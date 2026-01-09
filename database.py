from sqlalchemy import create_engine, text
from werkzeug.security import generate_password_hash, check_password_hash
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
            return f"Connected! Sectors: {count}"
    except Exception as e:
        return f"Error: {str(e)}"

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
        print(f" Database engine not initialized in get_demo_config_by_department")
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
            print(f" Unknown department: {department}")
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
        
        print(f"get_demo_config_by_department({department}) found {len(doc_types)} doc types")
        return doc_types
    except Exception as e:
        print(f"Error in get_demo_config_by_department({department}): {e}")
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
        print(f"Database engine not initialized for {department}")
        return []
    
    try:
        # Get from database
        config = get_demo_config_by_department(department)
        if not config:
            print(f" No config found in database for {department}")
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
                    print(f"JSON parse error for {department}: {e}")
                    file_paths = []
            
            # Ensure it's a list
            if not isinstance(file_paths, list):
                file_paths = []
                
            for path in file_paths:
                samples.append({
                    "path": path,
                    "label": os.path.basename(path)
                })
        
        print(f"get_samples_for_template({department}) returning {len(samples)} samples")
        return samples
    except Exception as e:
        print(f"Error in get_samples_for_template({department}): {e}")
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


# ============================================================================
# SEARCH LOGS - Track RAG search queries
# ============================================================================

def log_search_query(query, search_type='rag', source_page=None, ip_address=None, 
                     user_agent=None, session_id=None, results_count=0, sources=None):
    """
    Log a search query to the database.
    
    Args:
        query (str): The search query text
        search_type (str): Type of search - 'rag', 'blog', 'static', 'contact_assistant'
        source_page (str): URL path where search originated
        ip_address (str): User's IP address
        user_agent (str): User's browser user agent
        session_id (str): Flask session ID
        results_count (int): Number of results returned
        sources (list): List of source titles/URLs found
    
    Returns:
        int: ID of created record, or None if failed
    """
    if not engine:
        return None
    
    try:
        import json
        # Convert sources list to JSON string for JSONB
        sources_json = json.dumps(sources) if sources else None
        
        with engine.connect() as conn:
            # Check if action_logs table exists, if not use email_captures as fallback
            try:
                result = conn.execute(text("""
                    INSERT INTO action_logs (
                        action_type,
                        action_data,
                        source_page,
                        ip_address,
                        user_agent,
                        session_id,
                        created_at
                    ) VALUES (
                        :action_type,
                        :action_data,
                        :source_page,
                        :ip_address,
                        :user_agent,
                        :session_id,
                        NOW()
                    )
                    RETURNING id
                """), {
                    "action_type": f"search_{search_type}",
                    "action_data": json.dumps({
                        "query": query,
                        "results_count": results_count,
                        "sources": sources
                    }),
                    "source_page": source_page,
                    "ip_address": ip_address,
                    "user_agent": user_agent,
                    "session_id": session_id
                })
                conn.commit()
                record_id = result.scalar()
                print(f"✅ Search query logged: '{query[:50]}...' ({search_type}) - ID: {record_id}")
                return record_id
            except Exception as table_error:
                # Fallback: Use email_captures table if action_logs doesn't exist
                print(f"⚠️ action_logs table not found, using email_captures fallback: {table_error}")
                result = conn.execute(text("""
                    INSERT INTO email_captures (
                        email_address,
                        report_type,
                        source_page,
                        request_data,
                        ip_address,
                        user_agent,
                        session_id
                    ) VALUES (
                        :email,
                        :report_type,
                        :source_page,
                        :request_data,
                        :ip_address,
                        :user_agent,
                        :session_id
                    )
                    RETURNING id
                """), {
                    "email": f"search_{search_type}@system.local",
                    "report_type": f"search_{search_type}",
                    "source_page": source_page,
                    "request_data": json.dumps({
                        "query": query,
                        "results_count": results_count,
                        "sources": sources
                    }),
                    "ip_address": ip_address,
                    "user_agent": user_agent,
                    "session_id": session_id
                })
                conn.commit()
                record_id = result.scalar()
                print(f"✅ Search query logged (fallback): '{query[:50]}...' ({search_type}) - ID: {record_id}")
                return record_id
            
    except Exception as e:
        print(f"❌ Error logging search query: {e}")
        import traceback
        traceback.print_exc()
        return None


# ============================================================================
# EMAIL CAPTURES - Track email report requests
# ============================================================================

