# ROI Calculator Module - Refactoring Progress

## Current Status: Partial Refactoring Complete

This directory contains the beginning of a refactored ROI calculator module. The original `roi_calculator_flask.py` file (3,262 lines) has been partially modularized.

## Completed

✅ **Directory Structure Created**
```
roi_calculator/
├── config/
│   ├── __init__.py
│   ├── industries.py      (548 lines extracted)
│   └── opportunities.py   (137 lines extracted)
├── calculations.py        (469 lines extracted)
└── README.md
```

✅ **Config Module** (`roi_calculator/config/`)
- `industries.py`: Contains the `INDUSTRIES` dictionary with all industry-specific configurations
- `opportunities.py`: Contains the `AI_OPPORTUNITIES` dictionary
- Total: ~685 lines extracted from main file

✅ **Calculations Module** (`roi_calculator/calculations.py`)
- `format_currency()`: Currency formatting utility
- `generate_automation_roadmap()`: Legacy roadmap generator
- `generate_automation_roadmap_v3()`: Current roadmap generator  
- `get_readiness_response()`: Data readiness messaging
- `get_doc_staff_percentage()`: Staff percentage calculator with firm size scaling
- `calculate_conservative_roi()`: Conservative ROI calculation
- `calculate_metrics_v3()`: Current metrics calculator
- `calculate_metrics()`: Legacy metrics calculator (deprecated)
- Total: ~469 lines extracted

## Still in Original File

The following remain in `roi_calculator_flask.py`:

❌ **PDF Generation** (`generate_pdf_report()` function ~105 lines)
- ReportLab-based PDF generation
- Should be moved to `roi_calculator/pdf_generator.py`

❌ **HTML Templates** (~2,100 lines of embedded HTML)
- Currently stored as Python strings in `HTML_TEMPLATE` variable
- Should be extracted to `roi_calculator/templates/`:
  - `step1_industry.html`
  - `step2_input.html`
  - `step3_results.html`
  - `step4_pdf.html`

❌ **Route Handlers** (~300 lines)
- `roi_calculator()`: Main route handler
- `email_report()`: Email sending route
- `send_roadmap_email()`: Roadmap email route
- `generate_roadmap_email_html()`: Email HTML generator
- `download_pdf()`: PDF download route
- `test_route()`: Test route
- Should be moved to `roi_calculator/routes.py`

❌ **Email Service** (~150 lines)
- Email generation and sending logic
- Should be moved to `roi_calculator/email_service.py`

## How to Use the Refactored Modules

### Option 1: Import from new modules (recommended for new code)

```python
from roi_calculator.config import INDUSTRIES, AI_OPPORTUNITIES
from roi_calculator.calculations import (
    calculate_conservative_roi,
    calculate_metrics_v3,
    generate_automation_roadmap_v3,
    format_currency
)

# Use in your code
industry_config = INDUSTRIES["Architecture & Building Services"]
results = calculate_conservative_roi(total_staff=25, industry_config=industry_config)
```

### Option 2: Keep using original file (current production setup)

The original `roi_calculator_flask.py` still works as-is. The refactored modules are independent and don't affect the original file.

## Recommended Next Steps

### Phase 1: Complete Basic Refactoring (2-4 hours)

1. **Extract PDF Generator**
   ```python
   # Create roi_calculator/pdf_generator.py
   # Move generate_pdf_report() function
   ```

2. **Extract Email Service**
   ```python
   # Create roi_calculator/email_service.py
   # Move email-related functions
   ```

3. **Create Routes Module**
   ```python
   # Create roi_calculator/routes.py
   # Move all @roi_app.route() handlers
   ```

### Phase 2: Extract Templates (4-6 hours)

1. **Split HTML_TEMPLATE by step**
   - Extract step 1 (industry selection) → `step1_industry.html`
   - Extract step 2 (data input) → `step2_input.html`
   - Extract step 3 (results) → `step3_results.html`
   - Extract step 4 (PDF) → `step4_pdf.html`

2. **Update route handlers to use `render_template()` instead of `render_template_string()`**

### Phase 3: Create Main Module Init (1 hour)

```python
# Create roi_calculator/__init__.py
from flask import Blueprint
from .routes import register_routes
from .config import INDUSTRIES, AI_OPPORTUNITIES

def create_blueprint():
    roi_app = Blueprint('roi_calculator', __name__, 
                       template_folder='templates')
    register_routes(roi_app)
    return roi_app

__all__ = ['create_blueprint', 'INDUSTRIES', 'AI_OPPORTUNITIES']
```

### Phase 4: Update Main App (1 hour)

```python
# In your main app.py or __init__.py
from roi_calculator import create_blueprint

roi_bp = create_blueprint()
app.register_blueprint(roi_bp, url_prefix='/roi-calculator')
```

### Phase 5: Testing & Validation (2-3 hours)

1. Test all routes still work
2. Test PDF generation
3. Test email sending
4. Check for any broken imports
5. Verify static assets load correctly

## Benefits After Full Refactoring

- **Maintainability**: ~500 lines per file vs 3,262 in one file
- **Testing**: Can test modules independently
- **Collaboration**: Multiple developers can work without conflicts
- **Debugging**: Easier to locate issues
- **Reusability**: Calculations module can be used by other parts of the app
- **Modern Flask Patterns**: Proper use of blueprints and templates

## Migration Strategy

**LOW RISK**: Keep both versions running during transition
1. Deploy refactored modules alongside original file
2. Add feature flag to switch between implementations
3. Test refactored version in staging
4. Gradually migrate production traffic
5. Remove original file once stable

**Total Estimated Time**: 10-16 hours for complete refactoring

## Questions?

This refactoring improves code organization significantly but doesn't change functionality. The original file will continue to work as-is.

