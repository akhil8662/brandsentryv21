import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.models.reference_data import (
    InternationalMarketBrand, IqviaExtract, RegisteredNotInUse, WhoInnRegistry,
)
from app.models.screening import BrandSearch, ScreeningConflict, ScreeningResult, SimilarBrandName


class ScreeningRepository:
    """Persistence for brand-analysis screening runs, plus read access to the
    Tier-1 WHO INN / IQVIA local reference tables. Both reference tables are
    empty until their respective import pipelines exist (see model
    docstrings) — an empty result must be treated as "not loaded yet", never
    as a clearance signal."""

    def __init__(self, db: Session):
        self.db = db

    def create_search(
        self, brand_name: str, user_id: Optional[uuid.UUID], case_id: Optional[str] = None,
    ) -> BrandSearch:
        search = BrandSearch(brand_name=brand_name, user_id=user_id, status="completed", case_id=case_id)
        self.db.add(search)
        self.db.commit()
        self.db.refresh(search)
        return search

    def list_by_case_id(self, case_id: str) -> List[BrandSearch]:
        clean = (case_id or "").strip()
        return (
            self.db.query(BrandSearch)
            .options(
                joinedload(BrandSearch.screening_result).joinedload(ScreeningResult.similar_names),
                joinedload(BrandSearch.screening_result).joinedload(ScreeningResult.conflicts),
            )
            .filter(func.lower(func.trim(BrandSearch.case_id)) == clean.lower())
            .order_by(BrandSearch.created_at.desc())
            .all()
        )

    def save_result(
        self,
        brand_search_id: uuid.UUID,
        result: dict,
        similar_names: List[dict],
        conflicts: List[dict],
    ) -> ScreeningResult:
        screening_result = ScreeningResult(brand_search_id=brand_search_id, **result)
        self.db.add(screening_result)
        self.db.flush()  # assign screening_result.id before children reference it

        for sn in similar_names:
            self.db.add(SimilarBrandName(screening_result_id=screening_result.id, **sn))
        for c in conflicts:
            self.db.add(ScreeningConflict(screening_result_id=screening_result.id, **c))

        self.db.commit()
        self.db.refresh(screening_result)
        return screening_result

    def get_by_search_id(self, search_id: uuid.UUID) -> Optional[BrandSearch]:
        return (
            self.db.query(BrandSearch)
            .options(
                joinedload(BrandSearch.screening_result).joinedload(ScreeningResult.similar_names),
                joinedload(BrandSearch.screening_result).joinedload(ScreeningResult.conflicts),
            )
            .filter(BrandSearch.id == search_id)
            .first()
        )

    def get_latest_by_name(self, brand_name: str, max_age_days: Optional[int] = None) -> Optional[BrandSearch]:
        """Most recent completed screening for this exact name (case-insensitive),
        used by Compare's DB-first history check. Inner-joins ScreeningResult so a
        BrandSearch row left orphaned by a failed save_result() (status stuck at
        "completed" with no result) is never returned as a usable hit.

        `created_at` is written via `datetime.now(timezone.utc)` into a plain
        DateTime column (no timezone=True) — both SQLite and Postgres drop the
        tzinfo on write but keep the UTC wall-clock value, so a UTC cutoff
        computed with `datetime.now(timezone.utc)` compares correctly against it.

        """
        query = (
            self.db.query(BrandSearch)
            .join(ScreeningResult, ScreeningResult.brand_search_id == BrandSearch.id)
            .options(
                joinedload(BrandSearch.screening_result).joinedload(ScreeningResult.similar_names),
                joinedload(BrandSearch.screening_result).joinedload(ScreeningResult.conflicts),
            )
            .filter(func.lower(BrandSearch.brand_name) == brand_name.lower())
        )
        if max_age_days is not None:
            cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
            query = query.filter(BrandSearch.created_at >= cutoff)
        return query.order_by(BrandSearch.created_at.desc()).first()


    def find_who_inn_local(self, name: str) -> List[WhoInnRegistry]:
        clean = (name or "").strip().lower()
        if not clean:
            return []
        needle = f"%{clean}%"
        # 1. Exact or Substring Match
        results = (
            self.db.query(WhoInnRegistry)
            .filter(
                (func.lower(WhoInnRegistry.normalized_name).like(needle)) |
                (func.lower(WhoInnRegistry.inn_name).like(needle))
            )
            .all()
        )
        seen_ids = {r.id for r in results}

        # 2. Phonetic Root & Prefix Matches (first 4 chars + common phonetic substitutions)
        p = clean[:min(4, len(clean))]
        prefixes = {p}
        prefixes.add(p.replace('y', 'i'))
        prefixes.add(p.replace('i', 'y'))
        if p.startswith('ce'): prefixes.add('se' + p[2:])
        elif p.startswith('se'): prefixes.add('ce' + p[2:])
        if p.startswith('ci'): prefixes.add('si' + p[2:])
        elif p.startswith('si'): prefixes.add('ci' + p[2:])
        if p.startswith('ph'): prefixes.add('f' + p[2:])
        elif p.startswith('f'): prefixes.add('ph' + p[1:])
        if p.startswith('z'): prefixes.add('s' + p[1:])
        elif p.startswith('s'): prefixes.add('z' + p[1:])

        for prefix in prefixes:
            if len(prefix) >= 3:
                prefix_results = (
                    self.db.query(WhoInnRegistry)
                    .filter(func.lower(WhoInnRegistry.normalized_name).like(f"{prefix}%"))
                    .limit(50)
                    .all()
                )
                for r in prefix_results:
                    if r.id not in seen_ids:
                        results.append(r)
                        seen_ids.add(r.id)
        return results

    def find_iqvia_local(self, name: str) -> List[IqviaExtract]:
        clean = (name or "").strip().lower()
        if not clean:
            return []
        needle = f"%{clean}%"
        results = (
            self.db.query(IqviaExtract)
            .filter(func.lower(IqviaExtract.normalized_name).like(needle))
            .all()
        )
        seen_ids = {r.id for r in results}

        p = clean[:min(4, len(clean))]
        prefixes = {p}
        prefixes.add(p.replace('y', 'i'))
        prefixes.add(p.replace('i', 'y'))
        if p.startswith('ce'): prefixes.add('se' + p[2:])
        elif p.startswith('se'): prefixes.add('ce' + p[2:])
        if p.startswith('ci'): prefixes.add('si' + p[2:])
        elif p.startswith('si'): prefixes.add('ci' + p[2:])
        if p.startswith('ph'): prefixes.add('f' + p[2:])
        elif p.startswith('f'): prefixes.add('ph' + p[1:])
        if p.startswith('z'): prefixes.add('s' + p[1:])
        elif p.startswith('s'): prefixes.add('z' + p[1:])

        for prefix in prefixes:
            if len(prefix) >= 3:
                prefix_results = (
                    self.db.query(IqviaExtract)
                    .filter(func.lower(IqviaExtract.normalized_name).like(f"{prefix}%"))
                    .limit(50)
                    .all()
                )
                for r in prefix_results:
                    if r.id not in seen_ids:
                        results.append(r)
                        seen_ids.add(r.id)
        return results

    def iqvia_row_count(self) -> int:
        return self.db.query(IqviaExtract).count()

    def who_inn_row_count(self) -> int:
        return self.db.query(WhoInnRegistry).count()

    def replace_all_who_inn(self, rows: List[dict]) -> int:
        """Fully replaces the WHO INN table's contents with `rows` in one
        transaction — matches the SDD's "refreshed on a cycle" model for
        this Tier-1 reference table rather than an incremental upsert, since
        the source PDF is a full list snapshot each time, not a diff."""
        self.db.query(WhoInnRegistry).delete()
        for row in rows:
            self.db.add(WhoInnRegistry(**row))
        self.db.commit()
        return len(rows)

    def registered_not_in_use_row_count(self) -> int:
        return self.db.query(RegisteredNotInUse).count()

    def international_market_row_count(self) -> int:
        return self.db.query(InternationalMarketBrand).count()

    def replace_all_registered_not_in_use(self, rows: List[dict]) -> int:
        self.db.query(RegisteredNotInUse).delete()
        for row in rows:
            self.db.add(RegisteredNotInUse(**row))
        self.db.commit()
        return len(rows)

    def replace_all_international_market(self, rows: List[dict]) -> int:
        self.db.query(InternationalMarketBrand).delete()
        for row in rows:
            self.db.add(InternationalMarketBrand(**row))
        self.db.commit()
        return len(rows)
