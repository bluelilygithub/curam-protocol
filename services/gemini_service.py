"""
Gemini AI Service - AI document analysis

Complete Gemini service with all 3 functions.

Functions:
- get_available_models(): Get list of available Gemini models
- build_prompt(): Build AI prompts for each document type
- analyze_gemini(): Call Gemini API with retry logic

Usage:
    from services.gemini_service import analyze_gemini
    
    entries, error, model, attempts, actions, schedule = analyze_gemini(
        text="Invoice text here...",
        doc_type="finance"
    )

Created: Phase 3.3c - Gemini Service Complete (FIXED)
"""

# Import prompts from separate modules
try:
    from services.prompts.finance_prompt import get_finance_prompt
    from services.prompts.engineering_prompt import get_engineering_prompt
    from services.prompts.transmittal_prompt import get_transmittal_prompt
    from services.prompts.logistics_prompt import get_logistics_prompt
except ImportError:
    # Fallback if prompts module not available
    get_finance_prompt = None
    get_engineering_prompt = None
    get_transmittal_prompt = None
    get_logistics_prompt = None

import os
import json
import time
import google.generativeai as genai

# Try to import grpc
try:
    import grpc
except ImportError:
    grpc = None

# Try to import specific exception types
try:
    from google.api_core import exceptions as google_exceptions
except ImportError:
    google_exceptions = None

# Import from other services
from services.pdf_service import prepare_prompt_text

