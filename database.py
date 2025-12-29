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

def get_sector_demo_config(sector_slug):
    """
    Get demo configuration for a specific sector.
    Returns sector info with demo customization fields.
    
    Args:
        sector_slug: Sector slug (e.g., 'professional-services', 'logistics-compliance', 'built-environment')
    
    Returns:
        Dictionary with sector configuration or None if not found
    """
    if not engine:
        print(f"Database engine not initialized")
        return None
    
    try:
        with engine.connect() as conn:
            result = conn.execute(text("""
                SELECT 
                    slug,
                    name,
                    icon_svg,
                    demo_headline,
                    demo_subheadline,
                    demo_title,
                    demo_description,
                    default_department
                FROM sectors
                WHERE slug = :sector_slug AND active = true
            """), {"sector_slug": sector_slug})
            
            row = result.fetchone()
            if not row:
                print(f"Sector not found: {sector_slug}")
                return None
            
            sector_config = dict(row._mapping)
            
            # Get document types for this sector
            doc_types_result = conn.execute(text("""
                SELECT name
                FROM document_types
                WHERE sector_id = (SELECT id FROM sectors WHERE slug = :sector_slug)
                AND demo_enabled = true
                ORDER BY id
            """), {"sector_slug": sector_slug})
            
            sector_config['document_types'] = [row[0] for row in doc_types_result]
            
            print(f"Loaded sector config: {sector_slug}")
            return sector_config
            
    except Exception as e:
        print(f"Error loading sector config for {sector_slug}: {e}")
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

# ============================================================================
# DATABASE-DRIVEN PROMPTS
# ============================================================================

def get_active_prompts(doc_type, sector_slug=None):
    """Get active prompts for a document type, ordered by priority"""
    if not engine:
        return []
    
    try:
        with engine.connect() as conn:
            universal_query = text("""
                SELECT prompt_text, priority, name
                FROM prompt_templates
                WHERE scope = 'universal' AND is_active = true
                ORDER BY priority ASC
            """)
            universal = conn.execute(universal_query).fetchall()
            
            doctype_query = text("""
                SELECT prompt_text, priority, name
                FROM prompt_templates
                WHERE scope = 'document_type' AND doc_type = :doc_type AND is_active = true
                ORDER BY priority ASC
            """)
            doctype = conn.execute(doctype_query, {"doc_type": doc_type}).fetchall()
            
            sector = []
            if sector_slug:
                sector_query = text("""
                    SELECT prompt_text, priority, name
                    FROM prompt_templates
                    WHERE scope = 'sector' AND sector_slug = :sector_slug
                    AND (doc_type = :doc_type OR doc_type IS NULL) AND is_active = true
                    ORDER BY priority ASC
                """)
                sector = conn.execute(sector_query, {"sector_slug": sector_slug, "doc_type": doc_type}).fetchall()
            
            all_prompts = list(universal) + list(sector) + list(doctype)
            all_prompts.sort(key=lambda x: x[1])
            
            return [{"text": p[0], "priority": p[1], "name": p[2]} for p in all_prompts]
    except Exception as e:
        print(f"Error loading prompts: {e}")
        return []


def build_combined_prompt(doc_type, sector_slug, text):
    """Build a combined prompt from database prompts"""
    prompts = get_active_prompts(doc_type, sector_slug)
    
    if not prompts:
        return None
    
    combined = "\n\n---\n\n".join([p["text"] for p in prompts])
    combined += f"\n\n---\n\nTEXT: {text}\n\nReturn ONLY valid JSON."
    
    return combined