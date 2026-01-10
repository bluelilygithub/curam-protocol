# Phase 1 Trial File Storage

## Current Storage Location

**Physical Path:**
- **Local Development:** `uploads/phase1_trials/<trial_id>/` (relative to Flask app root)
- **Railway Production:** Same path, but in **ephemeral container filesystem**

**Full Example:**
- Local: `C:\Users\micha\Local Sites\curam-protocol\uploads\phase1_trials\1\`
- Railway: `/app/uploads/phase1_trials/1/` (container filesystem - **EPHEMERAL**)

---

## ⚠️ CRITICAL: Railway Ephemeral Storage Issue

**Current Status:** Files are stored in the Railway container's filesystem, which is **ephemeral** (temporary).

**What This Means:**
- ✅ Files persist while container is running
- ❌ Files are **lost** when container restarts
- ❌ Files are **lost** on every deployment/redeploy
- ❌ Files are **lost** on container crashes
- ❌ Files are **lost** when Railway scales or replaces containers

**This is a production issue** - customer documents will be lost if the container restarts or redeploys!

---

## Solutions for Persistent Storage

### Option 1: Railway Persistent Volume (Recommended for Railway)

**What:** Mount a persistent volume to Railway container

**Steps:**
1. In Railway dashboard, go to your web service
2. Click "Settings" → "Volumes"
3. Click "Create Volume"
4. Name: `phase1-uploads`
5. Mount path: `/data/uploads`
6. Add environment variable: `UPLOAD_BASE_DIR=/data/uploads`
7. Redeploy service

**Configuration:**
```bash
# Set in Railway environment variables
UPLOAD_BASE_DIR=/data/uploads
```

**Result:** Files stored at `/data/uploads/phase1_trials/<trial_id>/` persist across deployments.

---

### Option 2: Cloud Object Storage (S3, Cloudflare R2, etc.)

**Best for:** Scalable, reliable, cloud-native storage

**Options:**
- **AWS S3** - Industry standard, reliable
- **Cloudflare R2** - S3-compatible, no egress fees
- **DigitalOcean Spaces** - S3-compatible, simple
- **Railway's object storage** (if available)

**Implementation:** Would require updating upload/download code to use cloud storage SDKs instead of local filesystem.

---

### Option 3: Database Storage (Not Recommended for PDFs)

**Why Not:** PDFs are too large (typically 100KB-5MB each). Database storage would:
- Slow down database operations
- Increase database costs
- Hit database size limits quickly
- Be inefficient for binary files

**When to Use:** Only for very small files (<100KB) or metadata.

---

## Current File Structure

**Directory Tree:**
```
uploads/  (or /data/uploads if using Railway volume)
└── phase1_trials/
    ├── 1/  (trial_id = 1)
    │   ├── 1704067200000_invoice-001.pdf
    │   ├── 1704067201000_beam-schedule.pdf
    │   └── ...
    ├── 2/  (trial_id = 2)
    │   └── ...
    └── ...
