# Curam-Ai Protocol: Project Overview

**Status:** Production (Railway)  
**Domain:** https://curam-protocol.curam-ai.com.au  
**Last Updated:** December 2025  
**Total Codebase:** ~6,000 lines Python

---

## What Is This?

**Curam-Ai Protocol™** is an AI-powered document automation platform that extracts structured data from unstructured PDFs for professional services firms.

### The Core Problem It Solves

Mid-sized firms (50-100 staff) waste $300k-$3M annually on manual document processing:
- **Finance teams:** Manually typing invoice data into accounting software (2.5 hrs/week wasted)
- **Engineers:** Transcribing structural schedules from PDFs to Excel (45-60 min per schedule)
- **Drafters:** Compiling drawing registers by hand (hours per transmittal)

### The Solution

AI extraction using Google Gemini that:
1. Reads any PDF (invoices, structural drawings, project documents)
2. Extracts structured data using department-specific AI prompts
3. Returns formatted tables/CSV ready for Excel, Xero, MYOB

---

## Target Market

**Primary:** Australian civil engineering firms (50-100 staff, like FSACE - a 70-person structural firm)

**Secondary Industries:**
- Accounting firms (15-100 staff)
- Legal services
- Logistics & compliance
- Construction & built environment

**Key Insight:** Large enough to have document volume pain, small enough that manual entry still dominates

---

## The Business Model: The Protocol™

A 4-phase de-risked framework (NOT hourly consulting):

### Phase 1: Feasibility Sprint ($1,500, 48 hours)
- Client uploads 15 of THEIR documents
- You prove accuracy on THEIR specific formats
- Refundable if they proceed to Phase 2
- **Goal:** Remove skepticism, prove it works

### Phase 2: Readiness Roadmap ($7,500, 3 weeks)
- Workflow analysis
- Financial modeling (ROI calculation)
- Security audit
- Board-ready business case
- **Goal:** Get executive buy-in

### Phase 3: Compliance Shield ($8k-$12k, 2 weeks)
- Shadow IT inventory
- ISO 27001 alignment
- PI Insurance documentation
- **Goal:** Unblock IT/legal objections

### Phase 4: Implementation ($20k-$30k, 30-day sprints)
- Wave-based deployment
- Integration with existing systems
- Staff training
- **Goal:** Go live, measure results

---

## Three Core Workflows

### 1. Finance Department: Invoice Processing

**Input:** PDF invoices (from suppliers, subcontractors, SaaS vendors)

**Output:**
```
Vendor | Invoice # | Date | Subtotal | GST | Total | Summary
ABC Corp | INV-123 | 2025-01-15 | $1,000 | $100 | $1,100 | Office supplies
```

**Accuracy:** 95%+ on standard invoices

**Time Saved:** 3 min/invoice → 2.5 hours/week for 50 invoices

### 2. Engineering Department: Structural Schedules

**Input:** PDF structural drawings with beam/column schedules

**Output:**
```
Mark | Size | Material | Grid | Qty
B1 | 310UC158 | 300PLUS | A-B/1-2 | 1
B2 | 460UB74.6 | 300PLUS | B-C/1-2 | 2
```

**Accuracy:** 90%+ on clean CAD exports, 75-85% on scanned drawings

**Time Saved:** 45-60 min per schedule (engineers do 2-5 schedules/week)

### 3. Transmittal Department: Drawing Registers

**Input:** Multiple PDF drawings (10-50 per transmittal)

**Output:**
```
Drawing # | Title | Revision | Scale | Status
S-001 | General Notes | B | NTS | FOR CONSTRUCTION
S-101 | Level 1 Framing Plan | A | 1:100 | FOR APPROVAL
```

**Accuracy:** 95%+ on title block extraction

**Time Saved:** 3-4 hours per transmittal (weekly task)

---

## Current Product Structure

