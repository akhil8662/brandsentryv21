import tempfile
import logging
import os
from typing import Any, Optional
import diskcache
from app.core.config import settings

logger = logging.getLogger(__name__)

# Initialize pure Python DiskCache
cache_dir = os.path.abspath(getattr(settings, "CACHE_DIR", None) or os.path.join(tempfile.gettempdir(), "brandsentry_cache"))
os.makedirs(cache_dir, exist_ok=True)

try:
    _disk_cache = diskcache.Cache(cache_dir)
    logger.info("[DISKCACHE] Initialized pure-Python persistent disk cache at '%s'", cache_dir)
except Exception as e:
    logger.warning("[DISKCACHE] Failed to initialize DiskCache (%s); falling back to RAM cache", e)
    _disk_cache = {}


class DiskCacheService:
    """Pure-Python Persistent Cache Service powered by diskcache.
    Provides sub-millisecond local caching with zero external servers:
      - Live E-Pharmacy scraped catalogs (TTL: 7 days)
      - Trademark and Market Database conflict pools (TTL: 1 hour)
      - Double Metaphone / Phonetic tokens
      - Web search API verifications (TTL: 30 days)
    """

    @staticmethod
    def get_json(key: str) -> Optional[Any]:
        try:
            if isinstance(_disk_cache, diskcache.Cache):
                return _disk_cache.get(key, default=None)
            return _disk_cache.get(key)
        except Exception as e:
            logger.warning("[DISKCACHE] Read error for key %s: %s", key, e)
            return None

    @staticmethod
    def set_json(key: str, value: Any, ttl_seconds: int = 86400) -> bool:
        try:
            if isinstance(_disk_cache, diskcache.Cache):
                _disk_cache.set(key, value, expire=ttl_seconds)
                return True
            else:
                _disk_cache[key] = value
                return True
        except Exception as e:
            logger.warning("[DISKCACHE] Write error for key %s: %s", key, e)
            return False

    @staticmethod
    def get_str(key: str) -> Optional[str]:
        return DiskCacheService.get_json(key)

    @staticmethod
    def set_str(key: str, value: str, ttl_seconds: int = 86400) -> bool:
        return DiskCacheService.set_json(key, value, ttl_seconds)

    @staticmethod
    def delete(key: str) -> bool:
        try:
            if isinstance(_disk_cache, diskcache.Cache):
                return _disk_cache.delete(key)
            return bool(_disk_cache.pop(key, None))
        except Exception:
            return False

    @staticmethod
    def clear() -> bool:
        try:
            if isinstance(_disk_cache, diskcache.Cache):
                _disk_cache.clear()
                return True
            _disk_cache.clear()
            return True
        except Exception:
            return False

    @staticmethod
    def is_healthy() -> bool:
        return isinstance(_disk_cache, diskcache.Cache)


cache_service = DiskCacheService()
