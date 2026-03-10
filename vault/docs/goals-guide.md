# Vault — Goals & 7 Habits: User Guide

## Overview

The Goals feature (`/goals`) is an OKR-style goal-setting system built around Stephen Covey's *7 Habits of Highly Effective People*. It has three layers:

1. **Personal Mission Statement** — your "why" (Habit 2: Begin with the End in Mind)
2. **Renewal Balance dashboard** — tracking your four life dimensions (Habit 7: Sharpen the Saw)
3. **Objectives & Key Results** — turning goals into measurable progress, linked to Tasks

---

## Section 1 — Personal Mission Statement

The top card on the Goals page is your **Personal Mission Statement** — a single statement that captures who you want to be and what you want to do in your life.

### Writing with Claude (recommended)
Click **"Write with Claude"** to open the 4-step wizard. Answer each question in turn:

1. What are your most important roles? (parent, professional, community member…)
2. What character traits matter most to you?
3. What do you want to achieve or contribute in your lifetime?
4. What principles or values guide your decisions?

Each answer unlocks the Next button. After step 4, click **Generate** — Claude streams a mission statement live. Once done, you can:
- **Use this statement** — saves it immediately
- **Regenerate** — generates a new version from the same answers
- **← Edit answers** — go back and refine your responses

Your answers are saved to `localStorage` so if you come back to rewrite, your previous answers are pre-filled.

### Writing manually
Click **"Add manually"** to type your own statement directly. Save with the Save button.

### Editing an existing statement
Hover over the statement — two icon buttons appear:
- **Pencil** — edit the text directly
- **Sparkles** — rewrite with Claude (pre-fills your saved wizard answers)

---

## Section 2 — Renewal Balance Dashboard (Habit 7)

Collapsible section below the mission statement. Tracks how your tasks and objectives are distributed across **four renewal dimensions**:

| Icon | Dimension | Colour |
|------|-----------|--------|
| 🏃 | Physical | Blue |
| 📚 | Mental | Green |
| 🤝 | Social | Amber |
| 🌱 | Spiritual | Purple |

### What it shows

**4 dimension cards** — each card shows:
- How many active tasks are tagged with that dimension
- How many active objectives are linked to it
- A progress mini-bar showing the average progress of those objectives

**Balance bar** — a proportional colour bar showing how your effort is distributed across the four dimensions at a glance.

**Imbalance nudge** — if one dimension accounts for more than 50% of all tagged items, you'll see a tip like: *"📚 Mental is dominant (62%). Consider adding tasks or goals in other dimensions."*

**AI Assessment** — click the **AI Assessment** button to get a personalised written analysis from Claude. It reads your current distribution and streams back specific advice on where to invest more energy.

### How to tag items

**Tasks** — open any task form. There's a "Renewal Dimension" selector with the four coloured buttons. Pick one to tag the task. Tagged tasks appear with a coloured dimension emoji pill in the list and board views. You can filter by dimension using the chip row in Task Filters.

**Objectives** — when creating a new objective, the form includes a "Renewal Dimension (Habit 7)" row. You can also change it later in the objective's detail panel. A coloured badge appears on the objective in the list.

### Deep links

The 7 Habits sidebar section (collapsible, bottom of the left sidebar) has a direct link: **🌱 Renewal** → navigates to `/goals?section=renewal`, which automatically expands the section and scrolls + briefly highlights it.

---

## Section 3 — Objectives & Key Results

The main body of the Goals page is a two-panel layout:
- **Left panel** — list of all objectives
- **Right panel** — detail view for the selected objective

### Creating an Objective

Click **"+ New Objective"** in the toolbar. The modal has:
- **Title** (required) — e.g. "Launch new product line"
- **Description** — what does success look like?
- **Timeframe** — free text, e.g. "Q2 2026" or "End of year"
- **Color** — 6 preset accent colours used for progress bars and badges
- **Renewal Dimension** — optional Habit 7 tag (see above)

### The Objective List

Each objective in the left panel shows:
- Coloured accent dot
- Title and timeframe
- Overall progress bar (average of all its Key Results)
- Renewal dimension badge (if set)
- Status badge (active / completed / paused)

Click any objective to open its detail in the right panel.

### Objective Detail Panel

