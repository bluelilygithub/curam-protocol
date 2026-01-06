# Department Sample Loading Refactoring

## Problem

The previous system had several issues that made it hard to manage:

1. **Hardcoded department list** - Had to manually update `['finance', 'engineering', 'transmittal', 'logistics']` in `routes/automater_routes.py`
2. **Complex merge logic** - Database and config merging happened inline in route handler
3. **No single source of truth** - Sample loading logic scattered across multiple files
4. **Incomplete database support** - Only 3 departments mapped to database, logistics and new departments couldn't use database

## Solution

Created a centralized utility module: `utils/sample_loader.py`

### Key Functions

1. **`get_department_samples(department, use_database=True)`**
   - Single function to get samples for one department
   - Automatically handles database override with config.py fallback
   - Returns full config dict with label, description, folder, samples

2. **`get_all_department_samples(use_database=True)`**
   - Automatically discovers all departments from `config.py`
   - No hardcoded list needed!
   - Returns dict of all departments

3. **`build_sample_to_dept_mapping(use_database=True)`**
   - Builds reverse mapping: sample path → department
   - Includes database samples if available
   - Replaces hardcoded `SAMPLE_TO_DEPT`

4. **`get_allowed_sample_paths(use_database=True)`**
   - Gets set of all allowed paths for security validation
   - Includes database samples if available

## Benefits

✅ **Auto-discovery** - New departments in `config.py` are automatically picked up  
✅ **Single source of truth** - All sample loading goes through one module  
✅ **Database-aware** - Automatically uses database if available, falls back to config  
✅ **No hardcoded lists** - System discovers departments from config  
✅ **Easier to maintain** - One place to update sample loading logic  

## Changes Made

### 1. Created `utils/sample_loader.py`
- Centralized sample loading functions
- Handles database/config merging automatically
- Auto-discovers departments from `config.py`

### 2. Updated `routes/automater_routes.py`
- Replaced 25+ lines of merge logic with 3 lines
- Uses `get_all_department_samples()` instead of hardcoded loop
- Uses `build_sample_to_dept_mapping()` for dynamic mapping

### 3. Updated `config.py`
- Added note that `SAMPLE_TO_DEPT` and `ALLOWED_SAMPLE_PATHS` are now built dynamically
- Kept for backward compatibility but recommend using utility functions

## How to Add a New Department Now

**Before (had to update 3+ places):**
1. Add to `config.py` `DEPARTMENT_SAMPLES`
2. Update hardcoded list in `routes/automater_routes.py` line 497
3. Update `SAMPLE_TO_DEPT` generation in `config.py`
4. Update `ALLOWED_SAMPLE_PATHS` generation in `config.py`

**After (just 1 place):**
1. Add to `config.py` `DEPARTMENT_SAMPLES` ✅
2. Done! System automatically discovers it

## Database Override

The system still supports database override:
- If database has samples for a department, those are used
- If database is empty/errors, falls back to `config.py`
- Database samples take priority

To enable database for a new department:
- Update `database.py` → `get_demo_config_by_department()` to map your department to a sector
- Or just use `config.py` - it works fine without database

## Migration Notes

- **Backward compatible** - Existing code still works
- `SAMPLE_TO_DEPT` and `ALLOWED_SAMPLE_PATHS` in `config.py` still exist but only include config.py samples
- For database-aware mappings, use `utils.sample_loader` functions
- No breaking changes to existing functionality
