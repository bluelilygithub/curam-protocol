# Backup & Restore

Curam Vault includes a built-in Google Drive backup system accessible from the Admin dashboard — no command line required. This document covers what is backed up, how to run and restore backups, and emergency procedures.

---

## What the backup covers

**Included:**
- All database tables: projects, chat sessions, messages, tasks, goals, key results, notes, prompts, personas, folders, prompt chains, bookmarks, pinned URLs, comparisons, debates, and all related data
- All uploaded files stored in the `UPLOAD_DIR` volume (PDFs, Word docs, images, etc.)
- A `manifest.json` recording the backup date, file count, and record counts per table

**Not included:**
- Environment variables (API keys, database connection string, encryption key)
- Google OAuth tokens (you'll need to reconnect Google after restoring to a new server)
- Server configuration (Railway settings, custom domains, etc.)

Store your environment variables in a password manager or a secure `.env` file kept outside the repository.

---

## Connecting Google Drive

The backup system uses the `drive.file` OAuth scope, which only grants access to files the app creates itself — it cannot read or modify any other files in your Drive.

1. Go to **Settings → Integrations**
2. Click **Connect Gmail** (or **Reconnect Google** if already connected)
3. Complete the Google OAuth flow — Drive access is granted alongside Gmail and Calendar
4. Return to **Admin → Backups** — the **Back Up Now** button will now be active

If Gmail was connected before this feature was added, a notice "Reconnect Google to enable Drive backup" will appear next to your Gmail connection status. Click Disconnect and reconnect to grant the new scope.

---

## Running a manual backup

1. Go to **Admin** (accessible from the sidebar)
2. Scroll to the **Backups** section
3. Click **Back Up Now**
4. Watch the progress bar move through three stages:
   - *Exporting database* — all tables dumped to `data.json`
   - *Uploading files* — each file in your storage volume streamed to Drive
   - *Removing old backups* — backups beyond the 4 most recent are deleted
5. On completion, the **Last Backup** date updates to today in green

Backups are stored in a folder called **Curam Vault Backups** in your Google Drive, with each backup in a timestamped subfolder (e.g. `2026-03-15_Sunday`).

Only the **4 most recent backups** are retained. Older ones are deleted automatically after each new backup.

---

## Restoring from a backup

1. Go to **Admin → Backups**
2. In the **Backup History** list, find the backup you want to restore
3. Click **Restore** on that row
4. Read the warning: this will replace ALL current data
5. Type `RESTORE` in the confirmation field
6. Click the red **Restore** button
7. Watch the progress bar through database and file restore stages
8. The app reloads automatically when complete

The database restore runs inside a single transaction. If anything fails mid-way, the entire restore is rolled back and your current data is preserved unchanged.

---

## Environment variables

Environment variables are never stored in backups. After restoring to a new server, you must re-add all variables manually.

The **Environment Variables** checklist in Admin → Backups shows which variables are currently set (✓) or missing (✗) — values are never shown, only presence.

Key variables to keep backed up externally:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude AI access |
| `GEMINI_API_KEY` | Gemini model access |
| `GOOGLE_CLIENT_ID` | Gmail, Calendar, Drive OAuth |
| `GOOGLE_CLIENT_SECRET` | Gmail, Calendar, Drive OAuth |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL |
| `ENCRYPTION_KEY` | Encrypts stored OAuth tokens — do not lose this |
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_URL` | Public URL of the app (used in OAuth redirects) |
| `UPLOAD_DIR` | Path to uploaded files volume |

**The `ENCRYPTION_KEY` is critical.** OAuth tokens (Gmail, Calendar, Drive) are encrypted with this key. If you lose it and restore a backup, all Google connections will be broken and users will need to reconnect.

---

## Emergency restore (app is completely down)

If the app is not running and you need to restore from a backup manually:

### Restore the database

1. Download `data.json` from your backup folder in Google Drive
2. The file contains all table data as JSON under a `tables` key
3. Connect to your PostgreSQL database using the Railway CLI or `psql`:
   ```
   railway connect postgres
   ```
4. Clear and re-insert tables in the correct order. The tables inside `data.json` are:
   `folders`, `personas`, `projects`, `memory`, `task_templates`, `objectives`, `key_results`, `sessions`, `messages`, `tasks`, `task_tags`, `task_comments`, `task_dependencies`, `template_subtasks`, `prompts`, `notes`, `pinned_urls`, `files`, `session_files`, `bookmarks`, `prompt_chains`, `debates`, `comparisons`, `search_index`
5. For each table, truncate it and then insert the rows from the JSON
6. Reset serial sequences after insert: `SELECT setval(pg_get_serial_sequence('"tablename"', 'id'), MAX(id)) FROM "tablename";`

### Restore uploaded files

1. Download the `files/` subfolder from your backup folder in Google Drive
2. Copy all files to your `UPLOAD_DIR` volume path

### Restart the app

Deploy or restart the app with all environment variables set. The schema is created automatically on first boot.

---

## Reconnecting Google Drive after OAuth expiry

Google OAuth tokens can expire if unused for extended periods, or if the Google account's permissions are changed.

To reconnect:
1. Go to **Settings → Integrations**
2. Click **Disconnect** next to Gmail (this also removes Calendar and Drive access)
3. Click **Connect Gmail** and complete the OAuth flow
4. Drive backup access will be restored alongside Gmail and Calendar

If the app is down and you can't access Settings, delete the row from the `gmail_tokens` table directly:
```sql
DELETE FROM gmail_tokens WHERE "userId" = 1;
```
Then restart the app and reconnect via Settings.
