# Curam Vault

A private AI workspace — a single-user, authenticated web app for working with Claude (Anthropic) and Gemini (Google) within structured project contexts.

## What It Does

Work is organised around **Projects**. Each project holds a structured brief (goal, problem, audience, tech stack, constraints, tone, notes) that is injected as context into every AI conversation within it.

### Features

| Feature | Description |
|---|---|
| **Projects** | Workspace containers with structured briefs — organise AI work by client or topic |
| **Folders** | Group projects into folders; drag-and-drop projects in and out of folders from the sidebar |
| **General Chat** | Project-free chat workspace for ad-hoc questions; sessions are saved and searchable |
| **Chat** | Claude and Gemini conversations scoped to a project's context; model and temperature switchable per session |
| **Chat History** | Browse every session across all projects and General Chat, filterable by date range and searchable by content |
| **Files** | Upload PDFs, images, and text files (txt, md, csv, json) to a project; text is extracted and AI-summarised on upload |
| **Project Files panel** | Side panel in the chat interface — lists all project files, upload new files, pin/unpin files to inject into every chat's context |
| **Pinned files** | Pinned files are automatically included in every chat's system prompt for that project |
| **Clipboard image paste** | Paste images directly from the clipboard into the chat input; sent as inline base64 to the AI, no file upload required |
| **Personas** | Reusable AI roles with custom system prompts (e.g. "Senior Copywriter", "Legal Reviewer") |
| **Prompts** | Prompt library — save, tag, and reuse prompt templates across projects |
| **Memory** | Global persistent notes injected into all chats (facts the AI should always know) |
| **Pinned URLs** | Attach web URLs to a project; content is fetched and stored for AI context |
| **`@search` web search** | Type `@` in chat and select "Search the web"; results shown in a panel before attaching as URL context |
| **Document Compare** | Compare two documents side by side using any Claude or Gemini model; 4 comparison modes; save results to a project |
| **Multi-Model Debate** | Pit multiple AI models against each other on a topic; multi-file context upload; synthesis summary |
| **Export** | Export chat conversations to Markdown, JSON, or PDF; email thread export |
| **Search** | Global search palette across projects, chats, and files |
| **Admin Dashboard** | Usage stats — sessions, messages, tokens, searches, debates, comparisons; filterable by date range |
| **Password reset** | Email-based password reset flow with 1-hour expiry tokens |

### Tech Stack

