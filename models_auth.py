from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime
from app.core.database import Base


class RevokedToken(Base):
    """PostgreSQL-backed JWT revocation store (H-02, L-08).
    Provides multi-worker, multi-replica distributed token blacklisting
    without requiring Redis."""

    __tablename__ = "revoked_tokens"

    jti = Column(String(64), primary_key=True, index=True)
    revoked_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)
