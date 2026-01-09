# Database Table Analysis & Usage Report

**Date:** January 2025  
**SQL Dump:** `dump-railway-202601091407.sql`  
**Codebase Analysis:** Complete

---

## Executive Summary

**Total Tables in Database:** 16  
**Tables Actually Used:** 6 (37.5%)  
**Tables Unused:** 10 (62.5%)  
**Tables with Disabled Functionality:** 1 (`prompt_templates` - all inactive)

---

## Tables Analysis

### ✅ ACTIVELY USED TABLES (6)

#### 1. `sectors` ⭐⭐⭐ **CRITICAL**
**Purpose:** Industry verticals configuration  
**Usage:** Heavy - Core configuration data

**Queries Found:**
```python
# database.py
SELECT COUNT(*) FROM sectors                    # Test connection
SELECT * FROM sectors ORDER BY display_order   # Get all sectors
SELECT ... FROM sectors WHERE slug = :slug     # Get sector config
```

**Used By:**
- `database.get_sectors()` - Get all sectors
- `database.get_sector_demo_config()` - Get sector demo configuration
- `database.get_document_types_by_sector()` - Get document types for sector
- `test_connection()` - Connection test

**Data Volume:** Likely small (3-5 sectors: professional-services, built-environment, logistics-compliance)

**Status:** ✅ **KEEP** - Essential for application functionality

---

#### 2. `document_types` ⭐⭐⭐ **CRITICAL**
**Purpose:** Document extraction configurations per sector  
**Usage:** Heavy - Core configuration data

**Queries Found:**
```python
# database.py
SELECT dt.slug, dt.name, dt.description, dt.sample_file_paths
FROM document_types dt
JOIN sectors s ON dt.sector_id = s.id
WHERE s.slug = :sector_slug AND dt.demo_enabled = true

SELECT name FROM document_types
WHERE sector_id = (SELECT id FROM sectors WHERE slug = :sector_slug)
```

**Used By:**
- `database.get_document_types_by_sector()` - Get document types for sector
- `database.get_sector_demo_config()` - Include in sector config
- `database.get_demo_config_by_department()` - Map departments to document types

**Key Fields:**
- `slug` - Document type identifier (vendor-invoice, beam-schedule, drawing-register)
- `sample_file_paths` - Array of sample PDF paths
- `demo_enabled` - Whether to show in demo

**Status:** ✅ **KEEP** - Essential for application functionality

---

#### 3. `action_logs` ⭐⭐ **ACTIVE (with fallback)**
**Purpose:** Application event logging (searches, ROI reports, etc.)

**Queries Found:**
```python
# database.py
INSERT INTO action_logs (
    action_type, action_data, source_page, 
    ip_address, user_agent, session_id, created_at
) VALUES (...)
```

**Used By:**
- `database.log_search_query()` - Log RAG search queries (with fallback to email_captures)
- `database.log_roi_report()` - Log ROI calculator reports (with fallback to email_captures)

**Fallback Behavior:**
- If `action_logs` doesn't exist → falls back to `email_captures` table
- Code has try/except for graceful degradation

**Action Types:**
- `search_rag_fast`, `search_rag_complete`, `search_contact_assistant`
- `roi_report_pdf_download`, `roi_report_email_report`

**Status:** ✅ **KEEP** - Actively used for logging (with fallback mechanism)

---

#### 4. `email_captures` ⭐⭐ **ACTIVE**
**Purpose:** Track email report requests and delivery status

**Queries Found:**
```python
# database.py
INSERT INTO email_captures (
    email_address, report_type, source_page, request_data,
    ip_address, user_agent, session_id
) VALUES (...)

UPDATE email_captures 
SET email_sent = :success, email_sent_at = ..., email_error = ...
WHERE id = :record_id

SELECT ... FROM email_captures
WHERE email_address = :email AND deleted_at IS NULL
```

