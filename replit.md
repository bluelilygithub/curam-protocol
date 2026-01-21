# Curam-Ai Protocol

## Overview

Curam-Ai Protocol™ is an AI-powered document extraction and automation platform built for Australian professional services firms. The system extracts structured data from unstructured PDF documents (invoices, engineering drawings, logistics forms, transmittals) using Google Gemini AI, achieving 90%+ accuracy rates across multiple document types.

The platform serves as both a customer-facing demo/trial system and an internal operational tool for managing Phase 1 customer feasibility sprints ($1,500 fixed-price document validation engagements).

**Core Capabilities:**
- Finance: Vendor invoice extraction (95%+ accuracy)
- Engineering: Structural beam/column schedule extraction (93% accuracy)
- Transmittal: Drawing register extraction (95%+ accuracy)
- Logistics: FTA lists, Bills of Lading, packing lists

**Target Industries (7 validated):**
- Accounting ($521k annual production value)
- Engineering ($521k annual production value)
- Logistics ($521k annual production value)
- Financial Planning ($521k annual production value)
- Insurance ($521k annual production value)
- Legal Services ($730k annual production value)
- Property Management ($500k annual production value)

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes (January 2026)

- **Industry Configs**: Added Legal Services and Property Management to validated industries.
- **ROI Calculator**: Added 'Billing Capacity' metric to show revenue potential ($2.5M for Legal).
- **Database**: Added `billing_rate` column to `industry_configs`.
- **Feasibility Report**: Dynamically updates ROI labels based on industry-specific DB values.
- **Bug Fixes**: Resolved internal server error in industry config updates by authorizing the `billing_rate` field.

## System Architecture

### Tech Stack
- **Backend:** Python 3.11, Flask web framework
- **Database:** PostgreSQL with SQLAlchemy ORM (Replit for dev, Railway for prod)
- **AI Engine:** Google Gemini 2.5 Flash for document extraction
- **PDF Processing:** Dual extraction via pdfplumber and PyMuPDF (fallback strategy)
- **Production Server:** Gunicorn WSGI
- **Performance:** Flask-Compress for Gzip/Brotli compression
- **Domain:** www.curam-ai.com.au

### Application Structure

**Flask Blueprint Architecture:**
- `routes/static_pages.py` - Marketing/informational pages
- `routes/automater_routes.py` - Document upload and extraction workflow
- `routes/export_routes.py` - Excel/PDF export functionality
- `routes/api_routes.py` - REST API endpoints
- `routes/admin_routes.py` - Admin dashboard for trial management

**Service Layer:**
- `services/gemini_service.py` - AI extraction using database-driven prompts
- Prompts managed exclusively via `prompt_templates` database table

**ROI Calculator:**
- `roi_calculator_flask.py` - Main calculator with embedded templates and industry configs
- `roi_calculator/calculations.py` - Core calculation logic

**Configuration:**
- `config.py` - Centralized settings for upload directories, department configs, sample file mappings
- Environment-based configuration via `.env` file

### PDF Extraction Pipeline

1. **Text Extraction:** Primary via pdfplumber, fallback to PyMuPDF
2. **Image Detection:** If scanned/poor quality, triggers image preprocessing
3. **AI Extraction:** Document text sent to Gemini with document-type-specific prompts
4. **Validation:** Results validated for completeness and accuracy
5. **Export:** JSON, Excel, or PDF report generation

### Database Schema (Key Tables)

- `sectors` - Industry categories (finance, engineering, logistics, transmittal)
- `document_types` - Specific document types per sector with demo settings
- `prompt_templates` - AI extraction prompts organized by scope/document type
- `industry_configs` - ROI calculator parameters per industry (doc_staff_pct, hrs_per_week, loaded_cost, automation_rate)
- `phase1_trials` - Customer trial management with token-based report access
- `extraction_logs` - Processing history and performance tracking
- `users` - Admin authentication with password hashing

### Authentication

- Admin dashboard uses session-based authentication with CSRF protection (Flask-WTF)
- Admin accounts must be created in database with hashed passwords (no default credentials)
- Login rate limiting: 5 attempts max, 15-minute lockout per IP
- Password hashing via Werkzeug security functions
- Phase 1 trial reports use secure token-based access (no login required for customers)
- Customer results page (/results/<token>) shows only aggregate metrics
- SECRET_KEY required (no startup without it)

