# Shares thesis journal

Shares → **Thesis**. Built 2026-11-07 as the first slice of roadmap step 10 ("thesis journal"). The idea comes from the `thesis-tracker` and `thesis-drift` skills in github.com/xbtlin/ai-berkshire (MIT, value-investing prompts for Claude Code). Nothing was copied: those skills write report files from a command line; this is rewritten around Vault's own data.

## What it does

One written thesis per holding (also allowed for a share not held): why I own it, 3 to 7 assumptions that must stay true (each with how to verify it), red lines that would mean the thesis is wrong, optional value anchors (optimistic / neutral / pessimistic) and an optional five-sentence "mirror test". **Check now** asks a model whether the stored evidence still supports the thesis and saves the result as a dated row, so the history is the drift record.

A check rates each assumption `intact`, `weakening`, `impaired`, `broken` or `unclear`, lists any red line that was hit, and from the second check on says what changed since the last one across five dimensions (valuation, assumptions, red lines, management, moat).

## Rules (enforced in code, tested)

- **Never advice.** The prompt forbids buy/sell/hold and price prediction, and the verdict words cannot carry one. The screen says so under every check.
- **Evidence or nothing.** A rating other than `intact`/`unclear`, a triggered red line, or a `improved`/`weakened` drift needs quoted evidence; without it the server downgrades it to `unclear` (`parseCheckReply`). An unreadable reply becomes all `unclear`, never a made-up rating.
- **Score and verdict are worked out in code, not by the model** (`scoreCheck`): 10 minus 1/2/3 for each weakening/impaired/broken assumption, minus 3 per red line hit, floor 0. Verdict order: `red-line`, `broken`, `impaired` (or score 5 or less), `weakening`, `unclear` (all unclear), `intact`.
- **Price is not evidence about the business.** The prompt says so; price only counts under the "valuation" drift dimension.
- **Evidence pack is Vault's own data only:** the thesis, the holding's current position, its trades, its daily news briefings (last 45 days) and the previous check. It holds **no company filings**, so many ratings will honestly be `unclear`. The earnings-review skill from the same repo was parked until roadmap step 7 (8-K feed) gives it real filings to read.
- A `red-line`, `broken` or `impaired` result is also put in the Suggestions inbox (`SuggestionService.capture`, source `sharesThesis`, one per holding, verdict and day).

## Where things are

- `server/services/sharesThesis.js`: input cleaning, `buildCheckPrompt`, `parseCheckReply`, `scoreCheck`, list/save/`runCheck`. Model: the `standard` slot via `getModelsForUser`. Usage is logged as `shares_thesis_check`.
- `server/routes/sharesThesis.js` at `/api/shares/thesis`: `GET /`, `PUT /` (create or replace by symbol + exchange), `GET /:id/checks`, `POST /:id/check` (AI rate limiter), `DELETE /:id`. Registered before `/api/shares`; all behind `requireFeature('shares')`. The five routes are in `server/testing/routeManifest.json`.
- Tables `share_theses` (unique per user, symbol, exchange) and `share_thesis_checks` (cascade) in `server/db.js`. Each check stores a snapshot of the thesis it was run against, so editing the thesis later does not rewrite history.
- Delete goes to the recycle bin with its check history (`recycleBin/adapters/sharesThesis.js`, type `share-thesis`); the toast offers Undo. Restore refuses if a thesis for that holding was written since.
- `client/src/components/shares/SharesThesisTab.jsx`: list on the left (two columns from `xl`), editor or open thesis on the right. Tooltips on the controls, microphone on every text field, `ProcessingModal` while a check runs.
- Guide chat: a `thesis` entry in `CATALOG` in `server/services/sharesTutor.js`, plus two "not possible" lines (no filings, no judging the thesis). The "How Shares Works" box on the page also describes the tab.

## The Shares tour

A 9-step Shepherd tour of the whole Shares page (`client/src/utils/tours/sharesTour.js`, key `vault_tour_shares_completed`): welcome, Refresh quotes and the tab row, Trades and Cash as the source, CGT/Statements/Accountant pack, Charts and News, Questions, Thesis, Metals, help. It switches tabs as it goes (`setTab`) and returns to Portfolio at the end. Start it from the "Take the tour" link beside the page title or Settings → Tours → Shares Tour (`/shares?tour=1`). Tabs carry `data-tour="shares-tab-<id>"`, so a new tab can get a step the same way; keep `TOTAL_STEPS` and the step numbers in step. Starting it closes the first-visit (i) box. Checked in a browser 2026-11-07 (all 9 steps, no console errors, finish sets the key).

## Tests

`node server/services/sharesThesis.test.js` (no model, no database): input cleaning, the downgrade rules, scoring and verdict order, prompt content and the advice rules. `node server/services/sharesTutor.test.js` keeps the guide and the page tabs in step. The full path (save, check with a stubbed model, delete, restore) was run once against the local database on 2026-11-07; the live model call has **not** been run yet, so read the first real check critically.

## Not built

A scheduled check after each earnings season; the pre-buy checklist's pass/fail gates (left out on purpose: they lean towards buy/avoid verdicts); earnings review from filings (needs roadmap step 7); the repo's cross-check of key figures (belongs in the step 3 data health panel).
