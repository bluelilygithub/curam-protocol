# Curam-AI Protocol: Deployment Guide

**For:** Setting up production on Railway  
**Time:** ~30 minutes  
**Prerequisites:** GitHub repo, Railway account, Gemini API key

---

## Quick Start (Railway)

### 1. Prepare Your Repository

**Required files in repo root:**

```
your-repo/
├── main.py                  # Flask app
├── requirements.txt         # Dependencies
├── Procfile                 # Railway config
├── runtime.txt             # Python version (optional)
├── services/               # Business logic
├── templates/              # HTML templates
├── assets/                 # Static files
└── .gitignore
```

**Procfile** (create this):
```
web: gunicorn main:app --bind 0.0.0.0:$PORT --workers 4 --timeout 120
```

**requirements.txt** (minimum):
```
Flask==3.0.0
gunicorn==21.2.0
google-generativeai==0.3.2
pdfplumber==0.10.3
pandas==2.1.4
requests==2.31.0
python-dotenv==1.0.0
sqlalchemy==2.0.23
psycopg2-binary==2.9.9
```

**.gitignore**:
```
__pycache__/
*.pyc
.env
*.log
venv/
.DS_Store
```

---

### 2. Railway Setup (Web UI Method)

**Step 1: Create Project**
1. Go to https://railway.app
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Authorize GitHub, select your repository
5. Railway auto-detects Python and starts building

**Step 2: Add PostgreSQL**
1. In project dashboard, click "+ New"
2. Select "Database" → "PostgreSQL"
3. Railway provisions database automatically
4. `DATABASE_URL` environment variable is auto-created

**Step 3: Set Environment Variables**
1. Click on your web service
2. Go to "Variables" tab
3. Add these:

```
GEMINI_API_KEY=your-gemini-api-key-here
SECRET_KEY=generate-random-32-chars
```

**Generate SECRET_KEY:**
```python
import secrets
print(secrets.token_hex(32))
```

**Step 4: Deploy**
1. Railway automatically deploys on git push
2. Or click "Deploy" in dashboard
3. Wait ~3-5 minutes for build
4. Check logs for errors

**Step 5: Get Your URL**
1. Click "Settings" → "Networking"
2. Click "Generate Domain"
3. Your app is live at `your-app.up.railway.app`

---

### 3. Railway CLI Method (Alternative)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to project (in your repo directory)
railway link

# Set variables
railway variables set GEMINI_API_KEY=your-key-here
railway variables set SECRET_KEY=random-32-chars

# Deploy
git push railway main

# View logs
railway logs

# Open in browser
railway open
```

---

## Database Setup

### Automatic (Recommended)

Railway PostgreSQL provisions automatically when you add the database service.

**Verify connection:**
```python
# In your Railway logs, look for:
✓ Connected! Sectors: X
```

### Manual Schema (If Needed)

If tables don't exist, run this SQL in Railway dashboard:

```sql
-- Sectors table
CREATE TABLE sectors (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    icon_svg TEXT
);

-- Document types table
CREATE TABLE document_types (
    id SERIAL PRIMARY KEY,
    sector_id INTEGER REFERENCES sectors(id),
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    sample_file_paths JSONB,
    demo_enabled BOOLEAN DEFAULT true
);

-- Prompt templates (keep disabled)
CREATE TABLE prompt_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    scope VARCHAR(50),
    doc_type VARCHAR(100),
    prompt_text TEXT,
    is_active BOOLEAN DEFAULT false,
    priority INTEGER DEFAULT 100
);

-- Insert sample data
INSERT INTO sectors (slug, name) VALUES
('professional-services', 'Accounting & Professional Services'),
('built-environment', 'Engineering & Construction');

INSERT INTO document_types (sector_id, slug, name, sample_file_paths, demo_enabled) VALUES
(1, 'vendor-invoice', 'Vendor Invoices', 
 '["invoices/Bne.pdf", "invoices/CloudRender.pdf"]'::jsonb, true),
(2, 'beam-schedule', 'Structural Schedules',
 '["drawings/schedule_cad.pdf", "drawings/schedule_revit.pdf"]'::jsonb, true);
