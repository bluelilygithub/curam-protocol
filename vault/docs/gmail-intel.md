# Inbox Intel

AI-powered read-only Gmail dashboard at `/gmail-intel`. Fetches the last 50 inbox messages and classifies them with Claude in a single batched prompt.

---

## What it does

- Fetches last 50 `INBOX` messages (metadata only — subject, sender, snippet, read status)
- Sends all 50 to Claude in one prompt; each gets a **category** and a **one-line summary**
- Displays results grouped by category with metric cards, filter pills, and client-side search
- Auto-refreshes every 5 minutes

---

## Categories

| Category | Meaning |
|---|---|
| **urgent** | Requires action soon, time-sensitive |
| **waiting** | Sender is blocked waiting on a reply from the user |
| **fyi** | Informational, no action required |
| **noise** | Newsletters, automated notifications, promotions |

---

## Architecture

**Backend routes** (in `server/routes/gmail.js`):

- `GET /api/gmail/inbox` — raw fetch of last 50 inbox emails, no AI
- `GET /api/gmail/inbox/classify` — fetch + Claude classify; returns `{ emails, classificationFailed }`

Both routes reuse `getGmailClient(userId)` which reads the stored OAuth token from `gmail_tokens`. No additional OAuth setup beyond the existing Gmail integration.

Classification uses the `standard` model tier from `getModelsForUser`. If Claude fails for any reason, `classificationFailed: true` is returned and emails are served without categorisation (graceful degradation).

**Rate limiting:** `/inbox/classify` is capped at 10 requests/minute per IP.

**Frontend** (`client/src/pages/GmailIntelPage.jsx`):

- Calls `/api/gmail/inbox/classify` on mount and every 5 minutes
- If the user has no Gmail token, shows a "not connected" state with a link to Settings
- Metric cards, category filter pills, and a search box (filters summary + sender + subject client-side)
- Emails grouped by category when "All" is selected; flat list when a category filter is active
- Unread emails get a left border accent in the primary colour

---

## Feature flag

Key: `gmailIntel` in `featureAccess`. Default: enabled for all users. Admins can toggle it off for members via the Admin → Feature Access panel.

---

## Gmail OAuth

Inbox Intel uses the same Gmail OAuth token that was already connected for Gmail search and the Ask AI thread feature. No additional scopes are required — `gmail.readonly` (already requested) is sufficient.

If a user has not connected Gmail, the page shows an empty state with a prompt to go to Settings → Integrations → Gmail.

---

## Limitations

- Read-only. No compose, reply, or any write operation.
- Fetches inbox only (not all mail, not sent, not other labels).
- Classification is best-effort. Long or ambiguous snippets may be mis-categorised.
- The 50-email limit is intentional to keep classification latency under ~10 seconds.
