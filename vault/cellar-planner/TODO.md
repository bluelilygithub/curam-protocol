# Cellar Planner: to do

Saved 2026-10-07 (updated 2026-10-09) from a review of the app. Sources: `docs/cellar-planner.md` (Open items, What is built) and `specs/spec-v1.md`. Tick items off and date them as they are done.

## Blocked on outside answers

- [ ] **Rack values** from the rod fabricator: unit width, depth, height, row pitch, bottles per row for each bottle type, posts, and what "label-forward" means on their racks. Question list: spec section 14.
- [ ] **Ceiling and floor build-up** from the authors of the Carter Noir sample drawings (sets the inside height).
- [ ] **Minimum walkway** the business designs to (blank = not checked).
- [ ] **A real past job** (dimensions, cut list, bottle count) as the acceptance test. Golden cases #01 and #02 are worked examples, not real-job validation.
- [ ] **Lighting supplier questions** (spec 20.5). The owner's lighting text was cut off mid-sentence; ask for the rest.
- [ ] Confirm every number read from the Carter Noir sheets (hinge side, door size, 940 | 970 | 940 split, header, vents).

## Mobile and touch: remaining

Phone layout, pinch-zoom, touch pan, tap-friendly hints and the phone/tablet tests are built (see Done below).

- [ ] **Check inside Vault's iframe** (`client/src/pages/CellarPlannerPage.jsx`) with Vault's mobile sidebar and the iframe height. Page code reviewed 2026-10-09 (iframe is flex 100%, should be fine); not yet seen on a real phone.
- [ ] **Real-device test** (iOS Safari, Android Chrome). So far only Chrome touch emulation.

## Lite version for the public website: remaining

Built 2026-10-09 (see Done below and `docs/cellar-planner.md`, "Lite version for the public website"): the static bundle, the screen, the design code and `?d=` link, the postMessage hand-off with origin checks, the WordPress fill script, "From design code" in the full planner, the round-trip test and a phone-size browser test. What is left needs the real website or a real device.

- [ ] **Try it on the real WordPress page**: upload `dist-lite/`, add the iframe and `lite-wordpress/cellar-lite-fill.js`, set `PLANNER_ORIGIN` and the two field selectors to match the actual enquiry form (Contact Form 7, WPForms or similar), send a test enquiry end to end.
- [ ] Check the site's security plugin and any Content-Security-Policy allow the iframe and the fill script.
- [ ] **Real-device check** of the lite page (iOS Safari, Android Chrome): typing in the fields (no page zoom), pinch-zoom, the quote step.
- [ ] **Wording review**: every number on screen and in the enquiry says "estimate only, final site measure required". Owner to read the screen text (heading, intro, labels, hints, foot line, quote step) and the new guide and tour text (`src/lite/LiteHelp.tsx`, `src/lite/liteTour.ts`); try them on someone who knows nothing about cellars.
- [ ] Decide the iframe height or auto-resize (the page is a single column; today the host sets a fixed height, about 1100px). Optional: the page posts its height to the host.
- [ ] Add a lite check to the CSP script (`scripts/cspCheck.mjs`) if the site uses a strict policy.
- [ ] Optional: a tiny WordPress plugin or shortcode to place it, if hand-editing the page proves awkward.
- [ ] **Later (not part of the first lite version):** a styled 3D picture, a pricing estimate, a choice of which walls to fill, and a Vault-hosted public endpoint if the site's own form isn't enough.

## Features not built

- [ ] **Double door extras:** one fixed leaf with one opening leaf, unequal leaves, and confirming the typical 1500 mm double opening (and which widths are offered) with the cabinet maker.
- [ ] 3D view (spec M4; instanced bottles, materials, lights, doors).
- [ ] Pricing and rate table; quote request flow; public front door.
- [ ] **Lighting** (spec section 20): LED strips, post lights, spotlights as placed parts, advice, parts list, drawing symbols.
- [ ] Drawing package extras: sections, isometric and axonometric views, renders, logo image, elevations of the other three walls, parts and hardware list, sending the package to a customer or installer.
- [ ] Placement: free-standing runs, runs on the header side, dragging runs on the plan, glazed fraction for the door.
- [ ] Enclosure: wall, floor and ceiling panel cut list; the room the enclosure stands in.
- [ ] Joinery product line in the same app (its engine in `src/engine/` is built, the screens don't use it).
- [ ] Connect the screens to the commands layer (`src/domain`, `src/state`); the old joinery library binding in `src/state/library.ts` is unused.
- [ ] Admin-facing way to edit assumptions and rates.

## Housekeeping

- [ ] Run the by-hand staging checks (`docs/cellar-planner.md`, "Staging checks") and record the result.
- [ ] Decide whether `npm run e2e` should run in CI (it does not today).
- [ ] Screen-reader pass; the drawings give only headline numbers as text.

## Done

- [x] 2026-10-09 Docs: `docs/cellar-planner.md` status line and `specs/spec-v1.md` section 19 corrected (Vault wiring and saved designs exist).
- [x] 2026-10-09 Pinch-zoom on the drawings; `touch-action: none` so one finger pans without scrolling the page.
- [x] 2026-10-09 Phone layout under 700px: Controls / Drawing / Checks tabs, one pane at a time.
- [x] 2026-10-09 Narrow-screen fields: name input 150px on phones, single-column forms.
- [x] 2026-10-09 Tap-friendly hints: a field's explanation shows under it on touch screens.
- [x] 2026-10-09 Phone (390px) and tablet (820px) viewports in `scripts/e2e.mjs` with axe-core scans, plus touch pan and pinch checks.
- [x] 2026-10-09 Mobile support documented in `docs/cellar-planner.md` ("Phones, tablets and touch").
- [x] 2026-10-09 Lite version built: `lite.html` + `src/lite/` (own build `npm run build:lite`, relative base, output `dist-lite/`), inputs for inside size, door wall, bottle style and fill-or-target, plan and racks drawings, bottle estimate marked estimate only, request-a-quote step with copy fallback.
- [x] 2026-10-09 Design code (`CL1.`, settings only) and `?d=` link; hand-off by `postMessage` to the embedding page (origin from the referrer, checked again by the WordPress script); `lite-wordpress/cellar-lite-fill.js`.
- [x] 2026-10-09 Staff side: **From design code** dialog and `?d=` on the full planner add the visitor's design as a new design.
- [x] 2026-10-09 Tests: `tests/lite.test.ts` (round trip into the full planner) and `scripts/e2e-lite.mjs` (phone size, hand-off, fill script, staff dialog, axe scan). How-to-update steps written in `docs/cellar-planner.md`.
- [x] 2026-10-09 Lite help for casual visitors: plain-language guide (opens once on a first visit, Help button), nine-step tour (Take the tour, `?tour=1`), always-visible hint under every question; tests in `tests/lite.test.ts` and `scripts/e2e-lite.mjs`.
- [x] 2026-10-09 Single and double doors in the full planner (model, plan, elevation, checks, panel, drawing package) and the lite tool (Door type question, design code, summary, help and tour). See `docs/cellar-planner.md`, "Single and double doors".
