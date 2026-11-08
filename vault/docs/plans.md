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
- **A leaf step's placement:** `start = max(plan start, day after every blocker's end)`, snapped to a working day, or its pinned start when it has one. `end = start + (days - 1)` working days. **A milestone is a point in time, not work:** it lands on the day the last step it waits on ends (not the day after), so a decision or sign-off adds no day, and the step after it starts the next working day. A milestone with nothing before it sits on the plan's first day. (Changed 2026-11-08 when diagram to plan was built; before that a milestone took the next day.)
- **No start at all** means nothing is placed (said plainly, not guessed). A pinned step can supply the start.
- **The server decides.** Every edit goes to the server and the page reloads; the client never computes dates (`planLogic.mjs` only formats and reorders).

## From a diagram (added 2026-11-08)

The **Make a plan** button in Diagrams (beside To Notes; shown only when Plans is switched on for the person, admins always) turns a diagram into a plan. It uses **no AI**: the diagram is read off the board in the browser (`readDiagram` in `client/src/pages/drawings/sceneDiagram.mjs`: boxes with writing, their shape, and the arrows joined to them with their labels) and sent to the server, which applies fixed rules (`server/services/planFromDiagram.js`, pure, tested).

- **Boxes** become steps of one working day unless the person gives a length. **Decisions** (diamonds) and **end ovals** become milestones; a **Start** oval with nothing before it is dropped (it is not work). An arrow means the next step waits on the one before.
- **Decisions are assumed to be Yes.** An arrow leaving a decision whose label says no (`no`, `n`, `nope`, `false`, or starting with reject, decline, deny, fail, cancel, refuse, or the word not) is left out, and so is any step reachable only through it. Unlabelled and any other label are kept. A tick in the box, **Include the No branches as steps**, brings them back. The box lists what was left out. Only arrows leaving a decision count: a box whose arrow says "no" is left alone.
- **Loops are left out and counted.** Forward arrows (by reading order) are kept first; an arrow that would close a circle is dropped (`wouldCycle`), because a plan cannot go in circles. "No, ask again" loops are the usual case.
- **The person is asked** for the start, the finish-by date, the working week and the days for each step, and a live line says whether it fits (Fits exactly, N working days spare, Over by N working days, or a suggested start when only the end date is given). The preview is a server call (`POST /api/plans/from-diagram/preview`, saves nothing) so the numbers come from the same rules as a saved plan.
- **Create plan** (`POST /api/plans/from-diagram`, one transaction) makes the plan (`sourceKind` `drawing`, `sourceId` the drawing), its steps (in reading order, notes say `After "Customer accepts?": Yes`), the dependencies, and **the first `plan_links` row** (kind `drawing`, the diagram's title as label). The diagram is checked to be the caller's first (another person's or a missing one is "not found" and nothing is made).
- **Two-way link:** `GET /api/plans/by-source?kind=drawing&id=N` lists the plans made from a diagram; the button then reads **In a plan** / **In N plans** with a list to **Go to** and **Make another plan**, the same pattern as To Notes. A later change to the diagram is not copied into a plan already made.
- **Limits:** 40 boxes and 80 arrows (the same as Draw it for me); with several separate diagrams on the board it uses the selected one, or the biggest. A diagram with fewer than two boxes joined by an arrow is refused with a plain message.
- **Where:** `server/services/planFromDiagram.js` (+ `.test.js`), `planErrors.js` (shared `PlanError`), `previewFromDiagram` / `createFromDiagram` / `listBySource` in `server/services/plans.js`, the three routes in `server/routes/plans.js` (named routes before `/:id`), `client/src/pages/drawings/PlanButton.jsx` and `MakePlanDialog.jsx`, the guide entry `make-plan` in `drawingsTools.mjs` and `server/services/drawingsTutor.js`. Tests: `node server/services/planFromDiagram.test.js` and the from-diagram section of `plans.db.test.js`.
- **Dialog** got a wider size, `2xl` (`max-w-4xl`), in `client/src/components/Dialog.jsx`.

## Made for what comes next (not built)

- **`plan_links`** is a generic link table from a plan, or one of its steps, to anything else in Vault: `kind` (`task`, `note`, `drawing`, `sketch`, `client`, `event` ...) and a text `refId`. Diagram to plan writes the first rows (kind `drawing`, after checking the diagram is the caller's). It is how "send a step to Tasks", "this step came from that diagram" and "show a plan on the calendar" will be recorded without another table each time. **The target's owner is not checked when a link is stored**, so the first writer must check it per kind.
- `plans."sourceKind"` / `"sourceId"` say where a plan was made from (`drawing` and the drawing's id, for plans made from a diagram).

## Not built yet (said honestly)

- **Estimate the lengths with AI.** Diagram to plan is built, but every step is one working day until the person types a length. An **Estimate lengths** button (a model call, with its own cost, rate limit and a fence round the diagram's words) was deliberately left until the plain version has been tried on a real diagram. **Make a plan from a note** is not built either.
- **Diagram to plan was checked on screen with a test diagram inserted directly into the local database**, not one drawn by the AI (no model key locally); a real hand-drawn or AI-drawn diagram on Railway is untried.
- **Send a step, or a whole plan, to Tasks**; a calendar layer; dragging bars to move or resize; a critical-path highlight.
- **A tour, a guide chat and an entry in Settings -> tours**, as the other tools have. The (i) box, tooltips on every control and the microphone on every text box are done.
- **Recycle bin for a single step**, and a way to reorder steps by hand (they stay in the order they were added; groups keep their sub-steps under them).
- **Not run on Railway.** Checked on a local copy: the plan list, creating a plan, adding steps, waits on, fit messages, the timeline, delete and Undo.
- The route manifest got the 10 new routes by hand; `crossUser.test.js` still fails on 11 SERP Tracker routes that were committed without one (not from Plans).
