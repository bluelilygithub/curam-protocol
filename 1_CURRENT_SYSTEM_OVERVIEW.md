# Curam-AI Protocol: Current System Overview

**Last Updated:** January 2, 2026  
**Status:** Production (Railway)  
**Domain:** https://curam-protocol.curam-ai.com.au

---

## What This System Does

**Curam-AI Protocol™** is an AI-powered document extraction platform for professional services firms.

### Core Capabilities (Working)

**1. Finance Department - Invoice Processing** ✅
- Extracts vendor invoices to structured data
- Accuracy: 95%+ on standard invoices
- Time saved: 3 min/invoice → 30 seconds

**2. Engineering Department - Structural Schedules** ✅  
- Extracts beam/column schedules from PDF drawings
- Accuracy: 93% overall (100% on clean PDFs, 86% on scans)
- Time saved: 45-60 min/schedule → 30 seconds

**3. Transmittal Department - Drawing Registers** ✅
- Extracts drawing metadata from title blocks
- Accuracy: 95%+ on title block data
- Time saved: 3-4 hours/transmittal → 20 seconds

---

## Current Architecture

### Technology Stack

**Backend:**
- Python 3.11
- Flask (web framework)
- PostgreSQL (Railway managed)
- Google Gemini 2.5 Flash (AI extraction)
- pdfplumber (PDF text extraction)

