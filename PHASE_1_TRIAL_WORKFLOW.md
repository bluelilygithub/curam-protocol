# Phase 1 Trial Management - Admin Workflow

## Overview

When a customer provides 15 documents for a Phase 1 trial, you can use the admin area and database to create a private report. This document explains the complete workflow.

---

## Step 1: Set Up Database Schema

**First, create the database tables:**

Run the SQL script in your PostgreSQL database:
```bash
# Via Railway CLI
railway run psql < database_setup_phase1_trials.sql

# OR via Railway Dashboard
# 1. Go to PostgreSQL service
# 2. Click "Query" tab
# 3. Copy/paste contents of database_setup_phase1_trials.sql
# 4. Execute
```

This creates three tables:
- `phase1_trials` - Stores trial/project information
- `phase1_trial_documents` - Stores uploaded customer documents
- `phase1_trial_results` - Stores extraction results for each document

---

## Step 2: Create a Phase 1 Trial (Admin)

**Access:** `/admin/phase1-trials/create`

**Process:**
1. Log into admin dashboard (`/admin`)
2. Navigate to "Phase 1 Trials" → "Create New Trial"
3. Fill in customer information:
   - Customer Name (required)
   - Customer Email (optional)
   - Company Name (optional)
   - Industry (e.g., "Engineering", "Accounting", "Logistics")
   - Sector (dropdown from database)
   - Notes (optional internal notes)
4. Click "Create Trial"

**What Happens:**
- System generates unique trial code (e.g., "P1-2025-001")
- System generates secure report token (64-character hex string)
- Trial record created in database with status "pending"
- You're redirected to trial detail page

---

## Step 3: Upload Customer Documents

**Access:** `/admin/phase1-trials/<trial_id>`

**Process:**
1. On the trial detail page, you'll see document upload sections
2. Organize documents into 3 categories (5 documents each = 15 total):
   - Category 1: Upload 5 documents
   - Category 2: Upload 5 documents  
   - Category 3: Upload 5 documents
3. For each category:
   - Select multiple PDF files (up to 5 at once)
   - Choose category from dropdown
   - Click "Upload Documents"

**What Happens:**
- Files are saved to `uploads/phase1_trials/<trial_id>/`
- Each file gets a unique timestamped filename
- Document records created in `phase1_trial_documents` table
- Trial `total_documents` count updated automatically

**File Storage:**
```
uploads/
  phase1_trials/
    1/  (trial_id = 1)
      1704067200000_invoice-001.pdf
      1704067201000_invoice-002.pdf
      ...
    2/  (trial_id = 2)
      ...
```

---

## Step 4: Process Documents (Run Extraction)

**Access:** `/admin/phase1-trials/<trial_id>/process`

**Process:**
1. On trial detail page, click "Process All Documents"
2. System processes each document through existing extraction pipeline:
   - Extracts text from PDF (via `pdf_service.py`)
   - Runs AI analysis (via `gemini_service.py`)
   - Calculates confidence scores
   - Validates fields
3. Results saved to `phase1_trial_results` table

**Integration with Existing Services:**
The processing integrates with your existing extraction routes:
- Uses `services/pdf_service.extract_text()` for PDF text extraction
- Uses `services/gemini_service.analyze_gemini()` for AI analysis
- Uses `services/validation_service` for field validation

**What Gets Saved:**
For each document:
- `extracted_data` - Full JSON of extracted fields
- `confidence_scores` - Per-field confidence percentages
- `field_accuracy` - Overall document accuracy
- `fields_total`, `fields_passed`, `fields_flagged` - Field counts
- `requires_human_review` - Boolean flag for exceptions
- `stp_eligible` - Boolean (can process without human)
- `processing_time_ms` - Performance metric

---

## Step 5: Review Results & Calculate Metrics

**Access:** `/admin/phase1-trials/<trial_id>`

**Automatic Calculations:**
Once all documents are processed, the system automatically calculates:

