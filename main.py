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

# Services
from services.validation_service import detect_low_confidence, correct_ocr_errors, validate_engineering_field
from utils.formatting import format_currency, format_text_to_html
from services.pdf_service import extract_text, prepare_prompt_text
from services.gemini_service import get_available_models, build_prompt, analyze_gemini
from services.rag_service import perform_rag_search
from routes.static_pages import static_pages_bp

# Configuration
from config import (
    SECRET_KEY, FINANCE_UPLOAD_DIR, DEFAULT_DEPARTMENT, DEPARTMENT_SAMPLES,
    SAMPLE_TO_DEPT, ALLOWED_SAMPLE_PATHS, ROUTINE_DESCRIPTIONS, ROUTINE_SUMMARY,
    ENGINEERING_PROMPT_LIMIT, FINANCE_FIELDS, LOGISTICS_FIELDS
)

app = Flask(__name__, static_folder='assets', static_url_path='/assets')
app.secret_key = SECRET_KEY
app.register_blueprint(static_pages_bp)

# =============================================================================
# RESTORED ELITE UI TEMPLATE (Full CSS & Responsive Design)
# =============================================================================
HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Consultancy Takeoff Automator</title>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Montserrat', sans-serif; max-width: 1200px; margin: 20px auto; padding: 20px; background: #F8F9FA; color: #4B5563; font-size: 14px; }
        .container { background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #0B1221; font-weight: 700; border-bottom: 2px solid #D4AF37; padding-bottom: 10px; margin-top: 0; }
        .toggle-group { display: flex; gap: 15px; margin-bottom: 20px; flex-wrap: wrap; }
        .toggle-group label { cursor: pointer; font-weight: 600; padding: 8px 15px; background: #f1f5f9; border-radius: 6px; transition: 0.3s; }
        .toggle-group input:checked + span { color: #0B1221; }
        .toggle-group label:has(input:checked) { background: #D4AF37; color: #0B1221; }
        .toggle-group input { display: none; }
        .sample-group { padding: 15px; background: #eef2ff; border-radius: 6px; margin-bottom: 15px; border: 1px solid #cbd5e1; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        th { background: #0B1221; color: white; padding: 12px 8px; text-align: left; text-transform: uppercase; letter-spacing: 0.5px; }
        td { border: 1px solid #ddd; padding: 10px 8px; }
        tr:nth-child(even) { background-color: #f9f9f9; }
        .btn { background: #D4AF37; color: #0B1221; font-weight: 700; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; text-decoration: none; display: inline-block; transition: 0.3s; }
        .btn:hover { background: #B8941F; transform: translateY(-1px); }
        .line-item-row { background-color: #f0f9ff !important; font-size: 12px; }
        .error { color: #dc2626; background: #fee2e2; padding: 10px; border-radius: 6px; margin-bottom: 15px; font-weight: 600; }
    </style>
</head>
<body>
    <div class="container">
        <h1>⚡ Consultancy Takeoff Automator</h1>
        {% if error %}<div class="error">{{ error }}</div>{% endif %}

        <form method="post" enctype="multipart/form-data">
            <div class="toggle-group">
                {% for dept in ['finance', 'engineering', 'transmittal', 'logistics'] %}
                <label>
                    <input type="radio" name="department" value="{{ dept }}" {% if department == dept %}checked{% endif %} onchange="this.form.submit()">
                    <span>{{ dept|capitalize }} Dept</span>
                </label>
                {% endfor %}
            </div>

            <div class="sample-group">
                <strong>{{ sample_files[department].label if department in sample_files else "Available Samples" }}</strong>
                <div style="margin-top: 10px;">
                    {% if department in sample_files %}
                        {% for sample in sample_files[department].samples %}
                        <label style="display: block; margin-bottom: 6px; cursor: pointer;">
                            <input type="checkbox" name="samples" value="{{ sample.path }}" {% if sample.path in selected_samples %}checked{% endif %}>
                            {{ sample.label }}
                        </label>
                        {% endfor %}
                    {% else %}
                        <p>No samples found for this department in DB.</p>
                    {% endif %}
                </div>
                {% if department == 'finance' %}
                <div style="margin-top: 15px; border-top: 1px dashed #cbd5e1; padding-top: 10px;">
                    <label><strong>Upload custom PDFs:</strong></label><br>
                    <input type="file" name="finance_uploads" multiple style="margin-top:5px;">
                </div>
                {% endif %}
            </div>

            <button type="submit" class="btn">🚀 Run AI Extraction</button>
        </form>

        {% if results %}
        <hr style="margin:30px 0; border: 0; border-top: 1px solid #e2e8f0;">
        <h3>AI Extraction Results: {{ department|capitalize }}</h3>
        
        <div style="overflow-x: auto;">
        <table>
            <thead>
                <tr>
                    {% if department == 'logistics' %}
                        <th>Doc Type</th><th>Doc Number</th><th>Shipper</th><th>Cargo</th><th>Weight</th><th>Container</th>
                    {% elif department == 'engineering' %}
                        <th>Mark</th><th>Size</th><th>Qty</th><th>Length</th><th>Grade</th><th>Comments</th>
                    {% elif department == 'finance' %}
                        <th>Vendor</th><th>Date</th><th>Invoice #</th><th>Total</th><th>Summary</th>
                    {% else %}
                        <th>Filename</th><th>Data</th>
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
                    {% elif department == 'finance' %}
                        <td>{{ row.Vendor }}</td><td>{{ row.Date }}</td><td>{{ row.InvoiceNum }}</td><td><strong>{{ row.FinalAmountFormatted }}</strong></td><td>{{ row.Summary }}</td>
                    {% else %}
                        <td>{{ row.Filename }}</td><td>Extracted</td>
                    {% endif %}
                </tr>
                {% if department == 'finance' and row.LineItems %}
                    {% for item in row.LineItems %}
                    <tr class="line-item-row">
                        <td colspan="2" style="text-align:right; color:#64748b;">Line Item {{ loop.index }}:</td>
                        <td colspan="2">{{ item.Description }}</td>
                        <td>{{ item.Quantity }} x {{ item.UnitPrice }}</td>
                        <td><strong>{{ item.LineTotal }}</strong></td>
                    </tr>
                    {% endfor %}
                {% endif %}
                {% endfor %}
            </tbody>
        </table>
        </div>
        
        <div style="margin-top: 20px;">
            <a href="/export_csv" class="btn" style="background:#0B1221; color:#D4AF37;">📥 Export to CSV</a>
        </div>
        {% endif %}
    </div>
</body>
</html>
"""

# =============================================================================
# FEASIBILITY & AUTOMATER ENGINE
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

@app.route('/automater', methods=['GET', 'POST'])
def automater():
    return index_automater()

def index_automater():
    department = request.form.get('department') or request.args.get('department') or DEFAULT_DEPARTMENT
    selected_samples = request.form.getlist('samples')
    results = []
    error_message = None
    last_model_used = None
    
    if request.method == 'POST':
        # Handle Finance Uploads
        if department == 'finance':
            uploaded_files = request.files.getlist('finance_uploads')
            for file_storage in uploaded_files:
                if file_storage and file_storage.filename:
                    filename = secure_filename(file_storage.filename)
                    file_path = os.path.join(FINANCE_UPLOAD_DIR, f"{int(time.time())}_{filename}")
                    file_storage.save(file_path)
                    selected_samples.append(file_path)

        if not selected_samples:
            error_message = "Please select at least one file to analyze."
        else:
            # PROCESS ALL SELECTED RECORDS (Removed the 'First 3' limit)
            for sample_path in selected_samples:
                if not os.path.exists(sample_path): continue
                
                is_image = any(sample_path.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png'])
                text_content = f"[IMAGE_FILE:{sample_path}]" if is_image else extract_text(sample_path)
                
                entries, api_err, model, _, _, sched = analyze_gemini(text_content, department)
                
                if entries:
                    for entry in entries:
                        entry['Filename'] = os.path.basename(sample_path)
                        if department == "finance":
                            v = entry.get('FinalAmount') or entry.get('Total')
                            entry['FinalAmountFormatted'] = format_currency(v) if v else "N/A"
                    results.extend(entries)
                    last_model_used = model
                if api_err: error_message = api_err

    # Database Sample Sync for the UI
    db_samples = {}
    for d in ['finance', 'engineering', 'transmittal', 'logistics']:
        try:
            s = get_samples_for_template(d)
            if s:
                db_samples[d] = {"label": f"Sample {d.capitalize()} Documents", "samples": s}
        except: pass
    
    merged_samples = {**DEPARTMENT_SAMPLES, **db_samples}
    # Ensure logistics exists in merged_samples even if DB is empty to avoid Jinja crash
    if 'logistics' not in merged_samples:
        merged_samples['logistics'] = {"label": "Logistics Samples", "samples": []}

    return render_template_string(
        HTML_TEMPLATE, results=results, department=department,
        selected_samples=selected_samples, sample_files=merged_samples,
        error=error_message, routine_descriptions=ROUTINE_DESCRIPTIONS,
        routine_summary=ROUTINE_SUMMARY.get(department, []),
        model_in_use=last_model_used
    )

# ROI Calculator Mount
try:
    from roi_calculator_flask import roi_app as roi_calculator_app
    app.register_blueprint(roi_calculator_app, url_prefix='/roi-calculator')
except: pass

if __name__ == '__main__':
    app.run(debug=True, port=5000)