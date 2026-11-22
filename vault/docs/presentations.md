# Presentations

**Status:** v1 available in preview (2026-11-22). Feature flag `presentations`, lifecycle `preview`, default off. Admins can always open it.

`Presentations` is a new Vault tool at **`/presentations`**. It turns a written brief, a document, a web page or a set of pictures into a small slide deck, lets the person edit the words and pictures, and exports an editable PPTX, a PDF, an HTML preview and per-slide PNGs.

It is deliberately **not** a clone of Presenton. It keeps the useful feature set but drops the parts that add operational weight: no MCP server, no API-key layer, no multi-provider abstraction, no template marketplace, no AI image generation and no separate “Smart” HTML slide engine. It uses Vault's own model resolver, auth, feature flags, Brand Kit, background-job pattern, storage and UI kit.

---

## Where work happens

| Layer | Files |
|---|---|
| Page shell | `client/src/pages/PresentationsPage.jsx` |
| Tool registry and jobs | `client/src/pages/presentations/toolRegistry.js`, `client/src/pages/presentations/presentationGoals.mjs` |
| Tool screens | `client/src/pages/presentations/tools/*.jsx` |
| Shared preview/export UI | `client/src/pages/presentations/PresentationPreview.jsx`, `client/src/pages/presentations/shared.jsx` |
| Browser history | `client/src/pages/presentations/historyStore.mjs` |
| Guided tour | `client/src/utils/tours/presentationsTour.js` (Settings → Tours, the compass button, or `/presentations?tour=1`) |
| Guide chat | `client/src/pages/presentations/PresentationsGuide.jsx` → `/api/presentations-tutor` (`server/routes/presentationsTutor.js`, `server/services/presentationsTutor.js`) |
| API | `server/routes/presentations.js` + `server/routes/presentations/*.js`, mounted at `/api/presentations` |
| Generation and export | `server/services/presentations/*.js` |
| Tables | `presentation_decks`, `presentation_templates` in `server/db.js` |
| Recycle bin | `server/services/recycleBin/adapters/presentations.js` |

The page uses the same shell as Graphics and Video Tools: grouped left sidebar, “What do you want to do?” start screen, job bar, tooltips, (i) help, voice on text fields, `Use in…` handoff, and a guide chat.

## Onboarding in the app

- **Guided tour** — six Shepherd steps from Settings → Tours → Presentations Tour (which opens `/presentations?tour=1`), or the compass button beside the title. It covers the start jobs, the four tool groups and search, the help/microphone controls, make → edit → export, and the guide chat. Finishing or skipping stores `vault_tour_presentations_completed` so it does not open again; the card in Settings then says “Retake Tour”.
- **Tooltips** — every group button and every tool button has a plain-English hover tip; the “What do you want to do?” button and the tool search have their own. A `?` button on each open tool gives a longer, tool-specific help box.
- **Help** — the `(i)` beside the title opens “How Presentations Works” once (tracked by `vault_presentations_info_seen`); the per-tool boxes explain what each tool can and cannot do.
- **Voice** — the shared `VoiceInputProvider` and microphone are available on the search box, the brief, and the other text inputs, as in the other tool pages.
- **Guide chat (the helper chatbot)** — `PresentationsGuide.jsx` uses the shared `TutorChat` component and the `presentations` catalogue entry in `server/config/guides.js`, behind `POST /api/presentations-tutor`. It knows the six tools and their order, suggests the right ones for a goal, and has Open buttons; it cannot see, read or change decks, documents or settings. It is a shell helper, not a seventh tool.

---

## Tool catalog — 6 tools

| Group | Tool id | Label | What it does |
|---|---|---|---|
| Make | `create` | Create deck | Brief → outline → slides using the chosen theme |
| Make | `import` | Import source | PDF, DOCX, TXT/MD, web URL or images → source text and image references |
| Design | `templates` | Themes | Built-in themes, saved custom themes, `.pptx/.potx` theme import, Brand Kit override |
| Design | `slides` | Slide editor | Edit titles and body text, swap images, add/delete/reorder slides |
| Finish | `export` | Export | PPTX, PDF, HTML preview, per-slide PNGs |
| Library | `decks` | My decks | Saved decks, browser history, reopen/duplicate/delete |

The guide chat, tooltips, help modal and voice controls are shell features, not counted as tools.

### Start-screen jobs

1. **Make a deck from a brief** → `create` → `slides` → `export`
2. **Turn a document into slides** → `import` → `create` → `slides` → `export`
3. **Make a deck in my brand** → `templates` → `create` → `slides` → `export`
4. **Reopen a saved deck** → `decks` → `slides` → `export`

