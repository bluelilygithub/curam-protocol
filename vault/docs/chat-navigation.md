# Chat navigation & session UX

How users start chats, resume recent work, and navigate projects vs quick (project-free) conversations.

Implementation: `client/src/pages/ProjectList.jsx` (home), `ProjectSidebar.jsx`, `ChatPage.jsx`, `NewChatModal.jsx`, `client/src/utils/sessionDisplay.js`, `server/routes/chat.js`.

---

## Mental model

| Concept | Route | Purpose |
|---|---|---|
| **Home / Continue** | `/` | Recents-first — pick up any chat across the workspace |
| **Quick chat** | `/chat` | Ad-hoc chat with no project brief, files, or RAG (global memory + persona still apply) |
| **Project chat** | `/projects/:id/chat` | Full project context: brief, pinned files, URLs, default model |
| **Collection** | Sidebar grouping | Organises **projects only** in the sidebar — not individual chats |

Sessions are lazy-created on first message (unchanged). Labels use **title → first user message → “New chat”** — never raw session-id suffixes in the UI.

---

## Home (`/`)

**Continue list** — `GET /api/chat/recent?limit=20`

- Newest sessions across Quick chat and all projects
- Each row: label, optional snippet, location (`Quick chat` or project name), relative time
- Click row → correct chat route + load session

**New chat** — opens `NewChatModal`:

1. **Quick chat** (default) → `/chat`, clears in-memory chat
2. **In a project…** → project picker → `/projects/:id/chat`

Projects grid sits below with copy that projects are optional context (brief, files, URLs).

---

## Sidebar

### Quick chat (formerly “General”)

- Top section: **Quick chat** + **+** for new quick chat
- Expandable list of recent quick chats (newest first)
- Drag a quick-chat session onto a project row to move it into that project

### Projects

- Helper text: *Collections group projects in the sidebar — not individual chats.*
- **Click project name** → enter project (opens `/projects/:id/chat`, resumes latest session or starts new)
- **Chevron** → expand/collapse recent sessions (newest 10)
- Hover icons: project settings, new chat in project, rename, archive, delete

### Collections (folders)

- Created via folder-plus icon; labelled “Collection” in UI copy
- Group project rows only; assign via project detail **Organisation** dropdown or drag project onto collection header

---

## Chat header

| Control | Role |
|---|---|
| **Home** | Back to Continue list (`/`) |
| **Quick chat / project name** | Context label |
| **Session title** | Editable; falls back to first user message |
| **Session picker** | Switch sessions / new chat in current context |
| **Files** | Project chats only — pinned + session attachments |
| **Settings ▾** | Model, temperature, web search, reasoning, persona, voice, feeling, export |
| **⋯** | Star, summarize, download, delete session |

Mobile: Settings panel is desktop-only (`sm+`); core chat unchanged on small screens.

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
| `GET` | `/api/chat/recent?limit=N` | Cross-workspace recents for home Continue (max 50) |
| `GET` | `/api/chat/sessions/general` | Quick-chat sessions |
| `GET` | `/api/chat/sessions/:projectId` | Project sessions (newest first) |
| `GET` | `/api/chat/all-history` | Chat History browser (+ `firstUserMsg`) |

---

## Key files

| File | Role |
|---|---|
| `ProjectList.jsx` | Continue section, New chat modal trigger |
| `NewChatModal.jsx` | Quick vs project chooser |
| `ProjectSidebar.jsx` | Quick chat, project enter/expand, collections hint |
| `ChatPage.jsx` | Header, Settings menu, empty-state copy |
| `sessionDisplay.js` | Label, location, relative-time helpers |
| `chat.js` | Recent + session list queries |
