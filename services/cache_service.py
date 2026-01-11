"""
Document Fingerprinting and AI Result Caching Service

Provides:
- SHA256 document fingerprinting
- AI response caching (skips expensive Gemini calls for duplicate docs)
- Configurable cache expiry
- Thread-safe operations
"""

import hashlib
import json
import time
import os
import threading
from typing import Optional, Dict, Any, Tuple

CACHE_EXPIRY_SECONDS = 86400 * 7  # 7 days default
_cache: Dict[str, Dict[str, Any]] = {}
_cache_lock = threading.Lock()


def get_document_fingerprint(content: bytes | str) -> str:
    """Generate SHA256 fingerprint for document content"""
    if isinstance(content, str):
        content = content.encode('utf-8')
    return hashlib.sha256(content).hexdigest()


def get_cached_result(fingerprint: str, doc_type: str) -> Optional[Dict[str, Any]]:
    """
    Get cached AI extraction result for a document fingerprint.
    Thread-safe.
    
    Returns None if:
    - No cached result exists
    - Cache has expired
    """
    cache_key = f"{fingerprint}:{doc_type}"
    
    with _cache_lock:
        if cache_key not in _cache:
            return None
        
        cached = _cache[cache_key]
        
        if time.time() - cached.get('timestamp', 0) > CACHE_EXPIRY_SECONDS:
            del _cache[cache_key]
            return None
        
        return cached.get('result')


def set_cached_result(fingerprint: str, doc_type: str, result: Dict[str, Any]) -> None:
    """
    Cache AI extraction result for a document fingerprint.
    Thread-safe.
    """
    cache_key = f"{fingerprint}:{doc_type}"
    
    with _cache_lock:
        _cache[cache_key] = {
            'result': result,
            'timestamp': time.time(),
            'doc_type': doc_type
        }


def clear_cache() -> int:
    """Clear all cached results. Returns count of cleared items. Thread-safe."""
    with _cache_lock:
        count = len(_cache)
        _cache.clear()
        return count


def get_cache_stats() -> Dict[str, Any]:
    """Get cache statistics. Thread-safe."""
    now = time.time()
    
    with _cache_lock:
        valid_count = sum(1 for v in _cache.values() 
                          if now - v.get('timestamp', 0) <= CACHE_EXPIRY_SECONDS)
        total = len(_cache)
    
    return {
        'total_entries': total,
        'valid_entries': valid_count,
        'expired_entries': total - valid_count,
        'cache_expiry_hours': CACHE_EXPIRY_SECONDS / 3600
    }


def cleanup_expired() -> int:
    """Remove expired cache entries. Returns count of removed items. Thread-safe."""
    now = time.time()
    
    with _cache_lock:
        expired_keys = [k for k, v in _cache.items() 
                        if now - v.get('timestamp', 0) > CACHE_EXPIRY_SECONDS]
        
        for key in expired_keys:
            del _cache[key]
    
    return len(expired_keys)


class DocumentCache:
    """
    Database-backed document cache for persistence across restarts.
    Falls back to in-memory cache if database unavailable.
    Thread-safe operations.
    """
    
    def __init__(self):
        self._use_db = False
        self._db_lock = threading.Lock()
        self._init_attempted = False
    
    def _try_init_db(self):
        """Lazy initialization of database backend"""
        if self._init_attempted:
            return
        
        self._init_attempted = True
        try:
            from database import engine
            if engine:
                self._use_db = True
                self._ensure_table()
        except Exception as e:
            print(f"Cache DB init skipped: {e}")
    
    def _ensure_table(self):
        """Create cache table if it doesn't exist"""
        try:
            from database import engine
            from sqlalchemy import text
            
            with engine.begin() as conn:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS extraction_cache (
                        id SERIAL PRIMARY KEY,
                        fingerprint VARCHAR(64) NOT NULL,
                        doc_type VARCHAR(50) NOT NULL,
                        result JSONB NOT NULL,
                        created_at TIMESTAMP DEFAULT NOW(),
                        expires_at TIMESTAMP NOT NULL,
                        UNIQUE(fingerprint, doc_type)
                    )
                """))
                conn.execute(text("""
                    CREATE INDEX IF NOT EXISTS idx_cache_fingerprint 
                    ON extraction_cache(fingerprint, doc_type)
                """))
                conn.execute(text("""
                    CREATE INDEX IF NOT EXISTS idx_cache_expires 
                    ON extraction_cache(expires_at)
                """))
        except Exception as e:
            print(f"Cache table creation skipped: {e}")
            self._use_db = False
    
    def get(self, fingerprint: str, doc_type: str) -> Optional[Dict[str, Any]]:
        """Get cached result from database or memory. Thread-safe."""
        self._try_init_db()
        
        if self._use_db:
            with self._db_lock:
                try:
                    from database import engine
                    from sqlalchemy import text
                    
                    with engine.connect() as conn:
                        result = conn.execute(text("""
                            SELECT result FROM extraction_cache
                            WHERE fingerprint = :fp AND doc_type = :dt
                            AND expires_at > NOW()
                        """), {"fp": fingerprint, "dt": doc_type})
                        
                        row = result.fetchone()
                        if row:
                            return row[0]
                except Exception as e:
                    print(f"DB cache read error: {e}")
        
        return get_cached_result(fingerprint, doc_type)
    
    def set(self, fingerprint: str, doc_type: str, result: Dict[str, Any]) -> None:
        """Store result in database and memory. Thread-safe."""
        self._try_init_db()
        
        set_cached_result(fingerprint, doc_type, result)
        
        if self._use_db:
            with self._db_lock:
                try:
                    from database import engine
                    from sqlalchemy import text
                    
                    result_json = json.dumps(result)
                    
                    with engine.begin() as conn:
                        conn.execute(text("""
                            INSERT INTO extraction_cache (fingerprint, doc_type, result, expires_at)
                            VALUES (:fp, :dt, CAST(:result AS jsonb), NOW() + INTERVAL '7 days')
                            ON CONFLICT (fingerprint, doc_type) 
                            DO UPDATE SET result = CAST(EXCLUDED.result AS jsonb), 
                                          expires_at = NOW() + INTERVAL '7 days',
                                          created_at = NOW()
                        """), {"fp": fingerprint, "dt": doc_type, "result": result_json})
                except Exception as e:
                    print(f"DB cache write error: {e}")
    
    def cleanup(self) -> int:
        """Remove expired entries from database. Thread-safe."""
        count = cleanup_expired()
        
        if self._use_db:
            with self._db_lock:
                try:
                    from database import engine
                    from sqlalchemy import text
                    
                    with engine.begin() as conn:
                        result = conn.execute(text("""
                            DELETE FROM extraction_cache
                            WHERE expires_at < NOW()
                        """))
                        count += result.rowcount
                except Exception as e:
                    print(f"DB cache cleanup error: {e}")
        
        return count


document_cache = DocumentCache()
