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

## Known limits (not decisions)
- Coverage ≥ 95 % lines on `src/engine/` (currently ~99.5 %).
- Perf ceilings (Test Plan §6) are asserted in `tests/perf/` and excluded from the coverage run, because v8 instrumentation
  makes timings meaningless.
- Wall corner joins for unequal thickness (C16) and everything outside Phase 1 are untouched.
