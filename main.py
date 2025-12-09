import os
import json
from flask import Flask, request, render_template_string, session, Response, send_file, abort, url_for, send_from_directory, redirect, jsonify
import google.generativeai as genai
import pdfplumber
import pandas as pd
import io
import grpc
import time
from werkzeug.utils import secure_filename
import requests
from urllib.parse import quote

# Try to import specific exception types
try:
    from google.api_core import exceptions as google_exceptions
except ImportError:
    google_exceptions = None

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')

# --- CONFIGURATION ---
api_key = os.environ.get("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)

FINANCE_UPLOAD_DIR = os.path.join('uploads', 'finance')
os.makedirs(FINANCE_UPLOAD_DIR, exist_ok=True)

# --- DEPARTMENT CONFIG ---
DEFAULT_DEPARTMENT = "finance"
DEPARTMENT_SAMPLES = {
    "finance": {
        "label": "Sample invoices",
        "description": "Finance department samples",
        "folder": "invoices",
        "samples": [
            {"path": "invoices/Bne.pdf", "label": "Subcontractor Invoice (Table)"},
            {"path": "invoices/CloudRender.pdf", "label": "SaaS Invoice (Modern)"},
            {"path": "invoices/Tingalpa.pdf", "label": "Hardware Receipt (Thermal)"}
        ]
    },
    "engineering": {
        "label": "Structural drawings",
        "description": "Engineering department samples",
        "folder": "drawings",
        "samples": [
            {"path": "drawings/schedule_cad.pdf", "label": "Roof Beam Schedule (CAD)"},
            {"path": "drawings/schedule_revit.pdf", "label": "Column Schedule (Revit)"}
        ]
    },
    "transmittal": {
        "label": "Drawing register samples",
        "description": "Structural drafter transmittal samples",
        "folder": "drawings",
        "samples": [
            {"path": "drawings/s001_general_notes.pdf", "label": "S-001 General Notes"},
            {"path": "drawings/s100_foundation_plan.pdf", "label": "S-100 Foundation Plan"},
            {"path": "drawings/s101_ground_floor_plan.pdf", "label": "S-101 Ground Floor"},
            {"path": "drawings/s102_framing_plan.pdf", "label": "S-102 Framing Plan"},
            {"path": "drawings/s500_standard_details.pdf", "label": "S-500 Details"}
        ]
    }
}
SAMPLE_TO_DEPT = {
    sample["path"]: dept_key
    for dept_key, group in DEPARTMENT_SAMPLES.items()
    for sample in group["samples"]
}
ROUTINE_DESCRIPTIONS = {
    "finance": [
        ("Finance / Admin: \"The Invoice Gatekeeper\"",
         """<p><strong>What it does:</strong> It acts as an <strong>Intelligent Document Processing (IDP)</strong> engine, translating raw incoming PDF bills (from subcontractors, hardware stores, software subscriptions, etc.) into structured data. It ignores layout variations and reliably extracts the core financial fields required to push the bill into your accounting platform (Xero/MYOB).</p>
         <p><strong>The Current Grind:</strong> The workflow involves excessive manual repetition: an admin staff member opens an email, saves the PDF, manually types the Vendor name, Date, Total, and Invoice ID into the accounting platform, and cross-checks for errors.</p>
         <p><strong>Frequency:</strong> Daily volume for a 70-staff firm is typically <strong>70–100 documents</strong> every week (external vendor invoices alone). We will initially focus the pilot on vendor invoices.</p>
         <p><strong>The Saving (Vendor Invoices Only):</strong><br>Manual: 3 minutes per document × 70 docs = <strong>3.5 hours/week</strong>.<br>AI: Near-instant. Accuracy is the new focus.<br><strong>Value:</strong> This immediate saving frees the Office Manager to focus on strategic tasks like staff culture, cost centre analysis, and debt recovery rather than transactional data entry.</p>
         <hr style="margin: 20px 0;">
         <p><strong>Future Impact: Internal Documents (Phase 2 Upside)</strong><br>The greatest opportunity lies in extending this capability to <strong>internal documents</strong>. By proving the engine on external invoices, the firm gains a validated tool ready to automate staff timesheets, project expense receipts, and internal cost allocations. This dramatically expands efficiency and eliminates manual project coding errors.</p>"""),
    ],
    "engineering": [
        ("Structural Engineer: \"The Schedule Digitiser\"",
         """<p><strong>What it does:</strong> It converts "dead" data (text inside a PDF drawing) into "live" data (Excel cells). It takes a list of beams or columns from a drawing and prepares it for calculation or ordering.</p>
         <p><strong>The Current Grind:</strong> An engineer needs to check the capacity of 50 columns or prepare a bill of materials. They look at the PDF schedule on the left screen and manually type member details (e.g., "310UC158") into a spreadsheet on the right screen, one by one.</p>
         <p><strong>Frequency:</strong> Project-Based (Bursts). This happens heavily at the start of a project, during major design revisions, and when preparing tender packages.</p>
         <p><strong>The Saving:</strong><br>Manual: 45–60 minutes per major schedule.<br>AI: 30 seconds.<br><strong>Value:</strong> The AI eliminates <strong>Transcription Error</strong>—a catastrophic risk in capacity checking or steel ordering. It guarantees data integrity for calculation or fabrication takeoff.</p>
         <p><strong>Note:</strong> This demo is tuned for the two structural schedules provided (`schedule_cad.pdf` and `schedule_revit.pdf`). Upload files with the same fields (Mark/Size/Qty/Length/Grade/PaintSystem/Comments), even if the layout is slightly different, so the extraction schema still applies.</p>""")
    ],
    "transmittal": [
        ("Structural Drafter: \"Automated Drawing Register\"",
         """<p><strong>Current Grind:</strong> Drafters spend hours opening drawing PDFs, manually recording drawing numbers, revisions, titles, scales, and approval dates into a transmittal register. For a 50-drawing package, this takes 30-45 minutes of repetitive clicking and typing across inconsistent title block layouts.</p>
         <p><strong>The Demo:</strong> Upload the five drawing PDFs supplied (S-001, S-100, S-101, S-102, S-500). The AI scans the title block and extracts Drawing Number, Revision, Drawing Title, and Scale from each, handling mixed title block layouts automatically.</p>
         <p><strong>Input Constraint:</strong> Files must contain the same metadata fields (Drawing Number, Revision, Title, Scale, Date, Status, Sheet Count, Project) even if the layout differs. The extraction schema normalizes across variations.</p>
         <p><strong>Outcome:</strong> A "Document Register" that your team can email or drop into Excel as a transmittal—ready for client distribution, RFI tracking, or compliance audits.</p>
         <p><strong>The Saving:</strong><br>Manual: 30-45 min per transmittal.<br>AI: 20 seconds.<br><strong>Value:</strong> Zero transcription errors (no mismatched rev letters, drawing numbers, or dates) + auditable extraction trail for compliance.</p>""")
    ]
}

ROUTINE_SUMMARY = {
    "finance": [
        ("Grind", "Admin opens email, saves the PDF, opens Xero, manually types Vendor, Date, Total, and checks for typos."),
        ("Frequency", "Daily; more realistic volume of <strong>70 documents</strong> per week for a 70-person firm (Vendor Invoices only)."),
        ("Saving", "Manual: 3 min/document × 70 docs = <strong>3.5 hours/week</strong>. AI: Near-instant."),
        ("Value", "Immediate efficiency frees up Office Manager time for strategic tasks (culture, billing), enabling a capacity reallocation upside of up to <strong>$1.44 M</strong> annually (Tier 4).")
    ],
    "engineering": [
        ("Grind", "Engineers read 50 column/beam entries, manually typing 310UC158 into Excel for each."),
        ("Frequency", "Project bursts—during project start and major revisions."),
        ("Saving", "Manual: 45–60 min per schedule. AI: 30 seconds."),
        ("Value", "Eliminates transcription errors (e.g., 310UB vs 310UC).")
    ],
    "transmittal": [
        ("Grind", "Drafters open 20–50 drawings, copying Drawing No/Rev/Title/Scale by hand."),
        ("Frequency", "Weekly to help compile client transmittals."),
        ("Saving", "Manual: hours of typing. AI: builds the register instantly."),
        ("Value", "Avoids Friday-afternoon typos and keeps registers accurate.")
    ]
}

ENGINEERING_PROMPT_LIMIT = 6000
ENGINEERING_PROMPT_LIMIT_SHORT = 3200
TRANSMITTAL_PROMPT_LIMIT = 3200

def prepare_prompt_text(text, doc_type, limit=None):
    cleaned = text.replace("\n", " ").strip()
    if doc_type == "engineering":
        limit = ENGINEERING_PROMPT_LIMIT_SHORT if limit is None else limit
        return cleaned[:limit]
    if doc_type == "transmittal":
        limit = TRANSMITTAL_PROMPT_LIMIT if limit is None else limit
        return cleaned[:limit]
    return cleaned

ALLOWED_SAMPLE_PATHS = {
    sample["path"]
    for group in DEPARTMENT_SAMPLES.values()
    for sample in group["samples"]
}

# Cache for available models
_available_models = None
FINANCE_FIELDS = ["Vendor", "Date", "InvoiceNum", "Cost", "GST", "FinalAmount", "Summary"]
ENGINEERING_BEAM_FIELDS = ["Mark", "Size", "Qty", "Length", "Grade", "PaintSystem", "Comments"]
ENGINEERING_COLUMN_FIELDS = ["Mark", "SectionType", "Size", "Length", "Grade", "BasePlate", "CapPlate", "Finish", "Comments"]
TRANSMITTAL_FIELDS = ["DwgNo", "Rev", "Title", "Scale"]
DOC_FIELDS = {
    "finance": FINANCE_FIELDS,
    "engineering": ENGINEERING_BEAM_FIELDS,  # Default, will be overridden based on detected type
    "transmittal": TRANSMITTAL_FIELDS
}
ERROR_FIELD = {"finance": "Summary", "engineering": "Comments", "transmittal": "Title"}

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

def build_prompt(text, doc_type):
    """Build a prompt tailored to the selected department."""
    if doc_type == "engineering":
        return f"""
        You are a structural engineering assistant extracting data from a structural schedule PDF.
        
        STEP 1: Identify the schedule type by examining the column headers:
        - BEAM SCHEDULE: Has columns like "Mark", "Size", "Qty", "Length", "Grade", "Paint System", "Comments"
        - COLUMN SCHEDULE: Has columns like "Mark", "Section Type", "Size (mm)", "Length (mm)", "Grade", "Base Plate", "Cap Plate", "Finish", "Comments"
        
        STEP 2: Extract data based on the schedule type:
        
        IF BEAM SCHEDULE, return objects with these keys:
        - "Mark": Short identifier (e.g., B-101, P1, STR-1) from MARK column. DO NOT extract detail references like "D1/S-500" from Comments.
        - "Size": Complete section size (e.g., 460UB82.1, 200PFC, 75×75×4 SHS)
        - "Qty": Quantity number (no units)
        - "Length": Length with units (e.g., "8500 mm"). If multiple lengths, combine: "1200 mm, 2400 mm"
        - "Grade": Material grade (e.g., 300PLUS, G300)
        - "PaintSystem": Paint/finish specification (e.g., "P1 (2 coats)", "HD Galv.")
        - "Comments": All notes and specifications
        
        IF COLUMN SCHEDULE, return objects with these keys:
        - "Mark": Short identifier (e.g., C1, C2) from MARK column. DO NOT extract detail references.
        - "SectionType": Section type (e.g., "Universal Column") from SECTION TYPE column
        - "Size": Complete size designation (e.g., "310 UC 158", "250 UC 89.5") from SIZE (mm) column
        - "Length": Length with units (e.g., "4500 mm") from LENGTH (mm) column
        - "Grade": Material grade (e.g., 350L0, 300PLUS) from GRADE column
        - "BasePlate": Base plate specification (e.g., "BP-01 (25mm)") from BASE PLATE column, or "N/A"
        - "CapPlate": Cap plate specification (e.g., "CP-01 (20mm)") from CAP PLATE column, or "N/A"
        - "Finish": Finish specification (e.g., "HD Galv.", "Paint System A") from FINISH column
        - "Comments": All notes and specifications from COMMENTS column
        
        CRITICAL RULES:
        1. FIRST identify ALL column headers to determine schedule type
        2. Mark values are SHORT (2-6 chars) like "B-101", "C1" - NOT detail references like "D1/S-500"
        3. Extract Mark ONLY from MARK column, never from Comments/Remarks
        4. Extract complete values exactly as shown in PDF
        5. Create ONE object per UNIQUE MARK - do NOT split same mark into multiple rows
        6. If multiple lengths exist for one mark, combine in Length field: "1200 mm, 2400 mm"
        7. Use "N/A" for missing fields or non-existent columns
        8. Verify data makes engineering sense (Length is numeric with units, Grade is grade designation, etc.)
        
        Return ONLY a valid JSON array (no markdown, no explanation, no code blocks).

        TEXT: {text}
        """
    if doc_type == "transmittal":
        return f"""
        You are an advanced structural engineering document analyzer extracting comprehensive structured data from drawing PDFs.
        
        Extract data into these categories and return a JSON object with these keys:
        
        1. "DrawingRegister" - Basic drawing metadata (always extract):
           - "DwgNo": Drawing number (e.g., S-001, S-100, S-101)
           - "Rev": Revision (e.g., A, 0, C)
           - "Title": Drawing title (e.g., "GENERAL NOTES", "FOUNDATION PLAN")
           - "Scale": Scale (e.g., "1:100", "N.T.S")
        
        2. "Standards" - Array of standards referenced:
           - "Standard": Standard name (e.g., "AS 4100", "AS 3600", "AS/NZS 1170.1")
           - "Clause": Clause/section numbers (e.g., "Cl. 9.2, 13.4")
           - "Applicability": What it applies to (e.g., "Structural Steel Design")
        
        3. "Materials" - Array of material specifications:
           - "MaterialType": Type (e.g., "Concrete", "Steel Grade", "Bolts", "Grout")
           - "GradeSpec": Specification (e.g., "32 MPa", "300PLUS", "M24 Grade 8.8")
           - "Applications": Where used (e.g., "Slabs Zones A1/A2", "Columns C1-C2")
        
        4. "Connections" - Array of connection details:
           - "DetailMark": Connection mark (e.g., "CBP-01", "BCC-2", "BR-3")
           - "ConnectionType": Type description
           - "BoltSpec": Bolt specifications
           - "PlateSpec": Plate/member specifications
           - "WeldTorque": Weld or torque requirements
           - "DrawingRef": Reference to detail drawing
        
        5. "Assumptions" - Array of design assumptions:
           - "Assumption": What is assumed (e.g., "Foundation bearing capacity")
           - "Value": The value (e.g., "250 kPa minimum")
           - "Location": Where it applies (e.g., "All footings", "Zones B1/B2")
           - "Critical": Criticality level (e.g., "CRITICAL", "HIGH")
           - "VerificationMethod": How to verify
        
        6. "VOSFlags" - Array of "Verify on Site" items:
           - "FlagID": Identifier (e.g., "V.O.S.-01")
           - "Item": What needs verification
           - "Issue": The issue or requirement
           - "ActionRequired": What action is needed
           - "ResponsibleParty": Who is responsible
        
        7. "CrossReferences" - Array of cross-references:
           - "Reference": The reference text (e.g., "See Detail D1/S-500")
           - "ReferencedIn": Which drawing contains the reference
           - "RefersTo": What it refers to (e.g., "Detail D1 on S-500")
        
        EXTRACTION RULES:
        - Extract ALL standards mentioned (AS, AS/NZS, NCC codes)
        - Extract ALL material grades and specifications
        - Extract ALL connection detail marks and their specs
        - Extract ALL design assumptions, bearing capacities, slab thicknesses, grid spacing, FRL requirements
        - Extract ALL "V.O.S.", "Verify on Site", "Check", or similar flags
        - Extract ALL "See Detail", "Ref:", "Refer to" cross-references
        - For standards: Look in notes, specifications, detail callouts
        - For materials: Extract from schedules, notes, detail specifications
        - For connections: Extract from detail marks, connection tables, specifications
        - For assumptions: Extract from notes, plan annotations, general notes
        - For VOS: Look for explicit "V.O.S.", "Verify", "Check on site" text
        - For cross-refs: Extract all "See Detail X", "Ref: Detail Y", "Refer to Z" mentions
        
        Return a JSON object with all 7 keys. Use empty arrays [] if a category has no data.
        Return ONLY valid JSON (no markdown, no explanation, no code blocks).

        TEXT: {text}
        """
    return f"""
    Extract specific fields from this invoice text as JSON.
    Fields: Vendor, Date (YYYY-MM-DD), InvoiceNum, Cost (pre-tax amount), GST (tax component, use "N/A" if not listed), FinalAmount (total payable), Summary (3-5 words).
    Keys: "Vendor", "Date", "InvoiceNum", "Cost", "GST", "FinalAmount", "Summary".
    Use "N/A" for missing fields. Return ONLY JSON.

    TEXT: {text}
    """


# --- HTML TEMPLATE ---
HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
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
            </div>

            <h3>1. Select Sample Files</h3>
            {% for dept_key, group in sample_files.items() %}
            <div class="sample-group" data-department="{{ dept_key }}">
                <strong>{{ group.label }}</strong> · {{ group.description }}
                <div style="margin-top: 10px;">
                    {% for sample in group.samples %}
                    {% if dept_key == 'finance' %}
                    <div class="finance-sample-row">
                        <span class="finance-sample-pill">✅ {{ sample.label }}</span>
                        <a href="{{ url_for('view_sample') }}?path={{ sample.path }}" target="_blank" rel="noopener" style="margin-left: 8px; color: #D4AF37;">🔗</a>
                        <input type="hidden" name="finance_defaults" value="{{ sample.path }}">
                    </div>
                    {% elif dept_key == 'transmittal' %}
                    <div class="transmittal-sample-row">
                        <span class="transmittal-sample-pill">✅ {{ sample.label }}</span>
                        <a href="{{ url_for('view_sample') }}?path={{ sample.path }}" target="_blank" rel="noopener" style="margin-left: 8px; color: #D4AF37;">🔗</a>
                        <input type="hidden" name="transmittal_defaults" value="{{ sample.path }}">
                    </div>
                    {% else %}
                    <label>
                        {% if dept_key == 'engineering' %}
                        <input type="radio" name="samples" value="{{ sample.path }}" {% if sample.path in selected_samples %}checked{% endif %}>
                        {% else %}
                        <input type="checkbox" name="samples" value="{{ sample.path }}" {% if sample.path in selected_samples %}checked{% endif %}>
                        {% endif %}
                        {{ sample.label }}
                        <a href="{{ url_for('view_sample') }}?path={{ sample.path }}" target="_blank" rel="noopener" style="margin-left: 8px; color: #D4AF37;">🔗</a>
                    </label>
                    {% endif %}
                    {% endfor %}
                </div>
                {% if dept_key == 'finance' %}
                <div class="upload-wrapper" data-upload="finance">
                    <label class="file-label">
                        <span>📤 Upload invoice PDFs</span>
                        <input type="file" name="finance_uploads" accept=".pdf" multiple>
                    </label>
                    <p class="instruction-text">PDF invoices only. Uploaded files run alongside the finance samples.</p>
                    <div class="upload-list" id="finance-upload-list" style="display: none;"></div>
                </div>
                {% endif %}
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
                                <span style="color: #27ae60; font-weight: 600;">✓ Found</span>
                                {% elif 'no' in found|lower or 'false' in found|lower %}
                                <span style="color: #e74c3c; font-weight: 600;">✗ Missing</span>
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
        
        {% if department == 'finance' or department == 'engineering' %}
        <table>
            <thead>
                <tr>
                    <th>Filename</th>
                    {% if department == 'finance' %}
                <th>Vendor</th>
                <th>Date</th>
                <th>Invoice #</th>
                    <th class="currency">Cost</th>
                    <th class="currency">GST</th>
                    <th class="currency">Final Amount</th>
                <th>Summary</th>
                    {% elif department == 'engineering' and schedule_type == 'column' %}
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
            {% for row in results %}
            <tr>
                <td>{{ row.Filename }}</td>
                    {% if department == 'finance' %}
                <td>{{ row.Vendor }}</td>
                <td>{{ row.Date }}</td>
                <td>{{ row.InvoiceNum }}</td>
                    <td class="currency">{{ row.CostFormatted or row.Cost or 'N/A' }}</td>
                    <td class="currency">{{ row.GSTFormatted if row.GSTFormatted and row.GSTFormatted != 'N/A' else (row.GST or 'N/A') }}</td>
                    <td class="currency">{{ row.FinalAmountFormatted or row.TotalFormatted or row.FinalAmount or row.Total or 'N/A' }}</td>
                <td>{{ row.Summary }}</td>
                    {% elif department == 'transmittal' %}
                    <td>{{ row.DwgNo }}</td>
                    <td>{{ row.Rev }}</td>
                    <td>{{ row.Title }}</td>
                    <td>{{ row.Scale }}</td>
                    {% elif department == 'engineering' and schedule_type == 'column' %}
                    <td>{{ row.Mark }}</td>
                    <td>{{ row.SectionType }}</td>
                    <td>{{ row.Size }}</td>
                    <td>{{ row.Length }}</td>
                    <td>{{ row.Grade }}</td>
                    <td>{{ row.BasePlate }}</td>
                    <td>{{ row.CapPlate }}</td>
                    <td>{{ row.Finish }}</td>
                    <td>{{ row.Comments }}</td>
                    {% else %}
                    <td>{{ row.Mark }}</td>
                    <td>{{ row.Size }}</td>
                    <td>{{ row.Qty }}</td>
                    <td>{{ row.Length }}</td>
                    <td>{{ row.Grade }}</td>
                    <td>{{ row.PaintSystem }}</td>
                    <td>{{ row.Comments }}</td>
                    {% endif %}
            </tr>
            {% endfor %}
            </tbody>
        </table>
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
                <a href="/" class="btn btn-secondary">Start Over</a>
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
                item.textContent = `📎 ${file.name}`;
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
def format_currency(value):
    """Format a number as currency with dollar sign and commas"""
    if not value or value == "" or value == "N/A":
        return ""
    try:
        # Try to convert to float
        num_value = float(str(value))
        # Format with dollar sign, commas, and 2 decimal places
        return f"${num_value:,.2f}"
    except (ValueError, TypeError):
        # If conversion fails, return as is
        return str(value) if value else ""

def extract_text(file_obj):
    text = ""
    try:
        with pdfplumber.open(file_obj) as pdf:
            for page in pdf.pages:
                extracted = page.extract_text()
                if extracted:
                    text += extracted + "\n"
        if not text.strip():
            return f"Error: No text extracted from PDF"
    except Exception as e:
        print(f"PDF Extraction Error: {type(e).__name__}: {str(e)}")
        return f"Error: {e}"
    return text

def analyze_gemini(text, doc_type):
    """Call Gemini with a doc-type-specific prompt and return entries, error, model used, attempt log, action log, and schedule_type."""
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

    if not text or text.startswith("Error:"):
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
    prompt_text = prepare_prompt_text(text, doc_type, prompt_limit)
    prompt = build_prompt(prompt_text, doc_type)
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
                response = model.generate_content(prompt, request_options={"timeout": timeout_seconds})
                resolved_model = model_name
                action_log.append(f"✓ API call succeeded with {model_name}")

                if not response or not hasattr(response, 'text') or not response.text:
                    print(f"Error: Empty response from Gemini API with model {model_name}")
                    attempt_detail["status"] = "no_response"
                    attempt_detail["message"] = "Empty response"
                    attempt_log.append(attempt_detail)
                    action_log.append(f"Empty response from {model_name}")
                    continue

                clean_json = response.text.replace("```json", "").replace("```", "").strip()
                parsed = json.loads(clean_json)
                
                # Handle different return structures
                if doc_type == "transmittal":
                    # Transmittal returns a single object with multiple arrays
                    entries = [parsed] if isinstance(parsed, dict) else parsed if isinstance(parsed, list) else []
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

            except (grpc.RpcError, TimeoutError) as e:
                error_type = type(e).__name__
                error_msg = str(e)
                print(f"Gemini timeout/error with {model_name}: {error_type}: {error_msg}")
                
                # For timeouts, try shortening prompt once, then move to next model
                is_timeout = "DeadlineExceeded" in error_msg or "504" in error_msg or "timeout" in error_msg.lower() or isinstance(e, TimeoutError)
                
                if is_timeout and doc_type == "engineering" and prompt_limit == ENGINEERING_PROMPT_LIMIT and attempt == 0:
                    # First attempt timeout - shorten prompt and retry once
                    prompt_limit = ENGINEERING_PROMPT_LIMIT_SHORT
                    prompt_text = prepare_prompt_text(text, doc_type, prompt_limit)
                    prompt = build_prompt(prompt_text, doc_type)
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

    action_log.append(f"✗ All models failed for this document: {last_error or 'Unknown error'}")
    return [error_entry(last_error or "All models failed")], last_error or "All models failed", resolved_model, attempt_log, action_log, None

# --- ROUTES ---
# Serve static assets (CSS, JS, images)
@app.route('/assets/<path:filename>')
def assets(filename):
    return send_from_directory('assets', filename)

# Serve invoice PDFs
@app.route('/invoices/<path:filename>')
def invoices(filename):
    return send_from_directory('invoices', filename)

# Serve drawing PDFs
@app.route('/drawings/<path:filename>')
def drawings(filename):
    return send_from_directory('drawings', filename)

# Serve static website files
@app.route('/homepage')
@app.route('/homepage.html')
def homepage():
    try:
        return send_file('homepage.html')
    except:
        return "Homepage not found.", 404

@app.route('/contact')
@app.route('/contact.html')
def contact_page():
    try:
        return send_file('contact.html')
    except:
        return "Contact page not found.", 404

@app.route('/about')
@app.route('/about.html')
def about_page():
    try:
        return send_file('about.html')
    except:
        return "About page not found.", 404

@app.route('/services')
@app.route('/services.html')
def services_page():
    try:
        return send_file('services.html')
    except:
        return "Services page not found.", 404

@app.route('/faq')
@app.route('/faq.html')
def faq_page():
    try:
        return send_file('faq.html')
    except:
        return "FAQ page not found.", 404

@app.route('/target-markets')
@app.route('/target-markets.html')
def target_markets():
    try:
        return send_file('target-markets.html')
    except:
        return "Target Markets page not found.", 404

@app.route('/accounting')
@app.route('/accounting.html')
def accounting_page():
    try:
        return send_file('accounting.html')
    except:
        return "Accounting page not found.", 404

@app.route('/case-study')
@app.route('/case-study.html')
def case_study_page():
    try:
        return send_file('case-study.html')
    except:
        return "Case study page not found.", 404

@app.route('/search-results')
@app.route('/search-results.html')
def search_results_page():
    try:
        return send_file('search-results.html')
    except:
        return "Search results page not found.", 404

def extract_text_from_html(file_path):
    """
    Extract text content from an HTML file.
    Returns dict with title, content, and filename.
    """
    import re
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            html_content = f.read()
        
        # Extract title from <title> tag or first <h1>
        title_match = re.search(r'<title[^>]*>(.*?)</title>', html_content, re.IGNORECASE | re.DOTALL)
        title = title_match.group(1).strip() if title_match else ''
        # Clean title HTML entities
        title = re.sub('<[^<]+?>', '', title)
        title = re.sub(r'\s+', ' ', title).strip()
        
        # Extract content from <main>, <article>, or <body>
        # Try main first, then article, then body
        content_match = None
        for tag in ['<main', '<article', '<body']:
            pattern = rf'{tag}[^>]*>(.*?)</(?:main|article|body)>'
            match = re.search(pattern, html_content, re.IGNORECASE | re.DOTALL)
            if match:
                content_match = match
                break
        
        if not content_match:
            # Fallback: extract from body if no main/article
            body_match = re.search(r'<body[^>]*>(.*?)</body>', html_content, re.IGNORECASE | re.DOTALL)
            if body_match:
                content_html = body_match.group(1)
            else:
                content_html = html_content
        else:
            content_html = content_match.group(1)
        
        # Remove script and style tags completely
        content_html = re.sub(r'<script[^>]*>.*?</script>', '', content_html, flags=re.IGNORECASE | re.DOTALL)
        content_html = re.sub(r'<style[^>]*>.*?</style>', '', content_html, flags=re.IGNORECASE | re.DOTALL)
        
        # Remove HTML tags
        content_clean = re.sub('<[^<]+?>', '', content_html)
        
        # Remove extra whitespace and newlines
        content_clean = re.sub(r'\s+', ' ', content_clean).strip()
        
        # Get filename for link
        filename = os.path.basename(file_path)
        
        return {
            'title': title or filename.replace('.html', '').replace('-', ' ').title(),
            'content': content_clean,
            'link': f'/{filename}',
            'filename': filename
        }
    except Exception as e:
        print(f"Error extracting text from {file_path}: {e}")
        return None

def search_static_html_pages(query):
    """
    Search static HTML pages in the current directory.
    Returns list of relevant pages with extracted content.
    """
    import re
    
    # Pages to exclude from search (navigation, includes, etc.)
    excluded_pages = {
        'navbar.html', 'embed_snippet.html', 'index.html',  # index.html typically redirects
        'sitemap.html'  # Sitemap is not content
    }
    
    # Get all HTML files in the root directory
    html_files = []
    root_dir = os.path.dirname(os.path.abspath(__file__))
    
    for filename in os.listdir(root_dir):
        if filename.endswith('.html') and filename not in excluded_pages:
            html_files.append(os.path.join(root_dir, filename))
    
    # Extract content from all HTML files
    pages = []
    for file_path in html_files:
        page_data = extract_text_from_html(file_path)
        if page_data and page_data['content']:
            pages.append(page_data)
    
    if not pages:
        return []
    
    # Rank pages by relevance
    query_lower = query.lower()
    stop_words = {'what', 'is', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can'}
    query_words = set(word for word in query_lower.split() if word not in stop_words and len(word) > 2)
    
    if not query_words:
        query_words = set(query_lower.split())
    
    def calculate_page_relevance(page):
        score = 0
        title = page.get('title', '').lower()
        content = page.get('content', '').lower()
        filename = page.get('filename', '').lower()
        
        # Title matches are most important
        for word in query_words:
            if word in title:
                score += 10
            if word in filename:
                score += 8
            if word in content:
                score += 1
        
        # Exact phrase match bonus
        if query_lower in title:
            score += 20
        if query_lower in content:
            score += 5
        
        return score
    
    # Sort by relevance
    ranked_pages = sorted(pages, key=calculate_page_relevance, reverse=True)
    
    # Filter out pages with zero relevance and take top 5
    relevant_pages = [p for p in ranked_pages if calculate_page_relevance(p) > 0][:5]
    
    return relevant_pages

@app.route('/api/search-blog', methods=['POST'])
def search_blog_rag():
    """
    RAG Search: Fetches blog content from www.curam-ai.com.au and static HTML pages,
    then uses Gemini to generate answers.
    """
    try:
        data = request.get_json()
        query = data.get('query', '').strip()
        
        if not query:
            return jsonify({'error': 'Query is required'}), 400
        
        if not api_key:
            return jsonify({'error': 'Gemini API key not configured'}), 500
        
        # Step 1: Fetch blog content from WordPress REST API
        blog_url = 'https://www.curam-ai.com.au'
        wp_api_url = f'{blog_url}/wp-json/wp/v2/posts'
        
        posts = []
        try:
            # Try multiple search strategies to get most relevant posts
            all_posts = []
            
            # Strategy 1: Search in WordPress API (searches title, content, excerpt)
            try:
                response = requests.get(wp_api_url, params={
                    'per_page': 50, 
                    'search': query,
                    '_fields': 'id,title,content,excerpt,link'
                }, timeout=10)
                if response.status_code == 200:
                    search_results = response.json()
                    if search_results:
                        all_posts.extend(search_results)
            except Exception as e:
                print(f"WordPress search API error: {e}")
                pass
            
            # Strategy 2: Always also fetch recent posts as backup (WordPress search can be unreliable)
            try:
                response = requests.get(wp_api_url, params={
                    'per_page': 100,
                    '_fields': 'id,title,content,excerpt,link'
                }, timeout=15)
                if response.status_code == 200:
                    recent_posts = response.json()
                    # Merge with search results, avoiding duplicates
                    existing_ids = {p.get('id') for p in all_posts}
                    for post in recent_posts:
                        if post.get('id') not in existing_ids:
                            all_posts.append(post)
            except Exception as e:
                print(f"WordPress recent posts API error: {e}")
                pass
            
            # Rank posts by relevance (simple keyword matching)
            query_lower = query.lower()
            # Remove common stop words for better matching
            stop_words = {'what', 'is', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can'}
            query_words = set(word for word in query_lower.split() if word not in stop_words and len(word) > 2)
            
            # If all words were stop words, use original query
            if not query_words:
                query_words = set(query_lower.split())
            
            def calculate_relevance(post):
                score = 0
                title = post.get('title', {}).get('rendered', '').lower()
                excerpt = post.get('excerpt', {}).get('rendered', '').lower()
                content = post.get('content', {}).get('rendered', '').lower()
                
                # Title matches are most important
                for word in query_words:
                    if word in title:
                        score += 10
                    if word in excerpt:
                        score += 5
                    if word in content:
                        score += 1
                
                # Exact phrase match bonus
                if query_lower in title:
                    score += 20
                if query_lower in excerpt:
                    score += 10
                if query_lower in content:
                    score += 5
                
                return score
            
            # Sort by relevance and take top 5
            # Don't filter by score - even low scores might have relevant content
            posts = sorted(all_posts, key=calculate_relevance, reverse=True)[:5]
            
            # If top post has score 0, try a more lenient search
            if posts and calculate_relevance(posts[0]) == 0 and len(all_posts) > 5:
                # Try searching for any word in the query (more lenient)
                for word in query_words:
                    matching_posts = [p for p in all_posts 
                                    if word in p.get('title', {}).get('rendered', '').lower() 
                                    or word in p.get('excerpt', {}).get('rendered', '').lower()
                                    or word in p.get('content', {}).get('rendered', '').lower()]
                    if matching_posts:
                        posts = matching_posts[:5]
                        break
            
        except requests.RequestException as e:
            print(f"WordPress API request error: {e}")
            posts = []
        
        # Step 1b: Search static HTML pages
        static_pages = []
        try:
            static_pages = search_static_html_pages(query)
        except Exception as e:
            print(f"Error searching static HTML pages: {e}")
            static_pages = []
        
        # Step 2: Prepare context from blog posts and static HTML pages
        import re
        
        context = ""
        sources = []
        
        # Add blog posts to context
        if posts:
            for post in posts[:5]:  # Use top 5 most relevant posts
                title = post.get('title', {}).get('rendered', '')
                content = post.get('content', {}).get('rendered', '')
                link = post.get('link', '')
                excerpt = post.get('excerpt', {}).get('rendered', '')
                
                # Clean HTML tags more thoroughly
                content_clean = re.sub('<[^<]+?>', '', content)
                excerpt_clean = re.sub('<[^<]+?>', '', excerpt)
                
                # Remove extra whitespace and newlines
                content_clean = re.sub(r'\s+', ' ', content_clean).strip()
                excerpt_clean = re.sub(r'\s+', ' ', excerpt_clean).strip()
                
                # Get more content (up to 4000 chars per post since articles are ~1000 words)
                # 1000 words ≈ 6000 chars, so 4000 gives good coverage
                content_snippet = content_clean[:4000] if len(content_clean) > 4000 else content_clean
                
                context += f"\n\n---\nBlog Post: {title}\nExcerpt: {excerpt_clean}\nFull Content: {content_snippet}\n---\n"
                sources.append({
                    'title': title,
                    'link': link,
                    'excerpt': excerpt_clean[:200] if excerpt_clean else content_clean[:200],
                    'type': 'blog'
                })
        
        # Add static HTML pages to context
        if static_pages:
            for page in static_pages[:5]:  # Use top 5 most relevant pages
                title = page.get('title', '')
                content = page.get('content', '')
                link = page.get('link', '')
                
                # Content is already cleaned, just truncate
                content_snippet = content[:4000] if len(content) > 4000 else content
                
                # Extract a snippet for excerpt (first 200 chars of meaningful content)
                excerpt = content[:200] + '...' if len(content) > 200 else content
                
                context += f"\n\n---\nWebsite Page: {title}\nContent: {content_snippet}\n---\n"
                sources.append({
                    'title': title,
                    'link': link,
                    'excerpt': excerpt,
                    'type': 'website'
                })
        
        # If no content found, provide a helpful message
        if not context:
            return jsonify({
                'answer': f"I couldn't find specific information about '{query}' in our blog or website content. Please visit www.curam-ai.com.au or contact us for more information.",
                'sources': [],
                'query': query
            })
        
        # Step 3: Use Gemini to generate answer based on retrieved context
        try:
            model = genai.GenerativeModel('gemini-2.0-flash-exp')
            
            prompt = f"""You are a helpful assistant for Curam-Ai Protocol™, an AI document automation service for engineering firms.

The user asked: "{query}"

Below is relevant content from our WordPress blog (800+ articles) and our website pages. Use this content to provide a comprehensive, informative answer.

Content from Blog and Website:
{context}

Instructions:
1. Provide a direct, comprehensive answer to the user's question using the content above
2. If the question is "what is X", explain what X is clearly and thoroughly
3. Include key details, definitions, and important information from both blog posts and website pages
4. Synthesize information from multiple sources if relevant (combine blog and website content)
5. Reference specific source titles when citing information (mention if it's from a blog post or website page)
6. Be thorough - the user wants to understand the topic, not just get a brief mention
7. If the content discusses comparisons or costs, also explain what the thing itself is
8. Prioritize website pages for information about services, pricing, and processes
9. Use blog posts for detailed explanations, case studies, and technical deep dives

Answer the question comprehensively:"""
            
            response = model.generate_content(prompt)
            answer = response.text if response.text else "I couldn't generate an answer. Please visit www.curam-ai.com.au for more information."
            
            return jsonify({
                'answer': answer,
                'sources': sources,
                'query': query
            })
            
        except Exception as e:
            return jsonify({
                'answer': f"I encountered an error processing your question. Please visit www.curam-ai.com.au to search for information about '{query}'.",
                'sources': sources,
                'query': query,
                'error': str(e)
            }), 500
            
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500


def format_text_to_html(text):
    """
    Convert plain text to HTML with paragraph breaks and basic formatting.
    Handles double newlines as paragraph breaks, single newlines as line breaks.
    Also handles sentences that end with periods followed by newlines as paragraph breaks.
    """
    if not text:
        return ""
    
    import re
    
    # First, normalize whitespace - replace multiple spaces with single space
    text = re.sub(r' +', ' ', text.strip())
    
    # Split by double newlines (paragraphs)
    paragraphs = re.split(r'\n\s*\n', text)
    
    # If no double newlines, try to intelligently split into paragraphs
    # Look for sentence endings followed by capital letters (likely new paragraph)
    if len(paragraphs) == 1:
        # Pattern: sentence ending (. ! ?) followed by space and capital letter
        # This helps identify natural paragraph breaks
        parts = re.split(r'([.!?])\s+([A-Z][a-z])', text)
        
        if len(parts) > 3:  # If we found potential breaks
            # Reconstruct paragraphs intelligently
            paragraphs = []
            current_para = parts[0] if parts[0] else ""
            
            for i in range(1, len(parts), 3):
                if i + 1 < len(parts):
                    punctuation = parts[i] if i < len(parts) else ""
                    next_sentence = parts[i + 1] if i + 1 < len(parts) else ""
                    
                    # If current paragraph is substantial and next starts a new thought, break
                    if len(current_para.strip()) > 50 and next_sentence:
                        if current_para.strip():
                            paragraphs.append((current_para.strip() + punctuation).strip())
                        current_para = next_sentence
                    else:
                        current_para += punctuation + " " + next_sentence
                else:
                    current_para += parts[i] if i < len(parts) else ""
            
            if current_para.strip():
                paragraphs.append(current_para.strip())
        else:
            # Fallback: if text has single newlines, use those
            if '\n' in text:
                paragraphs = [p.strip() for p in text.split('\n') if p.strip()]
    
    html_parts = []
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        
        # Replace single newlines with <br> within paragraphs (but preserve intentional breaks)
        para = para.replace('\n', '<br>')
        
        # Basic markdown-style formatting
        # Bold: **text** or *text* (but not if it's part of a URL or email)
        para = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', para)
        # Only italicize single asterisks that aren't part of bold
        para = re.sub(r'(?<!\*)\*([^*]+?)\*(?!\*)', r'<em>\1</em>', para)
        
        # Escape any remaining HTML that shouldn't be there
        # (This is a simple escape - more complex sanitization happens in frontend)
        
        # Wrap in paragraph tag
        html_parts.append(f'<p>{para}</p>')
    
    return ''.join(html_parts) if html_parts else f'<p>{text}</p>'


@app.route('/api/contact-assistant', methods=['POST'])
def contact_assistant():
    """
    AI Contact Assistant: Helps users understand their needs and guides them through the contact process.
    """
    try:
        data = request.get_json()
        message = data.get('message', '').strip()
        conversation_history = data.get('history', [])  # Array of {role: 'user'|'assistant', content: '...'}
        
        if not message:
            return jsonify({'error': 'Message is required'}), 400
        
        if not api_key:
            return jsonify({'error': 'Gemini API key not configured'}), 500
        
        # Build conversation context
        system_prompt = """You are a helpful AI assistant for Curam-Ai Protocol™, an AI document automation service for engineering firms.

Your role is to:
1. Understand the user's needs and challenges
2. Ask clarifying questions to better understand their situation
3. Suggest relevant services (Phase 1 Feasibility Sprint, Phase 2 Roadmap, Phase 3 Compliance Shield, Phase 4 Implementation)
4. Provide helpful information about the protocol and pricing
5. Guide users toward the most appropriate next step

Key information about Curam-Ai Protocol™:
- Phase 1 (Feasibility Sprint): $1,500 - 48-hour proof of concept on their documents
- Phase 2 (The Roadmap): $7,500 - Detailed implementation plan
- Phase 3 (Compliance Shield): $8-12k - Production-ready automation
- Phase 4 (Implementation): $20-30k - Full deployment

Services:
- Finance/Admin: Invoice automation, data entry into Xero
- Engineering: Beam schedule digitization from drawings
- Drafting: Transmittal register automation

IMPORTANT: Format your responses using HTML tags for better readability:
- Use <p> tags for paragraphs
- Use <strong> or <b> for emphasis
- Use <ul> and <li> for lists
- Use <br> for line breaks when needed
- Keep HTML simple and safe (no scripts or complex tags)
- DO NOT wrap your response in markdown code blocks (no ```html or ```)
- Return the HTML directly, not wrapped in code fences

Keep responses concise (2-3 sentences per paragraph), friendly, and focused on understanding their needs. Ask one clarifying question at a time when needed."""
        
        # Build conversation for Gemini
        conversation = [{"role": "user", "parts": [system_prompt]}]
        
        # Add conversation history (limit to last 10 exchanges to avoid token limits)
        recent_history = conversation_history[-10:] if len(conversation_history) > 10 else conversation_history
        for item in recent_history:
            role = "user" if item.get('role') == 'user' else "model"
            conversation.append({"role": role, "parts": [item.get('content', '')]})
        
        # Add current message
        conversation.append({"role": "user", "parts": [message]})
        
        try:
            model = genai.GenerativeModel('gemini-2.0-flash-exp')
            
            # Generate response
            response = model.generate_content(conversation)
            assistant_message = response.text if response.text else "I'm here to help! Could you tell me more about what you're looking for?"
            
            # Remove markdown code blocks if present (```html ... ``` or ``` ... ```)
            import re
            if assistant_message:
                # Remove markdown code blocks
                assistant_message = re.sub(r'```html\s*\n?(.*?)\n?```', r'\1', assistant_message, flags=re.DOTALL)
                assistant_message = re.sub(r'```\s*\n?(.*?)\n?```', r'\1', assistant_message, flags=re.DOTALL)
                # Remove any remaining backticks
                assistant_message = assistant_message.strip().strip('`')
                # Clean up any extra whitespace
                assistant_message = re.sub(r'\n\s*\n\s*\n+', '\n\n', assistant_message)
            
            # Always format the response to ensure proper HTML structure
            if assistant_message:
                # Check if response already contains proper HTML paragraph tags
                has_proper_paragraphs = '<p>' in assistant_message and '</p>' in assistant_message
                
                if not has_proper_paragraphs:
                    # Convert plain text to HTML with paragraph breaks
                    # This handles cases where LLM returns plain text or partial HTML
                    assistant_message = format_text_to_html(assistant_message)
                else:
                    # LLM returned HTML with paragraphs, but clean it up
                    import re
                    # Remove extra whitespace between tags
                    assistant_message = re.sub(r'>\s+<', '><', assistant_message)
                    # Normalize whitespace in content
                    assistant_message = re.sub(r'\s+', ' ', assistant_message)
                    # Clean up any unclosed tags or malformed HTML
                    if assistant_message.count('<p>') != assistant_message.count('</p>'):
                        # If paragraphs aren't balanced, extract text and reformat
                        text_only = re.sub(r'<[^>]+>', ' ', assistant_message)
                        assistant_message = format_text_to_html(text_only)
            
            # Try to extract suggested service/interest from the conversation
            suggested_interest = None
            message_lower = message.lower()
            if any(word in message_lower for word in ['phase 1', 'feasibility', 'proof of concept', 'poc', 'test']):
                suggested_interest = 'phase-1'
            elif any(word in message_lower for word in ['phase 2', 'roadmap', 'plan', 'strategy']):
                suggested_interest = 'phase-2'
            elif any(word in message_lower for word in ['phase 3', 'compliance', 'production', 'shield']):
                suggested_interest = 'phase-3'
            elif any(word in message_lower for word in ['phase 4', 'implementation', 'deploy', 'rollout']):
                suggested_interest = 'phase-4'
            elif any(word in message_lower for word in ['roi', 'calculator', 'return on investment', 'cost']):
                suggested_interest = 'roi'
            
            return jsonify({
                'message': assistant_message,
                'suggested_interest': suggested_interest
            })
            
        except Exception as e:
            app.logger.error(f"Gemini generation failed for contact assistant: {e}")
            return jsonify({
                'message': "I'm here to help! Could you tell me more about your document automation needs?",
                'error': str(e)
            }), 500
            
    except Exception as e:
        app.logger.error(f"Contact assistant failed: {e}")
        return jsonify({'error': f'An unexpected error occurred: {str(e)}'}), 500


@app.route('/api/check-message-relevance', methods=['POST'])
def check_message_relevance():
    """
    NLP-based check to determine if a contact form message is related to Curam-Ai services.
    Uses the same Gemini model as the contact assistant.
    """
    try:
        data = request.get_json()
        message = data.get('message', '').strip()
        
        if not message:
            return jsonify({'error': 'Message is required'}), 400
        
        if not api_key:
            # Fallback to keyword matching if API key not available
            return jsonify({
                'is_relevant': True,  # Default to relevant if we can't check
                'confidence': 0.5,
                'reason': 'AI service unavailable, defaulting to allow submission'
            })
        
        # System prompt for relevance checking
        relevance_prompt = """You are analyzing a contact form message to determine if it's related to Curam-Ai Protocol™ services.

Curam-Ai Protocol™ provides:
- Document automation and extraction (invoices, CAD schedules, drawings)
- AI implementation for engineering firms
- Workflow automation for structural engineering
- The Protocol: 4-phase framework (Feasibility Sprint, Roadmap, Compliance Shield, Implementation)
- ROI calculations and efficiency improvements
- ISO-27001 compliance and security
- Data entry automation, PDF processing, OCR

Analyze the message and respond with ONLY a JSON object in this exact format:
{
    "is_relevant": true or false,
    "confidence": 0.0 to 1.0,
    "reason": "brief explanation"
}

Consider relevant if the message mentions:
- Document processing, automation, extraction
- AI, machine learning, or technology implementation
- Engineering, structural engineering, or professional services
- Workflow efficiency, time savings, productivity
- Invoices, schedules, drawings, PDFs
- The Protocol, phases, feasibility, compliance
- General inquiries about services, pricing, or next steps

Consider NOT relevant if the message is clearly about:
- Completely unrelated services (e.g., selling products, unrelated consulting)
- Spam or promotional content
- Personal matters unrelated to business services
- Topics completely outside document automation/AI

Message to analyze:
"""
        
        try:
            model = genai.GenerativeModel('gemini-2.0-flash-exp')
            
            # Generate relevance analysis
            full_prompt = relevance_prompt + message
            response = model.generate_content(full_prompt)
            response_text = response.text if response.text else ""
            
            # Try to parse JSON from response
            import re
            json_match = re.search(r'\{[^}]+\}', response_text, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
                return jsonify({
                    'is_relevant': result.get('is_relevant', True),
                    'confidence': result.get('confidence', 0.5),
                    'reason': result.get('reason', 'Analyzed by AI')
                })
            else:
                # Fallback: check if response indicates relevance
                response_lower = response_text.lower()
                is_relevant = not any(word in response_lower for word in ['not relevant', 'unrelated', 'not related', 'cannot help'])
                return jsonify({
                    'is_relevant': is_relevant,
                    'confidence': 0.6,
                    'reason': 'AI analysis completed'
                })
            
        except Exception as e:
            app.logger.error(f"Gemini relevance check failed: {e}")
            # Fallback to allowing submission
            return jsonify({
                'is_relevant': True,
                'confidence': 0.5,
                'reason': 'AI check unavailable, defaulting to allow'
            })
            
    except Exception as e:
        app.logger.error(f"Message relevance check failed: {e}")
        return jsonify({
            'is_relevant': True,
            'confidence': 0.5,
            'reason': 'Error in analysis, defaulting to allow'
        }), 500


@app.route('/api/contact', methods=['POST'])
def contact_form():
    """
    Handle contact form submissions and send emails using MailChannel API.
    """
    try:
        data = request.get_json()
        name = data.get('name', '').strip()
        email = data.get('email', '').strip()
        company = data.get('company', '').strip()
        interest = data.get('interest', '').strip()
        message = data.get('message', '').strip()
        
        # Validation
        if not name or not email or not message:
            return jsonify({'error': 'Name, email, and message are required'}), 400
        
        # Get MailChannel API key
        mailchannels_api_key = os.environ.get('MAILCHANNELS_API_KEY')
        if not mailchannels_api_key:
            app.logger.error("MAILCHANNELS_API_KEY not configured - email sending disabled")
            return jsonify({
                'error': 'Email service is currently unavailable. Please try again later.',
                'details': 'MAILCHANNELS_API_KEY environment variable is missing'
            }), 503
        
        # Get recipient email (admin/contact email)
        to_email = os.environ.get('CONTACT_EMAIL', 'contact@curam-ai.com.au')
        from_email = os.environ.get('FROM_EMAIL', 'noreply@curam-ai.com.au')
        
        # Interest labels
        interest_labels = {
            'phase-1': 'Phase 1 - Feasibility Sprint ($1,500)',
            'phase-2': 'Phase 2 - The Roadmap ($7,500)',
            'phase-3': 'Phase 3 - Compliance Shield ($8-12k)',
            'phase-4': 'Phase 4 - Implementation ($20-30k)',
            'roi': 'ROI Calculator',
            'general': 'General Inquiry'
        }
        interest_display = interest_labels.get(interest, interest or 'Not specified')
        
        # Build email content for admin
        email_subject = f"New Contact Form Submission from {name}"
        
        # Prepare message with HTML line breaks (escape newlines for HTML)
        message_html = message.replace(chr(10), '<br>') if message else ''
        company_html = f'<div class="field"><div class="label">Company:</div><div class="value">{company}</div></div>' if company else ''
        
        email_html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }}
                h1 {{ color: #0a1628; border-bottom: 2px solid #D4AF37; padding-bottom: 10px; }}
                .field {{ margin: 15px 0; }}
                .label {{ font-weight: bold; color: #0a1628; }}
                .value {{ margin-top: 5px; padding: 10px; background: #F8F9FA; border-radius: 4px; }}
                .message-box {{ background: #F8F9FA; padding: 15px; border-left: 3px solid #D4AF37; border-radius: 4px; }}
            </style>
        </head>
        <body>
            <h1>New Contact Form Submission</h1>
            
            <div class="field">
                <div class="label">Name:</div>
                <div class="value">{name}</div>
            </div>
            
            <div class="field">
                <div class="label">Email:</div>
                <div class="value"><a href="mailto:{email}">{email}</a></div>
            </div>
            
            {company_html}
            
            <div class="field">
                <div class="label">Interest:</div>
                <div class="value">{interest_display}</div>
            </div>
            
            <div class="field">
                <div class="label">Message:</div>
                <div class="message-box">{message_html}</div>
            </div>
        </body>
        </html>
        """
        
        # Prepare email text content
        newline = '\n'
        company_line = f'Company: {company}{newline}' if company else ''
        email_text = f"""New Contact Form Submission

Name: {name}
Email: {email}
{company_line}Interest: {interest_display}

Message:
{message}
"""
        
        # Build confirmation email for user
        confirmation_html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }}
                h1 {{ color: #0a1628; border-bottom: 2px solid #D4AF37; padding-bottom: 10px; }}
                .message {{ margin: 20px 0; padding: 15px; background: #F8F9FA; border-radius: 4px; }}
            </style>
        </head>
        <body>
            <h1>Thank You for Contacting Curam-Ai</h1>
            <p>Hi {name},</p>
            <p>We've received your message and will get back to you within 24 hours.</p>
            <div class="message">
                <strong>Your Message:</strong><br>
                {message_html}
            </div>
            <p>Best regards,<br>Curam-Ai Protocol™ Team</p>
        </body>
        </html>
        """
        
        confirmation_text = f"""Thank You for Contacting Curam-Ai

Hi {name},

We've received your message and will get back to you within 24 hours.

Your Message:
{message}

Best regards,
Curam-Ai Protocol™ Team
"""
        
        mailchannels_url = 'https://api.mailchannels.net/tx/v1/send'
        
        # MailChannel API headers - API key is optional if domain lockdown is configured
        headers = {
            'Content-Type': 'application/json'
        }
        if mailchannels_api_key:
            headers['X-Api-Key'] = mailchannels_api_key
        
        # Send email to admin
        admin_email_data = {
            "personalizations": [
                {
                    "to": [{"email": to_email}]
                }
            ],
            "from": {
                "email": from_email,
                "name": "Curam-Ai Protocol™ Contact Form"
            },
            "reply_to": {
                "email": email,
                "name": name
            },
            "subject": email_subject,
            "content": [
                {
                    "type": "text/plain",
                    "value": email_text
                },
                {
                    "type": "text/html",
                    "value": email_html
                }
            ]
        }
        
        # Send confirmation email to user
        user_email_data = {
            "personalizations": [
                {
                    "to": [{"email": email, "name": name}]
                }
            ],
            "from": {
                "email": from_email,
                "name": "Curam-Ai Protocol™"
            },
            "subject": "Thank You for Contacting Curam-Ai",
            "content": [
                {
                    "type": "text/plain",
                    "value": confirmation_text
                },
                {
                    "type": "text/html",
                    "value": confirmation_html
                }
            ]
        }
        
        try:
            # Send admin notification
            admin_response = requests.post(mailchannels_url, json=admin_email_data, headers=headers, timeout=10)
            if admin_response.status_code != 202:
                app.logger.error(f"Mailchannels API error (admin email): {admin_response.status_code} - {admin_response.text}")
            
            # Send user confirmation
            user_response = requests.post(mailchannels_url, json=user_email_data, headers=headers, timeout=10)
            if user_response.status_code != 202:
                app.logger.error(f"Mailchannels API error (user confirmation): {user_response.status_code} - {user_response.text}")
            
            if admin_response.status_code == 202:
                app.logger.info(f"Contact form email sent successfully from {email}")
                
                # SMS functionality removed
                
                return jsonify({
                    'success': True,
                    'message': 'Thank you for your message! We will get back to you soon.'
                })
            else:
                app.logger.error(f"Failed to send contact form email: {admin_response.text}")
                return jsonify({
                    'error': 'Failed to send email. Please try again later.',
                    'details': admin_response.text if admin_response.text else 'Unknown error'
                }), 500
                
        except requests.RequestException as e:
            app.logger.error(f"Error sending contact form email via Mailchannels: {e}")
            return jsonify({
                'error': 'Failed to send email. Please try again later.'
            }), 500
        
    except Exception as e:
        app.logger.error(f"Contact form submission failed: {e}")
        import traceback
        app.logger.error(traceback.format_exc())
        return jsonify({'error': f'An unexpected error occurred: {str(e)}'}), 500


@app.route('/api/email-chat-log', methods=['POST'])
def email_chat_log():
    """
    Email the chat log from the AI Contact Assistant conversation.
    """
    try:
        data = request.get_json()
        email = data.get('email', '').strip()
        conversation_history = data.get('history', [])
        user_name = data.get('name', '')
        company = data.get('company', '')
        
        if not email:
            return jsonify({'error': 'Email address is required'}), 400
        
        if not conversation_history:
            return jsonify({'error': 'No conversation history to email'}), 400
        
        # Generate email content
        email_subject = f"Curam-Ai Contact Assistant Conversation - {user_name or 'Inquiry'}"
        
        # Build HTML email content
        email_html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }}
                h1 {{ color: #0B1221; border-bottom: 2px solid #D4AF37; padding-bottom: 10px; }}
                .message {{ margin: 15px 0; padding: 12px; border-radius: 6px; }}
                .user-message {{ background: #0B1221; color: white; text-align: right; }}
                .assistant-message {{ background: #F8F9FA; border-left: 3px solid #D4AF37; }}
                .meta {{ color: #666; font-size: 0.9em; margin-top: 20px; padding-top: 20px; border-top: 1px solid #E5E7EB; }}
            </style>
        </head>
        <body>
            <h1>Your Curam-Ai Contact Assistant Conversation</h1>
            <p>Thank you for using our AI Contact Assistant. Here's a transcript of our conversation:</p>
        """
        
        if user_name or company:
            email_html += f"<p><strong>Name:</strong> {user_name or 'Not provided'}<br>"
            email_html += f"<strong>Company:</strong> {company or 'Not provided'}</p>"
        
        email_html += "<div style='margin: 20px 0;'>"
        
        for msg in conversation_history:
            role = msg.get('role', '')
            content = msg.get('content', '')
            if role == 'user':
                email_html += f'<div class="message user-message"><strong>You:</strong> {content}</div>'
            elif role == 'assistant':
                email_html += f'<div class="message assistant-message"><strong>AI Assistant:</strong> {content}</div>'
        
        email_html += """
            </div>
            <div class="meta">
                <p><strong>Next Steps:</strong></p>
                <ul>
                    <li>Fill out our contact form to continue the conversation</li>
                    <li>Book a diagnostic call to discuss your specific needs</li>
                    <li>Try our ROI Calculator to see potential savings</li>
                </ul>
                <p>Visit us at <a href="https://protocol.curam-ai.com.au">protocol.curam-ai.com.au</a></p>
                <p>Best regards,<br>Curam-Ai Protocol™ Team</p>
            </div>
        </body>
        </html>
        """
        
        # Plain text version
        email_text = f"""Your Curam-Ai Contact Assistant Conversation\n\n"""
        if user_name or company:
            email_text += f"Name: {user_name or 'Not provided'}\n"
            email_text += f"Company: {company or 'Not provided'}\n\n"
        email_text += "Conversation:\n\n"
        for msg in conversation_history:
            role = msg.get('role', '')
            content = msg.get('content', '')
            if role == 'user':
                email_text += f"You: {content}\n\n"
            elif role == 'assistant':
                email_text += f"AI Assistant: {content}\n\n"
        email_text += "\nNext Steps:\n"
        email_text += "- Fill out our contact form to continue the conversation\n"
        email_text += "- Book a diagnostic call to discuss your specific needs\n"
        email_text += "- Try our ROI Calculator to see potential savings\n\n"
        email_text += "Visit us at https://protocol.curam-ai.com.au\n\n"
        email_text += "Best regards,\nCuram-Ai Protocol™ Team"
        
        # Send email using Mailchannels API
        mailchannels_api_key = os.environ.get('MAILCHANNELS_API_KEY')
        if not mailchannels_api_key:
            app.logger.error("MAILCHANNELS_API_KEY not configured - email sending disabled")
            # Log available env vars for debugging (without exposing sensitive data)
            env_vars = [k for k in os.environ.keys() if 'MAIL' in k.upper() or 'EMAIL' in k.upper()]
            app.logger.info(f"Available email-related env vars: {env_vars}")
            return jsonify({
                'error': 'Email service is currently unavailable. Please fill out the contact form below or try again later.',
                'details': 'MAILCHANNELS_API_KEY environment variable is missing'
            }), 503
        
        # Get from email address (default to noreply, but can be configured)
        from_email = os.environ.get('FROM_EMAIL', 'noreply@curam-ai.com.au')
        
        # Mailchannels API endpoint
        mailchannels_url = 'https://api.mailchannels.net/tx/v1/send'
        
        # Prepare email data for Mailchannels
        email_data = {
            "personalizations": [
                {
                    "to": [{"email": email}]
                }
            ],
            "from": {
                "email": from_email,
                "name": "Curam-Ai Protocol™"
            },
            "subject": email_subject,
            "content": [
                {
                    "type": "text/plain",
                    "value": email_text
                },
                {
                    "type": "text/html",
                    "value": email_html
                }
            ]
        }
        
        # Set headers - MailChannel API key is optional if domain lockdown is configured
        headers = {
            'Content-Type': 'application/json'
        }
        if mailchannels_api_key:
            headers['X-Api-Key'] = mailchannels_api_key
        
        try:
            # Send email via Mailchannels API
            response = requests.post(mailchannels_url, json=email_data, headers=headers, timeout=10)
            
            if response.status_code == 202:
                app.logger.info(f"Chat log email sent successfully to {email}")
                return jsonify({
                    'success': True,
                    'message': 'Chat log email sent successfully'
                })
            else:
                app.logger.error(f"Mailchannels API error: {response.status_code} - {response.text}")
                return jsonify({
                    'error': f'Failed to send email. Please try again later.',
                    'details': response.text if response.text else 'Unknown error'
                }), 500
                
        except requests.RequestException as e:
            app.logger.error(f"Error sending email via Mailchannels: {e}")
            return jsonify({
                'error': 'Failed to send email. Please try again later.'
            }), 500
        
    except Exception as e:
        app.logger.error(f"Email chat log failed: {e}")
        return jsonify({'error': f'An unexpected error occurred: {str(e)}'}), 500


@app.route('/how-it-works')
@app.route('/how-it-works.html')
def how_it_works():
    try:
        return send_file('how-it-works.html')
    except:
        return "How it works page not found.", 404

@app.route('/curam-ai-protocol.html')
def curam_ai_protocol():
    try:
        return send_file('curam-ai-protocol.html')
    except:
        return "Protocol page not found.", 404

@app.route('/tier2-report.html')
def tier2_report():
    """Serve the Tier 2 report HTML file"""
    try:
        # Serve the actual Tier 2 report file (tier2-report.html contains the report)
        # The Curam-Ai-Redacted file appears to be homepage content, so use tier2-report.html
        html_file = 'tier2-report.html'
        
        if not os.path.exists(html_file):
            return f"Tier 2 report not found. Looking for: {html_file}", 404
        
        # Use absolute path to ensure we get the right file
        file_path = os.path.abspath(html_file)
        return send_file(file_path, mimetype='text/html')
    except Exception as e:
        return f"Error serving report: {str(e)}", 500

@app.route('/tier-one-feasibility-report')
@app.route('/tier-one-feasibility-report.html')
def tier_one_feasibility_report():
    """Serve the Tier One Feasibility Report HTML file"""
    try:
        return send_file('tier-one-feasibility-report.html')
    except:
        return "Tier One Feasibility Report not found.", 404

@app.route('/phase-1-feasibility')
@app.route('/phase-1-feasibility.html')
def phase_1_feasibility():
    """Serve the Phase 1 Feasibility page"""
    try:
        return send_file('phase-1-feasibility.html')
    except:
        return "Phase 1 Feasibility page not found.", 404

@app.route('/phase-2-roadmap')
@app.route('/phase-2-roadmap.html')
def phase_2_roadmap():
    """Serve the Phase 2 Roadmap page"""
    try:
        return send_file('phase-2-roadmap.html')
    except:
        return "Phase 2 Roadmap page not found.", 404

@app.route('/phase-3-compliance')
@app.route('/phase-3-compliance.html')
def phase_3_compliance():
    """Serve the Phase 3 Compliance Shield page"""
    try:
        return send_file('phase-3-compliance.html')
    except:
        return "Phase 3 Compliance Shield page not found.", 404

@app.route('/feasibility-sprint-report')
@app.route('/feasibility-sprint-report.html')
@app.route('/gate2-sample-report')
@app.route('/gate2-sample-report.html')
def feasibility_sprint_report():
    """Serve the Phase 1 Feasibility Sprint report slideshow page"""
    try:
        return send_file('feasibility-sprint-report.html')
    except:
        return "Feasibility Sprint report page not found.", 404

@app.route('/risk-audit-report')
@app.route('/risk-audit-report.html')
def risk_audit_report():
    """Serve the Risk Audit Report page"""
    try:
        return send_file('risk-audit-report.html')
    except:
        return "Risk Audit Report page not found.", 404

# Phase 2 Report Routes
@app.route('/phase-2-exec-summary')
@app.route('/phase-2-exec-summary.html')
def phase_2_exec_summary():
    """Serve the Phase 2 Executive Summary report"""
    try:
        return send_file('phase-2-exec-summary.html')
    except:
        return "Phase 2 Executive Summary not found.", 404

@app.route('/phase-2-discovery-baseline-report')
@app.route('/phase-2-discovery-baseline-report.html')
def phase_2_discovery_baseline():
    """Serve the Phase 2 Discovery Baseline report"""
    try:
        return send_file('phase-2-discovery-baseline-report.html')
    except:
        return "Phase 2 Discovery Baseline report not found.", 404

@app.route('/phase-2-metric-agreement')
@app.route('/phase-2-metric-agreement.html')
def phase_2_metric_agreement():
    """Serve the Phase 2 Metric Agreement report"""
    try:
        return send_file('phase-2-metric-agreement.html')
    except:
        return "Phase 2 Metric Agreement not found.", 404

@app.route('/phase-2-reports')
@app.route('/phase-2-reports.html')
def phase_2_reports():
    """Serve the Phase 2 reports index page"""
    try:
        return send_file('phase-2-reports.html')
    except:
        return "Phase 2 reports page not found.", 404

# Root route - serve the marketing homepage
@app.route('/')
def root():
    try:
        return send_file('homepage.html')
    except Exception as e:
        # Fallback message if homepage doesn't exist
        return f"Homepage not found. Error: {str(e)}", 404

# Demo HTML page with iframe (serves demo.html)
@app.route('/demo.html')
def demo_html():
    """Serve demo.html page with iframe to automater"""
    return send_file('demo.html')

# Automater route (document extraction tool) - moved from root
@app.route('/automater', methods=['GET', 'POST'])
@app.route('/demo', methods=['GET', 'POST'])
@app.route('/extract', methods=['GET', 'POST'])
def automater():
    # Call the original index function logic
    return index_automater()

# Original index function (document extraction) - renamed
def index_automater():
    department = request.form.get('department') or request.args.get('department')
    results = []
    error_message = None
    last_model_used = None
    model_attempts = []
    model_actions = []
    detected_schedule_type = None
    selected_samples = []

    # Default to DEFAULT_DEPARTMENT if still not set
    if not department:
        department = DEFAULT_DEPARTMENT

    # Load results from session on GET requests (only if department matches)
    if request.method == 'GET':
        saved = session.get('last_results')
        if saved:
            saved_department = saved.get('department')
            # Only load from session if department matches (respect user's selection)
            if saved_department == department:
                session_results = saved.get('rows', [])
                if session_results:
                    results = session_results
                    # Get schedule type for engineering
                    if saved_department == "engineering":
                        detected_schedule_type = saved.get('schedule_type')
                    model_actions.append(f"Loaded {len(results)} row(s) from previous session")

    if request.method == 'POST':
        # Log the department received
        model_actions.append(f"POST request received. Department from form: '{department}'")
        
        finance_defaults = []
        finance_uploaded_paths = []
        transmittal_defaults = []

        # For engineering (radio buttons), get single value; for others handle custom logic
        if department == 'engineering':
            sample_value = request.form.get('samples')
            selected_samples = [sample_value] if sample_value else []
            model_actions.append(f"Engineering mode: sample_value from form = '{sample_value}'")
        elif department == 'finance':
            finance_defaults = request.form.getlist('finance_defaults')
            selected_samples = finance_defaults.copy()
            model_actions.append(f"Finance mode: auto-selecting {len(finance_defaults)} sample invoice(s)")
        elif department == 'transmittal':
            transmittal_defaults = request.form.getlist('transmittal_defaults')
            selected_samples = transmittal_defaults.copy()
            model_actions.append(f"Transmittal mode: auto-selecting {len(transmittal_defaults)} sample drawing(s)")
        else:
            selected_samples = request.form.getlist('samples')
            model_actions.append(f"Non-engineering mode: selected_samples from form = {selected_samples}")
        allowed_folder = DEPARTMENT_SAMPLES.get(department, {}).get("folder", "")
        
        # Handle finance uploads
        if department == 'finance':
            uploaded_files = request.files.getlist('finance_uploads')
            if uploaded_files:
                model_actions.append(f"Finance mode: {len(uploaded_files)} uploaded file(s) received")
            for file_storage in uploaded_files:
                if not file_storage or not file_storage.filename:
                    continue
                filename = secure_filename(file_storage.filename)
                if not filename.lower().endswith('.pdf'):
                    error_message = "Only PDF files can be uploaded for Finance."
                    model_actions.append(f"✗ ERROR: {filename} rejected (not a PDF)")
                    break
                unique_name = f"{int(time.time() * 1000)}_{filename}"
                file_path = os.path.join(FINANCE_UPLOAD_DIR, unique_name)
                file_storage.save(file_path)
                finance_uploaded_paths.append(file_path)
                model_actions.append(f"✓ Uploaded invoice saved: {file_path}")
            selected_samples.extend(finance_uploaded_paths)

        # Filter samples to only those matching the current department (skip for auto-select departments)
        if department in ('finance', 'transmittal'):
            samples = [sample for sample in selected_samples if sample]
        else:
            samples = [
                sample for sample in selected_samples
                if sample and SAMPLE_TO_DEPT.get(sample) == department
            ]
        # Log what was selected for debugging
        if selected_samples:
            model_actions.append(f"Selected samples: {selected_samples}")
            for sample in selected_samples:
                if sample:
                    dept_match = SAMPLE_TO_DEPT.get(sample, "NOT FOUND")
                    model_actions.append(f"  - {sample}: mapped to department '{dept_match}'")
            model_actions.append(f"Filtered to department '{department}': {samples}")
        else:
            model_actions.append("No samples selected in form")

        # Check if there's anything to process
        if not samples:
            if selected_samples:
                error_message = f"No samples matched department '{department}'. Selected: {selected_samples}"
                model_actions.append(f"✗ ERROR: {error_message}")
            else:
                error_message = "Please select at least one sample file."
                model_actions.append(f"✗ ERROR: {error_message}")

        if not error_message:
            if samples:
                model_actions.append(f"Processing {len(samples)} sample file(s)")
                for sample_path in samples:
                    if not os.path.exists(sample_path):
                        error_msg = f"File not found: {sample_path}"
                        model_actions.append(f"✗ {error_msg}")
                        if not error_message:
                            error_message = error_msg
                        continue
                
                    filename = os.path.basename(sample_path)
                    model_actions.append(f"Processing file: {filename} (path: {sample_path})")
                    model_actions.append(f"Extracting text from {filename}")
                    text = extract_text(sample_path)
                    if text.startswith("Error:"):
                        model_actions.append(f"✗ Text extraction failed for {filename}: {text}")
                        if not error_message:
                            error_message = f"Text extraction failed for {filename}"
                        continue
                    else:
                        model_actions.append(f"✓ Text extracted successfully ({len(text)} characters)")
                    
                    model_actions.append(f"Analyzing {filename} with AI models")
                    entries, api_error, model_used, attempt_log, file_action_log, schedule_type = analyze_gemini(text, department)
                    if file_action_log:
                        model_actions.extend(file_action_log)
                    if model_used:
                        last_model_used = model_used
                        model_actions.append(f"✓ Successfully processed {filename} with {model_used}")
                    if attempt_log:
                        model_attempts.extend(attempt_log)
                    if api_error:
                        model_actions.append(f"✗ Failed to process {filename}: {api_error}")
                        if not error_message:
                            error_message = api_error
                    if entries:
                        if department == "transmittal":
                            # Transmittal returns a single object with multiple arrays
                            if isinstance(entries, list) and len(entries) > 0 and isinstance(entries[0], dict):
                                transmittal_data = entries[0]
                                # Add filename to DrawingRegister (handle both dict and list)
                                if 'DrawingRegister' in transmittal_data:
                                    dr = transmittal_data['DrawingRegister']
                                    if isinstance(dr, dict):
                                        dr['Filename'] = filename
                                    elif isinstance(dr, list) and len(dr) > 0:
                                        for item in dr:
                                            if isinstance(item, dict):
                                                item['Filename'] = filename
                                # Add SourceDocument to all sub-arrays
                                for key in ['Standards', 'Materials', 'Connections', 'Assumptions', 'VOSFlags', 'CrossReferences']:
                                    if key in transmittal_data and isinstance(transmittal_data[key], list):
                                        for item in transmittal_data[key]:
                                            if isinstance(item, dict):
                                                item['SourceDocument'] = filename
                                results.append(transmittal_data)
                                model_actions.append(f"✓ Extracted structured data from {filename}")
                            else:
                                # Fallback to old format
                                for entry in entries if isinstance(entries, list) else [entries]:
                                    entry['Filename'] = filename
                                    results.append(entry)
                                model_actions.append(f"✓ Extracted {len(entries)} row(s) from {filename}")
                        else:
                            model_actions.append(f"✓ Extracted {len(entries)} row(s) from {filename}")
                            for entry in entries:
                                entry['Filename'] = filename
                                if department == "finance":
                                    cost_value = entry.get('Cost')
                                    gst_value = entry.get('GST')
                                    final_value = entry.get('FinalAmount') or entry.get('Total')
                                    if final_value and not entry.get('FinalAmount'):
                                        entry['FinalAmount'] = final_value
                                    entry['CostFormatted'] = format_currency(cost_value) if cost_value not in ("", None, "N/A") else (cost_value or "N/A")
                                    entry['GST'] = gst_value if gst_value not in ("", None) else "N/A"
                                    entry['GSTFormatted'] = format_currency(gst_value) if gst_value not in ("", None, "N/A") else "N/A"
                                    entry['FinalAmountFormatted'] = format_currency(final_value) if final_value not in ("", None, "N/A") else (final_value or "N/A")
                                else:
                                    entry['TotalFormatted'] = format_currency(entry.get('Total', ''))
                                results.append(entry)
                            # Store schedule type for engineering documents (use first detected type)
                            if department == "engineering" and schedule_type and not detected_schedule_type:
                                detected_schedule_type = schedule_type
                    else:
                        model_actions.append(f"⚠ No data extracted from {filename}")

        # Aggregate transmittal data into structured categories
        transmittal_aggregated = None
        if department == "transmittal" and results:
            transmittal_aggregated = {
                "DrawingRegister": [],
                "Standards": [],
                "Materials": [],
                "Connections": [],
                "Assumptions": [],
                "VOSFlags": [],
                "CrossReferences": []
            }
            for result in results:
                if isinstance(result, dict):
                    # Extract drawing register - handle both dict and list
                    if 'DrawingRegister' in result:
                        dr = result['DrawingRegister']
                        if isinstance(dr, dict):
                            transmittal_aggregated["DrawingRegister"].append(dr)
                        elif isinstance(dr, list):
                            transmittal_aggregated["DrawingRegister"].extend(dr)
                    # Aggregate arrays
                    for key in ['Standards', 'Materials', 'Connections', 'Assumptions', 'VOSFlags', 'CrossReferences']:
                        if key in result and isinstance(result[key], list):
                            transmittal_aggregated[key].extend(result[key])

        if results:
            session_data = {"department": department, "rows": results}
            if department == "engineering" and 'detected_schedule_type' in locals():
                session_data["schedule_type"] = detected_schedule_type
            if transmittal_aggregated:
                session_data["transmittal_aggregated"] = transmittal_aggregated
            session['last_results'] = session_data
        else:
            session.pop('last_results', None)

    # Get schedule type from session or detected value
    schedule_type = None
    if department == "engineering":
        saved = session.get('last_results', {})
        schedule_type = saved.get('schedule_type')
        if not schedule_type and 'detected_schedule_type' in locals() and detected_schedule_type:
            schedule_type = detected_schedule_type
    
    # Get aggregated transmittal data
    transmittal_data = None
    if department == "transmittal":
        saved = session.get('last_results', {})
        transmittal_data = saved.get('transmittal_aggregated')
        if not transmittal_data and 'transmittal_aggregated' in locals():
            transmittal_data = transmittal_aggregated
        # If still no transmittal_data, try to aggregate from results
        if not transmittal_data and results:
            transmittal_data = {
                "DrawingRegister": [],
                "Standards": [],
                "Materials": [],
                "Connections": [],
                "Assumptions": [],
                "VOSFlags": [],
                "CrossReferences": []
            }
            for result in results:
                if isinstance(result, dict):
                    # Extract drawing register - handle both dict and list
                    if 'DrawingRegister' in result:
                        dr = result['DrawingRegister']
                        if isinstance(dr, dict):
                            transmittal_data["DrawingRegister"].append(dr)
                        elif isinstance(dr, list):
                            transmittal_data["DrawingRegister"].extend(dr)
                    # Aggregate arrays
                    for key in ['Standards', 'Materials', 'Connections', 'Assumptions', 'VOSFlags', 'CrossReferences']:
                        if key in result and isinstance(result[key], list):
                            transmittal_data[key].extend(result[key])
        # Ensure all keys are lists, not None
        if transmittal_data and isinstance(transmittal_data, dict):
            for key in ['DrawingRegister', 'Standards', 'Materials', 'Connections', 'Assumptions', 'VOSFlags', 'CrossReferences']:
                if key not in transmittal_data or transmittal_data[key] is None:
                    transmittal_data[key] = []
    
    return render_template_string(
        HTML_TEMPLATE,
        results=results if results else [],
        department=department,
        selected_samples=selected_samples,
        sample_files=DEPARTMENT_SAMPLES,
        error=error_message,
        routine_descriptions=ROUTINE_DESCRIPTIONS,
        routine_summary=ROUTINE_SUMMARY.get(department, []),
        model_in_use=last_model_used,
        model_attempts=model_attempts,
        model_actions=model_actions,
        schedule_type=schedule_type,
        transmittal_data=transmittal_data
    )

@app.route('/export_csv')
def export_csv():
    """Export results as CSV"""
    saved = session.get('last_results')
    if not saved or not saved.get('rows'):
        return "No data to export", 404

    department = saved.get('department', DEFAULT_DEPARTMENT)
    df = pd.DataFrame(saved['rows'])

    if department == 'finance':
        df_export = df.copy()
        for currency_col in ['Cost', 'GST', 'FinalAmount']:
            if currency_col in df_export.columns:
                df_export[currency_col] = df_export[currency_col].apply(
                    lambda x: format_currency(x) if x and x not in ("N/A", "") else "N/A"
                )
            else:
                df_export[currency_col] = "N/A"
        columns = ['Filename', 'Vendor', 'Date', 'InvoiceNum', 'Cost', 'GST', 'FinalAmount', 'Summary']
        df_export = df_export[[col for col in columns if col in df_export.columns]]
        df_export.columns = ['Filename', 'Vendor', 'Date', 'Invoice #', 'Cost', 'GST', 'Final Amount', 'Summary']
    elif department == 'transmittal':
        df_export = df.copy()
        columns = ['Filename', 'DwgNo', 'Rev', 'Title', 'Scale']
        df_export = df_export[[col for col in columns if col in df_export.columns]]
    elif department == 'engineering':
        df_export = df.copy()
        schedule_type = saved.get('schedule_type')
        if schedule_type == 'column':
            columns = ['Filename', 'Mark', 'SectionType', 'Size', 'Length', 'Grade', 'BasePlate', 'CapPlate', 'Finish', 'Comments']
        else:
            columns = ['Filename', 'Mark', 'Size', 'Qty', 'Length', 'Grade', 'PaintSystem', 'Comments']
        df_export = df_export[[col for col in columns if col in df_export.columns]]
    else:
        df_export = df.copy()
        columns = ['Filename', 'Mark', 'Size', 'Qty', 'Length', 'Grade', 'PaintSystem', 'Comments']
        df_export = df_export[[col for col in columns if col in df_export.columns]]

    output = io.StringIO()
    df_export.to_csv(output, index=False)
    csv_string = output.getvalue()

    response = Response(
        csv_string,
        mimetype='text/csv',
        headers={'Content-Disposition': 'attachment; filename=takeoff_results.csv'}
    )
    return response

@app.route('/export_transmittal_csv')
def export_transmittal_csv():
    """Export a specific transmittal category as CSV"""
    saved = session.get('last_results')
    if not saved:
        return "No data to export", 404
    
    category = request.args.get('category')
    if not category:
        return "Category parameter required", 400
    
    transmittal_data = saved.get('transmittal_aggregated')
    if not transmittal_data or not isinstance(transmittal_data, dict):
        return "No transmittal data available", 404
    
    # Map category names to data keys
    category_map = {
        'DrawingRegister': 'DrawingRegister',
        'Standards': 'Standards',
        'Materials': 'Materials',
        'Connections': 'Connections',
        'Assumptions': 'Assumptions',
        'VOSFlags': 'VOSFlags',
        'CrossReferences': 'CrossReferences'
    }
    
    data_key = category_map.get(category)
    if not data_key or data_key not in transmittal_data:
        return f"Category '{category}' not found", 404
    
    category_data = transmittal_data[data_key]
    if not category_data or len(category_data) == 0:
        return f"No data available for category '{category}'", 404
    
    # Convert to DataFrame
    # Handle DrawingRegister which might be a list of dicts or a single dict
    if data_key == 'DrawingRegister':
        if isinstance(category_data, list):
            df = pd.DataFrame(category_data)
        elif isinstance(category_data, dict):
            df = pd.DataFrame([category_data])
        else:
            return "Invalid data format for DrawingRegister", 500
    else:
        df = pd.DataFrame(category_data)
    
    # Generate filename based on category
    filename_map = {
        'DrawingRegister': 'drawing_register',
        'Standards': 'standards_compliance',
        'Materials': 'material_specifications',
        'Connections': 'connection_details',
        'Assumptions': 'design_assumptions',
        'VOSFlags': 'vos_flags',
        'CrossReferences': 'cross_references'
    }
    
    filename = filename_map.get(category, category.lower())
    
    output = io.StringIO()
    df.to_csv(output, index=False)
    csv_string = output.getvalue()
    
    response = Response(
        csv_string,
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename={filename}.csv'}
    )
    return response


@app.route('/sample')
def view_sample():
    requested = request.args.get('path')
    if not requested or requested not in ALLOWED_SAMPLE_PATHS:
        abort(404)

    if not os.path.isfile(requested):
        abort(404)

    return send_file(requested)

# ROI calculator HTML page with iframe (serves roi.html)
@app.route('/roi.html')
def roi_html():
    """Serve roi.html page with iframe to ROI calculator"""
    return send_file('roi.html')

# ROI calculator redirect route (for /roi without .html)
@app.route('/roi')
def roi_redirect():
    """Redirect /roi to /roi.html"""
    return redirect('/roi.html', code=301)

# Blog HTML page with iframe (serves blog.html)
@app.route('/blog.html')
def blog_html():
    """Serve blog.html page with iframe to curam-ai.com.au"""
    return send_file('blog.html')

# Blog redirect route (for /blog without .html)
@app.route('/blog')
def blog_redirect():
    """Redirect /blog to /blog.html"""
    return redirect('/blog.html', code=301)

@app.route('/sitemap.html')
def sitemap_html():
    """Serve sitemap.html page"""
    try:
        return send_file('sitemap.html')
    except:
        return "Sitemap not found.", 404

@app.route('/sitemap.xml')
def sitemap_xml():
    """Serve sitemap.xml for search engines"""
    try:
        return send_file('sitemap.xml', mimetype='application/xml')
    except:
        return "Sitemap XML not found.", 404

# Import ROI calculator routes BEFORE running the app
try:
    from roi_calculator_flask import roi_app as roi_calculator_app
    # Mount ROI calculator at /roi-calculator (with trailing slash support)
    app.register_blueprint(roi_calculator_app, url_prefix='/roi-calculator')
    print("✓ ROI Calculator blueprint registered successfully at /roi-calculator")
except ImportError as e:
    print(f"✗ Warning: Could not import ROI calculator: {e}")
    import traceback
    traceback.print_exc()
except Exception as e:
    print(f"✗ Error registering ROI calculator: {e}")
    import traceback
    traceback.print_exc()

if __name__ == '__main__':
    # This allows local testing
    app.run(debug=True, port=5000)