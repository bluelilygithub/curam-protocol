# Tasks — Feature Documentation

## Overview

A full personal task manager built into Curam Vault. Accessible via the sidebar icon or directly at `/tasks`. Four views — List, Board, Calendar, and Eisenhower Matrix — share the same data and filters.

---

## Pages & Entry Points

| Location | What it does |
|---|---|
| `/tasks` | Full task management page |
| Sidebar | Checklist icon |
| Home page (Projects) | Tasks widget — top 5 upcoming tasks, quick-add input, Ask Claude button |
| Any page | Quick Capture FAB (bottom-right `+` button, or `Ctrl+Shift+N`) — minimal new-task modal |
| Any page | Morning Digest overlay — shown once per day on first visit if overdue or today tasks exist |

---

## Task Fields

| Field | Notes |
|---|---|
| **Title** | Required |
| **Notes** | Free-text description |
| **Status** | `todo` / `in-progress` / `done` |
| **Priority** | `high` / `medium` / `low` — shown as coloured left border and badge |
| **Category** | Free text — groups tasks in list view; autocompletes from existing categories |
| **Tags** | Comma-separated; stored in `task_tags`; shown as `#tag` pills in expanded view |
| **Due date** | Date only or date + time (e.g. `2026-03-08` or `2026-03-08T14:30`) |
| **Recurrence** | `none` / `daily` / `weekly` / `fortnightly` / `monthly` / `annually` — requires a due date |
| **Project** | Link to a Vault project |
| **Parent task** | Makes this a subtask of another task |
| **Estimated effort** | `estimatedMinutes` integer — entered via presets or free text |
| **Time spent** | `timeSpentMinutes` integer — accumulated focus time and manual timer sessions |
| **Key Result** | Link to a Goal Key Result (`keyResultId`) |
| **Urgent** | `isUrgent` integer (0/1) — marks a task as requiring immediate attention; drives the Eisenhower Matrix view |
| **Renewal Dimension** | `renewalDimension` text — one of `physical`, `mental`, `social`, `spiritual` (or null); Habit 7 / Sharpen the Saw categorisation; shown as emoji pill on cards |

**Computed fields returned by the API (not stored):**
- `tags` — array from `task_tags`
- `subtaskCount`, `subtaskDone` — count of child tasks and how many are done
- `keyResultTitle`, `objectiveTitle` — joined from `key_results` + `objectives`
- `blockerCount` — count of incomplete tasks that are blocking this task

---

## Task Form

Open with **+ New Task** (top right) or `n`. Edit by clicking the pencil icon on any task row.

**Effort estimate input** accepts free text:
- `15m`, `30m`, `1h`, `2h`, `4h`, `1d`, `2d` — quick-select presets
- `45m` → 45 minutes; `3h` → 180 minutes; `1.5h` → 90 minutes; `2d` → 960 minutes
- Plain integer is treated as minutes

