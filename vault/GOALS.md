# Goals — Feature Documentation

## Overview

An OKR-lite goal tracking system built into Curam Vault. Accessible via the target icon in the sidebar or directly at `/goals`. Structured as a two-tier hierarchy: **Objectives** contain **Key Results**, and tasks can be linked to a Key Result to track execution progress.

At the very top of the Goals page sits the **Personal Mission Statement** — a full-width card that provides the north star context for all your objectives.

---

## Personal Mission Statement

Inspired by Habit 2 (Begin with the End in Mind) from the 7 Habits framework. Stored in the `settings` table under the key `mission_statement`.

### Three card states

| State | Shown when |
|---|---|
| **Empty** | No statement saved — compass icon, title, subtitle, two action buttons |
| **Display** | Statement exists — rendered as an italic blockquote with a left primary-colour border; Edit and Rewrite buttons appear on hover |
| **Edit** | Triggered by "Add manually" or the pencil icon — pre-filled textarea with Save / Cancel |

### Write with Claude wizard

Click **Write with Claude** (empty state) or the sparkle icon (display state hover) to open an inline collapsible panel below the card. The panel steps through 4 questions:

1. **Roles** — "What are your most important roles in life? (e.g. parent, professional, community member)"
2. **Character** — "What do you want to be known for — what character traits matter most to you?"
3. **Contributions** — "What do you want to achieve or contribute in your lifetime?"
4. **Principles** — "What principles or values guide your decisions?"

Navigate with **Next** / **Back**. On step 4, the button becomes **Generate**, which calls `POST /api/goals/mission/generate` and streams the result via SSE. The generated statement appears live in a styled result panel. Once complete:

- **Use this statement** — saves via `PUT /api/goals/mission` and closes the wizard
- **Regenerate** — reruns with the same answers
- **← Edit answers** — returns to wizard step 1 for editing

Wizard answers are saved to `localStorage` under `missionWizardAnswers` when Generate is clicked. When reopening the wizard via "Rewrite with Claude", previous answers are pre-populated.

### Weekly Review banner

When the Weekly Review modal opens, `GET /api/goals/mission` is fetched. If a statement exists, a compact banner appears at the top of Step 1:

> 🧭 **North star:** *[statement text truncated to one line, full text on hover]*

If no statement exists, the banner is omitted.

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/goals/mission` | Returns `{ statement: string \| null }` |
| PUT | `/api/goals/mission` | Body: `{ statement }` — upserts into `settings` table; returns `{ statement }` |
| POST | `/api/goals/mission/generate` | SSE stream — body: `{ answers: [q1, q2, q3, q4] }` — streams mission statement tokens via Claude Haiku |

All three endpoints are registered **before** the `/:id` parameterised routes to avoid routing conflicts.

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
| **Renewal Dimension** | `physical` / `mental` / `social` / `spiritual` / none — Habit 7 categorisation; shown as emoji badge in the objective list and in the Renewal Balance dashboard |

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

## Renewal Balance Dashboard

Inspired by Habit 7 (Sharpen the Saw). A collapsible section on GoalsPage below the Mission Statement card, above the objectives panel. Collapsed by default; state persisted in `localStorage` under `goalsRenewalOpen`.

### Layout
- **4 dimension cards** (🏃 Physical · 📚 Mental · 🤝 Social · 🌱 Spiritual): each shows active task count, active objective count, and an average progress bar (when objectives exist)
- **Balance bar**: horizontal segmented bar showing the proportion of dimension-tagged items across all 4 dimensions
- **Nudge message**: if a single dimension accounts for >50% of tagged items, a hint appears suggesting balance
- **AI Assessment button**: triggers `POST /api/goals/renewal-assessment` (SSE) — Claude Haiku streams a 2-3 sentence warm assessment with a concrete action suggestion

### Navigation
- Accessible via the 7 Habits sidebar section: **🌱 Renewal Balance** → `/goals?section=renewal`
- GoalsPage reads the `?section=renewal` query param on mount and scrolls + briefly highlights the section

---

## 7 Habits Navigation (Sidebar)

A collapsible **7 Habits** section in `ProjectSidebar.jsx`, positioned between the project list and the bottom nav (Chat History / Settings). Collapsed by default; state persisted in `localStorage` under `sidebarHabitsOpen`.

Three navigation links:
| Link | Destination |
|---|---|
| 🧭 Mission Statement | `/goals?section=mission` — scrolls to & highlights MissionStatementCard |
| ⚡ Priority Matrix | `/tasks?view=matrix` — opens Tasks page in Matrix view |
| 🌱 Renewal Balance | `/goals?section=renewal` — scrolls to & highlights Renewal Balance section |

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/goals` | List all objectives with nested Key Results and computed progress |
| POST | `/api/goals` | Create objective — body: `{ title, description, timeframe, color, renewalDimension }` |
| GET | `/api/goals/dashboard` | Summary for home widget — `{ activeCount, avgProgress, topObjectives, completedThisMonth }` |
| POST | `/api/goals/ai-suggest` | SSE stream — body: `{ title, description, timeframe }` — streams KR suggestions as JSON lines |
| POST | `/api/goals/renewal-assessment` | SSE stream — body: `{ dimensions: { physical, mental, social, spiritual } }` — streams renewal balance assessment via Claude Haiku |
| GET | `/api/goals/:id` | Single objective with nested KRs |
| PUT | `/api/goals/:id` | Update objective fields (partial updates supported) incl. `renewalDimension` |
| DELETE | `/api/goals/:id` | Delete objective, its KRs, and unlink tasks |
| POST | `/api/goals/:id/key-results` | Add a KR — body: `{ title, targetValue, currentValue, unit, dueDate }` |
| PUT | `/api/goals/key-results/:krId` | Update KR fields (partial updates supported) |
| DELETE | `/api/goals/key-results/:krId` | Delete KR and unlink tasks |

**Route ordering note:** `/dashboard`, `/ai-suggest`, `/renewal-assessment`, `/key-results/:krId`, `/mission`, `/mission/generate` are all registered before `/:id` in the Express router to prevent the parameterised route from matching them.

---

## Database

**`objectives`**
- `id`, `title`, `description`, `timeframe`, `status` (active/completed/paused), `color`, `renewalDimension` (TEXT NULL), `createdAt`, `updatedAt`

**`key_results`**
- `id`, `objectiveId` (FK → objectives, CASCADE DELETE), `title`, `targetValue`, `currentValue`, `unit`, `status`, `dueDate`, `createdAt`, `updatedAt`

**`tasks.keyResultId`**
- FK → `key_results(id)` ON DELETE SET NULL — tasks survive KR deletion, just become unlinked
