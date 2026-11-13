# AI Visibility

`/ai-visibility` · nav: **Web & SEO → AI Visibility** · flag `aiVisibility` (default off, lifecycle **preview**) · table `ai_visibility_audits`

An audit of one public page for the way AI assistants find, read and quote it. It is deliberately **not** a Google rankings tool: SEO is `/seo`, speed is `/html`, Search Console query data is `/search-console`. This tool answers a narrower question — *when someone asks an AI assistant about this business, can the assistant reach the page, read the offer without JavaScript, understand the entity, and cite it?*

## What a run does

1. **Fetches the page** with the shared SSRF-safe `htmlFetch` (no JavaScript, as an AI crawler that does not run scripts sees it). If the host drops the first connection (a bare `socket hang up`), the audit retries twice with plain identities (no header, then an ordinary browser; never Googlebot, which would read what a site serves Google) and then says plainly that the site closed the connection.
2. **Fetches `/robots.txt`** from the same origin and parses it properly.
3. **Renders the page in Chromium** (Playwright) and compares the readable content with the raw HTML.
4. **Extracts and validates JSON-LD** entities.
5. **Generates or accepts buyer questions**, then for each one: a ranking search (top 10) and the question put to each ticked **real AI assistant**, which searches the web itself. Named / used-as-source verdicts per assistant, and key facts checked against the assistants' answers.
6. **Scores**, writes suggestions, and saves the report.

**Runs in the background (since 2026-11-13).** A run takes one to four minutes, longer than the gateway keeps a request open, so `POST /audits` validates the address and model, saves a row with `status='running'` and answers 202 at once. The work continues in the server process and writes the current step to `progress`; the page polls `GET /audits/:id` every 3 seconds and shows it. On success the row becomes `done`; on an error `failed` with `error` and a **Run again** button (the inputs are saved in `report.input`). One running audit per person (409 otherwise). A run cannot survive a restart: rows still `running` at boot are marked failed in `db.js`, and a row not updated for 20 minutes is shown as failed. Railway log lines: `[ai-visibility] audit <id> done in <n>s` / `failed after <n>s`.

Questions run one after another; within a question the search and the assistants run in parallel (different providers, separate rate limits).

## robots.txt

The parser follows the grouping rules rather than searching for strings:

- consecutive `User-agent` lines share the rules that follow them;
- a crawler uses the groups that name it, and only falls back to `*` when no group names it;
- the **longest matching** `Allow`/`Disallow` path wins, and `Allow` wins a tie;
- `Disallow:` with no path means no restriction, not "block everything";
- `*` wildcards and a trailing `$` anchor are supported.

The checked crawlers (`AI_BOTS` in `robots.js`) are GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-Web, anthropic-ai, PerplexityBot, Perplexity-User, Google-Extended, Applebot-Extended, CCBot, Bingbot, Bytespider and meta-externalagent. Each row in the report names the exact rule that decides it. A missing robots.txt is treated as "everything allowed", which is the crawler's default.

Two facts the report states explicitly because they are commonly confused:

- **Google-Extended does not control Google Search.** It controls Gemini/Vertex AI training use. Blocking it does not remove a page from Google results.
- **GPTBot is the training crawler.** `OAI-SearchBot` builds the index ChatGPT search answers from, and `ChatGPT-User` fetches a page when someone asks ChatGPT to open it. Blocking one does not necessarily block the others.

## Readability without JavaScript

The raw HTML's visible text is counted (words and `h1`–`h3`) and compared with the same page rendered in Chromium. The ratio is the share of the rendered page that exists without JavaScript:

| Ratio | Meaning |
| --- | --- |
| ≥ 85% | readable without JavaScript |
| 60–84% | mostly readable; move the remaining offer/prices/specs into the initial HTML |
| < 60% | JavaScript-dependent; a non-rendering crawler sees little or none of the offer |

If Chromium is unavailable the area is **not measured** (and left out of the overall score) rather than scored zero. The renderer (`render.js`) reuses the safety approach of `brandFromUrl`: every request is paused and checked with `checkSsrf`, only ports 80/443, no frames, media, downloads, popups or service workers. Chromium resolves names itself after the check, so a hostile DNS server that answers differently a second time is not fully covered — the same accepted trade-off as `brandFromUrl`.

## Structured data

