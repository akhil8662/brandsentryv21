from typing import Literal, Optional
from datetime import datetime
import uuid
from pydantic import BaseModel


class UploadResponse(BaseModel):
    rows_imported: int
    message: str


# Backwards-compatible alias used by the WHO INN upload route.
WhoInnUploadResponse = UploadResponse


class ReferenceDataStatus(BaseModel):
    who_inn_row_count: int
    iqvia_row_count: int
    registered_not_in_use_row_count: int
    international_market_row_count: int


DataSourceId = Literal["who_inn", "iqvia", "epharmacy", "google_search"]


class DataSourceStatus(BaseModel):
    id: DataSourceId
    name: str
    category: str
    description: str
    enabled: bool
    connected: bool
    detail: str


class DataSourceToggleRequest(BaseModel):
    enabled: bool


class DataSourceListResponse(BaseModel):
    sources: list[DataSourceStatus]


# ---------------------------------------------------------------------------
# Master Data Schemas — WHO INN Registry
# ---------------------------------------------------------------------------

class WhoInnRecordCreate(BaseModel):
    inn_name: str
    who_publication_reference: Optional[str] = None
    chembl_id: Optional[str] = None
    molecule_type: Optional[str] = None


class WhoInnRecordUpdate(BaseModel):
    inn_name: Optional[str] = None
    who_publication_reference: Optional[str] = None
    chembl_id: Optional[str] = None
    molecule_type: Optional[str] = None


class WhoInnRecordResponse(BaseModel):
    id: uuid.UUID
    inn_name: str
    normalized_name: str
    who_publication_reference: Optional[str] = None
    chembl_id: Optional[str] = None
    molecule_type: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Master Data Schemas — International Markets
# ---------------------------------------------------------------------------

class InternationalMarketRecordCreate(BaseModel):
    brand_name: str
    active_ingredient: Optional[str] = None
    country: Optional[str] = None
    as_of_date: Optional[datetime] = None


class InternationalMarketRecordUpdate(BaseModel):
    brand_name: Optional[str] = None
    active_ingredient: Optional[str] = None
    country: Optional[str] = None
    as_of_date: Optional[datetime] = None


class InternationalMarketRecordResponse(BaseModel):
    id: uuid.UUID
    brand_name: str
    normalized_name: str
    active_ingredient: Optional[str] = None
    country: Optional[str] = None
    as_of_date: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Master Data Schemas — Registered but Not in Use
# ---------------------------------------------------------------------------

class RegisteredNotInUseRecordCreate(BaseModel):
    brand_name: str
    trademark_class: Optional[int] = None
    application_number: Optional[str] = None
    application_date: Optional[datetime] = None
    status: Optional[str] = None
    valid_till: Optional[datetime] = None
    remarks: Optional[str] = None
    as_of_date: Optional[datetime] = None


class RegisteredNotInUseRecordUpdate(BaseModel):
    brand_name: Optional[str] = None
    trademark_class: Optional[int] = None
    application_number: Optional[str] = None
    application_date: Optional[datetime] = None
    status: Optional[str] = None
    valid_till: Optional[datetime] = None
    remarks: Optional[str] = None
    as_of_date: Optional[datetime] = None


class RegisteredNotInUseRecordResponse(BaseModel):
    id: uuid.UUID
    brand_name: str
    normalized_name: str
    trademark_class: Optional[int] = None
    application_number: Optional[str] = None
    application_date: Optional[datetime] = None
    status: Optional[str] = None
    valid_till: Optional[datetime] = None
    remarks: Optional[str] = None
    as_of_date: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
