# Browser Agent

`/browser-agent`, flag `browserAgent`. Ported from a standalone Playwright/CDP demo into a native Vault feature.

Streams a live view of a real headless Chromium session (Chrome DevTools Protocol screencast, `Page.startScreencast`) while an Anthropic tool-use loop fills a form on a site the user names. It never presses submit — the click tool refuses submit-like elements (`isSubmitLike()`), and a Playwright request-route guard blocks/aborts same-host POSTs while the agent is driving. When the form is complete the agent calls `handoff_for_review`, control passes to the user, and both guards switch off — the user reviews the filled form in the streamed view and presses the site's own send button themselves.

## Files

- `server/services/browserAgent/browserAgentSession.js` — `BrowserAgentSession`: one Playwright `BrowserContext`/`Page` per WS connection, the agent loop and its tools, the submit-click guard, the network-level POST guard, retry/error-recovery, multi-tab tracking, pause/resume, idle timeout.
- `server/services/browserAgent/browserAgentWs.js` — WS upgrade handler mounted at `/api/browser-agent/ws`. Authenticates the same way `requireAuth` does (32-byte hex token, but read from `?token=` since the upgrade handshake never runs Express middleware), applies `browserAgent` feature-access, caps concurrent sessions, resolves an Anthropic model via `getModelsForUser()`, loads the profile (Settings) and a per-hostname credential lookup for `fill_login`.
- `server/routes/browserAgent.js` — run archive (list/get/delete/bulk-delete, list includes step count + duration) + saved-login CRUD incl. pin (`/credentials`).
- `client/src/pages/BrowserAgentPage.jsx` — live view (with a stand-in scrollbar widget — see below), instruction box with mic input (`useVoice()`), presets, domain-restrict field, live cost/turn readout, step log with copy/download, read-only profile summary, info modal + tooltips.
- `client/src/pages/BrowserAgentSettingsPage.jsx` (`/browser-agent/settings`) — editable profile fields (writes the same `settings` keys as the main Settings page) + saved site logins (pin/delete).
- `client/src/pages/BrowserAgentArchivePage.jsx` (`/browser-agent/archive`) — past runs (outcome, step count, duration), expandable to the full step log with copy/download, multi-select delete.
- `client/src/components/BrowserAgentInfoModal.jsx` — "How This Works" modal, same pattern as `CrmInfoModal.jsx` (info icon in the header, auto-shows once per browser via `localStorage`, always reachable again via that icon).

## Conversation memory

`this.messages` persists for the life of the WS session (not reset per instruction) — a follow-up like "now use a different date" has the prior exchange as context, not just whatever's visible in the live page state. **Clear session** (header button) wipes it and navigates the page to `about:blank`, for a genuinely fresh start without reconnecting.

## Saved site logins (`fill_login`)

`browser_agent_credentials` (userId, label, domain, username, password, pinned) — password encrypted at rest with `server/utils/encryption.js`, the same AES-256-GCM helper Gmail OAuth tokens use. Pinned logins sort to the top of the Settings list.

The password is **never sent to the model or the Anthropic API**. The `fill_login` tool takes no input; server-side, `browserAgentWs.js` decrypts the matching credential for the current page's hostname and `browserAgentSession.js` fills it directly into the detected username/password fields via Playwright, returning only "Filled saved login" (or "No saved login for this site.") to the model. This was a deliberate redesign — an earlier draft that returned the credential value as a tool result was blocked by Claude Code's own permission classifier for credential leakage before it shipped.

Login/sign-in submit buttons are blocked by the same `isSubmitLike()` guard as every other submit button — `fill_login` only fills the form, it never signs in on its own.

## Robustness features

- **Retry + faster recovery** — `click`/`type` retry once after a transient Playwright timeout (`withRetry`, common on React/Vue sites that redraw right after an action). A "No element with ref" failure now hands the model a fresh snapshot inline instead of costing it an extra turn.
- **Screenshot on error** — any tool error captures the current page as a JPEG, archived as an `error_screenshot` log entry (rendered inline in both the live log and Archive).
- **Multi-tab awareness** — new tabs (OAuth popups, payment redirects, "view" links) stay open and tracked (`this.pages`) instead of being force-merged into the main tab. `list_tabs` / `switch_tab` let the model see and move between them; the live screencast follows the active tab.
- **Live cost/turn readout** — a `usage` WS message after every model turn (`{turn, maxTurns, inputTokens, outputTokens, costUsd}`) shown in the turn bar, using the same "hardcoded price table for cost display only" exception as `costCalculator.js`.
- **Per-run domain allowlist** — an optional field on the instruction box restricts `navigate` to one domain (and its subdomains) for that run.
- **Idle timeout** — a Chromium context with no WS activity for 10 minutes is closed to free resources; conversation memory survives, the next instruction just reopens the browser.

## Productivity features

- **Instruction presets** — save a typed/spoken instruction as a one-click chip (`browser_agent_presets` setting, per-user JSON array via the generic `/api/settings` upsert — no new table).
- **Pause / Resume** — distinct from Take over: pause halts the loop before the next tool call (`this.paused` + a promise the loop awaits, resolved by `resume()`); the run, its turn count, and conversation memory are untouched. Take over still fully ends the run.
- **"Fields changed this run"** — derived client-side from `action`-kind log entries matching `Typing into`/`Choosing`/`Filling saved login`, shown alongside the handoff summary during review.
- **Copy/Download step log** — plain-text export, on both the live page and Archive (`error_screenshot` entries excluded from the text export).
- **Enter to start** — Enter in the instruction box starts the run; Shift+Enter for a newline, matching the answer box's existing behaviour.

## Known limits (carried over from the reviewed original, not yet hardened further)

- The POST guard only catches `document`/`xhr`/`fetch` resource types — a GET-based form submit or `navigator.sendBeacon` isn't blocked by it. Narrow edge case, not the common path.
- `snapshot()` feeds raw page text into the model's context with no delimiting — a page could contain content shaped like instructions. The system prompt tells the model to treat page content as data, not commands, but that's a mitigation, not a guarantee.
- Model tool-use loop is Anthropic-only (no Gemini/DeepSeek routing like `chat.js`); `browserAgentWs.js` picks the first Anthropic id out of the resolved `standard`/`light` tiers and errors clearly if the workspace has none configured.
- Headless Chromium's default fingerprint (`navigator.webdriver=true`, giveaway UA) is unmodified — sites running active bot-detection (Cloudflare Bot Fight Mode, Wordfence, etc.) on a login/checkout page will challenge the agent even where a real browser sails through. Fixing that is headless-detection evasion, which Claude Code's own permission classifier blocks regardless of intent — the workaround is on the site's side (allowlist the agent, or turn off bot-challenge for that path), not the browser's fingerprint. See the payment-automation exploratory discussion in project history for the full reasoning.

## SSRF guard

`navigate` reuses `server/services/htmlFetch.js`'s `normaliseHttpUrl()` + `checkSsrf()` (DNS lookup + private-IP/localhost rejection) — the standalone original had no such guard on its equivalent tool.
