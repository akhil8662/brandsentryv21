import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text, Uuid
from app.core.database import Base


class WhoInnRegistry(Base):
    """Tier-1 local cache of WHO International Nonproprietary Names.

    Populated by bulk-uploading the Trade Marks Registry (India) "List of
    International Non Proprietary Names (INN)" PDF via
    POST /reference-data/who-inn/upload (see app/services/who_inn_import.py)
    — a fixed two-column template (name, WHO publication reference), parsed
    deterministically rather than guessed at. Each upload fully replaces the
    table's contents (per SDD: "held as local reference data, refreshed on a
    cycle, not a live per-candidate call").

    Until an upload has been run, app.services.external_apis.search_who_inn()
    hits the live ChEMBL mirror of the WHO INN list directly as a real,
    working substitute — see BrandScreeningService, which queries this table
    first and falls back to the live call. No fabricated rows are seeded
    here; an empty table means "not imported yet", never "no WHO INNs exist"
    (absence of evidence != evidence of absence).
    """
    __tablename__ = "who_inn_registry"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    inn_name = Column(String(255), nullable=False, index=True)
    normalized_name = Column(String(255), nullable=False, index=True)
    # Raw "W.H.O Publication Reference" cell from the source PDF, e.g.
    # "Vol,11No,3 1997,List 38" — kept verbatim since the source document
    # doesn't use one consistent citation format across its 60+ years of entries.
    who_publication_reference = Column(String(255), nullable=True)
    chembl_id = Column(String(50), nullable=True)
    molecule_type = Column(String(100), nullable=True)
    as_of_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class IqviaExtract(Base):
    """Tier-1 licensed IQVIA market-data extract. Empty until (a) a real
    periodic extract-import pipeline exists and (b) the client's IQVIA
    licence is confirmed (SDD §13.4 open point) — until then this table MUST
    NOT be represented as active coverage, and a no-match here reports as
    "not licensed / no data loaded", never as a clearance signal.
    """
    __tablename__ = "iqvia_extract"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    brand_name = Column(String(255), nullable=False, index=True)
    normalized_name = Column(String(255), nullable=False, index=True)
    composition = Column(String(300), nullable=True)
    manufacturer = Column(String(300), nullable=True)
    therapeutic_area = Column(String(150), nullable=True)
    country = Column(String(100), nullable=True)
    license_confirmed = Column(Boolean, nullable=False, default=False)
    as_of_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class RegisteredNotInUse(Base):
    """Tier-1 "Registered-but-Not-in-Use" trademark repository (SDD §6.1) —
    names formally registered/applied for at the Trade Marks Registry but not
    an actively marketed product. A live product wouldn't show up here (see
    IqviaExtract / e-pharmacy tiers for that); this table exists specifically
    to catch names that look "free" in the market but are still a real legal
    conflict on paper.

    Populated by bulk-uploading the registrar's own export (e.g. the
    "Un-used TradeMarks List" workbook) via
    POST /reference-data/registered-not-in-use/upload — see
    app/services/tabular_import.py. Storage only for now: not yet wired into
    the Brand Analysis screening pipeline.
    """
    __tablename__ = "registered_not_in_use"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    brand_name = Column(String(255), nullable=False, index=True)
    normalized_name = Column(String(255), nullable=False, index=True)
    trademark_class = Column(Integer, nullable=True)
    application_number = Column(String(50), nullable=True, index=True)
    application_date = Column(DateTime, nullable=True)
    status = Column(String(100), nullable=True)
    valid_till = Column(DateTime, nullable=True)
    remarks = Column(Text, nullable=True)
    as_of_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class InternationalMarketBrand(Base):
    """Tier-1 "International Markets" repository (SDD §6.1) — brand names
    already in use for a given molecule in overseas markets, relevant when a
    domestically "clear" name would still collide with an existing
    international brand for that same active ingredient.

    Populated by bulk-uploading an overseas brand-name search export (e.g.
    the "Overseas Brand-Names Searched" workbook) via
    POST /reference-data/international-market/upload — see
    app/services/tabular_import.py. Storage only for now: not yet wired into
    the Brand Analysis screening pipeline. `country` is nullable because the
    source export doesn't break results out by country.
    """
    __tablename__ = "international_market_brands"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    brand_name = Column(String(255), nullable=False, index=True)
    normalized_name = Column(String(255), nullable=False, index=True)
    active_ingredient = Column(String(300), nullable=True, index=True)
    country = Column(String(100), nullable=True)
    as_of_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
