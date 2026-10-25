# Burner Mail

Throw-away email addresses on your own domain for web sign-ups. Page: `/burner-mail` (flag `burnerMail`, Research & Utilities). Make an address, use it on a sign-up form, and the verification code and confirm link appear on the page within a few seconds.

## What it does and does not do

- Makes addresses like `spotify-a1b2c3@yourdomain.xyz`, kept 1, 7 or 30 days (default 7). Expired addresses stop receiving mail; a cron removes them a day later.
- Pulls out verification codes (4-8 digits, or a short letters-and-digits code near words like "code") and links (confirm-looking ones first). Pure code, no model: `server/services/burnerMail/extract.js`.
- Stores plain text, codes and link addresses only. Email HTML is never stored or shown.
- **Never opens a link.** Each link shows its site name with Copy and Open buttons; the person decides.
- Mail to an address that does not exist or has expired is dropped quietly (no bounce, so a stranger cannot learn which addresses exist).
- Limits: 50 live addresses per person, 100 emails kept per address, 6 MB per email.
- Does not send mail, and does not fill sign-up forms (use Browser Agent for that).
- Deleting an address or email removes it for good (no recycle bin): the point of the tool is that it is disposable.

## One-time setup (owner)

1. **Domain.** Buy a cheap, ordinary-looking domain and put it on Cloudflare (free). Avoid names that look like "tempmail"; sign-up sites block those.
2. **Email Routing.** Cloudflare dashboard, the domain, Email, Email Routing, Enable. Cloudflare adds the MX and SPF records.
3. **Worker.** Create a Worker from `docs/burner-mail-worker.js`. Add two variables: `VAULT_URL` = `https://curam-vault.up.railway.app/api/inbound-mail` and `SECRET` (a long random string, as a secret).
4. **Catch-all.** Email Routing, Routing rules, Catch-all address, action "Send to a Worker", pick that Worker, enable.
5. **Railway variables.** `BURNER_MAIL_DOMAIN` = the domain (no `@`), `INBOUND_MAIL_SECRET` = the same string as `SECRET`.

Until both Railway variables are set the page shows a "not set up" note and the Make address button is off.

## How mail gets in

Cloudflare receives the email, the Worker posts the raw message to `POST /api/inbound-mail` with headers `X-Inbound-Secret` and `X-Envelope-To` (the real recipient, which can differ from the To header). The route is mounted before `requireAuth` and proved by the secret (constant-time compare). Another provider (Mailgun, Postmark) works the same way if it can post the raw message with those two headers.

## Files

`server/routes/burnerMail.js` (signed-in API and the inbound route), `server/services/burnerMail/extract.js` (+ `extract.test.js`), `server/cron/burnerMailCron.js`, `client/src/pages/BurnerMailPage.jsx`. Tables `burner_addresses`, `burner_messages` in `server/db.js`. Tests: `npm run test:burner-mail`, `npm run test:burner-mail-tutor`.

## Help

The page has an (i) box (opens once), a compass tour (`client/src/utils/tours/burnerMailTour.js`, key `vault_tour_burner_mail_completed`, retake from Settings -> `/burner-mail?tour=1`) and a **Burner Mail guide** (round button, `POST /api/burner-mail-tutor`, `server/services/burnerMailTutor.js` on `guideCore.js`, wrapper `client/src/pages/burnerMail/BurnerMailTutorChat.jsx`). It sees no addresses or emails. `burnerMailTools.mjs` lists the page's two areas and the controls the Open buttons scroll to; update it and the guide `CATALOG` together (`test:burner-mail-tutor` fails on drift).

## Not built

Microphone on the label field. A Browser Agent hand-off that reads the code for you.
