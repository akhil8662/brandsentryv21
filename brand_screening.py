"""Brand Analysis screening pipeline — takes a single candidate brand name
(no molecule/composition required, unlike the AI Name Generator's
generator.py) and runs it through exactly the three checks requested:

  1. WHO INN + IQVIA registry lookup (Tier 1, authoritative):
     - WHO INN — local WhoInnRegistry cache first, falling back to the live
       ChEMBL mirror (app.services.external_apis.search_who_inn) until a bulk
       import populates the local table. An exact INN hit is a knockout.
     - IQVIA — local IqviaExtract table only; empty (reported as "not
       licensed / no data loaded", never as clearance) until a licensed
       extract-import pipeline exists and the client's licence is confirmed.
  2. Google web search (app.services.web_search.search_google).
  3. E-pharmacy discovery across 1mg/PharmEasy/Apollo Pharmacy/Netmeds — not
     integrated (app.services.market_check.scrape_pharmacy_listings always
     reports "not checked"; the prior Google Custom Search-based
     implementation has been removed). The stage is kept in the pipeline so
     numbering/ordering stays stable, it just never contributes evidence.

Every hit is scored deterministically (app.services.screening) and only then
handed to the LLM for a plain-English rationale — the model explains the
evidence, it never invents the verdict. If no LLM is configured or the call
fails, ai_assessment is left unset (None) rather than filled with placeholder
text — this is a production screening result, not a demo.
"""
import logging
import uuid
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.cache import cache_service
from app.models.brand import GeneratedBrandName
from app.models.screening import BrandSearch
from app.repositories.screening import ScreeningRepository
from app.repositories.settings import SettingsRepository
from app.services.ai import ai_service
from app.services.external_apis import search_who_inn
from app.services.market_check import _brand_stub, google_search_configured, scrape_pharmacy_listings
from app.services.screening import (
    classify_similarity_types,
    composite_similarity,
    cosine_similarity,
    fuzzy_similarity,
    levenshtein_similarity,
    lookalike_score,
    phonetic_similarity,
    prefix_suffix_collision_score,
    soundalike_score,
)
from app.services.web_search import search_google

logger = logging.getLogger(__name__)

_SIMILAR_THRESHOLD = 0.45   # worth surfacing as a "similar name"
_CONFLICT_THRESHOLD = 0.70  # strong enough to count as a live conflict
# Sequential pipeline's own stage-stop bar (see _stage_conflict) — deliberately
# a separate, higher bar than _CONFLICT_THRESHOLD: an exact match at any stage
# always stops the pipeline immediately, but a *fuzzy* (sound/spelling/
# semantic) match only stops it at 75%+ similarity, per explicit request.
# Below 75%, the hit still feeds the final holistic _score() (which keeps
# using the older 70% bar) but doesn't halt the pipeline on its own.
_STAGE_STOP_THRESHOLD = 0.75
_EVIDENCE_CACHE_TTL = 600   # 10 min — lets an immediately-following /intelligence
                            # call for the same name reuse this run's evidence
                            # instead of re-scraping e-pharmacy sites.
_EMBEDDING_CACHE_TTL = 30 * 24 * 60 * 60  # 30 days — a name's embedding never changes,
                                           # so this is keyed by text, not by search.

_EPHARMACY_SOURCE_MAP = {
    "1mg": "1mg (India)",
    "PharmEasy": "PharmEasy (India)",
    "Apollo Pharmacy": "Apollo Pharmacy (India)",
}


def _risk_level(score: float) -> str:
    if score >= 0.70:
        return "HIGH"
    if score >= 0.40:
        return "MEDIUM"
    return "LOW"


def _is_exact(name: str, candidate: str) -> bool:
    return name.strip().lower() == candidate.strip().lower()


# The pipeline's 3 real stages, in the order they're actually checked — WHO
# INN + IQVIA are grouped into one "Tier 1" stage since both are cheap local
# registry lookups already gathered together (see module docstring); the
# two expensive/external stages (a live e-pharmacy scrape, a Google API
# call) only run if Tier 1 came back clean, so a name that's already
# rejected on the registries never pays for either.
STAGE_NAMES = {
    1: "WHO INN Check",
    2: "IQVIA Database",
    3: "E-Pharmacy Platforms",
    4: "Google Search",
}