**Due date input** accepts natural language — see [Natural Language Due Dates](#natural-language-due-dates).

**Link to Goal** — two-step dropdown (only visible if Objectives exist):
1. Select an Objective
2. A second dropdown appears to select a Key Result from that Objective
3. Clear the link by selecting "None" in either dropdown

**Urgent toggle** — below the Priority field. Click ⚡ to mark the task urgent. Urgent tasks appear in Q1 (Do First) or Q3 (Delegate) of the Eisenhower Matrix. The toggle is also available in Quick Capture.

**Renewal Dimension selector** — below the Urgent toggle. Four icon toggle buttons: 🏃 Physical · 📚 Mental · 🤝 Social · 🌱 Spiritual. Only one dimension can be active at a time; clicking the active button deselects it (sets `renewalDimension` to null). Maps to the `renewalDimension` field on the task. Used to categorise tasks by the Habit 7 / Sharpen the Saw dimensions.

**Save as template** button in the form footer saves the current form state (title, notes, category, priority, recurrence, tags) plus existing subtasks as a reusable template.

---

## Views

### List view (default)

Tasks are grouped by **category** and sorted by the active sort order within each group. Completed tasks are collected in a collapsible **Completed** section at the bottom that auto-expands when you mark a task done.

**Per-task row shows:**
- Coloured left border (priority)
- Checkbox (visible on hover, or always when any task is selected)
- Drag handle (grip icon, visible on hover — incomplete tasks only)
- Title with strikethrough when done
- Priority badge
- Category chip
- Due date label: `Overdue HH:MM` / `Due today HH:MM` / `Tomorrow HH:MM` / `Mar 12 14:00`
- Stale indicator — clock icon (amber) if task has been in To Do for 7+ days
- Recurrence badge: `↻ weekly` (or `↻ weekly ×3` after 3 recurrences)
- Project name
- Subtask progress badge: `2/5`
- Effort pill: `~1h`
- KR badge: `🎯 KR title` (if linked to a Key Result)
- Renewal dimension emoji (e.g. `🏃`) — shown when `renewalDimension` is set; appears after the effort pill
- **Notes tooltip** — hover the row to see a preview of the notes field (up to 300 characters)

**Actions on hover:**
- Circle button — toggle done/undone (shows inline warning if the task has unresolved blockers; confirm to proceed anyway)
- Share icon — generate public link (see [Task Sharing](#task-sharing))
- Copy icon — duplicate task
- Pencil icon — edit
- Stopwatch (⏱) icon — start/stop the time tracker for this task
- Focus (🎯) icon — open Focus Mode (Pomodoro timer overlay) for this task
- Trash icon — delete (confirm inline)

**Inline badges (after effort pill):**
- `⏱ 2h` — shown when `timeSpentMinutes > 0`
- `🔒` — shown when `blockerCount > 0` (task has incomplete blockers); tooltip shows count
- `⚡ Urgent` — shown when `isUrgent === 1` on incomplete tasks; amber badge

### Board view (Kanban)

Three fixed columns: **To Do** / **In Progress** / **Done**.

Drag cards **within** a column to reorder. Drag cards **across** columns to change status.

**Each card shows:** title, priority badge, due date, subtask count, effort pill, stale indicator, `⚡` urgent badge (when `isUrgent`), share button (on hover). Toggle done and edit buttons in top-right.

### Calendar view

Rendered by `TasksCalendar` component (`vault/client/src/components/TasksCalendar.jsx`). Task-specific components (filters, stats bar, templates panel, focus mode, weekly review, CSV import) live in `vault/client/src/components/tasks/`. Sub-view persists in `localStorage` under the key `tasksCalendarSubView`. Default: **week**.

**Sub-views:**

| Sub-view | Layout |
|---|---|
| **Day** | Single-day time grid — full 24-hour column |
| **Week** | 7-day time grid — Mon–Sun columns side by side |
| **Month** | 6-week grid — up to 3 task chips per cell; "+N more" popover for overflow |
| **Agenda** | List of the next 30 days, skipping empty days; date heading + task rows with priority badge, time, category |

**Time grid (Day/Week):**
- 24 hour rows × 64px each. Half-hour divider lines (dashed). Hour labels on the left column.
- **Unscheduled panel** at the top — tasks with no time component.
- **Task blocks** are absolutely positioned: `top = (hours*60+mins)/60 × 64px`, `height = max(estimatedMinutes, 30)/60 × 64px`. Left border colour by priority. Completed tasks: 50% opacity + strikethrough title.
- **Current time indicator** — red horizontal line + dot at the current hour/minute position.
- **Click empty slot** → opens New Task form with that date+time pre-filled.
- **Click task block** → inline popover (title, notes, status toggle, edit link).

**Drag-drop rescheduling:**
- Drag any task block to a new time slot → `PUT /api/tasks/:id` with updated `dueDate` (preserves existing date, changes time).
- Drag from Unscheduled panel → assigns a time.
- Drop target slots highlight on `dragover`.

**Block resize (effort editing):**
- A resize handle sits at the bottom edge of each block (cursor: `s-resize`).
- Drag down/up to change `estimatedMinutes` — snaps to 15-minute increments.
- On release: `PUT /api/tasks/:id { estimatedMinutes }` is called.

View selection (day/week/month/agenda buttons) is shown in the calendar header. The top-level view selection (list/board/calendar/matrix) persists in `localStorage` under `tasksViewMode`.

---

### Matrix view (Eisenhower)

Inspired by Habit 3 (Put First Things First). Renders the classic 2×2 Eisenhower Priority Matrix.

**Axes:**
- **Urgent** = `task.isUrgent === 1` (set via the ⚡ toggle in the task form or Quick Capture)
- **Important** = `task.priority === 'high'`

| | Urgent | Not Urgent |
|---|---|---|
| **Important** | **Q1 — Do First** (red) | **Q2 — Schedule** (indigo) |
| **Not Important** | **Q3 — Delegate** (amber) | **Q4 — Eliminate** (gray) |

Each quadrant is a scrollable card showing the task count, task rows with title + due date, and done/edit buttons.

**Insight line** — a single sentence at the top summarises the most pressing quadrant (e.g. "3 tasks need immediate attention (Q1)").

**Show completed toggle** — a chip in the matrix sub-header includes or excludes done tasks from the quadrants.

Keyboard shortcut: `m` jumps directly to Matrix view. `b` cycles through all four views.

---

## Stats Bar

Shown below the toolbar when tasks exist. Six stat cards:

| Card | Value | Clickable |
|---|---|---|
| **Total Active** | Count of incomplete tasks | No |
| **Done This Week** | Tasks marked done within the current Mon–Sun week | Yes — toggles 14-day completion bar chart |
| **Overdue** | Incomplete tasks with a past due date | Yes — applies Overdue quick filter |
| **High Priority** | Incomplete high-priority tasks | Yes — applies High Priority quick filter |
| **Total Effort** | Sum of `estimatedMinutes` for incomplete tasks in the current filter | No |
| **Time Logged** | Sum of `timeSpentMinutes` for tasks with logged time in the current filter. Formatted as `Xh Ym`. Shows `—` when zero. | No |

**14-day completion chart** — bar chart below the stats row; bars show completed task count per day; today's bar is highlighted in the primary colour.

---

## Filters & Sort

### Quick filter chips
`All` · `Today` · `This Week` · `High Priority` · `Overdue`

### Renewal dimension chips
A second filter row below the quick filter chips: `All Dimensions` · `🏃 Physical` · `📚 Mental` · `🤝 Social` · `🌱 Spiritual`. Selecting a dimension hides all tasks that don't have that `renewalDimension` value set. Selecting `All Dimensions` removes the filter. Only one dimension can be active at a time.

### Dropdowns
| Dropdown | Options |
|---|---|
| **Category** | All categories + each unique category from tasks |
| **Project** | All projects + each project |
| **Status** | To Do + In Progress (default) / To Do / In Progress / Done / All |

### Search
Full-text search across **title** and **notes**.

### Sort
| Option | Order |
|---|---|
| **Due Date** (default) | Earliest first; no due date last |
| **Priority** | High → Medium → Low |
| **Created** | Newest first (by id) |
| **A–Z** | Alphabetical ascending |
| **Z–A** | Alphabetical descending |

Sorting applies within each category group in List view.

---

## Drag to Reorder (List view)

Hover any incomplete task to reveal a grip handle on the left. Drag to reorder within the same category group. The new order is saved immediately via `PUT /api/tasks/reorder`. Reordering across category groups is not supported — use the category field to move a task.

---

## Expanding a Task

Click the task title to expand it. Shows:
- Notes
- `#tag` pills
- **View source chat** link (if task was extracted from a chat session — navigates to that session)
- Subtasks with done/undone toggles
- Inline **Add subtask** input (Enter to add)
- **Generate subtasks** button — pre-filled with task title, edit then press Enter or Generate; Claude creates subtasks via `POST /api/tasks/ai-generate` with `parentTaskId`
- **Time logged** row — `⏱ 2h 15m logged`; when `estimatedMinutes` is also set shows `⏱ 2h 15m of ~4h` with a progress bar
- **Dependencies** section — see [Task Dependencies](#task-dependencies)
- **Activity** section — user comments and auto-logged system events (see below)

---

## Comments & Activity

When a task is expanded, the Activity section shows:

- **User comments** — type in the input and press Enter or Post; delete your own comments via the ✕ button on hover
- **System events** (italicised, auto-generated) — logged automatically on `PUT /api/tasks/:id` when:
  - Status changes: `Status changed from To Do to In Progress`
  - Priority changes: `Priority changed from medium to high`
  - Due date changes: `Due date set to 2026-03-15` / `Due date removed`

---

## Recurring Tasks

Set recurrence in the task form when a due date is present. When a recurring task is marked done:
1. A new copy is created with the next due date (based on the recurrence interval)
2. Tags are copied to the new task
3. `recurrenceCount` is incremented on the new task
4. The original task remains in Completed as a record

Recurrence badge on each recurring task: `↻ weekly` (or `↻ weekly ×3` once it has recurred 3 times).

Intervals: `daily` (+1 day) · `weekly` (+7 days) · `fortnightly` (+14 days) · `monthly` (+1 month) · `annually` (+1 year).

---

## Bulk Actions

Hover any task row to reveal a checkbox. Check one or more tasks to enter bulk mode — checkboxes stay visible across the list. The bulk toolbar appears above the task list.

| Action | What it does |
|---|---|
| **Mark Done** | Set all selected tasks to `done` |
| **In Progress** | Set all to `in-progress` |
| **To Do** | Set all to `todo` |
| **Priority dropdown** | Change priority of all selected |
| **Set category** | Type a category name and press Enter to reassign all selected |
| **Delete** | Delete all selected (inline confirm required) |
| **Clear** | Deselect all |

A **select all** checkbox in the category group header selects all tasks in that group.

---

## Duplicating Tasks

Click the copy icon on any task row. Creates a new task with:
- Title + ` (copy)` suffix
- All fields copied (notes, priority, category, project, recurrence, due date, order, tags)
- Subtasks copied
- New task highlighted briefly at the top of the list

---

## Stale Task Indicator

Tasks that have been in `todo` status for more than 7 days since creation show an amber clock icon. This is a client-side visual indicator only.

---

## AI Task Generation

Click **Ask Claude** in the toolbar to open the AI panel:
1. Type a plain-language description of what you need to accomplish
2. Optionally select a project to link all generated tasks to
3. Click **Generate Tasks**

Claude (Haiku) returns a JSON array of tasks with `title`, `notes`, `priority`, `category`, `dueDate`, and `estimatedMinutes`. Tasks are created immediately and appear at the top of the list.

Examples:
- `Prepare for the client pitch on Friday`
- `Everything I need to launch the new website`
- `Plan Q2 marketing campaign`

---

## Extract Tasks from Chat

In any chat session, click **Export → Extract Tasks**. Claude reads the last 20 messages and extracts action items as tasks. A toast notification shows the count and a **View Tasks** link.

Extracted tasks store `sourceSessionId` — expand the task in the list to see **View source chat**, which navigates directly back to that conversation.

---

## Task Templates

Click **Templates** in the toolbar to open the templates side panel.

**Each template stores:** name, description, category, priority, recurrence, tags (comma-separated), and a list of subtasks.

**Apply** a template → creates a task pre-filled with all template fields; subtasks are created as child tasks; tags are applied.

**Create from panel:** click **+ New** at the top of the panel — fill name, category, priority, and subtasks (one per line).

**Create from form:** click **Save as template** in the task form footer — saves the current form values plus any existing subtasks.

---

## CSV Import

Click **Import** in the toolbar to open the import modal.

1. **Download template** — sample CSV with column headers
2. **Upload** — drag-drop or browse; client-side parsing with quoted-field support
3. **Preview** — table shows each row with a per-row checkbox; invalid rows are flagged with the reason
4. **Import selected** — POSTs to `POST /api/tasks/import`

**Accepted CSV columns:** `title` (required), `notes`, `status`, `priority`, `category`, `projectId`, `dueDate`, `estimatedMinutes`, `timeSpentMinutes`, `tags` (comma-separated within the cell).

Row-level validation: missing title, invalid status/priority values, non-existent `projectId` are reported as errors but don't block importing valid rows.

---

## Task Sharing

Any task can be shared as a public read-only link.

**To share:** hover any task card → click the share icon → a popover appears with the URL and a Copy button.

First click generates a `shareToken` (16-byte hex) and stores it on the task. Subsequent clicks on the same task re-use the existing token.

The public URL is `APP_URL + /shared/task/:token` and requires no login. The public view shows: title, priority, status, notes, due date, category, estimated effort, tags, and subtasks.

**To revoke:** open the share popover → click **Revoke link** → `shareToken` is set to `NULL` and the URL immediately returns 404.

If a task already has a `shareToken`, the share icon on the card is highlighted in the primary colour.

---

## Natural Language Due Dates

The due date field in the New/Edit Task form accepts natural language. A live preview below the input shows the resolved date in green, or an amber warning if the input can't be parsed.

**Supported formats** (all local time, handled by `vault/client/src/utils/parseDate.js`):

| Input example | Result |
|---|---|
| `today` | Today at current time |
| `tomorrow` | Tomorrow at 09:00 |
| `yesterday` | Yesterday |
| `monday` / `friday` (weekday name) | Next occurrence of that weekday |
| `next monday` | Next Monday |
| `this friday` | Coming Friday within the current week |
| `in 3 days` / `in 2 weeks` / `in 1 month` | Relative offset |
| `end of week` | Coming Sunday |
| `end of month` | Last day of current month |
| `next week` | Monday of next week |
| `next month` | 1st of next month |
| `mar 15` / `15 mar` / `march 15` | That date (current year or next year if past) |
| `15/03` / `03-15` | DD/MM — current or next year |
| `2027-03-15` / `15/03/2027` | Exact full date |
| `tomorrow 3pm` / `friday 14:30` | Date + time combined |
| `next friday 9am` | Next Friday at 09:00 |

A 📅 icon in the field opens a standard date picker as a fallback.

An optional **time** input appears below the date field to refine the time after a date is resolved.

---

## Task Dependencies

Tasks can depend on other tasks. A **blocked task** cannot be started (conceptually) until all its blockers are done.

**Setup (expanded view → Dependencies section):**
- **Blocked by** — lists tasks that block this task. Each entry shows the blocker's title, status badge, and a `×` remove button.
- **Add blocker** — type to search existing tasks. A dropdown shows matching results. Select one to create the dependency via `POST /api/tasks/:id/dependencies`.
- **Blocking** (read-only) — lists tasks that this task is blocking (i.e., tasks that depend on this task).

**🔒 badge:** shown on any task card when `blockerCount > 0` (at least one incomplete blocker). Tooltip shows "Blocked by N incomplete tasks".

**Blocker warning on done:** if a task has unresolved blockers and you click its circle button to mark it done, an inline warning appears: "This task has N unresolved blockers. Mark as done anyway?" — Confirm/Cancel. The action is not blocked, just warned.

**Circular dependency detection:** the server performs a BFS traversal from the new `blockedByTaskId` following its own blockers. If it reaches `taskId`, the POST returns `400 Circular dependency detected`.

---

## Time Tracking

Two mechanisms accumulate `timeSpentMinutes` on a task:

### 1. Stopwatch (task card)
- Click the ⏱ icon on any task card hover actions to start timing.
- Only one task can be timed at a time — starting a new timer stops and logs the previous one.
- A running indicator appears in the top bar: `⏱ Task title — HH:MM:SS`.
- Click the ⏱ icon again (or start a timer on another task) to stop and log the elapsed minutes via `PUT /api/tasks/:id { timeSpentMinutes }`.

### 2. Focus Mode (Pomodoro timer)
- Time accumulated while the Focus mode timer runs in **Focus** mode is logged on close — see [Focus Mode](#focus-mode-pomodoro).

### Display
- Task card: `⏱ 2h` pill next to effort pill when `timeSpentMinutes > 0`.
- Expanded view: `⏱ 2h 15m logged` row. With an estimate: `⏱ 2h 15m of ~4h` with a small progress bar.
- Stats bar: **Time Logged** card (6th card) shows the total across the current filtered view.

---

## Focus Mode (Pomodoro)

Click the 🎯 icon on any task card to open the Focus Mode overlay. Also accessible via `Shift+F` when a task is expanded, or from the board card.

**Layout:** fixed full-screen overlay with a centred card (max 480px wide, `z-index: 9999`). Click backdrop or press Esc to close.

**Task panel:**
- Task title, priority badge, due date
- Notes (scrollable, max 80px)
- Subtask checklist — each subtask is a checkbox; toggling calls `PUT /api/tasks/:subId { status }`
- **Mark task done** button — marks the parent task done and closes the overlay

**Pomodoro timer:**
- Four mode buttons: **Focus** (25m), **Short break** (5m), **Long break** (15m), **Custom**
- Large `MM:SS` countdown with an SVG ring progress indicator
- **Start / Pause / Reset** controls
- Session counter: "Session N of 4" — after every 4 focus sessions a long break is suggested
- Timer zero: plays a 440Hz Web Audio API beep (0.3s, sine wave) and shows "Time's up!"

**Settings** (gear ⚙ icon, inline panel):
- Focus, short break, long break, and custom durations (1–120 min)
- Auto-start breaks — automatically starts a short/long break when focus timer ends
- Auto-start focus — automatically restarts focus after a break
- Persisted in `localStorage` under key `pomodoroSettings`

**Time tracking:**
- `elapsedFocusSeconds` accumulates while the timer runs in Focus mode.
- On close (✕, Esc, or backdrop click): if ≥ 1 minute has elapsed, `PUT /api/tasks/:id { timeSpentMinutes }` is called, and a "Paused — X minutes logged" message is shown for 1.5 s before closing.
- On "Mark task done": time is logged before the task is marked done.

---

## @mention Tasks in Chat

Type `@` in any chat input to open the mention dropdown. The dropdown shows:
- **Search the web** option
- Matching projects
- Up to 20 incomplete tasks (filtered by title as you type)

Select a task → inserts `@task[title]` into the input and appends the task's title, notes, and due date as context in the message sent to the AI.

---

## Morning Digest

On the first visit each day, an overlay appears if there are any overdue or today tasks. Shows:
- Overdue tasks (up to 10, sorted by due date)
- Tasks due today (up to 10, sorted by due date)
- A Claude-generated focus suggestion (2–3 sentences, Haiku model)

Dismissed once per session (`sessionStorage`). Reappears on next login.

---

## Weekly Review

Click **Weekly Review** in the toolbar or press `w`. Opens the 3-step `WeeklyReviewModal` (`vault/client/src/components/tasks/WeeklyReviewModal.jsx`):

1. **Last week** — tasks completed in the past 7 days grouped by category. If a Personal Mission Statement is saved, a compact **North star** banner appears at the top of this step (compass icon + statement text, truncated to one line).
2. **Overdue** — incomplete overdue tasks with actions: mark done, reschedule (Today / Tomorrow / Next week), or remove due date
3. **This week** — upcoming tasks + Claude SSE focus suggestions + total effort estimate + quick-add task + Goals progress panel (active objectives with inline KR value updates) + **🌱 Renewal This Week** row — four dimension icons (🏃 📚 🤝 🌱) each showing the count of tasks completed last week with that dimension; a red dot appears on any dimension with zero completed tasks as a balance nudge

---

## Keyboard Shortcuts

Shortcuts fire when no text input is focused. Press `?` to see the in-app reference.

| Key | Action |
|---|---|
| `n` | Open New Task form |
| `w` | Open Weekly Review |
| `Esc` | Close form / Weekly Review / Import / Focus Mode / collapse expanded task / deselect all / close shortcuts |
| `/` | Focus the search input |
| `f` | Cycle quick filters: All → Today → This Week → High Priority → Overdue → All |
| `1` | Set status filter to To Do |
| `2` | Set status filter to In Progress |
| `3` | Set status filter to Done |
| `b` | Cycle view: List → Board → Calendar → Matrix |
| `m` | Switch directly to Eisenhower Matrix view |
| `Shift+F` | Open Focus Mode for the currently expanded task |
| `?` | Open keyboard shortcuts modal |

---

## API Endpoints

### Tasks

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/tasks` | Top-level tasks. Query params: `status`, `priority`, `category`, `projectId`, `tag`, `dueBefore`, `dueAfter`, `search` |
| POST | `/api/tasks` | Create task |
| PUT | `/api/tasks/reorder` | Reorder tasks — body: `{ items: [{ id, order }] }` |
| PUT | `/api/tasks/bulk` | Bulk update — body: `{ ids, updates: { status \| priority \| category } }` |
| DELETE | `/api/tasks/bulk` | Bulk delete — body: `{ ids }` |
| GET | `/api/tasks/morning-digest` | Overdue + today tasks + Claude focus suggestion |
| POST | `/api/tasks/weekly-review-suggestions` | SSE stream — Claude focus suggestions for the coming week |
| POST | `/api/tasks/import` | Bulk CSV import — body: `{ tasks: [] }` |
| POST | `/api/tasks/ai-generate` | AI task generation — body: `{ prompt, projectId?, parentTaskId? }` |
| POST | `/api/tasks/extract` | Extract tasks from a chat session — body: `{ sessionId, projectId? }` |
| GET | `/api/tasks/:id` | Single task (via catch-all in GET `/`) |
| PUT | `/api/tasks/:id` | Update task (partial — omitted fields keep their current values) |
| DELETE | `/api/tasks/:id` | Delete task and all its subtasks |
| POST | `/api/tasks/:id/duplicate` | Duplicate task with subtasks and tags |
| POST | `/api/tasks/:id/share` | Generate share token — returns `{ shareUrl, token }` |
| DELETE | `/api/tasks/:id/share` | Revoke share token |
| GET | `/api/tasks/:id/subtasks` | List subtasks |
| POST | `/api/tasks/:id/subtasks` | Add subtask — body: `{ title }` |
| GET | `/api/tasks/:id/comments` | List comments and activity events |
| POST | `/api/tasks/:id/comments` | Add comment — body: `{ content, type? }` (type defaults to `user`) |
| DELETE | `/api/tasks/comments/:commentId` | Delete a comment |
| GET | `/api/tasks/:id/dependencies` | Task dependencies — returns `{ blockers: [{id,title,status,priority}], dependents: [{...}] }` |
| POST | `/api/tasks/:id/dependencies` | Add blocker — body: `{ blockedByTaskId }`. Returns 400 if circular dependency detected. |
| DELETE | `/api/tasks/:id/dependencies/:blockedByTaskId` | Remove a blocker relationship |

### Templates

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/task-templates` | List all templates (with subtasks) |
| POST | `/api/task-templates` | Create template — body: `{ name, description?, category?, priority, recurrence, tags, subtasks[] }` |
| PUT | `/api/task-templates/:id` | Update template (replaces subtasks array) |
| DELETE | `/api/task-templates/:id` | Delete template |
| POST | `/api/task-templates/:id/apply` | Create task from template — body: `{ projectId?, category? }` |

### Public (no auth)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/shared/task/:token` | Public read-only task view — returns `{ id, title, notes, priority, status, dueDate, category, estimatedMinutes, timeSpentMinutes, tags, subtasks }` |

---

## Database

### `tasks`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `title` | TEXT | Required |
| `notes` | TEXT | |
| `status` | TEXT | `todo` / `in-progress` / `done` |
| `priority` | TEXT | `high` / `medium` / `low` |
| `category` | TEXT | |
| `projectId` | INTEGER FK | → `projects.id` |
| `parentTaskId` | INTEGER FK | → `tasks.id` (self-referential — subtasks) |
| `dueDate` | TEXT | ISO date `YYYY-MM-DD` or datetime `YYYY-MM-DDTHH:MM` |
| `"order"` | INTEGER | Drag-to-reorder position within category group |
| `recurrence` | TEXT | `none` / `daily` / `weekly` / `fortnightly` / `monthly` / `annually` |
| `recurrenceConfig` | TEXT | JSON blob — currently reserved; intended for enhanced recurrence patterns (e.g. specific days of the week, Nth day of month) beyond the simple interval-based recurrence currently implemented |
| `recurrenceCount` | INTEGER | Incremented each time a recurring task spawns a new copy |
| `shareToken` | TEXT UNIQUE | 16-byte hex; NULL if not shared |
| `estimatedMinutes` | INTEGER | Effort estimate in minutes |
| `timeSpentMinutes` | INTEGER | Accumulated focus/timer time in minutes. Default 0. Added via migration. |
| `isUrgent` | INTEGER | 1 = urgent, 0 = not urgent. Drives Eisenhower Matrix Q1/Q3. Added via migration. |
| `renewalDimension` | TEXT | `physical` / `mental` / `social` / `spiritual` / NULL. Habit 7 categorisation. Added via migration. |
| `keyResultId` | INTEGER FK | → `key_results.id` ON DELETE SET NULL |
| `sourceSessionId` | TEXT | Session ID of the chat this task was extracted from |
| `createdAt` | TEXT | `datetime('now')` |
| `updatedAt` | TEXT | Updated on every PUT |

Index: `CREATE UNIQUE INDEX idx_tasks_shareToken ON tasks(shareToken) WHERE shareToken IS NOT NULL`

### `task_tags`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `taskId` | INTEGER FK | → `tasks.id` |
| `tag` | TEXT | Single tag value |

### `task_comments`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `taskId` | INTEGER FK | → `tasks.id` |
| `type` | TEXT | `user` (manual) or `system` (auto-logged activity) |
| `content` | TEXT | Comment text or activity description |
| `createdAt` | TEXT | `datetime('now')` |

### `task_templates`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT | Required |
| `description` | TEXT | |
| `category` | TEXT | |
| `priority` | TEXT | `high` / `medium` / `low` |
| `recurrence` | TEXT | |
| `tags` | TEXT | Comma-separated tag string |
| `createdAt` | TEXT | |
| `updatedAt` | TEXT | |

### `task_dependencies`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `taskId` | INTEGER FK | → `tasks.id` ON DELETE CASCADE — the task that is blocked |
| `blockedByTaskId` | INTEGER FK | → `tasks.id` ON DELETE CASCADE — the task doing the blocking |
| `createdAt` | TEXT | `datetime('now')` |

Unique constraint on `(taskId, blockedByTaskId)` — no duplicate edges.

### `template_subtasks`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `templateId` | INTEGER FK | → `task_templates.id` |
| `title` | TEXT | |
| `"order"` | INTEGER | Display order |
