# ROI Report Logging Implementation

## ✅ Implementation Complete

All ROI report generation events are now logged to the database.

---

## What Was Implemented

### 1. **New Logging Function** (`database.py`)

Added `log_roi_report()` function that:
- Logs to `action_logs` table (if exists)
- Falls back to `email_captures` table if `action_logs` doesn't exist
- Stores ROI-specific data in JSONB format
- Captures user tracking information (IP, user agent, session)

### 2. **Logging Added to All Report Routes**

**PDF Download** (`/pdf` route):
- ✅ Now logs every PDF download
- Captures: industry, staff_count, avg_rate, calculations, delivery method

**Email PDF Report** (`/email-report` route):
- ✅ Enhanced existing logging
- Now logs via both `capture_email_request()` and `log_roi_report()`

**Phase 1 Email Report** (`/email-phase1-report` route):
- ✅ Enhanced existing logging
- Now logs via both `capture_email_request()` and `log_roi_report()`

**Roadmap Email** (`/send-roadmap-email` route):
- ✅ Now logs every roadmap email
- Captures: industry, staff_count, calculations, email address

---

## Database Table

### Option 1: Use Existing `action_logs` Table (Recommended)

**If the table exists**, it will be used automatically. The function tries this first.

**Schema:**
```sql
CREATE TABLE action_logs (
    id SERIAL PRIMARY KEY,
    action_type VARCHAR(100) NOT NULL,
    action_data JSONB,
    source_page VARCHAR(500),
    ip_address VARCHAR(45),
    user_agent TEXT,
    session_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Option 2: Create Table (If It Doesn't Exist)

**SQL Script:** `CREATE_ACTION_LOGS_TABLE.sql`

Run this script if `action_logs` table doesn't exist:
```bash
psql $DATABASE_URL -f CREATE_ACTION_LOGS_TABLE.sql
```

Or execute the SQL directly in your database.

---

## Data Captured

For each report generation, the following is logged:

### Report Metadata
- **report_type:** `pdf_download`, `email_report`, `phase1_report`, `roadmap_email`
- **industry:** Industry name (e.g., "Architecture & Building Services")
- **delivery_method:** `download` or `email`
- **email_address:** Email (if email delivery)

### ROI Metrics
- **staff_count:** Number of staff
- **avg_rate:** Average hourly rate
- **tier_1_savings:** Tier 1 savings amount
- **tier_2_savings:** Tier 2 savings amount
- **annual_burn:** Annual cost
- **annual_cost:** Annual cost (alternative field)
- **total_recoverable_hours:** Recoverable hours per week
- **weighted_potential:** Automation potential percentage
- **mode:** Calculation mode (e.g., "conservative_proven", "simple_fallback")

### User Tracking
- **ip_address:** User's IP address
- **user_agent:** Browser user agent
- **session_id:** Flask session ID
- **source_page:** URL where report was generated
- **created_at:** Timestamp

---

## Querying the Data

### Get All ROI Reports
```sql
SELECT * 
FROM action_logs 
WHERE action_type LIKE 'roi_report_%' 
ORDER BY created_at DESC;
```

### Get PDF Downloads Only
```sql
SELECT 
    id,
    action_data->>'industry' as industry,
    action_data->>'staff_count' as staff_count,
    action_data->>'tier_1_savings' as tier_1_savings,
    created_at
FROM action_logs 
WHERE action_type = 'roi_report_pdf_download' 
ORDER BY created_at DESC;
```

### Get Reports by Industry
```sql
SELECT 
    action_data->>'industry' as industry,
    COUNT(*) as report_count,
    COUNT(*) FILTER (WHERE action_type = 'roi_report_pdf_download') as pdf_downloads,
    COUNT(*) FILTER (WHERE action_type = 'roi_report_email_report') as email_reports
FROM action_logs 
WHERE action_type LIKE 'roi_report_%' 
GROUP BY action_data->>'industry' 
ORDER BY report_count DESC;
```

### Get Daily Report Counts
```sql
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_reports,
    COUNT(*) FILTER (WHERE action_type = 'roi_report_pdf_download') as pdf_downloads,
    COUNT(*) FILTER (WHERE action_type = 'roi_report_email_report') as email_reports
FROM action_logs
WHERE action_type LIKE 'roi_report_%'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

### Get Average Savings by Industry
```sql
SELECT 
    action_data->>'industry' as industry,
    COUNT(*) as report_count,
    AVG((action_data->>'tier_1_savings')::numeric) as avg_tier_1_savings,
    AVG((action_data->>'tier_2_savings')::numeric) as avg_tier_2_savings
FROM action_logs
WHERE action_type LIKE 'roi_report_%'
  AND action_data->>'tier_1_savings' IS NOT NULL
GROUP BY action_data->>'industry'
ORDER BY avg_tier_1_savings DESC;
```

---

## Files Modified

1. **`database.py`**
   - Added `log_roi_report()` function

2. **`roi_calculator_flask.py`**
   - Updated imports to include `log_roi_report`
   - Added logging to `/pdf` route
   - Enhanced logging in `/email-report` route
   - Enhanced logging in `/email-phase1-report` route
   - Added logging to `/send-roadmap-email` route

3. **`CREATE_ACTION_LOGS_TABLE.sql`** (new)
   - SQL script to create `action_logs` table if needed

---

## Testing

### Verify Logging Works

1. **Generate a PDF download:**
   - Go to ROI calculator
   - Complete assessment
   - Click "Download PDF"
   - Check database: `SELECT * FROM action_logs WHERE action_type = 'roi_report_pdf_download' ORDER BY created_at DESC LIMIT 1;`

2. **Generate an email report:**
   - Complete assessment
   - Enter email and click "Email Report"
   - Check database: `SELECT * FROM action_logs WHERE action_type = 'roi_report_email_report' ORDER BY created_at DESC LIMIT 1;`

3. **Check console logs:**
   - Should see: `✅ ROI report logged: pdf_download (Architecture & Building Services) - ID: X`

---

## Status

✅ **Implementation Complete**
- Logging function created
- All report routes updated
- Fallback mechanism in place
- SQL script provided for table creation

**Next Step:** Run `CREATE_ACTION_LOGS_TABLE.sql` if `action_logs` table doesn't exist, or verify it works with existing table.
