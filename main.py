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

# Phase 3.1: Validation Service
from services.validation_service import (
    detect_low_confidence,
    correct_ocr_errors,
    validate_engineering_field
)

# Formatting utilities
from utils.formatting import format_currency, format_text_to_html

# Phase 3.2: PDF Service
from services.pdf_service import (
    extract_text,
    prepare_prompt_text
)

# Phase 3.3c: Gemini Service
from services.gemini_service import get_available_models, build_prompt, analyze_gemini

# Phase 3.4: RAG Search Service
from services.rag_service import (
    extract_text_from_html,
    calculate_authority_score,
    search_static_html_pages,
    perform_rag_search
)

# Phase 4.1: Static Pages Blueprint
from routes.static_pages import static_pages_bp

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

# Configure UTF-8 encoding sanitization
from utils.encoding_fix import create_safe_template_filter, sanitize_response_middleware
app.jinja_env.filters['sanitize'] = create_safe_template_filter()

# =============================================================================
# UI TEMPLATE (Navy & Gold Theme)
# =============================================================================
HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Consultancy Takeoff Automator</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Montserrat', sans-serif; max-width: 1200px; margin: 20px auto; padding: 20px; background: #F8F9FA; color: #4B5563; }
        .container { background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #0B1221; border-bottom: 2px solid #D4AF37; padding-bottom: 10px; }
        .toggle-group { display: flex; gap: 15px; margin-bottom: 20px; }
        .sample-group { padding: 15px; background: #EEF2FF; border-radius: 6px; margin-bottom: 15px; display: none; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
        th { background: #0B1221; color: white; padding: 12px; text-align: left; }
        td { border: 1px solid #ddd; padding: 10px; }
        tr:nth-child(even) { background-color: #f9f9f9; }
        .btn { background: #D4AF37; color: #0B1221; font-weight: 700; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; text-decoration: none; display: inline-block; }
        .error { color: #dc3545; font-weight: bold; }
        #processing-spinner { display: none; margin-top: 15px; color: #1d4ed8; font-weight: 600; }
    </style>
</head>
<body>
    <div class="container">
        <h1>⚡ Consultancy Takeoff Automator</h1>
        
        {% if error %}<p class="error">{{ error }}</p>{% endif %}

        <form method="post" enctype="multipart/form-data">
            <div class="toggle-group">
                {% for dept in ['finance', 'engineering', 'transmittal', 'logistics'] %}
                <label>
                    <input type="radio" name="department" value="{{ dept }}" {% if department == dept %}checked{% endif %} onchange="this.form.submit()">
                    {{ dept|capitalize }}
                </label>
                {% endfor %}
            </div>

            <div class="sample-group" style="display: block;">
                <strong>{{ sample_files[department].label }}</strong>
                <div style="margin-top: 10px;">
                    {% for sample in sample_files[department].samples %}
                    <label style="display: block; margin-bottom: 5px;">
                        <input type="checkbox" name="samples" value="{{ sample.path }}" {% if sample.path in selected_samples %}checked{% endif %}>
                        {{ sample.label }}
                    </label>
                    {% endfor %}
                </div>
                {% if department == 'finance' %}
                <div style="margin-top: 10px; border-top: 1px solid #ddd; padding-top: 10px;">
                    <input type="file" name="finance_uploads" multiple>
                </div>
                {% endif %}
            </div>

            <button type="submit" class="btn" onclick="document.getElementById('processing-spinner').style.display='block'">🚀 Generate Output</button>
            <div id="processing-spinner">Processing files...</div>
        </form>

        {% if results %}
        <hr>
        <h3>Results ({{ department|capitalize }})</h3>
        
        <div style="overflow-x: auto;">
        <table>
            <thead>
                <tr>
                    {% if department == 'logistics' %}
                        <th>Type</th><th>Number</th><th>Shipper</th><th>Consignee</th><th>Description</th><th>Weight</th><th>Container</th>
                    {% elif department == 'engineering' %}
                        <th>Mark</th><th>Size</th><th>Qty</th><th>Length</th><th>Grade</th><th>Comments</th>
                    {% elif department == 'finance' %}
                        <th>Vendor</th><th>Date</th><th>Invoice #</th><th>Total</th><th>Summary</th>
                    {% else %}
                        <th>Filename</th><th>Extraction</th>
                    {% endif %}
                </tr>
            </thead>
            <tbody>
                {% for row in results %}
                <tr>
                    {% if department == 'logistics' %}
                        <td>{{ row.DocumentType }}</td><td>{{ row.DocumentNumber }}</td><td>{{ row.Shipper }}</td><td>{{ row.Consignee }}</td><td>{{ row.CargoDescription }}</td><td>{{ row.GrossWeight }}</td><td>{{ row.Container }}</td>
                    {% elif department == 'engineering' %}
                        <td>{{ row.Mark }}</td><td>{{ row.Size }}</td><td>{{ row.Qty }}</td><td>{{ row.Length }}</td><td>{{ row.Grade }}</td><td>{{ row.Comments }}</td>
                    {% elif department == 'finance' %}
                        <td>{{ row.Vendor }}</td><td>{{ row.Date }}</td><td>{{ row.InvoiceNum }}</td><td>{{ row.FinalAmountFormatted }}</td><td>{{ row.Summary }}</td>
                    {% else %}
                        <td>{{ row.Filename }}</td><td>Extracted successfully</td>
                    {% endif %}
                </tr>
                {% endfor %}
            </tbody>
        </table>
        </div>
        
        <div style="margin-top: 20px;">
            <a href="/export_csv" class="btn">📥 Export to CSV</a>
        </div>
        {% endif %}
    </div>
</body>
</html>
"""

# =============================================================================
# AUTOMATER LOGIC
# =============================================================================

@app.route('/automater', methods=['GET', 'POST'])
@app.route('/extract', methods=['GET', 'POST'])
def automater():
    return index_automater()

def index_automater():
    department = request.form.get('department') or request.args.get('department') or DEFAULT_DEPARTMENT
    results = []
    error_message = None
    last_model_used = None
    model_attempts = []
    model_actions = []
    detected_schedule_type = None
    selected_samples = request.form.getlist('samples')

    if request.method == 'POST':
        finance_uploaded_paths = []
        
        # Handle file uploads for Finance
        if department == 'finance':
            uploaded_files = request.files.getlist('finance_uploads')
            for file_storage in uploaded_files:
                if file_storage and file_storage.filename:
                    filename = secure_filename(file_storage.filename)
                    unique_name = f"{int(time.time())}_{filename}"
                    file_path = os.path.join(FINANCE_UPLOAD_DIR, unique_name)
                    file_storage.save(file_path)
                    finance_uploaded_paths.append(file_path)
            selected_samples.extend(finance_uploaded_paths)

        # Process each selected file
        for sample_path in selected_samples:
            if not os.path.exists(sample_path):
                continue
            
            filename = os.path.basename(sample_path)
            file_ext = os.path.splitext(sample_path)[1].lower()
            is_image = file_ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp']
            
            image_path = sample_path if is_image else None
            text_content = f"[IMAGE_FILE:{sample_path}]" if is_image else extract_text(sample_path)

            if isinstance(text_content, str) and text_content.startswith("Error:"):
                error_message = text_content
                continue

            # Core AI Analysis Call
            sector_slug = request.args.get("sector", "professional-services")
            entries, api_error, model_used, attempts, logs, sched_type = analyze_gemini(
                text_content, department, image_path, sector_slug=sector_slug
            )

            if entries:
                for entry in entries:
                    entry['Filename'] = filename
                    # Apply finance formatting
                    if department == "finance":
                        final_val = entry.get('FinalAmount') or entry.get('Total')
                        entry['FinalAmountFormatted'] = format_currency(final_val) if final_val else "N/A"
                results.extend(entries)
                last_model_used = model_used
                model_actions.extend(logs)
                detected_schedule_type = sched_type

        if results:
            session['last_results'] = {"department": department, "rows": results, "schedule_type": detected_schedule_type}

    # Prepare sample list for UI
    db_samples = {}
    for dept_key in ['finance', 'engineering', 'transmittal', 'logistics']:
        try:
            samples = get_samples_for_template(dept_key)
            if samples:
                db_samples[dept_key] = {
                    "label": f"Sample {dept_key.capitalize()}",
                    "samples": samples
                }
        except:
            pass
    
    sample_files_merged = {**DEPARTMENT_SAMPLES, **db_samples}

    return render_template_string(
        HTML_TEMPLATE,
        results=results,
        department=department,
        selected_samples=selected_samples,
        sample_files=sample_files_merged,
        error=error_message,
        routine_descriptions=ROUTINE_DESCRIPTIONS,
        routine_summary=ROUTINE_SUMMARY.get(department, []),
        model_in_use=last_model_used,
        model_attempts=model_attempts,
        model_actions=model_actions,
        schedule_type=detected_schedule_type
    )

# (Rest of the helper routes remain unchanged...)
@app.route('/sample')
def view_sample():
    requested = request.args.get('path')
    if not requested or requested not in ALLOWED_SAMPLE_PATHS:
        abort(404)
    return send_file(requested)

@app.route('/export_csv')
def export_csv():
    saved = session.get('last_results')
    if not saved or not saved.get('rows'): return "No data", 404
    df = pd.DataFrame(saved['rows'])
    output = io.StringIO()
    df.to_csv(output, index=False)
    return Response(output.getvalue(), mimetype='text/csv', headers={'Content-Disposition': 'attachment; filename=results.csv'})

if __name__ == '__main__':
    app.run(debug=True, port=5000)