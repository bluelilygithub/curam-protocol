from dotenv import load_dotenv
load_dotenv()

import os
from flask import Flask, request, render_template, send_file, abort, redirect
from flask_compress import Compress
from flask_wtf.csrf import CSRFProtect

# Phase 4.1: Static Pages Blueprint
from routes.static_pages import static_pages_bp

# Phase 4.2: Automater Routes Blueprint
from routes.automater_routes import automater_bp

# Phase 4.3: Export Routes Blueprint
from routes.export_routes import export_bp

# Phase 4.4: API Routes Blueprint
from routes.api_routes import api_bp

# Admin Panel Blueprint
from routes.admin_routes import admin_bp

# Import configuration
from config import (
    SECRET_KEY,
    FINANCE_UPLOAD_DIR
)

# Import sample loader utility
from utils.sample_loader import get_allowed_sample_paths

# Database seeding
from database import engine
from services.db_seeder import run_seeder

app = Flask(__name__, static_folder='assets', static_url_path='/assets')

# Seed database on startup if tables are empty
run_seeder(engine)
app.secret_key = SECRET_KEY

# Security: Enable CSRF protection
csrf = CSRFProtect(app)

# Performance: Enable Gzip/Brotli compression
Compress(app)

# Production: Force HTTPS and redirect apex to www
@app.before_request
def redirect_and_force_https():
    """Redirect HTTP to HTTPS and apex domain to www"""
    # Skip for local development
    if request.host.startswith('localhost') or request.host.startswith('127.0.0.1'):
        return None
    
    # Force HTTPS
    if not request.is_secure and request.headers.get('X-Forwarded-Proto') != 'https':
        url = request.url.replace('http://', 'https://', 1)
        return redirect(url, code=301)
    
    # Redirect apex domain to www
    if request.host == 'curam-ai.com.au':
        return redirect('https://www.curam-ai.com.au' + request.full_path, code=301)
    
    return None

# Performance: Add caching headers for static assets with versioning
# Version number - increment when static assets change
STATIC_ASSETS_VERSION = "1.0.0"

@app.context_processor
def inject_version():
    """Inject version number into templates for cache busting"""
    return {'static_version': STATIC_ASSETS_VERSION}

@app.after_request
def add_cache_headers(response):
    """Add appropriate cache headers based on file type"""
    if request.endpoint == 'static' or request.path.startswith('/assets/'):
        # CSS and JS files - cache for 1 year (with versioning in URL)
        if request.path.endswith(('.css', '.js')):
            response.cache_control.max_age = 31536000  # 1 year
            response.cache_control.public = True
            response.cache_control.immutable = True  # Indicates file won't change
        # Images - cache for 6 months
        elif request.path.endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico')):
            response.cache_control.max_age = 15552000  # 6 months
            response.cache_control.public = True
        # Videos - cache for 1 month (large files)
        elif request.path.endswith(('.mp4', '.webm', '.mov')):
            response.cache_control.max_age = 2592000  # 1 month
            response.cache_control.public = True
        # Fonts - cache for 1 year
        elif request.path.endswith(('.woff', '.woff2', '.ttf', '.otf', '.eot')):
            response.cache_control.max_age = 31536000  # 1 year
            response.cache_control.public = True
            response.cache_control.immutable = True
        # Other static files - cache for 1 hour
        else:
            response.cache_control.max_age = 3600  # 1 hour
            response.cache_control.public = True
    
    # Add security headers
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    
    return response

# Register blueprints
app.register_blueprint(static_pages_bp)
app.register_blueprint(automater_bp)
app.register_blueprint(export_bp)
app.register_blueprint(api_bp)
app.register_blueprint(admin_bp)  # Admin panel (separate, doesn't modify existing code)

# Exempt routes from CSRF (they're used by external clients/AJAX/file uploads)
csrf.exempt(api_bp)
csrf.exempt(automater_bp)
csrf.exempt(export_bp)

# Configure UTF-8 encoding sanitization for corrupt characters
from utils.encoding_fix import create_safe_template_filter

# Add Jinja2 filter for automatic sanitization in templates
app.jinja_env.filters['sanitize'] = create_safe_template_filter()

# Error handlers
@app.errorhandler(404)
def page_not_found(error):
    """Custom 404 error page"""
    return render_template('404.html'), 404

@app.errorhandler(500)
def internal_error(error):
    """Show detailed error message for debugging"""
    import traceback
    trace = traceback.format_exc()
    app.logger.error(f"500 Internal Server Error:\n{trace}")
    if app.debug:
        return f"<pre>Internal Server Error:\n\n{trace}</pre>", 500
    return "Internal Server Error. Please check the logs.", 500

