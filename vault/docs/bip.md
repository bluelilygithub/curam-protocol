# Business Profiler (BIP)

`/bip` (start a profile) · `/bip/:id` (saved profile) · nav: **Web & SEO → Business Profiler** · flag `bip` (default off, lifecycle **preview**) · table `bip_profiles` (Postgres JSONB)

A sourced company dossier built from a domain. BIP collects what the domain says, what public registers say, what the business says about itself and what third parties say, then puts every value on the page with the source that supplied it. Where sources disagree the disagreement is shown, **not resolved**: the person reading the card chooses, and that decision is saved with the profile.

It is a research sheet, not a credit report, an ASIC company extract or legal advice. It does not guess revenue, directors or ownership, and it does not infer facts from a company name.

## What a run does

### Stage 1 — seed

Runs first, four sources in parallel. Each has its own timeout and keeps a source row even when it fails or is unavailable.

1. **Domain registration** — `https://rdap.org/domain/{domain}`. No key. RDAP vcard layouts vary between registries, so the parser is forgiving and reads registrant name, organisation, address, registrar, registration/expiry dates and status. If RDAP is redacted (no registrant, organisation or address) or the request fails, it falls back to a **small pure-Node port-43 WHOIS client** (`whoisFallback.js`, a fixed table of public WHOIS servers). That fallback is deliberate: adding `node-whois` would change `package.json`, and a dependency change forces the 10–15 minute base-image rebuild described in `docs/deploy-speed.md`. Registration age is derived from the date actually found; nothing is invented when it is absent.
2. **DNS** — reuses the **`/dns-lookup` service** (`server/services/dnsLookup/lookup.js`), Cloudflare resolver, no second resolver or parser in BIP. Reads A, CNAME, MX, NS, TXT, SOA, CAA and DMARC; the raw `{ type, records, error }` answer is kept.
3. **Website** — SSRF-safe scrape of `/`, `/about`, `/contact` and `/sitemap.xml` through the shared `htmlFetch` guard. Records page status and title, meta description, repeated keywords, contact emails/phones/addresses, named people with roles, social links, analytics tags and up to 100 sitemap URLs. Text and HTML are capped per page; a page that blocks the fetch becomes a source row with an error, not a failed profile.
4. **Domain tool overview** — calls the Domain tool's `/overview` for the same domain, when that provider is available, and keeps its answer as another seed source.

### Stage 2 — enrichment modules

The seed (name, ABN if found, domain) is passed to each module. A module returns `success`, `skipped` (with a plain reason) or `failed`; a missing key skips only that module.

