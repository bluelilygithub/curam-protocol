# Curam-Ai Protocol: How to Use Overview

**Last Updated:** January 2025  
**Purpose:** Quick start guide, common tasks, and troubleshooting

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
# In industries.py
INDUSTRIES = {
    'new-industry': {
        'name': 'New Industry Name',
        'base_automation_potential': 0.45,  # 45% baseline
        'avg_hourly_rate': 180,
        'confidence_adjustment': 1.0,
        'default_staff_count': 50,
        'default_hours_per_week': 10
    }
}
```

**Step 2: Add to UI**
- Update industry selection page
- Add to results display
- Update PDF report template

**Step 3: Test**
- Run ROI calculator with new industry
- Verify calculations are correct
- Check PDF report generation

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

**For Poor Quality Scans:**
- Verify `services/image_preprocessing.py` is working
- Check logs for "📊 Image quality: POOR"
- Look for "✓ Applied X auto-correction(s)" in logs

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

### Encoding Corruption (Corrupt Characters)

**Should be FIXED, but if it happens:**

**Check:**
1. `utils/encoding_fix.py` is imported
2. Jinja2 filter is registered:
   ```python
   from utils.encoding_fix import create_safe_template_filter
   app.jinja_env.filters['sanitize'] = create_safe_template_filter()
   ```
3. Templates use: `{{ value|sanitize }}`

**Fix:**
- Verify encoding fix is applied at every layer
- Check PDF extraction sanitization
- Check AI response sanitization
- Hard refresh browser (Ctrl+F5)

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

---

## Testing

### Manual Testing Process

**1. Test PDF Extraction**
```bash
# Navigate to /automater
# Select department
# Upload sample PDF
# Verify extraction results
```

**2. Test ROI Calculator**
```bash
# Navigate to /roi-calculator
# Select industry
# Enter sample data
# Verify calculations
# Download PDF report
```

**3. Test Database Connection**
```bash
# Check Railway logs for:
✓ Connected! Sectors: X

# Or test locally:
python -c "from database import get_db_connection; print('Connected!' if get_db_connection() else 'Failed')"
```

### Sample Files for Testing

**Location:** `/assets/samples/`

**Finance Samples:**
- `invoices/sample-invoice.pdf`
- Test: Vendor, invoice #, date, amount extraction

**Engineering Samples:**
- `drawings/sample-beam-schedule.pdf`
- `drawings/sample-column-schedule.pdf`
- Test: Mark, size, grade, quantity extraction

**Transmittal Samples:**
- `transmittals/sample-drawing-register.pdf`
- Test: Drawing #, revision, title, status extraction

---

## Deployment

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

### Pre-Deployment Checklist

- [ ] Test locally with sample PDFs
- [ ] Verify accuracy (90%+)
- [ ] Check for console errors
- [ ] Review logs for warnings
- [ ] Test all departments
- [ ] Verify ROI calculator works
- [ ] Check environment variables set correctly

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

---

## Quick Reference Commands

### Local Development
```bash
python main.py                   # Run Flask app
pip install -r requirements.txt  # Install dependencies
python -m pytest                 # Run tests (if added)
```

### Railway CLI
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

### Database Queries
```sql
-- Check prompt status
SELECT name, is_active FROM prompt_templates;

-- Check sectors
SELECT slug, name FROM sectors WHERE active = true;

-- Check document types
SELECT slug, name, demo_enabled FROM document_types;

-- View recent extractions
SELECT * FROM extraction_logs ORDER BY created_at DESC LIMIT 10;
```

---

## Support Resources

**Internal Documentation:**
- `TECHNICAL_OVERVIEW.md` - How the system works technically
- `INFRASTRUCTURE_OVERVIEW.md` - Deployment and infrastructure

**External Resources:**
- Google Gemini API Docs: https://ai.google.dev/docs
- Flask Documentation: https://flask.palletsprojects.com/
- Railway Docs: https://docs.railway.app/
- PostgreSQL Docs: https://www.postgresql.org/docs/

---

## Emergency Procedures

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
- Review recent commits
- Check file system
- Inspect database directly
- SSH into Railway container (if available)

---

**Document Version:** 1.0  
**Last Updated:** January 2025
