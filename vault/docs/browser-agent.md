# Browser Agent

`/browser-agent`, flag `browserAgent`. Ported from a standalone Playwright/CDP demo into a native Vault feature.

Streams a live view of a real headless Chromium session (Chrome DevTools Protocol screencast, `Page.startScreencast`) while an Anthropic tool-use loop fills a form on a site the user names. It never presses submit — the click tool refuses submit-like elements (`isSubmitLike()`), and a Playwright request-route guard blocks/aborts same-host POSTs while the agent is driving. When the form is complete the agent calls `handoff_for_review`, control passes to the user, and both guards switch off — the user reviews the filled form in the streamed view and presses the site's own send button themselves.

## Files

- `server/services/browserAgent/browserAgentSession.js` — `BrowserAgentSession`: one Playwright `BrowserContext`/`Page` per connection, the 9-tool agent loop, the submit-click guard, the network-level POST guard.
- `server/services/browserAgent/browserAgentWs.js` — WS upgrade handler mounted at `/api/browser-agent/ws`. Authenticates the same way `requireAuth` does (32-byte hex token, but read from `?token=` since the upgrade handshake never runs Express middleware), applies `browserAgent` feature-access, caps concurrent sessions, resolves an Anthropic model via `getModelsForUser()`.
- `client/src/pages/BrowserAgentPage.jsx` — live view + instruction box + step log + saved "your details" profile (browser-local, not server-persisted).

## Known limits (carried over from the reviewed original, not yet hardened further)

- The POST guard only catches `document`/`xhr`/`fetch` resource types — a GET-based form submit or `navigator.sendBeacon` isn't blocked by it. Narrow edge case, not the common path.
- `snapshot()` feeds raw page text into the model's context with no delimiting — a page could contain content shaped like instructions. The system prompt tells the model to treat page content as data, not commands, but that's a mitigation, not a guarantee.
- Model tool-use loop is Anthropic-only (no Gemini/DeepSeek routing like `chat.js`); `browserAgentWs.js` picks the first Anthropic id out of the resolved `standard`/`light` tiers and errors clearly if the workspace has none configured.

## SSRF guard

`navigate` reuses `server/services/htmlFetch.js`'s `normaliseHttpUrl()` + `checkSsrf()` (DNS lookup + private-IP/localhost rejection) — the standalone original had no such guard on its equivalent tool.
