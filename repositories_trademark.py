from typing import List
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from app.models.brand import MarketBrand, TrademarkRegistry


class TrademarkRepository:
    """Read access to the Tier-1 registry/market reference tables. Both are
    empty until a real registry-import pipeline exists (see model docstrings) —
    callers must treat an empty result as "not loaded yet", never as a
    clearance signal."""

    def __init__(self, db: Session):
        self.db = db

    
    def find_candidate_trademarks(self, brand_name: str, limit: int = 100) -> List[TrademarkRegistry]:
        """SQL-level candidate filtering with bounded limit to prevent full-table loads (H-12)."""
        if not brand_name or not brand_name.strip():
            return []
        term = brand_name.strip()
        prefix = term[:3]
        return (
            self.db.query(TrademarkRegistry)
            .filter(
                or_(
                    TrademarkRegistry.brand_name.ilike(f"{prefix}%"),
                    TrademarkRegistry.brand_name.ilike(f"%{term}%"),
                )
            )
            .limit(limit)
            .all()
        )

    def find_candidate_market_brands(self, brand_name: str, limit: int = 100) -> List[MarketBrand]:
        """SQL-level candidate filtering with bounded limit to prevent full-table loads (H-12)."""
        if not brand_name or not brand_name.strip():
            return []
        term = brand_name.strip()
        prefix = term[:3]
        return (
            self.db.query(MarketBrand)
            .filter(
                or_(
                    MarketBrand.brand_name.ilike(f"{prefix}%"),
                    MarketBrand.brand_name.ilike(f"%{term}%"),
                )
            )
            .limit(limit)
            .all()
        )

    def get_all_trademarks(self, limit: int = 2500) -> List[TrademarkRegistry]:
        """Bounded retrieval of trademark registry rows to prevent full-table memory exhaustion (H-12)."""
        return self.db.query(TrademarkRegistry).limit(limit).all()

    def get_all_market_brands(self, limit: int = 2500) -> List[MarketBrand]:
        """Bounded retrieval of market brand rows to prevent full-table memory exhaustion (H-12)."""
        return self.db.query(MarketBrand).limit(limit).all()

    def get_all_epharmacy_brands(self, limit: int = 2500) -> List[MarketBrand]:
        """Bounded retrieval of e-pharmacy rows (H-12)."""
        return self.db.query(MarketBrand).limit(limit).all()


    def find_by_active_ingredient(self, ingredient: str) -> List[TrademarkRegistry]:
        if not ingredient or not ingredient.strip():
            return []
        needle = f"%{ingredient.strip().lower()}%"
        return (
            self.db.query(TrademarkRegistry)
            .filter(func.lower(TrademarkRegistry.active_ingredient).like(needle))
            .all()
        )

    def find_market_by_active_ingredient(self, ingredient: str) -> List[MarketBrand]:
        if not ingredient or not ingredient.strip():
            return []
        needle = f"%{ingredient.strip().lower()}%"
        return (
            self.db.query(MarketBrand)
            .filter(
                or_(
                    func.lower(MarketBrand.active_ingredient).like(needle),
                    func.lower(MarketBrand.brand_name).like(needle),
                )
            )
            .all()
        )
