# Appendix C — Contract Resolutions

Oct 3, 2026 · Michael Barrett

**Status:** Binding for P0 implementation. Companion to Spec V2 Rev 4, Phase 1 Contract Rev 3, Appendix B and Test Plan v1.0.

This appendix settles twenty-two contradictions and gaps found across the contract documents. Each item names the clause it settles or overrides, the resolution, and a one-line rationale.

**Precedence rule (binding):** where Appendix C conflicts with the Spec, Phase 1, Appendix A, Appendix B or the Test Plan, Appendix C wins. Anything still ambiguous after Appendix C is raised before implementation (Spec §2), never resolved silently in code or tests.

Items marked **[Override]** change the literal text of an earlier document. Items marked **[Settle]** fill a gap or pick between readings without changing intent.

## C1. Authoritative revisions [Settle]

**Affects:** Spec V2 footer ("Rev 3"), Phase 1 footer ("Rev 2"), Appendix B header ("companion to Spec V2 Rev 3").

- Spec V2 **Rev 4** and Phase 1 **Rev 3** are authoritative. The mismatched footers are typographical errors.
- Appendix B is binding against Rev 4. Where Appendix B text predates Rev 4 (see C6), Rev 4 wins.

*Rationale:* the headers and change logs are explicit; the footers were not updated.

## C2. Linear and rotation rounding [Settle]

**Affects:** Spec §3 Quantization, Phase 1 §1 rounding mode, Test Plan §3 quantize properties.

- Rounding is **round half away from zero** on the millimetre value. This is the "same magnitude rule" the spec describes; JavaScript's bare `Math.round` (half toward +∞) is not used for negatives.
- Reference implementation:

```ts
function quantizeLinear(m: number): number {
  const mm = Math.round(Math.abs(m) * 1000 + 1e-9);
  const q = Math.sign(m) * mm / 1000;
  return q === 0 ? 0 : q; // normalise -0 to 0
}
```

- The `1e-9` mm nudge makes decimal midpoints that are not exact in binary (for example 1.0005 m) round up, as a person would expect.
- `-0` never appears in committed state or serialized output.
- Rotation uses the same rule on tenths of a degree, before conversion to radians.
- Expected values: 0.0004 → 0, 0.0005 → 0.001, 1.0005 → 1.001, −0.0005 → −0.001, −0.0004 → 0.
- The quantize property tests use generators bounded to |x| ≤ 1000 m.

*Rationale:* the spec's two descriptions disagree for negatives; the magnitude rule is the stated intent and is symmetric.

## C3. Rotation range [Settle]

**Affects:** Spec §3 Quantization, Phase 1 `FurnitureInstance.rotation`.

- Committed rotation is normalised to **[0, 2π)** after quantization. 360.0° stores as 0.
- Comparisons of rotation in tests account for wraparound (359.95° and 0.05° are 0.1° apart).

*Rationale:* one canonical range keeps replay hashes and inverse checks stable.

## C4. Touching vs. separated at EPSILON [Settle]

**Affects:** Spec Rule 17, §3 Floating-point policy, A10, Test Plan §3 "Touching ≠ collision".

- A gap or penetration whose absolute value is **≤ EPSILON** (1e-6 m) is touching. Strictly greater than EPSILON is separated or overlapping.
- Property tests do not probe exactly EPSILON. They test at 0.5 × EPSILON (must be touching) and 2 × EPSILON (must be separated or overlapping).

*Rationale:* an inclusive boundary is the safer default for valid placements, and testing exactly at the boundary is inherently flaky in floating point.

## C5. EditWall carries fixtures on both sides [Override]

**Affects:** Phase 1 §4 `EditWallCommand`, §6a, A3, Test Plan §2 `wall-edit-cascade` fixture.

- `from.fixtures` and `to.fixtures` are **mandatory**. Each holds the room's complete fixture list before and after the edit. `fixtureSnapshots?` is removed.
- Fixture offsets clamped by the interaction layer are carried in `to.fixtures`, so `apply` stays pure and undo restores fixtures exactly.
- Fixtures that cannot be clamped are carried unchanged and reported by re-validation as `fixture_out_of_wall` (derived, non-blocking).

