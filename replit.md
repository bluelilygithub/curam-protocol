# Curam-Ai Protocol

## Overview

Curam-Ai Protocol™ is an AI-powered document extraction and automation platform built for Australian professional services firms. The system extracts structured data from unstructured PDF documents (invoices, engineering drawings, logistics forms, transmittals) using Google Gemini AI, achieving 90%+ accuracy rates across multiple document types.

The platform serves as both a customer-facing demo/trial system and an internal operational tool for managing Phase 1 customer feasibility sprints ($1,500 fixed-price document validation engagements).

**Core Capabilities:**
- Finance: Vendor invoice extraction (95%+ accuracy)
- Engineering: Structural beam/column schedule extraction (93% accuracy)
- Transmittal: Drawing register extraction (95%+ accuracy)
- Logistics: FTA lists, Bills of Lading, packing lists

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Tech Stack
- **Backend:** Python 3.11, Flask web framework
- **Database:** PostgreSQL with SQLAlchemy ORM (Replit for dev, Railway for prod)
- **AI Engine:** Google Gemini 2.5 Flash for document extraction
- **PDF Processing:** Dual extraction via pdfplumber and PyMuPDF (fallback strategy)
- **Production Server:** Gunicorn WSGI
- **Performance:** Flask-Compress for Gzip/Brotli compression

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
- `phase1_trials` - Customer trial management with token-based report access
- `extraction_logs` - Processing history and performance tracking
- `users` - Admin authentication with password hashing

### Authentication

- Admin dashboard uses session-based authentication with CSRF protection (Flask-WTF)
- Admin accounts must be created in database with hashed passwords (no default credentials)
- Login rate limiting: 5 attempts max, 15-minute lockout per IP
- Password hashing via Werkzeug security functions
- Phase 1 trial reports use secure token-based access (no login required for customers)
- SECRET_KEY required (no startup without it)

### File Storage

- Upload directories configurable via `UPLOAD_BASE_DIR` environment variable
- For Railway persistent storage, mount volume to `/data/uploads`
- Organized by department: `uploads/finance/`, `uploads/phase1_trials/`

## External Dependencies

### Third-Party Services

| Service | Purpose | Configuration |
|---------|---------|---------------|
| Google Gemini AI | Document text extraction and JSON structuring | `GEMINI_API_KEY` env var |
| Railway PostgreSQL | Managed database hosting | `DATABASE_URL` env var (auto-set in Railway) |

### Python Dependencies (Key)

- `google-genai` - Gemini API client (unified SDK, replaced deprecated google-generativeai Jan 2026)
- `PyMuPDF` + `pdfplumber` - PDF text extraction (PyMuPDF primary, pdfplumber fallback)
- `pillow`, `opencv-python-headless`, `pytesseract` - Image preprocessing for scanned documents
- `pandas`, `openpyxl` - Excel export
- `reportlab` - PDF report generation
- `plotly` - ROI calculator visualizations
- `psycopg2-binary`, `SQLAlchemy` - PostgreSQL connectivity (with connection pooling)

## Performance Optimizations

### Document Context & Extraction Hints (Per-Document)
- Each uploaded document can have user-provided guidance fields:
  - `extraction_context`: Description of what the document is
  - `extraction_hints`: Tips for locating specific fields
  - `expected_fields`: Comma-separated list of fields to extract
  - `notes`: Additional notes
- "Edit Details" button on trial detail page opens modal for each document
- User guidance is appended to AI prompts to improve extraction accuracy
- Cache is bypassed when user guidance is present to ensure fresh extraction

### Document Fingerprinting & AI Caching
- SHA256 fingerprinting of document content
- Cached AI results skip expensive Gemini API calls for duplicate documents
- 7-day cache expiry (database-backed when available)
- Cache bypassed when document-level guidance is provided
- `services/cache_service.py` - Document cache implementation

### PDF Extraction
- PyMuPDF as primary extractor (faster than pdfplumber)
- Parallel page processing for multi-page documents
- Automatic fallback to pdfplumber for complex layouts

### Database Connection Pooling
- SQLAlchemy QueuePool with 5 connections (10 overflow)
- Connection recycling every 30 minutes
- Pre-ping enabled for connection health checks

### Background Task Processing
- Async document processing via threading
- Non-blocking web requests during AI extraction
- `services/background_tasks.py` - Task queue implementation

### Production Server (Gunicorn)
- 4 workers for concurrent request handling
- 5-second keep-alive for connection reuse
- 5-minute timeout for AI API calls
- Worker recycling every 1000 requests

### Static Asset Caching
- CSS/JS: 1 year cache with immutable flag
- Images: 6 months cache
- Fonts: 1 year cache with immutable flag
- Version-based cache busting via template variable

### API Endpoints
- `GET /api/system/performance` - System stats (cache, pool, queue)
- `POST /api/system/cache/clear` - Clear document cache
- `GET /api/task/<task_id>/status` - Background task status
- `POST /api/system/cleanup-documents` - Auto-cleanup expired trial documents (requires admin or CLEANUP_API_KEY)

### Document Retention & Privacy (Australian Privacy Act Compliance)
- Configurable retention periods: 7-90 days (default 30)
- `phase1_trials.retention_days` - Per-trial retention setting
- `phase1_trials.documents_deleted_at` - Timestamp when documents were purged
- Manual deletion via admin "Delete Documents Now" button
- Automatic cleanup via `/api/system/cleanup-documents` (secured with API key or admin session)
- Original PDFs deleted after retention; extraction results preserved for reporting
- Files stored in `uploads/phase1_trials/{trial_id}/`

### Required Environment Variables

```
DATABASE_URL=postgresql://...
GEMINI_API_KEY=...
SECRET_KEY=...
ADMIN_USERNAME=admin (optional)
ADMIN_PASSWORD=changeme123 (optional)
UPLOAD_BASE_DIR=/data/uploads (optional, for persistent storage)
```