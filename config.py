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
         """<p><strong>What it does:</strong> It acts as an <strong>Intelligent Document Processing (IDP)</strong> engine, translating raw incoming PDF bills into structured data ready for Xero/MYOB.</p>
         <p><strong>The Current Grind:</strong> Admin staff manually type Vendor, Date, and Totals into accounting platforms.</p>
         <p><strong>Saving:</strong> Manual: 3 min/doc vs AI: Near-instant.</p>"""),
    ],
    "engineering": [
        ("Structural Engineer: \"The Schedule Digitiser\"",
         """<p><strong>What it does:</strong> It converts "dead" data inside a PDF drawing into "live" data for Excel calculation or ordering.</p>
         <p><strong>The Current Grind:</strong> Engineers manually transcribe member details (e.g., "310UC158") one by one.</p>
         <p><strong>Saving:</strong> 45–60 minutes per major schedule reduced to 30 seconds.</p>""")
    ],
    "transmittal": [
        ("Structural Drafter: \"Automated Drawing Register\"",
         """<p><strong>Current Grind:</strong> Drafters spend hours recording drawing numbers, revisions, and scales into transmittal registers.</p>
         <p><strong>Outcome:</strong> Builds an accurate Document Register for client distribution or RFI tracking instantly.</p>""")
    ],
    "logistics": [
        ("Logistics Coordinator: \"The Customs Compliance Accelerator\"",
         """<p><strong>What it does:</strong> Extracts structured data from Bills of Lading, FTA certificates, and packing lists to normalize data for compliance systems.</p>
         <p><strong>The Current Grind:</strong> Coordinators manually type B/L numbers, cargo descriptions, and HS codes into TMS systems.</p>
         <p><strong>Saving:</strong> 4 minutes per document reduced to 20-30 seconds.</p>""")
    ]
}

ROUTINE_SUMMARY = {
    "finance": [
        ("Grind", "Admin manually types Vendor, Date, and Total from PDFs into Xero."),
        ("Saving", "Manual: 3 min/doc × 70 docs = 3.5 hours/week. AI: Near-instant.")
    ],
    "engineering": [
        ("Grind", "Engineers transcribe 50+ beam/column entries into Excel spreadsheets."),
        ("Saving", "Manual: 45–60 min per schedule. AI: 30 seconds.")
    ],
    "transmittal": [
        ("Grind", "Drafters copying Drawing No/Rev/Title/Scale by hand into registers."),
        ("Saving", "Manual: hours of typing. AI: builds the register instantly.")
    ],
    "logistics": [
        ("Grind", "Coordinators manually entering shipping details and HS codes into TMS."),
        ("Saving", "Manual: 4 min/doc × 100 docs = 6.5 hours/week. AI: 20-30 seconds.")
    ]
}

# --- PROMPT LIMITS ---
# Increased to 100,000 to prevent truncation of large technical documents
ENGINEERING_PROMPT_LIMIT = 100000
ENGINEERING_PROMPT_LIMIT_SHORT = 3200
TRANSMITTAL_PROMPT_LIMIT = 3200

# --- DOCUMENT FIELD DEFINITIONS ---
FINANCE_FIELDS = ["Vendor", "Date", "InvoiceNum", "Cost", "GST", "FinalAmount", "Summary", "LineItems", "ShippingTerms", "HSCodes", "Currency", "ABN", "POReference", "PaymentTerms", "DueDate", "PortOfLoading", "PortOfDischarge", "VesselVoyage", "BillOfLading", "Flags"]
ENGINEERING_BEAM_FIELDS = ["Mark", "Size", "Qty", "Length", "Grade", "PaintSystem", "Comments"]
ENGINEERING_COLUMN_FIELDS = ["Mark", "SectionType", "Size", "Length", "Grade", "BasePlate", "CapPlate", "Finish", "Comments"]
TRANSMITTAL_FIELDS = ["DwgNo", "Rev", "Title", "Scale"]
LOGISTICS_FIELDS = ["DocumentType", "DocumentNumber", "Shipper", "Consignee", "CargoDescription", "GrossWeight", "NetWeight", "Container", "Seal", "Origin", "Destination", "HSCode", "Vessel", "NotifyParty"]

DOC_FIELDS = {
    "finance": FINANCE_FIELDS,
    "engineering": ENGINEERING_BEAM_FIELDS,
    "transmittal": TRANSMITTAL_FIELDS,
    "logistics": LOGISTICS_FIELDS    
}

ERROR_FIELD = {
    "finance": "Summary",
    "engineering": "Comments",
    "transmittal": "Title",
    "logistics": "CargoDescription" 
}