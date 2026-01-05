# Main.py Refactoring Analysis

## Current State
- **File Size:** 84 KB (1,763 lines)
- **Functions:** 17 route handlers + helper functions
- **Status:** Already partially modularized (services extracted, static_pages blueprint exists)

## Refactoring Opportunities

Following the same pattern as prompts and templates, we can extract route handlers into separate modules.

### 1. API Routes (Recommended Priority: HIGH)
**Location:** Lines 131-845  
**Size:** ~715 lines  
**Routes:**
- `/test/dependencies` - Dependency checker
- `/api/search-blog` - Basic blog search
- `/api/search-blog-complete` - Complete blog search with RAG
- `/api/contact-assistant` - AI contact assistant
- `/api/email-chat-log` - Email chat log
- `/api/contact` - Contact form submission
- `/email-phase3-sample` - Phase 3 sample email

**Extract to:** `routes/api_routes.py`
**Benefits:**
- Clean separation of API endpoints
- Easier to add new API routes
- Better organization

### 2. Automater Routes (Recommended Priority: HIGH)
**Location:** Lines 1088-1594  
**Size:** ~506 lines  
**Routes:**
- `/automater` (GET, POST)
- `/extract` (GET, POST) - Alias for automater
- Helper function: `index_automater()` - Main extraction logic

**Extract to:** `routes/automater_routes.py`
**Benefits:**
- Core functionality isolated
- Main extraction logic easier to maintain
- Can add more extraction routes later

### 3. Export Routes (Recommended Priority: MEDIUM)
**Location:** Lines 1595-1730  
**Size:** ~135 lines  
**Routes:**
- `/export_csv` - General CSV export
- `/export_transmittal_csv` - Transmittal-specific CSV export

**Extract to:** `routes/export_routes.py`
**Benefits:**
- Export logic centralized
- Easy to add new export formats (JSON, Excel, etc.)

### 4. Sample/View Routes (Recommended Priority: LOW)
**Location:** Lines 1731-1763  
**Size:** ~32 lines  
**Routes:**
- `/sample` - View sample files

**Extract to:** `routes/sample_routes.py` (or keep in main.py if small)

## Implementation Strategy

### Phase 1: Extract API Routes (Easiest, Most Impact)
1. Create `routes/api_routes.py`
2. Create Flask Blueprint `api_bp`
3. Move all `/api/*` routes to blueprint
4. Register blueprint in `main.py`
5. **Estimated Reduction:** ~715 lines from main.py

### Phase 2: Extract Automater Routes (Core Functionality)
1. Create `routes/automater_routes.py`
2. Create Flask Blueprint `automater_bp`
3. Move `/automater` and `/extract` routes
4. Move `index_automater()` function
5. Register blueprint in `main.py`
6. **Estimated Reduction:** ~506 lines from main.py

### Phase 3: Extract Export Routes (Quick Win)
1. Create `routes/export_routes.py`
2. Create Flask Blueprint `export_bp`
3. Move `/export_csv` and `/export_transmittal_csv` routes
4. Register blueprint in `main.py`
5. **Estimated Reduction:** ~135 lines from main.py

## Expected Results

**After All Phases:**
- `main.py`: ~400 lines (down from 1,763)
- Better organization: routes grouped by functionality
- Easier maintenance: each route file is focused
- Follows same pattern as prompts/templates modularization

## Files Structure After Refactoring

```
routes/
├── __init__.py
├── static_pages.py          (existing)
├── api_routes.py            (new - ~715 lines)
├── automater_routes.py      (new - ~506 lines)
└── export_routes.py         (new - ~135 lines)

main.py                      (~400 lines - app setup + blueprint registration)
```

## Notes
- Keep it simple: just move route handlers, don't rewrite logic
- Maintain backward compatibility: all URLs stay the same
- Use Flask Blueprints (same pattern as static_pages)
- No database or service changes needed