| Module | Source | What it adds | When it is off |
| --- | --- | --- | --- |
| `abr` | ABR JSON API (`abr.business.gov.au/json`) | ABN lookup by the ABN found in Stage 1, or by entity name when there is none: exact entity name, formatted ABN, entity type, GST status and start date, ABN status, registration date, trading names, state and postcode. The JSONP wrapper is unwrapped by the shared HTTP helper. | No `ABR_GUID` |
| `abr` without a key | ABN Lookup public history page (`abr.business.gov.au/AbnHistory/View?id=<ABN>`, `abrPublic.js`) | When `ABR_GUID` is not set but an ABN was found on the website: current and former entity names with dates, ABN status and start, entity type, GST, main business location (state and postcode) with its history, and the ACN. It cannot search by name. With `ABR_GUID` set, the same page is read after the JSON lookup to add the name and location history and the ACN. Fixture of the real page: `server/services/bip/fixtures/abnHistory-69161409132.html`. | No ABN on the website and no `ABR_GUID` |
| `asic` | ASIC Connect public register | Deliberately graceful: there is no free public API. If the public pages expose no directors, the module records `status: 'unavailable'` with a **manual link to `https://connectonline.asic.gov.au/`** and says to check there. It never guesses directors or share structure. | Unavailable by design; always shows the manual link |
| `places` | Google Places (Text Search) | Verified listing name, formatted address, phone, website, Maps URL, rating and review count, queried from the business name and domain. | No `GOOGLE_PLACES_API_KEY` |
| `googleSearch` | Google Custom Search JSON API | Two de-duplicated searches (quoted entity name and quoted domain), **top 10 results with title, snippet, URL and date** (date from the result's page metadata when present). | No `GOOGLE_SEARCH_API_KEY` or `GOOGLE_SEARCH_CX` |
| `socialLinks` | Stage 1 website scrape | Social profile URLs, network and handle from the scraped pages; no separate crawl. | No links found on the pages |
| `productReview` | ProductReview.com.au | Public listing's rating, review count and listing URL when the page states them explicitly. | No public listing or the page cannot be read |
| `trustpilot` | Trustpilot | Same, by domain. Ratings are shown as what the review site says, not verified by BIP. | No public listing or the page cannot be read |
| `techStack` | **DNS TXT/MX/NS/CNAME + page source** | Inferred email provider, DNS host, CDN, analytics, CRM/marketing and third-party verifications. Every inference carries its evidence string (for example `MX record: aspmx.l.google.com`), so it reads as an inference, never as a fact supplied by the business. | Not applicable — derived from Stage 1 |

Each module owns its timeout, small retry and minimum gap between calls; one slow or rate-limited source cannot hold up the rest of the profile.

### Website extraction (fixed 2026-11-23 from the live saleslogs.com profile)

- **sitemap.xml is not page text.** It used to be joined to the HTML pages' text, so its URLs became "keywords" (`hubfs`, `thumbnail`, hashes) and its `<lastmod>` dates and image ids became "phones". The sitemap is now only read for `sitemapUrls`.
- **Phones** must look like a phone (`looksLikePhone`): `+` and 8–15 digits, or an Australian `0X XXXX XXXX` / `1300` / `1800` number. Dates, year ranges and ids are refused.
- **Addresses** are read across line breaks (`extractAddresses`): a street line followed within two lines by a state, postcode or "Australia" line is one address ("Level 10, 637 Flinders Street" + "Docklands VIC 3008").
- **Business names from the site** (`extractNames`): the legal name from a `© … Pty Ltd` line (only when it ends in a company suffix) and the site name from `og:site_name` or the part of page titles after `|` / `–`. Both go into reconciliation as `Website scrape`, and the legal name is used (after ABR and RDAP) for the profile title and the ABR name search. Business names are compared without company suffixes, so "SalesLogs" and "SALESLOGS PTY LIMITED" agree.
- **ABN printed on the site** ("ABN: 69 161 409 132") is read and used for the ABR lookup and reconciliation.
- **More of the site (2026-11-23):** after `/`, `/about`, `/contact` and `/sitemap.xml`, up to 8 same-site pages from the homepage links and the sitemap are read when the last part of their path is a legal, people, history, press, customer or careers page (`pickExtraPages`; `/teams` or `/benefits-sales-team` do not count). Legal pages are where the registered name and ABN usually are ("SalesLogs Pty Ltd ABN 69 161 409 132"); a name followed by ABN/ACN is preferred over the © line. Phones, emails and addresses are read from the business's own pages only, not its terms or privacy pages (those list the regulator, e.g. OAIC 1300 363 992). Addresses need a street number and street word as whole words, or a Level/Suite/Unit/PO Box line, followed by a state or "Australia"; a trailing ", Australia" is dropped. The extra pages' text is kept (`extraPages`, 4,000 characters each) and goes to the summary.
- **Cards and PDF:** a skipped Google Places no longer shows an empty rating line; "Years in business" says whether it is a stated founding year or only the domain's age; the PDF prints the confidence labels as words, since its built-in fonts cannot draw the ✅ ⚠️ ❌ icons.

### Stage 2b — web research (`webResearch`, `research.js`)

Runs after the other enrichment modules, with the ABN Lookup result in the seed, so it can search by the registered name. Uses Vault's shared web search (`SEARCH_API_KEY` / `SEARCH_PROVIDER`, `services/webSearchService.js`); skipped when no key is set or no model is set up.

1. **Five searches**, each excluding the business's own site (`-site:<domain>`): founders/launch, CEO/director/COO, news/interview/podcast, reviews/G2/Capterra, and the registered name without its suffix.
2. **Pages:** the business's own site and its subdomains, LinkedIn, Facebook, Instagram, X, YouTube, TikTok and Pinterest are skipped. Up to 8 pages are read through `htmlFetch` (SSRF guard), 7,000 characters each, and **kept only if they mention the business** (its domain, brand or registered name as whole words), which keeps same-name businesses out.
3. **Extraction:** the workspace standard model (logged as `bip_research`) returns facts of kind person / history / customer / scale / partnership / review / other, each with a page id, a word-for-word quote and a `sourceType`: `register`, `independent` (press, podcast, third-party site), `company_claim` (the business or its staff about themselves, including interviews) or `estimate` (data-broker bands).
4. **Checks (`checkFacts`):** a fact is dropped unless its page exists, its quote is found on that page (case, spacing and punctuation ignored), and every number of two or more digits in the fact is in the quote. The count of dropped facts is kept.

People facts join the **People** card with their page, quote and label (a founder or COO named in the press is not a confirmed director). The rest fill the **History & research** card and the PDF, grouped as history, customers, scale, partnerships, review sites and other. The summary receives them with their `sourceType` and is told to say "the company says" for company claims and to name estimates as estimates.

### Stage 3 — reconciliation

The ABN Lookup main business location ("NSW 2284") is added as an `address` value, so a website address in another state shows as ❌ for the person to judge. Years in business uses, in order: a founding year stated on the website, the ABN's registration date, then only the domain's age, and says which.

`businessName`, `abn`, `address` and `phone` are cross-referenced from all modules that supplied them. **Every value is kept** with its source name and, where there is one, the source URL. Values are normalised only for comparison (case, spacing, punctuation and ABN digits), never to pick a winner.

| Mark | Meaning |
| --- | --- |
| ✅ | Confirmed by two or more sources, all giving the same value |
| ⚠️ | One source only |
| ❌ | Sources disagree |

BIP **never auto-resolves a conflict**. All values stay visible under the field; the person picks one, and the choice is written to that field's `decision` on the profile. A later run keeps the decision attached to the same field, and a conflict remains marked as a conflict even after someone has decided.

### Stage 4 — cards

The saved profile renders seven cards: **Entity Overview** (name, ABN, entity/GST/ABN status, trading names, domain, registration dates, registrar), **People** (from the website and any ASIC directors), **Locations** (every address with its confidence mark), **Products & Services** (description, keywords, industry hints, sitemap URLs), **Digital Footprint** (email/hosting/CDN/analytics/CRM, social links, DNS records), **Online Presence & Reputation** (Google Places, ProductReview, Trustpilot and the top-10 mentions) and **Financial Indicators**.

The Financial card is labelled *estimates from public sources*, but BIP does not manufacture them: revenue and funding stay blank because none of the sources publishes them, and only a stated employee count or founded year appears. Missing facts anywhere else show "Not found" rather than a guess.

## Worked example — saleslogs.com

*Illustrative example. These are the values to expect in a profile of `saleslogs.com` when the named sources return them; they were not looked up while writing this document.*

- **Stage 1** — RDAP gives the domain registration and a registrant address in **Victoria**; `/dns-lookup` gives the MX/NS/TXT/CNAME records; the website scrape of `/about` says the business was **founded ~2004**, has **~13 employees** and works in **automotive SaaS**; the Domain tool `/overview` supplies a second name/ABN row.
- **Stage 2** — ABR confirms the exact entity **SalesLogs Pty Limited** and ABN **69 161 409 132**; Google Places and the review sites may add a rating and a listing link; DNS plus page source infer the email provider, host and analytics with their evidence.
- **Stage 3** — the name and ABN are ✅ (ABR plus the Domain tool), while the Victorian address, ~2004, ~13 employees and automotive SaaS are ⚠️ because each came from one source. If Google Places returned a different trading name, that field would be ❌ with both values shown until the person chooses.
- **Stage 4** — the Entity card shows `SalesLogs Pty Limited` · `69 161 409 132`; the Products & Services card shows `automotive SaaS`; the Financial card shows `~13 employees`, `~2004` and no revenue or funding figure.

## Summary (AI)

`server/services/bip/summary.js`. When a run finishes (`run.js`, after `finishProfile`, progress phase `summary`), the workspace's **standard** model (`getModelsForUser`) writes three plain paragraphs: what the business is and sells, where it is and how long it appears to have operated (with the basis), and its online presence, technology, reputation and gaps. The input is only the saved profile: reconciled fields with their sources and confidence, the cards, the sources that were skipped and why, and up to 3,500 characters each of the homepage, About and Contact text from the saved scrape (fenced as information, never instructions). No web search, no general knowledge. After writing, `checkFigures` lists any year, phone or count in the summary that does not appear in that input (`unverifiedFigures`), shown in amber under the summary and in the PDF. A failed summary never fails the run. Stored in `bip_profiles.summary` (JSONB `{ text, model, generatedAt, unverifiedFigures }`); `POST /profiles/:id/summary` (behind `aiLimiter`) writes it again. It is shown above the cards, at the top of the PDF, and in the Save to Note body. Usage is logged as `bip_summary`. The figure check is digits only: a made-up name or claim without a number is not caught.

A re-scan of one source now rebuilds the cards with the saved website, registration and DNS data (they are stored in `seedData`, while `enrichmentData` holds only their status); before, refreshing any one source emptied the website-based fields.

## Ask about this profile

The **Ask about this profile** tool (Report group; `client/src/pages/bip/BipAsk.jsx`, `server/services/bip/ask.js`). A question box with the shared microphone (`VoiceInput type="textarea" append`), four suggested questions, and **Ask**. The standard model answers from the same data as the summary (reconciled fields, cards, skipped sources, page text) plus the web-research facts with their quotes and the summary itself, names the source of each claim in brackets, keeps research labels (company claims said as such, estimates named, founders not called directors), gives both values where sources disagree, and says plainly when the data does not answer (and which source would). Figures not found in that data are listed in amber (`checkFigures`). Usage is logged as `bip_ask`; the ask route is behind `aiLimiter`.

Nothing is stored until **Save**: the pending answer has Save and Discard. Saved Q&As (table `bip_qa`: question, answer, model, `unverifiedFigures`, `createdAt`; cascade with the profile) are listed newest first, each with **Delete** (asks first; deleted for good). Deleting the profile puts its saved Q&As in the recycle bin with it, and a restore brings them back.

## Cache, refresh and storage

- **30-day cache.** A profile is saved with the day it was checked. Opening `/bip/:id` shows the saved cards and the source rows, not a fresh set of calls. **Re-scan** re-runs every module and replaces the run; the refresh icon on a card re-runs just that module, then rebuilds reconciliation and cards from the current set of rows. Each refresh records its own checked-at time.
- **Postgres JSONB.** One `bip_profiles` row per person holds the seed, the per-module results **including raw source rows**, the reconciliation (values, confidence, decisions) and the built cards. All reads filter by `"userId"`; another person's id answers 404. The `pg` driver returns JSONB already parsed — use `typeof v === 'string' ? JSON.parse(v) : v`, never a blind `JSON.parse` (`CLAUDE.md`).
- **No retention limit.** Profiles stay until the person deletes them; there is no purge cron and no 30-day expiry on the profile itself. Deleting uses the shared **recycle bin** (`moveToBin` in the same transaction, with a BIP adapter), so a deleted profile can be restored from Settings → Recycle bin for 30 days and is gone for good after that (`docs/recycle-bin.md`).
- **PDF export.** `GET /profiles/:id/pdf` renders the same card text server-side with the standard PDF font set, so the download cannot drift from the page.

## Config keys

Server-side environment variables; empty in `.env.example`, never returned by `GET /config` (it answers booleans only). Without a key the affected module is `skipped` with a reason and the rest of the profile still runs.

| Key | Used for |
| --- | --- |
| `ABR_GUID` | ABR ABN Lookup GUID (`abr.business.gov.au/WebServices.aspx`) for the exact entity/ABN module |
| `GOOGLE_PLACES_API_KEY` | Google Places (New) Text Search for address, phone, website and rating |
| `GOOGLE_SEARCH_API_KEY` | Google Custom Search JSON API key — with the CX below, the top-10 mentions |
| `GOOGLE_SEARCH_CX` | Programmable Search Engine id for that Custom Search key |

ASIC needs no key and stays a manual link. RDAP/WHOIS, DNS, the website scrape, the Domain overview, social links, the review-site pages and tech-stack detection need none of the four.

## API

Mounted at `/api/bip` behind `requireFeature('bip')`; `bip` is in **preview**, so admins can open it while it is off for members. Every read and write is scoped to the signed-in person.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/config` | Which keyed modules are connected (`abr`, `places`, `googleSearch`, `asic: false`); never the key values |
| `GET` | `/profiles` | Saved profiles for this person, with checked-at times |
| `POST` | `/profiles` | `{ domain, force? }` — a 30-day cache hit answers `200 { profile, cached: true }`; otherwise saves a `running` row and answers `202 { jobId, profileId, domain, cached: false }` |
| `GET` | `/profiles/:id` | One saved profile: seed, source rows, reconciliation, cards, decisions |
| `POST` | `/profiles/:id/rescan` | `{ modules?: string[] }` — re-run everything, or only the named modules (seed modules run first, then enrichment). Answers `202 { jobId, ... }` |
| `PATCH` | `/profiles/:id` | `{ decisions }` — record the person's choices for reconciled fields; the original values are unchanged |
| `GET` | `/profiles/:id/pdf` | PDF download of the cards |
| `DELETE` | `/profiles/:id` | Delete into the shared recycle bin |
| `GET` | `/profiles/:id/notes` | Notes that link to this profile (text contains `](/bip/:id)`), newest first, at most 20 |
| `PUT` | `/profiles/:id/client` | `{ clientId }` (one of the person's clients, else 400) or `{ clientId: null }` to unlink |
| `GET` | `/linked?clientId=` | The profiles filed under that client, for the client page's Business profiles tab |
| `POST` | `/profiles/:id/ask` | `{ question }` — answer from the saved profile (`aiLimiter`); returns `{ question, answer, model, unverifiedFigures }`, stores nothing |
| `GET` | `/profiles/:id/qa` | Saved questions and answers, newest first |
| `POST` | `/profiles/:id/qa` | `{ question, answer, model, unverifiedFigures }` — save one |
| `DELETE` | `/profiles/:id/qa/:qaId` | Delete one saved Q&A |
| `POST` | `/profiles/:id/summary` | Write the summary again (`aiLimiter`) |
| `GET` | `/jobs/:jobId` | Current status, progress and result of a background run; the page polls every 2.5s |

Named routes stay before `/profiles/:id` in the route file.

## Notes and clients (links both ways)

The **Notes & client** box under the cards on a saved profile (`client/src/pages/bip/BipLinks.jsx`; the Save to Note / Client button at the top scrolls to it). The text it writes comes from `client/src/pages/bip/bipNote.mjs` (test: `node client/src/pages/bip/bipNote.test.mjs`).

- **Save to Note** makes a new note through the existing `POST /api/notes`: title (default the business name), an optional project, and the profile's client when it has one. The body starts `From Business Profiler: [Name](/bip/:id)`, then the facts found (website, ABN, entity type, address, phone, Google rating, people, description); a recorded conflict decision wins over the first value and "Not found" is left out. **Back link:** the box lists the notes whose text holds that link (`GET /profiles/:id/notes`, the same text-match approach as Drawings), so a note made by hand with the link counts too, and a deleted note or a removed link stops counting.
- **Client.** *Create client from profile* calls the existing `POST /api/clients` (name and company = business name, type company, status Prospect, notes = the profile link plus website, ABN, address and phone; no email domains, so no Gmail sync starts), then `PUT /profiles/:id/client`. Or pick an existing client and press Link. `bip_profiles."clientId"` (FK to `clients`, `ON DELETE SET NULL`) holds the link; the client's page shows a **Business profiles** tab (`client/src/components/LinkedBusinessProfiles.jsx`, hidden when the `bip` flag is off for that person). Notes saved after linking get the client's `client_id`. Unlink clears the column only. A restored profile keeps its client link only if that client still exists. Long runs follow Vault's background-job pattern (save a `running` row, answer at once with a `jobId`, let the page poll) rather than hold a request open past the gateway timeout, as in `docs/ai-visibility.md`. The registry is in memory, so a server restart loses the progress ticker but not the saved profile.

## Help and UI

**Layout (2026-11-23), like Video Tools.** The shared `ToolSidebar` on the left (search, groups that open and close, a hint "Open a profile first" on tools that need one) with three groups: **Profile** (Profile a domain, Saved profiles), **Report** (Profile cards, Confidence & conflicts, Re-scan & sources) and **Keep & share** (Download PDF, Save to Note & Client). The page opens on **What do you want to do?**: `JobStart` tiles from `client/src/pages/bip/bipGoals.mjs` (check out a business, prepare for a meeting, add to the CRM, bring a profile up to date, share a profile; test `node client/src/pages/bip/bipGoals.test.mjs`) and tiles for the six most recent profiles. A job opens its tools one step at a time with `JobBar`; making or opening a profile moves the job to its next step. "Next time, open on the tool I used last" is remembered in `localStorage` (`vault:bip:openOnLast`, `vault:bip:lastTool`). `/bip/:id` opens that profile on Profile cards; the Report and Keep & share tools show the open profile's name, domain, client and Delete above them. Re-scan & sources lists each source's status with its own Refresh. The tour switches tools as it goes (`startBipTour(goTool)`); the guide's Open buttons switch tools. Tool ids, groups and labels live in `bipTools.mjs` and must match the guide catalogue (`node server/services/bipTutor.test.js`).

Per `client/DESIGN.md` and the Video Tools convention: one `Tooltip` on every control, an (i) "how it works" box, a compass tour, a **Business Profiler guide** chat (`TutorChat`, registered in `server/config/guides.js`, `npm run test:guides`), and `VoiceInput` on the domain field. A background run shows an inline progress panel with the current module and elapsed seconds; all calls go through `apiClient` and icons through `getIcon`. An empty list or card says so in plain text. A conflict is shown in the page's warning colour (`#f59e0b`), never as a green success. The page is added to `client/src/config/appNavigation.js` under **Web & SEO** (not in Layout); `npm run test:nav` catches drift.

