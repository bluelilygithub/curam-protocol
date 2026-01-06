# ROI Report Logging Analysis

## Current State

### Existing Logging Infrastructure

**1. `action_logs` Table** (if exists)
- Used for: General application event logging
- Fields: `action_type`, `action_data` (JSONB), `source_page`, `ip_address`, `user_agent`, `session_id`, `created_at`
- Currently used for: Search query logging

**2. `email_captures` Table** (confirmed exists)
- Used for: Email report requests
- Fields: `email_address`, `report_type`, `source_page`, `request_data` (JSONB), `ip_address`, `user_agent`, `session_id`, `email_sent`, `email_sent_at`, `created_at`
- Currently used for: ROI email reports (already logging!)

### ROI Report Generation Points

1. **PDF Download** (`/pdf` route) - ❌ **NOT LOGGED**
2. **Email PDF Report** (`/email-report` route) - ✅ **ALREADY LOGGED** (uses `email_captures`)
3. **Phase 1 Email Report** (`/email-phase1-report` route) - ✅ **ALREADY LOGGED** (uses `email_captures`)
4. **Roadmap Email** (`/send-roadmap-email` route) - ❌ **NOT LOGGED**

## Recommendation

### Option 1: Use Existing `action_logs` Table (Recommended)

**Pros:**
- No new table needed
- Consistent with existing logging pattern
- Can track all report types (PDF downloads, emails, etc.)

**Cons:**
- Need to verify table exists
- May need to add fields if more detail needed

### Option 2: Create Dedicated `roi_report_logs` Table

**Pros:**
- Purpose-built for ROI reports
- Can include ROI-specific fields (industry, staff_count, savings, etc.)
- Easier to query ROI-specific data

**Cons:**
- Additional table to maintain
- More complex schema

## Recommended Approach

**Use `action_logs` table** with a new logging function:

1. Create `log_roi_report()` function in `database.py`
2. Log all report generation events:
   - PDF downloads
   - Email reports (already logged, but can enhance)
   - Roadmap emails
3. Store ROI-specific data in `action_data` JSONB field

## Implementation Plan

### Step 1: Verify/Create `action_logs` Table

Check if table exists, create if needed:

```sql
CREATE TABLE IF NOT EXISTS action_logs (
    id SERIAL PRIMARY KEY,
    action_type VARCHAR(100) NOT NULL,
    action_data JSONB,
    source_page VARCHAR(500),
    ip_address VARCHAR(45),
    user_agent TEXT,
    session_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_action_logs_type ON action_logs(action_type);
CREATE INDEX idx_action_logs_created ON action_logs(created_at);
```

### Step 2: Create Logging Function

Add to `database.py`:

```python
def log_roi_report(report_type, industry=None, staff_count=None, 
                  avg_rate=None, calculations=None, delivery_method='download',
                  email_address=None, ip_address=None, user_agent=None, 
                  session_id=None, source_page=None):
    """
    Log ROI report generation to database.
    
    Args:
        report_type: 'pdf_download', 'email_report', 'phase1_report', 'roadmap_email'
        industry: Industry name
        staff_count: Number of staff
        avg_rate: Average hourly rate
        calculations: Full calculations dict (will be stored as JSON)
        delivery_method: 'download' or 'email'
        email_address: Email if delivery_method is 'email'
        ... (other tracking fields)
    
    Returns:
        int: Record ID or None
    """
```

### Step 3: Add Logging to Routes

Update routes in `roi_calculator_flask.py`:
- `/pdf` route → Add logging
- `/email-report` route → Enhance existing logging
- `/email-phase1-report` route → Enhance existing logging  
- `/send-roadmap-email` route → Add logging

## Data to Capture

For each report generation:
- **Report Type:** pdf_download, email_report, phase1_report, roadmap_email
- **Industry:** Which industry was selected
- **Staff Count:** Number of staff
- **Average Rate:** Hourly rate used
- **Key Metrics:** Tier 1 savings, Tier 2 savings, annual burn
- **Delivery Method:** download or email
- **Email Address:** (if email delivery)
- **User Tracking:** IP, user agent, session ID
- **Timestamp:** When generated

## Next Steps

1. ✅ **Verify `action_logs` table exists** (check database dump)
2. ⚠️ **Create table if needed** (SQL script)
3. ⚠️ **Create `log_roi_report()` function** (database.py)
4. ⚠️ **Add logging to all report routes** (roi_calculator_flask.py)
5. ⚠️ **Test logging** (verify records are created)
