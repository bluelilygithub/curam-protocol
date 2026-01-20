# ROI Calculator Module

**Last Updated:** January 2026

## Overview

The ROI Calculator provides industry-specific ROI estimates for document automation. It uses a conservative methodology based on proven automation rates.

## Key Business Rules

### Fixed 80/20 Documentation Staff Rule

**Business Decision:** 20% of staff are executives/senior partners who do NOT do repetitive documentation.

```python
EXECUTIVE_EXCLUSION_RATE = 0.20
doc_staff_percentage = 1.0 - EXECUTIVE_EXCLUSION_RATE  # Always 80%
doc_staff_count = int(total_staff * doc_staff_percentage)
```

**Example (50-staff firm):**
- Total staff: 50
- Documentation staff: 40 (80%)
- Excluded (executives): 10 (20%)

### Core Calculation Formula

```
Documentation Staff = Total Staff × 0.80
Total Weekly Hours = Doc Staff × Hours per Staff per Week
Annual Documentation Cost = Weekly Hours × Hourly Rate × 48 weeks
Tier 1 Savings = Annual Cost × Automation Potential × Industry Variance Multiplier
```

## Supported Industries (5)

| Industry | Average ROI | Variance Multiplier |
|----------|-------------|---------------------|
| Accounting | $739k | 0.90 (High) |
| Engineering | $437k | 0.75 (Medium) |
| Logistics | $432k | 0.90 (High) |
| Financial Planning | $358k | 0.90 (High) |
| Insurance | $489k | 0.90 (High) |

## Three Savings Scenarios

1. **Conservative:** Base calculation with industry variance multiplier
2. **Probable:** Conservative × 1.15 (15% above conservative)
3. **Optimistic:** Conservative × 1.35 (35% above conservative)

## Staff Adoption Sensitivity

Applied to Probable scenario:
- **High Adoption (80%):** Strong change management, comprehensive training
- **Expected Adoption (60%):** Standard training (default/most likely)
- **Low Adoption (40%):** Minimal training, resistance to change

## Module Structure

```
roi_calculator/
├── __init__.py
├── calculations.py      # Core calculation functions
└── README.md
```

Note: Industry configs are now embedded in `roi_calculator_flask.py`.

## Key Functions

### `calculate_conservative_roi(total_staff, industry_config)`
Main ROI calculation using fixed 80% documentation staff rule.

### `calculate_simple_roi(staff_count, avg_rate, industry_config)`
Fallback calculation for industries without full task configuration. Also uses 80% rule.

### `has_full_roi_config(industry_config)`
Checks if industry has proven_tasks and tasks arrays for detailed calculation.

## Usage

```python
from roi_calculator.calculations import calculate_conservative_roi, calculate_simple_roi

# Industry configs are defined in roi_calculator_flask.py
# Pass industry_config dict to calculation functions
results = calculate_conservative_roi(total_staff=50, industry_config=industry_config)

# For industries without full configuration
results = calculate_simple_roi(staff_count=50, avg_rate=140, industry_config=industry_config)

# Results include:
# - doc_staff_count: 40 (80% of 50)
# - doc_staff_percentage: 80.0
# - total_weekly_hours: 200 (40 × 5 hours)
# - annual_cost: $1,248,000 (200 × $130 × 48)
# - tier_1_savings: Calculated based on automation potential
```

## Main Route File

The Flask routes and HTML templates are in `roi_calculator_flask.py` (root directory). This file contains:
- Blueprint registration
- Route handlers (step 1-4)
- Embedded HTML templates
- PDF generation
- Email functionality

## Recent Changes (January 2026)

- Removed firm size scaling for documentation staff percentage
- Implemented fixed 80% documentation staff rule across all calculations
- Updated both `calculate_conservative_roi` and `calculate_simple_roi` functions
- Updated UI to display "Documentation Staff (80%)" and "Executives/Senior Partners (20%)"
- Removed "Firm Size Adjustment Applied" section from results
