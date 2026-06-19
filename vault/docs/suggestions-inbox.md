# Agent suggestions inbox

A triage queue for findings from Cursor agents, cron jobs, and other routines — anomalies, missing rules/skills, automation ideas, and alerts worth reviewing later.

## Overview

- **Table:** `agent_suggestions`
- **Routes:** `server/routes/suggestions.js`
- **Constants:** `server/constants/suggestionInbox.js`
- **UI:** `/suggestions` (inbox icon in top nav, after Memory)

Suggestions are **per user** (`userId`). Each account sees only their own inbox.

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
| `apply` | Will act on this |
| `learn` | Revisit later |
| `ignore` | Dismissed |

User owns triage — agents should **create** suggestions only, not change status.

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/suggestions` | List — `?category=`, `?status=`, `?q=` search |
| `GET` | `/api/suggestions/meta` | Category/status counts |
| `GET` | `/api/suggestions/count?status=new` | Badge count |
| `GET` | `/api/suggestions/:id` | Single item |
| `POST` | `/api/suggestions` | Create |
| `PATCH` | `/api/suggestions/:id` | Update fields or status |
| `DELETE` | `/api/suggestions/:id` | Remove |

### Create payload

```json
{
  "category": "rule",
  "title": "Short actionable summary",
  "body": "What was found and why it matters",
  "context": "optional: file path, job name, commit"
}
```

## UI

- Filter chips by category and status (with counts)
- Search across title, body, context
- Status buttons on each card
- Manual **Add suggestion** form
- Nav badge when `new` count > 0

## Agent instructions

Documented in `CLAUDE.md` → **Agent suggestions inbox**.

After **substantial** vault work, if something is worth flagging, POST to `/api/suggestions` (when dev server is running) instead of relying on chat alone.

## Future

If this workflow proves useful in Vault, the same pattern can migrate to **mcptools** (Settings or dedicated tab) for org-wide agent findings.
