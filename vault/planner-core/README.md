# planner-core

Code shared by **Room Planner** (`../room-planner/`) and **Garden Planner** (`../garden-planner/`), and, for speech and OCR, by Vault's own client.

It is not a package: the apps and Vault's client import it with a Vite/TypeScript alias, `@planner-core/...` → `planner-core/src/...`, so nothing in the root `package.json` or the Railway install changed. Libraries (`three`, `react`, `zustand`, `konva`) are de-duplicated by each app's `resolve.dedupe`, so the shared code always uses the importing app's copy. Do not give this folder its own `node_modules`.

| Module | What it is |
|---|---|
| `types.ts` | `Metres`, `Vec2`, `Vertex`, `AABB`, `Interval`, `Footprinted`, `PolygonErrorCode` |
| `engine/coordinates.ts` `geometry.ts` `polygons.ts` `collision.ts` `footprints.ts` | pure 2D geometry: quantising, vectors, point-in-polygon, SAT collision, oriented rectangles |
| `engine/history.ts` | `CommandHistoryOf<State, Command>`: undo/redo over invertible commands; each planner supplies `apply` and `inverse` |
| `adapters/canvas.ts` | the 2D view transform (the only place the screen's Y flip lives), fit/zoom/pan |
| `state/viewStore.ts` `cameraStore.ts` | 2D view and 3D camera stores |
| `render3d/camera.ts` | camera presets, fit distance, perspective/orthographic conversion (works from any bounds) |
| `render3d/photo.ts` | pure helpers for Render photo |
| `audio/ambient.ts` `noise.ts` | synthesised ambient sound |
| `help/TooltipHost.tsx` `tooltipLogic.ts` `tour.css` `tourCard.ts` | the one themed tooltip for every `title`; the Shepherd tour look; finding the card that is showing (Shepherd keeps earlier cards hidden in the page), the "Step n of N" counter and keyboard focus. Both planners' tours use it. |
| `speech/speechRecognizer.ts` | browser speech-to-text (accumulate finals, interim text, plain error messages). **Vault's `useVoice` hook uses this too.** |
| `speech/VoiceInput.tsx` | `MicButton` and `VoiceInput` (text / number / textarea with a mic built in); en-AU; one field listens at a time |
| `library/library.ts` `libraryStore.ts` `projectsController.ts` | the project library (Vault account via `/api/<planner>-projects`, browser fallback), generic over project and list-entry type via a `ProjectCodec`; and the autosave / conflict / draft-recovery state machine. Room Planner (`room-planner/src/state/library.ts`, `projects.ts`) and Garden Planner are thin bindings. |
| `ocr/ocrEngine.ts` | Tesseract.js worker wrapper. **Vault's `client/src/utils/ocrEngine.js` re-exports it.** |

## What is deliberately not here

Room Planner's interaction machine, Konva renderer, 3D `Scene3D`, inspector and constraint pipeline are written against `Room`, `WallSegment` and `Fixture`. Generalising them speculatively would risk 1,131 passing tests for no gain, so they stay in `room-planner/`. A piece moves here when the second planner needs it. What Garden Planner still wants from Room Planner, in the order the build needs it: saved views, fly-through, first-person walk, Render photo (path tracer), lighting sliders. See `docs/garden-planner.md`.

## Rules

- Moved files leave a one-line re-export at their old path (`export * from '@planner-core/...'`), so existing imports and tests did not change. Delete a shim only when nothing imports it.
- No imports from an app (`room-planner`, `garden-planner`) or from Vault's `client/` into this folder.
- Run both apps' tests after any change here: `cd room-planner && npm test`, `cd garden-planner && npm test`.
