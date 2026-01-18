"""
Application configuration and constants
Extracted from main.py to improve maintainability
"""
import os

# --- FLASK CONFIGURATION ---
SECRET_KEY = os.environ.get('SECRET_KEY')
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable is required. Set a strong random key in your environment.")

# --- UPLOAD DIRECTORIES ---
# Base upload directory - can be overridden with UPLOAD_BASE_DIR environment variable
# For Railway persistent storage, set UPLOAD_BASE_DIR to mounted volume path (e.g., /data/uploads)
UPLOAD_BASE_DIR = os.environ.get('UPLOAD_BASE_DIR', 'uploads')

FINANCE_UPLOAD_DIR = os.path.join(UPLOAD_BASE_DIR, 'finance')
PHASE1_TRIALS_UPLOAD_DIR = os.path.join(UPLOAD_BASE_DIR, 'phase1_trials')

# --- DEPARTMENT CONFIG ---
DEFAULT_DEPARTMENT = "finance"

DEPARTMENT_SAMPLES = {
    "finance": {
        "label": "Sample invoices",
        "description": "Accounting department samples - vendor invoices, expense receipts",
        "folder": "samples/finance",
        "samples": [
            {"path": "samples/finance/CloudRender.pdf", "label": "CloudRender.pdf"},
            {"path": "samples/finance/Tingalpa.pdf", "label": "Tingalpa.pdf"},
            {"path": "samples/finance/John Deere Construction & Forestry Commercial Invoice.pdf", "label": "John Deere Construction & Forestry Commercial Invoice.pdf"},
            {"path": "samples/finance/Lenovo Global Logistics Commercial Invoice.pdf", "label": "Lenovo Global Logistics Commercial Invoice.pdf"},
            {"path": "samples/finance/Shenzhen Fast-Circuit Co Commercial Invoice.pdf", "label": "Shenzhen Fast-Circuit Co Commercial Invoice.pdf"}
        ]
    },
    "financial_planning": {
        "label": "Financial planning samples",
        "description": "Client statements, compliance forms, portfolio documentation",
        "folder": "samples/financial_planning",
        "samples": [
            {"path": "samples/financial_planning/Portfolio_Investment_Strategy.pdf", "label": "Portfolio Investment Strategy", "preselected": True},
            {"path": "samples/financial_planning/ASIC_Compliance_Form.pdf", "label": "ASIC Compliance Form", "preselected": True},
            {"path": "samples/financial_planning/Client_Portfolio_Statement.pdf", "label": "Client Portfolio Statement", "preselected": True}
        ]
    },
    "insurance": {
        "label": "Insurance samples",
        "description": "Claims forms, policy documents, risk assessment paperwork",
        "folder": "samples/insurance",
        "samples": [
            {"path": "samples/insurance/Insurance_Policy_Document.pdf", "label": "Insurance Policy Document", "preselected": True},
            {"path": "samples/insurance/General_Insurance_Claim.pdf", "label": "General Insurance Claim", "preselected": True},
            {"path": "samples/insurance/Risk_Assessment_Report.pdf", "label": "Risk Assessment Report", "preselected": True}
        ]
    },
    "engineering": {
        "label": "Structural drawings",
        "description": "Engineering department samples",
        "folder": "samples/engineering",
        "samples": [
            {"path": "samples/engineering/schedule_cad.pdf", "label": "beam_schedule_CLEAN_cad.pdf"},
            {"path": "samples/engineering/schedule_revit.pdf", "label": "column_schedule_CLEAN_revit.pdf"},
            {"path": "samples/engineering/beam_messy_scan.pdf", "label": "beam_schedule_MESSY_scan.pdf"},
            {"path": "samples/engineering/column_complex_messy.pdf", "label": "column_schedule_MESSY_scan.pdf"}
        ]
    },
    "transmittal": {
        "label": "Drawing register samples",
        "description": "Structural drafter transmittal samples",
        "folder": "samples/transmittal",
        "samples": [
            {"path": "samples/transmittal/s100_foundation_plan.pdf", "label": "S-100 Foundation Plan"},
            {"path": "samples/transmittal/s101_ground_floor_plan.pdf", "label": "S-101 Ground Floor"},
            {"path": "samples/transmittal/s102_framing_plan.pdf", "label": "S-102 Framing Plan"},
            {"path": "samples/transmittal/s500_standard_details.pdf", "label": "S-500 Details"}
        ]
    },
    "logistics": {
        "label": "Logistics samples",
        "description": "Logistics/freight forwarding samples",
        "folder": "samples/logistics",
        "samples": [
            {"path": "samples/logistics/Carrier Master Bill Of Lading.pdf", "label": "Carrier Master Bill of Lading"},
            {"path": "samples/logistics/Maersk Line - Sea Waybill Bill Of Lading.pdf", "label": "Maersk Sea Waybill"},
            {"path": "samples/logistics/Scribbled House Bill of Lading.pdf", "label": "Scribbled House Bill of Lading"},
            {"path": "samples/logistics/Timber Tally Sheet.pdf", "label": "Timber Tally Sheet"}
        ]
    }
}

