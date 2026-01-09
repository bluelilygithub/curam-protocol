"""
Admin Panel Routes
Separate admin dashboard for managing the Curam-Ai Protocol system.

This module provides admin functionality without modifying existing code.
All routes are prefixed with /admin
"""

from flask import Blueprint, render_template, request, jsonify, session, redirect, url_for
from functools import wraps
import os
from datetime import datetime, timedelta

# Import database functions
from database import (
    get_extraction_results,
    get_extraction_analytics,
    get_sectors,
    get_document_types_by_sector
)

admin_bp = Blueprint('admin', __name__, url_prefix='/admin')

# Simple authentication using environment variables
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
        
        if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
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