`schema.js` extracts every `application/ld+json` block, flattens `@graph` and nested entities, and checks each entity on its own. Rules exist for Organization, LocalBusiness (and common subtypes such as Store, Restaurant, LiquorStore, ProfessionalService), Product, Offer, FAQPage, Article, BreadcrumbList, WebSite and Service.

Required properties are checked directly on the entity (so an Organization with `name` and `url` passes). Recommended properties may be nested (a Product's `offers.price`). A Product additionally needs an offer, a review or an aggregate rating — a product page with none of those has nothing an answer engine can quote.

A half-filled block is treated as worse than none, because it teaches the model the wrong thing; each missing required property produces its own finding.

## Buyer questions, search ranking and real AI assistants (report version 2)

If no questions are supplied, four are generated from the page title, description and headings by the chosen text model. If the model is unavailable, plain template questions are used (the subject is the part of the title that describes the offer, so "Curam-Ai Protocol | Systematised AI…" gives "systematised ai… in Australia", not "best Curam"), and the report flags them and suggests writing real ones.

For each question:

1. **Search ranking** — one search with the existing key (`SEARCH_API_KEY`, Brave/Serper/SerpAPI), top 10. Ranking score: #1 100, top 3 85, top 5 70, top 10 50, not found 0. A subdomain of the site counts. Provider errors are detected in each provider's own shape (Brave's `{type:"ErrorResponse", error:{detail}}`, Serper's `message`, SerpAPI's `error`, any HTTP 4xx/5xx) by `providerError()` in `searchClient.js`; a failed search leaves ranking **unmeasured** and adds a Setup suggestion with the provider's message. (Before this fix an invalid key or used-up quota read as "zero results" and the audit reported the site as not found. The chat `@search` route had the same bug and now uses the same check.)
2. **Real AI assistants** (`assistants.js`), each searching the web itself:
   - **Claude** — Anthropic web search tool (`web_search_20250305`, up to 3 searches, user location AU). Model: the workspace default if it is an Anthropic model, else the first Anthropic model in `vault_models`. Sources: the answer's citations first, then the search results it saw.
   - **Gemini** — grounded with Google Search (`tools: [{ googleSearch: {} }]`). Model: the `gemini` tier. Its sources are Google redirect addresses whose title is the source domain, so the site is matched by that title.
   - **Perplexity** — Sonar API, only when `PERPLEXITY_API_KEY` is set (environment or Settings). Model: setting `ai_visibility_perplexity_model`, default `sonar` (not in `vault_models`, so it is a setting rather than a hardcoded choice). **Never run against the real API yet.**

   The new-audit screen shows each as a tick box (`GET /assistants`), greyed out with the reason when not connected. Per assistant: **named** (the brand, the brand without a legal suffix, its first two words, or the domain label, matched as whole words with a space, hyphen or nothing between them, so "Curam AI", "Curam-AI" and "CuramAI" all count and a page name such as "Home" never does) and **used the site as a source** (a site page among its sources or linked in its answer). 50 points each. An assistant that errors or times out (120 s) is recorded and **left out** of the score.

Answers vary between runs, accounts and locations; the report says this is a sample, not a guarantee.

Version 1 reports (before 2026-11-13) had the configured model "answer" from the top five search results only, so being named depended almost entirely on ranking in those five. They still open and render as before, labelled as the earlier version.

### Key facts

The optional key-fact list is checked against each assistant's answer only (never against other sites' search snippets). Matching is a **documented heuristic, not entailment**: every number must be present with a compatible unit, and at least 60% of the distinctive words must appear. Units are compared as families (`°C`/celsius, `A`/amp, `weeks`/wk, `%`/percent, …), and a range needs both ends. It is designed to catch "0.5 amps" for "0.5°C" and "6 months" for "6 weeks", not to prove meaning. The report says so.

## Scores

| Area | Weight | Source |
| --- | --- | --- |
| Technical access | 20 | HTTP status, indexability (robots meta / X-Robots-Tag), title, description, language, blocked AI crawlers |
| No-JavaScript readability | 15 | raw-vs-rendered word ratio |
| Structured data | 15 | JSON-LD entity completeness |
| Search ranking | 15 | average ranking score over questions whose search worked |
| Named by AI assistants | 25 | average named/source score over every assistant answer that came back |
| Key-fact accuracy | 10 | average share of supplied facts present per assistant answer |

An area that could not be measured (no browser, failed search, no assistant answered, no facts) is **left out and the remaining weights are rescaled**; a null is never averaged in as zero. A missing measurement is not a failure, and the report lists which areas were measured.