def capture_email_request(email_address, report_type, source_page=None, request_data=None, 
                         ip_address=None, user_agent=None, session_id=None):
    """
    Record an email report request
    
    Args:
        email_address (str): User's email address
        report_type (str): Type of report - 'roi_calculator', 'demo_extraction', 'phase1_sample'
        source_page (str): URL path where request originated
        request_data (dict): Context data (industry, calculations, etc.)
        ip_address (str): User's IP address
        user_agent (str): User's browser user agent
        session_id (str): Flask session ID
    
    Returns:
        int: ID of created record, or None if failed
    """
    if not engine:
        print("❌ Database engine not initialized")
        return None
    
    try:
        import json
        # Convert request_data dict to JSON string for JSONB
        request_json = json.dumps(request_data) if request_data else None
        
        with engine.connect() as conn:
            result = conn.execute(text("""
                INSERT INTO email_captures (
                    email_address,
                    report_type,
                    source_page,
                    request_data,
                    ip_address,
                    user_agent,
                    session_id
                ) VALUES (
                    :email,
                    :report_type,
                    :source_page,
                    :request_data,
                    :ip_address,
                    :user_agent,
                    :session_id
                )
                RETURNING id
            """), {
                "email": email_address,
                "report_type": report_type,
                "source_page": source_page,
                "request_data": request_json,
                "ip_address": ip_address,
                "user_agent": user_agent,
                "session_id": session_id
            })
            conn.commit()
            
            record_id = result.scalar()
            print(f"✅ Email capture recorded: {email_address} ({report_type}) - ID: {record_id}")
            return record_id
            
    except Exception as e:
        print(f"❌ Error capturing email request: {e}")
        import traceback
        traceback.print_exc()
        return None


