# Vault navigation and information architecture

How users move through Vault after the navigation redesign (2026-07).

## Top bar (desktop)

Persistent chrome in [`Layout.jsx`](../client/src/components/Layout.jsx):

| Control | Purpose |
|---------|---------|
| Sidebar toggle | Expand/collapse project sidebar |
| **Project Vault** | Home (`/` desktop, `/mobile-dashboard` mobile) |
| **Search** | Global search (`⌘K`) |
| **Tasks** | Task board/list |
| **Chat History** | All sessions; bookmark badge when starred sessions exist |
| **Notes** | Quick access to notes (encouraged daily use) |
| **Apps** | Grouped launcher — all other features; badge when new Suggestions exist |
| **Settings** | Workspace settings |
| **Sign out** | End session |

Mobile uses Home + Menu dropdown instead of the full top bar.

## Apps launcher

Catalog lives in [`client/src/config/appNavigation.js`](../client/src/config/appNavigation.js). Groups:

- **Workspace** — Personas, Memory, Prompt Library, User Guide
- **Productivity** — Notes, Goals, Clients, Student
- **AI tools** — Prompt Chains, Knowledge Graph, Debate, Document Compare
- **Content tools** — PDF, Graphics, Domain & Brand, WP Theme Builder, YouTube
- **Money & data** — Finance, Shares, Usage & Cost, News Digest
- **Personal** — Mood, Wellbeing, Inbox Intel
- **Admin** — Suggestions (agent inbox), Clients, Dashboard (admins only)

Feature flags from Settings → Feature Access hide items workspace-wide (`canUseFeature`).

## Sidebar

[`ProjectSidebar.jsx`](../client/src/components/ProjectSidebar.jsx) is the app spine:

1. **Quick chat** — project-free sessions + recent list
2. **Workspace** — Tasks, Notes, Goals, Clients shortcuts
3. **Projects** — collections + project tree with recent chats
4. **7 Habits** (optional) — Goals/tasks shortcuts when enabled
5. **Client** (contextual) — touchpoints when active project has `clientId`
6. **Footer** — Chat History, Archived Projects, Settings

Expanding a project (chevron) shows recent chats plus **task / note / file counts** linking to filtered views.

## Content hierarchy

```
Client (optional)
  └── Project (optional Collection grouping in sidebar)
        ├── Chats (sessions)
        ├── Files (required projectId — no global file library)
        ├── Tasks (optional projectId)
        └── Notes (optional project_id)
```

- **Collections** group project rows in the sidebar only; they do not contain chats directly.
- **Clients** link to projects via `projects.clientId`; client detail is CRM-style, not a chat container.
- **Quick chat** sessions can be moved into a project for brief + file context.

## Project hub

[`ProjectDetail.jsx`](../client/src/pages/ProjectDetail.jsx) opens on **Overview** by default:

- Stat cards: chats, tasks, notes, files
- Recent chats, tasks, notes with links to full pages
- **Brief & settings** tab: context fields, model, collection, pinned URLs, files

Deep links:

- `/tasks?project={id}` — Tasks filtered to project
- `/notes?project={id}` — Notes filtered to project
- `/projects/{id}#files` — Brief tab, files section

## Related docs

- [Chat navigation](./chat-navigation.md) — Continue home, New chat modal, session labels
