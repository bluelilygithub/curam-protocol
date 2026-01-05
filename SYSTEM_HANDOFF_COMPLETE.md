# Curam-AI Protocol: Complete System Handoff Document

**Date Created:** January 3, 2026  
**Purpose:** Complete knowledge transfer for developers/AI assistants taking over this project  
**Production URL:** https://curam-ai.com.au  
**Status:** ✅ Production (Stable)

---

## 🎯 QUICK START - READ THIS FIRST

### What This System Does
**Curam-AI Protocol™** is an AI-powered document extraction platform that converts PDF documents into structured data using Google Gemini API. It serves professional services firms across three departments:

1. **Finance** - Vendor invoice extraction
2. **Engineering** - Structural beam/column schedule extraction  
3. **Transmittal/Drafting** - Drawing register extraction

### Critical Success Metrics
- **Accuracy:** 93% overall (95%+ on Finance, 93% on Engineering, 95%+ on Transmittal)
- **Speed:** 30-60 seconds per document (vs 3-60 minutes manual)
- **Technology:** Python 3.11 + Flask + PostgreSQL + Google Gemini 2.5 Flash

---

## 🚀 DEPLOYMENT INFORMATION

### Current Production Environment

**Hosting:** Railway  
**Domain:** https://curam-ai.com.au  
**Database:** PostgreSQL (Railway managed)  
**Python Version:** 3.11+  
**WSGI Server:** Gunicorn

### Environment Variables (Railway Configuration)

```bash
# CRITICAL - Application will not work without these
DATABASE_URL=postgresql://...          # PostgreSQL connection string (Railway managed)
GEMINI_API_KEY=...                     # Google AI API key (Gemini Pro with $ limits)
SECRET_KEY=...                         # Flask session secret

# OPTIONAL - Communication features (not currently used in core extraction)
MAILCHANNELS_API_KEY=...               # Email service
TWILIO_ACCOUNT_SID=...                 # SMS service
TWILIO_API_KEY_SID=...
TWILIO_API_SECRET=...
TWILIO_PHONE_FROM=...
WORDPRESS_BLOG_URL=...                 # Blog integration
```

### How to Verify Deployment

1. **Check production URL:** Visit https://curam-ai.com.au
2. **Test database connection:** `/debug/db-test` endpoint (if enabled)
3. **Check Railway logs:** Railway dashboard → Deployments → Logs
4. **Verify Gemini API:** Test with any sample PDF upload

---

## 📁 FILE STRUCTURE & ARCHITECTURE

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    USER INTERFACE LAYER                      │
├─────────────────────────────────────────────────────────────┤
│  Marketing Pages  │  ROI Calculator  │  Document Automation │
│  (Static HTML)    │  (Flask)         │  (Flask)             │
└──────────┬────────┴──────────┬───────┴────────┬─────────────┘
           │                    │                 │
           v                    v                 v
┌─────────────────────────────────────────────────────────────┐
│                   APPLICATION LAYER (Flask)                  │
├─────────────────────────────────────────────────────────────┤
│  routes/           │  services/        │  utils/            │
│  - static_pages.py │  - gemini_service │  - encoding_fix    │
│                    │  - pdf_service    │  - formatting      │
│                    │  - rag_service    │                    │
│                    │  - validation     │                    │
└──────────┬─────────┴──────────┬────────┴────────┬───────────┘
           │                     │                  │
           v                     v                  v
