import os
from flask import Flask, request, render_template, send_file, abort, redirect
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
    FINANCE_UPLOAD_DIR,
    ALLOWED_SAMPLE_PATHS
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


# =============================================================================
# API ROUTES
# =============================================================================
# API routes moved to routes/api_routes.py

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