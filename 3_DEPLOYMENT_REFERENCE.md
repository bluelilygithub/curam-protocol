# Curam-Ai Protocol: Deployment & Testing Reference

**Purpose:** Practical guide for deploying and testing similar projects  
**Audience:** DevOps, QA, Deployment engineers  
**Prerequisites:** Railway account, Git, basic Flask knowledge

---

## Production Environment (Current)

**Platform:** Railway  
**Domain:** https://curam-protocol.curam-ai.com.au  
**Python Version:** 3.11  
**Process Manager:** Gunicorn  
**Workers:** 4  
**Timeout:** 120s (for AI processing)

---

## Railway Deployment (Step-by-Step)

### 1. Initial Setup

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Create new project (or link existing)
railway init
# OR
railway link [project-id]

# Verify connection
railway status
```

### 2. Set Environment Variables

```bash
# Required variables
railway variables set GEMINI_API_KEY=your-gemini-api-key-here
railway variables set SECRET_KEY=your-random-secret-key-minimum-24-chars
railway variables set FLASK_ENV=production

# Optional variables
railway variables set DEBUG=False
railway variables set PORT=5000

# Verify variables
railway variables
```

**Generate SECRET_KEY:**
```python
import secrets
print(secrets.token_hex(32))  # Copy output to SECRET_KEY
```

### 3. Configure Deployment Files

**Procfile** (Railway deployment config):
```
web: gunicorn main:app --bind 0.0.0.0:$PORT --workers 4 --timeout 120 --access-logfile - --error-logfile -
```

**Explanation:**
- `web:` - Railway process type
- `main:app` - Points to Flask app in main.py
- `--bind 0.0.0.0:$PORT` - Bind to Railway's dynamic port
- `--workers 4` - 4 concurrent workers (adjust based on traffic)
- `--timeout 120` - 120s timeout (AI calls can be slow)
- `--access-logfile -` - Log to stdout
- `--error-logfile -` - Log errors to stdout

**runtime.txt** (Python version):
```
python-3.11.7
```

**requirements.txt** (Dependencies):
```txt
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

### 4. Deploy

```bash
# Commit changes
git add .
git commit -m "Initial deployment setup"

# Push to trigger deployment
git push origin main

# Railway automatically:
# 1. Detects Flask app
# 2. Installs requirements.txt
# 3. Runs Procfile command
# 4. Exposes on public URL
```

### 5. Monitor Deployment

```bash
# Watch real-time logs
railway logs --tail

# Check deployment status
railway status

# Open deployed app in browser
railway open
```

**Successful Deployment Logs Should Show:**
```
[INFO] Starting gunicorn 21.2.0
[INFO] Listening at: http://0.0.0.0:5000
[INFO] Using worker: sync
[INFO] Booted worker with pid: 123
✓ ROI Calculator blueprint registered successfully
✓ Static pages blueprint registered successfully
```

---

## Local Development Setup

### 1. Clone & Install

```bash
# Clone repository
git clone [repository-url]
cd curam-protocol

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On macOS/Linux:
source venv/bin/activate
# On Windows:
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
# Create .env file
touch .env

# Add variables to .env
echo "GEMINI_API_KEY=your-key-here" >> .env
echo "SECRET_KEY=dev-secret-key-at-least-24-chars" >> .env
echo "FLASK_ENV=development" >> .env
echo "DEBUG=True" >> .env
```

**Or use python-dotenv:**
```python
# Load .env automatically
from dotenv import load_dotenv
load_dotenv()
```

### 3. Run Locally

```bash
# Run Flask development server
python main.py

# Should see:
# * Running on http://127.0.0.1:5000
# * Debug mode: on

# Or use Gunicorn (production-like):
gunicorn main:app --bind 0.0.0.0:5000 --reload
```

### 4. Test Routes

```bash
# Homepage
curl http://localhost:5000/

# ROI Calculator
curl http://localhost:5000/roi-calculator/

# Automater
curl http://localhost:5000/automater

# API endpoint
curl -X POST http://localhost:5000/api/search-blog \
  -H "Content-Type: application/json" \
  -d '{"query": "automation"}'
```

---

## Database Setup

### SQLite (Current - Development)

```python
# database.py
import sqlite3

def init_db():
    conn = sqlite3.connect('automater_samples.db')
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS department_samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            department TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_label TEXT NOT NULL,
            is_active BOOLEAN DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()

# Call on startup
init_db()
```

### PostgreSQL (Recommended for Production)

**Add to Railway:**
```bash
# Add PostgreSQL plugin in Railway dashboard
railway add postgresql

# Railway automatically sets DATABASE_URL
railway variables | grep DATABASE_URL
```

