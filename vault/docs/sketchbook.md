# Sketchbook

Added 2026-11-08. A person describes a scene, a theory or a possibility (typed or spoken) and the image model draws it as a cartoon. Every picture is saved in the person's own collection, can be changed later with more words (the **same** picture changes, no new one is made), and can be saved as a file. Route `/sketchbook` (the collection) and `/sketchbook/:id` (one sketch). Content Creation in the navigation. Flag **`sketchbook`**, lifecycle **`preview`**, **off by default** (admins can always open it).

It is its own tool, not part of Graphics, because it is project-shaped (a saved collection, a history per picture, follow-up edits) and Graphics' 43 tools are stateless picture-in, picture-out. It reuses Graphics' image generation, spend limits and content restrictions rather than rebuilding them.

## What it does

- **Describe a scene** box on the collection page: words (microphone supported), a look (**Pencil**, **Pen** with one of 7 ink colours, **Coloured in**) and a shape (Wide 1024x768, Square 768x768, Tall 768x1024). **Draw it** makes one picture and opens it.
- **Change this picture**: words in, the same sketch changes. The picture it replaces is kept as an **earlier picture** (last 6, newest first) with the words that replaced it. **Put back** makes an earlier picture current again, restores its look, and keeps the one it replaced, so putting back can itself be undone.
- **Pencil, pen or colour**: redraw the same picture in another look, or **Colour it in** with no words needed.
- **Save or share**: PNG, JPG, WebP (made in the browser from the stored picture; JPG gets a white background) and **Copy picture**. SVG, PDF and print files are reached by saving a PNG and opening it in Graphics (Vectorize, Print Ready).
- **To Notes, a two-way link** (same design as Diagrams): `saveSketchToNotes.mjs` makes a new note named after the sketch (optionally filed under a project or client), attaches a PNG, and writes `{picture:N}` and a link back (`From the sketch [Title](/sketchbook/ID)`, `sketchNoteBody` in `pages/notes/notePictures.mjs`) into the note, using only existing Notes routes. The note's own text is the record of the link, so nothing extra is stored: `GET /api/sketchbook/:id/notes` finds the person's notes containing `](/sketchbook/ID)` (matched with the closing bracket, so /sketchbook/7 never matches /sketchbook/70; newest first, at most 20), and `GET /api/sketchbook` adds `noteCount` to every row from one pass over the notes (a note linking twice counts once). **The buttons follow the state:** no note -> **To Notes** (opens a box to file the note, then **Save to Notes**); one note -> **Go to note** (straight there) plus **Put in another note**; several -> **In N notes** with a list of **Go to** entries plus **Put in another note**. Each card in the collection shows **In a note** / **In N notes** when `noteCount > 0` (one goes straight there, several show a short list). A deleted note or a removed link makes the button go back to To Notes; a note linked by hand with the same link counts. From the note, the link goes back to the sketch. A later change to a sketch is not copied into an earlier note (Put in another note makes a fresh one). Test: `node client/src/pages/sketchbook/saveSketchToNotes.test.mjs`, and the link lookup is in `sketchbook.db.test.js`.
- **Help:** the (i) box, a 6-step tour (Settings -> tours, key `vault_tour_sketchbook_completed`, `/sketchbook?tour=1`, `client/src/utils/tours/sketchbookTour.js`), a tooltip on every control, the microphone on every text box, and the **Sketchbook guide** round button (`guideId` `sketchbook`, `POST /api/sketchbook-tutor`, `server/services/sketchbookTutor.js` on `guideCore.js`, wrapper `SketchbookTutorChat.jsx`, flag `sketchbook`). The guide sees no sketches. `client/src/pages/sketchbook/sketchbookTools.mjs` is the list of views and controls the page and the guide share; `node server/services/sketchbookTutor.test.js` (tested with `guideTestKit.js`) fails if it and the guide's catalogue drift apart. When a Sketchbook control is added or changed, update `sketchbookTools.mjs` and `CATALOG` together.
- Collection: search by name or description, rename, copy (a copy starts with no history), delete (inline Yes/No, 30 days in the shared recycle bin, Undo button). 200 sketches per person.

## Where things are

| Piece | File |
|---|---|
| table `sketches` (`image` current picture, `versions` JSON text of earlier pictures with their look, `changeCount`) | `server/db.js` |
| rules, prompt wording, SQL (all queries by `"userId"`) | `server/services/sketchbook.js` |
| image provider calls (draw, change, price, thumbnail, normalise) | `server/services/sketchbookEngine.js` |
| HTTP | `server/routes/sketchbook.js`, mounted at `/api/sketchbook` behind `requireFeature('sketchbook')` |
| recycle bin | `server/services/recycleBin/adapters/sketchbook.js` (type `sketch`) |
| page | `client/src/pages/SketchbookPage.jsx`, `sketchbook/SketchList.jsx`, `SketchEditor.jsx`, `LookPicker.jsx`, `useSketchOptions.js`, `sketchbookLogic.mjs`, `saveSketchToNotes.mjs`, `sketchbookTools.mjs`, `SketchbookTutorChat.jsx` |
| guide and tour | `server/services/sketchbookTutor.js`, `server/routes/sketchbookTutor.js` (`/api/sketchbook-tutor`), `server/config/guides.js`, `client/src/utils/tours/sketchbookTour.js` |
| tests | `node server/routes/sketchbook.db.test.js` (needs `DATABASE_URL`; wording part runs without), `node client/src/pages/sketchbook/sketchbookLogic.test.mjs`, `saveSketchToNotes.test.mjs`, `node server/services/sketchbookTutor.test.js`, `npm run test:guides` |

## API

`GET /api/sketchbook` (list: previews and `noteCount` only), `GET /options`, `GET /cost?kind=draw|change`, `POST /draw { description, style?, penColor?, aspect?, title? }`, `GET /:id`, `GET /:id/notes`, `POST /:id/change { instruction?, style?, penColor?, baseUpdatedAt? }`, `GET /:id/versions/:vid`, `POST /:id/versions/:vid/restore`, `PUT /:id { title }`, `POST /:id/duplicate`, `DELETE /:id`. Another person's sketch is "not found" (404) on every route. A change from a stale tab is refused with 409 `CHANGED`.

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

- **Drawing or painting by hand** on the picture (pens, colouring-in tools). Today pencil, pen and colour are looks the AI draws, and any sketch can be redrawn or coloured in.
- **Several pictures in a row** (a comic strip) and **the same character across pictures**.
- **The guide chat was checked on screen to open and show its starter questions, but no question was sent to a real model** (no AI key locally); its logic is covered by `sketchbookTutor.test.js` with a stand-in model.
- **PDF and SVG export inside the tool**.
- **Not tried with the live image service.** The screens and the flow were checked against a stand-in that draws simple shapes. The default edit model id and how well it follows instructions on a cartoon are unproven until an admin switches the flag on and tries it on Railway.
