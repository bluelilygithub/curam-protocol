# Vault Shelf

A small Windows clipboard companion (Tauri v2, in `vault/shelf/`, not built yet) that keeps what you copy and sends the bits you choose into
Vault. This file covers the **Vault side (Milestone 1, built)** and the plan for the rest. The app itself is milestones M2 to M5 below.

## Milestones

| | What | Status |
|---|---|---|
| M1 | Vault server: keys, `/api/quick-ingest/*`, Settings card, CRM inbox, Invoice Review tag, tests | **Built** (local only; not on `staging` until the owner says) |
| M2 | Native shell: tray, global hotkey, clipboard listener with exclusion flags, secret masking, DPAPI-encrypted SQLite. **Starts with a measuring spike** (idle memory, WebView teardown, focus return) | **Stack: C# / .NET 10 + WebView2** (`shelf/host/`). **Built and tested:** tray, hotkey, on-demand window, clipboard listener with the password-manager markers, secret masking, DPAPI-encrypted SQLite history with retention and auto-clear, settings, Start with Windows, Credential Manager store (171 tests + a live self-test). Still to build: sending to Vault is M4 |
| M3 | The tray page (`vault/shelf/`): shelf of cards, filters, previews, actions, Settings, hotkey recorder, behind a bridge contract (`shelf/README.md`) | **Built and verified in Chrome** against sample data (32 unit tests, 47 browser checks, light and dark). The window lifecycle (create on open, destroy on dismiss) is done by the shell (M2) |
| M4 | Dispatch from Rust (`reqwest`) with the key from Windows Credential Manager, Settings view | Not started |
| M5 | `vault-shelf://open` handler (no parameters), "Open Shelf" button in Vault's top bar, packaging | Not started |

## M2 spike results (2026-10-29, Windows 10 22H2, .NET 10.0.14, WebView2 runtime 156)

Run with the host's self-test (`shelf/host/README.md`): real hotkey, real Notepad, injected key presses; memory = private working set of the host plus its own WebView2 processes.

| Goal | Result |
|---|---|
| Idle under 35 MB | **Met.** The tray alone is about 17 MB (about 2 MB after a memory trim), with **no browser process running** |
| Active under 90 MB | **Met, but only with tuned browser switches.** With WebView2's defaults the open shelf used about 115 MB (157 MB the first time). With the switches in `ShelfWindow.DefaultBrowserArgs` it uses **65 to 80 MB** (6 processes) |
| Webview created on open, destroyed on dismiss | **Works.** Every browser process is gone within about a second of closing; 5 open/close cycles showed no growth |
| Speed | Window visible in about **60 ms**; cards drawn in about **0.72 s** (cold browser start is about 440 ms of that). With default switches it was about **2.8 s**: the stall was removed by turning off background networking, update checks and SmartScreen lookups, not by the GPU switch |
| Shelf gets the keyboard focus | **Yes** (directly, no workaround needed) in all cycles |
| Previous window gets focus back on Esc | **Yes**, in all cycles, about 60 ms |
| Click-away | **Works.** Choosing another window closes the shelf in about 40 ms and the chosen window keeps the focus |
| Hostile clips in the real window with the built page's policy | SVG shown as a blob image, HTML in a sandboxed frame, **0 script pop-ups** |

### After the clipboard, masking and storage work (same machine)

With the SQLite store, listener and WinForms clipboard code added: idle about 18 MB (14 MB after clipboard activity); **first open about 85 MB, later opens about 73 MB** (under 90; a cycle that also renders an SVG and an HTML clip is about 81); cards in about 0.75 to 0.9 s. The live listener passed every scenario through the real message loop: it captures text, masks a secret (the real one is nowhere in the store), drops password-manager clips, honours pause and the exclusion list, names the copying program, keeps a double copy once, captures pictures, and does not re-capture a copy-back from the shelf.

Findings that changed the design: the "200 to 400 ms to create the webview" estimate was wrong for default settings (2.8 s) and about right only with the tuned switches (about 0.7 s
to a finished page); and Windows 10 has no Mica, so the translucent window could not be tested here.

## The key (ingest-only token)

- A key looks like `vsh_` + 64 hex characters. **Only its SHA-256 is stored** (`shelf_tokens."tokenHash"`); the key is shown once when made.
- Made, named and revoked in **Settings -> Vault Shelf** (`client/src/components/settings/ShelfTokensPanel.jsx`). Up to 5 active keys per person; optional expiry (30 / 90 / 365 days).
- Each key has **scopes**: `notes:write`, `finance:write`, `crm:write`, `redact:check`. What a key can do right now = its scopes **and** what the account may use
  (`effectiveScopes()` in `server/services/shelfTokens.js`): Notes has no switch; Finance needs `finance` and `gmailIntel` (the queue lives in Inbox Intel); CRM needs
  `clients`; redaction needs `documentRedaction`. Admins are never narrowed, same as `requireFeature`.
- The whole thing is behind the **`shelf` feature flag (off by default)**. Members get it from Settings -> Feature Access; it can be narrowed per member.
- A key stops working when it is revoked, expires, the account is disabled, the person is deleted (cascade), or the account is an accountant login.
- A key works **only** on `/api/quick-ingest/*`. A login session token does not work there, and a key does not work anywhere else.
- Errors never echo the request. Failures are logged by name/code only; `server/lib/sentry.js` strips bodies and the `Authorization` header for these paths.

## Routes

