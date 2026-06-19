# PostgreSQL Migration Progress

## Status: ✅ Complete
## Completed: 2026-03-10

---

## File Progress

| File | Status | Verified | Notes |
|------|--------|----------|-------|
| `server/db.js` | ✅ Done | ✅ Verified | Pool connects; 27 tables created; GIN index on search_index; `[db] Schema ready` confirmed |
| `server/middleware/auth.js` | ✅ Done | ✅ Verified | async pool.query; try/catch + next(err) |
| `server/routes/health.js` | ✅ Done | ✅ Verified | No db calls — no changes needed |
| `server/routes/auth.js` | ✅ Done | ✅ Verified | All 6 routes async; RETURNING id; camelCase columns quoted |
| `server/routes/settings.js` | ✅ Done | ✅ Verified | ON CONFLICT upsert → PostgreSQL syntax |
| `server/routes/personas.js` | ✅ Done | ✅ Verified | RETURNING id; datetime('now') → NOW() |
| `server/routes/prompts.js` | ✅ Done | ✅ Verified | Dynamic query; RETURNING id |
| `server/routes/memory.js` | ✅ Done | ✅ Verified | RETURNING id; updatedAt quoted; semantic search + stats |
| `server/routes/suggestions.js` | ✅ Done | — | Agent suggestions inbox CRUD |
| `server/routes/notes.js` | ✅ Done | ✅ Verified | Dynamic $N params; ILIKE; rowCount |
| `server/routes/files.js` | ✅ Done | ✅ Verified | extractedText/aiSummary/uploadedAt quoted; search_index writes |
| `server/routes/projects.js` | ✅ Done | ✅ Verified | db.transaction → client BEGIN/COMMIT; chatCount alias quoted |
| `server/routes/debate.js` | ✅ Done | ✅ Verified | getGeminiKey async; debateId/modelA/modelB quoted |
| `server/routes/compare.js` | ✅ Done | ✅ Verified | resolveDocument async; docAName/docBName quoted |
| `server/routes/tasks.js` | ✅ Done | ✅ Verified | 3× client BEGIN/COMMIT; 5 async helpers; NULLS LAST; ON CONFLICT DO NOTHING; ILIKE |
| `server/routes/goals.js` | ✅ Done | ✅ Verified | buildKeyResult/buildObjective async; Promise.all; ON CONFLICT upsert; Number() for COUNT |
| `server/routes/chat.js` | ✅ Done | ✅ Verified | buildSystemPrompt/buildMessageContent async; branch transaction; search_index writes; GROUP BY s."sessionId" for session queries |
| `server/routes/folders.js` | ✅ Done | ✅ Verified | folderId quoted in projects UPDATE |
| `server/routes/search.js` | ✅ Done | ✅ Verified | FTS5 MATCH/snippet() → tsvector/plainto_tsquery/ts_headline; GIN index in db.js |
| `server/routes/pinnedUrls.js` | ✅ Done | ✅ Verified | projectId/createdAt quoted |
| `server/routes/user.js` | ✅ Done | ✅ Verified | passwordHash quoted |
| `server/routes/admin.js` | ✅ Done | ✅ Verified | Promise.all 7 queries; Number() for COUNT/SUM strings |
| `server/routes/export.js` | ✅ Done | ✅ Verified | sessionId/projectId/aiSummary/uploadedAt quoted |
| `server/routes/taskTemplates.js` | ✅ Done | ✅ Verified | buildTemplate async; for..of loops with await |
| `server/routes/sharedTasks.js` | ✅ Done | ✅ Verified | getTags async; shareToken/parentTaskId quoted |
| `server/routes/webSearch.js` | ✅ Done | ✅ Verified | 3 db calls: settings reads + search_log insert |
| `server/routes/gmail.js` | ✅ Done | ✅ Verified | getGmailClient async; expiryDate BIGINT→Number(); fire-and-forget token refresh |
| `server/routes/email.js` | ✅ Done | ✅ Verified | Inactive route (not registered in index.js); sessionId/createdAt quoted |
| `server/routes/pdf.js` | ✅ Done | ✅ Verified | Inactive route (not registered in index.js); pool.query for file lookup |
| `server/index.js` | ✅ Done | ✅ Verified | seedInitialUser → async pool.query; RETURNING id |

---

## FTS5 Replacement (Phase 5)

- [x] `search_index` virtual table removed (replaced with plain table in Phase 1)
- [x] GIN index created: `idx_search_index_fts ON search_index USING GIN (to_tsvector(...))`
- [x] `search.js` FTS query converted to `tsvector` / `plainto_tsquery` / `ts_headline`
- [x] `search_index` writes in `chat.js`, `files.js`, `projects.js` — plain INSERT (unchanged)
- [x] All search endpoints updated

---

