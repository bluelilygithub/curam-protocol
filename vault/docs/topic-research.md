# Topic Research

Find what is being written about a topic, so the owner can write their own piece. It lists existing coverage (and, in later milestones, ranks it and turns it into a research brief). It can turn a brief into a first draft for the owner to edit. It never publishes anything, and never rewrites anyone else's article. Page: `/topic-research` (flag `topicResearch`, Research & Utilities, **off by default** until the last milestone; admins always get in).

Built from the owner's spec ("Topic Research App — Build Spec", 25 Oct 2026) as a **native Vault tool**, not the Python/FastAPI app the spec describes. Built one milestone at a time, with a plan agreed before each.

## How to use it

1. **Switch it on.** It starts off for members. Admins always see it; to give a member access use Settings -> Feature Access (`topicResearch`).
2. **Choose the AI model** in Vault's main Settings -> **Topic Research**: pick any connected model, or leave it on "Use default model" (the workspace default). It is used only to write briefs. No model id is written in the code.
3. **Set up** (Topic Research -> Settings): add RSS feeds, say what your site is about, and set a monthly spending limit.
4. **Search** a topic on the Topics tab. Open it to see stories ranked best first.
5. **Watch** a topic (tick Watch, choose how often) and it refreshes itself in the background.
6. **Write a brief**: tick up to 12 articles, press Generate brief, then write your own piece from the notes.
4a. **Suggest industry terms** (optional, under the topic box): the AI model offers up to three other ways to word the topic as the trade would; tick the ones to search as well.
4b. While anything runs, a box shows the real steps; a bar above each page shows where you are (Search, Choose sources, Brief, Draft).
7. **Draft article** (optional): on a brief, choose a length and press Draft article for a first draft built from that brief. Edit and fact-check it elsewhere.
8. **History** lists every past search, brief and draft; open one to read it again.
8. Help: the (i) box, the compass tour (also Settings -> Tours) and the round guide button.

## Status

| Milestone | What | State |
|---|---|---|
| 1. Skeleton and RSS | tables, settings, RSS source, Results page | built, awaiting review |
| 2. More sources | Hacker News, GDELT, Brave, Serper (SERP), Reddit, 24 h cache; Google Trends not built | built, awaiting review |
| 3. Extraction, clustering, scoring | article text, stories, score + breakdown, Original badge, topic heat, Settings weights | built, awaiting review |
| 4. Briefs | research brief from ticked articles, strict checks, Brief page, Markdown, 12-word overlap check | built, awaiting review (ran on Railway with a real model, 26 Oct 2026) |
| 5. Watchlist and polish | model setting, scheduled refresh, history, monthly budget stop, 30-day purge, guide chat, tour, (i) box | built, awaiting review |
| 6. Draft from a brief | first draft from one brief only, source numbers, gap markers, copy check, bin, budget | built, awaiting review (**not yet run against a real model**) |
| 8. See what was asked, and ask better | the search words and unused sources shown, the exact prompt of every AI call shown, a premise note on question-type topics, Serper via the key Vault already has | built, awaiting review (**the note and the prompts not yet seen with a real model**) |
| 7. Right sources first, and visible progress | real progress steps + where-you-are bar, shop-page detection, topic-match score, source check before a brief, industry-term suggestions with multi-phrase search, thin-brief warning | built, awaiting review (**suggestions and the source check not yet run against a real model**) |

## Spec to Vault translations

| Spec | Vault |
|---|---|
| FastAPI + Jinja + HTMX | Express routes + React page in the Vault theme |
| SQLite + SQLModel | Postgres, raw SQL in `server/db.js` (tables `topic_research_*`, every row has `"userId"`) |
| `.env` Anthropic key and `CLAUDE_MODEL` | `getModelsForUser` + `callModel` (model ids come from Settings, never hardcoded) |
| `APP_PASSWORD` | Vault's own login |
| APScheduler | node-cron (M5) |
| trafilatura | `webExtractorService.extractArticle` (M3) |
| scikit-learn TF-IDF | hand-written TF-IDF and cosine similarity (M3) |
| pytest + respx | plain `node` test scripts with injected fetchers and an in-memory pool |

## Milestone 1

**What it does.** Settings holds the site profile and a list of RSS feed addresses (one per line, up to 50). Searching a topic reads every feed and keeps items that mention **every word** of the topic (matched at the start of a word, so "pump" finds "pumps") and are not older than 30 days (undated items are kept). Results are de-duplicated by normalised address (tracking parameters such as `utm_*`, `fbclid`, `gclid` stripped, trailing slash, fragment and default port dropped) and listed newest first. Searching the same words again reuses the saved topic. One bad feed is listed on the Results page and the rest still count; a search with no feeds says so.

