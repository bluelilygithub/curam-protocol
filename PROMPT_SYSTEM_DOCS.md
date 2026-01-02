# Prompt System Documentation

## Overview

The application has a **dual-prompt system**:

1. **Database Prompts** (`prompt_templates` table) - Database-driven, can be toggled on/off
2. **Code-based Prompts** (`gemini_service.py`) - Hardcoded fallback with extensive rules

---

## How Prompts Are Loaded

**Priority Order (see `gemini_service.py` line 110-122):**

1. **Try database first:** If `prompt_templates` has active prompts → use those
2. **Fallback to code:** If database fails or returns nothing → use hardcoded prompts

**Code logic:**
```python
db_prompt = build_combined_prompt(doc_type, sector_slug, text)
if db_prompt:
    return db_prompt  # Database wins
else:
    return HARDCODED_PROMPT  # Fallback
```

---

## Current Configuration (as of 2025-01-02)

### Database Prompts - DISABLED

All database prompts are **disabled** (`is_active = false`) to use the superior code-based prompts.

**Reason:** Database prompts were simplified versions (~1,733 chars) that lacked critical extraction rules.

**To verify current state:**
```sql
SELECT name, scope, is_active, LENGTH(prompt_text) as chars 
FROM prompt_templates
ORDER BY name;
```

**Expected:** All rows show `is_active = false`

---

## Prompt Comparison

### Database Prompt (engineering_extraction_rules)
- **Size:** 1,733 characters
- **Capabilities:** Basic extraction rules
- **Status:** DISABLED (too simplified)

### Code-based Prompt (gemini_service.py lines 124-3015)
- **Size:** ~40,000 characters
- **Capabilities:**
  - Universal extraction principles
  - OCR error correction (I vs 1, O vs 0)
  - Strikethrough text handling
  - Handwritten annotation detection
  - Character soup detection
  - Multi-part comment extraction
  - Partial extraction before marking illegible
  - Cross-field validation
  - Section header detection
- **Status:** ACTIVE (currently in use)

---

## How to Enable/Disable Database Prompts

### Check Current Status
```sql
SELECT name, scope, is_active, LENGTH(prompt_text) as chars 
FROM prompt_templates;
```

### Disable a Prompt (Use Code-based Instead)
```sql
UPDATE prompt_templates 
SET is_active = false 
WHERE name = 'engineering_extraction_rules';
```

### Enable a Prompt (Use Database Version)
```sql
UPDATE prompt_templates 
SET is_active = true 
WHERE name = 'engineering_extraction_rules';
```

⚠️ **WARNING:** Only enable database prompts if they contain the full extraction logic. The current database prompts are simplified and will reduce accuracy from 93% to ~60%.

---

## Testing Which Prompt is Active

### Method 1: Check Application Logs

Run extraction and check the action log for:
- ✓ `"Using database prompt for engineering"` → Database prompt is active
- ⚠ `"Using hardcoded fallback for engineering"` → Code-based prompt is active

### Method 2: Test Extraction Quality

**Database prompt (simplified) typically shows:**
- Missing handwritten annotations
- Incorrect strikethrough handling
- More "N/A" values
- Lower accuracy (~60-70%)

**Code-based prompt (elite) typically shows:**
- Handwritten text captured: `[handwritten: "CHANGED TO 310UC137"]`
- Strikethrough rows marked: `[row deleted - strikethrough]`
- Partial extractions: `"Install per spec [coffee stain obscures remainder]"`
- Higher accuracy (~93%)

---

## Future: Hybrid Approach

**Recommended strategy:**

1. **Keep core rules in code** (`gemini_service.py`)
   - Universal principles
   - OCR correction logic
   - Complex handling rules

2. **Use database for refinements** (`prompt_templates` table)
   - Industry-specific tweaks
   - Edge case fixes
   - Quick adjustments without deployment

3. **Modify `build_combined_prompt`** to append database snippets instead of replacing:
   ```python
   # Instead of: return db_prompt
   # Do: return CODE_BASE_PROMPT + db_refinements + text
   ```

**This gives:**
- ✅ Version control for core logic (git)
- ✅ Quick tweaks without deployment (database)
- ✅ Best of both worlds

---

## Troubleshooting

### Problem: Extraction accuracy suddenly dropped from 93% to 60%

**Cause:** Database prompt was accidentally enabled

**Fix:**
```sql
UPDATE prompt_templates SET is_active = false WHERE scope = 'engineering';
```

### Problem: Can't tell which prompt is being used

**Fix:** Check application logs for "Using database prompt" vs "Using hardcoded fallback"

### Problem: Want to test database prompt without breaking production

**Fix:** 
1. Create a test document type in database
2. Enable prompt only for test type
3. Test separately before enabling for production

---

## Change Log

### 2025-01-02: Disabled Database Prompts
- **Action:** Set `is_active = false` for all engineering prompts
- **Reason:** Database prompts were simplified (~1,733 chars) vs code-based (~40,000 chars)
- **Impact:** Accuracy remains at 93% using elite code-based prompts
- **Reference:** Landmine 1 fix from pre-demo checklist

---

## Related Documentation

- `ARCHITECTURE_NOTES.md` - Overall system architecture
- `DATABASE_QUICK_REF.md` - Database management commands
- `PRE_DEMO_CHECKLIST.md` - Verification steps before client demos
- `gemini_service.py` lines 124-3015 - Full code-based prompt
