# Running Vault locally on this Windows machine

Works as of 2026-10-12 (Node 24, PostgreSQL 16 installed under `C:\Program Files\PostgreSQL\16`). The old SQLite notes (`local-setup-issues.md`) and the Mac Docker notes (`docs/local-database-recovery.md`) no longer apply: the app uses PostgreSQL through `pg`, with no native build.

## Why a private database

Other PostgreSQL installs already own ports 5432 and 5433 on this machine and their `postgres` passwords are not known to the app. So the app gets its own throwaway cluster on port **15433** in `C:\Users\micha\vault-local-pg` (outside the repo), with trust authentication and a `vault` role. Nothing else is touched. pgvector is not installed locally; the schema code guards for that and only the RAG/embedding features are off.

## One-time setup (already done)

```bash
PGBIN="/c/Program Files/PostgreSQL/16/bin"
mkdir -p /c/Users/micha/vault-local-pg && cd /c/Users/micha/vault-local-pg
"$PGBIN/initdb.exe" -D data -U vault --auth=trust -E UTF8 --locale=C
"$PGBIN/pg_ctl.exe" -D data -o "-p 15433" -l pg.log start
"$PGBIN/createdb.exe" -h 127.0.0.1 -p 15433 -U vault vault_local
```

## Each time

1. Start the database (skip if it is already running):
   `"C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe" -D C:\Users\micha\vault-local-pg\data -o "-p 15433" -l C:\Users\micha\vault-local-pg\pg.log start`
2. From `vault/`, run the app against it (PowerShell: `$env:DATABASE_URL = ...`; bash: prefix the command):
   `DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local npm run dev`
   The server is on http://localhost:3001 and the app on **http://localhost:5173**. `.env` keeps pointing at the old `vault_dev` URL, so set `DATABASE_URL` as above (a variable already set in the shell wins over `.env`).
3. Log in as the admin created from `SEED_EMAIL` / `SEED_PASSWORD` in `.env` (first boot only).
4. To stop the database: same `pg_ctl` command with `stop` instead of `start`.

## The fitness demo user

Create it from the app (Fitness, three-dot menu, "Create or reset demo user") while signed in as the admin, or run it directly:

```bash
DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node -e "require('./server/services/fitness/demoSeed').seedDemoUser().then(o=>{console.log(o.password||'(existing user)');process.exit(0)})"
```

Login `fitness-demo@curam.local`. The password is printed on creation only. Re-running resets the demo user's fitness data (four past weeks, mixed logs).

## Gotchas

- No model is set in a fresh local database (Settings, AI & Chat), so wording falls back to the rule-based text. Add a model in Settings to see model-written wording; `ANTHROPIC_API_KEY` is already in `.env`.
- Registration needs an invite code; create extra test users directly in the database (hash with `bcryptjs`).
- Local data never reaches Railway. Staging has its own database.
