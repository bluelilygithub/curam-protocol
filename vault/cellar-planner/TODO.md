# Cellar Planner: to do

Saved 2026-10-07 (updated 2026-10-09) from a review of the app. Sources: `docs/cellar-planner.md` (Open items, What is built) and `specs/spec-v1.md`. Tick items off and date them as they are done.

## Blocked on outside answers

- [ ] **Rack values** from the rod fabricator: unit width, depth, height, row pitch, bottles per row for each bottle type, posts, and what "label-forward" means on their racks. Question list: spec section 14.
- [ ] **Ceiling and floor build-up** from the authors of the Carter Noir sample drawings (sets the inside height).
- [ ] **Minimum walkway** the business designs to (blank = not checked).
- [ ] **A real past job** (dimensions, cut list, bottle count) as the acceptance test. Golden cases #01 and #02 are worked examples, not real-job validation.
- [ ] **Lighting supplier questions** (spec 20.5). The owner's lighting text was cut off mid-sentence; ask for the rest.
- [ ] Confirm every number read from the Carter Noir sheets (hinge side, door size, 940 | 970 | 940 split, header, vents).
- [ ] **Send the trade question lists** (added 2026-10-24). To the **rack fabricator**: where tall runs (over 2000 mm) are fixed (floor shoe, top tie-back, ceiling bracket); the approved fixing for a rack against a 50 mm insulated panel wall; the clearance needed between a run's end upright and a perpendicular wall; whether uprights are pre-routed for LED wiring and where the wiring leaves the carcass. To the **enclosure (panel and glass) supplier**: what fixing or pull-out load the panel allows, or whether racks need their own floor-to-ceiling bracing; the dead load the header can carry; the floor perimeter channel and thermal break; how much gap scribes and cover trims can hide each side, and the clearances needed to deliver and stand the panels. To the **HVAC contractor and electrician**: a plug-in outlet or an isolator for the conditioner; the sleeve size through the header or wall; condensate pipe size, fall, and whether the unit has a lift pump.

## Commercial protection: next (small, needs no outside answers)

Agreed 2026-10-24 after a design discussion: the only two additions worth building now are the ones that stop a quote and a design drifting apart. Everything else from that discussion is parked below.

- [ ] **Job status with an acceptance record.** A `jobStatus` on the design set by plain buttons: enquiry, quoted, accepted, site measured, issued for construction (plus on hold, declined, lost); it can move backward. Accepting records the date, how (email, PO, deposit, verbal, other), a reference and a note, and names the quote revision accepted; it cannot be set while no quote has been made. The planner keeps its own status and never takes it from the CRM deal stage. It keeps posting a timeline note to the CRM when a quote is made (already built, `src/app/leads.ts`).
- [ ] **Frozen quote with an "out of date" warning.** Making a customer quote stores a snapshot with the design: the quote lines and totals, the catalogue prices, costs and terms used at that moment, and a fingerprint of what the customer is promised. The fingerprint is a normalised, versioned hash of the retail lines and total, outer sizes and wall types, bottle style, door and swing, finish, and each run's wall, unit count, rack type, orientation and bottle total. It leaves out run positions, run ids, internal margin that does not change the retail price, and any technical or drafting notes. If the design's fingerprint differs from the last quote's, show "Quote is out of date". Before acceptance that is only a warning; after acceptance a change needs an explicit **Issue revision** (Rev A, Rev B, earlier ones kept). Check how large a saved design gets and cap the number of revisions kept (a design is limited to 2 MB). The drawing package title block should print the quote revision.

## Ideas: only if a real job or a drafter asks for them

Parked 2026-10-24. These build on supplier numbers nobody has yet, so none is started and none is in the spec. Do the trade question lists and one real job first.