`/api/quick-ingest/*` is mounted in `server/index.js` **before the global 30 MB body parser and before `requireAuth`**; the router checks the key first, then reads its own small body
(2 MB of JSON, or one picture up to 10 MB as multipart). Every answer is `Cache-Control: no-store`. There is deliberately no CORS: the native app is not a browser.

| Route | Scope | What it does |
|---|---|---|
| `GET /verify` | any | Is the key good? Returns the scopes usable **now** (`scopes`), the ones held but switched off (`unavailable`), and limits. The app hides buttons the server would refuse, so the server stays the single source of truth. |
| `POST /notes` | `notes:write` | `{ clipId, text?, title?, sourceApp? }` or multipart with `file` -> a note, `notes.source = 'shelf'`. A picture is attached through the normal attachment system (same quota). |
| `POST /finance` | `finance:write` | Text, table or picture -> a **pending row in `expense_review_queue`** (`source = 'shelf'`, `gmailMessageId` NULL). A model reads vendor / amount / date / currency (see below). Never creates an expense. |
| `POST /crm` | `crm:write` | -> `shelf_inbox` (unfiled). No client picker in the app by design. |
| `POST /redact` | `redact:check` | `{ text }` -> where sensitive-looking details are. Pattern scan only, **nothing stored, no model**. |

Every write takes a **`clipId`** (8 to 64 of `A-Za-z0-9_-`). `shelf_ingests` has one row per (person, clip, route), so a retry after a dropped connection answers
`{ ok: true, duplicate: true, id }` instead of making a second copy. A request still running answers 409 `IN_PROGRESS`; a claim abandoned for 5 minutes (a crash) can be re-sent.

Signed-in routes used by the Vault pages:

- `/api/shelf-tokens` (behind `requireFeature('shelf')`): `GET /`, `POST /`, `POST /:id/revoke`, `DELETE /:id` (only a revoked/expired key can be removed).
- `/api/shelf-inbox` (behind `requireFeature('clients')`): `GET /`, `GET /count`, `GET /:id/file`, `POST /:id/assign { clientId, contactId?, dealId?, note? }`, `DELETE /:id`.

## Finance extraction (`server/services/shelfExtract.js`)

- Model = whatever the workspace set in Settings, never an id in code: `light` for text; for a picture the first of `light`, `gemini`, `standard` that can look at pictures.
  No suitable model = the clip is queued blank.
- The clip is **untrusted**: cut to 10,000 characters, wrapped as data, and the answer is checked in code (types, ranges, a real date not years ahead). Nothing the model says is run.
- Output `{ vendor, amount, date, currency, confidence }`. **Below 0.6 confidence the whole suggestion is kept out of the queue's own fields** (all-or-nothing) and stored under
  `rawExtraction.suggested` for the reviewer. Only an **AUD** total is put in `amount` (same rule as Gmail invoices: foreign totals are left for the card statement).
- Limit: 20 model calls per key per hour; past it the clip is still queued, blank (`extraction: 'rate_limited'`). Cost is logged to `usage_logs` as `shelf_extract`.
- **Not yet run against a real model** (tests stub `callModel`).

## Data

- `shelf_tokens` (hash, label, scopes, expiry, last used, revoked), `shelf_ingests` (idempotency), `shelf_inbox` (unfiled CRM captures; text or a picture on disk under `UPLOAD_DIR/shelf-inbox/<userId>/`).
- `expense_review_queue`: `"gmailMessageId"` is now nullable; new `source` (`gmail` default / `shelf`) and `"sizeBytes"`. The unique `(userId, gmailMessageId)` rule still holds for Gmail rows (NULLs never collide).
- Pictures for Finance are saved by `saveInvoiceFile()` (generalised from the PDF saver) under `invoices/YYYY/MM/`, extension chosen by us from the file's **magic bytes** (`server/utils/imageSniff.js`: PNG, JPEG, GIF, WebP only; SVG is refused).
- Shelf storage cap: `SHELF_QUOTA_MB` (default 200) across unfiled CRM captures and Shelf rows in the review queue. Note and CRM-note pictures use the usual attachment quota.
- A picture or text clip in the CRM inbox becomes a real `client_interactions` row (type `note`, titled "Captured with Vault Shelf") only when a client is chosen; a picture is then attached to it and the temporary file removed.
  Throwing a capture away is a hard delete (it is only a copy of the clipboard, so it does not use the recycle bin).

## Limits and guards

120 requests a minute per key; 20 model calls an hour per key; 60 redaction checks a minute per key; 10 MB per picture; 200,000 characters per text clip; 500 unfiled CRM captures per person.
These counters are in memory and **reset when the server restarts**.

## Tests

`npm run test:shelf` (helpers, then the real app against a throwaway Postgres; `DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_shelf_test`, the harness refuses anything not on this machine and blocks the network).
Also `npm run test:settings-nav`, `test:settings-tutor`, `test:guides`. The 14 routes are in `server/testing/routeManifest.json` (ingest = `public`, i.e. key-authenticated like the PC Health helper; the rest `authed`).

## Decisions made with the owner (so they are not re-opened)

- Server first, with real endpoints, before any app code.
- Redaction = an inline pattern scan, not a DOCX job. Names are not found; the answer says so.
- Finance lands in the Invoice Review queue, never straight into the books.
- CRM = an unfiled inbox, no client picker in the app.
- Webview created on open and destroyed on dismiss to meet the idle-memory goal; normal window activation with the previous window restored on dismiss (validated in the M2 spike).
- Originals of pictures are kept encrypted on disk in the app (10 MB cap); the thumbnail is separate.
- HTTP dispatch happens in the Rust process, so the key never reaches the webview.
