# Observability

Structured logging, request tracing, slow-query logging, rate limiting, and error tracking — added because the app had none of this at ~58k lines of routes/services and 65 route files, all logging via bare `console.log`/`console.error`.

---

## Request tracing

Every request gets a `requestId` (from `x-request-id` header if the caller sent one, otherwise a generated UUID), carried through an `AsyncLocalStorage` context so any log line emitted anywhere during that request — route handler, service, DB query — is tagged with the same id, without threading it through every function signature.

- `server/lib/logger.js` — base `pino` instance. Level from `LOG_LEVEL` env var (default `info`).
- `server/middleware/requestContext.js` — `requestContext` middleware creates the per-request child logger and `AsyncLocalStorage` context; `getLogger()` returns the current request's logger anywhere in the call chain (falls back to the base logger outside a request, e.g. cron jobs); `attachUserToLogContext(userId)` re-derives the child logger with `userId` once auth resolves.
- `server/middleware/auth.js` — calls `attachUserToLogContext(req.user.id)` right after setting `req.user`, so `userId` appears on every subsequent log line in that request.
- `server/middleware/httpLogger.js` — one `info`/`warn`/`error` line per finished request: `method`, `path`, `status`, `durationMs`. Level bumps to `warn` on 4xx, `error` on 5xx.

Both are mounted in `server/index.js` before `helmet` and before route registration, so even a request rejected by helmet or a rate limiter still gets an id and shows up in the log.

**Migration note:** the ~700 existing `console.log`/`console.error` calls across the codebase were left in place — no mass find-replace. Replace opportunistically when touching a file; `getLogger()` is the replacement (`getLogger().info({...}, 'message')`), not `logger` directly, so the `requestId`/`userId` tagging isn't lost.

## Slow-query / DB failure logging

`server/db.js` wraps `pool.query` in place at the source (`pool.query = async function tracedQuery(...) {...}`), so every existing `pool.query(...)` call site across the codebase gets this for free — no call-site changes needed anywhere.

- Queries over 200ms log a `warn` with the query text (first 200 chars), duration, and row count.
- Failed queries log an `error` with the query text and error message, then rethrow (behavior unchanged).
- Both are tagged with the current request's `requestId`/`userId` via `getLogger()`.

**Closed:** `pool.connect()` is also wrapped, so `client.query()` inside the `BEGIN`/`COMMIT`/`ROLLBACK` transaction pattern gets the same tracing as `pool.query()`. Had to support pg-pool's dual callback/promise `connect()` contract — pg-pool's own `Pool.prototype.query()` calls `this.connect(callback)` internally, so a promise-only wrapper broke `pool.query()` itself.

## Rate limiting

`express-rate-limit`, applied in two places:

**Auth (`server/routes/auth.js`)** — per-IP, since these run before `req.user` exists:
- `login` — 10 / 15 min (pre-existing)
- `register` — 10 / 15 min (added; `INVITE_CODE` is one shared secret with no expiry, so this is the only thing standing between a leaked code and unlimited registration attempts)
- `reset-password-request` / `reset-password-confirm` — 5 / 15 min each (added; unlimited reset-request was both a spam vector and an email-enumeration side channel)

**AI-cost routes (`server/middleware/aiRateLimit.js`)** — `aiLimiter`, 30 req/min, keyed by `req.user.id` (not IP — so a shared office IP doesn't throttle everyone, and the cap is actually per-user rather than per-network). Mounted in `server/index.js` on every route that calls a paid external API directly: chat, compare, debate, videos, product-scout, property-scenario, document-redaction, google-ads/seo, translate, graphics.

Not rate-limited: recipes (grocery pricing is live-search only, no model call), domains, fonts (local Python subprocess, no external API cost), pdf (stateless, no generation cost).

## Error tracking (Sentry)

`server/lib/sentry.js` — a thin wrapper around `@sentry/node`, entirely gated on the `SENTRY_DSN` env var:

- **Unset** — every exported function (`captureException`, `setupExpressErrorHandler`, `flush`) is a no-op. Nothing to configure, nothing breaks, before a Sentry project exists.
- **Set** — real `Sentry.init()` at the very top of `server/index.js` (before `express` or anything else is required, so Sentry's auto-instrumentation covers `http`/`express`/`pg`), `Sentry.setupExpressErrorHandler(app)` mounted after all routes and before the final error-handling middleware (per Sentry's Express integration contract), and `captureException` wired into all three existing failure paths:
  - the global Express error handler (tagged with `requestId`/`userId`)
  - `process.on('unhandledRejection', ...)`
  - `process.on('uncaughtException', ...)` — flushes Sentry (2s timeout) before `process.exit(1)`, since `captureException` only enqueues the event and `process.exit` would otherwise kill the process before the transport sends it

### Env vars

| Var | Purpose | Required? |
|---|---|---|
| `SENTRY_DSN` | Sentry project DSN. Unset = Sentry fully disabled (no-op). | No |
| `SENTRY_TRACES_SAMPLE_RATE` | Fraction of requests traced for performance monitoring (default `0.1`). Only relevant if `SENTRY_DSN` is set. | No |
| `SENTRY_AUTH_TOKEN` | Sentry internal integration token (`Settings → Auth Tokens`, scope `project:read`) — read-only pull of issues/stats into the admin dashboard overview panel. Unset = panel shows a "set this to see data" message with a link to Sentry instead. | No |
| `SENTRY_ORG` | Sentry org slug for the dashboard API calls. Default `curam-ai`. | No |
| `SENTRY_PROJECT` | Sentry project slug for the dashboard API calls. Default `python-flask` (the project's Sentry slug, unrelated to the actual Node stack). | No |
| `LOG_LEVEL` | pino log level (default `info`). | No |
| `NODE_ENV` | Already used elsewhere in the app (CSP, static serving); also tags Sentry events with the environment. | No |

### Admin dashboard overview

`server/services/sentryStats.js` (`getOverview()`) + `GET /api/admin/sentry-overview` + `SentryPanel` in `client/src/pages/AdminPage.jsx`: pulls unresolved-issue count/list and 24h event volume straight from the Sentry REST API (`/api/0/projects/{org}/{project}/issues/` + `/stats/`), read-only, gated on `SENTRY_AUTH_TOKEN`. Always shows an "Open in Sentry" link to the project regardless of token state. Issue list is capped at 10 (page limit) — beyond that the count badge shows `10+` rather than a false exact number.

## What's not done yet

- Error-rate / 429-count / slow-query-count from the app's own request logs are not yet surfaced in the admin dashboard (only Sentry's own issue/event data is, via the panel above) — cross-referencing app-side rate-limit/slow-query metrics with Sentry issues is still a log-only exercise.
- No log aggregation/shipping configured beyond Railway's own stdout capture — `requestId` correlation works via `grep`/Railway's log search today, not a dedicated log platform.
