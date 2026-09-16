# CSS (internal name: Restyle)

Non-technical-friendly CSS editor, displayed in the UI as **"CSS"** (nav, feature-access label, User Guide) — the internal feature key, route (`/restyle`), file names, and API prefix (`/api/restyle`) still say "restyle" for continuity, invisible to the user. Upload or paste HTML plus one or more CSS files (reorderable cascade), get a live sandboxed preview, click any element to edit it via a simple property panel, voice, or a plain-English AI request, then save it for later or download the result. Flag `restyle`. Route: `client/src/pages/RestylePage.jsx`. API: `server/routes/restyle.js`.

Stateless, same pattern as PDF Tools/Web Extractor — every request carries its own HTML/CSS; nothing persists server-side, nothing written to disk (multer memory storage only).

## No CSS jargon anywhere

Every automatic action (auto-fix, AI edit, undo) still produces a one-sentence, jargon-free explanation internally — "the space around it," not "padding"; "this text is being overridden by another style," not "specificity conflict" — see `PLAIN` map in `RestylePage.jsx` and the equivalent in `services/restyle/cssProcessor.js`. The visible "What's happened so far" change-log panel was removed from the UI per user feedback; `changeLog` state is still tracked (harmless, unused for rendering) rather than ripped out of every call site, in case it's wanted back. Flagged issues (duplicate properties, overridden rules, contrast) still show in the "Things worth a look" panel — that one wasn't removed.

## Endpoints

- `POST /api/restyle/upload-html` — accepts a `.html` file or pasted `html` string, sanitizes it server-side with jsdom (`services/restyle/sanitizeHtml.js`) before it's ever sent to the browser: strips `<script>`, inline event handlers (`onclick` etc.), `javascript:` URLs, and nested browsing contexts (`<iframe>`/`<object>`/`<embed>`/`<base>`). Returns the safe `<head>`/`<body>` innerHTML separately, plus a change-log entry.
- `POST /api/restyle/process-css` — accepts any number of dropped `.css` files (`files`) and/or a JSON `pasted` array of `{filename, css}`, plus an `order` array (filenames) giving the desired cascade order. Runs every stylesheet through PostCSS's real AST (`services/restyle/cssProcessor.js`) — never regex — to silently normalize parser-safe issues (missing semicolons, trailing commas) and flag ambiguous ones: duplicate properties within a rule, a rule fully overridden by a later one with equal-or-higher specificity, and a basic WCAG contrast check when a single rule sets both `color` and `background-color`. Returns one merged stylesheet in cascade order (last file wins on ties, same as the real browser cascade) plus `changeLog` and `flags` arrays.
- `POST /api/restyle/ai-edit` — the selected element's tag/classes/inline styles/computed styles for the supported properties, plus a free-text request. Resolves the model via `getModelsForUser(req.user.id).standard` — the same "standard" tier every other Vault AI feature uses, no separate model setting. System prompt (`services/restyle/aiEdit.js`) constrains Claude to a strict JSON array with an allow-listed `property` field; anything outside `ALLOWED_PROPERTIES` is filtered server-side before it reaches the frontend, so the model can never return a change the property panel doesn't know how to apply.

## Remote images — inlined server-side, not fetched by the iframe

A real bug found via user report: images with correct, working URLs still didn't render in the preview. Cause — Vault's own Content-Security-Policy (which the `srcdoc` iframe inherits, since `srcdoc` has no origin of its own to carry a separate CSP) restricts `img-src` to `'self' data: blob:`, so the browser silently blocks any `http(s)` image request the iframe tries to make, sandbox attribute notwithstanding. Confirmed via the browser's own console error (`Loading the image '<URL>' violates the following Content Security Policy directive: "img-src 'self' data: blob:"`).

Fix: never ask the iframe to fetch a remote image at all. `server/services/restyle/inlineImages.js` fetches every `http(s)` image reference server-side — reusing the same SSRF-safe `fetchBinary()` as Web Extractor — and rewrites it to a `data:` URI, which the CSP already permits. Covers all four places a remote image can appear (an earlier version only caught the first one, which is why some images kept getting blocked even after the initial fix):
1. `<img src>` / `<img srcset>` — `inlineImagesInHtmlFragment()`, called on both the sanitized head AND body in `/upload-html` (and in `/scrape-url`, below).
2. an inline `style="background-image:url(...)"` attribute on any element — same function, same call.
3. a `<style>...</style>` block embedded directly in the page — same function, same call; distinct from an uploaded/pasted CSS **file**.
4. `url(...)` inside an uploaded/pasted CSS file — `inlineImagesInCss()`, called on the merged stylesheet in `/process-css`.

