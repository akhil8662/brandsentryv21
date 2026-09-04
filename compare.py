"""Compare Names — DB-first history lookup in front of the Brand Analysis
screening pipeline.

For each name submitted to Compare, checks whether it has already been
screened (Brand Analysis history, `brand_searches`/`screening_results`) or
generated+market-verified (AI Name Generator history, `generated_brand_names`)
within the last 90 days, and serves that record directly instead of
re-running the full WHO INN -> IQVIA -> Google -> e-pharmacy pipeline. Only a
genuinely new (or stale) name pays for a fresh pipeline run — which is the
exact same `BrandScreeningService.screen_brand()` used by `/brands/screen`,
unmodified, so Brand Analysis's own behavior (always fresh) is untouched.

A generator-history hit is treated as equally trustworthy evidence as a
screening-history hit, since the generator's own `_verify_against_market()`
already checks the same four tiers per candidate. But its stored evidence is
handled carefully: `conflict_details.top_conflicts` (scored against the
Trademark Registry / Market Database / prior-generated-names pool) is always
about the name that was actually persisted, so it's safe to reuse as the sole
source of conflict/score data. `conflict_details.market_check.conflicts_found`
(the WHO/IQVIA/pharmacy/Google evidence) is NOT safe to reuse for per-tier
scores or counts — the generator's auto-regeneration loop can leave entries in
that list that describe an earlier, discarded candidate name rather than the
one that was saved. Only its four `*_checked` booleans are used (they
describe whether a tier ran, which is accurate regardless of which attempt it
ran against) — surfaced as a note in the assessment text rather than a
fabricated similarity number.
"""
import logging
import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.brand import GeneratedBrandName
from app.models.screening import BrandSearch
from app.repositories.brand import BrandRepository
from app.repositories.screening import ScreeningRepository
from app.services.brand_screening import BrandScreeningService, _CONFLICT_THRESHOLD, _SIMILAR_THRESHOLD, _risk_level
from app.services.screening import (
    levenshtein_similarity, fuzzy_similarity, phonetic_similarity,
    lookalike_score, composite_similarity, classify_similarity_types,
    prefix_suffix_collision_score, calculate_mentor_risk_score,
)

logger = logging.getLogger(__name__)

HISTORY_FRESHNESS_DAYS = 90

_GEN_STATUS_TO_RECOMMENDATION = {
    "recommended": "PROCEED",
    "review_required": "LEGAL_REVIEW",
    "high_risk": "REJECT",
}
_TRADEMARK_SOURCE = "Trademark Registry"
# market_presence_score is surfaced by the frontend specifically as the
# "Google Search" workflow step's presence index (see
# ScreeningResultBlocks.tsx) — scoped to genuine Google-sourced hits only,
# matching brand_screening.py's fresh-pipeline scoring, so it never
# silently absorbs a WHO INN/IQVIA/E-Pharmacy hit under the Google label.
_GOOGLE_SOURCE = "Google Search"


