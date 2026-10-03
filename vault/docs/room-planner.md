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
| M3 | Wall / corner editing, draw a room, set room size, impact preview | **Built, awaiting review** (631 unit/property/gate tests + browser e2e) |
| M4 | 3D (R3F), shared selection, mitred wall corners in 3D | Not started |
| M5 | **Plan library** (saved plans in Vault's database), **export** (PDF, PNG/JPG, SVG, CSV/XLSX, plain 2D DXF, glTF after M4), furniture schedule | Not started |

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

## Where things are
- `room-planner/README.md` — module table, how to run.
- `room-planner/TESTING.md` — test layout, binding rules, milestone gates.
- `room-planner/DECISIONS.md` — engine decisions awaiting owner review (D4/D5 provisional, in plain words) and the M2 UI decisions D15–D25.
- `specs/` — Spec V2 Rev 4, Phase 1 Rev 3, Appendix B, **Appendix C (binding; wins on conflict)**, Test Plan v1.0.
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
- C16 unequal-thickness corners: mitred outer corner approved for drawing; 3D follows at M4.
- C20 / C21 provisional. D6–D8, D10–D14 in `DECISIONS.md` await review.
- Imperial display is P1; the Draw-a-room flow (C14) and wall editing arrive in M3.
