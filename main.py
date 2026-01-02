import os
import json
import re
import time
import io
import pandas as pd
import requests
from flask import Flask, request, render_template, render_template_string, session, Response, send_file, abort, url_for, send_from_directory, redirect, jsonify
from werkzeug.utils import secure_filename
import google.generativeai as genai

# Import database and service layers
from database import (
    get_samples_for_template,
    get_sector_demo_config
)
from services.pdf_service import extract_text
from services.gemini_service import analyze_gemini
from utils.formatting import format_currency

# Configuration
from config import (
    SECRET_KEY, FINANCE_UPLOAD_DIR, DEFAULT_DEPARTMENT, 
    DEPARTMENT_SAMPLES, ROUTINE_DESCRIPTIONS, ROUTINE_SUMMARY
)

app = Flask(__name__, static_folder='assets', static_url_path='/assets')
app.secret_key = SECRET_KEY

# =============================================================================
# ELITE UI TEMPLATE (Full Logic & Styles)
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
        body { font-family: 'Montserrat', sans-serif; max-width: 1200px; margin: 20px auto; padding: 20px; background: #F8F9FA; color: #4B5563; line-height: 1.5; }
        .container { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
        h1 { color: #0B1221; font-weight: 800; border-bottom: 3px solid #D4AF37; padding-bottom: 12px; margin-top: 0; display: flex; align-items: center; gap: 10px; }
        
        /* Interactive Radio Buttons */
        .toggle-group { display: flex; gap: 12px; margin-bottom: 25px; flex-wrap: wrap; }
        .dept-label { cursor: pointer; padding: 12px 20px; background: #f1f5f9; border-radius: 8px; font-weight: 700; transition: all 0.3s ease; border: 2px solid transparent; color: #64748b; }
        .dept-label:hover { background: #e2e8f0; }
        .dept-label.active { background: #D4AF37; color: #0B1221; border-color: #B8941F; box-shadow: 0 4px 6px rgba(212, 175, 55, 0.2); }
        .dept-label input { display: none; }

        /* Dynamic Sections */
        .sample-group { display: none; padding: 20px; background: #f8fafc; border-radius: 10px; margin-bottom: 20px; border: 1px solid #e2e8f0; animation: fadeIn 0.4s ease; }
        .sample-group.active { display: block; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

        /* Tables */
        .table-container { overflow-x: auto; margin-top: 25px; border-radius: 8px; border: 1px solid #e2e8f0; }
        table { width: 100%; border-collapse: collapse; background: white; }
        th { background: #0B1221; color: white; padding: 14px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; position: sticky; top: 0; }
        td { border-bottom: 1px solid #f1f5f9; padding: 12px 10px; font-size: 13px; vertical-align: top; }
        tr:hover { background-color: #fcfcfc; }
        
        /* Line Item Styling */
        .line-item-row { background-color: #f0f9ff !important; font-size: 12px; }
        .line-item-indicator { color: #3b82f6; font-weight: bold; margin-right: 5px; }

        /* Button & Loader */
        .btn { background: #0B1221; color: #D4AF37; font-weight: 700; border: none; padding: 14px 28px; border-radius: 8px; cursor: pointer; transition: all 0.3s; font-size: 15px; }
        .btn:hover { background: #1a2332; transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
        #processing-spinner { display: none; margin-top: 20px; padding: 15px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; color: #92400e; font-weight: 600; text-align: center; }
    </style>
</head>
<body>
    <div class="container">
        <h1>⚡ Consultancy Takeoff Automator</h1>
        
        <form id="automater-form" method="post" enctype="multipart/form-data">
            <h3>1. Select Department</h3>
            <div class="toggle-group">
                {% for dept in ['finance', 'engineering', 'transmittal', 'logistics'] %}
                <label class="dept-label {% if department == dept %}active{% endif %}" id="label-{{ dept }}">
                    <input type="radio" name="department" value="{{ dept }}" {% if department == dept %}checked{% endif %} onchange="switchDept('{{ dept }}')">
                    {{ dept|capitalize }} Sector
                </label>
                {% endfor %}
            </div>

            <h3>2. Select Sample Files</h3>
            {% for dept_key, group in sample_files.items() %}
            <div class="sample-group {% if department == dept_key %}active{% endif %}" id="group-{{ dept_key }}">
                <strong>{{ group.label }}</strong>
                <p style="font-size: 12px; color: #64748b; margin-bottom: 15px;">{{ group.description }}</p>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px;">
                    {% for sample in group.samples %}
                    <label style="display: flex; align-items: center; gap: 8px; padding: 8px; background: white; border: 1px solid #e2e8f0; border-radius: 6px; cursor: pointer;">
                        <input type="checkbox" name="samples" value="{{ sample.path }}" {% if sample.path in selected_samples %}checked{% endif %}>
                        <span style="font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ sample.label }}</span>
                    </label>
                    {% endfor %}
                </div>
                {% if dept_key == 'finance' %}
                <div style="margin-top: 20px; padding-top: 15px; border-top: 1px dashed #cbd5e1;">
                    <label><strong>📁 Upload Project Invoices:</strong></label><br>
                    <input type="file" name="finance_uploads" multiple style="margin-top: 8px;">
                </div>
                {% endif %}
            </div>
            {% endfor %}

            <button type="submit" class="btn" id="submit-btn">🚀 Run Full Extraction</button>
            <div id="processing-spinner">
                <span style="display:block; margin-bottom: 5px;">⚙️ AI Engine: Analyzing all selected documents...</span>
                <small>This may take 15-30 seconds depending on volume.</small>
            </div>
        </form>

        {% if results %}
        <div class="results-header" style="margin-top: 40px; display: flex; justify-content: space-between; align-items: center;">
            <h2 style="margin: 0;">Extraction Results</h2>
            <a href="/export_csv" class="btn" style="padding: 8px 16px; font-size: 12px;">📥 CSV Export</a>
        </div>
        
        <div class="table-container">
        <table>
            <thead>
                <tr>
                    {% if department == 'logistics' %}
                        <th>Doc Type</th><th>ID Number</th><th>Shipper</th><th>Consignee</th><th>Description</th><th>Weight</th><th>Container</th>
                    {% elif department == 'engineering' %}
                        <th>Mark</th><th>Size</th><th>Qty</th><th>Length</th><th>Grade</th><th>Comments</th>
                    {% elif department == 'finance' %}
                        <th>Vendor</th><th>Date</th><th>Invoice #</th><th>Total</th><th>Summary</th>
                    {% else %}
                        <th>Filename</th><th>Status</th>
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
                        <td>{{ row.Vendor }}</td><td>{{ row.Date }}</td><td>{{ row.InvoiceNum }}</td><td><strong>{{ row.FinalAmountFormatted }}</strong></td><td>{{ row.Summary }}</td>
                    {% else %}
                        <td>{{ row.Filename }}</td><td>✅ Extracted</td>
                    {% endif %}
                </tr>
                {% if department == 'finance' and row.LineItems %}
                    {% for item in row.LineItems %}
                    <tr class="line-item-row">
                        <td colspan="2" style="text-align:right;"><span class="line-item-indicator">↳</span> Line {{ loop.index }}:</td>
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
        {% endif %}
    </div>

    <script>
        // FIXED: The interactive switching logic
        function switchDept(dept) {
            // Hide all sections
            document.querySelectorAll('.sample-group').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.dept-label').forEach(el => el.classList.remove('active'));
            
            // Show active section
            document.getElementById('group-' + dept).classList.add('active');
            document.getElementById('label-' + dept).classList.add('active');
        }

        // FIXED: Run Report Button Logic
        document.getElementById('automater-form').addEventListener('submit', function() {
            const btn = document.getElementById('submit-btn');
            btn.style.opacity = '0.5';
            btn.style.pointerEvents = 'none';
            btn.innerText = 'AI Analysis in Progress...';
            document.getElementById('processing-spinner').style.display = 'block';
        });
    </script>
</body>
</html>
"""

# =============================================================================
# APPLICATION ROUTES
# =============================================================================

@app.route('/feasibility-preview.html')
def feasibility_preview_html():
    sector_slug = request.args.get('sector', 'professional-services')
    sector_config = {'name': sector_slug.replace('-', ' ').title(), 'slug': sector_slug}
    try:
        db_config = get_sector_demo_config(sector_slug)
        if db_config: sector_config.update(db_config)
    except: pass
    return render_template('feasibility-preview.html', sector=sector_config)

@app.route('/automater', methods=['GET', 'POST'])
def automater():
    return index_automater()

def index_automater():
    department = request.form.get('department') or request.args.get('department') or DEFAULT_DEPARTMENT
    selected_samples = request.form.getlist('samples')
    results = []
    
    if request.method == 'POST':
        # Handle Finance Uploads
        if department == 'finance':
            uploaded_files = request.files.getlist('finance_uploads')
            for f in uploaded_files:
                if f and f.filename:
                    filename = secure_filename(f.filename)
                    file_path = os.path.join(FINANCE_UPLOAD_DIR, f"{int(time.time())}_{filename}")
                    f.save(file_path)
                    selected_samples.append(file_path)

        # CORE LOOP: Process EVERY checked item (No limit)
        for path in selected_samples:
            if not os.path.exists(path): continue
            
            is_image = any(path.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png'])
            text_input = f"[IMAGE_FILE:{path}]" if is_image else extract_text(path)
            
            # API Call
            entries, _, _, _, _, _ = analyze_gemini(text_input, department)
            
            if entries:
                for entry in entries:
                    entry['Filename'] = os.path.basename(path)
                    if department == "finance":
                        val = entry.get('FinalAmount') or entry.get('Total')
                        entry['FinalAmountFormatted'] = format_currency(val) if val else "N/A"
                results.extend(entries)

    # UI Preparation
    db_samples = {}
    for d in ['finance', 'engineering', 'transmittal', 'logistics']:
        try:
            s = get_samples_for_template(d)
            if s: db_samples[d] = {"label": f"Available {d.capitalize()} Samples", "description": f"Target documents for {d} sector.", "samples": s}
        except: pass
    
    final_sample_files = {**DEPARTMENT_SAMPLES, **db_samples}
    # Ensure logistics exists in the dict even if DB is empty
    if 'logistics' not in final_sample_files:
        final_sample_files['logistics'] = {"label": "Logistics Samples", "description": "Shipping documents.", "samples": []}

    return render_template_string(
        HTML_TEMPLATE, results=results, department=department,
        selected_samples=selected_samples, sample_files=final_sample_files
    )

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