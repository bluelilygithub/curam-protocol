# How to Add a New Department to the Automater

This guide shows you exactly what files to create/modify when adding a new department (e.g., "procurement", "hr", "legal", etc.).

## Overview

Adding a new department requires updates to **8 main areas**:

> **📁 PDF Files Location:** PDF files are defined in **`config.py`** in the `DEPARTMENT_SAMPLES` dictionary. This is the PRIMARY location. Optionally, they can also be loaded from the database (see Step 1 details below).

1. **Configuration** (`config.py`)
2. **Prompt** (`services/prompts/[dept]_prompt.py`)
3. **Template** (`services/templates/[dept]_template.py`)
4. **Export Function** (`routes/exports/[dept]_export.py`)
5. **Gemini Service** (`services/gemini_service.py`)
6. **Automater Routes** (`routes/automater_routes.py`)
7. **Base Template** (`services/templates/base_template.py`)
8. **Sample Files** (physical PDF files in a folder)

---

## Step-by-Step Guide

### Step 1: Add Department Configuration (`config.py`) - **PDF FILES DEFINED HERE**

**This is where you define which PDF files can be extracted for your department.**

Add your department to these dictionaries:

```python
# 1. Add to DEPARTMENT_SAMPLES
DEPARTMENT_SAMPLES = {
    # ... existing departments ...
    "your_dept": {
        "label": "Your Department Label",
        "description": "Description shown in UI",
        "folder": "your_folder",  # e.g., "procurement", "hr"
        "samples": [
            {"path": "your_folder/sample1.pdf", "label": "Sample 1"},
            {"path": "your_folder/sample2.pdf", "label": "Sample 2"},
        ]
    }
}

# 2. Add to ROUTINE_DESCRIPTIONS (HTML shown in UI)
ROUTINE_DESCRIPTIONS = {
    # ... existing departments ...
    "your_dept": [
        ("Your Department Title",
         """<p>HTML description of what this department does...</p>""")
    ]
}

# 3. Add to ROUTINE_SUMMARY (summary shown in results)
ROUTINE_SUMMARY = {
    # ... existing departments ...
    "your_dept": [
        ("Grind", "What manual work is done"),
        ("Frequency", "How often"),
        ("Saving", "Time saved"),
        ("Value", "Business value")
    ]
}

# 4. Define field schema
YOUR_DEPT_FIELDS = [
    "Field1", "Field2", "Field3", ...
]

# 5. Add to DOC_FIELDS mapping
DOC_FIELDS = {
    # ... existing departments ...
    "your_dept": YOUR_DEPT_FIELDS
}

# 6. Add error field mapping
ERROR_FIELD = {
    # ... existing departments ...
    "your_dept": "FieldName"  # Field to show errors in
}
```

**Note:** `SAMPLE_TO_DEPT` and `ALLOWED_SAMPLE_PATHS` are auto-generated from `DEPARTMENT_SAMPLES`, so no manual update needed.

**📌 IMPORTANT - Database Override (Optional):**
- The system can also load PDFs from the database if connected
- Function: `database.py` → `get_samples_for_template(department)`
- Currently only `finance`, `engineering`, and `transmittal` are mapped to database sectors
- `logistics` and new departments use hardcoded `config.py` samples only
- To enable database override for a new department, update `database.py` → `get_demo_config_by_department()` to map your department to a sector

---

### Step 2: Create Prompt File (`services/prompts/your_dept_prompt.py`)

Create a new file following the pattern of existing prompts:

```python
"""
Your Department prompt for document extraction
"""

def get_your_dept_prompt(text):
    """
    Generate the your_dept extraction prompt
    
    Args:
        text: Extracted text from PDF document
        
    Returns:
        Formatted prompt string for Gemini API
    """
    return f"""
# EXTRACTION PROMPT - YOUR DEPARTMENT

Your primary goal: Extract [describe what to extract] from the document.

## DOCUMENT CHARACTERISTICS
[Describe document types, formats, variations]

## EXTRACTION REQUIREMENTS
[Describe fields to extract, format requirements, validation rules]

## OUTPUT FORMAT
Return a JSON array with one object per row/item:
[
    {{
        "Field1": "value1",
        "Field2": "value2",
        ...
    }},
    ...
]

## TEXT TO EXTRACT FROM:
{text}
"""
```

