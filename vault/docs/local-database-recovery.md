# Local Database Recovery

This Mac Mini local development environment uses a Docker PostgreSQL container for the real application data.

## Critical Source Of Local Data

Do not delete, recreate, prune, or replace this container or its volume unless you have made a verified backup first.

```text
Container: local-pg
Image: postgres
Database: vault
Host port: localhost:5432
Docker volume: ef237628df50e21541114e4641cfe97c4f497d255d1b8e0ae5816e81e90885a6
Mount path in container: /var/lib/postgresql
```

The app's `vault/.env` should point `LOCAL_DATABASE_URL` at this Docker PostgreSQL instance.

## Normal Startup

After a Mac restart, start Docker Desktop first, then confirm the database container is running:

```bash
docker start local-pg
docker ps --filter name=local-pg
pg_isready -h localhost -p 5432
```

Then start the app:

```bash
npm --prefix "/Users/michaelbarrrett/Cursor Projects/curam-protocol/vault" run dev
```

The app should print:

```text
Frontend: http://localhost:5173/
Backend:  Vault server running on port 3001
```

If Vite uses another `517x` port, use the exact URL printed by Vite.

## Login Network Error

If login shows a network error, usually the frontend is running but the backend API is not.

Check:

```bash
curl -I http://localhost:3001/api/health
docker ps --filter name=local-pg
pg_isready -h localhost -p 5432
```

If `local-pg` is stopped, start it:

```bash
docker start local-pg
```

Then restart the app dev server.

## Invalid Email Or Password After A Restart

If the login form says "Invalid email or password" and you know the credentials are correct, check whether the app is accidentally connected to an empty PostgreSQL database.

The real local database should have existing data. As of this recovery note, the Docker database had:

```text
users: 5
projects: 25
tasks: 98
```

Check counts without exposing passwords:

```bash
node - <<'NODE'
require('./vault/node_modules/dotenv').config({ path: './vault/.env' });
const { Client } = require('./vault/node_modules/pg');
(async () => {
  const client = new Client({ connectionString: process.env.LOCAL_DATABASE_URL });
  await client.connect();
  for (const table of ['users', 'projects', 'tasks']) {
    const { rows } = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
    console.log(`${table}: ${rows[0].count}`);
  }
  await client.end();
})().catch((err) => { console.error(err.message); process.exit(1); });
NODE
```

If `users` is `0`, stop and locate the Docker `local-pg` database before creating new users.

## Avoid This Mistake

Homebrew PostgreSQL may also be installed on this Mac. Starting Homebrew PostgreSQL on `localhost:5432` can mask the Docker database and make the app look empty.

Before starting Homebrew PostgreSQL, check whether Docker `local-pg` is the intended database:

```bash
docker ps -a --filter name=local-pg
```

If `local-pg` exists, use it for this app.

## Backups

Before any risky local database work, create a backup:

```bash
docker exec local-pg pg_dump -U vault_local -d vault > vault-local-backup.sql
```

Keep the backup outside the repository or in an ignored backup location. Do not commit database dumps.
