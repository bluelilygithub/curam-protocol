# M1 implementation decisions

Spec §2 says anything that affects user-visible behaviour or a frozen principle is raised before implementation.
These were gaps or tensions in the contract documents (Spec V2 Rev 4, Phase 1 Rev 3, Appendix B, Appendix C, Test Plan v1).

**Accepted and folded into Appendix C** (`../specs/04-appendix-c-resolutions.md`): D1 → C18, D3 → C19, D4 → C20, D5 → C21, D9 → C22.
They are no longer listed as open here, except D4/D5, which stay below in plain words because they are accepted *provisionally*.

## Accepted provisionally — conventions in plain words

**D4 — which way is "front", "left", "right"?** Every piece of furniture has its own small coordinate frame. Its **width runs
left–right** and its **length runs front–back**. At rotation 0 the **front points toward +Y** (toward the top of the plan,
in room coordinates). Rotating the object turns the front with it (rotate 90° and the front points toward −X). "Left" and
"right" are from the **object's own point of view**, as if it were looking out of its front: its right is **+X** at rotation 0.
(A person standing in front of a sofa and looking at it sees the sofa's right on *their* left.) Clearance zones (`front`,
`back`, `left`, `right`) follow this frame. Rotation is counter-clockwise looking at the plan with +Y up. The 2D view shows a **front marker** on every piece of furniture so the
designer can always see which side is the front. (The screen's Y-down flip is handled only in the 2D drawing code.)

**D5 — which hinge is "left" and where does the door swing?** Stand **inside the room, facing the wall the door is in**.
**Left hinge** means the hinge is on your left-hand side; **right hinge** on your right. Walls are drawn counter-clockwise, so
standing inside and facing a wall, your left is toward that wall's **end** vertex (the vertex it runs *to*). The door leaf starts
closed, lying in the wall opening, and swings **into the room** through its swing angle (default 90°). The swing area is the
pie slice the leaf sweeps; the **access zone** is a band of `accessZoneDepth` metres just beyond the end of the leaf, over the
same angle.

## Still open (awaiting your review)

| # | Decision | Where | Why it needed deciding |
|---|---|---|---|
| D6 | **Access zone** = annular sector of depth `accessZoneDepth` beyond the leaf radius, over the same angle as the swing. | `constraints.ts` | Phase 1 §7 allows "rectangular or sector"; needed one definition. Swing sector and access zone are decomposed into convex triangles/quads so SAT works for any swing angle. |
| D7 | Clearance `'all'` = union of the **four edge rectangles** (corners not filled). | `constraints.ts` | Spec: "extends all four edges". Filling the corners would be a different, larger shape. |
| D8 | `fixture_out_of_wall` sits right after `outside_room` in the feedback priority order. | `validation.ts` | Spec §4's priority list omits it. `locked` is first. |
| D10 | Containment is **edge-splitting + midpoint test**, not triangulation. | `containment.ts` | Phase 1 allows "or equivalent". Robust for concave polygons and handles reflex-vertex grazes. |
| D11 | Fix position is **coarse (50 mm) then fine (10, 2, 1 mm) refinement** around the best candidates. | `nearestValid.ts` | C10 allows it. Limitation: a valid sliver narrower than 50 mm that is nearer than every coarse hit can be missed. |
| D12 | `quantizeRotation(rad, stepDeg)` takes the active angular snap increment (default 0.1°). | `coordinates.ts` | Spec: "or the active angular snap increment". |
| D13 | Group rotate rotates each member about its own centre by the delta **and** orbits it about the selection's bounding-box centre. | `pipeline.ts` | B2 fixes the pivot; B4 says per-instance rotation edits are about each instance's own centre. A group *rotate* needs both. |
| D14 | Group duplicate and the "no-op proposal" result (`noop: true`) are not full features yet. | `pipeline.ts` | Duplicate (A6) is interaction-layer ghost logic; noop avoids empty history entries. |

## M2 decisions (2D editing loop) — awaiting review

| # | Decision | Where | Why |
|---|---|---|---|
| D15 | **Drag and rotate follow the pointer and turn red when invalid; on release an invalid drag animates back (no history).** **Resize sticks** at the last valid size. | `interaction.ts` | Spec §5 says "red feedback, then silent animate-back" for drags; A2/B1 hint that furniture should "stick" at the nearest valid spot. B3 says resize sticks. I read §5 for drags/rotation and B3 for resize. Easy to switch drags to sticking if designers prefer. |
| D16 | Wall-flush **rotation snap** triggers when a footprint *corner* is within 0.25 m of a wall (and the angle is within 10° of flush). | `snapping.ts` `wallFlushAngle` | B2 says "centre within snapDistance of a wall", which furniture can almost never satisfy. |
| D17 | While rotating, the default angular snap is **15°** (Shift = free, 0.1°). A wall-flush snap keeps 0.1° so it lands on the wall angle. | `interaction.ts` | B2 says Shift disables angular snapping, implying it is on by default; the spec names no increment. |
| D18 | **Arrow = 1 cm, Shift+Arrow = one grid unit (10 cm)**; each key press is its own history entry. | `interaction.ts` | Spec: "small move / larger move (respects snap)". No sizes given. |
| D19 | Live dimensions: nearest wall per axis and nearest furniture gap per axis by ray casting; fixture = nearest opening centre; alignment shown when centres line up within 5 mm. The "below screen-scale 0.15" rule is read as **suppress non-wall dimensions when zoomed out past 0.15 m per pixel**. | `liveDimensions.ts` | B10 wording is ambiguous about the direction of "below". |
| D20 | **Duplicate (A6):** an offset copy always collides with its same-size source, so Ctrl+D normally puts a **ghost of the copy on the pointer** (single object). A multi-object duplicate that does not fit just reports why. | `interaction.ts` | A6 says the ghost "remains attached"; the group case is not specified. |
| D21 | `isAboveCutPlane` uses an **EPSILON tolerance** (0.8 + 0.4 is not above 1.2). | `selection.ts` | Float sums land a hair over the plane. |
| D22 | Quick repeated clicks at the same point (< 500 ms) **cycle to the next object under the pointer** (B6). A fast double-click on an object therefore selects the one beneath it. | `selection.ts` | That is the spec'd cycle rule; flagged because it can surprise. |
| D23 | The 2D renderer is **plain Konva driven imperatively**, not react-konva. | `render2d/SceneRenderer.ts` | The plan said react-konva; per-frame previews must never go through React or a store (A12), and this keeps that guarantee structural. |
| D24 | **Undo history is never persisted.** Only the project is autosaved; the UI says "Project saved" and its tooltip says undo starts fresh. | `persistence.ts` | Owner decision. |
| D25 | Single-room UI: the editor works on `rooms[0]`; a project with several rooms opens but only the first is editable. | `interaction.ts` | Multi-room navigator is a foundation, not P0. |

## M3 decisions (wall and corner editing) — awaiting review

| # | Decision | Where | Why |
|---|---|---|---|
| D26 | **Insert a corner projects the click onto the wall**, so the shape does not change (three collinear corners are valid, C7). B1 says "at the quantized click position"; a kink is made by dragging the new corner. | `wallEdit.ts` | Inserting must never make an invalid or surprising shape. |
| D27 | **Double-click anywhere on a wall body** inserts (touch: long-press); B1 says "segment midpoint". | `wallTool.ts` | A midpoint-only target is too fiddly to hit. A "+" marks the midpoint of a selected wall as a hint. |
| D28 | Deleting a corner re-homes the **outgoing** wall's fixtures with `offset + incoming length`, then re-fits them; ones that cannot fit are carried unclamped and flagged (C15). Inserting then deleting restores the original exactly. | `wallEdit.ts` | C6 says "re-homed the same way" without the arithmetic. |
| D29 | Fixtures are **re-clamped on every corner move and every length change** (not only on release), and carried in `to.fixtures` (C5). | `wallEdit.ts` | The live preview must show what will be committed. |
| D30 | **Room size = wall length field** (moves the wall's *end* corner along the wall, start stays) **+ corner X/Y fields + dragging**. No Width × Length form (owner decision). | `wallEdit.ts`, Inspector | One mechanism that works for any shape. |
| D31 | **One editable room.** "Draw a room" is for an empty project; to redraw, use *Delete room* (undoable, confirmed). | `createApp.ts` | Multi-room/Room Navigator is not P0. |
| D32 | **Walls tool (key 3) is the only place corners are edited.** Furniture is dimmed and not pickable there; entering it clears the selection. | `interaction.ts` | Prevents moving furniture by accident. |
| D33 | Corner snapping: another corner (100), alignment with a corner's X or Y (40), grid (20), reach 0.25 m. A snap that would make the polygon invalid is skipped. | `wallEdit.ts` | B1 gives no snap set for corners. |
| D34 | "N objects will need attention" counts only objects that **become** invalid, not ones already invalid. Same `validateRoom` as the post-commit check, so preview = outcome. | `wallEdit.ts` `impactOf` | An edit that changes nothing for an already-invalid object should not nag. |
| D35 | **Closing a drawn room is blocked when invalid**: a plain message, and the corners stay so Backspace can fix it (C14). Error codes are never shown to users. | `wallTool.ts` | C14 says blocked; behaviour afterwards was unspecified. |
| D36 | A drag that would cross itself **sticks at the last valid millimetre** along the drag (bisection), with the bad edges orange (B1, owner decision). | `wallEdit.ts` `stickVertex` | Owner decision. |

## M4 decisions (3D view) — awaiting review

| # | Decision | Where | Why |
|---|---|---|---|
| D37 | **Domain → three.js:** World X → X, World Y → Z, elevation → Y; a counter-clockwise domain rotation φ is `rotation.y = −φ`. An object's local frame (width = X, length = Z, front = +Z) is the same as C20. | `render3d/transforms.ts` | Spec §4 fixes the axes; the rotation sign follows from them. A property test proves the 3D model lands exactly on the engine footprint at every rotation. |
| D38 | **Doors and windows in 3D:** a frame around the opening plus a **closed** door leaf, or translucent window glass; centred in the wall thickness (walls grow outward only). The glass is never picked. The **whole opening** (not just the frame) is the click target for a door or window. | `fixtureParts.ts`, `Scene3D.ts` | Spec only says "cut openings". Picking by the whole opening avoids the 2D "thin target" problem you reported. |
| D39 | **Walls are sliced, never boolean-subtracted** (Spec rule 14): each wall's mitred outline is cut by planes perpendicular to the wall at every opening edge, giving full-height pieces plus the solid below the sill and above the head. Pieces tile exactly; mitred corners stay whole. | `wallPieces.ts` | Robust, deterministic, and testable by area and volume. |
| D40 | **R3F hosts an imperative three.js scene** (`Scene3D`, one `<primitive>`), and **one `Interaction` serves both views**: 3D pointer events become the same world-space events (ray ∩ floor plane) plus the ray's depth-ordered hit list. | `Scene3D.ts`, `controller3d.ts`, `interaction.ts` | Same reason as D23: previews must never go through React or a store (A12). One state machine means drag, snap, ghost, commit and Escape behave identically in 2D and 3D, and the whole 3D scene can be tested in Node. |
| D41 | **Furniture models are generic per library item** (sofa, armchair, tables, chair, bed, wardrobe, desk, bookshelf, TV unit); anything else is one box. Part names (`frame`, `upholstery`, `top`, `leg`, `fabric`, `accent`) are the keys of `finishOverrides` (C13). Every model fills exactly its width × length × height. | `furnitureParts.ts` | "Simple shapes per type" (owner decision). Real models (glTF) can replace them later. |
| D42 | **Wall fading (A7):** a wall fades when the camera is on the *outer* side of its inside face, or the plan line from camera to room centre crosses it; never when looking within 20° of straight down. Faded walls cannot be picked and do not cast shadows. | `wallFade.ts` | The spec's "between camera and room centre" alone left a near wall opaque in front of furniture standing close behind it (found in the browser check); this rule contains the spec's. |
| D43 | **Camera:** Isometric looks from the front-right and above; **Top** looks straight down with plan +y toward the bottom of the screen (as in 2D); **Fit room** keeps the current direction. Perspective ⇄ orthographic keeps the visible height at the target. Orbit on empty space, right-drag pans, wheel zooms; the camera cannot go below the floor. | `cameraPresets.ts` | Spec §8 names the presets, not the maths. |
| D44 | **Saved views live in the project file** (`savedViews`, optional) but are **not undoable**: presentation, not design. Positions are rounded to 1 mm. | `savedViews.ts`, `projectStore.updateSilently` | "Not stored in undo history" (plan); old files load unchanged. |
| D45 | **3D has only the Select tool.** No marquee, no corner/resize/rotate handles, no door/window dragging; Pan, Walls and Measure are disabled; `V` toggles the view. Switching view cancels any gesture (and a library item being placed) with no history. Dragging furniture, placing from the library, Delete, `R`, Ctrl+D, arrows and undo all work. | `interaction.ts` | Owner decision ("select + drag along the floor"). |
| D46 | **Lighting:** ambient 0.6 and sun 0.8 as in Spec §8, multiplied by π (those numbers are legacy three.js units; current three.js lights are physical), flat tone mapping, soft shadow map, and **walls cast no shadows** (the sun sits outside the room, so they would darken the interior whenever the camera is behind them). | `Scene3D.ts` | Found in the browser check: the literal values rendered grey. |
| D47 | **Dragging in 3D grabs the object at the height you clicked**, so it follows the pointer; elevation never changes by dragging. | `controller3d.ts` | Dragging along the floor plane would make a tall object slide under the cursor. |
| D48 | **Both views stay mounted** once opened: 2D is hidden (not destroyed) while 3D shows, and the 3D chunk (three.js, ~260 kB gzipped) loads the first time 3D is opened. Each keeps its own camera. | `App.tsx` | Instant switching, state kept, and 2D start-up does not pay for three.js. |
| D49 | **Picking in 3D** is depth-ordered (nearest first); repeated clicks on the same screen point within 500 ms cycle to the next hit (B6); furniture and openings are picked by an invisible box around them. | `Scene3D.ts` | B6 wording is for plan view; this is its natural 3D reading. |

## Cinematic (M4.5) decisions — filled in as they are made (Spec Addition A1)

| # | Decision | Where | Why |
|---|---|---|---|
| D50 | **Cinematic is a mode of the current plan**, not a sample scene; fly-through stops are the saved views, with automatic stops (entrance, then far-corner diagonals) when there are none. | `specs/05-spec-addition-cinematic.md` | Owner decision 2026-10-03. |
| D51 | **Clay is the Cinematic look** (chosen from two stills of the owner's own room); **realistic is a planned follow-up (M4.6)** after the furniture shapes are improved. Clay is re-confirmed on a furnished scene before M4.5 closes. | A1.2, A1.7 | Owner decision 2026-10-03. Clay needs no textures and hides the simple shapes. |
| D52 | **Textures: CC0 or self-generated only**, licence recorded per file, enforced by a test. **Quality low/high, default low**, tested on an integrated GPU. **Walk mode collides** with walls and furniture. | A1.2 | Owner decision. |
| D53 | **Fly-through stops:** two or more saved views are the tour (creation order); with fewer, an overview, the entrance (0.6 m inside the first door, eye height 1.55 m, looking at the room's area centroid) and up to three far convex corners (inset 0.45 m along the corner bisector, at least 1.5 m from the entrance, ordered around the room). One saved view is kept as the first stop. Rests 3 s on a saved view, 2.5 s on an automatic stop; legs run at 1.2 m/s clamped to 3–8 s. | `render3d/tour.ts` | Owner decision (saved views = stops) plus the automatic fallback. Numbers are mine; easy to change in one file. |
| D54 | **Between two eye-level stops the camera travels a straight chord**; any leg touching a saved view or the overview uses a centripetal Catmull–Rom curve. | `tour.ts` | A property test found that the curve, pulled by the outside overview point, left a small room's walls. A chord between two points inside a convex room stays inside it. A concave room can still clip a wall mid-leg; walls are single-sided and cut away there, so it is invisible rather than wrong. |
| D55 | **Clay look:** every furniture part, wall and the floor are one white matte material (floor slightly darker), glass a pale translucent pane; studio environment light, filmic tone mapping, soft (variance) shadows, pale background; no problem tints. **Walls between the camera and the room are cut away, not faded.** | `Scene3D.ts`, `Viewport3D.tsx` | Chosen from the stills; cut-away reads like an architectural model, and openings on a cut wall go with it. |
| D56 | **Quality:** low (default) = 1024 shadow map, no post effects; high = 2048 shadow map plus ambient occlusion (GTAO) through a composer mounted only at high. Stored per browser (`room-planner:quality:v1`), not in the project. | `uiStore.ts`, `PostFx.tsx`, `createApp.ts` | Spec A1.2. Low must be safe on an integrated GPU; that check is the owner's (see TESTING.md). |
| D57 | **Presentation view:** *Full screen* hides the toolbar, panels and status bar and asks the browser for full screen (Vault's frame allows it); Esc leaves it. **While the tour plays, clicks and keys edit nothing** (Space and Esc pause it). The tour clock is real elapsed time, so a slow card drops frames instead of slowing the tour. | `createApp.ts`, `interaction.ts`, `Viewport3D.tsx` | A presentation must not be edited by accident. |

| D58 | **Walk mode** is a first-person camera at eye height 1.6 m. It is available in the ordinary 3D look as well as Cinematic (a superset of the spec, which listed it under Cinematic); it is exclusive with the fly-through. | `render3d/walk.ts`, `Viewbar3D.tsx` | Checking sightlines and scale is useful in colour too. |
| D59 | **Collision:** the walker is a circle of radius 0.25 m on the plan. It stays inside the room (the polygon edge is a wall's inside face) and outside any furniture whose **top is above 0.4 m (knee) and whose underside is below 1.8 m (head)**: rugs and high wall shelves do not block. Movement is applied in steps of at most 0.1 m and pushed out of what it overlaps, so it slides; a step that cannot be resolved is refused, so the position is always valid. | `walk.ts` | Spec A1.2 #6. Numbers are mine (typical body, knee and head); one place to change. |
| D60 | **The room is the whole world:** door openings do not let you out, and you start at the entrance (0.6 m inside the first door) looking at the centre, or at the nearest free spot if furniture is there. A room with no free floor says so instead of starting. | `walk.ts`, `createApp.ts` | Leaving the room would need rooms beyond it. |
| D61 | **Controls:** W A S D or arrows to move (Left/Right arrows turn), drag to look (one finger on touch), Shift to run (2.4 m/s; walking 1.4 m/s), an on-screen pad for touch, Esc or the button to stop. While walking, every other key and click is ignored. **The camera is placed directly rather than through the orbit controls** (they would clamp a level or upward look), and the orbit camera you left is restored on exit. | `Viewport3D.tsx`, `WalkPad.tsx`, `interaction.ts` | A walker must not edit by accident; direct placement is the only way to look level. |


## Projects and rooms (M5, library part) — awaiting review

| # | Decision | Where | Why |
|---|---|---|---|
| D62 | **The store keeps the whole project (`document`) and shows the editor one room (`project` = a view with only the active room).** Commands carry room ids and apply to the document; renderers, interaction, inspector, tour and walk keep reading `project` unchanged. | `projectStore.ts` | The UI read `rooms[0]` in 31 places; this makes several rooms a store concern instead of a 31-place change, and keeps single-room tests valid. |
| D63 | **Rooms are separate: no shared walls, one shown at a time**, each with its own coordinates. A new, copied or drawn room becomes the open one; deleting the open room opens its neighbour; undo and redo keep a valid open room. | `projectStore.ts` `nextActive` | Owner choice (switch between rooms). Side-by-side rooms with shared walls is a much bigger model. |
| D64 | **Ids are time-ordered** (base-36 time, counter, random), so sorting by id (C18) lists rooms and furniture in creation order. Older files keep their random ids, so their rooms may list in any order. | `projectFactory.ts` | The room tabs would otherwise appear in random order. |
| D65 | **Projects are saved to the Vault account when the user is signed in to Vault, otherwise in this browser** (the interface says which). The planner reads Vault's token from `localStorage['vault-auth']` (same origin); a ended session or unreachable Vault falls back to the browser with the reason. | `library.ts`, `vaultAuth.ts` | Owner choice (database). Standalone dev has no token, so it works offline. |
| D66 | **Save:** every change marks the project *Unsaved* and saves after a 1.5 s pause; **Save** saves now; a failed network save retries every 15 s; the old single-key draft stays as crash recovery and is re-saved if the last session ended with unsaved changes. Undo history is still never saved (D24). | `projects.ts` | Owner choice (autosave + manual Save). |
| D67 | **Two windows cannot silently overwrite each other:** a save carries the time it last saw; if the project changed since, the server answers 409, autosave pauses, and the owner chooses *Reload the saved version* or *Keep mine and overwrite*. Switching projects is refused while a save problem is unresolved. | `roomProjectsRouter.js`, `projects.ts`, `LibraryBanner.tsx` | Autosave in two tabs would otherwise lose work without a word. |
| D68 | **Server limits:** 200 projects per user, 5 MB per project, names up to 120 characters, every query filtered by user, ids must be plain numbers. | `roomProjectsRouter.js` | Protects the database and other users' data. |
| D69 | **Deleting a project or a room asks inline ("Delete? Yes / No")**, never with a browser dialog; room deletes are undoable, project deletes are not (a project is a whole file; use Export first). | `ProjectsPanel.tsx`, `RoomBar.tsx`, Inspector | Vault's UI rule for routine deletions. |
| D70 | **A project has a name** (optional field `name`, schema stays 1); the account's name column is the truth when the two differ. File export is named after it. | `types.ts`, `library.ts` | The library needs something to show. |

## Photographic view (M4.6 / M4.7, Spec Addition A2) — decisions as made

| # | Decision | Where | Why |
|---|---|---|---|
| D71 | **Realistic first, then a path-traced photo; no AI images.** Textures are generated at run time (no files, no licence question). Finishes become data (material texture kind + default finishes per part); designer overrides always win. | `specs/06-spec-addition-photo.md` | Owner decision 2026-10-03: client presentation must show the real design. |

## Known limits (not decisions)
- Coverage ≥ 95 % lines on `src/engine/` (currently ~99.5 %).
- Perf ceilings (Test Plan §6) are asserted in `tests/perf/` and excluded from the coverage run, because v8 instrumentation
  makes timings meaningless.
- Wall corner joins for unequal thickness (C16) and everything outside Phase 1 are untouched.

## D72 - Realistic look (M4.6)

Realistic is a second look inside Cinematic (`ui.look`: `clay` | `realistic`, stored per browser, default clay), not a separate mode. Textures are generated at run time from seeded periodic noise (`render3d/textureData.ts`): no image files, so no licences, tileable by construction, deterministic. Finishes are data: `Material.texture` is optional (old files load unchanged); each library item has default finishes per part (`DEFAULT_FINISHES`), and a designer finish (`finishOverrides`, C13) always wins. Furniture gains `rbox` (rounded box) and `taper` part shapes; every recipe still fills its exact width x length x height. Room details in this look only: plank floor, plaster walls, skirting boards (stopped at doors, cut away with a cut-away wall), door panels and handles, window sill and glazing bars, pale sky behind windows. The look switch rebuilds the scene once.

## D73 - Render photo (M4.7)

A path-traced still image of the open room, for client presentation. No AI-generated images (they can invent or change the design); the picture is the design, lit and rendered.

- **Panel, not a view mode.** "Render photo" (3D view bar) opens a panel over the 3D view (`ui.photoOpen`); the 3D view and the project are never touched. Choose a view (current or any saved view), lighting (Daylight / Overcast / Evening), size (640 x 360 quick look, 1280 x 720, 1920 x 1080, 3840 x 2160) and quality (Draft 64 / Good 256 / Best 1024 passes). It shows a progress bar and a time-left estimate measured from the real speed, with Pause, Stop, Download PNG (optional caption strip: project, room, date; file `<project>-<room>-<yyyy-mm-dd>.png`) and Back to 3D. Esc stops a render, then closes the panel. A change to the design while rendering stops the render.
- **Off-screen renderer.** The path tracer draws into its own canvas with its own WebGL context and its own `Scene3D` (Realistic look, private UI state), so the live view keeps working and the context is released on close. An orthographic view is rendered as a perspective one from the same position.
- **Pure core.** `render3d/photo.ts` holds presets, estimates, caption layout, file name, device check and `PhotoJob` (idle -> building -> rendering <-> paused -> done | stopped | failed), driven through an injected `Tracer`, so it is unit-tested without WebGL. `photoTracer.ts` is the only file that touches the library.
- **Library.** `three-gpu-pathtracer` 0.0.26 (MIT), pinned, with `three-mesh-bvh` 0.9.15 forced by `overrides` (see `LICENCES.md`). Its WebGL tracer is deprecated upstream (a WebGPU one replaces it, but many laptops cannot run that yet), so it is isolated in one file. The scene is built synchronously (`setScene`); the async build needs a BVH worker, which is one more moving part.
- **Guards.** Needs WebGL2 and float render targets and a texture size at least as large as the picture; otherwise a plain message and the button is disabled. A render that will take over three minutes warns before the wait gets long.
- **Not measured here.** Speed on a laptop GPU cannot be measured by the assistant; the owner times Draft and Good (steps in `TESTING.md`).

## D74 - Help: tooltips, How This Works, guided tour (matches the other Vault tools)

The planner gets the same help as Vault's other tools. It runs in an iframe on Vault's origin, so it carries its own copies, in `src/help/`:

- **Title buttons.** A compass (guided tour) and an (i) (How This Works) beside the title, as on Vault page headers. The wordmark now shows when embedded (only the mark is hidden), so the buttons sit in a title.
- **How This Works** (`InfoModal.tsx`) opens by itself once per browser (`vault_room_planner_info_seen`) and any time from the (i). Esc or a click outside closes it.
- **Tour** (`roomPlannerTour.ts`, steps as data in `tourSteps.ts`): Shepherd.js 14.5.0, the same CSS as Vault's tours, 11 steps (projects, rooms, tools, library, plan, inspector, 2D/3D, Cinematic, Render photo). Steps that need 3D switch to it (when there is a room) and the planner is put back as found; an element that is not on screen turns a step into a centred card. Completion or skip sets `vault_tour_room_planner_completed`. Shepherd loads on first use, so it is not in the main bundle.
- **Settings.** Vault's Settings page has a "Room Planner Tour" card with Take / Retake (`client/src/utils/tours/roomPlannerTour.js`): it clears the key and opens `/room-planner?tour=1`; `RoomPlannerPage` passes `tour=1` to the frame and the planner runs the tour (and skips the info modal).
- **Tooltips.** One `TooltipHost` gives every element with a `title` the same themed card as Vault's Tooltip (350 ms hover or keyboard focus, not on touch), instead of wrapping hundreds of controls. The native title is moved aside while hovering and put back afterwards, so controls keep their accessible name; icon-only controls get an `aria-label` while it is out. Inspector fields get their sentence from `fieldTips.ts`; buttons that had no explanation now have one. The e2e scripts set the info-seen key before loading and find titled controls by `[title]` or `[data-tip]`.