**Safety.** Feed addresses are typed by the person, so each is downloaded through `server/utils/safeFetch.js` (`fetchPublicFile`: public addresses only, DNS pinned, redirects re-checked, 5 MB cap) and parsed from text. `rss-parser`'s own URL download is never used because it skips that check. The page text of articles is not fetched in M1.

**Files.** `server/routes/topicResearchRouter.js` (injectable pool; `topicResearch.js` mounts it at `/api/topic-research`), `server/services/topicResearch/` (`urlNormalise.js`, `matchTopic.js`, `settings.js`, `collect.js`, `sources/base.js`, `sources/rss.js`), `server/services/recycleBin/adapters/topicResearch.js`, `client/src/pages/TopicResearchPage.jsx` + `client/src/pages/topicResearch/`.

**API** (all behind `requireFeature('topicResearch')`, 60 requests a minute per person): `GET/PUT /settings`, `GET/POST /topics`, `GET /topics/:id`, `POST /topics/:id/run`, `DELETE /topics/:id`, `GET /runs/:id`.

**Data.** `topic_research_topics` (one per person per keyword, case-insensitive), `topic_research_runs` (status `ok` / `partial` / `failed`, per-source errors as JSON), `topic_research_articles` (one per person per normalised URL; `extractedText` is for M3 and is never sent to the browser), `topic_research_run_articles` (which run saw which article; score and cluster columns wait for M3). Settings are one JSON value in the `settings` table, key `topic_research_settings`. Deleting a topic moves it, its runs and links to the shared recycle bin (30 days, Undo toast); the articles stay.

**Adding a source.** Write `{ name, async search(keyword, since) -> { items, errors, answered? } }` (see `sources/base.js`), and return it from `buildSources` in the router. `answered` is how many of the source's upstreams replied, so "nothing matched" is not mistaken for "nothing worked".

**Tests.** `npm run test:topic-research` (no database, no network). The SQL is exercised by booting against a real database (`crossUser*.test.js`) and by hand.

## Milestone 2: more sources

Every source is an adapter (`server/services/topicResearch/sources/`, contract in `base.js`: `search(keyword, since, ctx) -> { items, errors, answered?, extras?, costUsd? }`). `sources/index.js` builds the list for one search from the person's settings and the server's keys and says, for each source that is off, exactly why; Settings -> Topic Research shows that list (`GET /api/topic-research/sources`). A source that fails never stops a run: it is listed on the Results page and the others still count. After a run the Results page shows what each source found ("Hacker News 6 · GDELT news 30 (saved from earlier)"), each article's numbers, which sources saw it, and any People-also-ask / related searches.

| Source | Key | State | Notes |
|---|---|---|---|
| RSS feeds | none | live | M1. Typed addresses go through `safeFetch`. |
| Hacker News | none | **live, verified** | Algolia search, stories that link to an article, points and comments. |
| GDELT news | none | built, **not verified live** | Free news index. Answered HTTP 429 on every live call from the development machine (also from another network). One request per 5 s server wide, and after a 429 it is left alone for a minute (it is slow, about 12 s, to say no). Field names (`url, title, seendate, domain`) confirmed only from third-party clients; `seendate` looks like `20261025T053000Z`. |
| Brave Search | the workspace `SEARCH_API_KEY`, when it is a Brave key | built, **not verified live** | Stands in for Google results until a provider is chosen. Each result's position = search rank. The key in the development `.env` was rejected by Brave (`422 SUBSCRIPTION_TOKEN_INVALID`; Brave uses 422 for a bad key), so no live success was seen. No People-also-ask. |
| Google results (Serper) | `SERP_API_KEY` + `SERP_PROVIDER=serper` (or the provider chosen in Settings), or a workspace `SEARCH_API_KEY` that is a Serper key | built, **off, mocks only** | Position, Top stories, People also ask, related searches. Written from Serper's documented key names; the Top stories key name is unconfirmed. SerpAPI and DataForSEO are not built. |
| Reddit | `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` (+ `REDDIT_USER_AGENT`) | built, **off, mocks only** | Reddit now approves access before issuing keys: apply to Reddit first. App-only OAuth; posts that link to an article; score and comments. No scraping of reddit.com. |
| Google Trends | | **not built** | `pytrends` was archived in April 2025, the unofficial Node packages are throttled, and Google's official API is invite only. Topic heat in M3 will use cluster count and engagement only; the trend slot stays empty until a source exists. |
| NewsAPI | | **not built** | The spec's optional alternative to GDELT: no key and no verifiable docs. |

