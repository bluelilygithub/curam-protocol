# QUICK START: Update Prompts in 3 Steps

## The Issue
Your prompts are **placeholders** (small sizes). You committed the SQL file but haven't executed it yet.

## Solution in 3 Steps

### Step 1: Access Railway Database SQL Interface
- Go to https://railway.app
- Click your project → PostgreSQL database
- Look for **"Query"**, **"Connect"**, or **"SQL"** button/tab
- Click it to open SQL editor

### Step 2: Execute the SQL File
1. Open `update_prompts_to_full.sql` on your computer
2. Select ALL (Ctrl+A)
3. Copy (Ctrl+C)
4. Paste into Railway SQL editor
5. Click **"Run"** or **"Execute"**

### Step 3: Verify
- Refresh `/admin/prompts` page
- Check Length column - should show:
  - Engineering: **48,849** chars (was 1,865)
  - Finance: **10,284** chars (was 1,342)
  - Logistics: **7,192** chars (was 2,254)
  - Transmittal: **3,485** chars (was 1,944)

## If Railway Doesn't Have SQL Editor

**Use Railway CLI instead:**

```bash
railway run psql < update_prompts_to_full.sql
```

**OR use a database GUI tool:**
1. Get connection string from Railway dashboard
2. Connect with pgAdmin, DBeaver, or TablePlus
3. Run the SQL file

## That's It!

Once you execute the SQL file, the prompts will be updated. Committing to git doesn't run SQL - you must execute it in the database.