The right panel shows full details for the selected objective. All fields are **inline editable** — click any value to edit it in place:
- Title, description, timeframe
- Status (active / completed / paused) via a dropdown
- Renewal dimension via the 4-button selector

At the top is the **overall progress bar** showing the average completion across all Key Results.

**Deleting an objective** — there's a delete button in the detail panel header with a confirm step ("Delete? / No").

### Key Results

Key Results are the measurable outcomes that define whether you've achieved an objective. Each KR has:
- **Title** — click to edit inline
- **Target value + unit** — e.g. `100 %`, `500 leads`, `12 articles`
- **Current value** — click the number to update progress. Enter the new value and press Enter or click away.
- **Progress bar** — colour-coded: green ≥70%, amber 30–69%, red <30%
- **Due date** — shown as "Due Mar 15" if set
- **Linked tasks count** — "3/7 tasks" shows how many linked tasks are done vs total

**Adding a Key Result manually** — click **"+ Add Key Result"** at the bottom of the detail panel. Fill in: title, target value, unit, and optional due date.

**AI Suggest Key Results** — click **"AI Suggest"** to open the suggestion panel. Click **Generate** — Claude streams SMART Key Result suggestions tailored to your objective's title, description, and timeframe. Each suggestion shows the title and target. Click **Add** to instantly create it as a KR. You can add as many as you like; already-added ones show "Added".

---

## Section 4 — Connecting Goals to Tasks

### Linking a task to a Key Result

In the task create/edit form, look for **"Link to Goal"**. This is a two-step dropdown:
1. Select an **Objective** from the list
2. Select a **Key Result** within that objective

The task's `keyResultId` is saved. The Key Result row then shows the completed/total task count, and task progress flows into KR progress automatically.

### Eisenhower Matrix (Habit 3: First Things First)

The Tasks page has a **Matrix view** accessible via:
- The `m` keyboard shortcut
- The view selector toolbar button
- The URL param `?view=matrix`
- The 7 Habits sidebar: **⚡ Matrix** link

The 2×2 grid plots tasks by:
- **Urgent** (Y-axis) — set via the ⚡ toggle in the task form or QuickCapture
- **Important** (X-axis) — determined by priority

Each quadrant:

| | **Important** | **Not Important** |
|---|---|---|
| **Urgent** | Do First (Q1) | Delegate (Q3) |
| **Not Urgent** | Schedule (Q2) | Eliminate (Q4) |

The insight line at the top of the matrix can show a renewal dimension prefix when tasks are tagged.

---

## Section 5 — 7 Habits Sidebar

At the bottom of the left sidebar is a collapsible **7 Habits** section (state persisted in localStorage). It has three quick-links:

- **🧭 Mission** → `/goals?section=mission` — scrolls to and highlights the Mission Statement
- **⚡ Matrix** → `/tasks?view=matrix` — opens Tasks in Eisenhower Matrix view
- **🌱 Renewal** → `/goals?section=renewal` — scrolls to and highlights the Renewal Balance dashboard

---

## Section 6 — Goals Widget (Dashboard)

On the main projects/home page, a **Goals Widget** appears automatically once you have at least one active objective. It shows:
- Number of active objectives
- Average progress across them
- Top 3 objectives with their progress bars

Click any objective in the widget to navigate directly to the Goals page.

---

## Section 7 — Weekly Review Integration

The **Weekly Review** modal (Tasks page → `w` shortcut or "Weekly Review" button) has a dedicated **Renewal this week** row in Step 3 (Planning). It shows the four dimension icons with a count of tasks completed this week in each dimension. Any dimension with zero completed tasks gets a red dot — a nudge to schedule something in that area before the week begins.

---

## Quick Reference

| Action | Where |
|---|---|
| Write/edit mission statement | Goals page → top card |
| See renewal balance | Goals page → Renewal Balance section |
| Tag a task by dimension | Task form → Renewal Dimension buttons |
| Tag an objective by dimension | New Objective modal or detail panel |
| Link a task to a KR | Task form → Link to Goal dropdown |
| AI-generate Key Results | Objective detail → AI Suggest |
| Get AI renewal assessment | Goals page → Renewal Balance → AI Assessment |
| Eisenhower Matrix | Tasks → `m` key or view selector |
| Weekly renewal check | Tasks → `w` → Step 3 |
