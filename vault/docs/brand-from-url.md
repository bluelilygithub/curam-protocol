# Brand from a website

Status: **all seven steps done and pushed (2026-11-07), plus brand-font text in Watermark and Batch Text afterwards. Every text tool now uses it, including Batch, Pipeline and saved recipes.** Private learning exercise, modelled on the idea behind `sunil-dsb/design.md` (read a live site's real design, write it down for a tool to use). Our version feeds **Graphics → Brand Kit**.

## The plan (agreed with the owner)

1. Extraction service (**done**: `server/services/brandFromUrl/`).
2. Route (**done**, see below). Returns a proposal; saves nothing. The font files stay on the server under a short-lived id and "Use this" will refer to it, rather than sending megabytes of base64 to the browser and back. The screen (step 4) shows `ProcessingModal` while it runs.
3. Storage and "Use this" (**done**, see below).
4. Brand Kit panel (**done**, see below): "Get from a website", preview (swatches, font sample, logo candidates with a swap), **Use this**. New fields are optional so an old kit works unchanged.
5. DESIGN.md download built from the saved kit (**done**, see below).
6. Consumers (**done for Text Overlay and Composite text layers**, see "Text rendering" below).
7. Tooltips, tour step, guide `CATALOG` entry, Changelog entry per commit.

## The route (step 2)

`server/routes/graphics/brandFromUrl.js`, mounted in `routes/graphics.js`, so it sits behind the `graphics` flag and the route-wide AI limiter like every Graphics route. No new flag.

- `POST /api/graphics/brand-from-url { url }` returns `{ ok, id, expiresInSec, sourceUrl, finalUrl, title, colours, palette, dark, radius, fonts, logos, logoIndex, warnings }`. Font files are NOT in the reply (only their facts: `renderFamily`, `weight`, `bytes`, `ext`, `sha256`); the logos are 512px PNG data URLs (about 40 KB each), so a reply is roughly 100 to 250 KB.
- `GET /api/graphics/brand-from-url/:id/font/:role` (`heading` or `body`) returns the converted font (`font/ttf` or `font/otf`, `no-store`) so the preview can show a sample with `@font-face` from a blob.
- The proposal is held **in memory for 30 minutes** under a random 32-hex id (`services/brandFromUrl/proposalStore.js`): at most 6 per person and 120 in all, owner only (another person's id answers 404, not "not yours"). A restart or the time running out means "read the website again". Step 3 decides where a chosen font is kept for good.
- **Limits** (it costs no money but each run is a browser page): one read at a time per person, 12 an hour (429 with a plain message). Bad input 400; unreachable, private or unknown address 422; busy 503; an unexpected failure 500 with a generic message (the detail goes to the log, which records the host only, never the full URL).
- Tests: `node server/routes/graphics/brandFromUrl.test.js` (stubbed reader: validation, no font bytes leaked, owner only, expiry, bounds, error messages, one at a time). Also run once end to end on 2026-11-07 against a live site and against `localhost` and `169.254.169.254` (both refused).
- Not yet in `crossUserOwnership.test.js` (that one needs a database); the unit test covers the same rule.

## Keeping it: storage and "Use this" (step 3)

Table `graphics_brand_fonts` (`server/db.js`, notes in `docs/schema-notes.md`): the font **file** as `BYTEA`, one heading and one body row per person. The rest of the Brand Kit stays the JSON in `settings.graphics_brand_kit`, which the Graphics screen already reads and writes, so nothing existing changes. New optional kit fields: `roles`, `palette`, `dark`, `radius`, `headingFont`, `bodyFont` (`{ family, weight, stored, renderFamily?, source? }`) and `source` `{ url, readAt }`. `colors` (the three swatches the tools show) and `fontFamily` are filled from the primary, accent and text colours and the heading font's name. A kit without the new fields behaves exactly as before.

Logic is in `server/services/graphicsBrandKit.js`, routes in `server/routes/graphics/brandKit.js`:

- `POST /api/graphics/brand-from-url/:id/apply { use: { colours, radius, logoIndex, fonts: { heading, body } } }` copies **only the ticked parts** of a reading into the kit and font table in one transaction (the kit row is locked, so the JSON and the table cannot disagree; a failure rolls both back). At least one thing must be ticked. Fields the code does not know about are left alone. Replies `{ ok, changed, kit, fonts }` with no logo picture and no font bytes.
- `GET /api/graphics/brand-kit/fonts` lists the stored fonts (no bytes); `GET .../fonts/:role/file` returns the file (`font/ttf`, `private, no-cache`, `ETag` = its sha256); `DELETE .../fonts/:role` removes the file and leaves the font's name in the kit with `stored: false`.
- Before anything is written the font is checked again: a TrueType/OpenType header, at most 4 MB, the same bytes the reader recorded (sha256), and a `BrandFont<8 hex>` name. Only a PNG logo is accepted. A name-only font (not downloadable) replaces the kit's font name and **removes** an older stored file for that role, so the kit never points at a file from another family.
- **Step 4 must send the whole kit back when it saves it** (`POST /api/settings` replaces the value): read the kit, change what the screen edits, write all of it, or the new fields are lost.
- **Recycle bin: not used, on purpose.** A reading can be repeated at any time and nothing here is typed by the person; the Brand Kit's logo and colours are not binned either. If the owner wants a "Recently deleted" for fonts, it is one adapter file.
- Tests: `DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_xuser node server/services/graphicsBrandKit.test.js` (works in a throw-away schema using the real table definition read from `db.js`; skips without a database). It covers merging, refusals leaving everything unchanged, rollback, replacing, one person never seeing another's font, and the four routes over HTTP. `crossUserOwnership.test.js` also passes with the new table and routes present.

## The screen (step 4)

In **Graphics → Brand Kit** (the dialog is now `max-w-xl`), above the old fields: **Get from a website**. `client/src/pages/graphics/BrandFromSite.jsx` (own component; `GraphicsPage.jsx` only mounts it and reloads the kit afterwards) with its pure logic in `brandSiteLogic.mjs` (**not** `brandFromSite.mjs`: on Windows, and so in Vite, `BrandFromSite` and `brandFromSite` are the same file name and the import silently picked the `.mjs`, blanking the whole page).

Flow: address box with a microphone (Enter reads) → the global `ProcessingModal` with three steps and **Cancel** (aborts the request) → a preview: colour swatches by role (Main, Accent, Page, Panel, Text, Small text, Lines) with hex, a corner sample, the heading and body font each with a sample line drawn in the real downloaded file (loaded through `FontFace` from `GET .../font/:role`, removed again on close) and a plain sentence on whether the file is ready, then logo candidates to click (or **Keep my logo**), warnings, the line "not official brand assets", and **Use selected**. Colours, corners, fonts and logo are separate ticks; at first only what was really found is ticked, and a body font in the same family as the heading is left unticked. Every control has a `Tooltip`. Errors show in a red box in plain words (unknown address, private address, busy, too many reads).

`GraphicsPage.jsx` changes: the kit is loaded by `loadBrandKit()` (also called after Use selected), **Save Brand Kit now carries over every field the window does not show** (`mergeManualKit`, otherwise saving by hand would have erased roles, corners and font references), typing a different font name than the stored heading font drops that file, and **Clear** also removes both stored font files.

Seen working on 2026-11-07 against the local app (signed in as the admin, real site, www.curam-ai.com.au): read (15 s), preview with Montserrat samples at 600 and 400, Use selected (toast "Brand Kit updated: colours, corners, logo, heading font."), kit and font row present in the API, a hand Save kept all the new fields, Clear emptied both, a private address showed the red message. `node client/src/pages/graphics/brandSiteLogic.test.mjs` covers the logic; `vite build` passes. Not yet looked at: a phone-width screen, a dark theme, the other four themes.

## DESIGN.md download (step 5)

**Download DESIGN.md** sits in the Brand Kit window's footer next to Clear, enabled when the saved kit has colours, a font or a corner style. It is built in the browser from the saved kit (`client/src/pages/graphics/designMd.mjs`, `node client/src/pages/graphics/designMd.test.mjs`); no server call, nothing uploaded. The file: a short "read this before building anything" opening with where and when the site was read and the "not an official brand guide" line; **Colours** (role, hex, what it is for) with the real contrast ratios of text on background and of the on-primary colour; the dark look and the other colours seen; **Typography** with a CSS `font-family` line per font (the `sans-serif` fall-back is a guess and the file says so); **Shape**; a `:root` block of `--brand-*` CSS variables; and a few **Rules** (only these colours, one primary action, contrast of 4.5:1 or better, ask for the logo instead of redrawing it). A section with nothing to say is left out; a kit filled in by hand (three swatches and a font name) still gives a smaller file. The logo picture, the font file and the internal `BrandFont…` names are never put in the file. Seen working on 2026-11-07 in the local app: the button builds `DESIGN.md` with the right content (the browser download was intercepted so the text could be read; the actual file save was not exercised).

## What step 1 does

`extractBrand(url)` in `server/services/brandFromUrl/index.js` opens the page in Chromium (the one the Browser Agent uses; no new dependency, no Dockerfile or `package.json` change) at desktop, phone and dark-mode settings and returns:

- **colours**: background, surface, text, mutedText, primary, onPrimary, accent, border (any can be `null`), plus a top-10 palette, and `dark` when the site really changes for dark mode.
- **fonts**: heading and body `{ family, weight, system, source, file }`. `file` holds the converted TTF/OTF (`buffer`, `renderFamily`, `weight`, `sha256`).
- **radius** `{ px, label }`, **logos** (PNG data URLs, best first; `logo` is the pick), **warnings** (plain words for anything that could not be read).

Files: `index.js` (browser, guard, logos, fonts), `pageScript.js` (runs inside the page), `brandRoles.js` (pure colour/font/radius logic), `brand_font.py` (woff2 to TTF), `brandFromUrl.test.js` (`node server/services/brandFromUrl/brandFromUrl.test.js`; needs Python+fontTools and Chromium for the later parts, and says so when it skips).

**How colours are chosen.** Every visible element in the first four screens counts: backgrounds by area, text by characters times font size squared, buttons and links weighted up, cookie bars and sale banners (by id/class) weighted down to 15%. Near-identical colours (delta E under 4) join. The primary is the most-used colourful colour that differs from the background and text; a black-and-white brand falls back to its button colour.

**Logos.** Images and inline SVGs near the top, scored (inside a link to the home page, "logo" in the class/alt/src, in the header, left-aligned, sensible size), with `apple-touch-icon` and `og:image` as weaker fall-backs. The original file is fetched with `safeFetch` (keeps transparency); an inline SVG or a failed fetch becomes a screenshot of the element. Everything ends as a PNG of at most 512px, so no SVG or script from a stranger's site is ever stored.

## Fonts: what the 2026-11-07 spike found

Sharp's text renderer (`sharp({ text: { font, fontfile } })`, Pango/FreeType):

- a **woff2 `fontfile` is silently ignored** (no error, fallback font drawn), so a font from a web page must be converted first;
- SVG `@font-face` is ignored (librsvg), which is why Text Overlay's current SVG path cannot use a brand font;
- a TTF/OTF `fontfile` works, and the font stays registered for the **whole Node process** under its family name.

So `brand_font.py` (fontTools + brotli, already installed for the Fonts tool) converts to a plain sfnt, cuts a variable font down to one weight (`instancer`), and **renames the result** to a unique plain Regular family (`BrandFont<8 hex>`, weight class 400). Without the rename, a variable font's default-instance name ("Montserrat Thin") made Pango either draw a fallback or fake the weight. Ask sharp for `font: file.renderFamily` at normal weight and it draws exactly the outlines in the file. Checked by eye on a real site: heading 600 and body 400 of one family came out as two correct, different weights.

Where a font comes from, in order: the font files the page really loaded (matched by the family name inside the file, tolerant of "Name Thin"/"Name Variable", never an icon font or a non-Latin subset), then a Google Fonts fall-back for a non-system family the page did not load as a file. If neither works only the name is kept and a warning says so. A site whose CSS name differs from the file's internal name (Stripe: `sohne-var`) is not matched; matching through the browser's own platform-font report (CDP `CSS.getPlatformFontsForNode`) would fix that and is not built.

### Text rendering (step 6): built for Text Overlay and Composite text layers

Not drawn with a font name at all. `server/services/graphicsBrandText.js` turns the text into **vector outlines (SVG `<path>`) with opentype.js from the stored font file**, and those outlines go into the same SVG the overlay always built (background pill, outline stroke, alignment, wrapping, opacity and the 9-point position all unchanged). That sidesteps every problem the Linux check below found with named fonts (librsvg ignores `@font-face`, an unregistered name silently draws a different font per system, colour fringes on thin strokes) and makes the Windows and Linux output the same shapes. Widths for wrapping and for the box come from the same file the outlines come from, with pair kerning, so the box fits. The line height grows for fonts taller than Arial.

- **Request:** `fontSource: 'brand-heading' | 'brand-body'` on `POST /api/graphics/text`, and on a text layer of `POST /api/graphics/composite`. Anything else (or nothing) is the old Arial path, byte for byte. If the person has no stored font for that role, or it cannot be read, the answer is **409 with a plain message**; it never quietly draws in another font. Other people's fonts are never used (every read filters by user). Fonts are parsed once and cached by file hash (12 at most).
- **Screens:** Text Overlay and each Composite text layer get a **Font** drop-down (Standard (Arial), Brand heading: X, Brand body: Y) only when the kit has a stored font file; a name-only font is not offered. The Bold/Normal setting is greyed out with a tooltip for a brand font, because the weight is already in the file. If the kit stops offering the chosen font, the tool falls back to the standard font before sending.
- **Also done (2026-11-07, after the first seven commits):** the text mode of **Watermark** (`POST /api/graphics/watermark`, `fontSource`, tiling works too; an image watermark ignores it) and **Batch Text** (`POST /api/graphics/batch-text`, `fontSource`, loaded once for the whole batch, so a missing font refuses the whole request with 409 instead of failing picture by picture). Both use `graphicsBrandText.centredLabel()` (outlines in a box sized from the font) and show the same Font drop-down. `runWatermark(params, ctx)` takes the loaded font as `ctx.brand`; its other callers pass nothing.
- **Batch, recipes and Pipeline (2026-11-07, later the same day):** the **Batch** text watermark (`op: 'watermark'`, `params.fontSource`), the **Pipeline** text step (`step.fontSource` on an `op: 'watermark'` step) and saved **recipes** use the brand font too. The font is loaded from the signed-in person's own Brand Kit, once for the whole batch or run (`loadBrandFontsFor` in `graphicsBrandText.js`), never from what the browser sends (a `brandFonts` value in `params` is deleted and replaced). A recipe stores only the choice (`fontSource`, kept only on text steps and only if valid); the font is read when it runs. If a step names a font the Brand Kit does not have, the whole batch, job or pipeline is refused before the first picture with 409 and a plain message. In the Pipeline screen a saved recipe whose Brand Kit has lost the font shows the choice as "Brand heading (none saved)" rather than quietly showing Arial. Nothing is left on Arial.
- **A bug found by opening the screen:** the **Batch** tool crashed on open (`Cannot access 'batchOp' before initialization`), because its recipe lines read the `batchOp` state before the line that declares it. It had been that way since the recipe-in-Batch commits of 2026-10-25. `batchOp` is now declared first.
- Limits: Latin text only (no ligatures or contextual shapes beyond kerning, no right-to-left; only the Latin part of a font is stored); a character the font lacks draws as its "missing glyph" box.
- Tests: `node server/routes/graphics/brandText.test.js` (needs any serif TrueType file on the machine; skips otherwise): measuring, anchors, the 409 messages, brand against Arial output, the chosen colour in the pixels, the same request twice gives the same picture, `standard`/unknown/empty values equal the old output, background pill + outline + left align + wrapping (the box gets taller and narrower), another person's font refused, a Composite layer with opacity. `node client/src/pages/graphics/brandSiteLogic.test.mjs` covers the drop-down choices.
- Seen working 2026-11-07 in the local app (real read of a site, then Text Overlay): Font drop-down appeared, headline in Montserrat SemiBold gold, centred, Weight greyed out; with background pill and outline a long headline wrapped to three lines inside a box that fitted it. The Composite text layer showed its Font drop-down; a full Composite run was covered by the server test, not by eye.

**Linux check, 2026-11-07** (WSL Ubuntu 24.04, Node 20, sharp 0.32.6 with the same bundled libvips 8.14.5, pango 1.51, fontconfig 2.14.2, freetype 2.13.2 as the Windows run, which is also what the Railway image installs; not run inside the Railway container itself). Eight checks, each in a fresh process, same results on both systems unless noted:

- a woff2 `fontfile` is ignored on Linux too (output identical to no font); a converted TTF draws the real font; looked at by eye, heading 600 and body 400 of one family came out as two correct, different weights;
- two brand fonts in one process both draw correctly, and a font already registered stays usable by name without passing the file again;
- **an unregistered family name falls back differently per system: on Windows to the first brand font loaded in that process, on Linux to the system default.** Nothing is reported either way, so every brand-text call must pass the stored `fontfile` itself and must never rely on the name alone;
- width from the font file with `opentype.js` (already a dependency) against the width sharp actually drew: 471 px against 465 px for a 48 px headline on both systems (about 1.3 %, the difference is the side margins). Good enough for wrapping and for sizing a background box; wrapped paragraphs came out within 1 px in height between the systems;
- compositing the text onto a base picture works. Output is not pixel-identical between Windows and Linux (anti-aliasing and hinting), only close: nothing here may compare rendered pixels across systems;
- a faint green colour fringe shows on the thin strokes of the regular-weight text on Linux (sharp's text is anti-aliased per colour channel there). Not checked whether `text: { ... }` options can switch it off; look before shipping step 6 and, if it stays, draw the text white or black and tint it.

Not covered: the real Railway container, very long paragraphs, right-to-left or non-Latin text (only the Latin subset of a font is kept).

## Safety

The URL is user input, so: `checkSsrf` on the first address **and on every request the page makes**, including every redirect leg. This uses the browser's own request-pause protocol (CDP `Fetch.requestPaused`), **not** Playwright's `page.route`, because `page.route` is not called for the later legs of a redirect (verified: a public page redirecting to `http://127.0.0.2/` was followed with no call). Also refused: frames (a frame in another process would escape the guard), popups (`--block-new-web-contents`, `window.open` off), media, websockets, ports other than 80/443, service workers, downloads. At most 2 runs at once (503 beyond), 60 second budget, the shared browser closes itself after a minute idle. Tests cover a redirect to an internal name, a picture/fetch/popup/frames aimed at one, and a private address typed in directly.

**Known gap:** Chromium resolves names itself after the check, so a hostile DNS server answering differently the second time (DNS rebinding) is not fully covered; the Node fetchers pin the address, a browser cannot. Acceptable for a signed-in tool, not for something exposed publicly.

## Known limits (honest)

- Colours come from computed styles: **gradients and background images are not read**, so a brand carried by a gradient hero is under-counted. On stripe.com the primary came out green (a small coloured area) instead of purple.
- Only the first four screens of one page are read; no crawl, no hover/focus states, no pixel-fidelity proof (the original repo has these on purpose, for coding agents).
- Sites that block automated visitors or need a login return little; the warning says so.
- Extracted brands are not official brand assets; the screen (step 4) must say so in one line.
- Cost: a run is about 10 to 20 seconds and a few hundred MB of browser, no paid API.