**Update config.py:**
```python
import os

class ProductionConfig(Config):
    # Railway sets DATABASE_URL for PostgreSQL
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL')
    
    # Fix for SQLAlchemy 1.4+ (Railway uses postgres://, needs postgresql://)
    if SQLALCHEMY_DATABASE_URI and SQLALCHEMY_DATABASE_URI.startswith('postgres://'):
        SQLALCHEMY_DATABASE_URI = SQLALCHEMY_DATABASE_URI.replace('postgres://', 'postgresql://', 1)
    
    SQLALCHEMY_TRACK_MODIFICATIONS = False
```

**Migration:**
```bash
# Install Flask-Migrate
pip install Flask-Migrate

# Initialize migrations
flask db init
flask db migrate -m "Initial migration"
flask db upgrade

# On Railway
railway run flask db upgrade
```

---

## Testing Guide

### Manual Testing Checklist

#### Critical Routes (Test First)
```bash
# 1. Homepage loads
curl -I http://localhost:5000/
# Expected: 200 OK

# 2. Automater loads
curl -I http://localhost:5000/automater
# Expected: 200 OK

# 3. ROI Calculator loads
curl -I http://localhost:5000/roi-calculator/
# Expected: 200 OK

# 4. Industry pages load
curl -I http://localhost:5000/accounting
# Expected: 200 OK

# 5. Static assets load
curl -I http://localhost:5000/assets/css/styles.css
# Expected: 200 OK
```

#### Functional Testing

**1. Document Extraction (Automater):**
```
Steps:
1. Go to /automater
2. Select "Finance Dept"
3. Check "Bne.pdf" sample
4. Click "Extract Data"
5. Verify results table appears
6. Check for vendor name, invoice number, amounts
7. Click "Export CSV"
8. Verify CSV downloads

Expected: All steps succeed, no errors
```

**2. ROI Calculator:**
```
Steps:
1. Go to /roi-calculator/
2. Click "Architecture & Building Services"
3. Enter: Staff=50, Rate=$175, Hours=100, Pain=5
4. Click "Calculate ROI"
5. Verify hero number shows ~$375k
6. Verify context section shows ~$1.09M
7. Check top 3 tasks display
8. Click "Generate PDF"
9. Verify PDF page loads

Expected: All calculations correct, no errors
```

**3. Industry Pages:**
```
Steps:
1. Go to /accounting
2. Verify hero section loads
3. Check pain point cards (3 cards)
4. Click ROI calculator CTA
5. Verify industry pre-selected

Expected: Page renders, links work
```

### Automated Testing (Future)

**Unit Tests (pytest):**
```python
# tests/test_services.py
import pytest
from services.gemini_service import parse_gemini_response

def test_parse_json_array():
    response = '[{"Mark": "B1", "Size": "310UC158"}]'
    result = parse_gemini_response(response)
    assert len(result) == 1
    assert result[0]['Mark'] == 'B1'

def test_parse_json_with_markdown():
    response = '```json\n[{"Mark": "B1"}]\n```'
    result = parse_gemini_response(response)
    assert len(result) == 1

def test_parse_empty_response():
    response = ''
    result = parse_gemini_response(response)
    assert result == []
```

**Run tests:**
```bash
# Install pytest
pip install pytest

# Run all tests
pytest

# Run specific test file
pytest tests/test_services.py

# Run with coverage
pytest --cov=services tests/
```

**Integration Tests:**
```python
# tests/test_routes.py
import pytest
from main import app

@pytest.fixture
def client():
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client

def test_homepage(client):
    response = client.get('/')
    assert response.status_code == 200
    assert b'Curam-Ai Protocol' in response.data

def test_roi_calculator(client):
    response = client.get('/roi-calculator/')
    assert response.status_code == 200
    assert b'Select Your Industry' in response.data

def test_automater_post(client):
    response = client.post('/automater', data={
        'department': 'finance',
        'samples': ['invoices/Bne.pdf']
    })
    assert response.status_code == 200
```

---

## Performance Optimization

### 1. Enable Caching (Redis)

```bash
# Add Redis to Railway
railway add redis

# Install Flask-Caching
pip install Flask-Caching redis
```

```python
# main.py
from flask_caching import Cache

cache = Cache(app, config={
    'CACHE_TYPE': 'redis',
    'CACHE_REDIS_URL': os.environ.get('REDIS_URL')
})

@cache.cached(timeout=300)  # 5 min cache
@app.route('/expensive-operation')
def expensive_operation():
    # Slow operation here
    pass
```

