"""
Document Fingerprinting and AI Result Caching Service

Provides:
- SHA256 document fingerprinting
- AI response caching (skips expensive Gemini calls for duplicate docs)
- Configurable cache expiry
"""

import hashlib
import json
import time
import os
from typing import Optional, Dict, Any, Tuple

CACHE_EXPIRY_SECONDS = 86400 * 7  # 7 days default
_cache: Dict[str, Dict[str, Any]] = {}

def get_document_fingerprint(content: bytes | str) -> str:
    """Generate SHA256 fingerprint for document content"""
    if isinstance(content, str):
        content = content.encode('utf-8')
    return hashlib.sha256(content).hexdigest()


def get_cached_result(fingerprint: str, doc_type: str) -> Optional[Dict[str, Any]]:
    """
    Get cached AI extraction result for a document fingerprint.
    
    Returns None if:
    - No cached result exists
    - Cache has expired
    """
    cache_key = f"{fingerprint}:{doc_type}"
    
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
    """
    cache_key = f"{fingerprint}:{doc_type}"
    
    _cache[cache_key] = {
        'result': result,
        'timestamp': time.time(),
        'doc_type': doc_type
    }


def clear_cache() -> int:
    """Clear all cached results. Returns count of cleared items."""
    count = len(_cache)
    _cache.clear()
    return count


def get_cache_stats() -> Dict[str, Any]:
    """Get cache statistics"""
    now = time.time()
    valid_count = sum(1 for v in _cache.values() 
                      if now - v.get('timestamp', 0) <= CACHE_EXPIRY_SECONDS)
    
    return {
        'total_entries': len(_cache),
        'valid_entries': valid_count,
        'expired_entries': len(_cache) - valid_count,
        'cache_expiry_hours': CACHE_EXPIRY_SECONDS / 3600
    }


def cleanup_expired() -> int:
    """Remove expired cache entries. Returns count of removed items."""
    now = time.time()
    expired_keys = [k for k, v in _cache.items() 
                    if now - v.get('timestamp', 0) > CACHE_EXPIRY_SECONDS]
    
    for key in expired_keys:
        del _cache[key]
    
    return len(expired_keys)


class DocumentCache:
    """
    Database-backed document cache for persistence across restarts.
    Falls back to in-memory cache if database unavailable.
    """
    
    def __init__(self):
        self._use_db = False
        try:
            from database import engine
            if engine:
                self._use_db = True
                self._ensure_table()
        except Exception:
            pass
    
    def _ensure_table(self):
        """Create cache table if it doesn't exist"""
        try:
            from database import engine
            from sqlalchemy import text
            
            with engine.connect() as conn:
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
                conn.commit()
        except Exception as e:
            print(f"Cache table creation skipped: {e}")
            self._use_db = False
    
    def get(self, fingerprint: str, doc_type: str) -> Optional[Dict[str, Any]]:
        """Get cached result from database or memory"""
        if self._use_db:
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
        """Store result in database and memory"""
        set_cached_result(fingerprint, doc_type, result)
        
        if self._use_db:
            try:
                from database import engine
                from sqlalchemy import text
                
                with engine.connect() as conn:
                    conn.execute(text("""
                        INSERT INTO extraction_cache (fingerprint, doc_type, result, expires_at)
                        VALUES (:fp, :dt, :result::jsonb, NOW() + INTERVAL '7 days')
                        ON CONFLICT (fingerprint, doc_type) 
                        DO UPDATE SET result = :result::jsonb, 
                                      expires_at = NOW() + INTERVAL '7 days',
                                      created_at = NOW()
                    """), {"fp": fingerprint, "dt": doc_type, "result": json.dumps(result)})
                    conn.commit()
            except Exception as e:
                print(f"DB cache write error: {e}")
    
    def cleanup(self) -> int:
        """Remove expired entries from database"""
        count = cleanup_expired()
        
        if self._use_db:
            try:
                from database import engine
                from sqlalchemy import text
                
                with engine.connect() as conn:
                    result = conn.execute(text("""
                        DELETE FROM extraction_cache
                        WHERE expires_at < NOW()
                    """))
                    conn.commit()
                    count += result.rowcount
            except Exception as e:
                print(f"DB cache cleanup error: {e}")
        
        return count


document_cache = DocumentCache()
