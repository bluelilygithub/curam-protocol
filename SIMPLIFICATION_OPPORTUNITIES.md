# Simplification Opportunities

## 🔍 Analysis Complete

Based on codebase review, here are opportunities to further simplify:

---

## 1. **Remove Unused Imports in main.py** ⚠️ HIGH IMPACT

### Current Issue:
`main.py` has many imports that are no longer used after refactoring.

**Actually Used:**
- `os` ✅ (lines 126, 131, 204)
- `Flask` ✅ (line 95)
- `request` ✅ (lines 158, 179, 200)
- `render_template` ✅ (line 171)
- `session` ✅ (not directly, but Flask needs it)
- `send_file` ✅ (lines 174, 207)
- `redirect` ✅ (lines 180, 186, 191)
- `genai` ✅ (line 128)
- `SECRET_KEY` ✅ (line 96)
- `FINANCE_UPLOAD_DIR` ✅ (line 131)
- `SAMPLE_TO_DEPT` ✅ (line 201 - wait, actually uses ALLOWED_SAMPLE_PATHS)
- `ALLOWED_SAMPLE_PATHS` ✅ (line 201)
- `abort` ✅ (lines 202, 205)

**Unused (can be removed):**
- `json` ❌
- `re` ❌
- `render_template_string` ❌
- `Response` ❌
- `url_for` ❌
- `send_from_directory` ❌
- `jsonify` ❌
- `pdfplumber` ❌
- `pandas` ❌
- `io` ❌
- `grpc` ❌
- `time` ❌
- `secure_filename` ❌
- `requests` ❌
- `quote` ❌
- All database imports (test_connection, get_document_types_by_sector, engine, get_sectors, get_demo_config_by_department, get_samples_for_template, get_sector_demo_config) ❌
- `text` (SQLAlchemy) ❌
- All validation_service imports ❌
- All formatting imports ❌
- All pdf_service imports ❌
- All gemini_service imports (get_available_models, build_prompt, HTML_TEMPLATE) ❌
- All rag_service imports ❌
- All unused config imports (see below)

**Impact:** Would reduce `main.py` imports from ~30 to ~10

---

## 2. **Remove Unused Config Imports** ⚠️ MEDIUM IMPACT

### Current Issue:
`main.py` imports many config values but only uses a few:

**Actually Used:**
- `SECRET_KEY` ✅ (line 96)
- `FINANCE_UPLOAD_DIR` ✅ (line 131)
- `ALLOWED_SAMPLE_PATHS` ✅ (line 201)

**Unused (used in routes, not main.py):**
- `DEFAULT_DEPARTMENT` ❌ (used in routes/automater_routes.py)
- `DEPARTMENT_SAMPLES` ❌ (used in routes/automater_routes.py)
- `SAMPLE_TO_DEPT` ❌ (not used anywhere - redundant)
- `ROUTINE_DESCRIPTIONS` ❌ (used in routes/automater_routes.py)
- `ROUTINE_SUMMARY` ❌ (used in routes/automater_routes.py)
- `ENGINEERING_PROMPT_LIMIT` ❌ (used in services/gemini_service.py)
- `ENGINEERING_PROMPT_LIMIT_SHORT` ❌ (used in services/gemini_service.py)
- `TRANSMITTAL_PROMPT_LIMIT` ❌ (used in services/gemini_service.py)
- `FINANCE_FIELDS` ❌ (used in services/gemini_service.py)
- `ENGINEERING_BEAM_FIELDS` ❌ (used in services/gemini_service.py)
- `ENGINEERING_COLUMN_FIELDS` ❌ (used in services/gemini_service.py)
- `TRANSMITTAL_FIELDS` ❌ (used in services/gemini_service.py)
- `DOC_FIELDS` ❌ (used in services/gemini_service.py)
- `ERROR_FIELD` ❌ (used in services/gemini_service.py)

**Action:** Remove unused config imports from `main.py`

---

## 3. **Replace SAMPLE_TO_DEPT/ALLOWED_SAMPLE_PATHS with utils/sample_loader** ⚠️ MEDIUM IMPACT

### Current Issue:
- `config.py` has `SAMPLE_TO_DEPT` and `ALLOWED_SAMPLE_PATHS` (lines 68-78)
- These are built dynamically by `utils/sample_loader.py`
- `main.py` still imports them from `config.py` (line 201)

**Solution:**
1. Update `main.py` `/sample` route to use `utils/sample_loader.get_allowed_sample_paths()`
2. Remove `SAMPLE_TO_DEPT` and `ALLOWED_SAMPLE_PATHS` from `config.py`
3. Remove imports from `main.py`

**Impact:** Single source of truth, cleaner config

---

## 4. **Remove Duplicate Section Headers** ✅ LOW RISK

### Current Issue:
`main.py` has duplicate section headers:
- Line 145: `# AUTOMATER & DEMO ROUTES`
- Line 149: `# AUTOMATER & DEMO ROUTES` (duplicate)

**Action:** Remove duplicate

---

## 5. **Remove Old Cleanup Script** ✅ LOW RISK

### File: `cleanup_phases.py`
- **Status:** Old cleanup script for removing commented Phase 3 code
- **Current:** No commented Phase 3 code blocks remain
- **Action:** Can be deleted

---

## 6. **Move /sample Route** ⚠️ LOW PRIORITY

### Current:
- `/sample` route in `main.py` (lines 198-207)
- Small route (~10 lines)

**Options:**
1. Move to `routes/static_pages.py` (fits with other static file serving)
2. Keep in `main.py` (it's small)

**Impact:** Minor cleanup, better organization

---

## 7. **Remove Unused Variables** ✅ LOW RISK

### Current Issue:
- `_available_models` (line 134) - Set but never used
- `google_exceptions` (line 72) - Imported but never used

**Action:** Remove unused variables

---

## 📊 SUMMARY

### Quick Wins (Low Risk, High Impact):
1. ✅ Remove unused imports from `main.py` (~20 imports)
2. ✅ Remove duplicate section header
3. ✅ Delete `cleanup_phases.py`
4. ✅ Remove unused variables (`_available_models`, `google_exceptions`)

### Medium Effort (Some Testing Needed):
5. ⚠️ Replace `SAMPLE_TO_DEPT`/`ALLOWED_SAMPLE_PATHS` with `utils/sample_loader`
6. ⚠️ Remove unused config imports

### Optional (Low Priority):
7. Move `/sample` route to `routes/static_pages.py`

---

## 🎯 RECOMMENDED ORDER

1. **Remove unused imports** (5 min, no risk)
2. **Fix duplicate header** (1 min, no risk)
3. **Delete cleanup script** (1 min, no risk)
4. **Remove unused variables** (1 min, no risk)
5. **Simplify sample loading** (15 min, test needed)
6. **Clean config imports** (10 min, test needed)

**Total time:** ~30 minutes  
**Risk:** Low  
**Impact:** Cleaner, more maintainable code

---

## 📈 EXPECTED RESULTS

**Before:**
- `main.py`: 230 lines with ~30 imports
- Redundant config values
- Old cleanup script

**After:**
- `main.py`: ~200 lines with ~10 imports
- Single source of truth for samples
- Cleaner, more focused code
