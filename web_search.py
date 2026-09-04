"""Google Custom Search JSON API — used to check a candidate brand name
against Google's general web index (not scoped to any particular site).

Requires GOOGLE_API_KEY + GOOGLE_CSE_ID (a Programmable Search Engine set to
search the entire web). Returns [] when unconfigured or on any API error —
callers must treat that as "not checked", never as "confirmed clean" (an
empty result here carries no evidence either way).
"""
import logging
from typing import Any, Dict, List

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

GOOGLE_CSE_URL = "https://www.googleapis.com/customsearch/v1"
_TIMEOUT = httpx.Timeout(10.0, connect=5.0)
_RESULTS_PER_PAGE = 10


async def search_google(query: str, pages: int = 2) -> List[Dict[str, Any]]:
    """Fetch up to `pages` pages (10 results each) of Google Custom Search
    results for `query`. Returns a flat list of {title, link, snippet}."""
    if not settings.GOOGLE_API_KEY or not settings.GOOGLE_CSE_ID:
        return []

    results: List[Dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            for page_index in range(pages):
                start = page_index * _RESULTS_PER_PAGE + 1
                response = await client.get(GOOGLE_CSE_URL, params={
                    "key": settings.GOOGLE_API_KEY,
                    "cx": settings.GOOGLE_CSE_ID,
                    "q": query,
                    "num": _RESULTS_PER_PAGE,
                    "start": start,
                })
                if response.status_code != 200:
                    logger.warning("Google CSE returned %s for query %r", response.status_code, query)
                    break
                data = response.json()
                items = data.get("items", [])
                for item in items:
                    results.append({
                        "title": item.get("title", ""),
                        "link": item.get("link", ""),
                        "snippet": item.get("snippet", ""),
                    })
                if len(items) < _RESULTS_PER_PAGE:
                    break  # fewer than a full page — no point requesting the next one
    except Exception:
        logger.exception("Google CSE search failed for query %r", query)
    return results
