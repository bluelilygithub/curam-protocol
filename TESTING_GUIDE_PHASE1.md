# Phase 1 Complete - Testing Guide

## 🎯 Quick Start

Run this command to test Phase 1:

```bash
python run_phase1_tests.py
```

## ✅ What to Test

### Test 1: Automated Test Suite (5 min)
```bash
cd "C:\Users\micha\Local Sites\curam-protocol"
python run_phase1_tests.py
```

**Expected:** All green checkmarks ✓

---

### Test 2: Manual Function Tests (3 min)

Open Python and test each utility:

```python
# Start Python
python

# Test 1: Currency formatting
from utils.formatting import format_currency
format_currency(1234.56)  # → "$1,234.56"
format_currency("")       # → ""

# Test 2: Text cleaning  
from utils.formatting import clean_text
clean_text("  hello   world  ")  # → "hello world"

# Test 3: OCR confidence detection
from utils.formatting import detect_low_confidence
detect_low_confidence("Normal text")  # → "high"
detect_low_confidence("H H o o t")    # → "low"

# Test 4: HTML formatting
from utils.formatting import format_text_to_html
format_text_to_html("Para 1.\n\nPara 2.")  # → "<p>Para 1.</p>\n<p>Para 2.</p>"

# Test 5: Prompt building
from utils.prompts import build_finance_prompt
prompt = build_finance_prompt("Test invoice")
"Vendor" in prompt  # → True
```

---

### Test 3: Import Verification (1 min)

```python
# Verify clean imports from utils package
from utils import (
    format_currency,
    format_text_to_html,
    clean_text,
    build_finance_prompt,
    build_engineering_prompt
)

# Success = no ImportError
```

---

## 📊 Test Results Checklist

Mark each test as you complete it:

- [ ] **Automated tests pass** (`python run_phase1_tests.py`)
- [ ] **format_currency works** (test with $1,234.56)
- [ ] **clean_text works** (test with whitespace)
- [ ] **detect_low_confidence works** (test with garbled text)
- [ ] **format_text_to_html works** (test with paragraphs)
- [ ] **build_finance_prompt works** (contains "Vendor")
- [ ] **build_engineering_prompt works** (contains "Mark" or "Size")
- [ ] **build_transmittal_prompt works** (contains "Drawing")
- [ ] **All imports successful** (no ImportError)

---

## 🔍 What We Extracted

| File | Functions | Lines | Purpose |
|------|-----------|-------|---------|
| `utils/formatting.py` | 5 functions | ~220 | Currency, text, HTML formatting |
| `utils/prompts.py` | 5 functions | ~180 | AI prompt building |
| **Total** | **10 functions** | **~400** | **Core utilities** |

These functions were **copied** from main.py (not moved yet).
main.py still has the originals - we'll update it in Phase 4.

---

## ⚠️ Important Notes

1. **DO NOT modify main.py yet** - we only added new files
2. **main.py still works** - nothing was broken
3. **Utils are tested independently** - safe to proceed
4. **Next: Phase 2** - extract config/models

---

## 🐛 If Tests Fail

### "No module named 'utils'"
→ Run from project root: `cd "C:\Users\micha\Local Sites\curam-protocol"`

### "AssertionError in test_X"
→ Check the error message for which function failed
→ Fix in `utils/formatting.py` or `utils/prompts.py`

### "Import Error: cannot import name 'X'"
→ Check `utils/__init__.py` has correct exports

---

## 📈 Success Criteria

**Phase 1 succeeds when:**
1. ✓ `run_phase1_tests.py` shows all tests passed
2. ✓ Manual tests work in Python REPL  
3. ✓ No import errors
4. ✓ main.py still runs (unchanged)

**Time Required:** 10 minutes
**Risk Level:** 🟢 LOW (only added files, no changes to existing code)

---

## 🚀 Next Phase

Once Phase 1 tests pass → Proceed to **Phase 2: Extract Models**

Phase 2 will extract:
- `DEPARTMENT_SAMPLES` configuration
- `ROUTINE_DESCRIPTIONS` text
- `ROUTINE_SUMMARY` data

See `PHASE1_README.md` for full documentation.

