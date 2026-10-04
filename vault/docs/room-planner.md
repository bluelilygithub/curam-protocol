# Room Planner

Professional interior-design room planner. Standalone app in `vault/room-planner/`, shown inside Vault as the **Room Planner** page
(`/room-planner`, Apps launcher → Content Creation, armchair icon, feature flag `roomPlanner`, allow-by-default).

**How it is wired** (same idea as the WP Theme Builder): the planner is its own Vite app with base `/room-planner-app/`. The root
`npm run build` builds Vault, then `scripts/buildRoomPlanner.js` builds the planner into `dist/room-planner-app/`; Express already serves
`dist/`. `client/src/pages/RoomPlannerPage.jsx` embeds it in an iframe, and shows a plain notice if the planner build is missing
(the planner build is non-fatal so it can never break a Vault deploy). It has no server API: projects live in the browser's
localStorage and `.json` files. The page route and the app path differ on purpose, so a hard load of `/room-planner` reaches Vault's router.
Locally: run `npm run dev` inside `room-planner/` too; the Vault client dev server proxies `/room-planner-app` to it.

## Principle
One authoritative domain model. 2D (Konva) and 3D (React Three Fiber) are independent renderers of it; neither owns design
state. The domain is a pure TypeScript engine with no UI code.

## Status
| Milestone | Scope | State |
|---|---|---|
| M1 | Pure spatial core `src/engine/`, tests, scenario fixtures | **Done** (332 tests, ~99.5 % line coverage) |
| M2 | First 2D editing loop (Vite + React + Konva + Zustand), designer demo | **Built, awaiting the designer demo** (530 tests + browser e2e) |
| M3 | Wall / corner editing, draw a room, set room size, impact preview | **On `staging`** (631 unit/property/gate tests + browser e2e) |
| M4 | 3D (R3F), shared selection, mitred wall corners in 3D, saved viewpoints, drag along the floor | **Built, awaiting review** (3D geometry, gates, perf and browser e2e; see below) |
| M4.5 | **Cinematic mode** (Spec Addition A1, `specs/05-spec-addition-cinematic.md`): **clay look** (decided and confirmed), Quality low/high, fly-through from saved views, walk mode with collision. **C2, C3 and C4 built** (C2 + C3 are on `staging`; walk mode awaiting review); C5 "See an example" (lowest) still to do | **In progress** |
| M4.6 | **Realistic look** (Spec Addition A2, `specs/06-spec-addition-photo.md`): better furniture shapes, generated textures, finishes as data, `Clay | Realistic` switch in Cinematic | **Built, awaiting owner check of stills** |
| M4.7 | **Render photo** (A2): path-traced still image of the open room for client presentation; camera / lighting / size / quality, progressive render, PNG download with optional caption | **Built; on `staging`; owner timing on a laptop outstanding** |
| M4.10 | **Plants settle on surfaces; ceiling lights and a Lights switch; ambient Sound in 3D** | **Built; awaiting push** |
| M4.9 | **Snap controls** (Smart / Grid only / Off, grid size, grid from the room corner, Alt to bypass) and **wall art stage 1** (7 hanging pieces with generated artworks and mirrors) | **Built; awaiting push** |
| M4.8 | **Library, rugs, colour palettes, photo polish**: 17 new pieces (29 in all, incl. rugs, plants, lamp, mirror), 8 room colour palettes, Render photo expectation line + named progress steps + eye-level "inside the room" views, plus the help system (tour, How This Works, themed tooltips) | **On `staging`** |
| M5 | **Plan library** (saved projects in Vault's database, several rooms per project: **built, awaiting review**); **export** (PDF, PNG/JPG, SVG, CSV/XLSX, plain 2D DXF, glTF after M4), furniture schedule (**not started**) | **Library built; export not started** |

### M5 scope: the plan library (owner decision 2026-10-03)
Today a plan lives only in the browser's localStorage plus downloadable `.json` files; there is no library. M5 adds one, as a database table (the same idea as My Fonts / `font_projects`, not a browser-only list):
- **Table `room_projects`** (`id`, `"userId"`, `name`, `"projectJson"` JSONB = the serialised `Project`, `"schemaVersion"`, `"thumbnail"` optional, `"createdAt"`, `"updatedAt"`); every query filters by `"userId"`; idempotent DDL in `server/db.js`.
- **API** `/api/room-projects` (list, get, create, update, rename, duplicate, delete), behind `requireAuth` + `requireFeature('roomPlanner')`; named routes before `/:id`. Revision/updatedAt check so two tabs cannot silently overwrite each other (the spec's cloud-ready serialisation: stable project id, `schemaVersion`, `revision`).
- **Planner side:** a "My plans" list (open, rename, duplicate, delete, thumbnail), "Save to library" and autosave to the open plan. Because the planner runs in an iframe with no auth of its own, it talks to the API through the Vault page (postMessage bridge) or through same-origin requests that reuse Vault's token; to be decided when M5 starts.
- **Kept:** `.json` download/upload and the browser autosave as the offline fallback. Undo history is still never saved.
- **Not in scope:** sharing, collaboration, versions/alternatives (Spec P2/P3).

### M5 scope: export (owner request 2026-10-03: "PDF and any major formats")
Exports are built from the domain model (Spec §10), never from screenshots, so they stay accurate at any scale. Proposed set, in priority order:

| Format | What it is for | Plan |
|---|---|---|
| **PDF** | The deliverable: floor plan to scale (dimensions, labels, room area, wall thicknesses, doors/windows with swings, furniture with tags) plus the furniture **schedule** (Tag, Item, Dimensions, Finish, Vendor/SKU) and a materials/finishes list. Paper size and scale selectable (A4/A3/Letter, 1:20–1:100). | M5 core (Spec P0) |
| **PNG / JPG** | Quick image of the 2D plan; the 3D view image once M4 exists. | M5 core (Spec P0) |
| **SVG** | Vector plan for editing in Illustrator/Figma/Inkscape, or for web. | M5 core (cheap: same drawing code as PDF) |
| **CSV (and XLSX)** | The schedule and costs (unit cost × quantity) for quoting and spreadsheets. | M5 core |
| **JSON** | Native project file (already exists). | Done |
| **DXF** (2D) | Hand the plan to CAD users: walls, openings, furniture outlines on named layers (Architecture, Furniture, Fixtures, Annotations, Measurements, matching the spec's layer set). | M5 stretch. **Spec says "sophisticated DXF" is Deferred**; a plain 2D export is small, but confirm before building and record it in Appendix C as an override. |
| **glTF / GLB** (3D) | Open in Blender, SketchUp, web viewers, AR. | After M4; Spec lists the glTF path under P2. |
| **OBJ** | Older 3D interchange. | Only if asked; glTF covers it. |
| **DWG, RVT, IFC (BIM)** | DWG is proprietary (DXF is the practical route); RVT/IFC need a BIM model the planner does not have. | Not planned; revisit only on a concrete client need. |

Open points to settle at M5 start: where PDF is produced (client-side with the same drawing code, or server-side like Finance's `invoicePdf.js` via react-pdf, which Vault already ships); font embedding; whether exports from the library (saved plans) can be re-generated without opening the plan; and which paper sizes/scales to offer.

### Library, rugs and colour palettes

The Library has 36 pieces, including plants, a floor lamp, a floor mirror and three rugs. Furniture can stand on a rug (rugs are not checked for overlap, clearance or door swing, only for staying inside the room). Pick a colour palette for a room in the Inspector (nothing selected) or from **Palette** in the 3D bar: it colours the walls, floor, trim, sofas, wood and rugs together in the 3D view and in Render photo; a finish you chose for a piece is kept. Not shown in Clay or in the plan.

**Wall art:** seven pieces (paintings, prints, photos, a wall mirror and a round mirror) that hang flat on a wall at a set height (`defaultElevation`; change it with Elevation in the Inspector). The artworks are generated in code (`render3d/artData.ts`), so no image files or licences; mirrors are real reflective surfaces in Render photo. Your own photos in a frame are not built yet.

**Ceiling lights, plants on surfaces, sound:** three ceiling fixtures (ceiling light, pendant, downlight) start hanging from the room's ceiling height and, with the floor lamp, give off light in the Realistic look and Render photo (point lights, warm, no shadows); the **Lights** button in the 3D bar switches them. A small plant settles on whatever is under its centre (a side table, sideboard, shelf up to 1.6 m) and takes that height as one undoable step; moving the table or sideboard carries the plants on it. **Sound** in the 3D bar plays soothing ambient sound while the 3D view shows: Gentle rain, Ocean waves, Forest breeze or Calm music, with a volume slider. The sounds are synthesised in the browser (noise, filters, slow oscillators), so there are no audio files; the choice and volume are remembered, and browsers start sound only after a click, which the planner handles.

### Snapping

The **Snap** list in the toolbar: **Smart** (walls, corners, furniture edges and centres, alignment, grid), **Grid only** (a dragged piece's nearest edges land on grid lines) or **Off**; **Grid** sets 5, 10, 25 or 50 cm. The grid is measured from the room's first corner, and the 2D grid lines are drawn from it. Hold **Alt** while dragging to skip snapping for one move. The choice is remembered per browser. Corner and room-drawing drags honour Off, Grid only and Alt but keep the plan origin as the grid start.

### Help

The compass beside the title starts a guided tour (11 steps); the (i) opens How This Works, which also opens by itself the first time. Hover any button or field for an explanation. Vault's Settings page has a Room Planner Tour card to retake the tour.

### Render photo (M4.7)

In the 3D view press **Render photo**. A line under the title says what to expect. Pick the view (the current 3D view, an eye-level "Inside the room" view from the entrance or a corner, or any saved view), the lighting (Daylight, Overcast, Evening), the size (640 × 360 quick look up to 4K; 1280 × 720 is the default) and the quality (Draft 64 passes, Good 256, Best 1024), then **Render**. The first few seconds are spent preparing (the panel names each step and shows a quick flat preview); then the picture starts grainy and sharpens while it works; a bar shows the progress and the time left, measured from the real speed. **Pause**, **Stop** (keeps the picture so far) and **Download PNG** (with an optional caption: project, room, date; file name `<project>-<room>-<date>.png`). Esc stops a render, then closes the panel. Your design is never changed; if it changes while rendering, the render stops. It needs WebGL2 with float render targets; otherwise the panel says so and the Realistic 3D view still works. Draft is visibly grainy in shaded areas; use Good for a client. Cut-away walls are left out of the picture just as in Cinematic, so the room is lit from the camera's side.

## Where things are
- `room-planner/README.md` — module table, how to run.
- `room-planner/TESTING.md` — test layout, binding rules, milestone gates.
- `room-planner/DECISIONS.md` — engine decisions awaiting owner review (D4/D5 provisional, in plain words), the M2 UI decisions D15–D25, M3 D26–D36 and M4 (3D) D37–D49.
- `specs/` — Spec V2 Rev 4, **Spec Addition A1 (Cinematic, `05-spec-addition-cinematic.md`)**, Phase 1 Rev 3, Appendix B, **Appendix C (binding; wins on conflict)**, Test Plan v1.0.
  `04-appendix-c-resolutions.md` is the current text (C1–C22); the Appendix C PDF is older.

## Designer demo (M2) — about ten minutes
In Vault open **Room Planner** from the Apps launcher (Content Creation), or run `npm run dev` in `vault/room-planner` and open http://127.0.0.1:5174/room-planner-app/. This is the Spec §11 early-validation loop minus 3D and PDF.
1. **Start from a rectangle.** Click a wall, then set unequal **thickness** in the inspector (e.g. 150 / 200 / 150 / 100 mm). Corners are mitred.
2. **Door and window.** Pick them in the library; the ghost snaps to the nearest wall, turns red where it does not fit. Click to place. `H` flips the hinge. Click a door to edit width, hinge, swing, offset.
3. **Sofa and coffee table.** Pick, move (ghost follows), `R` rotates 45°, click to place. Drag objects; live dimensions show distances. Drag one into a wall: it turns red, a message says why, and on release it slides back.
4. **Clearances.** Select the sofa and toggle the dashed-square button: soft clearance zones appear. Put the table inside it: amber, not blocked.
5. **High object.** Place the wardrobe or bookshelf: it is drawn **dashed** (above the 1.2 m cut-plane).
6. **Inspect.** Edit dimensions (type `2.4`, `2400mm` or `240cm`), vendor/SKU/cost, lock an object. Select several (drag a box, or shift-click) and edit "Mixed" fields.
7. Undo/redo (buttons name the action), **Measure** (key `4`), save / open a `.json` file. Reload: the project is back, undo history starts fresh.

### Walls tool (M3), key `3`
- **Draw a room:** empty project → *Draw a room*. Click each corner, click the first corner (or `Enter`) to close, `Backspace` removes the last corner, `Esc` cancels. A shape whose walls cross cannot be closed.
- **Reshape:** click a corner and drag it (snaps to grid and other corners). If the shape would cross itself the corner stops at the last valid spot and the bad edges turn orange. Objects that would end up outside or colliding get a dashed red outline and the status bar says how many; the edit still goes ahead and nothing moves by itself.
- **Add / remove corners:** double-click a wall (touch: long-press) adds a corner; select a corner and press `Delete` to remove it (a room keeps at least three).
- **Room size:** select a wall and type its **inside length**; select a corner and type X / Y. *Delete room* (Inspector, nothing selected) lets you start over; it is undoable.
- Doors and windows are re-fitted to the new wall lengths; furniture is never moved.

### 3D view (M4), button **3D** or key `V`
- **Switch:** the 2D | 3D buttons (or `V`). Selection, undo history and the project are shared; each view remembers its own camera. Switching mid-drag cancels the drag.
- **Look around:** drag on empty space to orbit, right-drag to pan, wheel to zoom. The bar at the top has **Perspective / Orthographic**, **Isometric**, **Top** and **Fit room**. Walls that stand between you and the room fade as you orbit, and drop away when you look straight down.
- **Saved views:** *Save view* stores the current camera under a name; click the name to fly back to it, ✎ renames, × deletes. They are saved with the project but are not undoable.
- **Select and move:** click furniture, a door/window (the whole opening), or a wall. Click the same spot again within half a second to pick what is behind. **Drag furniture along the floor**: same snapping, red/amber feedback and messages as 2D, one drag = one undo step, and an invalid drop slides back. Library items can be placed from 3D too (the ghost follows the floor point).
- **Not in 3D:** resize/rotate handles, marquee, Pan/Walls/Measure tools, dragging doors or windows. Rotate with `R`, resize in the Inspector, or switch to 2D.
- Furniture appears as simple shapes per type at its true size, coloured by its finish; red/amber glow = the same problems the Inspector lists.

### Projects and rooms (M5, library part)
- **Projects:** the project name in the toolbar opens the **Projects** panel: **New project**, open any project, **Rename**, **Duplicate**, **Delete** (asks "Delete? Yes / No"), **Import file…** and **Export open project** (a `.json` backup with every room). **Save** saves now; otherwise it saves a moment after your last change. The toolbar shows *Saved*, *Saving…*, *Unsaved changes* or *Could not save*.
- **Where it is saved:** when you open Room Planner from Vault while signed in, projects are saved to **your Vault account** (the `room_projects` table; any device). Otherwise they are saved **in this browser only**; the Projects panel says which. If your Vault session ends, saving says so and your work stays in the browser until you sign in again.
- **Two windows:** if the same project is saved from another window, you are asked to **reload the saved version** or **keep yours and overwrite**; nothing is overwritten silently.
- **Rooms:** a project holds several rooms. The tabs at the top left of the view switch between them; **+ Add room** offers a 4 × 5 m rectangle, **Draw a room** (corner by corner; Esc twice or Cancel gives up) or **a copy of this room**. Double-click a tab (or use the Inspector) to rename a room; **×** deletes the open room (asks first; **Ctrl+Z** brings it back). Rooms are separate plans: no shared walls, one shown at a time (2D, 3D, tour and walk all follow the open room).
- Vault side: `vault/server/routes/roomProjects.js` (+ `roomProjectsRouter.js`), mounted at `/api/room-projects` behind the `roomPlanner` feature flag; table `room_projects` created at boot in `server/db.js`. Limits: 200 projects per user, 5 MB per project. Tests: `npm run test:room-projects` in `vault/`.

### Cinematic (M4.5), button **Cinematic** in the 3D bar
- **Cinematic** switches the 3D view to a white clay architectural model: soft shadows, no colours, the walls between you and the room cut away. It changes nothing in your design and is not in undo history.
- **Low / High:** Low (default) is the safe choice for laptops. High adds softer shadows and ambient shading and needs a stronger graphics card. Your choice is remembered in this browser.
- **Play tour:** a camera fly-through. With two or more **saved views** it visits them in the order you saved them. With fewer it starts with an overview, then the entrance, then a view from each far corner. **Space** pauses and resumes, **Loop** repeats it, **Full screen** hides the interface for presenting (Esc comes back). While it plays, nothing can be edited by accident.
- **Walk** (button in the 3D bar, works in either look): you stand at the entrance at eye height (1.6 m) and walk through your room. **W A S D** or the arrow keys move (Left/Right arrows turn), **drag** to look, **Shift** runs, **Esc** stops; on a touch screen use the pad at the bottom left. You cannot walk through walls or furniture; you slide along them. Rugs and low things (under 0.4 m) can be walked over, and shelves hung above head height can be walked under. Walking changes nothing in your design.
- Not built yet in this milestone: the optional "See an example" link (C5). The **Realistic** look (M4.6) is a switch next to **Clay** in the Cinematic group: rounded and tapered furniture shapes, generated wood/fabric/leather/metal textures (no image files), plank floor, plaster walls, skirting boards, door panels and handles, window sills and glazing bars, warm daylight and a pale sky. A finish chosen in the Inspector always wins over the item's default. The choice is remembered per browser.

Questions to put to the designer: is the *front marker* (small triangle) the right way to show which side is front, and does *left/right hinge* match how they think about doors? (C20/C21 are provisional until then.)

## Run
```
cd vault/room-planner
npm install
npm run dev         # the app
npm run e2e         # drives the app in Chrome (dev server must be running)
npm test            # unit, scenarios, property, interaction gates, perf
npm run coverage    # perf excluded, fails under 95 % lines on src/engine
npm run typecheck
```

## Rules worth knowing
- Linear values quantize to 1 mm, rotation to 0.1° (half away from zero, C2); rotation is stored in [0, 2π) (C3).
- Hard violations block a commit; soft ones only warn. Touching (≤ EPSILON = 1e-6 m) is valid (C4).
- Every state change is a command with mandatory inverse data; undo applies the inverse (Phase 1 §5b).
- `Project.rooms`, `Room.furniture`, `Room.fixtures` are sorted by id. **Never rely on stored array order** (C18).
- Object frame: width = local X, length = local Y, front = +Y at rotation 0 (C20). Door hinge side is seen from inside the room
  facing the door's wall (C21). Both provisional until the designer demo.
- `src/data/furnitureLibrary.ts` is the only place the seed furniture numbers live (C17).

## Open items
- C16 unequal-thickness corners: mitred outer corner approved for drawing and now also drawn in 3D (M4).
- C20 / C21 provisional. D6–D8, D10–D14 in `DECISIONS.md` await review.
- Imperial display is P1; the Draw-a-room flow (C14) and wall editing arrive in M3.