Best-effort and capped (40 images per call): a URL that fails to fetch (404, blocked host, too large, timeout) just stays as the original URL and remains broken in the preview, and the response's `flags` array says how many failed. A side benefit: the exported/downloaded page is now fully self-contained — its images don't depend on the original site staying up.

## Load from a web address

A third HTML-source tab ("From a web address") alongside Upload/Paste. `POST /api/restyle/scrape-url` reuses `htmlFetch.fetchHtml()` (the same SSRF-safe, bot-detection-aware fetcher as Web Extractor/SEO/Translate) to load a public URL, discovers every `<link rel="stylesheet" href>` it references (resolved to absolute URLs, capped at 10) and fetches each one alongside, sanitizes and image-inlines the HTML exactly like a normal upload, and returns both the page AND the fetched stylesheets in one response — the client adds the stylesheets straight into the CSS list, so there's no separate "now go find and paste the CSS" step. **Never fetches or executes `<script>`** — this is the one hard line in the whole tool (no `allow-scripts`, scripts always stripped) and scrape-url doesn't relax it; the change log tells the user how many scripts existed on the source page and that they were intentionally skipped.

## Why "Build the preview" can look stuck — the real cause

The earlier hint-text fix (below) treated the symptom; the actual root cause, found from a second user report, was that **a `<style>` block embedded directly in the page's `<head>` (or anywhere in the HTML) was never treated as CSS at all.** `sanitizeHtml()` left `<style>` tags in place but the tool only ever ran the *separate* `cssEntries` list through the auto-fix pipeline — so a pasted or scraped page whose actual styling lives in an embedded `<style>` block (extremely common on real sites) rendered completely unstyled in the preview, AND "Build the preview" stayed disabled (`cssEntries.length === 0`) even though the page unmistakably had real CSS sitting inertly inside it. This explains both the "scrape looked poor" and "Build won't enable without loading the demo first" reports as the same bug.

Fix: `sanitizeHtml()` now pulls every `<style>` block's text out (removing the tags from the DOM so they aren't duplicated once the merged stylesheet is re-injected) and returns it as `embeddedCss`. Both `/upload-html` and `/scrape-url` pass it through `inlineImagesInCss()` (for any `url(...)` inside it) and hand it back as a `cssFiles: [{ filename: "Embedded styles from your page", css }]` entry — the client adds it straight into the style list, same as an uploaded file, so it goes through the exact same PostCSS auto-fix/flag pass and immediately unblocks "Build the preview." Verified: `sanitizeHtml()` on a `<style>`-only test page now returns the CSS text separately with the tag removed from both head and body.

The disabled-button hint text (added first) still stays as a fallback for the genuine case of a page with truly no CSS anywhere: "Add your HTML above, and at least one style file, to enable this" / "Add at least one style file above to enable this", plus a native `title` tooltip on the button.

## Why the scrape quality complaint was partly a different bug

Two separate causes were compounding: (1) the embedded-`<style>` gap above meant a scraped page's real CSS (very often embedded, not linked) was being silently dropped entirely; (2) `/scrape-url` originally used `htmlFetch.fetchHtml()`, which exists for SEO/text-extraction features and has a multi-strategy fallback chain (Serper scrape API, WordPress REST API, Jina readability) that kicks in whenever a heuristic decides the direct response looks "thin." Those fallbacks reconstruct a stripped-down, readable-text approximation of the page — a reasonable trade for extracting article text, a bad one for a tool whose entire job is preserving the real markup. Switched to `fetchDirect()` instead, which returns the actual fetched HTML byte-for-byte (the same thing View Source shows) with zero substitution; a failed or error-status fetch now returns a clear message suggesting the paste-source path instead of silently degrading to a lossy reconstruction.

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
2. "Build the preview" posts to `/process-css`, then renders the merged HTML+CSS in `<iframe sandbox="allow-same-origin">` (deliberately no `allow-scripts` — sanitization is the real defense, not the sandbox attribute alone).
3. A separate `<style id="restyle-outline-css">` tag, injected only inside the iframe, handles hover/selected outlines — the user's own merged CSS is never touched to show selection state.
4. Clicking an element selects it; the property panel initializes from `getComputedStyle()` so it reflects the page's real current appearance rather than a fixed default.
5. Panel controls and the AI request box both write directly to the selected element's inline style and push `{target, property, previousValue}` onto an undo stack.
6. **Export** clones the iframe's current DOM (edits included), strips the selection-outline style tag, and downloads a standalone `.html` file with the merged, auto-fixed CSS inlined in a `<style>` tag.

Rebuilding the preview (re-running "Build the preview") resets the selection and undo stack, since the previous DOM nodes are gone once the iframe's document is replaced.

## Limits

2MB max per uploaded file (HTML or CSS), enforced server-side via multer — not just the file picker's `accept` attribute. Server-side extension checks (`.html`/`.htm`, `.css`) on every upload.
