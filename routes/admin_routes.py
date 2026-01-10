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
    get_trial_results
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
    
    # Create upload directory for this trial
    trial_upload_dir = os.path.join('uploads', 'phase1_trials', str(trial_id))
    os.makedirs(trial_upload_dir, exist_ok=True)
    
    uploaded_files = request.files.getlist('documents')
    document_category = request.form.get('category', 'Category 1')
    
    if not uploaded_files or not any(f.filename for f in uploaded_files):
        return jsonify({"success": False, "error": "No files uploaded"}), 400
    
    uploaded_count = 0
    errors = []
    
    # Get existing documents in this category to determine document_number
    existing_docs = get_trial_documents(trial_id)
    category_docs = [d for d in existing_docs if d.get('document_category') == document_category]
    next_doc_number = len(category_docs) + 1
    
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
            
            # Add document to database
            doc_id = add_trial_document(
                trial_id=trial_id,
                document_category=document_category,
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
