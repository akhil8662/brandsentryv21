from sqlalchemy import Column, Integer, String, Float, Index
from app.core.database import Base


class RateLimitHit(Base):
    """PostgreSQL-backed distributed rate limit store (H-15).
    Provides multi-worker, multi-replica sliding window rate limiting
    without requiring Redis."""

    __tablename__ = "rate_limit_hits"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(255), nullable=False, index=True)
    timestamp = Column(Float, nullable=False, index=True)

    __table_args__ = (
        Index("ix_rate_limit_key_ts", "key", "timestamp"),
    )