### 1. Marketing Website (Flask + Static HTML)
- Homepage with Protocol™ diagram
- 4 industry-specific pages (Accounting, Professional Services, Logistics, Built Environment)
- RAG-powered blog search
- AI contact assistant chatbot
- Navy Blue (#0F172A) & Gold (#D4AF37) branding

### 2. ROI Calculator (Flask Blueprint)
- 4-step flow: Industry → Data Entry → Results → PDF Report
- 14 industries configured
- Calculates annual efficiency loss ($300k-$3M range)
- Generates board-ready PDF reports
- **Recent Fix (v2.0):** Calculation error corrected (was inflating by 10-50×)

### 3. Document Automater (Flask Routes)
- 3 department toggles: Finance | Engineering | Transmittal
- Sample PDF library (6 invoices, 4 drawings, 10 transmittals)
- Drag-and-drop upload
- Real-time extraction (2-10 seconds per PDF)
- CSV export
- Color-coded results (red = errors, yellow = warnings)

---

## Technology Stack (Current)

**Backend:**
- Python 3.11
- Flask (web framework)
- Google Gemini 2.0 Flash API (AI extraction)
- pdfplumber (PDF text extraction)
- SQLite (sample management)

**Frontend:**
- Vanilla JavaScript (no frameworks)
- Custom CSS (Navy/Gold theme)
- Responsive design

**Deployment:**
- Railway (production)
- Gunicorn (process manager)
- Environment: `GEMINI_API_KEY`, `SECRET_KEY`

**File Structure (Post-Refactoring):**
```
main.py (1003 lines - down from 6000!)
├── routes/
│   └── static_pages.py (50+ marketing routes)
├── services/
│   ├── gemini_service.py (AI integration)
│   ├── pdf_service.py (PDF processing)
│   ├── rag_service.py (blog search)
│   └── validation_service.py
├── models/
│   └── department_config.py (document schemas)
├── utils/
│   ├── formatting.py
│   └── prompts.py (AI prompt templates)
└── templates/ (Jinja2 HTML)
```

---

## Key Achievements & Fixes

### Completed Phases:
- ✅ **Phase 1:** Foundation (basic extraction working)
- ✅ **Phase 2:** Refactoring (config, models, utils extracted)
- ✅ **Phase 3:** Services layer (business logic separated)
- ✅ **Phase 4.1:** Routes blueprint (50+ static routes extracted)
- ✅ **Phase 5:** ROI Calculator v2.0 (14 critical fixes)

### Recent Fixes (December 2025):
1. ✅ **ROI Calculation Error** - Removed double multiplication (results now 10-50× more realistic)
2. ✅ **Pain Score Implementation** - Multipliers (0.85×-1.35×) now affect automation potential
3. ✅ **Transparency** - Show multipliers and assumptions in results
4. ✅ **Input Validation** - Warn if inputs seem unrealistic
5. ✅ **UX Improvements** - Better visual hierarchy, Phase 1 CTA emphasis

### Known Limitations:
1. **Scanned PDFs:** 75-85% accuracy (vs 95% on digital PDFs) - OCR not yet implemented
2. **Line Items:** Optional for invoices (only extracted if clearly itemized)
3. **Complex Drawings:** Struggles with hand-marked drawings, non-standard formats
4. **Concurrent Users:** SQLite limits concurrent writes (PostgreSQL migration planned)

---

## Business Performance Indicators

### ROI Calculator Metrics:
- **Typical Small Firm (15 staff):** $324k annual leakage
- **Medium Firm (50 staff):** $888k annual leakage  
- **Large Firm (80 staff):** $3.8M annual leakage

### Conversion Funnel:
1. Homepage visit → ROI Calculator: ~40% click-through
2. ROI Calculator → Phase 1 booking: ~15% conversion (target)
3. Phase 1 → Phase 2: ~60% conversion (high trust after proof)
4. Phase 2 → Implementation: ~80% conversion (board approval secured)

### Pricing Tiers:
- Phase 1: $1,500 (refundable, breaks even at 5 conversions/month)
- Phase 2: $7,500 (margins ~60%, requires 8-10 hours consulting)
- Phase 3: $8k-$12k (custom scope)
- Phase 4: $20k-$30k per workflow (implementation + training)

**Annual Target:** 10 Phase 2 clients = $75k revenue base

---

## Critical Files to Reference

### For New Projects:

1. **Product Understanding:**
   - `PRODUCT_OVERVIEW.md` - Target market, value prop
   - `README.md` - Quick start guide
   - `website-brief.md` - Marketing site design rationale

2. **Technical Implementation:**
   - `TECHNICAL_DOCUMENTATION.md` - How things work
   - `gemini_service.py` - AI integration patterns
   - `prompts.py` - Prompt engineering examples

3. **Deployment:**
   - `DEPLOYMENT_GUIDE.md` - Railway setup
   - `DEPLOYMENT_SUMMARY.md` - Recent deployments
   - `requirements.txt` - Dependencies

4. **ROI Calculator:**
   - `ROI_CALCULATOR_README.md` - How it works
   - `ROI_CALCULATOR_FIXES.md` - What was fixed in v2.0
   - `roi_calculator_flask.py` - Implementation

5. **Industry Configs:**
   - `INDUSTRY_CONFIGS_COMPLETE.md` - All 14 industry configurations
   - `INDUSTRY_PAGE_UNIVERSAL_TEMPLATE.md` - How to add new industries

### Outdated Files (Historical Only):
- `PHASE1_*.md` - Early phase docs (superseded by current code)
- `JINJA2_MIGRATION_SUMMARY.md` - Migration complete
- `AUTOMATER_ISE_TROUBLESHOOTING.md` - Old errors, now fixed
- `BUTTON_DIFFERENTIATION_FIX.md` - UI tweak, now in main CSS

---

## Quick Start for New Similar Project

### 1. Clone Core Architecture:
```python
# Use this structure:
main.py (Flask app initialization only)
├── routes/ (blueprints for different sections)
├── services/ (AI, PDF, validation logic)
├── models/ (data schemas, configs)
└── utils/ (formatting, prompts)
```

### 2. Gemini Integration Pattern:
```python
# Always use model fallback:
models = ['gemini-2.0-flash-exp', 'gemini-1.5-flash-latest', ...]
for model in models:
    try:
        return extract_with_gemini(text, dept, model)
    except ResourceExhausted:
        continue  # Try next model
```

### 3. Prompt Engineering Template:
```python
prompt = f"""
Extract [DATA TYPE] from this document as JSON.

## DOCUMENT TYPE DETECTION
[How to identify document variants]

## REQUIRED FIELDS
[Field definitions with examples]

## VALIDATION RULES
[Data quality checks]

## OUTPUT FORMAT
Return ONLY valid JSON array. No markdown.

TEXT: {text}
"""
```

### 4. ROI Calculator Pattern:
```python
# 4-step flow works for any service:
Step 1: Industry/Category Selection
Step 2: Data Input (with industry defaults)
Step 3: Results Dashboard (hero number, breakdown, CTA)
Step 4: PDF Report (downloadable business case)
```

### 5. De-risking Strategy:
- Phase 1 = Prove it works ($1,500)
- Phase 2 = Get buy-in ($7,500)
- Phase 3 = Remove blockers ($8k-$12k)
- Phase 4 = Implementation ($20k-$30k)

**This model works for ANY professional services AI project.**

---

## What Makes This Valuable for New Projects

### Proven Patterns:
1. **AI Extraction Framework** - Prompt templates, fallback logic, error handling
2. **ROI Calculator** - Psychological conversion flow (industry → data → results → CTA)
3. **De-risked Sales Process** - 4-phase model removes "black box" consulting fear
4. **Industry Segmentation** - Universal template for adding industries in 15 min
5. **Refactored Codebase** - Clean separation: routes | services | models | utils

### Reusable Components:
- Gemini service with fallback (copy-paste ready)
- PDF extraction pipeline (pdfplumber → text → AI → structured data)
- ROI calculator (change industry configs, keep flow)
- Marketing website (navy/gold theme, protocol diagram, trust builders)

### Business Model Template:
- Fixed-fee productized services (NOT hourly consulting)
- Low-risk Phase 1 ($1,500 to prove it)
- High-margin Phase 2 ($7,500 for strategy)
- Implementation only after proof + buy-in

**Total addressable playbook for professional services AI automation.**

---

## Next Steps for New Project

1. **Define the document type** - Invoices? Contracts? Reports?
2. **Clone architecture** - Use routes/services/models structure
3. **Adapt prompts** - Copy gemini_service.py, change prompts
4. **Build ROI calculator** - Copy roi_calculator_flask.py, change industry configs
5. **Deploy to Railway** - Same Procfile, requirements.txt, env vars
6. **Test Phase 1** - Prove it works on 15 real documents
7. **Launch** - Marketing site + ROI calculator + Phase 1 booking

**Estimated Time to Launch:** 2-4 weeks (using this as template)

---

**END OF OVERVIEW**

See next file: `2_ARCHITECTURE_REFERENCE.md` for technical deep dive.
