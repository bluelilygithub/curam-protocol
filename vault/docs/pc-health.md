# PC Health agent

Admin-only page (`/pc-health`, nav "PC Health" under Business) that reports on the admin's **own computer**: drive space, memory and processor use, the programs using the most, the largest files and biggest folders, log files that keep growing, and things left behind (crash dumps, temp folders, caches, old installers, the Recycle Bin). It also compares each scan with the previous one to show growth.

**It reports and explains. The one exception is Safe clean-up** (below), which can empty four rebuildable folders and nothing else. Scanning never deletes, moves, renames or changes a file or stops a program, and no finding carries a "fix" command. `server/services/pcHealth.test.js` fails if anything outside the marked clean-up section of the helper gains a write or delete command.

## How it reaches the PC

Vault runs on Railway and cannot see a Windows PC. So the page only **queues** a scan and a small read-only helper on the PC does the looking:

0. The **Set up the helper** page is the user manual: a six-step quick start (download, put the file in a folder such as `C:\Tools\pc-health`, make the key, open PowerShell and paste the two lines `cd <folder>` + the command, leave the window open, Run a scan), a tick box that adds `-AllowCleanup`, "Day to day" notes (the helper only works while its window is open; Ctrl+C stops it) and an "If something goes wrong" list for the common errors. Keep that page in step with the helper's parameters.
1. Admin opens **Set up the helper**, makes a key (shown once, stored only as a SHA-256 hash in `pc_health_helpers`), downloads `server/assets/pc-health-helper.ps1`, and runs the one command shown (`-Server` + `-Token`; the `PC_HEALTH_TOKEN` environment variable also works).
2. The helper polls `POST /api/pc-helper/poll` every 30 s (token auth, mounted before `requireAuth`, classed `public` in the route manifest).
3. **Run a scan** inserts a `pc_health_scans` row (`queued`). The helper claims it (`running`, `FOR UPDATE SKIP LOCKED`), scans, and posts the report. The server sanitises it (`pcHealth.sanitizeReport`: every field type-checked, bounded, control characters stripped), compares it with the previous finished scan, stores `report` + `findings` + `summary`, and the page opens it.

A running scan that never reports is marked failed after 45 minutes; a request nobody picks up is cancelled after a day. 30 scans are kept per person. Only one scan may be waiting or running at a time.

## What the helper reads

Windows PowerShell 5.1+. Only `Get-CimInstance`, `Get-Process`, read-only .NET directory listings and one HTTPS call to the server given. Standard places: the user profile (includes Local Sites), `C:\Users\Public`, `C:\ProgramData`, `C:\Windows\Temp`, `C:\Windows\Logs`, `C:\Windows\Minidump`; or the whole `C:` drive; plus optional extra folders. Junctions/symlinks are not followed. A time limit (1 to 30 min) stops a long scan and the report says so. Known places measured separately: temp, Windows Update download cache, Recycle Bin, Windows.old, crash dumps, WER, npm/pip/Yarn/NuGet caches, Chrome/Edge cache, and the hibernation/page/swap files and `MEMORY.DMP` (listed as Windows-managed system files, not as removals).

