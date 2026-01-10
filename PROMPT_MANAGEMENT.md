# Prompt Management Guide

**Last Updated:** January 2025  
**Purpose:** Complete guide for managing prompts stored in the database

---

## Table of Contents

1. [Overview](#overview)
2. [Quick Start: Updating Prompts](#quick-start-updating-prompts)
3. [Executing SQL Updates](#executing-sql-updates)
4. [Testing Prompt Changes](#testing-prompt-changes)
5. [Troubleshooting](#troubleshooting)
6. [Diagnostic Tools](#diagnostic-tools)

---

## Overview

All prompts are stored in the `prompt_templates` database table. The system uses database prompts with hardcoded fallbacks only if database prompts are not found. Prompts are organized by:

- **Scope:** `universal`, `document_type`, `sector`
- **Document Type:** `beam-schedule` (engineering), `vendor-invoice` (finance), `fta-list` (logistics), `drawing-register` (transmittal)
- **Priority:** Lower numbers are applied first (within same category)
- **Active Status:** Only `is_active = true` prompts are used

**Current Prompt Sizes (Full Content):**
- Engineering: ~48,849 characters
- Finance: ~10,284 characters
- Logistics: ~7,192 characters
- Transmittal: ~3,485 characters

---

## Quick Start: Updating Prompts

### 3-Step Process

**Step 1: Access Railway Database SQL Interface**
- Go to https://railway.app
- Click your project → PostgreSQL database
- Look for **"Query"**, **"Connect"**, or **"SQL"** button/tab
- Click it to open SQL editor

**Step 2: Execute the SQL File**
1. Open the SQL update file on your computer (e.g., `update_prompts_to_full.sql`)
2. Select ALL (Ctrl+A)
3. Copy (Ctrl+C)
4. Paste into Railway SQL editor
5. Click **"Run"** or **"Execute"**

**Step 3: Verify**
- Refresh `/admin/prompts` page
- Check Length column - should show expected sizes:
  - Engineering: **48,849** chars (was ~1,865)
  - Finance: **10,284** chars (was ~1,342)
  - Logistics: **7,192** chars (was ~2,254)
  - Transmittal: **3,485** chars (was ~1,944)

---

## Executing SQL Updates

### Method 1: Railway Dashboard (Easiest - No CLI Needed)

1. **Get to Railway Database**
   - Go to https://railway.app
   - Log in to your account
   - Click on your **project**
   - Find and click on your **PostgreSQL database service**

2. **Access SQL Query Interface**
   - Look for **"Query"**, **"Data"**, or **"SQL"** tab → Click to open SQL editor
   - OR look for **"Connect"** button → May open web-based SQL editor, connection details, or terminal

3. **Execute the SQL**
   - Open the SQL file on your computer (e.g., `update_prompts_to_full.sql`)
   - Copy the **ENTIRE contents** (all lines)
   - Paste into the SQL editor in Railway
   - Click **"Run"**, **"Execute"**, or press Ctrl+Enter
   - Wait for completion (may take 10-30 seconds due to large prompts)

4. **Verify**
   - Check success messages for each UPDATE
   - Verification query results showing new lengths
   - Refresh admin panel at `/admin/prompts` - lengths should be updated

### Method 2: Railway CLI

If you have Railway CLI installed:

```bash
# 1. Make sure you're in the project directory
cd C:\Users\micha\Local Sites\curam-protocol

# 2. Link to your Railway project (if not already linked)
railway link

# 3. Execute the SQL file
railway run psql < update_prompts_to_full.sql
```

This will:
- Connect to your Railway PostgreSQL database
- Execute all SQL statements
- Show results in the terminal

### Method 3: Direct PostgreSQL Connection

If you have direct database access:

```bash
# Get connection string from Railway dashboard
# Format: postgresql://user:pass@host:port/dbname

# Then run:
psql "your-connection-string" -f update_prompts_to_full.sql
```

### Method 4: Database GUI Tool

Tools like **pgAdmin**, **DBeaver**, or **TablePlus**:

1. Connect to your Railway database using connection details from Railway dashboard
2. Open a SQL query window
3. Copy/paste the entire contents of the SQL file
4. Execute the query

### Method 5: Python Script (For Specific Prompts)

For running specific prompt updates programmatically:

```bash
# First install dependencies
pip install sqlalchemy psycopg2-binary

# Then run the script
python run_logistics_prompt_sql.py  # Example for logistics
```

---

## Testing Prompt Changes

### Quick Test Method

**Step 1: Edit a Prompt**
1. Go to `/admin/prompts`
2. Click **"Edit"** on any active prompt
3. Scroll down to the **"Prompt Text"** textarea

**Step 2: Add a Test Marker**
At the very beginning of the prompt text (before everything else), add:

```
## TEST MARKER - ADMIN PANEL UPDATE - $(date) ##
```

Or simpler:
```
TEST_12345 - This prompt was edited via admin panel
```

**Step 3: Save the Change**
1. Click **"Save Changes"**
2. You should see: "Prompt updated successfully"

**Step 4: Verify It's Working**

**Method 1: Check Logs (Recommended)**
- Upload a document and run an extraction
- Check your application logs (Railway logs, console output)
- You should see: `✓ Using database prompt for [department] (db: [doc-type])`
- If you see: `→ Using hardcoded fallback for [department]` - then the database prompt isn't being used

**Method 2: Make the Change More Obvious**
Instead of just a marker, add this at the very top:

```
IMPORTANT: Return all amounts with the word "TESTED" appended to each amount.
Example: "$100.50" should become "$100.50 TESTED"
```

Then test with a finance document extraction and check if amounts have "TESTED" appended.

**Method 3: Change Output Format**
Add this instruction near the end of the prompt (before "TEXT:"):

```
## TEST INSTRUCTION ##
Add a field called "test_marker" with value "admin_panel_works" to every JSON object returned.
```

Then run an extraction and check if the JSON output includes `"test_marker": "admin_panel_works"`.

### Recommended Tests by Prompt Type

**For `universal_core_principles`:**
- Applies to ALL document types
- Easiest to test - any document will use it
- Add marker at beginning, upload ANY document, check logs

**For `finance_extraction_rules`:**
- Upload a finance/invoice document
- Check logs for: `✓ Using database prompt for finance`
- Verify extraction uses updated prompt

**For `logistics_extraction_rules` (fta-list):**
- Upload a logistics document (FTA list, bill of lading, etc.)
- Check logs for: `✓ Using database prompt for logistics (db: fta-list)`
- Note: System searches for `doc_type IN ('fta-list', 'logistics')` and has fallback to search by name

---

## Troubleshooting

### Issue: "Table doesn't exist"

**Check:**
- Make sure you're connected to the correct database
- The `prompt_templates` table should exist if you've used the admin panel

**Fix:**
- Run database setup scripts if needed
- Verify database connection

### Issue: "Permission denied"

**Check:**
- Database user has UPDATE permissions
- Railway should have this by default

**Fix:**
- Check Railway database user permissions
- Contact Railway support if needed

### Issue: "No rows updated"

**Check:**
- The WHERE clause matches your prompt names:
  ```sql
  -- First, see what names exist:
  SELECT name, doc_type FROM prompt_templates WHERE scope = 'document_type';
  ```
- The SQL uses `WHERE name = 'engineering_extraction_rules'` etc.
- If your names are different, adjust the WHERE clause

**Fix:**
- Verify prompt names in database match SQL WHERE clause
- Update SQL file if names don't match

### Issue: "SQL syntax error"

**Check:**
- The file uses PostgreSQL dollar-quoting which should work
- Railway's SQL editor should handle it

**Fix:**
- If Railway's SQL editor has issues, try Railway CLI (Method 2) instead
- Or use database GUI tool (Method 4)

### Issue: "File too large"

**Check:**
- SQL file is large (~70KB) due to full prompts
- Most SQL editors can handle this

**Fix:**
- If your editor can't handle it:
  - Split into separate files (one per prompt)
  - Or use CLI method
  - Or use database GUI tool

### Issue: Prompt Not Active

**Check:**
- Is the prompt **Active**? (Should show green "Active" badge in `/admin/prompts`)

**Fix:**
- Click "Activate" button next to the prompt in admin panel

### Issue: Wrong Document Type

**Check:**
- Database has: `doc_type = 'fta-list'` or `doc_type = 'logistics'`
- Code looks for: `doc_type IN ('fta-list', 'logistics')`
- Should work with current code, but verify

**Fix:**
- Verify `doc_type` matches expected values
- System has fallback to search by name if `doc_type` doesn't match

### Issue: Wrong Scope

**Check:**
- Should be: `scope = 'document_type'` (not `universal` or `sector`)

**Fix:**
- Update scope in admin panel or via SQL

### Issue: Still Using Hardcoded Prompts

**Check:**
- Logs show: `→ Using hardcoded fallback for [department]`
- This means database prompt not found

**Fix:**
- Verify prompt exists with correct `doc_type` and `scope`
- Check `is_active = true`
- Verify prompt name matches what code expects
- Use diagnostic tools (see below)

### Issue: Logistics Prompt Not Found

**Check:**
The system searches for logistics prompts with:
- `doc_type IN ('fta-list', 'logistics')`
- `scope = 'document_type'`
- `is_active = true`

**Fallback:**
If not found by `doc_type`, system will search by name pattern:
- `name ILIKE '%logistics%'` OR `name ILIKE '%fta%'` OR `name ILIKE '%trade%'`

**Fix:**
- Check logs for diagnostic output showing what prompts exist
- Verify logistics prompt has correct `doc_type` value
- Ensure `is_active = true`

### Issue: Files Disappear After Deployment

**Note:** SQL files committed to git don't execute automatically. You must run them in the database after each deployment if needed.

---

## Diagnostic Tools

### Verification Query

After running SQL updates, verify with:

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
- `engineering_extraction_rules`: ~48,849 chars
- `finance_extraction_rules`: ~10,284 chars
- `logistics_extraction_rules`: ~7,192 chars
- `transmittal_extraction_rules`: ~3,485 chars

If you still see small numbers (1,000-2,000 chars), the SQL didn't execute successfully.

### Check What Prompts Exist

```sql
-- See all document_type prompts:
SELECT name, scope, doc_type, is_active, LENGTH(prompt_text) as len
FROM prompt_templates
WHERE scope = 'document_type'
ORDER BY doc_type, name;

-- See logistics-related prompts (any scope):
SELECT name, scope, doc_type, is_active
FROM prompt_templates
WHERE (name ILIKE '%logistics%' OR name ILIKE '%fta%' OR name ILIKE '%trade%')
ORDER BY scope, doc_type;
```

### Python Diagnostic Script

Run `check_logistics_prompt.py` to check logistics prompt status:

```bash
python check_logistics_prompt.py
```

This will show:
- Prompt ID, name, scope, doc_type
- Prompt length and preview
- Active status
- Creation date

### Check Logs for Prompt Usage

When processing documents, check Railway logs for:

```
🔍 [get_active_prompts] Searching for doc_type=fta-list with values: ['fta-list', 'logistics']
✓ Found 1 active database prompt(s) for doc_type=fta-list
⚠️ WARNING: No document-type prompts found for doc_type=fta-list! This may cause extraction errors.
```

If you see warnings about missing prompts, use the diagnostic queries above to check what's actually in the database.

---

## What SQL Files Do

The SQL update files contain:

1. **UPDATE statements** for each prompt type:
   - Updates prompt text with full content (40K+ chars for engineering)
   - Uses PostgreSQL dollar-quoting (`$TAG$...$TAG$`) to safely handle special characters
   - Updates `updated_at` timestamp

2. **Verification queries** to show new lengths after update

3. **ON CONFLICT handling** (for INSERT-based files):
   - Some files use `INSERT ... ON CONFLICT DO UPDATE` pattern
   - This ensures prompts are updated if they exist, or inserted if new

---

## Admin Panel Updates

### Via Admin Panel

You can also edit prompts directly in `/admin/prompts`:

1. Click "Edit" on any prompt
2. Modify the prompt text
3. Click "Save Changes"

**Limitations:**
- For very large prompts (48K+ chars), this can be tedious
- Better to use SQL files for bulk updates
- Admin panel is good for small edits or testing

### Checking Active Status

In `/admin/prompts`, verify:
- ✅ **Status**: Green "Active" badge (not yellow "Inactive")
- ✅ **Scope**: `document_type`, `universal`, or `sector`
- ✅ **Document Type**: Should match expected values (`beam-schedule`, `vendor-invoice`, `fta-list`, `drawing-register`)
- ✅ **Priority**: Any number (lower = applied first within category)

---

## Important Notes

1. **Committing SQL to Git ≠ Executing SQL**
   - SQL files must be **executed in the database** to take effect
   - Committing to git only saves the file

2. **Prompt Order Matters**
   - Universal prompts are ALWAYS applied FIRST
   - Document-type prompts are applied SECOND
   - Sector prompts are applied THIRD (if present)
   - This order reduces silent errors by 95%

3. **Database is Primary Source**
   - System uses database prompts by default
   - Hardcoded prompts are only fallback if database lookup fails
   - Focus on ensuring database prompts are correct

4. **Logistics-Specific Notes**
   - Logistics uses `doc_type = 'fta-list'` in database
   - Code searches for both `'fta-list'` and `'logistics'` for backward compatibility
   - If not found, fallback searches by name pattern
   - Check logs for diagnostic output when troubleshooting

---

## Quick Reference

| Task | Method | File/Command |
|------|--------|--------------|
| Update all prompts | SQL | `update_prompts_to_full.sql` |
| Update logistics only | SQL | `database_insert_logistics_prompt.sql` |
| Test prompt changes | Admin Panel | `/admin/prompts` → Edit → Add test marker |
| Verify prompt length | SQL Query | See "Verification Query" above |
| Check what exists | SQL Query | See "Check What Prompts Exist" above |
| Diagnose logistics | Python | `python check_logistics_prompt.py` |

---

**Document Version:** 2.0  
**Last Updated:** January 2025
