# Presentations

**Status:** v1 available in preview (2026-11-22). Feature flag `presentations`, lifecycle `preview`, default off. Admins can always open it.

`Presentations` is a new Vault tool at **`/presentations`**. It turns a written brief, a document, a web page or a set of pictures into a small slide deck, lets the person edit the words and pictures, and exports an editable PPTX, a PDF, an HTML preview and per-slide PNGs.

It is deliberately **not** a clone of Presenton. It keeps the useful feature set but drops the parts that add operational weight: no MCP server, no API-key layer, no multi-provider abstraction, no template marketplace, no AI image generation and no separate “Smart” HTML slide engine. It uses Vault's own model resolver, auth, feature flags, Brand Kit, background-job pattern, storage and UI kit.

---

## Where work happens

| Layer | Files |
|---|---|
| Page shell | `client/src/pages/PresentationsPage.jsx` |
| Tool list, tips and help | `client/src/pages/presentations/presentationsTools.mjs` (the `ToolSidebar` groups, hover tips, the line under each tool, the (?) and (i) boxes; shared with the guide's catalogue) |
| Tool components and jobs | `client/src/pages/presentations/toolRegistry.js` (lazy components by id), `client/src/pages/presentations/presentationGoals.mjs` |
| Shared pieces | `client/src/pages/presentations/shared.jsx`: the deck model, the job hook, and DESIGN.md class strings (`CARD`, `ROW`, `SELECT`, `BTN_PRIMARY`, `BTN_SECONDARY`, `BTN_QUIET`), `InlineDelete`, `themeOptions` |
| Tool screens | `client/src/pages/presentations/tools/*.jsx` |
| Shared preview/export UI | `client/src/pages/presentations/PresentationPreview.jsx`, `client/src/pages/presentations/shared.jsx` |
| Browser history | `client/src/pages/presentations/historyStore.mjs` |
| Guided tour | `client/src/utils/tours/presentationsTour.js` (Settings → Tours, the compass button, or `/presentations?tour=1`) |
| Guide chat | `client/src/pages/presentations/PresentationsGuide.jsx` → `/api/presentations-tutor` (`server/routes/presentationsTutor.js`, `server/services/presentationsTutor.js`) |
| API | `server/routes/presentations.js` + `server/routes/presentations/*.js`, mounted at `/api/presentations` |
| Slide geometry | `server/services/presentations/layouts.js`: the 8 design styles and 13 slide layouts, as percent boxes (`plan()`); used by the HTML renderer, the PPTX exporter and the Themes gallery thumbnails |
| Design gallery | `client/src/pages/presentations/DesignGallery.jsx` (draws the `designs[].samples` from `GET /api/presentations/meta`) |
| Generation and export | `server/services/presentations/*.js` |
| Tables | `presentation_decks`, `presentation_templates` in `server/db.js` |
| Recycle bin | `server/services/recycleBin/adapters/presentations.js` |

The page uses the same shell as Contract Review and DocCompare: the shared `ToolSidebar` (tool search with a microphone, `/` to jump to it, groups that open and close, a hint on Slide editor and Export until a deck exists), the “What do you want to do?” start screen, `BackToJobs` and the job bar, then one line describing the open tool. Every control has a tooltip; loading uses `Skeleton`, empty lists use `EmptyState`, routine deletes confirm in place (`InlineDelete`). The preview rebuilds by itself 600 ms after typing stops (Refresh rebuilds at once). Theme pickers show each theme's own colours and names.

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
  designId: 'clean' | 'underline' | 'banded' | 'sidebar' | 'split' | 'framed' | 'bold' | 'corner',
  aspect: '16:9',
  slides: [
    {
      id: 's1',
      layout: 'title' | 'section' | 'bullets' | 'agenda' | 'two-column' | 'comparison' | 'three-column'
            | 'stats' | 'quote' | 'timeline' | 'picture' | 'full-picture' | 'closing',
      title: '...',
      bullets: ['...', '...'],
      body: '...',
      columns: [{ heading: '42%', bullets: ['...'] }],   // comparison (2), three-column (3), stats (up to 4); [] otherwise
      imageRef: 'asset-id-or-data-url-or-remote-url',
      notes: '...'
    }
  ]
}
```

The HTML preview, PDF and PNGs render from this model. The PPTX is built from the same model with `pptxgenjs`, keeping text as editable text boxes. One model means no drift between preview and export.

Where things go on a slide comes from one place, `layouts.js` `plan(slide, { designId, aspect, titleSize })`: the design's decoration shapes (bands, panels, frames, accents, all in theme colour names) and the layout's text boxes, pictures and shapes, in percent of the slide with text sizes in px for a 720px-tall slide. `render.js` turns a plan into absolutely positioned HTML; `export.js` turns the same plan into PPTX shapes, text boxes and pictures on the real slide size (10 × 5.625 in for 16:9, 10 × 7.5 for 4:3, 9 × 9 for 1:1). Stats and columns fall back to the bullets when a slide has no columns (`"42% | Growth"` becomes a number and its label). Unknown layouts fall back to `bullets`, unknown designs to `clean`. Before 2026-11-23 the PPTX used fixed positions for a 7.5 in tall slide, so 16:9 exports lost their body text off the bottom; that is fixed by the shared geometry.

---

## Generation pipeline

1. **Source normalisation** — `import` (`server/services/presentations/sources.js`) extracts text from PDF (`pdf-parse`), DOCX (`mammoth`), TXT/MD, or a safe-fetched URL; images are kept as asset references under the user's upload folder. The brief tool accepts typed text directly.
2. **Outline** — `generation.js` asks the workspace default model (`default_model`, with `standard`/`light` tiers only as fallbacks) for a short JSON outline: deck title, subtitle, 6–12 slides, each with one of the 13 layouts (the prompt says what each is for and asks for variety, and never to invent numbers or images), a heading, bullets and, for comparison, three-column and stats slides, columns. Output is parsed strictly and clamped.
3. **Slides** — the same `generation.js` asks that same resolved model to expand the outline into the canonical deck JSON. Unknown layouts fall back to `bullets`; text is length-capped.
4. **Preview** — `PresentationPreview.jsx` renders the canonical JSON as HTML using the selected theme; the server-side renderer in `server/services/presentations/render.js` produces the same HTML for export.
5. **Export** — `server/services/presentations/export.js` writes PPTX with `pptxgenjs`, PDF with Playwright's `page.pdf()`, per-slide PNGs zipped with `archiver`, and a self-contained HTML file with assets inlined as data URLs. Finished files are kept per user under `{UPLOAD_DIR}/presentations/{userId}/exports/` until they are replaced.

All model calls use `getModelsForUser(userId)` and `callModel()`; usage is logged through `logUsage()`. No model id is hard-coded.

### Model selection

There is no model picker on the page (removed 2026-11-23). The page sends no model id, so `POST /api/presentations/create` writes the outline and the slides with the workspace default model an admin sets in Settings → AI & Chat (`default_model`), falling back to the resolver's `standard`/`light` tiers. Create deck names that model under the brief (`useModels().defaultModel`, display only). The guide chat sends no model either, so it uses its configured tier like the other Vault guides.

`server/utils/userModelSelection.js` still guards the endpoints: an explicit id is accepted only from someone allowed to choose and only if it is a text model in their `vault_models` catalogue, so a hand-made request cannot pick an arbitrary model.

If a provider rejects the key or the call fails, `server/utils/modelCallError.js` turns the raw SDK JSON into one readable message (for example, “The AI provider rejected Vault's key … An admin needs to check the provider API key.”) with HTTP 502 and `code: 'model_call'`. Raw provider JSON is never shown, and a provider failure is never silently replaced by a fallback deck.

---

## Designs and themes

A **design** (`deck.designId`) lays out and decorates every slide: Clean, Underline (accent bar under titles), Banded (titles in a coloured band; title slides get a band across the middle), Sidebar (accent strip down the left), Split (tinted right panel; title slides split into a colour block and text), Framed (inset accent frame), Bold (title, section and closing slides fill with the accent colour) and Corner (accent triangle and dot). Designs are code (`layouts.js` `DESIGNS`) and work with any colour theme. Themes shows them as a gallery of two sample slides each, drawn from the server's own `plan()` in the deck's current colours; Create deck has a Design picker too.

A **colour theme** sets colours, font and title size. Built-in themes are code, not database rows: `paper`, `ink`, `warm`, `ocean`, `forest`, `mono`. Each is a small JSON object: colours, font family, title size and whether to use the Brand Kit logo. A saved theme is a row in `presentation_templates`; importing a `.pptx/.potx` reads colours, fonts and layout hints only — it does not reproduce PowerPoint masters. Brand Kit is applied as an override on top of whatever theme is selected.

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
- `node server/services/presentations/generation.test.js` — outline/slide prompt plumbing, the same validated model for both calls, default-model precedence and friendly provider errors with stubbed models; no network.
- `node server/utils/userModelSelection.test.js` — admin/member permission and configured text-id validation; no database.
- `node server/services/guideCore.test.js` — guide tier fallback, explicit model and friendly provider errors; no database.
- `node server/services/presentations/export.test.js` — PPTX/PDF/PNG generation from a fixture deck, then every layout in every design and aspect: the HTML carries the words and the PPTX builds.
- `node server/services/presentations/layouts.test.js` — the geometry: every shape and box stays on the slide in every design, aspect and layout, circles stay round, column and stats fallbacks; no files.
- `node server/services/presentations/jobs.test.js` — job lifecycle, cancel/resume and the 30-minute result cache.
- `node server/routes/presentations/templates.test.js` — theme sanitising and import rules.
- `node client/src/pages/presentations/presentationGoals.test.mjs` — every job step names a real tool.
- `node server/services/presentationsTutor.test.js` — the guide's catalogue matches `presentationsTools.mjs` (ids, labels, groups, tips), the guide's safety wording, every job step is a real tool and every tool has a (?) box; no model is called.
- `node server/config/guides.test.js` — the guide catalogue (including `presentations`) still resolves.
- `npm run test:nav` and `npm run build` — navigation/route checks and the client build.

Run these directly; no `package.json` script is added (deploy-speed rule).
