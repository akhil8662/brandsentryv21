import uuid
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field


class ScreeningRequest(BaseModel):
    brand_name: str = Field(..., min_length=2, max_length=100)
    include_semantic: bool = True
    case_id: Optional[str] = Field(None, pattern=r"^[A-Za-z0-9_-]{1,30}$")



class SimilarNameSchema(BaseModel):
    id: uuid.UUID
    name: str
    similarity_type: str
    similarity_score: float
    source: str
    risk_level: Literal["LOW", "MEDIUM", "HIGH"]
    therapeutic_area: Optional[str] = None
    manufacturer: Optional[str] = None
    country: Optional[str] = None

    class Config:
        from_attributes = True


class ConflictSchema(BaseModel):
    id: uuid.UUID
    conflicting_name: str
    conflict_type: str
    source: str
    severity: Literal["LOW", "MEDIUM", "HIGH"]
    details: Optional[str] = None
    registration_number: Optional[str] = None
    owner: Optional[str] = None
    status: Optional[str] = None

    class Config:
        from_attributes = True


class ScreeningResultSchema(BaseModel):
    id: uuid.UUID
    brand_search_id: Optional[uuid.UUID] = None
    overall_risk_score: float
    risk_classification: Literal["LOW", "MEDIUM", "HIGH"]
    exact_match_score: float
    spelling_similarity_score: float
    phonetic_similarity_score: float
    semantic_similarity_score: float
    lookalike_score: float
    soundalike_score: float
    trademark_conflict_score: float
    market_presence_score: float
    # LLM-rated (see ai_service.rate_name_qualities), not part of the
    # deterministic screening pipeline itself — None (not a fabricated
    # number) only when no LLM is configured or the rating call failed.
    memorability_score: Optional[float] = None
    pronunciation_score: Optional[float] = None
    ai_assessment: Optional[str] = Field(None, max_length=10000)
    ai_recommendation: Optional[str] = None
    total_conflicts: int
    trademark_conflicts: int
    market_conflicts: int
    epharmacy_conflicts: int
    # Sequential-pipeline outcome (see brand_screening.py's
    # _gather_evidence) — stages_completed is how many of the pipeline's 3
    # stages actually ran; rejected_at_stage/rejected_stage_name/
    # rejection_reason are only set when a stage's own conflict stopped the
    # pipeline before later stages ran at all.
    stages_completed: Optional[int] = 3
    rejected_at_stage: Optional[int] = None
    rejected_stage_name: Optional[str] = None
    rejection_reason: Optional[str] = None
    similar_names: list[SimilarNameSchema] = []
    conflicts: list[ConflictSchema] = []
    created_at: datetime

    class Config:
        from_attributes = True


class BrandSearchResponse(BaseModel):
    id: uuid.UUID
    brand_name: str
    status: str
    screening_result: Optional[ScreeningResultSchema] = None
    created_at: datetime

    class Config:
        from_attributes = True


class CompareRequest(BaseModel):
    brand_name: str = Field(..., min_length=2, max_length=100)
    case_id: Optional[str] = Field(None, pattern=r"^[A-Za-z0-9_-]{1,30}$")



class CompareResultSchema(BrandSearchResponse):
    """Same shape the Compare screen already renders (BrandSearchResponse),
    plus where this particular result came from — a DB-first history hit or a
    freshly-run pipeline — so the frontend can skip the pipeline-progress
    animation for cached results and show a "from history" badge instead."""

    source: Literal["screening_history", "generator_history", "fresh_pipeline"]


class CompetitorEntrySchema(BaseModel):
    brand: str
    similarity_score: float
    market_presence: float
    trademark_status: str
    manufacturer: str
    therapeutic_area: str


class SimilarityBreakdownSchema(BaseModel):
    type: str
    count: int
    color: str


class RiskDistributionSchema(BaseModel):
    level: str
    count: int
    color: str


class TrendDataPointSchema(BaseModel):
    month: str
    trademark: float
    market: float
    epharmacy: float


class IntelligenceData(BaseModel):
    brand_name: str
    trademark_presence: float
    market_presence: float
    epharmacy_presence: float
    geographic_reach: int
    competitor_count: int
    market_saturation: float
    brand_uniqueness_score: float
    ai_summary: Optional[str] = None
    similar_brands: list[SimilarNameSchema] = []
    competitive_landscape: list[CompetitorEntrySchema] = []
    trend_data: list[TrendDataPointSchema] = []
    similarity_breakdown: list[SimilarityBreakdownSchema] = []
    risk_distribution: list[RiskDistributionSchema] = []
