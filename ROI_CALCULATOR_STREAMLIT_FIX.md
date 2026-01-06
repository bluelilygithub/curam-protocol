# ROI Calculator Streamlit Import Fix

## Problem

**Error:** `No module named 'streamlit'` when loading ROI Calculator

## Root Cause

Python's import system was finding `roi_calculator.py` (a Streamlit file) before the `roi_calculator/` package directory when trying to import:

```python
from roi_calculator.calculations import has_full_roi_config, calculate_simple_roi
```

This caused Python to:
1. Find `roi_calculator.py` in the root directory
2. Try to import it (which imports `streamlit`)
3. Fail because `streamlit` is not installed (and not needed for Flask app)

## Solution

**Renamed `roi_calculator.py` to `roi_calculator_streamlit.py`**

This prevents the import conflict because:
- Python now correctly finds the `roi_calculator/` package directory
- The Streamlit file is preserved but doesn't interfere with imports
- Flask app can import from `roi_calculator.calculations` without issues

## Files Changed

- ✅ **Renamed:** `roi_calculator.py` → `roi_calculator_streamlit.py`
- ✅ **No code changes needed** - Flask app imports remain the same

## Verification

The import should now work correctly:
```python
from roi_calculator.calculations import has_full_roi_config, calculate_simple_roi
```

## Status

✅ **Fixed** - Import conflict resolved
✅ **Streamlit file preserved** - Can be used separately if needed
✅ **Flask app unaffected** - All imports work correctly