```ts
interface EditWallCommand {
  type: 'EditWall';
  roomId: string;
  from: { vertices: Vertex[]; walls: WallSegment[]; fixtures: Fixture[] };
  to:   { vertices: Vertex[]; walls: WallSegment[]; fixtures: Fixture[] };
}
```

*Rationale:* the Rev 3 command had no place for post-edit fixture state, so the cascade fixture's "clamped per A3" expectation was unreachable at engine level.

## C6. Vertex insertion and deletion by ID [Override]

**Affects:** Appendix B B1 ("Index remapping per A1"), Spec A1 vertex-ID rule.

- The B1 phrase "Index remapping per A1" is void. Wall topology uses stable vertex IDs only (Rev 4).
- **Insertion:** the new vertex gets a new ID. The split segment keeps its original ID for the half ending at the new vertex; the other half gets a new segment ID. Both halves inherit the original thickness.
- **Fixtures on a split wall:** a fixture whose centre falls on the new half has its `wallId` and `offsetAlongWall` updated, carried in `to.fixtures` (C5). A fixture straddling the new vertex is handled as an unclamped fixture (C5).
- **Deletion:** the two segments meeting at the deleted vertex merge into one segment that keeps the ID of the incoming segment (the one ending at the vertex) and its thickness. Fixtures on the outgoing segment are re-homed the same way.
- All new vertex and segment IDs are generated outside `apply` and carried in the command.

*Rationale:* Rev 4 replaced index topology; B1 was written against Rev 3 and was not updated.

## C7. Collinear vertices are valid [Settle]

**Affects:** Spec §4 polygon validation, Phase 1 `PolygonErrorCode`.

- Three consecutive collinear vertices are **valid**. Vertex insertion (B1) creates them by design.
- `DEGENERATE_EDGE` means an edge shorter than 1 mm after quantization.
- `DUPLICATE_VERTEX` means two non-adjacent vertices at the same position (within EPSILON). Two adjacent vertices at the same position are `DEGENERATE_EDGE`.

*Rationale:* rejecting collinear vertices would make every B1 insertion invalid.

## C8. Fixture position along the wall [Override]

**Affects:** Spec A1 and A4, Phase 1 `Fixture.offsetAlongWall`.

- `offsetAlongWall` is the distance from the wall's **start vertex** to the fixture's **centre**, measured along the interior face.
- **End margin:** each edge of the opening must stay at least **50 mm** from its wall end. Valid centre range is [width/2 + 0.05, L − width/2 − 0.05], where L is the interior segment length.
- A fixture wider than L − 0.1 m cannot be placed on that segment.

*Rationale:* A4's literal wording ("half the fixture width or 50 mm, whichever is larger") allows a door edge flush into a corner, which leaves no room for a frame. **This changes the spec's text and is flagged for confirmation.**

## C9. Added commands [Override]

**Affects:** Phase 1 §4 `Command` union; Spec A5, A9, A16, B4, B5, B8; Test Plan M5.

The Phase 1 command set has no way to express several required operations. The following are added; all follow the existing rules (immutable, quantized, IDs supplied by the caller, mandatory inverse data).

```ts
interface UpdateFurnitureCommand {
  type: 'UpdateFurniture';
  instanceId: string;
  from: Partial<FurnitureProps>; // REQUIRED: prior values of exactly the keys in `to`
  to:   Partial<FurnitureProps>;
}
// FurnitureProps = elevation | height | locked | finishOverrides | metadata

interface UpdateFixtureCommand {
  type: 'UpdateFixture';
  fixtureId: string;
  from: Partial<Fixture>; // REQUIRED inverse data
  to:   Partial<Fixture>; // id and type may not change
}

interface DeleteFixtureCommand {
  type: 'DeleteFixture';
  fixtureId: string;
  snapshot: Fixture; // REQUIRED full pre-state
}

interface CreateRoomCommand {
  type: 'CreateRoom';
  room: Room; // full room, pre-generated IDs, validated polygon
  // inverse: DeleteRoom with snapshot = room
}

interface DeleteRoomCommand {
  type: 'DeleteRoom';
  roomId: string;
  snapshot: Room; // REQUIRED full pre-state incl. walls, fixtures, furniture
}
```

**Mapping of operations to commands:**