┌─────────────────────────────────────────────────────────────┐
│                     DATA & AI LAYER                          │
├─────────────────────────────────────────────────────────────┤
│  Gemini API       │  PostgreSQL       │  PDF Processing    │
│  - Text extract   │  - Config data    │  - pdfplumber      │
│  - AI generation  │  - Results cache  │  - Text extraction │
└─────────────────────────────────────────────────────────────┘
```

### File Structure (Current State)

```
curam-ai/
├── main.py                          # 1,627 lines - Core Flask application
├── config.py                        # Configuration constants & department configs
├── database.py                      # PostgreSQL integration (393 lines)
├── requirements.txt                 # Python dependencies
│
├── services/                        # Business logic layer
│   ├── gemini_service.py            # 152KB - AI extraction (40K+ char prompts)
│   ├── pdf_service.py               # PDF text extraction
│   ├── validation_service.py        # Data validation & OCR correction
│   ├── rag_service.py               # RAG search functionality (20KB)
│   └── image_preprocessing.py       # Image enhancement (14KB)
│
├── routes/                          # Flask blueprints
│   └── static_pages.py              # 50+ marketing page routes (18KB)
│
├── utils/                           # Utilities
│   ├── encoding_fix.py              # UTF-8 sanitization (fixes corrupt chars)
│   └── formatting.py                # Output formatting helpers
│
├── templates/                       # Jinja2 HTML templates
│   ├── base.html                    # Base template (8KB)
│   ├── roi_results_improved.html    # ROI calculator results (34KB)
│   ├── roi_report_pdf.html          # PDF report template (29KB)
│   └── feasibility-preview.html     # Demo preview page (12KB)
│
├── assets/                          # Static files
│   ├── css/
│   │   └── styles.css               # 266KB - Complete styling
│   ├── js/
│   │   ├── main.js                  # 23KB - Core JavaScript
│   │   ├── scripts.js               # 4.5KB - Additional scripts
│   │   ├── rag-search-demo.js       # 28KB - RAG search UI
│   │   ├── search_progressive_ux.js # 16KB - Progressive search
│   │   ├── hero-text-rotation.js    # 5KB - Homepage animation
│   │   ├── navbar-loader.js         # 3.5KB - Dynamic navbar
│   │   └── footer-loader.js         # 1KB - Dynamic footer
│   ├── images/                      # Marketing images
│   └── samples/                     # Demo PDF samples
│
├── calculations.py                  # ROI calculation logic (16KB)
├── industries.py                    # Industry-specific ROI configs (28KB)
├── department_config.py             # Department settings (10KB)
├── roi_calculator.py                # Standalone ROI calculator (25KB)
├── roi_calculator_flask.py          # Flask-integrated ROI calc (200KB)
├── engineering_validator.py         # Engineering-specific validation (11KB)
├── prompts.py                       # Prompt templates (4.5KB)
│
└── dump-railway-202512301711.sql    # 57KB - Latest database backup
```

---

## 🗄️ DATABASE STRUCTURE

### PostgreSQL Schema (Active Tables)

**1. `sectors`** - Industry verticals
```sql
CREATE TABLE sectors (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    icon_svg TEXT,
    demo_headline TEXT,
    demo_subheadline TEXT,
    demo_title TEXT,
    demo_description TEXT,
    default_department VARCHAR(100),
    active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0
);

-- Current sectors:
-- - professional-services (Finance)
-- - built-environment (Engineering, Transmittal)
```

**2. `document_types`** - Document extraction configurations
```sql
CREATE TABLE document_types (
    id SERIAL PRIMARY KEY,
    sector_id INTEGER REFERENCES sectors(id),
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    sample_file_paths TEXT[],              -- Array of sample PDF paths
    extraction_fields JSONB,               -- Field definitions for extraction
    demo_enabled BOOLEAN DEFAULT false,
    validation_rules JSONB
);

-- Current document types:
-- - vendor-invoice (Finance)
-- - beam-schedule (Engineering)
-- - column-schedule (Engineering)
-- - drawing-register (Transmittal)
```

**3. `prompt_templates`** - AI extraction prompts (CURRENTLY DISABLED)
```sql
CREATE TABLE prompt_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) UNIQUE NOT NULL,
    scope VARCHAR(100),                    -- e.g., 'engineering', 'finance'
    prompt_text TEXT NOT NULL,
    is_active BOOLEAN DEFAULT false,       -- ⚠️ ALL SET TO FALSE (using code-based prompts)
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

**4. Additional Tables:**
- `extraction_logs` - Tracks all document processing
- `action_logs` - Application event logging
- `sessions` - User session storage (if used)

### Database State: CRITICAL INFORMATION

**✅ Current State (Verified):**
- Database dump: `dump-railway-202512301711.sql` (December 30, 2025)
- Status: Active and populated with all sectors/document types
- Prompt templates: **ALL DISABLED** (`is_active = false`)
- Connection: Stable (verified via Railway)

