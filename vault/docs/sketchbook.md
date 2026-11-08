# Sketchbook

Added 2026-11-08. A person describes a scene, a theory or a possibility (typed or spoken) and the image model draws it as a cartoon. Every picture is saved in the person's own collection, can be changed later with more words (the **same** picture changes, no new one is made), and can be saved as a file. Route `/sketchbook` (the collection) and `/sketchbook/:id` (one sketch). Content Creation in the navigation. Flag **`sketchbook`**, lifecycle **`preview`**, **off by default** (admins can always open it).

It is its own tool, not part of Graphics, because it is project-shaped (a saved collection, a history per picture, follow-up edits) and Graphics' 43 tools are stateless picture-in, picture-out. It reuses Graphics' image generation, spend limits and content restrictions rather than rebuilding them.

## What it does

- **Describe a scene** box on the collection page: words (microphone supported), a look (**Pencil**, **Pen** with one of 7 ink colours, **Coloured in**) and a shape (Wide 1024x768, Square 768x768, Tall 768x1024). **Draw it** makes one picture and opens it.
- **Change this picture**: words in, the same sketch changes. The picture it replaces is kept as an **earlier picture** (last 6, newest first) with the words that replaced it. **Put back** makes an earlier picture current again, restores its look, and keeps the one it replaced, so putting back can itself be undone.
- **Pencil, pen or colour**: redraw the same picture in another look, or **Colour it in** with no words needed.
- **Save or share**: PNG, JPG, WebP (made in the browser from the stored picture; JPG gets a white background) and **Copy picture**. SVG, PDF and print files are reached by saving a PNG and opening it in Graphics (Vectorize, Print Ready).
- Collection: search by name or description, rename, copy (a copy starts with no history), delete (inline Yes/No, 30 days in the shared recycle bin, Undo button). 200 sketches per person.

## Where things are

| Piece | File |
|---|---|
| table `sketches` (`image` current picture, `versions` JSON text of earlier pictures with their look, `changeCount`) | `server/db.js` |
| rules, prompt wording, SQL (all queries by `"userId"`) | `server/services/sketchbook.js` |
| image provider calls (draw, change, price, thumbnail, normalise) | `server/services/sketchbookEngine.js` |
| HTTP | `server/routes/sketchbook.js`, mounted at `/api/sketchbook` behind `requireFeature('sketchbook')` |
| recycle bin | `server/services/recycleBin/adapters/sketchbook.js` (type `sketch`) |
| page | `client/src/pages/SketchbookPage.jsx`, `sketchbook/SketchList.jsx`, `SketchEditor.jsx`, `LookPicker.jsx`, `useSketchOptions.js`, `sketchbookLogic.mjs` |
| tests | `node server/routes/sketchbook.db.test.js` (needs `DATABASE_URL`; wording part runs without), `node client/src/pages/sketchbook/sketchbookLogic.test.mjs` |

## API

`GET /api/sketchbook` (list: previews only), `GET /options`, `GET /cost?kind=draw|change`, `POST /draw { description, style?, penColor?, aspect?, title? }`, `GET /:id`, `POST /:id/change { instruction?, style?, penColor?, baseUpdatedAt? }`, `GET /:id/versions/:vid`, `POST /:id/versions/:vid/restore`, `PUT /:id { title }`, `POST /:id/duplicate`, `DELETE /:id`. Another person's sketch is "not found" (404) on every route. A change from a stale tab is refused with 409 `CHANGED`.

## How a picture is made

- **Words sent to the model** are built in `sketchbook.js` (`buildDrawPrompt`, `buildChangePrompt`). The person's text goes in as the idea; style and pen colour come only from fixed lists, so nothing else the person types reaches a prompt. The prompt-refining step Graphics Generate uses is NOT used: it adds photographic lighting words that fight a cartoon look.
- **Draw** uses the workspace's graphics model and provider exactly as Graphics Generate does (`resolveGraphicsModel`, `generateWithFal` or ComfyUI).
- **Change** on the hosted site uses an instruction-following edit model on FAL: env `SKETCHBOOK_EDIT_MODEL` (default `fal-ai/flux-kontext/dev`), price estimate env `SKETCHBOOK_EDIT_COST_USD` (default 0.03). On a local copy it uses ComfyUI image-to-image, which can only nudge a picture, not follow an exact instruction.
- Pictures are stored as JPEG, longest side at most 1024 px, so the picture sent for the next change stays small.

## Limits and safety

- **Spend:** both POST routes sit behind the Graphics paid-tool guard (`makePaidGuard`): two image jobs at once per person and the rolling 24-hour cap (`GRAPHICS_DAILY_COST_CAP_USD`, default $5). Usage is logged as `graphics_sketchbook`, so it shows on the Usage dashboard and shares the daily limit with Graphics. The collection and editor show the price and the limit left before the button is pressed.
- **Content restrictions** (Settings, admin) are checked on the whole prompt; a restricted idea answers 422 `CONTENT_RESTRICTED`.
- **Room is checked before paying** for a picture, so a person at 200 sketches is not charged for one that cannot be kept.
- **A provider failure** shows a plain message ("Nothing was charged to you"); the provider's own text is logged, never shown.
- **Recycle bin:** a sketch and its earlier pictures go in together (up to 16 MB).

## Not built yet (said honestly)

- **To Notes** (the same way Diagrams does it: new note, attached PNG, link back). Asked for as a later step.
- **Drawing or painting by hand** on the picture (pens, colouring-in tools). Today pencil, pen and colour are looks the AI draws, and any sketch can be redrawn or coloured in.
- **Several pictures in a row** (a comic strip) and **the same character across pictures**.
- **Guide chat, tour and Feature Access tour entry**: not written yet (the (i) box is).
- **PDF and SVG export inside the tool**.
- **Not tried with the live image service.** The screens and the flow were checked against a stand-in that draws simple shapes. The default edit model id and how well it follows instructions on a cartoon are unproven until an admin switches the flag on and tries it on Railway.