| Operation | Command |
| --- | --- |
| Edit metadata, finish, elevation, height | `UpdateFurniture` |
| Lock / unlock | `UpdateFurniture` (`locked`) |
| Multi-selection inspector edit (B4) | `Composite` of `UpdateFurniture` / `ResizeFurniture` / `RotateFurniture` |
| Duplicate (single) | `PlaceFurniture` |
| Duplicate (group) | `Composite` of `PlaceFurniture` |
| Fix position (B5) | `MoveFurniture` (see C10) |
| Start from a rectangle (B8) | `CreateRoom` |
| Move fixture along wall, change swing | `UpdateFixture` |

- `UpdateFurniture` may target a locked instance only to change `locked` itself. All other edits on a locked instance are rejected in the pipeline (A16).
- `width`, `length` and `position` stay in `ResizeFurniture` / `MoveFurniture`; `UpdateFurniture` may not carry them.
- A `from`/`to` key mismatch is `STRUCTURALLY_CORRUPT_COMMAND`.

*Rationale:* each operation above is required by a binding clause but had no command, so an implementer would otherwise invent one.

## C10. Fix position [Settle]

**Affects:** Spec A3 no-deadlock rule, Appendix B B5, Phase 1 §6 escape rule.

- "Nearest valid position" is computed by **translation only**. Rotation and size are kept.
- "Nearest" is the smallest Euclidean distance of the object's centre from its current position, among quantized positions with no hard violation.
- Search is deterministic. The result must be within 1 mm of the true nearest valid position (centre distance); it need not be bit-identical to a 1 mm ring search. A coarse-then-fine search is permitted. Ties are broken by smallest angle measured counter-clockwise from +X.
- The search is bounded to the room's bounding box. If no valid position exists (for example, the room is now smaller than the object), the action shows "No valid position — resize or move manually" and **no command is emitted**.
- A successful Fix position is a single `MoveFurniture` and one history entry.

*Rationale:* translation-only keeps the result predictable for the designer, and the no-result case was previously undefined. The 1 mm tolerance avoids millions of checks when the nearest valid spot is far away.

## C11. Commit pipeline module [Settle]

**Affects:** Phase 1 §5 module list, §6, Test Plan §1 structure.

- A new pure module `pipeline.ts` owns the canonical commit pipeline: resolve snap → quantize → lock check → validate → escape rule (for already-invalid objects) → emit command.
- It returns either a command or a structured rejection (`{ rejected: true, violations }`); it never mutates state.
- `EditWall` follows the §6a exception inside the same module.
- Tests live in `tests/unit/pipeline.test.ts`.

*Rationale:* the pipeline holds the most important rules but had no home in the module list.

## C12. Test expectations [Settle]

**Affects:** Test Plan §2 fixture rules, §3 inverse and replay properties.

- **Expected results are derived by hand,** with the working shown in a comment or sidecar note. They are never generated by running the engine under test. A scenario whose expectation was produced by the engine is invalid.
- **Violation matching:** compare `type`, `severity` and each ID list sorted. Order of `violations[]` and `message` text are not compared.
- **One equality helper:** all project comparisons use a shared `expectProjectEqual(a, b)`. Linear values compare exactly; rotation compares within 1e-9 rad with wraparound (C3).
- **Replay hash:** canonical JSON (keys sorted, rotation rounded to 1e-9 rad before hashing), then SHA-256.
- **Naming:** test data directory is `tests/scenarios/` (not `fixtures/`) to avoid confusion with door and window fixtures.

*Rationale:* engine-generated expectations make every test pass by definition, and the Test Plan did not define how results are compared.

## C13. Materials and finish overrides [Settle]

**Affects:** Phase 1 §3 `Project`, `FurnitureInstance`; C9 `UpdateFurniture`; Spec §8 Materials.

- `FurnitureInstance` gains `finishOverrides?: Record<string, string>` (part name → material id).
- `Project` gains `materials: Material[]`.

```ts
interface Material {
  id: string;
  name: string;
  colour: string;     // hex, e.g. '#c8a165'
  roughness: number;  // 0.4–0.8 (Spec §8)
  metalness: number;  // 0.0–0.1 (Spec §8)
}
```

- `UpdateFurniture` edits `finishOverrides` as a whole-record replacement (`from` and `to` each carry the full record).
- A `finishOverrides` value naming an unknown material id is `ID_NOT_FOUND`.