Limits: Windows keeps some folders private (a few sizes are too low, notably other accounts' Recycle Bins); processor use is a 5-second sample, not a daily average; names, sizes and dates only, never file contents.

## Findings

`pcHealth.analyse()` is pure code with thresholds in `THRESHOLDS`, so the same report always gives the same findings (the model is not involved). High/Watch rules: drive free below 20% / 10%; memory used above 70% / 85%; a program using over 1.5 GB / 4 GB or 25% / 60% of the processor; a file over the chosen size (5 GB = High); logs over 200 MB / 1 GB total and any single log over 100 MB; leftovers over 500 MB / 5 GB; folders that grew 500 MB or 25% (and at least 100 MB) since the previous scan, and new folders over 1 GB / 5 GB. High findings file one Suggestions-inbox alert per distinct set (`source: pcHealth`).

## Safe clean-up

Added 2026-10-21 at the owner's request ("show what is safe to delete and give me a toggle to complete the task"). Everything else the scan finds stays advice only. What can be cleared is a fixed list in `server/services/pcHealthCleanup.js` (`CLEANABLE`): the user Temp folder (files not changed for over a day, plus the empty folders they leave) and the npm, pip and Yarn download caches. All rebuild themselves. Not offered, on purpose: Downloads, archives, installers, Docker/WSL/VM disks, logs, the Recycle Bin, browser caches, NuGet, Windows' own Temp, system files.

Several locks, each enforced separately and tested:

1. **Candidates** come only from the latest finished scan and only when a scanned location matches the exact expected path for that cache (`candidatesFor`). A look-alike path is not a match.
2. **Vault sends names, never paths.** The helper has the four real locations written in the script (`Get-CleanTargets`) and refuses any location that is not exactly the expected one or is a link.
3. **Two opt-ins.** The person switches each item on (all off to start) and confirms "Yes, clear them" in Vault; and the helper must have been started with `-AllowCleanup` (it reports `canClean` on every poll; the server never hands a clean-up to a helper without it, and the page shows the exact command when it is off).
4. **Narrow deletion code.** Everything between `BEGIN SAFE CLEAN-UP` and `END SAFE CLEAN-UP` in the helper; exactly two delete calls (`File.Delete` per file, `Directory.Delete(path, $false)` for empty folders), no recursive delete, links and junctions are never entered or removed, files in use or changed within the age limit are skipped, the root folder itself stays.
5. **Permanent.** Nothing goes to the Recycle Bin; the page says so before the person confirms.
6. **Reported and logged.** The helper returns MB freed, files removed and files left alone per item (`pc_health_cleanups.results`), shown on the page; each request and result is logged server-side.

Tables: `pc_health_cleanups`, plus `pc_health_helpers."canClean"`. Routes: `GET /api/pc-health/cleanup`, `POST /api/pc-health/cleanups` (needs `confirm: true`), `POST /api/pc-health/cleanups/:id/cancel`; helper side `POST /api/pc-helper/cleanups/:id/result|fail`. Client: `client/src/pages/pcHealth/CleanupPanel.jsx`. Tests: `pcHealthCleanup.test.js` (what may be offered, result cleaning), the structure checks in `pcHealth.test.js`, and an end-to-end run of the real helper against a throwaway `subst` drive (junction not followed, locked file kept, new files kept, wrong location refused, nothing deleted without `-AllowCleanup`).

Clearing caches frees space only for now and will not by itself fix a nearly full drive; the big items (Downloads, Docker, VM disks) are deliberately left to the person.

## More info and Copy report

Every finding has a **More info** toggle (what it is, why it matters, what you could consider, what to check first). The text comes from `server/services/pcHealthAdvice.js`: fixed rules on the finding's id and path (Docker and WSL disks, the Claude app's VM files, archives and installers in Downloads, editor databases, MySQL binlogs, Git packs, WordPress debug logs, browsers, node, caches, the Recycle Bin and so on), added when a scan is read so wording changes also apply to old scans. It names no command, and says plainly when deleting the thing would be harmful (a test checks both). **Copy report** / **Copy with explanations** (Overview) build a plain-text version in `client/src/pages/pcHealth/reportText.mjs` for pasting into a chat or email.

## Pieces

| Piece | Where |
|---|---|
| Page | `client/src/pages/PcHealthPage.jsx`, panels `client/src/pages/pcHealth/Panels.jsx` |
| Tool list, tips, (i) text, guide controls | `client/src/pages/pcHealth/pcHealthTools.mjs` |
| Tour | `client/src/utils/tours/pcHealthTour.js` (compass icon; `/pc-health?tour=1`) |
| Admin API | `server/routes/pcHealth.js` at `/api/pc-health` (`requireAdmin`) |
| Helper API | same file, `helperRouter` at `/api/pc-helper` (token) |
| Logic | `server/services/pcHealth.js`, advice wording `server/services/pcHealthAdvice.js`, copy text `client/src/pages/pcHealth/reportText.mjs` |
| Helper program | `server/assets/pc-health-helper.ps1` |
| Guide chat | `server/services/pcHealthTutor.js`, `server/routes/pcHealthTutor.js` (`/api/pc-health-tutor`, `requireAdmin`), `client/src/pages/pcHealth/PcHealthTutorChat.jsx`, `guideId` `pc-health`. Sees no scan data. |
| Tables | `pc_health_helpers`, `pc_health_scans` in `server/db.js` |
| Tests | `npm run test:pc-health`, `npm run test:pc-health-tutor`, `npm run test:guides`, `npm run test:cross-user` |

Same layout as Video Tools / Measurements: shared `ToolSidebar` (grouped list, search with microphone, hover tips), (i) box that opens once, tour, round guide button, microphone on the search box, extra folders, large-file size and time limit.

When a tool is added or changed update `pcHealthTools.mjs` and the guide `CATALOG` together (`test:pc-health-tutor` fails on drift).

## Not built

Scheduled automatic scans, real-time alerts, other computers, the Vault server itself, hardware health (SMART, temperatures), virus checks, and any clean-up beyond the four items in Safe clean-up (no deleting of files, archives, logs, installers, Docker or VM disks, or the Recycle Bin).
