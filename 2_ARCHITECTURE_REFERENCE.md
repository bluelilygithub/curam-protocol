# Curam-Ai Protocol: Architecture Reference

**Purpose:** Technical deep dive for developers starting a new similar project  
**Audience:** Python developers, AI engineers  
**Prerequisites:** Flask, Python 3.11+, basic Gemini API knowledge

---

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    USER INTERFACE LAYER                      │
├─────────────────────────────────────────────────────────────┤
│  Marketing Website  │  ROI Calculator  │  Document Automater │
│  (Static HTML)      │  (Flask Blueprint) │  (Flask Routes)   │
└──────────┬──────────┴──────────┬────────┴────────┬──────────┘
           │                      │                  │
           v                      v                  v
┌─────────────────────────────────────────────────────────────┐
│                   APPLICATION LAYER (Flask)                  │
├─────────────────────────────────────────────────────────────┤
│  routes/            │  services/         │  models/          │
│  - static_pages.py  │  - gemini_service  │  - department_    │
│  - (future: api,    │  - pdf_service     │    config         │
│    automater)       │  - rag_service     │                   │
│                     │  - validation      │                   │
└──────────┬──────────┴──────────┬─────────┴────────┬──────────┘
           │                      │                   │
           v                      v                   v
┌─────────────────────────────────────────────────────────────┐
│                     DATA & AI LAYER                          │
├─────────────────────────────────────────────────────────────┤
│  Gemini API        │  PDF Processing   │  Database          │
│  - Text extraction │  - pdfplumber     │  - SQLite          │
│  - AI generation   │  - PyMuPDF        │  - Session store   │
│  - RAG search      │                   │  - Results cache   │
└─────────────────────────────────────────────────────────────┘
```

---

## File Structure (Post-Refactoring)

```
curam-protocol/
├── main.py                         # 1003 lines (down from 6000!)
│   ├── Flask app initialization
│   ├── Blueprint registration
│   ├── Automater routes (4 routes - to be extracted)
│   ├── API routes (3 routes - to be extracted)
│   └── Export routes (2 routes - to be extracted)
│
├── config.py                       # 90 lines
│   ├── Config (base)
│   ├── DevelopmentConfig
│   ├── ProductionConfig
│   └── TestingConfig
│
├── database.py                     # Database init & queries
│   ├── init_db() - Create tables
│   ├── get_samples_for_template()
│   └── add_sample()
│
├── requirements.txt                # 20+ dependencies
├── Procfile                        # Railway: "web: gunicorn main:app"
├── runtime.txt                     # Python 3.11
│
├── routes/                         # Flask blueprints
│   ├── __init__.py
│   └── static_pages.py            # 565 lines, 50+ routes
│       ├── Homepage, About, Services
│       ├── Industry pages (4)
│       ├── Phase pages (4)
│       ├── Report pages (10+)
│       └── Asset routes
│
├── services/                       # Business logic
│   ├── gemini_service.py          # 400+ lines
│   │   ├── extract_with_gemini()
│   │   ├── Model fallback logic
│   │   ├── Prompt truncation
│   │   └── JSON parsing
│   │
│   ├── pdf_service.py             # 150+ lines
│   │   ├── extract_text_from_pdf()
│   │   └── Fallback to PyMuPDF
│   │
│   ├── rag_service.py             # 200+ lines
│   │   ├── search_blog_content()
│   │   ├── WordPress API integration
│   │   └── Static HTML search
│   │
│   └── validation_service.py      # 100+ lines
│       ├── validate_roi_inputs()
│       └── Input sanitization
│
├── models/                         # Data models & configs
│   └── department_config.py       # 170 lines
│       ├── DEPARTMENT_SAMPLES
│       ├── FINANCE_FIELDS
│       ├── ENGINEERING_BEAM_FIELDS
│       ├── ENGINEERING_COLUMN_FIELDS
│       └── TRANSMITTAL_FIELDS
│
├── utils/                          # Utility functions
│   ├── formatting.py              # 220 lines
│   │   ├── format_currency()
│   │   ├── format_text_to_html()
│   │   └── clean_text()
│   │
│   └── prompts.py                 # 180 lines
│       ├── build_finance_prompt()
│       ├── build_engineering_prompt()
│       └── build_transmittal_prompt()
│
├── templates/                      # Jinja2 templates
│   ├── roi_step1_select.html
│   ├── roi_step2_input.html
│   ├── roi_step3_results.html
│   ├── roi_results_improved.html
│   └── roi_report_pdf.html
│
├── assets/                         # Static assets
│   ├── css/styles.css             # Navy/Gold theme
│   ├── js/
│   │   ├── main.js
│   │   ├── navbar-loader.js
│   │   ├── hero_rotation.js
│   │   └── scripts.js
│   ├── images/
│   ├── videos/
│   ├── includes/navbar.html
│   └── samples/
│
├── invoices/                       # Finance samples (6 PDFs)
├── drawings/                       # Engineering samples (14 PDFs)
│
└── [40+ .md documentation files]
```

---

## Core Components Deep Dive

### 1. main.py (Flask App Entry Point)

**Current State:** 1003 lines (reduced from 6000!)

**Responsibilities:**
```python
from flask import Flask
from routes.static_pages import static_pages_bp
from roi_calculator_flask import roi_app

