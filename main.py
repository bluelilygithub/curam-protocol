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

# Services logic
from services.validation_service import detect_low_confidence, correct_ocr_errors, validate_engineering_field
from utils.formatting import format_currency, format_text_to_html
from services.pdf_service import extract_text, prepare_prompt_text
from services.gemini_service import get_available_models, build_prompt, analyze_gemini
from services.rag_service import perform_rag_search
from routes.static_pages import static_pages_bp

# Config constants
from config import (
    SECRET_KEY, FINANCE_UPLOAD_DIR, DEFAULT_DEPARTMENT, DEPARTMENT_SAMPLES,
    SAMPLE_TO_DEPT, ALLOWED_SAMPLE_PATHS, ROUTINE_DESCRIPTIONS, ROUTINE_SUMMARY,
    ENGINEERING_PROMPT_LIMIT, FINANCE_FIELDS, LOGISTICS_FIELDS
)

app = Flask(__name__, static_folder='assets', static_url_path='/assets')
app.secret_key = SECRET_KEY
app.register_blueprint(static_pages_bp)

# =============================================================================
# UI TEMPLATE (Restored Elite HTML)
# =============================================================================
HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Consultancy Takeoff Automator</title>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Montserrat', sans-serif; max-width: 1200px; margin: 20px auto; padding: 20px; background: #F8F9FA; color: #4B5563; }
        .container { background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #0B1221; border-bottom: 2px solid #D4AF37; padding-bottom: 10px; }
        .toggle-group { display: flex; gap: 15px; margin-bottom: 20px; }
        .btn { background: #D4AF37; color: #0B1221; font-weight: 700; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; text-decoration: none; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th { background: #0B1221; color: white; padding: 10px; text-align: left; }
        td { border: 1px solid #ddd; padding: 10px; font-size: 13px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>⚡ Consultancy Takeoff Automator</h1>
        <form method="post" enctype="multipart/form-data">
            <div class="toggle-group">
                {% for dept in ['finance', 'engineering', 'transmittal', 'logistics'] %}
                <label><input type="radio" name="department" value="{{ dept }}" {% if department == dept %}checked{% endif %} onchange="this.form.submit()"> {{ dept|capitalize }}</label>
                {% endfor %}
            </div>
            <div class="sample-group">
                <strong>{{ sample_files[department].label }}</strong>
                {% for sample in sample_files[department].samples %}
                <label style="display: block;"><input type="checkbox" name="samples" value="{{ sample.path }}" {% if sample.path in selected_samples %}checked{% endif %}> {{ sample.label }}</label>
                {% endfor %}
            </div>
            <button type="submit" class="btn">🚀 Generate Output</button>
        </form>

        {% if results %}
        <h3>Extraction Results ({{ department|capitalize }})</h3>
        <table>
            <thead>
                <tr>
                    {% if department == 'logistics' %}
                        <th>Type</th><th>Document #</th><th>Shipper</th><th>Cargo</th><th>Weight</th><th>Container</th>
                    {% elif department == 'engineering' %}
                        <th>Mark</th><th>Size</th><th>Qty</th><th>Length</th><th>Grade</th><th>Comments</th>
                    {% else %}
                        <th>Vendor</th><th>Date</th><th>Invoice #</th><th>Total</th><th>Summary</th>
                    {% endif %}
                </tr>
            </thead>
            <tbody>
                {% for row in results %}
                <tr>
                    {% if department == 'logistics' %}
                        <td>{{ row.DocumentType }}</td><td>{{ row.DocumentNumber }}</td><td>{{ row.Shipper }}</td><td>{{ row.CargoDescription }}</td><td>{{ row.GrossWeight }}</td><td>{{ row.Container }}</td>
                    {% elif department == 'engineering' %}
                        <td>{{ row.Mark }}</td><td>{{ row.Size }}</td><td>{{ row.Qty }}</td><td>{{ row.Length }}</td><td>{{ row.Grade }}</td><td>{{ row.Comments }}</td>
                    {% else %}
                        <td>{{ row.Vendor }}</td><td>{{ row.Date }}</td><td>{{ row.InvoiceNum }}</td><td>{{ row.FinalAmountFormatted }}</td><td>{{ row.Summary }}</td>
                    {% endif %}
                </tr>
                {% endfor %}
            </tbody>
        </table>
        {% endif %}
    </div>
</body>
</html>
"""

# =============================================================================
# RESTORED FEASIBILITY PREVIEW ROUTES
# =============================================================================

@app.route('/feasibility-preview.html')
def feasibility_preview_html():
    sector_slug = request.args.get('sector', 'professional-services')
    sector_config = {'name': sector_slug.replace('-', ' ').title(), 'slug': sector_slug}
    
    try:
        db_config = get_sector_demo_config(sector_slug)
        if db_config: sector_config.update(db_config)
    except: pass

    try:
        return render_template('feasibility-preview.html', sector=sector_config)
    except:
        return send_from_directory(os.getcwd(), 'feasibility-preview.html')

@app.route('/feasibility-preview')
def feasibility_preview_redirect():
    return redirect(url_for('feasibility_preview_html', sector=request.args.get('sector', 'professional-services')))

# =============================================================================
# AUTOMATER ENGINE
# =============================================================================

@app.route('/automater', methods=['GET', 'POST'])
def automater():
    return index_automater()

def index_automater():
    department = request.form.get('department') or request.args.get('department') or DEFAULT_DEPARTMENT
    selected_samples = request.form.getlist('samples')
    results = []
    
    if request.method == 'POST' and selected_samples:
        for sample_path in selected_samples:
            if not os.path.exists(sample_path): continue
            
            is_image = any(sample_path.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png'])
            text_content = f"[IMAGE_FILE:{sample_path}]" if is_image else extract_text(sample_path)
            
            entries, _, model, _, _, sched = analyze_gemini(text_content, department)
            if entries:
                for entry in entries:
                    entry['Filename'] = os.path.basename(sample_path)
                    if department == "finance":
                        v = entry.get('FinalAmount') or entry.get('Total')
                        entry['FinalAmountFormatted'] = format_currency(v) if v else "N/A"
                results.extend(entries)

    # Database Sample Sync
    db_samples = {}
    for d in ['finance', 'engineering', 'transmittal', 'logistics']:
        try:
            s = get_samples_for_template(d)
            if s: db_samples[d] = {"label": f"Sample {d.capitalize()}", "samples": s}
        except: pass
    
    merged_samples = {**DEPARTMENT_SAMPLES, **db_samples}

    return render_template_string(
        HTML_TEMPLATE, results=results, department=department,
        selected_samples=selected_samples, sample_files=merged_samples,
        routine_descriptions=ROUTINE_DESCRIPTIONS,
        routine_summary=ROUTINE_SUMMARY.get(department, [])
    )

# =============================================================================
# ROI CALCULATOR SYNC
# =============================================================================
try:
    from roi_calculator_flask import roi_app as roi_calculator_app
    app.register_blueprint(roi_calculator_app, url_prefix='/roi-calculator')
except: pass

if __name__ == '__main__':
    app.run(debug=True, port=5000)