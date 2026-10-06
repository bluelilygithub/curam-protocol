# Cellar Planner: Specification v1

Walk-in wine cellar and fridge configurator. A bespoke-first design tool: cabinets are driven by their dimensions, not by product codes, and the main output is an installer specification and cutting list for a cabinet maker.

**Status:** Milestone 1 (the pure rule and maths engine, no UI) is built and tested in `src/engine/`. Everything below marked **DRAFT** is a typical default to be confirmed with a cabinet maker. **Real-job validation is pending** (section 11): nothing here has yet been checked against a real cut list.

## 1. Scope and users

- **Phase 1, internal designer tool:** signed-in Vault users (designers, staff). Full planner, elevation view, cut-list engine, pricing calculator. Built inside Vault like the other planners (own Vite app on `planner-core`, iframe page, feature flag).
- **Phase 2, quote generator and public front door:** procedural layout presets, pricing and bill of materials, door and drawer animation, installer PDF and cut-list export; then an unauthenticated guest session, a CSP `frame-ancestors` change for embedding on another site, an email notification when a quote is requested, and a photo retention policy.
- **Phase 3, photo overlay:** manual 3-point camera match with a shadow catcher. AI blending is optional and later (it can change dimensions, and uploads a customer's home photo to a third party).
- Phase 1 gates the cut-list **export UI**; the engine's cut-list calculation is active from Milestone 1.
- Not in scope: cooling load, insulation, structural advice, WebXR/AR on a phone.

## 2. Conventions

- **Units:** whole millimetres everywhere (integers in the stored model). Metres only for display and areas.
- **Placement snaps:** 50 mm (positions, shelf heights, LED niches). Module template sizes default to 100 mm steps.
- **Derive, never store:** wall length, the bottom module's height, run scribes and capacity are computed. A stored copy can drift out of date.
- **Labelling:** every default is "Typical defaults, confirm with your cabinet maker". Every output carries `PRELIMINARY DESIGN ONLY: FINAL SITE MEASURE REQUIRED PRIOR TO FABRICATION`.
- **Stack:** Vite + React + TypeScript + Zustand; Konva for the 2D plan and the wall elevation; three.js for 3D with **instanced meshes** for bottles (no GLB assets). Location: `cellar-planner/` on `planner-core` (placement engine, undo, library, PDF primitives). The engine has no dependencies and no DOM.

## 3. Construction rules (DRAFT defaults, all overridable per project)

| Rule | Default |
|---|---|
| Board (sides, top, bottom, shelves) | 16 mm HMR particleboard/MDF |
| Back panel | 6 mm HMR MDF in a 10 mm rebate (so 4 mm void behind it) |
| Front margin (shelf setback from the front edge) | 12 mm |
| Plinth / kick | 100 mm (adjustable 60 to 150) |
| Top shadow rail | 50 mm |
| Side scribe at a room wall | 50 mm |
| Corner clearance | 20 mm |
| Depth clearance for a bottle | 15 mm (10 rear air gap + 5 door buffer) |
| Excess row-height note | minimum clear + 40 mm |
| Display angle / lip / hand clearance | 15 degrees / 20 mm / 25 mm |

Cabinets are **individual cabinets side by side**: each has its own two 16 mm sides, so uprights double to 32 mm where two meet.

## 4. Data model

Defined in `src/engine/types.ts` (`schemaVersion: 1`). A `CellarProject` has `rules`, a `cornerOwnershipMode` (`LONGEST_WALL_FIRST` or `MANUAL`), and a `Room`: `heightMm`, `walls`, `doors`, `windows`, `obstructions`. A `Wall` has start and end points, `startTermination` and `endTermination` (`ROOM_WALL`, `CORNER_OWNS`, `CORNER_YIELDS`) and `bays`. A `CabinetBay` has `xMm`, `widthMm`, `outerDepthMm`, `outerHeightMm` and `modules`, **stored bottom to top**. A `BayModule` has a `storageStyle` (`SCALLOPED_CRADLE`, `LABEL_FORWARD`, `CASE_DRAWER`), one `bottleProfile`, and a `heightMm` that is **required on every module except the first and forbidden on the first** (the base takes the remainder). Not stored: `lengthMm`, `isFlexibleBase`, base height, capacity.

**Bottle profiles** (DRAFT, typical sizes; diameter is the largest in the usual range):

| Profile | Diameter | Length | Min clear | Slot pitch |
|---|---|---|---|---|
| Bordeaux / Shiraz | 76 | 300 | 100 | 85 |
| Burgundy / Pinot / Chardonnay | 90 | 310 | 110 | 100 |
| Champagne / Sparkling | 98 | 320 | 120 | 105 |
| Magnum (1.5 L) | 115 | 370 | 130 | 125 |

A module holds one bottle profile.

## 5. Formulas

### 5.1 The vertical stack

Bay outer height (for example 2200) = plinth + bottom panel + **stack zone** + top panel + shadow rail.

    carcass height = outer height - plinth - shadow rail          (2200 -> 2050; side panels are this tall)
    stack zone     = carcass height - 2 * board                   (2200 -> 2018)
    base module    = stack zone - sum(upper module heights)
    net height     = module height          for the bottom module (sits on the cabinet's bottom panel)
                   = module height - board  for every module above (it owns a divider shelf at its bottom)

### 5.2 Scalloped rows

    N     = floor((net + board) / (minClear + board))       rows that fit
    clear = (net - (N - 1) * board) / N                      clear height per row, spare shared evenly
    slots = floor((W - 2 * board) / slotPitch)
    capacity = N * slots

There are N - 1 shelves between N rows. Spare height is **absorbed evenly** into the rows, so nothing is left "unallocated"; a note appears when a row is more than minClear + 40 mm.

Worked: net 1768 -> N = 15, clear 102.93 mm (44 mm absorbed in all). An 800 mm bay (768 mm inside): Bordeaux 9, Burgundy 7, Champagne 7, Magnum 6 slots a row.

### 5.3 Label-forward displays

Bottles lie along the cabinet's depth at 15 degrees, so the width pitch is the profile's slot pitch.

    envelope = L sin(a) + D cos(a)                  Bordeaux 151.1 mm, Champagne 177.5 mm
    tier opening = envelope + 25 mm hand clearance  Bordeaux 176.1 mm
    tiers = floor((net + board) / (tier opening + board))
    depth needed = L cos(a) + D sin(a) + lip        Bordeaux 329.5 mm

### 5.4 Depth

    internal depth = outer depth - front margin - rebate        (350 -> 328; 360 -> 338)
    needed         = bottle length + 15 mm                       (inclined displays use 5.3)

Minimum outer depth is rounded up to the next 10 mm: Bordeaux 340, Champagne 360, Magnum 410.

### 5.5 Width

Best widths waste nothing: `2 * board + k * slotPitch` (Bordeaux: 712 mm for 8 slots, 797 mm for 9). The Checks Panel suggests them.

## 6. Runs, scribes and corners

- A run's usable length = wall length - start offset - end offset. A `ROOM_WALL` or `CORNER_OWNS` end loses a 50 mm scribe. A `CORNER_YIELDS` end starts after the owning wall's cabinet depth + 20 mm and has no scribe (it meets cabinets, not a wall).
- **Equal split:** `bay width = floor(usable / count)` (a whole millimetre); the remainder goes to the two site-cut scribes (half each, the odd millimetre to the end), so all bays stay identical.
- **Corner ownership:** the longer wall owns by default; `MANUAL` overrides. A U-shaped room's middle wall has separate start and end ends. Exactly one wall must own each corner.
- **Dead corner:** the yielding wall cannot use the corner square. This is **information, not an error**. Lost capacity is calculated as what a bay that wide would have held with the same modules.

## 7. Pricing (Phase 2)

    cost ex GST = sum(sheet area m2 * (1 + waste) * sheet rate) + sum(edge-band m * edge rate) + hardware + labour per bay
    total inc GST = cost ex GST * 1.10

Default waste 20%. Each saved job stores a frozen copy of the `RateTable` it used. Every figure reads "estimate, not a quote".

## 8. Checks (the engine's issue list)

`DEPTH_TOO_SHALLOW`, `DISPLAY_DEPTH_TOO_SHALLOW`, `BASE_HEIGHT_STORED`, `UPPER_HEIGHT_MISSING`, `STACK_OVERFLOW`, `MODULE_TOO_SHORT`, `BAY_TOO_TALL`, `BAY_TOO_NARROW`, `BAY_EMPTY`, `RUN_OVERFLOW`, `BAY_OVERLAP`, `CORNER_BOTH_OWN`, `CORNER_NO_OWNER` (errors or warnings); `ROW_HEIGHT_EXCESSIVE`, `WIDTH_WASTE`, `DEAD_CORNER`, `CASE_DRAWER_NOT_COUNTED` (information). Each carries a message and, where there is one, a fix.

## 9. Cut list (INDICATIVE)

Per bay: 2 sides (carcass height x outer depth), top and bottom (inside width x outer depth - rebate), back (6 mm, in the rebate), plinth, shadow rail, and shelves. Shelves: `(rows - 1)` per module plus one divider for each module above the first; size inside width x (outer depth - rebate - front margin), with `CNC_ROUT_SCALLOP_{pitch}MM` on scalloped shelves. Identical parts merge with a quantity. Totals: pieces, sheet area (m2), edge banding (m). Placeholder codes are derived, never stored: `CUSTOM-PORT-800-1618`.

Not yet in the cut list: site scribe pieces, hardware (LED channel, runners), door and glass, drawers, sheet nesting.

## 10. Decisions log

| ID | Decision | Alternative / note |
|---|---|---|
| D-01 | Label-forward display: bottles lie along the depth, width pitch = slot pitch, so a 400 mm display holds 2 tiers x 8 = **16**. | Pitch 310 mm (bottles lying across the width) gives 4. **Confirm.** |
| D-02 | Run-split remainder goes to the site-cut scribes, so bays are identical. | Giving it to end bays makes unequal bays. **Confirm.** |
| D-03 | Display tiers use the same shelf-separated rule as rows, with 25 mm hand clearance. | A 15 mm clearance gives the same tiers for the golden case (tested). |
| D-04 | With the 15 mm depth rule, Magnum needs 410 mm outer depth, not 400. | 400 leaves 378 inside for a 385 mm need. |
| D-05 | Dead corner width = owner depth + 20 mm (the run length actually lost). | Depth alone understates it. |
| D-06 | Engine lives in `src/engine/`, matching the other planners. | |
| D-07 | `CASE_DRAWER` holds no counted bottles in V1. | |
| D-08 | An inclined display's depth need does not add the 15 mm clearance (its 20 mm lip is the front allowance). | With it, Bordeaux needs 345 inside. |
| D-09 | Cut-list part sizes follow section 9's typical rules and are indicative. | The cabinet maker's rules replace them. |

## 11. Golden Test Case #01 and validation

A straight 2450 mm wall in a 2400 mm room, two room-wall ends, three bays 360 deep and 2200 tall, each a 400 mm label-forward display on a scalloped base (Bordeaux). Expected and tested: stack zone 2018, internal depth 338, 3 bays of **783 mm** (the 1 mm remainder to the end scribe), net width 751, 8 slots; base 1618 mm = 14 rows, 100.71 mm clear = 112 bottles; display 384 mm net = 2 tiers = 16; **128 a bay, 384 in all**; 66 cut-list pieces.

This is a **worked example, not a benchmark**: its numbers come from this specification. **Pending:** one real past job (room and bay dimensions, cut list, bottle count) as the acceptance test.

## 12. Milestones

1. **M1 (built):** headless engine and tests: model, formulas, runs and corners, checks, cut list, golden case. `npm test` in `cellar-planner/`.
2. M2: project store, undo, library saving, 2D plan renderer on `planner-core`.
3. M3: wall elevation view, bay and module editing, Checks Panel UI.
4. M4: 3D (instanced bottles, materials, lights, doors).
5. Phase 2: layout generator, pricing and rate table, installer PDF and cut-list CSV, then the public front door.
6. Phase 3: photo overlay.