*Rationale:* C9 and Spec §3 reference `finishOverrides`, but the Phase 1 types omitted both the field and the material list it points to.

## C14. Draw a room [Settle]

**Affects:** Appendix B B8 ("Draw a room"), C9 `CreateRoom`.

- Closing a hand-drawn polygon emits `CreateRoom`, the same command as "Start from a rectangle".
- Closing is **blocked** if the polygon is invalid. It uses the same polygon validation and `PolygonErrorCode`s as `EditWall`, and the error is shown inline; no command is emitted.
- All vertex, wall and room IDs are generated by the interaction layer and carried in the command.

*Rationale:* B8 described only the rectangle path; the freehand path had no defined command or failure behaviour.

## C15. Vertex deletion with fixtures [Settle]

**Affects:** C6 deletion, C5.

- When two segments merge on vertex deletion, fixtures from the outgoing segment are re-homed to the merged segment (C6).
- A fixture that no longer fits the merged segment is carried **unclamped** in `to.fixtures` and reported by re-validation as `fixture_out_of_wall` (derived, non-blocking), as in C5.
- Deletion is never blocked because of fixtures; only polygon validity (B1) can block it.

*Rationale:* C6 re-homes fixtures but did not say what happens when they no longer fit.

## C16. Unequal-thickness wall corners [Settle, deferred]

**Affects:** Spec A1, §8 segmented walls, Appendix B B1.

- Not needed for P0 M1 (engine only); decided at the 2D/3D milestone.
- Proposed default: extend the outer faces of the two adjoining walls until they meet (mitred outer corner). The interior polygon is never altered.
- **Must be confirmed with the owner before implementing.**

*Rationale:* neither the Spec nor B1 defines the corner join when adjoining walls differ in thickness.

## C17. Seed furniture library [Settle]

**Affects:** Spec §3 `FurnitureDefinition`, §6 Library, §11 early validation gate.

- A generic metric seed set lives in **one data file** (editable without touching engine code). Dimensions are W × L × H in metres. Clearances are **soft** unless noted.

| Item | W × L × H | Clearance |
| --- | --- | --- |
| 3-seat sofa | 2.20 × 0.95 × 0.85 | front 0.45 |
| Armchair | 0.85 × 0.85 × 0.85 | front 0.45 |
| Coffee table | 1.20 × 0.60 × 0.42 | none |
| Side table | 0.50 × 0.50 × 0.55 | none |
| Dining table | 1.80 × 0.90 × 0.75 | all 0.90 |
| Dining chair | 0.45 × 0.52 × 0.85 | none |
| Queen bed | 1.60 × 2.10 × 1.00 | front, left, right 0.60 |
| Bedside table | 0.50 × 0.40 × 0.55 | none |
| Wardrobe | 1.80 × 0.60 × 2.10 | front 0.60 |
| Desk | 1.40 × 0.70 × 0.74 | front 0.80 |
| Bookshelf | 0.90 × 0.35 × 1.80 | none |
| TV unit | 1.80 × 0.45 × 0.50 | none |

- Clearances are soft so a coffee table can sit in front of a sofa without blocking.
- Wardrobe and bookshelf exceed the 1.2 m cut-plane, so they render dashed in 2D, covering the §11 "high object" step.
- No rug: the engine has no under-object stacking until A8 surface stacking exists.
- Bed sizes are generic; check them against what the designer specifies (mattress standards differ by country).

*Rationale:* the spec requires a library but supplies no definitions.

## C18. Collections are sorted by id; nothing may rely on stored order [Settle]

**Affects:** Phase 1 §3 `Room`/`Project`, §9 exit criteria 11 and 18 (inverse restores state), C9 `DeleteFurnitureCommand`.

- `Project.rooms`, `Room.furniture` and `Room.fixtures` are kept **sorted by id** (plain string comparison). `apply` inserts at the sorted position.
- **No UI, export or other consumer may rely on stored array order.** Schedules, lists, the room navigator and 2D/3D draw order sort explicitly by the key they need (tag, name, elevation, and so on).
- `Room.vertices` and `Room.walls` are *not* sorted: vertex order is the polygon order.

*Rationale:* `apply(inverse(c), apply(c, s))` must equal `s`. A delete's inverse (a place) cannot know the original array position, so insertion order has to be canonical.

