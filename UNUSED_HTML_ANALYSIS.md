# Unused HTML Files Analysis

## Files That Can Be Safely Deleted

### 1. `index.html`
- **Status:** ❌ NOT USED
- **Reason:** Root route (`/`) serves `homepage.html` instead
- **Route:** None found
- **Safe to delete:** ✅ YES

### 2. `roi_calculator_improved.html`
- **Status:** ❌ NOT USED
- **Reason:** No route serves this file. ROI calculator uses `/roi.html` and templates in `roi_calculator/templates/`
- **Route:** None found
- **Safe to delete:** ✅ YES

### 3. `roi_report_pdf_template.html`
- **Status:** ❌ NOT USED
- **Reason:** No route serves this file. PDF templates are in `templates/roi_report_pdf.html`
- **Route:** None found
- **Safe to delete:** ✅ YES

### 4. `commercial-guarantee.html`
- **Status:** ❌ NOT USED
- **Reason:** Listed in sitemap but no route serves it
- **Route:** None found
- **Safe to delete:** ✅ YES (or add route if needed)

### 5. `Curam-Ai-Redacted-Tier-2-Strategic-Assessment.html`
- **Status:** ❌ NOT USED
- **Reason:** Listed in sitemap but no route serves it
- **Route:** None found
- **Safe to delete:** ✅ YES (or add route if needed)

### 6. `embed_snippet.html`
- **Status:** ❌ NOT USED
- **Reason:** Only referenced in `rag_service.py` as a file to search, but no route serves it
- **Route:** None found
- **Safe to delete:** ✅ YES

## Files That Are Referenced But May Not Exist

### 7. `phase-2-roadmap.html`
- **Status:** ⚠️ REFERENCED BUT MISSING
- **Route:** `/phase-2-roadmap` and `/phase-2-roadmap.html` in `routes/static_pages.py`
- **Action:** Check if file exists, if not, remove route or create file

### 8. `phase-2-reports.html`
- **Status:** ⚠️ REFERENCED BUT MISSING
- **Route:** `/phase-2-reports` and `/phase-2-reports.html` in `routes/static_pages.py`
- **Action:** Check if file exists, if not, remove route or create file

## Summary

**Files to delete:** 6 files
- index.html
- roi_calculator_improved.html
- roi_report_pdf_template.html
- commercial-guarantee.html
- Curam-Ai-Redacted-Tier-2-Strategic-Assessment.html
- embed_snippet.html

**Files to check:** 2 files
- phase-2-roadmap.html (may need route removed)
- phase-2-reports.html (may need route removed)
