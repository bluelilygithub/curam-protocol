<!-- sources: CLAUDE.md sha256=8939df12d90a83d06e909c3fe6da3fd1c81d07f4e31aea1c610cfad017ff38e6; docs/core-conventions.md sha256=ba7476a9e791ed4a3879370c8e367ee680f991041d37315a5503d8e11cf4757d -->
1. **Access.** Every API route is behind `requireAuth` except auth, health and shared links (registered before it). Admin-only routes use `requireAdmin`; a member tool's routes use `requireFeature('<flag>')`. Every query filters by `"userId"`; ids from the request are checked against the owner.
2. **Feature flags.** A new member tool gets a flag in both `server/config/featureAccess.js` and `client/src/utils/featureAccess.js`, with the same default. Workspace switches come first, then per-member narrowing (a member can be switched off, never on). Admins are never narrowed.
3. **Lifecycle.** A flag that ships off or is not yet proven gets a `FEATURE_LIFECYCLE` entry (`preview` or `parked`) on both sides; everything else is `ga`.
4. **Navigation.** A page is added once, to `client/src/config/appNavigation.js`, and a route in `App.jsx`; never to Layout by hand.
5. **Help on every tool.** A shared `Tooltip` on every control, an (i) "how it works" box, a compass tour, a microphone on text fields (`VoiceInput`), and a guide chat built on `TutorChat` and registered in `server/config/guides.js`, whose catalogue stays in step with the page's tool list (a test fails on drift). Admin reports may skip the guide.
6. **Client calls.** Every `/api/` call goes through `client/src/utils/apiClient.js`; never a raw `fetch('/api/...')`.
7. **UI kit.** Icons only through `getIcon(name)` (registered in the icon map first). Modals only through the shared `Dialog`. Loading and empty states use `Skeleton` and `EmptyState`. Colours come from the theme variables, hover is opacity only, transitions are 200 ms, layout uses the full desktop width (two columns from `xl`). Floating buttons are draggable. Slow blocking work shows the `ProcessingModal`.
8. **Deleting.** User content goes to the shared 30-day recycle bin with `moveToBin` in the same transaction as the delete, with an adapter that can restore it. Routine deletes confirm inline (Yes / No).
9. **AI cost guard.** Any mount whose routes call a model has `aiLimiter`.
10. **Model selection.** No hardcoded model ids: models come from Settings through `getModelsForUser(userId)` (`standard` for substantive work, `light` for cheap background calls); usage is logged.
11. **Outside URLs.** Anything that fetches a user-supplied URL uses `safeFetch` or `htmlFetch.checkSsrf`.
12. **Findings go to the inbox.** Services, crons and agents that detect an anomaly or improvement call `SuggestionService.capture()` / `captureIf()`, not just log it.
13. **Background jobs.** Crons that send mail, create records or call paid APIs run inside `withCronLock`.
14. **Logging.** New server code logs through `getLogger()` (pino), not `console.*`, and never logs secrets or user content.
15. **Database.** Raw parameterised SQL; idempotent DDL in `server/db.js` (`IF NOT EXISTS`); camelCase columns double-quoted; counts wrapped in `Number()`; transactions with BEGIN / COMMIT / ROLLBACK; named routes before `/:id`.
16. **Tests.** Every tool has tests run directly with `node path/to/file.test.js`. New test scripts are never added to package.json.
17. **Docs.** Every tool has `docs/<tool>.md`, and key files are listed in `docs/key-files.md`.
18. **Changelog.** Every commit gets an admin Changelog entry (what changed, files, goal, benefit, honest concerns) in a separate `Changelog:` commit before pushing.
19. **Deploy speed.** Never edit package.json or the lockfile just for a script; a dependency change rebuilds the base image (10-15 minutes) and must be announced and batched. System packages go in `Dockerfile.base`, never `Dockerfile`. Prefer packages already installed.