# NOTE: Sample lookup maps (SAMPLE_TO_DEPT, ALLOWED_SAMPLE_PATHS) have been removed.
# Use utils.sample_loader functions instead:
#   - get_allowed_sample_paths() - Get set of allowed sample paths
#   - build_sample_to_dept_mapping() - Build path -> department mapping
# These functions support both config.py and database sources.

# --- ROUTINE DESCRIPTIONS (HTML content for UI) ---
ROUTINE_DESCRIPTIONS = {
    "finance": [
        ("Accounting: \"The Invoice Gatekeeper\"",
         """<p><strong>What it does:</strong> It acts as an <strong>Intelligent Document Processing (IDP)</strong> engine, translating raw incoming PDF bills (from subcontractors, hardware stores, software subscriptions, etc.) into structured data. It ignores layout variations and reliably extracts the core financial fields required to push the bill into your accounting platform (Xero/MYOB).</p>
         <p><strong>The Current Grind:</strong> The workflow involves excessive manual repetition: an admin staff member opens an email, saves the PDF, manually types the Vendor name, Date, Total, and Invoice ID into the accounting platform, and cross-checks for errors.</p>
         <p><strong>Frequency:</strong> Daily volume for a 70-staff firm is typically <strong>70–100 documents</strong> every week (external vendor invoices alone). We will initially focus the pilot on vendor invoices.</p>
         <p><strong>The Saving (Vendor Invoices Only):</strong><br>Manual: 3 minutes per document × 70 docs = <strong>3.5 hours/week</strong>.<br>AI: Near-instant. Accuracy is the new focus.<br><strong>Value:</strong> This immediate saving frees the Office Manager to focus on strategic tasks like staff culture, cost centre analysis, and debt recovery rather than transactional data entry.</p>
         <hr style="margin: 20px 0;">
         <p><strong>Future Impact: Internal Documents (Phase 2 Upside)</strong><br>The greatest opportunity lies in extending this capability to <strong>internal documents</strong>. By proving the engine on external invoices, the firm gains a validated tool ready to automate staff timesheets, project expense receipts, and internal cost allocations. This dramatically expands efficiency and eliminates manual project coding errors.</p>"""),
    ],
    "financial_planning": [
        ("Financial Planning: \"The Compliance Accelerator\"",
         """<p><strong>What it does:</strong> It extracts structured data from client statements, compliance forms, and portfolio documentation—turning PDF-locked financial data into actionable records for your advice platform.</p>
         <p><strong>Document Types Supported:</strong></p>
         <ul style="margin: 10px 0 10px 20px;">
             <li><strong>Client Statements:</strong> Bank statements, superannuation statements, investment platform reports</li>
             <li><strong>Compliance Forms:</strong> Fact-find documents, risk profile questionnaires, authority to proceed forms</li>
             <li><strong>Portfolio Documentation:</strong> Asset summaries, performance reports, product disclosure statements</li>
         </ul>
         <p><strong>The Current Grind:</strong> Paraplanners manually open each client document, re-type holdings, balances, and beneficiary details into CRM or advice software—risking transcription errors on critical compliance data.</p>
         <p><strong>Frequency:</strong> Per client review. A 10-adviser practice may process <strong>50–100 client documents</strong> weekly during review cycles.</p>
         <p><strong>The Saving:</strong><br>Manual: 5–10 minutes per document.<br>AI: 30 seconds.<br><strong>Value:</strong> Eliminates data entry errors in compliance-critical SOA preparation.</p>
         <p><strong>The Demo:</strong> Run the three sample documents provided (Portfolio Investment Strategy, ASIC Compliance Form, Client Portfolio Statement). The AI extracts client names, account balances, asset allocations, AFSL details, and compliance data—handling scanned documents automatically.</p>"""),
    ],
    "insurance": [
        ("Insurance: \"The Claims Processor\"",
         """<p><strong>What it does:</strong> It extracts structured data from claims forms, policy documents, and risk assessment paperwork—converting complex insurance documents into clean, actionable data for claims management and underwriting systems.</p>
         <p><strong>Document Types Supported:</strong></p>
         <ul style="margin: 10px 0 10px 20px;">
             <li><strong>Claims Forms:</strong> Motor vehicle claims, property damage claims, liability claim notifications</li>
             <li><strong>Policy Documents:</strong> Certificates of insurance, policy schedules, endorsements</li>
             <li><strong>Risk Assessment Paperwork:</strong> Underwriting questionnaires, site inspection reports, loss history summaries</li>
         </ul>
         <p><strong>The Current Grind:</strong> Claims handlers and underwriters manually read each document, re-type policyholder details, coverage limits, incident descriptions, and assessment findings into claims management systems.</p>
         <p><strong>Frequency:</strong> Daily. A mid-size insurer or broker processes <strong>100–300 documents</strong> weekly across claims and underwriting.</p>
         <p><strong>The Saving:</strong><br>Manual: 6–12 minutes per document.<br>AI: 30–45 seconds.<br><strong>Value:</strong> Faster claims turnaround and reduced errors in coverage verification.</p>
         <p><strong>The Demo:</strong> Run the three sample documents provided (Insurance Policy Document, General Insurance Claim, Risk Assessment Report). The AI extracts policy numbers, coverage details, claim amounts, incident descriptions, and property information—handling scanned documents automatically.</p>"""),
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
    ],
    "logistics": [
        ("Freight Forwarder / Customs: \"The Compliance Validator\"",
         """<p><strong>What it does:</strong> Automatically extracts critical data from Bills of Lading, FTA lists, and shipping documents to validate compliance, cross-check container details, and prepare customs declarations.</p>
         <p><strong>The Current Grind:</strong> Freight coordinators manually open each shipping document, type shipper/consignee details, container numbers, vessel information, and weights into tracking systems. For FTA claims, they cross-reference HS codes across multiple documents.</p>
         <p><strong>Frequency:</strong> Daily. A mid-size forwarder processes <strong>200-400 shipping documents</strong> weekly (BOLs, packing lists, FTA declarations).</p>
         <p><strong>The Saving:</strong><br>Manual: 4-6 minutes per document.<br>AI: 20-30 seconds.<br><strong>Value:</strong> Eliminates container number/weight errors that cause customs holds.</p>
         <p><strong>The Demo:</strong> Upload the five logistics samples. The AI extracts shipper, consignee, container details, and cargo descriptions—handling handwritten annotations and varying layouts automatically.</p>""")
    ]
}

