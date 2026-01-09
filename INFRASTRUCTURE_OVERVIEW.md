# Curam-Ai Protocol: Infrastructure Overview

**Last Updated:** January 2025  
**Production URL:** https://curam-ai.com.au  
**Hosting:** Railway  
**Database:** PostgreSQL (Railway managed)

---

## Deployment Environment

### Current Production

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
├── .gitignore              # Git ignore rules
└── railway.toml            # Railway build config (if needed)
```

**Procfile:**
```
web: gunicorn main:app --bind 0.0.0.0:$PORT --workers 4 --timeout 120
```

**requirements.txt** (Critical packages):
```
Flask==3.0.0
gunicorn==21.2.0
google-generativeai==0.3.2
pdfplumber==0.10.3
pandas==2.1.4
SQLAlchemy==2.0.23
psycopg2-binary==2.9.9
python-dotenv==1.0.0
flask-compress>=1.14
Werkzeug>=3.0.0
```

---

## Environment Variables

### Required Variables

| Variable | Example | Purpose |
|----------|---------|---------|
| `GEMINI_API_KEY` | `AIza...` | Google Gemini API access |
| `SECRET_KEY` | `abc123...` (32+ chars) | Flask session encryption |
| `DATABASE_URL` | `postgresql://...` | Auto-set by Railway PostgreSQL |

### Admin Dashboard Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ADMIN_USERNAME` | `admin` | Admin dashboard username (fallback if users table not configured) |
| `ADMIN_PASSWORD` | `changeme123` | Admin dashboard password (fallback if users table not configured) |

**Note:** For production, use database-backed authentication via `users` table. Environment variables serve as fallback only.

**Generate SECRET_KEY:**
```python
import secrets
print(secrets.token_hex(32))
```

### Optional Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `FLASK_ENV` | `production` | Environment mode |
| `DEBUG` | `False` | Debug mode (keep False in prod) |
| `PORT` | `5000` | Auto-set by Railway |

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

## Database Setup

### PostgreSQL (Railway Managed)

**Automatic Provisioning:**
- Add PostgreSQL service in Railway dashboard
- `DATABASE_URL` environment variable auto-created
- No manual setup required

**Verify Connection:**
```python
# Check Railway logs for:
✓ Connected! Sectors: X
```

### Database Schema

**Core Tables:**

1. **`sectors`** - Industry verticals
```sql
CREATE TABLE sectors (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    icon_svg TEXT,
    active BOOLEAN DEFAULT true
);
```

2. **`document_types`** - Document extraction configurations
```sql
CREATE TABLE document_types (
    id SERIAL PRIMARY KEY,
    sector_id INTEGER REFERENCES sectors(id),
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    sample_file_paths TEXT[],
    extraction_fields JSONB,
    demo_enabled BOOLEAN DEFAULT false
);
```

3. **`prompt_templates`** - AI prompts (CURRENTLY DISABLED)
```sql
CREATE TABLE prompt_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) UNIQUE NOT NULL,
    scope VARCHAR(100),
    prompt_text TEXT NOT NULL,
    is_active BOOLEAN DEFAULT false  -- ⚠️ ALL SET TO FALSE
);
```

**⚠️ CRITICAL:** All `prompt_templates.is_active = false`. System uses code-based prompts in `gemini_service.py` (40K+ chars vs 1,733 in database).

4. **`users`** - Admin dashboard authentication
```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    full_name VARCHAR(200),
    is_active BOOLEAN DEFAULT true,
    is_admin BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);
```

