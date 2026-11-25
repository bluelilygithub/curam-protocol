# DNS Lookup

See what a domain name points to, who hosts it, which registrar it is with, where its email goes, and whether a DNS change has spread. Page: `/dns-lookup` (flag `dnsLookup`, Research & Utilities). Laid out like Graphics and Video Tools: a `ToolSidebar` menu on the left (Look up → Look up records, Check email setup; Saved → Saved lookups). Table `dns_lookups`; no environment variables.

## What it does

- **Look up records.** Type a domain, a web address or an email address (only the domain part is used), or an IP address. Record types: A, AAAA, CNAME, MX, NS, TXT, SOA, CAA (all ticked by default). An IP address gives a reverse lookup (PTR). Each value has a Copy button; A/AAAA show their TTL, MX its priority.
- **Host and registrar.** Every lookup also asks `POST /about`, separately so the records show first. Host: the name's first A (else AAAA) address, looked up on `rdap.org/ip/<ip>` (organisation, network name) plus its reverse name. Cloudflare, Akamai, Fastly, CloudFront and similar are marked as a proxy: the real server is hidden. Registrar: the registrable domain (`www.x.com.au` → `x.com.au`) through Business Profiler's `lookupRegistration` (RDAP, then port-43 WHOIS for .au and others that redact). .au gives no dates. Never shows owner name or address. Code: `server/services/dnsLookup/whoHosts.js`.
- **Ask which resolver.** Cloudflare (1.1.1.1) or Google (8.8.8.8). The server asks that public resolver directly (`dns.promises.Resolver`, 4 s timeout), not the server's own resolver.
- **Compare both.** Asks both resolvers and says, per record type, whether they agree (TTL ignored). Pure helper: `client/src/pages/dnsLookup/compare.mjs`.
- **Check email setup.** Reads MX, SPF and `_dmarc` TXT and lists plain-words findings (good / worth a look / problem / note). Pure code: `server/services/dnsLookup/emailChecks.js`.
- **Saved lookups.** The page saves every answer it shows (records with host/registrar once both are in, and email checks) to `dns_lookups` (`kind` records|email, `result` JSONB exactly as shown). Saved lookups lists the newest 200; clicking one reopens it as it was (not refreshed). Delete goes to the recycle bin (type `dns-lookup`, adapter `server/services/recycleBin/adapters/dnsLookup.js`) with an Undo toast.
- **Export.** Beside every answer and every saved row: **Report** (a self-contained .html that prints to PDF) and **CSV**. Built in the browser from the saved shape, no new lookup: `client/src/pages/dnsLookup/report.mjs`.

## Gotchas

- The host panel resolves the address itself, so on a site that rotates addresses (GitHub) the "Address checked" can differ from the A record shown. That is why the line says "checked".
- RDAP calls go through BIP's `fetchPublicJson` (SSRF guard, 300 ms gap per module `dns-lookup-rdap`), so many lookups at once queue.

## What it does not do

Change records, check DKIM (needs the sender's selector), say whether mail will really arrive, show the domain owner's details, watch a name over time, or look up private/internal names. A site's uptime is **Lighthouse**; whether a name is free to buy is **Domain**. No microphone on the boxes: a spoken domain name is too easy to mishear.

## Files

`server/routes/dnsLookup.js` (`GET /options`, `POST /records`, `POST /email`, `POST /about` — those three share a 40-a-minute limit per person — and `GET/POST /saved`, `DELETE /saved/:id`), `server/services/dnsLookup/lookup.js`, `whoHosts.js`, `emailChecks.js`, `client/src/pages/DnsLookupPage.jsx`. Tests: `npm run test:dns-lookup` (no network) and `node client/src/pages/dnsLookup/report.test.mjs`.

## Help

(i) box (opens once), compass tour (`client/src/utils/tours/dnsLookupTour.js`, key `vault_tour_dns_lookup_completed`, retake from Settings -> `/dns-lookup?tour=1`) and a **DNS Lookup guide** (round button, `POST /api/dns-lookup-tutor`, `server/services/dnsLookupTutor.js`, wrapper `client/src/pages/dnsLookup/DnsLookupTutorChat.jsx`). It sees no names or answers. `dnsLookupTools.mjs` holds the menu (`DNS_TOOLS`) and the controls the guide's Open buttons go to; update it and the guide `CATALOG` together (`npm run test:dns-lookup-tutor` fails on drift).