**Then update `services/prompts/__init__.py`:**
```python
from .your_dept_prompt import get_your_dept_prompt

__all__ = [
    # ... existing ...
    'get_your_dept_prompt'
]
```

---

### Step 3: Create Template File (`services/templates/your_dept_template.py`)

Create a new file following the pattern of existing templates:

```python
"""
Your Department template section
Extracted from gemini_service.py for modularization
"""

def get_your_dept_template():
    """
    Returns the your_dept-specific template section
    
    Returns:
        str: Jinja2 template string for your_dept department
    """
    return """
        {% if department == 'your_dept' %}
        {# Render your_dept results #}
        {% if results %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">Your Department Documents Extracted</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">{{ results|length }} row(s) extracted</div>
            </div>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; margin-top: 20px; background: white;">
                    <thead>
                        <tr style="background-color: #0B1221; color: white;">
                            <th style="padding: 10px; border: 1px solid #ddd;">Field1</th>
                            <th style="padding: 10px; border: 1px solid #ddd;">Field2</th>
                            <!-- Add more columns as needed -->
                        </tr>
                    </thead>
                    <tbody>
                        {% for row in results %}
                        <tr style="border-bottom: 1px solid #ddd;">
                            <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('Field1', 'N/A') }}</td>
                            <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('Field2', 'N/A') }}</td>
                            <!-- Add more cells as needed -->
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
        </div>
        {% endif %}
        {% endif %}
"""
```

**Then update `services/gemini_service.py`** (around line 179-200):
```python
# Import template sections
try:
    from services.templates.your_dept_template import get_your_dept_template
    # ... existing imports ...
except ImportError:
    get_your_dept_template = None
    # ... existing fallbacks ...

_template_sections = {
    # ... existing ...
    'your_dept': get_your_dept_template()
}

# Update replacement loop (around line 284)
for dept in ['transmittal', 'engineering', 'finance', 'logistics', 'your_dept']:
    if dept in _template_sections and _template_sections[dept]:
        HTML_TEMPLATE = replace_template_section(HTML_TEMPLATE, dept, _template_sections[dept])
```

---

### Step 4: Create Export Function (`routes/exports/your_dept_export.py`)

Create a new file:

```python
"""
Your Department CSV Export

Handles CSV export formatting for Your Department documents.
"""

import pandas as pd


def export_your_dept_csv(df, saved):
    """
    Export your_dept department data to CSV format
    
    Args:
        df: pandas DataFrame with your_dept data
        saved: Session data dictionary
        
    Returns:
        pandas DataFrame formatted for CSV export
    """
    df_export = df.copy()
    
    # Select and order columns
    columns = [
        'Filename', 'Field1', 'Field2', 'Field3', ...
    ]
    
    df_export = df_export[[col for col in columns if col in df_export.columns]]
    
    # Add any custom formatting/transformations here
    
    return df_export
```

**Then update `routes/exports/__init__.py`:**
```python
from .your_dept_export import export_your_dept_csv

__all__ = [
    # ... existing ...
    'export_your_dept_csv'
]
```

**And update `routes/export_routes.py`:**
```python
from routes.exports import (
    # ... existing ...
    export_your_dept_csv
)

# In export_csv() function, add:
elif department == 'your_dept':
    df_export = export_your_dept_csv(df, saved)
```

---

### Step 5: Update Gemini Service (`services/gemini_service.py`)

**Update `build_prompt()` function** (around line 136-173):
```python
def build_prompt(text, doc_type, sector_slug=None):
    # ... existing code ...
    elif doc_type == "your_dept":
        if get_your_dept_prompt:
            return get_your_dept_prompt(text)
        return f"Extract your_dept data from: {text}"
```

