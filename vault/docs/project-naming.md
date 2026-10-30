# Project naming

Decision record, 2026-10-31. The wording part is done; the field part is deliberately not.

## The problem

"Project" is used in six unrelated senses:

| Sense | Stored in | What the user sees |
|---|---|---|
| Chat project | `projects` | "Projects" in the sidebar, home, `@` mentions, search |
| Client work | **the same `projects` row** (`projectType='client'`, `clientId`, `clientStatus`) | "Client work" |
| Room planner design | `room_projects` | "Projects" in the planner |
| Garden planner garden | `garden_projects` | "Your gardens" |
| Cellar planner design | `cellar_projects` | "Jobs" / "designs" |
| Tool save file | `restyle_projects`, `font_projects`, `seo_projects` | "Saved pages", "My Fonts", "Campaigns" |

Two of them are one table, which is where most of the confusion comes from: client work *is* a chat project with a client relationship attached, so `/projects/:id` opens a chat for it too. That is deliberate — it reuses sessions, files and tasks.

## Decision

- **Project** means the chat workspace only: a row in `projects`.
- **Client work** means a Project with `clientStatus` set. `projectType` goes back to meaning only the kind of work (Development / Research / Writing / Visual / Quick Tasks).
- **A saved garden, job, page, font or campaign is not a Project.** It is a file inside a tool.
- **`projects` is not renamed, and neither are its routes.** The ambiguity that hurts is the field overload and the wording, not the table name. A rename would touch every one of the dozen tables that carry a `projectId` for no user-visible gain.

## Done

- `5ac68aa0` — wording only: "Client projects" → "Client work", Adwords "Projects" → "Campaigns" (it already had a "Campaign readiness checklist").
- `ebb51a06` — "unlink from client" now refuses on a client project instead of leaving a half-detached engagement.

## Not done, and why

`PATCH /api/clients/:id/assign-project` still sets `clientId` without setting `projectType='client'` or `clientStatus`, so "project linked to a client" and "client project" remain two different states. Retiring the `projectType='client'` sentinel needs an additive column, a backfill, dual-write and a dual-read window — which needs a migration baseline, and Vault does not have one yet (`db.js` runs idempotent DDL on every boot). That work follows the restore rehearsal in `BACKUP.md`, not this note.

Before any of it, count the existing inconsistency per bucket: `projectType='client'` with null `clientStatus`; `clientStatus` set with `projectType <> 'client'`; and `clientId` set with neither.

## Rule for new code

Call the thing what it is. Do not add a `*_projects` table for saved documents, and do not write a new sentinel into `projectType`. If it is a chat project, say Project. If it is a saved file, name the file.