---

## Canonical deck shape

Everything is generated from and exported to one versioned JSON shape:

```js
{
  schemaVersion: 1,
  title: '...',
  subtitle: '...',
  themeId: 'paper',
  aspect: '16:9',
  slides: [
    {
      id: 's1',
      layout: 'title' | 'bullets' | 'two-column' | 'picture' | 'closing',
      title: '...',
      bullets: ['...', '...'],
      body: '...',
      imageRef: 'asset-id-or-data-url-or-remote-url',
      notes: '...'
    }
  ]
}
```

The HTML preview, PDF and PNGs render from this model. The PPTX is built from the same model with `pptxgenjs`, keeping text as editable text boxes. One model means no drift between preview and export.

---

## Generation pipeline

1. **Source normalisation** — `import` (`server/services/presentations/sources.js`) extracts text from PDF (`pdf-parse`), DOCX (`mammoth`), TXT/MD, or a safe-fetched URL; images are kept as asset references under the user's upload folder. The brief tool accepts typed text directly.
2. **Outline** — `generation.js` asks the workspace `light` model (falling back to `standard`) for a short JSON outline: deck title, subtitle, 6–12 slides, each with a layout hint, heading and 2–4 bullets. Output is parsed strictly and clamped. The outline deliberately keeps using the light tier even when a person picks a model.
3. **Slides** — the same `generation.js` asks the workspace `standard` model (falling back to `light`) to expand the outline into the canonical deck JSON. A model explicitly chosen on the page replaces the `standard` slot after it has been validated server-side. Unknown layouts fall back to `bullets`; text is length-capped.
4. **Preview** — `PresentationPreview.jsx` renders the canonical JSON as HTML using the selected theme; the server-side renderer in `server/services/presentations/render.js` produces the same HTML for export.
5. **Export** — `server/services/presentations/export.js` writes PPTX with `pptxgenjs`, PDF with Playwright's `page.pdf()`, per-slide PNGs zipped with `archiver`, and a self-contained HTML file with assets inlined as data URLs. Finished files are kept per user under `{UPLOAD_DIR}/presentations/{userId}/exports/` until they are replaced.

All model calls use `getModelsForUser(userId)` and `callModel()`; usage is logged through `logUsage()`. No model id is hard-coded.

### Model selection

Presentations follows the same rule as Chat. The page loader calls `useModels()` (Settings → AI & Chat: `vault_models` and `default_model`) and reads `memberModelSelection` from Feature Access. Admins may always choose; members may choose only when that flag is on. The effective choice is the picked model, otherwise `defaultModel`, otherwise the first configured text model. The sidebar picker lists text models only, and the selected id is sent with `POST /api/presentations/create`.

`server/utils/userModelSelection.js` repeats the permission check at the HTTP boundary. It accepts an explicit id only when that person is allowed to choose and the id is a text model in the user's resolved `vault_models` catalog (admin fallback included). A member with selection off has the id ignored; an allowed caller who sends an unknown or non-text id gets a 400 and no provider call. Generation still falls back to the resolver's `standard`/`light` tiers when no valid selection is present.

The guide chat sends the same effective id as `model` on `POST /api/presentations-tutor`. `makeGuideRouter()` validates it with the same helper, and `guideCore.ask()` uses it for that reply; guides that do not send a model keep their configured tier. `TutorChat` takes optional `model`, `modelOptions`, `canSelectModel` and `onModelChange` props, so other guides are unchanged when they are absent.

