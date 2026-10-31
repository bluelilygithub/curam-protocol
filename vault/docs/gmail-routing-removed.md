# Gmail routing (Shop/Deliveries) — tried and removed, 2026-10-31

An admin panel, a `gmail_routing_rules` table and a `GET /api/gmail/shop/ingest` endpoint were added to poll a
Gmail label (`Deliveries/ToProcess`) plus a sender/keyword query for shipping and delivery emails. They were
removed the same day (revert of commit `abc725b4`). Nothing else in Vault used them.

## Why it was removed
- Nothing called the endpoint: no cron, no page, no service. The panel's settings changed nothing.
- Only the "find the emails" step existed. There was no step that did anything with them and no record of which
  emails had been handled, so a label used as a queue would have returned the same mail on every poll.
- "Disabled" quietly fell back to polling the whole inbox.
- The label and the query were ANDed, so a hand-labelled email that missed the query was dropped without a trace.
- The rules table was global while Gmail connections are per person.
- The "Shop" app it was written for no longer has Gmail access, and the idea was never specced.

## If the idea comes back
Start from a concrete email stream and what should happen to it, not from the plumbing. Build it on the pattern
Invoice Review already uses (`expense_review_queue`, `server/services/expenseReviewService.js`,
`server/cron/expenseReviewCron.js`): a per-person rules table (who or what is watched, on or off), one row per
message with a unique message id and a status (new, actioned, ignored), and a cron wrapped in `withCronLock`.
Look at Invoice Review and Email Follow-Up first; a third copy of that loop should replace or reuse them.

## Leftover on production
The revert removes the code that created `gmail_routing_rules`, but a database that already booted with it still
has the table and its one seeded row. It is harmless and unused. Drop it by hand if you want it gone:
`DROP TABLE IF EXISTS gmail_routing_rules;` (deliberately not put in `db.js`, which runs on every boot).
