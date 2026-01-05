# Logistics Extraction Debug Guide
## Why the HTML Table Doesn't Show

**Problem:** Logistics extraction processes data but doesn't display HTML table  
**Status:** Data flow issue - extraction works, display doesn't

---

## 🔍 DATA FLOW ANALYSIS

### Step 1: Extraction (services/gemini_service.py)

**Line 1743-1755:** Logistics response parsing
```python
elif doc_type == "logistics":
    # Logistics returns {document_type: "...", rows: [...]}
    if isinstance(parsed, dict) and "rows" in parsed:
        entries = parsed["rows"]  # ✅ Extracts rows array
        document_type = parsed.get('document_type', 'unknown')
        for entry in entries:
            if isinstance(entry, dict):
                entry['_document_type'] = document_type
    else:
        # Fallback: treat as regular array
        entries = parsed if isinstance(parsed, list) else [parsed] if isinstance(parsed, dict) else []
```

**✅ This should work** - extracts `entries` from `parsed["rows"]`

---

### Step 2: Processing (main.py)

**Line 1273-1278:** Logistics entry processing
```python
elif department == "logistics":
    # Logistics returns multiple rows like finance/engineering
    model_actions.append(f"Extracted {len(entries)} row(s) from {filename}")
    for entry in entries:
        entry['Filename'] = filename
        results.append(entry)  # ✅ Adds to results
```

**✅ This should work** - adds entries to `results` array

---

### Step 3: Template Rendering (main.py)

**Line 1531-1547:** Template rendering
```python
return render_template_string(
    HTML_TEMPLATE,
    results=results if results else [],  # ✅ Passes results
    department=department,  # ✅ Passes department
    ...
)
```

**✅ This should work** - passes `results` and `department` to template

---

### Step 4: Template Display (services/gemini_service.py HTML_TEMPLATE)

**Line 1239-1400:** Logistics template section

**Critical Condition Check:**
```jinja2
{% if department == 'logistics' %}
    ...
    {% if results %}  # ⚠️ THIS IS THE KEY CONDITION
        <div>...table rendering...</div>
    {% endif %}
{% endif %}
```

**⚠️ PROBLEM:** If `results` is empty or falsy, table won't render!

---

## 🐛 LIKELY ISSUES

### Issue 1: Results Array is Empty

**Symptoms:**
- Processing shows "Extracted X row(s)"
- But `results` array is empty when template renders

**Possible Causes:**
1. **Gemini returns wrong structure:**
   - Expected: `{document_type: "...", rows: [...]}`
   - Actual: `[...]` (direct array) or `{...}` (single object)
   - **Check:** Look at `action_log` for "Detected logistics document type" message

2. **Entries not being added:**
   - `entries` might be empty after parsing
   - **Check:** Add debug print: `print(f"Logistics entries: {entries}")`

3. **Results cleared before rendering:**
   - Session might be clearing results
   - **Check:** Verify `results` before `render_template_string` call

---

### Issue 2: Field Name Mismatch

**Template Detection Logic (line 1268-1271):**
```jinja2
{% set first_row = results[0] if results else {} %}
{% set has_fta = 'FTAAgreement' in first_row or 'CountryOfOrigin' in first_row or 'ItemDescription' in first_row %}
{% set has_bol = 'BLNumber' in first_row or 'Shipper' in first_row or 'Vessel' in first_row %}
{% set has_packing = 'CartonNumber' in first_row or 'Dimensions' in first_row %}
```

**Prompt Returns (logistics_prompt.py):**
- ✅ `ItemDescription` (camelCase) - matches
- ✅ `FTAAgreement` (camelCase) - matches
- ✅ `CountryOfOrigin` (camelCase) - matches
- ✅ `BLNumber` (camelCase) - matches
- ✅ `Shipper` (camelCase) - matches
- ✅ `Vessel` (camelCase) - matches

**⚠️ BUT:** If Gemini returns snake_case (`item_description`) or different casing, detection fails!

---

### Issue 3: Template Condition Failing

**The template has debug output (line 1248-1258):**
```jinja2
<div style="background: #fff3cd; border: 2px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 8px;">
    <strong>🔍 DEBUG - Logistics Data:</strong><br>
    <strong>results exists:</strong> {{ 'Yes' if results else 'No' }}<br>
    <strong>results type:</strong> {{ results.__class__.__name__ if results else 'None' }}<br>
    <strong>results length:</strong> {{ results|length if results else 0 }}<br>
    <strong>department value:</strong> "{{ department }}"<br>
    {% if results and results|length > 0 %}
    <strong>First result keys:</strong> {{ results[0].keys()|list if results[0] is mapping else 'Not a dict' }}<br>
    <strong>First result:</strong> {{ results[0] }}<br>
    {% endif %}
</div>
```

