"""
Data import endpoints for IP India / CDSCO / E-Pharmacy data.
Supports CSV and Excel (.xlsx) uploads.
All write endpoints require is_superuser=True.
"""

from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from datetime import datetime
import io
import csv
import re
from typing import Optional

from app.core.database import get_db
from app.api.deps import require_superuser
from app.models.user import User
from app.models.trademark import TrademarkRegistry, MarketBrand, EPharmacyBrand

try:
    import openpyxl
    HAS_OPENPYXL = True
except ImportError:
    HAS_OPENPYXL = False

router = APIRouter(prefix="/admin/import", tags=["Import"])


# ── Helpers ─────────────────────────────────────────────────────────────────

def _norm_col(name: str) -> str:
    return re.sub(r'[^a-z0-9]+', '_', name.lower().strip()).strip('_')


def _parse_file(file_bytes: bytes, filename: str) -> list:
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else 'csv'

    if ext in ('xlsx', 'xls'):
        if not HAS_OPENPYXL:
            raise HTTPException(400, "openpyxl not installed. Run: pip install openpyxl")
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            return []
        headers = [_norm_col(str(h or '')) for h in rows[0]]
        result = []
        for row in rows[1:]:
            if all(v is None or str(v).strip() == '' for v in row):
                continue
            result.append({
                headers[i]: (str(v).strip() if v is not None else '')
                for i, v in enumerate(row) if i < len(headers)
            })
        return result
    else:
        text = file_bytes.decode('utf-8-sig', errors='replace')
        # skip comment lines (IP India template note row)
        lines = [l for l in text.splitlines() if not l.strip().startswith('#')]
        cleaned = '\n'.join(lines)
        sep = ',' if cleaned.count(',') >= cleaned.count('\t') else '\t'
        reader = csv.DictReader(io.StringIO(cleaned), delimiter=sep)
        return [{_norm_col(k): (v.strip() if v else '') for k, v in row.items()} for row in reader]


def _pick(row: dict, *keys: str, default: str = '') -> str:
    for k in keys:
        v = row.get(_norm_col(k), '')
        if v and str(v).lower() not in ('none', 'null', 'n/a', '-', ''):
            return str(v)
    return default


def _parse_date(val: str) -> Optional[datetime]:
    if not val:
        return None
    for fmt in ('%d/%m/%Y', '%Y-%m-%d', '%d-%m-%Y', '%m/%d/%Y', '%d.%m.%Y', '%Y/%m/%d'):
        try:
            return datetime.strptime(val, fmt)
        except ValueError:
            continue
    return None


def _get_phonetic(name: str) -> str:
    try:
        import phonetics
        return phonetics.metaphone(name)
    except Exception:
        return name.upper()[:50]


# ── Stats ────────────────────────────────────────────────────────────────────

@router.get("/stats")
def import_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_superuser),
):
    return {
        "trademark": db.query(TrademarkRegistry).count(),
        "market":    db.query(MarketBrand).count(),
        "epharmacy": db.query(EPharmacyBrand).count(),
    }


# ── Template downloads ───────────────────────────────────────────────────────

_TEMPLATES = {
    "trademark": {
        "filename": "ip_india_trademark_template.csv",
        "note": (
            "IP India export column mapping: "
            "'Application No.' -> application_no | "
            "'TM Applied For' -> brand_name | "
            "'Proprietor Name' -> owner | "
            "'Current Status' -> status | "
            "'Valid Upto' -> expiry_date | "
            "'Date of Application' -> registration_date"
        ),
        "headers": [
            "application_no", "brand_name", "therapeutic_area", "drug_class",
            "active_ingredient", "owner", "country", "status",
            "registration_date", "expiry_date",
        ],
        "example": [
            "IN-TM-0001", "Brandex", "Pain & Fever", "Analgesic/Antipyretic",
            "Paracetamol", "Micro Labs Ltd.", "India", "registered",
            "01/01/2020", "01/01/2030",
        ],
    },
    "market": {
        "filename": "cdsco_market_template.csv",
        "note": (
            "CDSCO export column mapping: "
            "'Drug Name' or 'Trade Name' -> brand_name | "
            "'Firm Name' -> manufacturer | "
            "'Generic Name' or 'Composition' -> active_ingredient | "
            "'Therapeutic Category' -> therapeutic_area"
        ),
        "headers": [
            "brand_name", "manufacturer", "therapeutic_area", "drug_class",
            "active_ingredient", "country", "launch_year",
        ],
        "example": [
            "Dolo 650", "Micro Labs Ltd.", "Pain & Fever", "Analgesic/Antipyretic",
            "Paracetamol", "India", "2001",
        ],
    },
    "epharmacy": {
        "filename": "epharmacy_template.csv",
        "note": "Platforms: 1mg, PharmEasy, Netmeds, Apollo, MedPlus",
        "headers": [
            "brand_name", "platform", "manufacturer", "therapeutic_area",
            "active_ingredient", "price_inr", "availability", "rating", "review_count",
        ],
        "example": [
            "Dolo 650", "1mg", "Micro Labs Ltd.", "Pain & Fever",
            "Paracetamol", "30.00", "available", "4.8", "52000",
        ],
    },
}


