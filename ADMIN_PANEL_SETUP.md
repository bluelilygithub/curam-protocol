# Admin Panel Setup Guide

**Date:** January 2025  
**Status:** ✅ Complete - Ready to Use  
**Location:** `/admin` route

---

## What Was Created

A complete admin dashboard for managing the Curam-Ai Protocol system, built as a **separate Flask blueprint** that doesn't modify any existing code.

### Files Created

1. **`routes/admin_routes.py`** - Admin routes blueprint
2. **`templates/admin/`** - Admin templates folder
   - `base.html` - Base template with sidebar navigation
   - `login.html` - Login page
   - `dashboard.html` - Main dashboard
   - `extractions.html` - Extraction history
   - `document_types.html` - Document types overview
   - `analytics.html` - Analytics dashboard

### Database Functions Added

Added to `database.py`:
- `save_extraction_result()` - Save extraction results to database
- `get_extraction_results()` - Get extraction results with filters
- `get_extraction_analytics()` - Get analytics and metrics

### Changes to Existing Files

- **`main.py`** - Added admin blueprint registration (2 lines)
- **`database.py`** - Added extraction result functions (no changes to existing functions)

---

## Accessing the Admin Panel

### URL
```
https://your-domain.com/admin
```

### Login Credentials

Set these environment variables in Railway:

```
ADMIN_USERNAME=your_username
ADMIN_PASSWORD=your_secure_password
```

**Default (if not set):**
- Username: `admin`
- Password: `changeme123`

⚠️ **IMPORTANT:** Change these in production!

---

## Setting Up Environment Variables

### Railway Dashboard
1. Go to your Railway project
2. Click on your web service
3. Go to "Variables" tab
4. Add:
   - `ADMIN_USERNAME` = your desired username
   - `ADMIN_PASSWORD` = your secure password

### Railway CLI
```bash
railway variables set ADMIN_USERNAME=your_username
railway variables set ADMIN_PASSWORD=your_secure_password
```

---

## Features

### 1. Dashboard (`/admin`)
- **Stats Cards:**
  - Total extractions (last 30 days)
  - Success rate
  - Average processing time
  - Document types count
- **Recent Extractions Table** - Last 10 extractions
- **Extractions by Document Type** - Breakdown chart

### 2. Extractions (`/admin/extractions`)
- **Filterable Table:**
  - Filter by document type
  - Filter by date range
  - Filter by success/failure
- **View Details** - See full extraction results (coming soon)

### 3. Document Types (`/admin/document-types`)
- View all document types
- See which sectors they belong to
- Check demo enabled status
- Check active status

### 4. Analytics (`/admin/analytics`)
- **Metrics:**
  - Total extractions
  - Success rate
  - Average processing time
- **Extractions by Document Type** - Distribution chart
- **Date Range Filter** - Custom date ranges

---

## Database Tables Used

The admin panel uses these existing database tables:

1. **`extraction_results`** ⭐ **NEW USAGE**
   - Stores extraction history
   - Currently empty (will populate as extractions are logged)
   - Used for: History, Analytics, Quality Monitoring

2. **`document_types`** ✅ **EXISTING**
   - Lists all document types
   - Used for: Document type management

3. **`sectors`** ✅ **EXISTING**
   - Lists all industry sectors
   - Used for: Sector grouping

---

## Next Steps

### To Start Collecting Data

The `extraction_results` table is currently empty. To start collecting data, you'll need to:

1. **Modify `routes/automater_routes.py`** (when ready)
   - Add call to `save_extraction_result()` after successful extraction
   - This will populate the `extraction_results` table
   - **Note:** This is a future enhancement, not required now

2. **Or manually test:**
   - The admin panel will work with empty data
   - Shows "No extractions yet" messages
   - Ready to display data once logging is enabled

### Future Enhancements

The admin panel is designed to support:
- **Field Management** (`extraction_fields` table)
- **FAQ Management** (`faqs` table)
- **Phases Management** (`phases` table)
- **Prompt Management** (`extraction_prompts` table)
- **User Feedback** (`user_satisfaction` table)

These can be added incrementally without modifying existing code.

---

## Testing Locally

1. **Set environment variables:**
   ```bash
   export ADMIN_USERNAME=admin
   export ADMIN_PASSWORD=test123
   ```

2. **Run Flask:**
   ```bash
   python main.py
   ```

3. **Access admin panel:**
   ```
   http://localhost:5000/admin
   ```

4. **Login with credentials:**
   - Username: `admin`
   - Password: `test123`

---

## Security Notes

### Current Implementation
- Simple session-based authentication
- Environment variable credentials
- No password hashing (basic implementation)

### Recommended for Production
- Use strong passwords (20+ characters)
- Consider adding password hashing (bcrypt)
- Add rate limiting on login attempts
- Add IP whitelisting if needed
- Consider 2FA for production

---

## Troubleshooting

### "No extractions found"
- **Normal:** The `extraction_results` table is empty until logging is enabled
- **Solution:** This is expected. The admin panel is ready to display data once extraction logging is added.

### "Table extraction_results does not exist"
- **Cause:** Table might not exist in your database
- **Solution:** The table should exist based on your SQL dump. If not, you may need to create it.

### Login not working
- **Check:** Environment variables are set correctly
- **Check:** Session cookies are enabled
- **Check:** Flask SECRET_KEY is set

### Styling looks broken
- **Check:** `/assets/css/styles.css` is accessible
- **Check:** Static versioning is working (`?v={{ static_version }}`)

---

## Architecture

### Separation from Existing Code
- ✅ **No modifications** to existing routes
- ✅ **No modifications** to existing templates
- ✅ **New blueprint** (`admin_bp`) registered separately
- ✅ **New templates** in `templates/admin/` folder
- ✅ **New database functions** added to `database.py` (no changes to existing)

### Works in Railway
- ✅ Same Flask app (no separate deployment)
- ✅ Uses existing database connection
- ✅ Uses existing static assets
- ✅ No build process required
- ✅ Works immediately after deployment

---

## Summary

✅ **Admin panel is complete and ready to use!**

- Access at: `/admin`
- Login with: Environment variable credentials
- Uses: Existing database tables
- Status: Ready for data collection

The admin panel is designed to grow with your system. As you enable extraction logging and add more features, the dashboard will automatically display the data.

---

**Questions?** Check the `ADMIN_PANEL_IMPLEMENTATION_PLAN.md` for detailed feature roadmap.
