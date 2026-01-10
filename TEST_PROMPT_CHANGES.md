# How to Test Prompt Changes from Admin Panel

## Quick Test Method

### Step 1: Edit a Prompt
1. Go to `/admin/prompts`
2. Click **"Edit"** on any active prompt (e.g., `finance_extraction_rules` or `universal_core_principles`)
3. Scroll down to the **"Prompt Text"** textarea

### Step 2: Add a Test Marker
At the very beginning of the prompt text (before everything else), add this line:

```
## TEST MARKER - ADMIN PANEL UPDATE - $(date) ##
```

Or even simpler, add:

```
TEST_12345 - This prompt was edited via admin panel
```

### Step 3: Save the Change
1. Click **"Save Changes"**
2. You should see: "Prompt updated successfully"

### Step 4: Verify It's Working
**Method 1: Check Logs (Recommended)**
- Upload a document and run an extraction (finance document for `finance_extraction_rules`, or any document for `universal_core_principles`)
- Check your application logs (Railway logs, console output, or server logs)
- You should see: `✓ Using database prompt for finance (db: vendor-invoice)`
- If you see: `→ Using hardcoded fallback for finance` - then the database prompt isn't being used

**Method 2: Make the Change More Obvious**
Instead of just a marker, add this at the very top of the prompt:

```
IMPORTANT: Return all amounts with the word "TESTED" appended to each amount.
Example: "$100.50" should become "$100.50 TESTED"
```

Then test with a finance document extraction and check if amounts have "TESTED" appended. If yes, your database prompt is working!

**Method 3: Change Output Format**
Add this instruction near the end of the prompt (before "TEXT:"):

```
## TEST INSTRUCTION ##
Add a field called "test_marker" with value "admin_panel_works" to every JSON object returned.
```

Then run an extraction and check if the JSON output includes `"test_marker": "admin_panel_works"`. If it does, your database prompt is working!

---

## Recommended Test for `universal_core_principles`

Since this is a universal prompt (applies to ALL document types), it's easiest to test:

1. **Edit** `universal_core_principles`
2. **At the very beginning**, add:
   ```
   ## UPDATED VIA ADMIN PANEL - $(timestamp) ##
   ```
3. **Save**
4. **Upload ANY document** (finance, engineering, etc.)
5. **Check logs** for: `✓ Using database prompt`

---

## Recommended Test for `finance_extraction_rules`

1. **Edit** `finance_extraction_rules`
2. **At the very beginning**, add:
   ```
   TEST_MARKER_ADMIN_UPDATE
   ```
3. **Save**
4. **Upload a finance/invoice document**
5. **Check logs** for: `✓ Using database prompt for finance`

---

## Troubleshooting

### If you see "→ Using hardcoded fallback":
- **Check 1**: Is the prompt **Active**? (Should show green "Active" badge)
- **Check 2**: Does the `doc_type` match? 
  - For finance: Should be `finance` or `vendor-invoice`
  - For engineering: Should be `engineering` or `beam-schedule`
- **Check 3**: Is the prompt in the right **scope**?
  - `universal` = applies to all documents
  - `document_type` = applies only to specific doc_type

### If logs don't show the test marker:
- The prompt might not be getting used
- Check that it's **Active** and has the correct `doc_type`/`scope`
- Universal prompts should always work if active

### If you don't see any logs:
- Check your logging configuration
- Try adding `print()` statements in `services/gemini_service.py` line 152 to see what's happening
