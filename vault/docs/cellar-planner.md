# Cellar Planner

Walk-in wine cellar configurator. **Glass enclosure with metal racking first**, then carcass joinery. Bespoke-first: everything is driven by dimensions in whole millimetres, not product codes. Code: `vault/cellar-planner/` (own Vite app on `planner-core`). Full specification and decisions log: `cellar-planner/specs/spec-v1.md` (v1.1).

> **Status: in Vault, switched off by default.** The page is at **`/cellar-planner`** (an iframe hosting the built app at `/cellar-planner-app/`, the same pattern as Garden Planner), with a nav item **Cellar Planner** (Content Creation), a Settings → **Cellar Planner Tour** card, and the feature flag **`cellarPlanner`**. The flag **defaults to off** (it is a work in progress with unverified values): an admin switches it on in **Settings → Feature Access**, which shows the nav item. The `/cellar-planner` page itself does not depend on the flag (as for the other planners), so the address works for any signed-in user. There is **no server route, table or API**: the planner saves to a `.cellar.json` file and a browser draft. It is built by the root `npm run build` (`scripts/buildCellarPlanner.js`, non-fatal: if it fails Vault still deploys and the page shows a "not available in this build" notice). It can also run alone with `npm run dev` inside `cellar-planner/` (port 5176, `http://127.0.0.1:5176/cellar-planner-app/`, trailing slash included).

## What is built

| Part | Where | State |
|---|---|---|
| Joinery maths engine (stack, scalloped rows, label-forward displays, depth, width, runs, scribes, corners, checks, cut list) | `src/engine/` | Built, tested. The **joinery** product's engine. |
| Glass enclosure model (per-wall build-up, door, header parts, checks, advisories) | `src/enclosure/` | Built, tested |
| Metal rack specification (blank by default; "not set", never 0) | `src/rack/` | Built, tested |
| Rack placement in the enclosure (door opening and swing arc, landing, overlap, walkway, fill a wall) | `src/placement/` | Built, tested |
| 2D plan and wall elevation as pure drawing primitives | `src/views/` | Built, tested |
| Project model layer (invertible commands, store, file format, library binding) | `src/domain/`, `src/state/` | Built, tested; **not used by the screens yet** (see below) |
| Screens, guide, tour, tooltips | `src/App.tsx`, `src/ui/`, `src/app/`, `src/help/` | Built, tested in Chrome |
| Saving to the Vault account, 3D view, pricing, drawing-package PDF, quote request, public front door | | **Not built** |

The screens edit a simple model (`src/app/model.ts`: one enclosure, one rack spec, the runs, the walkway minimum) with undo and redo in `src/app/store.ts`. The commands/library layer in `src/domain` and `src/state` (built for the joinery cabinets and the Vault library) is not connected to them yet.

## Using it

- **Sample** loads the Carter Noir sample enclosure **as read** from sheets A101 to A103 (2850 x 1665 x 2200 mm, 50 mm panels, a 970 x 2120 door centred on the south wall hinged on the left, a 500 mm header with a conditioner and two vents). **Every number from the sample is unverified.**
- **Enclosure panel:** outer sizes (to the outer faces), ceiling and floor build-up, header height. **Walls:** each wall's kind (insulated panel, framed glass, stud wall) and build-up; the build-ups are taken off to give the **inside size** (sample: 2750 x 1565 x 2150). **Door:** wall, size, swing, hinge as seen from outside, offset (blank = centred), glazed. **Header:** conditioner and vents, positioned from the header's left end.
- **Rack specification:** unit width, depth, height; row pitch; bottles per row; orientation; posts; optional rows. **All start blank.** **Minimum walkway:** blank until you set it.
- **Rack runs:** add a run on a wall, or **Fill** a wall with whole units (leaving the door opening free).
- **Plan** (from above) and **Elevation** (any wall, seen from outside). Scroll to zoom, drag to pan, **Fit**.
- **Checks** (errors, then warnings, then information, each with a fix) and **Advisory guidance** are on the right.
- **Save file / Open file** (a `.cellar.json`), plus a draft kept in the browser. Undo and redo cover every edit.

### The rules that matter

- **Blank is "not set", never zero.** A blank rack field is shown as "not set"; a run with a blank unit width or depth has no footprint and is skipped by the geometry; the bottle total reads "not set (n runs without rack values)" until every run is complete; `RACK_SPEC_MISSING` names the missing values. There are no invented rack defaults.
- **The walkway minimum has no default and is only ever a warning.** Blank = not checked (one information note says so). A step-in glass cabinet and a walk-in room are designed to different minimums (D-17).
- **The floor-inside-the-door check applies only when the door swings in.** An inward door also gets the swing sweep tested as a true quarter circle.
- **Advisory guidance never blocks a design.** Insulation, glass (about 1.4 W/m2K or better, thermal breaks, sealed doors) and heat-source notes from the Kings Winehaus guide are information only and always begin *"Advisory only: requires mechanical engineer / HVAC sign-off."* The glass share (and the advisory 50% note that uses it) is measured on the **outer faces** (10.35% for the sample).
- **Every drawing carries** `PRELIMINARY DESIGN ONLY: FINAL SITE MEASURE REQUIRED PRIOR TO FABRICATION`.
- **The header is a bulkhead above the enclosure**, not space inside it, so it never reduces the inside height.
- **Label-forward depth is a joinery assumption on metal racks** (inclined footprint plus a 20 mm lip) until the fabricator confirms how their rods hold the bottle.