### File Storage

- Upload directories configurable via `UPLOAD_BASE_DIR` environment variable
- For Railway persistent storage, mount volume to `/data/uploads`
- Organized by department: `uploads/finance/`, `uploads/phase1_trials/`

### Deployment & Maintenance

- **Port Configuration:** Production server (Gunicorn) must bind to `0.0.0.0:5000` to match Replit's infrastructure.
- **Security Scans:** To speed up future deployments:
    1.  **Cache Results:** Replit caches successful scans; only code changes trigger full re-scans.
    2.  **Configuration Stability:** Avoid frequent changes to the `deployment_config` to prevent triggering extra health check cycles.
    3.  **Dependency Management:** Large additions to `requirements.txt` can increase scan time.

## ROI Calculator

### Simplified Marketing Formula (January 2026)
Fixed formula for website marketing examples:
- **85%** of total staff are documentation staff
- **15%** are executives/senior partners excluded
- **4.5 hours/week** per doc staff on documentation
- **40%** conservative automation potential
- **48 weeks/year**
- No industry variance multipliers

### Calculation Formula
```
Documentation Staff = Total Staff × 0.85 (rounded)
Total Weekly Hours = Doc Staff × 4.5 hours
Annual Documentation Cost = Weekly Hours × Hourly Rate × 48 weeks
Conservative Savings = Annual Cost × 40%
```

**Example (50 staff @ $140/hr):**
- 50 × 85% = 43 doc staff
- 43 × 4.5 = 193.5 hrs/week
- 193.5 × $140 × 48 = $1,302,480/year
- $1,302,480 × 40% = **$520,992 conservative savings**

### Three Savings Scenarios
- **Conservative:** Annual cost × 40%
- **Probable:** Conservative × 1.15 (15% above)
- **Optimistic:** Conservative × 1.35 (35% above)

## External Dependencies

### Third-Party Services

| Service | Purpose | Configuration |
|---------|---------|---------------|
| Google Gemini AI | Document text extraction and JSON structuring | `GEMINI_API_KEY` env var |
| Railway PostgreSQL | Managed database hosting | `DATABASE_URL` env var |
| WordPress Blog | Blog content at blog.curam-ai.com.au | REST API with hybrid fallback |

### Python Dependencies (Key)

- `google-genai` - Gemini API client (unified SDK)
- `PyMuPDF` + `pdfplumber` - PDF text extraction
- `pillow`, `opencv-python-headless`, `pytesseract` - Image preprocessing
- `pandas`, `openpyxl` - Excel export
- `reportlab` - PDF report generation
- `plotly` - ROI calculator visualizations
- `psycopg2-binary`, `SQLAlchemy` - PostgreSQL connectivity

## Performance Optimizations

### Document Fingerprinting & AI Caching
- SHA256 fingerprinting of document content
- Cached AI results skip expensive Gemini API calls for duplicate documents
- 7-day cache expiry (database-backed when available)

### PDF Extraction
- PyMuPDF as primary extractor (faster than pdfplumber)
- Parallel page processing for multi-page documents
- Automatic fallback to pdfplumber for complex layouts

### Database Connection Pooling
- SQLAlchemy QueuePool with 5 connections (10 overflow)
- Connection recycling every 30 minutes
- Pre-ping enabled for connection health checks

### Production Server (Gunicorn)
- 4 workers for concurrent request handling
- 5-second keep-alive for connection reuse
- 5-minute timeout for AI API calls

### Static Asset Caching
- CSS/JS: 1 year cache with immutable flag
- Images: 6 months cache
- Version-based cache busting via template variable

## API Endpoints
- `GET /api/system/performance` - System stats
- `POST /api/system/cache/clear` - Clear document cache
- `GET /api/task/<task_id>/status` - Background task status
- `POST /api/system/cleanup-documents` - Auto-cleanup expired trial documents
- `GET /api/blog-posts` - Blog posts with WordPress fallback

## Required Environment Variables

```
DATABASE_URL=postgresql://...
GEMINI_API_KEY=...
SECRET_KEY=...
ADMIN_PASSWORD=... (for admin access)
MAILCHANNELS_API_KEY=... (for email sending)
```