**Cost and cache.** Brave, Serper and GDELT answers are kept for 24 hours per person, per topic (words, region, language, days) in `topic_research_cache`. Typing the same words again may use them; **Search again** always asks afresh (`POST /topics/:id/run` sends `refresh`, `false` to allow saved answers). An answer from nothing is never saved. Cost per run is the sum of `BRAVE_PRICE_PER_QUERY_USD` / `SERP_PRICE_PER_QUERY_USD` for the queries really made (default 0, so the monthly budget stop in M5 does nothing until real prices are set); a saved answer costs 0. The search key is workspace wide, so any member who can use Topic Research spends the admin's Brave/Serper quota.

**Error messages never carry a key.** Keys travel in headers, and `sources/http.js` words every failure itself (source name and what went wrong), never the address, headers or a network detail. `sources.test.js` checks this for each source.

**Data added.** `topic_research_cache`; `topic_research_runs."sourcesJson"` (per source: count, cached, answered, cost, ms) and `"extrasJson"` (People also ask, related searches). Each article's `signalsJson` carries `hn_points, hn_comments, reddit_score, reddit_comments, serp_rank, serp_top_story` and `seenIn` (which sources saw it).

**Env vars** (also in CLAUDE.md): `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`, `SERP_PROVIDER`, `SERP_API_KEY`, `BRAVE_PRICE_PER_QUERY_USD`, `SERP_PRICE_PER_QUERY_USD`. Brave reuses the existing `SEARCH_API_KEY`.

## Milestone 3: reading, stories, ranking

After the sources answer, a search does three more things (`server/services/topicResearch/analyse.js`, called from the router; a fault here never loses the search, it just comes back unranked):

1. **First pass.** Group all articles into stories and score them using headlines and snippets.
2. **Read the best 12 pages** (`extract.js`), obeying robots.txt (`robots.js`): one request every two seconds to a site (longer if its `Crawl-delay` asks, and a site asking for more than 10 s is skipped), four sites at a time, 2 MB and HTML only, the honest agent name `CuramVault`, 25 s for the whole step. A site that says no, cannot be asked, refuses us (401/403/429 even on robots.txt) or errors keeps its snippet and the search moves on; nothing is retried or worked around. A page read in the last week is not fetched again (a refusal or error is not retried for a day). The text comes from the Web Extractor's own `extractArticle`; a page's own publish date fills a missing date. **Page text is stored for analysis and is never sent to the browser.**
3. **Second pass.** Group and score again with the page text, then save each article's story number (1 = the story with the best article), score, breakdown and Original flag, and the weights used and the topic's heat on the run.

**Stories** (`cluster.js`): TF-IDF vectors over headline (x2), snippet and the start of the page text (half weight), cosine similarity at 0.40, and two articles must share two distinctive words; similarity chains. Words in only one article, and words in every article of a set of four or more, are ignored; rarer shared words count for more (squared). A real page carries its site with it, and a live check merged three unrelated ABC stories on a repeated "related stories" box and "Topic:/Posted" lines, so before grouping a paragraph repeated across two or more of one site's articles is dropped, and (with three or more pages from a site) so is any word on 60% or more of them.

**Score** (`score.js`, 0-100): search rank (1.0 at position 1, 0.1 less each place to 0.1 at 10, 0 outside, +0.2 for Top stories, capped at 1), story size (distinct outlets, log scaled), engagement (Hacker News and Reddit points and comments, log scaled), recency (half-life 48 h, editable; undated = 0.3), your outlet weight (0.5 for an unlisted site). Default weights 30/25/20/15/10, editable in Settings. **A signal with nothing to say in this search is left out and the others scaled up** (no Google results source on, no story with two outlets, no numbers, no dates, no outlet weights), and the hover breakdown says so. Weights that do not add to 100% are scaled. The **Original** is the earliest dated article of a story that two or more outlets covered. **Heat** = stories with an article in the last 48 h + log10(1 + engagement), compared with the topic's previous search (20% either way; first search "New"); there is no Trends slope.

**Changing a weight** (Settings -> How results are ranked, or Outlets you trust more or less): the stored scores carry a fingerprint of the settings that made them, so the Results page notices they are out of date and re-ranks by itself (`POST /api/topic-research/runs/:id/rescore`: no fetching, no re-reading; an older search that was never grouped is grouped first).

**Tables/columns added:** `topic_research_source_weights`; `topic_research_articles."extractStatus"` / `"extractedAt"`; `topic_research_run_articles."breakdownJson"`; `topic_research_runs."heatJson"`. **Env:** `TOPIC_RESEARCH_EXTRACT_LIMIT` (default 12), `TOPIC_RESEARCH_EXTRACT_BUDGET_MS` (default 25000).

