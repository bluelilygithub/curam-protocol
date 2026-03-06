# Curam Vault

A private AI workspace — a single-user, authenticated web app for working with Claude (Anthropic API) within structured project contexts.

## What It Does

Work is organised around **Projects**. Each project holds a structured brief (goal, problem, audience, tech stack, constraints, tone, notes) that is injected as context into every AI conversation within it.

### Features

| Feature | Description |
|---|---|
| **Projects** | Workspace containers with structured briefs — organise AI work by client or topic |
| **Chat** | Claude-powered conversations scoped to a project's context |
| **Files** | Upload files (PDFs, images, docs) to a project; text is extracted and AI-summarised for use in chat |
| **Personas** | Reusable AI roles with custom system prompts (e.g. "Senior Copywriter", "Legal Reviewer") |
| **Prompts** | Prompt library — save, tag, and reuse prompt templates across projects |
| **Memory** | Global persistent notes injected into all chats (facts the AI should always know) |
| **Pinned URLs** | Attach web URLs to a project; content is fetched and stored for AI context |
| **Export** | Export chat conversations to Markdown |
| **Email** | Send content via email from within the app |
| **Search** | Global search palette across projects, chats, and files |

### Tech Stack

- **Backend:** Node.js / Express, SQLite (`better-sqlite3`), Anthropic SDK
- **Frontend:** React / Vite, Zustand (auth state), React Router, Tailwind CSS
- **Auth:** Token-based sessions (single-user via seed credentials)
- **Deploy:** Railway with persistent volume for SQLite DB and file uploads

---

## File Structure

```
vault/
├── server/
│   ├── index.js                  # Express server entry point
│   ├── db.js                     # SQLite schema + migrations
│   ├── typePrompts.js            # AI type-specific prompt helpers
│   ├── seed.js                   # Initial user seeding from env vars
│   ├── middleware/
│   │   └── auth.js               # requireAuth middleware (protects /api/*)
│   └── routes/
│       ├── auth.js               # Login / logout / session
│       ├── projects.js           # Project CRUD
│       ├── chat.js               # Claude streaming chat
│       ├── files.js              # File upload, extraction, AI summary
│       ├── personas.js           # Persona CRUD
│       ├── prompts.js            # Prompt library CRUD
│       ├── memory.js             # Global memory CRUD
│       ├── folders.js            # Folder management
│       ├── pinnedUrls.js         # URL pinning + content fetch
│       ├── fetchUrl.js           # URL content fetching
│       ├── search.js             # Global search
│       ├── export.js             # Chat export
│       ├── email.js              # Email sending
│       ├── pdf.js                # PDF text extraction
│       └── health.js             # Health check endpoint
│
├── client/
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── src/
│       ├── main.jsx              # React entry point
│       ├── App.jsx               # Router setup + keyboard shortcuts
│       ├── index.css
│       ├── themes.js             # Theme definitions
│       ├── pages/
│       │   ├── LoginPage.jsx
│       │   ├── ProjectList.jsx   # Home — list all projects
│       │   ├── ProjectDetail.jsx # Project brief + files + pinned URLs
│       │   ├── ChatPage.jsx      # Main chat interface
│       │   ├── PersonasPage.jsx  # Manage AI personas
│       │   ├── PromptsPage.jsx   # Prompt library
│       │   ├── MemoryPage.jsx    # Global memory management
│       │   ├── SettingsPage.jsx  # Account settings / password change
│       │   └── UserGuidePage.jsx # In-app user guide
│       ├── components/
│       │   ├── Layout.jsx        # App shell with sidebar
│       │   ├── ProjectSidebar.jsx
│       │   ├── AuthGuard.jsx     # Route protection
│       │   ├── MessageBubble.jsx # Chat message rendering
│       │   ├── ArtifactPanel.jsx # Rendered code/content panel
│       │   ├── ChatFileBar.jsx   # Files attached to a chat
│       │   ├── ChatFilePicker.jsx
│       │   ├── FileUploader.jsx
│       │   ├── FileList.jsx
│       │   ├── UrlBar.jsx        # Pinned URL input
│       │   ├── SearchPalette.jsx # Global search modal
│       │   ├── AtMentionDropdown.jsx  # @file/@prompt mentions in chat
│       │   ├── FollowUpChips.jsx # Suggested follow-up prompts
│       │   ├── ExportMenu.jsx
│       │   ├── EmailModal.jsx
│       │   ├── ImageAIPanel.jsx  # Image analysis panel
│       │   ├── NewProjectModal.jsx
│       │   └── KeyboardShortcutsModal.jsx
│       ├── store/
│       │   ├── authStore.js      # Zustand auth state (persisted)
│       │   ├── projectStore.js   # Zustand project state
│       │   └── settingsStore.js  # Zustand settings state
│       ├── hooks/
│       │   ├── useChat.js        # Chat logic + streaming
│       │   ├── useFileAttachment.js
│       │   ├── useUrlAttachment.js
│       │   ├── useSearch.js
│       │   ├── useSystemPrompt.js
│       │   ├── useVoice.js
│       │   └── useGeminiNano.js
│       ├── utils/
│       │   ├── apiClient.js      # Authenticated fetch wrapper (use for all /api/ calls)
│       │   ├── models.js         # Available Claude model list
│       │   ├── pricing.js        # Token pricing helpers
│       │   ├── exportMd.js       # Markdown export formatter
│       │   └── exportHelpers.js
│       └── providers/
│           ├── ThemeProvider.jsx
│           └── IconProvider.jsx
│
├── data/                         # SQLite database (gitignored)
│   └── vault.db
├── uploads/                      # Uploaded files (gitignored)
├── railway.toml                  # Railway build + deploy config
├── .env.example                  # Environment variable template
└── package.json
```

---

## Database Schema

| Table | Purpose |
|---|---|
| `users` | Single user account |
| `auth_sessions` | Active login tokens |
| `projects` | Project workspaces with context briefs |
| `messages` | Chat message history per project |
| `files` | Uploaded files with extracted text + AI summaries |
| `personas` | Saved AI personas with system prompts |
| `prompts` | Reusable prompt templates |
| `memory` | Global persistent memory entries |
| `pinned_urls` | URLs pinned to projects with fetched content |
| `folders` | Folder organisation |

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API access |
| `SEED_EMAIL` | Initial user email (created on first startup) |
| `SEED_PASSWORD` | Initial user password |
| `DB_PATH` | Path to SQLite database file |
| `UPLOAD_DIR` | Path to file uploads directory |
| `NODE_ENV` | `production` or `development` |

---

## Running Locally

```bash
cd vault
npm run dev
```

**Note:** The local environment is currently broken — see `../local-setup-issues.md`.
Production is deployed on Railway: `https://curam-vault.up.railway.app`
