# Curam-Ai Protocol: Technical Overview

**Last Updated:** January 2025  
**Status:** Production (Railway)  
**Tech Stack:** Python 3.11, Flask, PostgreSQL, Google Gemini 2.5 Flash

---

## What This System Does

Curam-Ai Protocol™ extracts structured data from unstructured PDF documents using Google Gemini AI. It serves three core workflows:

1. **Finance** - Vendor invoice extraction (95%+ accuracy)
2. **Engineering** - Structural beam/column schedule extraction (93% accuracy)
3. **Transmittal** - Drawing register extraction (95%+ accuracy)

---

## Core Architecture

### High-Level Flow

```
PDF Upload
    ↓
[1. Text Extraction] → pdfplumber/PyMuPDF (dual fallback)
    ↓
[2. Image Detection] → If scanned/poor quality → image preprocessing
    ↓
[3. AI Processing] → Gemini 2.5 Flash with 40K+ char prompts
    ↓
[4. JSON Parsing] → Extract structured data with aggressive cleaning
    ↓
[5. Validation] → Auto-correct OCR errors, flag issues
    ↓
[6. Output] → Display table + CSV export
```

### File Structure

```
main.py                          # Flask application (1,627 lines)
├── routes/
│   └── static_pages.py          # Marketing page routes
├── services/
│   ├── gemini_service.py        # AI extraction (152KB, 40K+ char prompts)
│   ├── pdf_service.py           # PDF text extraction
│   ├── validation_service.py    # Data validation & OCR correction
│   ├── rag_service.py           # Blog search functionality
│   └── image_preprocessing.py   # Image enhancement
├── utils/
│   ├── encoding_fix.py          # UTF-8 sanitization
│   └── formatting.py            # Output formatting
├── models/
│   └── department_config.py     # Document schemas
└── templates/                   # Jinja2 HTML templates
```

---

## PDF Extraction Pipeline

### Dual Extraction Strategy

**Priority:**
1. **pdfplumber** (better for tables, preserves structure)
2. **PyMuPDF** (better for general text, handles edge cases)
3. **Error handling** (never crashes, always returns something)

**Pattern:**
```python
def extract_text(pdf_path):
    try:
        # Try pdfplumber first
        with pdfplumber.open(pdf_path) as pdf:
            text = ""
            for page in pdf.pages:
                text += sanitize_text(page.extract_text()) + "\n"
            if text.strip():
                return text
    except:
        # Fallback to PyMuPDF
        return extract_with_pymupdf(pdf_path)
```

### Image Preprocessing

**When to Use:** Scanned PDFs, photos, poor-quality images

**Quality Assessment:**
- Calculate sharpness (Laplacian variance)
- Assess: POOR (<50) → FAIR (50-100) → GOOD (>100)

**Enhancement Steps:**
1. Sharpen (2.5×) - Critical for text clarity
2. Increase contrast (1.8×) - Helps with faded scans
3. Brightness boost (1.15×)
4. Edge enhancement - Helps AI detect column boundaries

**Impact:** +15-20% accuracy on poor-quality images

---

## AI Extraction System

### Gemini API Configuration

**Model Priority (with fallback):**
1. `gemini-2.5-flash-lite` (fastest, cheapest)
2. `gemini-2.5-pro` (most capable)
3. `gemini-2.5-flash` (balanced)
4. `gemini-pro-latest` (fallback)

**Pattern:**
```python
models = ['gemini-2.5-flash-lite', 'gemini-2.5-pro', ...]
for model_name in models:
    try:
        model = genai.GenerativeModel(model_name)
        response = model.generate_content(prompt)
        return parse_json_response(response.text)
    except ResourceExhausted:
        continue  # Try next model
```

**Why This Works:**
- Graceful degradation (tries cheaper models first)
- Handles quota exhaustion automatically
- Never gives up (tries 4 models)

### Prompt System

**Current State:** Code-based prompts only (database prompts disabled)

**Location:** `services/gemini_service.py` lines 124-3015

**Size:** ~40,000 characters

**Key Features:**
- Universal extraction principles
- OCR error correction (I→1, O→0, S→5)
- Strikethrough text handling
- Handwritten annotation detection
- Character soup detection
- Multi-part comment extraction
- Partial extraction before marking illegible
- Cross-field validation

