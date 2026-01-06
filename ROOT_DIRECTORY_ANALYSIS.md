# Why Are Sample Directories in the Root?

## Current Situation

You have **3 sample directories in the project root**:
- `invoices/` - Finance department sample PDFs (6 files)
- `drawings/` - Engineering + Transmittal sample PDFs (9 files)
- `logistics/` - Logistics department sample PDFs (5 files)

## Why They're There

### 1. **Historical Development**
These directories were created early in development as simple, flat paths:
- `invoices/Bne.pdf` - easy to reference
- `drawings/schedule_cad.pdf` - straightforward
- No initial planning for project organization

### 2. **Direct File Serving**
The app serves these files directly via Flask routes:

**`routes/static_pages.py`:**
```python
@static_pages_bp.route('/invoices/<path:filename>')
def invoices(filename):
    """Serve invoice PDF files"""
    return send_from_directory('invoices', filename)

@static_pages_bp.route('/drawings/<path:filename>')
def drawings(filename):
    """Serve drawing PDF files"""
    return send_from_directory('drawings', filename)
```

**`main.py`:**
```python
@app.route('/sample')
def view_sample():
    requested = request.args.get('path')
    # Serves files like: invoices/Bne.pdf, drawings/schedule_cad.pdf
    return send_file(requested)
```

### 3. **Config References**
`config.py` references them directly:
```python
DEPARTMENT_SAMPLES = {
    "finance": {
        "samples": [
            {"path": "invoices/Bne.pdf", ...}  # Direct root path
        ]
    }
}
```

## Problems with Current Structure

### ❌ **Clutters Root Directory**
- Root has 50+ files/directories
- Sample directories mixed with code, config, HTML files
- Hard to see what's important vs. what's just samples

### ❌ **Inconsistent Naming**
- `invoices/` - document type name
- `drawings/` - document type name (but contains 2 departments!)
- `logistics/` - department name
- Should be consistent (department-based or document-type-based)

### ❌ **Not Standard Practice**
Most projects organize samples/assets in:
- `samples/` - for demo/test files
- `assets/samples/` - for static assets
- `data/samples/` - for data files
- Not in root alongside code

### ❌ **Security Concerns**
- Files in root are easier to accidentally expose
- No clear separation between code and data
- Harder to apply access controls

## Recommended Solution

### Move to `samples/` Directory Structure

```
samples/
├── finance/          (from invoices/)
│   ├── Bne.pdf
│   └── ...
├── engineering/      (from drawings/)
│   ├── schedule_cad.pdf
│   └── ...
├── transmittal/      (from drawings/)
│   ├── s001_general_notes.pdf
│   └── ...
└── logistics/        (from logistics/)
    ├── Apparel FTA List.pdf
    └── ...
```

### Benefits

✅ **Cleaner root** - All samples in one place  
✅ **Consistent naming** - Department-based folders  
✅ **Better organization** - Clear separation of code vs. data  
✅ **Easier to manage** - One directory to backup/exclude  
✅ **Standard practice** - Follows common project structure  

## Migration Steps

### 1. Create New Structure
```bash
mkdir samples
mkdir samples/finance
mkdir samples/engineering
mkdir samples/transmittal
mkdir samples/logistics
```

### 2. Move Files
```bash
# Finance
mv invoices/*.pdf samples/finance/

# Engineering (from drawings/)
mv drawings/schedule_*.pdf samples/engineering/
mv drawings/beam_*.pdf samples/engineering/
mv drawings/column_*.pdf samples/engineering/

# Transmittal (from drawings/)
mv drawings/s*.pdf samples/transmittal/

# Logistics
mv logistics/*.pdf samples/logistics/
```

### 3. Update Code

**`config.py`:**
```python
DEPARTMENT_SAMPLES = {
    "finance": {
        "folder": "samples/finance",
        "samples": [
            {"path": "samples/finance/Bne.pdf", ...}
        ]
    },
    # ... etc
}
```

**`routes/static_pages.py`:**
```python
@static_pages_bp.route('/samples/<department>/<path:filename>')
def sample_file(department, filename):
    """Serve sample PDF files"""
    return send_from_directory(f'samples/{department}', filename)
```

**`main.py` `view_sample()`:**
- Already uses `ALLOWED_SAMPLE_PATHS` for security
- Will work with new paths after config update

### 4. Update `.gitignore` (if needed)
```gitignore
# Sample files (if you want to exclude them)
/samples/*/real-clients/
```

### 5. Remove Old Directories
```bash
rmdir invoices
rmdir logistics
# Keep drawings/ if it has other files (like column_complex_vector.jpeg)
```

## Alternative: Keep Current Structure

If migration is too much work right now, at least:

1. **Document why** - Add README explaining structure
2. **Add to .gitignore** - Ensure sample files aren't accidentally committed
3. **Consider for future** - Plan migration when adding new departments

## Summary

**Why they're in root:**
- Historical development (simple paths)
- Direct file serving (Flask routes)
- No initial organization planning

**Should they be moved?**
- ✅ **Yes** - Better organization, cleaner root, standard practice
- ⚠️ **But** - Requires updating config.py, routes, and file paths

**Recommendation:**
- Move to `samples/` with department subfolders
- Cleaner, more maintainable, follows best practices
- One-time migration effort, long-term benefit
