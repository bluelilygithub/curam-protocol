# Codebase Pitfalls Analysis
## Why the Code Has Become Unmanageable

**Date:** January 2026  
**Status:** Critical - Refactoring Required

---

## 🔴 CRITICAL ISSUES

### 1. **Massive Monolithic Files**

**Problem:**
- `services/gemini_service.py`: **3,287 lines** (152KB)
- `main.py`: **1,581 lines** (79KB)
- `roi_calculator_flask.py`: **200KB** (estimated 4,000+ lines)

**Impact:**
- Impossible to navigate or understand
- Git conflicts on every change
- No clear separation of concerns
- Testing becomes impractical
- Code review is impossible

**Evidence:**
```python
# main.py has 22+ department conditionals scattered throughout
if department == 'engineering' or department == 'finance':
    # 50 lines of logic
elif department == 'transmittal':
    # 30 lines of logic
elif department == 'logistics':
    # 40 lines of logic
# Repeated 10+ times in same file
```

---

### 2. **Dual Configuration Systems (Source of Truth Confusion)**

**Problem:**
- **config.py**: Hardcoded `DEPARTMENT_SAMPLES`, field definitions, prompt limits
- **Database**: `sectors`, `document_types`, `sample_file_paths` (JSONB)
- **Both are used simultaneously** with unclear priority

**Impact:**
- Developers don't know where to update data
- Changes in one place don't reflect in the other
- Sample files defined in 3 places: config.py, database, and hardcoded paths
- Documentation warns: "⚠️ CRITICAL: Sample files are loaded from DATABASE, not config.py"

**Evidence:**
```python
# config.py line 16-65: Hardcoded samples
DEPARTMENT_SAMPLES = {
    "finance": {
        "samples": [{"path": "invoices/Bne.pdf", ...}]
    }
}

# database.py: Also loads from database
def get_samples_for_template(dept):
    # Queries document_types.sample_file_paths (JSONB)

# main.py line 1499-1520: Merges both!
db_samples = get_samples_for_template(dept)  # From DB
sample_files_merged = {**DEPARTMENT_SAMPLES, **db_samples}  # Merge with config.py
```

**Result:** Unclear which is authoritative, causing bugs and confusion.

---

### 3. **Three-Way Industry Redundancy**

**Problem:**
Industries are defined in **3 separate locations** with different schemas:

1. **`roi_calculator_flask.py`** (line 130): `INDUSTRIES` dict
2. **`roi_calculator/config/industries.py`**: Duplicate `INDUSTRIES` dict
3. **Database `sectors` table**: Different schema entirely

**Impact:**
- Adding a new industry requires changes in 3 places
- Inconsistencies between ROI calculator and main app
- Failed attempts to add Legal/Logistics due to complexity
- Documentation explicitly warns: "Cannot add new industries easily"

**Evidence:**
```python
# roi_calculator_flask.py
INDUSTRIES = {
    "Architecture & Building Services": {
        "context": "...",
        "doc_staff_percentage_base": 0.75,
        # 50+ lines per industry
    }
}

# roi_calculator/config/industries.py - EXACT DUPLICATE
INDUSTRIES = {
    "Architecture & Building Services": {
        # Same structure, different file
    }
}

# database.py - Different schema
SELECT slug, name, icon_svg, demo_headline FROM sectors
```

---

### 4. **Mixed Concerns in Single Functions**

**Problem:**
The `index_automater()` function in `main.py` (lines 1095-1547) is **450+ lines** and does:
- Request handling (GET/POST)
- File upload processing
- Department-specific logic (22+ conditionals)
- Database queries
- AI service calls
- Data validation
- Session management
- Template rendering

**Impact:**
- Impossible to test individual pieces
- Changes in one area break unrelated features
- No reusability
- Violates Single Responsibility Principle

**Evidence:**
```python
def index_automater():  # 450+ lines
    # Request handling
    department = request.form.get('department')
    
    # File processing
    uploaded_files = request.files.getlist('finance_uploads')
    
    # Department-specific logic (repeated 4 times)
    if department == 'finance':
        # 30 lines
    elif department == 'engineering':
        # 40 lines
    elif department == 'transmittal':
        # 50 lines
    
    # Database queries
    samples = get_samples_for_template(dept)
    
    # AI processing
    entries, error, model = analyze_gemini(text, department)
    
    # Data transformation
    for entry in entries:
        entry['Filename'] = filename
        # 20 lines of formatting
    
    # Session management
    session['last_results'] = {...}
    
    # Template rendering
    return render_template_string(HTML_TEMPLATE, ...)
```

---

### 5. **Dead/Disabled Code Still Executed**

**Problem:**
- Database prompts are **disabled** (`is_active = false`) but code still checks for them
- Fallback logic runs on every request even though it never succeeds
- Encoding workarounds (`utils/encoding_fix.py`) fix symptoms, not root cause

**Impact:**
- Performance overhead (unnecessary database queries)
- Confusion about which code path is active
- Maintenance burden (dead code accumulates)

**Evidence:**
```python
# gemini_service.py line 125-135
def build_prompt(text, doc_type, sector_slug=None):
    # Try database first (ALWAYS FAILS - all prompts disabled)
    try:
        from database import build_combined_prompt
        db_prompt = build_combined_prompt(doc_type, sector_slug, text)
        if db_prompt:  # Never True - all is_active = false
            return db_prompt
    except Exception as e:
        print(f"Database failed: {e}")  # Runs every time
    
    # Always falls back to hardcoded
    print(f"Using hardcoded fallback for {doc_type}")
```

**Documentation confirms:**
> "⚠️ CRITICAL: All database prompts set to `is_active = false` - using code-based only"

---

### 6. **Inconsistent Extraction Patterns**

**Problem:**
Each department has **completely different** extraction logic:

- **Finance**: Returns array of invoice objects
- **Engineering**: Returns array with validation flags, confidence scores
- **Transmittal**: Returns single object with nested arrays (`DrawingRegister`, `Standards`, etc.)
- **Logistics**: Returns array but with different field structure

**Impact:**
- No shared extraction interface
- Each new department requires custom handling in 5+ places
- Impossible to create generic extraction pipeline
- Code duplication for common tasks (filename addition, error handling)

**Evidence:**
```python
# main.py - Different handling for each department
if department == "transmittal":
    # Handle nested structure
    transmittal_data = entries[0]
    if 'DrawingRegister' in transmittal_data:
        # Special handling
elif department == "logistics":
    # Different structure
    for entry in entries:
        entry['Filename'] = filename
else:
    # Finance/Engineering - array of flat objects
    for entry in entries:
        entry['Filename'] = filename
        # Department-specific formatting
```

---

### 7. **Hardcoded Business Logic in Routes**

**Problem:**
Business logic is embedded directly in Flask route handlers:

- Validation rules in routes
- Data transformation in routes
- Error handling in routes
- Department-specific branching in routes

**Impact:**
- Cannot reuse logic outside Flask context
- Difficult to test (requires Flask test client)
- Routes become 200+ lines each
- Business rules scattered across files

**Evidence:**
```python
# main.py route handler contains business logic
@app.route('/automater', methods=['POST'])
def automater():
    # Business logic: Department selection
    if department == 'engineering' or department == 'finance':
        selected_samples = request.form.getlist('samples')
    
    # Business logic: File validation
    if not filename.lower().endswith('.pdf'):
        error_message = "Only PDF files can be uploaded"
    
    # Business logic: Data transformation
    if department == "finance":
        entry['CostFormatted'] = format_currency(cost_value)
    
    # Business logic: Validation
    if department == "engineering":
        entry['critical_errors'] = []
        # 50 lines of validation logic
```

---

### 8. **No Clear Service Boundaries**

**Problem:**
Services are not clearly separated:

- `gemini_service.py` (3,287 lines) contains:
  - Prompt building
  - API calls
  - Error handling
  - Response parsing
  - HTML template generation
  - Model selection logic
  - Retry logic

**Impact:**
- Services are too large to understand
- Cannot swap implementations (e.g., different AI provider)
- Testing requires mocking entire service
- Changes ripple across entire codebase

---

### 9. **Encoding Workarounds Instead of Fixes**

**Problem:**
`utils/encoding_fix.py` was created to fix UTF-8 corruption issues:
- 62 hardcoded corrupt characters
- Sanitization middleware
- Template filters
- CSV export sanitization

**Impact:**
- Treats symptoms, not root cause
- Performance overhead (runs on every response)
- Maintenance burden (new corruptions require code changes)
- Indicates deeper data handling issues

**Evidence:**
```python
# utils/encoding_fix.py - 62 hardcoded character replacements
CORRUPT_CHARACTERS = {
    'â€œ': '"',  # Left double quotation mark
    'â€': '"',   # Right double quotation mark
    'â€™': "'",  # Right single quotation mark
    # ... 59 more
}
```

---

### 10. **Inconsistent Error Handling**

**Problem:**
Error handling is inconsistent across the codebase:

- Some functions return `(data, error, model)` tuples
- Others raise exceptions
- Some return `None` on error
- Some log and continue silently
- Some return error strings

**Impact:**
- Unpredictable behavior
- Difficult to debug
- Error messages lost in translation
- No centralized error handling

**Evidence:**
```python
# Different error patterns in same file
entries, api_error, model, attempts, actions, schedule = analyze_gemini(...)
# Returns tuple with error string

if text.startswith("Error:"):
    error_message = text
# Error as string prefix

try:
    result = process_file()
except Exception as e:
    app.logger.error(f"Error: {e}")
    return None
# Exception handling

if not result:
    return jsonify({'error': 'Failed'}), 500
# Error in response
```

---

## 📊 METRICS OF COMPLEXITY

| Metric | Value | Healthy Target |
|--------|-------|----------------|
| Largest file | 3,287 lines | < 300 lines |
| Functions in main.py | 18+ | < 10 |
| Department conditionals | 22+ | 0 (use polymorphism) |
| Configuration sources | 3 | 1 |
| Industry definitions | 3 locations | 1 |
| Lines in single function | 450+ | < 50 |
| Service file size | 152KB | < 20KB |

---

## 🎯 ROOT CAUSES

1. **No Architecture from Start**: Code grew organically without design
2. **Premature Optimization**: Database-driven config added before needed
3. **Copy-Paste Development**: Features added by duplicating existing code
4. **No Refactoring Discipline**: Technical debt accumulated
5. **Mixed Abstraction Levels**: Low-level file handling mixed with high-level business logic
6. **No Clear Boundaries**: Routes, services, models all mixed together

---

## ✅ RECOMMENDED SOLUTIONS

### Immediate (Stop the Bleeding)
1. **Extract routes to blueprints** - Move `/automater` to `routes/automater.py`
2. **Create department handlers** - One class per department (FinanceHandler, EngineeringHandler)
3. **Unify configuration** - Choose ONE source of truth (database OR config.py, not both)
4. **Remove dead code** - Delete database prompt checking if disabled

### Short-term (1-2 weeks)
1. **Break up gemini_service.py** - Split into: `prompt_builder.py`, `api_client.py`, `response_parser.py`
2. **Create extraction interface** - Abstract base class for all extractors
3. **Centralize error handling** - Custom exception classes, error handler middleware
4. **Extract business logic** - Move from routes to service layer

### Long-term (1-2 months)
1. **Domain-driven design** - Separate domains: Extraction, Validation, Configuration
2. **Dependency injection** - Make services testable and swappable
3. **API layer** - Separate REST API from web routes
4. **Configuration service** - Single source of truth for all config

---

## 🚨 WARNING SIGNS FOR FUTURE

If you see these patterns, refactor immediately:

- ✅ File exceeds 500 lines
- ✅ Function exceeds 50 lines
- ✅ More than 3 `if/elif` branches in one function
- ✅ Same logic repeated 3+ times
- ✅ Configuration in 2+ places
- ✅ Business logic in route handlers
- ✅ Workaround files (`*_fix.py`, `*_hack.py`)

---

**Conclusion:** The codebase has grown organically without architectural discipline. While functional, it's become unmaintainable. A systematic refactoring is required, starting with extracting routes and creating clear service boundaries.