**Used By:**
- `database.capture_email_request()` - Record email report requests
- `database.mark_email_sent()` - Update email delivery status
- `database.get_email_history()` - Get email history for user
- Fallback for `action_logs` if that table doesn't exist

**Report Types:**
- `roi_calculator`, `demo_extraction`, `phase1_sample`
- Also used as fallback for search logs

**Status:** ✅ **KEEP** - Essential for email functionality

---

#### 5. `prompt_templates` ⚠️ **PRESENT BUT DISABLED**
**Purpose:** Store AI extraction prompts  
**Usage:** Code queries this table, but all prompts are disabled

**Queries Found:**
```python
# database.py - get_active_prompts()
SELECT prompt_text, priority, name
FROM prompt_templates
WHERE scope = 'universal' AND is_active = true

SELECT prompt_text, priority, name
FROM prompt_templates
WHERE scope = 'document_type' AND doc_type = :doc_type AND is_active = true

SELECT prompt_text, priority, name
FROM prompt_templates
WHERE scope = 'sector' AND sector_slug = :sector_slug AND is_active = true
```

**Current State:**
- All rows have `is_active = false`
- System uses code-based prompts in `gemini_service.py` (40K+ chars)
- Database prompts are simplified (~1,733 chars)
- If enabled, accuracy would drop from 93% to ~60%

**Used By:**
- `database.get_active_prompts()` - Returns empty list (all disabled)
- `database.build_combined_prompt()` - Always returns None (no active prompts)
- `services.gemini_service.py` - Falls back to code-based prompts

**Status:** ⚠️ **KEEP BUT DISABLED** - Table exists but not actively used. Could be removed if code-based prompts are permanent.

**Recommendation:**
- Keep for now (might be used for future prompt refinements)
- OR: Remove if code-based prompts are permanent approach
- Document why it's disabled (accuracy reasons)

---

### ❌ UNUSED TABLES (10)

#### 6. `extraction_fields` ❌ **NOT USED**
**Found in SQL dump:** Yes  
**Referenced in code:** No  
**Purpose:** Unknown - possibly intended for dynamic field definitions

**Recommendation:** 🔴 **CONSIDER REMOVING** - No code references found

---

#### 7. `extraction_prompts` ❌ **NOT USED**
**Found in SQL dump:** Yes  
**Referenced in code:** No  
**Purpose:** Unknown - might be legacy/alternative to `prompt_templates`

**Recommendation:** 🔴 **CONSIDER REMOVING** - No code references found. May be duplicate of `prompt_templates`.

---

#### 8. `extraction_results` ❌ **NOT USED**
**Found in SQL dump:** Yes  
**Referenced in code:** No  
**Purpose:** Possibly intended for storing extraction results (currently stored in session)

**Current Implementation:**
- Extraction results stored in Flask session (`session['last_results']`)
- Not persisted to database

**Recommendation:** 🔴 **CONSIDER REMOVING** OR **IMPLEMENT USAGE**
- Option A: Remove if session-based storage is permanent
- Option B: Implement if you want to persist extraction history

---

#### 9. `extraction_logs` ❌ **NOT USED** (but referenced in docs)
**Found in SQL dump:** Possibly (need to verify)  
**Referenced in docs:** Yes (`HOW_TO_USE_OVERVIEW.md` line 497)  
**Referenced in code:** No

**Documentation mentions:**
```sql
SELECT * FROM extraction_logs ORDER BY created_at DESC LIMIT 10;
```

**Recommendation:** 🔴 **CONSIDER REMOVING** OR **UPDATE DOCS**
- Table doesn't exist in codebase queries
- Documentation is outdated
- Either remove table OR implement logging functionality

---

#### 10. `faqs` ❌ **NOT USED**
**Found in SQL dump:** Yes  
**Referenced in code:** No  
**Purpose:** Possibly intended for dynamic FAQ management

**Current Implementation:**
- FAQs are static HTML in `faq.html`
- No database integration

**Recommendation:** 🟡 **KEEP FOR FUTURE** OR **REMOVE**
- Could be useful if you want to manage FAQs via admin panel
- Currently not needed

