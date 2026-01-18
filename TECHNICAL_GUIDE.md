# Curam-Ai Protocol: Technical Guide

**Last Updated:** January 2026  
**Purpose:** Technical architecture, implementation details, and development reference

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [PDF Extraction Pipeline](#pdf-extraction-pipeline)
4. [AI Extraction System](#ai-extraction-system)
5. [ROI Calculation System](#roi-calculation-system)
6. [Validation & Quality](#validation--quality)
7. [Performance Optimization](#performance-optimization)
8. [Error Handling](#error-handling)

---

## System Overview

Curam-Ai Protocol™ extracts structured data from unstructured PDF documents using Google Gemini AI. It serves three core workflows:

1. **Finance** - Vendor invoice extraction (95%+ accuracy)
2. **Engineering** - Structural beam/column schedule extraction (93% accuracy)
3. **Transmittal** - Drawing register extraction (95%+ accuracy)

**Tech Stack:**
- Python 3.11, Flask
- PostgreSQL (Railway/Replit managed)
- Google Gemini 2.5 Flash
- pdfplumber, PyMuPDF (dual extraction)
- Gunicorn (production WSGI server)

**Target Industries (5 validated):**
- Accounting, Engineering, Logistics, Financial Planning, Insurance

---

## Architecture

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
main.py                          # Flask application
├── routes/
│   ├── static_pages.py          # Marketing page routes
│   ├── api_routes.py            # REST API endpoints
│   └── admin_routes.py          # Admin dashboard blueprint
├── services/
│   ├── gemini_service.py        # AI extraction (40K+ char prompts)
│   ├── pdf_service.py           # PDF text extraction
│   ├── validation_service.py    # Data validation & OCR correction
│   └── image_preprocessing.py   # Image enhancement
├── roi_calculator/
│   ├── calculations.py          # ROI calculation logic (80% staff rule)
│   └── config/
│       └── industries.py        # Industry configurations
├── roi_calculator_flask.py      # ROI calculator routes + templates
└── templates/                   # Jinja2 HTML templates
    └── admin/                   # Admin dashboard templates
```

---

## PDF Extraction Pipeline

### Dual Extraction Strategy

**Priority:**
1. **pdfplumber** (better for tables, preserves structure)
2. **PyMuPDF** (better for general text, handles edge cases)
3. **Error handling** (never crashes, always returns something)

### Image Preprocessing

**When to Use:** Scanned PDFs, photos, poor-quality images

**Quality Assessment:**
- Calculate sharpness (Laplacian variance)
- Assess: POOR (<50) → FAIR (50-100) → GOOD (>100)

**Enhancement Steps:**
1. Sharpen (2.5×)
2. Increase contrast (1.8×)
3. Brightness boost (1.15×)
4. Edge enhancement

---

## AI Extraction System

### Gemini API Configuration

**Model Priority (with fallback):**
1. `gemini-2.5-flash-lite` (fastest, cheapest)
2. `gemini-2.5-pro` (most capable)
3. `gemini-2.5-flash` (balanced)
4. `gemini-pro-latest` (fallback)

### Prompt System

**Current State:** Code-based prompts (database prompts disabled for accuracy)

**Location:** `services/gemini_service.py`

**Key Features:**
- Universal extraction principles
- OCR error correction (I→1, O→0, S→5)
- Strikethrough text handling
- Handwritten annotation detection
- Multi-part comment extraction

---

## ROI Calculation System

### Fixed 80/20 Documentation Staff Rule

**Business Decision:** 20% of staff are executives/senior partners who do NOT do repetitive documentation.

```python
EXECUTIVE_EXCLUSION_RATE = 0.20
doc_staff_percentage = 1.0 - EXECUTIVE_EXCLUSION_RATE  # Always 80%
doc_staff_count = int(total_staff * doc_staff_percentage)
```

**Example (50-staff firm):**
- Total staff: 50
- Documentation staff: 40 (80%)
- Excluded (executives): 10 (20%)
- Hours per week: 5.0 (from industry config)
- Total weekly hours: 200 (40 × 5)

### Industry Variance Multiplier

**Purpose:** Adjusts ROI calculations based on how well each industry's document types align with the proven automation model.

**Multiplier Tiers:**
- **High-Reliability (0.90):** Accounting, Logistics, Financial Planning, Insurance
- **Medium-Reliability (0.75):** Engineering, Construction, Architecture

### Calculation Flow

**Location:** `roi_calculator/calculations.py`

**Steps:**
1. Apply 80% documentation staff rule
2. Calculate total weekly hours (doc_staff × hours_per_week)
3. Calculate annual documentation cost (weekly_hours × rate × 48)
4. Calculate savings based on automation potential
5. Apply Industry Variance Multiplier

**Formula:**
```
Adjusted Annual Savings = Base Savings × Industry Variance Multiplier
```

### Three Savings Scenarios

- **Conservative:** Base rate × variance multiplier
- **Probable:** Conservative × 1.15 (15% above conservative)
- **Optimistic:** Conservative × 1.35 (35% above conservative)

### Staff Adoption Sensitivity

Applied to Probable Scenario:
- **High Adoption (80%):** 80% of probable savings
- **Expected Adoption (60%):** 60% of probable savings (default)
- **Low Adoption (40%):** 40% of probable savings

---

## Validation & Quality

### Validation Pipeline

**Pattern:** Validate → Auto-Correct → Flag Errors

**Auto-Corrects:**
- OCR errors (I→1, O→0, S→5)
- Spacing issues
- Case inconsistencies

**Flags:**
- Invalid patterns
- Missing critical fields
- Suspicious values

---

## Accuracy Benchmarks

### By Department

| Department | Accuracy | Speed |
|------------|----------|-------|
| Finance | 95%+ | ~30 seconds per invoice |
| Engineering | 93% | ~30-60 seconds per schedule |
| Transmittal | 95%+ | ~20 seconds per register |

### By Document Quality

| Document Type | Accuracy |
|--------------|----------|
| Clean digital PDF | 95%+ |
| Scanned PDF (good quality) | 90%+ |
| Scanned PDF (poor quality) | 85%+ |
| Handwritten annotations | 85%+ |

---

## Performance Optimization

### Caching

- Document fingerprinting (SHA256)
- 7-day cache expiry
- Cache bypass when user guidance provided

### Database Connection Pooling

- SQLAlchemy QueuePool with 5 connections
- Connection recycling every 30 minutes
- Pre-ping enabled for health checks

### Production Server (Gunicorn)

- 4 workers for concurrent handling
- 5-minute timeout for AI API calls
- Worker recycling every 1000 requests

---

## Error Handling

### Never Crash - Always Return Something

```python
def extract_data(pdf_path):
    try:
        return extract_with_pdfplumber(pdf_path)
    except:
        try:
            return extract_with_pymupdf(pdf_path)
        except:
            return {"status": "error", "data": []}
```

---

## Critical Files Reference

**Core Services:**
- `services/gemini_service.py` - AI extraction
- `services/pdf_service.py` - PDF text extraction
- `services/validation_service.py` - Data validation

**ROI Calculator:**
- `roi_calculator_flask.py` - Routes and templates
- `roi_calculator/calculations.py` - Calculation logic

**Configuration:**
- `config.py` - Department field definitions
- `roi_calculator/config/industries.py` - Industry configs

---

**Document Version:** 3.0  
**Last Updated:** January 2026
