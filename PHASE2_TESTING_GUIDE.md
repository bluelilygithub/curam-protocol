# Phase 2 Complete - Testing Guide

## 🎯 Quick Start

Run this command to test Phase 2:

```bash
python run_phase2_tests.py
```

## ✅ What to Test

### Test 1: Automated Test Suite (5 min)
```bash
cd "C:\Users\micha\Local Sites\curam-protocol"
python run_phase2_tests.py
```

**Expected:** All green checkmarks ✓

---

### Test 2: Manual Config Tests (3 min)

Open Python and test configuration:

```python
# Start Python
python

# Test 1: Department samples
from models import DEPARTMENT_SAMPLES
DEPARTMENT_SAMPLES["finance"]["label"]  # → "Sample invoices"
len(DEPARTMENT_SAMPLES["finance"]["samples"])  # → 6

# Test 2: Sample mapping
from models import SAMPLE_TO_DEPT
SAMPLE_TO_DEPT["invoices/Bne.pdf"]  # → "finance"

# Test 3: Routine descriptions
from models import ROUTINE_DESCRIPTIONS
len(ROUTINE_DESCRIPTIONS["finance"])  # → 1 (tuple with heading and HTML)

# Test 4: Config classes
from config import get_config, DevelopmentConfig
config = get_config('development')
config.DEBUG  # → True
config.DEFAULT_DEPARTMENT  # → "finance"

# Test 5: Field schemas
from models.department_config import FINANCE_FIELDS, ENGINEERING_BEAM_FIELDS
"Vendor" in FINANCE_FIELDS  # → True
"Mark" in ENGINEERING_BEAM_FIELDS  # → True
```

---

### Test 3: Import Verification (1 min)

```python
# Verify clean imports
from models import (
    DEPARTMENT_SAMPLES,
    ROUTINE_DESCRIPTIONS,
    ROUTINE_SUMMARY,
    ALLOWED_SAMPLE_PATHS
)

from config import Config, get_config

# Success = no ImportError
```

---

## 📊 Test Results Checklist

Mark each test as you complete it:

- [ ] **Automated tests pass** (`python run_phase2_tests.py`)
- [ ] **DEPARTMENT_SAMPLES imports** (contains finance/engineering/transmittal)
- [ ] **SAMPLE_TO_DEPT mapping works** (maps paths to departments)
- [ ] **ROUTINE_DESCRIPTIONS imports** (contains descriptions for all depts)
- [ ] **Config classes work** (Development/Production/Testing)
- [ ] **get_config() function works** (returns correct config)
- [ ] **Field schemas import** (FINANCE_FIELDS, ENGINEERING_BEAM_FIELDS, etc.)
- [ ] **All package imports successful** (from models import ...)

---

## 🔍 What We Extracted

| File | Content | Lines | Purpose |
|------|---------|-------|---------|
| `models/department_config.py` | Sample files, descriptions, field schemas | ~170 | All department configuration |
| `config.py` | Flask config classes | ~90 | Environment-based settings |
| **Total** | **2 files** | **~260** | **Configuration & data** |

---

## ⚠️ Important Notes

1. **DO NOT modify main.py yet** - we only added new files
2. **main.py still works** - nothing was broken
3. **Models are tested independently** - safe to proceed
4. **Next: Phase 3** - extract services (Gemini, PDF, validation)

---

## 🐛 If Tests Fail

### "No module named 'models'"
→ Run from project root: `cd "C:\Users\micha\Local Sites\curam-protocol"`

### "AssertionError in test_X"
→ Check the error message for which test failed
→ Fix in `models/department_config.py` or `config.py`

### "KeyError: 'finance'"
→ Check DEPARTMENT_SAMPLES has all three departments

---

## 📈 Success Criteria

**Phase 2 succeeds when:**
1. ✓ `run_phase2_tests.py` shows all tests passed
2. ✓ Manual tests work in Python REPL  
3. ✓ No import errors
4. ✓ Config classes instantiate correctly

**Time Required:** 10 minutes
**Risk Level:** 🟢 LOW (only added files, no changes to existing code)

---

## 🚀 Next Phase

Once Phase 2 tests pass → Proceed to **Phase 3: Extract Services**

Phase 3 will extract:
- Gemini AI service (analyze_gemini, model management)
- PDF service (text extraction, pdfplumber)
- Validation service (OCR checks, engineering validation)

---

## 📦 Phase Progress

```
Phase 1: ✅ COMPLETE - Utils extracted
Phase 2: ✅ COMPLETE - Models/config extracted ← YOU ARE HERE
Phase 3: ⏳ NEXT - Services extraction
Phase 4: ⏳ PENDING - Blueprints
Phase 5: ⏳ PENDING - Update main.py
```

