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


def get_demo_config_by_department(department):
    """Get demo configuration for a department (maps old dept names to new sectors)"""
    # Map old department names to sector slugs
    dept_to_sector = {
        'finance': 'professional-services',
        'engineering': 'built-environment',
        'transmittal': 'built-environment'
    }
    
    sector_slug = dept_to_sector.get(department)
    if not sector_slug:
        return None
    
    # Get document types for this sector
    doc_types = get_document_types_by_sector(sector_slug)
    
    # Filter based on department-specific logic
    if department == 'finance':
        doc_types = [dt for dt in doc_types if dt['slug'] == 'vendor-invoice']
    elif department == 'engineering':
        doc_types = [dt for dt in doc_types if dt['slug'] == 'beam-schedule']
    elif department == 'transmittal':
        doc_types = [dt for dt in doc_types if dt['slug'] == 'drawing-register']
    
    return doc_types

def get_samples_for_template(department):
    """Get sample file configuration for template rendering"""
    # Get from database
    config = get_demo_config_by_department(department)
    if not config:
        return []
    
    # Convert to template format
    samples = []
    for doc_type in config:
        file_paths = doc_type.get('sample_file_paths', [])
        
        # Handle if it's a JSON string instead of list
        if isinstance(file_paths, str):
            import json
            try:
                file_paths = json.loads(file_paths)
            except:
                file_paths = []
        
        # Ensure it's a list
        if not isinstance(file_paths, list):
            file_paths = []
            
        for path in file_paths:
            samples.append({
                "path": path,
                "label": os.path.basename(path)
            })
    
    return samples
