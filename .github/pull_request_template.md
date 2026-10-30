## What this changes

<!-- one or two plain sentences -->

## New feature gate (tick or write "n/a" and why; see vault/docs/hardening.md)

- [ ] One flag in the registry (server + client lists, parity test passes)
- [ ] Ownership rule, and a test showing another member cannot reach it (`crossUserOwnership.test.js`); new routes added to `routeManifest.json`
- [ ] Schema change is idempotent and additive (no drop, rename or type change)
- [ ] `getLogger()` logging; cost/rate limit decided if it calls a paid API; retention or recycle bin decided if it stores user data
- [ ] Any cron that sends, creates or pays is wrapped in `withCronLock`
- [ ] Guide entry and docs updated (drift tests pass)
- [ ] If it grows an already-large file: the extraction target, or why none

## How it was tested

<!-- commands run and what they showed -->
