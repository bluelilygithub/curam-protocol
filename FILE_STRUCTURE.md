# Curam-Ai Automater - Refactored File Structure

## 📁 New Project Structure

```
curam-protocol/
│
├── main.py                          # Flask app (STILL ORIGINAL - will update Phase 4)
│
├── config.py                        # ✨ NEW - Environment configuration
│   ├── Config (base)
│   ├── DevelopmentConfig
│   ├── ProductionConfig
│   ├── TestingConfig
│   └── get_config()
│
├── database.py                      # ✓ Existing - database functions
│
├── models/                          # ✨ NEW - Data models & config
│   ├── __init__.py
│   └── department_config.py        # Department samples, descriptions, field schemas
│       ├── DEPARTMENT_SAMPLES      # Sample file configurations
│       ├── ROUTINE_DESCRIPTIONS    # UI workflow descriptions
│       ├── ROUTINE_SUMMARY         # Quick reference stats
│       ├── ALLOWED_SAMPLE_PATHS    # Security validation
│       ├── SAMPLE_TO_DEPT          # Path to department mapping
│       ├── FINANCE_FIELDS          # Invoice field schema
│       ├── ENGINEERING_BEAM_FIELDS # Beam schedule fields
│       ├── ENGINEERING_COLUMN_FIELDS # Column schedule fields
│       ├── TRANSMITTAL_FIELDS      # Drawing register fields
│       ├── DOC_FIELDS              # Document type mapping
│       └── ERROR_FIELD             # Error field mapping
│
├── utils/                           # ✨ NEW - Utility functions
│   ├── __init__.py
│   ├── formatting.py               # Text & currency formatting
│   │   ├── format_currency()
│   │   ├── clean_text()
│   │   ├── normalize_whitespace()
│   │   ├── format_text_to_html()
│   │   └── detect_low_confidence()
│   └── prompts.py                  # AI prompt builders
│       ├── build_finance_prompt()
│       ├── build_engineering_prompt()
│       ├── build_transmittal_prompt()
│       ├── build_prompt()
│       └── prepare_prompt_text()
│
├── services/                        # 🔜 PHASE 3 - Business logic services
│   ├── __init__.py
│   ├── gemini_service.py           # Gemini AI calls
│   ├── pdf_service.py              # PDF extraction
│   └── validation_service.py       # Data validation
│
├── routes/                          # 🔜 PHASE 4 - Flask blueprints
│   ├── __init__.py
│   ├── automater.py                # Document extraction routes
│   ├── static_pages.py             # Homepage, about, contact
│   ├── api.py                      # API endpoints
│   └── export.py                   # CSV export routes
│
├── templates/                       # ✓ Existing - Jinja2 templates
│   ├── base.html
│   ├── industries/
│   └── roi_*.html
│
├── tests/                           # ✨ NEW - Test suite
│   ├── __init__.py
│   ├── test_phase1_utils.py        # Phase 1: Utils tests
│   └── test_phase2_models.py       # Phase 2: Models tests
│
├── assets/                          # ✓ Existing - Static files
│   ├── css/
│   ├── js/
│   └── images/
│
├── uploads/                         # ✓ Existing - File uploads
│   └── finance/
│
├── .gitignore                       # ✓ Created - Git ignore rules
│
├── requirements.txt                 # ✓ Existing - Python dependencies
│
├── run_phase1_tests.py             # ✨ NEW - Phase 1 test runner
├── run_phase2_tests.py             # ✨ NEW - Phase 2 test runner
│
└── Documentation/
    ├── PHASE1_QUICKSTART.md        # Phase 1 quick reference
    ├── PHASE1_SUMMARY.md           # Phase 1 detailed summary
    ├── PHASE1_README.md            # Phase 1 full docs
    ├── PHASE2_QUICKSTART.md        # Phase 2 quick reference
    ├── PHASE2_SUMMARY.md           # Phase 2 detailed summary
    └── PHASE2_TESTING_GUIDE.md     # Phase 2 testing guide
```

---

## 📊 Before vs After

### Before (main.py - 6000+ lines)
```
main.py
├── Imports & config (50 lines)
├── DEPARTMENT_SAMPLES, configs (100 lines)
├── Utility functions (400 lines)
├── Gemini AI logic (3000 lines)
├── PDF processing (500 lines)
├── Validation logic (800 lines)
├── Route handlers (600 lines)
└── HTML template (2000 lines)
```

### After Phase 2 (Refactored)
```
main.py (still 6000 lines - not modified yet)

config.py (90 lines)
└── Flask configuration classes

models/department_config.py (170 lines)
└── All department data & schemas

utils/formatting.py (220 lines)
└── Text & currency utilities

utils/prompts.py (180 lines)
└── AI prompt builders

services/ (Phase 3 - Coming next)
routes/ (Phase 4 - Coming next)
```

