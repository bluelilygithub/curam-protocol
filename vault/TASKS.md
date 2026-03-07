# Tasks — Feature Documentation

## Overview

A full task management system built into Curam Vault. Accessible via the checklist icon in the top nav bar or directly at `/tasks`.

---

## Pages & Entry Points

| Location | What it does |
|---|---|
| `/tasks` | Full task management page |
| Top nav bar | Checklist icon — always visible |
| Home page (Projects) | Tasks widget showing your top 5 upcoming tasks |

---

## Task Fields

| Field | Notes |
|---|---|
| **Title** | Required |
| **Notes** | Free-text description |
| **Priority** | High / Medium / Low — shown as a coloured left border and priority badge |
| **Status** | To Do / In Progress / Done |
| **Due date & time** | Date picker + time picker. Shown as "Overdue 14:30", "Due today 09:00", "Mar 12 14:00", etc. |
| **Recurrence** | None / Daily / Weekly / Fortnightly / Monthly — only available when a due date is set |
| **Category** | Free text — groups tasks together; autocompletes from existing categories |
| **Tags** | Comma-separated; shown as `#tag` pills when you expand a task |
| **Project** | Link to one of your Vault projects |
| **Parent task** | Makes this task a subtask of another task |
| **Order** | Integer used for drag-to-reorder position within a category group |

---

## Creating Tasks

### Manually
Click **+ New Task** in the top right (or press `n`). The form opens with today's date and current time pre-filled. Fill in the details and click **Create task** (or press Enter in the title field).

### With AI
Click **Ask Claude** in the top bar. Type a plain-language description of what you need to accomplish, optionally link it to a project, then click **Generate Tasks**. Claude will create a structured task list with subtasks automatically.

Examples:
- `Prepare for the client pitch on Friday`
- `Everything I need to launch the new website`
- `Plan a marketing campaign for the product launch`

---

## Stats Bar

Displayed below the page heading whenever tasks exist. Four cards show at a glance:

| Card | What it shows |
|---|---|
| **Total Active** | Count of all incomplete tasks |
| **Done This Week** | Tasks marked done within the current Mon–Sun week |
| **Overdue** | Incomplete tasks whose due date is in the past — click to filter |
| **High Priority** | Incomplete high-priority tasks — click to filter |

The same summary appears as a single line in the dashboard widget: `X done this week · Y overdue`.

---

## Task List

### Priority indicators
Each task shows priority in two ways:
- A coloured **left border** (red / amber / green)
- A coloured **priority badge** (High / Medium / Low) next to the task title

### Status toggle (strikethrough)
Each task row has a circle icon in the actions area on the right. Click it to mark the task done — the title gets a strikethrough and the task moves to the **Completed** section at the bottom (which auto-expands). Click the icon again (now a green tick) to revert the task back to To Do.

### Expand a task
Click the task title to expand it. This shows:
- Notes
- Tags
- A **View source chat** link (if the task was extracted from a chat session)
- Subtasks with individual done/undone toggles
- An inline input to add subtasks manually
- A **Generate subtasks** button to let Claude generate subtasks from a prompt

### AI subtask generation
In the expanded task view, click **Generate subtasks**. An input appears pre-filled with the task title — edit it if needed, then press Enter or click **Generate**. Claude creates subtasks under the current task automatically.

### Subtask progress
Tasks with subtasks show a `done/total` count badge (e.g. `2/5`).

### Completed tasks
Done tasks are collected in a collapsible **Completed** section at the bottom of the list. This section auto-expands when you mark a task done so you can see the result immediately.

---

## Sorting

Use the **Sort** dropdown at the right of the filter bar to change the order of the task list:

| Option | Order |
|---|---|
| **Due Date** (default) | Earliest first; no due date last |
| **Priority** | High → Medium → Low |
| **Created Date** | Newest first |
| **A–Z** | Alphabetical ascending |
| **Z–A** | Alphabetical descending |

Sorting is applied within each category group. The selected sort persists during the session.

---

## Drag to Reorder

Hover over any incomplete task to reveal a grip handle on the left. Drag the task to reorder it within its category group. The new order is saved immediately to the server. Reordering only works within the same category group.

---

## Recurring Tasks

When a task has a due date, you can set a recurrence in the task form:
- **None** — no recurrence (default)
- **Daily** — repeats every day
- **Weekly** — repeats every 7 days
- **Fortnightly** — repeats every 14 days
- **Monthly** — repeats on the same date each month

When a recurring task is marked as done, a new copy is automatically created with the next due date. The original task remains in Completed as a record. Tags are copied to the new task. A recurrence badge (↻ weekly) is shown next to the due date.

---

## Bulk Actions