# Import configuration constants
from config import (
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

# Configure Gemini API
api_key = os.environ.get("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)

# Global cache for available models
_available_models = None


def get_available_models():
    """Get list of available Gemini models"""
    global _available_models
    if _available_models is not None:
        return _available_models
    
    if not api_key:
        return []
    
    _available_models = []
    try:
        models = genai.list_models()
        models_list = list(models)  # Convert to list once
        print(f"Found {len(models_list)} total models")
        
        # Extract model names, removing 'models/' prefix
        for m in models_list:
            try:
                model_name = m.name
                if model_name.startswith('models/'):
                    model_name = model_name.replace('models/', '')
                
                # Check if model supports generateContent
                supported_methods = getattr(m, 'supported_generation_methods', [])
                if hasattr(supported_methods, '__iter__'):
                    methods = list(supported_methods)
                else:
                    methods = [str(supported_methods)] if supported_methods else []
                
                if 'generateContent' in methods or len(methods) == 0:
                    _available_models.append(model_name)
                    print(f"  - {model_name} (methods: {methods})")
            except Exception as e:
                print(f"Error processing model {m}: {e}")
                continue
        
        print(f"Available models for generateContent: {_available_models}")
        return _available_models if _available_models else None
    except Exception as e:
        print(f"Error listing models: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        # Return None to use fallback
        return None


def build_prompt(text, doc_type, sector_slug=None):
    """Build a prompt tailored to the selected department."""
    # Try database first
    try:
        from database import build_combined_prompt
        db_prompt = build_combined_prompt(doc_type, sector_slug, text)
        if db_prompt:
            print(f"âœ“ Using database prompt for {doc_type}")
            return db_prompt
    except Exception as e:
        print(f"âš  Database failed: {e}")
    
    print(f"âš  Using hardcoded fallback for {doc_type}")
    
    if doc_type == "engineering":
        # Use modular engineering prompt
        if get_engineering_prompt:
            return get_engineering_prompt(text)
        # Fallback to basic prompt if module not available
        return f"Extract engineering schedule data from: {text}"
    elif doc_type == "transmittal":
        # Use modular transmittal prompt
        if get_transmittal_prompt:
            return get_transmittal_prompt(text)
        # Fallback to basic prompt if module not available
        return f"Extract drawing register data from: {text}"
    elif doc_type == "logistics":
        # Use modular logistics prompt
        if get_logistics_prompt:
            return get_logistics_prompt(text)
        # Fallback to basic prompt if module not available
        return f"Extract Bill of Lading data from: {text}"
    else:
        # Use modular finance prompt
        if get_finance_prompt:
            return get_finance_prompt(text)
        # Fallback to basic prompt if module not available
        return f"Extract invoice data from: {text}"


# --- HTML TEMPLATE ---

HTML_TEMPLATE = """
<!DOCTYPE html>
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
            content: "âš ï¸ ";
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
            content: "âš ï¸ LOW CONFIDENCE - REVIEW REQUIRED";
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
            content: "ÃƒÂ¢Ã‚ÂÃ…â€™";
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
            content: "âš ï¸ MANUAL VERIFICATION REQUIRED - DO NOT USE EXTRACTED VALUES";
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
        <h1>&#9889; Consultancy  Takeoff Automator</h1>
        
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
                <strong>{{ group.label }}</strong> Â· {{ group.description }}
                <div style="margin-top: 10px;">
                    {% for sample in group.samples %}
                    {% if dept_key == 'transmittal' %}
                    <div class="transmittal-sample-row">
                        <span class="transmittal-sample-pill">&#9989; {{ sample.label }}</span>
                        <a href="{{ url_for('view_sample') }}?path={{ sample.path }}" target="_blank" rel="noopener" style="margin-left: 8px; color: #D4AF37;">&#128279;</a>
                        <input type="hidden" name="transmittal_defaults" value="{{ sample.path }}">
                    </div>
                    {% else %}
                    <label>
                        <input type="checkbox" name="samples" value="{{ sample.path }}" {% if sample.path in selected_samples or ((dept_key == 'engineering' or dept_key == 'finance') and not selected_samples) %}checked{% endif %}>
                        {{ sample.label }}
                        <a href="{{ url_for('view_sample') }}?path={{ sample.path }}" target="_blank" rel="noopener" style="margin-left: 8px; color: #D4AF37;">&#128279;</a>
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
                <button type="submit" class="btn">&#128640; Generate Output</button>
            </div>
            <div id="processing-spinner"><span class="spinner-icon"></span>Processing files&#8230;</div>
        </form>

        {% if results %}
        <div id="results-section">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 30px;">
            <h3 style="margin: 0;">Extraction Results</h3>
            <span class="info">{{ results|length }} row(s) processed</span>
        </div>
        
        <div style="background: #e3f2fd; border: 2px solid #2196f3; padding: 10px; margin: 10px 0; border-radius: 4px; font-family: monospace; font-size: 14px;">
            <strong>ðŸ” UNIVERSAL DEBUG:</strong><br>
            <strong>department:</strong> "{{ department }}"<br>
            <strong>results length:</strong> {{ results|length }}<br>
            {% if results and results|length > 0 %}
            <strong>first result:</strong> {{ results[0] }}<br>
            {% endif %}
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
                <a href="/export_transmittal_csv?category=DrawingRegister" class="btn btn-export" style="text-decoration: none;">ðŸ“¥ Export Drawing Register to CSV</a>
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
                <a href="/export_transmittal_csv?category=Standards" class="btn btn-export" style="text-decoration: none;">ðŸ“¥ Export Standards to CSV</a>
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
                <a href="/export_transmittal_csv?category=Materials" class="btn btn-export" style="text-decoration: none;">ðŸ“¥ Export Materials to CSV</a>
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
                <a href="/export_transmittal_csv?category=Connections" class="btn btn-export" style="text-decoration: none;">ðŸ“¥ Export Connections to CSV</a>
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
                <a href="/export_transmittal_csv?category=Assumptions" class="btn btn-export" style="text-decoration: none;">ðŸ“¥ Export Assumptions to CSV</a>
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
                <a href="/export_transmittal_csv?category=VOSFlags" class="btn btn-export" style="text-decoration: none;">ðŸ“¥ Export V.O.S. Flags to CSV</a>
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
                <a href="/export_transmittal_csv?category=CrossReferences" class="btn btn-export" style="text-decoration: none;">ðŸ“¥ Export Cross-References to CSV</a>
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
        
        {% if department == 'finance' or department == 'engineering' %}
        {% if department == 'engineering' %}
        {# Render separate table for each document #}
        {% for filename, file_results in grouped_engineering_results.items() %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">{{ filename }}</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">{{ file_results|length }} row(s) extracted</div>
            </div>
            <div style="overflow-x: auto;">
        <table>
            <thead>
                <tr>
                    {% if schedule_type == 'column' %}
                    <th>Mark</th>
                    <th>Section Type</th>
                    <th>Size</th>
                    <th>Length</th>
                    <th>Grade</th>
                    <th>Base Plate</th>
                    <th>Cap Plate</th>
                    <th>Finish</th>
                    <th>Comments</th>
                    {% else %}
                    <th>Mark</th>
                    <th>Size</th>
                    <th>Qty</th>
                    <th>Length</th>
                    <th>Grade</th>
                    <th>Paint System</th>
                    <th>Comments</th>
                    {% endif %}
            </tr>
            </thead>
            <tbody>
            {% for row in file_results %}
            <tr {% if row.get('requires_manual_verification') %}class="requires-manual-verification"{% elif row.get('has_critical_errors') %}class="has-critical-errors"{% endif %}>
                    {% if schedule_type == 'column' %}
                    <td>{% if row.get('Mark_confidence') == 'low' %}<span class="low-confidence">{{ row.Mark }}</span>{% else %}{{ row.Mark }}{% endif %}</td>
                    <td>{{ row.SectionType }}</td>
                    <td>{% if row.get('Size_confidence') == 'low' %}<span class="low-confidence">{{ row.Size }}</span>{% else %}{{ row.Size }}{% endif %}</td>
                    <td>{{ row.Length }}</td>
                    <td>{% if row.get('Grade_confidence') == 'low' %}<span class="low-confidence">{{ row.Grade }}</span>{% else %}{{ row.Grade }}{% endif %}</td>
                    <td>{{ row.BasePlate }}</td>
                    <td>{{ row.CapPlate }}</td>
                    <td>{{ row.Finish }}</td>
                    <td>
                        {% if row.get('Comments_confidence') == 'low' %}<span class="low-confidence-text">{{ row.Comments }}</span>{% else %}{{ row.Comments }}{% endif %}
                        {% if row.get('critical_errors') %}
                        <div class="critical-error">
                            <div class="critical-error-header">Critical Errors Detected:</div>
                            {% for error in row.critical_errors %}
                            <div class="critical-error-item">{{ error }}</div>
                            {% endfor %}
                        </div>
                        {% endif %}
                    </td>
                    {% else %}
                    <td>{% if row.get('Mark_confidence') == 'low' %}<span class="low-confidence">{{ row.Mark }}</span>{% else %}{{ row.Mark }}{% endif %}</td>
                    <td>
                        {% if row.get('Size_confidence') == 'low' %}<span class="low-confidence">{{ row.Size }}</span>{% else %}{{ row.Size }}{% endif %}
                        {% if row.get('corrections_applied') %}
                            {% for correction in row.corrections_applied %}
                                {% if 'Size' in correction %}
                                <div style="background-color: #d1f2eb; border-left: 3px solid #27ae60; padding: 4px 8px; margin-top: 4px; border-radius: 3px; font-size: 11px;">
                                    {{ correction }}
                                </div>
                                {% endif %}
                            {% endfor %}
                        {% endif %}
                        {% if row.get('critical_errors') %}
                            {% for error in row.critical_errors %}
                                {% if 'Size' in error %}
                                <div class="critical-error" style="margin-top: 4px;">
                                    <div class="critical-error-header">âš ï¸ Size Error:</div>
                                    <div class="critical-error-item">{{ error }}</div>
                                </div>
                                {% endif %}
                            {% endfor %}
                        {% endif %}
                    </td>
                    <td>
                        {{ row.Qty }}
                        {% if row.get('critical_errors') %}
                            {% for error in row.critical_errors %}
                                {% if 'Quantity' in error %}
                                <div class="critical-error" style="margin-top: 4px;">
                                    <div class="critical-error-header">âš ï¸ Quantity Error:</div>
                                    <div class="critical-error-item">{{ error }}</div>
                                </div>
                                {% endif %}
                            {% endfor %}
                        {% endif %}
                    </td>
                    <td>{{ row.Length }}</td>
                    <td>
                        {% if row.get('Grade_confidence') == 'low' %}<span class="low-confidence">{{ row.Grade }}</span>{% else %}{{ row.Grade }}{% endif %}
                        {% if row.get('critical_errors') %}
                            {% for error in row.critical_errors %}
                                {% if 'Grade' in error %}
                                <div class="critical-error" style="margin-top: 4px;">
                                    <div class="critical-error-header">âš ï¸ Grade Error:</div>
                                    <div class="critical-error-item">{{ error }}</div>
                                </div>
                                {% endif %}
                            {% endfor %}
                        {% endif %}
                    </td>
                    <td>{% if row.get('PaintSystem_confidence') == 'low' %}<span class="low-confidence">{{ row.PaintSystem }}</span>{% else %}{{ row.PaintSystem }}{% endif %}</td>
                    <td>
                        {% if row.get('rejection_reason') %}
                        <div class="rejection-notice">
                            âš  {{ row.rejection_reason }}
                        </div>
                        {% endif %}
                        {% if row.get('Comments_confidence') == 'low' %}<span class="low-confidence-text">{{ row.Comments }}</span>{% else %}{{ row.Comments }}{% endif %}
                        {% if row.get('critical_errors') and row.get('requires_manual_verification') %}
                        <div class="critical-error" style="margin-top: 8px;">
                            <div class="critical-error-header">âš  Critical Errors - Manual Verification Required:</div>
                            {% for error in row.critical_errors %}
                            <div class="critical-error-item">{{ error }}</div>
                            {% endfor %}
                        </div>
                        {% endif %}
                    </td>
                    {% endif %}
            </tr>
            {% endfor %}
            </tbody>
        </table>
            </div>
        </div>
        {% endfor %}
        
        {# Finance tables - grouped by filename #}
        {% elif department == 'finance' %}
        {# Render separate table for each document #}
        {% for filename, file_results in grouped_finance_results.items() %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">{{ filename }}</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">{{ file_results|length }} row(s) extracted</div>
            </div>
            <div style="overflow-x: auto;">
        <table>
            <thead>
                <tr>
                <th>Vendor</th>
                <th>Date</th>
                <th>Invoice #</th>
                <th>Currency</th>
                    <th class="currency">Cost</th>
                    <th class="currency">GST</th>
                    <th class="currency">Final Amount</th>
                <th>Summary</th>
                {% if file_results[0].get('POReference') and file_results[0].POReference != 'N/A' %}
                <th>PO Ref</th>
                {% endif %}
                {% if file_results[0].get('PaymentTerms') and file_results[0].PaymentTerms != 'N/A' %}
                <th>Payment Terms</th>
                {% endif %}
                {% if file_results[0].get('ShippingTerms') and file_results[0].ShippingTerms != 'N/A' %}
                <th>Shipping Terms</th>
                {% endif %}
            </tr>
            </thead>
            <tbody>
            {% for row in file_results %}
            <tr {% if row.get('requires_manual_verification') %}class="requires-manual-verification"{% elif row.get('has_critical_errors') %}class="has-critical-errors"{% endif %}>
                <td>{{ row.Vendor }}</td>
                <td>{{ row.Date }}</td>
                <td>{{ row.InvoiceNum }}</td>
                <td>{{ row.Currency or 'N/A' }}</td>
                    <td class="currency">{{ row.CostFormatted or row.Cost or 'N/A' }}</td>
                    <td class="currency">{{ row.GSTFormatted if row.GSTFormatted and row.GSTFormatted != 'N/A' else (row.GST or 'N/A') }}</td>
                    <td class="currency">{{ row.FinalAmountFormatted or row.TotalFormatted or row.FinalAmount or row.Total or 'N/A' }}</td>
                <td>{{ row.Summary }}</td>
                {% if file_results[0].get('POReference') and file_results[0].POReference != 'N/A' %}
                <td>{{ row.POReference or 'N/A' }}</td>
                {% endif %}
                {% if file_results[0].get('PaymentTerms') and file_results[0].PaymentTerms != 'N/A' %}
                <td>{{ row.PaymentTerms or 'N/A' }}{% if row.DueDate and row.DueDate != 'N/A' %}<br><small style="color: #666;">Due: {{ row.DueDate }}</small>{% endif %}</td>
                {% endif %}
                {% if file_results[0].get('ShippingTerms') and file_results[0].ShippingTerms != 'N/A' %}
                <td>{{ row.ShippingTerms or 'N/A' }}{% if row.PortOfLoading and row.PortOfLoading != 'N/A' %}<br><small style="color: #666;">{{ row.PortOfLoading }} {{ row.PortOfDischarge or '' }}</small>{% endif %}</td>
                {% endif %}
            </tr>
            {% endfor %}
            </tbody>
        </table>
            </div>
            {# Display Business Context Information #}
            {% for row in file_results %}
            {% if row.get('ABN') or row.get('VesselVoyage') or row.get('BillOfLading') or (row.get('Flags') and row.Flags|length > 0) %}
            <div style="padding: 15px 20px; border-top: 1px solid #e0e0e0; background: #f9f9f9;">
                <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #2c3e50;">Additional Information</h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; font-size: 13px;">
                    {% if row.ABN and row.ABN != 'N/A' %}
                    <div><strong>ABN:</strong> {{ row.ABN }}</div>
                    {% endif %}
                    {% if row.VesselVoyage and row.VesselVoyage != 'N/A' %}
                    <div><strong>Vessel:</strong> {{ row.VesselVoyage }}</div>
                    {% endif %}
                    {% if row.BillOfLading and row.BillOfLading != 'N/A' %}
                    <div><strong>B/L Reference:</strong> {{ row.BillOfLading }}</div>
                    {% endif %}
                </div>
                {% if row.get('Flags') and row.Flags|length > 0 %}
                <div style="margin-top: 10px; padding: 10px; background: #fff3cd; border-left: 3px solid #ffc107; border-radius: 4px;">
                    <strong style="color: #856404;">âš ï¸ Flags:</strong>
                    <ul style="margin: 5px 0 0 0; padding-left: 20px; color: #856404;">
                        {% for flag in row.Flags %}
                        <li>{{ flag }}</li>
                        {% endfor %}
                    </ul>
                </div>
                {% endif %}
            </div>
            {% endif %}
            {% endfor %}
            {# Display Line Items if present #}
            {% for row in file_results %}
            {% if row.get('LineItems') and row.LineItems|length > 0 %}
            <div style="padding: 20px; border-top: 2px solid #e0e0e0; background: #f9f9f9;">
                <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #2c3e50;">Line Items</h3>
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; background: white;">
                        <thead>
                            <tr style="background: #f5f5f5;">
                                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Item #</th>
                                {% if row.LineItems[0].get('PartNumber') and row.LineItems[0].PartNumber != 'N/A' %}
                                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Part #</th>
                                {% endif %}
                                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Description</th>
                                {% if row.LineItems[0].get('HSCode') and row.LineItems[0].HSCode != 'N/A' %}
                                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">HS Code</th>
                                {% endif %}
                                <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Quantity</th>
                                <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Unit Price</th>
                                <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Line Total</th>
                                {% if row.LineItems[0].get('SKU') and row.LineItems[0].SKU != 'N/A' %}
                                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">SKU</th>
                                {% endif %}
                                {% if row.LineItems[0].get('Category') and row.LineItems[0].Category != 'N/A' %}
                                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Category</th>
                                {% endif %}
                            </tr>
                        </thead>
                        <tbody>
                            {% for item in row.LineItems %}
                            <tr>
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.ItemNumber or '' }}</td>
                                {% if row.LineItems[0].get('PartNumber') and row.LineItems[0].PartNumber != 'N/A' %}
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.PartNumber or '' }}</td>
                                {% endif %}
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.Description or 'N/A' }}</td>
                                {% if row.LineItems[0].get('HSCode') and row.LineItems[0].HSCode != 'N/A' %}
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.HSCode or '' }}</td>
                                {% endif %}
                                <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">{{ item.Quantity or 'N/A' }}</td>
                                <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">{{ item.UnitPrice or 'N/A' }}</td>
                                <td style="padding: 8px; text-align: right; border: 1px solid #ddd; font-weight: bold;">{{ item.LineTotal or 'N/A' }}</td>
                                {% if row.LineItems[0].get('SKU') and row.LineItems[0].SKU != 'N/A' %}
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.SKU or '' }}</td>
                                {% endif %}
                                {% if row.LineItems[0].get('Category') and row.LineItems[0].Category != 'N/A' %}
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.Category or '' }}</td>
                                {% endif %}
                            </tr>
                            {% endfor %}
                        </tbody>
                    </table>
                </div>
            </div>
            {% endif %}
            {% endfor %}
        </div>
        {% endfor %}
        {% endif %}
        
        {% if department == 'logistics' %}
        <!-- ============================================================ -->
        <!-- PROOF: NEW TEMPLATE DEPLOYED - VERSION 2026-01-05-FINAL -->
        <!-- ============================================================ -->
        <div style="background: #ff0000; color: white; border: 4px solid #000; padding: 20px; margin: 20px 0; border-radius: 8px; font-size: 18px; font-weight: bold; text-align: center;">
            🚨 PROOF: NEW TEMPLATE DEPLOYED - 2026-01-05-FINAL 🚨
        </div>
        {# Render logistics results - one table for all documents #}
        {# DEBUG INFO #}
        <div style="background: #fff3cd; border: 2px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 8px;">
            <strong>ðŸ” DEBUG - Logistics Data:</strong><br>
            <strong>results exists:</strong> {{ 'Yes' if results else 'No' }}<br>
            <strong>results type:</strong> {{ results.__class__.__name__ if results else 'None' }}<br>
            <strong>results length:</strong> {{ results|length if results else 0 }}<br>
            <strong>department value:</strong> "{{ department }}"<br>
            {% if results and results|length > 0 %}
            <strong>First result keys:</strong> {{ results[0].keys()|list if results[0] is mapping else 'Not a dict' }}<br>
            <strong>First result:</strong> {{ results[0] }}<br>
            {% endif %}
        </div>
        {% if results %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">📦 Logistics Documents Extracted</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">{{ results|length }} row(s) extracted</div>
            </div>
            <div style="overflow-x: auto;">
        
        {# Detect document type from first row #}
        {% set first_row = results[0] if results else {} %}
        {% set has_fta = 'FTAAgreement' in first_row or 'CountryOfOrigin' in first_row or 'ItemDescription' in first_row %}
        {% set has_bol = 'BLNumber' in first_row or 'Shipper' in first_row or 'Vessel' in first_row %}
        {% set has_packing = 'CartonNumber' in first_row or 'Dimensions' in first_row %}
        
        {# FTA DOCUMENT TABLE #}
        {% if has_fta %}
        <table>
            <thead>
                <tr>
                    <th>Item Description</th>
                    <th>Country of Origin</th>
                    <th>FTA Agreement</th>
                    <th>Shipment Ref</th>
                    <th>Invoice #</th>
                    <th>Tariff Code</th>
                    <th>Notes</th>
                    <th>File</th>
                </tr>
            </thead>
            <tbody>
            {% for row in results %}
            <tr>
                <td>{{ row.ItemDescription or row.Description or 'N/A' }}</td>
                <td>{{ row.CountryOfOrigin or 'N/A' }}</td>
                <td>{{ row.FTAAgreement or 'N/A' }}</td>
                <td>{{ row.ShipmentRef or 'N/A' }}</td>
                <td>{{ row.InvoiceNumber or 'N/A' }}</td>
                <td>{{ row.TariffCode or 'N/A' }}</td>
                <td>{{ row.Notes or 'N/A' }}</td>
                <td style="font-size: 11px;">{{ row.Filename or 'N/A' }}</td>
            </tr>
            {% endfor %}
            </tbody>
        </table>
        
        {# BILL OF LADING TABLE #}
        {% elif has_bol %}
        <table>
            <thead>
                <tr>
                    <th>B/L Number</th>
                    <th>Shipper</th>
                    <th>Consignee</th>
                    <th>Vessel</th>
                    <th>Container #</th>
                    <th>Port of Loading</th>
                    <th>Port of Discharge</th>
                    <th>Description</th>
                    <th>Weight</th>
                    <th>File</th>
                </tr>
            </thead>
            <tbody>
            {% for row in results %}
            <tr>
                <td>{{ row.BLNumber or 'N/A' }}</td>
                <td>{{ row.Shipper or 'N/A' }}</td>
                <td>{{ row.Consignee or 'N/A' }}</td>
                <td>{{ row.Vessel or 'N/A' }}</td>
                <td>{{ row.ContainerNumber or 'N/A' }}</td>
                <td>{{ row.PortOfLoading or 'N/A' }}</td>
                <td>{{ row.PortOfDischarge or 'N/A' }}</td>
                <td>{{ row.CargoDescription or row.Description or 'N/A' }}</td>
                <td>{{ row.GrossWeight or row.Weight or 'N/A' }}</td>
                <td style="font-size: 11px;">{{ row.Filename or 'N/A' }}</td>
            </tr>
            {% endfor %}
            </tbody>
        </table>
        
        {# PACKING LIST TABLE #}
        {% elif has_packing %}
        <table>
            <thead>
                <tr>
                    <th>Carton #</th>
                    <th>PO Number</th>
                    <th>Item Description</th>
                    <th>Quantity</th>
                    <th>Dimensions</th>
                    <th>Gross Weight</th>
                    <th>Net Weight</th>
                    <th>Volume</th>
                    <th>File</th>
                </tr>
            </thead>
            <tbody>
            {% for row in results %}
            <tr>
                <td>{{ row.CartonNumber or 'N/A' }}</td>
                <td>{{ row.PONumber or 'N/A' }}</td>
                <td>{{ row.ItemDescription or 'N/A' }}</td>
                <td>{{ row.Quantity or 'N/A' }}</td>
                <td>{{ row.Dimensions or 'N/A' }}</td>
                <td>{{ row.GrossWeight or 'N/A' }}</td>
                <td>{{ row.NetWeight or 'N/A' }}</td>
                <td>{{ row.Volume or 'N/A' }}</td>
                <td style="font-size: 11px;">{{ row.Filename or 'N/A' }}</td>
            </tr>
            {% endfor %}
            </tbody>
        </table>
        
        {# FALLBACK - GENERIC TABLE #}
        {% else %}
        <table>
            <thead>
                <tr>
                    {% for key in first_row.keys() if key != 'Filename' %}
                    <th>{{ key }}</th>
                    {% endfor %}
                    <th>File</th>
                </tr>
            </thead>
            <tbody>
            {% for row in results %}
            <tr>
                {% for key in first_row.keys() if key != 'Filename' %}
                <td>{{ row[key] or 'N/A' }}</td>
                {% endfor %}
                <td style="font-size: 11px;">{{ row.Filename or 'N/A' }}</td>
            </tr>
            {% endfor %}
            </tbody>
        </table>
        {% endif %}
        
            </div>
        </div>

        {% endif %}
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
                <a href="/export_csv" class="btn btn-export">ðŸ“¥ Export to CSV</a>
                <a href="/contact.html?option=phase-1" class="btn btn-secondary" target="_parent">Book Your Phase 1 Sprint</a>
            </div>
        </div>
        {% endif %}
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
                item.textContent = `&#128206; ${file.name}`;
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
</html>
"""

# --- HELPER FUNCTIONS ---
def analyze_gemini(text, doc_type, image_path=None, sector_slug=None):
    """Call Gemini with a doc-type-specific prompt and return entries, error, model used, attempt log, action log, and schedule_type.
    
    Args:
        text: Text content or [IMAGE_FILE:path] marker
        doc_type: Document type (engineering, finance, transmittal)
        image_path: Optional path to image file for vision processing
    """
    # For engineering, we'll detect schedule type from returned data
    if doc_type == "engineering":
        fields = ENGINEERING_BEAM_FIELDS  # Default, will detect if column schedule
    else:
        fields = DOC_FIELDS.get(doc_type, FINANCE_FIELDS)
    error_field = ERROR_FIELD.get(doc_type, fields[-1])

    def error_entry(message):
        return {
            field: (message if field == error_field else "AI Error")
            for field in fields
        }

    if not api_key:
        return [error_entry("MISSING API KEY")], "MISSING API KEY", None, [], [], None

    # Check if this is an image file marker
    if text and text.startswith("[IMAGE_FILE:"):
        image_path = text.replace("[IMAGE_FILE:", "").rstrip("]")
        if not os.path.exists(image_path):
            return [error_entry(f"Image file not found: {image_path}")], f"Image file not found: {image_path}", None, [], [], None
        text = None  # Will use image instead
    
    if not text and not image_path:
        return [error_entry("No content provided for analysis")], "No content provided for analysis", None, [], [], None
    
    if text and text.startswith("Error:"):
        return [error_entry(f"Text extraction failed: {text}")], f"Text extraction failed: {text}", None, [], [], None

    available_models = get_available_models()
    stable_preferred = ['gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-pro-latest']
    model_names = []
    action_log = []
    
    action_log.append(f"Model selection: Checking {len(available_models) if available_models else 0} available models")
    action_log.append(f"Preferred order: {', '.join(stable_preferred)}")
    
    if available_models and len(available_models) > 0:
        # Prefer stable GA models in defined order
        model_names = [m for m in stable_preferred if m in available_models]
        if model_names:
            action_log.append(f"Found {len(model_names)} preferred model(s): {', '.join(model_names)}")
        if not model_names:
            # Expand to include any available model that contains the GA name
            preview_candidates = []
            for preferred in stable_preferred:
                for m in available_models:
                    if preferred in m and m not in preview_candidates:
                        preview_candidates.append(m)
            if preview_candidates:
                model_names = preview_candidates
                action_log.append(f"Using preview variants: {', '.join(model_names)}")
        if not model_names:
            legacy = [m for m in available_models if m.startswith("gemini-1.5")]
            if legacy:
                model_names = legacy[:2]
                action_log.append(f"Falling back to legacy models: {', '.join(model_names)}")
        if not model_names:
            model_names = available_models[:2]
            action_log.append(f"Using first available models: {', '.join(model_names)}")
        print(f"Using available models from API: {model_names}")
    else:
        model_names = stable_preferred
        action_log.append(f"API listing failed, using fallback: {', '.join(model_names)}")
        print(f"Using fallback models (API listing failed): {model_names}")

    prompt_limit = (
        ENGINEERING_PROMPT_LIMIT if doc_type == "engineering"
        else TRANSMITTAL_PROMPT_LIMIT if doc_type == "transmittal"
        else None
    )
    # For images, we still need prompt text (empty string is fine, prompt will be built)
    prompt_text = prepare_prompt_text(text or "", doc_type, prompt_limit) if text else ""
    prompt = build_prompt(prompt_text, doc_type, sector_slug)
    if prompt_limit:
        action_log.append(f"Prompt truncated to {prompt_limit} characters for {doc_type} document")
    last_error = None
    response = None
    resolved_model = None
    attempt_log = []

    for model_name in model_names:
        for attempt in range(3):
            attempt_detail = {
                "model": model_name,
                "attempt": attempt + 1,
                "status": "pending",
                "message": ""
            }
            action_log.append(f"Trying {model_name} (Attempt {attempt + 1})")
            try:
                print(f"Trying model: {model_name}")
                model = genai.GenerativeModel(model_name)
                # Use longer timeout for engineering (large PDFs), shorter for others
                timeout_seconds = 60 if doc_type == "engineering" else 30
                
# Prepare content for Gemini
                if image_path:
                    # Use Gemini vision API for images with table-optimized preprocessing
                    import pathlib
                    from PIL import Image
                    image_file = pathlib.Path(image_path)
                    if not image_file.exists():
                        attempt_detail["status"] = "error"
                        attempt_detail["message"] = f"Image file not found: {image_path}"
                        action_log.append(f"âœ— Image file not found: {image_path}")
                        continue
                    
                    # ENHANCED: Table-optimized image preprocessing
                    try:
                        from services.image_preprocessing import process_image_for_extraction
                        
                        # Process image: enhance for tables, assess quality
                        enhanced_path, ocr_text, quality = process_image_for_extraction(image_path)
                        action_log.append(f"ðŸ“Š Image quality: {quality['quality_level']} (sharpness: {quality['sharpness']:.1f})")
                        
                        # Use enhanced image
                        img = Image.open(enhanced_path)
                        
                        # For engineering docs, use focused vision prompt
                        if doc_type == "engineering":
                            vision_prompt = """Extract data from this structural schedule table into JSON.

CRITICAL - COLUMN MAPPING:
Look at the table carefully. Identify these columns by their headers:
1. Mark (member ID like "B1", "NB-01", "C1")
2. Size/Section (CRITICAL - formats like "310UC158", "250UB37.2", "WB1220Ã—6.0")
3. Qty (quantity - numbers)
4. Length (in mm)
5. Grade (steel grade like "300", "300PLUS", "350L0")
6. Paint System (coating type)
7. Comments/Remarks

THE SIZE COLUMN IS CRITICAL:
- Never mark Size as "N/A" unless the cell is truly empty
- Common patterns: "310UC158", "250UB37.2", "200PFC", "WB1220Ã—6.0"
- Extract EXACTLY what you see in each Size cell
- The Size column is usually the 2nd column after Mark

Extract ALL visible rows. Return JSON array only, no markdown.
"""
                            content_parts = [img, vision_prompt]
                        else:
                            # Use regular prompt for other document types
                            content_parts = [img, prompt]
                        
                        response = model.generate_content(content_parts, request_options={"timeout": timeout_seconds})
                        action_log.append(f"âœ“ Vision API (table-optimized) succeeded with {model_name}")
                        
                    except ImportError:
                        # Fallback: use original image without preprocessing
                        action_log.append("âš  Image preprocessing unavailable - using original")
                        img = Image.open(image_path)
                        content_parts = [img, prompt]
                        response = model.generate_content(content_parts, request_options={"timeout": timeout_seconds})
                        action_log.append(f"âœ“ Vision API call succeeded with {model_name}")
                    except Exception as img_error:
                        attempt_detail["status"] = "error"
                        attempt_detail["message"] = f"Failed to process image: {img_error}"
                        action_log.append(f"âœ— Failed to process image: {img_error}")
                        continue
                else:
                    # Regular text-based processing
                    response = model.generate_content(prompt, request_options={"timeout": timeout_seconds})
                    action_log.append(f"API call succeeded with {model_name}")
                
                resolved_model = model_name

                if not response or not hasattr(response, 'text') or not response.text:
                    print(f"Error: Empty response from Gemini API with model {model_name}")
                    attempt_detail["status"] = "no_response"
                    attempt_detail["message"] = "Empty response"
                    attempt_log.append(attempt_detail)
                    action_log.append(f"Empty response from {model_name}")
                    continue

                # Import sanitization utilities
                from utils.encoding_fix import sanitize_json_response, sanitize_dict
                
                # Clean the JSON string before parsing (fixes corrupt UTF-8 characters)
                clean_json = sanitize_json_response(response.text)
                parsed = json.loads(clean_json)
                
                # Sanitize all string values in the parsed data
                parsed = sanitize_dict(parsed)
                
                # Handle different return structures
                if doc_type == "transmittal":
                    # Transmittal returns a single object with multiple arrays
                    entries = [parsed] if isinstance(parsed, dict) else parsed if isinstance(parsed, list) else []
                elif doc_type == "logistics":
                    # Logistics returns {document_type: "...", rows: [...]}
                    if isinstance(parsed, dict) and "rows" in parsed:
                        entries = parsed["rows"]
                        # Add document_type to each row for display purposes
                        document_type = parsed.get('document_type', 'unknown')
                        for entry in entries:
                            if isinstance(entry, dict):
                                entry['_document_type'] = document_type
                        action_log.append(f"Detected logistics document type: {document_type}")
                    else:
                        # Fallback: treat as regular array
                        entries = parsed if isinstance(parsed, list) else [parsed] if isinstance(parsed, dict) else []
                else:
                    entries = parsed if isinstance(parsed, list) else [parsed] if isinstance(parsed, dict) else []

                # Detect schedule type for engineering documents
                schedule_type = None
                if doc_type == "engineering" and entries:
                    first_entry = entries[0] if isinstance(entries[0], dict) else {}
                    # Check if it's a column schedule (has SectionType, BasePlate, or CapPlate)
                    if "SectionType" in first_entry or "BasePlate" in first_entry or "CapPlate" in first_entry:
                        fields = ENGINEERING_COLUMN_FIELDS
                        schedule_type = "column"
                        action_log.append("Detected COLUMN schedule type")
                    else:
                        fields = ENGINEERING_BEAM_FIELDS
                        schedule_type = "beam"
                        action_log.append("Detected BEAM schedule type")
                    error_field = ERROR_FIELD.get(doc_type, fields[-1])
                    
                    # Validate fields for engineering
                    for entry in entries:
                        for field in fields:
                            entry.setdefault(field, "N/A")
                elif doc_type == "transmittal":
                    # For transmittal, ensure required keys exist
                    for entry in entries:
                        if isinstance(entry, dict):
                            for key in ['DrawingRegister', 'Standards', 'Materials', 'Connections', 'Assumptions', 'VOSFlags', 'CrossReferences']:
                                if key not in entry:
                                    entry[key] = [] if key != 'DrawingRegister' else {}

                if entries:
                    attempt_detail["status"] = "success"
                    attempt_detail["message"] = f"Extracted {len(entries)} row(s)"
                    attempt_log.append(attempt_detail)
                    print(f"Successfully extracted {len(entries)} rows with {model_name} for {doc_type}")
                    action_log.append(f"Success with {model_name}: extracted {len(entries)} row(s)")
                    
                    # PHASE 3: Validate and auto-correct engineering extractions
                    if doc_type == "engineering" and entries:
                        try:
                            from services.engineering_validator import validate_schedule
                            
                            # Run validation
                            validation_report = validate_schedule(entries, schedule_type)
                            
                            # Log validation results
                            action_log.append(f"ðŸ“‹ Validation: {validation_report['valid_rows']}/{validation_report['total_rows']} rows valid")
                            
                            if validation_report['rows_with_corrections'] > 0:
                                action_log.append(f"âœ“ Applied {validation_report['rows_with_corrections']} auto-correction(s)")
                                # Use corrected entries
                                entries = validation_report['corrected_entries']
                                
                                # Log specific corrections
                                for row_val in validation_report['row_validations']:
                                    if row_val['corrections']:
                                        mark = row_val['corrected_row'].get('Mark', f"Row {row_val['row_index']}")
                                        for correction in row_val['corrections']:
                                            action_log.append(f"  â€¢ {mark}: {correction}")
                            
                            if validation_report['rows_with_errors'] > 0:
                                action_log.append(f"âš  {validation_report['rows_with_errors']} row(s) have errors requiring manual review")
                            
                            if validation_report['rows_with_warnings'] > 0:
                                action_log.append(f"âš  {validation_report['rows_with_warnings']} row(s) have warnings")
                                
                        except ImportError:
                            action_log.append("âš  Engineering validator unavailable - skipping validation")
                        except Exception as val_error:
                            action_log.append(f"âš  Validation error: {val_error}")
                    
                    return entries, None, resolved_model, attempt_log, action_log, schedule_type

                attempt_detail["status"] = "no_data"
                attempt_detail["message"] = "No structured data returned"
                attempt_log.append(attempt_detail)
                last_error = "No structured data returned"
                action_log.append(f"No structured data returned from {model_name}")
                continue

            except json.JSONDecodeError as e:
                print(f"JSON Parse Error with {model_name}: {e}")
                response_text = response.text if response and hasattr(response, 'text') else 'No response'
                print(f"Response text: {response_text}")
                last_error = f"JSON parse error: {str(e)}"
                attempt_detail["status"] = "json_error"
                attempt_detail["message"] = str(e)
                attempt_log.append(attempt_detail)
                action_log.append(f"JSON parse error for {model_name}: {str(e)}")
                continue

            except (TimeoutError,) + ((grpc.RpcError,) if grpc else ()) as e:
                error_type = type(e).__name__
                error_msg = str(e)
                print(f"Gemini timeout/error with {model_name}: {error_type}: {error_msg}")
                
                # For timeouts, try shortening prompt once, then move to next model
                is_timeout = "DeadlineExceeded" in error_msg or "504" in error_msg or "timeout" in error_msg.lower() or isinstance(e, TimeoutError)
                
                if is_timeout and doc_type == "engineering" and prompt_limit == ENGINEERING_PROMPT_LIMIT and attempt == 0:
                    # First attempt timeout - shorten prompt and retry once
                    prompt_limit = ENGINEERING_PROMPT_LIMIT_SHORT
                    prompt_text = prepare_prompt_text(text, doc_type, prompt_limit)
                    prompt = build_prompt(prompt_text, doc_type, sector_slug)
                    action_log.append(f"Timeout detected - shortening prompt to {prompt_limit} chars and retrying {model_name}")
                    time.sleep(2)  # Brief delay before retry
                    continue
                
                attempt_detail["status"] = "error"
                attempt_detail["message"] = f"{error_type}: {error_msg}"
                attempt_log.append(attempt_detail)
                action_log.append(f"{model_name} (Attempt {attempt + 1}) error: {error_type}: {error_msg}")
                
                # For timeouts, move to next model immediately (don't retry same model)
                if is_timeout:
                    action_log.append(f"Timeout on {model_name} - moving to next model (timeouts indicate model overload)")
                    last_error = f"{error_type}: {error_msg}"
                    break
                
                # For other errors, retry with backoff
                if attempt < 2:
                    backoff_delay = 2 ** attempt
                    action_log.append(f"Waiting {backoff_delay} second(s) before retry (exponential backoff)")
                    time.sleep(backoff_delay)
                    continue
                action_log.append(f"All retries exhausted for {model_name}, trying next model")
                last_error = f"{error_type}: {error_msg}"
                break

            except Exception as e:
                error_type = type(e).__name__
                error_msg = str(e)
                print(f"Gemini API Error with {model_name}: {error_type}: {error_msg}")
                is_not_found = (
                    'NotFound' in error_type or
                    '404' in error_msg or
                    'not found' in error_msg.lower() or
                    (google_exceptions and isinstance(e, google_exceptions.NotFound))
                )
                attempt_detail["status"] = "error"
                attempt_detail["message"] = f"{error_type}: {error_msg}"
                attempt_log.append(attempt_detail)
                action_log.append(f"{model_name} (Attempt {attempt + 1}) error: {error_type}: {error_msg}")
                if is_not_found and attempt < 2:
                    backoff_delay = 2 ** attempt
                    action_log.append(f"Model not found, waiting {backoff_delay} second(s) before retry")
                    time.sleep(backoff_delay)
                    continue
                last_error = f"API error: {error_type} - {error_msg}"
                action_log.append(f"All retries exhausted for {model_name}, trying next model")
                break
        else:
            continue
        break

    action_log.append(f"All models failed for this document: {last_error or 'Unknown error'}")
    return [error_entry(last_error or "All models failed")], last_error or "All models failed", resolved_model, attempt_log, action_log, None