5. **`extraction_results`** - Extraction history and analytics
```sql
CREATE TABLE extraction_results (
    id SERIAL PRIMARY KEY,
    document_type_id INTEGER,
    uploaded_file_name VARCHAR(500),
    extracted_data JSONB,
    confidence_scores JSONB,
    validation_errors JSONB,
    processing_time_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Database Access

**Via Railway CLI:**
```bash
railway run psql
```

**Via Railway Dashboard:**
1. Click PostgreSQL service
2. Click "Query" tab
3. Run SQL queries directly

---

## Deployment Process

### Method 1: Railway Web UI (Recommended)

1. **Create Project**
   - Go to https://railway.app
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Authorize GitHub, select repository

2. **Add PostgreSQL**
   - In project dashboard, click "+ New"
   - Select "Database" → "PostgreSQL"
   - Railway provisions automatically

3. **Set Environment Variables**
   - Click on web service
   - Go to "Variables" tab
   - Add `GEMINI_API_KEY` and `SECRET_KEY`

4. **Deploy**
   - Railway auto-deploys on git push
   - Or click "Deploy" in dashboard
   - Wait ~3-5 minutes for build

5. **Get URL**
   - Click "Settings" → "Networking"
   - Click "Generate Domain"
   - App live at `your-app.up.railway.app`

### Method 2: Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to project
railway link

# Set variables
railway variables set GEMINI_API_KEY=your-key
railway variables set SECRET_KEY=random-32-chars

# Deploy
git push railway main

# View logs
railway logs

# Open in browser
railway open
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

**Deployment Time:** ~2-5 minutes (typical)

---

## Monitoring & Logs

### Viewing Logs

**Railway Dashboard:**
1. Click your project
2. Click "Deployments"
3. Select latest deployment
4. Click "View Logs"

**Railway CLI:**
```bash
railway logs              # View logs
railway logs --follow     # Live logs
```

### What to Monitor

**✅ Good Signs:**
```
✓ Connected! Sectors: X
⚠ Using hardcoded fallback for engineering
✓ Text extracted successfully
✓ Success with gemini-2.5-flash-lite
📋 Validation: X/Y rows valid
```

**⚠️ Warning Signs:**
```
⚠ Database failed: ...
⚠ All models failed
⚠ PDF extraction failed
```

**🚨 Critical Errors:**
```
✓ Using database prompt  # BAD - disables elite prompts
ResourceExhausted  # API quota exceeded
500 Internal Server Error
```

### Current Monitoring Status

**Available:**
- Railway logs (stdout/stderr)
- Database logs (action_logs, extraction_results tables)
- Console output (Python print statements)
- Admin dashboard analytics (`/admin/analytics`)

**Not Currently Configured:**
- Error tracking service (Sentry, Rollbar)
- Uptime monitoring
- Performance metrics dashboards
- Automated alerts

**Recommendations:**
- Add Sentry for error tracking
- Add uptime monitoring (UptimeRobot)
- Add health check endpoint (`/health`)
- Set up automated alerts (email/SMS)

---

## Scaling & Performance

### Railway Resource Limits

**Free Tier:**
- 500 execution hours/month
- 512MB RAM
- Good for: Testing, personal projects

**Hobby Tier ($5/month):**
- 8GB RAM
- Better performance
- Good for: Small production apps

**Pro Tier ($20+/month):**
- Custom resources
- Priority support
- Good for: Production apps with traffic

### Optimization Tips

**1. Reduce Workers (Lower Memory)**
```procfile
# Use 2 workers instead of 4 if running out of RAM
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
from concurrent.futures import ThreadPoolExecutor

with ThreadPoolExecutor(max_workers=3) as executor:
    results = executor.map(extract_from_file, files)
