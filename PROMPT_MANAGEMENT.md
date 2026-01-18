# Prompt Management Guide

**Last Updated:** January 2026  
**Purpose:** Complete guide for managing prompts stored in the database

---

## Table of Contents

1. [Overview](#overview)
2. [Quick Start: Updating Prompts](#quick-start-updating-prompts)
3. [Executing SQL Updates](#executing-sql-updates)
4. [Testing Prompt Changes](#testing-prompt-changes)
5. [Troubleshooting](#troubleshooting)

---

## Overview

All prompts are stored in the `prompt_templates` database table. The system uses database prompts with hardcoded fallbacks only if database prompts are not found. Prompts are organized by:

- **Scope:** `universal`, `document_type`, `sector`
- **Document Type:** `beam-schedule` (engineering), `vendor-invoice` (finance), `fta-list` (logistics), `drawing-register` (transmittal)
- **Priority:** Lower numbers are applied first (within same category)
- **Active Status:** Only `is_active = true` prompts are used

**⚠️ IMPORTANT:** Database prompts are currently DISABLED for production accuracy. Code-based prompts in `services/gemini_service.py` are the active system.

**Current Prompt Sizes (Full Content):**
- Engineering: ~48,849 characters
- Finance: ~10,284 characters
- Logistics: ~7,192 characters
- Transmittal: ~3,485 characters

---

## Quick Start: Updating Prompts

### Current System (Code-Based)

For production accuracy (93%+), prompts are maintained in `services/gemini_service.py`.

**To Update:**
1. Edit prompts in `gemini_service.py`
2. Test locally with sample PDFs
3. Verify accuracy (maintain 90%+)
4. Commit and deploy

### Database Prompts (Optional)

If using database prompts:

1. Access database SQL interface
2. Execute SQL file with prompt updates
3. Set `is_active = true` for the prompt

---

## Executing SQL Updates

### Via Database Dashboard

1. Access your database management interface
2. Open SQL query editor
3. Paste SQL update statement
4. Execute

### Via CLI

```bash
# Connect to database and execute SQL file
psql $DATABASE_URL -f update_prompts.sql
```

---

## Testing Prompt Changes

### Quick Test Method

**Step 1: Add a Test Marker**
At the beginning of the prompt text, add:
```
## TEST MARKER - $(date) ##
```

**Step 2: Save and Test**
- Upload a document and run extraction
- Check logs for prompt usage confirmation

**Step 3: Verify Output**
- Check if extraction results match expected format
- Look for test markers in output if added

### Check Logs for Prompt Usage

When processing documents, check logs for:
```
✓ Using database prompt for [department]
→ Using hardcoded fallback for [department]
```

---

## Troubleshooting

### Issue: Prompt Not Being Used

**Check:**
- `is_active = true` for the prompt
- Correct `doc_type` and `scope`
- No syntax errors in prompt text

### Issue: Low Accuracy After Enabling Database Prompts

**Likely Cause:** Database prompts are shorter/simpler than code-based prompts

**Fix:**
- Ensure database prompts match the full 40K+ character prompts
- Or disable database prompts: `UPDATE prompt_templates SET is_active = false;`

### Issue: Wrong Document Type

**Check:**
- `doc_type` values: `beam-schedule`, `vendor-invoice`, `fta-list`, `drawing-register`
- `scope` should be `document_type` for these

---

## Verification Query

Check prompt status:

```sql
SELECT 
    name,
    doc_type,
    scope,
    LENGTH(prompt_text) as length,
    is_active,
    updated_at
FROM prompt_templates
WHERE scope = 'document_type'
ORDER BY name;
```

Expected results:
- Engineering: ~48,849 chars
- Finance: ~10,284 chars
- Logistics: ~7,192 chars
- Transmittal: ~3,485 chars

---

## Important Notes

1. **Code-based prompts are primary** - Database prompts are fallback only
2. **Prompt order matters** - Universal → Document-type → Sector
3. **Test thoroughly** - Accuracy can drop significantly with wrong prompts
4. **Keep database prompts disabled** unless they match code-based quality

---

**Document Version:** 3.0  
**Last Updated:** January 2026