- Mixed rack types in one design: an optional rack type on each run, falling back to the design's type. The engine reads one rack specification for the whole design today, so capacity, placement and checks would resolve it per run; an unknown run type must be an error, never a silent fall-back to the default; a quote needs every type used to be confirmed.
- Site measure record (measured room opening and ceiling height, measured by) with a fit check: a room smaller than the enclosure is always an error; extra room is fine up to a tolerance the installer supplies (blank until they do); a measurement never revises a quote by itself, changing the enclosure does.
- A Sales view and a Technical view as two saved panel layouts (`layoutPrefs.ts`), not a permissions system.
- Drawing set extras: the other three wall elevations, a section cut, a parts and carcass schedule; DXF layer names configurable in Settings, empty layers left out, a layer picker in the download.
- Technical sheets carry an "unverified" notice until the ceiling and floor build-up, anchoring and HVAC details are confirmed (one verification panel; the rack supplier tick comes from the catalogue's existing confirmed flag).
- Rough-in markers on the plan (power supply point, condensate, line-set sleeve, sensor), each saying a licensed electrician or HVAC contractor must verify; anchoring method per run; stud grids only on stud walls, with a warning, not a ban, for fixings into insulated panel or glass. Australian terms throughout (noggings, 230 V, GPO or isolator, DN20 or DN25).

## Mobile and touch: remaining

Phone layout, pinch-zoom, touch pan, tap-friendly hints and the phone/tablet tests are built (see Done below).

- [ ] **Check inside Vault's iframe** (`client/src/pages/CellarPlannerPage.jsx`) with Vault's mobile sidebar and the iframe height. Page code reviewed 2026-10-09 (iframe is flex 100%, should be fine); not yet seen on a real phone.
- [ ] **Real-device test** (iOS Safari, Android Chrome). So far only Chrome touch emulation.

## Lite version for the public website: remaining

Hosting: either upload `dist-lite/` to SiteGround, or use Vault's `/cellar-lite/` on Railway (built in; set `CELLAR_LITE_FRAME_ANCESTORS` to the website's origin). Decide which, then try it on the real page.

Built 2026-10-09 (see Done below and `docs/cellar-planner.md`, "Lite version for the public website"): the static bundle, the screen, the design code and `?d=` link, the postMessage hand-off with origin checks, the WordPress fill script, "From design code" in the full planner, the round-trip test and a phone-size browser test. What is left needs the real website or a real device.

- [ ] **Try it on the real WordPress page**: upload `dist-lite/`, add the iframe and `lite-wordpress/cellar-lite-fill.js`, set `PLANNER_ORIGIN` and the two field selectors to match the actual enquiry form (Contact Form 7, WPForms or similar), send a test enquiry end to end.
- [ ] Check the site's security plugin and any Content-Security-Policy allow the iframe and the fill script.
- [ ] **Real-device check** of the lite page (iOS Safari, Android Chrome): typing in the fields (no page zoom), pinch-zoom, the quote step.
- [x] 2026-10-11 A "best on a computer or tablet" note on phone-sized screens in the public planner (owner-editable wording, off switch, never blocks). Still to check on a real phone and to read for wording.
- [ ] **Wording review**: every number on screen and in the enquiry says "estimate only, final site measure required". Owner to read the screen text (heading, intro, labels, hints, foot line, quote step) and the new guide and tour text (`src/lite/LiteHelp.tsx`, `src/lite/liteTour.ts`); try them on someone who knows nothing about cellars.
- [ ] Decide the iframe height or auto-resize (the page is a single column; today the host sets a fixed height, about 1100px). Optional: the page posts its height to the host.
- [ ] Add a lite check to the CSP script (`scripts/cspCheck.mjs`) if the site uses a strict policy.
- [ ] Optional: a tiny WordPress plugin or shortcode to place it, if hand-editing the page proves awkward.
- [ ] **Later (not part of the first lite version):** a styled 3D picture, a pricing estimate, a choice of which walls to fill, and a Vault-hosted public endpoint if the site's own form isn't enough.