Suggestions are ordered fail → improve → consider and each has a concrete "what to do".

## Output

- **On-page report** — scores, suggestions, robots table, readability comparison, schema table and findings, each question with its search ranking and one box per assistant (verdicts, facts, answer and sources).
- **Copy for AI** — the full report as Markdown (the same text the PDF renders, so they cannot drift).
- **Download PDF** — rendered server-side with `pdf-lib`, standard fonts only.

## Guide chat

The round **AI Visibility guide** sits at the bottom right of `/ai-visibility` (`guideId` `ai-visibility`, `POST /api/ai-visibility-tutor`, flag `aiVisibility`, `aiLimiter`). It points at the page's real parts in order, or says plainly that something is not built: the start screen (New audit, Page URL, Name and Brand, AI assistants to ask, Model, Buyer questions, Key facts, Run audit) and a saved report (scores and their six areas, Suggestions, Technical access and the AI-crawler table, Readability without JavaScript, Structured data, Buyer questions and AI assistants with the assistant checks, Key facts, Copy for AI, Download PDF). It sees no address, score or report, and it says an audit is a snapshot that cannot control what an AI assistant says. The shared tool list is `client/src/pages/aiVisibility/aiVisibilityTools.mjs`; `node server/services/aiVisibilityTutor.test.js` (with `guideTestKit.js`) fails if the guide and the page drift apart. See `docs/guide-chat.md`.

## API

Mounted at `/api/ai-visibility` with `requireFeature('aiVisibility')`. `aiLimiter` sits on the `POST` only, so listing and downloading do not consume the AI budget. The guide chat is mounted separately at `/api/ai-visibility-tutor` behind the same flag and `aiLimiter`; it sees no address, score or report.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/assistants` | which assistants this person can ask, with model and the reason when unavailable |
| `GET` | `/audits` | saved runs for the signed-in person (with `status`) |
| `POST` | `/audits` | start an audit in the background (`url`, optional `name`, `brand`, `queries`, `facts`, `modelId`, `assistants` ids); 202 with the running row, 409 with `auditId` if one is already running |
| `GET` | `/audits/:id` | one saved report, or its `status` / `progress` / `error` while running or after a failure |
| `DELETE` | `/audits/:id` | delete a run |
| `GET` | `/audits/:id/markdown` | `{ markdown }` for Copy for AI |
| `GET` | `/audits/:id/pdf` | PDF download |

## Setup

- For the assistants: an Anthropic model in `vault_models` plus `ANTHROPIC_API_KEY` (Claude), a Gemini model plus `GEMINI_API_KEY` (Gemini), and optionally `PERPLEXITY_API_KEY` (Perplexity). Any one is enough; none means only search ranking is checked.
- A connected **text** model writes the questions when none are supplied; without one, template questions are used.
- `SEARCH_API_KEY` (Brave, Serper or SerpAPI), in the environment or Settings. Without it (or when it is invalid or out of credit), search ranking is unmeasured and the report says why.
- Chromium/Playwright (already installed in the Docker image). Without it, readability is unmeasured.

**Cost per audit** (four questions, all three assistants): 4 searches on the search key, plus per question one Claude call with up to 3 web searches (Anthropic bills web searches per search on top of tokens), one grounded Gemini call and one Perplexity call. A few cents to tens of cents depending on models; untick assistants to spend less.

## Files and tests

- `server/services/aiVisibility/robots.js`, `schema.js`, `facts.js`, `searchClient.js`, `render.js`, `assistants.js`, `queryAnalysis.js`, `scoring.js`, `markdown.js`, `pdf.js`, `aiVisibilityService.js`
- Table columns `status`, `progress`, `error` added in `server/db.js` (2026-11-13)
- `server/routes/aiVisibility.js`; mounted in `server/index.js`
- `server/services/aiVisibilityTutor.js`, `server/routes/aiVisibilityTutor.js` (the guide chat)
- `client/src/pages/AiVisibilityPage.jsx`; guide wrapper `client/src/pages/aiVisibility/AiVisibilityTutorChat.jsx` and shared list `client/src/pages/aiVisibility/aiVisibilityTools.mjs`
- `server/services/aiVisibility/aiVisibility.test.js` — `npm run test:ai-visibility` (pure modules only: no network, browser or database)
- `server/services/aiVisibilityTutor.test.js` — `npm run test:ai-visibility-tutor` (guide catalogue vs page, with `guideTestKit.js`)
