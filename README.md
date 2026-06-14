# Curam-Ai Protocol

AI-powered document extraction and automation platform for Australian professional services firms, plus an internal AI workspace (Vault).

**Live:** [curam-ai.com.au](https://www.curam-ai.com.au) | **Vault:** [curam-vault.up.railway.app](https://curam-vault.up.railway.app)

---

## Table of Contents

1. [Repository Structure](#repository-structure)
2. [App 1 — Flask Site](#app-1--flask-site-mainpy)
3. [App 2 — Vault](#app-2--vault-vault)
4. [Gmail Integration](#gmail-integration)
5. [Environment Variables](#environment-variables)
6. [Deployment](#deployment)
7. [Git Workflow](#git-workflow)
8. [Troubleshooting](#troubleshooting)

---

## Repository Structure

```
curam-protocol/
├── main.py                  # Flask marketing + document extraction site
├── routes/                  # Flask route blueprints
├── services/                # AI extraction, PDF processing, validation
├── roi_calculator/          # ROI calculator logic + industry configs
├── templates/               # Jinja2 HTML templates
├── Procfile                 # Gunicorn start command for Railway
├── railway.toml             # Flask Railway build config (OCR apt packages)
├── requirements.txt         # Python dependencies
├── vault/                   # Node.js/React AI workspace app
│   ├── server/
│   │   ├── index.js         # Express entry point, route registration, seeding
│   │   ├── db.js            # PostgreSQL schema + connection pool (pg)
│   │   ├── middleware/
│   │   │   └── auth.js      # requireAuth middleware
│   │   ├── routes/          # API route handlers (one file per domain)
│   │   └── services/
│   │       ├── gmailNLP.js  # Natural language → Gmail query translator
│   │       └── gmailNLP.test.js  # 45-case NLP eval harness
│   ├── client/
│   │   └── src/
│   │       ├── pages/       # Route-level page components
│   │       ├── components/  # Shared UI components
│   │       ├── hooks/       # React hooks (chat, models, attachments, voice)
│   │       └── utils/       # apiClient, models, pricing, export helpers
│   ├── railway.toml         # Vault Railway build + deploy config
│   └── package.json
└── local-setup-issues.md    # Windows / Node version history
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
source venv/bin/activate     # macOS/Linux
pip install -r requirements.txt
```

Create a `.env` file in the project root:

```env
SECRET_KEY=your_strong_random_secret_here   # REQUIRED — Flask sessions
DATABASE_URL=postgresql://user:pass@host/db  # REQUIRED — PostgreSQL
GEMINI_API_KEY=your_gemini_key              # REQUIRED — document extraction
ADMIN_PASSWORD=your_admin_password          # REQUIRED — /admin panel
MAILCHANNELS_API_KEY=                       # optional, for email
FROM_EMAIL=noreply@curam-ai.com.au          # optional, defaults to this
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

### Production config (Gunicorn)

`gunicorn.conf.py` auto-scales workers: `min(4, cpu_count × 2 + 1)`, 5-minute timeout, max 1 000 requests per worker with jitter.

---

## App 2 — Vault (`vault/`)

Internal AI workspace: projects, chat, files, tasks, goals, clients, personas, prompts, memory, debates, document comparison, Gmail integration, prompt chains, and an interactive knowledge graph.

**Stack:** Node.js 22 LTS, Express, PostgreSQL (`pg`), React 18, Vite, Tailwind CSS, `react-force-graph-2d` (D3 force simulation)

**Deployed on Railway:** auto-deploys on push to `version-7` branch.

### Setup

```bash
cd vault
npm install
```

Create `vault/.env` (see [Environment Variables](#environment-variables) for the full reference):

```env
ANTHROPIC_API_KEY=sk-ant-...
SEED_EMAIL=admin@example.com
SEED_PASSWORD=yourpassword
NODE_ENV=development
APP_ENV=local
LOCAL_DATABASE_URL=postgresql://vault_local:<local-password>@localhost:5432/vault
UPLOAD_DIR=./uploads
APP_URL=http://localhost:5173
```

On the Mac Mini, the real local app data is stored in the Docker PostgreSQL container `local-pg` on `localhost:5432`. Start Docker Desktop and run `docker start local-pg` before starting the app. Do not replace it with an empty Homebrew PostgreSQL database. See `vault/docs/local-database-recovery.md` before changing local database settings.

```bash
npm run dev
# Frontend: http://localhost:5173
# Backend:  http://localhost:3001
```

> **Node version:** Node.js v22 LTS is recommended.

### Key Features

| Feature | Description |
|---|---|
| **Chat** | Multi-model chat (Claude + Gemini); project sessions + general chat; chat history with restorable deleted chats; `@search`, `@gmail`, `@mention` tasks/files/prompts |
| **Tasks** | Full task manager — list, Kanban, calendar, Eisenhower Matrix views; subtasks, templates, effort tracking, time logging, dependencies, Focus Mode (Pomodoro), weekly review, CSV import, public sharing |
| **Goals** | OKR-lite — Objectives → Key Results → Tasks; AI-suggested KRs; Personal Mission Statement wizard; Renewal Balance Dashboard; Getting Started Wizard (7-step guided setup) |
| **Document Compare** | Side-by-side SSE streaming comparison; 4 modes; save to project |
| **Debate** | Multi-model debate (Anthropic + Gemini); round history; synthesis summary |
| **Files** | Per-project uploads — PDFs, images, text, spreadsheets (xlsx, xls, ods), Word documents (docx, doc), and code files (js, jsx, ts, tsx, php, py, css, html, sql, sh, .env.example); text extracted and AI-summarised for all formats; spreadsheets converted to per-sheet CSV; Word docs extracted via mammoth; code files stored as plain text, 500 KB limit, prompt-injection sanitised; pin files for permanent context in every project chat; add files to the current session only via the session files feature |
| **Prompts / Personas / Memory** | Reusable prompt library, AI personas, global memory snippets |
| **Admin Dashboard** | Usage stats — messages, sessions, searches, debates, comparisons, tokens; period selector; Settings includes admin-only runtime visibility and a read-only Tool Update Report for local Homebrew, Python package, and Ollama model updates |
| **Web Search** | `@search` in chat; Brave Search / Serper / SerpAPI auto-detected from key format |
| **Gmail** | `@gmail` in chat; connect personal Gmail via OAuth 2.0; natural language search with Claude Haiku query translation; attach email threads as context; ask questions about threads via SSE streaming |
| **Notes** | Quick-capture thought pad — title, date, free text; link to projects; one-click "Take to Chat" to open note as chat context |
| **Clients** | CRM module at `/clients` — company and individual client records; contacts (name, role, email, phone); touchpoint log (call, email, meeting, note); linked to projects, invoices, tasks, and the morning digest; company/individual toggle in new/edit modal (individual auto-creates a primary contact from the client name); client chip in project detail header + client name on project cards; sidebar quick-log for touchpoints; Finance invoices linkable to CRM clients via `clientRef` |
| **Wellbeing & Personality Checks** | Proof-of-concept self-report area behind the heart-pulse nav. Eight checks are grouped into bordered modules: Mood & Emotional State (BDI, GAD-7, PANAS), Personality & Traits (IPIP-NEO-120, HEXACO-60), and Regulation & Coping (GAD-7, ASRS-5, CERQ, Brief COPE). Each module can generate a cached report; final Summary, Detailed, Analytical, and Suggestions reports are generated from the module outcomes. Charts, mind map, PDFs, admin invite/resend, demo data, reset, pause/resume, and review/retake flows are supported. |
| **Prompt Chains** | Build reusable multi-step prompt sequences; run sequentially with output passed as context between steps |
| **Knowledge Graph** | Full-screen D3 force-simulation canvas at `/graph` (🕸 share icon in top nav, desktop; navigate directly on mobile). Maps all vault content as interactive nodes: Projects (indigo circle, large), Files (blue rect), Notes (amber rounded rect), Chat Sessions (green circle), Tasks (orange diamond), Goals (purple hexagon), Pinned URLs (teal circle). Explicit structural edges: `contains`, `subtask`, `branch`, `created`, `tracks`, `key_result`, `blocks`. AI-computed semantic edges (dashed pink lines) via pgvector + Gemini embeddings — `contains` links orbit wide (180 px), collision radius prevents overlap. Interactions: zoom/pan, drag nodes, click a node to open a detail panel with type badge and "Go to" button for direct navigation, hover to highlight adjacency. Toolbar: search bar (amber glow on match), type-filter panel (per-colour checkboxes), "Find connections" / "Re-compute" semantic button, live node and edge count. Labels hidden when zoomed out, shown on zoom-in or hover. Proactive Insights panel (Claude Haiku) surfaces cross-project patterns, orphaned content, and semantic clusters — each insight has a "Show me" button that highlights and zooms to the relevant nodes. |

### API Auth

Token-based. All `/api/*` endpoints require a session token **except**:
- `/api/auth/*` — login, register, password reset
- `/api/shared/task/:token` — public read-only task share
- `/api/gmail/callback` — OAuth redirect from Google (no session at that point)

The Gmail router handles its own `requireAuth` internally for all paths except `/callback`. Frontend always uses `vault/client/src/utils/apiClient.js` — never raw `fetch()`.

### Database

PostgreSQL. Schema and connection pool in `vault/server/db.js`. On Railway, connect via the Railway PostgreSQL service (`DATABASE_URL`). Uploaded files live on a mounted volume (`UPLOAD_DIR`).

| Table | Purpose |
|---|---|
| `users` | Single user account |
| `auth_sessions` | Active login tokens (32-byte hex, 24-hour expiry) |
| `password_resets` | Email-based reset tokens (1-hour expiry) |
| `projects` | Project workspaces with context briefs, persona, model |
| `sessions` | Chat session metadata — title, star, soft-delete timestamp, summary, token counts |
| `messages` | Chat message history |
| `files` | Uploaded files with extracted text + AI summaries |
| `personas` | Saved AI personas |
| `prompts` | Reusable prompt templates |
| `memory` | Global persistent memory entries |
| `pinned_urls` | URLs pinned to projects with fetched content |
| `folders` | Folder organisation for projects |
| `debates` | Multi-model debate rounds |
| `comparisons` | Saved document comparison results |
| `search_logs` | Web search query log |
| `settings` | Key/value store — `vault_models`, API keys, app config |
| `tasks` | Task records with all fields |
| `task_tags` | Many-to-many tag associations |
| `task_comments` | Per-task comments + auto-logged activity events |
| `task_dependencies` | Directed blocker relationships |
| `task_templates` | Reusable task templates with subtasks |
| `template_subtasks` | Subtask definitions for a template |
| `objectives` | OKR Objectives |
| `key_results` | Key Results linked to an Objective |
| `gmail_tokens` | Gmail OAuth tokens per user — auto-refreshed via `googleapis` token event |
| `notes` | User-scoped quick-capture notes with optional project link |
| `graph_edges` | Cached semantic connection pairs (`source_id`, `target_id`, similarity score, `computed_at`) with unique constraint enabling upsert |
| `clients` | CRM client records — name, company, status, communicationPref, howTheyWork, startDate, tags, notes, clientType (company/individual) |
| `client_contacts` | Contacts at a client — name, role, email, phone, isPrimary |
| `client_touchpoints` | Communication log entries per client — type, date, note |
| `chains` | Prompt chain definitions (name, steps JSON) |
| `search_index` | Full-text search index (tsvector + GIN index) across projects, files, and messages |
| `wellbeing_attempts` | BDI-style mood check attempts with score, band, analysis, and PDF-ready answers |
| `gad7_attempts` | GAD-7-style anxiety check attempts used in mood/emotional and regulation/coping modules |
| `panas_attempts` | PANAS-style affect check attempts with positive/negative affect scales |
| `asrs5_attempts` | ASRS-5-style attention/self-regulation attempts |
| `ipip_neo_attempts` | IPIP-NEO-120 personality attempts with domain and facet scores |
| `hexaco_attempts` | HEXACO-60-style personality attempts with six-domain scores |
| `cerq_attempts` | CERQ-style cognitive coping attempts |
| `cope_attempts` | Brief COPE-style behavioural coping attempts |
| `wellbeing_combined_reports` | Cached module and final wellbeing reports keyed by report variant and latest source attempts |

---

## Gmail Integration

### Overview

Users connect their personal Gmail account via Google OAuth 2.0 from **Settings → Integrations**. Once connected, typing `@gmail` in any chat opens a search modal. Matching email threads can be attached as context and interrogated with follow-up questions — all without leaving the Vault chat interface.

### Architecture

```
User types @gmail → search modal opens
  → user enters natural language query
  → translateToGmailQuery() (Claude Haiku, gmailNLP.js)
  → Gmail API: users.messages.list with translated gmailQuery
  → results panel: subject / from / date / snippet
  → user selects thread → GET /api/gmail/thread/:id (full body fetch)
  → thread injected via addManual() as gmail://thread/<id> URL attachment
  → user sends message → buildMessageContent() in chat.js attaches [Email thread: Subject]
  → optional: POST /api/gmail/ask → SSE stream from Claude Haiku about the thread
```

### OAuth Flow

1. `GET /api/gmail/auth` — generates a Google OAuth URL with a short-lived state nonce (10-minute expiry) stored in the `settings` table.
2. User is redirected to Google and grants `gmail.readonly` + `userinfo.email` scopes.
3. Google redirects to `GET /api/gmail/callback` (registered **before** `requireAuth` in `index.js`). The callback validates the state nonce, exchanges the code for tokens, and upserts `gmail_tokens`. The state nonce is deleted after use (CSRF protection).
4. Tokens stored: `accessToken`, `refreshToken`, `tokenType`, `expiryDate`, `scope`, `email`.
5. The `googleapis` client emits a `tokens` event when the access token is auto-refreshed; the new token is persisted immediately.

### NLP Query Translation (`server/services/gmailNLP.js`)

Every search passes through `translateToGmailQuery(userMessage, today)` before hitting the Gmail API.

**What it does:**

1. `calculateDates(todayStr)` pre-computes ~22 date range strings in JavaScript — today, yesterday, this/last week (Mon–Sun), this/last month, this/last year, last 7/14/30/90 days, this/last calendar quarter, current and last Australian financial year (1 Jul – 30 Jun), and most-recent January. Using noon UTC internally to avoid DST edge cases.

2. `buildSystemPrompt(dates)` injects all pre-computed date values into the Claude system prompt. Claude pattern-matches the user's intent to the right range — it never does date arithmetic itself.

3. A single Claude Haiku call converts the natural language query to a structured JSON response:
   ```json
   {
     "gmailQuery": "from:\"Jane Smith\" subject:invoice after:2025/03/01",
     "intent": "extract",
     "maxResults": 200,
     "responseMode": "table"
   }
   ```

**Intent values:** `count` · `list` · `read` · `extract` · `summary` · `thread`

**Response mode values:** `count` · `table` · `prose` · `list`

**Direction rules built into the prompt:**
- "from X / X emailed me" → `from:X`
- "I emailed X / I sent to X" → `to:X`
- "correspondence with X" → `from:X OR to:X`
- No direction stated → `from:X` (received assumed)

### GMAIL_LIMITS Constants

Defined at the top of `vault/server/services/gmailNLP.js`:

```js
const GMAIL_LIMITS = {
  count:   500,   // "how many times has X emailed me" — fetch enough to count
  extract: 200,   // "extract all invoice amounts" — high volume needed
  list:    50,    // default browsing
  prose:   50,    // "catch me up on X" — summarise from top results
  default: 20,    // fallback
};
```

To change result limits, edit this object. The constants are referenced everywhere `maxResults` is set — no other changes needed.

### Ask Endpoint (`POST /api/gmail/ask`)

Streams a Claude Haiku answer about a specific thread via SSE.

**Ownership framing** — the system prompt explicitly states the user owns the inbox to prevent Claude refusing on privacy grounds for financial/legal/personal emails:

> *"You are a personal email assistant integrated into the user's own productivity workspace… Never refuse to summarise, analyse, or discuss emails on privacy grounds. The user owns this inbox."*

**Refusal detection** — after the stream completes, the full response is tested against a regex of common refusal phrases. Any match is logged to the server console with the email subject and question for prompt tuning:

```
[gmail/ask] Possible refusal detected — subject: "Tax Return 2025" | question: "What is the total?" | response snippet: "I'm sorry, I'm unable to..."
```

### NLP Eval Harness

`vault/server/services/gmailNLP.test.js` — 45 test cases across 11 categories with ANSI colour pass/fail output and a per-category breakdown score.

```bash
cd vault
node server/services/gmailNLP.test.js
```

Categories: Direction (5) · Name Resolution (5) · Time Range (8) · Content Keywords (5) · Attachments (3) · Status (3) · Count Intent (4) · Extract Intent (3) · Summary Intent (3) · Thread Intent (1) · Combined (5).

Each test defines `contains[]` fragment checks (case-insensitive) plus optional `intent` and `responseMode` exact-match assertions.

### Gmail Setup Checklist

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Library** → enable **Gmail API**.
2. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID** (Web application type).
3. Add **Authorised redirect URIs**:
   - Production: `https://curam-vault.up.railway.app/api/gmail/callback`
   - Local dev: `http://localhost:3001/api/gmail/callback`
4. Copy **Client ID** and **Client Secret** to your `.env` / Railway variables.
5. Set `GOOGLE_REDIRECT_URI` to exactly the URI you added in step 3.
6. In Vault: **Settings → Integrations → Connect Gmail**.

### Gmail Troubleshooting

**`redirect_uri_mismatch` error from Google**

The `GOOGLE_REDIRECT_URI` env var must match — character for character — the URI registered in Google Cloud Console. Common mismatches:
- Trailing slash (`/callback` vs `/callback/`)
- HTTP vs HTTPS
- Wrong port (Google expects `3001` for local, not `5173`)
- Railway URL changed after redeploy

Fix: update the URI in Google Cloud Console → Credentials → your OAuth 2.0 client → Authorised redirect URIs, then redeploy.

**"Gmail not connected" error after previously working**

The access token has expired and the refresh token is invalid (this happens if you revoke access in your Google account, or Google invalidates the token after 7 days for unverified apps in test mode).

Fix: go to **Settings → Integrations → Disconnect**, then reconnect. The OAuth flow issues a new refresh token.

**"0 results" for searches that should return emails**

The NLP translation may have generated an overly specific query. The raw translated query is shown as a `<code>` hint in the search modal. Steps:
1. Check the translated query — is the date range correct? Is the `from:` address right?
2. Try a simpler query (just the sender name, no date range).
3. Run the NLP harness to check if the query category is covered: `node server/services/gmailNLP.test.js`.
4. The fallback: if `translateToGmailQuery` fails to parse Claude's JSON response it returns the raw user query directly to Gmail API — which may work if the query is already in Gmail syntax.

**Testing NLP query translation accuracy**

Run the eval harness to verify all 45 query categories pass before deploying changes to `gmailNLP.js`:

```bash
node vault/server/services/gmailNLP.test.js
```

**Claude refusing to analyse sensitive emails**

If you see refusal language despite the ownership framing, check the server log for the `[gmail/ask] Possible refusal detected` warning. The question may have triggered a different policy edge case. Options:
1. Rephrase the question to be more explicit about ownership ("Summarise this email I received from my accountant about my tax return").
2. Adjust the system prompt in `vault/server/routes/gmail.js` → the `ask` endpoint's `system` string.
3. Check model — the ask endpoint uses `claude-haiku-4-5-20251001`. Switching to Sonnet may reduce false refusals for complex financial content.

---

## Environment Variables

### Vault (Node.js) — `vault/.env`

| Variable | Required | Default | Description | Example |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | — | Claude API key. All chat, compare, debate, Gmail ask, and AI-generation features. | `sk-ant-api03-...` |
| `SEED_EMAIL` | **Yes** | — | Email for the initial admin user created on first startup. | `admin@example.com` |
| `SEED_PASSWORD` | **Yes** | — | Password for the initial admin user. Change via Settings after first login. | `changeme123` |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string. On Railway: provided automatically by the PostgreSQL service. | `postgresql://vault:vault@localhost:5432/vault_dev` |
| `UPLOAD_DIR` | **Yes** | `./uploads` | Directory for uploaded files. On Railway: `/data/uploads` (persistent volume). | `/data/uploads` |
| `NODE_ENV` | **Yes** | — | `development` or `production`. Controls Helmet CSP, static file serving, and error verbosity. | `production` |
| `APP_URL` | **Yes** | `http://localhost:5173` | Base URL for password-reset email links, OAuth redirects, and public task share URLs. No trailing slash. | `https://curam-vault.up.railway.app` |
| `PORT` | Optional | `3001` | HTTP port. Railway sets this automatically — do not hardcode for production. | `3001` |
| `GEMINI_API_KEY` | Optional | — | Google Gemini API key. Enables Gemini 2.0 Flash and Gemini 2.5 Pro in chat, compare, and debate. Can also be set via Settings UI. | `AIza...` |
| `SEARCH_API_KEY` | Optional | — | Web search API key. Auto-detected by format: `BSA…` → Brave Search; 40-char hex → Serper.dev; anything else → SerpAPI. Can also be set via Settings UI. | `BSA-abc123...` |
| `SEARCH_PROVIDER` | Optional | Auto-detect | Override search provider detection. Values: `brave`, `serper`, `serpapi`. | `brave` |
| `YOUTUBE_API_KEY` | Optional | — | YouTube Data API key. Enables YouTube search. | `AIza...` |
| `FAL_API_KEY` | Optional | — | Fal API key for hosted image generation when the selected graphics provider is Fal. | `fal-key...` |
| `FINNHUB_API_KEY` | Optional | — | Finnhub API key for US share quotes and company news. | `cabc123...` |
| `GOLD_CACHE_MS` | Optional | `86400000` | Gold spot cache duration in milliseconds. `86400000` is 24 hours. | `86400000` |
| `AWS_ACCESS_KEY_ID` | Optional | — | AWS/S3 access key placeholder for S3-compatible storage configuration. | `AKIA...` |
| `AWS_SECRET_ACCESS_KEY` | Optional | — | AWS/S3 secret access key placeholder. Keep only in `.env` or Railway variables. | `...` |
| `AWS_S3_BUCKET` | Optional | — | S3 bucket name placeholder for object storage configuration. | `curam-vault-uploads` |
| `AWS_S3_REGION` | Optional | — | AWS/S3 region placeholder for object storage configuration. | `ap-southeast-2` |
| `GOOGLE_CLIENT_ID` | Optional | — | Google OAuth 2.0 Client ID. Required for Gmail integration (`@gmail` in chat). | `123456.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Optional | — | Google OAuth 2.0 Client Secret. Required for Gmail integration. | `GOCSPX-...` |
| `GOOGLE_REDIRECT_URI` | Optional | — | OAuth redirect URI — must match Google Cloud Console exactly. | `https://curam-vault.up.railway.app/api/gmail/callback` |
| `ENCRYPTION_KEY` | Optional² | — | 64 hex char key for AES-256-GCM encryption of Gmail OAuth tokens at rest. Generate: `openssl rand -hex 32`. Strongly recommended in production. | *(64 hex chars)* |
| `MAIL_CHANNEL_API_KEY` | Optional | — | MailChannels API key for transactional email (password reset). Preferred over SMTP. Can also be set via Settings UI. | `mc-key-...` |
| `SMTP_HOST` | Optional¹ | — | SMTP server hostname. Used if `MAIL_CHANNEL_API_KEY` is not set. | `smtp.gmail.com` |
| `SMTP_PORT` | Optional¹ | `587` | SMTP port. `587` for STARTTLS, `465` for SSL. | `587` |
| `SMTP_USER` | Optional¹ | — | SMTP username / sender email address. | `you@example.com` |
| `SMTP_PASS` | Optional¹ | — | SMTP password or app-specific password. | `abcd efgh ijkl mnop` |
| `INVITE_CODE` | Optional | — | If set, new registrations require this code. Leave unset to allow open registration. | `my-secret-invite` |

¹ `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS` are required together when `MAIL_CHANNEL_API_KEY` is not set and you need email features.

² Strongly recommended in production. Without it, Gmail OAuth tokens are stored unencrypted in the database.

Keep real Vault secret values out of git. Local development should use the ignored `vault/.env` file, production should use Railway Variables, and committed code should read runtime configuration through `process.env` with safe placeholders documented in `vault/.env.example`.

### Flask Site — root `.env`

| Variable | Required | Default | Description | Example |
|---|---|---|---|---|
| `SECRET_KEY` | **Yes** | — | Flask session encryption key. Must be a long random string. App raises `RuntimeError` on startup if missing. | `openssl rand -hex 32` output |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string. | `postgresql://user:pass@host:5432/db` |
| `GEMINI_API_KEY` | **Yes** | — | Google Gemini key for document extraction (Gemini 2.5 Flash). | `AIza...` |
| `ADMIN_PASSWORD` | **Yes** | — | Password for the `/admin` dashboard. | `secure-admin-pass` |
| `ADMIN_USERNAME` | Optional | `admin` | Username for the `/admin` dashboard. | `admin` |
| `MAILCHANNELS_API_KEY` | Optional | — | MailChannels API key for Flask email sending (trial reports, ROI calculator). | `mc-key-...` |
| `FROM_EMAIL` | Optional | `noreply@curam-ai.com.au` | Sender address for all Flask emails. | `noreply@curam-ai.com.au` |
| `UPLOAD_BASE_DIR` | Optional | `uploads/` | Base directory for file uploads. On Railway: `/data/uploads`. | `/data/uploads` |
| `CLEANUP_API_KEY` | Optional | — | Secret key to authenticate cleanup/admin API endpoints. | `random-hex-string` |
| `WORDPRESS_BLOG_URL` | Optional | `https://blog.curam-ai.com.au` | WordPress blog URL for RAG content integration. | `https://blog.curam-ai.com.au` |
| `GUNICORN_WORKERS` | Optional | Auto (`cpu×2+1`, max 4) | Override Gunicorn worker count. | `4` |

---

## Deployment

### Flask Site

Deployed on Railway (project root). Gunicorn starts via `Procfile`:

```
web: gunicorn main:app --bind 0.0.0.0:$PORT --workers 4 --timeout 120
```

`railway.toml` installs OCR system packages (`tesseract-ocr`, `libtesseract-dev`, `libleptonica-dev`) needed by the document extraction pipeline.

**Required Railway variables:** `SECRET_KEY`, `DATABASE_URL`, `GEMINI_API_KEY`, `ADMIN_PASSWORD`

### Vault

Deployed on Railway via `vault/railway.toml`. Push to `version-7` → auto-deploy.

```toml
[build]
installCommand = "npm install"
buildCommand = "npm run build"

[deploy]
startCommand = "npm start"
healthcheckPath = "/api/health"
healthcheckTimeout = 30
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

**Minimum required Railway variables:**

```
ANTHROPIC_API_KEY=sk-ant-...
SEED_EMAIL=admin@example.com
SEED_PASSWORD=your-password
NODE_ENV=production
DATABASE_URL=<Railway PostgreSQL service URL>
UPLOAD_DIR=/data/uploads
APP_URL=https://curam-vault.up.railway.app
ENCRYPTION_KEY=...          # openssl rand -hex 32 — AES-256-GCM encryption of Gmail OAuth tokens at rest
```

**Database:** Add a PostgreSQL service to your Railway project. Railway provides `DATABASE_URL` automatically — reference it as a shared variable in the Vault service environment.

**Volume mount (for uploaded files):**

1. In Railway dashboard → your Vault service → **Volumes** tab.
2. Add a volume, mount path: `/data`.
3. Set `UPLOAD_DIR=/data/uploads`.

Without the volume, uploaded files are lost on every redeploy. The PostgreSQL database is persisted independently by the Railway PostgreSQL service.

**Optional variables:**

```
GEMINI_API_KEY=AIza...
SEARCH_API_KEY=BSA-...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://curam-vault.up.railway.app/api/gmail/callback
MAIL_CHANNEL_API_KEY=...    # or SMTP_HOST / SMTP_USER / SMTP_PASS
```

---

## Git Workflow

```bash
# All git commands from project root
git checkout version-7          # working branch
git push origin version-7       # triggers Railway deploy for Vault
# PRs target: main
```

---

## Troubleshooting

### Railway Deployment Issues

**App starts but crashes immediately — `Cannot find module`**

`npm install` ran but `node_modules` is missing a dependency. This can happen if `package.json` was edited manually and the lock file is out of sync.

Fix: delete `vault/package-lock.json`, commit, and redeploy. Railway will run a clean `npm install`.

**Deploy succeeds but app shows blank white screen**

The Vite build (`npm run build`) may have failed silently. Check the Railway build logs for Vite errors. Common cause: a TypeScript/JSX syntax error introduced before deploy.

Fix: run `npm run build` locally in `vault/` and fix any errors before pushing.

**Health check fails → service marked as crashed**

Railway calls `GET /api/health` within 30 seconds of startup. If the server hasn't started (e.g., port binding failed), the service is killed.

Common causes: `PORT` env var not set (Railway provides it automatically — do not hardcode); `DATABASE_URL` not set or the PostgreSQL service not linked; `UPLOAD_DIR` directory doesn't exist (the server creates it automatically on first boot, but the `/data` volume must be mounted first).

### PostgreSQL on Railway

Vault uses PostgreSQL. Add a **PostgreSQL** service to your Railway project and link its `DATABASE_URL` variable to the Vault service.

**Step-by-step:**

1. Railway dashboard → **New** → **Database** → **PostgreSQL**.
2. In the Vault service → **Variables** tab → **Add Reference** → select the PostgreSQL service's `DATABASE_URL`.
3. On first boot, `db.js` connects and creates all 30 tables if they don't exist. Subsequent deploys are idempotent.

**Volume mount for file uploads:**

Railway's filesystem is ephemeral — add a volume for uploaded files:

1. Vault service → **Volumes** tab → **Add Volume**, mount path `/data`.
2. Set `UPLOAD_DIR=/data/uploads`.

**Checking DB health after deploy:**

```bash
# Railway CLI
railway run --service vault node -e "
  const { pool } = require('./server/db');
  pool.query('SELECT COUNT(*) AS n FROM users').then(r => console.log(r.rows[0]));
"
```

**Backup the PostgreSQL DB:**

```bash
# Via Railway CLI — dumps DB to local file
railway connect postgresql
# Then from the psql prompt: \! pg_dump ... > vault_backup.sql
# Or use pg_dump directly with the DATABASE_URL
pg_dump "$DATABASE_URL" > vault_backup.sql
```

### Node.js Version Issues

**Checking your Node version:**

```bash
node -v          # should be v22.x.x
npm -v           # should be 10.x
nvm use 22       # if using nvm
```

Node.js v22 LTS is recommended. See `local-setup-issues.md` for the full local environment history.

**`npm install` fails with peer dependency errors**

Run `npm install --legacy-peer-deps` from `vault/`. The `pdfjs-dist` package has peer dep conflicts with some versions of React that are benign at runtime.

### Gmail-Specific Issues

See the [Gmail Troubleshooting](#gmail-troubleshooting) section above for:
- `redirect_uri_mismatch`
- Token expiry / re-auth
- Zero search results
- Claude refusing sensitive email content

### General Vault Issues

**"Session expired" on every page refresh**

`auth_sessions` tokens expire after 24 hours server-side. If the app is serving a cached build from before a schema change, the token format may have changed.

Fix: clear localStorage in the browser (`localStorage.clear()` in DevTools console) and log in again.

**Gemini models not appearing in chat**

`GEMINI_API_KEY` must be set either in `.env` or via Settings UI (stored in the `settings` table as key `GEMINI_API_KEY`). The model picker hides Gemini models when the key is absent (checked via `GET /api/chat/model-status`).

**Web search always returns "no results"**

The `SEARCH_API_KEY` format determines the provider. If the key format is unrecognised it defaults to SerpAPI. Check that the key you've entered matches the expected format for your provider (Brave: starts with `BSA`; Serper: 40-char hex). Use the Settings page to update the key — no restart needed.

**PDF upload fails or returns empty extraction**

`pdfjs-dist` handles text PDFs client-side. Scanned PDFs (image-only) have no extractable text layer. Workaround: use the Flask document extraction endpoint which applies OCR via Tesseract/PyMuPDF.

**Email password reset not working**

Requires either `MAIL_CHANNEL_API_KEY` or all four SMTP vars. Check the server log for `[email]` errors. `APP_URL` must also be set to the correct domain — the reset link in the email will point to `${APP_URL}/reset-password?token=...`.

---

## Recent Changes

### March 2026

- **Clients module** — full CRM at `/clients`; company and individual client types (toggle in new/edit modal; individual hides company field and auto-creates a primary contact from the client name; person icon vs briefcase icon on cards and detail header); contacts tab (add/edit/delete contacts with role, email, phone, primary flag); touchpoints tab (call, email, meeting, note log with date and free text); three summary stats per client card (projects, outstanding invoiced, dominant project mood); client chip in the Project Detail header links back to the client; client name shown under project name in Project List cards; client selector in New Project Modal; sidebar "Client" section on open projects shows a quick touchpoint log form; Finance invoices linkable to CRM clients via a `clientRef` foreign key (Finance Clients tab shows a banner directing to the Clients module); morning digest shows client name beside overdue/due-today tasks; new DB tables: `clients`, `client_contacts`, `client_touchpoints`; new columns: `projects.clientId`, `fin_invoices.clientRef`, `clients.clientType`
- **Bug fix — mood type mismatch** — `mood_checkins.entity_id` is stored as INTEGER in the live DB; two queries were comparing it against TEXT expressions, causing 500 errors on `GET /api/clients` and `POST /api/mood/dominant/batch`; fixed by removing the `::text` cast in `clients.js` (`p.id = mc.entity_id`) and adding a cast in `mood.js` (`mc.entity_id::text = t.eid`)
- **Getting Started Wizard** — 7-step full-screen guided setup for the Goals page; steps: Personal Context (what matters most, what you're improving, life stage) → Mission Statement (Claude drafts from context, editable) → First Objective (AI-suggested with colour picker) → Key Results (3 AI-suggested, toggle/edit) → Connect Tasks (link open tasks to the objective) → Renewal Balance (four 0–10 sliders with streaming AI observation) → Review & Save (one-click sequential save of mission, objective, KRs, task links, and wizard completion flag); draft auto-saved to `localStorage`; wizard triggered automatically on first visit when no objectives exist; ✨ button in Goals header to reopen; Settings page "Redo Setup" button resets completion flag; `POST /api/goals/wizard/(complete|reset|generate-mission|suggest-objective|suggest-krs|renewal-observation)` and `GET /api/goals/wizard/status` — all stored in the existing `settings` table
- **Knowledge Graph — Phase 3: Proactive Insights** — Insights panel on the graph page powered by Claude Haiku; analyses graph structure (node counts, orphaned content, cross-project semantic clusters, top connected nodes) and generates 4–6 specific observations; each insight has a "Show me" button that highlights and zooms to the relevant nodes; insights cached in the `settings` table and refreshed on demand
- **Knowledge Graph — Phase 2: Semantic Connections** — `POST /api/graph/compute-semantic` SSE endpoint; file↔file similarity via pgvector SQL (`avg(embedding) <=> avg(embedding)`); note and session embeddings via Gemini; note↔note, file↔note, and session↔note comparisons in Node.js; connections cached in the new `graph_edges` table; dashed pink lines on the canvas; "Find connections" / "Re-compute" button with live progress bar
- **Knowledge Graph — Phase 1** — New `/graph` route with a full-screen `react-force-graph-2d` canvas; all vault content (projects, files, notes, sessions, tasks, goals, pinned URLs) rendered as typed, shaped nodes; explicit structural edges (contains, subtask, branch, created, tracks, key_result, blocks); hover highlights adjacency; click opens node detail panel with "Go to" navigation; search, type filters, legend
- **Prompt Chains** — New `/chains` page for building and running multi-step prompt sequences; output from each step passed as context to the next
- **Modal confirmations** — All `window.confirm()` calls replaced with a new `ConfirmModal` component; affects Gmail/Drive/Calendar disconnect and chain/session delete actions
- **Google Drive backup fix** — Backup was creating an empty `files/` folder in Drive because `fs.readdirSync(UPLOAD_DIR)` only scanned the top level; files are stored in `UPLOAD_DIR/{projectId}/filename` subdirectories; fixed with a recursive `walkDir()` helper and matching Drive subfolder creation on backup; restore uses a recursive Drive listing + `fs.mkdirSync({ recursive: true })` to recreate the directory structure
- **File upload auth fix** — Project Files panel was showing "Not authenticated"; the XHR upload in `FileUploader.jsx` was missing the `Authorization` header; fixed by reading the token from `useAuthStore` and calling `xhr.setRequestHeader`
- **Backup moved to Dashboard** — Google Drive backup section restored to the Admin Dashboard (`/admin`) after being temporarily moved to Settings caused a global auth-clearing bug (any 401 from the backup status call on Settings mount wiped the session via `apiClient`)
- **Office file extraction** — `.xlsx`, `.xls`, `.ods` (via `xlsx` package) and `.docx`, `.doc` (via `mammoth`) files now have text extracted on upload and AI-summarised; content injected into AI context identically to PDFs
- **Session files** — select project library files to include in the current chat session only; shown in a context bar; persisted to `session_files` table; paperclip icon per file card
- **Project sidebar accordion** — click a project name to toggle its recent session list; one project expanded at a time; sessions loaded lazily
- **Code block rendering fix** — Tailwind Typography prose backtick pseudo-elements were appearing on code blocks; fixed with `not-prose` class on CodeBlock and inline code elements
- **Recurring tasks fix** — recurrence now fires without a due date (uses today as base); double-creation on already-done tasks prevented
- **File library — attach from Project Files panel** — Attach button on every file in the chat's Project Files panel adds it to the current message without re-uploading; pin files for all-chat context, attach for single-message access
- **Markdown table rendering** — tables in AI responses, compare, and debate now render correctly with styled borders and horizontal scroll
- **Anthropic SDK upgraded to 0.78.0** — `@anthropic-ai/sdk` updated from 0.36.3 to 0.78.0
- **Code file uploads** — `.js`, `.jsx`, `.ts`, `.tsx`, `.php`, `.py`, `.css`, `.html`, `.sql`, `.sh`, `.env.example` accepted; stored as plain text with 500 KB limit and prompt-injection sanitisation
- **Settings file type persistence** — allowed file types now saved to the database and synced across devices
- **Gmail integration** — `@gmail` in chat; OAuth 2.0; natural language search via Claude Haiku; email threads as chat context; Gmail tokens encrypted at rest (AES-256-GCM)
- **Dynamic AI model management** — add, edit, delete, and test models from Settings without a code deploy