## Files and tests

- Service modules (pure where possible, stubbed dependencies for everything else): `server/services/bip/` — `normalise.js`, `http.js`, `rdap.js`, `whoisFallback.js`, `dns.js`, `website.js`, `techStack.js`, `sources.js`, `reconcile.js`, `cards.js`, `store.js`, `run.js`, `jobs.js`, `pdf.js`.
- Route/table/page: `server/routes/bip.js`, `server/routes/bipTutor.js`, `bip_profiles` and `bip_sources` in `server/db.js` (idempotent DDL), the recycle-bin adapter `server/services/recycleBin/adapters/bip.js`, `client/src/pages/BipPage.jsx`; flag `bip` in **both** `server/config/featureAccess.js` and `client/src/utils/featureAccess.js` with `FEATURE_LIFECYCLE = 'preview'`.
- Run the tests with `node --test server/services/bip/bip.test.js server/services/bipTutor.test.js` (no `package.json` test script — `CLAUDE.md` rule 1). They stub `fetch`, `fetchPublicFile`, `query`, `fetchHtml` and the DNS/provider dependencies, so no network, DNS or port-43 call is made. They cover domain normalisation and ABN formatting; RDAP parse and redaction fallback; WHOIS line parsing; website extraction; tech-stack evidence strings; keyed-module skips; reconciliation marks and "decision kept, conflict still shown"; and the SalesLogs case study.
- With no keys set locally: start a profile for `saleslogs.com` and confirm the keyed modules show their `skipped` reasons while Stage 1 and the saved profile still work. With keys set: check the ABR entity/ABN, the Places row, the top-10 result list (title/snippet/URL/date), Re-scan, one per-module Refresh, a recorded decision, the PDF download, and delete → restore from Settings → Recycle bin.
- `node server/config/featureAccess.test.js` (client/server flag parity and preview lifecycle), `npm run test:nav`, and `node server/routes/crossUserOwnership.test.js` after adding BIP's routes to `server/testing/routeManifest.json` — a new route fails `crossUser.test.js` until it is classified (`docs/hardening.md`). Add a guide entry and run `npm run test:guides` if the guide ships with the page.
