# Cellar Planner: Specification v1.1

*v1.1 amends v1 after the owner supplied three reference documents (section 13). Sections 1 to 12 are v1; sections 13 to 18 are new. Where they disagree, v1.1 wins.*

Walk-in wine cellar and fridge configurator. A bespoke-first design tool: cabinets are driven by their dimensions, not by product codes, and the main output is an installer specification and cutting list for a cabinet maker.

**Status (v1.1):** two product lines are live (section 13), so the joinery engine below is one of two. Milestone 2 is paused after M2a until the enclosure model is settled. Milestone 1 (the pure rule and maths engine, no UI) is built and tested in `src/engine/`. Everything below marked **DRAFT** is a typical default to be confirmed with a cabinet maker. **Real-job validation is pending** (section 11): nothing here has yet been checked against a real cut list.

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

**Confirmed** = agreed with the project owner. **Open** = still to decide. **Proposed** = my default, not yet discussed.

| ID | Status | Decision | Alternative / note |
|---|---|---|---|
| D-01 | **Confirmed** | Label-forward display: bottles lie along the depth, width pitch = slot pitch, so a 400 mm display holds 2 tiers x 8 = **16**. | Pitch 310 mm (bottles lying across the width) gives 4. |
| D-02 | **Confirmed** | Run-split remainder goes to the site-cut scribes, so bays are identical. | Giving it to end bays makes unequal bays. |
| D-03 | **Open** | Display tiers use the same shelf-separated rule as rows, with 25 mm hand clearance. | A 15 mm clearance gives the same tiers for the golden case (tested). |
| D-04 | **Confirmed** | With the 15 mm depth rule, Magnum needs 410 mm outer depth, not 400. | 400 leaves 378 inside for a 385 mm need. |
| D-05 | Proposed | Dead corner width = owner depth + 20 mm (the run length actually lost). | Depth alone understates it. |
| D-06 | Proposed | Engine lives in `src/engine/`, matching the other planners. | |
| D-07 | Proposed | `CASE_DRAWER` holds no counted bottles in V1. | |
| D-08 | Proposed | An inclined display's depth need does not add the 15 mm clearance (its 20 mm lip is the front allowance). | With it, Bordeaux needs 345 inside. |
| D-09 | Proposed | Cut-list part sizes follow section 9's typical rules and are indicative. | The cabinet maker's rules replace them. |
| D-10 | **Confirmed** | Both product lines are live: glass enclosures with metal and timber racking, and carcass joinery. | v1 assumed joinery only. |
| D-11 | **Confirmed** | Customers are not given drawings by default; they can request them with a quote. The drawing package is a staff-generated, on-request output. | Customers see a preview (3D view, bottle count, estimate). |
| D-12 | Proposed | The racking is a plug-in (`CARCASS_JOINERY` = the M1 engine, untouched; `METAL_RACK` = new) on a shared enclosure and drawing core. No refactor of `src/engine/` until the product order is chosen. | Two separate apps (rejected: the room, door and sheets are common). |
| D-13 | Proposed | Climate, insulation and glass guidance is advisory only and never an error. | The 50% glass guidance cannot block a design: free-standing glass cabinets are close to 100% glass. |
| D-14 | **Confirmed** | The glass enclosure with metal racking is built first. Source: the owner's own answer ("glass enclosure") to the question of which product to build first, given in the design conversation. | Joinery follows; its engine (M1) is already built. |
| D-18 | **Confirmed** | The bottle total counts **only runs with no error**; runs with errors are reported as "not counted" (their runs and bottles), never added to the headline. A run too tall, too shallow for the bottle, off its wall, in the door's way, or with a bottle that cannot fit is such a run. | Showing the total with a footnote. A clean number must never include something the tool says cannot be built. |
| D-19 | **Confirmed** | Bottles per row left blank is **calculated**: floor(unit width / the bottle's slot pitch) (600 mm: Bordeaux 7, Burgundy 6, Champagne 5, Magnum 4), labelled calculated, and a typed number overrides it. A typed number that cannot fit across the unit at the bottle's diameter is an error (`RACK_ROW_TOO_WIDE`). The Test case leaves it calculated, so the Bottle setting moves the count. | A typed 7 that silently ignores the bottle choice. |
| D-20 | **Confirmed** | **Label-forward** has its own bottles-per-row, never calculated, "not set" until typed: the neck-out figure never carries over. On a metal rack label-forward may mean the bottle lies side-on and takes about its own length of width (so a 600 mm unit might hold 1 or 2), unlike the joinery display (D-01). | Reusing the neck-out count (wrong). **Ask the fabricator.** |
| D-17 | **Revised** | The minimum walkway belongs to the project and has **no default**: blank means the walkway and landing checks do not run (one information note says so). When set, a narrow walkway is a **warning**, never an error. The floor-inside-the-door check applies **only when the door swings in**. | A 900 mm default would flag a step-in glass cabinet, whose two rack rows are roughly 600 mm apart (scaled from the sample plan, unverified): the same trap as the 50% glass rule. If the business has a minimum it designs to, that is the default. |
| D-16 | Proposed | Enclosure defaults are read from sample drawings A101 to A103 and are unverified. Checked against the drawings: the **2120 mm door** and **500 mm header** are consistent with A102. The **50 mm ceiling build-up and the 2150 mm inside height are NOT confirmed** (A103 says "reinforced ceiling panel" with no thickness; no drawing shows a floor build-up, which moves the inside height as much as the ceiling does): only the drawing's authors can confirm either. | Owner confirms or corrects. |
| D-15 | **Confirmed** | With no supplier spec sheet, metal-rack capacity comes from a user-editable rack-module table whose fields start BLANK. Blank means "not set", never zero; `RACK_SPEC_MISSING` explains why. | Wait for the supplier sheet. |

## 11. Golden Test Case #01 and validation

A straight 2450 mm wall in a 2400 mm room, two room-wall ends, three bays 360 deep and 2200 tall, each a 400 mm label-forward display on a scalloped base (Bordeaux). Expected and tested: stack zone 2018, internal depth 338, 3 bays of **783 mm** (the 1 mm remainder to the end scribe), net width 751, 8 slots; base 1618 mm = 14 rows, 100.71 mm clear = 112 bottles; display 384 mm net = 2 tiers = 16; **128 a bay, 384 in all**; 66 cut-list pieces.

This is a **worked example, not a benchmark**: its numbers come from this specification. **Pending:** one real past job (room and bay dimensions, cut list, bottle count) as the acceptance test.

## 12. Milestones (v1 plan; see section 18 for the v1.1 order)

1. **M1 (built):** headless engine and tests: model, formulas, runs and corners, checks, cut list, golden case. `npm test` in `cellar-planner/`.
2. M2: project store, undo, library saving, 2D plan renderer on `planner-core`.
3. M3: wall elevation view, bay and module editing, Checks Panel UI.
4. M4: 3D (instanced bottles, materials, lights, doors).
5. Phase 2: layout generator, pricing and rate table, installer PDF and cut-list CSV, then the public front door.
6. Phase 3: photo overlay.

## 13. Reference documents (v1.1)

Three documents were read as page images, so details in drawings may be misread; values taken from them are **unverified until confirmed**.

- **Kings Winehaus, "Building a Wine Cellar"** (4 pages, the last blank): how a cellar room must be built (insulation, glass, doors, heat sources).
- **Carter Noir, "built in room plan sample"** (3 sheets, project M0103, A101 plan, A102 elevation, A103 axonometric): a walk-in cabinet enclosure for a builder.
- **Carter Noir, "copy customer plans and elevations"** (5 sheets): an 1800 x 1000 glass and aluminium walk-in with steel cantilever racking and timber shelves; plan, sections, elevations, isometrics and renders.

None states a bottle count, a rack pitch or a cut list, so **none validates the formulas**. Real-job validation (section 11) is still pending.

## 14. Product lines and rack systems

Both lines share a core and differ in what is inside:

| | Shared core | Racking inside |
|---|---|---|
| **Glass enclosure** | room or enclosure, door, per-wall build-up, header, conditioner, vents, sheets | `METAL_RACK`: steel posts and pins, timber shelves, drawers (to be specified) |
| **Joinery** | room, door, sheets | `CARCASS_JOINERY`: the built M1 engine (sections 3 to 9) |

A project has a `productType` (`ENCLOSURE_METAL_RACK` or `CARCASS_JOINERY`); the engine behind each is separate. The M1 engine is unchanged and remains the joinery engine.

**Metal racking, interim (built, `src/rack/`).** There is no supplier sheet, so the rack module is a **user-editable table whose fields start blank**. The same fields apply whether the values come from a supplier sheet or a fabricator's drawings: unit width, depth and height; row pitch; bottles per row; bottle orientation (neck-out or label-forward, which changes the depth needed); posts per unit; and optionally a stated number of rows. Capacity = rows x bottles per row x units, with rows = the stated number or floor(height / pitch) (the first row's offset is not modelled). **Blank is "not set", never 0**, and a rack with missing values raises `RACK_SPEC_MISSING` naming the fields, so it can never be counted or quoted as zero bottles. The quickest real numbers: one call to whoever fabricates the posts and rods for jobs like the 1800 x 1000 glass cabinet.

