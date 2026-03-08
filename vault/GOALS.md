# Goals — Feature Documentation

## Overview

An OKR-lite goal tracking system built into Curam Vault. Accessible via the target icon in the sidebar or directly at `/goals`. Structured as a two-tier hierarchy: **Objectives** contain **Key Results**, and tasks can be linked to a Key Result to track execution progress.

---

## Pages & Entry Points

| Location | What it does |
|---|---|
| `/goals` | Full Goals management page |
| Sidebar | Target icon — always visible on desktop |
| Home page (Projects) | Goals widget showing active objective count, average progress, and top 3 progress bars |
| Weekly Review Step 3 | Active objectives with inline KR current-value update inputs |

There is no keyboard shortcut to open Goals. Navigate via the sidebar target icon or the Goals widget on the home page.

---

## Objective Fields

| Field | Notes |
|---|---|
| **Title** | Required |
| **Description** | Free-text — "what does success look like?" |
| **Timeframe** | Free text — e.g. `Q2 2026`, `H1 2026`, `2026` |
| **Status** | Active / Completed / Paused |
| **Color** | One of 6 preset swatches (indigo, pink, amber, green, blue, red) |

---

## Key Result Fields

| Field | Notes |
|---|---|
| **Title** | Required — describes the measurable outcome |
| **Target value** | Numeric — the number you're aiming for (default: 100) |
| **Current value** | Numeric — where you are now (default: 0) |
| **Unit** | Label for the number — `%`, `tasks`, `calls`, `$`, `items`, etc. |
| **Due date** | Optional — shown in the KR row |
| **Status** | Active / Completed / Paused |

Computed fields returned by the API (not stored):
- **progress** — `min(100, round(currentValue / targetValue × 100))`
- **linkedTaskCount** — tasks with `keyResultId = this KR`
- **completedTaskCount** — linked tasks with `status = 'done'`

---

## Creating Objectives

Click **New** in the top-left panel header. A modal opens with:
- **Title** (required)
- **Description**
- **Timeframe** — free text input
- **Color** — row of 6 colour swatches; click to select

Press **Create Objective** or Enter. The new objective is immediately selected in the detail panel.

---

## Creating Key Results

With an objective selected in the right panel, click **+ Add KR**. A form appears inline:
- **Title** — what you're measuring
- **Target** — numeric goal
- **Unit** — label for the number
- **Due date** — optional

Click **Add** to save.

---

## AI Suggest Key Results

With an objective selected, click **AI Suggest** in the Key Results header. A panel expands below the header:

1. Click **Generate** — Claude Haiku streams 3–5 SMART Key Result suggestions based on the objective's title, description, and timeframe
2. Suggestions appear as cards with title, target value, and unit
3. Click **Add** on any suggestion to create it as a KR instantly
4. Already-added suggestions show "Added" and cannot be re-added

The model (Haiku) streams JSON objects one per line; suggestions appear progressively as they arrive.

---

## Inline Editing

All fields on a selected objective are editable in place — no separate edit form:

| Field | How to edit |
|---|---|
| Title | Click the title text → type → blur or Enter to save |
| Description | Click the description text → textarea appears → blur to save |
| Timeframe | Click the timeframe chip → input appears → blur or Enter to save |
| Status | Select from the inline dropdown |
| Color | Click any swatch — saves immediately |

Key Result editing:
- **Title**: click the KR title text → input → blur or Enter to save
- **Current value**: click the value button (e.g. `42 %`) → number input → blur or Enter to save

---

## Progress & Color Coding

Progress is calculated automatically:
- **KR progress** = `min(100, round(currentValue / targetValue × 100))`
- **Objective overall progress** = average of all KR progress values (0 if no KRs)

Progress bar and % badge colours:
| Range | Color |
|---|---|
| ≥ 70% | Green |
| 30–69% | Amber |
| < 30% | Red |

---

## Linking Tasks to Goals

Any task can be linked to a Key Result via the task form:

1. Open the task form (new or edit)
2. Scroll to **Link to Goal** — select an Objective from the dropdown
3. A second dropdown appears — select a Key Result
4. The badge `🎯 KR title` appears on the task card after saving

If a KR is deleted, linked tasks have their `keyResultId` set to `NULL` — they are not deleted. The same applies when an Objective is deleted.

The KR row in GoalsPage shows a `X/Y tasks` badge when tasks are linked.

---

## Deleting

**Delete an objective**: scroll to the bottom of the detail panel → click **Delete objective…** → confirm. Deletes the objective, all its Key Results, and sets `keyResultId = NULL` on any linked tasks.

**Delete a Key Result**: click the trash icon on the KR row → confirm inline. Sets `keyResultId = NULL` on any linked tasks.

---

## Goals Widget (Home Page)

Shown automatically on the Projects home page when at least one **active** objective exists. Fetches `GET /api/goals/dashboard` and displays:

- **Active goals** count and **Average progress** %
- Top 3 objectives by progress — each shown as a mini progress bar with title and %
- **View all goals →** link to `/goals`

The widget does not render at all when `activeCount === 0` — if all your objectives are **Completed** or **Paused** (none Active), the widget is hidden on the home page. To see goal progress for completed objectives, navigate directly to `/goals`. Mark an objective Active to make it reappear in the widget.

---

## Goals in Weekly Review

In the Weekly Review modal (Step 3), a Goals section appears below the Claude suggestions panel showing all **active** objectives. For each:

- Objective title, color dot, and overall progress bar
- Each KR listed with its progress bar and an inline input for the current value
- Click any current value → type the new value → press Enter or click away to save

This provides a lightweight end-of-week cadence for updating goal metrics without navigating away from the review.

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/goals` | List all objectives with nested Key Results and computed progress |
| POST | `/api/goals` | Create objective — body: `{ title, description, timeframe, color }` |
| GET | `/api/goals/dashboard` | Summary for home widget — `{ activeCount, avgProgress, topObjectives, completedThisMonth }` |
| POST | `/api/goals/ai-suggest` | SSE stream — body: `{ title, description, timeframe }` — streams KR suggestions as JSON lines |
| GET | `/api/goals/:id` | Single objective with nested KRs |
| PUT | `/api/goals/:id` | Update objective fields (partial updates supported) |
| DELETE | `/api/goals/:id` | Delete objective, its KRs, and unlink tasks |
| POST | `/api/goals/:id/key-results` | Add a KR — body: `{ title, targetValue, currentValue, unit, dueDate }` |
| PUT | `/api/goals/key-results/:krId` | Update KR fields (partial updates supported) |
| DELETE | `/api/goals/key-results/:krId` | Delete KR and unlink tasks |

**Route ordering note:** `/dashboard`, `/ai-suggest`, and `/key-results/:krId` are registered before `/:id` in the Express router to prevent the parameterised route from matching them.

---

## Database

**`objectives`**
- `id`, `title`, `description`, `timeframe`, `status` (active/completed/paused), `color`, `createdAt`, `updatedAt`

**`key_results`**
- `id`, `objectiveId` (FK → objectives, CASCADE DELETE), `title`, `targetValue`, `currentValue`, `unit`, `status`, `dueDate`, `createdAt`, `updatedAt`

**`tasks.keyResultId`**
- FK → `key_results(id)` ON DELETE SET NULL — tasks survive KR deletion, just become unlinked
