# Phase 1 Refactoring - Utils Module

## What Was Done

Extracted utility functions from `main.py` into a new `utils/` module:

### Files Created
- `utils/__init__.py` - Module initialization with exports
- `utils/formatting.py` - Text and currency formatting functions
- `utils/prompts.py` - Prompt building functions for Gemini AI
- `tests/test_phase1_utils.py` - Comprehensive test suite

### Functions Extracted

#### `utils/formatting.py`
- `format_currency(value)` - Format numbers as currency
- `clean_text(text)` - Clean and normalize text
- `normalize_whitespace(text)` - Remove excessive whitespace
- `format_text_to_html(text)` - Convert plain text to HTML
- `detect_low_confidence(text)` - Detect OCR errors and garbled text

#### `utils/prompts.py`
- `build_finance_prompt(text)` - Build invoice extraction prompt
- `build_engineering_prompt(text)` - Build engineering schedule prompt
- `build_transmittal_prompt(text)` - Build drawing register prompt
- `build_prompt(text, doc_type)` - Router function for all prompts
- `prepare_prompt_text(text, doc_type, limit)` - Clean and limit prompt text

## Testing Instructions

### Step 1: Run Automated Tests

```bash
cd "C:\Users\micha\Local Sites\curam-protocol"
python tests/test_phase1_utils.py
```

**Expected Output:**
```
============================================================
PHASE 1 REFACTORING TESTS
Testing utils module extraction
============================================================

Testing imports...
✓ All imports successful
Testing format_currency...
✓ format_currency tests passed
Testing clean_text...
✓ clean_text tests passed
Testing normalize_whitespace...
✓ normalize_whitespace tests passed
Testing detect_low_confidence...
✓ detect_low_confidence tests passed
Testing format_text_to_html...
✓ format_text_to_html tests passed
Testing prepare_prompt_text...
✓ prepare_prompt_text tests passed
Testing prompt builders...
✓ prompt builder tests passed

============================================================
✓ ALL TESTS PASSED!
Phase 1 refactoring successful.
============================================================
```

### Step 2: Test Individual Functions

Open Python REPL and test each function:

```python
# Test currency formatting
from utils.formatting import format_currency
print(format_currency(1234.56))  # Should output: $1,234.56
print(format_currency("N/A"))    # Should output: (empty string)

# Test text cleaning
from utils.formatting import clean_text
print(clean_text("  hello   world  "))  # Should output: hello world

# Test prompt building
from utils.prompts import build_finance_prompt
prompt = build_finance_prompt("Invoice from ABC Corp")
print("Vendor" in prompt)  # Should output: True
```

### Step 3: Integration Test (DO NOT RUN YET)

**⚠️ IMPORTANT: Do NOT update main.py yet!**

The functions are extracted but `main.py` still has the original versions.
Phase 2 will update `main.py` to use the new utils module.

### Step 4: Verify File Structure

Check that files were created correctly:

```
utils/
├── __init__.py           ✓ Module exports
├── formatting.py         ✓ 8 functions (~220 lines)
└── prompts.py           ✓ 5 functions (~180 lines)

tests/
└── test_phase1_utils.py  ✓ Test suite (~180 lines)
```

## What to Check

### ✓ Pass Criteria
- [ ] All automated tests pass
- [ ] Functions can be imported from `utils` package
- [ ] No import errors or exceptions
- [ ] Currency formatting works correctly
- [ ] Text cleaning functions work
- [ ] Prompt builders return valid strings
- [ ] Low confidence detection logic works

### ✗ Fail Criteria
- Import errors (missing dependencies)
- Test assertions fail
- Functions return wrong data types
- Exceptions raised during tests

## Next Steps

Once all tests pass:

1. ✓ **Phase 1 Complete** - Utils extracted and tested
2. → **Phase 2** - Extract models/config (DEPARTMENT_SAMPLES, etc.)
3. → **Phase 3** - Extract services (Gemini, PDF, validation)
4. → **Phase 4** - Create Flask blueprints
5. → **Phase 5** - Update main.py to use new modules

## Troubleshooting

### Import Error: "No module named 'utils'"
**Solution:** Make sure you're running from the project root directory:
```bash
cd "C:\Users\micha\Local Sites\curam-protocol"
python tests/test_phase1_utils.py
```

### Test Fails: "AssertionError"
**Solution:** Check which specific test failed. The error message will show:
- Function name
- Expected vs actual output
- Fix the corresponding function in `utils/formatting.py` or `utils/prompts.py`

### "ModuleNotFoundError: No module named 're'"
**Solution:** This shouldn't happen (`re` is built-in), but if it does:
```bash
# Verify Python installation
python --version  # Should be 3.8+
```

## Success Metrics

**Phase 1 is complete when:**
- ✓ All tests pass with no errors
- ✓ Utils module can be imported
- ✓ Individual functions work correctly
- ✓ No code has been removed from main.py yet (we only added new files)

**Estimated Time:** 5-10 minutes to run tests

**Risk Level:** 🟢 LOW (no existing code modified, only new files added)

