# Restyle

A non-technical-friendly tool for editing a website's look. Upload or paste HTML and one or more CSS files, get a live clickable preview, adjust styling with simple controls or plain-English requests, then download the result.

## Stack

- **Backend:** Node.js + Express
- **CSS parsing/fixing:** PostCSS (real AST — no regex CSS parsing)
- **HTML sanitizing:** jsdom (strips `<script>`, inline event handlers, `javascript:` URLs, nested browsing contexts)
- **AI edits:** Anthropic SDK, model resolved from the Curam Vault ecosystem's own "standard" setting (see [Model resolution](#model-resolution))
- **Uploads:** multer, in-memory only — nothing is written to disk
- **Frontend:** plain HTML/CSS/vanilla JS, no build step, served as static files by Express

No database of its own. Everything lives in browser memory for the session.

## Local dev

```bash
npm install
cp .env.example .env   # then fill in ANTHROPIC_API_KEY
npm start
```

Runs at `http://localhost:3000` (or `$PORT` if set).

## Model resolution

Restyle doesn't hardcode which Claude model it calls. It reads the same "standard" model setting the rest of the Curam Vault ecosystem uses (`vault_models` + `default_model` in the `settings` table, first admin's config) by connecting to the same Postgres via `DATABASE_URL` — read-only, no writes, no schema changes. See `lib/vaultModel.js`.

If `DATABASE_URL` isn't set (e.g. running Restyle fully standalone) or the query fails, it falls back to `claude-sonnet-5` so the tool still works without Vault access.

## How it works

1. **Upload/paste HTML** → `POST /api/upload-html` sanitizes it server-side with jsdom (strips anything that could run script) and returns the safe `<head>`/`<body>` content.
2. **Upload/paste CSS** (any order, reorderable in the UI) → `POST /api/process-css` runs every stylesheet through PostCSS, silently normalizes parser-safe issues, flags ambiguous ones (duplicate properties, rules fully overridden by a later one, basic contrast issues), and returns one merged stylesheet in cascade order.
3. The merged HTML + CSS renders in a sandboxed `<iframe sandbox="allow-same-origin">` (no `allow-scripts`) with a separate injected stylesheet purely for hover/selection outlines — the user's own CSS is never touched to show selection state.
4. Clicking an element selects it; the property panel initializes from `getComputedStyle()` so it reflects the page's real current appearance, not a fixed default.
5. Panel controls and the plain-English AI box (`POST /api/ai-edit`) both write directly to the selected element's inline style, and both log a one-sentence, jargon-free explanation.
6. **Undo** pops a `{element, property, previousValue}` stack.
7. **Export** clones the iframe's current DOM (edits included), strips the selection-outline style tag, and downloads it as a standalone `.html` file with the merged CSS inlined in a `<style>` tag.

## Plain-English AI edits

`POST /api/ai-edit` sends Claude the selected element's tag, classes, current inline styles, and current computed styles for the supported properties, plus the user's free-text request. The system prompt constrains the model to a strict JSON array with an allow-listed `property` field — anything outside that list is filtered server-side before it ever reaches the frontend, so the model can't return a change the UI doesn't know how to apply.

## Deploying to Railway

1. Push this repo (or just the `restyle/` folder as its own Railway service) to a connected git remote.
2. Create a new Railway service pointed at it. `railway.json` sets the start command and health check (`GET /health`) already.
3. Set environment variables in Railway's dashboard:
   - `ANTHROPIC_API_KEY` (required for AI edits)
   - `DATABASE_URL` (optional — same value as the Vault service's, to follow its model setting)
4. Railway provides `PORT` automatically — the app reads it from `process.env.PORT`, never hardcoded.
5. Nothing is written to disk that needs to survive a restart — Railway's ephemeral filesystem on redeploy is a non-issue.

## Limits

- 2MB max per uploaded file (HTML or CSS), enforced server-side via multer, not just the file picker's `accept` attribute.
- Server-side extension checks (`.html`/`.htm`, `.css`) on every upload — never trusts the client.
