# Logistics Extraction: Grouping by File for API Integration

## Current Structure vs. API Requirements

### Current Approach ❌
**Problem:** All documents of the same type are grouped into one table, losing file-level grouping.

**Current Data Structure:**
```python
results = [
    # All B/L rows mixed together
    {"BLNumber": "...", "Filename": "file1.pdf", ...},
    {"BLNumber": "...", "Filename": "file2.pdf", ...},
    {"BLNumber": "...", "Filename": "file3.pdf", ...},
    # All Packing List rows mixed together
    {"CartonNumber": "...", "Filename": "file4.pdf", ...},
    {"CartonNumber": "...", "Filename": "file4.pdf", ...},
]
```

**Display:** Grouped by document type (all B/Ls in one table, all Packing Lists in another)

**API Problem:** If you want to send each PDF's data to a separate API endpoint, you need to:
1. Filter results by `Filename`
2. Group rows by file
3. Send each file's data separately

This is **inefficient** and **error-prone**.

---

## Better Approach for API Integration ✅

### Option 1: Group by File First (Recommended)

**Data Structure:**
```python
results_by_file = {
    "file1.pdf": {
        "document_type": "bill_of_lading",
        "rows": [
            {"BLNumber": "...", ...}
        ]
    },
    "file2.pdf": {
        "document_type": "bill_of_lading",
        "rows": [
            {"BLNumber": "...", ...}
        ]
    },
    "file3.pdf": {
        "document_type": "packing_list",
        "rows": [
            {"CartonNumber": "...", ...},
            {"CartonNumber": "...", ...}
        ]
    }
}
```

**Benefits:**
- ✅ Easy to send each file to individual API
- ✅ Maintains document type information
- ✅ Preserves file-level grouping
- ✅ Can still display in grouped tables for UI

**API Integration:**
```python
for filename, file_data in results_by_file.items():
    api_payload = {
        "source_file": filename,
        "document_type": file_data["document_type"],
        "data": file_data["rows"]
    }
    send_to_api(api_payload)
```

---

### Option 2: Maintain Both Structures

**Keep current structure for display, add grouped structure for API:**

```python
# For display (current)
results = [...]  # Flat list grouped by document type

# For API (new)
results_by_file = {
    "file1.pdf": [...],
    "file2.pdf": [...],
    "file3.pdf": [...]
}
```

**Benefits:**
- ✅ No changes to UI/template
- ✅ Easy API integration
- ✅ Best of both worlds

---

## Recommended Implementation

### Step 1: Group Results by File

Modify `routes/automater_routes.py` to maintain both structures:

```python
# Current: Flat results array
results = []

# New: Grouped by file
results_by_file = {}

# When processing each file:
for entry in entries:
    entry['Filename'] = filename
    results.append(entry)  # Keep for display
    
    # Group by file for API
    if filename not in results_by_file:
        results_by_file[filename] = {
            "document_type": entry.get('_document_type', 'unknown'),
            "rows": []
        }
    results_by_file[filename]["rows"].append(entry)
```

### Step 2: Pass Both to Template

```python
return render_template('automater_results.html',
    results=results,  # For display
    results_by_file=results_by_file,  # For API/export
    ...
)
```

### Step 3: API Endpoint

```python
@api_bp.route('/api/extract-logistics', methods=['POST'])
def extract_logistics_api():
    # Receive file
    file = request.files['file']
    
    # Extract
    entries = extract_from_file(file)
    
    # Return grouped by file
    return jsonify({
        "source_file": file.filename,
        "document_type": entries[0].get('_document_type'),
        "rows": entries
    })
```

---

## Comparison

| Aspect | Current (Type Grouping) | File Grouping | Both Structures |
|--------|------------------------|---------------|-----------------|
| **UI Display** | ✅ Easy (grouped tables) | ⚠️ More complex | ✅ Easy |
| **API Integration** | ❌ Requires filtering | ✅ Direct | ✅ Direct |
| **File Tracking** | ⚠️ Via Filename field | ✅ Native | ✅ Native |
| **Code Complexity** | ✅ Simple | ⚠️ Moderate | ⚠️ Moderate |
| **Data Integrity** | ⚠️ Can mix files | ✅ Preserved | ✅ Preserved |

---

## Recommendation

**Use Option 2: Maintain Both Structures**

1. **Keep current `results` array** for UI display (no template changes)
2. **Add `results_by_file` dictionary** for API integration
3. **Export functions** can use `results_by_file` for file-level exports
4. **API endpoints** can use `results_by_file` for individual file processing

This gives you:
- ✅ No breaking changes to UI
- ✅ Easy API integration
- ✅ File-level data integrity
- ✅ Flexible for future needs

---

## Implementation Steps

1. **Modify `routes/automater_routes.py`**
   - Add `results_by_file = {}` dictionary
   - Group entries by filename during processing
   - Pass both to template

2. **Update Export Functions**
   - Use `results_by_file` for CSV exports
   - Export each file separately or combined

3. **Create API Endpoint**
   - Accept file upload
   - Return file-grouped structure
   - Easy integration with external systems

4. **Template (Optional)**
   - Can add file-level grouping in UI if desired
   - Or keep current document-type grouping

---

## Example: API Payload Structure

**Current (requires filtering):**
```json
{
  "all_bills_of_lading": [
    {"BLNumber": "...", "Filename": "file1.pdf"},
    {"BLNumber": "...", "Filename": "file2.pdf"}
  ]
}
```

**Recommended (file-grouped):**
```json
{
  "file1.pdf": {
    "document_type": "bill_of_lading",
    "rows": [{"BLNumber": "...", ...}]
  },
  "file2.pdf": {
    "document_type": "bill_of_lading",
    "rows": [{"BLNumber": "...", ...}]
  }
}
```

**Much easier for API integration!**