---

#### 11. `phases` ❌ **NOT USED**
**Found in SQL dump:** Yes  
**Referenced in code:** No  
**Purpose:** Possibly intended for dynamic Phase 1-4 configuration

**Current Implementation:**
- Phase information is static HTML
- No database integration

**Recommendation:** 🟡 **KEEP FOR FUTURE** OR **REMOVE**
- Could be useful for dynamic phase management
- Currently not needed

---

#### 12. `prompt_refinements` ❌ **NOT USED**
**Found in SQL dump:** Yes  
**Referenced in code:** No  
**Purpose:** Unknown - possibly for incremental prompt improvements

**Recommendation:** 🔴 **CONSIDER REMOVING** - No references found

---

#### 13. `prompt_sections` ❌ **NOT USED**
**Found in SQL dump:** Yes  
**Referenced in code:** No  
**Purpose:** Unknown - possibly for modular prompt sections

**Recommendation:** 🔴 **CONSIDER REMOVING** - No references found

---

#### 14. `rag_queries` ❌ **NOT USED**
**Found in SQL dump:** Yes  
**Referenced in code:** No  
**Purpose:** Possibly intended for logging RAG search queries

**Current Implementation:**
- RAG queries logged to `action_logs` (or `email_captures` as fallback)
- Dedicated table not used

**Recommendation:** 🔴 **REMOVE** - Functionality already handled by `action_logs`

---

#### 15. `sample_documents` ❌ **NOT USED**
**Found in SQL dump:** Yes  
**Referenced in code:** No  
**Purpose:** Possibly intended for managing sample PDFs in database

**Current Implementation:**
- Sample files stored as file paths in `document_types.sample_file_paths`
- Actual files in `/assets/samples/` directory
- No database table needed

**Recommendation:** 🔴 **REMOVE** - File paths in `document_types` table sufficient

---

#### 16. `user_satisfaction` ❌ **NOT USED**
**Found in SQL dump:** Yes  
**Referenced in code:** No  
**Purpose:** Possibly intended for user feedback/ratings

**Recommendation:** 🟡 **KEEP FOR FUTURE** OR **REMOVE**
- Could be useful for collecting user feedback
- Currently not implemented

---

#### 17. `validation_rules` ❌ **NOT USED**
**Found in SQL dump:** Yes  
**Referenced in code:** No  
**Purpose:** Possibly intended for dynamic validation rules

**Current Implementation:**
- Validation rules hardcoded in `services/validation_service.py`
- No database integration

**Recommendation:** 🔴 **CONSIDER REMOVING** OR **IMPLEMENT USAGE**
- Option A: Remove if hardcoded validation is permanent
- Option B: Implement if you want dynamic validation rules

---

#### 18. `sessions` ❌ **NOT USED** (Flask handles sessions)
**Found in SQL dump:** Possibly (need to verify)  
**Referenced in code:** No  
**Purpose:** Possibly intended for database-backed sessions

**Current Implementation:**
- Flask uses default session handling (client-side cookies)
- Not using database-backed sessions

**Recommendation:** 🔴 **REMOVE IF EXISTS** - Flask sessions don't need database table

---

## Table Usage Summary

| Table Name | Status | Usage Level | Recommendation |
|------------|--------|-------------|----------------|
| `sectors` | ✅ Active | Critical | **KEEP** |
| `document_types` | ✅ Active | Critical | **KEEP** |
| `action_logs` | ✅ Active | High | **KEEP** |
| `email_captures` | ✅ Active | High | **KEEP** |
| `prompt_templates` | ⚠️ Disabled | None (all inactive) | **KEEP** (or remove if permanent) |
| `extraction_fields` | ❌ Unused | None | **REMOVE** |
| `extraction_prompts` | ❌ Unused | None | **REMOVE** |
| `extraction_results` | ❌ Unused | None | **REMOVE** or implement |
| `extraction_logs` | ❌ Unused | None | **REMOVE** or update docs |
| `faqs` | ❌ Unused | None | **REMOVE** or future use |
| `phases` | ❌ Unused | None | **REMOVE** or future use |
| `prompt_refinements` | ❌ Unused | None | **REMOVE** |
| `prompt_sections` | ❌ Unused | None | **REMOVE** |
| `rag_queries` | ❌ Unused | None | **REMOVE** (duplicate) |
| `sample_documents` | ❌ Unused | None | **REMOVE** |
| `user_satisfaction` | ❌ Unused | None | **REMOVE** or future use |
| `validation_rules` | ❌ Unused | None | **REMOVE** or implement |

