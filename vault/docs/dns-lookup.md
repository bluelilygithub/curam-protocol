# DNS Lookup

See what a domain name points to, where its email goes, and whether a DNS change has spread. Page: `/dns-lookup` (flag `dnsLookup`, Research & Utilities). Read only: nothing is stored, no table, no environment variables.

## What it does

- **Look up records.** Type a domain, a web address or an email address (only the domain part is used), or an IP address. Record types: A, AAAA, CNAME, MX, NS, TXT, SOA, CAA (all ticked by default). An IP address gives a reverse lookup (PTR). Each value has a Copy button; A/AAAA show their TTL, MX its priority.
- **Ask which resolver.** Cloudflare (1.1.1.1) or Google (8.8.8.8). The server asks that public resolver directly (`dns.promises.Resolver`, 4 s timeout), not the server's own resolver.
- **Compare both.** Asks both resolvers and says, per record type, whether they agree (TTL ignored). Different answers after a change usually mean it is still spreading. Pure helper: `client/src/pages/dnsLookup/compare.mjs`.
- **Check email setup.** Reads MX, SPF and `_dmarc` TXT and lists plain-words findings (good / worth a look / problem / note): no MX, mixed Cloudflare Email Routing and other MX, no SPF, two SPF records, `+all`/`?all`, more than 10 SPF lookups, no DMARC, DMARC `p=none`. Pure code: `server/services/dnsLookup/emailChecks.js`.

## What it does not do

Change records, check DKIM (needs the sender's selector), say whether mail will really arrive, WHOIS or expiry, watch a name over time, or look up private/internal names. A site's uptime is **Lighthouse**; whether a name is free to buy is **Domain**. No microphone on the boxes: a spoken domain name is too easy to mishear.

## Files

`server/routes/dnsLookup.js` (`GET /options`, `POST /records`, `POST /email`; 40 requests a minute per person), `server/services/dnsLookup/lookup.js` (input clean-up, resolver queries) and `emailChecks.js`, `client/src/pages/DnsLookupPage.jsx`. Tests: `npm run test:dns-lookup` (no network).

## Help

(i) box (opens once), compass tour (`client/src/utils/tours/dnsLookupTour.js`, key `vault_tour_dns_lookup_completed`, retake from Settings -> `/dns-lookup?tour=1`) and a **DNS Lookup guide** (round button, `POST /api/dns-lookup-tutor`, `server/services/dnsLookupTutor.js`, wrapper `client/src/pages/dnsLookup/DnsLookupTutorChat.jsx`). It sees no names or answers. `dnsLookupTools.mjs` lists the page's two boxes and the controls the Open buttons scroll to; update it and the guide `CATALOG` together (`npm run test:dns-lookup-tutor` fails on drift).
