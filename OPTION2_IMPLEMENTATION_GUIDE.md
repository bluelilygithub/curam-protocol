# Option 2 Implementation Guide - Python Function-Based Templates

## Overview

This guide will help you implement the Python function-based approach to modularize the HTML template, similar to how prompts are organized.

## What You Need to Do

### Step 1: Create the Template Directory Structure

**Action:** Create the following directory and files:

```
services/templates/
  ├── __init__.py
  ├── base_template.py
  ├── logistics_template.py
  ├── finance_template.py
  ├── engineering_template.py
  └── transmittal_template.py
```

**Command to create:**
```bash
mkdir services\templates
```

**Files to create:**
1. `services/templates/__init__.py` (empty file or with imports)
2. `services/templates/logistics_template.py` (we'll start with this)
3. Other template files (can be created as we extract them)

---

### Step 2: Identify the Logistics Section

**What I need from you:** 
- The exact line numbers where the logistics section starts and ends in `services/gemini_service.py`

**How to find it:**
1. Open `services/gemini_service.py`
2. Search for: `{% if department == 'logistics' %}`
3. Note the line number where it starts
4. Find the matching `{% endif %}` that closes it
5. Note that line number

**Or tell me:** "The logistics section is around line X to line Y" and I can extract it for you.

---

### Step 3: Extract the Logistics Template (I'll Do This)

Once you provide the line numbers, I will:
1. Extract the logistics section code
2. Create `services/templates/logistics_template.py`
3. Create the function that returns the template string
4. Update `services/gemini_service.py` to use it

**What you'll see:**
- A new file: `services/templates/logistics_template.py`
- Updated `services/gemini_service.py` with an import and function call

---

### Step 4: Test the Changes

**What you need to do:**
1. Run your Flask application
2. Test the logistics extraction
3. Verify the tables still display correctly
4. Check for any errors in the console

**If there are errors:**
- Share the error message
- I'll help fix it

---

## Detailed Steps

### Step 1: Create Directory Structure

**Windows PowerShell:**
```powershell
cd "c:\Users\micha\Local Sites\curam-protocol"
New-Item -ItemType Directory -Path "services\templates" -Force
New-Item -ItemType File -Path "services\templates\__init__.py" -Force
New-Item -ItemType File -Path "services\templates\logistics_template.py" -Force
```

**Or manually:**
- Create folder: `services/templates/`
- Create empty file: `services/templates/__init__.py`
- Create empty file: `services/templates/logistics_template.py`

---

### Step 2: Find Logistics Section Boundaries

**Method 1: Using Search**
1. Open `services/gemini_service.py` in your editor
2. Press `Ctrl+F` (or `Cmd+F` on Mac)
3. Search for: `{% if department == 'logistics' %}`
4. Note the line number (e.g., line 1230)
5. Search for the matching `{% endif %}` that closes it
6. Count forward from the `{% if department == 'logistics' %}` line
   - Look for the `{% endif %}` that's at the same indentation level
   - This should be around line 1420-1430 based on the structure

**Method 2: Visual Inspection**
Look for this pattern:
```jinja2
{% if department == 'logistics' %}
    <!-- All the logistics code here -->
    <!-- Tables, conditionals, etc. -->
{% endif %}
```

**What to report back:**
- Start line: `{% if department == 'logistics' %}` is at line X
- End line: The matching `{% endif %}` is at line Y

---

### Step 3: I'll Extract and Create the Template File

Once you give me the line numbers, I'll:

1. **Read the logistics section** from `services/gemini_service.py`
2. **Create `services/templates/logistics_template.py`** with:
   ```python
   """
   Logistics department template section
   """
   
   def get_logistics_template():
       """
       Returns the logistics-specific template section
       
       Returns:
           str: Jinja2 template string for logistics department
       """
       return """
       {% if department == 'logistics' %}
       <!-- All the extracted logistics code here -->
       {% endif %}
       """
   ```

3. **Update `services/gemini_service.py`** to:
   - Import the function: `from services.templates.logistics_template import get_logistics_template`
   - Replace the logistics section in `HTML_TEMPLATE` with: `{get_logistics_template()}`

---

### Step 4: Test

**What to test:**
1. Start your Flask app
2. Navigate to the logistics extraction page
3. Upload some logistics documents
4. Run the extraction
5. Verify:
   - ✅ Tables display correctly
   - ✅ No errors in console
   - ✅ All three table types show (FTA, BOL, Packing List)
   - ✅ Data is correct

**If something breaks:**
- Share the error message
- I'll help debug

---

## What You Need to Provide

### Minimum Required:
1. ✅ **Line numbers** for logistics section start/end
   - Or just say "extract the logistics section" and I'll find it

### Optional but Helpful:
2. ✅ **Test results** after I make the changes
3. ✅ **Any errors** you encounter

---

## Example of What Will Change

### Before (in `services/gemini_service.py`):
```python
HTML_TEMPLATE = """
...
{% if department == 'logistics' %}
    <!-- 200 lines of logistics code -->
{% endif %}
...
"""
```

### After:

**New file: `services/templates/logistics_template.py`**
```python
def get_logistics_template():
    return """
    {% if department == 'logistics' %}
        <!-- 200 lines of logistics code -->
    {% endif %}
    """
```

**Updated `services/gemini_service.py`**
```python
from services.templates.logistics_template import get_logistics_template

HTML_TEMPLATE = f"""
...
{get_logistics_template()}
...
"""
```

---

## Quick Start Checklist

- [ ] Create `services/templates/` directory
- [ ] Create `services/templates/__init__.py` (empty file)
- [ ] Find logistics section line numbers (or ask me to find them)
- [ ] Tell me the line numbers (or say "extract it")
- [ ] I'll create the template file and update the code
- [ ] Test the changes
- [ ] Report any issues

---

## Next Steps After Logistics

Once logistics is working:
1. **Finance** - Extract finance section (similar process)
2. **Engineering** - Extract engineering section
3. **Transmittal** - Extract transmittal section
4. **Base template** - Extract common parts (CSS, JS, form)

Each follows the same pattern, so it gets easier each time.

---

## Questions?

**Q: Do I need to understand Jinja2?**
A: No, I'll handle the extraction. You just need to find the line numbers.

**Q: Will this break existing functionality?**
A: No, it's just moving code to a separate file. The functionality stays the same.

**Q: Can I test incrementally?**
A: Yes! We'll do one department at a time, test it, then move to the next.

**Q: What if I make a mistake?**
A: All changes are in version control (git). You can always revert. Plus, I'll make the changes carefully.

---

## Ready to Start?

**Just tell me:**
1. "I've created the `services/templates/` directory"
2. "The logistics section starts at line X and ends at line Y" 
   - OR: "Please find and extract the logistics section for me"

And I'll do the rest! 🚀