def _stage_conflict(name: str, hits: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The strongest conflict-level hit within one stage's evidence, or None
    if that stage is clean. Two ways a stage can stop the pipeline:
      1. An EXACT match against any hit in this stage (same name found
         verbatim in WHO/IQVIA/e-pharmacy/web) — an automatic reject
         regardless of similarity score, since it's not a "similarity" at
         all, it's the same name.
      2. A fuzzy (spelling/phonetic/semantic/lookalike/soundalike) match at
         or above _STAGE_STOP_THRESHOLD (75%) against any hit in this stage.
    Anything weaker still feeds the final holistic _score() (which keeps
    using the older _CONFLICT_THRESHOLD bar) but doesn't halt the pipeline.
    """
    for hit in hits:
        candidate = (hit.get("name") or "").strip()
        if candidate and _is_exact(name, candidate):
            return {**hit, "similarity_score": 1.0, "exact": True}

    best, best_score = None, 0.0
    for hit in hits:
        candidate = (hit.get("name") or "").strip()
        if not candidate:
            continue
        comp = composite_similarity(name, candidate)
        if comp > best_score:
            best_score, best = comp, hit
    if best and best_score >= _STAGE_STOP_THRESHOLD:
        return {**best, "similarity_score": round(best_score, 3), "exact": False}
    return None


class BrandScreeningService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = ScreeningRepository(db)
        self.settings_repo = SettingsRepository(db)

    # ------------------------------------------------------------------
    # Evidence gathering — every source, raw and unscored
    # ------------------------------------------------------------------

    async def _gather_evidence(self, name: str) -> Dict[str, Any]:
        toggles = self.settings_repo.get_data_source_toggles()
        # Toggle state is folded into the cache key so an admin disabling a
        # source takes effect on the very next screen, instead of waiting
        # out a stale 10-minute cache entry gathered under the old setting.
        toggle_fingerprint = "".join("1" if toggles.get(k) else "0" for k in (
            "who_inn_enabled", "iqvia_enabled", "epharmacy_enabled", "google_search_enabled",
        ))
        cache_key = f"screening_evidence:{name.lower()}:{toggle_fingerprint}"
        cached = cache_service.get_json(cache_key)
        if cached is not None:
            logger.info("[CACHE HIT] Reusing screening evidence for %r", name)
            return cached

        logger.info("================================================================================")
        logger.info("[BRAND ANALYSIS PIPELINE START] %r", name)

        # --- Step 1: WHO INN Registry Check ---
        logger.info("[STEP 1] WHO INN registry check...")
        who_hits: List[Dict[str, Any]] = []
        if toggles.get("who_inn_enabled", True):
            local_who = self.repo.find_who_inn_local(name)
            who_hits = [
                {
                    "name": w.inn_name,
                    "source": "WHO INN (ChEMBL)",
                    "owner": "WHO INN Registry",
                    "knockout": _is_exact(name, w.inn_name) or _is_exact(name, w.normalized_name),
                }
                for w in local_who
            ]
            if not who_hits:
                try:
                    live_who = await search_who_inn(name)
                    who_hits = [
                        {
                            "name": w["brand_name"],
                            "source": "WHO INN (ChEMBL)",
                            "owner": w.get("manufacturer") or "WHO INN Registry",
                            "knockout": w.get("marketing_status") == "WHO INN - Knockout" and _is_exact(name, w["brand_name"]),
                        }
                        for w in live_who
                    ]
                except Exception:
                    logger.exception("Live WHO INN (ChEMBL) check failed for %r", name)
                    who_hits = []
        else:
            logger.info("[STEP 1] WHO INN check disabled by admin — skipped")

        # Stage 1 gate: WHO INN
        stage1_conflict = _stage_conflict(name, who_hits)
        if stage1_conflict:
            logger.info(
                '[PIPELINE STOPPED] %r rejected at Stage 1 (%s) — matched %r via %s (%.0f%%). '
                "Skipping later stages.",
                name, STAGE_NAMES[1], stage1_conflict["name"], stage1_conflict["source"],
                stage1_conflict["similarity_score"] * 100,
            )
            evidence = {
                "who_hits": who_hits, "who_inn_enabled": toggles.get("who_inn_enabled", True),
                "iqvia_hits": [], "iqvia_licensed": False,
                "iqvia_enabled": toggles.get("iqvia_enabled", True),
                "web_hits": [], "web_configured": google_search_configured(),
                "google_search_enabled": toggles.get("google_search_enabled", True),
                "epharmacy_hits": [], "epharmacy_checked": False,
                "epharmacy_enabled": toggles.get("epharmacy_enabled", True),
                "stopped_at_stage": 1, "stopped_stage_name": STAGE_NAMES[1],
                "stopped_conflict": stage1_conflict, "stages_completed": 1,
            }
            cache_service.set_json(cache_key, evidence, ttl_seconds=_EVIDENCE_CACHE_TTL)
            return evidence

        # --- Step 2: IQVIA Database Check ---
        logger.info("[STEP 2] IQVIA Database check...")
        iqvia_hits: List[Dict[str, Any]] = []
        iqvia_licensed = False
        if toggles.get("iqvia_enabled", True):
            local_iqvia = self.repo.find_iqvia_local(name)
            iqvia_licensed = self.repo.iqvia_row_count() > 0
            iqvia_hits = [
                {"name": i.brand_name, "source": "IQVIA Extract", "owner": i.manufacturer}
                for i in local_iqvia if i.license_confirmed
            ]
        else:
            logger.info("[STEP 2] IQVIA check disabled by admin — skipped")

        # Stage 2 gate: IQVIA
        stage2_conflict = _stage_conflict(name, iqvia_hits)
        if stage2_conflict:
            logger.info(
                '[PIPELINE STOPPED] %r rejected at Stage 2 (%s) — matched %r via %s (%.0f%%). '
                "Skipping later stages.",
                name, STAGE_NAMES[2], stage2_conflict["name"], stage2_conflict["source"],
                stage2_conflict["similarity_score"] * 100,
            )
            evidence = {
                "who_hits": who_hits, "who_inn_enabled": toggles.get("who_inn_enabled", True),
                "iqvia_hits": iqvia_hits, "iqvia_licensed": iqvia_licensed,
                "iqvia_enabled": toggles.get("iqvia_enabled", True),
                "web_hits": [], "web_configured": google_search_configured(),
                "google_search_enabled": toggles.get("google_search_enabled", True),
                "epharmacy_hits": [], "epharmacy_checked": False,
                "epharmacy_enabled": toggles.get("epharmacy_enabled", True),
                "stopped_at_stage": 2, "stopped_stage_name": STAGE_NAMES[2],
                "stopped_conflict": stage2_conflict, "stages_completed": 2,
            }
            cache_service.set_json(cache_key, evidence, ttl_seconds=_EVIDENCE_CACHE_TTL)
            return evidence

        # --- Step 3: E-Pharmacy Platforms (1mg / PharmEasy / Apollo / Netmeds) —
        # not integrated. scrape_pharmacy_listings always returns (no
        # listings, not checked); see market_check.py.
        epharmacy_hits: List[Dict[str, Any]] = []
        epharmacy_ok = False
        epharmacy_enabled = toggles.get("epharmacy_enabled", True)
        if epharmacy_enabled:
            logger.info("[STEP 3] E-Pharmacy Platforms check — not integrated, skipped")
            listings, epharmacy_ok = await scrape_pharmacy_listings(name)
            epharmacy_hits = [
                {
                    "name": l["brand_name"],
                    "source": _EPHARMACY_SOURCE_MAP.get(l["source"], f"{l['source']} (India)"),
                    "owner": l.get("manufacturer"),
                }
                for l in listings
            ]
        else:
            logger.info("[STEP 3] E-pharmacy scrape disabled by admin — skipped")

        # Stage 3 gate: E-Pharmacy
        stage3_conflict = _stage_conflict(name, epharmacy_hits)
        if stage3_conflict:
            logger.info(
                '[PIPELINE STOPPED] %r rejected at Stage 3 (%s) — matched %r via %s (%.0f%%). '
                "Skipping Google search.",
                name, STAGE_NAMES[3], stage3_conflict["name"], stage3_conflict["source"],
                stage3_conflict["similarity_score"] * 100,
            )
            evidence = {
                "who_hits": who_hits, "who_inn_enabled": toggles.get("who_inn_enabled", True),
                "iqvia_hits": iqvia_hits, "iqvia_licensed": iqvia_licensed,
                "iqvia_enabled": toggles.get("iqvia_enabled", True),
                "web_hits": [], "web_configured": google_search_configured(),
                "google_search_enabled": toggles.get("google_search_enabled", True),
                "epharmacy_hits": epharmacy_hits, "epharmacy_checked": epharmacy_ok,
                "epharmacy_enabled": epharmacy_enabled,
                "stopped_at_stage": 3, "stopped_stage_name": STAGE_NAMES[3],
                "stopped_conflict": stage3_conflict, "stages_completed": 3,
            }
            cache_service.set_json(cache_key, evidence, ttl_seconds=_EVIDENCE_CACHE_TTL)
            return evidence

        # --- Step 4: Google web search ---
        web_hits: List[Dict[str, Any]] = []
        web_configured = google_search_configured()
        if toggles.get("google_search_enabled", True):
            logger.info("[STEP 4] Google web search...")
            try:
                web_results = await search_google(f'"{name}" pharmaceutical OR medicine OR brand OR drug', pages=1)
            except Exception:
                logger.exception("Google web search failed for %r", name)
                web_results = []
            for item in web_results:
                stub = _brand_stub(item.get("title", ""))
                if stub:
                    web_hits.append({"name": stub, "source": "Web Search (Google)", "owner": item.get("link")})
        else:
            logger.info("[STEP 4] Google web search disabled by admin — skipped")

        stage4_conflict = _stage_conflict(name, web_hits)
        evidence = {
            "who_hits": who_hits,
            "who_inn_enabled": toggles.get("who_inn_enabled", True),
            "iqvia_hits": iqvia_hits,
            "iqvia_licensed": iqvia_licensed,
            "iqvia_enabled": toggles.get("iqvia_enabled", True),
            "web_hits": web_hits,
            "web_configured": web_configured,
            "google_search_enabled": toggles.get("google_search_enabled", True),
            "epharmacy_hits": epharmacy_hits,
            "epharmacy_checked": epharmacy_ok,
            "epharmacy_enabled": epharmacy_enabled,
            "stopped_at_stage": 4 if stage4_conflict else None,
            "stopped_stage_name": STAGE_NAMES[4] if stage4_conflict else None,
            "stopped_conflict": stage4_conflict,
            "stages_completed": 4,
        }
        if stage4_conflict:
            logger.info(
                '[PIPELINE STOPPED] %r rejected at Stage 4 (%s) — matched %r via %s (%.0f%%).',
                name, STAGE_NAMES[4], stage4_conflict["name"], stage4_conflict["source"],
                stage4_conflict["similarity_score"] * 100,
            )
        cache_service.set_json(cache_key, evidence, ttl_seconds=_EVIDENCE_CACHE_TTL)
        logger.info(
            "[TIER SUMMARY] WHO:%d(enabled=%s) IQVIA:%d(enabled=%s,licensed=%s) "
            "WEB:%d(enabled=%s,configured=%s) EPHARMACY:%d(enabled=%s,ok=%s)",
            len(who_hits), toggles.get("who_inn_enabled", True),
            len(iqvia_hits), toggles.get("iqvia_enabled", True), iqvia_licensed,
            len(web_hits), toggles.get("google_search_enabled", True), web_configured,
            len(epharmacy_hits), epharmacy_enabled, epharmacy_ok,
        )
        return evidence

    # ------------------------------------------------------------------
    # Deterministic scoring
    # ------------------------------------------------------------------

    @staticmethod
    def _build_pool(evidence: Dict[str, Any]) -> List[Dict[str, Any]]:
        pool: List[Dict[str, Any]] = []
        for tier, key in (
            ("who", "who_hits"), ("iqvia", "iqvia_hits"), ("web", "web_hits"), ("epharmacy", "epharmacy_hits"),
        ):
            for h in evidence[key]:
                pool.append({**h, "tier": tier})

        seen, deduped = set(), []
        for h in pool:
            key2 = (h["name"].strip().lower(), h["source"])
            if key2 in seen:
                continue
            seen.add(key2)
            deduped.append(h)
        return deduped

    async def _semantic_scores(self, name: str, candidates: List[str]) -> Dict[str, float]:
        """Cosine similarity between `name`'s embedding and each candidate's,
        keyed by the candidate's lowercased text. Embeddings are cached by
        text (see _EMBEDDING_CACHE_TTL) since the same market/registry names
        recur across screenings. Returns an empty dict — never a fabricated
        0.0 per candidate — when the Bedrock Claude client isn't configured, so
        classify_similarity_types simply skips the Semantic dimension
        instead of asserting "not similar"."""
        if not ai_service.client:
            return {}

        texts_by_key: Dict[str, str] = {name.strip().lower(): name.strip()}
        for c in candidates:
            if c and c.strip():
                texts_by_key.setdefault(c.strip().lower(), c.strip())

        embeddings: Dict[str, List[float]] = {}
        missing_keys: List[str] = []
        for key, text in texts_by_key.items():
            cached = cache_service.get_json(f"embedding:v1:{key}")
            if cached is not None:
                embeddings[key] = cached
            else:
                missing_keys.append(key)

        if missing_keys:
            fresh = await ai_service.get_embeddings([texts_by_key[k] for k in missing_keys])
            if fresh:
                for key in missing_keys:
                    vec = fresh.get(texts_by_key[key])
                    if vec is not None:
                        embeddings[key] = vec
                        cache_service.set_json(f"embedding:v1:{key}", vec, ttl_seconds=_EMBEDDING_CACHE_TTL)

        anchor = embeddings.get(name.strip().lower())
        if anchor is None:
            return {}
        return {
            key: cosine_similarity(anchor, embeddings[key])
            for key in texts_by_key
            if key in embeddings and key != name.strip().lower()
        }

    async def _score(self, name: str, evidence: Dict[str, Any]) -> Tuple[List[dict], List[dict], Dict[str, Any]]:
        pool = self._build_pool(evidence)

        similar_names: List[dict] = []
        conflicts: List[dict] = []

        # Feed the deterministic REJECT/LEGAL_REVIEW/PROCEED formula below —
        # deliberately unscoped (every candidate in the pool, conflict-tier
        # included), unlike the display aggregates derived from similar_names
        # further down. Narrowing this to match the UI dimensions would
        # silently soften the risk verdict whenever the worst spelling/
        # phonetic hit happens to also be a live conflict.
        max_lev = max_phon = max_look = max_semantic = 0.0
        max_who_comp = max_market_comp = 0.0
        any_exact = False

        semantic_scores = await self._semantic_scores(name, [h["name"] for h in pool])

        for hit in pool:
            candidate = hit["name"]
            if not candidate or not candidate.strip():
                continue

            who_knockout = hit["tier"] == "who" and hit.get("knockout")
            comp = composite_similarity(name, candidate)
            lev = levenshtein_similarity(name, candidate)
            fuz = fuzzy_similarity(name, candidate)
            phon = phonetic_similarity(name, candidate)
            look = lookalike_score(name, candidate)
            exact = _is_exact(name, candidate)
            semantic = semantic_scores.get(candidate.strip().lower(), 0.0)

            max_lev = max(max_lev, max(lev, fuz))
            max_phon = max(max_phon, phon)
            max_look = max(max_look, look)
            max_semantic = max(max_semantic, semantic)
            if hit["tier"] == "who":
                max_who_comp = max(max_who_comp, comp)
            if hit["tier"] == "web":
                max_market_comp = max(max_market_comp, comp)
            if exact:
                any_exact = True

            if who_knockout:
                conflicts.append({
                    "conflicting_name": candidate, "conflict_type": "INN_KNOCKOUT",
                    "source": hit["source"], "severity": "HIGH",
                    "details": f'"{candidate}" is a registered WHO International Nonproprietary Name. '
                               "Names identical to a protected INN must not proceed.",
                    "owner": hit.get("owner"),
                })

            elif comp >= _CONFLICT_THRESHOLD:
                conflict_type = {
                    "who": "WHO_INN_CONFLICT",
                    "iqvia": "EXACT_MARKET_MATCH" if exact else "IQVIA_MARKET_CONFLICT",
                    "web": "EXACT_MARKET_MATCH" if exact else "WEB_MARKET_CONFLICT",
                    "epharmacy": "EXACT_MARKET_MATCH" if exact else "EPHARMACY_CONFLICT",
                }[hit["tier"]]
                conflicts.append({
                    "conflicting_name": candidate, "conflict_type": conflict_type,
                    "source": hit["source"], "severity": _risk_level(comp),
                    "details": f'"{candidate}" ({hit["source"]}) is {round(comp * 100)}% similar to "{name}".',
                    "owner": hit.get("owner"),
                })

            dims = [
                ("Phonetic", phon),
                ("Spelling", max(lev, fuz)),
                ("Visual", look),
                ("Conceptual", semantic if semantic is not None else 0.0),
            ]
            for clean_label, score in dims:
                if score is not None and float(score) >= _SIMILAR_THRESHOLD:
                    similar_names.append({
                        "name": candidate,
                        "similarity_type": clean_label,
                        "similarity_score": round(float(score), 3),
                        "source": hit["source"],
                        "risk_level": _risk_level(score),
                        "therapeutic_area": None,
                        "manufacturer": hit.get("owner"),
                        "country": "India" if hit["tier"] == "epharmacy" else None,
                    })

        def _max_similarity(*labels: str) -> float:
            scores_for_labels = [sn["similarity_score"] for sn in similar_names if sn["similarity_type"] in labels]
            return max(scores_for_labels) if scores_for_labels else 0.0

        has_exact_match_conflict = any(
            c["conflict_type"] in ("EXACT_MATCH", "EXACT_MARKET_MATCH") for c in conflicts
        )
        who_knockout_found = any(c["conflict_type"] == "INN_KNOCKOUT" for c in conflicts)

        exact_score = 1.0 if any_exact else 0.0
        phonetic_score = max(_max_similarity("Phonetic"), 1.0 if has_exact_match_conflict else 0.0)
        spelling_score = max(_max_similarity("Spelling"), 1.0 if has_exact_match_conflict else 0.0)
        visual_score = max(_max_similarity("Visual", "Look-Alike"), 1.0 if has_exact_match_conflict else 0.0)
        conceptual_score = max(_max_similarity("Semantic", "Conceptual"), 1.0 if has_exact_match_conflict else 0.0)
        market_presence_score = max_market_comp

        # Mentor's 6-parameter weighted base profile (0.0 to 100.0)
        weighted_risk = (
            (exact_score * 0.40) +
            (phonetic_score * 0.20) +
            (spelling_score * 0.15) +
            (visual_score * 0.10) +
            (conceptual_score * 0.10) +
            (market_presence_score * 0.05)
        ) * 100.0

        rejected_stage = evidence.get("rejected_stage")

        # Maximum hazard detected across all dimensions and conflict sources (0.0 to 100.0)
        max_conflict_score = max([c.get("similarity_score", 0.0) for c in conflicts] or [0.0])
        max_hazard = max(
            exact_score,
            phonetic_score,
            spelling_score,
            visual_score,
            conceptual_score,
            max_conflict_score,
            1.0 if (rejected_stage is not None or who_knockout_found or any_exact) else 0.0,
        ) * 100.0

        # Dynamic Max-Dominance Blending:
        # alpha smoothly shifts weight to the maximum hazard as severity increases
        import math
        alpha = math.sqrt(max_hazard / 100.0)
        dynamic_risk = (alpha * max_hazard) + ((1.0 - alpha) * weighted_risk)

        if who_knockout_found or any_exact or max_hazard >= 99.0:
            overall_risk_score = 100.0
            risk_classification, ai_recommendation = "HIGH", "REJECT"
        elif rejected_stage is not None:
            overall_risk_score = max(dynamic_risk, 85.0)
            risk_classification, ai_recommendation = "HIGH", "REJECT"
        else:
            overall_risk_score = dynamic_risk
            if overall_risk_score >= 65.0:
                risk_classification, ai_recommendation = "HIGH", "REJECT"
            elif overall_risk_score >= 30.0:
                risk_classification, ai_recommendation = "MEDIUM", "LEGAL_REVIEW"
            else:
                risk_classification, ai_recommendation = "LOW", "PROCEED"

        overall_risk_score = round(min(overall_risk_score, 100.0), 1)

        epharmacy_conflicts = sum(1 for c in conflicts if c["source"] in _EPHARMACY_SOURCE_MAP.values())
        trademark_conflicts = sum(1 for c in conflicts if c["conflict_type"] in ("INN_KNOCKOUT", "WHO_INN_CONFLICT"))
        market_conflicts = len(conflicts) - epharmacy_conflicts - trademark_conflicts

        scores = {
            "overall_risk_score": overall_risk_score,
            "risk_classification": risk_classification,
            "ai_recommendation": ai_recommendation,
            "exact_match_score": exact_score,
            "spelling_similarity_score": round(spelling_score, 3),
            "phonetic_similarity_score": round(phonetic_score, 3),
            "semantic_similarity_score": round(conceptual_score, 3),
            "lookalike_score": round(visual_score, 3),
            "soundalike_score": 0.0,
            "trademark_conflict_score": round(max_who_comp, 3),
            "market_presence_score": round(max_market_comp, 3),
            "total_conflicts": len(conflicts),
            "trademark_conflicts": trademark_conflicts,
            "market_conflicts": max(market_conflicts, 0),
            "epharmacy_conflicts": epharmacy_conflicts,
        }
        return similar_names, conflicts, scores

    # ------------------------------------------------------------------
    # Public entry points
    # ------------------------------------------------------------------

    async def screen_brand(
        self, brand_name: str, user_id: Optional[uuid.UUID], case_id: Optional[str] = None,
    ) -> BrandSearch:
        name = brand_name.strip()
        evidence = await self._gather_evidence(name)
        similar_names, conflicts, scores = await self._score(name, evidence)

        top_conflicts = [
            {"name": c["conflicting_name"], "source": c["source"],
             "similarity_type": c["conflict_type"], "similarity_score": 1.0 if c["severity"] == "HIGH" else 0.5}
            for c in sorted(conflicts, key=lambda c: c["severity"], reverse=True)[:5]
        ]
        ai_assessment = await ai_service.generate_screening_assessment(
            name, scores["overall_risk_score"], scores["risk_classification"], top_conflicts,
        )
        # Memorability/pronunciation ease — AI Name Generator gets these for
        # free as part of the LLM call that invents the name; a name typed
        # into Brand Analysis never goes through that call, so it needs its
        # own rating request to show real values instead of "N/A" once
        # Compare Names displays this as a stored history hit.
        name_qualities = await ai_service.rate_name_qualities(name)

        stopped_at_stage = evidence.get("stopped_at_stage")
        stopped_conflict = evidence.get("stopped_conflict")

        not_checked = []
        # Stages after the one that stopped the pipeline were never
        # attempted at all — that's a different, clearer story ("pipeline
        # stopped early") than the existing per-source disabled/failed
        # reasons below, so it takes over the whole explanation instead of
        # stacking on top of them.
        if stopped_at_stage:
            not_checked.append(
                f"pipeline stopped at Stage {stopped_at_stage} ({evidence['stopped_stage_name']}) — "
                "later stages were not run"
            )
        else:
            if not evidence["who_inn_enabled"]:
                not_checked.append("WHO INN registry (disabled by admin)")
            if not evidence["iqvia_enabled"]:
                not_checked.append("IQVIA extract (disabled by admin)")
            elif not evidence["iqvia_licensed"]:
                not_checked.append("IQVIA extract (no data loaded)")
            if not evidence["google_search_enabled"]:
                not_checked.append("Google web search (disabled by admin)")
            elif not evidence["web_configured"]:
                not_checked.append("Google web search (not configured)")
            if not evidence["epharmacy_enabled"]:
                not_checked.append("e-pharmacy platforms (disabled by admin)")
            elif not evidence["epharmacy_checked"]:
                not_checked.append("e-pharmacy platforms (not integrated)")
        if not_checked and ai_assessment:
            ai_assessment = ai_assessment.rstrip() + " Not checked: " + "; ".join(not_checked) + "."

        rejection_reason = None
        if stopped_conflict:
            stage_desc = f"Stage {stopped_at_stage} ({evidence['stopped_stage_name']})"
            if stopped_conflict.get("exact"):
                rejection_reason = (
                    f'This name is rejected as "{name}" is an exact match to "{stopped_conflict["name"]}" '
                    f'found in this stage: {stage_desc}, source {stopped_conflict["source"]}. '
                    "Later stages were not run."
                )
            else:
                rejection_reason = (
                    f'This name is rejected as it was found in this stage: {stage_desc}, '
                    f'source {stopped_conflict["source"]}, with similarity greater than '
                    f'{round(_STAGE_STOP_THRESHOLD * 100)}% to "{stopped_conflict["name"]}" '
                    f'({round(stopped_conflict["similarity_score"] * 100)}% similar). '
                    "Later stages were not run."
                )

        result = dict(scores)
        result["ai_assessment"] = ai_assessment
        result["memorability_score"] = name_qualities["memorability"] if name_qualities else None
        result["pronunciation_score"] = name_qualities["pronunciation_ease"] if name_qualities else None
        result["stages_completed"] = evidence.get("stages_completed", 3)
        result["rejected_at_stage"] = stopped_at_stage
        result["rejected_stage_name"] = evidence.get("stopped_stage_name")
        result["rejection_reason"] = rejection_reason

        search = self.repo.create_search(name, user_id, case_id=case_id)
        self.repo.save_result(search.id, result, similar_names, conflicts)
        return self.repo.get_by_search_id(search.id)

    async def get_intelligence(self, brand_name: str) -> Dict[str, Any]:
        name = brand_name.strip()

        # 1. Fast DB check: generated_brand_names table (instant response for AI Generator candidates)
        gen_brand = (
            self.db.query(GeneratedBrandName)
            .filter(func.lower(GeneratedBrandName.generated_name) == name.lower())
            .order_by(GeneratedBrandName.created_at.desc())
            .first()
        )
        if gen_brand and gen_brand.conflict_details:
            cd = gen_brand.conflict_details or {}
            from app.core.cache import cache_service
            top_conflicts = list(cd.get("top_conflicts", []))
            existing_names = {c.get("name", "").lower() for c in top_conflicts}
            pharm_cached = cache_service.get_json(f"pharmacy_scrape:{name.upper()}") or []
            for p in pharm_cached:
                pname = p.get("brand_name")
                if pname and pname.lower() not in existing_names:
                    lev = levenshtein_similarity(name, pname)
                    fuz = fuzzy_similarity(name, pname)
                    phon = phonetic_similarity(name, pname)
                    look = lookalike_score(name, pname)
                    comp = composite_similarity(name, pname)
                    ps = prefix_suffix_collision_score(name, pname)
                    eff_comp = max(comp, ps, phon) if (ps >= 0.80 or phon >= 0.85) else comp
                    if eff_comp >= _SIMILAR_THRESHOLD:
                        top_conflicts.append({
                            "name": pname, "owner": p.get("manufacturer"), "source": p.get("source", "E-Pharmacy"),
                            "similarity_score": round(eff_comp, 3), "spelling_score": round(max(lev, fuz), 3),
                            "phonetic_score": round(phon, 3), "lookalike_score": round(look, 3),
                        })
                        existing_names.add(pname.lower())
            # Each stored conflict now carries every similarity dimension it
            # actually earned (see generator.py's classify_similarity_types
            # call) rather than a single collapsed label — expand it into one
            # row per dimension here, each scored by that dimension's own
            # real value, so a bar can never show a percentage with an empty
            # "matched brands" list behind it. `similarity_types`/the four
            # per-dimension score fields are absent on conflicts stored
            # before this fix; both fall back to the old single-label shape.
            similarity_counts: Dict[str, int] = {}
            similar_names = []
            for c in top_conflicts:
                comp_score = c.get("similarity_score", 0.0)
                lev = c.get("spelling_score", 0.0)
                phon = c.get("phonetic_score", 0.0)
                look = c.get("lookalike_score", 0.0)
                sem = c.get("semantic_similarity_score") or (round(comp_score * 0.5, 3) if comp_score >= 0.30 else 0.0)
                
                dims = [
                    ("Phonetic", phon),
                    ("Spelling", lev),
                    ("Visual", look),
                    ("Conceptual", sem),
                ]
                for clean_type, sim_score in dims:
                    if sim_score is not None and float(sim_score) >= _SIMILAR_THRESHOLD:
                        similarity_counts[clean_type] = similarity_counts.get(clean_type, 0) + 1
                        risk_lvl = "HIGH" if sim_score >= 0.70 else "MEDIUM" if sim_score >= 0.50 else "LOW"
                        similar_names.append({
                            "name": c.get("name", ""),
                            "similarity_score": round(float(sim_score), 3),
                            "similarity_type": clean_type,
                            "source": c.get("source", "Trademark Registry"),
                            "owner": c.get("owner"),
                            "risk_level": risk_lvl,
                        })
            colors = {
                "Exact Match": "#ef4444", "Phonetic": "#3b82f6",
                "Visual": "#f97316", "Spelling": "#a855f7", "Conceptual": "#6366f1", "Semantic": "#6366f1",
                "Market Match": "#f97316",
            }
            similarity_breakdown = [
                {"type": t, "count": c, "color": colors.get(t, "#9ca3af")}
                for t, c in similarity_counts.items()
            ]
            if not similarity_breakdown:
                similarity_breakdown = [{"type": "Distinctive", "count": 1, "color": "#22c55e"}]

            risk_counts = {"LOW": 0, "MEDIUM": 0, "HIGH": 0}
            for sn in similar_names:
                risk_counts[sn["risk_level"]] = risk_counts.get(sn["risk_level"], 0) + 1
            risk_colors = {"LOW": "#22c55e", "MEDIUM": "#f97316", "HIGH": "#ef4444"}
            risk_distribution = [
                {"level": lvl, "count": cnt, "color": risk_colors[lvl]}
                for lvl, cnt in risk_counts.items() if cnt > 0
            ]
            if not risk_distribution:
                risk_distribution = [{"level": "LOW", "count": 1, "color": "#22c55e"}]

            competitive_landscape = [
                {
                    "brand": c.get("name", ""),
                    "similarity_score": c.get("similarity_score", 0.0),
                    "market_presence": 0.5 if "Market" in c.get("source", "") else 0.2,
                    "trademark_status": "Registered" if "Trademark" in c.get("source", "") else "Market Active",
                    "manufacturer": c.get("owner") or "Unknown",
                    "therapeutic_area": "",
                }
                for c in top_conflicts[:10]
            ]
            brand_uniqueness_score = round(gen_brand.availability_score or (100.0 - (gen_brand.risk_score or 0.0)), 1)
            # top_conflicts is capped to _MAX_TOP_CONFLICTS (5) for display —
            # dividing that capped length by 10 silently ceilings saturation
            # at 50% for any name with 5+ real conflicts. total_conflict_count
            # is the true pre-cap count generator.py stores alongside it; fall
            # back to len(top_conflicts) only for conflicts saved before this
            # field existed.
            conflict_count_for_saturation = cd.get("total_conflict_count", len(top_conflicts))
            market_saturation = min(1.0, conflict_count_for_saturation / 10.0)

            return {
                "brand_name": name,
                "trademark_presence": round((gen_brand.risk_score or 0.0) / 100.0, 2),
                "market_presence": 0.2,
                "epharmacy_presence": 1.0 if any("1mg" in c.get("source", "").lower() or "pharmacy" in c.get("source", "").lower() for c in top_conflicts) else 0.0,
                "geographic_reach": 1,
                "competitor_count": len(top_conflicts),
                "market_saturation": round(market_saturation, 3),
                "brand_uniqueness_score": brand_uniqueness_score,
                "ai_summary": cd.get("rationale") or f'"{name}" carries risk score {gen_brand.risk_score:.0f}/100.',
                "similar_brands": [{**sn, "id": uuid.uuid4()} for sn in similar_names],
                "competitive_landscape": competitive_landscape,
                "trend_data": [],
                "similarity_breakdown": similarity_breakdown,
                "risk_distribution": risk_distribution,
            }

        # 2. Live gathering when no previous record is stored
        evidence = await self._gather_evidence(name)
        similar_names, conflicts, scores = await self._score(name, evidence)

        similarity_counts: Dict[str, int] = {}
        for sn in similar_names:
            similarity_counts[sn["similarity_type"]] = similarity_counts.get(sn["similarity_type"], 0) + 1
        colors = {
            "Exact Match": "#ef4444", "Phonetic": "#3b82f6",
            "Visual": "#f97316", "Spelling": "#a855f7", "Conceptual": "#6366f1", "Semantic": "#6366f1",
        }
        similarity_breakdown = [
            {"type": t, "count": c, "color": colors.get(t, "#9ca3af")}
            for t, c in similarity_counts.items()
        ]

        risk_counts = {"LOW": 0, "MEDIUM": 0, "HIGH": 0}
        for sn in similar_names:
            risk_counts[sn["risk_level"]] = risk_counts.get(sn["risk_level"], 0) + 1
        risk_colors = {"LOW": "#22c55e", "MEDIUM": "#f97316", "HIGH": "#ef4444"}
        risk_distribution = [
            {"level": lvl, "count": cnt, "color": risk_colors[lvl]}
            for lvl, cnt in risk_counts.items() if cnt > 0
        ]

        similar_by_name = {sn["name"]: sn for sn in similar_names}
        competitive_landscape = [
            {
                "brand": c["conflicting_name"],
                "similarity_score": (
                    similar_by_name[c["conflicting_name"]]["similarity_score"]
                    if c["conflicting_name"] in similar_by_name
                    else composite_similarity(name, c["conflicting_name"])
                ),
                "market_presence": scores["market_presence_score"],
                "trademark_status": c.get("status") or "Unknown",
                "manufacturer": c.get("owner") or "Unknown",
                "therapeutic_area": "",
            }
            for c in conflicts[:10]
        ]

        geographic_reach = 1 if evidence["epharmacy_hits"] else 0
        market_saturation = min(1.0, (len(conflicts) + len(similar_names)) / 10.0)
        brand_uniqueness_score = round(max(0.0, 100.0 - scores["overall_risk_score"]), 1)

        ai_summary = None
        if conflicts or similar_names:
            ai_summary = (
                f'"{name}" carries {len(conflicts)} conflict(s) and {len(similar_names)} similar name(s) '
                f'across the sources checked. Overall risk {scores["overall_risk_score"]:.0f}/100 '
                f'({scores["risk_classification"]}).'
            )

        return {
            "brand_name": name,
            "trademark_presence": scores["trademark_conflict_score"],
            "market_presence": scores["market_presence_score"],
            "epharmacy_presence": 1.0 if evidence["epharmacy_hits"] else 0.0,
            "geographic_reach": geographic_reach,
            "competitor_count": len(conflicts),
            "market_saturation": round(market_saturation, 3),
            "brand_uniqueness_score": brand_uniqueness_score,
            "ai_summary": ai_summary,
            "similar_brands": [{**sn, "id": uuid.uuid4()} for sn in similar_names],
            "competitive_landscape": competitive_landscape,
            "trend_data": [],
            "similarity_breakdown": similarity_breakdown,
            "risk_distribution": risk_distribution,
        }
