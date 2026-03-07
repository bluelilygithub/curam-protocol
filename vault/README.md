# Curam Vault

A private AI workspace — a single-user, authenticated web app for working with Claude (Anthropic API) within structured project contexts.

## What It Does

Work is organised around **Projects**. Each project holds a structured brief (goal, problem, audience, tech stack, constraints, tone, notes) that is injected as context into every AI conversation within it.

### Features

| Feature | Description |
|---|---|
| **Projects** | Workspace containers with structured briefs — organise AI work by client or topic |
| **Folders** | Group projects into folders; drag-and-drop projects in and out of folders from the sidebar |
| **Chat** | Claude-powered conversations scoped to a project's context; Shift/Ctrl+Enter to send, Enter for new line; voice input via browser mic |
| **Files** | Upload PDFs, images, and text files (txt, md, csv, json) to a project; text is extracted and AI-summarised on upload |
| **Project Files panel** | Side panel in the chat interface — lists all project files, upload new files, pin/unpin files to inject into every chat's context |
| **Pinned files** | Pinned files are automatically included in every chat's system prompt for that project |
| **Personas** | Reusable AI roles with custom system prompts (e.g. "Senior Copywriter", "Legal Reviewer") |
| **Prompts** | Prompt library — save, tag, and reuse prompt templates across projects |
| **Memory** | Global persistent notes injected into all chats (facts the AI should always know) |
| **Pinned URLs** | Attach web URLs to a project; content is fetched and stored for AI context |
| **Export** | Export chat conversations to Markdown |
| **Email** | Send content via email from within the app |
| **Search** | Global search palette across projects, chats, and files |

### Recent Changes

- **Mobile-responsive** — works on iPhone; sidebar becomes a slide-over drawer on small screens; chat header collapses to essentials; artifact and file panels open full-screen on mobile; iOS keyboard zoom prevented; safe-area insets applied for notch and home bar
- **Security hardening** — 7 vulnerabilities fixed: SSRF blocked in URL-fetch routes (private IP check via DNS lookup); path traversal fixed in file upload; login brute-force protection (rate limit 10/15 min); HTML escaping in email export; `change-password` moved behind `requireAuth` middleware; web search rate limited; response body capped at 2 MB before buffering
- **Project Files panel** — new side panel in the chat header (files icon) shows all project files with pin/unpin, delete, and direct upload without needing to start a chat
- **File pinning** — pin any project file so its full content is injected into the system prompt for every chat in that project (previously only available from the project detail page)
- **Text file extraction** — `.txt`, `.md`, `.csv`, and `.json` files now have their content extracted and stored on upload, making them accessible to Claude when attached in chat
- **Project deletion** — delete projects from both the sidebar and the project list, with a confirmation modal showing how many chats will be removed
- **Folder drag-and-drop** — drag projects into folders in the sidebar; a "drop zone" appears to remove a project from a folder
- **New project defaults** — new projects default to the Research type and Economy (Haiku) model
- **Chat input** — plain Enter creates a new line; Shift+Enter or Ctrl+Enter sends the message
- **External links** — links in Claude's responses open in a new browser tab
- **`@search` web search** — type `@` in the chat input and select "Search the web"; enter a query and the top 3 results are fetched and injected as URL context (requires `SEARCH_API_KEY` — free key at serpapi.com)
- **Token budget alerts** — set a per-session cost limit in Settings; amber warning at 80%, red warning at 100% with a direct "Summarise now" button
- **Voice input** — mic button in the chat toolbar starts browser-native speech recognition (Web Speech API, no external service); pulses red with a live transcript preview while listening; final text is appended to whatever is already typed; hidden automatically in browsers that don't support it

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
│       ├── auth.js               # Login (rate-limited) / logout / session
│       ├── user.js               # Change password (protected by requireAuth)
│       ├── projects.js           # Project CRUD
│       ├── chat.js               # Claude streaming chat
│       ├── files.js              # File upload, extraction, AI summary
│       ├── personas.js           # Persona CRUD
│       ├── prompts.js            # Prompt library CRUD
│       ├── memory.js             # Global memory CRUD
│       ├── folders.js            # Folder management
│       ├── pinnedUrls.js         # URL pinning + content fetch (SSRF-protected)
│       ├── fetchUrl.js           # URL content fetching (SSRF-protected)
│       ├── webSearch.js          # Web search via SerpAPI (rate-limited)
│       ├── search.js             # Global search (vault-internal full-text)
│       ├── export.js             # Chat export
│       ├── email.js              # Email sending (HTML-escaped)
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
│       │   ├── ProjectFilesPanel.jsx # Side panel for project file management in chat
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
│       │   ├── useVoice.js           # Browser speech recognition + TTS; exposes interimText for live preview
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
├── .env.example                  # Environment variable template (includes SEED_EMAIL, SEED_PASSWORD)
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
| `SEARCH_API_KEY` | SerpAPI key for `@search` web search in chat (optional — free key at serpapi.com) |

---

## Security

| Area | Protection |
|---|---|
| **SSRF** | `fetchUrl.js` and `pinnedUrls.js` resolve hostnames via `dns.lookup()` before connecting; requests to private/internal IP ranges (`127.x`, `10.x`, `172.16–31.x`, `192.168.x`, `169.254.x`, `::1`) are rejected with 400. Check runs on every redirect hop. |
| **Response size** | Both URL-fetch routes cap the response body at 2 MB; the request is destroyed if exceeded. |
| **Path traversal** | File upload and list routes validate `projectId` is numeric-only before constructing any filesystem path. Validation runs *before* multer processes the upload. |
| **Brute force** | `POST /api/auth/login` is rate-limited to 10 attempts per 15 minutes per IP via `express-rate-limit`. |
| **XSS in email** | All user-generated content (message body, role, subject) is HTML-escaped via `escapeHtml()` before injection into the email template. |
| **Change-password auth** | Route moved from `/api/auth/` to `/api/user/change-password` and protected by the standard `requireAuth` middleware — no manual token check needed. |
| **Web search cost** | `/api/web-search` rate-limited to 20 requests per hour per IP. |
| **SQL injection** | All database queries use `better-sqlite3` prepared statements with parameterised values — no string interpolation. |
| **Auth sessions** | 32-byte random hex tokens; 24-hour expiry checked server-side on every request. |
| **Passwords** | bcrypt with SALT_ROUNDS=12. |
| **Security headers** | `helmet` middleware applied in production (default CSP, HSTS, X-Frame-Options, etc.). |

---

## Running Locally

```bash
cd vault
npm run dev
```

**Note:** The local environment is currently broken — see `../local-setup-issues.md`.
Production is deployed on Railway: `https://curam-vault.up.railway.app`