**✅ USE THIS:** Check the debug output in the rendered HTML to see:
- Is `results` empty?
- What are the actual field names?
- What does `first_row` contain?

---

## 🔧 DEBUGGING STEPS

### Step 1: Check Debug Output

1. Run logistics extraction
2. Look for the yellow debug box in the rendered HTML
3. Check:
   - `results exists`: Should be "Yes"
   - `results length`: Should be > 0
   - `First result keys`: Should show field names
   - `First result`: Should show actual data

### Step 2: Add Print Statements

**In main.py, after line 1278:**
```python
elif department == "logistics":
    model_actions.append(f"Extracted {len(entries)} row(s) from {filename}")
    for entry in entries:
        entry['Filename'] = filename
        results.append(entry)
    # ADD THIS:
    print(f"🔍 LOGISTICS DEBUG: {len(results)} results, first entry keys: {list(results[0].keys()) if results else 'No results'}")
```

**In main.py, before line 1531:**
```python
print(f"🔍 RENDERING: department={repr(department)}, results_count={len(results) if results else 0}")
# ADD THIS:
if department == "logistics":
    print(f"🔍 LOGISTICS RENDER: results={results}, first_row_keys={list(results[0].keys()) if results and len(results) > 0 else 'No results'}")
```

### Step 3: Check Gemini Response

**In services/gemini_service.py, after line 1752:**
```python
action_log.append(f"Detected logistics document type: {document_type}")
# ADD THIS:
action_log.append(f"Logistics entries count: {len(entries)}")
if entries:
    action_log.append(f"First entry keys: {list(entries[0].keys()) if isinstance(entries[0], dict) else 'Not a dict'}")
```

---

## 🎯 MOST LIKELY FIXES

### Fix 1: Handle Direct Array Response

**If Gemini returns array directly (not wrapped in `{rows: [...]}`):**

**In services/gemini_service.py line 1743:**
```python
elif doc_type == "logistics":
    # Handle both {document_type: "...", rows: [...]} and direct array
    if isinstance(parsed, dict) and "rows" in parsed:
        entries = parsed["rows"]
        document_type = parsed.get('document_type', 'unknown')
        for entry in entries:
            if isinstance(entry, dict):
                entry['_document_type'] = document_type
    elif isinstance(parsed, list):
        # Direct array response - use as-is
        entries = parsed
        action_log.append("Logistics: Direct array response (no document_type wrapper)")
    else:
        # Single object or fallback
        entries = [parsed] if isinstance(parsed, dict) else []
```

### Fix 2: Normalize Field Names

**If field names are inconsistent (camelCase vs snake_case):**

**In main.py, after line 1278:**
```python
elif department == "logistics":
    model_actions.append(f"Extracted {len(entries)} row(s) from {filename}")
    for entry in entries:
        entry['Filename'] = filename
        # Normalize field names to match template expectations
        if 'item_description' in entry:
            entry['ItemDescription'] = entry.pop('item_description')
        if 'country_of_origin' in entry:
            entry['CountryOfOrigin'] = entry.pop('country_of_origin')
        if 'fta_agreement' in entry:
            entry['FTAAgreement'] = entry.pop('fta_agreement')
        # ... normalize other fields
        results.append(entry)
```

### Fix 3: Ensure Results is Not Empty

**In main.py, before line 1531:**
```python
# Ensure logistics results are properly formatted
if department == "logistics" and results:
    # Verify results structure
    if not isinstance(results, list):
        results = []
    elif len(results) > 0 and not isinstance(results[0], dict):
        # Results are not dicts - convert or clear
        results = []
```

---

## ✅ QUICK TEST

**Add this temporary debug route:**

```python
@app.route('/debug/logistics')
def debug_logistics():
    """Debug logistics data structure"""
    saved = session.get('last_results')
    if not saved:
        return "No results in session"
    
    dept = saved.get('department')
    rows = saved.get('rows', [])
    
    return f"""
    <h1>Logistics Debug</h1>
    <p>Department: {dept}</p>
    <p>Results count: {len(rows) if rows else 0}</p>
    <pre>{json.dumps(rows[:1] if rows else [], indent=2)}</pre>
    """
```

**Visit:** `/debug/logistics` after running extraction to see actual data structure.

---

## 🎯 RECOMMENDED FIX

**Most likely issue:** Gemini is returning data in a different structure than expected, or field names don't match template expectations.

**Immediate action:**
1. Check the debug output box in rendered HTML
2. Add print statements to see actual data structure
3. Compare field names in `first_row` with template expectations
4. Fix field name normalization or response parsing as needed

---

**Next Steps:**
1. Run extraction and check debug output
2. Share the debug output values
3. We'll fix the specific mismatch