@router.get("/template/{data_type}")
def download_template(
    data_type: str,
    current_user: User = Depends(require_superuser),
):
    if data_type not in _TEMPLATES:
        raise HTTPException(404, f"Unknown type '{data_type}'. Use: trademark, market, epharmacy")

    t = _TEMPLATES[data_type]
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["# " + t["note"]])
    writer.writerow(t["headers"])
    writer.writerow(t["example"])

    return StreamingResponse(
        io.BytesIO(output.getvalue().encode('utf-8-sig')),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{t["filename"]}"'},
    )


# ── Clear table ──────────────────────────────────────────────────────────────

@router.delete("/{data_type}")
def clear_table(
    data_type: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_superuser),
):
    model_map = {
        "trademark": TrademarkRegistry,
        "market":    MarketBrand,
        "epharmacy": EPharmacyBrand,
    }
    if data_type not in model_map:
        raise HTTPException(404, f"Unknown type '{data_type}'")
    deleted = db.query(model_map[data_type]).delete()
    db.commit()
    return {"deleted": deleted, "type": data_type}


# ── Trademark import (IP India format) ──────────────────────────────────────

@router.post("/trademark")
async def import_trademark(
    file: UploadFile = File(...),
    clear_existing: bool = Query(False, description="Wipe table before import"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_superuser),
):
    """
    Upload IP India trademark export (CSV or .xlsx).

    Recognised columns (case-insensitive, any order):
    - brand_name / tm_applied_for / trade_name / name
    - application_no / registration_number / reg_no
    - owner / proprietor / proprietor_name / applicant / company
    - therapeutic_area / class / category
    - drug_class / class
    - active_ingredient / generic_name / composition / molecule
    - country  (default: India)
    - status / current_status  (default: registered)
    - registration_date / date_of_application / filing_date  (dd/mm/yyyy)
    - expiry_date / valid_upto  (dd/mm/yyyy)
    """
    data = _parse_file(await file.read(), file.filename or 'upload.csv')
    if not data:
        raise HTTPException(400, "File is empty or could not be parsed")

    if clear_existing:
        db.query(TrademarkRegistry).delete()
        db.commit()

    existing_reg = {
        r[0] for r in
        db.query(TrademarkRegistry.registration_number)
          .filter(TrademarkRegistry.registration_number.isnot(None)).all()
    }
    existing_names = {r[0].lower() for r in db.query(TrademarkRegistry.brand_name).all()}

    inserted, skipped, errors = 0, 0, []
    BATCH = 500

    for i, row in enumerate(data, start=2):
        try:
            brand = _pick(row, 'brand_name', 'tm_applied_for', 'trade_name', 'name', 'drug_name')
            if not brand or len(brand) < 2:
                skipped += 1
                continue

            reg_no = _pick(row, 'application_no', 'application_number',
                           'registration_number', 'reg_no') or None

            if reg_no and reg_no in existing_reg:
                skipped += 1
                continue
            if not reg_no and brand.lower() in existing_names:
                skipped += 1
                continue

            db.add(TrademarkRegistry(
                brand_name=brand,
                normalized_name=brand.lower(),
                registration_number=reg_no,
                owner=_pick(row, 'owner', 'proprietor', 'proprietor_name',
                            'applicant', 'company', 'manufacturer') or 'Unknown',
                therapeutic_area=_pick(row, 'therapeutic_area', 'class',
                                       'category', 'drug_class') or None,
                drug_class=_pick(row, 'drug_class', 'class', 'category') or None,
                active_ingredient=_pick(row, 'active_ingredient', 'generic_name',
                                        'composition', 'molecule') or None,
                country=_pick(row, 'country', default='India'),
                status=(_pick(row, 'status', 'current_status',
                              default='registered') or 'registered').lower()[:50],
                registration_date=_parse_date(
                    _pick(row, 'registration_date', 'date_of_application', 'filing_date')),
                expiry_date=_parse_date(_pick(row, 'expiry_date', 'valid_upto', 'expiry')),
                phonetic_code=_get_phonetic(brand),
            ))

            if reg_no:
                existing_reg.add(reg_no)
            existing_names.add(brand.lower())
            inserted += 1

            if inserted % BATCH == 0:
                db.commit()

        except Exception as exc:
            errors.append(f"Row {i}: {exc}")

    db.commit()
    return {
        "type": "trademark",
        "inserted": inserted,
        "skipped": skipped,
        "errors": errors[:20],
        "total_rows": len(data),
    }


# ── Market brands import (CDSCO format) ─────────────────────────────────────

