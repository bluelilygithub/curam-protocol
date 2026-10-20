# PC Health agent

Admin-only page (`/pc-health`, nav "PC Health" under Business) that reports on the admin's **own computer**: drive space, memory and processor use, the programs using the most, the largest files and biggest folders, log files that keep growing, and things left behind (crash dumps, temp folders, caches, old installers, the Recycle Bin). It also compares each scan with the previous one to show growth.

**It only reports.** Nothing in the page, the server routes or the helper deletes, moves, renames, cleans or changes a file, or stops a program. No finding carries a "fix" command. `server/services/pcHealth.test.js` fails if the helper script gains a write/delete cmdlet.

## How it reaches the PC

Vault runs on Railway and cannot see a Windows PC. So the page only **queues** a scan and a small read-only helper on the PC does the looking:

1. Admin opens **Set up the helper**, makes a key (shown once, stored only as a SHA-256 hash in `pc_health_helpers`), downloads `server/assets/pc-health-helper.ps1`, and runs the one command shown (`-Server` + `-Token`; the `PC_HEALTH_TOKEN` environment variable also works).
2. The helper polls `POST /api/pc-helper/poll` every 30 s (token auth, mounted before `requireAuth`, classed `public` in the route manifest).
3. **Run a scan** inserts a `pc_health_scans` row (`queued`). The helper claims it (`running`, `FOR UPDATE SKIP LOCKED`), scans, and posts the report. The server sanitises it (`pcHealth.sanitizeReport`: every field type-checked, bounded, control characters stripped), compares it with the previous finished scan, stores `report` + `findings` + `summary`, and the page opens it.

A running scan that never reports is marked failed after 45 minutes; a request nobody picks up is cancelled after a day. 30 scans are kept per person. Only one scan may be waiting or running at a time.

## What the helper reads

Windows PowerShell 5.1+. Only `Get-CimInstance`, `Get-Process`, read-only .NET directory listings and one HTTPS call to the server given. Standard places: the user profile (includes Local Sites), `C:\Users\Public`, `C:\ProgramData`, `C:\Windows\Temp`, `C:\Windows\Logs`, `C:\Windows\Minidump`; or the whole `C:` drive; plus optional extra folders. Junctions/symlinks are not followed. A time limit (1 to 30 min) stops a long scan and the report says so. Known places measured separately: temp, Windows Update download cache, Recycle Bin, Windows.old, crash dumps, WER, npm/pip/Yarn/NuGet caches, Chrome/Edge cache, and the hibernation/page/swap files and `MEMORY.DMP` (listed as Windows-managed system files, not as removals).

Limits: Windows keeps some folders private (a few sizes are too low, notably other accounts' Recycle Bins); processor use is a 5-second sample, not a daily average; names, sizes and dates only, never file contents.

## Findings

`pcHealth.analyse()` is pure code with thresholds in `THRESHOLDS`, so the same report always gives the same findings (the model is not involved). High/Watch rules: drive free below 20% / 10%; memory used above 70% / 85%; a program using over 1.5 GB / 4 GB or 25% / 60% of the processor; a file over the chosen size (5 GB = High); logs over 200 MB / 1 GB total and any single log over 100 MB; leftovers over 500 MB / 5 GB; folders that grew 500 MB or 25% (and at least 100 MB) since the previous scan, and new folders over 1 GB / 5 GB. High findings file one Suggestions-inbox alert per distinct set (`source: pcHealth`).

## Pieces

| Piece | Where |
|---|---|
| Page | `client/src/pages/PcHealthPage.jsx`, panels `client/src/pages/pcHealth/Panels.jsx` |
| Tool list, tips, (i) text, guide controls | `client/src/pages/pcHealth/pcHealthTools.mjs` |
| Tour | `client/src/utils/tours/pcHealthTour.js` (compass icon; `/pc-health?tour=1`) |
| Admin API | `server/routes/pcHealth.js` at `/api/pc-health` (`requireAdmin`) |
| Helper API | same file, `helperRouter` at `/api/pc-helper` (token) |
| Logic | `server/services/pcHealth.js` |
| Helper program | `server/assets/pc-health-helper.ps1` |
| Guide chat | `server/services/pcHealthTutor.js`, `server/routes/pcHealthTutor.js` (`/api/pc-health-tutor`, `requireAdmin`), `client/src/pages/pcHealth/PcHealthTutorChat.jsx`, `guideId` `pc-health`. Sees no scan data. |
| Tables | `pc_health_helpers`, `pc_health_scans` in `server/db.js` |
| Tests | `npm run test:pc-health`, `npm run test:pc-health-tutor`, `npm run test:guides`, `npm run test:cross-user` |

Same layout as Video Tools / Measurements: shared `ToolSidebar` (grouped list, search with microphone, hover tips), (i) box that opens once, tour, round guide button, microphone on the search box, extra folders, large-file size and time limit.

When a tool is added or changed update `pcHealthTools.mjs` and the guide `CATALOG` together (`test:pc-health-tutor` fails on drift).

## Not built

Scheduled automatic scans, real-time alerts, other computers, the Vault server itself, hardware health (SMART, temperatures), virus checks, and any clean-up action. By design there is no delete or fix.
