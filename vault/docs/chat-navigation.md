# Chat navigation & session UX

How users start chats, resume recent work, and navigate projects vs quick (project-free) conversations.

Implementation: `client/src/pages/ProjectList.jsx` (home), `ProjectSidebar.jsx`, `ChatPage.jsx`, `client/src/utils/chatNavigation.js`, `client/src/utils/sessionDisplay.js`, `server/routes/chat.js`.

---

## Mental model

| Concept | Route | Purpose |
|---|---|---|
| **Home / Continue** | `/` | Recents-first — pick up any chat across the workspace |
| **Quick chat** | `/chat` | Ad-hoc chat with no project brief, files, or RAG (global memory + persona still apply) |
| **Project chat** | `/projects/:id/chat` | Full project context: brief, pinned files, URLs, default model |
| **Collection** | Sidebar grouping | Organises **projects only** in the sidebar — not individual chats |

Sessions are lazy-created on first message (unchanged). Labels use **title → first user message → “New chat”** — never raw session-id suffixes in the UI.

**Design principle (2026-07):** talk first, organise second. New chats open instantly; assign to a project later via move/drag or the empty-state context picker.

---

## Starting a chat (instant — no modal)

| Action | Behaviour |
|---|---|
| **Quick chat** in sidebar (or **+**) | Routes to `/chat`, clears composer (`vault:new-chat`) |
| **⌘/Ctrl+N** | Blank chat in current context: project route → project chat; otherwise quick chat |
| **+ New chat** in session picker | Clears composer in place (same context) |
| **New chat** from Home / Project detail | Routes via `openNewChatModal()` → `NewChatModalHost` (navigation only, no dialog) |
| **Empty-state Context picker** | Dropdown on blank chat: switch between Quick chat and any project before first message |

Move a quick chat into a project anytime: drag onto a project row, **Move** on history/sidebar, or overflow actions.

---

## Home (`/`)

**Continue list** — `GET /api/chat/recent?limit=20`

- Newest sessions across Quick chat and all projects
- Each row: label, optional snippet, location (`Quick chat` or project name), relative time
- Click row → correct chat route + load session

**New chat** buttons route immediately (no Quick vs Project modal).

Projects grid sits below with copy that projects are optional context (brief, files, URLs).

---

## Sidebar

### Recent (cross-project)

- Below Quick chat: last **5** sessions from `GET /api/chat/recent?limit=5`
- Shows label + location (project name or “Quick chat”)
- Refreshes on `vault:sessions-changed`

### Quick chat

- Top section: **Quick chat** + **+** for new quick chat
- Expandable list of recent quick chats (newest first)
- Drag a quick-chat session onto a project row to move it into that project

### Projects

- Helper text: *Collections group projects in the sidebar — not individual chats.*
- **Click project name** → enter project (`/projects/:id/chat`); resumes latest session, or blank chat if none
- **Chevron** → expand/collapse recent sessions (newest 10); **View all N chats →** when more than 10 (`/history?projectId=`)
- **⋯ overflow menu:** New chat, Overview, Move to collection…, Rename, Archive (confirm), Delete (confirm)

### Collections (folders)

- Created via folder-plus icon; labelled “Collection” in UI copy
- Group project rows only; assign via project detail **Organisation** dropdown, **Move to collection** in overflow menu, or drag project onto collection header

### Client context (conditional)

- Touchpoint logging block shown only on **project overview** (`/projects/:id`) and **client detail** — hidden on chat routes

---

## Chat header

| Control | Role |
|---|---|
| **Home** | Resume latest conversation (`GET /api/chat/recent?limit=1`); falls back to `/` |
| **Quick chat / project name** | Context label |
| **Session title** | Editable; falls back to first user message |
| **Session picker** | Switch sessions / + New chat (clears in place) |
| **Files** | Project chats only — pinned + session attachments |
| **Settings ▾** | Model, temperature, web search, reasoning, persona, voice, feeling, export |
| **⋯** | Star, summarize, download, delete session |

Mobile: Settings panel is desktop-only (`sm+`); core chat unchanged on small screens.

---

## Chat History

- **History / Deleted / Bookmarks** tabs (unchanged)
- **`?projectId=`** query param filters the History tab to one project’s sessions; banner with **Clear filter**

---

## Session labels

Shared helper: `formatSessionLabel()` in `sessionDisplay.js`

1. Stored `sessions.title` (including auto-title after first exchange)
2. First user message (trimmed ~48 chars)
3. `"New chat"`

API fields: `firstUserMsg` on `/api/chat/recent`, `/api/chat/sessions/general`, `/api/chat/sessions/:projectId`, `/api/chat/all-history`.

Project session lists sort by **newest first** (`MAX(createdAt) DESC`).

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/chat/recent?limit=N` | Cross-workspace recents (home Continue + sidebar Recent; max 50) |
| `GET` | `/api/chat/sessions/general` | Quick-chat sessions |
| `GET` | `/api/chat/sessions/:projectId` | Project sessions (newest first) |
| `GET` | `/api/chat/all-history` | Chat History browser (+ `firstUserMsg`) |

---

## Key files

| File | Role |
|---|---|
| `ProjectList.jsx` | Continue section, New chat triggers |
| `NewChatModalHost.jsx` | Global route-only new-chat handler (no UI) |
| `chatNavigation.js` | `loadSessionById`, `openRecentSession`, `startBlankChat` |
| `ProjectSidebar.jsx` | Recent, Quick chat, project enter/expand, overflow menu |
| `ChatPage.jsx` | Header, Settings menu, context picker, empty-state copy |
| `ChatHistoryPage.jsx` | History browser + `projectId` filter |
| `sessionDisplay.js` | Label, location, relative-time helpers |
| `chat.js` | Recent + session list queries |