1. **Overall Field Accuracy** (Test 1):
   - Average of all `field_accuracy` values across 15 documents
   - Stored in `phase1_trials.overall_accuracy`

2. **STP Rate** (Test 2):
   - Percentage of documents where `stp_eligible = true`
   - Formula: `(STP documents / Total documents) × 100`
   - Stored in `phase1_trials.stp_rate`

3. **Exception Count** (Test 3):
   - Count of documents where `requires_human_review = true`
   - Stored in `phase1_trials.exceptions_count`

**Trial Status Updates:**
- `pending` → Initial state
- `processing` → Documents being processed
- `completed` → All 15 documents processed
- `failed` → Processing errors occurred

---

## Step 6: Generate Private Report

**Access (Admin View):** `/admin/phase1-trials/<trial_id>/report`

**Access (Customer View):** `/phase1-report/<report_token>`

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
     - Category
     - Extracted fields with confidence scores
     - Validation status (PASS/FLAG)
     - Notes/observations

6. **Recommendation:**
   - If all three tests pass → "Proceed to Phase 2"
   - If any test fails → "No-Go: Refund $1,500" + explanation

---

## Step 7: Share Private Report with Customer

**Method 1: Secure Token Link (Recommended)**
- Each trial has a unique `report_token` (64-character hex string)
- Share this URL with customer: `https://yourdomain.com/phase1-report/<report_token>`
- No login required - token provides access
- Customer can view report but cannot modify data

**Method 2: Generate PDF (Future Enhancement)**
- Admin can generate PDF version of report
- Email to customer directly
- Or download and share via secure file transfer

---

## Database Structure

### `phase1_trials` Table
Stores trial/project information:
- `id` - Primary key
- `trial_code` - Unique code (e.g., "P1-2025-001")
- `customer_name`, `customer_email`, `customer_company`
- `industry`, `sector_slug`
- `status` - pending/processing/completed/failed
- `total_documents` - Count (should be 15)
- `documents_processed` - Count of completed documents
- `overall_accuracy` - Calculated from results (Test 1)
- `stp_rate` - Calculated from results (Test 2)
- `exceptions_count` - Calculated from results (Test 3)
- `report_token` - Secure token for private access
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

---

## Admin Routes Summary

| Route | Method | Purpose |
|-------|--------|---------|
| `/admin/phase1-trials` | GET | List all Phase 1 trials |
| `/admin/phase1-trials/create` | GET/POST | Create new trial |
| `/admin/phase1-trials/<id>` | GET | View trial details |
| `/admin/phase1-trials/<id>/upload` | POST | Upload customer documents |
| `/admin/phase1-trials/<id>/process` | POST | Process documents (run extraction) |
| `/admin/phase1-trials/<id>/report` | GET | Admin view of report |
| `/phase1-report/<token>` | GET | **Public view** (token-based, no login) |

---

## Complete Workflow Example

**Scenario:** Customer "Acme Engineering" sends 15 CAD schedules

1. **Admin creates trial:**
   - Name: "John Smith"
   - Email: "john@acme-eng.com"
   - Company: "Acme Engineering"
   - Industry: "Engineering"
   - Sector: "built-environment"
   - → Trial created: **P1-2025-001** with token `a1b2c3d4...`

2. **Admin uploads documents:**
   - Category 1: Upload 5 beam schedule PDFs (S-101.pdf, S-102.pdf, etc.)
   - Category 2: Upload 5 column schedule PDFs
   - Category 3: Upload 5 mixed schedule PDFs
   - → All 15 documents saved to `uploads/phase1_trials/1/`

3. **Admin processes documents:**
   - Click "Process All Documents"
   - System runs extraction on each PDF
   - Results saved with confidence scores, accuracy, etc.
   - → Trial status changes to "completed"

4. **System calculates metrics:**
   - Test 1: Overall accuracy = 94.2% ✅ (≥90% - PASS)
   - Test 2: STP rate = 73% ✅ (≥60% - PASS)
   - Test 3: 2 exceptions flagged, properly routed ✅ (PASS)
   - → All tests pass → Recommendation: "Proceed to Phase 2"

