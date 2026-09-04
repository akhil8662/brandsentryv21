import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, JSON, String, Text, UniqueConstraint, Uuid
from app.core.database import Base


class GeneratedBrandName(Base):
    __tablename__ = "generated_brand_names"
    __table_args__ = (
        UniqueConstraint("generated_name", "user_id", "case_id", name="uq_generated_name_user_case"),
    )

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)


    # Human-readable business reference of the Suggestion Form case this
    # generation was requested for, if any. Not a hard FK — the frontend still
    # saves cases to localStorage rather than the backend's own
    # brand_suggestion_forms table, so a matching row may not exist server-side.
    case_id = Column(String(30), nullable=True, index=True)
    # Full structured suggestion_form payload (or flat molecule/therapeutic_area/
    # etc. criteria) that produced this name, snapshotted at generation time so
    # the input is traceable even if the source case is edited/deleted later.
    request_snapshot = Column(JSON, nullable=True)

    generated_name = Column(String(255), nullable=False)
    molecule = Column(String(255), nullable=True)
    therapeutic_area = Column(String(255), nullable=True)
    geography = Column(String(255), nullable=True)
    product_attributes = Column(Text, nullable=True)
    naming_style = Column(String(100), nullable=True)

    risk_score = Column(Float, nullable=False, default=0.0)
    availability_score = Column(Float, nullable=False, default=100.0)
    memorability_score = Column(Float, nullable=False, default=0.0)
    pronunciation_score = Column(Float, nullable=False, default=0.0)
    recommendation_status = Column(String(50), nullable=False, default="review_required")

    ai_explanation = Column(Text, nullable=True)
    phonetic_analysis = Column(Text, nullable=True)
    semantic_analysis = Column(Text, nullable=True)
    trademark_availability = Column(String(50), nullable=True)
    conflict_details = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class TrademarkRegistry(Base):
    """Tier-1 registered-brand reference data. Empty until a real registry
    import (IP India / CDSCO extract) is built — a separate, larger feature.
    No fabricated rows are seeded here; an empty table means "no data loaded
    yet", never "nothing exists" (absence of evidence != evidence of absence).
    """
    __tablename__ = "trademark_registry"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    brand_name = Column(String(255), nullable=False, index=True)
    normalized_name = Column(String(255), nullable=False, index=True)
    registration_number = Column(String(100), nullable=True)
    owner = Column(String(300), nullable=True)
    therapeutic_area = Column(String(150), nullable=True)
    active_ingredient = Column(String(300), nullable=True, index=True)
    country = Column(String(100), nullable=True, default="India")
    status = Column(String(50), nullable=True, default="registered")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class MarketBrand(Base):
    """Tier-1 marketed-brand reference data (CDSCO/market extract). Empty
    until a real import pipeline exists — see TrademarkRegistry docstring."""
    __tablename__ = "market_brands"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    brand_name = Column(String(255), nullable=False, index=True)
    normalized_name = Column(String(255), nullable=False, index=True)
    manufacturer = Column(String(300), nullable=True)
    therapeutic_area = Column(String(150), nullable=True)
    active_ingredient = Column(String(300), nullable=True, index=True)
    dosage_form = Column(String(100), nullable=True)
    country = Column(String(100), nullable=True)
    is_generic = Column(Boolean, nullable=True, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