Hover over any task to reveal a checkbox on the left. Once one or more tasks are checked, the checkboxes stay visible across the whole list. The bulk action toolbar appears above the task list as soon as anything is selected.

Available bulk actions:
- **Mark Done** — set all selected tasks to done
- **In Progress** — set all selected tasks to in-progress
- **To Do** — set all selected tasks back to to-do
- **Priority dropdown** — change priority of all selected tasks
- **Set category** — type a category name and press Enter to reassign all selected tasks
- **Delete** — delete all selected tasks (requires confirmation)
- **Clear** — deselect all

---

## Filters

| Filter | What it does |
|---|---|
| **All** | Show all tasks |
| **Today** | Tasks due today only |
| **This Week** | Tasks due within the next 7 days |
| **High Priority** | High priority tasks only |
| **Overdue** | Incomplete tasks with a past due date |
| **Category dropdown** | Filter to one category |
| **Project dropdown** | Filter to tasks linked to one project |
| **Status dropdown** | To Do / In Progress / Done / All |
| **Search** | Searches title and notes |

Default view shows all tasks. Use the status dropdown to narrow the view.

---

## Keyboard Shortcuts

Press `?` or click the **?** button in the top right to open the shortcuts reference. Shortcuts only fire when no text input is focused.

| Key | Action |
|---|---|
| `n` | Open New Task form |
| `Esc` | Close form / collapse expanded task / deselect all |
| `/` | Focus the search input |
| `f` | Cycle quick filters: All → Today → This Week → High Priority → Overdue → All |
| `1` | Set status filter to To Do |
| `2` | Set status filter to In Progress |
| `3` | Set status filter to Done |
| `?` | Open keyboard shortcuts modal |

---

## Due Today Banner

When you load the app, if you have any tasks due today a dismissible amber banner appears below the top nav bar on every page. It shows the count and includes a **View Tasks** link that takes you directly to the Today filter. The banner is dismissed for the rest of the browser session (uses `sessionStorage`) — it reappears on next login.

---

## Extract Tasks from Chat

In any chat session, click **Export → Extract Tasks**. Claude reads the last 20 messages and extracts all action items and next steps as tasks. A toast notification appears bottom-right with the count and a **View Tasks** link.

Extracted tasks remember which chat session they came from. Open any extracted task and you'll see a **View source chat** link in the expanded view — click it to jump directly back to that conversation.

---

## Dashboard Widget (Home Page)

The Tasks widget on the Projects home page shows:
- A summary line: `X done this week · Y overdue`
- Your top 5 incomplete tasks (sorted by due date, then priority)
- Due date labels (Overdue / Today / date)
- A circle button on each row — click to mark done instantly; list refreshes automatically
- Newly AI-generated tasks highlight briefly (2 seconds) so you can see what was added
- A quick-add input — type a title and press Enter to create a task instantly
- An **Ask Claude** button for AI task generation; list refreshes from server after generating

---

## Editing & Deleting

- Click the **pencil icon** on any task to open the edit form
- Click the **trash icon** to delete — a confirm button appears inline before deleting
- Deleting a task also deletes all its subtasks

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/tasks` | List top-level tasks (supports query filters: status, priority, category, projectId, dueBefore, dueAfter, search, tag) |
| POST | `/api/tasks` | Create a task |
| PUT | `/api/tasks/reorder` | Reorder tasks — body: `{ items: [{ id, order }] }` |
| PUT | `/api/tasks/bulk` | Bulk update — body: `{ ids, updates: { status/priority/category } }` |
| DELETE | `/api/tasks/bulk` | Bulk delete — body: `{ ids }` |
| PUT | `/api/tasks/:id` | Update a task (partial updates supported; triggers recurrence on done) |
| DELETE | `/api/tasks/:id` | Delete a task and its subtasks |
| GET | `/api/tasks/:id/subtasks` | List subtasks |
| POST | `/api/tasks/:id/subtasks` | Add a subtask manually |
| POST | `/api/tasks/ai-generate` | Generate tasks from a prompt — optional `parentTaskId` creates subtasks |
| POST | `/api/tasks/extract` | Extract tasks from a chat session — saves `sourceSessionId` back-link |

---

## Database

Two tables:

**`tasks`**
- `id`, `title`, `notes`, `status`, `priority`, `category`, `projectId`, `parentTaskId`, `dueDate`, `order`, `recurrence`, `sourceSessionId`, `createdAt`, `updatedAt`

**`task_tags`**
- `id`, `taskId`, `tag`

Subtasks are stored as tasks with a `parentTaskId`. Tags are in `task_tags`. `order` stores drag position. `recurrence` stores repeat schedule (none/daily/weekly/fortnightly/monthly). `sourceSessionId` links back to the chat session a task was extracted from.