## Help: guide, tour, tooltips

Same pattern as Room Planner and Garden Planner.

- **How this works** (`src/ui/InfoModal.tsx`, the **(i)** button): the plain-language guide. **Opens once on the first visit** (localStorage `cellar-planner:info-seen:v1`), then from the button. Covers what it is, getting started, the two drawings, racks and what "not set" means, checks and advice, saving, and what is not built yet.
- **Guided tour** (`src/help/cellarTour.ts`, the **compass** button): 13 Shepherd.js steps (the same library and look as Vault's tours), loaded on first use so it stays out of the main bundle. The tour is data (`TOUR_STEPS`), tested against the `data-tour` hooks on the screen so it cannot drift away from it. The elevation step switches to the elevation and the drawing step back to the plan; the screen is put back when the tour ends. Completing or skipping sets **`vault_tour_cellar_planner_completed`** (the key Vault's other tours use, so Settings can show "Retake Tour"), and **`?tour=1`** starts it (how Vault's Settings page will retake it).
- **Tooltips:** the shared themed tooltip (`@planner-core/help/TooltipHost`, the same look as Vault's). Every button, field, menu and tab has a plain-language `title` or `hint`, written as real sentences; a test fails if one is missing. Cards are capped at 160 px wide: the shared placement keeps a card's centre 80 px from the window edge, so a wider card runs off the screen beside the left panel. (This is a latent limit in `planner-core/src/help/tooltipLogic.ts`, which assumes 240 px cards; it was not changed here because it is shared with the other planners.)

## Tests

- `cd cellar-planner && npm test` runs **180** unit and property tests (`tests/`): the joinery engine and Golden Test Case #01; the enclosure and Golden Test Case #02; the rack spec; placement; the views; the app model and store; the help (tour hooks, guide content, tooltip coverage); the commands, store and library layer. `npm run typecheck` checks the types. **CI** (`.github/workflows/build-check.yml`, job "Cellar Planner engine") runs both on every push to `staging`, `version-7` and `main`.
- `node scripts/cspCheck.mjs` (after `npm run build`) serves the production build under Vault's production Content Security Policy and opens the app, guide, tour and both drawings: **0 violations**. The dev server has no policy, so this is the check that matches the real site.
- `npm run e2e` (dev server running first) drives the screens in real Chrome: the sample, the blanks and "not set", the invented 160 and 480 bottle totals, fill a wall, the walkway warning, a run error, undo and redo, an inward door, bad numbers, save/open/draft, and the whole help flow (first-visit guide, tooltips, the 13-step tour, `?tour=1`, Esc). Not part of CI.
- **All rack sizes in the tests are invented** to exercise the maths; none is a supplier's value. The golden cases are worked examples, **not real-job validation** (still pending, spec section 11).

## Open items

1. **Rack values** from whoever fabricates the posts and rods: unit width, depth, height, row pitch, bottles per row, orientation, posts. This turns "not set" into real counts.
2. **Ceiling and floor build-up** (and so the inside height) from the authors of the sample drawings.
3. **Minimum walkway** the business designs to (blank until set).
4. **Saving to the Vault account** (a `cellar_projects` table and `/api/cellar-projects`, using the library binding already built in `src/state/library.ts`), and connecting the screens to the commands layer. Not built.
5. A real past job (dimensions, cut list, bottle count) as the acceptance test for the joinery formulas.

## Staging checks (for you, by hand)

On staging: sign in, open **`/cellar-planner`**, and (admin) switch **Cellar Planner** on in **Settings → Feature Access** to see it in the nav. Or locally: `npm run dev` in `cellar-planner/`, open `http://127.0.0.1:5176/cellar-planner-app/`. Use a private window so nothing is "already seen".

1. The guide opens by itself; **Got it** closes it; refreshing does not reopen it; **(i)** does.
2. The compass starts the tour; step through all 13; **Finish** ends it; Esc ends it; `?tour=1` starts it. In Vault, **Settings → Cellar Planner Tour** (Take / Retake Tour) opens the page and runs it.
3. Hover every control in the left panel: each shows a short explanation, and none runs off the screen.
4. Load **Sample** and set it beside A101, A102 and A103. Report anything that differs: hinge side, door size, header, vents, the 940 | 970 | 940 split, the inside size.
5. Enter any rack numbers and press **Fill** on the north wall: bottles appear. Blank one field: the total goes back to "not set".
6. Set the door to swing in, set a minimum walkway, and place a run in front of it: the keep-clear zone and the warning appear.
7. Elevation: check each wall, and that the door diagonal points to the handle side.
8. **Save file**, change something, **Open file**: it comes back exactly.
9. Anything the guide or a tooltip says that is wrong or confusing for a real customer or installer.
