# Schema notes

Moved out of CLAUDE.md.

- ~144 tables (count of `CREATE TABLE IF NOT EXISTS` in `server/db.js`, 2026-09-30 — the old "49" was long stale). All schema in `server/db.js`.
- `fin_budgets` (`"userId"`, `fy` e.g. `'2025-26'`, `kind` income|expense, `code` tx-code, `amount`; `UNIQUE("userId", fy, kind, code)`) — annual budgets for the Finance Budget vs Actual report; missing row = no budget.
- **No `pg` type parsers are configured**, so `DATE`/`TIMESTAMPTZ` columns arrive as JS `Date` objects, not strings — never `String(date).slice(0,10)` (yields `"Mon Sep 29"`); format with local getters (`ds()` in `server/routes/financeReports.js`) or cast in SQL (`::date::text`, `to_char`). No migration tool — idempotent DDL on every boot.
- `font_projects` stores the Font Customizer's saved-project *recipe* (`"googleFont"` name + `recipe` JSONB `{transforms, kerning}`), never a rendered font file — reopening a project re-fetches the font and reapplies the recipe.
- `room_projects` (Room Planner library): `"userId"` FK cascade, `name`, `data` JSONB (the planner's whole project, every room, `schemaVersion` 1), `"roomCount"`, `"updatedAt"` (compared at millisecond precision for the optimistic save — Postgres keeps microseconds, JS does not). Index `idx_room_projects_user_updated`.
- `sessions.sessionId` is `TEXT PRIMARY KEY` (UUID), not SERIAL.
- `sessions."deletedAt"` is the OLD soft-delete timestamp. Since 2026-10-24 deleting a chat moves it to the shared 30-day recycle bin and removes the rows (`adapters/chats.js`); only chats deleted before then, and chats over 25 MB, still use `deletedAt` (Chat History -> Deleted). Normal lists/search/RAG must still filter `s."deletedAt" IS NULL`.
- `users."isAdmin"` is `BOOLEAN NOT NULL DEFAULT FALSE`; first user is promoted to admin during bootstrap/backfill.
- `users."featureOverrides"` is nullable `JSONB` — per-user feature narrowing, see **Feature access**. `null` = no narrowing.
- `tasks."order"` double-quoted everywhere (SQL reserved word).
- `tasks."keyResultId"` FK added via `ALTER TABLE` after `key_results` is created (avoids forward reference).
- `gmail_tokens.expiryDate` is `BIGINT` (Unix ms). Cast to `Number()` in routes.
- Multi-user `"userId"` columns added post-hoc. Every query filters by `"userId"=$1`.
- `share_trades.exchange` CHECK constraint `('ASX','NYSE','NASDAQ')` added via `ALTER TABLE` (post-DDL, inside `DO $$ ... EXCEPTION WHEN OTHERS THEN NULL $$` to survive re-runs).
- `share_trades.pricePerShare` is stored in **AUD** for all new trades. Legacy USD rows carry `currency='USD'` + `fxRateToAud` for backward compatibility.
- `share_news_briefings`: `symbol IS NULL` row = market summary for that date. `type` column: `'daily'` (45-day retention, auto-pruned) or `'monthly_summary'` (never deleted). Unique index `idx_share_news_user_date_sym_v2` on `(userId, date, COALESCE(symbol,''), COALESCE(exchange,''), type)`. Daily generate deletes then re-inserts today's `type='daily'` rows. Monthly summaries stored separately and retained permanently. **`DATE` columns from pg come back as strings `'YYYY-MM-DD'`; always `String(b.date).slice(0,10)` before string ops — do not assume it's always a primitive.**

---

