import os
from flask import Flask, request, render_template, send_file, abort, redirect
from flask_compress import Compress
import google.generativeai as genai

# Phase 4.1: Static Pages Blueprint
from routes.static_pages import static_pages_bp

# Phase 4.2: Automater Routes Blueprint
from routes.automater_routes import automater_bp

# Phase 4.3: Export Routes Blueprint
from routes.export_routes import export_bp

# Phase 4.4: API Routes Blueprint
from routes.api_routes import api_bp

# Import configuration
from config import (
    SECRET_KEY,
    FINANCE_UPLOAD_DIR
)

# Import sample loader utility
from utils.sample_loader import get_allowed_sample_paths

app = Flask(__name__, static_folder='assets', static_url_path='/assets')
app.secret_key = SECRET_KEY

# Performance: Enable Gzip/Brotli compression
Compress(app)

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

# Configure UTF-8 encoding sanitization for corrupt characters
from utils.encoding_fix import create_safe_template_filter

# Add Jinja2 filter for automatic sanitization in templates
app.jinja_env.filters['sanitize'] = create_safe_template_filter()

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
    # Use sample_loader to get allowed paths (supports database override)
    allowed_paths = get_allowed_sample_paths(use_database=False)
    if not requested or requested not in allowed_paths:
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