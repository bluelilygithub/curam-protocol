# Sample Paths Fix

## Issue

Finance, Engineering, and Transmittal were showing PDF names correctly but links were pointing to old paths (e.g., `invoices/Bne.pdf` instead of `samples/finance/Bne.pdf`).

Logistics was working correctly because it wasn't in the database, so it used `config.py` which had the new paths.

## Root Cause

The `utils/sample_loader.py` was trying the database first, and the database had old paths for finance, engineering, and transmittal. Only logistics fell back to `config.py` (which had correct paths).

## Fix

Changed `routes/automater_routes.py` line 502:
- **Before:** `get_all_department_samples(use_database=True)`
- **After:** `get_all_department_samples(use_database=False)`

This ensures all departments use `config.py` which has the correct `samples/[department]/` paths.

## Result

✅ All departments now use `config.py` paths  
✅ All links point to `samples/[department]/[filename].pdf`  
✅ Consistent behavior across all departments  

## Future

If you want to re-enable database lookup, update the database `document_types` table to have paths like `samples/finance/...` instead of `invoices/...`.