```

### Gemini API Costs

**Free Tier:**
- 15 requests/minute
- 1,500 requests/day
- Good for: 100-200 documents/day

**Paid Tier:**
- $0.00025/1K chars (Gemini 2.0 Flash)
- Average document: ~5K chars = $0.00125
- 1,000 documents = ~$1.25

**Monthly Estimate:**
- 1,000 docs/month = ~$1.25 Gemini + $5 Railway = **$6.25/month**

---

## Custom Domain Setup

### Add Custom Domain

**Railway Dashboard:**
1. Project → Settings → Networking
2. Click "Custom Domain"
3. Enter: `app.yourdomain.com`
4. Add CNAME record in DNS:
   ```
   CNAME app.yourdomain.com → your-app.up.railway.app
   ```
5. Wait 5-60 minutes for DNS propagation
6. Railway auto-provisions SSL certificate

---

## Backup & Rollback

### Automatic Backups

**Railway Provides:**
- Last 10 deployments (automatic)
- PostgreSQL daily snapshots (Hobby tier+)

### Rollback Process

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

## Security

### Current Security Status: ⚠️ MINIMAL

**Implemented:**
- HTTPS via Railway (automatic SSL)
- Environment variable protection (API keys not exposed)
- Flask SECRET_KEY (session encryption)

**Not Implemented:**
- User authentication/authorization
- API rate limiting
- CSRF protection
- Input sanitization (beyond encoding fixes)
- File upload validation (currently disabled in UI)

**Recommendations:**
1. Add authentication (OAuth, JWT, or simple login)
2. Implement API key system for external integrations
3. Add rate limiting (Flask-Limiter)
4. Add file upload validation (size, type, content scanning)
5. Implement CSRF tokens for forms

### Security Best Practices

**✅ Do:**
- Use environment variables for secrets
- Enable HTTPS (Railway auto-provisions)
- Set strong `SECRET_KEY` (32+ random chars)
- Keep dependencies updated
- Monitor logs for suspicious activity

**❌ Don't:**
- Commit API keys to git
- Use `DEBUG=True` in production
- Expose database credentials
- Allow unrestricted file uploads
- Ignore security warnings

---

## Troubleshooting

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

**Error:** `password authentication failed`  
**Fix:** Don't manually set DATABASE_URL, let Railway manage it

### Extraction Not Working

**Issue:** All extractions return empty  
**Check:**
1. `GEMINI_API_KEY` is set correctly
2. Railway logs for API errors
3. Gemini API quota hasn't exceeded

**Issue:** Size column all "N/A"  
**Check:**
1. Database prompts are disabled: `is_active = false`
2. Look for "⚠ Using hardcoded fallback" in logs

**Issue:** Corrupt characters in output  
**Check:**
1. `utils/encoding_fix.py` exists
2. Sanitization is integrated
3. Hard refresh browser (Ctrl+F5)

---

## Maintenance

### Regular Tasks

**Daily:**
- Check error logs
- Monitor API quota

**Weekly:**
- Review extraction accuracy
- Check Railway resource usage
- Update dependencies (if security fixes)

**Monthly:**
- Review costs
- Check database size
- Optimize slow queries
- Update documentation

### Dependency Updates

**How to Update:**
```bash
# 1. Update requirements.txt
# 2. Test locally first:
pip install -r requirements.txt
python main.py

# 3. Test with sample PDFs
# 4. If OK, commit and push:
git add requirements.txt
git commit -m "Update dependencies"
git push
```

**⚠️ CRITICAL:** Test Gemini API after updates - SDK updates can break compatibility

---

## Quick Reference

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

### Local Development

```bash
python main.py                   # Run locally
pip install -r requirements.txt  # Install deps
```

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

## Success Checklist

Before going live:

- [ ] All environment variables set
- [ ] Database connected and tables created
- [ ] Homepage loads correctly
- [ ] ROI Calculator works end-to-end
- [ ] Document extraction works with 90%+ accuracy
- [ ] Database prompts disabled (`is_active = false`)
- [ ] Logs show no critical errors
- [ ] Custom domain configured (optional)
- [ ] Monitoring/alerting set up
- [ ] Backup strategy documented

---

## Support Resources

**Railway:**
- Docs: https://docs.railway.app
- Discord: https://discord.gg/railway
- Status: https://status.railway.app

**Gemini API:**
- Docs: https://ai.google.dev/docs
- Quota: https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas
