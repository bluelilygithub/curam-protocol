# Gemini Service Size Analysis

## Current State: 1,998 lines

### What We Extracted (Previous Refactoring)
- ✅ Department-specific table sections → `services/templates/*.py`
  - Logistics template: ~163 lines
  - Transmittal template: ~336 lines  
  - Engineering template: ~146 lines
  - Finance template: ~157 lines
  - **Total extracted: ~802 lines**

### What's Still in `gemini_service.py`

#### 1. **HTML_TEMPLATE** (Lines 194-1544) - **~1,350 lines** 🔴
   - **CSS styles** (~400 lines): All styling for tables, buttons, forms, etc.
   - **JavaScript** (~150 lines): Form handling, department switching, file uploads
   - **Base HTML structure** (~200 lines): Form, sample selection, error display
   - **Transmittal full template** (~600 lines): Still embedded (we only extracted the table sections, not the full transmittal display logic)

#### 2. **analyze_gemini()** function (Lines 1631-1998) - **~368 lines**
   - Model selection logic
   - Retry logic with exponential backoff
   - Error handling for timeouts, JSON errors, etc.
   - Image processing with vision API
   - Response parsing and validation
   - Engineering schedule type detection

#### 3. **Other Code** - **~280 lines**
   - Imports and configuration
   - `get_available_models()` function (~45 lines)
   - `build_prompt()` function (~40 lines)
   - `replace_template_section()` function (~80 lines)
   - Template injection logic (~35 lines)

## Why It's Still Large

**The base HTML template is still embedded!** We only extracted the department-specific table rendering sections, but:
- All CSS is still in the file
- All JavaScript is still in the file
- The form HTML is still in the file
- The transmittal display logic (all 7 tables) is still embedded

## Solution: Extract Base Template

### Option 1: Extract to Separate Template File (Recommended)
Create `services/templates/base_template.py`:
- Move entire `HTML_TEMPLATE` string
- Keep template injection logic in `gemini_service.py`
- **Reduction: ~1,350 lines → ~650 lines**

### Option 2: Split Further
- Extract CSS → `services/templates/styles.css` (or `.py` file)
- Extract JavaScript → `services/templates/scripts.js` (or `.py` file)
- Extract base HTML → `services/templates/base_template.py`
- **Reduction: ~1,350 lines → ~400 lines**

### Option 3: Use Jinja2 Template Files (More Complex)
- Convert to actual `.html` Jinja2 template files
- Use Flask's `render_template()` instead of `render_template_string()`
- Requires refactoring `main.py` to use templates
- **Reduction: ~1,350 lines → ~200 lines**

## Recommendation

**Extract the base template to `services/templates/base_template.py`** - This is the simplest approach that follows the same pattern we used for department templates.

Expected result:
- `gemini_service.py`: ~650 lines (down from 1,998)
- `services/templates/base_template.py`: ~1,350 lines
- Much easier to maintain and edit the HTML/CSS/JS separately