class CompareService:
    def __init__(self, db: Session):
        self.db = db
        self.screening_repo = ScreeningRepository(db)
        self.brand_repo = BrandRepository(db)
        self.screening_service = BrandScreeningService(db)

    async def compare_one(
        self, brand_name: str, user_id: Optional[uuid.UUID], case_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        name = brand_name.strip()
        logger.info("================================================================================")
        logger.info("[COMPARE PIPELINE START] %r (case_id=%s)", name, case_id)

        screening_hit = self.screening_repo.get_latest_by_name(name, max_age_days=HISTORY_FRESHNESS_DAYS)
        generator_hit = self.brand_repo.get_latest_by_generated_name(name, max_age_days=HISTORY_FRESHNESS_DAYS)

        chosen = _pick_more_recent(screening_hit, generator_hit)
        if chosen == "screening":
            age = _age_days(screening_hit.created_at)
            logger.info(
                "[HISTORY HIT] %r served from Brand Screening history (search_id=%s, screened_at=%s, age=%dd)",
                name, screening_hit.id, screening_hit.created_at, age,
            )
            # If case_id is provided, ensure a BrandSearch entry exists for this case
            if case_id:
                clean_case = case_id.strip()
                existing_for_case = self.db.query(BrandSearch).filter(
                    func.lower(BrandSearch.brand_name) == name.lower(),
                    func.lower(func.trim(BrandSearch.case_id)) == clean_case.lower(),
                ).first()
                if not existing_for_case:
                    if not screening_hit.case_id:
                        screening_hit.case_id = clean_case
                        self.db.commit()
                    else:
                        new_search = self.screening_repo.create_search(name, user_id, case_id=clean_case)
                        if screening_hit.screening_result:
                            sr = screening_hit.screening_result
                            sims = [
                                {
                                    "name": sn.name,
                                    "similarity_type": sn.similarity_type,
                                    "similarity_score": sn.similarity_score,
                                    "source": sn.source,
                                    "risk_level": sn.risk_level,
                                    "therapeutic_area": sn.therapeutic_area,
                                    "manufacturer": sn.manufacturer,
                                    "country": sn.country,
                                }
                                for sn in sr.similar_names
                            ]
                            confs = [
                                {
                                    "conflicting_name": c.conflicting_name,
                                    "conflict_type": c.conflict_type,
                                    "source": c.source,
                                    "severity": c.severity,
                                    "details": c.details,
                                    "registration_number": c.registration_number,
                                    "owner": c.owner,
                                    "status": c.status,
                                }
                                for c in sr.conflicts
                            ]
                            res_dict = {
                                "overall_risk_score": sr.overall_risk_score,
                                "risk_classification": sr.risk_classification,
                                "exact_match_score": sr.exact_match_score,
                                "spelling_similarity_score": sr.spelling_similarity_score,
                                "phonetic_similarity_score": sr.phonetic_similarity_score,
                                "semantic_similarity_score": sr.semantic_similarity_score,
                                "lookalike_score": sr.lookalike_score,
                                "soundalike_score": sr.soundalike_score,
                                "trademark_conflict_score": sr.trademark_conflict_score,
                                "market_presence_score": sr.market_presence_score,
                                "memorability_score": sr.memorability_score,
                                "pronunciation_score": sr.pronunciation_score,
                                "stages_completed": sr.stages_completed,
                                "rejected_at_stage": sr.rejected_at_stage,
                                "rejected_stage_name": sr.rejected_stage_name,
                                "rejection_reason": sr.rejection_reason,
                                "ai_assessment": sr.ai_assessment,
                                "ai_recommendation": sr.ai_recommendation,
                                "total_conflicts": sr.total_conflicts,
                                "trademark_conflicts": sr.trademark_conflicts,
                                "market_conflicts": sr.market_conflicts,
                                "epharmacy_conflicts": sr.epharmacy_conflicts,
                            }
                            self.screening_repo.save_result(new_search.id, res_dict, sims, confs)
            result = {**_from_brand_search(screening_hit), "source": "screening_history"}
        elif chosen == "generator":
            age = _age_days(generator_hit.created_at)
            logger.info(
                "[HISTORY HIT] %r served from AI Name Generator history (id=%s, generated_at=%s, age=%dd)",
                name, generator_hit.id, generator_hit.created_at, age,
            )
            # If case_id is provided, associate this screening with this case
            if case_id:
                clean_case = case_id.strip()
                existing_for_case = self.db.query(BrandSearch).filter(
                    func.lower(BrandSearch.brand_name) == name.lower(),
                    func.lower(func.trim(BrandSearch.case_id)) == clean_case.lower(),
                ).first()
                if not existing_for_case:
                    new_search = self.screening_repo.create_search(name, user_id, case_id=clean_case)
                    gen_data = _from_generated_name(generator_hit, self.db)
                    sr_data = gen_data["screening_result"]
                    sims = [
                        {
                            "name": sn["name"],
                            "similarity_type": sn["similarity_type"],
                            "similarity_score": sn["similarity_score"],
                            "source": sn["source"],
                            "risk_level": sn.get("risk_level", "LOW"),
                            "therapeutic_area": sn.get("therapeutic_area"),
                            "manufacturer": sn.get("manufacturer"),
                            "country": sn.get("country"),
                        }
                        for sn in sr_data.get("similar_names", [])
                    ]
                    confs = [
                        {
                            "conflicting_name": c["conflicting_name"],
                            "conflict_type": c["conflict_type"],
                            "source": c["source"],
                            "severity": c.get("severity", "LOW"),
                            "details": c.get("details"),
                            "registration_number": c.get("registration_number"),
                            "owner": c.get("owner"),
                            "status": c.get("status"),
                        }
                        for c in sr_data.get("conflicts", [])
                    ]
                    res_dict = {
                        "overall_risk_score": sr_data.get("overall_risk_score", 0.0),
                        "risk_classification": sr_data.get("risk_classification", "LOW"),
                        "exact_match_score": sr_data.get("exact_match_score", 0.0),
                        "spelling_similarity_score": sr_data.get("spelling_similarity_score", 0.0),
                        "phonetic_similarity_score": sr_data.get("phonetic_similarity_score", 0.0),
                        "semantic_similarity_score": sr_data.get("semantic_similarity_score", 0.0),
                        "lookalike_score": sr_data.get("lookalike_score", 0.0),
                        "soundalike_score": sr_data.get("soundalike_score", 0.0),
                        "trademark_conflict_score": sr_data.get("trademark_conflict_score", 0.0),
                        "market_presence_score": sr_data.get("market_presence_score", 0.0),
                        "memorability_score": sr_data.get("memorability_score"),
                        "pronunciation_score": sr_data.get("pronunciation_score"),
                        "stages_completed": sr_data.get("stages_completed", 3),
                        "rejected_at_stage": sr_data.get("rejected_at_stage"),
                        "rejected_stage_name": sr_data.get("rejected_stage_name"),
                        "rejection_reason": sr_data.get("rejection_reason"),
                        "ai_assessment": sr_data.get("ai_assessment"),
                        "ai_recommendation": sr_data.get("ai_recommendation"),
                        "total_conflicts": sr_data.get("total_conflicts", 0),
                        "trademark_conflicts": sr_data.get("trademark_conflicts", 0),
                        "market_conflicts": sr_data.get("market_conflicts", 0),
                        "epharmacy_conflicts": sr_data.get("epharmacy_conflicts", 0),
                    }
                    self.screening_repo.save_result(new_search.id, res_dict, sims, confs)
            result = {**_from_generated_name(generator_hit, self.db), "source": "generator_history"}
        else:
            logger.info(
                "[HISTORY MISS] %r not found in either history table within %d days — running full screening pipeline",
                name, HISTORY_FRESHNESS_DAYS,
            )
            search = await self.screening_service.screen_brand(name, user_id, case_id=case_id)
            result = {**_from_brand_search(search), "source": "fresh_pipeline"}

        logger.info("[COMPARE PIPELINE COMPLETE] %r resolved via %s", name, result["source"])
        return result


def _age_days(created_at) -> int:
    from datetime import datetime, timezone
    if not created_at:
        return 0
    now = datetime.now(timezone.utc)
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return (now - created_at).days



def _pick_more_recent(
    screening_hit: Optional[BrandSearch], generator_hit: Optional[GeneratedBrandName],
) -> Optional[str]:
    """Both history sources are equally trustworthy evidence (confirmed
    product decision) — when both exist within the freshness window, prefer
    whichever is more recent rather than a fixed table priority, since
    recency is the entire point of the freshness rule."""
    if screening_hit and generator_hit:
        return "screening" if screening_hit.created_at >= generator_hit.created_at else "generator"
    if screening_hit:
        return "screening"
    if generator_hit:
        return "generator"
    return None


def _from_brand_search(search: BrandSearch) -> Dict[str, Any]:
    return {
        "id": search.id,
        "brand_name": search.brand_name,
        "status": search.status,
        "created_at": search.created_at,
        "screening_result": search.screening_result,
    }


def _from_generated_name(g: GeneratedBrandName, db: Optional[Session] = None) -> Dict[str, Any]:
    conflict_details = g.conflict_details or {}
    top_conflicts: List[dict] = conflict_details.get("top_conflicts") or []
    market_check: Dict[str, Any] = conflict_details.get("market_check") or {}

    similar_names: List[dict] = []
    conflicts: List[dict] = []
    max_trademark = max_market = 0.0
    any_exact = False

    # A stored conflict (see generator.py's _score_candidate) carries every
    # similarity dimension it actually earned, each with its own real score,
    # so a row here is scored by the dimension it's tagged with rather than
    # the generic composite `score`. similarity_types/the four score fields
    # are absent on conflicts stored before this existed; both fall back to
    # the old single-label shape.

    for c in top_conflicts:
        cname = (c.get("name") or "").strip()
        if not cname:
            continue
        score = float(c.get("similarity_score") or 0.0)
        source = c.get("source") or "Unknown"

        if source == _TRADEMARK_SOURCE:
            max_trademark = max(max_trademark, score)
        elif source == _GOOGLE_SOURCE:
            max_market = max(max_market, score)
        is_exact = cname.lower() == g.generated_name.strip().lower()
        if is_exact:
            any_exact = True

        if score >= _CONFLICT_THRESHOLD:
            conflicts.append({
                "id": uuid.uuid4(),
                "conflicting_name": cname,
                "conflict_type": "EXACT_MARKET_MATCH" if is_exact else (c.get("similarity_type") or "MARKET_MATCH"),
                "source": source,
                "severity": _risk_level(score),
                "details": f'"{cname}" ({source}) is {round(score * 100)}% similar to "{g.generated_name}".',
                "owner": c.get("owner"),
            })

        lev = c.get("spelling_score") or levenshtein_similarity(g.generated_name, cname)
        phon = c.get("phonetic_score") or phonetic_similarity(g.generated_name, cname)
        look = c.get("lookalike_score") or lookalike_score(g.generated_name, cname)
        sem = c.get("semantic_similarity_score") or (round(score * 0.5, 3) if score >= 0.30 else 0.0)
        
        dims = [
            ("Phonetic", phon),
            ("Spelling", lev),
            ("Visual", look),
            ("Conceptual", sem),
        ]
        for dim_type, dim_score in dims:
            if dim_score is not None and float(dim_score) >= _SIMILAR_THRESHOLD:
                similar_names.append({
                    "id": uuid.uuid4(),
                    "name": cname,
                    "similarity_type": dim_type,
                    "similarity_score": round(float(dim_score), 3),
                    "source": source,
                    "risk_level": _risk_level(dim_score),
                    "manufacturer": c.get("owner"),
                })

    # Evaluate against trademark registry, market database, and cached pharmacy listings
    from app.repositories.trademark import TrademarkRepository
    from app.core.cache import cache_service
    
    # Load cached collision pool or full DB pool
    pool_candidates = cache_service.get_json("global_db_conflict_pool")
    if pool_candidates is None and db is not None:
        tm_repo = TrademarkRepository(db)
        pool_candidates = (
            [{"name": t.brand_name, "owner": t.owner, "source": "Trademark Registry"} for t in tm_repo.get_all_trademarks() if t.brand_name] +
            [{"name": m.brand_name, "owner": m.manufacturer, "source": "Market Database"} for m in tm_repo.get_all_market_brands() if m.brand_name]
        )
    elif pool_candidates is None:
        pool_candidates = []

    # Also check cached pharmacy scrape listings for this name
    pharm_cached = cache_service.get_json(f"pharmacy_scrape:{g.generated_name.upper()}") or []
    for p in pharm_cached:
        if p.get("brand_name"):
            pool_candidates.append({"name": p["brand_name"], "owner": p.get("manufacturer"), "source": p.get("source", "E-Pharmacy")})

    for ref in pool_candidates:
        bname = ref.get("name")
        bowner = ref.get("owner")
        bsource = ref.get("source", "Trademark Registry")
        if not bname:
            continue
        lev = levenshtein_similarity(g.generated_name, bname)
        fuz = fuzzy_similarity(g.generated_name, bname)
        phon = phonetic_similarity(g.generated_name, bname)
        look = lookalike_score(g.generated_name, bname)
        comp = composite_similarity(g.generated_name, bname)
        ps = prefix_suffix_collision_score(g.generated_name, bname)

        effective_comp = max(comp, ps, phon) if (ps >= 0.80 or phon >= 0.85) else comp

        dims = [
            ("Phonetic", phon),
            ("Spelling", max(lev, fuz)),
            ("Visual", look),
            ("Conceptual", round(effective_comp * 0.5, 3) if effective_comp >= 0.30 else 0.0),
        ]
        for clean_label, label_score in dims:
            if label_score is not None and float(label_score) >= _SIMILAR_THRESHOLD:
                if not any(s["name"].lower() == bname.lower() and s["similarity_type"] == clean_label for s in similar_names):
                    similar_names.append({
                        "id": uuid.uuid4(),
                        "name": bname,
                        "similarity_type": clean_label,
                        "similarity_score": round(float(label_score), 3),
                        "source": bsource,
                        "risk_level": _risk_level(label_score),
                        "manufacturer": bowner,
                    })

    def _max_similarity(*labels: str) -> float:
        scores_for_labels = [sn["similarity_score"] for sn in similar_names if sn["similarity_type"] in labels and sn["similarity_score"] >= _SIMILAR_THRESHOLD]
        return max(scores_for_labels) if scores_for_labels else 0.0

    max_lev = _max_similarity("Spelling")
    max_phon = _max_similarity("Phonetic")
    max_look = _max_similarity("Visual", "Look-Alike")
    max_sem = _max_similarity("Conceptual", "Semantic")

    similar_names.sort(key=lambda s: s["similarity_score"], reverse=True)

    def _is_epharmacy_source(src: str) -> bool:
        s = (src or "").lower()
        return any(k in s for k in ("1mg", "pharmeasy", "apollo", "netmeds", "pharmacy", "e-pharmacy"))

    trademark_conflicts = sum(1 for c in conflicts if c["source"] == _TRADEMARK_SOURCE)
    epharmacy_conflicts = sum(1 for c in conflicts if _is_epharmacy_source(c["source"]))
    market_conflicts = max(len(conflicts) - trademark_conflicts - epharmacy_conflicts, 0)

    exact_score = 1.0 if any_exact else 0.0
    phonetic_score = max_phon
    spelling_score = max_lev
    visual_score = max_look
    conceptual_score = max_sem
    market_presence_score = float(conflict_details.get("market_presence_score") or max_market or 0.0)

    # Mentor's 4-Parameter Balanced Formula with Hard Knockout Gates
    # Re-compute using the same formula that was applied during generation,
    # so the Detailed Analysis modal is always consistent with the card score.
    calculated_risk, risk_classification, ai_recommendation = calculate_mentor_risk_score(
        phonetic_score=phonetic_score,
        spelling_score=spelling_score,
        visual_score=visual_score,
        conceptual_score=conceptual_score,
        is_exact_match=bool(any_exact),
        is_who_inn_knockout=False,
    )

    # Use the DB-persisted risk_score as the single source of truth
    # (set by _rescore_candidate_with_market after the full pipeline).
    # Only fall back to recalculated score if DB value is missing/zero.
    db_risk = float(g.risk_score) if g.risk_score is not None else 0.0
    if db_risk > 0.0:
        risk_score = round(db_risk, 1)
        risk_classification = "HIGH" if risk_score >= 65 else "MEDIUM" if risk_score >= 30 else "LOW"
        ai_recommendation = _GEN_STATUS_TO_RECOMMENDATION.get(g.recommendation_status, "LEGAL_REVIEW")
    else:
        risk_score = calculated_risk

    tiers_checked = ", ".join(
        f"{label}: {'checked' if market_check.get(key) else 'not checked'}"
        for label, key in (
            ("WHO INN", "who_inn_checked"), ("IQVIA", "iqvia_checked"),
            ("E-Pharmacy", "pharmacy_checked"), ("Google", "google_checked"),
        )
    )
    ai_assessment = g.ai_explanation or conflict_details.get("rationale") or None
    if tiers_checked:
        note = f"Market verification at generation time: {tiers_checked}."
        ai_assessment = f"{ai_assessment.rstrip()} {note}" if ai_assessment else note

    screening_result = {
        "id": uuid.uuid4(),
        "brand_search_id": g.id,
        "brand_name": g.generated_name,
        "overall_risk_score": risk_score,
        "risk_classification": risk_classification,
        "exact_match_score": exact_score,
        "spelling_similarity_score": round(max_lev, 3),
        "phonetic_similarity_score": round(max_phon, 3),
        "semantic_similarity_score": round(conceptual_score, 3),
        "lookalike_score": round(max_look, 3),
        "soundalike_score": 0.0,
        "trademark_conflict_score": round(max_trademark, 3),
        "market_presence_score": round(market_presence_score, 3),
        # Real values captured at generation time (see generator.py's
        # _score_candidate) — not recomputed here, just finally threaded
        # through to Compare instead of being silently dropped.
        "availability_score": g.availability_score or round(max(100.0 - risk_score, 0.0), 1),
        "memorability_score": g.memorability_score or 80.0,
        "pronunciation_score": g.pronunciation_score or 85.0,
        "ai_assessment": ai_assessment,
        "ai_recommendation": ai_recommendation,
        "total_conflicts": len(conflicts),
        "trademark_conflicts": trademark_conflicts,
        "market_conflicts": max(market_conflicts, 0),
        "epharmacy_conflicts": epharmacy_conflicts,
        "similar_names": similar_names,
        "conflicts": conflicts,
        "created_at": g.created_at,
    }
    return {
        "id": g.id,
        "brand_name": g.generated_name,
        "status": "completed",
        "created_at": g.created_at,
        "screening_result": screening_result,
    }
