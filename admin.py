from app.core.rate_limit import get_client_ip
"""
Admin endpoints for data management and user management.
All endpoints require is_superuser=True or admin role.
"""

from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException, Query, Request
from sqlalchemy.orm import Session
from typing import Optional
import uuid


from app.core.database import get_db
from app.api.deps import get_current_user, require_superuser, require_super_admin
from app.core.roles import UserRole
from app.models.user import User
from app.models.trademark import MarketBrand
from app.services.external_apis import search_openfda
from app.repositories.user import UserRepository
from app.repositories.audit import AuditRepository
from app.schemas.user import UserAdminResponse, CreateUserAdminRequest, UpdateUserAdminRequest

router = APIRouter(prefix="/admin", tags=["Admin"])

# ── User Management ────────────────────────────────────────────────────────────

@router.get("/users", response_model=list[UserAdminResponse])
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_superuser),
):
    return UserRepository(db).get_all_users()


@router.post("/users", response_model=UserAdminResponse)
def create_user(
    request: CreateUserAdminRequest,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    client_ip = get_client_ip(http_request)
    repo = UserRepository(db)
    if repo.get_by_email(request.email):
        raise HTTPException(status_code=400, detail="Email already registered")
    canonical_role = request.get_canonical_role()
    is_super = request.is_superuser or (canonical_role == UserRole.SUPER_ADMIN.value)
    user = repo.create(
        email=request.email,
        full_name=request.full_name,
        password=request.password,
        role=canonical_role,
        department=request.department,
        is_superuser=is_super,
    )

    AuditRepository(db).create(
        action="USER_CREATED",
        user_id=current_user.id,
        resource_type="user",
        resource_id=str(user.id),
        details=f"Created user {user.email} (Role: {user.role})",
        metadata={"email": user.email, "role": user.role, "department": user.department},
        ip_address=client_ip,
        status="success",
    )
    return user


@router.patch("/users/{user_id}", response_model=UserAdminResponse)
def update_user(
    user_id: uuid.UUID,
    request: UpdateUserAdminRequest,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    client_ip = get_client_ip(http_request)
    repo = UserRepository(db)
    target = repo.get_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    old_role = target.role
    old_superuser = target.is_superuser

    data = {k: v for k, v in request.model_dump().items() if v is not None}
    if "role" in data:
        data["role"] = request.get_canonical_role()
        if data["role"] == UserRole.SUPER_ADMIN.value:
            data["is_superuser"] = True
    user = repo.update_user(user_id, **data)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # L-18: Specific ROLE_CHANGED audit record for privilege changes
    if "role" in data or "is_superuser" in data:
        AuditRepository(db).create(
            action="ROLE_CHANGED",
            user_id=current_user.id,
            resource_type="user",
            resource_id=str(user.id),
            details=f"Privilege change for {user.email}: role ({old_role} -> {user.role}), superuser ({old_superuser} -> {user.is_superuser})",
            metadata={"old_role": old_role, "new_role": user.role, "old_superuser": old_superuser, "new_superuser": user.is_superuser},
            ip_address=client_ip,
            status="success",
        )
    else:
        AuditRepository(db).create(
            action="USER_UPDATED",
            user_id=current_user.id,
            resource_type="user",
            resource_id=str(user.id),
            details=f"Updated user {user.email}",
            metadata=data,
            ip_address=client_ip,
            status="success",
        )
    return user


@router.delete("/users/{user_id}")
def deactivate_user(
    user_id: uuid.UUID,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    client_ip = get_client_ip(http_request)
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
    repo = UserRepository(db)
    user = repo.update_user(user_id, is_active=False)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    AuditRepository(db).create(
        action="USER_DEACTIVATED",
        user_id=current_user.id,
        resource_type="user",
        resource_id=str(user.id),
        details=f"Deactivated user {user.email}",
        ip_address=client_ip,
        status="success",
    )
    return {"message": "User deactivated"}


@router.delete("/users/{user_id}/permanent")
def delete_user(
    user_id: uuid.UUID,
    http_request: Request,
    confirm_email: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    client_ip = get_client_ip(http_request)
    """Permanently remove a user (distinct from deactivation).
    L-22: Requires confirm_email parameter matching the user's email."""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    repo = UserRepository(db)
    target = repo.get_by_id(user_id)

    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if not confirm_email or confirm_email.strip().lower() != target.email.lower():
        raise HTTPException(
            status_code=400,
            detail=f"Permanent deletion requires email confirmation. Pass confirm_email='{target.email}'.",
        )
    target_email = target.email
    deleted = repo.delete_user(user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="User not found")
    AuditRepository(db).create(
        action="USER_DELETED",
        user_id=current_user.id,
        resource_type="user",
        resource_id=str(user_id),
        details=f"Permanently deleted user {target_email}",
        ip_address=client_ip,
        status="success",
    )
    return {"message": "User deleted"}


# ── FDA Data Sync ──────────────────────────────────────────────────────────────

_SEED_TERMS = [
    "cardio", "neuro", "gluco", "onco", "respir", "arthro", "derm",
    "gastro", "nephro", "immuno", "meta", "vaso", "pulmo", "osteo",
    "lipid", "hyper", "diab", "thyro", "hemo", "infect",
]


@router.post("/sync/fda")
async def sync_fda_data(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_superuser),
):
    background_tasks.add_task(_run_fda_sync, db)
    return {"message": "FDA sync started in background", "terms": len(_SEED_TERMS)}



async def _run_fda_sync(db: Session):
    import asyncio
    inserted = 0

    for term in _SEED_TERMS:
        try:
            results = await search_openfda(term)
            for item in results:
                brand = item.get("brand_name", "").strip()
                if not brand or len(brand) < 2:
                    continue

                exists = (
                    db.query(MarketBrand)
                    .filter(MarketBrand.brand_name.ilike(brand))
                    .first()
                )
                if exists:
                    continue

                normalized = brand.lower().strip()
                record = MarketBrand(
                    brand_name=brand,
                    normalized_name=normalized,
                    manufacturer=item.get("manufacturer", ""),
                    therapeutic_area=item.get("product_type", "Pharmaceutical"),
                    drug_class=item.get("route", ""),
                    active_ingredient=item.get("generic_name", ""),
                    country="US",
                    is_otc=False,
                    is_generic=False,
                )
                db.add(record)
                inserted += 1

            await asyncio.sleep(0.3)

        except Exception:
            continue

    try:
        db.commit()
    except Exception:
        db.rollback()

    return inserted
