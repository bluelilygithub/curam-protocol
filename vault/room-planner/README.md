# Room Planner

Professional interior-design room planner. One authoritative domain model; 2D (Konva) and 3D (React Three Fiber) are
independent renderers of it. Spec lives in `../specs/` (Spec V2 Rev 4, Phase 1 Rev 3, Appendix B, **Appendix C**, Test Plan).

**Status: M1 — spatial core only.** `src/engine/` is pure TypeScript with no React, Konva, R3F or store code.

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

`src/data/furnitureLibrary.ts` is the seed library (C17), the only place those numbers live.

See `TESTING.md` for how to run and what is enforced, and **`DECISIONS.md` for the choices that need owner confirmation**.

```
npm install
npm test
```

Not wired into Vault's server or client yet (no route, no feature flag, no `room_projects` table); that arrives with the UI milestone.