ROUTINE_SUMMARY = {
    "finance": [
        ("Grind", "Admin opens email, saves the PDF, opens Xero, manually types Vendor, Date, Total, and checks for typos."),
        ("Frequency", "Daily; more realistic volume of <strong>70 documents</strong> per week for a 70-person firm (Vendor Invoices only)."),
        ("Saving", "Manual: 3 min/document × 70 docs = <strong>3.5 hours/week</strong>. AI: Near-instant."),
        ("Value", "Immediate efficiency frees up Office Manager time for strategic tasks (culture, billing), enabling a capacity reallocation upside of up to <strong>$1.44 M</strong> annually (Tier 4).")
    ],
    "financial_planning": [
        ("Grind", "Paraplanner opens client PDF, re-types holdings, balances, and beneficiary details into CRM or advice software."),
        ("Frequency", "Per client review; <strong>50–100 documents</strong> weekly during review cycles for a 10-adviser practice."),
        ("Saving", "Manual: 5–10 min/document. AI: 30 seconds."),
        ("Value", "Eliminates data entry errors in compliance-critical SOA preparation. Faster client reviews.")
    ],
    "insurance": [
        ("Grind", "Claims handler reads each document, re-types policyholder details, coverage limits, and incident descriptions."),
        ("Frequency", "Daily; <strong>100–300 documents</strong> weekly across claims and underwriting."),
        ("Saving", "Manual: 6–12 min/document. AI: 30–45 seconds."),
        ("Value", "Faster claims turnaround and reduced errors in coverage verification.")
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
    ],
    "logistics": [
        ("Grind", "Freight coordinator opens BOL scans, manually types container numbers, weights, shipper/consignee details, cross-checks HS codes."),
        ("Frequency", "Daily; realistic volume of <strong>200-400 documents</strong> per week (BOLs, packing lists, FTA declarations)."),
        ("Saving", "Manual: 4-6 min/document × 200 docs = <strong>13-20 hours/week</strong>. AI: 20-30 seconds."),
        ("Value", "Eliminates errors that cause customs holds. Ensures FTA duty concessions aren't missed.")
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

# FIXED: Logistics now supports multiple document types
# These are the universal fields that work across FTA, BOL, Packing Lists
LOGISTICS_FIELDS = [
    "ShipmentRef", 
    "InvoiceNumber", 
    "ItemDescription", 
    "CountryOfOrigin", 
    "FTAAgreement", 
    "TariffCode", 
    "Notes",
    # BOL fields (when applicable)
    "BLNumber",
    "Shipper", 
    "Consignee", 
    "Vessel", 
    "ContainerNumber",
    "PortOfLoading",
    "PortOfDischarge"
]

FINANCIAL_PLANNING_FIELDS = [
    "ClientName", "DocumentType", "AccountNumber", "StatementDate", 
    "OpeningBalance", "ClosingBalance", "Holdings", "AssetClass",
    "FundName", "UnitsHeld", "UnitPrice", "MarketValue", 
    "BeneficiaryName", "TFN", "ABN", "RiskProfile", "Notes"
]

INSURANCE_FIELDS = [
    "PolicyNumber", "PolicyholderName", "InsuredParty", "PolicyType",
    "CoverageType", "EffectiveDate", "ExpiryDate", "PremiumAmount",
    "SumInsured", "ExcessAmount", "ClaimNumber", "IncidentDate",
    "IncidentDescription", "ClaimAmount", "RiskCategory", 
    "PropertyAddress", "VehicleDetails", "Notes"
]

DOC_FIELDS = {
    "finance": FINANCE_FIELDS,
    "engineering": ENGINEERING_BEAM_FIELDS,
    "transmittal": TRANSMITTAL_FIELDS,
    "logistics": LOGISTICS_FIELDS,
    "financial_planning": FINANCIAL_PLANNING_FIELDS,
    "insurance": INSURANCE_FIELDS
}

ERROR_FIELD = {
    "finance": "Summary",
    "engineering": "Comments",
    "transmittal": "Title",
    "logistics": "Notes",
    "financial_planning": "Notes",
    "insurance": "Notes"
}