# Drawings (Excalidraw in Vault)

Added 2026-11-08. A person's own saved drawings, drawn on the real **Excalidraw** editor (MIT licence, `@excalidraw/excalidraw` 0.18, a React component). Route `/drawings` (the list) and `/drawings/:id` (one drawing). Content Creation in the navigation. Flag **`drawings`**, lifecycle **`preview`**, **off by default** (admins can always open it; switch it on for members in Settings → Feature Access once it has been seen working on Railway).

## What it does

- A list of the person's drawings with a small JPEG preview, name, piece count and last change; **New drawing**, **Open a file** (an `.excalidraw` file becomes a new drawing), search by name (with the microphone), **Rename**, **Copy**, **Delete** (inline "Delete? Yes / No", then a toast with **Undo**; the shared recycle bin keeps it 30 days).
- One drawing opens on the editor. It **saves by itself** 1.5 s after the last change, and again on leaving. The words beside the name say Saving / Saved at / Changes not saved yet. **PNG**, **SVG** and **File** (`.excalidraw`) export to the person's computer (PNG and SVG embed the scene, so they can be opened again in Excalidraw).
- Excalidraw's own menu is replaced with a short one (save as image, clear the page, light/dark, page colour, help). Its live-collaboration button, its paid-plan links and its social links are not shown. Light or dark follows Vault's theme on first open and is then kept in the drawing.
- **Draw it for me** (added 2026-11-08): say (microphone) or type a scenario and the AI develops a diagram from it; see "Draw it for me" below.
- **Sketch / Clean look** (added 2026-11-08, same day): two buttons above the board switch the whole drawing between Excalidraw's hand-drawn style and a conservative one (steady straight lines, square corners, straight arrows, solid fills instead of hatching, a plain font, Vault's text colour for lines). It is **reversible**: when a piece goes clean it remembers how it was drawn in its own `customData.vaultLook.sketch` (Excalidraw saves this with the scene), and Sketch puts exactly that back; Undo also works (`CaptureUpdateAction.IMMEDIATELY`). Pieces drawn while clean have nothing remembered and get ordinary sketch settings on the way back. New pieces start in the drawing's look (the editor's `currentItem*` settings). The look is stored in the `look` column and shown on each card in the list. Logic: `client/src/pages/drawings/lookConvert.mjs` (pure, tested).
- **Pictures: same / clean / sketch** (next to PNG and SVG): the exported PNG or SVG, and the picture sent to Notes, can be in either look without changing the drawing. The `.excalidraw` file is always the drawing as it is.
- **To Notes** (`saveDrawingToNotes.mjs`): makes a new note named after the drawing (optionally filed under a project or client, as in YouTube's Save to Notes), attaches a PNG, and writes `{picture:N}` (N = the attachment) and a link back to the drawing into the note. Uses only existing Notes routes (`POST /api/notes`, `POST /api/notes/:id/attachments`, `PUT /api/notes/:id`). Preview shows the picture inside the note (see "Pictures in notes" in `docs/notes.md`). A new note each time; later changes to the drawing are not copied. **Back to the note:** the editor shows an **In a note** button (or **In N notes** with a short list) that goes to the note; `GET /api/drawings/:id/notes` finds the person's notes whose text contains `](/drawings/ID)` (the link To Notes writes, matched with the closing bracket so /drawings/7 never matches /drawings/70), newest first, at most 20. No new table: the note's own text is the record, so deleting a note or removing its link makes the button go away, and a note the person linked by hand counts too. Anything waiting is saved before going. **On the list:** each card shows the same button when `noteCount > 0`; `GET /api/drawings` adds `noteCount` to every row from ONE pass over the person's notes (`noteCounts`: `regexp_matches` over the notes that contain `](/drawings/`), not one search per drawing; a note linking twice counts once. One note goes straight there, several open a short list under the card's buttons (fetched from `/:id/notes` on click).
- The Drawings guide (round button), the (i) box, a 6-step tour (also in Settings → tours), tooltips on every Vault control, and the microphone on the name and search boxes.

## Where things are

| Piece | File |
|---|---|
| table `drawings` (`userId`, `title`, `scene` TEXT, `thumbnail`, `look`, `elementCount`, `sceneBytes`, dates) | `server/db.js`, `docs/schema-notes.md` |
| rules and SQL (all queries by `"userId"`) | `server/services/drawings.js` |
| HTTP | `server/routes/drawings.js`, mounted at `/api/drawings` behind `requireFeature('drawings')` |
| recycle bin | `server/services/recycleBin/adapters/drawings.js` (type `drawing`) |
| guide | `server/services/drawingsTutor.js`, `server/routes/drawingsTutor.js` (`/api/drawings-tutor`), `client/src/pages/drawings/drawingsTools.mjs`, `DrawingsTutorChat.jsx` |
| page | `client/src/pages/DrawingsPage.jsx`, `client/src/pages/drawings/DrawingsList.jsx`, `DrawingEditor.jsx`, `sceneLogic.mjs` |
| loading the editor | `client/src/pages/drawings/loadExcalidraw.js` (loaded only when a drawing is opened) |
| fonts from our own origin | `client/vite/excalidrawAssets.mjs` (a Vite plugin, like `planner-core/vite/ocrAssets.mjs`) |
| tour | `client/src/utils/tours/drawingsTour.js` |

## API

`GET /api/drawings` (list, no scenes), `POST /api/drawings` (`{ title?, scene?, thumbnail? }`), `GET /api/drawings/:id` (with the scene), `PUT /api/drawings/:id` (`{ title?, scene?, thumbnail?, baseUpdatedAt? }`), `POST /api/drawings/:id/duplicate`, `DELETE /api/drawings/:id` (into the recycle bin). A drawing that is not the caller's is "not found" (404) on every route.

- **Limits** (`services/drawings.js`): scene up to **6 MB** (413 with a plain message, usually pasted pictures), up to 20,000 pieces, 300 drawings per person, title 120 characters, preview 150 KB. The scene must be an Excalidraw scene (`type: "excalidraw"`, an `elements` array).
- **Two tabs:** `baseUpdatedAt` is the "updatedAt" the page last saw. If the drawing changed since, the save is refused with **409 `CHANGED`** and the page stops saving and asks for a reload, so one tab never overwrites another silently.
- **Recycle bin:** a deleted drawing is snapshotted in the same transaction (up to 8 MB; a bigger one is not deleted at all and the person is told why). Restore re-checks the scene and the 300 cap.

## Draw it for me (dictate a scenario, get a diagram)

A button above the board opens a box (a dictation-ready text area, the shared microphone field). The person says or types a scenario ("A customer calls, the receptionist books a visit, the surveyor attends, then we send the quote. If the customer says no, we close the job."), presses **Draw it**, and a diagram appears on the drawing as ordinary Excalidraw pieces they can move and edit. **One Undo (the board's Undo button) removes the whole diagram.**

- **Structure, not pictures.** `POST /api/drawings/diagram` (`{ text }`, or `{ previous, instruction }` to change the last one) -> `{ diagram }`, in `server/services/drawingDiagram.js`. The model is asked for ONLY a structure: `kind` (flow, org, mindmap, timeline, relationship), `direction` (down | right), `nodes` (id, short label, shape box | decision | start-end) and `edges` (from, to, optional label). It never chooses positions. Up to 40 nodes and 80 arrows; labels 60 characters. It uses one call on the workspace's **`standard`** model (`getModelsForUser`, never a hardcoded id), behind `aiLimiter`, usage logged as feature `drawing_diagram`.
- **The model's answer is untrusted** (`normalizeDiagram`): parsed with `extractJson`, ids made safe and unique, labels trimmed, unknown shapes become boxes, arrows only between boxes that exist (no self loops or repeats), a timeline with no arrows becomes a chain, nothing usable gives a plain 422/502 message and never the model's raw text. The person's words go in a `<description>` fence the person cannot close, and the system prompt says to treat them as content, never instructions, and to use only what was described.
- **What the model sees:** only the words typed or said in the box (and, to change a diagram, the structure it made itself). Never any drawing. The panel says so.
- **Layout is ours** (`client/src/pages/drawings/diagramLayout.mjs`, pure and tested): boxes in layers (longest path, cycles tolerated, so "no, try again" loops do not break it), ordered by their parents' positions, sized to wrapped labels (a diamond and an ellipse get more room), arrows clipped to box edges and bound to the boxes (`start` / `end`). It goes through Excalidraw's own `convertToExcalidrawElements`, so the result is normal pieces.
- **Placement:** below whatever is already on the drawing (left edge aligned), or at the top left of the screen on an empty drawing, then zoomed to fit but never zoomed IN (`fitToContent`; `fitToViewport` zoomed a small org chart to 310%). The panel closes after drawing so the diagram gets the whole board.
- **Look:** drawn in the drawing's own look (Clean runs `toClean` over the new pieces, so switching to Sketch later restores sketch values).
- **Change it:** every generated piece carries `customData.vaultDiagram.run`. A change asks the model for the whole updated diagram, then deletes the pieces of the last run (and their labels) and draws the new one in the same place; anything drawn by hand around it is untouched, but hand edits to the generated pieces are replaced (the panel says so). The structure to change is kept in memory for this visit only; after the drawing is closed the person describes again. **Start fresh** forgets it.
- **Cost:** one model call per Draw it or Change it (a few thousand tokens at most), shown as "This uses one AI request" in the panel and logged in Usage.
- **Limits, stated honestly:** flows, org charts, mind maps, timelines and relationship diagrams. NOT drawings to scale (a floor plan, a map), illustrations, or reading or tidying a drawing the person made. A description over 4,000 characters is refused.
- **Tests:** `node server/services/drawingDiagram.test.js` (the checking, the fence, the prompt, ask() with a stand-in model, refusals, bad replies) and `node client/src/pages/drawings/diagramLayout.test.mjs` (layers, loops, no overlaps for 40 boxes and a 30-branch star, arrows on box edges, run tags). A real model was NOT tried (no key locally): the screen was checked with a stand-in that returns fixed diagrams (flow with a decision, an org chart, a change that adds a box), including Clean look, change-replaces-last, reload, and Undo.
- **Gotcha found while testing:** the keyboard Ctrl+Z sent by the browser-automation tool did not reach the board; the on-screen Undo button did (one press removed 11 pieces). Editing code while testing hot-reloads the page and empties the undo history, so test Undo without saving code in between.

## Stretching, two-way arrows, loops and the grid (added 2026-11-08, from the first real use)

- **Keep shape / Free** (toolbar, remembered in `localStorage` `vault:drawings:keepShape`, default Free = the board's own behaviour). The board keeps a stretched selection's proportions only while Shift is held (`shouldMaintainAspectRatio = event.shiftKey`, read on pointermove and pointerup). `DrawingEditor` adds window capture listeners that, for a stretch only, redefine `event.shiftKey` on the event: Keep shape makes it "held", Free leaves it native, and a real Shift does the opposite for that drag. A stretch is recognised by `appState.isResizing` OR by the press having started on a resize cursor (the board only sets `isResizing` during the first movement, so a one-jump drag was missed without the cursor check). Pictures are left alone (the board already inverts Shift for them). Works for one piece or everything selected. Verified: the same drag on a 831x210 diagram gave a free result in Free mode (ratio 2.21 to 3.96) and 1076x272 with the ratio held at 3.957 in Keep shape.
- **Two-way arrow:** a button, enabled when arrows are selected; sets `startArrowhead` (the board's own arrowhead choice in its left panel does the same). Draw it for me makes two-way arrows too: the model may set `both: true` on an edge, and an arrow each way between the same two boxes is merged into one two-way arrow (`normalizeDiagram`).
- **Loops:** the structure already allowed an arrow back to an earlier step. The layout now routes such an arrow round the OUTSIDE of the diagram with sharp corners (one lane per loop), leaving from the side, or from underneath when a box sits beside the source (a straight sideways exit ran through its neighbour in the first version); a forward arrow that skips layers is routed round only when a straight line would cross a box. Left to right, loops run underneath. Tests check no loop path passes through a box in either direction. The model is told loops are fine.
- **Snap to grid:** toggles the board's own `gridModeEnabled` (it shows the grid and snaps drawing and moving to it); saved in the scene's appState and part of the save fingerprint so switching it is saved even with no other change. One fixed grid size.
- **Undo / Redo** (toolbar, `data-testid` buttons of the board's own history): the board keeps an unlimited-depth history per visit (each draw, move, stretch, look switch and diagram is a step; a diagram is one step). Our big buttons click the board's small ones and read their disabled state every 400 ms; `handleKeyboardGlobally` makes Ctrl+Z / Ctrl+Shift+Z work anywhere on the page. History is not saved: it starts empty on open. Verified on screen: diagram then Clean = two undos back to empty, two redos forward.
- Decision diamonds are laid out larger (1.8 x 1.9) so their writing stays on one line.

## What "Clean" can and cannot do (be honest about it)

- **Vault's colours:** only the line colour. Excalidraw's own default black becomes Vault's `--color-text` **in a light theme** (a dark Vault theme leaves it alone, because Excalidraw's dark mode inverts colours, so a light line colour chosen for a dark page would come out dark). A colour the person chose is never replaced, and fills keep their colours.
- **Fonts:** the board cannot load Vault's DM Sans or any CSS font; it has a fixed set. Clean uses Excalidraw's plain `Helvetica` family (id 2); Sketch uses Excalifont (id 5). No arbitrary CSS.
- **Arrows:** existing arrows become straight (curve removed). Right-angled ("elbow") arrows are available for NEW arrows through the arrow-type choice in the left panel; converting existing arrows to right-angled is not done (re-routing them reliably is not possible from outside the editor).
- **Not changed:** freehand pen strokes (they are the person's hand), pictures and embeds. Text is re-measured after the font changes (`restoreElements(..., { refreshDimensions: true })` once the fonts are in).
- Switching changes each piece's `version` and `versionNonce` (so Excalidraw and the save notice the change) and goes to the server like any edit.

## Things that went wrong and are now guarded (read before changing the editor code)

- **Never save from the editor object while leaving the page.** When the page is left, Excalidraw is already torn down and reports an empty drawing; an early version saved that empty scene over the real one (found by opening the screen, 2026-11-08). Saves now read `latestRef`, the newest `{ elements, appState, files }` the editor reported through `onChange`, and ignore reports after the page is left (`leftRef`).
- **Tailwind needs the project root.** Build with `npx vite build --config client/vite.config.js` from `vault/` (this is what `npm run build` does). Building from `client/` drops nearly every style.
- **The page is the same component for the list and for a drawing** (two routes, one `DrawingsPage`), so effects that must run "when the view changes" (the `?tour=1` start) depend on the search params and the view, not `[]`.
- A drawing brought in from a file has no preview; opening it makes the first save, which adds one (`needsPreviewRef`).

## Security and the Content Security Policy

- The page reaches no outside host. Excalidraw fetches fonts from `esm.sh` by default; `loadExcalidraw.js` sets `window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/'` before the editor is imported, and the Vite plugin serves and builds `excalidraw-assets/fonts/**` from the package (234 files, 14 MB, only the ones a drawing uses are fetched). The fonts shown on the canvas are bundled by Vite itself.
- **One known violation:** Excalidraw's font-subsetting helper (HarfBuzz compiled to WebAssembly) builds code with `eval`, which the production policy (`script-src 'self' 'wasm-unsafe-eval' blob:`) forbids. Seen in production mode (`NODE_ENV=production`, 2026-11-08): the console reports `script-src eval`, drawing and saving are unaffected, and exports still work (PNG, SVG and file all produced), but exported SVG fonts are probably embedded whole rather than trimmed to the letters used. **Decision: accepted; the policy is not loosened for the whole site.** The CSP is off in development, so this only shows in production mode.
- Scenes are stored and returned as text and are only ever parsed by Excalidraw in the browser; the server only checks the shape and size.

## Tests

- `node server/services/drawings.test.js` (pure rules; with `DATABASE_URL` set to a scratch Postgres, also the service and the routes over HTTP in a throw-away schema using the real table definitions: create, list, get, partial save, the 409 guard, copy, the 300 cap, delete into the recycle bin, restore with the same id, a too-big drawing not deleted, another person getting 404 everywhere).
- `node server/services/drawingsTutor.test.js` (the guide against `drawingsTools.mjs`).
- `node client/src/pages/drawings/sceneLogic.test.mjs` (change fingerprint, file names, colours, file checks, search).
- `node client/src/pages/drawings/lookConvert.test.mjs` (Sketch to Clean and back: exact restoration through three round trips, own colours kept, pen and pictures untouched, versions bumped, inputs not changed).
- `node client/src/pages/drawings/saveDrawingToNotes.test.mjs` (the three steps, a failing step at each point, safe names), `node client/src/pages/notes/notePictures.test.mjs` (the marker, code blocks, line numbers).
- `DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_xuser node server/routes/crossUserOwnership.test.js` covers the routes automatically (every table with a `"userId"` is seeded and probed).

## Measured and not measured

- Local (Windows 10), 2026-11-08: the editor opens in about a second after the first load; opening it fetches roughly 5 MB of script (compresses well); `vite build` takes about 12 s with it. A drawing of a few pieces saves a few KB of scene and a 5 to 10 KB preview.
- **Not measured:** the Railway container (memory, first-load time behind the gateway, font requests), a drawing with many large pictures, a drawing of thousands of pieces, a phone or touch screen (Excalidraw supports touch; the Vault layout around it was only looked at on a wide screen), Cancel-free long sessions (autosave while offline: it retries every 6 s and keeps the drawing on screen, tested only by reading the code).

## Not included yet

Live co-editing and share links (they belong to excalidraw.com, not the package), sending a drawing into Graphics or Chat, adding a drawing to an EXISTING note, converting a drawing's look from the list without opening it (the text needs the editor to be measured), folders or tags, searching inside a drawing, drawings to scale made from words (a floor plan), the AI reading or tidying a drawing the person made. Export a picture for now.

## Deploy note

Adding `@excalidraw/excalidraw` changed `package.json` and `package-lock.json`, so the first push after it is a **slow deploy** (see `docs/deploy-speed.md`, layer 4 onwards). Say so before pushing.
