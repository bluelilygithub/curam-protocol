# Curam-Ai Protocol: Operations Guide

**Last Updated:** January 2026  
**Purpose:** Quick start, deployment, daily operations, and troubleshooting

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Deployment](#deployment)
3. [Environment Variables](#environment-variables)
4. [Daily Operations](#daily-operations)
5. [Troubleshooting](#troubleshooting)
6. [Common Tasks](#common-tasks)

---

## Quick Start

### For New Developers

**1. Clone Repository**
```bash
git clone <repository-url>
cd curam-protocol
```

**2. Set Up Local Environment**
```bash
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
```

**3. Set Environment Variables**
```bash
# Create .env file (DO NOT COMMIT)
DATABASE_URL=postgresql://...
GEMINI_API_KEY=...
SECRET_KEY=...
ADMIN_PASSWORD=...
```

**4. Run Locally**
```bash
python main.py
# Visit http://localhost:5000
```

**5. Test with Sample PDFs**
- Navigate to `/automater`
- Select a department (Finance/Engineering/Transmittal)
- Verify extraction accuracy (90%+ expected)

**6. Access Admin Dashboard**
- Navigate to `http://localhost:5000/admin`
- Login with admin credentials

---

## Deployment

### Production Environment

**Platform:** Replit / Railway  
**Domain:** https://curam-ai.com.au  
**Python Version:** 3.11+  
**WSGI Server:** Gunicorn

### Workflow Configuration

The project uses a Flask Server workflow:
```
python main.py
```

For production, use Gunicorn:
```
gunicorn main:app --bind 0.0.0.0:$PORT --workers 4 --timeout 120
```

---

## Environment Variables

### Required Variables

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Google Gemini API access |
| `SECRET_KEY` | Flask session encryption |
| `DATABASE_URL` | PostgreSQL connection string |
| `ADMIN_PASSWORD` | Admin dashboard access |

### Optional Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MAILCHANNELS_API_KEY` | - | Email sending |
| `UPLOAD_BASE_DIR` | `uploads` | File upload location |

---

## Daily Operations

### Regular Checks

**Daily:**
- Check logs for errors
- Monitor Gemini API quota usage
- Verify extraction accuracy with spot checks

**Weekly:**
- Review extraction accuracy across all departments
- Check resource usage
- Review error logs for patterns

### Monitoring

**Good Signs in Logs:**
```
✓ Connected! Sectors: X
✓ Text extracted successfully
✓ Success with gemini-2.5-flash-lite
📋 Validation: X/Y rows valid
```

**Warning Signs:**
```
⚠ Database failed: ...
⚠ All models failed
⚠ PDF extraction failed
```

---

## Troubleshooting

### ROI Calculator Shows Wrong Numbers

**Check:**
- Documentation staff should be 80% of total staff
- Executives excluded should be 20%

**Example (50 staff):**
- Documentation staff: 40 (80%)
- Excluded: 10 (20%)
- If showing 50/0, the calculation function may not be applying the 80% rule

**Fix:**
- Verify both `calculate_conservative_roi` and `calculate_simple_roi` functions use the 80% rule
- Check `roi_calculator/calculations.py`

### Poor Extraction Accuracy

**Expected Accuracy:**
- Digital PDFs: 95%+
- Clean scans: 90%+
- Poor scans: 85%+

**If Below Thresholds:**
1. Check prompt templates are DISABLED (`is_active = false`)
2. Verify code-based prompts are active
3. Test with different PDF samples

### Database Connection Errors

**Check:**
1. `DATABASE_URL` environment variable set correctly
2. Database status in hosting dashboard
3. Network connectivity

### Application Won't Start

**Check:**
1. Logs for errors
2. Database connection (`DATABASE_URL` set?)
3. Gemini API key (`GEMINI_API_KEY` set?)
4. Python version (3.11+ required)

---

## Common Tasks

### Adding a New Industry to ROI Calculator

**Step 1: Update Industry Config**
```python
# In roi_calculator_flask.py (INDUSTRIES dict at top of file)
INDUSTRIES = {
    'New Industry': {
        'context': 'Industry description',
        'automation_potential': 0.40,
        # ... other config
    }
}
```

**Step 2: Add to UI**
- Update industry selection in templates
- Add to Target Markets page if needed

### Updating ROI Calculation Rules

**Key files:**
- `roi_calculator/calculations.py` - Main calculation logic
- `roi_calculator_flask.py` - Templates and display

**Current rule:** Fixed 80% documentation staff (20% executives excluded)

---

## Critical Gotchas

### 🚨 TOP 3 THINGS THAT WILL BREAK THE SYSTEM

**1. ENABLING DATABASE PROMPTS**
```sql
-- ⚠️ NEVER DO THIS (unless prompts are updated):
UPDATE prompt_templates SET is_active = true;
-- Impact: Accuracy drops from 93% to ~60%
```

**2. CHANGING GEMINI API KEY WITHOUT TESTING**
- Test immediately with sample PDF
- Check logs for API errors
- Verify quota/billing is active

**3. MODIFYING ROI CALCULATION WITHOUT UPDATING ALL FUNCTIONS**
- Both `calculate_conservative_roi` AND `calculate_simple_roi` must be updated
- UI templates must match calculation output

---

## Performance Benchmarks

### Extraction Speed (Target)

- Finance: 20-30 seconds per invoice
- Engineering: 30-60 seconds per schedule
- Transmittal: 15-20 seconds per register

### Accuracy Targets

- Finance: 95%+
- Engineering: 93%+
- Transmittal: 95%+

---

## Support Resources

**Internal Documentation:**
- `TECHNICAL_GUIDE.md` - Technical architecture
- `PHASE_1_TRIAL_GUIDE.md` - Phase 1 trial management
- `PROMPT_MANAGEMENT.md` - Prompt system guide

**External Resources:**
- Google Gemini API Docs: https://ai.google.dev/docs
- Flask Documentation: https://flask.palletsprojects.com/

---

**Document Version:** 3.0  
**Last Updated:** January 2026
