# CRM email sync

Records the email exchanged with a client's people in that client's **Activity** log, from the person's own connected Gmail. Built 2026-11-09, small on purpose.

## What it does

- A client is matched by its **contacts' email addresses** (exact match) and by the **email domains** saved on the client (`clients."emailDomains"`, for example `wiwc.com.au`). Anyone at a saved domain (and its sub-domains) matches; a contact on a free-mail address such as `brett@gmail.com` matches by address only.
- Both **inbox and sent mail** are read (the Gmail search is `from:`, `to:` and `cc:` for each address and domain). Gmail's default search leaves out spam and trash.
- **One Activity entry per thread** (type `email`, source `gmail_sync`, shown under the Emails filter). Its date is the latest message in the thread; its note is the subject and a count (`1 sent, 2 received (3 emails)`). If one of the client's contacts took part, the entry is tied to that contact.
- **The note is three parts:** the subject (the **first email's**, even when blank: a thread started from a phone with no subject stays "(no subject)"), the counts with the **dates of the first and last email** (`5 sent, 2 received (7 emails) · first 6 Nov 2026, last 9 Nov 2026`, Brisbane time; a single email shows its date), and an **AI summary** of the exchange (2 to 4 sentences: what it was about, what was asked or agreed, what is outstanding). **The entry's date is the latest real email**, so a long thread shows when it last moved.
- **The summary** is written by the light model (`getModelsForUser().light`, usage logged as `clients_email_summary`). It is shown the thread's text (quoted earlier mail and reply trails removed, about 9,000 characters across the thread) **only to write the summary: the message text itself is never stored**, only the summary. The prompt treats the email text as data, not instructions, and asks it not to repeat passwords or card or account numbers. A thread is summarised when it is first logged and again when it grows. At most **40 summaries per client per run**; the rest are done on later runs, and an entry this job wrote that has no summary yet (made before summaries existed, or a failed attempt) is given one the next time its client is read, as long as nobody has edited its note. If the model fails, the entry is logged without a summary and tried again. Newsletters and automated mail are skipped (a `List-Unsubscribe`, `Precedence: bulk/list/junk` or `Auto-Submitted` header). Mail to yourself is not a client email.
- **Whole threads are read.** The Gmail search finds the threads that have mail in its window, then each thread is read whole, so the counts and the first and last dates are those of the full exchange even when only one new message fell inside the window. (An earlier version counted only the messages the search found, which gave one-email counts on a re-read.)
- **Drafts, bin and spam do not count.** An unsent reply sitting in Drafts is not an email that was exchanged: it is left out of the counts, the dates and the summary. A thread that is only a draft is not logged.
- **Entries are brought in line.** An entry this job wrote and nobody edited (its note starts with its own subject) is corrected from the whole thread on the next read: wrong counts, dates or subject are put right and its existing summary is kept (no new model call) unless the thread has new mail. An entry whose note you wrote in yourself is left alone until its thread grows.
- **No duplicates.** Each entry carries `"externalId"` = `thread:<gmail thread id>`, with a unique index on `("clientId", "externalId")`. When a thread grows, its entry moves to the new date and note; a thread that has not grown is left alone, so a note you edited stays as you left it.

## When it reads, and how far back

- **From 1 July 2026** (`SEED_FROM`, Brisbane midnight) the first time a client is read. Every client starts unread (`clients."emailSyncedAt"` NULL), so the **first daily run seeds every existing client** back to 1 July.
- **A new client** with a domain, **a new or changed contact email**, or **a changed domain list** marks that client unread and starts a read straight away in the background (`requestSync`), so it goes back to 1 July without waiting for the daily run. A client created with no domain and no contact emails has nothing to match and costs no Gmail call; adding either later triggers the read.
- **Daily at 21:00 UTC = 7:00 am Brisbane** (`server/cron/clientEmailSyncCron.js`, `withCronLock('client-email-sync')`): every connected person's clients (archived ones skipped), reading only what is new (since the last read minus two days, never before 1 July). It runs **before** the stale-deal check (22:00 UTC), so a deal being emailed about is not flagged as quiet (the stale-deal rule counts `email` entries as activity).
- **Check email now** (Info card on the client page, `POST /api/clients/:id/email-sync`) does a **full read back to 1 July 2026** for that one client, whatever the last read was. It is safe to repeat: nothing already logged is duplicated and nothing already summarised is summarised again. This is also how an entry that is wrong gets put right when its thread has nothing new (the daily job only reads recent mail, so it never looks at an old, quiet thread). The toast says how many conversations were new and how many were corrected or updated, or that some could not be read from Gmail.
- **One-time reset (2026-11-09):** on the first boot after the drafts/whole-thread fix, every client is marked unread once (`workspace_settings` marker `client_email_resync_2026_11_09`, so it never repeats), so the next daily run re-reads every client back to 1 July and corrects the entries the first rules got wrong. Corrected entries keep their summary (no new model call); only entries without a summary, or whose thread has grown, are summarised.
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
- A button to rewrite one summary, or to turn summaries off (they cost a small model call per thread; the first run over many threads costs more).
- A setting for who is included or a per-client off switch; matching a person by name; guessing a client from the subject; Bcc.
- Never run against a real Gmail account in development (it was tested with a fake Gmail): the first live read is the real test.