**Questions for the rod fabricator** (one call fills the whole table): unit width, depth and height; the vertical row pitch; how many bottles per row for each bottle type (Bordeaux, Burgundy, Champagne, Magnum) and the pin spacing behind that; **what "label-forward" means on their racks** (does the bottle lie side-on, at what angle, how much width does each take, how deep must the unit be); posts per unit; whether racks are single- or double-sided; lead time and price per unit.

**Label-forward depth is a joinery assumption on metal racks.** The depth a label-forward bottle needs reuses the joinery display rule (inclined footprint plus its 20 mm lip). A rod rack may hold the bottle differently and need more or less; treat it as unverified until the fabricator confirms how their label-forward rods hold the bottle.

**Placement (built, `src/placement/`).** Rack runs sit against the inside faces. Inside coordinates are millimetres from the inside north-west corner. A run has a wall, a start along it, a unit count and a spec. Checks: inside the wall and the height (`RUN_OUTSIDE`, `RUN_TOO_DEEP`, `RACK_TOO_TALL`); not across the door opening (`RUN_ON_DOOR`); clear of the quarter circle an inward-opening door sweeps, tested as a true arc (`RUN_IN_DOOR_SWING`); the floor inside an inward-opening door clear (`DOOR_PATH_BLOCKED`, skipped when the door swings out or no minimum is set); no two runs overlapping, so the second run at a corner starts after the first's depth (`RUN_OVERLAP`); and a walkway between facing runs, or a run and the far wall (`WALKWAY_TOO_NARROW`, a warning, one report per pair, only when the project sets a minimum; otherwise `WALKWAY_NOT_SET`, information). The hinge side is as seen from outside, facing the door. A run whose unit width or depth is blank has **no footprint** ("not set") and is skipped by the geometry, and the project total is "not set" (naming how many runs) until every run is complete. `fillWall` fits whole units either side of the door, or says "not set". Nothing is inferred from the 1:20 drawings (the 100 mm and 300 mm dimensions on them are not rack data).