# Create upload directories
os.makedirs(FINANCE_UPLOAD_DIR, exist_ok=True)


# =============================================================================
# API ROUTES
# =============================================================================
# API routes moved to routes/api_routes.py

# =============================================================================
# AUTOMATER & DEMO ROUTES
# =============================================================================

# Feasibility Preview HTML page with iframe (serves feasibility-preview.html)
@app.route('/feasibility-preview.html')
def feasibility_preview_html():
    """Serve feasibility-preview.html page with iframe to automater"""
    sector_slug = request.args.get('sector', 'professional-services')
    
    # Map sector slug to department and metadata
    sector_mapping = {
        'professional-services': {
            'dept': 'finance',
            'name': 'Professional Services',
            'headline': 'AI Document Automation for Professional Services',
            'subheadline': 'Extract structured data from invoices, receipts, and professional forms with 95%+ accuracy.',
            'demo_title': 'P1 Feasibility Sprint',
            'demo_description': 'Upload finance documents to test extraction',
            'icon': '💼'
        },
        'logistics-compliance': {
            'dept': 'logistics',
            'name': 'Logistics & Compliance',
            'headline': 'Trade & Logistics Document Extraction',
            'subheadline': 'Automate FTA lists, Bills of Lading, and Packing Lists processing.',
            'demo_title': 'Logistics Feasibility Demo',
            'demo_description': 'Test extraction on trade and shipping documents',
            'icon': '📦'
        },
        'built-environment': {
            'dept': 'engineering',
            'name': 'Built Environment',
            'headline': 'Engineering & Construction Data Extraction',
            'subheadline': 'Extract beam schedules and technical specs from structural drawings.',
            'demo_title': 'Engineering Feasibility Demo',
            'demo_description': 'Test extraction on technical engineering schedules',
            'icon': '🏗️'
        }
    }
    
    sector_config = sector_mapping.get(sector_slug, sector_mapping['professional-services'])
    department = sector_config['dept']
    
    return render_template('feasibility-preview.html', 
                         sector=sector_config, 
                         department=department,
                         sector_slug=sector_slug)

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
    # Log the exact raw path for debugging
    raw_path = request.args.get('path', '')
    app.logger.info(f"Sample request raw path: {raw_path}")
    
    # Re-construct the full path from all arguments to handle ampersands correctly
    # Flask's request.args.get('path') stops at the first '&'
    full_query = request.query_string.decode('utf-8')
    requested = ""
    if 'path=' in full_query:
        requested = full_query.split('path=', 1)[1]
    else:
        requested = raw_path

    if not requested:
        abort(404)

    # Clean the requested path to handle URL encoding
    from urllib.parse import unquote
    requested = unquote(requested)
    app.logger.info(f"Sample request unquoted path: {requested}")

    # Allow direct links to curam-ai.com.au domain for samples
    if requested.startswith(('http://www.curam-ai.com.au', 'https://www.curam-ai.com.au')):
        try:
            from urllib.parse import urlparse, parse_qs
            parsed = urlparse(requested)
            if parsed.path == '/sample':
                # Extract path from query string of the nested URL
                if parsed.query and 'path=' in parsed.query:
                    requested = unquote(parsed.query.split('path=', 1)[1])
            else:
                if '/samples/' in requested:
                    requested = 'samples/' + requested.split('/samples/', 1)[1]
        except Exception as e:
            app.logger.error(f"URL parsing error: {e}")

    # Use sample_loader to get allowed paths (supports database override)
    allowed_paths = get_allowed_sample_paths(use_database=False)
    
    # Final normalization: standardizing spaces and common special characters
    def normalize(p):
        return unquote(p).replace('+', ' ').strip()

    norm_requested = normalize(requested)
    
    found_path = None
    for path in allowed_paths:
        if normalize(path) == norm_requested:
            found_path = path
            break
    
    if not found_path:
        app.logger.warn(f"Path not found in allowed list: {norm_requested}")
        abort(404)

    if not os.path.isfile(found_path):
        app.logger.error(f"File exists in allowed list but not on disk: {found_path}")
        abort(404)

    return send_file(found_path)

# =============================================================================
# ROI CALCULATOR BLUEPRINT REGISTRATION
# =============================================================================

# Import ROI calculator routes BEFORE running the app
try:
    from roi_calculator_flask import roi_app as roi_calculator_app
    # Mount ROI calculator at /roi-calculator (with trailing slash support)
    app.register_blueprint(roi_calculator_app, url_prefix='/roi-calculator')
    csrf.exempt(roi_calculator_app)  # Exempt from CSRF (uses AJAX)
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
    app.run(host='0.0.0.0', debug=True, port=5000)