If a provider rejects the key or the call fails, `server/utils/modelCallError.js` turns the raw SDK JSON into one readable message (for example, “The AI provider rejected Vault's key … An admin needs to check the provider API key.”) with HTTP 502 and `code: 'model_call'`. Raw provider JSON is never shown, and a provider failure is never silently replaced by a fallback deck.

---

## Themes

Built-in themes are code, not database rows: `paper`, `ink`, `warm`, `ocean`, `forest`, `mono`. Each is a small JSON object: colours, font family, title size and whether to use the Brand Kit logo. A saved theme is a row in `presentation_templates`; importing a `.pptx/.potx` reads colours, fonts and layout hints only — it does not reproduce PowerPoint masters. Brand Kit is applied as an override on top of whatever theme is selected.

---

## Storage

- `presentation_decks`: id, owner, title, theme id, source type, canonical `data` JSONB, created/updated timestamps.
- `presentation_templates`: id, owner (nullable for built-ins), name, `theme` JSONB, source (`builtin` / `saved` / `import`), timestamps.
- Asset files live under `{UPLOAD_DIR}/presentations/{userId}/`; finished exports go in that user's `exports/` subfolder.
- Deleting a deck or saved theme uses `moveToBin()` with types `presentation-deck` and `presentation-template`.
- Background job state is in memory only: one active job per person, Cancel/Resume, and finished results kept for 30 minutes. Restarting the server forgets running jobs; saved decks are the durable copy.
- Browser history is opt-in, kept in IndexedDB `vault-presentations-history`, last 40 decks / 150 MB, like Graphics history. It is a convenience, not a backup.

---

## API

Mounted in `server/index.js` as:

```js
app.use('/api/presentations', requireFeature('presentations'), require('./routes/presentations'));
```

| Route | Purpose |
|---|---|
| `GET /api/presentations/meta` | Slide limit and Brand Kit availability for the current user |
| `POST /api/presentations/create` | Start a generation job from a brief or outline; optional `model` uses the validated page selection |
| `POST /api/presentations/import` | Multipart document/image import; `POST /api/presentations/import/url` for a URL |
| `GET /api/presentations/assets/:userId/:name` | Serve an uploaded image to the preview and editor |
| `POST /api/presentations/preview` | Render canonical deck HTML without starting a job |
| `GET /api/presentations/jobs/:id` | Job status |
| `POST /api/presentations/jobs/:id/cancel` / `/resume` | Cancel a running job or resume a cancelled one |
| `GET /api/presentations/jobs/:id/result` | Finished canonical deck or export payload |
| `GET /api/presentations/decks` / `POST` / `GET /:id` / `PATCH /:id` / `DELETE /:id` | Saved decks |
| `POST /api/presentations/decks/:id/duplicate` | Duplicate a deck |
| `GET /api/presentations/templates` / `POST` / `DELETE /:id` | Saved themes |
| `POST /api/presentations/templates/import` | Multipart `.pptx/.potx` theme import |
| `POST /api/presentations/export` | Start an export job (`pptx`, `pdf`, `png`, or `html`) |
| `GET /api/presentations/export/:id/file/:format` | Download a finished export |
| `POST /api/presentations-tutor` | Guide chat; only tool advice, never deck data (separate mount); optional validated `model` |

Long work returns `202 { jobId }`, follows the Video Tools background-job pattern (one active job per person, Cancel, Resume, 30-minute result cache), and is never left blocking a web request.

---

## Limits and non-goals

- 6–12 slides per deck by default, 20 maximum.
- PDF/DOCX exports are capped by the existing upload limit; extracted text is capped before it is sent to a model.
- No AI-generated images in v1. Images come from uploads, the Brand Kit, or a Graphics handoff.
- `.pptx/.potx` import takes colours/fonts/layout hints, not full master fidelity.
- No MCP, API keys, community templates, smart HTML-only slides or full drag/drop slide designer.
- No new npm dependencies: everything needed is already in `package.json`.

---

## Integration

- **Brand Kit** — reads `graphics_brand_kit` through the existing Graphics Brand Kit helpers; missing values are reported plainly before a job starts.
- **Use in…** — decks and slide images can be handed to other tools and results from Graphics can be dropped into the slide editor.
- **Feature access** — `presentations` in both feature-access files; member tool, default off, lifecycle `preview`.
- **Guide chat (helper chatbot)** — catalogued in `server/config/guides.js`, served by `POST /api/presentations-tutor` behind the `presentations` flag and `aiLimiter`; only points at real tools, never runs them or reads a deck.
- **Onboarding** — Settings → Tours lists Presentations Tour; the page's compass button and `?tour=1` run the same six-step Shepherd tour. Tooltips, the (i) help box and the shared microphone are part of the shell.

---

## Tests

- `node server/services/presentations/schema.test.js` — canonical deck validation and clamping.
- `node server/services/presentations/generation.test.js` — outline/slide prompt plumbing, explicit model override and friendly provider errors with stubbed models; no network.
- `node server/utils/userModelSelection.test.js` — admin/member permission and configured text-id validation; no database.
- `node server/services/guideCore.test.js` — guide tier fallback, explicit model and friendly provider errors; no database.
- `node server/services/presentations/export.test.js` — PPTX/PDF/PNG generation from a fixture deck.
- `node server/services/presentations/jobs.test.js` — job lifecycle, cancel/resume and the 30-minute result cache.
- `node server/routes/presentations/templates.test.js` — theme sanitising and import rules.
- `node client/src/pages/presentations/presentationGoals.test.mjs` — every job step names a real tool.
- `node server/config/guides.test.js` — the guide catalogue (including `presentations`) still resolves.
- `npm run test:nav` and `npm run build` — navigation/route checks and the client build.

Run these directly; no `package.json` script is added (deploy-speed rule).
