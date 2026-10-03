# Room Planner

Professional interior-design room planner. One authoritative domain model; 2D (Konva) and 3D (React Three Fiber) are
independent renderers of it. Spec lives in `../specs/` (Spec V2 Rev 4, Phase 1 Rev 3, Appendix B, **Appendix C**, Test Plan).

**Status: M2 — first 2D editing loop (designer demo).** `src/engine/` is pure TypeScript with no React, Konva, R3F or store code.
On top of it: Zustand stores (`src/state/`), a DOM-free interaction state machine (`src/interaction/`), an imperative Konva
renderer (`src/render2d/`) and the React shell (`src/ui/`). Not included yet: wall/vertex editing (M3), 3D (M4), PDF export and
the `room_projects` table (M5).

```
npm install
npm run dev        # http://127.0.0.1:5174/room-planner-app/  (Vault embeds it at /room-planner)
npm test           # unit, scenarios, property, interaction gates, perf
npm run e2e        # drives the real UI in Chrome (start `npm run dev` first)
```

The demo walkthrough is in `docs/room-planner.md` (Vault docs folder).

| Module | Responsibility |
|---|---|
| `coordinates.ts` | quantize (1 mm, 0.1° / snap step), EPSILON, unit + 3D axis mapping |
| `polygons.ts` | CCW normalise, validate with stable error codes, area |
| `footprints.ts` | oriented rectangles, `resizeAboutAnchor` |
| `collision.ts` / `containment.ts` | SAT + vertical intervals; footprint-in-room with the boundary policy |
| `constraints.ts` | fixture-in-wall, door swing/access geometry, clearance zones |
| `validation.ts` | full re-validation pass, per-object checks, feedback priority |
| `snapping.ts` | candidates, ranking, deterministic tie-break |
| `commands.ts` / `history.ts` | pure `apply`, `inverse`, undo/redo |
| `pipeline.ts` | commit pipeline: snap → quantize → lock → validate → escape rule → command |
| `nearestValid.ts` | "Fix position" (C10) |
| `serialize.ts` | canonical JSON, schemaVersion |
| `fixtureSnap.ts` · `wallOutline.ts` · `liveDimensions.ts` · `selection.ts` | M2: wall-snap ghost (A4), mitred wall outlines (C16), live dimensions (B10), picking/marquee (B6) |

| UI layer | Responsibility |
|---|---|
| `src/state/` | `projectStore` (project + undo history), `uiStore`, `viewStore`, `feedbackBus` (per-frame previews, never React state), persistence |
| `src/interaction/` | pointer/keyboard state machine, handles, status messages |
| `src/render2d/` | blueprint glyphs (pure data), Konva scene + overlay renderer |
| `src/ui/` | toolbar, library, inspector (+ pure `inspectorLogic.ts`), status bar, HUD, empty state |

`src/data/furnitureLibrary.ts` is the seed library (C17), the only place those numbers live.

See `TESTING.md` for how to run and what is enforced, and **`DECISIONS.md` for the choices that need owner confirmation**.

Seed furniture **and the default door/window sizes** live in that one file. Vault embeds the app at `/room-planner` (see `docs/room-planner.md`);
it still has no server API and no `room_projects` table: that arrives with M5.
