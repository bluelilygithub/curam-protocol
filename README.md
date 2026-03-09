# Curam-Ai Protocol

AI-powered document extraction and automation platform for Australian professional services firms, plus an internal AI workspace (Vault).

**Live:** [curam-ai.com.au](https://www.curam-ai.com.au) | **Vault:** [curam-vault.up.railway.app](https://curam-vault.up.railway.app)

---

## Repository Structure

```
curam-protocol/
├── main.py                  # Flask marketing + document extraction site
├── routes/                  # Flask route blueprints
├── services/                # AI extraction, PDF processing, validation
├── roi_calculator/          # ROI calculator logic + industry configs
├── templates/               # Jinja2 HTML templates
├── vault/                   # Node.js/React AI workspace app
│   ├── server/              # Express backend
│   │   ├── index.js         # Server entry point
│   │   ├── db.js            # SQLite schema + migrations
│   │   └── routes/          # API route handlers
│   └── client/              # React/Vite frontend
│       └── src/
│           ├── pages/       # Route-level page components
│           ├── components/  # Shared UI components
│           └── utils/       # apiClient, helpers
└── requirements.txt
```

---

## App 1 — Flask Site (`main.py`)

Document extraction platform. Extracts structured data from PDFs (invoices, engineering drawings, transmittals) using Google Gemini AI.

**Stack:** Python 3.11, Flask, PostgreSQL, Google Gemini 2.5 Flash, pdfplumber + PyMuPDF, Gunicorn

**Accuracy:** Finance 95%+ · Engineering 93% · Transmittal 95%+

### Setup

```bash
# From project root
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
```

Create a `.env` file:

```
DATABASE_URL=postgresql://...
GEMINI_API_KEY=...
SECRET_KEY=...
ADMIN_PASSWORD=...
MAILCHANNELS_API_KEY=...     # optional, for email
```

```bash
python main.py
# Runs at http://localhost:5000
```

### Key Features

- PDF extraction pipeline: pdfplumber → PyMuPDF fallback → Gemini AI
- Document fingerprinting (SHA256) with 7-day AI response cache
- ROI Calculator with three savings scenarios (conservative / probable / optimistic)
- Phase 1 trial management with token-based customer report access
- Admin dashboard with extraction logs and trial tracking
- 7 validated industries: Accounting, Engineering, Logistics, Financial Planning, Insurance, Legal Services, Property Management

---

## App 2 — Vault (`vault/`)

Internal AI workspace: projects, chat, files, tasks, goals, personas, prompts, memory, debates, document comparison.

**Stack:** Node.js, Express, SQLite (better-sqlite3), React 18, Vite, Tailwind CSS

**Deployed on Railway:** auto-deploys on push to `version-7` branch.

### Setup

```bash
cd vault
npm install
```

Create `vault/.env`:

```
ANTHROPIC_API_KEY=...
SEED_EMAIL=admin@example.com
SEED_PASSWORD=yourpassword
NODE_ENV=development
DB_PATH=./server/vault.db
UPLOAD_DIR=./uploads
APP_URL=http://localhost:5173
# Optional (or set in Settings UI after login):
GEMINI_API_KEY=...
SEARCH_API_KEY=...            # Brave Search (BSA prefix), Serper, or SerpAPI
```

```bash
npm run dev
# Frontend: http://localhost:5173
# Backend:  http://localhost:3001
```

### Key Features

| Feature | Description |
|---|---|
| **Chat** | Multi-model chat (Claude + Gemini); project sessions + general chat; chat history |
| **Tasks** | Full task manager — list, board (Kanban), calendar views; subtasks, templates, effort tracking, time logging, dependencies, Focus Mode (Pomodoro), weekly review, CSV import, public sharing |
| **Goals** | OKR-lite — Objectives → Key Results → Tasks; AI-suggested KRs via SSE stream |
| **Document Compare** | Side-by-side SSE streaming comparison; 4 modes; save to project |
| **Debate** | Multi-model debate (Anthropic + Gemini); round history; synthesis summary |
| **Files** | Per-project file uploads with search |
| **Prompts / Personas / Memory** | Reusable prompt library, AI personas, memory snippets |
| **Admin Dashboard** | Usage stats — messages, sessions, searches, debates, comparisons, tokens; period selector |
| **Web Search** | `@search` in chat; Brave Search / Serper / SerpAPI auto-detected from key format |
| **Gmail** | `@gmail` in chat; connect personal Gmail via OAuth; natural language search with Claude Haiku query translation; attach email threads as context; ask questions about threads via SSE streaming |

### API Auth

Token-based. All `/api/*` endpoints (except `/api/auth/*` and `/api/health`) require a session token. Frontend uses `vault/client/src/utils/apiClient.js` for all authenticated requests — never use raw `fetch()`.

### Database

SQLite at `DB_PATH`. Schema + migrations in `vault/server/db.js`. On Railway, DB lives on a mounted volume (`/data/vault.db`).

Key tables: `users`, `auth_sessions`, `projects`, `files`, `messages`, `sessions`, `tasks`, `task_templates`, `task_tags`, `task_comments`, `objectives`, `key_results`, `personas`, `prompts`, `memory`, `debates`, `comparisons`, `settings`, `gmail_tokens`

---

## Deployment

### Flask Site
Deployed on Railway. Gunicorn binds to `0.0.0.0:5000`.

### Vault
Deployed on Railway via `vault/railway.toml`. Push to `version-7` → auto-deploys.

**Required Railway environment variables for Vault:**
```
ANTHROPIC_API_KEY
SEED_EMAIL / SEED_PASSWORD
NODE_ENV=production
DB_PATH=/data/vault.db
UPLOAD_DIR=/data/uploads
APP_URL=https://curam-vault.up.railway.app
```

**Optional — Gmail integration:**
```
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI=https://curam-vault.up.railway.app/api/gmail/callback
```

---

## Git Workflow

```bash
# All git commands from project root
git checkout version-7          # working branch
git push origin version-7       # triggers Railway deploy
# PRs target: main
```