**Frontend:**
- Vanilla JavaScript
- Custom CSS (Navy #0F172A + Gold #D4AF37)
- Jinja2 templates
- Responsive design

**Deployment:**
- Railway (production hosting)
- Gunicorn (WSGI server)
- GitHub (version control)

### File Structure (Current)

```
curam-protocol/
├── main.py                     # Core Flask app (1,581 lines)
├── config.py                   # Configuration constants
├── database.py                 # PostgreSQL integration
├── requirements.txt            # Python dependencies
│
├── services/                   # Business logic
│   ├── gemini_service.py      # AI extraction (3,287 lines)
│   ├── pdf_service.py         # PDF processing
│   ├── validation_service.py  # Data validation
│   ├── image_preprocessing.py # Image enhancement
│   └── engineering_validator.py # Engineering-specific validation
│
├── routes/                     # Flask blueprints
│   └── static_pages.py        # 50+ marketing routes
│
├── utils/                      # Utilities
│   ├── encoding_fix.py        # UTF-8 sanitization
│   └── formatting.py          # Output formatting
│
├── templates/                  # Jinja2 HTML
│   └── (various .html files)
│
└── assets/                     # Static files
    ├── css/
    ├── js/
    └── images/
```

---

## Database Structure (PostgreSQL)

### Active Tables

**1. `sectors`** - Industry sectors
```sql
id | slug | name | icon_svg
```

**2. `document_types`** - Document configurations
```sql
id | sector_id | slug | name | sample_file_paths | extraction_fields
```

**3. `prompt_templates`** - AI prompts (DISABLED - using code-based prompts)
```sql
id | name | scope | doc_type | prompt_text | is_active
```

### Sample Files Source

**⚠️ CRITICAL:** Sample files are loaded from DATABASE, not config.py

**Location:** `document_types.sample_file_paths` column (JSONB array)

**To update samples:**
```sql
UPDATE document_types 
SET sample_file_paths = '["path/to/file.pdf"]'::jsonb
WHERE slug = 'beam-schedule';
```

---

## Current Limitations & Known Issues

### What Works Well ✅
1. Clean digital PDFs → 95-100% accuracy
2. Finance invoice extraction → Production ready
3. Engineering schedule extraction → 93% accuracy
4. ROI calculator → Fully functional
5. Marketing website → Live and stable

### Known Limitations ⚠️
1. **Cannot add new industries easily** - Requires database + code changes in multiple places
2. **Dual configuration system** - config.py + database creates confusion
3. **Scanned JPEGs** - Size column extraction fails (Vision API limitation)
4. **Three-way industry redundancy** - Industries defined in: industries.py, roi_calculator_flask.py, sectors table

### Failed Attempts (Do Not Retry) ❌
1. **Legal/Logistics industries** - Attempted to add, had to rollback due to architectural complexity
2. **Full database migration** - Tried to make everything database-driven, too complex for current needs
3. **JPEG schedule extraction** - Vision API alone cannot reliably extract Size column from photos

---

## Prompt System (Current State - Jan 2, 2026)

### Dual Prompt Architecture

**1. Database Prompts (DISABLED)** ❌
- Location: `prompt_templates` table
- Status: All `is_active = false`
- Reason: Database prompts were simplified (~1,700 chars) vs code-based (~40,000 chars)
- **Do not enable** - will reduce accuracy from 93% to ~60%

**2. Code-based Prompts (ACTIVE)** ✅
- Location: `services/gemini_service.py` (lines 124-3015)
- Size: ~40,000 characters
- Features:
  - Universal extraction principles
  - OCR error correction
  - Strikethrough handling
  - Handwritten annotation detection
  - Character soup detection
  - Multi-part comment extraction

**Priority:** Code checks database first, falls back to hardcoded prompts

**To verify which is active:**
```sql
SELECT name, is_active FROM prompt_templates;
-- All should show is_active = false
```

---

## Performance Metrics (Actual)

### Extraction Accuracy (Tested Dec 2025)

| Document Type | Accuracy | Notes |
|--------------|----------|-------|
| Clean CAD PDF | 100% | All rows perfect (8/8) |
| Clean Revit PDF | 100% | All rows perfect (5/5) |
| Messy beam scan | 100% | All rows valid (7/7) |
| Messy column scan | 71% | 5/7 valid, 2 correctly flagged |
| **Overall** | **93%** | 25/27 rows perfect |

### Processing Times

- Finance invoice: 2-4 seconds
- Engineering schedule (20 rows): 5-8 seconds  
- Transmittal register (5 drawings): 10-15 seconds
- Image preprocessing: +1-2 seconds (if image)

---

## ROI Calculator (Working)

**Status:** Fully functional, v2.0 deployed Dec 2025

**Fixed in v2.0:**
1. ✅ Calculation error (was inflating 10-50×)
2. ✅ Pain score multipliers working
3. ✅ Input validation active
4. ✅ Transparency improvements

**Coverage:** 14 industries configured

**Typical Results:**
- Small firm (15 staff): $324k annual leakage
- Medium firm (50 staff): $888k annual leakage
- Large firm (80 staff): $3.8M annual leakage

---

## Recent Fixes & Improvements

### December 2025 - Major Cleanup

**1. UTF-8 Encoding (FIXED)** ✅
- Created `utils/encoding_fix.py`
- Fixed 62 hardcoded corrupt characters
- Integrated sanitization throughout pipeline
- Result: Clean UTF-8 everywhere

**2. Prompt System (CLARIFIED)** ✅
- Disabled all database prompts
- Documented which system is active
- Added verification queries
- Result: Using elite 40k-char prompts

**3. Configuration (DOCUMENTED)** ✅
- Added warnings to config.py
- Created database quick reference
- Documented sample file source
- Result: No more wasted time editing wrong files

---

## Environment Variables (Production)

```bash
# Required
GEMINI_API_KEY=your-key-here
SECRET_KEY=minimum-24-chars-random
DATABASE_URL=postgresql://...  # Railway provides

# Optional
FLASK_ENV=production
DEBUG=False
PORT=5000  # Railway sets automatically
```

---

## Quick Start for Developers

### Local Development

```bash
# Clone repo
git clone https://github.com/your-repo/curam-protocol
cd curam-protocol

# Install dependencies
pip install -r requirements.txt

# Set environment variables
cp .env.example .env
# Edit .env with your GEMINI_API_KEY

# Run locally
python main.py

# Visit http://localhost:5000
```

### Test Extraction

1. Go to `/automater`
2. Select "Engineering Dept"
3. Check all 4 sample files
4. Click "Generate Output"
5. Verify 93%+ accuracy (25/27 rows correct)

### Deploy to Railway

```bash
# Link to Railway project
railway link

# Set environment variables
railway variables set GEMINI_API_KEY=your-key
railway variables set SECRET_KEY=random-32-chars

# Deploy
git push railway main

# Check logs
railway logs
```

---

## What NOT to Do (Lessons Learned)

### ❌ Don't Edit config.py for Sample Files
**Why:** Sample files come from database, not config.py  
**Instead:** Update database directly with SQL

### ❌ Don't Enable Database Prompts
**Why:** They're simplified versions that reduce accuracy  
**Instead:** Keep using code-based prompts

### ❌ Don't Try to Add Legal/Logistics Yet
**Why:** Current architecture doesn't support it easily  
**Instead:** Wait for Phase 1 refactor (industries unification)

### ❌ Don't Use JPEG Schedules
**Why:** Vision API can't reliably extract Size column  
**Instead:** Request CAD/Revit PDF exports

---

## Recommended Next Steps (Future)

**Only do these if clients demand more than current 2 industries:**

### Phase 1: Unify Industries (2 days)
- Add `roi_config` JSONB to `sectors` table
- Migrate `industries.py` → database
- Update `roi_calculator_flask.py` to read from DB
- **Enables:** Adding industries via database

### Phase 2: Enable New Industries (1 day)
- Add `extraction_fields` to `document_types`
- Make UI generate department list from database
- **Enables:** Legal/logistics support

### Phase 3: Admin Panel (3-5 days)
- Create `/admin/sectors` for ROI config
- Create `/admin/samples` for file management
- Add authentication
- **Enables:** Non-technical configuration

---

## Support & Documentation

### Key Files to Reference

**Current System:**
- This file (`1_CURRENT_SYSTEM_OVERVIEW.md`)
- `2_TECHNICAL_DEEP_DIVE.md` - Code architecture
- `3_DEPLOYMENT_GUIDE.md` - Railway deployment
- `PROMPT_SYSTEM_DOCS.md` - Prompt management

**Database:**
- `DATABASE_QUICK_REF.md` - SQL commands
- `ARCHITECTURE_NOTES.md` - Known issues

**Troubleshooting:**
- Check Railway logs: `railway logs`
- Verify database prompts disabled
- Check environment variables set

---

## Summary

**What Works:** Finance + Engineering + Transmittal extraction at 93%+ accuracy  
**What Doesn't:** Adding new industries, JPEG extraction  
**What's Next:** Ship to clients, validate demand, then refactor if needed

**Status:** ✅ Production-ready for 2 industries (finance, engineering)

---

**Last Verified:** January 2, 2026  
**Accuracy Tested:** 27 rows across 4 documents  
**Result:** 93% (25/27 perfect, 2 correctly flagged)