## 15. Enclosure model (PROPOSED)

- **Build-up is per wall:** each wall has a thickness (50 mm insulated panel, 100 mm stud wall, or a glass/frame section). Internal size = outer size minus the build-ups. Example, sheet A101: 2850 x 1665 mm to the outer faces of 50 mm panels gives **2750 x 1565 mm inside**, but only if panels run on all four sides; the door wall (glass, doors, vent panels, no stud return) differs and must be set separately.
- **Components seen in the samples** (values as read, unverified): door 970 x 2120 (or 900 wide, swinging out) in a 2200 high enclosure; panel modules of 940 and 970 mm either side of the door; ceiling-mounted conditioner about 902 x 317 mm; the door hinged on the left as seen from outside (A101's open leaf is at the west jamb, and the A102 handle is on the right; the door diagonal on the elevations points to the handle side); vents 400 x 100 mm with dashed ducting zones; a ceiling header of 500 to 590 mm above the glass; a 2690 mm overall height on the larger job.
- **The header is a bulkhead above the enclosure** (the motor sits on the roof), not space inside it, so it never reduces the inside height.
- **Glass share, and the basis it is measured on:** the share (and the advisory 50% note that uses it) is measured on the **outer faces**: glass area over the four outer walls, `2 x (width + depth) x height` (2850 x 1665 x 2200 gives 19.87 m2). A glazed 970 x 2120 door is then **10.35%**. Measured on the inside faces instead (2 x (2750 + 1565) x 2150 = 18.56 m2) the same door is about **11.1%**. The outer basis is the one in the code and tests; it must not change without changing this line. How much of the door frame counts as glass moves it a little more. The glazed area of a door is smaller than its opening; the model does not yet take a glazed fraction.
- **Rules to carry over from the engine:** placement snapping, door swing clearance, no rack in a door's clearance.

## 16. Advisory guidance (PROPOSED, never an error)

Every item below is information only and is shown as: **Advisory only: requires mechanical engineer / HVAC sign-off.** None blocks a design, produces an error, or appears on a quote as a guarantee.

- Insulation is critical to a cellar conditioner working; the guide recommends 50 to 80 mm polyurethane foam (EPS about double the thickness) on the face of studs, with brick and concrete lined, not left bare.
- Glass: about 1.4 W/m2K or better (4 mm glass, 16 mm argon, 4 mm glass); glass adds heat load; the guide says at most 50% of cellar walls; free-standing glass cabinets exceed this, so it is a note only.
- Glass doors and frames thermally broken; doors sealed on all four sides.
- No heat source inside; slab heating at least 500 mm from the perimeter walls with a thermal break.
- Typical conditioner set point 14 to 18 degrees C (preset 15).

## 17. Drawing package (Phase 2, on request)

Generated by staff when a customer asks for drawings with a quote; customers get a preview (3D view, bottle count, estimate) unless asked. Sheets as in the samples: plan (A101), elevation (A102), axonometric (A103), then sections, isometric front and back, and a sheet of renders. A3 landscape, scale 1:20, a title block (project, client, address, drawing title, drawing number, project number, date, scale, drawn by, checked by, a logo), tick-mark dimension lines, leader callouts (for example "50mm WALL PANEL"), and ducting and vents shown dashed. The `planner-core` drawing primitives cover plan and elevation; sections and axonometric projection are new work. Every sheet carries `PRELIMINARY DESIGN ONLY: FINAL SITE MEASURE REQUIRED PRIOR TO FABRICATION`.

## 18. Milestones (v1.1)

M1 (built) and M2a (built, product-agnostic: commands, undo, store, file format, library binding) stand. **M2 is paused.** D-14 is decided (glass enclosure first). Order:

1. **Rack placement (built, `src/placement/`, 22 tests):** footprints, door opening and swing, landing, overlap, walkway, fill a wall, totals that stay "not set". Test sizes are invented. Not yet: free-standing runs, runs on the header side, a glazed-fraction for the door.
2. **Metal rack spec (built, `src/rack/`, 12 tests):** blank-by-default specification, "not set" capacity, `RACK_SPEC_MISSING`, depth by orientation, pitch and value checks. The numbers in its tests are invented to exercise the maths, not supplier values. Not yet: placing rack runs in the enclosure.
3. **Enclosure model (built, `src/enclosure/`, 21 tests):** per-wall build-up, internal size, door layout and swing, glass fraction, header parts, checks, advisories, and Golden Test Case #02 (sample A101 to A103 as read: 2750 x 1565 mm inside, door wall 940 | 970 | 940). Not yet: metal racking, wall/floor/ceiling panel cut list, the room the enclosure stands in.
4. Vault integration (table, API, feature flag, page): product-agnostic, can go any time.
5. **2D plan and wall elevation for the glass enclosure (built, standalone; section 19).**
6. Joinery in the same app (its engine is built).
7. Drawing package and the quote request flow (Phase 2).

## 19. The screens (built, standalone)

Run with `npm run dev` inside `cellar-planner/` (port 5176); `npm run e2e` drives it in Chrome. **It is not yet wired into Vault's build, nav or feature flags**: that integration is later, in its own commits, with the other planners' tests.

- **Plan** (from above), **Elevation** (any wall, seen from outside) and **Racks** (the inside face of a wall with every bottle drawn at true size) are drawn from pure primitives (`src/views/`), so the shapes are tested without a browser and can feed the drawing package later. Drag to pan, scroll to zoom, Fit to reset.
- **Panels** edit the enclosure (outer size, ceiling and floor build-up, per-wall kind and build-up), the door, the header parts, the rack specification, the project's minimum walkway, and the rack runs (add, edit, fill a wall). Every edit is one undo step.
- **Blank means not set, never zero**: rack fields and the walkway minimum start blank and say "not set"; the bottle total reads "not set (n runs without rack values)" until every run is complete; a required number cannot be blanked and a bad number is refused with a message.
- **Checks** list errors, then warnings, then information, each with its fix. **Advisory guidance** is separate and always carries the sign-off wording. The foot of every drawing says `PRELIMINARY DESIGN ONLY: FINAL SITE MEASURE REQUIRED PRIOR TO FABRICATION`.
- **Saving:** Save and Open a `.cellar.json` file (so the plan can be sent to someone to look at), plus a draft kept in the browser. Not yet: saving to the Vault account, dragging runs on the plan, free-standing runs, the drawing package PDF.
- **Help:** a first-visit guide (the (i) modal), a 13-step Shepherd tour (the compass; `?tour=1`; key `vault_tour_cellar_planner_completed`) and a tooltip on every control, as in the other planners; see `docs/cellar-planner.md`.
- **Tests:** `tests/app.test.ts` (model, store, file format), `tests/help.test.ts` (tour hooks, guide, tooltip coverage) and `scripts/e2e.mjs` (the screens, in Chrome: blanks and "not set", the 160 and 480 bottle totals from invented rack values, fill a wall, walkway warning, run error, undo and redo, inward door, bad numbers, save/open/draft).
