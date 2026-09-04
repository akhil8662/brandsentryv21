import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.brand import GeneratedBrandName


class BrandRepository:
    def __init__(self, db: Session):
        self.db = db

    def save_generated_names(self, names: List[dict]) -> List[GeneratedBrandName]:
        saved = []
        valid_cols = {c.name for c in GeneratedBrandName.__table__.columns}
        for data in names:
            clean_data = {k: v for k, v in data.items() if k in valid_cols}
            obj = GeneratedBrandName(**clean_data)
            try:
                self.db.add(obj)
                self.db.commit()
                self.db.refresh(obj)
                saved.append(obj)
            except Exception:
                self.db.rollback()
        return saved


    def get_generated_names(
        self, user_id: Optional[uuid.UUID] = None, limit: int = 50, case_id: Optional[str] = None,
    ) -> List[GeneratedBrandName]:
        query = self.db.query(GeneratedBrandName)
        if user_id:
            query = query.filter(GeneratedBrandName.user_id == user_id)
        if case_id:
            clean_case = case_id.strip()
            query = query.filter(func.lower(func.trim(GeneratedBrandName.case_id)) == clean_case.lower())
        return query.order_by(GeneratedBrandName.created_at.desc()).limit(limit).all()

    def get_all_generated_names(self) -> List[GeneratedBrandName]:
        """Every name this system has ever generated, across all users/cases —
        used as an additional uniqueness check so the LLM isn't asked to
        re-invent (and risk re-suggesting) a name it already produced before."""
        return self.db.query(GeneratedBrandName).all()

    def get_latest_by_generated_name(
        self, brand_name: str, max_age_days: Optional[int] = None,
    ) -> Optional[GeneratedBrandName]:
        """Most recent AI Name Generator record for this exact name
        (case-insensitive), used by Compare's DB-first history check —
        mirrors ScreeningRepository.get_latest_by_name's freshness semantics."""
        query = self.db.query(GeneratedBrandName).filter(
            func.lower(GeneratedBrandName.generated_name) == brand_name.lower()
        )
        if max_age_days is not None:
            cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
            query = query.filter(GeneratedBrandName.created_at >= cutoff)
        return query.order_by(GeneratedBrandName.created_at.desc()).first()

