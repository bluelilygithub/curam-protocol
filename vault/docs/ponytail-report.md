# Ponytail report

`/ponytail`, admin only (Business group, next to Changelog). No feature flag, guide chat or tour: it is an admin report, like Changelog and Code Map. Built 2026-11-19.

[Ponytail](https://github.com/DietrichGebert/ponytail) is a Claude Code plugin. Its "band" counts each task's cost, turns, agent time, tokens, function reuse and last test result. This page receives those rows and shows them next to the code written per day, so the owner can judge whether Ponytail really reduces code.

## What Ponytail sends, and when

Read from the plugin source (v5.3.3, `hooks/band/metrics.ts` and `register.tsx`), because the spec file that was meant to describe it (`specs/code-map/ponytail-report-prompt.md`) did not exist.

- **When:** after every turn, if a Webhook URL is set in the plugin's settings. Not awaited, so a slow or failing Vault never holds up Claude Code; Ponytail shows "webhook answered 401" or "webhook unreachable" in its status line instead.
- **How:** `POST`, `content-type: application/json`, `authorization: Bearer <Webhook token>`. https only (plain http only to localhost).
- **Body** (one `Snapshot`, the whole row every time, not a change):
  `key` (first 8 characters of the session id + `-` + start time in ms), `started` (`"YYYY-MM-DD HH:MM"`, the machine's local time), `project`, `name` (`""` when "Send task names" is off), `session`, `level`, `model`, `cost` (the session's total since it started or since the last /clear), `lastTurn` (or null), `turns`, `agentMs`, `tokens: { input, output, cacheRead, cacheWrite }`, `reuse` (0-100, or null under 3 functions), `reused`, `created`, `callersOpen`, `tests` (`"N passed"`, `"N failed"`, `"stale"`, `"not run"`).
- A **task** is one session, or the part of one after a /clear (a new start time makes a new key).

## What Vault stores

- `ponytail_tokens`: one row per key: label, `tokenHash`, `prefix` and `last4` (for the list), `createdAt`, `lastUsedAt`, `revokedAt`. Up to 5 active keys per admin.
- `ponytail_tasks`: one row per (`userId`, `key`), replaced on every post. Column per field above (tokens split into four columns), `started` as TIMESTAMPTZ read as **Australia/Brisbane**, plus `source` (`webhook` or `csv`), `updatesReceived` (posts received for this task), `firstSeenAt`, `lastSeenAt`.
- Unknown fields are ignored, so a newer plugin that adds one still gets in. Limits: name 300, project 200, model 100, tests 50, session 100, level 20, key 80 characters; numbers finite and 0 or more; reuse 0-100.

## The ingest route

`POST /api/ponytail/ingest`, mounted in `server/index.js` before `requireAuth` and before the 30 MB body parser (like Vault Shelf's `/api/quick-ingest`). In order:

1. The Bearer key must look like `pty_` + 64 hex, match a stored hash, not be revoked, and belong to an enabled admin who is not an accountant login. Otherwise **401**.
2. 120 posts a minute per key (in memory), else **429**. Ponytail sends once per turn, so this is far above real use.
3. Only then the body is read: JSON, 16 KB. Too big or not JSON: **400** with a short reason (never the body).
4. Checked by `cleanSnapshot` (`server/services/ponytailTasks.js`): **400** with a short reason.
5. Upsert, `updatesReceived + 1`: **204**.

Nothing about the body is logged; errors are logged by name and code only. No model is called, so there is no `aiLimiter`.

## Why the key is hashed

The key lets anyone post rows into the owner's report without signing in. Vault keeps only its SHA-256, the same as Vault Shelf keys: a copy of the database (a backup, a leaked dump) cannot be used to post. The key is shown once, when it is made, with a Copy button. Losing it means making a new one. In Claude Code the plugin keeps it in the system keychain, not a settings file.

## CSV backfill

Ponytail also writes every task to `~/.config/ponytail/band/<project>.csv` (Windows: `%USERPROFILE%\.config\ponytail\band\<project>.csv`). Setup → "Import a CSV file" (`POST /api/ponytail/import`, multipart, 2 MB, one file) reads it:

- The first line must be exactly `key,started,project,name,cost_usd,turns,agent_minutes,tokens_total,tokens_output,reuse_pct,reused,new,callers_open,tests,level,model`.
- Each row goes through the same checks as the webhook. Bad rows are reported by line number and skipped; the rest are saved in one transaction.
- The CSV has less than the webhook: cost to 2 decimals, agent minutes to 1, only the token total and the output (stored as input = total − output, cache 0, the same shortcut the plugin's own `resume()` uses), no session, no last turn.
- **Re-importing is safe:** rows are upserted by key. A row the webhook already sent is never overwritten by the CSV (`source = 'webhook'` wins), because the webhook's row has more in it. The answer says how many were added, updated, left alone and skipped.

## Reading the page

- Tiles, charts and the table follow the range, project and model filters (all in the address, so a view can be linked). Days are Brisbane days; a task counts on the day it **started**, even if it ran past midnight.
- Tests passing = tasks whose label ends "passed" out of those ending "passed" or "failed"; "not run" and "stale" are left out.
- **Code written** puts commits per Brisbane day from `changelog_entries` (excluding `Changelog:` commits) beside that day's Ponytail tasks, cost and average reuse. **They are matched by day, not linked one to one**: a commit is not necessarily the work of that day's tasks, a task can span days, and work on other projects (cellar-planner, etc.) has its own Ponytail rows but no Vault changelog entries. Read it as a trend, not proof. The project and model filters apply to the Ponytail columns only.

## Deleting

Delete (in a task's detail) moves the row to the shared recycle bin for 30 days (adapter `ponytail-task`). If the task is still running, Ponytail sends it again on its next turn, which makes a fresh row with the same key; restoring the deleted copy then answers 409.

## Switching it off

- Stop one machine: in Claude Code, `/plugin` → Installed → ponytail → Configure, clear **Webhook URL**, Save.
- Stop a key everywhere: Revoke it on the page (Ponytail then shows "webhook answered 401").
- Keep the data but hide the page: it is admin-only already; remove the nav entry in `client/src/config/appNavigation.js` if wanted.

## Files and tests

| Piece | Where |
|---|---|
| Routes | `server/routes/ponytail.js` (`createRouters({ pool, limiter, bin })`), wired in `server/routes/ponytailRoutes.js` |
| Checks, CSV | `server/services/ponytailTasks.js` |
| Recycle bin | `server/services/recycleBin/adapters/ponytailTasks.js` |
| Tables | `server/db.js` (`ponytail_tokens`, `ponytail_tasks`) |
| Page | `client/src/pages/PonytailPage.jsx`; parts in `client/src/pages/ponytail/` |

- `node server/services/ponytailTasks.test.js` — validation and CSV parsing, no database.
- `node client/src/pages/ponytail/ponytailFormat.test.mjs` — formatting and Brisbane days.
- `DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_xuser node server/routes/ponytail.test.js` — the real app on a local throwaway database: keys, ingest (update not duplicate, Brisbane time, empty name, 401/400), CSV import and re-import, filters, member 403, delete and restore. A brand-new empty database currently fails Vault's own boot ("relation clients does not exist"), so use the existing `vault_xuser` one.
- Routes are classified in `server/testing/routeManifest.json` (ingest `public`, the rest `admin`); `crossUser.test.js` checks them.