## C19. Violation magnitude and the locked constraint [Settle]

**Affects:** Phase 1 §2 `ConstraintType`, `ValidationViolation`; §6 escape rule; §5a lock handling.

- `ConstraintType` gains `'locked'`. A locked-object rejection from the pipeline is reported as a hard `locked` violation naming the object.
- `ValidationViolation` gains optional `magnitude` (penetration depth, or length of footprint outside the room, or fixture overshoot; ≥ 0).
- The escape rule compares magnitudes **with an EPSILON tolerance**: a move commits for an already-invalid object if it introduces no new violation (type plus involved objects) and no violation's magnitude grows by more than EPSILON. Sliding an invalid object parallel to a wall therefore commits.
- `magnitude` is never compared in tests (C12).

*Rationale:* the escape rule needs to know when a violation gets worse, which type and object ids alone cannot say; and `ConstraintType` had no value for the lock message the pipeline is required to surface.

## C20. Object frame: width, length, front, rotation [Settle, provisional]

**Affects:** Spec §3 `FurnitureInstance`, ClearancePolicy sides; Phase 1 footprints; Appendix B B2.

- Width runs along the object's local X, length along local Y. Rotation is counter-clockwise from world +X, looking at the plan with +Y up.
- At rotation 0 the **front** points toward +Y. `front` / `back` / `left` / `right` clearance sides are in this frame, and "right" is +X at rotation 0 (the object's own point of view, looking out of its front).
- The 2D view draws a **front marker** on every piece of furniture.

*Rationale:* the spec never fixed handedness or which side is the front. Provisional: accepted pending designer feedback.

## C21. Door hinge side and swing [Settle, provisional]

**Affects:** Spec §3 Fixture, §4 door swing geometry; Phase 1 §7.

- Hinge side is **as seen from inside the room, facing the wall the door is in**. With the CCW room boundary, `left` is toward the wall's **end** vertex.
- The leaf starts closed in the wall opening and swings **into the room** through `swingAngle` (default 90°).
- The access zone is a band of `accessZoneDepth` beyond the leaf radius, over the same angle as the swing.

*Rationale:* "hinge side" was used without a definition. Provisional: accepted pending designer feedback.

## C22. Quantization assert tolerance [Override]

**Affects:** Phase 1 §6 "Quantization assertion"; Spec A10.

- The debug assert in `apply` checks **linear values within EPSILON of the 1 mm grid** and **rotation within 1e-9 rad of a 0.1° multiple**, and that rotation is in [0, 2π) (C3).
- The literal text, "within half a quantization step + EPSILON", is void: every number satisfies it.
- The assert never repairs and may be disabled in production.

*Rationale:* the literal wording made the assertion meaningless.

## Change log

| Item | Type | Needs confirmation |
| --- | --- | --- |
| C1 Authoritative revisions | Settle | No |
| C2 Rounding | Settle | No |
| C3 Rotation range | Settle | No |
| C4 EPSILON boundary | Settle | No |
| C5 EditWall fixtures | Override | No |
| C6 Vertex insert/delete by ID | Override | No |
| C7 Collinear vertices | Settle | No |
| C8 Fixture offset and end margin | Override | Confirmed (changes A4 wording) |
| C9 Added commands | Override | No |
| C10 Fix position | Settle | Confirmed, with 1 mm tolerance relaxation |
| C11 Pipeline module | Settle | No |
| C12 Test expectations | Settle | No |
| C13 Materials and finish overrides | Settle | Confirmed |
| C14 Draw a room | Settle | Confirmed |
| C15 Vertex deletion with fixtures | Settle | Confirmed |
| C16 Unequal-thickness corners | Settle (deferred) | **Yes** — ask before implementing |
| C17 Seed furniture library | Settle | Confirmed (check bed sizes) |
| C18 Collections sorted by id | Settle | Confirmed |
| C19 Magnitude and locked constraint | Settle | Confirmed (EPSILON tolerance) |
| C20 Object frame and front | Settle | Provisional — review after designer demo |
| C21 Door hinge side and swing | Settle | Provisional — review after designer demo |
| C22 Quantization assert tolerance | Override | Confirmed |

At the next Spec revision (Rev 5), these resolutions are folded into the main documents and this appendix is retired.

*End of Appendix C (Binding for P0)*