- **Backend:** Node.js / Express, SQLite (`better-sqlite3`), Anthropic SDK, Google Generative AI SDK (`@google/generative-ai`)
- **Frontend:** React / Vite, Zustand (auth + project + settings state), React Router, Tailwind CSS
- **Auth:** Token-based sessions (single-user via seed credentials); bcryptjs for password hashing
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
│       ├── auth.js               # Login (rate-limited) / logout / session / password reset
│       ├── user.js               # Change password (protected by requireAuth)
│       ├── projects.js           # Project CRUD
│       ├── chat.js               # Claude/Gemini streaming chat + session management
│       ├── compare.js            # Document comparison (Claude + Gemini, SSE streaming)
│       ├── debate.js             # Multi-model debate rounds
│       ├── files.js              # File upload, extraction, AI summary
│       ├── personas.js           # Persona CRUD
│       ├── prompts.js            # Prompt library CRUD
│       ├── memory.js             # Global memory CRUD
│       ├── folders.js            # Folder management
│       ├── pinnedUrls.js         # URL pinning + content fetch (SSRF-protected)
│       ├── fetchUrl.js           # URL content fetching (SSRF-protected)
│       ├── webSearch.js          # Web search — Brave / Serper.dev / SerpAPI (rate-limited)
│       ├── search.js             # Global search (vault-internal full-text)
│       ├── export.js             # Chat export (JSON, PDF, Markdown, email)
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
│       │   ├── ResetPasswordPage.jsx  # Email-based password reset
│       │   ├── ProjectList.jsx   # Home — list all projects
│       │   ├── ProjectDetail.jsx # Project brief + files + pinned URLs
│       │   ├── ChatPage.jsx      # Main chat interface (project and general)
│       │   ├── ChatHistoryPage.jsx    # Browse all sessions by date / search
│       │   ├── ComparisonPage.jsx     # Document compare tool
│       │   ├── DebatePage.jsx         # Multi-model debate tool
│       │   ├── PersonasPage.jsx  # Manage AI personas
│       │   ├── PromptsPage.jsx   # Prompt library
│       │   ├── MemoryPage.jsx    # Global memory management
│       │   ├── SettingsPage.jsx  # Account settings / password change
│       │   ├── AdminPage.jsx     # Usage dashboard
│       │   └── UserGuidePage.jsx # In-app user guide
│       ├── components/
│       │   ├── Layout.jsx        # App shell with sidebar + top nav
│       │   ├── ProjectSidebar.jsx
│       │   ├── AuthGuard.jsx     # Route protection
│       │   ├── MessageBubble.jsx # Chat message rendering
│       │   ├── ArtifactPanel.jsx # Rendered code/content panel
│       │   ├── ChatFileBar.jsx   # Files attached to a chat
│       │   ├── ChatFilePicker.jsx
│       │   ├── FileUploader.jsx
│       │   ├── FileList.jsx
│       │   ├── ProjectFilesPanel.jsx # Side panel for project file management in chat
│       │   ├── UrlBar.jsx        # URL chips above textarea
│       │   ├── SearchPalette.jsx # Global search modal
│       │   ├── AtMentionDropdown.jsx  # @file/@prompt/@search mentions in chat
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
│       │   ├── useChat.js        # Chat logic + streaming (Anthropic + Gemini)
│       │   ├── useFileAttachment.js
│       │   ├── useUrlAttachment.js
│       │   ├── useSearch.js
│       │   ├── useSystemPrompt.js
│       │   └── useVoice.js       # Browser speech recognition + TTS
│       ├── utils/
│       │   ├── apiClient.js      # Authenticated fetch wrapper (use for all /api/ calls)
│       │   ├── models.js         # Claude + Gemini model definitions with provider field
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
| `auth_sessions` | Active login tokens (32-byte hex, 24-hour expiry) |
| `password_resets` | Email-based reset tokens (1-hour expiry) |
| `projects` | Project workspaces with context briefs |
| `sessions` | Chat session metadata — title, star, summary state, token counts |
| `messages` | Chat message history (linked to session and optionally a project) |
| `files` | Uploaded files with extracted text + AI summaries |
| `personas` | Saved AI personas with system prompts |
| `prompts` | Reusable prompt templates |
| `memory` | Global persistent memory entries |
| `pinned_urls` | URLs pinned to projects with fetched content |
| `folders` | Folder organisation |
| `debates` | Multi-model debate rounds and results |
| `comparisons` | Saved document comparison results linked to projects |
| `search_logs` | Web search query log (powers admin dashboard search count) |
| `settings` | Key/value store for API keys and app config set via Settings UI |

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API access |
| `SEED_EMAIL` | Yes | Initial user email (created on first startup if no users exist) |
| `SEED_PASSWORD` | Yes | Initial user password (change via Settings after first login) |
| `DB_PATH` | Yes | Absolute path to SQLite database file |
| `UPLOAD_DIR` | Yes | Absolute path to file uploads directory |
| `NODE_ENV` | Yes | `production` or `development` |
| `APP_URL` | Yes | Base URL for password reset emails (e.g. `https://curam-vault.up.railway.app`) |
| `GEMINI_API_KEY` | Optional | Google Gemini API access — enables Gemini 2.0 Flash and Gemini 2.5 Pro models |
| `SEARCH_API_KEY` | Optional | Web search API key — supports Brave Search (`BSA…` prefix), Serper.dev (40-char hex), or SerpAPI (default) |
| `MAIL_CHANNEL_API_KEY` | Optional | MailChannels API key for email export; falls back to SMTP if not set |

---

## Security

| Area | Protection |
|---|---|
| **SSRF** | `fetchUrl.js` and `pinnedUrls.js` resolve hostnames via `dns.lookup()` before connecting; requests to private/internal IP ranges (`127.x`, `10.x`, `172.16–31.x`, `192.168.x`, `169.254.x`, `::1`) are rejected with 400. Check runs on every redirect hop. |
| **Response size** | Both URL-fetch routes cap the response body at 2 MB; the request is destroyed if exceeded. |
| **Path traversal** | File upload and list routes validate `projectId` is numeric-only before constructing any filesystem path. Validation runs *before* multer processes the upload. |
| **Brute force** | `POST /api/auth/login` is rate-limited to 10 attempts per 15 minutes per IP via `express-rate-limit`. |
| **XSS in email** | All user-generated content (message body, role, subject) is HTML-escaped via `escapeHtml()` before injection into the email template. |
| **Change-password auth** | Route is at `/api/user/change-password` and protected by the standard `requireAuth` middleware. |
| **Web search cost** | `/api/web-search` rate-limited to 20 requests per hour per IP. |
| **SQL injection** | All database queries use `better-sqlite3` prepared statements with parameterised values — no string interpolation. |
| **Auth sessions** | 32-byte random hex tokens; 24-hour expiry checked server-side on every request. |
| **Passwords** | bcryptjs with SALT_ROUNDS=12. |
| **Security headers** | `helmet` middleware applied in production (default CSP, HSTS, X-Frame-Options, etc.). |

---

## Running Locally

```bash
cd vault
npm install
npm run dev
```

**Node version:** `better-sqlite3` requires a pre-built native binary. Use **Node.js v22 LTS** — it has pre-built binaries and requires no compilation. Node v23+ does not have pre-built binaries and will fail to install on Windows without Visual Studio C++ Build Tools.

Check your version: `node -v`. If you are on v23 or higher, install Node v22 LTS from [nodejs.org](https://nodejs.org) and reinstall.

**Production** is deployed on Railway: `https://curam-vault.up.railway.app`