**⚠️ CRITICAL:** Database prompts are disabled (`is_active = false`). Enabling them would drop accuracy from 93% to ~60%.

### Prompt Engineering Pattern

**Structure:**
```
## CRITICAL RULES
[Explicit instructions]

## FIELD DEFINITIONS
[What each field means with examples]

## VALIDATION RULES
[Data quality checks]

## EDGE CASES
[Strikethrough, handwriting, stains, etc.]

## OUTPUT FORMAT
Return ONLY valid JSON array. No markdown.

TEXT: {extracted_text}
```

**Key Principles:**
1. Explicit instructions - Tell AI exactly what to do
2. Examples - Show format you want
3. Edge cases - Handle strikethrough, handwriting, stains
4. Validation rules - Ask AI to self-check
5. Output format - Crystal clear (JSON only, no markdown)

---

## Data Processing

### JSON Response Parsing

**Pattern:** Clean → Parse → Validate → Sanitize

```python
# 1. Remove markdown code fences
clean_text = sanitize_json_response(response_text)

# 2. Try to parse
try:
    parsed = json.loads(clean_text)
except json.JSONDecodeError:
    # Extract JSON from text
    match = re.search(r'\[.*\]', clean_text, re.DOTALL)
    parsed = json.loads(match.group(0))

# 3. Sanitize all strings
parsed = sanitize_dict(parsed)

# 4. Validate structure
if not isinstance(parsed, list):
    parsed = [parsed]  # Wrap single object
```

**Handles:**
- Markdown code fences (```json ... ```)
- Preamble text before JSON
- UTF-8 corruption
- Single object instead of array
- Malformed JSON (extracts what it can)

### UTF-8 Sanitization

**File:** `utils/encoding_fix.py`

**Pattern:** Dictionary of known corruptions

**Common Fixes:**
- `â„¢` → `™`
- `â€™` → `'`
- `â€œ` → `"`
- `Ã—` → `×`
- `\xc2\xa0` → ` ` (non-breaking space)
- 50+ more patterns

**Apply Everywhere:**
- PDF extraction
- AI responses
- CSV exports
- Template rendering

**Result:** Clean UTF-8 throughout entire pipeline

### Validation & Auto-Correction

**File:** `services/validation_service.py`

**Pattern:** Validate → Auto-Correct → Flag Errors

**Example (Engineering Size Field):**
```python
def validate_size(size_value):
    # Pattern matching
    patterns = {
        "UC": r'^\d{3}UC\d{2,3}(\.\d)?$',  # 310UC158
        "UB": r'^\d{3}UB\d{2,3}(\.\d)?$',  # 460UB82.1
        "WB": r'^WB\d{3,4}[×x]\d+(\.\d)?$' # WB1220×6.0
    }
    
    # Auto-correct OCR errors
    if not matched:
        corrected = size_value
        corrected = re.sub(r'(?<!\d)[IO](?=\d)', '1', corrected)
        corrected = re.sub(r'(?<=\d)[O](?=\d|$)', '0', corrected)
        return corrected_value
```

**Auto-Corrects:**
- OCR errors (I→1, O→0, S→5)
- Spacing issues
- Case inconsistencies

**Flags:**
- Invalid patterns
- Missing critical fields
- Suspicious values

**Impact:** +5-10% accuracy, catches errors before export

---

## Accuracy Benchmarks

### By Department

**Finance (Vendor Invoices):**
- Accuracy: 95%+
- Fields: Vendor, invoice #, date, amount, line items
- Speed: ~30 seconds per invoice

**Engineering (Beam/Column Schedules):**
- Accuracy: 93% overall
  - Clean PDFs: 100%
  - Scanned documents: 86%
- Fields: Member mark, size, grade, length, quantity, comments
- Speed: ~30-60 seconds per schedule
- Special handling: Handwritten notes, strikethrough text

**Transmittal (Drawing Registers):**
- Accuracy: 95%+
- Fields: Drawing #, revision, title, date, status
- Speed: ~20 seconds per register

### By Document Quality

| Document Type | Accuracy | Notes |
|--------------|----------|-------|
| Clean digital PDF | 95%+ | Best case |
| Scanned PDF (good quality) | 90%+ | With image preprocessing |
| Scanned PDF (poor quality) | 85%+ | With enhancement |
| Photo of document | 80-85% | Requires preprocessing |
| Handwritten annotations | 85%+ | Captured in brackets |

