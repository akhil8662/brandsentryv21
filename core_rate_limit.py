import time
import asyncio
import logging
from collections import defaultdict
from typing import Dict, List, Tuple
from fastapi import Request, HTTPException, status

logger = logging.getLogger(__name__)


def get_client_ip(request: Request) -> str:
    """Extract real client IP, inspecting X-Forwarded-For when behind a proxy (L-06)."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class SlidingWindowRateLimiter:
    """
    Thread-safe, PostgreSQL-backed sliding window rate limiter (H-15).
    Provides multi-worker, multi-replica distributed rate limiting without Redis.
    """

    def __init__(self):
        self._lock = asyncio.Lock()
        self._records: Dict[str, List[float]] = defaultdict(list)

    async def check_rate_limit(
        self, key: str, max_requests: int, window_seconds: int = 60
    ) -> Tuple[bool, int]:
        """
        Check if `key` exceeds `max_requests` within `window_seconds`.
        Queries PostgreSQL database table `rate_limit_hits` for cross-worker safety.
        Returns (is_allowed, retry_after_seconds).
        """
        now = time.time()
        cutoff = now - window_seconds

        # 1. Primary PostgreSQL database check (Multi-worker safe)
        try:
            from app.core.database import SessionLocal
            from app.models.rate_limit import RateLimitHit
            from sqlalchemy import func

            with SessionLocal() as db:
                # Prune hits older than cutoff for this key
                db.query(RateLimitHit).filter(
                    RateLimitHit.key == key,
                    RateLimitHit.timestamp < cutoff
                ).delete(synchronize_session=False)

                # Count hits in current window
                hit_count = db.query(func.count(RateLimitHit.id)).filter(
                    RateLimitHit.key == key,
                    RateLimitHit.timestamp >= cutoff
                ).scalar() or 0

                if hit_count >= max_requests:
                    oldest_hit = db.query(RateLimitHit.timestamp).filter(
                        RateLimitHit.key == key,
                        RateLimitHit.timestamp >= cutoff
                    ).order_by(RateLimitHit.timestamp.asc()).first()
                    oldest_ts = oldest_hit[0] if oldest_hit else cutoff
                    retry_after = max(1, int(oldest_ts + window_seconds - now))
                    db.commit()
                    return False, retry_after

                # Record new hit
                db.add(RateLimitHit(key=key, timestamp=now))
                db.commit()
                return True, 0
        except Exception as e:
            logger.warning("DB rate limiter check error (%s); falling back to in-memory check", e)

        # 2. In-memory fallback if DB is temporarily unreachable
        async with self._lock:
            timestamps = self._records[key]
            self._records[key] = [t for t in timestamps if t > cutoff]

            if len(self._records[key]) >= max_requests:
                oldest = self._records[key][0]
                retry_after = max(1, int(oldest + window_seconds - now))
                return False, retry_after

            self._records[key].append(now)
            return True, 0


# Global shared rate limiter instance
limiter = SlidingWindowRateLimiter()


def rate_limit(max_requests: int = 10, window_seconds: int = 60, by_ip: bool = False):
    """
    FastAPI dependency to rate limit endpoints.
    Supports client IP (handling X-Forwarded-For) or authenticated user ID.
    """
    async def dependency(request: Request):
        client_ip = get_client_ip(request)
        if by_ip:
            key = f"ip:{client_ip}:{request.url.path}"
        else:
            # Try to get user identifier or fallback to IP
            auth_header = request.headers.get("Authorization", "")
            cookie_token = request.cookies.get("access_token", "")
            key_id = auth_header or cookie_token or client_ip
            key = f"user:{key_id}:{request.url.path}"

        allowed, retry_after = await limiter.check_rate_limit(
            key, max_requests=max_requests, window_seconds=window_seconds
        )

        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded. Try again in {retry_after} seconds.",
                headers={"Retry-After": str(retry_after)},
            )

    return dependency