### 2. Async Document Processing (Celery)

```bash
# Install Celery
pip install celery redis
```

```python
# tasks.py
from celery import Celery

celery = Celery('tasks', broker=os.environ.get('REDIS_URL'))

@celery.task
def process_document_async(file_path, department):
    text = extract_text(file_path)
    data = extract_with_gemini(text, department)
    return data

# main.py
@app.route('/automater-async', methods=['POST'])
def automater_async():
    file_path = save_uploaded_file(request.files['document'])
    task = process_document_async.delay(file_path, 'finance')
    return {'task_id': task.id, 'status': 'processing'}
```

### 3. CDN for Static Assets

```python
# Use Cloudflare or similar
# Update asset URLs:
ASSET_URL = os.environ.get('CDN_URL', '/assets')

# templates
<link rel="stylesheet" href="{{ ASSET_URL }}/css/styles.css">
```

### 4. Minify CSS/JS

```bash
# Install minifiers
npm install -g terser cssnano-cli

# Minify JS
terser assets/js/main.js -o assets/js/main.min.js

# Minify CSS
cssnano assets/css/styles.css assets/css/styles.min.css

# Use minified versions in production
{% if config.ENV == 'production' %}
  <link href="/assets/css/styles.min.css">
{% else %}
  <link href="/assets/css/styles.css">
{% endif %}
```

---

## Monitoring & Debugging

### Railway Logs

```bash
# Real-time logs (all services)
railway logs --tail

# Filter by service
railway logs --service web --tail

# Export logs to file
railway logs > logs_$(date +%Y%m%d).txt

# Search logs
railway logs | grep ERROR
railway logs | grep "Gemini API"
```

### Application Logging

```python
# main.py
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('app.log'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)

# Use in routes
@app.route('/automater', methods=['POST'])
def automater():
    logger.info(f"Processing {len(request.files)} files")
    try:
        result = extract_data(file)
        logger.info(f"Extracted {len(result)} records")
        return result
    except Exception as e:
        logger.error(f"Extraction failed: {e}", exc_info=True)
        return {'error': str(e)}, 500
```

### Error Tracking (Sentry)

```bash
# Install Sentry SDK
pip install sentry-sdk[flask]
```

```python
# main.py
import sentry_sdk
from sentry_sdk.integrations.flask import FlaskIntegration

sentry_sdk.init(
    dsn=os.environ.get('SENTRY_DSN'),
    integrations=[FlaskIntegration()],
    traces_sample_rate=0.1  # 10% of transactions
)

# Errors automatically reported to Sentry
```

---

## Troubleshooting Common Issues

### Issue 1: "Module not found" on Railway

**Symptoms:**
```
ModuleNotFoundError: No module named 'google.generativeai'
```

**Solution:**
```bash
# 1. Verify requirements.txt includes the package
cat requirements.txt | grep generativeai

# 2. If missing, add it
pip freeze | grep generativeai >> requirements.txt

# 3. Commit and push
git add requirements.txt
git commit -m "Add missing dependency"
git push

# 4. Railway will redeploy automatically
```

### Issue 2: Gemini API Quota Exceeded

**Symptoms:**
```
google.api_core.exceptions.ResourceExhausted: 429 Quota exceeded
```

**Solution:**
```python
# Implement model fallback (already in gemini_service.py)
MODELS = ['gemini-2.0-flash-exp', 'gemini-1.5-flash-latest', ...]

# Add rate limiting
from flask_limiter import Limiter

limiter = Limiter(app, key_func=lambda: request.remote_addr)

@app.route('/automater', methods=['POST'])
@limiter.limit("10 per minute")
def automater():
    pass

# Check quota in Google Cloud Console
# https://console.cloud.google.com/apis/api/generativeai.googleapis.com/quotas
```

### Issue 3: 504 Gateway Timeout

**Symptoms:**
```
504 Gateway Timeout
```

**Solution:**
```python
# 1. Increase Gunicorn timeout (Procfile)
web: gunicorn main:app --timeout 180  # Increase from 120 to 180

# 2. Implement prompt truncation (already in gemini_service.py)
if len(prompt) > 6000:
    prompt = truncate_prompt(prompt, 6000)

# 3. Add retry logic with shorter prompt
try:
    return extract(prompt)
except TimeoutError:
    shorter_prompt = truncate_prompt(prompt, 3200)
    return extract(shorter_prompt)
```

### Issue 4: Static Files Not Loading

**Symptoms:**
```
404 Not Found: /assets/css/styles.css
```