---

## Key Technical Patterns

### 1. Dual Extraction (PDF + Image fallback)
```python
try pdfplumber → try PyMuPDF → return error
```

### 2. Model Fallback (Gemini resilience)
```python
for model in [fast, medium, slow, fallback]:
    try → success → return
```

### 3. Quality Assessment (Image preprocessing)
```python
assess → if poor → enhance → extract
```

### 4. Structured Prompts (AI instructions)
```python
rules + examples + edge cases + output format + text
```

### 5. Aggressive Parsing (JSON extraction)
```python
clean markdown → try parse → extract JSON → sanitize
```

### 6. Validation Pipeline (Post-processing)
```python
validate → auto-correct → flag errors → log changes
```

### 7. UTF-8 Sanitization (Corruption fixes)
```python
apply at every layer: PDF → AI → Data → Export
```

---

## Error Handling

### Never Crash - Always Return Something

```python
def extract_data(pdf_path):
    try:
        return extract_with_pdfplumber(pdf_path)
    except Exception as e1:
        try:
            return extract_with_pymupdf(pdf_path)
        except Exception as e2:
            try:
                return extract_with_vision(pdf_path)
            except Exception as e3:
                return {
                    "status": "error",
                    "message": "All extraction methods failed",
                    "errors": [str(e1), str(e2), str(e3)],
                    "data": []
                }
```

### Logging

```python
import logging

logger = logging.getLogger(__name__)
logger.info(f"Processing {filename}")
logger.warning(f"Low confidence on row {i}")
logger.error(f"Extraction failed: {str(e)}")
```

---

## Performance Optimization

### Caching

```python
from functools import lru_cache

@lru_cache(maxsize=100)
def get_prompt_template(doc_type):
    """Cache prompt templates"""
    return build_prompt(doc_type)
```

### Timeout Handling

```python
import signal

def timeout_handler(signum, frame):
    raise TimeoutError("AI request timeout")

signal.signal(signal.SIGALRM, timeout_handler)
signal.alarm(30)  # 30s timeout

try:
    result = model.generate_content(prompt)
finally:
    signal.alarm(0)  # Cancel alarm
```

### Batch Processing

```python
from concurrent.futures import ThreadPoolExecutor

def process_batch(files):
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(extract_from_file, f) for f in files]
        return [future.result() for future in concurrent.futures.as_completed(futures)]
```

---

## Common Pitfalls

### ❌ DON'T Trust AI JSON Without Cleaning
```python
# BAD
data = json.loads(response.text)

# GOOD
data = sanitize_json_response(response.text)
data = json.loads(data)
data = sanitize_dict(data)
```

### ❌ DON'T Ignore OCR Errors
```python
# BAD
return raw_size_value

# GOOD
return validate_and_correct_size(raw_size_value)
```

### ❌ DON'T Use Single Model
```python
# BAD
model = genai.GenerativeModel('gemini-pro')
return model.generate_content(prompt)

# GOOD
for model_name in fallback_models:
    try:
        model = genai.GenerativeModel(model_name)
        return model.generate_content(prompt)
    except:
        continue
```

---

## Critical Files Reference

**Core Services:**
- `services/gemini_service.py` - AI extraction (40K+ char prompts)
- `services/pdf_service.py` - PDF text extraction
- `services/validation_service.py` - Data validation
- `services/image_preprocessing.py` - Image enhancement

**Utilities:**
- `utils/encoding_fix.py` - UTF-8 sanitization
- `utils/formatting.py` - Output formatting

**Configuration:**
- `models/department_config.py` - Document schemas
- `config.py` - Department field definitions

---

## Summary

**Core Principles:**
1. **Resilience** - Multiple fallbacks, never crash
2. **Sanitization** - Clean data at every layer
3. **Validation** - Auto-correct when possible, flag when not
4. **Transparency** - Log everything, show corrections
5. **Testing** - Unit + integration tests recommended

**Proven Patterns:**
- Dual extraction (pdfplumber + PyMuPDF)
- Model fallback (4 Gemini models)
- Quality assessment (image preprocessing)
- Structured prompts (rules + examples)
- Aggressive parsing (clean → parse → sanitize)
- Post-processing validation

**Result:** 93% accuracy on real-world documents