def mark_email_sent(record_id, success=True, error_message=None):
    """
    Update email delivery status
    
    Args:
        record_id (int): ID of the email_captures record
        success (bool): Whether email was sent successfully
        error_message (str): Error message if send failed
    
    Returns:
        bool: True if update successful, False otherwise
    """
    if not engine:
        return False
    
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                UPDATE email_captures 
                SET 
                    email_sent = :success,
                    email_sent_at = CASE WHEN :success THEN CURRENT_TIMESTAMP ELSE NULL END,
                    email_error = :error
                WHERE id = :record_id
            """), {
                "record_id": record_id,
                "success": success,
                "error": error_message
            })
            conn.commit()
            
        print(f"✅ Email status updated: ID {record_id} - {'Sent' if success else 'Failed'}")
        return True
        
    except Exception as e:
        print(f"❌ Error updating email status: {e}")
        return False


def get_email_history(email_address, limit=10):
    """
    Get recent email requests for a specific address
    
    Args:
        email_address (str): Email to look up
        limit (int): Max number of records to return
    
    Returns:
        list: List of email capture records
    """
    if not engine:
        return []
    
    try:
        with engine.connect() as conn:
            result = conn.execute(text("""
                SELECT 
                    id,
                    email_address,
                    report_type,
                    source_page,
                    request_data,
                    email_sent,
                    email_sent_at,
                    created_at
                FROM email_captures
                WHERE email_address = :email
                  AND deleted_at IS NULL
                ORDER BY created_at DESC
                LIMIT :limit
            """), {
                "email": email_address,
                "limit": limit
            })
            
            return [dict(row._mapping) for row in result]
            
    except Exception as e:
        print(f"❌ Error fetching email history: {e}")
        return []


# ============================================================================
# ROI REPORT LOGGING - Track ROI report generation
# ============================================================================

def log_roi_report(report_type, industry=None, staff_count=None, avg_rate=None,
                  calculations=None, delivery_method='download', email_address=None,
                  ip_address=None, user_agent=None, session_id=None, source_page=None):
    """
    Log ROI report generation to database.
    
    Tries to use action_logs table first, falls back to email_captures if needed.
    
    Args:
        report_type (str): Type of report - 'pdf_download', 'email_report', 'phase1_report', 'roadmap_email'
        industry (str): Industry name (e.g., 'Architecture & Building Services')
        staff_count (int): Number of staff
        avg_rate (float): Average hourly rate
        calculations (dict): Full calculations dictionary (will be stored as JSON)
        delivery_method (str): 'download' or 'email'
        email_address (str): Email address if delivery_method is 'email'
        ip_address (str): User's IP address
        user_agent (str): User's browser user agent
        session_id (str): Flask session ID
        source_page (str): URL path where report was generated
    
    Returns:
        int: ID of created record, or None if failed
    """
    if not engine:
        print("❌ Database engine not initialized for ROI report logging")
        return None
    
    try:
        import json
        
        # Prepare report data for JSONB
        report_data = {
            'report_type': report_type,
            'industry': industry,
            'staff_count': staff_count,
            'avg_rate': avg_rate,
            'delivery_method': delivery_method,
            'email_address': email_address,
            # Store key metrics from calculations (not full object to avoid size issues)
            'tier_1_savings': calculations.get('tier_1_savings') if calculations else None,
            'tier_2_savings': calculations.get('tier_2_savings') if calculations else None,
            'annual_burn': calculations.get('annual_burn') if calculations else None,
            'annual_cost': calculations.get('annual_cost') if calculations else None,
            'total_recoverable_hours': calculations.get('total_recoverable_hours') if calculations else None,
            'weighted_potential': calculations.get('weighted_potential') if calculations else None,
            'mode': calculations.get('mode') if calculations else None
        }
        
        report_json = json.dumps(report_data)
        
        with engine.connect() as conn:
            # Try action_logs table first
            try:
                result = conn.execute(text("""
                    INSERT INTO action_logs (
                        action_type,
                        action_data,
                        source_page,
                        ip_address,
                        user_agent,
                        session_id,
                        created_at
                    ) VALUES (
                        :action_type,
                        :action_data,
                        :source_page,
                        :ip_address,
                        :user_agent,
                        :session_id,
                        NOW()
                    )
                    RETURNING id
                """), {
                    "action_type": f"roi_report_{report_type}",
                    "action_data": report_json,
                    "source_page": source_page,
                    "ip_address": ip_address,
                    "user_agent": user_agent,
                    "session_id": session_id
                })
                conn.commit()
                record_id = result.scalar()
                print(f"✅ ROI report logged: {report_type} ({industry}) - ID: {record_id}")
                return record_id
                
            except Exception as table_error:
                # Fallback: Use email_captures table if action_logs doesn't exist
                print(f"⚠️ action_logs table not found, using email_captures fallback: {table_error}")
                
                # Use email_captures for non-email reports too (with placeholder email)
                fallback_email = email_address if email_address else f"roi_{report_type}@system.local"
                
                result = conn.execute(text("""
                    INSERT INTO email_captures (
                        email_address,
                        report_type,
                        source_page,
                        request_data,
                        ip_address,
                        user_agent,
                        session_id
                    ) VALUES (
                        :email,
                        :report_type,
                        :source_page,
                        :request_data,
                        :ip_address,
                        :user_agent,
                        :session_id
                    )
                    RETURNING id
                """), {
                    "email": fallback_email,
                    "report_type": f"roi_{report_type}",
                    "source_page": source_page,
                    "request_data": report_json,
                    "ip_address": ip_address,
                    "user_agent": user_agent,
                    "session_id": session_id
                })
                conn.commit()
                record_id = result.scalar()
                print(f"✅ ROI report logged (fallback): {report_type} ({industry}) - ID: {record_id}")
                return record_id
                
    except Exception as e:
        print(f"❌ Error logging ROI report: {e}")
        import traceback
        traceback.print_exc()
        return None


# ============================================================================
# EXTRACTION RESULTS - Store extraction history for admin panel
# ============================================================================

def save_extraction_result(
    document_type_slug=None,
    document_type_id=None,
    uploaded_file_name=None,
    extracted_data=None,
    confidence_scores=None,
    validation_errors=None,
    processing_time_ms=None,
    user_session_id=None,
    user_feedback=None,
    feedback_notes=None
):
    """
    Save extraction result to database for analytics and quality monitoring.
    
    Args:
        document_type_slug: Slug like 'vendor-invoice', 'beam-schedule'
        document_type_id: Database ID (will look up if slug provided)
        uploaded_file_name: Original filename
        extracted_data: JSONB dict of extracted fields
        confidence_scores: JSONB dict of per-field confidence scores
        validation_errors: JSONB array of validation failures
        processing_time_ms: Processing time in milliseconds
        user_session_id: Flask session ID
        user_feedback: 'positive', 'negative', 'neutral'
        feedback_notes: User's feedback text
    
    Returns:
        int: ID of created record, or None if failed
    """
    if not engine:
        return None
    
    try:
        # Look up document_type_id if slug provided
        if document_type_slug and not document_type_id:
            with engine.connect() as conn:
                result = conn.execute(text("""
                    SELECT id FROM document_types WHERE slug = :slug
                """), {"slug": document_type_slug})
                row = result.fetchone()
                if row:
                    document_type_id = row[0]
        
        if not document_type_id:
            print(f"⚠️ Warning: Could not find document_type_id for slug: {document_type_slug}")
            return None
        
        import json
        
        with engine.connect() as conn:
            result = conn.execute(text("""
                INSERT INTO extraction_results (
                    document_type_id,
                    uploaded_file_name,
                    extracted_data,
                    confidence_scores,
                    validation_errors,
                    processing_time_ms,
                    user_session_id,
                    user_feedback,
                    feedback_notes,
                    created_at
                ) VALUES (
                    :document_type_id,
                    :uploaded_file_name,
                    :extracted_data,
                    :confidence_scores,
                    :validation_errors,
                    :processing_time_ms,
                    :user_session_id,
                    :user_feedback,
                    :feedback_notes,
                    NOW()
                )
                RETURNING id
            """), {
                "document_type_id": document_type_id,
                "uploaded_file_name": uploaded_file_name,
                "extracted_data": json.dumps(extracted_data) if extracted_data else None,
                "confidence_scores": json.dumps(confidence_scores) if confidence_scores else None,
                "validation_errors": json.dumps(validation_errors) if validation_errors else None,
                "processing_time_ms": processing_time_ms,
                "user_session_id": user_session_id,
                "user_feedback": user_feedback,
                "feedback_notes": feedback_notes
            })
            conn.commit()
            record_id = result.scalar()
            print(f"✅ Extraction result saved: ID {record_id}")
            return record_id
            
    except Exception as e:
        print(f"❌ Error saving extraction result: {e}")
        import traceback
        traceback.print_exc()
        return None


def get_extraction_results(filters=None, limit=100, offset=0):
    """
    Get extraction results with optional filters.
    
    Args:
        filters: Dict with keys:
            - document_type_id: Filter by document type
            - date_from: Start date (datetime string)
            - date_to: End date (datetime string)
            - success_only: Boolean (only successful extractions)
        limit: Max records to return
        offset: Pagination offset
    
    Returns:
        list: List of extraction result dicts
    """
    if not engine:
        return []
    
    try:
        where_clauses = []
        params = {"limit": limit, "offset": offset}
        
        if filters:
            if filters.get('document_type_id'):
                where_clauses.append("er.document_type_id = :document_type_id")
                params['document_type_id'] = filters['document_type_id']
            
            if filters.get('date_from'):
                where_clauses.append("er.created_at >= :date_from")
                params['date_from'] = filters['date_from']
            
            if filters.get('date_to'):
                where_clauses.append("er.created_at <= :date_to")
                params['date_to'] = filters['date_to']
            
            if filters.get('success_only'):
                where_clauses.append("(er.validation_errors IS NULL OR er.validation_errors::text = '[]'::text OR er.validation_errors::text = 'null')")
        
        where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
        
        with engine.connect() as conn:
            result = conn.execute(text(f"""
                SELECT 
                    er.id,
                    er.document_type_id,
                    dt.slug as document_type_slug,
                    dt.name as document_type_name,
                    er.uploaded_file_name,
                    er.extracted_data,
                    er.confidence_scores,
                    er.validation_errors,
                    er.processing_time_ms,
                    er.user_feedback,
                    er.feedback_notes,
                    er.created_at
                FROM extraction_results er
                LEFT JOIN document_types dt ON er.document_type_id = dt.id
                {where_sql}
                ORDER BY er.created_at DESC
                LIMIT :limit OFFSET :offset
            """), params)
            
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
            
    except Exception as e:
        print(f"❌ Error fetching extraction results: {e}")
        import traceback
        traceback.print_exc()
        return []


def get_extraction_analytics(date_from=None, date_to=None):
    """
    Get extraction analytics and metrics.
    
    Returns:
        dict: Analytics data including:
            - total_extractions
            - success_rate
            - avg_processing_time_ms
            - extractions_by_document_type
    """
    if not engine:
        return {}
    
    try:
        where_clause = ""
        params = {}
        
        if date_from and date_to:
            where_clause = "WHERE created_at BETWEEN :date_from AND :date_to"
            params = {"date_from": date_from, "date_to": date_to}
        elif date_from:
            where_clause = "WHERE created_at >= :date_from"
            params = {"date_from": date_from}
        elif date_to:
            where_clause = "WHERE created_at <= :date_to"
            params = {"date_to": date_to}
        
        with engine.connect() as conn:
            # Total extractions
            total_result = conn.execute(text(f"""
                SELECT COUNT(*) as total FROM extraction_results {where_clause}
            """), params)
            total_extractions = total_result.scalar() or 0
            
            # Success rate (no validation errors)
            success_result = conn.execute(text(f"""
                SELECT COUNT(*) as successful
                FROM extraction_results
                {where_clause}
                AND (validation_errors IS NULL OR validation_errors::text = '[]'::text OR validation_errors::text = 'null')
            """), params)
            successful = success_result.scalar() or 0
            success_rate = (successful / total_extractions * 100) if total_extractions > 0 else 0
            
            # Average processing time
            time_result = conn.execute(text(f"""
                SELECT AVG(processing_time_ms) as avg_time
                FROM extraction_results
                {where_clause}
                AND processing_time_ms IS NOT NULL
            """), params)
            avg_processing_time = time_result.scalar() or 0
            
            # Extractions by document type
            type_result = conn.execute(text(f"""
                SELECT 
                    dt.slug,
                    dt.name,
                    COUNT(*) as count
                FROM extraction_results er
                LEFT JOIN document_types dt ON er.document_type_id = dt.id
                {where_clause}
                GROUP BY dt.id, dt.slug, dt.name
                ORDER BY count DESC
            """), params)
            by_document_type = [dict(row._mapping) for row in type_result]
            
            return {
                "total_extractions": total_extractions,
                "successful_extractions": successful,
                "success_rate": round(success_rate, 2),
                "avg_processing_time_ms": round(avg_processing_time, 2),
                "extractions_by_document_type": by_document_type
            }
            
    except Exception as e:
        print(f"❌ Error fetching analytics: {e}")
        import traceback
        traceback.print_exc()
        return {}


# =============================================================================
# USER MANAGEMENT FUNCTIONS (for admin authentication)
# =============================================================================

def get_user_by_username(username):
    """Get user by username"""
    if not engine:
        return None
    
    try:
        with engine.connect() as conn:
            result = conn.execute(text("""
                SELECT id, username, password_hash, email, full_name, is_active, is_admin, last_login
                FROM users
                WHERE username = :username AND is_active = true
            """), {"username": username})
            row = result.fetchone()
            if row:
                return dict(row._mapping)
            return None
    except Exception as e:
        print(f"❌ Error fetching user: {e}")
        return None


def verify_user_password(username, password):
    """Verify username and password"""
    if not engine:
        return False
    
    try:
        user = get_user_by_username(username)
        if not user:
            return False
        
        return check_password_hash(user['password_hash'], password)
    except Exception as e:
        print(f"❌ Error verifying password: {e}")
        return False


def update_user_password(username, new_password):
    """Update user password"""
    if not engine:
        return False
    
    try:
        password_hash = generate_password_hash(new_password)
        with engine.connect() as conn:
            result = conn.execute(text("""
                UPDATE users
                SET password_hash = :password_hash,
                    updated_at = CURRENT_TIMESTAMP
                WHERE username = :username AND is_active = true
            """), {"username": username, "password_hash": password_hash})
            conn.commit()
            return result.rowcount > 0
    except Exception as e:
        print(f"❌ Error updating password: {e}")
        import traceback
        traceback.print_exc()
        return False


def update_user_last_login(username):
    """Update user's last login timestamp"""
    if not engine:
        return False
    
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                UPDATE users
                SET last_login = CURRENT_TIMESTAMP
                WHERE username = :username
            """), {"username": username})
            conn.commit()
            return True
    except Exception as e:
        print(f"❌ Error updating last login: {e}")
        return False


def create_admin_user(username, password, email=None, full_name=None):
    """Create a new admin user (helper function for initial setup)"""
    if not engine:
        return False
    
    try:
        password_hash = generate_password_hash(password)
        with engine.connect() as conn:
            result = conn.execute(text("""
                INSERT INTO users (username, password_hash, email, full_name, is_active, is_admin)
                VALUES (:username, :password_hash, :email, :full_name, true, true)
                ON CONFLICT (username) DO NOTHING
                RETURNING id
            """), {
                "username": username,
                "password_hash": password_hash,
                "email": email,
                "full_name": full_name
            })
            conn.commit()
            return result.fetchone() is not None
    except Exception as e:
        print(f"❌ Error creating user: {e}")
        import traceback
        traceback.print_exc()
        return False