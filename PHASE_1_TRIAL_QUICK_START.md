# Phase 1 Trial System - Quick Start Guide

## Overview

This system allows you to manage customer Phase 1 trials directly from the admin area. When a customer provides 15 documents for testing, you can:

1. Create a trial record
2. Upload their documents (organized into 3 categories)
3. Process documents through your extraction pipeline
4. Generate a private, secure report
5. Share the report link with the customer

---

## Setup (One-Time)

### Step 1: Run Database Migration

Execute the SQL script to create the necessary tables:

```bash
# Via Railway CLI
railway run psql < database_setup_phase1_trials.sql

# OR via Railway Dashboard
# 1. Go to PostgreSQL service
# 2. Click "Query" tab  
# 3. Copy/paste contents of database_setup_phase1_trials.sql
# 4. Click "Execute"
```

This creates:
- `phase1_trials` table
- `phase1_trial_documents` table  
- `phase1_trial_results` table
- Helper functions (`generate_trial_code()`, `generate_report_token()`)

### Step 2: Verify Routes

The admin routes are already added to `routes/admin_routes.py`. Ensure your Flask app registers the admin blueprint (should already be done in `main.py`).

---

## Workflow: Creating a Phase 1 Trial

### Step 1: Create Trial

1. Log into admin: `https://yourdomain.com/admin`
2. Navigate to **"Phase 1 Trials"** in sidebar
3. Click **"+ Create New Trial"**
4. Fill in customer information:
   - **Customer Name** (required)
   - **Customer Email** (optional)
   - **Company Name** (optional)
   - **Industry** (e.g., "Engineering", "Accounting")
   - **Sector** (dropdown from database)
   - **Notes** (internal notes)
5. Click **"Create Trial"**

**Result:** System generates:
- Unique trial code (e.g., "P1-2025-001")
- Secure report token (64-character hex string)
- Trial record in database

---

### Step 2: Upload Documents

1. On the trial detail page, you'll see 3 upload sections (Category 1, 2, 3)
2. For each category:
   - Click "Click to Upload or Drag & Drop"
   - Select up to 5 PDF files at once
   - Files are automatically saved to `uploads/phase1_trials/<trial_id>/`
3. Repeat for all 3 categories until you have 15 documents total

**File Organization:**
- Category 1: Documents 1-5
- Category 2: Documents 6-10  
- Category 3: Documents 11-15

**Note:** Documents should represent "worst-case" scenarios, not cherry-picked clean examples.

---

### Step 3: Process Documents

1. Once all 15 documents are uploaded, click **"🚀 Process All Documents"**
2. System processes each document:
   - Extracts text via `pdf_service.py`
   - Runs AI analysis via `gemini_service.py`
   - Calculates confidence scores
   - Validates fields
   - Determines STP eligibility
3. Results are saved to `phase1_trial_results` table

**⚠️ Important:** The `/admin/phase1-trials/<id>/process` route currently returns a placeholder. You need to integrate it with your existing extraction pipeline (see "Integration" section below).

---

### Step 4: Review Results

After processing, the system automatically calculates:

1. **Test 1: Field Extraction Accuracy**
   - Average accuracy across all 15 documents
   - Target: ≥90% (PASS)

2. **Test 2: STP Rate**
   - Percentage of documents eligible for straight-through processing
   - Target: ≥60% (PASS)

3. **Test 3: Exception Handling**
   - Count of documents flagged for human review
   - Validates "safe failure" mode

The trial detail page shows:
- Overall metrics
- Document-level results
- Field-level confidence scores
- Validation errors (if any)
- Recommendation (PASS/FAIL)

---

### Step 5: Share Private Report

1. Once processing is complete, the report link appears at the bottom of the trial detail page
2. Copy the **Private Report URL**:
   ```
   https://yourdomain.com/phase1-report/<64-character-token>
   ```
3. Share this link with the customer:
   - Email it directly
   - Or use the "Email Link" button (requires customer email)

**Security:**
- No login required for customer
- Token provides private access
- Token is not guessable (64-character random hex)
- Only works for this specific trial

---

## Routes Reference

| URL | Method | Access | Purpose |
|-----|--------|--------|---------|
| `/admin/phase1-trials` | GET | Admin | List all trials |
| `/admin/phase1-trials/create` | GET/POST | Admin | Create new trial |
| `/admin/phase1-trials/<id>` | GET | Admin | View trial details |
| `/admin/phase1-trials/<id>/upload` | POST | Admin | Upload documents (AJAX) |
| `/admin/phase1-trials/<id>/process` | POST | Admin | Process documents ⚠️ **NEEDS IMPLEMENTATION** |
| `/admin/phase1-trials/<id>/report` | GET | Admin | Admin view of report |
| `/phase1-report/<token>` | GET | **Public** | Customer-facing report (token-based) |

---

## Integration: Document Processing

