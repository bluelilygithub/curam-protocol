# CSS (internal name: Restyle)

Non-technical-friendly CSS editor, displayed in the UI as **"CSS"** (nav, feature-access label, User Guide) — the internal feature key, route (`/restyle`), file names, and API prefix (`/api/restyle`) still say "restyle" for continuity, invisible to the user. Upload or paste HTML plus one or more CSS files (reorderable cascade), get a live sandboxed preview, click any element to edit it via a simple property panel, voice, or a plain-English AI request, then save it for later or download the result. Flag `restyle`. Route: `client/src/pages/RestylePage.jsx`. API: `server/routes/restyle.js`.

Stateless, same pattern as PDF Tools/Web Extractor — every request carries its own HTML/CSS; nothing persists server-side, nothing written to disk (multer memory storage only), except the real per-user saved-page persistence described below.

**Three ways to bring a page in: a live page by its web address, an uploaded file, or pasted HTML.** An earlier "load from a web address" (a server-side scrape that tried to guess the page's stylesheets) was removed after repeated fidelity problems; the 2026-10 version below replaces it and is built differently (the page's `<link>` style files are fetched and handed back as ordinary style files, and a headless browser is available for pages built by script).

**Images from remote URLs are a known, accepted limitation, not actively being worked.** See "Remote images" below for what was tried; per user instruction, this is being left as-is rather than continuing to iterate on it.

## What the tool is for (2026-10 rework)

**Restyle a page you already have, without writing code, and take the CSS away to paste into the real site.** The flow: load the page (best of all a live one, by its address), click things and change them (by hand or in plain English), check the result, export the CSS. It never edits the live website: it hands over CSS for the site's own "Additional CSS" / custom CSS box (WordPress, Shopify, Squarespace...) or for a developer.

What the rework added to the original click-and-edit tool: a clean **stylesheet output** (changes are rules, not inline styles), **loading a live page by address** (with a headless-browser option for pages built by script), **Desktop / Tablet / Phone previews** with **screen-size and mouse-over/focus** rules, **brand colours and fonts** used everywhere, a **Changes so far** list with an **Original / With changes** compare, **accessibility checks**, **export** (CSS, page, developer report), **update in place with version history**, and a **public preview link**.

## No CSS jargon anywhere

Every automatic action (auto-fix, AI edit, undo) still produces a one-sentence, jargon-free explanation internally — "the space around it," not "padding"; "this text is being overridden by another style," not "specificity conflict" — see `PLAIN` map in `RestylePage.jsx` and the equivalent in `services/restyle/cssProcessor.js`. The visible "What's happened so far" change-log panel was removed from the UI per user feedback; `changeLog` state is still tracked (harmless, unused for rendering) rather than ripped out of every call site, in case it's wanted back. Flagged issues (duplicate properties, overridden rules, contrast) still show in the "Things worth a look" panel — that one wasn't removed.

## Endpoints

- `POST /api/restyle/upload-html` — accepts a `.html` file or pasted `html` string, sanitizes it server-side with jsdom (`services/restyle/sanitizeHtml.js`) before it's ever sent to the browser: strips `<script>`, inline event handlers (`onclick` etc.), `javascript:` URLs, and nested browsing contexts (`<iframe>`/`<object>`/`<embed>`/`<base>`). Also extracts any embedded `<style>` block's text (see "Embedded `<style>` blocks" below) and inlines any `http(s)` images it can (see "Remote images" below). Returns the safe `<head>`/`<body>` innerHTML separately, plus a `cssFiles` array (embedded styles, if any) and a change-log entry.
- `POST /api/restyle/process-css` — accepts any number of dropped `.css` files (`files`) and/or a JSON `pasted` array of `{filename, css}`, plus an `order` array (filenames) giving the desired cascade order. Runs every stylesheet through PostCSS's real AST (`services/restyle/cssProcessor.js`) — never regex — to silently normalize parser-safe issues (missing semicolons, trailing commas) and flag ambiguous ones: duplicate properties within a rule, a rule fully overridden by a later one with equal-or-higher specificity, and a basic WCAG contrast check when a single rule sets both `color` and `background-color`. Returns one merged stylesheet in cascade order (last file wins on ties, same as the real browser cascade) plus `changeLog` and `flags` arrays. This is the one endpoint most likely to receive large text fields (embedded/inlined CSS can run to hundreds of KB or more) — see "multer's field-size limit" below.
- `POST /api/restyle/ai-edit` — the selected element's tag/classes/inline styles/computed styles for the supported properties, plus a free-text request. Resolves the model via `getModelsForUser(req.user.id).standard` — the same "standard" tier every other Vault AI feature uses, no separate model setting. System prompt (`services/restyle/aiEdit.js`) constrains Claude to a strict JSON array with an allow-listed `property` field; anything outside `ALLOWED_PROPERTIES` is filtered server-side before it reaches the frontend, so the model can never return a change the property panel doesn't know how to apply.

