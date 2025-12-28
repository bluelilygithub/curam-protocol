from sqlalchemy import create_engine, text
import os

DATABASE_URL = os.getenv('DATABASE_URL')
engine = create_engine(DATABASE_URL) if DATABASE_URL else None

def test_connection():
    """Test database connection"""
    if not engine:
        return "No DATABASE_URL configured"
    
    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT COUNT(*) FROM sectors"))
            count = result.scalar()
            return f"✅ Connected! Sectors: {count}"
    except Exception as e:
        return f"❌ Error: {str(e)}"

def get_sectors():
    """Get all sectors"""
    with engine.connect() as conn:
        result = conn.execute(text("SELECT * FROM sectors ORDER BY display_order"))
        return [dict(row._mapping) for row in result]


def get_document_types_by_sector(sector_slug):
    """Get document types for a specific sector"""
    with engine.connect() as conn:
        result = conn.execute(text("""
            SELECT dt.slug, dt.name, dt.description, dt.sample_file_paths
            FROM document_types dt
            JOIN sectors s ON dt.sector_id = s.id
            WHERE s.slug = :sector_slug AND dt.demo_enabled = true
            ORDER BY dt.id
        """), {"sector_slug": sector_slug})
        return [dict(row._mapping) for row in result]