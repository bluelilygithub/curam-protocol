# Room Planner

Professional interior-design room planner. Standalone app in `vault/room-planner/`; **not yet wired into Vault** (no route,
feature flag, table, or import from `server/` or `client/`). It cannot affect the running Vault app.

## Principle
One authoritative domain model. 2D (Konva) and 3D (React Three Fiber) are independent renderers of it; neither owns design
state. The domain is a pure TypeScript engine with no UI code.

## Status
| Milestone | Scope | State |
|---|---|---|
| M1 | Pure spatial core `src/engine/`, tests, scenario fixtures | **Done** (332 tests, ~99.5 % line coverage) |
| M2 | First 2D editing loop (Vite + React + Konva + Zustand), designer demo | Planned, approved |
| M3 | Wall / vertex editing, impact preview | Not started |
| M4 | 3D (R3F), shared selection, mitred wall corners in 3D | Not started |
| M5 | Save/load polish, PDF + image export, `room_projects` table | Not started |

## Where things are
- `room-planner/README.md` — module table, how to run.
- `room-planner/TESTING.md` — test layout, binding rules, milestone gates.
- `room-planner/DECISIONS.md` — engine decisions still awaiting owner review (D4/D5 provisional, in plain words).
- `specs/` — Spec V2 Rev 4, Phase 1 Rev 3, Appendix B, **Appendix C (binding; wins on conflict)**, Test Plan v1.0.
  `04-appendix-c-resolutions.md` is the current text (C1–C22); the Appendix C PDF is older.

## Run
```
cd vault/room-planner
npm install
npm test            # unit, scenarios, property, perf
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
