"""
Base HTML Template for Document Extraction UI

This template contains the base HTML structure, CSS styles, JavaScript,
and form elements for the document extraction interface.

The template includes placeholders for department-specific sections
which are injected at runtime from other template modules.
"""


def get_base_template():
    """
    Returns the base HTML template string
    
    This template includes:
    - CSS styles for all UI components
    - JavaScript for form handling and department switching
    - Base HTML structure (form, sample selection, error display)
    - Placeholders for department-specific table sections
    
    Returns:
        str: Complete Jinja2 template string
    """
    return """<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Consultancy  Takeoff Automator</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            max-width: 1200px;
            margin: 20px auto;
            padding: 20px;
            line-height: 1.5;
            background: #F8F9FA;
            color: #4B5563;
            font-size: 14px;
        }
        .container {
            background: white;
            padding: 25px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #0B1221;
            font-family: 'Montserrat', sans-serif;
            font-weight: 700;
            border-bottom: 2px solid #D4AF37;
            padding-bottom: 10px;
            margin-top: 0;
            font-size: 24px;
        }
        h3 {
            font-size: 16px;
            margin: 20px 0 10px;
            color: #0B1221;
            font-weight: 600;
        }
        .toggle-group {
            display: flex;
            gap: 15px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        .toggle-group label {
            cursor: pointer;
            font-weight: 600;
        }
        .toggle-group input {
            margin-right: 6px;
        }
        .sample-group {
            padding: 15px;
            background: #eef;
            border-radius: 4px;
            margin-bottom: 15px;
            display: none;
        }
        .sample-group label {
            display: block;
            margin-bottom: 4px;
            font-size: 14px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
            font-size: 13px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        th, td {
            border: 1px solid #ddd;
            padding: 10px 8px;
            text-align: left;
        }
        th {
            background-color: #0B1221;
            color: white;
            font-weight: 600;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        td {
            font-size: 13px;
        }
        tr:nth-child(even) {
            background-color: #f9f9f9;
        }
        tr:hover {
            background-color: #f5f5f5;
        }
        .currency {
            text-align: right;
            font-weight: 600;
            font-family: 'Courier New', monospace;
        }
        .btn {
            background: #D4AF37;
            color: #0B1221;
            font-weight: 600;
            border: none;
            padding: 10px 20px;
            font-size: 14px;
            border-radius: 6px;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
            transition: all 0.3s ease;
        }
        .btn:hover {
            background: #B8941F;
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }
        .btn-secondary {
            background: #0B1221;
            color: #D4AF37;
        }
        .btn-secondary:hover {
            background: #1a2332;
        }
        .btn-export {
            background: #28a745;
        }
        .btn-export:hover {
            background: #218838;
        }
        .button-group {
            margin-top: 20px;
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        .error {
            color: red;
            font-weight: bold;
            margin-top: 10px;
        }
        .info {
            font-size: 12px;
            color: #666;
        }
        .upload-wrapper {
            margin-top: 10px;
        }
        .file-label {
            display: inline-block;
            border-radius: 6px;
            padding: 10px 20px;
            background: #D4AF37;
            border: none;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            color: #0B1221;
            transition: all 0.3s ease;
            text-align: center;
        }
        .file-label:hover {
            background: #B8941F;
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }
        .file-label input {
            display: none;
        }
        .finance-sample-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
        }
        .finance-sample-pill {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: #e0f2ff;
            color: #0f172a;
            padding: 4px 10px;
            border-radius: 999px;
            font-weight: 600;
            font-size: 13px;
        }
        .transmittal-sample-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
        }
        .transmittal-sample-pill {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: #fef3c7;
            color: #78350f;
            padding: 4px 10px;
            border-radius: 999px;
            font-weight: 600;
            font-size: 13px;
        }
        .instruction-text {
            font-size: 12px;
            color: #475569;
        }
        .upload-list {
            margin-top: 8px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            font-size: 12px;
            color: #0f172a;
        }
        .upload-item {
            padding: 6px 10px;
            border-radius: 6px;
            background: #e2e8f0;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .routine-description {
            border: 1px dashed #cbd5e1;
            padding: 12px 16px;
            border-radius: 6px;
            background: #f8fafc;
            margin-bottom: 10px;
            font-size: 13px;
            display: none;
        }
        #processing-spinner {
            display: none;
            margin-top: 16px;
            padding: 10px 14px;
            background: #eef4ff;
            border: 1px solid #9ac6ff;
            border-radius: 6px;
            color: #1d4ed8;
            font-weight: 600;
        }
        #processing-spinner.visible {
            display: block;
        }
        #processing-spinner .spinner-icon {
            width: 16px;
            height: 16px;
            margin-right: 8px;
            border: 3px solid rgba(37, 120, 195, 0.3);
            border-top-color: #1d4ed8;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            display: inline-block;
            vertical-align: middle;
        }
        .model-info {
            margin-top: 6px;
            font-size: 12px;
            color: #1d4ed8;
        }
        .attempt-log {
            margin-top: 16px;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 10px 14px;
            background: #f8fafc;
            font-size: 12px;
        }
        .attempt-log ul {
            margin: 6px 0 0;
            padding-left: 16px;
        }
        .action-log {
            margin-top: 20px;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 12px 16px;
            background: #f8fafc;
            font-size: 13px;
        }
        .action-log ol {
            margin: 6px 0 0;
            padding-left: 18px;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .summary-card {
            margin-top: 20px;
            padding: 12px 16px;
            border-radius: 6px;
            border: 1px solid #dbeafe;
            background: #f0f9ff;
            font-size: 13px;
        }
        .low-confidence {
            background-color: #fef3c7;
            border-left: 3px solid #f59e0b;
            padding: 4px 8px;
            border-radius: 3px;
            display: inline-block;
        }
        .low-confidence::before {
            content: "[!] ";
            font-weight: 600;
        }
        .low-confidence-text {
            background-color: #fee2e2;
            border-left: 3px solid #ef4444;
            padding: 6px 10px;
            border-radius: 4px;
            display: block;
            position: relative;
        }
        .low-confidence-text::before {
            content: "[!] LOW CONFIDENCE - REVIEW REQUIRED";
            display: block;
            font-size: 10px;
            font-weight: 700;
            color: #dc2626;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .critical-error {
            background-color: #fee2e2;
            border: 2px solid #ef4444;
            padding: 8px 12px;
            border-radius: 4px;
            margin: 4px 0;
            font-size: 12px;
        }
        .critical-error-header {
            font-weight: 700;
            color: #dc2626;
            margin-bottom: 4px;
            font-size: 11px;
            text-transform: uppercase;
        }
        .critical-error-item {
            margin: 2px 0;
            padding-left: 12px;
            position: relative;
        }
        .critical-error-item::before {
            content: "• ";
            position: absolute;
            left: 0;
        }
        tr.has-critical-errors {
            background-color: #fef2f2 !important;
        }
        tr.has-critical-errors:hover {
            background-color: #fee2e2 !important;
        }
        .requires-manual-verification {
            background-color: #fff3cd !important;
            border: 3px solid #ffc107 !important;
            position: relative;
        }
        .requires-manual-verification::before {
            content: "[!] MANUAL VERIFICATION REQUIRED - DO NOT USE EXTRACTED VALUES";
            display: block;
            background-color: #dc3545;
            color: white;
            font-weight: 700;
            padding: 8px 12px;
            text-align: center;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
        }
        .rejection-notice {
            background-color: #dc3545;
            color: white;
            padding: 12px 16px;
            border-radius: 4px;
            font-weight: 600;
            margin: 8px 0;
            font-size: 13px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>⚡ Consultancy  Takeoff Automator</h1>
        
        {% if error %}
        <p class="error">{{ error }}</p>
        {% endif %}

        <form method="post" enctype="multipart/form-data" novalidate>
            <div class="toggle-group">
                <label>
                    <input type="radio" name="department" value="finance" {% if department == 'finance' %}checked{% endif %}>
                    Finance Dept
                </label>
                <label>
                    <input type="radio" name="department" value="engineering" {% if department == 'engineering' %}checked{% endif %}>
                    Engineering Dept
                </label>
                <label>
                    <input type="radio" name="department" value="transmittal" {% if department == 'transmittal' %}checked{% endif %}>
                    Drafter Transmittal
                </label>
                <label>
                <input type="radio" name="department" value="logistics" {% if department == 'logistics' %}checked{% endif %}>
                    Logistics
                </label>
            </div>

            <h3>1. Select Sample Files</h3>
            {% for dept_key, group in sample_files.items() %}
            <div class="sample-group" data-department="{{ dept_key }}">
                <strong>{{ group.label }}</strong> · {{ group.description }}
                <div style="margin-top: 10px;">
                    {% for sample in group.samples %}
                    {% if dept_key == 'transmittal' %}
                    <div class="transmittal-sample-row">
                        <span class="transmittal-sample-pill">✓ {{ sample.label }}</span>
                        <a href="{{ url_for('view_sample') }}?path={{ sample.path }}" target="_blank" rel="noopener" style="margin-left: 8px; color: #D4AF37;">🔗</a>
                        <input type="hidden" name="transmittal_defaults" value="{{ sample.path }}">
                    </div>
                    {% else %}
                    <label>
                        <input type="checkbox" name="samples" value="{{ sample.path }}" {% if sample.path in selected_samples or ((dept_key == 'engineering' or dept_key == 'finance') and not selected_samples) %}checked{% endif %}>
                        {{ sample.label }}
                        <a href="{{ url_for('view_sample') }}?path={{ sample.path }}" target="_blank" rel="noopener" style="margin-left: 8px; color: #D4AF37;">🔗</a>
                    </label>
                    {% endif %}
                    {% endfor %}
                </div>
            </div>
            {% endfor %}

            {% for dept_key, description in routine_descriptions.items() %}
            <div class="routine-description" data-department="{{ dept_key }}">
                {% for heading, body in description %}
                <strong>{{ heading }}</strong>
                {{ body|safe }}
                {% endfor %}
            </div>
            {% endfor %}

            <div class="button-group">
                <button type="submit" class="btn">🚀 Generate Output</button>
            </div>
            <div id="processing-spinner"><span class="spinner-icon"></span>Processing files…</div>
        </form>

        {% if results %}
        <div id="results-section">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 30px;">
            <h3 style="margin: 0;">Extraction Results</h3>
            <span class="info">{{ results|length }} row(s) processed</span>
        </div>
        
        {% if department == 'transmittal' and transmittal_data %}
        <!-- Enhanced Transmittal Report with Multiple Categories -->
        <div style="background: #e8f4f8; border-left: 4px solid #3498db; padding: 12px; margin: 20px 0; border-radius: 4px; font-size: 13px; color: #2c3e50;">
            <strong>What this demonstrates:</strong> The LLM extracts semi-structured & narrative data from {{ (results or [])|length }} PDF document(s) and produces 6 clean CSV tables that engineers can immediately use in Excel, BIM coordination, fabrication workflows, and quality audits. Each CSV can be exported individually.
        </div>
        
        <!-- 1. Drawing Register -->
        {% if transmittal_data and transmittal_data.DrawingRegister %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">1. Drawing Register</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Basic drawing metadata | Use Case: Document control, revision tracking</div>
            </div>
            <div style="overflow-x: auto; max-height: 300px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Filename</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Drawing No</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Revision</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Drawing Title</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Scale</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for reg in transmittal_data.DrawingRegister %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;">{{ reg.Filename or reg.get('Filename', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ reg.DwgNo or reg.get('DwgNo', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ reg.Rev or reg.get('Rev', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ reg.Title or reg.get('Title', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ reg.Scale or reg.get('Scale', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=DrawingRegister" class="btn btn-export" style="text-decoration: none;">📥 Export Drawing Register to CSV</a>
            </div>
        </div>
        {% endif %}
        
        <!-- 2. Standards & Compliance Matrix -->
        {% if transmittal_data and transmittal_data.Standards %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">2. Standards & Compliance Matrix</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Extracted from all documents | Use Case: Compliance audits, subcontractor briefing</div>
            </div>
            <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Standard</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Clause/Section</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Applicability</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Source Document</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for std in transmittal_data.Standards %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;"><span style="background: #fff3cd; padding: 2px 6px; border-radius: 3px; font-weight: 500;">{{ std.Standard or std.get('Standard', 'N/A') }}</span></td>
                            <td style="padding: 10px 12px;">{{ std.Clause or std.get('Clause', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ std.Applicability or std.get('Applicability', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ std.SourceDocument or std.get('SourceDocument', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=Standards" class="btn btn-export" style="text-decoration: none;">📥 Export Standards to CSV</a>
            </div>
        </div>
        {% endif %}
        
        <!-- 3. Material Specifications Inventory -->
        {% if transmittal_data and transmittal_data.Materials %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">3. Material Specifications Inventory</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Extracted from all documents | Use Case: Procurement, quality control, consistency checks</div>
            </div>
            <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Material Type</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Grade/Spec</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Applications</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Source References</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for mat in transmittal_data.Materials %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;"><strong>{{ mat.MaterialType or mat.get('MaterialType', 'N/A') }}</strong></td>
                            <td style="padding: 10px 12px;">{{ mat.GradeSpec or mat.get('GradeSpec', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ mat.Applications or mat.get('Applications', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ mat.SourceDocument or mat.get('SourceDocument', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=Materials" class="btn btn-export" style="text-decoration: none;">📥 Export Materials to CSV</a>
            </div>
        </div>
        {% endif %}
        
        <!-- 4. Connection Detail Registry -->
        {% if transmittal_data and transmittal_data.Connections %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">4. Connection Detail Registry</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Extracted from all documents | Use Case: Fabricator briefing, design consistency checks, RFI prevention</div>
            </div>
            <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Detail Mark</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Connection Type</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Bolt Spec</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Plate/Member Spec</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Weld/Torque</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Drawing Ref</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for conn in transmittal_data.Connections %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;"><strong>{{ conn.DetailMark or conn.get('DetailMark', 'N/A') }}</strong></td>
                            <td style="padding: 10px 12px;">{{ conn.ConnectionType or conn.get('ConnectionType', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ conn.BoltSpec or conn.get('BoltSpec', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ conn.PlateSpec or conn.get('PlateSpec', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ conn.WeldTorque or conn.get('WeldTorque', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ conn.DrawingRef or conn.get('DrawingRef', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=Connections" class="btn btn-export" style="text-decoration: none;">📥 Export Connections to CSV</a>
            </div>
        </div>
        {% endif %}
        
        <!-- 5. Design Assumptions & Verification Points -->
        {% if transmittal_data and transmittal_data.Assumptions %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">5. Design Assumptions & Verification Checklist</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Extracted from all documents | Use Case: Site engineer verification, BIM coordination, design review</div>
            </div>
            <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Assumption/Spec</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Value</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Location/Zones</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Critical?</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Verification Method</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Source</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for assump in transmittal_data.Assumptions %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;">{{ assump.Assumption or assump.get('Assumption', 'N/A') }}</td>
                            <td style="padding: 10px 12px;"><span style="background: #fff3cd; padding: 2px 6px; border-radius: 3px; font-weight: 500;">{{ assump.Value or assump.get('Value', 'N/A') }}</span></td>
                            <td style="padding: 10px 12px;">{{ assump.Location or assump.get('Location', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">
                                {% set crit = assump.Critical or assump.get('Critical', '') %}
                                {% if 'CRITICAL' in crit|upper %}
                                <strong style="color: #e74c3c;">CRITICAL</strong>
                                {% elif 'HIGH' in crit|upper %}
                                <strong style="color: #f39c12;">HIGH</strong>
        {% else %}
                                {{ crit }}
                                {% endif %}
                            </td>
                            <td style="padding: 10px 12px;">{{ assump.VerificationMethod or assump.get('VerificationMethod', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ assump.SourceDocument or assump.get('SourceDocument', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=Assumptions" class="btn btn-export" style="text-decoration: none;">📥 Export Assumptions to CSV</a>
            </div>
        </div>
        {% endif %}
        
        <!-- 6. V.O.S. Flags & Coordination Points -->
        {% if transmittal_data and transmittal_data.VOSFlags %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">6. V.O.S. Flags & On-Site Coordination Points</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Extracted from all documents | Use Case: Site management, design coordination, decision log</div>
            </div>
            <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Flag ID</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Item</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Issue</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Action Required</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Responsible Party</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for vos in transmittal_data.VOSFlags %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;"><span style="background: #e74c3c; color: white; padding: 3px 8px; border-radius: 3px; font-size: 11px; font-weight: 600;">{{ vos.FlagID or vos.get('FlagID', 'N/A') }}</span></td>
                            <td style="padding: 10px 12px;">{{ vos.Item or vos.get('Item', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ vos.Issue or vos.get('Issue', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ vos.ActionRequired or vos.get('ActionRequired', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ vos.ResponsibleParty or vos.get('ResponsibleParty', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ vos.Status or vos.get('Status', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=VOSFlags" class="btn btn-export" style="text-decoration: none;">📥 Export V.O.S. Flags to CSV</a>
            </div>
        </div>
        {% endif %}
        
        <!-- 7. Cross-Reference Validation -->
        {% if transmittal_data and transmittal_data.CrossReferences %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">7. Cross-Reference Validation & Missing Details Report</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Extracted from all documents | Use Case: Quality assurance, drawing completeness audit, RFI prevention</div>
            </div>
            <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Reference</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Referenced In</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Refers To</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Found?</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for xref in transmittal_data.CrossReferences %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;">{{ xref.Reference or xref.get('Reference', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ xref.ReferencedIn or xref.get('ReferencedIn', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ xref.RefersTo or xref.get('RefersTo', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">
                                {% set found = xref.Found or xref.get('Found', '') %}
                                {% if 'yes' in found|lower or 'true' in found|lower %}
                                <span style="color: #27ae60; font-weight: 600;">Found</span>
                                {% elif 'no' in found|lower or 'false' in found|lower %}
                                <span style="color: #e74c3c; font-weight: 600;">Missing</span>
                                {% else %}
                                {{ found or 'N/A' }}
                                {% endif %}
                            </td>
                            <td style="padding: 10px 12px;">{{ xref.Status or xref.get('Status', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=CrossReferences" class="btn btn-export" style="text-decoration: none;">📥 Export Cross-References to CSV</a>
            </div>
        </div>
        {% endif %}
        
        {% if model_actions %}
        <div class="action-log" style="margin-top: 30px;">
            <div><strong>Action log</strong></div>
            <ol>
                {% for action in model_actions %}
                <li>{{ action }}</li>
                {% endfor %}
            </ol>
        </div>
        {% endif %}
        
        {% endif %}
        
        {% if department == 'transmittal' and not transmittal_data %}
        <!-- Fallback to simple table if aggregated data not available for transmittal -->
        <table>
            <thead>
            <tr>
                <th>Filename</th>
                    <th>Drawing No</th>
                    <th>Revision</th>
                    <th>Drawing Title</th>
                    <th>Scale</th>
                </tr>
            </thead>
            <tbody>
                {% for row in results %}
                <tr>
                    <td>{{ row.Filename }}</td>
                    <td>{{ row.DwgNo }}</td>
                    <td>{{ row.Rev }}</td>
                    <td>{{ row.Title }}</td>
                    <td>{{ row.Scale }}</td>
                </tr>
                {% endfor %}
            </tbody>
        </table>
        {% endif %}
        
        {% if department == 'engineering' %}
        {# Engineering section will be injected here #}
        {% endif %}
        
        {# Finance tables - grouped by filename #}
        {% if department == 'finance' %}
        {# Finance section will be injected here #}
        {% endif %}
        
        {% if department == 'logistics' %}
        {# Logistics section will be injected here #}
        {% endif %}
        
        <div class="summary-card">
            <div><strong>Run Summary</strong></div>
            {% for label, text in routine_summary %}
            <div><strong>{{ label }}:</strong> {{ text }}</div>
            {% endfor %}
        </div>
        {% if model_actions %}
        <div class="action-log">
            <div><strong>Action log</strong></div>
            <ol>
                {% for action in model_actions %}
                <li>{{ action }}</li>
                {% endfor %}
            </ol>
        </div>
        {% endif %}
            <div class="button-group">
                <a href="/export_csv" class="btn btn-export">📥 Export to CSV</a>
                <a href="/contact.html?option=phase-1" class="btn btn-secondary" target="_parent">Book Your Phase 1 Sprint</a>
            </div>
        </div>
        {% endif %}
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const sampleGroups = document.querySelectorAll('.sample-group');
            const routineDescriptions = document.querySelectorAll('.routine-description');
            const deptRadios = document.querySelectorAll('input[name="department"]');

            function updateSampleVisibility() {
                const checkedRadio = document.querySelector('input[name="department"]:checked');
                if (!checkedRadio) return;
                const active = checkedRadio.value;
                sampleGroups.forEach(group => {
                    group.style.display = group.dataset.department === active ? 'block' : 'none';
                });
            }

        function clearOtherSelections(activeDept) {
            if (!activeDept) return;
            sampleGroups.forEach(group => {
                if (group.dataset.department !== activeDept) {
                    const toggles = group.querySelectorAll('input[type="radio"], input[type="checkbox"]');
                    toggles.forEach(input => {
                        if (input.checked) {
                            input.checked = false;
                        }
                    });
                    const fileInputs = group.querySelectorAll('input[type="file"]');
                    fileInputs.forEach(input => {
                        input.value = '';
                    });
                }
            });
            if (activeDept !== 'finance') {
                updateFinanceUploadList([]);
            }
        }

        const financeUploadInput = document.querySelector('input[name="finance_uploads"]');
        const financeUploadList = document.getElementById('finance-upload-list');

        function updateFinanceUploadList(filesArray) {
            if (!financeUploadList) return;
            const files = filesArray || (financeUploadInput ? Array.from(financeUploadInput.files || []) : []);
            financeUploadList.innerHTML = '';
            if (!files.length) {
                financeUploadList.style.display = 'none';
                return;
            }
            financeUploadList.style.display = 'flex';
            files.forEach(file => {
                const item = document.createElement('div');
                item.className = 'upload-item';
                item.textContent = `📄 ${file.name}`;
                financeUploadList.appendChild(item);
            });
        }

            const resultsSection = document.getElementById('results-section');
            function hideResultsSection() {
                if (resultsSection) {
                    resultsSection.style.display = 'none';
                }
            }

            function updateRoutineVisibility() {
                const checkedRadio = document.querySelector('input[name="department"]:checked');
                if (!checkedRadio) return;
                const active = checkedRadio.value;
                routineDescriptions.forEach(desc => {
                    desc.style.display = desc.dataset.department === active ? 'block' : 'none';
                });
            }

            function handleDepartmentChange() {
                updateSampleVisibility();
                hideResultsSection();
                updateRoutineVisibility();
            const checkedRadio = document.querySelector('input[name="department"]:checked');
            clearOtherSelections(checkedRadio ? checkedRadio.value : null);
            if (checkedRadio && checkedRadio.value === 'finance') {
                updateFinanceUploadList();
            }
            }

            deptRadios.forEach(radio => radio.addEventListener('change', handleDepartmentChange));
            updateSampleVisibility();
            updateRoutineVisibility();
        if (financeUploadInput) {
            financeUploadInput.addEventListener('change', () => updateFinanceUploadList());
            const activeDeptRadio = document.querySelector('input[name="department"]:checked');
            if (activeDeptRadio && activeDeptRadio.value === 'finance') {
                updateFinanceUploadList();
            }
        }
        });

        document.addEventListener('DOMContentLoaded', function() {
            const spinner = document.getElementById('processing-spinner');
            const mainForm = document.querySelector('form');
            if (mainForm) {
                mainForm.addEventListener('submit', () => {
                    spinner?.classList?.add('visible');
                });
            }

            // Smooth scroll to results when they appear (if results exist on page load)
            const resultsSection = document.getElementById('results-section');
            if (resultsSection) {
                setTimeout(() => {
                    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            }
        });
    </script>
</body>
</html>"""
