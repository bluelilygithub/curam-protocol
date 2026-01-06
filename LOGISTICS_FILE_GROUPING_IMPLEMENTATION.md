# Logistics File-Level Grouping Implementation

## ✅ Implementation Complete

Added file-level grouping for logistics extraction to enable easy API integration while maintaining current UI display.

---

## Problem Statement

**Current Issue:**
- All Bills of Lading are grouped into one table
- All Packing Lists are grouped into another table
- **Problem:** If you want to send each PDF's data to individual APIs, you need to filter by `Filename` field
- **Inefficient:** Requires post-processing to group by file

**Solution:**
- Maintain **both** structures:
  1. `results` - Flat list grouped by document type (for UI display)
  2. `results_by_file` - Dictionary grouped by filename (for API integration)

---

## What Was Implemented

### 1. **File-Level Grouping Structure**

**New Data Structure:**
```python
results_by_file = {
    "Carrier Master Bill Of Lading.pdf": {
        "document_type": "bill_of_lading",
        "rows": [
            {"BLNumber": "MAEU220938445", "Shipper": "...", ...}
        ]
    },
    "Maersk Line - Sea Waybill Bill Of Lading.pdf": {
        "document_type": "bill_of_lading",
        "rows": [
            {"BLNumber": "MAEU220938445", ...}
        ]
    },
    "Timber Tally Sheet.pdf": {
        "document_type": "packing_list",
        "rows": [
            {"CartonNumber": "Bundle 1", ...},
            {"CartonNumber": "Bundle 2", ...}
        ]
    }
}
```

### 2. **Code Changes**

**`routes/automater_routes.py`:**
- Added `results_by_file = {}` dictionary
- Group entries by filename during processing
- Store in session for API access
- Pass to template (available but not required for UI)

### 3. **Session Storage**

**Stored in session:**
```python
session['last_results'] = {
    "department": "logistics",
    "rows": [...],  # Flat list for UI
    "results_by_file": {  # File-grouped for API
        "file1.pdf": {"document_type": "...", "rows": [...]},
        "file2.pdf": {"document_type": "...", "rows": [...]}
    }
}
```

---

## Benefits

### ✅ For API Integration

**Before (Current):**
```python
# Need to filter by filename
file1_rows = [r for r in results if r['Filename'] == 'file1.pdf']
file2_rows = [r for r in results if r['Filename'] == 'file2.pdf']
# Error-prone, inefficient
```

**After (New):**
```python
# Direct access by filename
for filename, file_data in results_by_file.items():
    api_payload = {
        "source_file": filename,
        "document_type": file_data["document_type"],
        "data": file_data["rows"]
    }
    send_to_api(api_payload)
# Clean, efficient, direct
```

### ✅ For UI Display

- **No changes required** - Current template still works
- `results` array still available for document-type grouping
- UI displays tables grouped by document type (as before)

### ✅ For Export Functions

- Can export each file separately
- Can export all files combined
- Easy to generate file-specific reports

---

## Usage Examples

### Example 1: Send Each File to Individual API

```python
# Get results from session
session_data = session.get('last_results', {})
results_by_file = session_data.get('results_by_file', {})

# Send each file to API
for filename, file_data in results_by_file.items():
    response = requests.post('https://api.example.com/process-document', json={
        "source_file": filename,
        "document_type": file_data["document_type"],
        "rows": file_data["rows"]
    })
    print(f"Sent {filename} to API: {response.status_code}")
```

### Example 2: Export Each File Separately

```python
results_by_file = session.get('last_results', {}).get('results_by_file', {})

for filename, file_data in results_by_file.items():
    df = pd.DataFrame(file_data["rows"])
    csv_filename = f"export_{filename.replace('.pdf', '.csv')}"
    df.to_csv(csv_filename, index=False)
    print(f"Exported {filename} to {csv_filename}")
```

### Example 3: Create API Endpoint

```python
@api_bp.route('/api/logistics-by-file', methods=['GET'])
def get_logistics_by_file():
    """Return logistics results grouped by file"""
    session_data = session.get('last_results', {})
    
    if session_data.get('department') != 'logistics':
        return jsonify({'error': 'No logistics results found'}), 404
    
    results_by_file = session_data.get('results_by_file', {})
    return jsonify(results_by_file)
```

---

## Data Structure Comparison

### Current Structure (for UI)
```python
results = [
    # All B/Ls together
    {"BLNumber": "...", "Filename": "file1.pdf"},
    {"BLNumber": "...", "Filename": "file2.pdf"},
    {"BLNumber": "...", "Filename": "file3.pdf"},
    # All Packing Lists together
    {"CartonNumber": "...", "Filename": "file4.pdf"},
    {"CartonNumber": "...", "Filename": "file4.pdf"},
]
```

### New Structure (for API)
```python
results_by_file = {
    "file1.pdf": {
        "document_type": "bill_of_lading",
        "rows": [{"BLNumber": "...", ...}]
    },
    "file2.pdf": {
        "document_type": "bill_of_lading",
        "rows": [{"BLNumber": "...", ...}]
    },
    "file3.pdf": {
        "document_type": "bill_of_lading",
        "rows": [{"BLNumber": "...", ...}]
    },
    "file4.pdf": {
        "document_type": "packing_list",
        "rows": [
            {"CartonNumber": "...", ...},
            {"CartonNumber": "...", ...}
        ]
    }
}
```

---

## Files Modified

1. **`routes/automater_routes.py`**
   - Added `results_by_file = {}` dictionary
   - Group logistics entries by filename
   - Store in session
   - Pass to template

---

## Testing

### Verify File Grouping

1. **Extract logistics documents:**
   - Select 3 B/L PDFs and 1 Packing List PDF
   - Run extraction

2. **Check session data:**
   ```python
   # In Python console or debug endpoint
   session_data = session.get('last_results', {})
   results_by_file = session_data.get('results_by_file', {})
   print(f"Files: {list(results_by_file.keys())}")
   for filename, data in results_by_file.items():
       print(f"{filename}: {len(data['rows'])} rows, type: {data['document_type']}")
   ```

3. **Expected output:**
   ```
   Files: ['file1.pdf', 'file2.pdf', 'file3.pdf', 'file4.pdf']
   file1.pdf: 1 rows, type: bill_of_lading
   file2.pdf: 1 rows, type: bill_of_lading
   file3.pdf: 1 rows, type: bill_of_lading
   file4.pdf: 2 rows, type: packing_list
   ```

---

## Next Steps

### For API Integration

1. **Create API endpoint** to return `results_by_file`
2. **Update export functions** to use file-grouped structure
3. **Add file-level validation** before sending to APIs

### For UI (Optional)

1. **Add file grouping view** - Show results grouped by file instead of document type
2. **Add file selector** - Let users choose which files to export/send
3. **Add file-level actions** - Export/send individual files

---

## Status

✅ **Implementation Complete**
- File-level grouping added
- Session storage updated
- Template receives both structures
- No breaking changes to UI
- Ready for API integration

**The system now maintains both structures:**
- `results` - For UI display (grouped by document type)
- `results_by_file` - For API integration (grouped by file)

**You can now easily send each PDF's data to individual APIs!**
