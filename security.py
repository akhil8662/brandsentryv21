from datetime import datetime, timedelta, timezone
from typing import Optional, Dict
import time
import uuid
import logging
import bcrypt
from jose import jwt, JWTError
from app.core.config import settings

logger = logging.getLogger(__name__)

# Pure Python in-memory token revocation store (jti -> expire_timestamp)
_revoked_tokens: Dict[str, float] = {}


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    # Embed unique JTI claim for server-side token revocation tracking (H-02)
    to_encode.setdefault("jti", str(uuid.uuid4()))
    to_encode.setdefault("type", "access")
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create long-lived refresh token (L-08)."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(days=getattr(settings, "REFRESH_TOKEN_EXPIRE_DAYS", 7))
    )
    to_encode.setdefault("jti", str(uuid.uuid4()))
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def revoke_token(jti: str, ttl_seconds: int = 3600) -> None:
    """Revoke a token by its JTI (H-02, L-08: DB-backed, multi-worker safe without Redis)."""
    if not jti:
        return
    now_ts = time.time()
    _revoked_tokens[jti] = now_ts + max(1, ttl_seconds)
    try:
        from app.core.database import SessionLocal
        from app.models.auth import RevokedToken
        now_utc = datetime.now(timezone.utc)
        expires_at = now_utc + timedelta(seconds=max(1, ttl_seconds))
        with SessionLocal() as db:
            existing = db.query(RevokedToken).filter(RevokedToken.jti == jti).first()
            if not existing:
                db.add(RevokedToken(jti=jti, revoked_at=now_utc, expires_at=expires_at))
            # Opportunistic cleanup of expired tokens
            db.query(RevokedToken).filter(RevokedToken.expires_at < now_utc).delete(synchronize_session=False)
            db.commit()
    except Exception as e:
        logger.warning("DB token revocation failed (%s), fallback to memory store", e)


def is_token_revoked(jti: str) -> bool:
    """Check if a JTI is blacklisted (H-02, L-08: DB-backed, multi-worker safe without Redis)."""
    if not jti:
        return False
    # Check fast local memory buffer first
    exp = _revoked_tokens.get(jti)
    if exp is not None:
        if exp > time.time():
            return True
        else:
            _revoked_tokens.pop(jti, None)
    # Check authoritative DB store
    try:
        from app.core.database import SessionLocal
        from app.models.auth import RevokedToken
        now_utc = datetime.now(timezone.utc)
        with SessionLocal() as db:
            token_record = db.query(RevokedToken).filter(
                RevokedToken.jti == jti,
                RevokedToken.expires_at > now_utc
            ).first()
            if token_record:
                _revoked_tokens[jti] = token_record.expires_at.replace(tzinfo=timezone.utc).timestamp()
                return True
    except Exception as e:
        logger.warning("DB token check failed (%s), relying on memory cache", e)
    return False
    exp = _revoked_tokens.get(jti)
    if exp is not None:
        if exp > time.time():
            return True
        else:
            _revoked_tokens.pop(jti, None)
    return False



def decode_token(token: str) -> Optional[dict]:
    """Decodes and validates JWT token, checking blacklist revocation (H-02)."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        jti = payload.get("jti")
        if jti and is_token_revoked(jti):
            logger.info("Rejected revoked token with jti=%s", jti)
            return None
        return payload
    except JWTError:
        return None

