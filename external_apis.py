"""
Live connectors to free public pharmaceutical APIs.

  - openFDA Drug NDC   https://api.fda.gov/drug/ndc.json   — used by the
    /admin/sync/fda MarketBrand-seeding endpoint (app/api/routes/admin.py).
  - WHO INN (ChEMBL)   https://www.ebi.ac.uk/chembl/api/data/   — used by
    the Brand Analysis screening pipeline (app/services/brand_screening.py)
    as the live fallback when the local WhoInnRegistry table is empty.

Both are free, no API key required.
"""

from typing import List, Dict, Any, Optional
import httpx

OPENFDA_NDC  = "https://api.fda.gov/drug/ndc.json"
CHEMBL_BASE  = "https://www.ebi.ac.uk/chembl/api/data"  # WHO INN via EMA/ChEMBL — free, no key

_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


async def _get(url: str, params: dict) -> Optional[dict]:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(url, params=params)
            if r.status_code == 200:
                return r.json()
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# openFDA – Drug NDC database
# Returns FDA-approved brand names matching the query
# ---------------------------------------------------------------------------

async def search_openfda(brand_name: str) -> List[Dict[str, Any]]:
    results = []

    # Exact phrase search
    data = await _get(OPENFDA_NDC, {
        "search": f'brand_name:"{brand_name}"',
        "limit": 10,
    })
    _parse_fda_ndc(data, results)

    # Fuzzy prefix search (catches partial matches)
    data2 = await _get(OPENFDA_NDC, {
        "search": f"brand_name:{brand_name}*",
        "limit": 15,
    })
    _parse_fda_ndc(data2, results)

    # Deduplicate by brand_name
    seen, unique = set(), []
    for r in results:
        key = r["brand_name"].lower()
        if key not in seen:
            seen.add(key)
            unique.append(r)
    return unique


def _parse_fda_ndc(data: Optional[dict], out: list) -> None:
    if not data or "results" not in data:
        return
    for item in data["results"]:
        brand = item.get("brand_name", "").strip()
        generic = item.get("generic_name", "").strip()
        if not brand:
            continue
        out.append({
            "brand_name": brand,
            "generic_name": generic,
            "manufacturer": item.get("labeler_name", ""),
            "product_type": item.get("product_type", ""),
            "route": ", ".join(item.get("route", [])),
            "marketing_status": item.get("marketing_status", ""),
            "source": "FDA Drug Database",
        })


# ---------------------------------------------------------------------------
# WHO INN (International Nonproprietary Names) via ChEMBL REST API
# Free — no API key required.  ChEMBL is maintained by the EMA and mirrors
# the WHO INN list as the canonical `pref_name` on each molecule record.
#
# Knockout rule (WHO spec): a brand name that IS a registered INN, or that
# starts with a protected INN stem (≥6 chars), must be rejected.
# ---------------------------------------------------------------------------

async def search_who_inn(brand_name: str) -> List[Dict[str, Any]]:
    """
    Returns matching WHO INN records from ChEMBL.

    Searches the molecule_synonyms field with syn_type=INN so that both
    the WHO INN name (e.g. "paracetamol") and the USAN name (e.g.
    "acetaminophen") are found — ChEMBL's pref_name is the USAN which often
    differs from the WHO INN, so pref_name searches miss many INNs.

    Results carry  marketing_status = "WHO INN - Knockout"  for exact INN hits.
    """
    results: List[Dict[str, Any]] = []

    def _inn_name_from_mol(mol: dict, fallback: str) -> str:
        """Return the INN synonym string; fall back to pref_name."""
        for s in mol.get("molecule_synonyms", []):
            if s.get("syn_type") == "INN":
                return (s.get("synonyms") or s.get("molecule_synonym") or "").strip()
        return (mol.get("pref_name") or fallback).strip()

    # 1. Exact INN match — the proposed name IS a registered nonproprietary name
    data = await _get(f"{CHEMBL_BASE}/molecule.json", {
        "molecule_synonyms__synonyms__iexact": brand_name,
        "molecule_synonyms__syn_type__iexact": "INN",
        "format": "json",
        "limit": 5,
    })
    if data:
        for mol in data.get("molecules", []):
            inn = _inn_name_from_mol(mol, brand_name)
            if inn:
                results.append({
                    "brand_name":       inn,
                    "generic_name":     inn,
                    "manufacturer":     "WHO INN Registry",
                    "product_type":     mol.get("molecule_type", "Small molecule"),
                    "route":            "",
                    "marketing_status": "WHO INN - Knockout",
                    "source":           "WHO INN (ChEMBL)",
                    "chembl_id":        mol.get("molecule_chembl_id", ""),
                })

    # 2. INN-stem match — brand name shares the first 6 chars with a known INN
    #    (catches e.g. "Simvalo" matching the "-simva-" statin stem)
    if len(brand_name) >= 6:
        data2 = await _get(f"{CHEMBL_BASE}/molecule.json", {
            "molecule_synonyms__synonyms__istartswith": brand_name[:6],
            "molecule_synonyms__syn_type__iexact": "INN",
            "format": "json",
            "limit": 20,
        })
        if data2:
            for mol in data2.get("molecules", []):
                inn = _inn_name_from_mol(mol, mol.get("pref_name", ""))
                if inn and inn.lower() != brand_name.lower():
                    results.append({
                        "brand_name":       inn,
                        "generic_name":     inn,
                        "manufacturer":     "WHO INN Registry",
                        "product_type":     mol.get("molecule_type", "Small molecule"),
                        "route":            "",
                        "marketing_status": "WHO INN",
                        "source":           "WHO INN (ChEMBL)",
                        "chembl_id":        mol.get("molecule_chembl_id", ""),
                    })

    # Deduplicate
    seen: set = set()
    unique: List[Dict[str, Any]] = []
    for r in results:
        key = r["brand_name"].lower()
        if key not in seen:
            seen.add(key)
            unique.append(r)
    return unique
