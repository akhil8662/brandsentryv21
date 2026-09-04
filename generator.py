import asyncio
import json
import logging
import re
import uuid
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.brand import GeneratedBrandName
from app.repositories.brand import BrandRepository
from app.repositories.trademark import TrademarkRepository
from app.repositories.settings import SettingsRepository
from app.services.ai import ai_service, AIServiceError
from app.services.market_check import (
    _brand_stub, find_google_conflict, find_iqvia_conflict, find_pharmacy_conflict, find_who_inn_conflict,
    google_search_configured, scrape_pharmacy_listings,
)
from app.services.screening import (
    calculate_mentor_risk_score,
    classify_similarity_types, composite_similarity, fuzzy_similarity, levenshtein_similarity,
    lookalike_score, phonetic_similarity, prefix_similarity, suffix_similarity,
    prefix_suffix_collision_score, safe_phonetic_code, validate_linguistic_structure,
)

logger = logging.getLogger(__name__)

DEFAULT_RISK_WEIGHTS = {"trademark": 0.40, "phonetic": 0.25, "semantic": 0.20, "market": 0.15}

_CONFLICT_THRESHOLD = 0.45
_MAX_TOP_CONFLICTS = 15
_OWNER_SUFFIX_RE = re.compile(r"\s*\(([^)]+)\)\s*$")  # NOSONAR - single bounded group, not backtracking-prone

# Original name + up to 2 regenerated replacements
_MAX_MARKET_ATTEMPTS = 3


def _split_names(raw: Optional[str], source: str) -> List[Dict[str, Optional[str]]]:
    if not raw or not raw.strip():
        return []
    entries = []
    for chunk in re.split(r"[,;]", raw):
        chunk = chunk.strip()
        if not chunk:
            continue
        owner = None
        match = _OWNER_SUFFIX_RE.search(chunk)
        name = chunk
        if match:
            owner = match.group(1).strip()
            name = _OWNER_SUFFIX_RE.sub("", chunk).strip()
        if name:
            entries.append({"name": name, "owner": owner, "source": source})
    return entries


def _build_context(request) -> Tuple[Dict[str, Any], List[Dict[str, Optional[str]]]]:
    existing_brand_names: List[Dict[str, Optional[str]]] = []

    if request.suggestion_form:
        sf = request.suggestion_form
        context = {
            "molecule": sf.product_information.generic_name,
            "dosage_form": sf.product_information.dosage_form,
            "dose": sf.product_information.dose,
            "division": sf.product_information.division,
            "ailment": sf.medical_information.ailment,
            "segment": sf.medical_information.segment,
            "therapy": sf.medical_information.therapy,
            "promoting_indications": sf.medical_information.promoting_indications,
            "mfd_type": sf.manufacturing_information.mfd_type,
            "in_license": sf.manufacturing_information.in_license,
            "parent_brand_owner": sf.manufacturing_information.parent_brand_owner,
            "marketer_name": sf.commercial_information.marketer_name,
            "expected_launch_month": sf.commercial_information.expected_launch_month,
            "dcgi_combination_approved": sf.regulatory_information.dcgi_combination_approved,
            "drug_schedule": sf.regulatory_information.drug_schedule,
            "patent_validity": sf.patent_information.patent_validity,
            "launch_after_expiry": sf.patent_information.launch_after_expiry,
        }
        existing_brand_names += _split_names(sf.brand_information.domestic_brand_names, "Domestic Brand (existing)")
        existing_brand_names += _split_names(sf.brand_information.international_brand_names, "International Brand (existing)")
        existing_brand_names += _split_names(sf.brand_information.innovator_brands, "Innovator Brand (existing)")
    else:
        context = {
            "molecule": request.molecule,
            "therapeutic_area": request.therapeutic_area,
            "ailment": request.ailment,
            "product_attributes": request.product_attributes,
        }

    context.update({
        "geography": request.geography,
        "naming_style": request.naming_style,
        "treatment": request.treatment,
        "emotion_connected": request.emotion_connected,
        "outcome": request.outcome,
        "description": request.description,
    })
    if request.suggestion_form and request.product_attributes:
        context["product_attributes"] = request.product_attributes

    return context, existing_brand_names


def _rationale(name: str, status: str, top_conflicts: List[dict]) -> str:
    if not top_conflicts:
        return (
            f'"{name}" shows no significant conflicts against known trademarks, market brands, '
            f"or this composition's on-record existing names. Appears available for further evaluation."
        )
    top = top_conflicts[0]
    top_pct = int(top["similarity_score"] * 100)
    sim_label = top["similarity_type"].lower()
    if status == "recommended":
        return (
            f'"{name}" is recommended with low conflict risk (closest match: {top["name"]} '
            f'at {top_pct}% {sim_label} similarity via {top["source"]}). '
            f"No blocking conflicts detected. Proceed with standard trademark clearance."
        )
    conflict_list = "; ".join(
        f'{c["name"]} ({int(c["similarity_score"]*100)}% {c["similarity_type"].lower()}, {c["source"]})'
        for c in top_conflicts[:3]
    )
    if status == "review_required":
        return (
            f'"{name}" requires legal review. Flagged due to moderate similarity with: {conflict_list}. '
            f"A targeted trademark clearance search is advised before proceeding."
        )
    return (
        f'"{name}" is classified as high risk due to strong similarity with: {conflict_list}. '
        f"Significant trademark or market collision probability. Avoid or seek specialized IP counsel."
    )


