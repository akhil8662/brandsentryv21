"""
Legal Review workflow endpoints.

POST /legal/submit                          — business team submits a brand name for review
GET  /legal/reviews                         — list reviews (mine=true for submitter-only view)
GET  /legal/reviews/{id}                    — single review detail
PUT  /legal/reviews/{id}/approve            — legal team approves
PUT  /legal/reviews/{id}/reject             — legal team rejects
PUT  /legal/reviews/{id}/request-revision   — legal team requests changes
DELETE /legal/reviews/{id}                  — submitter can retract a pending review
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime, timezone
import uuid

from app.core.database import get_db
from app.api.deps import get_current_user, TRADEMARK_ROLES
from app.core.roles import canonicalize_role, ROLE_LABELS
from app.models.user import User

from app.models.legal import LegalReview, LegalReviewBatch, ReviewMessage
from app.models.screening import BrandSearch
from app.models.brand import GeneratedBrandName
from app.services import notification as notif_svc
from pydantic import BaseModel, Field

router = APIRouter(prefix="/legal", tags=["Legal Review"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class SubmitReviewRequest(BaseModel):
    brand_name: str
    source_type: str = "manual"
    brand_search_id: Optional[str] = None
    generated_name_id: Optional[str] = None
    therapeutic_area: Optional[str] = None
    target_market: Optional[str] = None
    business_notes: Optional[str] = None
    risk_score: Optional[float] = None
    risk_level: Optional[str] = None
    risk_ai_assessment: Optional[str] = None
    market_ai_assessment: Optional[str] = None
    case_id: Optional[str] = Field(None, pattern=r"^[A-Za-z0-9_-]{1,30}$")
    case_name: Optional[str] = None


class SubmitBatchRequest(BaseModel):
    description: Optional[str] = None
    items: List[SubmitReviewRequest]


class ReviewActionRequest(BaseModel):
    comments: Optional[str] = None
    legal_ref: Optional[str] = None


class ResubmitReviewRequest(BaseModel):
    comments: Optional[str] = None
    rationale: Optional[str] = None


class ReviewMessageCreate(BaseModel):
    message: str = Field(..., max_length=5000)



class ReviewMessageOut(BaseModel):
    id: str
    review_id: str
    sender_id: Optional[str] = None
    sender_name: str
    sender_role: Optional[str] = None
    message: str
    created_at: Optional[str] = None

    class Config:
        from_attributes = True


class LegalReviewOut(BaseModel):
    id: str
    brand_name: str
    proposed_by_name: Optional[str]
    proposed_by_dept: Optional[str]
    submitted_at: str
    source_type: str
    therapeutic_area: Optional[str]
    target_market: Optional[str]
    business_notes: Optional[str]
    risk_score: Optional[float]
    risk_level: Optional[str]
    risk_ai_assessment: Optional[str]
    market_ai_assessment: Optional[str]
    status: str
    reviewer_name: Optional[str]
    reviewed_at: Optional[str]
    reviewer_comments: Optional[str]
    legal_ref: Optional[str]
    created_at: str
    messages: List[ReviewMessageOut] = []
    messages_count: int = 0

    class Config:
        from_attributes = True


def _message_to_out(m: ReviewMessage) -> dict:
    return {
        "id": str(m.id),
        "review_id": str(m.review_id),
        "sender_id": str(m.sender_id) if m.sender_id else None,
        "sender_name": m.sender_name,
        "sender_role": m.sender_role,
        "message": m.message,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def _to_out(r: LegalReview) -> dict:
    raw_msgs = r.messages if hasattr(r, "messages") and r.messages else []
    msgs = [_message_to_out(m) for m in raw_msgs]
    
    # If no explicit messages in table yet, synthesize from existing comments/notes if present
    if not msgs:
        if r.business_notes:
            msgs.append({
                "id": f"bn-{r.id}",
                "review_id": str(r.id),
                "sender_id": str(r.proposed_by_id) if r.proposed_by_id else None,
                "sender_name": r.proposed_by_name or "Brand Marketing Team",
                "sender_role": "Brand Marketing",
                "message": r.business_notes,
                "created_at": r.submitted_at.isoformat() if r.submitted_at else None,
            })
        if r.reviewer_comments:
            msgs.append({
                "id": f"rc-{r.id}",
                "review_id": str(r.id),
                "sender_id": str(r.reviewer_id) if r.reviewer_id else None,
                "sender_name": r.reviewer_name or "Trademark Counsel",
                "sender_role": "Trademark Counsel",
                "message": r.reviewer_comments,
                "created_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
            })

    return {
        "id": str(r.id),
        "brand_name": r.brand_name,
        "proposed_by_name": r.proposed_by_name,
        "proposed_by_dept": r.proposed_by_dept,
        "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
        "source_type": r.source_type,
        "therapeutic_area": r.therapeutic_area,
        "target_market": r.target_market,
        "business_notes": r.business_notes,
        "risk_score": r.risk_score,
        "risk_level": r.risk_level,
        "risk_ai_assessment": r.risk_ai_assessment,
        "market_ai_assessment": r.market_ai_assessment,
        "status": r.status,
        "reviewer_name": r.reviewer_name,
        "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
        "reviewer_comments": r.reviewer_comments,
        "legal_ref": r.legal_ref,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "messages": msgs,
        "messages_count": len(msgs),
    }


# ── Helpers (batch) ─────────────────────────────────────────────────────────

# Derived batch status — never stored, so it can't drift from its children.
def _batch_status(reviews) -> str:
    if not reviews:
        return "pending"
    if all(r.status == "pending" for r in reviews):
        return "pending"
    if all(r.status != "pending" for r in reviews):
        return "completed"
    return "in_progress"


def _generate_batch_code(db: Session) -> str:
    year = datetime.now(timezone.utc).year
    prefix = f"LR-{year}-"
    codes = db.query(LegalReviewBatch.batch_code).filter(
        LegalReviewBatch.batch_code.like(f"{prefix}%")
    ).all()
    max_seq = 0
    for (code,) in codes:
        try:
            max_seq = max(max_seq, int(code[len(prefix):]))
        except ValueError:
            continue
    return f"{prefix}{max_seq + 1:04d}"


_MAX_PENDING_PER_CASE = 6


def _enforce_case_pending_cap(db: Session, items: list["SubmitReviewRequest"]) -> None:
    by_case: dict[str, int] = {}
    for item in items:
        if item.case_id:
            by_case[item.case_id] = by_case.get(item.case_id, 0) + 1

    for case_id, new_count in by_case.items():
        pending = (
            db.query(LegalReview)
            .filter(LegalReview.case_id == case_id, LegalReview.status == "pending")
            .count()
        )
        if pending + new_count > _MAX_PENDING_PER_CASE:
            remaining = max(0, _MAX_PENDING_PER_CASE - pending)
            case_name = next((i.case_name for i in items if i.case_id == case_id and i.case_name), case_id)
            raise HTTPException(
                status_code=400,
                detail=(
                    f'"{case_name}" already has {pending} name(s) pending trademark review '
                    f"(max {_MAX_PENDING_PER_CASE} at a time). You can submit {remaining} more for this case "
                    f"right now — the rest can go in once Trademark Review resolves the current batch."
                ),
            )


def _build_review(body: SubmitReviewRequest, current_user: User, db: Session,
                  batch_id: Optional[uuid.UUID] = None) -> LegalReview:
    b_search_id = None
    if body.brand_search_id:
        try:
            b_search_id = uuid.UUID(body.brand_search_id)
            # L-24: Validate ownership of referenced search
            search = db.query(BrandSearch).filter(BrandSearch.id == b_search_id).first()
            if search and search.user_id and search.user_id != current_user.id and not current_user.is_superuser:
                raise HTTPException(status_code=403, detail="Not authorized to reference another user's brand search")
        except ValueError:
            pass

    g_name_id = None
    if body.generated_name_id:
        try:
            g_name_id = uuid.UUID(body.generated_name_id)
            # L-24: Validate ownership of referenced generated name
            gen = db.query(GeneratedBrandName).filter(GeneratedBrandName.id == g_name_id).first()
            if gen and gen.user_id and gen.user_id != current_user.id and not current_user.is_superuser:
                raise HTTPException(status_code=403, detail="Not authorized to reference another user's generated name")
        except ValueError:
            pass

    return LegalReview(
        id=uuid.uuid4(),
        batch_id=batch_id,
        brand_name=body.brand_name.strip(),
        proposed_by_id=current_user.id,
        proposed_by_name=current_user.full_name or current_user.email,
        proposed_by_dept=getattr(current_user, "department", None),
        source_type=body.source_type,
        brand_search_id=b_search_id,
        generated_name_id=g_name_id,
        therapeutic_area=body.therapeutic_area,
        target_market=body.target_market,
        business_notes=body.business_notes,
        risk_score=body.risk_score,
        risk_level=body.risk_level,
        risk_ai_assessment=body.risk_ai_assessment,
        market_ai_assessment=body.market_ai_assessment,
        case_id=body.case_id,
        case_name=body.case_name,
        status="pending",
    )



def _batch_to_out(batch: LegalReviewBatch, reviews=None) -> dict:
    reviews = batch.reviews if reviews is None else reviews
    reviewed = [r for r in reviews if r.status != "pending"]
    # Per-name outcome breakdown — drives the name-outcome KPI row.
    approved_count = sum(1 for r in reviews if r.status == "approved")
    rejected_count = sum(1 for r in reviews if r.status == "rejected")
    needs_revision_count = sum(1 for r in reviews if r.status == "needs_revision")
    pending_count = sum(1 for r in reviews if r.status == "pending")
    return {
        "id": str(batch.id),
        "batch_code": batch.batch_code,
        "description": batch.description,
        "proposed_by_name": batch.proposed_by_name,
        "proposed_by_dept": batch.proposed_by_dept,
        "submitted_at": batch.submitted_at.isoformat() if batch.submitted_at else None,
        "name_count": len(reviews),
        "reviewed_count": len(reviewed),
        "approved_count": approved_count,
        "rejected_count": rejected_count,
        "needs_revision_count": needs_revision_count,
        "pending_count": pending_count,
        "status": _batch_status(reviews),
        # Lightweight name list (not the full LegalReview rows) so the queue's
        # search can match a submitted name — e.g. "FYNARA" — against a batch
        # without a per-card detail fetch for every row in the list.
        "names": [r.brand_name for r in reviews],
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/submit", status_code=201)
def submit_for_review(
    body: SubmitReviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _enforce_case_pending_cap(db, [body])
    review = _build_review(body, current_user, db)
    db.add(review)
    db.flush()

    notif_svc.notify_reviewers_and_admins(
        db,
        ntype="legal_submitted",
        title=f"New legal review: {review.brand_name}",
        message=f"{current_user.full_name or current_user.email} submitted \"{review.brand_name}\" for legal review.",
        resource_id=review.id,
    )
    db.commit()
    db.refresh(review)
    return _to_out(review)


@router.get("/reviews")
def list_reviews(
    status: Optional[str] = Query(None),
    mine: bool = Query(False),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(LegalReview)
    # M-01: When mine=False, non-trademark/non-admin users automatically see only their own submissions
    is_tm_or_admin = current_user.is_superuser or (current_user.role in TRADEMARK_ROLES)
    if mine or not is_tm_or_admin:
        q = q.filter(LegalReview.proposed_by_id == current_user.id)
    if status:
        q = q.filter(LegalReview.status == status)
    # M-04: Pagination
    return [_to_out(r) for r in q.order_by(LegalReview.submitted_at.desc()).offset(offset).limit(limit).all()]


@router.get("/reviews/submitted-names")
def list_submitted_names(
    limit: int = Query(1000, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Every brand name that has ever been submitted for Trademark Review.
    M-02 & L-15: Scoped to submitter for non-trademark users and paginated."""
    q = db.query(LegalReview.brand_name).distinct()
    is_tm_or_admin = current_user.is_superuser or (current_user.role in TRADEMARK_ROLES)
    if not is_tm_or_admin:
        q = q.filter(LegalReview.proposed_by_id == current_user.id)
    rows = q.offset(offset).limit(limit).all()
    return [r[0] for r in rows]


