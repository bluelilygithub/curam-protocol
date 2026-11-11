# AI Visibility

`/ai-visibility` · nav: **Web & SEO → AI Visibility** · flag `aiVisibility` (default off, lifecycle **preview**) · table `ai_visibility_audits`

An audit of one public page for the way AI assistants find, read and quote it. It is deliberately **not** a Google rankings tool: SEO is `/seo`, speed is `/html`, Search Console query data is `/search-console`. This tool answers a narrower question — *when someone asks an AI assistant about this business, can the assistant reach the page, read the offer without JavaScript, understand the entity, and cite it?*

## What a run does

1. **Fetches the page** with the shared SSRF-safe `htmlFetch` (no JavaScript, as an AI crawler that does not run scripts sees it).
2. **Fetches `/robots.txt`** from the same origin and parses it properly.
3. **Renders the page in Chromium** (Playwright) and compares the readable content with the raw HTML.
4. **Extracts and validates JSON-LD** entities.
5. **Generates or accepts buyer questions**, then for each one: real web search → a model answer grounded in those results → citation checks and key-fact checks.
6. **Scores**, writes suggestions, and saves the report.

A run is sequential on purpose: search providers and models rate-limit, and this is a single deliberate audit, not a bulk job. Expect roughly 10–60 seconds plus one model call per question.

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

## Simulated questions

If no questions are supplied, four are generated from the page title, description and headings by the chosen text model. If the model is unavailable, a template fallback still produces usable queries, so an audit never fails just because query generation did.

For each question:

1. **Search** — the existing search key (`SEARCH_API_KEY`, Brave/Serper/SerpAPI) returns up to five results. `DISABLE_WEB_SEARCH` wins, and a missing key is recorded on the query rather than failing the run.
2. **Answer** — the configured text model answers from those results only, citing full URLs. Search results are labelled untrusted data in the prompt.
3. **Three separate verdicts**:
   - **found in search** — the site's host appears in the search results, and at what position;
   - **named in the answer** — the brand or domain appears in the answer text;
   - **linked in the answer** — a URL on the site's host is cited.

   These are kept separate because they are different failures. A site can rank and still not be named; it can be named without a link. The query's citation score is 40 for appearing in search (+20 at #1, +15 in the top 3, +8 in the top 10), +30 for being named, +30 for being linked.

### Key facts

The optional key-fact list is checked against each answer (and the search snippets). Matching is a **documented heuristic, not entailment**: every number must be present with a compatible unit, and at least 60% of the distinctive words must appear. Units are compared as families (`°C`/celsius, `A`/amp, `weeks`/wk, `%`/percent, …), and a range needs both ends. It is designed to catch "0.5 amps" for "0.5°C" and "6 months" for "6 weeks", not to prove meaning. The report says so.

## Scores

| Area | Weight | Source |
| --- | --- | --- |
| Technical access | 25 | HTTP status, indexability (robots meta / X-Robots-Tag), title, description, language, blocked AI crawlers |
| No-JavaScript readability | 15 | raw-vs-rendered word ratio |
| Structured data | 20 | JSON-LD entity completeness |
| Citation in answers | 25 | average query citation score |
| Key-fact accuracy | 15 | average share of supplied facts present |

An area that could not be measured (no browser, no search key, no facts) is **left out and the remaining weights are rescaled**. A missing measurement is not a failure, and the report lists which areas were measured.

Suggestions are ordered fail → improve → consider and each has a concrete "what to do".

## Output

- **On-page report** — scores, suggestions, robots table, readability comparison, schema table and findings, each question with its three verdicts, answer, facts and the results given to the model.
- **Copy for AI** — the full report as Markdown (the same text the PDF renders, so they cannot drift).
- **Download PDF** — rendered server-side with `pdf-lib`, standard fonts only.

## API

Mounted at `/api/ai-visibility` with `requireFeature('aiVisibility')`. `aiLimiter` sits on the `POST` only, so listing and downloading do not consume the AI budget.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/audits` | saved runs for the signed-in person |
| `POST` | `/audits` | run an audit (`url`, optional `name`, `brand`, `queries`, `facts`, `modelId`) |
| `GET` | `/audits/:id` | one saved report |
| `DELETE` | `/audits/:id` | delete a run |
| `GET` | `/audits/:id/markdown` | `{ markdown }` for Copy for AI |
| `GET` | `/audits/:id/pdf` | PDF download |

## Setup

- A connected **text** model (Anthropic, Gemini, DeepSeek or Ollama in `vault_models`). Without one, the technical checks still run and the questions are recorded as unanswered.
- `SEARCH_API_KEY` (Brave, Serper or SerpAPI), in the environment or Settings. Without it, discovery checks are recorded as unavailable.
- Chromium/Playwright (already installed in the Docker image). Without it, readability is unmeasured.

## Files and tests

- `server/services/aiVisibility/robots.js`, `schema.js`, `facts.js`, `searchClient.js`, `render.js`, `queryAnalysis.js`, `scoring.js`, `markdown.js`, `pdf.js`, `aiVisibilityService.js`
- `server/routes/aiVisibility.js`; mounted in `server/index.js`
- `client/src/pages/AiVisibilityPage.jsx`
- `server/services/aiVisibility/aiVisibility.test.js` — `npm run test:ai-visibility` (pure modules only: no network, browser or database)
