# Agent suggestions inbox

A triage queue for findings from Cursor agents, cron jobs, and other routines — anomalies, missing rules/skills, automation ideas, and alerts worth reviewing later.

## Architecture

All emitters funnel through **`server/services/SuggestionService.js`**. Do not insert into `agent_suggestions` directly.

```
┌─────────────────┐     ┌──────────────────────┐     ┌──────────────────┐
│ Crons           │────▶│ SuggestionService    │────▶│ agent_suggestions│
│ Services        │     │ capture / captureIf  │     │ (per user)       │
│ Startup checks  │     │ report* helpers      │     └────────┬─────────┘
│ Cursor agents   │────▶│ POST /api/suggestions│              │
└─────────────────┘     └──────────────────────┘              ▼
                                                      /suggestions UI
```

**Mandatory:** Any service, cron, or agent that finds something worth flagging must call `SuggestionService` — not only `console.warn`.

## Overview

- **Table:** `agent_suggestions` (`source`, `fingerprint` for dedup)
- **Routes:** `server/routes/suggestions.js`
- **Constants:** `server/constants/suggestionInbox.js`
- **UI:** `/suggestions` (inbox icon in top nav, after Memory)

Suggestions are **per user** (`userId`). Workspace-wide issues (missing pgvector, API keys) go to the **primary admin** inbox.

## Categories

| Category | Use for |
|----------|---------|
| `rule` | Missing or outdated Cursor rule, DESIGN.md gap |
| `skill` | Repetitive pattern that could become an agent skill |
| `automation` | Cron, hook, or script opportunity |
| `source` | Code/config anomaly at a specific location |
| `alert` | Misconfig, security note, operational warning |
| `other` | Anything else |

## Status workflow

| Status | Meaning |
|--------|---------|
| `new` | Just added — shows nav badge |
| `opened` | Seen, not yet decided |
| `implement` | Acted on — task/note created or page opened |
| `learn` | Revisit later |
| `ignore` | Dismissed (same fingerprint can be suggested again later) |

## Implement action

`POST /api/suggestions/:id/implement` creates a concrete artifact based on category:

| Category | Action |
|----------|--------|
| `rule` | Note with Cursor rule draft + save path |
| `skill` | Note with SKILL.md outline |
| `automation` | High-priority task tagged `automation` |
| `source` | Task with file/context in notes |
| `alert` | Navigate to relevant settings page when detectable; else high-priority task |
| `other` | Standard task |

Status is set to `implement` and `implementationResult` JSON stores `{ type, taskId?, noteId?, path? }`. Re-clicking Implement returns the existing result without duplicating.

User owns triage — automated emitters create only; they do not change status.

## Emitting (server code)

```javascript
const { capture, captureIf, makeFingerprint } = require('../services/SuggestionService');

await captureIf(condition, {
  userId,
  source: 'newsDigestCron',       // emitter name
  category: 'alert',
  fingerprint: makeFingerprint('newsDigestCron', 'stable-key'),
  title: 'Short summary',
  body: 'Details and suggested fix',
  context: 'file path, job id, date',
});
```

### Built-in emitters (wired today)

| Emitter | When it suggests |
|---------|------------------|
| `startup` | pgvector missing, embeddings unavailable |
| `newsDigestCron` | No articles, topic failures, all-empty run, high cost |
| `sharesCron` | Missing ASX API key, poll/briefing failures |
| `MemoryService` | Embeddings down, memories not searchable |
| `manual` | User adds via UI |

### Adding a new emitter

1. Import `SuggestionService` in your service/cron.
2. At end of run (or on error path), call `captureIf` / `capture`.
3. Use a stable `fingerprint` so repeated runs refresh the same open item instead of flooding the inbox.
4. Document the `source` name in this file.

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/suggestions` | List — `?category=`, `?status=`, `?q=` search |
| `GET` | `/api/suggestions/meta` | Category/status counts |
| `GET` | `/api/suggestions/count?status=new` | Badge count |
| `POST` | `/api/suggestions` | Create (uses SuggestionService) |
| `PATCH` | `/api/suggestions/:id` | Update fields or status (not `implement` — use implement endpoint) |
| `POST` | `/api/suggestions/:id/implement` | Create task/note/nav target and mark implemented |
| `DELETE` | `/api/suggestions/:id` | Remove |

## UI

- Filter chips by category and status (with counts)
- Search across title, body, context
- Status buttons on each card
- Manual **Add suggestion** form
- Nav badge when `new` count > 0

## Cursor agents

Documented in `CLAUDE.md` → **Agent suggestions inbox**. After substantial work, call `SuggestionService.capture()` or `POST /api/suggestions`.

## Future

Migrate the same pattern to **mcptools** for org-wide agent findings.