app = Flask(__name__)
app.config.from_object(get_config())

# Register blueprints
app.register_blueprint(static_pages_bp)
app.register_blueprint(roi_app, url_prefix='/roi-calculator')

# Remaining routes (to be extracted in Phase 4.2):
# - /automater (4 routes)
# - /api/* (3 routes)
# - /export-csv, /export-pdf (2 routes)

if __name__ == '__main__':
    app.run(debug=True, port=5000)
```

**Target State (Phase 4.2):** ~400 lines (initialization only)

---

### 2. services/gemini_service.py (AI Extraction Core)

**Key Functions:**

#### extract_with_gemini(text, department, model_name)
```python
def extract_with_gemini(text, department, model_name='gemini-2.0-flash-exp'):
    """
    Extract structured data using Gemini AI with fallback
    
    Args:
        text: PDF text content
        department: 'finance', 'engineering', 'transmittal'
        model_name: Gemini model to use
    
    Returns:
        List[Dict]: Extracted records
    
    Raises:
        ResourceExhausted: Quota exceeded → try fallback
        DeadlineExceeded: Timeout → retry with shorter prompt
        NotFound: Model unavailable → try fallback
    """
    
    # Build department-specific prompt
    prompt = build_prompt(text, department)
    
    # Truncate if too long (engineering/transmittal only)
    if len(prompt) > 6000 and department != 'finance':
        prompt = truncate_prompt(prompt, 6000)
    
    try:
        model = genai.GenerativeModel(model_name)
        response = model.generate_content(prompt, request_options={'timeout': 30})
        
        # Parse JSON response
        data = parse_gemini_response(response.text)
        return data
    
    except google.api_core.exceptions.DeadlineExceeded:
        # Retry with much shorter prompt
        prompt = truncate_prompt(prompt, 3200)
        model = genai.GenerativeModel(model_name)
        response = model.generate_content(prompt)
        return parse_gemini_response(response.text)
```

#### Model Fallback Hierarchy
```python
MODEL_HIERARCHY = [
    'gemini-2.0-flash-exp',      # Fastest, latest
    'gemini-1.5-flash-latest',   # Stable
    'gemini-1.5-flash',          # Fallback
    'gemini-1.5-pro-latest'      # Slowest but most capable
]

def extract_with_fallback(text, department):
    for model in MODEL_HIERARCHY:
        try:
            return extract_with_gemini(text, department, model)
        except (ResourceExhausted, NotFound):
            logging.warning(f"{model} failed, trying next")
            continue
    raise Exception("All models exhausted")
