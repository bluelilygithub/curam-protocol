# How to Update Prompts to Full Content

**IMPORTANT:** Committing the SQL file to git does NOT update the database. You must **execute the SQL file** in your PostgreSQL database.

## The Problem

Your prompts are currently PLACEHOLDERS (small sizes):
- Engineering: 1,865 chars (should be ~48,849)
- Finance: 1,342 chars (should be ~10,284)
- Logistics: 2,254 chars (should be ~7,192)
- Transmittal: 1,944 chars (should be ~3,485)

## Solution: Execute the SQL File

You have the file `update_prompts_to_full.sql` which contains the full prompts. Now you need to **run it in your database**.

## Method 1: Railway CLI (Recommended)

If you have Railway CLI installed:

```bash
# 1. Link to your project (if not already)
railway link

# 2. Execute the SQL file
railway run psql < update_prompts_to_full.sql
```

This will:
- Connect to your Railway PostgreSQL database
- Execute all UPDATE statements
- Replace placeholders with full prompts
- Show verification results

## Method 2: Railway Dashboard (Easiest)

1. **Go to Railway Dashboard**
   - Visit: https://railway.app
   - Log in to your account

2. **Navigate to Your Database**
   - Click on your project
   - Click on your PostgreSQL database service
   - You should see database connection details

3. **Open Query Interface**
   - Look for a "Query" or "Connect" or "Data" tab
   - OR click "Connect" button → this will give you connection options

4. **Run the SQL**
   - Option A: If Railway has a built-in SQL editor:
     - Copy the entire contents of `update_prompts_to_full.sql`
     - Paste into the SQL editor
     - Click "Run" or "Execute"
   
   - Option B: Use Railway's "Connect" option:
     - Click "Connect" on your database
     - It will give you connection string or open a web SQL interface
     - Copy/paste the SQL file contents there

5. **Verify Results**
   - After running, check your admin panel: `/admin/prompts`
   - The Length column should now show:
     - Engineering: ~48,849 chars
     - Finance: ~10,284 chars
     - Logistics: ~7,192 chars
     - Transmittal: ~3,485 chars

## Method 3: Direct PostgreSQL Connection

If you have direct database access:

```bash
# Get connection string from Railway dashboard
# Format: postgresql://user:pass@host:port/dbname

# Then run:
psql "your-connection-string" -f update_prompts_to_full.sql
```

## Method 4: Use a Database GUI Tool

Tools like **pgAdmin**, **DBeaver**, or **TablePlus**:

1. Connect to your Railway database using connection details from Railway dashboard
2. Open a SQL query window
3. Copy/paste the entire contents of `update_prompts_to_full.sql`
4. Execute the query

## What the SQL File Does

The `update_prompts_to_full.sql` file contains:

1. **UPDATE statements** for each prompt type:
   - Updates `engineering_extraction_rules` with full 48,849 char prompt
   - Updates `finance_extraction_rules` with full 10,284 char prompt
   - Updates `logistics_extraction_rules` with full 7,192 char prompt
   - Updates `transmittal_extraction_rules` with full 3,485 char prompt

2. **Verification queries** to show the new lengths after update

3. Uses PostgreSQL dollar-quoting (`$TAG$...$TAG$`) to safely handle special characters

## Verification

After running the SQL, verify in admin panel:

1. Go to `/admin/prompts`
2. Check the "Length" column - should show much larger numbers
3. All prompts should still be "Active" (status doesn't change)

## If It Still Doesn't Work

If after running the SQL the sizes are still small:

1. **Check for errors** when running SQL - did it execute successfully?
2. **Verify the WHERE clause** - make sure it's matching your prompts:
   ```sql
   -- Check what doc_type values exist:
   SELECT DISTINCT doc_type FROM prompt_templates WHERE scope = 'document_type';
   ```
   
3. **Try updating manually** - test with one prompt:
   ```sql
   -- Check current length:
   SELECT name, doc_type, LENGTH(prompt_text) as len 
   FROM prompt_templates 
   WHERE doc_type = 'engineering';
   
   -- If needed, the UPDATE should match by doc_type = 'engineering'
   ```

4. **Check if prompts have different names** - the WHERE clause matches by `doc_type`, not by name, so it should work regardless of the prompt name.

## Quick Test

After running the SQL, test with a document extraction:

1. Go to `/automater` or run a logistics extraction
2. Check the logs - should see:
   ```
   ✓ Using database prompt for logistics (db: fta-list) - length: 7192 chars
   ```
   (not the small placeholder size)

3. The extraction should use the full complex prompt now
