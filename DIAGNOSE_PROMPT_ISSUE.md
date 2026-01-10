# Diagnosing Why You Don't See the Test Field

## Issue Summary
You added a test instruction to add `"admin_test": "working"` to the JSON output, but you're not seeing it in the finance report.

## Why You Can't See It

**The UI only shows formatted table data**, not raw JSON. Even if the field was added, it wouldn't appear in the table view because the table only displays specific columns (Vendor, Date, InvoiceNum, etc.).

## How to Verify If It's Working

### Step 1: Check Server Logs (Most Important!)

When you run an extraction, check your **Railway logs** or **console output**. You should see:

```
🔍 Attempting to load database prompts for doc_type='finance' -> db_doc_type='vendor-invoice'
✓ Found 1 active database prompt(s) for doc_type=vendor-invoice
  1. finance_extraction_rules (priority: 50)
✅ TEST MARKER FOUND IN DATABASE PROMPT!
✓ Using database prompt for finance (db: vendor-invoice) - length: XXXX chars
```

If you see:
```
⚠️ No active database prompts found for doc_type=vendor-invoice
→ Using hardcoded fallback for finance
```

This means the database prompt isn't being used.

### Step 2: Check the Actual JSON Response

The UI doesn't show raw JSON, but you can check it:

1. **Open Browser Developer Tools** (F12)
2. **Go to Network tab**
3. **Run an extraction** (upload document and click "Generate Output")
4. **Look for the POST request** to `/automater` or similar
5. **Check the Response** - look for the raw JSON data
6. **Search for "admin_test"** in the response

### Step 3: Make the Test More Obvious

Instead of just adding a field, make it change something VISIBLE in the table:

**Better Test - Change Vendor Name:**
```
## TEST INSTRUCTION - CRITICAL ##
Prefix the Vendor field with "TEST: " in the JSON output.
Example: If Vendor is "CloudRender.io", return "TEST: CloudRender.io"
```

Then check if the vendor name in the table shows "TEST: CloudRender.io"

### Step 4: Check Prompt Settings in Database

Go to `/admin/prompts` and verify:
1. ✅ **Status**: Green "Active" badge (not yellow "Inactive")
2. ✅ **Scope**: `document_type`
3. ✅ **Document Type**: Should be `finance` (or `vendor-invoice` - both work)
4. ✅ **Priority**: Any number (lower = applied first)

## Common Issues

### Issue 1: Prompt Not Active
**Fix**: Click "Activate" button next to the prompt

### Issue 2: Wrong Document Type
- Database has: `doc_type = 'finance'`
- Code looks for: `doc_type IN ('vendor-invoice', 'finance')`
- **This should work** with our recent fix, but verify

### Issue 3: Wrong Scope
- Should be: `scope = 'document_type'` (not `universal` or `sector`)

### Issue 4: Prompt Not Found Due to Mapping
The code maps:
- `finance` → `vendor-invoice` for database lookup
- Then checks for both `vendor-invoice` AND `finance`

If your prompt has `doc_type = 'finance'`, it should be found. If it has `doc_type = 'vendor-invoice'`, it should also be found.

## Next Steps

1. **Check Railway logs** for the debug messages we added
2. **Try the "TEST:" prefix on Vendor name** - this will be visible in the table
3. **Verify prompt is Active** in `/admin/prompts`
4. **Check browser Network tab** for the raw JSON response

If you see the log message `✓ Using database prompt` but still don't see changes, the issue is that the AI isn't following the instruction. In that case, make the instruction more forceful or prominent in the prompt.
