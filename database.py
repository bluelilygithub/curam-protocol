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
            return f"âœ… Connected! Sectors: {count}"
    except Exception as e:
        return f"âŒ Error: {str(e)}"

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
    if not engine:
        print(f"âš  Database engine not initialized in get_demo_config_by_department")
        return None
    
    try:
        # Map old department names to sector slugs
        dept_to_sector = {
            'finance': 'professional-services',
            'engineering': 'built-environment',
            'transmittal': 'built-environment'
        }
        
        sector_slug = dept_to_sector.get(department)
        if not sector_slug:
            print(f"âš  Unknown department: {department}")
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
        
        print(f"âœ“ get_demo_config_by_department({department}) found {len(doc_types)} doc types")
        return doc_types
    except Exception as e:
        print(f"âœ— Error in get_demo_config_by_department({department}): {e}")
        import traceback
        traceback.print_exc()
        return None

def get_samples_for_template(department):
    """Get sample file configuration for template rendering"""
    # Check if database is available
    if not engine:
        print(f"âš  Database engine not initialized for {department}")
        return []
    
    try:
        # Get from database
        config = get_demo_config_by_department(department)
        if not config:
            print(f"âš  No config found in database for {department}")
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
                except Exception as e:
                    print(f"âœ— JSON parse error for {department}: {e}")
                    file_paths = []
            
            # Ensure it's a list
            if not isinstance(file_paths, list):
                file_paths = []
                
            for path in file_paths:
                samples.append({
                    "path": path,
                    "label": os.path.basename(path)
                })
        
        print(f"âœ“ get_samples_for_template({department}) returning {len(samples)} samples")
        return samples
    except Exception as e:
        print(f"âœ— Error in get_samples_for_template({department}): {e}")
        import traceback
        traceback.print_exc()
        return []

def get_departments_by_sector(sector_slug):
    """Get list of departments that belong to a sector"""
    sector_to_departments = {
        'built-environment': ['finance', 'engineering', 'transmittal'],
        'logistics-compliance': ['finance', 'logistics'],
        'professional-services': ['finance', 'legal']
    }
    return sector_to_departments.get(sector_slug, [])


def capture_email_request(industry, company_name, email, calculator_type='roi'):
    """Capture email submission from calculator"""
    # Placeholder - implement if needed
    pass


def mark_email_sent(request_id):
    """Mark email as sent"""
    # Placeholder - implement if needed
    pass