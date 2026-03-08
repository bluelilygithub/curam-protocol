# Tasks — Feature Documentation

## Overview

A full personal task manager built into Curam Vault. Accessible via the sidebar icon or directly at `/tasks`. Three views — List, Board, and Calendar — share the same data and filters.

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
| **Key Result** | Link to a Goal Key Result (`keyResultId`) |

**Computed fields returned by the API (not stored):**
- `tags` — array from `task_tags`
- `subtaskCount`, `subtaskDone` — count of child tasks and how many are done
- `keyResultTitle`, `objectiveTitle` — joined from `key_results` + `objectives`

---

## Task Form

Open with **+ New Task** (top right) or `n`. Edit by clicking the pencil icon on any task row.

**Effort estimate input** accepts free text:
- `15m`, `30m`, `1h`, `2h`, `4h`, `1d`, `2d` — quick-select presets
- `45m` → 45 minutes; `3h` → 180 minutes; `1.5h` → 90 minutes; `2d` → 960 minutes
- Plain integer is treated as minutes

**Link to Goal** — two-step dropdown (only visible if Objectives exist):
1. Select an Objective
2. A second dropdown appears to select a Key Result from that Objective
3. Clear the link by selecting "None" in either dropdown

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
- **Notes tooltip** — hover the row to see a preview of the notes field (up to 300 characters)

**Actions on hover:**
- Circle button — toggle done/undone
- Share icon — generate public link (see [Task Sharing](#task-sharing))
- Copy icon — duplicate task
- Pencil icon — edit
- Trash icon — delete (confirm inline)

### Board view (Kanban)

Three fixed columns: **To Do** / **In Progress** / **Done**.

Drag cards **within** a column to reorder. Drag cards **across** columns to change status.

**Each card shows:** title, priority badge, due date, subtask count, effort pill, stale indicator, share button (on hover). Toggle done and edit buttons in top-right.

### Calendar view

Rendered by `TasksCalendar` component. Day, week, month, and range sub-views. Drag tasks to reschedule.

View persists in `localStorage` under the key `tasksViewMode`.

---

## Stats Bar

Shown below the toolbar when tasks exist. Five stat cards:

| Card | Value | Clickable |
|---|---|---|
| **Total Active** | Count of incomplete tasks | No |
| **Done This Week** | Tasks marked done within the current Mon–Sun week | Yes — toggles 14-day completion bar chart |
| **Overdue** | Incomplete tasks with a past due date | Yes — applies Overdue quick filter |
| **High Priority** | Incomplete high-priority tasks | Yes — applies High Priority quick filter |
| **Total Effort** | Sum of `estimatedMinutes` for incomplete tasks in the current filter | No |

**14-day completion chart** — bar chart below the stats row; bars show completed task count per day; today's bar is highlighted in the primary colour.

---

## Filters & Sort

### Quick filter chips
`All` · `Today` · `This Week` · `High Priority` · `Overdue`

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

**Accepted CSV columns:** `title` (required), `notes`, `status`, `priority`, `category`, `projectId`, `dueDate`, `estimatedMinutes`, `tags` (comma-separated within the cell).

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

Click **Weekly Review** in the toolbar or press `w`. Opens the 3-step `WeeklyReview` modal:

1. **Last week** — tasks completed in the past 7 days grouped by category
2. **Overdue** — incomplete overdue tasks with actions: mark done, reschedule (Today / Tomorrow / Next week), or remove due date
3. **This week** — upcoming tasks + Claude SSE focus suggestions + total effort estimate + quick-add task + Goals progress panel (active objectives with inline KR value updates)

---

## Keyboard Shortcuts

Shortcuts fire when no text input is focused. Press `?` to see the in-app reference.

| Key | Action |
|---|---|
| `n` | Open New Task form |
| `w` | Open Weekly Review |
| `Esc` | Close form / Weekly Review / Import / collapse expanded task / deselect all / close shortcuts |
| `/` | Focus the search input |
| `f` | Cycle quick filters: All → Today → This Week → High Priority → Overdue → All |
| `1` | Set status filter to To Do |
| `2` | Set status filter to In Progress |
| `3` | Set status filter to Done |
| `b` | Cycle view: List → Board → Calendar |
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
| GET | `/api/shared/task/:token` | Public read-only task view — returns `{ id, title, notes, priority, status, dueDate, category, estimatedMinutes, tags, subtasks }` |

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

### `template_subtasks`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `templateId` | INTEGER FK | → `task_templates.id` |
| `title` | TEXT | |
| `"order"` | INTEGER | Display order |