## Schema Design Decisions

### Column naming
All camelCase column names from SQLite are preserved using PostgreSQL double-quoted identifiers
(e.g. `"createdAt"`, `"projectId"`). This allows route files to continue accessing `row.createdAt`
etc. without changes. Columns that were already lowercase (`email`, `scope`, `token`, etc.)
remain unquoted.

### Type mappings
| SQLite | PostgreSQL |
|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| `TEXT DEFAULT (datetime('now'))` | `TIMESTAMPTZ DEFAULT NOW()` |
| `INTEGER` (boolean: 0/1) | `INTEGER` (kept for compatibility — routes use truthy checks) |
| `gmail_tokens.expiryDate INTEGER` | `BIGINT` (Unix ms timestamp) |
| `REAL` | `REAL` |
| `TEXT` (JSON stored as string) | `TEXT` (routes still use JSON.parse/stringify) |

### sessions table
`sessionId TEXT PRIMARY KEY` — kept as TEXT primary key (not SERIAL). Session IDs are
generated as random UUIDs by the application.

### tasks."order"
`"order"` is a SQL reserved word — kept double-quoted in both DDL and all queries.

### tasks.keyResultId FK
`tasks` is defined before `objectives`/`key_results` in the original SQLite schema.
In PostgreSQL, the FK constraint cannot reference a table that doesn't exist yet.
Solution: `tasks."keyResultId"` is defined as plain `INTEGER` in the CREATE TABLE,
and the FK constraint `fk_tasks_keyresultid` is added via `ALTER TABLE` after
`key_results` is created. A `DO $$ ... EXCEPTION WHEN duplicate_object` block
makes this idempotent.

### search_index (FTS5 → tsvector)
The SQLite `CREATE VIRTUAL TABLE ... USING fts5` is replaced with a plain `search_index`
table plus a GIN index on `to_tsvector('english', COALESCE(title,'') || ' ' || COALESCE(body,''))`.
Queries use `@@ plainto_tsquery('english', $1)` and `ts_headline` for snippets.

### projects.folderId / personaId
These were added via `ALTER TABLE` in SQLite without FK constraints. Kept as plain
`INTEGER` in PostgreSQL (no FK), matching original behaviour.

### GROUP BY in session list queries
PostgreSQL requires non-aggregated SELECT columns to be functionally dependent on GROUP BY
columns. Session list queries (`chat.js`) use `GROUP BY m."sessionId", s."sessionId"` —
since `s."sessionId"` is the PK of sessions, all other `s.*` columns are allowed in SELECT.

### COUNT/SUM string coercion
PostgreSQL returns `COUNT(*)` and `SUM()` as JavaScript strings (bigint safety). All
such values are wrapped with `Number()` where used in arithmetic or JSON responses.

---

## Conversion Reference (quick lookup)

```
SQLite                                    PostgreSQL
──────────────────────────────────────────────────────────────────────────────
db.prepare('...').get(x)             →   const { rows } = await pool.query('...', [x]);
                                         rows[0]

db.prepare('...').all(x)             →   const { rows } = await pool.query('...', [x]);
                                         rows

db.prepare('...').run(x)             →   await pool.query('...', [x])

? (placeholder)                      →   $1, $2, $3 ...

INTEGER PRIMARY KEY AUTOINCREMENT    →   SERIAL PRIMARY KEY

datetime('now')                      →   NOW()

.lastInsertRowid                     →   RETURNING id  →  rows[0].id

db.transaction(() => { ... })()      →   const client = await pool.connect();
                                         try {
                                           await client.query('BEGIN');
                                           ...
                                           await client.query('COMMIT');
                                         } catch (e) {
                                           await client.query('ROLLBACK');
                                           throw e;
                                         } finally { client.release(); }

const db = require('../db')          →   const { pool } = require('../db')

INSERT OR REPLACE INTO t (k) VALUES  →   INSERT INTO t (k) VALUES ($1)
                                         ON CONFLICT (k) DO UPDATE SET ...=EXCLUDED....

INSERT OR IGNORE INTO t VALUES       →   INSERT INTO t VALUES (...) ON CONFLICT DO NOTHING

LIKE (case-insensitive in SQLite)    →   ILIKE

ORDER BY col ASC (NULLs last        →   ORDER BY col ASC NULLS LAST
in SQLite)

FTS5 MATCH / snippet()               →   @@ plainto_tsquery() / ts_headline()
```

---

## Completed

Migration finished: 2026-03-10
All 29 files verified. Zero SQLite references remaining in active routes.
`better-sqlite3` uninstalled (29 packages removed).
Local PostgreSQL (Windows, localhost:5432/vault_dev) confirmed working.
All 27 tables verified via `\dt`.
Seed user created on first boot: michaelbarrett@bluelily.com.au