@router.get("/reviews/{review_id}")
def get_review(
    review_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    review = db.query(LegalReview).filter(LegalReview.id == uuid.UUID(review_id)).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    # H-05: IDOR check - submitter, trademark role, or superuser only
    is_tm_or_admin = current_user.is_superuser or (current_user.role in TRADEMARK_ROLES)
    if review.proposed_by_id != current_user.id and not is_tm_or_admin:
        raise HTTPException(status_code=403, detail="Access denied to this legal review")
    return _to_out(review)



# ── Batch routes ──────────────────────────────────────────────────────────────

@router.post("/batches", status_code=201)
def submit_batch(
    body: SubmitBatchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    items = [i for i in body.items if i.brand_name and i.brand_name.strip()]
    if not items:
        raise HTTPException(status_code=400, detail="Batch must contain at least one name")
    _enforce_case_pending_cap(db, items)

    batch = LegalReviewBatch(
        id=uuid.uuid4(),
        batch_code=_generate_batch_code(db),
        description=(body.description or "").strip() or None,
        proposed_by_id=current_user.id,
        proposed_by_name=current_user.full_name or current_user.email,
        proposed_by_dept=getattr(current_user, "department", None),
    )
    db.add(batch)
    db.flush()

    reviews = [_build_review(item, current_user, db, batch_id=batch.id) for item in items]
    db.add_all(reviews)
    db.flush()

    notif_svc.notify_reviewers_and_admins(
        db,
        ntype="legal_submitted",
        title=f"New legal review batch: {batch.batch_code} ({len(reviews)} names)",
        message=(
            f"{current_user.full_name or current_user.email} submitted a batch of "
            f"{len(reviews)} name(s) for legal review"
            + (f": {batch.description}" if batch.description else ".")
        ),
        resource_id=batch.id,
    )
    db.commit()
    db.refresh(batch)
    return _batch_to_out(batch, reviews)


@router.get("/batches")
def list_batches(
    mine: bool = Query(False),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(LegalReviewBatch)
    is_tm_or_admin = current_user.is_superuser or (current_user.role in TRADEMARK_ROLES)
    if mine or not is_tm_or_admin:
        q = q.filter(LegalReviewBatch.proposed_by_id == current_user.id)
    # L-14: Pagination
    batches = q.order_by(LegalReviewBatch.submitted_at.desc()).offset(offset).limit(limit).all()
    return [_batch_to_out(b) for b in batches]


@router.get("/batches/{batch_id}")
def get_batch(
    batch_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    batch = db.query(LegalReviewBatch).filter(LegalReviewBatch.id == uuid.UUID(batch_id)).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    is_tm_or_admin = current_user.is_superuser or (current_user.role in TRADEMARK_ROLES)
    if batch.proposed_by_id != current_user.id and not is_tm_or_admin:
        raise HTTPException(status_code=403, detail="Access denied to this legal review batch")
    reviews = sorted(batch.reviews, key=lambda r: r.submitted_at or datetime.min)
    return {
        **_batch_to_out(batch, reviews),
        "reviews": [_to_out(r) for r in reviews],
    }



def _legal_action(review_id: str, new_status: str, body: ReviewActionRequest,
                  db: Session, current_user: User) -> dict:
    # H-04: Only trademark team members or superusers can approve/reject/request revision
    if not (current_user.is_superuser or current_user.role in TRADEMARK_ROLES):
        raise HTTPException(status_code=403, detail="Trademark review privileges required")

    review = db.query(LegalReview).filter(LegalReview.id == uuid.UUID(review_id)).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")

    review.status = new_status
    review.reviewer_id = current_user.id
    review.reviewer_name = current_user.full_name or current_user.email
    review.reviewed_at = datetime.now(timezone.utc)
    review.reviewer_comments = body.comments
    if body.legal_ref:
        review.legal_ref = body.legal_ref

    # Save to conversation history thread
    if body.comments and body.comments.strip():
        role_label = ROLE_LABELS.get(canonicalize_role(current_user.role), "Trademark User")
        msg = ReviewMessage(
            id=uuid.uuid4(),
            review_id=review.id,
            sender_id=current_user.id,
            sender_name=current_user.full_name or current_user.email,
            sender_role=role_label,
            message=body.comments.strip(),
            created_at=datetime.now(timezone.utc),
        )

        db.add(msg)

    _STATUS_META = {
        "approved":       ("legal_approved",      "approved",           "approved"),
        "rejected":       ("legal_rejected",       "rejected",           "rejected"),
        "needs_revision": ("legal_needs_revision", "needs revision",     "requested revisions on"),
    }
    ntype, label, verb = _STATUS_META.get(new_status, ("legal_action", new_status, new_status))
    reviewer_display = current_user.full_name or current_user.email
    title = f'Legal review {label}: {review.brand_name}'
    message = f'{reviewer_display} has {verb} the legal review for "{review.brand_name}".'
    if body.comments:
        message += f" Note: {body.comments}"

    # H-14: Targeted notifications to reviewers, admins, and submitter
    notif_svc.notify_reviewers_and_admins(db, ntype, title, message, review.id)
    if review.proposed_by_id and review.proposed_by_id != current_user.id:
        notif_svc._create(db, review.proposed_by_id, ntype, title, message, review.id)

    db.commit()
    db.refresh(review)
    return _to_out(review)


@router.put("/reviews/{review_id}/approve")
def approve_review(
    review_id: str,
    body: ReviewActionRequest = ReviewActionRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _legal_action(review_id, "approved", body, db, current_user)


@router.put("/reviews/{review_id}/reject")
def reject_review(
    review_id: str,
    body: ReviewActionRequest = ReviewActionRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _legal_action(review_id, "rejected", body, db, current_user)


@router.put("/reviews/{review_id}/request-revision")
def request_revision(
    review_id: str,
    body: ReviewActionRequest = ReviewActionRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _legal_action(review_id, "needs_revision", body, db, current_user)


@router.put("/reviews/{review_id}/resubmit")
def resubmit_review(
    review_id: str,
    body: ResubmitReviewRequest = ResubmitReviewRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """BMT user or Admin sends a subcase that required revision back to the Trademark Team."""
    review = db.query(LegalReview).filter(LegalReview.id == uuid.UUID(review_id)).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")

    review.status = "pending"
    review.submitted_at = datetime.now(timezone.utc)

    # Append revision clarification/notes and save to conversation thread
    comment_text = (body.comments or body.rationale or "").strip()
    if comment_text:
        user_name = current_user.full_name or current_user.email
        user_role = (current_user.role or "").lower()
        role_label = "Brand Marketing" if ("brand" in user_role or "market" in user_role) else (current_user.role or "Submitter")
        
        msg = ReviewMessage(
            id=uuid.uuid4(),
            review_id=review.id,
            sender_id=current_user.id,
            sender_name=user_name,
            sender_role=role_label,
            message=comment_text,
            created_at=datetime.now(timezone.utc),
        )
        db.add(msg)

        revised_note = f"[Revised by {user_name} on {datetime.now(timezone.utc).strftime('%d %b %Y, %H:%M UTC')}]: {comment_text}"
        if review.business_notes:
            review.business_notes = f"{review.business_notes}\n\n{revised_note}"
        else:
            review.business_notes = revised_note

    # H-14: Targeted notification to trademark reviewers and admins
    case_label = review.case_name or review.case_id or "Case"
    notif_svc.notify_reviewers_and_admins(
        db,
        ntype="legal_submitted",
        title=f"Subcase Resubmitted: {review.brand_name} ({case_label})",
        message=f"{current_user.full_name or current_user.email} (Brand Marketing) resubmitted '{review.brand_name}' for case '{case_label}' with revised information to the Trademark Team.",
        resource_id=review.id,
    )

    db.commit()
    db.refresh(review)
    return _to_out(review)


@router.get("/reviews/{review_id}/messages")
def get_review_messages(
    review_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    review = db.query(LegalReview).filter(LegalReview.id == uuid.UUID(review_id)).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    # H-05: Access check
    is_tm_or_admin = current_user.is_superuser or (current_user.role in TRADEMARK_ROLES)
    if review.proposed_by_id != current_user.id and not is_tm_or_admin:
        raise HTTPException(status_code=403, detail="Access denied to messages for this review")

    msgs = db.query(ReviewMessage).filter(ReviewMessage.review_id == review.id).order_by(ReviewMessage.created_at.asc()).all()
    if not msgs:
        out = []
        if review.business_notes:
            out.append({
                "id": f"bn-{review.id}",
                "review_id": str(review.id),
                "sender_id": str(review.proposed_by_id) if review.proposed_by_id else None,
                "sender_name": review.proposed_by_name or "Brand Marketing Team",
                "sender_role": "Brand Marketing",
                "message": review.business_notes,
                "created_at": review.submitted_at.isoformat() if review.submitted_at else None,
            })
        if review.reviewer_comments:
            out.append({
                "id": f"rc-{review.id}",
                "review_id": str(review.id),
                "sender_id": str(review.reviewer_id) if review.reviewer_id else None,
                "sender_name": review.reviewer_name or "Trademark Counsel",
                "sender_role": "Trademark Counsel",
                "message": review.reviewer_comments,
                "created_at": review.reviewed_at.isoformat() if review.reviewed_at else None,
            })
        return out
    return [_message_to_out(m) for m in msgs]


@router.post("/reviews/{review_id}/messages", status_code=201)
def post_review_message(
    review_id: str,
    body: ReviewMessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    review = db.query(LegalReview).filter(LegalReview.id == uuid.UUID(review_id)).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")

    # M-03: Participation check - submitter, trademark role, or superuser only
    is_tm_or_admin = current_user.is_superuser or (current_user.role in TRADEMARK_ROLES)
    if review.proposed_by_id != current_user.id and not is_tm_or_admin:
        raise HTTPException(status_code=403, detail="Not authorized to post messages on this review")

    text = (body.message or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    # L-11: Length limit
    if len(text) > 5000:
        raise HTTPException(status_code=400, detail="Message cannot exceed 5000 characters")

    role_label = ROLE_LABELS.get(canonicalize_role(current_user.role), "Team Member")

    msg = ReviewMessage(
        id=uuid.uuid4(),
        review_id=review.id,
        sender_id=current_user.id,
        sender_name=current_user.full_name or current_user.email,
        sender_role=role_label,
        message=text,
        created_at=datetime.now(timezone.utc),
    )

    db.add(msg)

    sender_name = current_user.full_name or current_user.email
    # H-14: Targeted notifications
    notif_svc.notify_reviewers_and_admins(
        db,
        ntype="legal_comment",
        title=f"New Note on {review.brand_name}",
        message=f"{sender_name} ({role_label}) posted a note on '{review.brand_name}': {text[:120]}",
        resource_id=review.id,
    )
    if review.proposed_by_id and review.proposed_by_id != current_user.id:
        notif_svc._create(db, review.proposed_by_id, "legal_comment", f"New Note on {review.brand_name}", f"{sender_name} ({role_label}) posted a note: {text[:120]}", review.id)

    db.commit()
    db.refresh(msg)
    return _message_to_out(msg)


@router.delete("/reviews/{review_id}", status_code=204)
def retract_review(
    review_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    review = db.query(LegalReview).filter(LegalReview.id == uuid.UUID(review_id)).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    if review.status != "pending":
        raise HTTPException(status_code=400, detail="Only pending reviews can be retracted")
    # H-06: Submitter verification
    if review.proposed_by_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="You can only retract your own submissions")

    brand = review.brand_name
    db.delete(review)
    notif_svc.notify_admins(
        db,
        ntype="legal_retracted",
        title=f"Review retracted: {brand}",
        message=f"{current_user.full_name or current_user.email} retracted the legal review for \"{brand}\".",
    )
    db.commit()