The `/admin/phase1-trials/<id>/process` route needs to be implemented to integrate with your existing extraction services.

**Current Status:** Placeholder route exists but doesn't actually process documents.

**Required Implementation:**

```python
@admin_bp.route('/phase1-trials/<int:trial_id>/process', methods=['POST'])
@require_admin
def phase1_trial_process(trial_id):
    """Process documents in a Phase 1 trial"""
    trial = get_phase1_trial(trial_id=trial_id)
    if not trial:
        return jsonify({"success": False, "error": "Trial not found"}), 404
    
    documents = get_trial_documents(trial_id)
    
    for doc in documents:
        if doc.get('status') == 'uploaded':
            # Update status to processing
            # ... update database ...
            
            try:
                # 1. Extract text from PDF
                from services.pdf_service import extract_text
                text = extract_text(doc['stored_file_path'])
                
                # 2. Run AI analysis (determine document type and extract fields)
                from services.gemini_service import analyze_gemini
                # You'll need to determine document_type based on trial's sector
                # or allow manual selection
                result = analyze_gemini(text, doc_type='...', sector=...)
                
                # 3. Calculate metrics
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
                
                # 4. Save result
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
                
            except Exception as e:
                # Handle errors
                print(f"Error processing document {doc['id']}: {e}")
                # Update document status to 'failed'
                # ...
    
    return jsonify({
        "success": True,
        "message": f"Processed {len(documents)} documents"
    })
```

**Key Integration Points:**
- Use existing `services/pdf_service.py` for text extraction
- Use existing `services/gemini_service.py` for AI analysis
- Use existing `services/validation_service.py` for validation
- Save results using `save_trial_result()` function from `database.py`

---

## File Storage

**Location:** `uploads/phase1_trials/<trial_id>/`

**Structure:**
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

**Security:**
- Add to `.gitignore` if not already:
  ```
  uploads/phase1_trials/
  ```

---

## Database Functions Reference

All functions are in `database.py`:

- `create_phase1_trial(...)` - Create new trial
- `get_phase1_trial(trial_id=None, trial_code=None, report_token=None)` - Get trial by ID/code/token
- `get_all_phase1_trials(limit, offset, status_filter)` - List trials
- `add_trial_document(...)` - Add document to trial
- `get_trial_documents(trial_id)` - Get all documents for trial
- `save_trial_result(...)` - Save extraction results
- `get_trial_results(trial_id)` - Get all results for trial

---

## Troubleshooting

**Issue: Trial creation fails**
- Check database connection
- Verify `phase1_trials` table exists
- Check that `generate_trial_code()` function exists in database

**Issue: File upload fails**
- Check `uploads/phase1_trials/` directory exists and is writable
- Verify Flask file size limits (default 16MB)
- Check file is valid PDF

**Issue: Report token doesn't work**
- Verify token in database matches URL
- Ensure route `/phase1-report/<token>` is registered (no `@require_admin` decorator)
- Check token hasn't been regenerated

**Issue: Processing fails**
- Check Gemini API key is configured
- Verify document paths are accessible
- Check extraction service logs
- Ensure `phase1_trial_results` table exists

---

## Next Steps

1. ✅ Database schema created
2. ✅ Admin routes created
3. ✅ Templates created
4. ⏳ **TODO: Implement document processing integration** (see "Integration" section above)
5. ⏳ Test with sample documents
6. ⏳ Add PDF report generation (optional)
7. ⏳ Add email notifications (optional)

---

## Example: Complete Workflow

**Customer:** "Acme Engineering" sends 15 CAD schedules

1. **Admin creates trial:**
   - Name: "John Smith"
   - Email: "john@acme-eng.com"
   - Company: "Acme Engineering"
   - Industry: "Engineering"
   - Sector: "built-environment"
   - → Trial: **P1-2025-001** with token `a1b2c3d4...`

2. **Admin uploads documents:**
   - Category 1: 5 beam schedule PDFs
   - Category 2: 5 column schedule PDFs
   - Category 3: 5 mixed schedule PDFs
   - → All saved to `uploads/phase1_trials/1/`

3. **Admin processes documents:**
   - Click "Process All Documents"
   - System extracts and analyzes each PDF
   - Results saved with metrics

4. **System calculates:**
   - Test 1: 94.2% accuracy ✅
   - Test 2: 73% STP rate ✅
   - Test 3: 2 exceptions flagged ✅
   - → **Recommendation: PROCEED TO PHASE 2**

5. **Share report:**
   - Send customer: `https://yourdomain.com/phase1-report/a1b2c3d4...`
   - Customer views detailed report (no login needed)
   - Customer sees all test results and recommendation

---

## Support

For detailed technical information, see:
- `PHASE_1_TRIAL_WORKFLOW.md` - Complete workflow documentation
- `database_setup_phase1_trials.sql` - Database schema
- `routes/admin_routes.py` - Admin routes implementation
- `database.py` - Database functions