## Remote images — status: known limitation, not being actively fixed

A real bug found via user report: images with correct, working URLs didn't render in the preview. Root cause — Vault's own Content-Security-Policy (which the `srcdoc` iframe inherits, since `srcdoc` has no origin of its own to carry a separate CSP) restricts `img-src` to `'self' data: blob:`, so the browser silently blocks any `http(s)` image request the iframe tries to make, sandbox attribute notwithstanding. Confirmed via the browser's own console error.

What was tried: `server/services/restyle/inlineImages.js` fetches images server-side (reusing Web Extractor's SSRF-safe `fetchBinary()`) and rewrites them to `data:` URIs, which the CSP permits — covering `<img src>`/`srcset`, inline `style="background-image:url(...)"` attributes, embedded `<style>` blocks, and uploaded/pasted CSS file `url(...)`. This is still in place and does work for images the tool can actually resolve (confirmed working in isolated tests). It has NOT resolved the user's real-world reports of images still not rendering — after several fix attempts (the CSP/data-URI approach itself, then extending coverage to style attributes and embedded `<style>`, then a multer field-size bug that was truncating the CSS carrying inlined images), the user asked to stop iterating on this and leave it as a known gap. Best-effort, capped at 40 images per call.

## Embedded `<style>` blocks are extracted and treated as real CSS

A page's actual styling very often lives in a `<style>` block embedded directly in the HTML (most commonly in `<head>`), not only in separate CSS files. `sanitizeHtml()` pulls every `<style>` block's text out (removing the tags from the DOM so they aren't duplicated once the merged stylesheet is re-injected) and returns it as `embeddedCss`. `/upload-html` passes it through `inlineImagesInCss()` and hands it back as a `cssFiles: [{ filename: "Embedded styles from your page", css }]` entry — the client adds it straight into the style list, same as an uploaded file, so it goes through the exact same PostCSS auto-fix/flag pass.

## multer's field-size limit — a real, fixed bug

Once CSS with inlined base64 background images got sent from the client to `/process-css` inside the multipart `pasted` text field, it could exceed **busboy's default 1MB field-size limit**. Multer/busboy's default behavior on overflow is to silently **truncate** the field rather than reject the request — the truncated JSON then failed `JSON.parse()`, and an earlier version of this route caught and *silently ignored* that failure, leaving the style list empty with no visible error. Fixed:
- `multer({ limits: { fieldSize: 25 * 1024 * 1024 } })` — 25MB comfortably covers a real page's CSS even with several inlined images.
- The `JSON.parse()` catch block no longer swallows the failure — it 400s with a clear message and logs the field length server-side.

## Scope: this element, its own class, OR an ancestor's class, and Reset

When something is selected, a "What should changes apply to?" panel appears above the request box: **Just this element** (default, always resets to this on a fresh selection — never carried over from a previous one), plus one radio option per class found — both the element's **own** classes ("Every element with class `.foo`") and classes on any **ancestor**, combined with this element's tag ("Every `<a>` inside `.greenboxsection`"). `getScopeTargets()` is the single choke point every change goes through — panel controls, detected-asset quick picks, animation presets, and AI edits alike — so scope applies uniformly regardless of how the change was made; nothing bypasses it. Choosing any option beyond "Just this element" shows an explicit warning line since it's a materially bigger action than editing one element.

**Live scope preview**: picking any scope option beyond "Just this element" immediately outlines every matching element in the preview with a distinct amber `box-shadow` (`data-restyle-scope-preview`, in `OUTLINE_CSS`) — box-shadow rather than outline so it visibly coexists with the selected/hover outlines instead of one overriding the other, since the selected element is normally also one of the scope matches. Cleared and reapplied on every scope change (a `useEffect` keyed on `editScopeSelector`/`hasSelection`), and stripped from the DOM before export/save, same as the hover/selected markers.

**The ancestor case exists because of a real user report**: they selected an `<a>` styled by `.greenboxsection ul li a { ... }` and the tool said "no class," which is technically true of the `<a>` itself (`classList` is genuinely empty — that's not a bug) but missed the obvious editing intent, since the class governing it sits on a container several levels up. `selectElement()` now walks from the selected element up to (not including) `<body>`, collecting every ancestor's classes (deduped, capped at 8 total options) and offering `.ancestorClass ${tag}` as a scope selector for each — `querySelectorAll` with a descendant combinator, so it doesn't need to replicate the exact intermediate tag chain (`ul li a`) to select the same practical set of elements.

**Reset** (same panel) clears every property this tool manages (the `PLAIN` map's keys — text/box/animation properties) back to blank on the current scope's target(s), restoring whatever the page's own CSS/inline style already had — it never touches properties the tool doesn't track, so a pre-existing `style="width:200px"` on the source page is left alone.

**Undo groups by action, not by element**: the undo stack holds one entry per logical action (`{ changes: [...] }`), not one per affected element — a class-wide change to 40 elements is a single Undo click, not 40. This applies equally to Reset (however many properties/elements it touched is one undo step).

## "Build the preview" no longer requires a style file at all

CSS is optional. The button is enabled as soon as `htmlLoaded` is true, full stop — no dependency on `cssEntries`. `runBuildPreview()` skips the `/process-css` network call entirely when the style list is empty (`mergedCssRef.current = ''`) and renders the sanitized HTML as-is.

## Regression: uploaded-file colors silently dropped once embedded styles hit the display cap

Confirmed real via user report, not imagined: color swatches only ever reflected "Embedded styles from your page," never a separately uploaded CSS file — font detection worked fine for the same upload, which was the key clue that this wasn't a detection-logic bug at all. Cause: `scanCssAssets()`'s color/font/size loops used to `break` out of the scan the moment they hit their DISPLAY cap (16 colors, 12 fonts). The merged CSS is built with the embedded-styles entry FIRST, ahead of separately uploaded/pasted files (cascade order) — so if the embedded styles alone already had ≥16 distinct colors, the scan stopped right there and never even reached the uploaded file's colors later in the string. Fonts happened not to hit this in practice (rarely 12+ distinct font stacks on one page), which is exactly why fonts kept working while colors silently didn't.

Fixed by always scanning the FULL merged text for every distinct value first, and applying a cap only as a final slice — plus the caps themselves were raised well above realistic totals (40 fonts, 60 colors, 20 each for sizes/padding/radius) so this class of bug can't resurface just because a page has an unusually large stylesheet. Verified: a synthetic 20-color embedded block followed by a separately-uploaded file's color and font both now come through correctly.

## Detected fonts/colors/sizes

After every successful build (upload, demo, or reloading a saved page), `scanCssAssets()` in `RestylePage.jsx` regex-scans the merged CSS + sanitized HTML for `font-family`, hex/`rgb()`/`rgba()` colors, and `font-size`/`padding`/`border-radius` values already in use, and offers them as quick picks alongside the curated lists — the Font dropdown gains an extra "(used in your files)" option per detected stack, and Text color/Background color/Size/Rounded corners/Space around the content each get a row of one-click swatches or chips under their normal control. These bypass the slider/native-picker's own value assembly (`applyQuickPick()`), applying the exact detected CSS value verbatim (so a `rem`/`%`/`rgba()` value round-trips exactly, not just whatever the slider's fixed unit would produce).

## Demo page

"Load a demo" (top bar) runs a canned Header/Paragraph/Card/Image page (`DEMO_HTML`/`DEMO_CSS` constants in `RestylePage.jsx`) through the exact same `/upload-html` → `/process-css` → render pipeline a real upload goes through — no separate demo code path. Lets a first-time user try selecting and editing something without needing their own files first.

## Layout, tools, guide and voice (2026-10)

The page uses the shared tool menu (`components/ToolSidebar.jsx`) like Graphics and Video Tools. Tools (`client/src/pages/restyle/restyleTools.mjs`, the single list the page, the menu tips and the guide share):

| Group | Tools |
|---|---|
| **Your page** | Your page (web address / upload / paste), Style files (+ Build the preview, "Things worth a look") |
| **Change it** | Ask in plain English, What it applies to (scope, screen size, mouse-over look, Reset), Text, Text enhancements, Animation, Box, Brand colours and fonts |
| **Check and compare** | Changes so far, Accessibility checks |
| **Keep and share** | Export the CSS, My saved pages, Page history, Share a preview |

The live preview stays beside the open tool. Above it: **Load a demo**, **Undo last change**, **Export the CSS (n)**; over the preview: **Desktop / Tablet / Phone**, **With changes / Original**, and the "Editing: ..." line. Building the preview, or clicking something in it, moves the open tool on from the set-up tools to Ask in plain English. Tools that need a click, a built preview or a saved page say so under their name in the menu and in their panel.

Code: `RestylePage.jsx` (state and logic) with the panels in `restyle/RestylePanels.jsx` (page, styles, brand, changes, checks, export, saved, history, share) and `restyle/PropertyPanels.jsx` (ask, scope, text, enhance, animation, box); pure logic in `restyle/editModel.mjs` (changes, CSS generation, report), `selectors.mjs` (unique and scope selectors) and `a11y.mjs` (contrast and the page scan).

A **CSS guide** (round button, `POST /api/restyle-tutor`, `server/services/restyleTutor.js`, `guideId` `css`) is focused on the tool's one job (restyle a page, take the CSS away) and covers every tool and control above; it uses plain words only, never says the tool can publish to a site, and sees no page. Keep `restyleTools.mjs` and the guide `CATALOG` together (`npm run test:restyle-tutor`).

Voice: the plain-English box (continuous dictation), the web address, the pasted-style name, the saved-page name, brand colour and font names and the tool search use the shared `VoiceInput` mic. The pasted HTML and pasted style boxes have no mic (they hold code, not speech).

## Loading a page by its address

`POST /api/restyle/fetch-url` `{ url, render }` (`server/services/restyle/loadFromUrl.js`): fetches the page through `htmlFetch.fetchHtml` (same SSRF checks, redirect limits and 2 MB cap as Web Extractor), makes every address in it complete (Web Extractor's `extractStyled`), takes the `<link rel="stylesheet">` files out and fetches them (up to 12, 1.5 MB each, 4 at a time; addresses inside each resolved against that file; print-only files skipped; files for some screens only are wrapped in `@media`), then runs the page through the same clean-up and picture inlining as an upload (`prepareHtml` in `routes/restyle.js`). The linked files come back as `cssFiles` first, then the page's own embedded styles, which is the order a real page applies them. A page's `@import`ed files are not loaded (a note says so), and a failed file is reported.

**`render: true`** ("This page builds itself with JavaScript") opens the address in a headless Chromium first (`services/restyle/renderPage.js`, Playwright, installed in the Docker image) so script-built pages have their content; styles added by script through the style API are copied into their `<style>` elements. Every request the page makes is checked with `checkSsrf`; one render at a time with a short queue; 30 s limit; 5 MB limit; no downloads, service workers, media or fonts. Known limit: the browser looks names up itself, so a DNS record that changes between our check and its lookup is not covered (the same limit the Browser Agent has). `GET /api/restyle/capabilities` says whether the browser is installed (it often is not on a laptop); the tick box is greyed out when it is not. Limits per person: 40 loads an hour, 8 of them rendered.

## Changes are rules, not inline styles

Each change is a rule in one list (`edits`: `{ selector, label, state, media, props: { fontSize: { value, was } } }`, `restyle/editModel.mjs`). A change goes to a **unique selector** for the clicked item (its id, or tag and classes, climbing the parents until it points at one item **and contains an id or a class**, so it is not just "span:nth-of-type(2)", which would hit every page of the site it is pasted into), or to the **scope selector** when "every matching item" is chosen. The preview, the export, Changes so far and the shared preview are all made from that list, so what you see is the CSS you export. Undo is a stack of snapshots of the list (one per action; brand colour add/remove also snapshots the brand list). `!important` is added by default so the changes win over the page's own styles, with a switch in Export.

## Screen sizes and mouse-over looks

In **What it applies to**: *Applies on* (all screen sizes, tablets and smaller up to 768px, phones only up to 480px) and *Which look* (normal, mouse-over, focus). Rules are grouped by media query (wide before narrow, so a phone rule beats a tablet one) and a look becomes `:hover` / `:focus`. In the preview only, a forced-state attribute (`data-restyle-force-hover`) stands in for the mouse so the look can be edited; the export never carries it. The Desktop / Tablet / Phone buttons only resize the preview (the page's own media queries respond to the frame width, 390px for Phone). The look goes back to normal on each new click; the screen size stays.

## Brand colours and fonts

Colour and font tokens (`--brand-<name>` in a `:root` block of the generated CSS). They appear as quick picks in Text and Box (written as `var(--brand-x)`, so changing a token changes every use), "Find the page's colours" seeds them from the page, and **Use it across the page** applies one in a single step to all headings, body text, all links, all buttons, the page background, or the heading / body font (`BRAND_TARGETS`). Removing a token takes back the changes that used it. Tokens belong to the person, not the page: they stay when a different page is loaded, and are saved with a saved page.

## Changes so far, compare, accessibility checks

*Changes so far* lists every property changed (plain words, what it was, what it is, for which screen size or look) with a cross per change, Undo last and Clear all (inline Yes/No). *With changes / Original* blanks the changes style in the preview to compare (making a change switches back). *Accessibility checks* (`restyle/a11y.mjs`): WCAG contrast of text against its real background (opaque background found by walking up, see-through ones laid over it; 4.5:1, or 3:1 for large text), pictures with no `alt`, and text under 12px; click a problem to select and scroll to it. A contrast note also shows live in Text and Box for the clicked item.

## Export

CSS (copy / `.css`), the whole page with the changes built in (`.html`; the editor's helper attributes and outline style are stripped), and a **developer report** (`changeReport`: every change with where and what it was, the brand values, and the CSS, as Markdown). Animations bring their `@keyframes` with them, only the ones used.

## Saved pages, history and the preview link

Saved pages: table `restyle_projects` (`name`, `html` JSONB, `cssEntries` JSONB, `"shareToken"`), `restyle_project_versions` (`"projectId"`, `name`, `html`, `"cssEntries"`, `"createdAt"`). `html` is `{ head, body, edits, tokens, important, sourceUrl, pageCss, editsCss }`: the ORIGINAL cleaned page plus the list of changes (the old format stored the edited DOM with inline styles; those pages still open, with the changes inside the markup, and just have no change list). A page can be saved with no style files (the old rule that blocked that is gone).

- `POST /api/restyle/projects` makes a new saved page; `PUT /api/restyle/projects/:id` **updates in place and first copies what was there into the page's history** (transaction; newest 20 kept). `GET /projects/:id/versions` and `/versions/:vid` list and read the history; the editor opens a version after an inline Yes/No and **Update** makes it the saved page again.
- **Preview link**: `POST /api/restyle/projects/:id/share` makes (or keeps) a 32-byte hex token, `DELETE` turns it off at once. `GET /api/shared/restyle/:token` (no login, `routes/restyleShared.js`, mounted before `requireAuth`, 60 a minute per IP) builds the page on the server (`services/restyle/sharePage.js`): the saved head and body are cleaned again (the saved project is only as clean as what the browser sent), the saved page CSS and the generated changes CSS go through `services/restyle/sanitizeCss.js` (changes CSS: only the properties the tool manages, `--brand-*`, plain rules, `@media` and the tool's own keyframes, no `url()`; page CSS: no `@import`, behaviours or script hooks), and it is served with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; ...`, **no script of any kind**, `frame-ancestors 'none'`, `noindex`, `no-referrer`, `no-store`. A bar at the top switches between "With the changes" and "Original" (`?view=original`). The link shows the page **as last saved**.

## Text enhancements + animation

Beyond the original Text/Box groups, the property panel has:
- **Text enhancements** — capitalization (`textTransform`), space between letters (`letterSpacing`), alignment (`textAlign`).
- **Animation** — a preset dropdown (`ANIMATION_PRESETS` in `RestylePage.jsx`): Fade in, Slide up, Pop in, Pulse, Bounce, or None. Each preset names a `@keyframes` rule injected once into the preview as a separate `<style id="restyle-animation-defs">` tag (same "never touch the user's own CSS" pattern as the selection-outline styles) — the property panel only ever sets the `animation` shorthand referencing one of those names. Picking a preset again re-triggers it (clear → force reflow → reapply, the standard trick, since setting the identical CSS value twice doesn't replay a CSS animation on its own).

All four properties are in `aiEdit.js`'s `ALLOWED_PROPERTIES`, so the plain-English AI box can use them too — `animation`'s value is additionally checked against the literal set of preset strings (`ALLOWED_ANIMATION_VALUES`, kept in sync with the client's `ANIMATION_PRESETS`) since a model-invented keyframe name would silently do nothing.

## Frontend flow

1. Load the page (address, upload or paste) and, if needed, add style files (drag order by the arrows: last in the list wins).
2. "Build the preview" posts to `/process-css` (skipped if there is no CSS), then renders the page and merged CSS in `<iframe sandbox="allow-same-origin">` (no `allow-scripts`: the clean-up is the real defence, not the sandbox alone). The iframe also holds `<style id="restyle-edits">` (the generated changes) and `<style id="restyle-outline-css">` (selection outlines, never mixed into the person's CSS).
3. Clicking selects an item; the panels start from `getComputedStyle()`, so they show the page's real appearance, including changes already made.
4. Every control and the AI box call `applyChanges()`, which records rules (unique or scope selector, chosen screen size and look) and redraws `#restyle-edits` straight away.
5. Rebuilding keeps the changes (they are rules, so they apply wherever they still match) and clears the selection; loading a different page starts a fresh list.

## Limits

2MB max per uploaded file (HTML or CSS), enforced server-side via multer — not just the file picker's `accept` attribute. Server-side extension checks (`.html`/`.htm`, `.css`) on every upload.
