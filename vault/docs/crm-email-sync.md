# CRM email sync

Records the email exchanged with a client's people in that client's **Activity** log, from the person's own connected Gmail. Built 2026-11-09, small on purpose.

## What it does

- A client is matched by its **contacts' email addresses** (exact match) and by the **email domains** saved on the client (`clients."emailDomains"`, for example `wiwc.com.au`). Anyone at a saved domain (and its sub-domains) matches; a contact on a free-mail address such as `brett@gmail.com` matches by address only.
- Both **inbox and sent mail** are read (the Gmail search is `from:`, `to:` and `cc:` for each address and domain). Gmail's default search leaves out spam and trash.
- **One Activity entry per thread** (type `email`, source `gmail_sync`, shown under the Emails filter). Its date is the latest message in the thread; its note is the subject and a count (`1 sent, 2 received (3 emails)`). If one of the client's contacts took part, the entry is tied to that contact.
- **Only the subject and counts are stored**, never the message text or a link. Newsletters and automated mail are skipped (a `List-Unsubscribe`, `Precedence: bulk/list/junk` or `Auto-Submitted` header). Mail to yourself is not a client email.
- **No duplicates.** Each entry carries `"externalId"` = `thread:<gmail thread id>`, with a unique index on `("clientId", "externalId")`. When a thread grows, its entry moves to the new date and note; a thread that has not grown is left alone, so a note you edited stays as you left it.

## When it reads, and how far back

- **From 1 July 2026** (`SEED_FROM`, Brisbane midnight) the first time a client is read. Every client starts unread (`clients."emailSyncedAt"` NULL), so the **first daily run seeds every existing client** back to 1 July.
- **A new client** with a domain, **a new or changed contact email**, or **a changed domain list** marks that client unread and starts a read straight away in the background (`requestSync`), so it goes back to 1 July without waiting for the daily run. A client created with no domain and no contact emails has nothing to match and costs no Gmail call; adding either later triggers the read.
- **Daily at 21:00 UTC = 7:00 am Brisbane** (`server/cron/clientEmailSyncCron.js`, `withCronLock('client-email-sync')`): every connected person's clients (archived ones skipped), reading only what is new (since the last read minus two days, never before 1 July). It runs **before** the stale-deal check (22:00 UTC), so a deal being emailed about is not flagged as quiet (the stale-deal rule counts `email` entries as activity).
- **Check email now** (Info card on the client page, `POST /api/clients/:id/email-sync`) reads one client immediately.
- The cron is **off where `DISABLE_EXTERNAL_CRON` is set** (staging), like the other jobs that read outside services. The per-client reads from saving a contact or domain run wherever the server runs, if that person has Gmail connected.
- Gmail not connected: nothing is read and nothing is lost; connect Gmail and the next run fills the gap. If Gmail refuses the login during the daily run, a **Suggestions inbox alert** says to reconnect.

## Limits and rules

- At most **500 messages per client per read**; a longer history is cut off (the oldest are left out) and a line is logged.
- **Free-mail domains** (gmail.com, outlook.com, hotmail.com, yahoo.com, icloud.com, bigpond.com, optusnet.com.au and the like, list in `FREE_MAIL`) are refused as a domain with a plain message, on create and edit. A pasted website address is tidied to its domain (`https://www.wiwc.com.au/about` becomes `wiwc.com.au`).
- Your own Gmail address and domain are never matched, or every email you sent would land on the client.
- Only the caller's own clients are read (`WHERE "userId"`), and each person's own Gmail is used (read-only scope; no new Google permission).
- Per client, two reads never overlap (an in-memory guard).

## Where things are

- `server/services/clientEmailSync.js`: the rules (`normaliseDomains`, `buildQuery`, `threadEntry`, `involvesClient`), `syncClientEmails`, `syncClient`, `requestSync`, `syncAllUsers`.
- `server/cron/clientEmailSyncCron.js`, started from `server/index.js` (inside the external-cron branch).
- `server/routes/clients.js`: `emailDomains` on create and edit; contact add and email change call `requestSync`; `POST /:id/email-sync`.
- `server/db.js`: `clients."emailDomains"` (JSONB), `clients."emailSyncedAt"`, `client_interactions."externalId"` and its unique index.
- Client UI: an **Email domains** field on New client and Edit client (`ClientsPage.jsx`, `ClientDetailPage.jsx`), and the **Email logging** line with **Check email now** at the top of the Info card.
- Test: `node server/services/clientEmailSync.test.js` (rules), and with `DATABASE_URL` set a real database and a fake Gmail (first read goes back to 1 July, later reads are incremental, nothing is logged twice, a grown thread updates, an edited entry is kept, another person's client is not read, a client with nothing to match makes no Gmail call).

## Not built

- Importing before 1 July 2026, or choosing the start date.
- A deleted email entry comes back on the next read that covers its thread (no memory of deletions).
- Linking to the thread in Gmail, storing message text, attachments, or reading the other mail (calendar invites).
- A setting for who is included or a per-client off switch; matching a person by name; guessing a client from the subject; Bcc.
- Never run against a real Gmail account in development (it was tested with a fake Gmail): the first live read is the real test.