```

---

## Environment Variables Reference

### Required

| Variable | Example | Purpose |
|----------|---------|---------|
| `GEMINI_API_KEY` | `AIza...` | Google Gemini API access |
| `SECRET_KEY` | `abc123...` (32+ chars) | Flask session encryption |
| `DATABASE_URL` | `postgresql://...` | Auto-set by Railway |

### Optional

| Variable | Default | Purpose |
|----------|---------|---------|
| `FLASK_ENV` | `production` | Environment mode |
| `DEBUG` | `False` | Debug mode (keep False in prod) |
| `PORT` | `5000` | Auto-set by Railway |

---

## Post-Deployment Checklist

### Verify Everything Works

**1. Homepage loads** ✅
```
Visit: https://your-app.up.railway.app
Should see: Marketing homepage
```

**2. ROI Calculator works** ✅
```
Visit: /roi-calculator/
Select industry → Enter data → See results → Download PDF
```

**3. Automater works** ✅
```
Visit: /automater
Select Engineering Dept → Check all samples → Generate Output
Expected: 93%+ accuracy (25/27 rows correct)
```

**4. Database connected** ✅
```
Check logs for: "✓ Connected! Sectors: X"
No errors about missing DATABASE_URL
```

**5. Prompts active** ✅
```
Check logs for: "⚠ Using hardcoded fallback for engineering"
NOT: "✓ Using database prompt"
```

---

## Monitoring & Logs

### View Logs

**Railway Dashboard:**
1. Click your project
2. Click "Deployments"
3. Select latest deployment
4. Click "View Logs"

**Railway CLI:**
```bash
railway logs
```

**Live logs:**
```bash
railway logs --follow
```

### What to Monitor

**✅ Good signs:**
```
✓ Connected! Sectors: X
⚠ Using hardcoded fallback for engineering
✓ Text extracted successfully
✓ Success with gemini-2.5-flash-lite
📋 Validation: X/Y rows valid
```

**⚠️ Warning signs:**
```
⚠ Database failed: ...
⚠ All models failed
⚠ PDF extraction failed
```

**🚨 Critical errors:**
```
✓ Using database prompt  # BAD - disables elite prompts
ResourceExhausted  # API quota exceeded
500 Internal Server Error
```

---

## Troubleshooting

### Build Fails

**Error:** `No module named 'google.generativeai'`
**Fix:** Check `requirements.txt` has correct versions

**Error:** `Application failed to respond`
**Fix:** Check `Procfile` points to `main:app`

**Error:** `Port already in use`
**Fix:** Railway auto-assigns port, remove hardcoded port

---

### Database Connection Fails

**Error:** `relation "sectors" does not exist`
**Fix:** Run schema SQL in Railway PostgreSQL dashboard

**Error:** `could not connect to server`
**Fix:** Verify `DATABASE_URL` is set (Railway auto-sets this)

**Error:** `password authentication failed`
**Fix:** Don't manually set DATABASE_URL, let Railway manage it

---

### Extraction Not Working

**Issue:** All extractions return empty
**Fix:** 
1. Check `GEMINI_API_KEY` is set correctly
2. Check Railway logs for API errors
3. Verify Gemini API quota hasn't exceeded

**Issue:** Size column all "N/A"
**Fix:**
1. Check database prompts are disabled: `is_active = false`
2. Look for "⚠ Using hardcoded fallback" in logs (should see this)

**Issue:** Corrupt characters in output
**Fix:**
1. Verify `utils/encoding_fix.py` exists
2. Check sanitization is integrated
3. Hard refresh browser (Ctrl+F5)

---

## Scaling & Performance

### Current Limits (Railway)

- **Free tier:** 500 hours/month, 512MB RAM
- **Hobby tier:** $5/month, 8GB RAM, better performance
- **Pro tier:** $20/month, custom resources

### Optimize for Railway

**1. Reduce Workers (Lower Memory)**
```
# Procfile - Use 2 workers instead of 4 if running out of RAM
web: gunicorn main:app --workers 2 --timeout 120
```

**2. Add Caching**
```python
from functools import lru_cache

@lru_cache(maxsize=100)
def get_prompt_template(doc_type):
    return build_prompt(doc_type)
```

**3. Batch API Calls**
```python
# Process multiple docs in parallel
from concurrent.futures import ThreadPoolExecutor

with ThreadPoolExecutor(max_workers=3) as executor:
    results = executor.map(extract_from_file, files)
```

