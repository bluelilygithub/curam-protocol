# HOW TO EXECUTE THE SQL FILE (IMPORTANT!)

## The Problem
You committed `update_prompts_to_full.sql` to git, but **the database hasn't been updated yet**. Committing to git only saves the file - it doesn't execute it against the database.

## The Solution
You need to **execute the SQL file** in your PostgreSQL database on Railway.

---

## Method 1: Railway Dashboard (Easiest - No CLI Needed)

### Step 1: Get to Railway Database
1. Go to https://railway.app
2. Log in to your account
3. Click on your **project** (the one with your PostgreSQL database)
4. Find and click on your **PostgreSQL database service** (might be called "Postgres" or "PostgreSQL")

### Step 2: Access SQL Query Interface
Railway has different interfaces depending on your setup:

**Option A: Built-in Query Tab**
- Look for a **"Query"**, **"Data"**, or **"SQL"** tab in the database service page
- Click it to open a SQL editor

**Option B: Connect Button**
- Look for a **"Connect"** button or link
- This may open:
  - A web-based SQL editor (use this!)
  - Connection details (copy these for Option C)
  - A terminal/CLI interface (use this for psql)

**Option C: Use External Tool**
- Copy the connection string/credentials from Railway
- Use pgAdmin, DBeaver, TablePlus, or any PostgreSQL client
- Connect and run the SQL

### Step 3: Execute the SQL
1. **Open the file** `update_prompts_to_full.sql` on your computer
2. **Copy the ENTIRE contents** (all 2,131 lines)
3. **Paste into the SQL editor** in Railway
4. **Click "Run"**, "Execute", or press Ctrl+Enter
5. **Wait for completion** - it may take 10-30 seconds due to large prompts

### Step 4: Verify
After execution, you should see:
- Success messages for each UPDATE
- Verification query results showing new lengths:
  - Engineering: ~48,849 chars
  - Finance: ~10,284 chars
  - Logistics: ~7,192 chars
  - Transmittal: ~3,485 chars

Then refresh your admin panel at `/admin/prompts` - the lengths should be updated!

---

## Method 2: Railway CLI

If you have Railway CLI installed:

```bash
# 1. Make sure you're in the project directory
cd C:\Users\micha\Local Sites\curam-protocol

# 2. Link to your Railway project (if not already linked)
railway link

# 3. Execute the SQL file
railway run psql < update_prompts_to_full.sql
```

This will:
- Connect to your Railway PostgreSQL database
- Execute all SQL statements
- Show results in the terminal

---

## Method 3: Test with One Prompt First

If you want to test with just one prompt before updating all:

1. Open `update_prompts_to_full.sql`
2. Find the section for one prompt (e.g., "UPDATE FINANCE PROMPT")
3. Copy just that section (from `-- UPDATE FINANCE` to the verification `SELECT`)
4. Run that in Railway SQL editor
5. Check admin panel - Finance should now be ~10,284 chars
6. If it works, run the full file for all prompts

---

## Method 4: Update via Admin Panel (Not Recommended - Too Tedious)

You could manually edit each prompt in the admin panel:
1. Go to `/admin/prompts`
2. Click "Edit" on each prompt
3. Paste the full prompt text (48k+ chars for engineering!)
4. Save

**But this is NOT recommended** because:
- Engineering prompt is 48,849 characters - very tedious to copy/paste
- Risk of errors/corruption
- Much easier to use SQL

---

## Troubleshooting

### "Table doesn't exist"
- Make sure you're connected to the correct database
- The `prompt_templates` table should exist if you've used the admin panel

### "Permission denied"
- Check that your database user has UPDATE permissions
- Railway should have this by default

### "No rows updated"
- Check the WHERE clause matches your prompt names:
  ```sql
  -- First, see what names exist:
  SELECT name, doc_type FROM prompt_templates WHERE scope = 'document_type';
  ```
- The SQL uses `WHERE name = 'engineering_extraction_rules'` etc.
- If your names are different, adjust the WHERE clause

### "SQL syntax error"
- The file uses PostgreSQL dollar-quoting which should work
- If Railway's SQL editor has issues, try Method 2 (CLI) instead

### "File too large"
- The SQL file is large (~70KB) due to full prompts
- Most SQL editors can handle this, but if yours can't:
  - Split into separate files (one per prompt)
  - Or use CLI method

---

## Verification Query

After running the SQL, you can verify with this query:

```sql
SELECT 
    name,
    doc_type,
    LENGTH(prompt_text) as length,
    is_active,
    updated_at
FROM prompt_templates
WHERE scope = 'document_type'
ORDER BY name;
```

Expected results:
- `engineering_extraction_rules`: ~48,849 chars
- `finance_extraction_rules`: ~10,284 chars
- `logistics_extraction_rules`: ~7,192 chars  
- `transmittal_extraction_rules`: ~3,485 chars

If you still see small numbers (1,000-2,000 chars), the SQL didn't execute successfully.