---

## 🎯 Module Responsibilities

### `config.py`
**Purpose:** Application configuration  
**Contains:** Config classes, environment settings, constants  
**Used by:** Flask app initialization, services

### `models/department_config.py`
**Purpose:** Static configuration data  
**Contains:** Department samples, field schemas, descriptions  
**Used by:** Routes, templates, validation

### `utils/formatting.py`
**Purpose:** Text and display formatting  
**Contains:** Currency formatting, HTML conversion, text cleaning  
**Used by:** Routes, templates, export functions

### `utils/prompts.py`
**Purpose:** AI prompt generation  
**Contains:** Prompt builders for each document type  
**Used by:** Gemini service (Phase 3)

### `services/` (Phase 3)
**Purpose:** Business logic layer  
**Will contain:** Gemini AI, PDF processing, validation  
**Used by:** Routes (Phase 4)

### `routes/` (Phase 4)
**Purpose:** HTTP request handlers  
**Will contain:** Flask blueprints for each feature area  
**Used by:** Flask app

---

## 📈 Extraction Progress

| Phase | Module | Lines | Status |
|-------|--------|-------|--------|
| Phase 1 | `utils/` | ~400 | ✅ Complete |
| Phase 2 | `models/` + `config.py` | ~260 | ✅ Complete |
| Phase 3 | `services/` | ~4300 | 🔜 Next |
| Phase 4 | `routes/` | ~600 | ⏳ Pending |
| Phase 5 | Update `main.py` | Refactor | ⏳ Pending |

**Total Extracted:** ~660 lines  
**Remaining:** ~5400 lines

---

## 🔄 Import Changes (Phase 4)

### Current (Phase 2)
```python
# In main.py
DEPARTMENT_SAMPLES = {...}  # Still defined here
def format_currency(value):  # Still defined here
    ...
```

### After Phase 4 Update
```python
# In main.py (will be updated)
from models import DEPARTMENT_SAMPLES
from utils.formatting import format_currency
from services.gemini_service import analyze_document
```

---

## 📚 File Purposes Quick Reference

| File | Purpose | Size | Phase |
|------|---------|------|-------|
| `config.py` | App configuration | 90 lines | 2 |
| `models/department_config.py` | Department data | 170 lines | 2 |
| `utils/formatting.py` | Text formatting | 220 lines | 1 |
| `utils/prompts.py` | AI prompts | 180 lines | 1 |
| `services/gemini_service.py` | AI calls | TBD | 3 |
| `services/pdf_service.py` | PDF extraction | TBD | 3 |
| `services/validation_service.py` | Validation | TBD | 3 |
| `routes/automater.py` | Main routes | TBD | 4 |
| `routes/export.py` | Export routes | TBD | 4 |

---

## 🎯 Design Principles

### 1. Separation of Concerns
- **Config** - Settings and constants
- **Models** - Data structures
- **Utils** - Reusable functions
- **Services** - Business logic
- **Routes** - HTTP handlers

### 2. Single Responsibility
Each module has ONE clear purpose

### 3. Dependency Direction
```
Routes → Services → Utils
  ↓         ↓
Models ← Config
```

### 4. Testability
Each module can be tested independently

---

## 🚀 Benefits of New Structure

### ✅ Maintainability
- Easy to find code
- Clear module boundaries
- Single file to edit for specific changes

### ✅ Testability
- Each module tested independently
- Mock dependencies easily
- Faster test execution

### ✅ Scalability
- Add new departments easily (just update config)
- Add new services without touching routes
- Add new routes without touching services

### ✅ Collaboration
- Multiple developers can work simultaneously
- Clear ownership of modules
- Reduced merge conflicts

---

## 📖 Related Documentation

- `PHASE1_SUMMARY.md` - Utils extraction details
- `PHASE2_SUMMARY.md` - Models/config extraction details
- `PHASE1_README.md` - Full Phase 1 documentation
- `PHASE2_TESTING_GUIDE.md` - Testing instructions

---

## 🔍 Finding Code

### "Where is the currency formatting?"
→ `utils/formatting.py`

### "Where are department samples defined?"
→ `models/department_config.py`

### "Where is the Flask config?"
→ `config.py`

### "Where are AI prompts built?"
→ `utils/prompts.py`

### "Where is Gemini AI called?" (Phase 3)
→ `services/gemini_service.py`

### "Where are routes defined?" (Phase 4)
→ `routes/automater.py`

---

**Last Updated:** After Phase 2 completion  
**Next Update:** Phase 3 (Services extraction)