---

## Custom Domain (Optional)

### Add Your Domain

**Railway Dashboard:**
1. Project → Settings → Networking
2. Click "Custom Domain"
3. Enter: `app.yourdomain.com`
4. Add CNAME record in your DNS:
   ```
   CNAME app.yourdomain.com → your-app.up.railway.app
   ```
5. Wait 5-60 minutes for DNS propagation
6. Railway auto-provisions SSL certificate

---

## Backup & Rollback

### Automatic Backups

Railway automatically keeps:
- Last 10 deployments
- PostgreSQL daily snapshots (Hobby tier+)

### Rollback to Previous Version

**Railway Dashboard:**
1. Deployments tab
2. Find working deployment
3. Click "Redeploy"

**Railway CLI:**
```bash
railway status  # See deployments
railway rollback DEPLOYMENT_ID
```

---

## Security Best Practices

### ✅ Do

- Use environment variables for secrets
- Enable HTTPS (Railway auto-provisions)
- Set strong `SECRET_KEY` (32+ random chars)
- Keep dependencies updated
- Monitor logs for suspicious activity

### ❌ Don't

- Commit API keys to git
- Use `DEBUG=True` in production
- Expose database credentials
- Allow unrestricted file uploads (limit to PDF only)
- Ignore security warnings in logs

---

## Cost Estimate

### Railway Pricing

**Free Tier:**
- Good for: Testing, personal projects
- Limits: 500 execution hours/month
- Cost: $0

**Hobby Tier ($5/month):**
- Good for: Small production apps
- Limits: 8GB RAM, no credit card required upfront
- Cost: $5/month

**Pro Tier ($20+/month):**
- Good for: Production apps with traffic
- Limits: Custom resources, priority support
- Cost: Based on usage

### Gemini API Costs

**Free Tier:**
- 15 requests/minute
- 1,500 requests/day
- Good for: 100-200 documents/day

**Paid Tier:**
- $0.00025/1K chars (Gemini 2.0 Flash)
- Average document: ~5K chars = $0.00125
- 1,000 documents = ~$1.25

**Monthly estimate:**
- 1,000 docs/month = ~$1.25 Gemini + $5 Railway = **$6.25/month**

---

## Maintenance Schedule

### Daily
- ✅ Check error logs
- ✅ Monitor API quota

### Weekly
- ✅ Review extraction accuracy
- ✅ Check Railway resource usage
- ✅ Update dependencies (if security fixes)

### Monthly
- ✅ Review costs
- ✅ Check database size
- ✅ Optimize slow queries
- ✅ Update documentation

---

## Quick Reference Commands

```bash
# Railway CLI essentials
railway login                    # Authenticate
railway link                     # Link to project
railway logs                     # View logs
railway logs --follow            # Live logs
railway variables                # List env vars
railway variables set KEY=VALUE  # Set variable
railway status                   # Check deployments
railway open                     # Open in browser

# Local development
python main.py                   # Run locally
pip install -r requirements.txt  # Install deps

# Database
railway run psql                 # Connect to DB
```

---

## Support Resources

**Railway:**
- Docs: https://docs.railway.app
- Discord: https://discord.gg/railway
- Status: https://status.railway.app

**Gemini API:**
- Docs: https://ai.google.dev/docs
- Quota: https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas

**This Project:**
- `1_CURRENT_SYSTEM_OVERVIEW.md` - What it does
- `2_TECHNICAL_DEEP_DIVE.md` - How it works
- `DATABASE_QUICK_REF.md` - SQL commands

---

## Success Checklist

Before going live:

- [ ] All environment variables set
- [ ] Database connected and tables created
- [ ] Homepage loads correctly
- [ ] ROI Calculator works end-to-end
- [ ] Automater extracts with 90%+ accuracy
- [ ] Database prompts disabled (is_active = false)
- [ ] Logs show no critical errors
- [ ] Custom domain configured (optional)
- [ ] Monitoring/alerting set up
- [ ] Backup strategy documented

---

**Deployment Time:** ~30 minutes  
**Complexity:** Low (Railway handles most infrastructure)  
**Cost:** ~$6/month (1K docs/month)  
**Reliability:** High (Railway 99.9% uptime SLA on Pro tier)

**Ready to deploy? Start with Railway web UI method - easiest path.**