**Solution:**
```python
# Verify static file route exists
@app.route('/assets/<path:filename>')
def assets(filename):
    return send_from_directory('assets', filename)

# Check file exists
ls assets/css/styles.css

# Verify Flask template references
# Use url_for for dynamic paths:
<link href="{{ url_for('static', filename='css/styles.css') }}">

# Or use direct path:
<link href="/assets/css/styles.css">
```

### Issue 5: Session Not Persisting

**Symptoms:**
```
KeyError: 'last_results'  # Session data missing
```

**Solution:**
```python
# 1. Verify SECRET_KEY is set
print(app.config['SECRET_KEY'])

# 2. Use session properly
from flask import session

@app.route('/store')
def store():
    session['data'] = {'key': 'value'}
    session.modified = True  # Force save
    return 'Stored'

@app.route('/retrieve')
def retrieve():
    data = session.get('data')  # Use .get() to avoid KeyError
    return data or 'No data'
```

---

## Security Best Practices

### 1. API Key Protection

```python
# ✅ Good: Use environment variables
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')

# ❌ Bad: Hardcode in code
GEMINI_API_KEY = 'AIza...'  # NEVER DO THIS
```

### 2. Input Validation

```python
from werkzeug.utils import secure_filename

@app.route('/upload', methods=['POST'])
def upload():
    file = request.files['document']
    
    # Validate file type
    if not file.filename.endswith('.pdf'):
        return {'error': 'Only PDF files allowed'}, 400
    
    # Sanitize filename
    filename = secure_filename(file.filename)
    
    # Validate file size (10MB limit)
    if len(file.read()) > 10 * 1024 * 1024:
        return {'error': 'File too large'}, 400
    
    file.seek(0)  # Reset after reading
    file.save(filename)
```

### 3. HTTPS Enforcement

```python
# Install Flask-Talisman
pip install flask-talisman

# main.py
from flask_talisman import Talisman

Talisman(app, force_https=True)
```

### 4. CORS Configuration

```python
# Install Flask-CORS
pip install flask-cors

# main.py
from flask_cors import CORS

CORS(app, resources={
    r"/api/*": {
        "origins": ["https://curam-protocol.curam-ai.com.au"],
        "methods": ["GET", "POST"],
        "allow_headers": ["Content-Type"]
    }
})
```

---

## Deployment Checklist

### Pre-Deployment
- [ ] All tests passing locally
- [ ] Environment variables configured in Railway
- [ ] Procfile and runtime.txt present
- [ ] requirements.txt up to date
- [ ] Database initialized (if using PostgreSQL)
- [ ] Static assets minified (for production)

### Deployment
- [ ] Code committed to Git
- [ ] Pushed to main branch
- [ ] Railway build succeeded
- [ ] Railway deploy succeeded
- [ ] Logs show no errors

### Post-Deployment
- [ ] Homepage loads (/)
- [ ] ROI Calculator works (/roi-calculator/)
- [ ] Automater works (/automater)
- [ ] Industry pages load (/accounting, etc.)
- [ ] Static assets load (/assets/*)
- [ ] API endpoints respond (/api/*)
- [ ] SSL certificate active (https://)
- [ ] No errors in Railway logs

### Performance Check
- [ ] Page load time < 3s
- [ ] PDF extraction < 10s
- [ ] No 504 timeouts
- [ ] Memory usage stable

---

## Quick Reference Commands

```bash
# Railway
railway login                    # Login to Railway
railway link                     # Link project
railway logs --tail              # Watch logs
railway variables                # List env vars
railway variables set KEY=VAL    # Set env var
railway status                   # Check status
railway open                     # Open in browser

# Local Development
python main.py                   # Run Flask dev server
gunicorn main:app --reload       # Run Gunicorn locally
pytest                          # Run tests
flask db upgrade                 # Run migrations

# Git
git add .
git commit -m "Message"
git push origin main            # Triggers Railway deploy

# Database
sqlite3 automater_samples.db    # Open SQLite
.tables                         # List tables
.schema department_samples      # Show schema
SELECT * FROM department_samples; # Query data
```

---

## Additional Resources

- **Flask Docs:** https://flask.palletsprojects.com/
- **Gemini API Docs:** https://ai.google.dev/docs
- **Railway Docs:** https://docs.railway.app/
- **Gunicorn Docs:** https://docs.gunicorn.org/

---

**END OF DEPLOYMENT REFERENCE**

These 3 files (PROJECT_OVERVIEW, ARCHITECTURE_REFERENCE, DEPLOYMENT_REFERENCE) should give you everything needed to start a new project based on this codebase.