## Features not built

- [x] 2026-10-12 Feature options ("Make it yours" step, staff Features panel, low/high prices in Settings, quote lines): see `docs/cellar-planner.md`, "Feature options". Still open: the owner to enter real prices (or press **Fill example prices** and adjust); special-storage options do not yet change capacity or drawings (needs the fabricator's bay values); the Settings screen has no browser test; the WordPress script's event list does not yet include `feature` (the page ignores it, harmless).
- [ ] **Double door extras:** one fixed leaf with one opening leaf, unequal leaves, and confirming the typical 1500 mm double opening (and which widths are offered) with the cabinet maker.
- [x] 2026-10-10 3D view in the staff planner (the public tool's inside view, finishes, in the drawing package and quote). Still open: header, conditioner and vents are not drawn in 3D; a full 3D editor (spec M4: materials, lights, doors) is not built.
- [x] 2026-10-10 Pricing, rate table (the rack catalogue), the customer quote and the website enquiry flow. Still open: glass, cooling unit, lighting and installation prices, and a parts list.
- [ ] **Lighting** (spec section 20): LED strips, post lights, spotlights as placed parts, advice, parts list, drawing symbols.
- [ ] Drawing package extras: sections, isometric and axonometric views, renders, logo image, elevations of the other three walls, parts and hardware list, sending the package to a customer or installer.
- [x] 2026-10-10 Dragging runs on the plan (snapping, one-click fixes).
- [ ] Placement: free-standing runs, runs on the header side, glazed fraction for the door. Mixed rack types in one design.
- [ ] Rooms that are not rectangular (L-shaped and so on).
- [ ] Enclosure: wall, floor and ceiling panel cut list; the room the enclosure stands in.
- [ ] Joinery product line in the same app (its engine in `src/engine/` is built, the screens don't use it).
- [ ] Connect the screens to the commands layer (`src/domain`, `src/state`); the old joinery library binding in `src/state/library.ts` is unused.
- [x] 2026-10-10 Admin-facing way to edit rack types, prices, quote details and cooling assumptions (Cellar Planner -> Settings).
- [ ] Confirm the cooling assumptions with the suppliers or an HVAC person (the starting values are typical, not verified), and add a room-position input (a cellar inside a warm building is not at the outside temperature).
- [ ] Cooling: per-design ambient allowance for a cellar inside a conditioned house; humidity.
- [ ] Keyboard way to move a run on the plan (the Start field in Rack runs does it today).

## Housekeeping

- [ ] Run the by-hand staging checks (`docs/cellar-planner.md`, "Staging checks") and record the result.
- [ ] Decide whether `npm run e2e` should run in CI (it does not today).
- [ ] Screen-reader pass; the drawings give only headline numbers as text.

## Done

- [x] 2026-10-24 Lite layout refresh from the alternative mockup: sticky footer with Back / Next (kept on phones only: it rides the visible window inside the WordPress iframe through the page script; on desktop and tablet it was tried and removed the same day, Back / Next end the panel again), labelled header buttons, Features groups as accordions, no price on cards that cannot be chosen. Guide, tour, website help chat and docs updated. **Still to do:** upload the new `cellar-lite-fill.js` and check on a real phone (iOS Safari, Android Chrome); an optional label for extras while prices are unpublished; an option to hide the "Cellar Planner" title when embedded.

- [x] 2026-10-10 Shared rack catalogue and staff price, customer quote, website enquiries to the CRM, technician calculation help, drag runs / one-click fixes / status strip / panel layout, indicative cooling estimate, 3D tab. Guide, tour and docs brought up to date.

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
- [x] 2026-10-09 Lite served by Vault on Railway at `/cellar-lite/` (public, static, own headers, embeddable only by `CELLAR_LITE_FRAME_ANCESTORS`); checked in Chrome with the real production headers: allowed site embeds it and receives the design, any other site is refused.