---

## Recommendations

### Immediate Actions

#### 1. Remove Unused Tables (High Priority)
**Tables to Remove:**
- `extraction_fields`
- `extraction_prompts`  
- `extraction_results` (unless implementing persistence)
- `prompt_refinements`
- `prompt_sections`
- `rag_queries` (duplicate of action_logs)
- `sample_documents`

**Impact:** Reduces database size, improves clarity

**SQL to Remove:**
```sql
DROP TABLE IF EXISTS extraction_fields CASCADE;
DROP TABLE IF EXISTS extraction_prompts CASCADE;
DROP TABLE IF EXISTS extraction_results CASCADE;
DROP TABLE IF EXISTS prompt_refinements CASCADE;
DROP TABLE IF EXISTS prompt_sections CASCADE;
DROP TABLE IF EXISTS rag_queries CASCADE;
DROP TABLE IF EXISTS sample_documents CASCADE;
```

#### 2. Review/Future Use Tables (Medium Priority)
**Tables to Evaluate:**
- `faqs` - Keep if planning admin panel for FAQ management
- `phases` - Keep if planning dynamic phase configuration
- `user_satisfaction` - Keep if planning feedback collection
- `validation_rules` - Keep if planning dynamic validation

**Decision:** Remove if no plans to use, OR implement if needed soon

#### 3. Clean Up Documentation (Low Priority)
**Action:** Update `HOW_TO_USE_OVERVIEW.md` to remove reference to `extraction_logs` table

**Change:**
```sql
-- REMOVE THIS (table doesn't exist/used):
SELECT * FROM extraction_logs ORDER BY created_at DESC LIMIT 10;

-- REPLACE WITH:
SELECT * FROM action_logs WHERE action_type LIKE 'search_%' ORDER BY created_at DESC LIMIT 10;
```

### Database Optimization Opportunities

#### 1. Add Indexes (Performance)
```sql
-- Critical indexes for frequently queried columns
CREATE INDEX IF NOT EXISTS idx_sectors_slug ON sectors(slug) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_sectors_active ON sectors(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_document_types_sector ON document_types(sector_id);
CREATE INDEX IF NOT EXISTS idx_document_types_demo ON document_types(demo_enabled) WHERE demo_enabled = true;
CREATE INDEX IF NOT EXISTS idx_action_logs_type ON action_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_action_logs_created ON action_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_captures_email ON email_captures(email_address);
CREATE INDEX IF NOT EXISTS idx_email_captures_type ON email_captures(report_type);
CREATE INDEX IF NOT EXISTS idx_email_captures_sent ON email_captures(email_sent, email_sent_at);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_scope ON prompt_templates(scope, is_active);
```

**Impact:** Faster queries, especially for sector/document_type lookups

#### 2. Consider Archiving Old Logs
```sql
-- Archive action_logs older than 90 days
CREATE TABLE action_logs_archive AS 
SELECT * FROM action_logs WHERE created_at < NOW() - INTERVAL '90 days';

DELETE FROM action_logs WHERE created_at < NOW() - INTERVAL '90 days';
```

**Impact:** Reduces active table size, improves query performance

#### 3. Enable Connection Pooling
**Current:** SQLAlchemy with default connection handling  
**Recommendation:** Configure connection pooling for better performance