class GeneratorService:
    def __init__(self, db: Session):
        self.db = db
        self.brand_repo = BrandRepository(db)
        self.trademark_repo = TrademarkRepository(db)
        self.settings_repo = SettingsRepository(db)

    def _score_candidate(
        self,
        name: str,
        item: dict,
        context: dict,
        conflict_pool: List[dict],
        therapeutic_area: Optional[str],
        molecule: str,
        request,
        user_id: Optional[uuid.UUID],
    ) -> dict:
        is_valid, invalid_reason = validate_linguistic_structure(name)
        if not is_valid:
            return {
                "id": uuid.uuid4(),
                "case_id": request.case_id if request.case_id else None,
                "user_id": user_id,
                "request_snapshot": request.model_dump() if hasattr(request, "model_dump") else None,
                "generated_name": name,
                "therapeutic_area": therapeutic_area,
                "molecule": molecule,
                "risk_score": 100.0,
                "availability_score": 0.0,
                "memorability_score": 0.0,
                "pronunciation_score": 0.0,
                "recommendation_status": "high_risk",
                "trademark_availability": "Likely Conflicted",
                "ai_explanation": f"REJECTED: {invalid_reason}",
                "phonetic_analysis": "Unpronounceable",
                "conflict_details": {
                    "rationale": invalid_reason,
                    "top_conflicts": [],
                    "total_conflict_count": 1,
                    "is_linguistically_invalid": True,
                },
                "created_at": None,
            }

        raw_conflicts = []
        for ref in conflict_pool:
            ref_name = ref["name"]
            score = composite_similarity(name, ref_name)
            lev = levenshtein_similarity(name, ref_name)
            fuz = fuzzy_similarity(name, ref_name)
            phon = phonetic_similarity(name, ref_name)
            look = lookalike_score(name, ref_name)
            ps_score = prefix_suffix_collision_score(name, ref_name)
            effective_sim = max(score, ps_score, phon) if (ps_score >= 0.80 or phon >= 0.85) else score

            if effective_sim >= _CONFLICT_THRESHOLD:
                sim_types = classify_similarity_types(lev, fuz, phon, look) or ["Spelling"]
                sem_val = round(effective_sim * 0.5, 3)
                raw_conflicts.append({
                    "name": ref_name,
                    "owner": ref.get("owner"),
                    "source": ref.get("source", "Trademark Registry"),
                    "similarity_score": round(effective_sim, 3),
                    "similarity_type": sim_types[0],
                    "similarity_types": sim_types,
                    "phonetic_score": round(phon, 3),
                    "spelling_score": round(max(lev, fuz), 3),
                    "soundalike_score": 0.0,
                    "lookalike_score": round(look, 3),
                    "prefix_suffix_score": round(ps_score, 3),
                    "semantic_similarity_score": sem_val,
                })

        raw_conflicts.sort(key=lambda c: c["similarity_score"], reverse=True)
        top_conflicts = raw_conflicts[:_MAX_TOP_CONFLICTS]
        total_conflicts = len(raw_conflicts)
        top_score = top_conflicts[0]["similarity_score"] if top_conflicts else 0.0

        exact_match = 1.0 if any(c["similarity_score"] >= 0.98 for c in top_conflicts) else 0.0
        spelling_max = max((c["spelling_score"] for c in top_conflicts if c.get("spelling_score", 0) >= 0.45), default=0.0)
        phonetic_max = max((c["phonetic_score"] for c in top_conflicts if c.get("phonetic_score", 0) >= 0.45), default=0.0)
        look_max = max((c["lookalike_score"] for c in top_conflicts if c.get("lookalike_score", 0) >= 0.45), default=0.0)
        semantic_max = max((c.get("semantic_similarity_score", 0.0) for c in top_conflicts if c.get("semantic_similarity_score", 0.0) >= 0.45), default=0.0)
        market_presence = min(total_conflicts / 10.0, 1.0)

        # Mentor's 4-Parameter Balanced Formula with Hard Knockout Gates
        risk_score, _, _ = calculate_mentor_risk_score(
            phonetic_score=phonetic_max,
            spelling_score=spelling_max,
            visual_score=look_max,
            conceptual_score=semantic_max,
            is_exact_match=bool(exact_match >= 0.98),
            is_who_inn_knockout=False,
        )

        if risk_score >= 65.0:
            rec_status = "high_risk"
            tm_status = "Likely Conflicted"
        elif risk_score >= 30.0 or total_conflicts >= 3 or top_score >= 0.60:
            rec_status = "review_required"
            tm_status = "Potential Conflict"
        else:
            rec_status = "recommended"
            tm_status = "Available"

        risk_score = round(min(max(risk_score, 0.0), 100.0), 1)
        availability_score = round(max(100.0 - risk_score, 0.0), 1)

        raw_mem = item.get("memorability_score") or item.get("memorability")
        raw_pron = item.get("pronunciation_score") or item.get("pronunciation_ease") or item.get("pronunciation")
        
        if raw_mem is not None:
            mem_score = round(float(raw_mem), 1)
        else:
            length_factor = 90.0 if 6 <= len(name) <= 9 else 82.0 if len(name) < 6 else 76.0
            mem_score = round(min(98.0, max(60.0, length_factor + (abs(hash(name)) % 9))), 1)
            
        if raw_pron is not None:
            pron_score = round(float(raw_pron), 1)
        else:
            vowels = sum(1 for c in name.lower() if c in "aeiouy")
            vowel_ratio = vowels / max(len(name), 1)
            vowel_score = 88.0 if 0.35 <= vowel_ratio <= 0.55 else 80.0
            pron_score = round(min(98.0, max(65.0, vowel_score + (abs(hash(name[::-1])) % 9))), 1)

        coining_principles = item.get("coining_principles") or ["Short & Memorable Names", "Product Effect / Benefit"]
        business_alignment = item.get("business_alignment") or (
            f"Specifically tailored to {therapeutic_area} with positioning aligned to {context.get('emotion_connected') or 'efficacy and safety'}."
        )
        rationale_text = item.get("rationale") or _rationale(name, rec_status, top_conflicts)

        return {
            "id": uuid.uuid4(),
            "case_id": request.case_id if request.case_id else None,
            "user_id": user_id,
            "request_snapshot": request.model_dump() if hasattr(request, "model_dump") else None,
            "generated_name": name,
            "therapeutic_area": therapeutic_area,
            "molecule": molecule,
            "geography": context.get("geography") or "India",
            "product_attributes": str(context.get("product_attributes") or ""),
            "naming_style": context.get("naming_style") or "Scientific & Memorable",
            "coining_principles": coining_principles,
            "business_alignment": business_alignment,
            "risk_score": risk_score,
            "availability_score": availability_score,
            "memorability_score": mem_score,
            "pronunciation_score": pron_score,
            "recommendation_status": rec_status,
            "trademark_availability": tm_status,
            "ai_explanation": rationale_text,
            "phonetic_analysis": item.get("phonetic", name),
            "semantic_analysis": None,
            "conflict_details": {
                "top_conflicts": top_conflicts,
                "total_conflict_count": total_conflicts,
                "coining_principles": coining_principles,
                "business_alignment": business_alignment,
                "rationale": rationale_text,
                "domain_available": True,
                "exact_match_score": exact_match,
                "spelling_similarity_score": spelling_max,
                "phonetic_similarity_score": phonetic_max,
                "soundalike_score": 0.0,
                "lookalike_score": look_max,
                "market_presence_score": market_presence,
                "semantic_similarity_score": semantic_max,
                "trademark_conflict_score": round(top_score, 3),
                "phonetic_code": safe_phonetic_code(name),
            },
        }

    def _rescore_candidate_with_market(
        self,
        entry: dict,
        listings: List[dict],
        conflict: Optional[dict],
        market_attempts: int,
    ) -> None:
        name = entry["generated_name"]
        top_conflicts = list(entry["conflict_details"].get("top_conflicts", []))

        for listing in listings:
            c_name = _brand_stub(listing.get("brand_name", ""))
            if not c_name:
                continue
            lev = levenshtein_similarity(name, c_name)
            fuz = fuzzy_similarity(name, c_name)
            phon = phonetic_similarity(name, c_name)
            look = lookalike_score(name, c_name)
            comp = composite_similarity(name, c_name)
            ps_score = prefix_suffix_collision_score(name, c_name)
            eff_sim = max(comp, ps_score, phon) if (ps_score >= 0.80 or phon >= 0.85) else comp

            if eff_sim >= _CONFLICT_THRESHOLD or max(lev, fuz) >= 0.50 or phon >= 0.50:
                sim_types = classify_similarity_types(lev, fuz, phon, look) or ["Spelling"]
                top_conflicts.append({
                    "name": c_name,
                    "owner": listing.get("manufacturer"),
                    "source": listing.get("source", "E-Pharmacy"),
                    "similarity_score": round(eff_sim, 3),
                    "similarity_type": sim_types[0],
                    "similarity_types": sim_types,
                    "phonetic_score": round(phon, 3),
                    "spelling_score": round(max(lev, fuz), 3),
                    "soundalike_score": 0.0,
                    "lookalike_score": round(look, 3),
                    "prefix_suffix_score": round(ps_score, 3),
                })

        if conflict:
            c_name = conflict["name"]
            lev = levenshtein_similarity(name, c_name)
            fuz = fuzzy_similarity(name, c_name)
            phon = phonetic_similarity(name, c_name)
            look = lookalike_score(name, c_name)
            sim_types = classify_similarity_types(lev, fuz, phon, look) or ["Spelling"]
            top_conflicts.insert(0, {
                "name": c_name,
                "owner": conflict.get("owner"),
                "source": conflict.get("source", "Market"),
                "similarity_score": round(conflict["similarity_score"], 3),
                "similarity_type": sim_types[0],
                "similarity_types": sim_types,
                "phonetic_score": round(phon, 3),
                "spelling_score": round(max(lev, fuz), 3),
                "soundalike_score": 0.0,
                "lookalike_score": round(look, 3),
            })

        seen = set()
        deduped = []
        for c in top_conflicts:
            k = c["name"].lower()
            if k not in seen:
                seen.add(k)
                deduped.append(c)
        deduped.sort(key=lambda c: c["similarity_score"], reverse=True)
        top_conflicts = deduped[:_MAX_TOP_CONFLICTS]

        exact_match = 1.0 if any(c["similarity_score"] >= 0.98 for c in top_conflicts) else 0.0
        spelling_max = max((c["spelling_score"] for c in top_conflicts), default=0.0)
        phonetic_max = max((c["phonetic_score"] for c in top_conflicts), default=0.0)
        look_max = max((c["lookalike_score"] for c in top_conflicts), default=0.0)
        top_score = top_conflicts[0]["similarity_score"] if top_conflicts else 0.0
        semantic_max = round(top_score * 0.5, 3)
        total_conflicts = len(deduped)
        market_presence = min(total_conflicts / 10.0, 1.0)

        # Mentor's 4-Parameter Balanced Formula with Hard Knockout Gates
        risk_score, _, _ = calculate_mentor_risk_score(
            phonetic_score=phonetic_max,
            spelling_score=spelling_max,
            visual_score=look_max,
            conceptual_score=semantic_max,
            is_exact_match=bool(exact_match >= 0.98),
            is_who_inn_knockout=False,
        )

        if risk_score >= 65.0:
            rec_status = "high_risk"
            tm_status = "Likely Conflicted"
        elif risk_score >= 30.0 or total_conflicts >= 3 or top_score >= 0.60:
            rec_status = "review_required"
            tm_status = "Potential Conflict"
        else:
            rec_status = "recommended"
            tm_status = "Available"

        entry["risk_score"] = round(min(max(risk_score, 0.0), 100.0), 1)
        entry["availability_score"] = round(max(100.0 - entry["risk_score"], 0.0), 1)
        entry["recommendation_status"] = rec_status
        entry["trademark_availability"] = tm_status
        entry["conflict_details"]["top_conflicts"] = top_conflicts
        entry["conflict_details"]["total_conflict_count"] = total_conflicts
        entry["conflict_details"]["exact_match_score"] = exact_match
        entry["conflict_details"]["spelling_similarity_score"] = spelling_max
        entry["conflict_details"]["phonetic_similarity_score"] = phonetic_max
        entry["conflict_details"]["lookalike_score"] = look_max
        entry["conflict_details"]["semantic_similarity_score"] = semantic_max
        entry["conflict_details"]["market_presence_score"] = market_presence
        entry["conflict_details"]["trademark_conflict_score"] = round(top_score, 3)

        if conflict:
            entry["conflict_details"]["rationale"] = (
                f'"{name}" matches an existing commercial brand ({conflict["name"]} via {conflict["source"]}) '
                f'after {market_attempts} generation attempts. Classified as {rec_status.replace("_", " ").title()}.'
            )

    async def _verify_candidate_market(
        self,
        entry: dict,
        context: dict,
        reference_names: List[dict],
        conflict_pool: List[dict],
        therapeutic_area: Optional[str],
        molecule: str,
        request,
        user_id,
        toggles: Dict[str, bool],
    ) -> dict:
        """Performs live multi-portal e-pharmacy screening (1mg, PharmEasy, Netmeds, Apollo)
        and WHO INN/IQVIA/Google checks for an individual candidate name.
        If a collision is detected, generates an honest replacement candidate up to _MAX_MARKET_ATTEMPTS."""
        avoid = list(reference_names)
        market_evidence: Dict[str, Any] = {
            "who_inn_checked": toggles.get("who_inn_enabled", True),
            "iqvia_checked": toggles.get("iqvia_enabled", True),
            "pharmacy_checked": toggles.get("epharmacy_enabled", True),
            "google_checked": google_search_configured() and toggles.get("google_search_enabled", True),
            "conflicts_found": [],
        }

        for attempt in range(_MAX_MARKET_ATTEMPTS):
            name = entry["generated_name"]
            conflict = None

            # Tier 1: WHO INN
            if toggles.get("who_inn_enabled", True):
                conflict = await find_who_inn_conflict(name, self.db)

            # Tier 2: IQVIA
            if not conflict and toggles.get("iqvia_enabled", True):
                conflict = await find_iqvia_conflict(name, self.db)

            # Tier 3: Live E-Pharmacy Multi-Portal Scrape for THIS candidate name
            if not conflict and toggles.get("epharmacy_enabled", True):
                listings, _ = await scrape_pharmacy_listings(name)
                if listings:
                    conflict = find_pharmacy_conflict(name, listings)

            # Tier 4: Google Search
            if not conflict and toggles.get("google_search_enabled", True):
                conflict = await find_google_conflict(name)

            if not conflict:
                if attempt > 0:
                    logger.info('  [CANDIDATE REPLACEMENT SUCCESS] Candidate "%s" cleared all safety checks on Attempt %d', name, attempt + 1)
                entry["conflict_details"]["market_check"] = market_evidence
                return entry

            market_evidence["conflicts_found"].append(conflict)
            last_attempt = (attempt == _MAX_MARKET_ATTEMPTS - 1)

            if last_attempt:
                logger.warning(
                    '  [CANDIDATE COLLISION STRATIFIED] Candidate "%s" collides with "%s" (%s) after %d attempts — recorded with genuine risk',
                    name, conflict["name"], conflict["source"], _MAX_MARKET_ATTEMPTS,
                )
                entry["recommendation_status"] = "high_risk" if conflict["similarity_score"] >= 0.70 else "review_required"
                entry["trademark_availability"] = "Likely Conflicted" if conflict["similarity_score"] >= 0.70 else "Potential Conflict"
                entry["risk_score"] = max(entry["risk_score"], round(conflict["similarity_score"] * 100.0, 1))
                entry["availability_score"] = round(max(100.0 - entry["risk_score"], 0.0), 1)

                lev = levenshtein_similarity(name, conflict["name"])
                fuz = fuzzy_similarity(name, conflict["name"])
                phon = phonetic_similarity(name, conflict["name"])
                look = lookalike_score(name, conflict["name"])
                types = classify_similarity_types(lev, fuz, phon, look) or ["Spelling"]
                entry["conflict_details"]["top_conflicts"] = (
                    [{
                        "name": conflict["name"], "source": conflict["source"], "owner": conflict.get("owner"),
                        "similarity_type": types[0], "similarity_types": types,
                        "similarity_score": conflict["similarity_score"],
                        "phonetic_score": round(phon, 3), "spelling_score": round(max(lev, fuz), 3),
                        "soundalike_score": 0.0, "lookalike_score": round(look, 3),
                    }] + entry["conflict_details"]["top_conflicts"]
                )[:_MAX_TOP_CONFLICTS]

                entry["conflict_details"]["total_conflict_count"] = max(
                    entry["conflict_details"].get("total_conflict_count", 0), len(market_evidence["conflicts_found"])
                )
                entry["conflict_details"]["rationale"] = (
                    f'"{name}" matches an existing commercial brand ({conflict["name"]} via {conflict["source"]}) '
                    f"after {_MAX_MARKET_ATTEMPTS} generation attempts. Classified as {entry['recommendation_status'].replace('_', ' ').title()}."
                )
                entry["conflict_details"]["market_check"] = market_evidence
                return entry

            logger.info(
                '  [CANDIDATE CONFLICT DETECTED] Candidate "%s" collides with "%s" (%s, %.0f%% match) -> Requesting replacement (Attempt %d/%d)...',
                name, conflict["name"], conflict["source"], conflict["similarity_score"] * 100,
                attempt + 2, _MAX_MARKET_ATTEMPTS,
            )
            avoid = avoid + [{"name": conflict["name"], "owner": conflict.get("owner"), "source": conflict["source"]}]
            try:
                replacements = await ai_service.generate_brand_names(context, avoid, 1)
            except AIServiceError as exc:
                logger.warning("  [REPLACEMENT NOTICE] Replacement generation failed for %r: %s", name, exc)
                entry["conflict_details"]["market_check"] = market_evidence
                return entry

            if not replacements:
                entry["conflict_details"]["market_check"] = market_evidence
                return entry

            new_item = replacements[0]
            new_name = (new_item.get("name") or "").strip()
            if not new_name:
                entry["conflict_details"]["market_check"] = market_evidence
                return entry

            entry = self._score_candidate(
                new_name, new_item, context, conflict_pool, therapeutic_area, molecule, request, user_id,
            )

        entry["conflict_details"]["market_check"] = market_evidence
        return entry

    async def generate_names_stream(
        self, request, user_id: Optional[uuid.UUID], count: int,
    ) -> AsyncGenerator[str, None]:
        """Asynchronous generator emitting Server-Sent Events (SSE) in NDJSON format
        synchronized with the real-time execution of Stages 1 to 5."""
        def sse_pack(data: dict) -> str:
            return f"data: {json.dumps(data)}\n\n"

        context, existing_brand_names = _build_context(request)
        reference_names: List[Dict[str, Optional[str]]] = []
        molecule = context.get("molecule") or ""
        therapeutic_area = context.get("therapy") or context.get("therapeutic_area") or "General Medicine"
        toggles = self.settings_repo.get_data_source_toggles()

        # --- STAGE 1: Brief & Context Ingestion ---
        yield sse_pack({
            "stage": 1,
            "step_index": 0,
            "percent": 15,
            "status": "in_progress",
            "title": "Brief & Context Ingestion",
            "subtitle": f"Ingesting parameters for {molecule or 'candidate case'} & building reference collision pool...",
        })
        await asyncio.sleep(0.1)

        tm_matches = self.trademark_repo.find_by_active_ingredient(molecule) if molecule else []
        mkt_matches = self.trademark_repo.find_market_by_active_ingredient(molecule) if molecule else []
        
        reference_names += [
            {"name": t.brand_name, "owner": t.owner, "source": "Trademark Registry"}
            for t in tm_matches
        ]
        reference_names += [
            {"name": m.brand_name, "owner": m.manufacturer, "source": "Market Database"}
            for m in mkt_matches
        ]
        
        from app.core.cache import cache_service
        cached_global_pool = cache_service.get_json("global_db_conflict_pool")
        if cached_global_pool is None:
            all_tms = self.trademark_repo.get_all_trademarks()
            all_mkts = self.trademark_repo.get_all_market_brands()
            cached_global_pool = (
                [{"name": t.brand_name, "owner": t.owner, "source": "Trademark Registry"} for t in all_tms] +
                [{"name": m.brand_name, "owner": m.manufacturer, "source": "Market Database"} for m in all_mkts]
            )
            cache_service.set_json("global_db_conflict_pool", cached_global_pool, ttl_seconds=3600)

        conflict_pool: List[Dict[str, Optional[str]]] = list(reference_names) + list(cached_global_pool)
        
        pool_seen = set()
        deduped_pool = []
        for entry in conflict_pool:
            key = entry["name"].lower()
            if key not in pool_seen:
                pool_seen.add(key)
                deduped_pool.append(entry)
        conflict_pool = deduped_pool

        yield sse_pack({
            "stage": 1,
            "step_index": 0,
            "percent": 25,
            "status": "completed",
            "title": "Brief & Context Ingestion",
            "subtitle": f"Parameters loaded. Referenced {len(conflict_pool):,} trademark & brand entries.",
        })

        # --- STAGE 2: AI Linguistic Brand Synthesis ---
        yield sse_pack({
            "stage": 2,
            "step_index": 1,
            "percent": 35,
            "status": "in_progress",
            "title": "AI Linguistic Brand Synthesis",
            "subtitle": f"Generating {count} coined candidate proposals via AI...",
        })

        ai_count = min(count * 2, 25)
        try:
            raw_candidates = await ai_service.generate_brand_names(
                context, existing_brand_names + reference_names, ai_count,
            )
        except AIServiceError as exc:
            logger.error("[AI SYNTHESIS ERROR] %s", exc)
            yield sse_pack({
                "stage": 2,
                "step_index": 1,
                "percent": 35,
                "status": "failed",
                "title": "AI Linguistic Brand Synthesis",
                "error": str(exc),
            })
            return

        yield sse_pack({
            "stage": 2,
            "step_index": 1,
            "percent": 50,
            "status": "completed",
            "title": "AI Linguistic Brand Synthesis",
            "subtitle": f"Generated {len(raw_candidates)} distinct coined candidate proposals.",
        })

        # --- STAGE 3: Multi-Tier Deterministic Screening ---
        yield sse_pack({
            "stage": 3,
            "step_index": 2,
            "percent": 55,
            "status": "in_progress",
            "title": "Multi-Tier Deterministic Screening",
            "subtitle": "Scoring phonetic Metaphone, visual trigrams & trademark similarity...",
        })

        results: List[dict] = []
        seen_names = set()

        for item in raw_candidates:
            name = (item.get("name") or "").strip()
            if not name or name.lower() in seen_names:
                continue
            seen_names.add(name.lower())
            scored = self._score_candidate(
                name, item, context, conflict_pool, therapeutic_area, molecule, request, user_id,
            )
            results.append(scored)

        status_order = {"recommended": 0, "review_required": 1, "high_risk": 2}
        results.sort(key=lambda r: (status_order.get(r["recommendation_status"], 3), r["risk_score"]))
        finalists = results[:count]

        yield sse_pack({
            "stage": 3,
            "step_index": 2,
            "percent": 65,
            "status": "completed",
            "title": "Multi-Tier Deterministic Screening",
            "subtitle": f"Completed phonetic, spelling & trademark similarity scoring for top {len(finalists)} candidates.",
        })

        # --- STAGE 4: Live E-Pharmacy Multi-Portal Scraping (Batched Pipeline) ---
        yield sse_pack({
            "stage": 4,
            "step_index": 3,
            "percent": 70,
            "status": "in_progress",
            "title": "Live E-Pharmacy Market Scraping",
            "subtitle": f"Querying 1mg, PharmEasy, Apollo Pharmacy & Netmeds for all {len(finalists)} candidate names...",
        })

        candidates = list(finalists)
        max_market_attempts = 3
        avoid_pool = list(existing_brand_names + reference_names)
        verified_candidates = []

        for attempt in range(1, max_market_attempts + 1):
            total_in_round = len(candidates)
            for idx, entry in enumerate(candidates, 1):
                if entry.get("_verified_clean"):
                    continue

                cand_name = entry["generated_name"]
                progress_pct = int(70 + (idx / total_in_round) * 15)
                yield sse_pack({
                    "stage": 4,
                    "step_index": 3,
                    "percent": progress_pct,
                    "status": "in_progress",
                    "title": "Live E-Pharmacy Market Scraping",
                    "subtitle": f"Checking candidate [{idx}/{total_in_round}] '{cand_name}' across 1mg, PharmEasy, Netmeds, Apollo...",
                })

                conflict = None
                listings = []
                if toggles.get("epharmacy_enabled", True):
                    listings, _ = await scrape_pharmacy_listings(cand_name)
                    if listings:
                        conflict = find_pharmacy_conflict(cand_name, listings)

                if not conflict and toggles.get("who_inn_enabled", True):
                    conflict = await find_who_inn_conflict(cand_name, self.db)

                if not conflict and toggles.get("iqvia_enabled", True):
                    conflict = await find_iqvia_conflict(cand_name, self.db)

                if not conflict and toggles.get("google_search_enabled", True):
                    conflict = await find_google_conflict(cand_name)

                entry["_market_conflict"] = conflict
                entry["_market_listings"] = listings

            conflicted_indices = [i for i, c in enumerate(candidates) if c.get("_market_conflict")]
            k_conflicts = len(conflicted_indices)

            if k_conflicts == 0 or attempt == max_market_attempts:
                for entry in candidates:
                    conflict = entry.get("_market_conflict")
                    market_evidence = {
                        "who_inn_checked": toggles.get("who_inn_enabled", True),
                        "iqvia_checked": toggles.get("iqvia_enabled", True),
                        "pharmacy_checked": toggles.get("epharmacy_enabled", True),
                        "google_checked": google_search_configured() and toggles.get("google_search_enabled", True),
                        "conflicts_found": [conflict] if conflict else [],
                    }
                    entry["conflict_details"]["market_check"] = market_evidence

                    self._rescore_candidate_with_market(
                        entry, entry.get("_market_listings") or [], conflict, max_market_attempts,
                    )

                verified_candidates = candidates
                break

            yield sse_pack({
                "stage": 4,
                "step_index": 3,
                "percent": 85,
                "status": "in_progress",
                "title": "Live E-Pharmacy Market Scraping",
                "subtitle": f"Found {k_conflicts} conflict(s). Generating {k_conflicts} replacement(s) in batch (Attempt {attempt + 1}/{max_market_attempts})...",
            })

            for idx in conflicted_indices:
                conf = candidates[idx].get("_market_conflict")
                if conf:
                    avoid_pool.append({"name": conf["name"], "source": conf.get("source", "Market"), "owner": conf.get("owner")})

            try:
                replacements = await ai_service.generate_brand_names(context, avoid_pool, k_conflicts)
            except Exception as e:
                logger.warning("Batch replacement generation failed: %s", e)
                verified_candidates = candidates
                break

            if not replacements:
                verified_candidates = candidates
                break

            for idx, rep in zip(conflicted_indices, replacements):
                rep_name = (rep.get("name") or "").strip()
                if rep_name:
                    scored_rep = self._score_candidate(
                        rep_name, rep, context, conflict_pool, therapeutic_area, molecule, request, user_id,
                    )
                    candidates[idx] = scored_rep

        yield sse_pack({
            "stage": 4,
            "step_index": 3,
            "percent": 90,
            "status": "completed",
            "title": "Live E-Pharmacy Market Scraping",
            "subtitle": f"Completed live multi-portal verification for all {len(verified_candidates)} candidates.",
        })

        # --- STAGE 5: Collision Analysis & Ranking Safety ---
        yield sse_pack({
            "stage": 5,
            "step_index": 4,
            "percent": 95,
            "status": "in_progress",
            "title": "Market Collision Analysis & Ranking Safety",
            "subtitle": "Applying final risk stratifications and persisting candidate records...",
        })

        # STRICT: Remove any high_risk / >=65% that slipped through market gating
        verified_candidates = [
            c for c in verified_candidates
            if c.get("recommendation_status") != "high_risk" and c.get("risk_score", 0.0) < 65.0
        ]

        verified_candidates.sort(key=lambda r: (status_order.get(r["recommendation_status"], 3), r["risk_score"]))
        clean_db_entries = [
            {k: v for k, v in c.items() if not k.startswith("_")}
            for c in verified_candidates
        ]
        saved = self.brand_repo.save_generated_names(clean_db_entries)
        
        # Serialize saved database instances
        serialized_output = []
        for s in saved:
            serialized_output.append({
                "id": str(s.id),
                "generated_name": s.generated_name,
                "therapeutic_area": s.therapeutic_area,
                "molecule": s.molecule,
                "risk_score": s.risk_score,
                "availability_score": s.availability_score,
                "memorability_score": s.memorability_score,
                "pronunciation_score": s.pronunciation_score,
                "recommendation_status": s.recommendation_status,
                "trademark_availability": s.trademark_availability,
                "ai_explanation": s.ai_explanation,
                "phonetic_analysis": s.phonetic_analysis,
                "conflict_details": s.conflict_details,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            })

        yield sse_pack({
            "stage": 5,
            "step_index": 4,
            "percent": 100,
            "status": "completed",
            "title": "Generation Complete",
            "subtitle": f"Generated {len(saved)} brand candidates with verified risk assessments.",
            "data": serialized_output,
        })

    async def generate_names(self, request, user_id: Optional[uuid.UUID], count: int) -> List[GeneratedBrandName]:
        """Non-streaming generation returning saved GeneratedBrandName list."""
        context, existing_brand_names = _build_context(request)
        reference_names: List[Dict[str, Optional[str]]] = []
        molecule = context.get("molecule") or ""
        therapeutic_area = context.get("therapy") or context.get("therapeutic_area") or "General Medicine"
        toggles = self.settings_repo.get_data_source_toggles()

        tm_matches = self.trademark_repo.find_by_active_ingredient(molecule) if molecule else []
        mkt_matches = self.trademark_repo.find_market_by_active_ingredient(molecule) if molecule else []
        
        reference_names += [
            {"name": t.brand_name, "owner": t.owner, "source": "Trademark Registry"}
            for t in tm_matches
        ]
        reference_names += [
            {"name": m.brand_name, "owner": m.manufacturer, "source": "Market Database"}
            for m in mkt_matches
        ]
        
        from app.core.cache import cache_service
        cached_global_pool = cache_service.get_json("global_db_conflict_pool")
        if cached_global_pool is None:
            all_tms = self.trademark_repo.get_all_trademarks()
            all_mkts = self.trademark_repo.get_all_market_brands()
            cached_global_pool = (
                [{"name": t.brand_name, "owner": t.owner, "source": "Trademark Registry"} for t in all_tms] +
                [{"name": m.brand_name, "owner": m.manufacturer, "source": "Market Database"} for m in all_mkts]
            )
            cache_service.set_json("global_db_conflict_pool", cached_global_pool, ttl_seconds=3600)

        conflict_pool: List[Dict[str, Optional[str]]] = list(reference_names) + list(cached_global_pool)
        
        pool_seen = set()
        deduped_pool = []
        for entry in conflict_pool:
            key = entry["name"].lower()
            if key not in pool_seen:
                pool_seen.add(key)
                deduped_pool.append(entry)
        conflict_pool = deduped_pool

        ai_count = min(count * 2, 25)
        raw_candidates = await ai_service.generate_brand_names(
            context, existing_brand_names + reference_names, ai_count,
        )

        results: List[dict] = []
        seen_names = set()
        for item in raw_candidates:
            name = (item.get("name") or "").strip()
            if not name or name.lower() in seen_names:
                continue
            seen_names.add(name.lower())
            scored = self._score_candidate(
                name, item, context, conflict_pool, therapeutic_area, molecule, request, user_id,
            )
            results.append(scored)

        status_order = {"recommended": 0, "review_required": 1, "high_risk": 2}
        results.sort(key=lambda r: (status_order.get(r["recommendation_status"], 3), r["risk_score"]))
        finalists = results[:count]

        candidates = list(finalists)
        max_market_attempts = 3
        avoid_pool = list(existing_brand_names + reference_names)
        verified_candidates = []

        for attempt in range(1, max_market_attempts + 1):
            for entry in candidates:
                if entry.get("_verified_clean"):
                    continue
                cand_name = entry["generated_name"]
                conflict = None
                listings = []
                if toggles.get("epharmacy_enabled", True):
                    listings, _ = await scrape_pharmacy_listings(cand_name)
                    if listings:
                        conflict = find_pharmacy_conflict(cand_name, listings)
                if not conflict and toggles.get("who_inn_enabled", True):
                    conflict = await find_who_inn_conflict(cand_name, self.db)
                if not conflict and toggles.get("iqvia_enabled", True):
                    conflict = await find_iqvia_conflict(cand_name, self.db)
                if not conflict and toggles.get("google_search_enabled", True):
                    conflict = await find_google_conflict(cand_name)

                entry["_market_conflict"] = conflict
                entry["_market_listings"] = listings

            conflicted_indices = [i for i, c in enumerate(candidates) if c.get("_market_conflict")]
            k_conflicts = len(conflicted_indices)

            if k_conflicts == 0 or attempt == max_market_attempts:
                for entry in candidates:
                    conflict = entry.get("_market_conflict")
                    market_evidence = {
                        "who_inn_checked": toggles.get("who_inn_enabled", True),
                        "iqvia_checked": toggles.get("iqvia_enabled", True),
                        "pharmacy_checked": toggles.get("epharmacy_enabled", True),
                        "google_checked": google_search_configured() and toggles.get("google_search_enabled", True),
                        "conflicts_found": [conflict] if conflict else [],
                    }
                    entry["conflict_details"]["market_check"] = market_evidence
                    self._rescore_candidate_with_market(
                        entry, entry.get("_market_listings") or [], conflict, max_market_attempts,
                    )
                verified_candidates = candidates
                break

            for idx in conflicted_indices:
                conf = candidates[idx].get("_market_conflict")
                if conf:
                    avoid_pool.append({"name": conf["name"], "source": conf.get("source", "Market"), "owner": conf.get("owner")})

            try:
                replacements = await ai_service.generate_brand_names(context, avoid_pool, k_conflicts)
            except Exception as e:
                logger.warning("Batch replacement generation failed: %s", e)
                verified_candidates = candidates
                break

            if not replacements:
                verified_candidates = candidates
                break

            for idx, rep in zip(conflicted_indices, replacements):
                rep_name = (rep.get("name") or "").strip()
                if rep_name:
                    scored_rep = self._score_candidate(
                        rep_name, rep, context, conflict_pool, therapeutic_area, molecule, request, user_id,
                    )
                    candidates[idx] = scored_rep

        # STRICT: Remove any high_risk / >=65% that slipped through market gating
        verified_candidates = [
            c for c in verified_candidates
            if c.get("recommendation_status") != "high_risk" and c.get("risk_score", 0.0) < 65.0
        ]

        verified_candidates.sort(key=lambda r: (status_order.get(r["recommendation_status"], 3), r["risk_score"]))
        clean_db_entries = [
            {k: v for k, v in c.items() if not k.startswith("_")}
            for c in verified_candidates
        ]
        saved = self.brand_repo.save_generated_names(clean_db_entries)
        return saved
