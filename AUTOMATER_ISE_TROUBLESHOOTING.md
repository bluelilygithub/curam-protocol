# Automater ISE Troubleshooting Guide

## Problem
The automater first page loads, but when generating the report, there's an Internal Server Error (ISE).

## Quick Checks

### 1. Check Flask Logs
Look at the terminal/console where Flask is running for the actual error message.

### 2. Enable Flask Debug Mode
In `main.py`, at the bottom:
```python
if __name__ == '__main__':
    app.run(debug=True, port=5000)  # debug=True should show detailed errors
```

### 3. Check Browser Console
Open browser DevTools (F12) → Console tab → look for JavaScript errors

### 4. Check Browser Network Tab
Open browser DevTools (F12) → Network tab → click on the failed request → look at Response

## Likely Causes After Refactoring

### Issue 1: Missing Import
**Symptom:** `NameError: name 'X' is not defined`

**Check:**
```bash
grep "HTML_TEMPLATE" main.py
# Should show: from services.gemini_service import ... HTML_TEMPLATE
```

### Issue 2: Route Conflict
**Symptom:** Wrong page loads or 404

**Check:**
- `/automater` route is in main.py (not moved to blueprint)
- `/feasibility-preview.html` route is in main.py

### Issue 3: Template Variable Missing
**Symptom:** `KeyError` or `UndefinedError` in template

**Check the render_template_string call** (line ~987 in main.py):
- All variables passed to template are defined
- `HTML_TEMPLATE` is imported

## Debugging Steps

### Step 1: Add Debug Logging
Add this at the start of `index_automater()` function:

```python
def index_automater():
    print(f"[DEBUG] index_automater called, method={request.method}")
    print(f"[DEBUG] Form data: {dict(request.form)}")
    
    department = request.form.get('department') or request.args.get('department')
    print(f"[DEBUG] Department: {department}")
    # ... rest of function
```

### Step 2: Wrap in Try/Except
Wrap the POST processing in try/except:

```python
if request.method == 'POST':
    try:
        # ... existing POST code ...
    except Exception as e:
        import traceback
        print(f"[ERROR] Exception in POST: {e}")
        traceback.print_exc()
        error_message = f"Processing error: {str(e)}"
```

### Step 3: Test with Minimal Data
1. Select just ONE sample file
2. Choose "Engineering" department
3. Click "Generate Report"
4. Check console/logs for specific error

## Common Errors We Fixed Today

✅ **Fixed:** Missing `format_currency` import  
✅ **Fixed:** Missing `HTML_TEMPLATE` import  
✅ **Fixed:** Missing `format_text_to_html` import  
✅ **Fixed:** RAG functions moved to service

## What Could Still Cause ISE

### 1. Database Connection
If `get_samples_for_template()` fails:
```python
# In index_automater(), around line 960
try:
    samples = get_samples_for_template(dept)
except Exception as e:
    print(f"Database error: {e}")
    samples = []  # fallback
```

### 2. Missing Environment Variable
```bash
# Check if GEMINI_API_KEY is set
python -c "import os; print('GEMINI_API_KEY:', 'SET' if os.environ.get('GEMINI_API_KEY') else 'MISSING')"
```

### 3. File Not Found
Check if sample files exist:
```python
# The error might be file not found
# Check logs for: "File not found: /path/to/sample"
```

## Quick Fix to Test

Add this temporary error handler in main.py:

```python
@app.errorhandler(500)
def internal_error(error):
    import traceback
    trace = traceback.format_exc()
    print(f"500 ERROR:\n{trace}")
    return f"<pre>Internal Server Error:\n\n{trace}</pre>", 500
```

This will show the actual error in the browser instead of generic ISE.

## Next Steps

1. **Run Flask in debug mode**
2. **Check the console/terminal output** when error occurs
3. **Share the actual error message** from logs
4. **Check browser Network tab** for the failing request details

## If Error Persists

Please provide:
1. Full error message from Flask console
2. Browser console errors (if any)
3. Network tab response for the failing request
4. Which sample files/department you're selecting

## Verification

After fix, test these scenarios:
- [ ] Engineering → Select one beam schedule → Generate
- [ ] Finance → Select one invoice → Generate  
- [ ] Transmittal → Select one drawing → Generate
- [ ] Export to CSV works