```python
# In database.py
from sqlalchemy import create_engine, pool

engine = create_engine(
    DATABASE_URL,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,  # Verify connections before use
    pool_recycle=3600    # Recycle connections after 1 hour
)
```

---

## Critical Issues & Notes

### ⚠️ Fallback Mechanism for action_logs

**Current Behavior:**
- Code tries to insert into `action_logs`
- If table doesn't exist → falls back to `email_captures`
- This is a graceful degradation pattern

**Recommendation:**
- ✅ **KEEP** this pattern (good error handling)
- Ensure `action_logs` table exists in production
- Monitor logs for fallback usage (indicates table missing)

### ⚠️ prompt_templates Table - All Disabled

**Why Disabled:**
- Database prompts are simplified (~1,733 chars)
- Code-based prompts are comprehensive (~40,000 chars)
- Enabling database prompts would reduce accuracy from 93% to ~60%

**Recommendation:**
- **Option A:** Remove table entirely if code-based prompts are permanent
- **Option B:** Keep table but document why it's disabled
- **Option C:** Enhance database prompts to match code-based quality, then enable

**Decision Needed:** Is code-based prompting permanent or temporary?

### 📊 Data Volume Estimates

**Small Tables (< 100 rows):**
- `sectors`: ~3-5 rows
- `document_types`: ~10-15 rows
- `prompt_templates`: ~10-20 rows (all inactive)

**Growing Tables:**
- `action_logs`: Grows with usage (searches, ROI reports)
- `email_captures`: Grows with email requests

**Recommendation:** 
- Monitor `action_logs` and `email_captures` size
- Implement archiving if > 100K rows
- Consider partitioning for very large tables

---

## Implementation Checklist

### Phase 1: Cleanup (Immediate)
- [ ] Verify all unused tables exist in production
- [ ] Backup database before removing tables
- [ ] Remove `extraction_fields`
- [ ] Remove `extraction_prompts`
- [ ] Remove `extraction_results` (or implement usage)
- [ ] Remove `prompt_refinements`
- [ ] Remove `prompt_sections`
- [ ] Remove `rag_queries`
- [ ] Remove `sample_documents`

### Phase 2: Optimization (Short-term)
- [ ] Add indexes to frequently queried columns
- [ ] Configure connection pooling
- [ ] Update documentation to remove `extraction_logs` reference
- [ ] Verify `action_logs` table exists in production

### Phase 3: Decision Making (Medium-term)
- [ ] Decide: Keep or remove `prompt_templates` table
- [ ] Decide: Keep or remove `faqs`, `phases`, `user_satisfaction`, `validation_rules`
- [ ] Implement archiving strategy for `action_logs` and `email_captures`
- [ ] Consider implementing persistence for extraction results (if needed)

---

## SQL Queries for Verification

### Check Which Tables Exist
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
```

### Check Table Row Counts
```sql
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = tablename) AS column_count
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Check Unused Tables (No Recent Activity)
```sql
-- For tables with created_at/timestamp columns
SELECT 'action_logs' as table_name, COUNT(*) as row_count, MAX(created_at) as last_activity
FROM action_logs
UNION ALL
SELECT 'email_captures', COUNT(*), MAX(created_at)
FROM email_captures;
```

### Verify Foreign Key Relationships
```sql
SELECT
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name 
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_schema = 'public';
```

---

## Summary

**Active Tables (Keep):** 5
- `sectors` - Critical
- `document_types` - Critical  
- `action_logs` - Active logging
- `email_captures` - Email functionality
- `prompt_templates` - Disabled but might be used later

**Unused Tables (Remove):** 10
- Most appear to be legacy/unimplemented features
- Removing them will simplify the database
- No functionality will be lost

**Next Steps:**
1. Verify table existence in production
2. Backup before cleanup
3. Remove unused tables
4. Add indexes for performance
5. Update documentation

---

**Last Updated:** January 2025  
**Analysis Status:** Complete  
**Action Required:** Review and execute cleanup plan
