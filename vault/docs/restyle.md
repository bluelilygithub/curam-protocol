# Restyle

Non-technical-friendly CSS editor. Upload or paste HTML plus one or more CSS files (reorderable cascade), get a live sandboxed preview, click any element to edit it via a simple property panel or a plain-English AI request, then download the result. Flag `restyle`. Route: `client/src/pages/RestylePage.jsx`. API: `server/routes/restyle.js`.

Stateless, same pattern as PDF Tools/Web Extractor — every request carries its own HTML/CSS; nothing persists server-side, nothing written to disk (multer memory storage only).

## No CSS jargon anywhere

Every automatic action (auto-fix, AI edit, undo) logs a one-sentence, jargon-free explanation. "The space around it," not "padding." "This text is being overridden by another style," not "specificity conflict." This applies to all UI copy and every change-log entry — see `PLAIN` map in `RestylePage.jsx` and the equivalent in `services/restyle/cssProcessor.js`.

## Endpoints

- `POST /api/restyle/upload-html` — accepts a `.html` file or pasted `html` string, sanitizes it server-side with jsdom (`services/restyle/sanitizeHtml.js`) before it's ever sent to the browser: strips `<script>`, inline event handlers (`onclick` etc.), `javascript:` URLs, and nested browsing contexts (`<iframe>`/`<object>`/`<embed>`/`<base>`). Returns the safe `<head>`/`<body>` innerHTML separately, plus a change-log entry.
- `POST /api/restyle/process-css` — accepts any number of dropped `.css` files (`files`) and/or a JSON `pasted` array of `{filename, css}`, plus an `order` array (filenames) giving the desired cascade order. Runs every stylesheet through PostCSS's real AST (`services/restyle/cssProcessor.js`) — never regex — to silently normalize parser-safe issues (missing semicolons, trailing commas) and flag ambiguous ones: duplicate properties within a rule, a rule fully overridden by a later one with equal-or-higher specificity, and a basic WCAG contrast check when a single rule sets both `color` and `background-color`. Returns one merged stylesheet in cascade order (last file wins on ties, same as the real browser cascade) plus `changeLog` and `flags` arrays.
- `POST /api/restyle/ai-edit` — the selected element's tag/classes/inline styles/computed styles for the supported properties, plus a free-text request. Resolves the model via `getModelsForUser(req.user.id).standard` — the same "standard" tier every other Vault AI feature uses, no separate model setting. System prompt (`services/restyle/aiEdit.js`) constrains Claude to a strict JSON array with an allow-listed `property` field; anything outside `ALLOWED_PROPERTIES` is filtered server-side before it reaches the frontend, so the model can never return a change the property panel doesn't know how to apply.

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
