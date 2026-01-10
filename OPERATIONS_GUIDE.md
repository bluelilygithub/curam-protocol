# Curam-Ai Protocol: Operations Guide

**Last Updated:** January 2025  
**Purpose:** Quick start, deployment, daily operations, and troubleshooting

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Deployment](#deployment)
3. [Environment Variables](#environment-variables)
4. [Daily Operations](#daily-operations)
5. [Troubleshooting](#troubleshooting)
6. [Common Tasks](#common-tasks)

---

## Quick Start

### For New Developers

**1. Clone Repository**
```bash
git clone <repository-url>
cd curam-protocol
```

**2. Set Up Local Environment**
```bash
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
```

**3. Set Environment Variables**
```bash
# Create .env file (DO NOT COMMIT)
DATABASE_URL=postgresql://...
GEMINI_API_KEY=...
SECRET_KEY=...
ADMIN_USERNAME=admin  # Optional: for admin dashboard
ADMIN_PASSWORD=changeme123  # Optional: for admin dashboard
```

**4. Run Locally**
```bash
python main.py
# Visit http://localhost:5000
```

**5. Test with Sample PDFs**
- Navigate to `/automater`
- Select a department (Finance/Engineering/Transmittal)
- Use sample PDFs from `/assets/samples/`
- Verify extraction accuracy (90%+ expected)

**6. Access Admin Dashboard**
- Navigate to `http://localhost:5000/admin`
- Login with `ADMIN_USERNAME` / `ADMIN_PASSWORD` (or create user via `create_admin_user.py`)

---

## Deployment

### Production Environment

**Platform:** Railway  
**Domain:** https://curam-ai.com.au  
**Python Version:** 3.11+  
**WSGI Server:** Gunicorn  
**Process Manager:** Gunicorn with 4 workers

### Required Files

```
curam-protocol/
├── main.py                  # Flask application
├── requirements.txt         # Python dependencies
├── Procfile                 # Railway process config
├── runtime.txt             # Python version (optional)
└── railway.toml            # Railway build config (if needed)
```

**Procfile:**
```
web: gunicorn main:app --bind 0.0.0.0:$PORT --workers 4 --timeout 120
```

### Standard Deployment Workflow

```bash
# 1. Make changes locally
git add .
git commit -m "Description of changes"

# 2. Push to trigger deployment
git push origin main

# 3. Railway automatically:
#    - Detects push
#    - Builds Docker container
#    - Runs deployment
#    - Switches to new version (zero-downtime)
```

**Deployment Time:** ~2-5 minutes

### Railway CLI Commands

```bash
railway login                    # Authenticate
railway link                     # Link to project
railway logs                     # View logs
railway logs --follow            # Live logs
railway variables                # List env vars
railway variables set KEY=VALUE  # Set variable
railway status                   # Check deployments
railway open                     # Open in browser
railway run psql                 # Connect to DB
```

### Rollback

**Via Railway Dashboard:**
1. Deployments tab
2. Find working deployment
3. Click "Redeploy"

**Via Git:**
```bash
git revert HEAD
git push origin main
```

---

## Environment Variables

### Required Variables

| Variable | Example | Purpose |
|----------|---------|---------|
| `GEMINI_API_KEY` | `AIza...` | Google Gemini API access |
| `SECRET_KEY` | `abc123...` (32+ chars) | Flask session encryption |
| `DATABASE_URL` | `postgresql://...` | Auto-set by Railway PostgreSQL |

**Generate SECRET_KEY:**
```python
import secrets
print(secrets.token_hex(32))
```

### Admin Dashboard Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ADMIN_USERNAME` | `admin` | Admin dashboard username (fallback if users table not configured) |
| `ADMIN_PASSWORD` | `changeme123` | Admin dashboard password (fallback if users table not configured) |

**Note:** For production, use database-backed authentication via `users` table. Environment variables serve as fallback only.

### Optional Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `FLASK_ENV` | `production` | Environment mode |
| `DEBUG` | `False` | Debug mode (keep False in prod) |
| `PORT` | `5000` | Auto-set by Railway |
| `UPLOAD_BASE_DIR` | `uploads` | Base directory for file uploads (use `/data/uploads` for Railway volumes) |

### Setting Variables

**Railway Dashboard:**
1. Click on your web service
2. Go to "Variables" tab
3. Add variables as key=value pairs

**Railway CLI:**
```bash
railway variables set GEMINI_API_KEY=your-key-here
railway variables set SECRET_KEY=random-32-chars
```

---

## Daily Operations

### Regular Checks

**Daily:**
- Check Railway logs for errors
- Monitor Gemini API quota usage
- Verify extraction accuracy with spot checks

**Weekly:**
- Review extraction accuracy across all departments
- Check Railway resource usage
- Review error logs for patterns

**Monthly:**
- Review costs (Railway + Gemini API)
- Check database size
- Optimize slow queries if needed
- Update dependencies if security fixes available

### Monitoring

**Railway Dashboard:**
- View logs: Project → Deployments → Latest deployment → "View Logs"
- Monitor resource usage: Project → Metrics
- Check database: PostgreSQL service → Query tab

**Good Signs in Logs:**
```
✓ Connected! Sectors: X
⚠ Using hardcoded fallback for engineering
✓ Text extracted successfully
✓ Success with gemini-2.5-flash-lite
📋 Validation: X/Y rows valid
```

**Warning Signs:**
```
⚠ Database failed: ...
⚠ All models failed
⚠ PDF extraction failed
```

**Critical Errors:**
```
✓ Using database prompt  # BAD - disables elite prompts
ResourceExhausted  # API quota exceeded
500 Internal Server Error
```

---

## Troubleshooting

### Extraction Returns Empty/Wrong Data

**Check:**
1. Which prompts are active? (Database vs code-based)
2. Gemini API quota/billing status
3. PDF text extraction quality (scanned vs digital)

**Verify Prompt System:**
```sql
SELECT is_active FROM prompt_templates;
-- Should all be FALSE
```

**Check Logs:**
- Look for "⚠ Using hardcoded fallback" (GOOD - means code prompts active)
- Look for "✓ Using database prompt" (BAD - means DB prompts active)

**Fix:**
```sql
-- Disable database prompts if enabled
UPDATE prompt_templates SET is_active = false;
```

### Poor Extraction Accuracy

**Expected Accuracy:**
- Digital PDFs: 95%+
- Clean scans: 90%+
- Poor scans: 85%+

**If Below Thresholds:**
1. Check prompt templates are DISABLED (`is_active = false`)
2. Verify code-based prompts are active (check logs)
3. Test with different PDF samples
4. Check if document needs image preprocessing

### Database Connection Errors

**Check:**
1. `DATABASE_URL` environment variable set correctly
2. Railway database status (dashboard)
3. Network connectivity

**Verify Connection:**
```python
# Test connection locally
from database import get_db_connection
conn = get_db_connection()
if conn:
    print("✓ Connected!")
else:
    print("✗ Connection failed")
```

**Fix:**
- Railway dashboard → Database → Connection Details
- Restart database if needed
- Verify `DATABASE_URL` format

### Application Won't Start

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

### Performance Issues (Slow Extraction)

**Check:**
1. Which Gemini model is being used? (check logs)
2. PDF size (large PDFs take longer)
3. Number of concurrent requests

**Optimize:**
- Use faster models first (gemini-2.5-flash-lite)
- Implement caching for repeated extractions
- Add timeout handling
- Consider batch processing for multiple files

### Build Fails

**Error:** `No module named 'google.generativeai'`  
**Fix:** Check `requirements.txt` has correct versions

**Error:** `Application failed to respond`  
**Fix:** Check `Procfile` points to `main:app`

**Error:** `Port already in use`  
**Fix:** Railway auto-assigns port, remove hardcoded port

### Database Connection Fails

**Error:** `relation "sectors" does not exist`  
**Fix:** Run schema SQL in Railway PostgreSQL dashboard

**Error:** `could not connect to server`  
**Fix:** Verify `DATABASE_URL` is set (Railway auto-sets this)

---

## Common Tasks

### Adding a New Document Type

**Step 1: Update Configuration**
```python
# In models/department_config.py
DOCUMENT_SCHEMAS = {
    'new-type': {
        'fields': ['field1', 'field2', ...],
        'required': ['field1'],
        'validation_rules': {...}
    }
}
```

**Step 2: Update Prompts**
```python
# In services/gemini_service.py
def build_new_type_prompt(text):
    return f"""
    Extract [FIELD_DEFINITIONS] as JSON.
    
    ## REQUIRED FIELDS
    [Field definitions]
    
    TEXT: {text}
    """
```

**Step 3: Add Sample Files**
- Place sample PDFs in `/assets/samples/new-type/`
- Update database `document_types` table if using DB

**Step 4: Test**
- Upload sample PDF
- Verify extraction accuracy
- Check validation rules work

### Updating Extraction Prompts

**Current System:** Code-based prompts (database prompts disabled)

**Location:** `services/gemini_service.py` lines 124-3015

**To Update:**
1. Edit prompts in `gemini_service.py`
2. Test locally with sample PDFs
3. Verify accuracy (maintain 90%+)
4. Commit and push to deploy

**⚠️ WARNING:** Don't enable database prompts unless they match code-based prompt quality (40K+ chars, not 1,733).

### Adding a New Industry to ROI Calculator

**Step 1: Update Industry Config**
```python
# In roi_calculator/config/industries.py
INDUSTRIES = {
    'New Industry': {
        'context': 'Industry description',
        'industry_variance_multiplier': 0.75,  # 0.90 (high), 0.75 (medium), 0.60 (low)
        'pain_point_question': 'Question text',
        'pain_point_options': [...],
        'weekly_hours_question': 'Question text',
        'weekly_hours_range': [10, 200, 60],
        'automation_potential': 0.40,  # 40% baseline
        # ... other config
    }
}
```

**Step 2: Add to UI**
- Update industry selection page (`roi.html`)
- Add to results display (`roi_calculator_flask.py`)
- Update PDF report template

**Step 3: Test**
- Run ROI calculator with new industry
- Verify Industry Variance Multiplier is applied
- Check three scenarios (Conservative/Probable/Optimistic) display correctly

### Managing Users

**Create New Admin User:**
```bash
python create_admin_user.py
```

**Update Password:**
- Via admin dashboard: `/admin/change-password`
- Via database: Update `users.password_hash` (use Werkzeug)

---

## Critical Gotchas

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

**3. MODIFYING EXTRACTION FIELDS WITHOUT UPDATING ALL LAYERS**
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

### Other Critical Gotchas

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

---

## Performance Benchmarks

### Extraction Speed (Target)

- Finance: 20-30 seconds per invoice
- Engineering: 30-60 seconds per schedule
- Transmittal: 15-20 seconds per register

### Accuracy Targets

- Finance: 95%+
- Engineering: 93%+
- Transmittal: 95%+

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

---

## Cost Estimate

**Minimum Production Setup:**
- Railway Hobby: $5/month
- Gemini API (1K docs/month): ~$1.25/month
- **Total: ~$6.25/month**

**With Custom Domain:**
- Domain: $10-15/year
- **Total: ~$7/month**

---

## Support Resources

**Internal Documentation:**
- `TECHNICAL_GUIDE.md` - Technical architecture and implementation details
- `PHASE_1_TRIAL_GUIDE.md` - Complete Phase 1 trial management guide
- `PHASE_1_TESTS.md` - Phase 1 test explanations
- `PHASE_1_CALCULATION_METHODOLOGY.md` - ROI calculation methodology

**External Resources:**
- Google Gemini API Docs: https://ai.google.dev/docs
- Flask Documentation: https://flask.palletsprojects.com/
- Railway Docs: https://docs.railway.app/
- PostgreSQL Docs: https://www.postgresql.org/docs/

---

**Document Version:** 2.0  
**Last Updated:** January 2025