5. **Admin reviews report:**
   - View at `/admin/phase1-trials/1/report`
   - Verify all metrics look correct
   - Add any additional notes

6. **Share with customer:**
   - Send customer link: `https://yourdomain.com/phase1-report/a1b2c3d4...`
   - Customer views report (no login needed)
   - Customer sees all three test results with detailed breakdown

---

## Security & Privacy

**Private Report Access:**
- Reports are **private** by default
- Only accessible via secure token (64-character random hex)
- Token is generated server-side, not guessable
- No login required for customer - token provides access
- Admin can regenerate token if needed (future enhancement)

**File Storage:**
- Customer documents stored in `uploads/phase1_trials/<trial_id>/`
- Files should be excluded from git (add to `.gitignore`)
- Consider encryption at rest for sensitive customer data (future enhancement)

**Data Retention:**
- Keep trial data for audit/compliance purposes
- Consider adding data retention policies (future enhancement)

---

## Integration with Existing Services

The Phase 1 trial system integrates with your existing extraction pipeline:

**Services Used:**
- `services/pdf_service.py` - PDF text extraction
- `services/gemini_service.py` - AI-powered field extraction
- `services/validation_service.py` - Field validation and confidence scoring

**Document Types Supported:**
- Works with any document type configured in `document_types` table
- Automatically detects document type from sector configuration
- Falls back to generic extraction if document type unknown

**Extraction Logic:**
- Uses same extraction logic as `/automater` route
- Same accuracy standards (90%+ target)
- Same validation rules
- Same confidence scoring methodology

---

## Next Steps / Future Enhancements

**Immediate Needs:**
1. ✅ Database schema created
2. ✅ Database functions added
3. ✅ Admin routes added
4. ⏳ Admin templates need to be created
5. ⏳ Document processing integration needs completion
6. ⏳ Report generation template needs creation

**Future Enhancements:**
- PDF report generation (downloadable)
- Email report to customer automatically
- Ground truth comparison tool (manual verification)
- Batch processing for multiple documents
- Progress tracking during processing
- Export results to Excel/CSV
- Integration with customer portal
- Automated email notifications

---

## Troubleshooting

**Issue: Trial creation fails**
- Check database connection (`database.py` `test_connection()`)
- Verify `phase1_trials` table exists
- Check that `generate_trial_code()` function exists

**Issue: File upload fails**
- Check `uploads/phase1_trials/` directory exists and is writable
- Verify file size limits (default Flask limit is 16MB)
- Check file is valid PDF

**Issue: Processing fails**
- Check Gemini API key is configured
- Verify document paths are accessible
- Check extraction service logs for errors
- Verify `phase1_trial_results` table exists

**Issue: Report token doesn't work**
- Verify token in database matches URL
- Check token hasn't been regenerated
- Ensure route `/phase1-report/<token>` is registered

---

## Example SQL Queries

**View all trials:**
```sql
SELECT trial_code, customer_name, customer_company, status, overall_accuracy, stp_rate, created_at
FROM phase1_trials
ORDER BY created_at DESC;
```

**View documents for a trial:**
```sql
SELECT document_category, document_number, original_filename, status
FROM phase1_trial_documents
WHERE trial_id = 1
ORDER BY document_category, document_number;
```

**View results for a trial:**
```sql
SELECT 
    td.original_filename,
    tr.field_accuracy,
    tr.fields_passed,
    tr.fields_flagged,
    tr.stp_eligible,
    tr.requires_human_review
FROM phase1_trial_results tr
JOIN phase1_trial_documents td ON tr.document_id = td.id
WHERE tr.trial_id = 1;
```

**Get trial summary:**
```sql
SELECT 
    trial_code,
    total_documents,
    documents_processed,
    overall_accuracy,
    stp_rate,
    exceptions_count,
    status
FROM phase1_trials
WHERE id = 1;
```