```

**File Naming:**
- Format: `{timestamp_ms}_{original_filename}.pdf`
- Example: `1704067200000_invoice-001.pdf`
- Timestamp prevents filename conflicts
- Original filename preserved for reference

**Database Reference:**
- File path stored in: `phase1_trial_documents.stored_file_path`
- Example: `uploads/phase1_trials/1/1704067200000_invoice-001.pdf`
- Or: `/data/uploads/phase1_trials/1/1704067200000_invoice-001.pdf` (if using volume)

---

## How to Check Current Storage Location

**Via Railway CLI:**
```bash
railway run ls -la uploads/phase1_trials/
```

**Via Railway Dashboard:**
1. Go to web service
2. Click "Deployments" → Latest deployment → "Shell"
3. Run: `ls -la uploads/phase1_trials/`

**Via Application Logs:**
Add temporary logging to see actual path:
```python
print(f"Upload directory: {os.path.abspath(trial_upload_dir)}")
```

---

## Recommended Immediate Actions

### 1. Add Railway Volume (Quick Fix)

1. Railway Dashboard → Web Service → Settings → Volumes
2. Create volume: `phase1-uploads`
3. Mount at: `/data/uploads`
4. Set env var: `UPLOAD_BASE_DIR=/data/uploads`
5. Redeploy

### 2. Verify .gitignore

Ensure `uploads/phase1_trials/` is in `.gitignore` (customer documents should never be committed to git).

### 3. Backup Strategy

Even with persistent volumes, implement regular backups:
- Option A: Automated S3 backups from Railway volume
- Option B: Database backup includes file references (but not actual files)
- Option C: Periodic manual export of customer documents

---

## Storage Path Configuration

**Environment Variable:**
```bash
UPLOAD_BASE_DIR=/data/uploads  # For Railway persistent volume
# OR
UPLOAD_BASE_DIR=uploads        # For local development (default)
```

**Code Configuration (config.py):**
```python
UPLOAD_BASE_DIR = os.environ.get('UPLOAD_BASE_DIR', 'uploads')
PHASE1_TRIALS_UPLOAD_DIR = os.path.join(UPLOAD_BASE_DIR, 'phase1_trials')
```

**Usage in Code:**
```python
from config import PHASE1_TRIALS_UPLOAD_DIR
trial_upload_dir = os.path.join(PHASE1_TRIALS_UPLOAD_DIR, str(trial_id))
```

---

## File Access Security

**Current:** Files are stored on filesystem, paths stored in database.

**Security Considerations:**
1. ✅ Files not publicly accessible via web server (no static route for `/uploads/`)
2. ✅ File paths stored in database with trial association
3. ⚠️ Files accessible to anyone with server filesystem access
4. ⚠️ Consider encryption at rest for sensitive customer documents

**Access Control:**
- Files can only be accessed via admin routes (admin authentication required)
- Processing route reads files directly from filesystem using database-stored paths
- Public report route does NOT serve original files (only extracted data)

---

## Migration Path (If Switching Storage)

**If moving from local filesystem to cloud storage:**

1. **Export existing files:**
   ```bash
   # List all files to migrate
   SELECT id, trial_id, stored_file_path, original_filename 
   FROM phase1_trial_documents;
   ```

2. **Upload to cloud storage:**
   - Use S3 CLI or SDK
   - Maintain same directory structure: `phase1_trials/<trial_id>/<filename>`
   - Get cloud storage URLs

3. **Update database:**
   ```sql
   UPDATE phase1_trial_documents 
   SET stored_file_path = 's3://bucket/phase1_trials/1/file.pdf'
   WHERE stored_file_path = 'uploads/phase1_trials/1/file.pdf';
   ```

4. **Update code:**
   - Replace filesystem operations with cloud storage SDK calls
   - Update file reading/writing logic

---

## Troubleshooting

**Issue: Files disappear after deployment**
- **Cause:** Ephemeral container filesystem
- **Fix:** Use Railway persistent volume (Option 1 above)

**Issue: Permission denied when saving files**
- **Cause:** Directory not writable or doesn't exist
- **Fix:** 
  ```bash
  mkdir -p uploads/phase1_trials
  chmod 755 uploads/phase1_trials
  ```

**Issue: Cannot access files for processing**
- **Cause:** File path in database doesn't match actual file location
- **Fix:** Check `stored_file_path` in database matches actual file system location

**Issue: Storage running out of space**
- **Cause:** Too many files accumulating
- **Fix:** Implement cleanup/archival strategy for old trials

---

## Summary

**Current Implementation:**
- ✅ Files stored locally on filesystem
- ✅ Works for local development
- ⚠️ **Does NOT persist on Railway** (ephemeral container filesystem)
- ⚠️ Files lost on every deployment

**Recommended Fix:**
1. Add Railway persistent volume mounted at `/data/uploads`
2. Set `UPLOAD_BASE_DIR=/data/uploads` environment variable
3. Redeploy service
4. Files will now persist across deployments

**Future Enhancement:**
- Consider cloud object storage (S3/R2) for better scalability and reliability
- Implement file encryption at rest for sensitive customer documents
- Add automated backup strategy