@router.post("/market")
async def import_market(
    file: UploadFile = File(...),
    clear_existing: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_superuser),
):
    """
    Upload CDSCO drug list or any market brand CSV/.xlsx.

    Recognised columns:
    - brand_name / drug_name / trade_name / name
    - manufacturer / firm_name / company / manufacturer_name
    - therapeutic_area / therapeutic_category / category
    - active_ingredient / generic_name / composition / molecule
    - drug_class / class / category
    - country  (default: India)
    - launch_year / year
    """
    data = _parse_file(await file.read(), file.filename or 'upload.csv')
    if not data:
        raise HTTPException(400, "File is empty or could not be parsed")

    if clear_existing:
        db.query(MarketBrand).delete()
        db.commit()

    existing = {
        (r[0].lower(), (r[1] or '').lower())
        for r in db.query(MarketBrand.brand_name, MarketBrand.manufacturer).all()
    }

    inserted, skipped, errors = 0, 0, []

    for i, row in enumerate(data, start=2):
        try:
            brand = _pick(row, 'brand_name', 'drug_name', 'trade_name', 'name')
            if not brand or len(brand) < 2:
                skipped += 1
                continue

            mfr = _pick(row, 'manufacturer', 'firm_name', 'company',
                        'manufacturer_name', default='Unknown')

            if (brand.lower(), mfr.lower()) in existing:
                skipped += 1
                continue

            year_str = _pick(row, 'launch_year', 'year')
            try:
                year = int(year_str) if year_str else None
            except ValueError:
                year = None

            db.add(MarketBrand(
                brand_name=brand,
                normalized_name=brand.lower(),
                manufacturer=mfr,
                therapeutic_area=_pick(row, 'therapeutic_area',
                                       'therapeutic_category', 'category') or None,
                drug_class=_pick(row, 'drug_class', 'class', 'category') or None,
                active_ingredient=_pick(row, 'active_ingredient', 'generic_name',
                                        'composition', 'molecule') or None,
                country=_pick(row, 'country', default='India'),
                launch_year=year,
                phonetic_code=_get_phonetic(brand),
            ))

            existing.add((brand.lower(), mfr.lower()))
            inserted += 1

            if inserted % 500 == 0:
                db.commit()

        except Exception as exc:
            errors.append(f"Row {i}: {exc}")

    db.commit()
    return {
        "type": "market",
        "inserted": inserted,
        "skipped": skipped,
        "errors": errors[:20],
        "total_rows": len(data),
    }


# ── E-Pharmacy import ────────────────────────────────────────────────────────

@router.post("/epharmacy")
async def import_epharmacy(
    file: UploadFile = File(...),
    clear_existing: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_superuser),
):
    """
    Upload e-pharmacy brand listing CSV/.xlsx.

    Recognised columns:
    - brand_name / drug_name / trade_name / name
    - platform  (1mg, PharmEasy, Netmeds, Apollo, MedPlus)
    - manufacturer / company / mfr
    - therapeutic_area / category / therapeutic_category
    - active_ingredient / generic_name / composition
    - price_inr / price / mrp / price_rs
    - availability  (default: available)
    - rating / stars
    - review_count / reviews / no_of_reviews
    """
    data = _parse_file(await file.read(), file.filename or 'upload.csv')
    if not data:
        raise HTTPException(400, "File is empty or could not be parsed")

    if clear_existing:
        db.query(EPharmacyBrand).delete()
        db.commit()

    existing = {
        (r[0].lower(), (r[1] or '').lower())
        for r in db.query(EPharmacyBrand.brand_name, EPharmacyBrand.platform).all()
    }

    inserted, skipped, errors = 0, 0, []

    for i, row in enumerate(data, start=2):
        try:
            brand = _pick(row, 'brand_name', 'drug_name', 'trade_name', 'name')
            if not brand or len(brand) < 2:
                skipped += 1
                continue

            platform = _pick(row, 'platform', 'website', 'source', default='Unknown')

            if (brand.lower(), platform.lower()) in existing:
                skipped += 1
                continue

            try:
                price = float(_pick(row, 'price_inr', 'price', 'mrp', 'price_rs') or 0) or None
            except ValueError:
                price = None

            try:
                rating = float(_pick(row, 'rating', 'stars') or 0) or None
            except ValueError:
                rating = None

            try:
                reviews = int(_pick(row, 'review_count', 'reviews', 'no_of_reviews') or 0)
            except ValueError:
                reviews = 0

            db.add(EPharmacyBrand(
                brand_name=brand,
                normalized_name=brand.lower(),
                platform=platform,
                manufacturer=_pick(row, 'manufacturer', 'company', 'mfr') or None,
                therapeutic_area=_pick(row, 'therapeutic_area', 'category',
                                       'therapeutic_category') or None,
                active_ingredient=_pick(row, 'active_ingredient', 'generic_name',
                                        'composition', 'molecule') or None,
                price_inr=price,
                availability=_pick(row, 'availability', 'stock', default='available'),
                rating=rating,
                review_count=reviews,
                country='India',
                phonetic_code=_get_phonetic(brand),
            ))

            existing.add((brand.lower(), platform.lower()))
            inserted += 1

            if inserted % 500 == 0:
                db.commit()

        except Exception as exc:
            errors.append(f"Row {i}: {exc}")

    db.commit()
    return {
        "type": "epharmacy",
        "inserted": inserted,
        "skipped": skipped,
        "errors": errors[:20],
        "total_rows": len(data),
    }
