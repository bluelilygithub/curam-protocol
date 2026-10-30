# Vault Shelf

A small Windows clipboard companion (C# / .NET 10 + WebView2 shell in `vault/shelf/host/`, React tray page in `vault/shelf/`) that keeps what you copy and
sends the bits you choose into Vault. This file covers the **Vault side (Milestone 1)** and the status of the app milestones M2 to M5 below.

## Milestones

| | What | Status |
|---|---|---|
| M1 | Vault server: keys, `/api/quick-ingest/*`, Settings card, CRM inbox, Invoice Review tag, tests | **Built** (local only; not on `staging` until the owner says) |
| M2 | Native shell: tray, global hotkey, clipboard listener with exclusion flags, secret masking, DPAPI-encrypted SQLite. **Starts with a measuring spike** (idle memory, WebView teardown, focus return) | **Stack: C# / .NET 10 + WebView2** (`shelf/host/`). **Built and tested:** tray, hotkey, on-demand window, clipboard listener with the password-manager markers, secret masking, DPAPI-encrypted SQLite history with retention and auto-clear, settings, Start with Windows, Credential Manager store (171 tests + a live self-test). Still to build: sending to Vault is M4 |
| M3 | The tray page (`vault/shelf/`): shelf of cards, filters, previews, actions, Settings, hotkey recorder, behind a bridge contract (`shelf/README.md`) | **Built and verified in Chrome** against sample data (32 unit tests, 47 browser checks, light and dark). The window lifecycle (create on open, destroy on dismiss) is done by the shell (M2) |
| M4 | Sending to Vault from the shell (`shelf/host/Vault/VaultClient.cs`): connect (check the address and key, then save), verify, and the four send actions, key read from Windows Credential Manager. Plus **tooltips, Help and a tour** on the tray page | **Built** (225 host tests incl. an opt-in live test against a real Vault; 47 page tests; 77 browser checks in each of light and dark; the whole chain driven in the real window against a local Vault server: all four buttons live, each confirmation shown) |
| M5 | `vault-shelf://open` handler (no parameters), "Open Shelf" button in Vault's top bar with an admin on/off switch, EXE installer | **Built** (290 host tests; the installer was run for real: install, update over a running copy, self-start, link, uninstall). The installer file is hosted by Vault itself (see below). Not done: code signing |

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

### After the Vault look (themes, fonts, Lucide icons) was applied

The shelf now follows Vault's design system (`shelf/README.md`, "The look"): Vault's six colour tokens from `client/src/themes.js` (all five themes, Warm Sand by default), Vault's fonts bundled with the page, opacity-only hover, 200 ms transitions, Lucide icons, no OS dark mode. Verified in the real window: the exact Vault colours and fonts are in place at first paint for the default and for a saved Dark Slate with Inter, the bundled fonts load under the page's security policy, no script pop-ups. **Memory finding:** the first version of this work raised the first open to about 84 to 96 MB (over the 90 MB cap); the cause was one CSS `backdrop-blur` on the panel, which the GPU-less browser renders in software. Removing it gives **first open about 79 MB, later opens 67 to 74 MB, worst case 84 MB** (three runs), about 10 MB under the cap. Chromium's low-end-device mode made no difference.

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

## Sending to Vault (M4): how the shell talks to Vault

Only the native shell talks to Vault; the page never sees the key. `Bridge.HandleAsync` answers `verify`, `save_connection` and `dispatch` through `VaultClient`:

- **Connect** (Settings, Vault connection): the address is normalised (https only, plain http only for localhost, no user name or password in it, only its origin is used), the key must look like `vsh_` plus 64 hex, and Vault is asked (`GET /api/quick-ingest/verify`) **before anything is saved**. Only then is the key written to Credential Manager and the address to `settings.json`. Leaving the key box empty re-checks the saved key against a new address.
- **Verify** runs each time the shelf opens; the four buttons come alive from its answer (greyed, with the reason in a tooltip, when the key cannot do that).
- **Dispatch**: text goes as JSON `{ text, clipId, sourceApp }`; a picture goes as multipart with the original PNG; redaction sends only `{ text }`. The clip id makes a retry safe (Vault answers `duplicate`, shown as "Already in Vault").
- **Refused before any network call:** a clip with a masked secret, text over 200,000 characters, a picture sent to redaction, a picture whose original was over 10 MB, a bad address or key.
- **Redirects are never followed** (the key would otherwise go to a second address), responses are read up to 2 MB only, a server answer of the wrong shape never throws, and the person sees fixed plain sentences for network faults, never exception text. The log (`%LOCALAPPDATA%\VaultShelf\vaultshelf.log`) records the action and the outcome only, never what was sent.
- Live check: set `VAULT_URL` and `VAULT_KEY` and run `dotnet test` in `shelf/host.tests` (the live test sends real clips: use a throwaway account), or run the self-test with those two set to drive the real window against that Vault.

## Installing it, the `vault-shelf://open` link and the top-bar button (M5)

**The installer** is `VaultShelfSetup.exe` (about 60 MB, one file, runs on a PC with no .NET). Build it with `powershell -ExecutionPolicy Bypass -File vault/shelf/setup/build-installer.ps1` (page build, self-contained publish, zip, then the setup program with the zip inside; output `shelf/setup/out/`, git-ignored; the script prints its SHA-256). It installs **for the person who runs it, in their own account, so no administrator is needed**: files in `%LOCALAPPDATA%ProgramsVaultShelf`, then the program registers itself (`VaultShelf.exe --register`: the `vault-shelf://` link, an entry in Windows' Apps list with its uninstall command, a Start menu shortcut) and starts in the tray. The setup program is a plain file copier; everything Windows-specific is in `shelf/host/Install/` where it is tested.
- Switches: `/S` silent, `/dir=PATH`, `/nostart`, `/uninstall` (with `/S`, and `/purge` to delete the copy history too). Installing again over a running copy updates it (the old files go, so none are left behind). The program is started through Explorer so a deployment tool waiting on the installer is not held up.
- **Folder safety:** an install folder must be new, empty, or an earlier install of this program; anything else is refused, so an update can never wipe someone's files. Archive names that try to leave the folder are refused. Uninstall removes only the exact folder the installer recorded, never a drive root, a profile folder or a source checkout; the copy history (`%LOCALAPPDATA%VaultShelf`) is kept unless `/purge`.
- **WebView2:** the installer checks for Microsoft's runtime and, if the PC lacks it, downloads Microsoft's own small installer and runs it only after checking it carries Microsoft's signature. That download path could not be exercised on this PC (the runtime is already here); the detection and the signature check are tested.
- **Not signed.** Windows SmartScreen warns on first run ("More info", "Run anyway") until the file is signed with a code-signing certificate.

**The link.** `vault-shelf://open` is the only request the app understands, and it carries no data. Anything else (a query, a path, another word) is ignored and logged. If the app is not running the link starts it and opens the shelf; if it is running, the link asks that copy to open (a named event, nothing travels with it). Windows/the browser asks the person once before opening it.

**Hosting the installer on Vault (Railway).** An admin uploads `VaultShelfSetup.exe` in **Settings, Vault Shelf, Open Shelf button and installer (admin)** (Upload or Replace installer; Remove). It is kept on the server's upload volume (`UPLOAD_DIR/shelf-installer/`, so it survives redeploys exactly like other uploads) as one file plus a small record of its size and SHA-256 (shown in Settings: compare it with the fingerprint `build-installer.ps1` printed). Routes (all under `/api/shelf-tokens`, signed in and Shelf on): `GET /installer` (anyone with the Shelf; sent as an attachment with `nosniff`, never run by the server), `POST /installer` (admin; multipart `file`; must be named `.exe`, start with "MZ", be over 100 KB and under `SHELF_INSTALLER_MAX_MB`, default 200; written to a temp name, hashed, then renamed over the old file in one step), `DELETE /installer` (admin). The download is **authenticated, not a public link**: the button fetches it with the person's sign-in and saves it. If no file is uploaded, the admin's optional outside https address is used instead; if neither, the note says "ask your Vault admin". Untested on Railway itself (tested through the real server code against a local database): confirm the volume is mounted and that a 60 MB upload gets through Railway's proxy.

**The top-bar button.** An **Open Shelf** button (clipboard icon) in Vault's top bar, shown only when: the person may use the Shelf (the `shelf` flag), they are on a Windows desktop browser, and **an admin has switched it on** in **Settings, Vault Shelf, Open Shelf button (admin)**, which also holds the installer download address (https only). Off by default. The setting is the `shelf_launcher` row in `workspace_settings` (`GET`/`PUT /api/shelf-tokens/launcher`; anyone with the Shelf may read it, only an admin may change it). The browser cannot tell whether the app opened, so after the press the button shows a small note: "your browser may ask to open Vault Shelf; if nothing happens it may not be installed", with the Download link (or "ask your admin"). Tests: `npm run test:shelf` (the switch), `npm run test:shelf-launcher` (Windows detection and the note).

## Help, tooltips and the tour (tray page)

Same conventions as Finance and Video Tools, scaled to a small tray window:

- **A tooltip on every control** (`components/Tooltip.tsx`, the shelf's version of Vault's: themed card, 200 ms, hover and keyboard focus, kept inside the window). All wording is in `src/lib/tips.ts` (send buttons: `ACTION_TIPS`; tabs: `FILTER_TIPS`; everything else: `TIPS`). A greyed send button shows the reason it is greyed (it uses `aria-disabled`, not `disabled`, so the tip still shows). No control may use the browser's plain `title`.
- **Help** (the (i) button beside Settings; opens by itself the first time, remembered in `localStorage` key `shelf:info-seen:v1`): six plain-word sections in `src/lib/help.ts` (what it is, using it, sending to Vault, connecting, privacy, if something is wrong).
- **Tour** (the compass button inside Help): spotlight steps on elements marked `data-tour="..."`, also in `help.ts` (`TOUR_STEPS`). Esc ends the tour without closing the shelf.
- **Not built: a guide chat.** The other tools have one (`/api/<tool>-tutor`), but it needs the page to call Vault, and here only the shell does. If wanted later it would be a bridge command that sends the question through `VaultClient`.
- **When a button, setting or screen changes, update `tips.ts` and `help.ts` together.** `npm test` in `vault/shelf` fails if a tab or send button has no tip, a control is not wrapped in a Tooltip, a plain `title` creeps back, a help section is missing, or a tour step points at nothing.

## Decisions made with the owner (so they are not re-opened)

- Server first, with real endpoints, before any app code.
- Redaction = an inline pattern scan, not a DOCX job. Names are not found; the answer says so.
- Finance lands in the Invoice Review queue, never straight into the books.
- CRM = an unfiled inbox, no client picker in the app.
- Webview created on open and destroyed on dismiss to meet the idle-memory goal; normal window activation with the previous window restored on dismiss (validated in the M2 spike).
- Originals of pictures are kept encrypted on disk in the app (10 MB cap); the thumbnail is separate.
- HTTP dispatch happens in the native shell process (C#, not Rust: the stack changed in M2), so the key never reaches the webview.
