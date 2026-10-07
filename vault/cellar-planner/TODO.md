# Cellar Planner: to do

Saved 2026-10-07 from a review of the app. Sources: `docs/cellar-planner.md` (Open items, What is built) and `specs/spec-v1.md`. Tick items off and date them as they are done.

## Blocked on outside answers

- [ ] **Rack values** from the rod fabricator: unit width, depth, height, row pitch, bottles per row for each bottle type, posts, and what "label-forward" means on their racks. Question list: spec section 14.
- [ ] **Ceiling and floor build-up** from the authors of the Carter Noir sample drawings (sets the inside height).
- [ ] **Minimum walkway** the business designs to (blank = not checked).
- [ ] **A real past job** (dimensions, cut list, bottle count) as the acceptance test. Golden cases #01 and #02 are worked examples, not real-job validation.
- [ ] **Lighting supplier questions** (spec 20.5). The owner's lighting text was cut off mid-sentence; ask for the rest.
- [ ] Confirm every number read from the Carter Noir sheets (hinge side, door size, 940 | 970 | 940 split, header, vents).

## Mobile and touch (added 2026-10-07)

Today: tablets are usable, phones are poor, and nothing is tested on touch devices.

- [ ] **Pinch-zoom** on the drawings. Zoom is mouse-wheel only (`src/ui/DrawingView.tsx`, `s.on('wheel')`). Add two-finger pinch.
- [ ] **`touch-action: none`** on the drawing so dragging pans it instead of scrolling the page.
- [ ] **Phone layout** under about 700px: a single column with Controls / Drawing / Checks tabs. At present the narrowest layout keeps a 280px left column beside the drawing (`src/styles.css`, `@media (max-width: 1100px)`), which leaves about 100px on a 390px phone.
- [ ] **Fixed-width fields**: the design name input is 260px; check the top bar on narrow screens.
- [ ] **Tap-friendly tooltips**: every control's explanation is hover-only. Show the hint under the field, or on tap.
- [ ] **Check inside Vault's iframe** (`client/src/pages/CellarPlannerPage.jsx`) with Vault's mobile sidebar and the iframe height.
- [ ] **Mobile tests**: add a phone-size and a tablet-size viewport to `scripts/e2e.mjs` and the axe-core scan, and test touch pan and pinch.
- [ ] Document mobile support in `docs/cellar-planner.md` (it is not mentioned there today).

## Lite version for the public website (added 2026-10-07)

Decided: a "play" tool embedded in a WordPress site on SiteGround (not on Railway), saving the visitor's settings and sending them with an enquiry. No need to wait for real rack values: every figure says "estimate only".

**Approach: a static bundle, no Vault involved.**
- [ ] Second Vite entry (`lite.html` + `src/lite/`) reusing `src/engine`, `src/enclosure`, `src/rack`, `src/placement` and `src/views`. Own build config with a relative `base` (`./`) so the folder works at any path. Output: one small static folder, no Vault login, no API calls, no saved-designs library.
- [ ] Simple screen, three or four inputs: inside size (or width, depth, height), door wall, bottle style, and either a bottle target or a "fill the walls" choice. Hide build-up, header parts, rack spec fields and the checks list (show a plain-language warning if a design can't be built).
- [ ] Show the plan and Racks view, a bottle count labelled **estimate only, not a quote**, and the "request a quote" step.
- [ ] Use the Test case's best-guess rack values as the built-in defaults, marked estimated (never quote from them).
- [ ] Phone layout and pinch-zoom are required here (see Mobile and touch above); visitors will mostly be on phones.

**Settings and the enquiry**
- [ ] A **design code**: the lite settings serialised to a short, versioned, copyable string (and a `?d=` link that reopens the design). Contains settings only, no personal data.
- [ ] **Hand-off to WordPress**: the embedded page posts the design code and a one-line summary to its parent with `postMessage` (check the origin on both sides), and a small script on the WordPress page fills hidden fields in the existing enquiry form (Contact Form 7, WPForms or similar). Fallback if the script is absent: a "Copy my design" button to paste into the form.
- [ ] **No server of ours.** The enquiry goes through the site's own form and email, so nothing public is added to Vault (no spam handling, rate limits or retention rules to build).
- [ ] **Staff side**: paste a design code (or open the link) in the full Cellar Planner to load it as a new design. Add "Open from design code" next to Open file; it adds a design, never overwrites.
- [ ] Round-trip test: lite settings -> code -> full planner gives the same enclosure, runs and bottle total.

**Delivery to SiteGround**
- [ ] Upload the built folder to the site (for example `public_html/cellar-lite/`) via Site Tools -> File Manager or SFTP, and embed it with an iframe (WordPress Custom HTML block). Same domain, so no cross-site header changes.
- [ ] Check the site's security plugin and any Content-Security-Policy allows the iframe and the small fill-the-form script.
- [ ] Write the how-to-update steps (build, zip, upload) in `docs/cellar-planner.md`.
- [ ] Wording review: every number on screen and in the enquiry says "estimate only, final site measure required".
- [ ] Optional later: a tiny WordPress plugin or shortcode to place it, if hand-editing the page proves awkward.

**Later (not part of the first lite version):** a styled 3D picture, a pricing estimate, and a Vault-hosted public endpoint if the site's own form isn't enough.

## Features not built

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

- [ ] `docs/cellar-planner.md` status line says "no server route, table or API"; saved designs now use `cellar_projects` and `/api/cellar-projects`. Fix.
- [ ] `specs/spec-v1.md` section 19 says the app is not wired into Vault's build, nav or flags. It is. Fix (also the "Not yet: saving to the Vault account" line in the Saving bullet).
- [ ] Run the by-hand staging checks (`docs/cellar-planner.md`, "Staging checks") and record the result.
- [ ] Decide whether `npm run e2e` should run in CI (it does not today).
- [ ] Screen-reader pass; the drawings give only headline numbers as text.