```

#### JSON Response Parsing
```python
def parse_gemini_response(response_text):
    """
    Handle various JSON response formats from Gemini
    
    Handles:
    - Clean JSON: [{"field": "value"}]
    - Markdown wrapped: ```json\n[...]\n```
    - Object response: {"results": [...]}
    - Single object: {"field": "value"} → wrap in array
    """
    
    text = response_text.strip()
    
    # Remove markdown fences
    text = re.sub(r'^```json\s*', '', text)
    text = re.sub(r'^```\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    
    try:
        data = json.loads(text)
        
        if isinstance(data, list):
            return data
        elif isinstance(data, dict):
            # Look for results/data key
            if 'results' in data:
                return data['results']
            elif 'data' in data:
                return data['data']
            else:
                return [data]  # Wrap single object
        else:
            return []
    
    except json.JSONDecodeError:
        # Try regex extraction
        match = re.search(r'\[.*\]', text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except:
                pass
        return []
```

---

### 3. utils/prompts.py (Prompt Engineering)

**Finance Prompt Template:**
```python
def build_finance_prompt(text):
    return f"""
Extract comprehensive invoice data from this document as JSON.

## DOCUMENT TYPE DETECTION

Identify the document type:

**INVOICE/COMMERCIAL INVOICE:**
- Contains: Invoice number, vendor, amounts, line items
- Purpose: Payment request, customs clearance
- Extract: Full details including line items

**RECEIPT:**
- Contains: Transaction completed, payment method
- Purpose: Proof of payment
- Extract: Summary level (line items optional if < 5 items)

**TAX INVOICE (Australian):**
- Contains: ABN, GST breakdown
- Purpose: Tax compliance
- Extract: ABN mandatory, GST details critical

**PRO FORMA INVOICE:**
- Flag as: "Pro Forma - Not for payment"
- Extract same fields but note status

## CORE FIELDS - ALWAYS EXTRACT

**Header Information (Required):**
- "Vendor": Vendor/supplier name (clean, no extra text)
- "InvoiceNum": Invoice number/reference (or "N/A" if receipt)
- "Date": Invoice date (YYYY-MM-DD format)
- "Currency": Document currency (default AUD if Australian, or extract from doc)

**Financial Totals (Required):**
- "Cost": Subtotal (before tax, numeric, no currency symbols)
- "GST": Tax/GST amount (numeric, use "N/A" if exempt/international)
- "FinalAmount": Total amount payable (numeric)

**Financial Validation:**
- Verify: Subtotal + Tax = Total (within $0.01 tolerance)
- If Australian vendor: Check for ABN and GST
- If international: Currency must be specified

## LINE ITEMS EXTRACTION

Extract line items when:
- Invoice has itemized table/list
- More than 2 distinct products/services
- Quantities and unit prices are listed

Skip line items when:
- Simple receipt (< 5 items)
- Only summary available

**Line Item Format:**
Each object should contain:
- "ItemNumber": Line number (auto-number if missing: "001", "002")
- "Description": Product/service description
- "Quantity": Quantity ordered
- "UnitPrice": Price per unit
- "LineTotal": Line total amount

## AUSTRALIAN TAX COMPLIANCE

For Australian vendors (Pty Ltd, ABN present):
- **ABN**: Extract 11-digit ABN number
- **GST Registration**: Check if GST registered
- **GST Amount**: Must be 10% of subtotal (validate)

If ABN missing but vendor is Australian: Flag as warning

## OUTPUT FORMAT

Return ONLY valid JSON array. No markdown, no explanation, no preamble.

Format:
[
  {{
    "Vendor": "ABC Corp Pty Ltd",
    "InvoiceNum": "INV-12345",
    "Date": "2025-01-15",
    "Currency": "AUD",
    "Cost": 1000.00,
    "GST": 100.00,
    "FinalAmount": 1100.00,
    "Summary": "Office supplies and equipment",
    "ABN": "12345678901",
    "LineItems": [
      {{
        "ItemNumber": "001",
        "Description": "Office desk",
        "Quantity": 2,
        "UnitPrice": 500.00,
        "LineTotal": 1000.00
      }}
    ]
  }}
]

TEXT: {text}
"""
```

**Engineering Prompt Template:**
```python
def build_engineering_prompt(text):
    return f"""
Extract structural schedule data from this drawing as JSON array.

## DOCUMENT TYPE IDENTIFICATION

**BEAM SCHEDULE:**
- Horizontal structural members
- Section types: UB, UC, PFC, RHS, CHS, angles
- Grid references typically: A-B/1-2, B-C/2-3

**COLUMN SCHEDULE:**
- Vertical structural members
- Section types: UC, CHS, RHS, SHS
- Level references: Level 1, Ground, Basement

## BEAM SCHEDULE FIELDS

Extract these fields for each beam:
- "Mark": Beam identifier (e.g., "B1", "B2.1", "B-01")
- "Size": Section size (e.g., "310UC158", "200×90x6RHS", "460UB74.6")
- "Material": Steel grade (e.g., "300PLUS", "350", "Grade 450", "AS/NZS 3679.1-300")
- "Grid": Location reference (e.g., "A-B/1-2", "Between Grid A & B")
- "Qty": Quantity or length (e.g., "1", "2.5m", "3 EA")

## COLUMN SCHEDULE FIELDS

Extract these fields for each column:
- "Mark": Column identifier (e.g., "C3", "C-01")
- "Size": Section size
- "Material": Steel grade
- "Level": Floor level (e.g., "Level 1", "Ground to Level 2")
- "Height": Column height if specified

## SIZE NOTATION STANDARDS

**Universal Beams (UB):**
- Format: 460UB74.6 = 460mm deep, 74.6 kg/m

**Universal Columns (UC):**
- Format: 310UC158 = 310mm deep, 158 kg/m

**Rectangular Hollow Sections (RHS):**
- Format: 200×90x6RHS = 200mm×90mm, 6mm wall thickness

**Circular Hollow Sections (CHS):**
- Format: 168.3x6.4CHS = 168.3mm diameter, 6.4mm wall

## OUTPUT FORMAT

Return ONLY valid JSON array of objects.

Example for beams:
[
  {{
    "Mark": "B1",
    "Size": "310UC158",
    "Material": "300PLUS",
    "Grid": "A-B/1-2",
    "Qty": "1"
  }},
  {{
    "Mark": "B2",
    "Size": "460UB74.6",
    "Material": "300PLUS",
    "Grid": "B-C/1-2",
    "Qty": "2"
  }}
]

TEXT: {text}
"""
```

---

### 4. models/department_config.py (Document Schemas)

**Department Samples Configuration:**
```python
DEPARTMENT_SAMPLES = {
    "finance": {
        "label": "Sample invoices",
        "description": "Finance department samples",
        "folder": "invoices",
        "samples": [
            {"path": "invoices/Bne.pdf", "label": "Bne.pdf"},
            {"path": "invoices/CloudRender.pdf", "label": "CloudRender.pdf"},
            # ... 6 total samples
        ]
    },
    "engineering": {
        "label": "Structural drawings",
        "description": "Engineering department samples",
        "folder": "drawings",
        "samples": [
            {"path": "drawings/schedule_cad.pdf", "label": "beam_schedule_CLEAN_cad.pdf"},
            {"path": "drawings/schedule_revit.pdf", "label": "column_schedule_CLEAN_revit.pdf"},
            # ... 4 total samples
        ]
    },
    "transmittal": {
        "label": "Drawing register samples",
        "description": "Structural drafter transmittal samples",
        "folder": "drawings",
        "samples": [
            {"path": "drawings/s001_general_notes.pdf", "label": "S-001 General Notes"},
            # ... 10 total samples
        ]
    }
}
```

**Field Schemas:**
```python
FINANCE_FIELDS = [
    "Vendor", "InvoiceNum", "Date", "Currency",
    "Cost", "GST", "FinalAmount", "Summary"
]

ENGINEERING_BEAM_FIELDS = [
    "Mark", "Size", "Material", "Grid", "Qty"
]

ENGINEERING_COLUMN_FIELDS = [
    "Mark", "Size", "Material", "Level", "Height"
]

TRANSMITTAL_FIELDS = [
    "DrawingNumber", "DrawingTitle", "Revision",
    "Scale", "Status", "Standards", "Materials",
    "Connections", "Assumptions", "VOSFlags", "CrossReferences"
]
```

---

### 5. ROI Calculator (roi_calculator_flask.py)

**Blueprint Structure:**
```python
from flask import Blueprint

roi_app = Blueprint('roi_calculator', __name__, template_folder='templates')

@roi_app.route('/', methods=['GET', 'POST'])
def roi_calculator():
    # Step 1: Industry selection
    # Step 2: Data entry
    # Step 3: Results
    pass

@roi_app.route('/results-improved', methods=['GET'])
def roi_results_improved():
    # New UX-improved results page
    pass

@roi_app.route('/pdf-improved', methods=['GET'])
def roi_pdf_improved():
    # PDF-optimized report
    pass
```

**Industry Configuration Example:**
```python
INDUSTRIES = {
    "Architecture & Building Services": {
        "default_hours_per_week": (60, 120),  # Range tuple
        "default_avg_rate": 175,
        "base_automation_potential": 0.42,
        "pain_points": [
            {
                "label": "Drawing register compilation",
                "score": 8,
                "multiplier": 1.25,
                "automation_note": "High automation potential - title blocks are structured"
            },
            {
                "label": "Specification document extraction",
                "score": 5,
                "multiplier": 1.00,
                "automation_note": "Moderate - depends on document formatting"
            },
            {
                "label": "Material takeoff from drawings",
                "score": 3,
                "multiplier": 0.90,
                "automation_note": "Lower automation - requires measurement, not just extraction"
            }
        ]
    },
    # ... 13 more industries
}
```

**Calculation Logic (Fixed in v2.0):**
```python
def calculate_roi(staff_count, hours_per_week, avg_rate, pain_point):
    # CRITICAL: hours_per_week is firm-wide, NOT per-staff
    # Don't multiply by staff_count again!
    
    weekly_waste = hours_per_week
    annual_burn = weekly_waste * avg_rate * 48  # 48 working weeks
    capacity_hours = weekly_waste * 48
    
    # Apply pain score multiplier
    pain_multipliers = {
        0: 0.85, 3: 0.90, 5: 1.00,
        6: 1.05, 7: 1.15, 8: 1.25, 10: 1.35
    }
    multiplier = pain_multipliers.get(pain_point, 1.00)
    
    # Calculate automation potential (cap at 70%)
    base_auto = industry_config['base_automation_potential']
    automation_potential = min(base_auto * multiplier, 0.70)
    
    # Tier 1: Direct cost savings
    tier_1_savings = annual_burn * automation_potential
    tier_1_hours = capacity_hours * automation_potential
    
    # Tier 2: Revenue opportunity (60% conversion assumption)
    tier_2_revenue = tier_1_hours * avg_rate * 0.60
    
    return {
        'annual_burn': annual_burn,
        'automation_potential': automation_potential,
        'tier_1_savings': tier_1_savings,
        'tier_1_hours': tier_1_hours,
        'tier_2_revenue': tier_2_revenue,
        'total_roi': tier_1_savings + tier_2_revenue,
        'pain_multiplier': multiplier
    }
```

---

## Key Design Patterns

### 1. Blueprint Pattern (Routes Organization)
```python
# routes/static_pages.py
from flask import Blueprint

static_pages_bp = Blueprint('static_pages', __name__)

@static_pages_bp.route('/')
def root():
    return send_file('homepage.html')

# main.py
from routes.static_pages import static_pages_bp
app.register_blueprint(static_pages_bp)
```

**Benefits:**
- Separates marketing routes from app logic
- Easy to find and update routes
- Can be tested independently

### 2. Service Layer Pattern
```python
# services/gemini_service.py
def extract_with_gemini(text, department, model_name):
    # Business logic here
    pass

# main.py
from services.gemini_service import extract_with_gemini

@app.route('/automater', methods=['POST'])
def automater():
    text = extract_text_from_pdf(file_path)
    data = extract_with_gemini(text, department)
    return render_template('results.html', data=data)
```

**Benefits:**
- Business logic separate from routes
- Easy to unit test
- Reusable across routes

### 3. Configuration Class Pattern
```python
# config.py
class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-key')
    DEBUG = False

class DevelopmentConfig(Config):
    DEBUG = True

class ProductionConfig(Config):
    DEBUG = False

def get_config(env='production'):
    configs = {
        'development': DevelopmentConfig,
        'production': ProductionConfig
    }
    return configs.get(env, ProductionConfig)

# main.py
app.config.from_object(get_config(os.environ.get('FLASK_ENV', 'production')))
```

### 4. Model Fallback Pattern (AI Resilience)
```python
MODELS = ['primary-model', 'fallback-1', 'fallback-2']

for model in MODELS:
    try:
        return ai_function(model)
    except (QuotaError, NotFoundError):
        if model == MODELS[-1]:
            raise  # Last model, re-raise
        continue  # Try next model
```

### 5. Prompt Truncation Pattern (Timeout Prevention)
```python
MAX_LENGTH = 6000
RETRY_LENGTH = 3200

prompt = build_prompt(text)

if len(prompt) > MAX_LENGTH:
    prompt = truncate(prompt, MAX_LENGTH)

try:
    return ai_call(prompt)
except TimeoutError:
    # Retry with much shorter prompt
    prompt = truncate(prompt, RETRY_LENGTH)
    return ai_call(prompt)
```

---

## Technology Dependencies

```txt
# requirements.txt (key packages)
Flask==3.0.0
gunicorn==21.2.0
google-generativeai==0.3.2
pdfplumber==0.10.3
PyMuPDF==1.23.8
pandas==2.1.4
plotly==5.18.0
reportlab==4.0.7
requests==2.31.0
python-dotenv==1.0.0
Werkzeug==3.0.1
```

**Critical Versions:**
- Python 3.11+ (required for Railway)
- Flask 3.0+ (latest stable)
- google-generativeai 0.3+ (Gemini 2.0 support)

---

## Environment Variables

```bash
# Required
GEMINI_API_KEY=your-gemini-api-key-here
SECRET_KEY=your-flask-secret-key

# Optional
FLASK_ENV=production  # or 'development'
DEBUG=False
PORT=5000
DATABASE_URL=sqlite:///automater_samples.db  # or PostgreSQL URL
```

---

## Database Schema (SQLite)

```sql
CREATE TABLE department_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_label TEXT NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_department ON department_samples(department);
CREATE INDEX idx_active ON department_samples(is_active);
```

**Usage:**
```python
from database import get_samples_for_template

samples = get_samples_for_template('finance')
# Returns: [{"path": "invoices/Bne.pdf", "label": "Bne.pdf"}, ...]
```

---

## Copy-Paste Ready: New Project Template

```python
# new_project/main.py
from flask import Flask, request, session
import google.generativeai as genai
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY')

# Configure Gemini
genai.configure(api_key=os.environ['GEMINI_API_KEY'])

# Service layer
from services.ai_service import extract_data
from services.pdf_service import extract_text

@app.route('/extract', methods=['POST'])
def extract():
    file = request.files['document']
    text = extract_text(file)
    data = extract_data(text, document_type='invoice')
    return {'data': data}

if __name__ == '__main__':
    app.run(debug=True, port=5000)
```

```python
# services/ai_service.py
import google.generativeai as genai

MODELS = ['gemini-2.0-flash-exp', 'gemini-1.5-flash-latest']

def extract_data(text, document_type):
    prompt = build_prompt(text, document_type)
    
    for model_name in MODELS:
        try:
            model = genai.GenerativeModel(model_name)
            response = model.generate_content(prompt)
            return parse_json(response.text)
        except Exception as e:
            if model_name == MODELS[-1]:
                raise
            continue
```

---

**END OF ARCHITECTURE REFERENCE**

See next file: `3_DEPLOYMENT_REFERENCE.md` for deployment guide.
