"""
Admin Panel Routes
Separate admin dashboard for managing the Curam-Ai Protocol system.

This module provides admin functionality without modifying existing code.
All routes are prefixed with /admin
"""

from flask import Blueprint, render_template, request, jsonify, session, redirect, url_for, send_file, flash
from functools import wraps
import os
import time
from datetime import datetime, timedelta
from werkzeug.utils import secure_filename
import secrets

# Import database functions
from database import (
    get_extraction_results,
    get_extraction_analytics,
    get_sectors,
    get_document_types_by_sector,
    verify_user_password,
    update_user_password,
    update_user_last_login,
    get_user_by_username,
    create_phase1_trial,
    get_phase1_trial,
    get_all_phase1_trials,
    add_trial_document,
    get_trial_documents,
    save_trial_result,
    get_trial_results,
    get_all_prompts,
    get_prompt_by_id,
    update_prompt,
    toggle_prompt_active
)

admin_bp = Blueprint('admin', __name__, url_prefix='/admin')

# Fallback authentication using environment variables (if users table doesn't exist)
ADMIN_USERNAME = os.getenv('ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD', 'changeme123')

def require_admin(f):
    """Decorator to require admin authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('admin_authenticated'):
            return redirect(url_for('admin.login'))
        return f(*args, **kwargs)
    return decorated_function


@admin_bp.route('/login', methods=['GET', 'POST'])
def login():
    """Admin login page"""
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '').strip()
        
        # Try database authentication first
        if verify_user_password(username, password):
            session['admin_authenticated'] = True
            session['admin_username'] = username
            update_user_last_login(username)
            return redirect(url_for('admin.dashboard'))
        # Fallback to environment variable authentication
        elif username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
            session['admin_authenticated'] = True
            session['admin_username'] = username
            return redirect(url_for('admin.dashboard'))
        else:
            return render_template('admin/login.html', error='Invalid credentials')
    
    # If already authenticated, redirect to dashboard
    if session.get('admin_authenticated'):
        return redirect(url_for('admin.dashboard'))
    
    return render_template('admin/login.html')


@admin_bp.route('/logout')
def logout():
    """Admin logout"""
    session.pop('admin_authenticated', None)
    session.pop('admin_username', None)
    return redirect(url_for('admin.login'))


@admin_bp.route('/')
@require_admin
def dashboard():
    """Main admin dashboard"""
    # Get analytics for last 30 days
    date_from = (datetime.now() - timedelta(days=30)).isoformat()
    date_to = datetime.now().isoformat()
    
    analytics = get_extraction_analytics(date_from=date_from, date_to=date_to)
    
    # Get recent extractions
    recent_extractions = get_extraction_results(limit=10, offset=0)
    
    # Get document types summary
    sectors = get_sectors()
    doc_types_summary = []
    for sector in sectors:
        doc_types = get_document_types_by_sector(sector['slug'])
        doc_types_summary.extend(doc_types)
    
    return render_template('admin/dashboard.html',
                         analytics=analytics,
                         recent_extractions=recent_extractions,
                         doc_types_summary=doc_types_summary)


@admin_bp.route('/extractions')
@require_admin
def extractions():
    """Extraction history page"""
    # Get filters from query params
    filters = {}
    if request.args.get('document_type_id'):
        try:
            filters['document_type_id'] = int(request.args.get('document_type_id'))
        except ValueError:
            pass
    
    if request.args.get('date_from'):
        filters['date_from'] = request.args.get('date_from')
    
    if request.args.get('date_to'):
        filters['date_to'] = request.args.get('date_to')
    
    if request.args.get('success_only') == 'true':
        filters['success_only'] = True
    
    limit = int(request.args.get('limit', 100))
    offset = int(request.args.get('offset', 0))
    
    results = get_extraction_results(filters=filters, limit=limit, offset=offset)
    
    # Get document types for filter dropdown
    sectors = get_sectors()
    all_doc_types = []
    for sector in sectors:
        doc_types = get_document_types_by_sector(sector['slug'])
        all_doc_types.extend(doc_types)
    
    return render_template('admin/extractions.html',
                         extractions=results,
                         document_types=all_doc_types,
                         filters=filters,
                         limit=limit,
                         offset=offset)


@admin_bp.route('/api/extractions')
@require_admin
def api_extractions():
    """API endpoint for extraction results (JSON)"""
    filters = {}
    if request.args.get('document_type_id'):
        try:
            filters['document_type_id'] = int(request.args.get('document_type_id'))
        except ValueError:
            pass
    
    if request.args.get('date_from'):
        filters['date_from'] = request.args.get('date_from')
    
    if request.args.get('date_to'):
        filters['date_to'] = request.args.get('date_to')
    
    if request.args.get('success_only') == 'true':
        filters['success_only'] = True
    
    limit = int(request.args.get('limit', 100))
    offset = int(request.args.get('offset', 0))
    
    results = get_extraction_results(filters=filters, limit=limit, offset=offset)
    
    return jsonify({'extractions': results})


@admin_bp.route('/api/analytics')
@require_admin
def api_analytics():
    """API endpoint for extraction analytics (JSON)"""
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')
    
    analytics = get_extraction_analytics(date_from=date_from, date_to=date_to)
    
    return jsonify(analytics)


@admin_bp.route('/document-types')
@require_admin
def document_types():
    """Document types management page"""
    sectors = get_sectors()
    all_doc_types = []
    for sector in sectors:
        doc_types = get_document_types_by_sector(sector['slug'])
        for dt in doc_types:
            dt['sector_name'] = sector['name']
            dt['sector_slug'] = sector['slug']
        all_doc_types.extend(doc_types)
    
    return render_template('admin/document_types.html',
                         document_types=all_doc_types,
                         sectors=sectors)


@admin_bp.route('/analytics')
@require_admin
def analytics():
    """Analytics dashboard page"""
    # Get date range from query params or default to last 30 days
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')
    
    if not date_from:
        date_from = (datetime.now() - timedelta(days=30)).isoformat()
    if not date_to:
        date_to = datetime.now().isoformat()
    
    analytics_data = get_extraction_analytics(date_from=date_from, date_to=date_to)
    
    return render_template('admin/analytics.html',
                         analytics=analytics_data,
                         date_from=date_from,
                         date_to=date_to)


@admin_bp.route('/change-password', methods=['GET', 'POST'])
@require_admin
def change_password():
    """Change password page"""
    if request.method == 'POST':
        current_password = request.form.get('current_password', '').strip()
        new_password = request.form.get('new_password', '').strip()
        confirm_password = request.form.get('confirm_password', '').strip()
        
        username = session.get('admin_username')
        if not username:
            return render_template('admin/change_password.html', error='Session expired. Please login again.')
        
        # Validate inputs
        if not current_password or not new_password or not confirm_password:
            return render_template('admin/change_password.html', error='All fields are required.')
        
        if new_password != confirm_password:
            return render_template('admin/change_password.html', error='New passwords do not match.')
        
        if len(new_password) < 8:
            return render_template('admin/change_password.html', error='New password must be at least 8 characters long.')
        
        # Verify current password
        if not verify_user_password(username, current_password):
            # Try fallback to environment variable
            if username != ADMIN_USERNAME or current_password != ADMIN_PASSWORD:
                return render_template('admin/change_password.html', error='Current password is incorrect.')
        
        # Update password in database
        if update_user_password(username, new_password):
            return render_template('admin/change_password.html', success='Password updated successfully!')
        else:
            return render_template('admin/change_password.html', error='Failed to update password. Please try again.')
    
    return render_template('admin/change_password.html')


# =============================================================================
# DOCUMENTATION ROUTES (Internal Q&A/FAQ)
# =============================================================================

@admin_bp.route('/documentation')
@require_admin
def documentation_index():
    """Internal documentation index page"""
    return render_template('admin/documentation/index.html')


@admin_bp.route('/documentation/roi')
@require_admin
def documentation_roi():
    """ROI FAQ page for internal documentation"""
    return render_template('admin/documentation/roi.html')


@admin_bp.route('/documentation/application-management')
@require_admin
def documentation_application_management():
    """Application Management documentation page"""
    return render_template('admin/documentation/application_management.html')


# =============================================================================
# PHASE 1 TRIAL MANAGEMENT ROUTES
# =============================================================================

@admin_bp.route('/phase1-trials')
@require_admin
def phase1_trials():
    """Phase 1 trials management page - list all trials"""
    status_filter = request.args.get('status')
    trials = get_all_phase1_trials(limit=100, offset=0, status_filter=status_filter)
    return render_template('admin/phase1_trials.html', trials=trials, status_filter=status_filter)


@admin_bp.route('/phase1-trials/create', methods=['GET', 'POST'])
@require_admin
def phase1_trial_create():
    """Create a new Phase 1 trial"""
    if request.method == 'POST':
        customer_name = request.form.get('customer_name', '').strip()
        customer_email = request.form.get('customer_email', '').strip()
        customer_company = request.form.get('customer_company', '').strip()
        industry = request.form.get('industry', '').strip()
        sector_slug = request.form.get('sector_slug', '').strip()
        notes = request.form.get('notes', '').strip()
        
        if not customer_name:
            return render_template('admin/phase1_trial_create.html',
                                 error='Customer name is required',
                                 sectors=get_sectors())
        
        created_by = session.get('admin_username')  # You might want to get user ID instead
        trial = create_phase1_trial(
            customer_name=customer_name,
            customer_email=customer_email if customer_email else None,
            customer_company=customer_company if customer_company else None,
            industry=industry if industry else None,
            sector_slug=sector_slug if sector_slug else None,
            created_by=None,  # TODO: Get actual user ID
            notes=notes if notes else None
        )
        
        if trial:
            return redirect(url_for('admin.phase1_trial_detail', trial_id=trial['id']))
        else:
            return render_template('admin/phase1_trial_create.html',
                                 error='Failed to create trial. Please try again.',
                                 sectors=get_sectors())
    
    sectors = get_sectors()
    return render_template('admin/phase1_trial_create.html', sectors=sectors)


@admin_bp.route('/phase1-trials/<int:trial_id>')
@require_admin
def phase1_trial_detail(trial_id):
    """View and manage a specific Phase 1 trial"""
    trial = get_phase1_trial(trial_id=trial_id)
    if not trial:
        return "Trial not found", 404
    
    documents = get_trial_documents(trial_id)
    results = get_trial_results(trial_id)
    sectors = get_sectors()
    
    return render_template('admin/phase1_trial_detail.html',
                         trial=trial,
                         documents=documents,
                         results=results,
                         sectors=sectors)


@admin_bp.route('/phase1-trials/<int:trial_id>/upload', methods=['POST'])
@require_admin
def phase1_trial_upload(trial_id):
    """Upload documents to a Phase 1 trial"""
    trial = get_phase1_trial(trial_id=trial_id)
    if not trial:
        return jsonify({"success": False, "error": "Trial not found"}), 404
    
    # Import config for upload directory
    from config import PHASE1_TRIALS_UPLOAD_DIR
    
    # Create upload directory for this trial
    trial_upload_dir = os.path.join(PHASE1_TRIALS_UPLOAD_DIR, str(trial_id))
    os.makedirs(trial_upload_dir, exist_ok=True)
    
    uploaded_files = request.files.getlist('documents')
    category = request.form.get('category', 'Category 1')  # Default to Category 1
    
    if not uploaded_files or not any(f.filename for f in uploaded_files):
        return jsonify({"success": False, "error": "No files uploaded"}), 400
    
    # Validate category
    valid_categories = ['Category 1', 'Category 2', 'Category 3']
    if category not in valid_categories:
        category = 'Category 1'  # Default fallback
    
    # Check current document count and enforce max of 15 total
    existing_docs = get_trial_documents(trial_id)
    current_count = len(existing_docs)
    max_files = 15
    
    # Check category-specific count (5 per category)
    category_docs = [d for d in existing_docs if d.get('document_category') == category]
    category_count = len(category_docs)
    max_per_category = 5
    
    if category_count >= max_per_category:
        return jsonify({
            "success": False,
            "error": f"{category} already has {category_count} files (maximum 5 per category)."
        }), 400
    
    if current_count >= max_files:
        return jsonify({
            "success": False,
            "error": f"Maximum of {max_files} files allowed across all categories. You already have {current_count} files."
        }), 400
    
    # Calculate how many files we can still upload in this category
    remaining_category_slots = max_per_category - category_count
    remaining_total_slots = max_files - current_count
    remaining_slots = min(remaining_category_slots, remaining_total_slots)
    
    if len(uploaded_files) > remaining_slots:
        return jsonify({
            "success": False,
            "error": f"Can only upload {remaining_slots} more file(s) to {category} (category limit: {remaining_category_slots}, total limit: {remaining_total_slots})."
        }), 400
    
    uploaded_count = 0
    errors = []
    
    # Get the next document number for this category (1-5 within category)
    next_doc_number = category_count + 1
    
    for file_storage in uploaded_files:
        if not file_storage or not file_storage.filename:
            continue
        
        if not file_storage.filename.lower().endswith('.pdf'):
            errors.append(f"{file_storage.filename}: Only PDF files are allowed")
            continue
        
        try:
            original_filename = secure_filename(file_storage.filename)
            unique_name = f"{int(time.time() * 1000)}_{original_filename}"
            file_path = os.path.join(trial_upload_dir, unique_name)
            file_storage.save(file_path)
            file_size = os.path.getsize(file_path)
            
            # Add document to database with category and document number
            doc_id = add_trial_document(
                trial_id=trial_id,
                document_category=category,
                document_number=next_doc_number,
                original_filename=original_filename,
                stored_file_path=file_path,
                file_size_bytes=file_size
            )
            
            if doc_id:
                uploaded_count += 1
                next_doc_number += 1
            else:
                errors.append(f"{original_filename}: Failed to save to database")
                # Remove file if database save failed
                if os.path.exists(file_path):
                    os.remove(file_path)
                    
        except Exception as e:
            errors.append(f"{file_storage.filename}: {str(e)}")
    
    if uploaded_count > 0:
        return jsonify({
            "success": True,
            "uploaded": uploaded_count,
            "errors": errors,
            "message": f"Successfully uploaded {uploaded_count} document(s)"
        })
    else:
        return jsonify({
            "success": False,
            "errors": errors,
            "error": "Failed to upload documents"
        }), 400


@admin_bp.route('/phase1-trials/<int:trial_id>/config', methods=['POST'])
@require_admin
def phase1_trial_config(trial_id):
    """Update extraction fields and output format configuration for a Phase 1 trial"""
    from database import update_phase1_trial_extraction_config
    
    trial = get_phase1_trial(trial_id=trial_id)
    if not trial:
        return jsonify({"success": False, "error": "Trial not found"}), 404
    
    data = request.get_json()
    
    # Preferred: category_configs (per-category configuration)
    category_configs = data.get('category_configs')
    
    # Legacy support: extraction_fields and output_format (trial-wide, deprecated)
    extraction_fields = data.get('extraction_fields')
    output_format = data.get('output_format')
    
    if category_configs is None and extraction_fields is None and output_format is None:
        return jsonify({"success": False, "error": "No configuration provided"}), 400
    
    success = update_phase1_trial_extraction_config(
        trial_id=trial_id,
        category_configs=category_configs,
        extraction_fields=extraction_fields,
        output_format=output_format
    )
    
    if success:
        return jsonify({"success": True, "message": "Extraction configuration updated successfully"})
    else:
        return jsonify({"success": False, "error": "Failed to update configuration"}), 500


@admin_bp.route('/phase1-trials/<int:trial_id>/process', methods=['POST'])
@require_admin
def phase1_trial_process(trial_id):
    """Process documents in a Phase 1 trial (run extraction)"""
    # This would integrate with your existing extraction services
    # For now, return a placeholder response
    return jsonify({
        "success": True,
        "message": "Document processing started. Results will be available shortly.",
        "note": "This endpoint needs to be implemented to integrate with extraction services"
    })


@admin_bp.route('/phase1-trials/<int:trial_id>/report')
@require_admin
def phase1_trial_report(trial_id):
    """Generate and view Phase 1 report for a trial (admin view)"""
    trial = get_phase1_trial(trial_id=trial_id)
    if not trial:
        return "Trial not found", 404
    
    documents = get_trial_documents(trial_id)
    results = get_trial_results(trial_id)
    
    # Calculate aggregated metrics
    if results:
        total_fields = sum(r.get('fields_total', 0) for r in results)
        total_passed = sum(r.get('fields_passed', 0) for r in results)
        total_flagged = sum(r.get('fields_flagged', 0) for r in results)
        stp_count = sum(1 for r in results if r.get('stp_eligible', False))
        stp_rate = (stp_count / len(results) * 100) if results else 0
    else:
        total_fields = total_passed = total_flagged = 0
        stp_rate = 0
    
    return render_template('admin/phase1_trial_report.html',
                         trial=trial,
                         documents=documents,
                         results=results,
                         total_fields=total_fields,
                         total_passed=total_passed,
                         total_flagged=total_flagged,
                         stp_rate=round(stp_rate, 1))


@admin_bp.route('/phase1-report/<report_token>')
def phase1_report_public(report_token):
    """Public/private Phase 1 report view (accessible via token, no login required)"""
    trial = get_phase1_trial(report_token=report_token)
    if not trial:
        return "Report not found or invalid token", 404
    
    documents = get_trial_documents(trial['id'])
    results = get_trial_results(trial['id'])
    
    # Calculate aggregated metrics
    if results:
        total_fields = sum(r.get('fields_total', 0) for r in results)
        total_passed = sum(r.get('fields_passed', 0) for r in results)
        total_flagged = sum(r.get('fields_flagged', 0) for r in results)
        stp_count = sum(1 for r in results if r.get('stp_eligible', False))
        stp_rate = (stp_count / len(results) * 100) if results else 0
    else:
        total_fields = total_passed = total_flagged = 0
        stp_rate = 0
    
    return render_template('admin/phase1_report_public.html',
                         trial=trial,
                         documents=documents,
                         results=results,
                         total_fields=total_fields,
                         total_passed=total_passed,
                         total_flagged=total_flagged,
                         stp_rate=round(stp_rate, 1))


# ============================================================================
# PROMPT MANAGEMENT ROUTES
# ============================================================================

@admin_bp.route('/prompts')
@require_admin
def prompts():
    """List all prompt templates"""
    try:
        prompts_list = get_all_prompts()
        # Count inactive migrated prompts
        inactive_migrated = sum(1 for p in prompts_list 
                               if p.get('name', '').find('Hardcoded Migration') >= 0 
                               and not p.get('is_active', False))
        
        # Also count active migrated prompts
        active_migrated = sum(1 for p in prompts_list 
                             if p.get('name', '').find('Hardcoded Migration') >= 0 
                             and p.get('is_active', False))
        
        # Check if table exists and has any prompts
        from sqlalchemy import text
        from database import engine
        table_exists = False
        total_count = 0
        if engine:
            try:
                with engine.connect() as conn:
                    # Check if table exists
                    check_query = conn.execute(text("""
                        SELECT EXISTS (
                            SELECT FROM information_schema.tables 
                            WHERE table_name = 'prompt_templates'
                        )
                    """))
                    table_exists = check_query.scalar()
                    
                    if table_exists:
                        count_query = conn.execute(text("SELECT COUNT(*) FROM prompt_templates"))
                        total_count = count_query.scalar()
            except Exception as e:
                flash(f'Database error: {str(e)}', 'error')
        
        return render_template('admin/prompts.html', 
                             prompts=prompts_list,
                             inactive_migrated_count=inactive_migrated,
                             active_migrated_count=active_migrated,
                             table_exists=table_exists,
                             total_prompts_count=total_count)
    except Exception as e:
        flash(f'Error loading prompts: {str(e)}', 'error')
        return render_template('admin/prompts.html', 
                             prompts=[],
                             inactive_migrated_count=0,
                             active_migrated_count=0,
                             table_exists=False,
                             total_prompts_count=0)


@admin_bp.route('/prompts/<int:prompt_id>')
@require_admin
def prompt_edit(prompt_id):
    """View and edit a single prompt template"""
    prompt = get_prompt_by_id(prompt_id)
    if not prompt:
        flash('Prompt not found', 'error')
        return redirect(url_for('admin.prompts'))
    
    return render_template('admin/prompt_edit.html', prompt=prompt)


@admin_bp.route('/prompts/<int:prompt_id>', methods=['POST'])
@require_admin
def prompt_update(prompt_id):
    """Update a prompt template"""
    prompt = get_prompt_by_id(prompt_id)
    if not prompt:
        flash('Prompt not found', 'error')
        return redirect(url_for('admin.prompts'))
    
    # Get form data
    name = request.form.get('name', '').strip()
    scope = request.form.get('scope', '').strip()
    doc_type = request.form.get('doc_type', '').strip() or None
    sector_slug = request.form.get('sector_slug', '').strip() or None
    prompt_text = request.form.get('prompt_text', '').strip()
    priority = request.form.get('priority', type=int)
    is_active = request.form.get('is_active') == 'on'
    
    # Validate required fields
    if not name or not scope or not prompt_text:
        flash('Name, scope, and prompt text are required', 'error')
        return redirect(url_for('admin.prompt_edit', prompt_id=prompt_id))
    
    # Update prompt
    success = update_prompt(
        prompt_id=prompt_id,
        name=name,
        scope=scope,
        doc_type=doc_type,
        sector_slug=sector_slug,
        prompt_text=prompt_text,
        priority=priority,
        is_active=is_active
    )
    
    if success:
        flash('Prompt updated successfully', 'success')
    else:
        flash('Failed to update prompt', 'error')
    
    return redirect(url_for('admin.prompt_edit', prompt_id=prompt_id))


@admin_bp.route('/prompts/<int:prompt_id>/toggle', methods=['POST'])
@require_admin
def prompt_toggle(prompt_id):
    """Toggle the active status of a prompt"""
    result = toggle_prompt_active(prompt_id)
    if result:
        status = 'activated' if result.get('is_active') else 'deactivated'
        flash(f'Prompt {status} successfully', 'success')
    else:
        flash('Failed to toggle prompt status', 'error')
    
    return redirect(url_for('admin.prompts'))


@admin_bp.route('/prompts/activate-all', methods=['POST'])
@require_admin
def prompts_activate_all():
    """Activate all migrated prompts (bulk operation)"""
    from sqlalchemy import text
    
    if not engine:
        flash('Database connection not available', 'error')
        return redirect(url_for('admin.prompts'))
    
    try:
        with engine.connect() as conn:
            # First count how many will be activated
            count_query = text("""
                SELECT COUNT(*) as count
                FROM prompt_templates
                WHERE name LIKE '%Hardcoded Migration%' AND is_active = false
            """)
            count_result = conn.execute(count_query)
            inactive_count = count_result.fetchone()[0]
            
            if inactive_count == 0:
                flash('No inactive migrated prompts to activate', 'info')
                return redirect(url_for('admin.prompts'))
            
            # Activate all migrated prompts
            query = text("""
                UPDATE prompt_templates 
                SET is_active = true, updated_at = CURRENT_TIMESTAMP
                WHERE name LIKE '%Hardcoded Migration%' AND is_active = false
            """)
            conn.execute(query)
            conn.commit()
            
            flash(f'Successfully activated {inactive_count} migrated prompt(s)', 'success')
    except Exception as e:
        print(f"Error activating prompts: {e}")
        flash(f'Failed to activate prompts: {str(e)}', 'error')
    
    return redirect(url_for('admin.prompts'))
