import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, DateTime
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class TokenUsage(Base):
    """
    PostgreSQL-backed real Bedrock token usage tracking (L-29).
    Captures input_tokens and output_tokens from Bedrock Claude and Titan embeddings.
    """
    __tablename__ = "token_usage"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    feature_name = Column(String(100), nullable=False, index=True)
    model_id = Column(String(100), nullable=True)
    prompt_tokens = Column(Integer, default=0, nullable=False)
    completion_tokens = Column(Integer, default=0, nullable=False)
    total_tokens = Column(Integer, default=0, nullable=False)
    user_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
