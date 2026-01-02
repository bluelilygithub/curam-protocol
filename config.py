"""
Application configuration and constants
Extracted from main.py to improve maintainability
"""
import os

# --- FLASK CONFIGURATION ---
SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')

# --- UPLOAD DIRECTORIES ---
FINANCE_UPLOAD_DIR = os.path.join('uploads', 'finance')

# --- DEPARTMENT CONFIG ---
DEFAULT_DEPARTMENT = "finance"

DEPARTMENT_SAMPLES = {
    "finance": {
        "label": "Sample invoices",
        "description": "Finance department samples",
        "folder": "invoices",
        "samples": [
            {"path": "invoices/Bne.pdf", "label": "Bne.pdf"},
            {"path": "invoices/CloudRender.pdf", "label": "CloudRender.pdf"},
            {"path": "invoices/Tingalpa.pdf", "label": "Tingalpa.pdf"},
            {"path": "invoices/John Deere Construction & Forestry Commercial Invoice.pdf", "label": "John Deere Construction & Forestry Commercial Invoice.pdf"},
            {"path": "invoices/Lenovo Global Logistics Commercial Invoice.pdf", "label": "Lenovo Global Logistics Commercial Invoice.pdf"},
            {"path": "invoices/Shenzhen Fast-Circuit Co Commercial Invoice.pdf", "label": "Shenzhen Fast-Circuit Co Commercial Invoice.pdf"}
        ]
    },
    "engineering": {
        "label": "Structural drawings",
        "description": "Engineering department samples",
        "folder": "drawings",
        "samples": [
            {"path": "drawings/schedule_cad.pdf", "label": "beam_schedule_CLEAN_cad.pdf"},
            {"path": "drawings/schedule_revit.pdf", "label": "column_schedule_CLEAN_revit.pdf"},
            {"path": "drawings/beam_messy_scan.pdf", "label": "beam_schedule_MESSY_scan.pdf"},
            {"path": "drawings/column_complex_messy.pdf", "label": "column_schedule_MESSY_scan.pdf"}
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

# Build sample lookup maps
SAMPLE_TO_DEPT = {
    sample["path"]: dept_key
    for dept_key, group in DEPARTMENT_SAMPLES.items()
    for sample in group["samples"]
}

ALLOWED_SAMPLE_PATHS = {
    sample["path"]
    for group in DEPARTMENT_SAMPLES.values()
    for sample in group["samples"]
}

# --- ROUTINE DESCRIPTIONS (HTML content for UI) ---
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

# --- PROMPT LIMITS ---
ENGINEERING_PROMPT_LIMIT = 100000
ENGINEERING_PROMPT_LIMIT_SHORT = 3200
TRANSMITTAL_PROMPT_LIMIT = 3200

# --- DOCUMENT FIELD DEFINITIONS ---
FINANCE_FIELDS = ["Vendor", "Date", "InvoiceNum", "Cost", "GST", "FinalAmount", "Summary", "LineItems", "ShippingTerms", "HSCodes", "Currency", "ABN", "POReference", "PaymentTerms", "DueDate", "PortOfLoading", "PortOfDischarge", "VesselVoyage", "BillOfLading", "Flags"]
ENGINEERING_BEAM_FIELDS = ["Mark", "Size", "Qty", "Length", "Grade", "PaintSystem", "Comments"]
ENGINEERING_COLUMN_FIELDS = ["Mark", "SectionType", "Size", "Length", "Grade", "BasePlate", "CapPlate", "Finish", "Comments"]
TRANSMITTAL_FIELDS = ["DwgNo", "Rev", "Title", "Scale"]

DOC_FIELDS = {
    "finance": FINANCE_FIELDS,
    "engineering": ENGINEERING_BEAM_FIELDS,  # Default, will be overridden based on detected type
    "transmittal": TRANSMITTAL_FIELDS
}

ERROR_FIELD = {
    "finance": "Summary",
    "engineering": "Comments",
    "transmittal": "Title"
}
