# CSS (internal name: Restyle)

Non-technical-friendly CSS editor, displayed in the UI as **"CSS"** (nav, feature-access label, User Guide) — the internal feature key, route (`/restyle`), file names, and API prefix (`/api/restyle`) still say "restyle" for continuity, invisible to the user. Upload or paste HTML plus one or more CSS files (reorderable cascade), get a live sandboxed preview, click any element to edit it via a simple property panel, voice, or a plain-English AI request, then save it for later or download the result. Flag `restyle`. Route: `client/src/pages/RestylePage.jsx`. API: `server/routes/restyle.js`.

Stateless, same pattern as PDF Tools/Web Extractor — every request carries its own HTML/CSS; nothing persists server-side, nothing written to disk (multer memory storage only), except the real per-user saved-page persistence described below.

**Two source options only: upload a file, or paste it in.** A third "load from a web address" option (server-side scrape + auto-discovered stylesheets) was built and then removed per user feedback after repeated rounds of trying to fix its fidelity/reliability — it kept producing a materially worse result than pasting real page source, and the user asked for it to be dropped rather than debugged further. Don't re-add it without being asked.

**Images from remote URLs are a known, accepted limitation, not actively being worked.** See "Remote images" below for what was tried; per user instruction, this is being left as-is rather than continuing to iterate on it.

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

## Detected fonts/colors/sizes

After every successful build (upload, demo, or reloading a saved page), `scanCssAssets()` in `RestylePage.jsx` regex-scans the merged CSS + sanitized HTML for `font-family`, hex/`rgb()`/`rgba()` colors, and `font-size`/`padding`/`border-radius` values already in use, and offers them as quick picks alongside the curated lists — the Font dropdown gains an extra "(used in your files)" option per detected stack, and Text color/Background color/Size/Rounded corners/Space around the content each get a row of one-click swatches or chips under their normal control. These bypass the slider/native-picker's own value assembly (`applyQuickPick()`), applying the exact detected CSS value verbatim (so a `rem`/`%`/`rgba()` value round-trips exactly, not just whatever the slider's fixed unit would produce).

## Demo page

"Load a demo" (top bar) runs a canned Header/Paragraph/Card/Image page (`DEMO_HTML`/`DEMO_CSS` constants in `RestylePage.jsx`) through the exact same `/upload-html` → `/process-css` → render pipeline a real upload goes through — no separate demo code path. Lets a first-time user try selecting and editing something without needing their own files first.

## Voice input

The plain-English request box reuses the same `useVoice()` hook (`client/src/hooks/useVoice.js`) as chat and other Vault pages — same mic button, browser Speech Recognition with local-recording fallback, same error messages. Transcribed text appends to whatever's already typed; nothing new was built for speech-to-text here.

## Text enhancements + animation

Beyond the original Text/Box groups, the property panel has:
- **Text enhancements** — capitalization (`textTransform`), space between letters (`letterSpacing`), alignment (`textAlign`).
- **Animation** — a preset dropdown (`ANIMATION_PRESETS` in `RestylePage.jsx`): Fade in, Slide up, Pop in, Pulse, Bounce, or None. Each preset names a `@keyframes` rule injected once into the preview as a separate `<style id="restyle-animation-defs">` tag (same "never touch the user's own CSS" pattern as the selection-outline styles) — the property panel only ever sets the `animation` shorthand referencing one of those names. Picking a preset again re-triggers it (clear → force reflow → reapply, the standard trick, since setting the identical CSS value twice doesn't replay a CSS animation on its own).

All four properties are in `aiEdit.js`'s `ALLOWED_PROPERTIES`, so the plain-English AI box can use them too — `animation`'s value is additionally checked against the literal set of preset strings (`ALLOWED_ANIMATION_VALUES`, kept in sync with the client's `ANIMATION_PRESETS`) since a model-invented keyframe name would silently do nothing.

## Saved pages (revisit later)

Real per-user persistence — the one place this feature isn't stateless. Table `restyle_projects` (`server/db.js`): `name`, `html` (JSONB `{head, body}` — the LIVE edited DOM at save time, inline-style edits included, not the original upload), `cssEntries` (JSONB, the ordered list as uploaded/pasted). Routes: `GET/POST /api/restyle/projects`, `GET/PUT/DELETE /api/restyle/projects/:id`. Reopening a saved page re-runs its `cssEntries` through `/process-css` (so auto-fixes/flags are recomputed, never stale) and re-renders the saved `html` — a genuine reload, not a rendered snapshot.

## Frontend flow

1. Upload/paste HTML and one or more CSS files (drag-to-reorder via up/down buttons — last in the list wins the cascade).
2. "Build the preview" posts to `/process-css` (skipped entirely if no CSS was added), then renders the merged HTML+CSS in `<iframe sandbox="allow-same-origin">` (deliberately no `allow-scripts` — sanitization is the real defense, not the sandbox attribute alone).
3. A separate `<style id="restyle-outline-css">` tag, injected only inside the iframe, handles hover/selected outlines — the user's own merged CSS is never touched to show selection state.
4. Clicking an element selects it; the property panel initializes from `getComputedStyle()` so it reflects the page's real current appearance rather than a fixed default.
5. Panel controls and the AI request box both write directly to the selected element's inline style and push `{target, property, previousValue}` onto an undo stack.
6. **Export** clones the iframe's current DOM (edits included), strips the selection-outline style tag, and downloads a standalone `.html` file with the merged, auto-fixed CSS inlined in a `<style>` tag.

Rebuilding the preview (re-running "Build the preview") resets the selection and undo stack, since the previous DOM nodes are gone once the iframe's document is replaced.

## Limits

2MB max per uploaded file (HTML or CSS), enforced server-side via multer — not just the file picker's `accept` attribute. Server-side extension checks (`.html`/`.htm`, `.css`) on every upload.
