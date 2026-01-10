# How to Run the Logistics Prompt SQL

The SQL file `database_insert_logistics_prompt.sql` needs to be **executed in your PostgreSQL database** - just committing it to git doesn't update the database.

## Option 1: Railway CLI (Easiest)

```bash
# 1. Make sure Railway CLI is installed
railway login

# 2. Link to your project (if not already linked)
railway link

# 3. Run the SQL file directly
railway run psql < database_insert_logistics_prompt.sql

# OR manually run the SQL:
railway run psql
# Then copy/paste the contents of database_insert_logistics_prompt.sql
```

## Option 2: Railway Dashboard Database Interface

1. Go to your Railway dashboard
2. Click on your PostgreSQL database service
3. Click "Query" or "Connect" tab
4. Copy the entire contents of `database_insert_logistics_prompt.sql`
5. Paste into the SQL editor
6. Click "Run" or "Execute"

## Option 3: Python Script (If running locally with database access)

```bash
# First install dependencies
pip install sqlalchemy psycopg2-binary

# Then run the script
python run_logistics_prompt_sql.py
```

## Option 4: Direct psql Connection (If you have direct database access)

```bash
# Get connection string from Railway dashboard
# Then run:
psql "your-database-connection-string" -f database_insert_logistics_prompt.sql
```

## Verification

After running the SQL, verify it worked:

1. Check the admin panel: `/admin/prompts` - you should see "Logistics - Trade Documents" with `is_active = true`
2. Check logs: Run a logistics extraction and look for:
   ```
   ✓ Using database prompt for logistics (db: fta-list) - length: 7191 chars
   ```
3. Or run this SQL query:
   ```sql
   SELECT name, doc_type, LENGTH(prompt_text) as length, is_active
   FROM prompt_templates
   WHERE name LIKE '%Logistics%';
   ```
   Should show: length ~7,191 characters, is_active = true

## What This Does

The SQL file will:
- INSERT the full logistics prompt (7,191 characters) if it doesn't exist
- UPDATE it if a placeholder already exists (ON CONFLICT clause)
- Set `is_active = true` so it will be used immediately
- After this, the system will automatically use the database prompt instead of hardcoded

## Next Steps

After running the SQL:
- The logistics extraction will use the full database prompt
- No code changes needed - the system already prioritizes database prompts
- You can verify in the admin panel that the prompt is active
- Test with a logistics document to confirm it's working
