# ROI Calculator Issue Analysis

## Problem Statement

The ROI calculator produces **credible numbers for "Architecture & Building Services"** but **questionable numbers for other industries**.

## Root Cause

### Current Implementation

**Line 3460 in `roi_calculator_flask.py`:**
```python
calculations = calculate_conservative_roi(staff_count, industry_config)
```

**ALL industries use the same function** `calculate_conservative_roi()`, which requires specific configuration fields:

### Required Fields for `calculate_conservative_roi()`:

1. **`doc_staff_percentage_base`** (defaults to 0.75)
2. **`doc_staff_hours_per_week`** (defaults to 5.0)
3. **`doc_staff_typical_rate`** (defaults to 130)
4. **`proven_tasks`** dictionary - Maps task IDs to percentages
5. **`tasks`** array - Detailed task definitions with:
   - `id`, `name`, `complexity`, `automation_potential`
   - `proven_success_rate`, `multiplier`, etc.

### Industry Configuration Status

**✅ "Architecture & Building Services"** - FULLY CONFIGURED:
- Has all required fields
- Has `proven_tasks` dictionary
- Has detailed `tasks` array (5 tasks)
- Has industry-specific rates and percentages

**❌ All Other Industries** - INCOMPLETE CONFIGURATION:
- Missing `proven_tasks` dictionary
- Missing `tasks` array
- Missing `doc_staff_percentage_base`, `doc_staff_hours_per_week`, `doc_staff_typical_rate`
- Only have `q1_label`, `q1_options`, `q2_label` (legacy fields)

### What Happens When Config is Missing?

When `calculate_conservative_roi()` runs for industries without proper config:

1. **Uses Architecture & Building Services defaults:**
   - `doc_staff_percentage_base = 0.75` (75% of staff do documentation)
   - `doc_staff_hours_per_week = 5.0` (5 hours/week per doc staff)
   - `doc_staff_typical_rate = 130` ($130/hour rate)

2. **Gets empty `proven_tasks` and `tasks`:**
   ```python
   proven_tasks = industry_config.get('proven_tasks', {})  # Returns {}
   tasks = industry_config.get('tasks', [])  # Returns []
   ```

3. **Result:**
   - `task_analysis = []` (empty)
   - `total_recoverable_hours = 0`
   - `total_proven_savings = 0`
   - But still calculates `annual_cost` using wrong assumptions!

4. **The numbers become questionable because:**
   - Using wrong staff percentage (75% may not apply to other industries)
   - Using wrong hourly rate ($130 may not apply to other industries)
   - Using wrong hours per week (5.0 may not apply to other industries)
   - No task breakdown, so savings are zero or wrong

## Solution Options

### Option 1: Complete Industry Configurations (Recommended)
**Add full configuration for all industries:**
- Add `proven_tasks` dictionary for each industry
- Add `tasks` array with detailed task definitions
- Add industry-specific rates and percentages

**Pros:**
- Accurate calculations for all industries
- Industry-specific assumptions
- Better credibility

**Cons:**
- Time-consuming (need to research each industry)
- Requires domain knowledge

### Option 2: Fallback Calculation Method
**Create a fallback for industries without full config:**
- Detect if industry has `proven_tasks` and `tasks`
- If missing, use a simpler calculation method
- Use industry-specific defaults from `automation_potential` field

**Pros:**
- Quick fix
- Works immediately for all industries

**Cons:**
- Less accurate than full config
- Still uses some assumptions

### Option 3: Hybrid Approach (Best)
**Combine both:**
1. Add fallback calculation for industries without full config
2. Gradually add full config for each industry as time permits
3. Prioritize industries with most usage

## Recommended Refactoring

### 1. Create Fallback Calculation Function

```python
def calculate_simple_roi(staff_count, avg_rate, industry_config):
    """
    Fallback calculation for industries without full proven_tasks config.
    Uses industry automation_potential and basic assumptions.
    """
    # Use industry-specific automation potential or default
    automation_potential = industry_config.get('automation_potential', 0.40)
    
    # Use industry-specific hours or default
    hours_per_staff = industry_config.get('hours_per_staff_per_week', 4.0)
    total_weekly_hours = staff_count * hours_per_staff
    
    # Calculate basic savings
    annual_burn = total_weekly_hours * avg_rate * 48
    tier_1_savings = annual_burn * automation_potential
    
    return {
        "mode": "simple_fallback",
        "total_staff": staff_count,
        "total_weekly_hours": total_weekly_hours,
        "annual_burn": annual_burn,
        "tier_1_savings": tier_1_savings,
        # ... other fields
    }
```

### 2. Update Route to Detect Config Type

```python
# Check if industry has full config
has_full_config = (
    'proven_tasks' in industry_config and 
    'tasks' in industry_config and 
    isinstance(industry_config.get('tasks'), list) and
    len(industry_config.get('tasks', [])) > 0
)

if has_full_config:
    calculations = calculate_conservative_roi(staff_count, industry_config)
else:
    # Use fallback for industries without full config
    calculations = calculate_simple_roi(staff_count, avg_rate, industry_config)
```

### 3. Gradually Add Full Configs

Prioritize industries by usage:
1. Architecture & Building Services ✅ (already done)
2. Construction (high usage likely)
3. Legal Services
4. Accounting & Advisory
5. Others...

## Code Structure Issues

### Current Structure Problems:

1. **Single calculation function for all industries** - Assumes all have same config structure
2. **No validation** - Doesn't check if required fields exist
3. **Silent failures** - Returns zeros/empty arrays instead of errors
4. **Hardcoded defaults** - Architecture & Building Services assumptions used for all

### Refactoring Benefits:

1. **Modular** - Separate functions for different calculation types
2. **Robust** - Handles missing config gracefully
3. **Maintainable** - Easy to add new industries
4. **Accurate** - Industry-specific calculations

## Next Steps

1. ✅ **Create analysis document** (this file)
2. ⚠️ **Implement fallback calculation** function
3. ⚠️ **Update route** to detect and use appropriate calculation
4. ⚠️ **Test** with different industries
5. ⚠️ **Gradually add full configs** for each industry
