# Phase 1 Trial Management - Complete Guide

**Last Updated:** January 2025  
**Purpose:** Complete documentation for managing Phase 1 customer trials from setup to report delivery

---

## Table of Contents

1. [Overview](#overview)
2. [Setup & Installation](#setup--installation)
3. [Creating a Trial](#creating-a-trial)
4. [Configuring Extraction Fields](#configuring-extraction-fields)
5. [Uploading Documents](#uploading-documents)
6. [File Storage](#file-storage)
7. [Processing Documents](#processing-documents)
8. [Understanding Results](#understanding-results)
9. [Generating Reports](#generating-reports)
10. [Database Reference](#database-reference)
11. [Routes Reference](#routes-reference)
12. [Troubleshooting](#troubleshooting)

---

## Overview

The Phase 1 trial system allows you to manage customer feasibility sprints ($1,500 fixed-price engagements) directly from the admin area. When a customer provides 15 documents for testing, you can:

1. Create a trial record with customer information
2. Configure extraction fields per category (3 categories × 5 documents)
3. Upload customer documents (organized by category)
4. Process documents through the extraction pipeline
5. Generate a private, secure report
6. Share the report link with the customer (no login required)

**Key Features:**
- Per-category extraction configuration
- Secure token-based report access
- Automatic test result calculation (3 tests: Accuracy, STP Rate, Exceptions)
- Category-based document organization (3 categories × 5 documents = 15 total)

---

## Setup & Installation

### Step 1: Database Schema

Run the SQL script to create the necessary tables:

```bash
# Via Railway CLI
railway run psql < database_setup_phase1_trials.sql

# OR via Railway Dashboard
# 1. Go to PostgreSQL service
# 2. Click "Query" tab
# 3. Copy/paste contents of database_setup_phase1_trials.sql
# 4. Click "Execute"
```

**If using existing database, also run migration:**
```bash
railway run psql < database_migration_add_extraction_config.sql
```

This creates:
- `phase1_trials` - Trial/project information
- `phase1_trial_documents` - Uploaded customer documents (with categories)
- `phase1_trial_results` - Extraction results for each document
- Helper functions (`generate_trial_code()`, `generate_report_token()`)
- `category_configs` JSONB column for per-category extraction settings

### Step 2: Verify Routes

The admin routes are already added to `routes/admin_routes.py`. Ensure your Flask app registers the admin blueprint (should already be done in `main.py`).

---

## Creating a Trial

**Access:** `/admin/phase1-trials/create`

**Process:**
1. Log into admin dashboard (`/admin`)
2. Navigate to "Phase 1 Trials" → "+ Create New Trial"
3. Fill in customer information:
   - **Customer Name** (required)
   - **Customer Email** (optional)
   - **Company Name** (optional)
   - **Industry** (dropdown: 11 industry options)
   - **Sector** (dropdown from database)
   - **Notes** (optional internal notes)
4. Click "Create Trial"

**What Happens:**
- System generates unique trial code (e.g., "P1-2025-001")
- System generates secure report token (64-character hex string)
- Trial record created in database with status "pending"
- You're redirected to trial detail page

---

## Configuring Extraction Fields

**Access:** Trial detail page → "Extraction Configuration" section (left column)

Each category can have different extraction fields and output format, since categories may represent different document types (e.g., Finance invoices vs Engineering schedules vs Logistics documents).

**Process:**
1. On trial detail page, locate "Extraction Configuration" section (left column)
2. For each category:
   - **Category 1:** Enter expected fields (comma-separated), e.g., `Vendor, Date, InvoiceNum, Cost, GST, FinalAmount`
   - **Category 2:** Enter expected fields, e.g., `Mark, Size, Qty, Length, Grade, PaintSystem`
   - **Category 3:** Enter expected fields, e.g., `ShipmentRef, CountryOfOrigin, FTAAgreement, TariffCode`
   - **Output Format:** Enter JSON structure or description (optional)
3. Click "💾 Save All Category Configurations"

**Example Configuration:**
- **Category 1 (Finance):** Fields: `Vendor, Date, InvoiceNum, Cost, GST, FinalAmount, LineItems` | Output: `{"type": "invoice", "structure": "flat_with_lineitems"}`
- **Category 2 (Engineering):** Fields: `Mark, Size, Qty, Length, Grade, PaintSystem` | Output: `{"type": "engineering_schedule", "structure": "tabular"}`
- **Category 3 (Logistics):** Fields: `ShipmentRef, CountryOfOrigin, FTAAgreement, TariffCode` | Output: `{"type": "logistics", "structure": "flat"}`

**Storage:** Configuration saved as JSONB in `phase1_trials.category_configs` column.

---

## Uploading Documents

**Access:** Trial detail page → "Document Upload" section (right column)

**Document Requirements:**
- **Format:** PDF only
- **Total:** 15 documents maximum
- **Organization:** 3 categories × 5 documents per category
- **Selection:** Should represent "worst-case" scenarios, not cherry-picked clean examples

**Process:**
1. On trial detail page, locate "Document Upload" section (right column)
2. Upload documents to each category:
   - **Category 1:** Click upload area, select up to 5 PDF files, click "Upload"
   - **Category 2:** Repeat for 5 more documents
   - **Category 3:** Repeat for final 5 documents
3. Files are automatically saved with unique timestamps
4. Progress indicator shows: "X/15 documents" and per-category counts

**File Naming:**
- Format: `{timestamp_ms}_{original_filename}.pdf`
- Example: `1704067200000_invoice-001.pdf`
- Original filename preserved for reference

**Validation:**
- Maximum 5 files per category (enforced)
- Maximum 15 files total across all categories (enforced)
- Only PDF files accepted (enforced)
- Progress shown per category and total

---

## File Storage

### Storage Location

**Local Development:**
- Path: `uploads/phase1_trials/<trial_id>/`
- Example: `C:\Users\micha\Local Sites\curam-protocol\uploads\phase1_trials\1\`

**Railway Production:**
- Path: Same relative path, but in **ephemeral container filesystem** ⚠️
- Example: `/app/uploads/phase1_trials/1/`

### ⚠️ CRITICAL: Railway Ephemeral Storage

**Current Status:** Files stored in Railway container's filesystem are **ephemeral** (temporary).

**What This Means:**
- ✅ Files persist while container is running
- ❌ Files are **lost** when container restarts
- ❌ Files are **lost** on every deployment/redeploy
- ❌ Files are **lost** on container crashes

**This is a production issue** - customer documents will be lost if the container restarts or redeploys!

### Solution: Railway Persistent Volume

**Steps to Fix:**
1. Railway Dashboard → Web Service → Settings → Volumes
2. Click "Create Volume"
3. Name: `phase1-uploads`
4. Mount path: `/data/uploads`
5. Add environment variable: `UPLOAD_BASE_DIR=/data/uploads`
6. Redeploy service

**After Setup:**
- Files stored at `/data/uploads/phase1_trials/<trial_id>/`
- Files persist across deployments
- Environment variable configurable (see `config.py`)

**Code Configuration:**
```python
# In config.py
UPLOAD_BASE_DIR = os.environ.get('UPLOAD_BASE_DIR', 'uploads')
PHASE1_TRIALS_UPLOAD_DIR = os.path.join(UPLOAD_BASE_DIR, 'phase1_trials')
```

### File Structure

```
uploads/  (or /data/uploads if using Railway volume)
└── phase1_trials/
    ├── 1/  (trial_id = 1)
    │   ├── 1704067200000_invoice-001.pdf
    │   ├── 1704067201000_beam-schedule.pdf
    │   └── ...
    ├── 2/  (trial_id = 2)
    │   └── ...
    └── ...
```

**Security:** 
- Files excluded from git (see `.gitignore`)
- Accessible only via admin routes (admin authentication required)
- Public report route does NOT serve original files (only extracted data)

---

## Processing Documents

**Access:** Trial detail page → Click "🚀 Process All Documents" (appears when 15 documents uploaded)

**Current Status:** ⚠️ **NEEDS IMPLEMENTATION**

The `/admin/phase1-trials/<id>/process` route currently returns a placeholder. You need to integrate it with your existing extraction pipeline.

**Required Implementation:**

```python
@admin_bp.route('/phase1-trials/<int:trial_id>/process', methods=['POST'])
@require_admin
def phase1_trial_process(trial_id):
    """Process documents in a Phase 1 trial"""
    trial = get_phase1_trial(trial_id=trial_id)
    if not trial:
        return jsonify({"success": False, "error": "Trial not found"}), 404
    
    # Get category configs for this trial
    category_configs = trial.get('category_configs', {}) or {}
    
    documents = get_trial_documents(trial_id)
    
    for doc in documents:
        if doc.get('status') == 'uploaded':
            # Update status to processing
            update_document_status(doc['id'], 'processing')
            
            try:
                # 1. Get category-specific config
                category = doc.get('document_category', 'Category 1')
                category_config = category_configs.get(category, {})
                expected_fields = category_config.get('fields', [])
                output_format = category_config.get('output_format', {})
                
                # 2. Extract text from PDF
                from services.pdf_service import extract_text
                text = extract_text(doc['stored_file_path'])
                
                # 3. Run AI analysis (use category-specific config if available)
                from services.gemini_service import analyze_gemini
                result = analyze_gemini(text, doc_type='...', sector=...)
                
                # 4. Calculate metrics
                extracted_data = result.get('extracted_data', {})
                confidence_scores = result.get('confidence_scores', {})
                
                # Calculate field accuracy
                fields_total = len(confidence_scores)
                fields_passed = sum(1 for score in confidence_scores.values() if score >= 90)
                fields_flagged = fields_total - fields_passed
                field_accuracy = (fields_passed / fields_total * 100) if fields_total > 0 else 0
                
                # Determine STP eligibility
                stp_eligible = field_accuracy >= 90 and fields_flagged == 0
                requires_human_review = not stp_eligible
                
                # 5. Save result
                save_trial_result(
                    trial_id=trial_id,
                    document_id=doc['id'],
                    extracted_data=extracted_data,
                    confidence_scores=confidence_scores,
                    field_accuracy=field_accuracy,
                    fields_total=fields_total,
                    fields_passed=fields_passed,
                    fields_flagged=fields_flagged,
                    validation_errors=result.get('validation_errors'),
                    requires_human_review=requires_human_review,
                    stp_eligible=stp_eligible,
                    processing_time_ms=result.get('processing_time_ms')
                )
                
                update_document_status(doc['id'], 'completed')
                
            except Exception as e:
                print(f"Error processing document {doc['id']}: {e}")
                update_document_status(doc['id'], 'failed')
    
    # Calculate trial-level metrics
    results = get_trial_results(trial_id)
    if results:
        overall_accuracy = sum(r.get('field_accuracy', 0) for r in results) / len(results)
        stp_count = sum(1 for r in results if r.get('stp_eligible', False))
        stp_rate = (stp_count / len(results) * 100) if results else 0
        exceptions_count = sum(1 for r in results if r.get('requires_human_review', False))
        
        # Update trial metrics
        update_trial_metrics(trial_id, overall_accuracy, stp_rate, exceptions_count, 'completed')
    
    return jsonify({"success": True, "message": f"Processed {len(documents)} documents"})
```

**Key Integration Points:**
- Use existing `services/pdf_service.py` for text extraction
- Use existing `services/gemini_service.py` for AI analysis
- Use category-specific `category_configs` if configured
- Save results using `save_trial_result()` from `database.py`
- Calculate trial-level metrics after all documents processed

---

## Understanding Results

After processing, the system automatically calculates three tests:

### Test 1: Field Extraction Accuracy
- **Metric:** Average accuracy across all 15 documents
- **Target:** ≥90% (PASS)
- **Calculation:** Sum of all `field_accuracy` values / document count
- **Storage:** `phase1_trials.overall_accuracy`

**What Success Looks Like:**
- ✅ Overall accuracy ≥90%: Proceed to Phase 2 with confidence
- ✅ Critical fields (invoice numbers, totals, dates) >95%: Core functionality proven

**What Failure Looks Like:**
- ❌ Overall accuracy <90%: System cannot reliably extract from your document types
- ❌ Critical fields consistently flagged: Core data points too unreliable

### Test 2: Straight-Through Processing (STP) Rate
- **Metric:** Percentage of documents processed completely automatically
- **Target:** ≥60% (PASS, varies by industry)
- **Calculation:** `(STP documents / Total documents) × 100`
- **Storage:** `phase1_trials.stp_rate`

**What Success Looks Like:**
- ✅ STP Rate ≥60%: Operational efficiency validated
- ✅ Remaining documents properly routed to review: Exception handling working

**What Failure Looks Like:**
- ❌ STP Rate <40%: Too many exceptions, automation may not provide sufficient ROI

### Test 3: Exception Handling and Safety
- **Metric:** Count of documents flagged for human review
- **Target:** Proper exception handling confirmed (safe failure modes)
- **Calculation:** Count where `requires_human_review = true`
- **Storage:** `phase1_trials.exceptions_count`

**What Success Looks Like:**
- ✅ Exceptions properly identified: System correctly flags ambiguous data
- ✅ Low false positive rate: Not over-flagging valid data
- ✅ Fail-safe behavior: System defaults to human review when uncertain

**What Failure Looks Like:**
- ❌ High false positive rate: System flags too many valid fields
- ❌ Missed exceptions: System confident in incorrect extractions

### Overall Recommendation

**Passing All Three Tests (Proceed to Phase 2):**
- Field extraction accuracy ≥90%
- STP rate ≥60%
- Exception handling works correctly

**Failing Any Test (No-Go Decision):**
- Field accuracy <90%: Technical capability insufficient
- STP rate too low: Automation efficiency insufficient for ROI
- Poor exception handling: Risk of introducing errors too high

For detailed test explanations, see `PHASE_1_TESTS.md`.

---

## Generating Reports

### Admin View

**Access:** `/admin/phase1-trials/<trial_id>/report`

View the full report as an admin (includes all technical details).

### Customer-Facing Report (Private Token Access)

**Access:** `/phase1-report/<report_token>`

**Security:**
- No login required for customer
- Token provides private access (64-character random hex)
- Token is not guessable
- Only works for this specific trial

**Report Contains:**

1. **Executive Summary:**
   - Trial code and customer information
   - Overall accuracy percentage
   - STP rate
   - Exception count
   - Go/No-Go recommendation

2. **Test 1 Results: Field Extraction Accuracy**
   - Overall accuracy: XX%
   - Documents processed: 15
   - Fields passed (≥90% confidence): X
   - Fields flagged (<90% confidence): Y
   - Detailed field-level results for each document

3. **Test 2 Results: STP Rate**
   - STP Rate: XX%
   - Documents processed automatically: X/15
   - Documents requiring human review: Y/15

4. **Test 3 Results: Exception Handling**
   - Exceptions flagged: X
   - Safe failure mode confirmed: Yes/No
   - Edge cases handled: List of flagged items with reasoning

5. **Document-Level Details:**
   - For each of the 15 documents:
     - Original filename
     - Category (1, 2, or 3)
     - Extracted fields with confidence scores
     - Validation status (PASS/FLAG)

6. **Recommendation:**
   - If all three tests pass → "Proceed to Phase 2"
   - If any test fails → "No-Go: Refund $1,500" + explanation

**Sharing the Report:**
1. Copy the **Private Report URL** from trial detail page:
   ```
   https://yourdomain.com/phase1-report/<64-character-token>
   ```
2. Share with customer:
   - Email it directly
   - Or use "Email Link" button (requires customer email set)

---

## Database Reference

### `phase1_trials` Table

Stores trial/project information:

- `id` - Primary key
- `trial_code` - Unique code (e.g., "P1-2025-001") - auto-generated
- `customer_name`, `customer_email`, `customer_company`
- `industry` - Industry name (e.g., "Engineering")
- `sector_slug` - Links to sectors table
- `status` - pending/processing/completed/failed
- `total_documents` - Count (should be 15)
- `documents_processed` - Count of completed documents
- `overall_accuracy` - Calculated from results (Test 1)
- `stp_rate` - Calculated from results (Test 2)
- `exceptions_count` - Calculated from results (Test 3)
- `report_token` - Secure token for private access (64-char hex) - auto-generated
- `category_configs` - JSONB: Per-category extraction config
- `extraction_fields` - JSONB: DEPRECATED - use category_configs
- `output_format` - JSONB: DEPRECATED - use category_configs
- `notes` - Admin notes
- `created_at`, `updated_at`, `completed_at`

### `phase1_trial_documents` Table

Stores individual customer documents:

- `id` - Primary key
- `trial_id` - Foreign key to phase1_trials
- `document_category` - "Category 1", "Category 2", or "Category 3"
- `document_number` - 1-5 within category
- `original_filename` - Customer's original filename
- `stored_file_path` - Path where file is saved
- `document_type_slug` - Optional: document type identifier
- `file_size_bytes` - File size in bytes
- `status` - uploaded/processing/completed/failed
- `created_at`, `processing_started_at`, `processing_completed_at`

### `phase1_trial_results` Table

Stores extraction results:

- `id` - Primary key
- `trial_id` - Foreign key to phase1_trials
- `document_id` - Foreign key to phase1_trial_documents
- `extracted_data` - JSONB: Full extraction results
- `confidence_scores` - JSONB: Per-field confidence percentages
- `field_accuracy` - Overall accuracy for this document
- `fields_total`, `fields_passed`, `fields_flagged` - Field counts
- `validation_errors` - JSONB: Array of validation issues
- `requires_human_review` - Boolean
- `stp_eligible` - Boolean (Straight-Through Processing eligible)
- `processing_time_ms` - Performance metric
- `ground_truth_data` - JSONB: Optional manually verified correct values
- `accuracy_vs_ground_truth` - Calculated accuracy vs manual verification
- `notes` - Admin notes
- `created_at`

### Database Functions

All functions in `database.py`:

- `create_phase1_trial(...)` - Create new trial (generates code & token)
- `get_phase1_trial(trial_id=None, trial_code=None, report_token=None)` - Get trial
- `get_all_phase1_trials(limit, offset, status_filter)` - List trials
- `update_phase1_trial_extraction_config(trial_id, category_configs=...)` - Update extraction config
- `add_trial_document(...)` - Add document to trial
- `get_trial_documents(trial_id)` - Get all documents for trial
- `save_trial_result(...)` - Save extraction results
- `get_trial_results(trial_id)` - Get all results for trial

---

## Routes Reference

| URL | Method | Access | Purpose |
|-----|--------|--------|---------|
| `/admin/phase1-trials` | GET | Admin | List all trials |
| `/admin/phase1-trials/create` | GET/POST | Admin | Create new trial |
| `/admin/phase1-trials/<id>` | GET | Admin | View trial details (config + upload) |
| `/admin/phase1-trials/<id>/upload` | POST | Admin | Upload documents (AJAX) |
| `/admin/phase1-trials/<id>/config` | POST | Admin | Save extraction configuration (AJAX) |
| `/admin/phase1-trials/<id>/process` | POST | Admin | Process documents ⚠️ **NEEDS IMPLEMENTATION** |
| `/admin/phase1-trials/<id>/report` | GET | Admin | Admin view of report |
| `/phase1-report/<token>` | GET | **Public** | Customer-facing report (token-based, no login) |

---

## Troubleshooting

### Issue: Trial creation fails

**Check:**
- Database connection (`database.py` `test_connection()`)
- Verify `phase1_trials` table exists
- Check that `generate_trial_code()` function exists
- Check that `generate_report_token()` function exists (not `gen_random_bytes()`)

**Fix:**
- Run `database_setup_phase1_trials.sql` to create tables and functions
- Check Railway database logs

### Issue: File upload fails

**Check:**
- `uploads/phase1_trials/` directory exists and is writable
- Verify file size limits (default Flask limit is 16MB)
- Check file is valid PDF
- Category limits: 5 per category, 15 total

**Fix:**
```bash
mkdir -p uploads/phase1_trials
chmod 755 uploads/phase1_trials
```

**For Railway:** Set up persistent volume (see [File Storage](#file-storage) section above)

### Issue: Report token doesn't work

**Check:**
- Verify token in database matches URL
- Ensure route `/phase1-report/<token>` is registered (no `@require_admin` decorator)
- Check token hasn't been regenerated

**Fix:**
- Verify route exists in `routes/admin_routes.py`
- Check token in database: `SELECT report_token FROM phase1_trials WHERE id = X`

### Issue: Processing fails

**Check:**
- Gemini API key is configured
- Document paths are accessible
- Extraction service logs for errors
- Ensure `phase1_trial_results` table exists
- Category configs are saved (check `category_configs` JSONB column)

**Fix:**
- Verify `GEMINI_API_KEY` environment variable
- Check file paths in database match actual file locations
- Review logs for specific error messages

### Issue: Files disappear after deployment

**Cause:** Railway ephemeral container filesystem

**Fix:** Use Railway persistent volume (see [File Storage](#file-storage) section above)

### Issue: Category configuration not saving

**Check:**
- JavaScript console for errors
- Network tab for AJAX response
- `category_configs` column exists in database (run migration if needed)

**Fix:**
- Run `database_migration_add_extraction_config.sql`
- Check browser console for JavaScript errors
- Verify route `/admin/phase1-trials/<id>/config` exists

---

## Example: Complete Workflow

**Customer:** "Acme Engineering" sends 15 CAD schedules

**1. Admin creates trial:**
- Name: "John Smith"
- Email: "john@acme-eng.com"
- Company: "Acme Engineering"
- Industry: "Engineering"
- Sector: "built-environment"
- → Trial: **P1-2025-001** with token `a1b2c3d4...`

**2. Admin configures extraction fields:**
- Category 1: `Mark, Size, Qty, Length, Grade, PaintSystem`
- Category 2: `Mark, Size, Qty, Length, Grade, PaintSystem`
- Category 3: `Mark, Size, Qty, Length, Grade, PaintSystem`
- → Saved to `category_configs` JSONB

**3. Admin uploads documents:**
- Category 1: 5 beam schedule PDFs
- Category 2: 5 column schedule PDFs
- Category 3: 5 mixed schedule PDFs
- → All saved to `uploads/phase1_trials/1/`

**4. Admin processes documents:**
- Click "Process All Documents"
- System extracts and analyzes each PDF using category-specific configs
- Results saved with metrics

**5. System calculates:**
- Test 1: 94.2% accuracy ✅
- Test 2: 73% STP rate ✅
- Test 3: 2 exceptions flagged ✅
- → **Recommendation: PROCEED TO PHASE 2**

**6. Share report:**
- Send customer: `https://yourdomain.com/phase1-report/a1b2c3d4...`
- Customer views detailed report (no login needed)
- Customer sees all test results and recommendation

---

## Additional Resources

- **Phase 1 Tests Explanation:** See `PHASE_1_TESTS.md` for detailed test intentions and outcome interpretation
- **ROI Calculation Methodology:** See `PHASE_1_CALCULATION_METHODOLOGY.md` for how Phase 1 ROI is calculated
- **Database Schema:** See `database_setup_phase1_trials.sql` for complete table definitions
- **Code Reference:** See `routes/admin_routes.py` for route implementations and `database.py` for database functions

---

**Document Version:** 2.0  
**Last Updated:** January 2025
