import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from app.core.config import settings
from app.services.screening import (
    composite_similarity, levenshtein_similarity, phonetic_similarity, prefix_suffix_collision_score
)
from app.services.web_search import search_google

logger = logging.getLogger(__name__)


def google_search_configured() -> bool:
    return bool(settings.GOOGLE_API_KEY and settings.GOOGLE_CSE_ID)

# A match here means "found on a live pharmacy site / Google right now" —
# a much stronger signal than the 0.45 "worth noting as a similar name"
# threshold used for reference-name scoring in generator.py, so it needs a
# stricter bar to avoid discarding a genuinely distinctive coined name over
# incidental overlap.
MATCH_THRESHOLD = 0.70

# Dosage/pack/form words to strip off a raw listing title before comparing —
# e.g. "Paracip-650 Tablet 10's" -> "Paracip-650", so the comparison is
# against the brand itself, not the pack description around it.
_STRIP_SUFFIXES = re.compile(
    r"\b(\d+[\.,]?\d*\s*(mg|ml|mcg|iu|gm|g|%)|"
    r"tablet|capsule|syrup|injection|solution|cream|gel|ointment|"
    r"drops|inhaler|spray|suspension|powder|sachet|strip|bottle|"
    r"pack|box|pc|pcs)\b.*$",
    re.IGNORECASE,
)


def _brand_stub(raw_title: str) -> str:
    for sep in (" - ", " | ", " : ", " – ", " — "):
        if sep in raw_title:
            raw_title = raw_title.split(sep)[0]
    stub = _STRIP_SUFFIXES.sub("", raw_title).strip(" -")
    return stub or raw_title


async def scrape_pharmacy_listings(composition: str) -> Tuple[List[Dict[str, Any]], bool]:
    """E-pharmacy discovery (1mg / PharmEasy / Apollo Pharmacy / Netmeds) is
    not integrated. It was previously implemented via Google Custom Search
    (one siteSearch-scoped query per domain); that implementation has been
    removed. Always returns (no listings, not checked) rather than (no
    listings, confirmed clean) — callers must keep treating this stage as
    unavailable, never as evidence the name is clear on these platforms.
    """
    return [], False


async def find_who_inn_conflict(name: str, db) -> Optional[Dict[str, Any]]:
    """WHO INN check — local WhoInnRegistry table first, falling back to the
    live ChEMBL mirror only when the local table has no data at all (an
    empty local table means "not imported yet", not "no INNs exist", so the
    live call is the honest substitute; a populated local table with no hit
    means "checked, clear" and the live call would be redundant).

    An exact name match to a registered INN is always a knockout per the
    WHO spec, regardless of the similarity threshold used for every other
    tier in this pipeline."""
    from app.repositories.screening import ScreeningRepository
    from app.services.external_apis import search_who_inn as _live_search_who_inn

    repo = ScreeningRepository(db)
    local = repo.find_who_inn_local(name)
    for w in local:
        if w.inn_name.strip().lower() == name.strip().lower():
            return {"name": w.inn_name, "source": "WHO INN Registry", "owner": "WHO INN Registry", "similarity_score": 1.0}

    if local:
        best, best_score = None, 0.0
        for w in local:
            score = composite_similarity(name, w.inn_name)
            if score > best_score:
                best_score, best = score, w
        if best and best_score >= MATCH_THRESHOLD:
            return {"name": best.inn_name, "source": "WHO INN Registry", "owner": "WHO INN Registry",
                    "similarity_score": round(best_score, 3)}
        return None

    try:
        live = await _live_search_who_inn(name)
    except Exception:
        logger.exception("Live WHO INN (ChEMBL) check failed for %r", name)
        return None

    for w in live:
        if w.get("marketing_status") == "WHO INN - Knockout":
            return {"name": w["brand_name"], "source": "WHO INN (ChEMBL)",
                    "owner": w.get("manufacturer") or "WHO INN Registry", "similarity_score": 1.0}
    best, best_score = None, 0.0
    for w in live:
        score = composite_similarity(name, w["brand_name"])
        if score > best_score:
            best_score, best = score, w
    if best and best_score >= MATCH_THRESHOLD:
        return {"name": best["brand_name"], "source": "WHO INN (ChEMBL)",
                "owner": best.get("manufacturer") or "WHO INN Registry", "similarity_score": round(best_score, 3)}
    return None


async def find_iqvia_conflict(name: str, db) -> Optional[Dict[str, Any]]:
    """IQVIA check — local IqviaExtract table only, restricted to rows whose
    licence is confirmed (an unlicensed/empty table must never read as
    clearance — see the model docstring)."""
    from app.repositories.screening import ScreeningRepository

    repo = ScreeningRepository(db)
    local = [i for i in repo.find_iqvia_local(name) if i.license_confirmed]
    best, best_score = None, 0.0
    for i in local:
        score = composite_similarity(name, i.brand_name)
        if score > best_score:
            best_score, best = score, i
    if best and best_score >= MATCH_THRESHOLD:
        return {"name": best.brand_name, "source": "IQVIA Extract", "owner": best.manufacturer,
                "similarity_score": round(best_score, 3)}
    return None


def find_pharmacy_conflict(name: str, listings: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    best = None
    best_score = 0.0
    for listing in listings:
        candidate = _brand_stub(listing["brand_name"])
        lev = levenshtein_similarity(name, candidate)
        phon = phonetic_similarity(name, candidate)
        comp = composite_similarity(name, candidate)
        ps = prefix_suffix_collision_score(name, candidate)
        exact = candidate.strip().lower() == name.strip().lower()
        
        # High confidence collision detection: exact match, high composite, or high LASA/phonetic match
        if exact:
            effective_score = 1.0
        elif comp >= MATCH_THRESHOLD:
            effective_score = comp
        elif phon >= 0.85:
            effective_score = phon
        elif ps >= 0.85:
            effective_score = ps
        elif lev >= 0.80:
            effective_score = lev
        else:
            effective_score = comp * 0.7  # Low confidence hit

        if effective_score > best_score:
            best_score = effective_score
            best = listing

    if best and best_score >= MATCH_THRESHOLD:
        return {
            "name": best["brand_name"],
            "source": best["source"],
            "owner": best.get("manufacturer") or None,
            "similarity_score": round(best_score, 3),
        }
    return None


async def find_google_conflict(name: str) -> Optional[Dict[str, Any]]:
    if not google_search_configured():
        return None

    cache_key = f"google_conflict:{name.lower()}"
    cached_result = cache_service.get_json(cache_key)
    if cached_result is not None:
        return cached_result if cached_result.get("conflict") else None

    query = f'"{name}" pharmaceutical OR medicine OR drug OR tablet'
    results = await search_google(query, pages=2)
    best = None
    best_score = 0.0
    for item in results:
        candidate = _brand_stub(item.get("title", ""))
        if not candidate:
            continue
        score = composite_similarity(name, candidate)
        if score > best_score:
            best_score = score
            best = item

    if best and best_score >= MATCH_THRESHOLD:
        conflict = {
            "name": name,
            "source": "Google Search",
            "owner": best.get("link"),
            "similarity_score": round(best_score, 3),
        }
        cache_service.set_json(cache_key, {"conflict": conflict}, ttl_seconds=2592000)  # 30 days
        return conflict

    cache_service.set_json(cache_key, {"conflict": None}, ttl_seconds=2592000)  # 30 days
    return None