**⚠️ Prompt System Configuration:**
```
Database prompts: DISABLED (is_active = false)
Active prompts:   CODE-BASED (gemini_service.py lines 124-3015)
Prompt size:      ~40,000 characters (vs 1,733 in database)
Reason:           Code-based prompts have superior extraction logic
```

**How to Verify Database State:**
```bash
# Via Railway CLI or psql
SELECT name, scope, is_active, LENGTH(prompt_text) as chars 
FROM prompt_templates 
ORDER BY name;

# Expected result: All rows show is_active = false
```

---

## 🤖 AI EXTRACTION SYSTEM

### Gemini API Configuration

**Model:** Google Gemini 2.5 Flash  
**API Access:** Gemini Pro subscription with $ limits (not enforced in code)  
**Rate Limiting:** None configured in application (relies on Google's limits)  
**Prompt System:** Dual-layer (database + code-based)

### Prompt System Architecture

**Priority Flow:**
```
1. Try database prompts (if is_active = true)
   ↓ (Currently skipped - all disabled)
2. Fall back to code-based prompts (ACTIVE)
   ↓
3. Use hardcoded 40K+ character prompts in gemini_service.py
```

**Code Location:** `services/gemini_service.py`
- Lines 110-122: Prompt loading logic
- Lines 124-3015: Full extraction prompts with:
  - Universal extraction principles
  - OCR error correction (I vs 1, O vs 0)
  - Strikethrough text handling
  - Handwritten annotation detection
  - Character soup detection
  - Multi-part comment extraction
  - Partial extraction rules
  - Cross-field validation

### Extraction Accuracy by Department

**Finance (Vendor Invoices):**
- Accuracy: 95%+
- Fields: Vendor name, invoice number, date, amount, line items
- Time: ~30 seconds per invoice

**Engineering (Beam/Column Schedules):**
- Accuracy: 93% overall
  - Clean PDFs: 100%
  - Scanned documents: 86%
- Fields: Member mark, size, grade, length, quantity, comments
- Time: ~30-60 seconds per schedule
- Special handling: Handwritten notes, strikethrough text

**Transmittal/Drafting (Drawing Registers):**
- Accuracy: 95%+
- Fields: Drawing number, revision, title, date, status
- Time: ~20 seconds per register
- Source: Title block extraction from PDFs

---

## 🔧 CRITICAL FIXES & KNOWN ISSUES

### ✅ RESOLVED ISSUES

**1. Encoding Corruption (FIXED)**
- **Problem:** Corrupt Unicode characters in database results (e.g., "â€œ" instead of quotes)
- **Solution:** `utils/encoding_fix.py` with sanitization middleware
- **Implementation:** 
  - Jinja2 filter: `{{ value|sanitize }}`
  - Response middleware (optional, currently disabled)
- **Status:** ✅ Fixed and tested

**2. Database Connection Crashes (FIXED)**
- **Problem:** Application crash on database connection failures
- **Solution:** Graceful error handling in `database.py`
- **Status:** ✅ Fixed

**3. Prompt System Confusion (RESOLVED)**
- **Problem:** Database prompts (1,733 chars) were simplified vs code-based (40K+ chars)
- **Decision:** Disabled all database prompts → use code-based only
- **Impact:** Maintains 93% accuracy (vs potential 60% drop with database prompts)
- **Status:** ✅ Resolved - all database prompts set to `is_active = false`

### ⚠️ CURRENT PRIORITIES

**1. CODE MODULARIZATION (In Progress)**
- **Issue:** Some files are very large:
  - `gemini_service.py`: 152KB (3,287 lines)
  - `roi_calculator_flask.py`: 200KB
  - `main.py`: 79KB (1,627 lines)
- **Goal:** Break into smaller, manageable modules
- **Status:** Partial progress (routes/services separation done)

**2. File Upload Disabled in UI**
- **Status:** Currently disabled in production
- **Reason:** Not specified (security? testing?)
- **Location:** Check UI JavaScript for upload button hiding
- **Impact:** Users cannot upload custom PDFs (only demo samples work)

### 🔴 NO CURRENT BUGS

All major issues resolved. Application is stable in production.

---

## 🎨 FRONTEND & USER INTERFACE

### Technology Stack

- **Framework:** Vanilla JavaScript (no React/Vue)
- **Templating:** Jinja2 (Flask)
- **Styling:** Custom CSS (266KB)
- **Design System:**
  - Primary: Navy #0F172A
  - Accent: Gold #D4AF37
  - Responsive design (mobile-first)

### Active Features (Public Access)

**1. Document Automation** ✅
- **URL:** `/automater` (or sector-specific routes)
- **Functionality:** PDF upload → AI extraction → structured data
- **Status:** WORKING (file upload disabled in UI, but backend functional)
- **Departments:** Finance, Engineering, Transmittal

**2. ROI Calculator** ✅
- **URL:** `/roi-calculator` (likely)
- **Functionality:** Calculate automation ROI for different industries
- **Components:**
  - `roi_calculator_flask.py` (200KB)
  - `calculations.py` (16KB)
  - `industries.py` (28KB - industry configs)
  - `department_config.py` (10KB)
- **Status:** WORKING

**3. RAG Search Demo** ✅
- **URL:** `/search` or similar
- **Functionality:** Search through static HTML documentation
- **Components:**
  - `rag_service.py` (20KB)
  - `rag-search-demo.js` (28KB)
  - `search_progressive_ux.js` (16KB)
- **Status:** WORKING

**4. Static Marketing Pages** ✅
- **Routes:** 50+ routes in `routes/static_pages.py`
- **Examples:** Homepage, About, Features, Pricing, Industries
- **Status:** WORKING

### Sample Files Location

**Location:** `/assets/samples/` (organized by department)

```
/assets/samples/
├── finance/
│   └── sample-invoice.pdf
├── engineering/
│   ├── sample-beam-schedule.pdf
│   └── sample-column-schedule.pdf
└── transmittal/
    └── sample-drawing-register.pdf
```

**Usage:** Demo samples are loaded from these paths for testing/demos

---

## 🔐 SECURITY & AUTHENTICATION

### Current Security Status: ⚠️ MINIMAL

**Authentication:** NONE  
**Authorization:** NONE  
**Public Access:** ALL FEATURES  

**Security Measures (Current):**
- Flask SECRET_KEY (session encryption)
- HTTPS via Railway (automatic)
- Environment variable protection (Gemini API key not exposed)

**Security Gaps:**
- No user accounts/login
- No API authentication
- No rate limiting (except Google's)
- No file upload validation (upload disabled in UI anyway)
- No CSRF protection
- No input sanitization (beyond encoding fixes)

**Recommendations for Future:**
1. Add authentication (OAuth, JWT, or simple login)
2. Implement API key system for external integrations
3. Add rate limiting (Flask-Limiter)
4. Add file upload validation (size, type, content scanning)
5. Implement CSRF tokens for forms
6. Add input sanitization/validation

---

## 📊 MONITORING & LOGGING

### Current Monitoring: BASIC

**1. Railway Logs**
- **Access:** Railway dashboard → Deployments → Logs
- **Contains:** Application stdout/stderr, errors, HTTP requests
- **Retention:** Limited by Railway plan

**2. Database Logging**
- **Tables:** `action_logs`, `extraction_logs`
- **Usage:** Tracks document processing, errors, user actions
- **Code:** Implemented in `database.py` and service layers

**3. Application Logging**
- **Method:** Python `print()` statements (goes to Railway logs)
- **Level:** DEBUG information in development
- **Production:** Console output only

### No Real-Time Monitoring

**Current State:**
- No automated alerts
- No error tracking service (Sentry, Rollbar, etc.)
- No uptime monitoring
- No performance metrics

**How Issues are Detected:**
- User reports
- Manual testing
- Checking Railway logs periodically

**Recommendations for Future:**
1. Add Sentry for error tracking
2. Add uptime monitoring (UptimeRobot, Pingdom)
3. Add performance monitoring (New Relic, DataDog)
4. Set up automated alerts (email/SMS on errors)
5. Create health check endpoint (`/health`)

---

## 🧪 TESTING & DEPLOYMENT

### Current Testing Approach: MANUAL

**No Automated Tests:**
- No unit tests
- No integration tests
- No end-to-end tests
- No CI/CD pipeline

**Manual Testing Process:**
1. Local development with sample PDFs
2. Visual inspection of results
3. Accuracy spot-checks
4. Deploy to Railway → test in production

### Deployment Workflow

**Method:** Git Push → Railway Auto-Deploy

```bash
# Standard deployment
git add .
git commit -m "Description of changes"
git push origin main

# Railway automatically:
# 1. Detects push
# 2. Builds Docker container
# 3. Runs deployment
# 4. Switches to new version (zero-downtime)
```

**Rollback Process:**
- Railway dashboard → Deployments → Redeploy previous version
- OR: `git revert` + push

**Deployment Time:** ~2-5 minutes (typical)

### Test Sample PDFs

**Location:** `/assets/samples/` (see structure above)

**Testing Checklist:**
1. Upload each department's sample PDF
2. Verify extraction accuracy (visual check)
3. Check for encoding errors (corrupt characters)
4. Verify database connection (logs or debug endpoint)
5. Test ROI calculator with sample inputs
6. Check static pages load correctly

---

## 💡 CRITICAL GOTCHAS & LANDMINES

### 🚨 TOP 3 THINGS THAT WILL BREAK THE SYSTEM

**1. ENABLING DATABASE PROMPTS**
```sql
-- ⚠️ NEVER DO THIS (unless prompts are updated):
UPDATE prompt_templates SET is_active = true;

-- Why: Database prompts are simplified (1,733 chars)
-- Impact: Accuracy drops from 93% to ~60%
-- Fix: Keep is_active = false (use code-based prompts)
```

**2. CHANGING GEMINI API KEY WITHOUT TESTING**
```bash
# If you change GEMINI_API_KEY in Railway:
# 1. Test immediately with sample PDF
# 2. Check logs for API errors
# 3. Verify quota/billing is active

# Common issue: New API key without billing → 429 errors
```

**3. MODIFYING EXTRACTION FIELDS WITHOUT DATABASE UPDATE**
```python
# If you change fields in config.py:
FINANCE_FIELDS = ['vendor', 'invoice_number', ...]  # Old
FINANCE_FIELDS = ['vendor', 'invoice_num', ...]     # New (renamed)

# You MUST also update:
# 1. database.py (field mappings)
# 2. gemini_service.py (prompt expectations)
# 3. HTML templates (field display)
# 4. JavaScript (field handling)

# Otherwise: Mismatched field names → missing data
```

### ⚠️ OTHER CRITICAL GOTCHAS

**4. Python Version Mismatch**
- Requires Python 3.11+ (uses new type hints, match/case)
- Railway auto-detects from `runtime.txt` or `requirements.txt`
- Verify: Check Railway build logs for Python version

**5. Database Connection String**
- Railway manages `DATABASE_URL` automatically
- Format: `postgresql://user:pass@host:port/db`
- If connection fails: Check Railway dashboard for database status

**6. File Paths in Production**
- Local: `/Users/you/project/assets/samples/...`
- Railway: `/app/assets/samples/...`
- Always use relative paths or `os.path.join()`

**7. Environment Variable Case Sensitivity**
- Railway: Case-sensitive
- `GEMINI_API_KEY` ≠ `gemini_api_key`
- Always use UPPERCASE for env vars

**8. Large File Uploads (Currently Disabled)**
- Default Flask limit: 16MB
- Gemini API limit: Varies by model
- Currently disabled in UI, so not an issue

---

## 🔄 DEPENDENCY MANAGEMENT

### Python Dependencies (requirements.txt)

**Critical Packages:**
```txt
Flask==3.0.0                    # Web framework
google-generativeai==0.3.2      # Gemini API
pdfplumber==0.10.3              # PDF text extraction
pandas==2.1.3                   # Data manipulation
SQLAlchemy==2.0.23              # Database ORM
psycopg2-binary==2.9.9          # PostgreSQL driver
gunicorn==21.2.0                # Production WSGI server
```

**Version Pinning Status:**
- ✅ All major packages are pinned
- ⚠️ Some dependencies use `>=` (could cause issues)

**How to Update Dependencies:**
```bash
# 1. Update requirements.txt
# 2. Test locally first:
pip install -r requirements.txt
python main.py  # Run local server

# 3. Test with sample PDFs
# 4. If OK, commit and push:
git add requirements.txt
git commit -m "Update dependencies"
git push
```

**⚠️ CRITICAL: Test Gemini API After Updates**
- Google SDK updates can break compatibility
- Always test extraction after updating `google-generativeai`

---

## 📈 ROI CALCULATOR SPECIFICS

### Status: ✅ FULLY FUNCTIONAL

**Components:**
1. `roi_calculator_flask.py` (200KB) - Flask integration
2. `calculations.py` (16KB) - Core calculation logic
3. `industries.py` (28KB) - Industry-specific configurations
4. `department_config.py` (10KB) - Department settings

### Calculation Logic

**Formula Overview:**
```python
# 1. Calculate annual waste
weekly_waste = hours_per_week
annual_burn = weekly_waste * avg_hourly_rate * 48_weeks

# 2. Apply pain score multiplier
pain_multipliers = {0: 0.85, 3: 0.90, 5: 1.00, 
                    6: 1.05, 7: 1.15, 8: 1.25, 10: 1.35}
multiplier = pain_multipliers[pain_score]

# 3. Calculate automation potential (capped at 70%)
automation_potential = min(base_automation * multiplier, 0.70)

# 4. Tier 1: Direct cost savings
tier_1_savings = annual_burn * automation_potential
tier_1_hours = capacity_hours * automation_potential

# 5. Tier 2: Revenue opportunity (60% conversion)
tier_2_revenue = tier_1_hours * avg_rate * 0.60

# 6. Total ROI
total_roi = tier_1_savings + tier_2_revenue
```

### Industry Configurations (industries.py)

**Available Industries:**
- Architecture & Design
- Engineering Consultancies
- Construction Companies
- Legal Services
- Accounting Firms
- Property Development
- Government & Infrastructure
- Healthcare
- Education
- (28KB of configuration data)

**Configuration Structure:**
```python
{
    'industry_name': {
        'base_automation_potential': 0.45,  # 45% baseline
        'avg_hourly_rate': 180,              # Industry average
        'confidence_adjustment': 1.0         # Multiplier
    }
}
```

### Known Issues: NONE

ROI calculator is stable and tested.

---

## 🎯 QUICK TROUBLESHOOTING GUIDE

### Problem: Application Won't Start

**Check:**
1. Railway logs for errors
2. Database connection (`DATABASE_URL` set?)
3. Gemini API key (`GEMINI_API_KEY` set?)
4. Python version (3.11+ required)

**Fix:**
```bash
# Verify environment variables in Railway dashboard
# Check build logs for missing dependencies
# Redeploy if needed
```

### Problem: Extraction Returns Empty/Wrong Data

**Check:**
1. Which prompts are active? (Database vs code-based)
2. Gemini API quota/billing status
3. PDF text extraction quality (scanned vs digital)

**Fix:**
```bash
# 1. Verify prompt system:
SELECT is_active FROM prompt_templates;
# Should all be FALSE

# 2. Test Gemini API directly:
# Check Google Cloud Console for errors

# 3. Test PDF extraction:
# Upload clean digital PDF (not scanned)
```

### Problem: Database Connection Errors

**Check:**
1. `DATABASE_URL` environment variable
2. Railway database status
3. Network connectivity

**Fix:**
```bash
# 1. Verify in Railway dashboard:
#    Database → Connection Details

# 2. Test connection:
#    Use /debug/db-test endpoint (if enabled)

# 3. Restart database if needed:
#    Railway dashboard → Database → Restart
```

### Problem: Encoding Corruption (Corrupt Characters)

**Should be FIXED, but if it happens:**

**Check:**
1. `utils/encoding_fix.py` is imported
2. Jinja2 filter is registered
3. Middleware is enabled (if needed)

**Fix:**
```python
# In main.py, verify:
from utils.encoding_fix import create_safe_template_filter
app.jinja_env.filters['sanitize'] = create_safe_template_filter()

# In templates, use:
{{ value|sanitize }}
```

### Problem: Poor Extraction Accuracy

**Check:**
1. Document quality (scanned vs digital)
2. Prompt system (database vs code-based)
3. Gemini model version

**Expected Accuracy:**
- Digital PDFs: 95%+
- Clean scans: 90%+
- Poor scans: 85%+

**If below these thresholds:**
1. Check prompt templates are DISABLED
2. Verify code-based prompts are active
3. Test with different PDF samples

---

## 📝 NEXT STEPS FOR NEW DEVELOPER

### Immediate Actions (First 30 Minutes)

1. **Verify Production Access**
   - Visit https://curam-ai.com.au
   - Check all pages load correctly
   - Test demo samples (if upload enabled)

2. **Access Railway Dashboard**
   - Get credentials from admin
   - Review deployment history
   - Check environment variables

3. **Clone Repository**
   ```bash
   git clone <repository-url>
   cd curam-ai
   ```

4. **Set Up Local Environment**
   ```bash
   python -m venv venv
   source venv/bin/activate  # or venv\Scripts\activate on Windows
   pip install -r requirements.txt
   ```

5. **Set Local Environment Variables**
   ```bash
   # Create .env file (DO NOT COMMIT)
   DATABASE_URL=postgresql://...
   GEMINI_API_KEY=...
   SECRET_KEY=...
   ```

6. **Test Locally**
   ```bash
   python main.py
   # Visit http://localhost:5000
   ```

### First Week Priorities

**Week 1: Understanding**
1. Read all documentation in project root
2. Review `gemini_service.py` (extraction logic)
3. Test each department with sample PDFs
4. Understand database schema
5. Map out all routes (`routes/static_pages.py`)

**Week 2: Code Modularization**
1. Identify large files to break down
2. Extract reusable functions
3. Create additional service modules
4. Add type hints (if missing)
5. Document complex functions

**Week 3: Testing**
1. Write unit tests for calculations
2. Add integration tests for extraction
3. Create test fixtures (sample PDFs)
4. Set up CI/CD pipeline (GitHub Actions)
5. Add code coverage reporting

**Week 4: Security & Monitoring**
1. Add authentication (if needed)
2. Implement rate limiting
3. Set up error tracking (Sentry)
4. Add uptime monitoring
5. Create health check endpoint

---

## 🔗 RELATED DOCUMENTATION

**In Project Root:**
- `1_CURRENT_SYSTEM_OVERVIEW.md` - System overview
- `1_PROJECT_OVERVIEW.md` - Project goals and scope
- `2_ARCHITECTURE_REFERENCE.md` - Detailed architecture
- `2_TECHNICAL_DEEP_DIVE.md` - Technical details
- `3_DEPLOYMENT_GUIDE.md` - Deployment instructions
- `3_DEPLOYMENT_REFERENCE.md` - Deployment reference
- `PROMPT_SYSTEM_DOCS.md` - Prompt system documentation
- `DATABASE_CONNECTION_STATUS.md` - Database status
- `PHASES_COMPLETE_SUMMARY.md` - Completed phases
- `ENCODING_INTEGRATION_SUMMARY.md` - Encoding fix details

**External Resources:**
- Google Gemini API Docs: https://ai.google.dev/docs
- Flask Documentation: https://flask.palletsprojects.com/
- Railway Docs: https://docs.railway.app/
- PostgreSQL Docs: https://www.postgresql.org/docs/

---

## 🎓 KEY CONCEPTS TO UNDERSTAND

### 1. Dual-Prompt System

**Why it exists:**
- Flexibility: Database prompts can be updated without deployment
- Fallback: Code-based prompts ensure system always works
- Version control: Code-based prompts tracked in Git

**Current state:**
- Database prompts: DISABLED (simplified, lower accuracy)
- Code-based prompts: ACTIVE (40K+ chars, 93% accuracy)

### 2. Department → Sector Mapping

**Legacy Structure:**
```python
departments = ['finance', 'engineering', 'transmittal']
```

**New Structure:**
```python
sectors = {
    'professional-services': ['finance'],
    'built-environment': ['engineering', 'transmittal']
}
```

**Mapping Logic:** `database.py` lines 48-76

### 3. Extraction Field Definitions

**Each document type has:**
- `extraction_fields` (JSONB in database)
- Field definitions in `config.py` (FINANCE_FIELDS, etc.)
- Prompt expectations in `gemini_service.py`
- HTML templates for display

**⚠️ All must stay in sync!**

### 4. PDF Processing Pipeline

```
1. Upload PDF → temp storage
   ↓
2. pdfplumber → extract text
   ↓
3. Preprocessing → clean text, fix encoding
   ↓
4. Gemini API → extract structured data
   ↓
5. Validation → check fields, fix OCR errors
   ↓
6. Format output → HTML/JSON/CSV
   ↓
7. Display to user
```

### 5. ROI Calculation Methodology

**Two-tier approach:**
- Tier 1: Direct cost savings (time saved × hourly rate)
- Tier 2: Revenue opportunity (freed capacity × billable rate × conversion)

**Pain score multiplier:**
- Higher pain = higher automation potential
- Capped at 70% (realistic constraint)

---

## ✅ HANDOFF CHECKLIST

Before another developer/AI takes over, ensure they have:

- [ ] Railway dashboard access
- [ ] Database credentials
- [ ] Gemini API key details
- [ ] Git repository access
- [ ] This handoff document
- [ ] All related documentation
- [ ] Sample PDFs for testing
- [ ] Understanding of prompt system
- [ ] Knowledge of deployment workflow
- [ ] Awareness of critical gotchas

---

## 📞 SUPPORT & ESCALATION

### When Things Break

**Level 1: Check Logs**
- Railway dashboard → Logs
- Database logs (`action_logs` table)
- Browser console (for frontend issues)

**Level 2: Check Environment**
- Verify all environment variables set
- Check database connection
- Test Gemini API directly

**Level 3: Rollback**
- Railway dashboard → Redeploy previous version
- OR: `git revert` + push

**Level 4: Manual Investigation**
- SSH into Railway container (if available)
- Check file system
- Inspect database directly
- Review recent commits

### Emergency Contacts

*[Add contact information for system owner/admin]*

---

## 📊 METRICS & SUCCESS CRITERIA

### System Health Indicators

**✅ Healthy:**
- Extraction accuracy: 90%+
- Response time: <2 seconds
- Error rate: <1%
- Database connection: Stable
- All features functional

**⚠️ Warning:**
- Extraction accuracy: 80-90%
- Response time: 2-5 seconds
- Error rate: 1-5%
- Occasional database timeouts
- Some features intermittent

**🚨 Critical:**
- Extraction accuracy: <80%
- Response time: >5 seconds
- Error rate: >5%
- Database connection failing
- Features down

### Performance Benchmarks

**Extraction Speed (Target):**
- Finance: 20-30 seconds
- Engineering: 30-60 seconds
- Transmittal: 15-20 seconds

**Accuracy Targets:**
- Finance: 95%+
- Engineering: 93%+
- Transmittal: 95%+

**Uptime Target:** 99.5%+ (monitored manually)

---

## 🎉 CONCLUSION

This document contains everything needed to take over the Curam-AI Protocol system. Key takeaways:

1. **System is stable** - All major issues resolved
2. **Code-based prompts are active** - 93% accuracy maintained
3. **Database is populated** - All sectors/document types configured
4. **Deployment is automatic** - Git push → Railway auto-deploy
5. **Security is minimal** - Public access to all features
6. **Monitoring is basic** - Railway logs + database logging
7. **Priority: Code modularization** - Large files need refactoring

**The system works well in production.** Focus should be on:
- Breaking down large files
- Adding tests
- Improving security
- Enhancing monitoring

Good luck! 🚀

---

**Document Version:** 1.0  
**Last Updated:** January 3, 2026  
**Next Review:** After major changes or monthly
