import os
import json
import re
from flask import Flask, request, render_template, render_template_string, session, Response, send_file, abort, url_for, send_from_directory, redirect, jsonify
import google.generativeai as genai
import pdfplumber
import pandas as pd
import io
try:
    import grpc
except ImportError:
    grpc = None
import time
from werkzeug.utils import secure_filename
import requests
from urllib.parse import quote

from database import (
    test_connection, 
    get_document_types_by_sector, 
    engine, 
    get_sectors, 
    get_demo_config_by_department,
    get_samples_for_template,
    get_sector_demo_config
)
from sqlalchemy import text

# Phase 3.1: Validation Service (extracted from main.py lines 3124-3449)
from services.validation_service import (
    detect_low_confidence,
    correct_ocr_errors,
    validate_engineering_field
)

# Formatting utilities
from utils.formatting import format_currency, format_text_to_html

# Phase 3.2: PDF Service (extracted from main.py lines 150-158, 3494-3522)
from services.pdf_service import (
    extract_text,
    prepare_prompt_text
)

# Phase 3.3c: Gemini Service - COMPLETE (all 3 functions extracted)
from services.gemini_service import get_available_models, build_prompt, analyze_gemini, HTML_TEMPLATE

# Phase 3.4: RAG Search Service (extracted from main.py lines 313-797)
from services.rag_service import (
    extract_text_from_html,
    calculate_authority_score,
    search_static_html_pages,
    perform_rag_search
)

# Phase 4.1: Static Pages Blueprint
from routes.static_pages import static_pages_bp

# Phase 4.2: Automater Routes Blueprint
from routes.automater_routes import automater_bp

# Phase 4.3: Export Routes Blueprint
from routes.export_routes import export_bp

# Phase 4.4: API Routes Blueprint
from routes.api_routes import api_bp

# Try to import specific exception types
try:
    from google.api_core import exceptions as google_exceptions
except ImportError:
    google_exceptions = None

# Import configuration
from config import (
    SECRET_KEY,
    FINANCE_UPLOAD_DIR,
    DEFAULT_DEPARTMENT,
    DEPARTMENT_SAMPLES,
    SAMPLE_TO_DEPT,
    ALLOWED_SAMPLE_PATHS,
    ROUTINE_DESCRIPTIONS,
    ROUTINE_SUMMARY,
    ENGINEERING_PROMPT_LIMIT,
    ENGINEERING_PROMPT_LIMIT_SHORT,
    TRANSMITTAL_PROMPT_LIMIT,
    FINANCE_FIELDS,
    ENGINEERING_BEAM_FIELDS,
    ENGINEERING_COLUMN_FIELDS,
    TRANSMITTAL_FIELDS,
    DOC_FIELDS,
    ERROR_FIELD
)

app = Flask(__name__, static_folder='assets', static_url_path='/assets')
app.secret_key = SECRET_KEY

# Register blueprints
app.register_blueprint(static_pages_bp)
app.register_blueprint(automater_bp)
app.register_blueprint(export_bp)
app.register_blueprint(api_bp)

# Configure UTF-8 encoding sanitization for corrupt characters
from utils.encoding_fix import create_safe_template_filter, sanitize_response_middleware

# Add Jinja2 filter for automatic sanitization in templates
app.jinja_env.filters['sanitize'] = create_safe_template_filter()

# Add middleware to sanitize all HTML responses (optional - uncomment to enable)
# This will clean ALL HTML responses automatically
# app.after_request(sanitize_response_middleware)

# Error handler for debugging
@app.errorhandler(500)
def internal_error(error):
    """Show detailed error message for debugging"""
    import traceback
    trace = traceback.format_exc()
    app.logger.error(f"500 Internal Server Error:\n{trace}")
    if app.debug:
        return f"<pre>Internal Server Error:\n\n{trace}</pre>", 500
    return "Internal Server Error. Please check the logs.", 500

# Configure Gemini API
api_key = os.environ.get("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)

# Create upload directories
os.makedirs(FINANCE_UPLOAD_DIR, exist_ok=True)

# Cache for available models
_available_models = None

from services.image_preprocessing import TESSERACT_AVAILABLE, CV2_AVAILABLE


# =============================================================================
# API ROUTES
# =============================================================================
# API routes moved to routes/api_routes.py

# =============================================================================
# AUTOMATER & DEMO ROUTES
# =============================================================================

# =============================================================================
# AUTOMATER & DEMO ROUTES
# =============================================================================

# Feasibility Preview - Sector-aware HTML page with iframe (database-driven)
# Feasibility Preview HTML page with iframe (serves feasibility-preview.html)
@app.route('/feasibility-preview.html')
def feasibility_preview_html():
    """Serve feasibility-preview.html page with iframe to automater"""
    # Try to render as template with default sector data
    sector_slug = request.args.get('sector', 'professional-services')
    
    # Default sector configuration
    sector_config = {
        'name': 'Professional Services',
        'headline': 'Sample Industry P1 Feasibility Demo',
        'subheadline': 'Test our AI-powered document classification and extraction engine live.',
        'demo_title': 'P1 Feasibility Sprint',
        'demo_description': 'Upload PDFs, images, or scanned documents to test extraction',
        'icon': None
    }
    
    try:
        return render_template('feasibility-preview.html', sector=sector_config)
    except:
        # Fallback: try to send as static file
        return send_file('feasibility-preview.html')

@app.route('/feasibility-preview', methods=['GET', 'POST'])
def feasibility_preview_redirect():
    """Redirect /feasibility-preview to /feasibility-preview.html preserving query params"""
    sector = request.args.get('sector', 'professional-services')
    return redirect(f'/feasibility-preview.html?sector={sector}', code=301)

# Legacy demo routes (301 redirects to new name)
@app.route('/demo.html')
def demo_html_legacy():
    """Legacy route - redirect to feasibility-preview.html"""
    return redirect('/feasibility-preview.html', code=301)

@app.route('/demo', methods=['GET', 'POST'])
def demo_legacy():
    """Legacy route - redirect to feasibility-preview.html"""
    return redirect('/feasibility-preview.html', code=301)

# Automater routes moved to routes/automater_routes.py

# Export routes moved to routes/export_routes.py


@app.route('/sample')
def view_sample():
    requested = request.args.get('path')
    if not requested or requested not in ALLOWED_SAMPLE_PATHS:
        abort(404)

    if not os.path.isfile(requested):
        abort(404)

    return send_file(requested)

# =============================================================================
# ROI CALCULATOR BLUEPRINT REGISTRATION
# =============================================================================

# Import ROI calculator routes BEFORE running the app
try:
    from roi_calculator_flask import roi_app as roi_calculator_app
    # Mount ROI calculator at /roi-calculator (with trailing slash support)
    app.register_blueprint(roi_calculator_app, url_prefix='/roi-calculator')
    print("ROI Calculator blueprint registered successfully at /roi-calculator")
except ImportError as e:
    print(f"Warning: Could not import ROI calculator: {e}")
    import traceback
    traceback.print_exc()
except Exception as e:
    print(f"Error registering ROI calculator: {e}")
    import traceback
    traceback.print_exc()

if __name__ == '__main__':
    # This allows local testing
    app.run(debug=True, port=5000)