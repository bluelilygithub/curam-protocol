# Plans

Added 2026-11-08. A plan is a named set of **steps**, each with a length in working days and optional "waits on" links, drawn as a Gantt. Route `/plans` (the list) and `/plans/:id` (one plan). Workspace group in the navigation. Flag **`plans`**, lifecycle **`preview`**, **off by default** (admins can always open it).

**Why its own tool, and why steps are not Tasks.** "Project" used to mean a chat workspace; the owner wanted a place for dated, dependent work that came from a diagram or a note. Tasks already has a Timeline (`client/src/components/tasks/TaskTimeline.jsx`) and dependencies (`task_dependencies`), but about 100 queries across 25 server files read the `tasks` table (digest, attention list, dashboard, calendar, fitness, goals, clients). Putting plan steps in `tasks` behind a `planId` would mean touching every one, and a single missed query would flood the digest with overdue steps. So **plan steps are their own rows** (`plan_steps`) and reach Tasks only when the person sends one (not built yet). The Timeline is shared, not copied.

## What it does

- **A plan** has a name, notes, a start date, a "finish by" date, a working week (Monday to Friday, or every day), and a status label (draft, active, done, archived). Up to 100 per person.
- **Steps** have a name, a length in working days, an optional **pinned start**, a status (to do, in progress, done), notes and an optional parent (a **group**). Up to 300 per plan. A **milestone** has no length and shows as a diamond. A step with sub-steps is a **group**: it has no length of its own and spans its children.
- **Waits on:** a step starts the working day after the last step it waits on ends. Steps that wait on nothing start together on the plan's start date. A circle is refused (`wouldCycle`), and groups take no dependencies (link their sub-steps instead). A step that has dependencies cannot become a group, and the plus button on it is disabled.
- **Any two of start, end and length:** start + lengths gives the finish; an end date + lengths with **no** start suggests one ("Use Fri 11 Dec" button); if both are set it says whether the steps **fit**, exactly, with room (working days spare), or are **over** (by how many working days) and what to do about it. It never squeezes the lengths by itself.
- **Pinned start:** change a step's date and it is held there (a pin button un-holds it). If a step it waits on runs past that day it is marked **clashes** in the table; the date is kept, not silently moved.
- **The timeline** is the Tasks timeline fed from the plan (`showBlocked={false}`, because waiting is normal in a plan; opens at Week zoom when the plan is four weeks or shorter). Clicking a bar jumps to the step's row. It is read-only: no dragging yet.
- **Delete:** a plan goes to the shared recycle bin whole (steps, dependencies and links, dates as text) with an Undo button, 30 days. **A single step is deleted for good** (its sub-steps and links go with it; the page asks first). Steps are not recycle-binned yet.

## Where things are

| Piece | File |
|---|---|
| tables `plans`, `plan_steps`, `plan_step_deps`, `plan_links` | `server/db.js` (after `task_dependencies`) |
| date rules, no database: working days, schedule, fit, start-from-end, cycle check | `server/services/planSchedule.js` |
| rules and SQL (every query by `"userId"`) | `server/services/plans.js` |
| HTTP | `server/routes/plans.js`, mounted at `/api/plans` behind `requireFeature('plans')` |
| recycle bin | `server/services/recycleBin/adapters/plans.js` (type `plan`) |
| pages | `client/src/pages/PlansPage.jsx`, `plans/PlanList.jsx`, `plans/PlanEditor.jsx`, `plans/planLogic.mjs` |
| shared timeline (now takes `startDate`, `showBlocked`, `defaultZoom`) | `client/src/components/tasks/TaskTimeline.jsx` |
| tests | `node server/services/planSchedule.test.js`, `node client/src/pages/plans/planLogic.test.mjs`, `DATABASE_URL=... node server/routes/plans.db.test.js` |

## Rules worth knowing

- **Dates are text.** `DATE` columns are read with `::text` (`PLAN_COLS`, `STEP_COLS`) and all date maths is in UTC, so a time zone or daylight-saving change can never move a step by a day. The recycle-bin snapshot uses the same columns for the same reason.
- **A leaf step's placement:** `start = max(plan start, day after every blocker's end)`, snapped to a working day, or its pinned start when it has one. `end = start + (days - 1)` working days. A milestone ends the day it starts.
- **No start at all** means nothing is placed (said plainly, not guessed). A pinned step can supply the start.
- **The server decides.** Every edit goes to the server and the page reloads; the client never computes dates (`planLogic.mjs` only formats and reorders).

## Made for what comes next (not built)

- **`plan_links`** is a generic link table from a plan, or one of its steps, to anything else in Vault: `kind` (`task`, `note`, `drawing`, `sketch`, `client`, `event` ...) and a text `refId`. Nothing writes to it yet. It is how "send a step to Tasks", "this step came from that diagram" and "show a plan on the calendar" will be recorded without another table each time. **The target's owner is not checked when a link is stored**, so the first writer must check it per kind.
- `plans."sourceKind"` / `"sourceId"` say where a plan was made from (for diagram to plan).

## Not built yet (said honestly)

- **Make a plan from a diagram or a note** (the AI drafts the steps and durations, the person corrects them in a preview). This was the reason for building Plans.
- **Send a step, or a whole plan, to Tasks**; a calendar layer; dragging bars to move or resize; a critical-path highlight.
- **A tour, a guide chat and an entry in Settings -> tours**, as the other tools have. The (i) box, tooltips on every control and the microphone on every text box are done.
- **Recycle bin for a single step**, and a way to reorder steps by hand (they stay in the order they were added; groups keep their sub-steps under them).
- **Not run on Railway.** Checked on a local copy: the plan list, creating a plan, adding steps, waits on, fit messages, the timeline, delete and Undo.
- The route manifest got the 10 new routes by hand; `crossUser.test.js` still fails on 11 SERP Tracker routes that were committed without one (not from Plans).