**What was checked live (2026-10-25, real feeds and real pages):** three topics ("queensland", "police", "storm") over ABC, Guardian, SMH, Brisbane Times, The Conversation and Hacker News.
- Correct: a three-outlet drive-by shooting story; a six-outlet story (an AI model's false police tip); a German robot story (CNN, BBC, CBS); a Dutch server seizure; the Guardian's storm article and ABC's flood warnings as one weather story; unrelated pieces from the same site kept apart.
- **Under-merged:** BBC and Reuters coverage of the same false-tip event came out as a second story, because the headlines use different words ("fake"/"false", "murder"/"homicide"). The grouping knows nothing about synonyms; it errs towards splitting.
- **Bug found and fixed:** Hacker News's typo-tolerant search returned "Story" for "storm"; its results are now checked against the topic words like feed items.
- robots.txt was obeyed: SMH and Brisbane Times refused, so their articles keep their snippet only.
- A search took 23-27 s. The Results page, the hover breakdown and the automatic re-rank after a Settings change were exercised in a real browser.
- **Not verified live:** GDELT (429 / unreachable), Brave (the key in the development `.env` is rejected), Serper and Reddit (no keys). So search rank is empty in practice for now.

**Honest limits.** The threshold (0.40) was tuned on three headline sets written by the same person who wrote the grouping code (`clusterFixtures.js`, with the ambiguous pairs listed as "may merge either way"), then checked by hand on the live runs above: a regression net plus a small real sample, not proof. **Page text is kept indefinitely until M5 adds the 30-day purge the spec asks for.** Only the top 12 pages are read per search, so stories found only further down are grouped on their snippets.

## Milestone 4: the research brief

On Results, every article has a tick box (the best ten start ticked, at most twelve). **Generate brief** (with an optional angle) writes notes to write your own piece from: summary, key facts each with their sources, how outlets framed it, gaps (including unanswered People-also-ask questions), three suggested angles for your site (from Settings -> Your site), an outline for the chosen angle, and keywords. It is not an article and the prompt forbids copying a source.

**The code, not the model, enforces the rules** (`server/services/topicResearch/brief/`):
- `schema.js` checks every answer. A fact keeps only source links that are really among the ticked articles (matched after URL tidying) and is **dropped** if none is left; "single source" is worked out here from how many different outlets back a fact (two articles from one outlet are one outlet), never taken from the model; every list and length is capped; HTML tags and control characters are stripped; unknown fields are ignored. An answer with no summary, no sourced fact, no suggested angle, no outline or no main keyword is refused, and the model is asked once more with the problems named, then it fails.
- `prompt.js`: the articles are untrusted data. Each sits in its own marked block, marker-looking characters inside it are defanged so a page cannot close its own block or add another, and the rules say nothing inside a block is an instruction. Up to 1,500 words of stored page text per article, or headline and snippet only (labelled as such: the model is told not to guess at the rest).
- `overlap.js`: any run of 12 or more words in the brief that also appears in a ticked article's **whole stored text** (not only the part the model saw), snippet or headline is reported with the field, a short excerpt and the matching source, on the Brief page and at the top of the Markdown. Case, punctuation and spacing are ignored; a quote under 12 words passes. It warns and saves; the owner decides.
- `generate.js`: the model chosen in Settings -> Topic Research, else the workspace default (`modelResolver.js`; never a hardcoded id; no model = a plain 503), 6,000 output tokens, 150 s timeout. Errors say what happened and never carry the prompt, article text or the provider's message (that goes to the server log). The tokens of both attempts are logged once (`usage_logs`, feature `topic_research_brief`) with an estimated cost, kept on the brief. Since M5 a brief's cost is **not** added to its search's estimate (it would be counted twice in the monthly total); see Milestone 5.
- `markdown.js`: one writer for **Copy as Markdown** and **Download .md**.

**Routes:** `POST /runs/:id/brief` (one at a time per search, 20 attempts per person per hour, 1-12 articles that must belong to that search and that person), `GET /runs/:id/briefs`, `GET /briefs/:id`, `DELETE /briefs/:id` (recycle bin). **Regenerate with a different angle** makes a new brief from the same articles and keeps the old one. Deleting a topic carries its briefs to the bin and brings them back. Table `topic_research_briefs`.

**What was checked:** unit tests for the validator, prompt, overlap (including a planted 15-word copy), Markdown, the generator against a fake model (invented source, injected instruction, retry, provider fault, no model), and the routes; every important rule was mutation-tested. In a real browser: the tick boxes, the Brief page (warning box, source numbers matching the Sources list), the no-model error, delete then Undo with the list refreshing, Copy and Download. Restoring a brief and a whole topic with its briefs was run against the real database.

**Verified on Railway (26 Oct 2026):** a real brief ran on `deepseek-v4-flash` for under 1 cent. It followed the JSON shape, flagged single-source facts correctly and said plainly that none of its ten sources covered the topic instead of inventing specs. It did not run locally (the development key is rejected). Whether each fact is *supported* by its source is still the owner's check: spot-check three facts before relying on a brief.

**Limits.** "No fact without a ticked source" is enforced, but whether a fact is *supported* by that source is not checked by code, only by you ("check each fact against its sources" is on the page and in the file). The overlap check catches copied runs of words, not close paraphrase of one article's structure. `costCalculator` prices are keyed on older model ids, so the cost shown is an estimate. A brief from one or two articles will mostly restate them (the page says so).

## Milestone 5: watchlist and polish

**Model choice.** Settings -> Topic Research (admin) picks which connected model writes briefs, exactly like Amazon Search's model override. Setting `topic_research_model` (empty = inherit). Resolved by `modelResolver.js`: the person's own choice, else the first admin's, else the workspace `standard` model; a choice no longer in `vault_models` falls back safely and Settings says so. `GET/POST /api/topic-research/model-config`. A unit test fails if a model id is ever written into Topic Research code. The Results page says which model will write the brief. The guide chat follows the workspace model like every other guide.

**Watchlist.** `PATCH /topics/:id { onWatchlist, refreshHours }` (6, 12, 24, 48 or 168 hours). `server/cron/topicResearchCron.js` runs every 15 minutes (only where external jobs are allowed, like the other jobs that call outside services): a watched topic is due when its last search started at least its interval ago, or it was never searched. At most 5 per tick, one at a time, longest-waiting first. A topic being searched right now (by the page or the previous tick) is skipped: the lock is shared (`runSearch.js`, the code the page's Search button also runs). A member who lost the feature is skipped. Scheduled searches use the 24-hour saved answers of the paid sources. A topic whose last three searches all failed raises **one** alert in the Suggestions inbox (fingerprint without a date; a fourth failure does not alert again; a success resets it).

**Monthly spending limit.** Settings -> Topic Research -> Spending this month. Default `MONTHLY_BUDGET_USD` or 20; **0 = no limit**; calendar month, UTC. Spend = search runs' `apiCostEstimate` this month + briefs' `costUsd` this month (`spend.js`). When spend reaches the limit (equal counts): Brave and Serper are **paused** with the reason shown in the Sources box, **new briefs are refused (402)** with a plain message, a banner shows on every tab. Free sources, reading old results and the scheduled refresh of free sources carry on. **Honest limit:** search prices count as 0 until `BRAVE_PRICE_PER_QUERY_USD` / `SERP_PRICE_PER_QUERY_USD` are set, so today only briefs push the total up (the Settings box says so). All amounts are estimates (`costCalculator` is keyed on older model ids).

**History.** `GET /history?q=&type=all|runs|briefs`: past searches (topic, date, status, article count, cost) and briefs (topic, angle, facts, overlap warnings, cost), newest first, latest 100 of each, found by topic words or by a brief's angle. A search opens in Results marked as an earlier search with a link to the latest (`?topic=&run=`); a brief opens on the Brief page.

**30-day clean-up.** `purgeOld` at 03:30 daily (runs everywhere, sends nothing): clears `extractedText` older than 30 days (articles, scores and briefs stay; a page whose text is gone is read again when next needed) and saved search answers older than 7 days. A brief's overlap check compares against stored text, so for an old article whose text was cleared only its headline and snippet remain to compare against.

**Help.** Guide chat (`/api/topic-research-tutor`, `server/services/topicResearchTutor.js`, catalogue matched to `topicResearchTools.mjs` by `npm run test:topic-research-tutor`), compass tour (8 steps, key `vault_tour_topic_research_completed`, `/topic-research?tour=1`, a card under Settings -> Tours), (i) box.

**What was checked:** unit tests for the model resolver (own, admin, stale, none, save), spend (month edges, brief not double counted, limit 0, equal to limit), the due logic (exact interval, cap, order, sequential, skips, failures, alert once), purge, the shared search lock and paid-source pausing; mutation checks on the risky rules. Against the real database with real free sources: a watched topic searched by a cron tick, the next tick skipped it, backdating its last search made a third tick run it; the purge cleared a 31-day-old text and kept a 29-day-old one; a seeded brief above a lowered limit made `/usage` report over, Brave show "Paused", and a brief come back 402. In a real browser: Watch tick and interval, History and an earlier search, the banner appearing after the limit was lowered, the model dropdown saving and the Results page naming the chosen model, the tour and the guide opening, and no sideways scrolling at 380 px wide.

**Not verified:** the guide's actual replies (the local key is rejected), and GDELT, Brave, Serper and Reddit against live responses. The tour's later steps were not stepped through by hand. The flag `topicResearch` is still off by default.

## Milestone 6: draft from a brief

**What it is.** On a brief, **Draft article** (length Short ~400 / Medium ~800 / Long ~1,400 words, plus an optional 200-character note about what to stress) writes a first draft to edit. This reverses the original spec's "never writes an article" rule on purpose, so the guardrails moved rather than went away.

**The rules the code enforces** (`server/services/topicResearch/draft/`):
- `prompt.js`: the model gets the **brief only** (angle, key facts with their source numbers, gaps, outline, keyword, the Sources list by title and outlet) and the owner's site profile. **It never sees any article's page text or snippet**, so it cannot lift sentences. The brief and the owner's note sit in marked blocks, marker characters are defanged, and the rules say nothing inside a block is an instruction.
- `schema.js`: every paragraph is a `fact`, a `framing` line or a `gap`. A `fact` must cite source numbers that the brief's **own facts** cite; numbers are turned into addresses in code. A fact with no valid source is **not shown as a fact**: it becomes a visible gap marker ("Add a sourced point here...") and is counted. A `framing` line containing a digit is treated the same way (a figure is a claim with no source). HTML is stripped, every length capped, unknown fields ignored. The length must be within 0.3x to 1.8x of what was asked. One retry naming the problems, then a plain failure.
- `generate.js`: model from Settings -> Topic Research (`modelResolver.js`, no id in the code); 400 if the brief has no sourced facts, 503 with no model; tokens of both attempts logged once as `topic_research_draft`; errors never carry the prompt, brief or provider text.
- **Copy check**: the existing 12-word check (`brief/overlap.js`) runs on the draft against the ticked articles' stored text, snippets and headlines **and against the brief's own wording** (so a draft that just pastes the brief is flagged). It warns and saves; the owner decides.
- `markdown.js`: **Copy as Markdown** and **Download .md**, with the warnings and gap markers kept at the top.

**Routes:** `POST /briefs/:id/draft { lengthChoice, steer }` (10 attempts per person per hour, one at a time per brief, 402 over the monthly limit), `GET /briefs/:id/drafts`, `GET /drafts/:id`, `DELETE /drafts/:id` (recycle bin, Undo). `GET /history` lists drafts too. Table `topic_research_drafts` (cascades from the brief). Draft cost counts towards the monthly limit (`spend.js`, new `draftUsd`). Deleting a brief or topic carries its drafts into the bin and restoring brings them back.

**Page.** The Draft panel sits on the Brief page with earlier drafts listed; the Draft page (`?draft=`) shows sections, source numbers matching the Sources list, dashed "[needs your input]" boxes, and the warning box. It is read-only: copy it and edit where you write. Guide, tour (9 steps) and (i) box say the new truth.

**What was checked:** unit tests for the validator (unsourced fact demoted, number not cited by the brief, framing with a figure, cleaning, caps, length), the prompt (no article text, defanged note), the generator against a fake model (retry, invented source, provider fault, no model, logging) and the copy check; route tests (validation, ownership, 402, 409, hourly cap, history, delete); mutation checks on every rule. Against the real database with the model stubbed: create, list, get, history, spend, other-person 404s on create/get/list/delete, delete and restore of a draft, of a brief with its draft and of a whole topic with both, 402 with no model call; a fresh-database boot. In a real browser: the Draft panel, the Draft page (warnings, gap boxes, source numbers), the no-model error, delete, and no sideways scroll at 380 px.

**Not verified:** a draft written by a **real model**. The local key is rejected, so how well a real model keeps to the JSON shape, cites only brief sources, leaves honest gaps and paraphrases is unmeasured until one runs on Railway. The Undo toast click for a draft was not exercised by hand (the bin round trip was checked in code). The narrow-window check covered the Brief page, not the Draft page.

**Limits.** "Every fact has a source from the brief" is enforced, but whether the paragraph's wording is *supported* by the brief's fact is not checked by code. The copy check catches shared runs of 12 words, not close paraphrase, and once page text is purged (30 days) it compares only headlines and snippets for those articles. A draft from a thin brief will be mostly gap markers (by design).

## Milestone 7: right sources first, and visible progress

**Why.** A real run on "motors for walk in wine cabinets" returned shop and category pages, the brief itself said no source covered a walk-in cooling unit, and the tool still produced a confident outline and a long draft. M7 checks relevance before money is spent, helps the search use the trade's words, and shows where a long action has got to.

**Progress is real, never a timer.** `progress.js` keeps, in memory, the steps of each long action under a random `opId` the page sends with the request (10-minute expiry, per person, capped, the person's own only). The search records each source as it answers ("2 of 3 answered"), the save, each page read ("4 of 12"), and the ranking; briefs and drafts record getting ready, writing (including a second try) and checking. The page polls `GET /progress/:opId` about every 0.7 s and shows the steps in the existing blocking box (`withProgress.js` into `processingStore`); a missed poll changes nothing and the box always closes when the request ends. A bar above the topic, brief and draft pages shows Search, Choose sources, Brief, Draft; earlier steps are clickable.

**Shop pages.** `pageKind.js` (pure) says product, listing or article from the address (/dp/, /products/x, /collections/, /category/, /shop/ ... as whole path segments), the page's markup (schema.org Product or ItemList, og:type product, "add to cart" beside several prices; editorial markup such as NewsArticle overrides the address) and, last, the text (a short page that is mostly prices). A shop address is known when the article is saved; the rest when the page is read. A shop page is badged "Shop page", is not ticked for a brief to begin with, and its score is multiplied by 0.4 (the breakdown shows the cut).

**Topic match.** A sixth ranking signal: 0.4 x the share of the topic's words in the title + 0.4 x the share anywhere in title, snippet and page text + 0.2 when the whole phrase appears in order. Default weights are now rank 25, size 20, engagement 15, recency 15, outlet 5, topic match 20 (still 100); saved weights without the new key take its default; the stored scores of older searches re-rank themselves (the fingerprint changed). The signal is left out of a search where every article matches equally, like the other signals.

**Source check before a brief.** Pressing Generate brief first asks the workspace's cheaper model to score each ticked article 0-3 for how directly it is about the topic (`relevance/check.js`; page text is untrusted data in marked blocks; scores clamped, missing = 0). **The verdict is worked out in code**: good at 60 % of articles scoring 2 or 3, mixed from 30 %, otherwise poor. Mixed or poor shows what the sources are mostly about and three choices: choose different articles, search again with different words, or write the brief anyway. A check that cannot run (no model, a fault) never blocks the brief; running out of the monthly limit does (402). Its cost is in the usage log and counts towards the monthly limit.

**Industry-term suggestions.** "Suggest industry terms" (`relevance/suggest.js`, same cheap model) offers up to three other phrasings (2-8 words, not the original, no duplicates, each with a searchable word). Ticked ones are saved on the topic (`"extraQueries"`) and every search of it (Search, Search again, Watch) asks every source about each phrasing (`collect.js` `searchAllQueries`: at most four phrasings in all, items merged and de-duplicated by address, a fault repeated by every phrasing reported once, one phrasing failing keeps the rest); the run records what it asked (`"queriesJson"`) and Results says "Searched for: ...". Paid sources are asked once per phrasing, which the page says and the monthly limit enforces.

**Draft changes.** The draft's 12-word copy check now compares against the source articles only (it used to include the brief, which the draft is built from, and that buried the warnings that matter). Before a draft of a thin brief the page warns ("N of M sections of the outline have no supporting fact in this brief", or fewer than four sourced facts) and asks whether to draft anyway: `draftReadiness()`, a rough check from word overlap, and the message says so. "Regenerate with a different angle" is now "Another angle, same articles" and says it cannot make up for a poor set of sources; the draft note says it shapes emphasis but cannot add facts.

**Routes added:** `GET /progress/:opId`, `POST /suggest-queries`, `POST /runs/:id/relevance` (the last two: 40 a person per hour between them, 402 over the limit); `opId` accepted on the four long routes; `extraQueries` accepted on `POST /topics`. Columns: articles `"pageKind"`, runs `"queriesJson"`, topics `"extraQueries"`.

**What was checked:** unit tests for the progress store (order, ownership, expiry, cap, bad ids, safe calls), the progress hooks in collect, extract and analyse, page-kind detection (addresses, markup, text, combinations), topic match and the shop cut with hand-derived numbers (the older hand-derived score tests keep their numbers by passing the old weights explicitly), the relevance and suggestion prompts, validators, verdict boundaries and error paths, multi-phrase collection, route validation, ownership, caps, 402s, and the client helpers; 19 mutations of the new rules plus a re-test of one badly built mutant: all caught except one equivalent mutant (a second, redundant ownership check in the progress store, whose key already includes the person). Against the real database with real free sources: a search with two extra phrasings (three asked, 24 articles merged, 13 distinct progress snapshots while it ran, page kinds and the match signal stored, another person sees nothing); a fresh-database boot with the three new columns. In a real browser: the bar, the chips, the cost note, the live steps ("2 of 3 answered ..."), the source-check panel (model call stubbed in the page), the thin-brief warning, and the renamed labels.

**Not verified:** the source check and the suggestions against a **real model** (the local key is rejected; both were exercised with the model call stubbed, in tests and in the browser), shop-page detection on real shop pages (it is unit-tested on hand-made addresses and markup; the one live search returned no shop pages), and how well a cheap model scores relevance or words a topic. After deploy, re-run the wine-cabinet topic on Railway and compare.

**Limits.** Topic match counts words, not meaning: a page that mentions the words in passing scores some. The readiness check is a word-overlap heuristic. Progress is in memory, so a restart during an action loses its steps (the action itself is unaffected). Searching several phrasings multiplies calls to paid sources.

## Milestone 8: see what was asked, and ask better

**Why.** On "motors for walk in wine cabinets" the search found mostly retail pages and nothing on screen said why. A web check showed nobody writes about "motors" for this: the trade writes about **cooling capacity (BTU an hour) and heat load**, and bottle count is a minor factor. Technical questions like this need the trade's words, and the tool should show what it asked so a thin result explains itself.

**The search words, and what was not used.** Results always says "Searched for: ..." (the topic's own words, then any ticked phrasings) and, when something was switched off, "Not used this time: Reddit (needs ...) . Google results (...)" with each reason, from the same status list as Settings (`GET /runs/:id` returns `notAsked`; a source that was asked is never listed).

**The exact prompt of every AI call.** A collapsed "What the AI was asked" panel shows the model, the rules (system), the request with its material (user; other outlets' text is shown as it was sent) and, for a second try, the extra text added. Copy puts the whole thing on the clipboard. Brief and draft prompts are **stored on the row** (`"promptJson"`, the user part cut at 240,000 characters with a marker, the system part never cut), returned **only by the single-item reads** (`GET /briefs/:id`, `GET /drafts/:id` and the create responses), never in lists or History. Source-check and suggestion prompts come back with their response and are shown with that result. A test compares what is returned with what the model actually received. **Because a stored prompt carries other outlets' page text it follows the 30-day rule**: the daily purge clears `"promptJson"` older than 30 days (the brief or draft stays; the panel then says the prompt is not kept, as it does for anything made before M8).

**Questions and the trade's words.** When the topic is a question about sizes, amounts or specifications, the suggestion step may add a one-sentence note on what the trade actually measures or calls it and whether the question's premise fits (the wine case: cooling is sized by heat load, not by motor size or bottle count). It is shown as "AI note (check it)", is never searched and never saved, and does not change the suggested phrasings. It can be wrong, which is why it is labelled and why the person still ticks what to search.

**Google results with the key Vault already has.** The Serper source accepts `SERPER_SEARCH_API_KEY` (the key the chat web search and Recipes use) **only when Serper is chosen as the Google results provider in Topic Research Settings**: a key that merely exists never starts spending on every search. `SERP_API_KEY` (this tool's own) still wins. Search prices count as zero until `SERP_PRICE_PER_QUERY_USD` is set, so Google searches are not yet in the monthly limit.

**Tip for technical topics.** Write the question, press Suggest industry terms, read the note, tick the trade phrasings (for the wine case: "wine cellar cooling capacity BTU", "wine cellar heat load"), and expect manufacturer sizing guides rather than news. Reference tables and PDF spec sheets are not read yet.

**What was checked:** the prompt returned equals what the (fake) model received for brief, draft, source check and suggestions, including a second try; storage on the row, absence from lists and History, the cut marker, ownership, bin round trips are covered by the existing restore code (columns are copied); the purge clears old prompts only; the premise note is cleaned, capped, dropped when it only repeats the topic and never changes the phrases; the Serper fallback rules (only on the choice, own key wins, blank is none, another provider ignores it); the helpers for the lines and Copy text. Real database and browser results are in the summary of this milestone.

**Not verified:** the premise note and suggestions with a **real model**; how often the note is right; and whether trade phrasings really change what Brave returns for the wine case (to try on Railway).

**Limits.** Prompts for briefs and drafts made before this are not available. The stored prompt can be large (up to about 240 KB for twelve articles). The "not used" list shows the current source status, so it reflects settings now, not at the moment of an old search.

## Known limits and open items

- Article pages are fetched by `extract.js` through `safeFetch` with robots.txt checks. `htmlFetch.fetchHtml` must not be used for this: it impersonates browsers and relays through third parties.
- Before trusting the results of GDELT, Brave and Serper: run each once with a working key/network and check the real response against the adapter (field names, Top stories key). The tests only prove the adapters against the shapes they were written from.
- A search waits for its slowest source (up to 15 s each, in parallel). A background run with progress would be better if a search ever feels slow; not done.
- `costCalculator.js` pricing is keyed on older model ids and falls back by name; check it before trusting the monthly spend estimate.
- Set real search prices (`BRAVE_PRICE_PER_QUERY_USD`, `SERP_PRICE_PER_QUERY_USD`) if the monthly limit should also count searches.
- Not built: Google Trends (no source), the spec's `APP_PASSWORD` (Vault's login covers it).
- The tour's step counter code was copied from the DNS Lookup tour, where it throws a harmless console error (`insertBefore`); fixed in the Topic Research tour only.