**Update imports** (around line 22-30):
```python
from services.prompts import (
    get_finance_prompt,
    get_engineering_prompt,
    get_transmittal_prompt,
    get_logistics_prompt,
    get_your_dept_prompt  # Add this
)
```

---

### Step 6: Update Automater Routes (`routes/automater_routes.py`)

**Update sample selection logic** (around line 101-115):
```python
if department == 'engineering' or department == 'finance' or department == 'your_dept':
    selected_samples = request.form.getlist('samples')
    model_actions.append(f"{department.capitalize()} mode: selected_samples from form = {selected_samples}")
elif department == 'transmittal':
    # ... existing ...
elif department == 'logistics':
    # ... existing ...
else:
    selected_samples = request.form.getlist('samples')
```

**Update sample filtering** (around line 136-145):
```python
if department == 'transmittal':
    samples = [sample for sample in selected_samples if sample]
elif department == 'your_dept':
    # Add any special filtering logic if needed
    samples = [
        sample for sample in selected_samples
        if sample and SAMPLE_TO_DEPT.get(sample) == department
    ]
else:
    samples = [
        sample for sample in selected_samples
        if sample and SAMPLE_TO_DEPT.get(sample) == department
    ]
```

**Update result processing** (around line 256-300):
```python
if entries:
    if department == "transmittal":
        # ... existing ...
    elif department == "logistics":
        # ... existing ...
    elif department == "your_dept":
        # Add your department-specific processing
        model_actions.append(f"Extracted {len(entries)} row(s) from {filename}")
        for entry in entries:
            entry['Filename'] = filename
            # Add any custom processing/formatting here
            results.append(entry)
    else:
        # ... existing finance/engineering logic ...
```

**Update grouping logic** (around line 482-495):
```python
# Group results by filename if needed
grouped_your_dept_results = {}
if department == 'your_dept' and results:
    for row in results:
        filename = row.get('Filename', 'Unknown')
        if filename not in grouped_your_dept_results:
            grouped_your_dept_results[filename] = []
        grouped_your_dept_results[filename].append(row)
```

**Update template rendering** (around line 548):
```python
return render_template_string(
    HTML_TEMPLATE,
    results=results if results else [],
    grouped_engineering_results=grouped_engineering_results if department == 'engineering' else {},
    grouped_finance_results=grouped_finance_results if department == 'finance' else {},
    grouped_your_dept_results=grouped_your_dept_results if department == 'your_dept' else {},  # Add this
    # ... rest of parameters ...
)
```

**Update sample files building** (around line 495-500):
```python
# Build sample_files using centralized loader (automatically discovers all departments)
from utils.sample_loader import get_all_department_samples
sample_files_merged = get_all_department_samples(use_database=True)
```

**✅ NO HARDCODED LIST NEEDED!** The system automatically discovers departments from `config.py`, so adding a new department to `DEPARTMENT_SAMPLES` is all you need.

---

### Step 7: Update Base Template (`services/templates/base_template.py`)

**Add radio button** (around line 420-437):
```python
<div class="toggle-group">
    <label>
        <input type="radio" name="department" value="finance" {% if department == 'finance' %}checked{% endif %}>
        Finance Dept
    </label>
    <!-- ... existing ... -->
    <label>
        <input type="radio" name="department" value="your_dept" {% if department == 'your_dept' %}checked{% endif %}>
        Your Department
    </label>
</div>
```

**Add placeholder for template injection** (around line 485-495):
```python
{% if department == 'your_dept' %}
{# Your department section will be injected here #}
{% endif %}
```

---

### Step 8: Create Sample Files Folder

Create a physical folder and add sample PDFs:
```
your_folder/
├── sample1.pdf
├── sample2.pdf
└── sample3.pdf
```

Update the paths in `config.py` `DEPARTMENT_SAMPLES` to match these files.

---

## Where PDF Files Are Defined

**There are TWO places where PDF files can be defined for each department:**

### 1. Hardcoded Configuration (`config.py`) - PRIMARY/FALLBACK

The main location is in `config.py` in the `DEPARTMENT_SAMPLES` dictionary:

```python
DEPARTMENT_SAMPLES = {
    "your_dept": {
        "label": "Your Department Label",
        "description": "Description",
        "folder": "your_folder",
        "samples": [
            {"path": "your_folder/sample1.pdf", "label": "Sample 1"},
            {"path": "your_folder/sample2.pdf", "label": "Sample 2"},
        ]
    }
}
```

**This is the PRIMARY location** - it's always used as a fallback and is required.

### 2. Database Configuration (Optional Override)

The system can also load sample files from the database if:
- Database is connected (`database.py` has active connection)
- Database has entries in the `document_types` table with `sample_file_paths`

**How it works:**
- `utils/sample_loader.py` → `get_department_samples()` handles all loading
- Tries database first via `database.py` → `get_samples_for_template()`
- If database returns samples, those are used
- If database returns empty/error, automatically falls back to `config.py` `DEPARTMENT_SAMPLES`
- Database samples take priority

**Database structure:**
- Table: `document_types`
- Column: `sample_file_paths` (JSON array of file paths)
- Filtered by: `department` field matching your department name

**To use database:**
1. Ensure database connection is active
2. Insert/update `document_types` table with your department's sample file paths
3. Update `database.py` → `get_demo_config_by_department()` to map your department to a sector
4. The system will automatically use database samples if available

**For new departments:** Start with `config.py` hardcoded samples. Database override is optional. The system automatically discovers new departments from `config.py` - no code changes needed!

---

## Quick Checklist

When adding a new department "your_dept", you need to:

- [ ] **config.py**: Add to `DEPARTMENT_SAMPLES`, `ROUTINE_DESCRIPTIONS`, `ROUTINE_SUMMARY`, `DOC_FIELDS`, `ERROR_FIELD`
- [ ] **services/prompts/your_dept_prompt.py**: Create prompt file
- [ ] **services/prompts/__init__.py**: Import new prompt
- [ ] **services/templates/your_dept_template.py**: Create template file
- [ ] **services/gemini_service.py**: Import template, add to `_template_sections`, update `build_prompt()`
- [ ] **routes/exports/your_dept_export.py**: Create export function
- [ ] **routes/exports/__init__.py**: Import export function
- [ ] **routes/export_routes.py**: Add export routing
- [ ] **routes/automater_routes.py**: Update sample selection, filtering, processing, grouping
- [ ] **services/templates/base_template.py**: Add radio button and placeholder
- [ ] **Sample files**: Create folder and add PDF samples

---

## Example: How Logistics Was Added

Looking at the codebase, "logistics" was added following this exact pattern:

1. ✅ `config.py`: Added `"logistics"` to all dictionaries
2. ✅ `services/prompts/logistics_prompt.py`: Created (251 lines)
3. ✅ `services/templates/logistics_template.py`: Created (163 lines)
4. ✅ `routes/exports/logistics_export.py`: Created (30 lines)
5. ✅ `services/gemini_service.py`: Updated imports and routing
6. ✅ `routes/automater_routes.py`: Added logistics handling
7. ✅ `services/templates/base_template.py`: Added radio button
8. ✅ Sample files: Created `logistics/` folder with 5 PDFs

---

## Tips

1. **Start with one file at a time** - Don't try to do everything at once
2. **Copy an existing department** - Use "logistics" or "finance" as a template
3. **Test incrementally** - Test after each major file is added
4. **Field names matter** - Make sure field names match between prompt, template, and export
5. **Sample files are important** - The AI needs good examples to learn from

---

## Common Issues

- **"Department not found"**: Check `config.py` `DEPARTMENT_SAMPLES`
- **"No template rendered"**: Check `services/gemini_service.py` template imports
- **"Export fails"**: Check `routes/exports/your_dept_export.py` column names match data
- **"No prompt used"**: Check `services/gemini_service.py` `build_prompt()` function
