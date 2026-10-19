# Web Extractor

`/web-extractor`, flag `webExtractor`. Pulls content out of one public web page. Stateless: nothing is saved.

## Layout (same as Graphics and Video Tools)

Left-hand list of tools in groups (**Text**, **Pictures**, **Data**, **Page**) with a search box (`/` jumps to it, Esc clears it) and a hover tip on every group and tool; an (i) "How the Web Extractor works" box that opens once; a round guide button bottom right; a microphone on every text field (address, sections, selector, link filter, tool search). Each tool keeps its own result while you switch tools. `?tool=article|images|links|tables|metadata|styled` opens a tool.

| Piece | Where |
|---|---|
| Page | `client/src/pages/WebExtractorPage.jsx` |
| Tool list, tips, "how it works" text, guide controls, speech helpers | `client/src/pages/webExtractor/webExtractorTools.mjs` |
| Guide chat wrapper | `client/src/pages/webExtractor/WebExtractorTutorChat.jsx` (`guideId` `web-extractor`) |
| Guide server | `server/services/webExtractorTutor.js` + `server/routes/webExtractorTutor.js` (`POST /api/web-extractor-tutor`, on `guideCore`/`guideRouter`) |
| API | `server/routes/webExtractor.js` (`/extract`, `/pdf`, `/download-image`, `/download-images-zip`) |
| Extraction | `server/services/webExtractorService.js` (jsdom) |
| PDF | `server/services/webExtractorPdf.js` |

When a tool or button is added, changed or removed, update `webExtractorTools.mjs` (the list, `TOOL_TIPS`, `TOOL_BLURBS`, `GUIDE_TOOLS`) and the guide's `CATALOG` together. `npm run test:web-extractor-tutor` fails if they drift.

## The six tools

- **Article content** - readable text with `#` headings, `•`/`1.` list items and ` | ` between table cells. Title is the social-card title, else the headline inside the article, else `<title>`. Author is the `author` meta tag or a short author element (a long bio block is ignored). Removed: menus, page header/footer, adverts, sidebars, comments, "most read"/"related" boxes, small forms, all pictures. Kept: the article's own `<header>` (the headline), and any `<form>` that wraps the article (ASP.NET WebForms). The biggest `<article>`/`<main>` is used; with none, the block with the most text in its own paragraphs (never the whole page).
- **Also exclude sections** - names matched as whole heading words ("Date" does not remove "Updates"). A match removes the heading's own box only if the heading leads it and it is not page-sized; otherwise only the heading goes.
- **Only extract inside (CSS selector)** - Article content only. `POST /extract` takes `selector` (trimmed, 200 characters). Only the matching boxes are read, in page order, nested matches once, at most 200. The built-in clean-up is skipped (it could remove the box asked for); the person's own excluded section names still apply. No match returns a notice; an invalid selector is a 400 ("Invalid CSS selector"). The result carries `matchCount`. Spoken form: "dot product dash card" -> `.product-card` (`parseSpokenSelector`).
- **Word count and reading time** - Article results carry `wordCount` and `readingMinutes` (230 words a minute).
- **Links** - `extractLinks`: every `<a href>` once (repeats counted in `occurrences`), typed `internal` (same host, `www.` ignored) / `external` / `email` / `phone`; `#fragment`, `javascript:` and other schemes skipped; the words fall back to `aria-label`, `title`, then the inner image's alt. Up to 2000. Filter by type and words; Copy links; CSV. It does NOT check that links work (that needs many outgoing fetches and is not built).
- **Tables** - `extractTables`: each top-level table as `headers` (only when the first row is all `<th>`), `rows`, `caption`, `rowCount`, `colCount`. Blank rows dropped; one-cell layout tables and nested tables skipped; up to 50 tables of 1000 rows. The page shows the first 200 rows of each; CSV and JSON have all of them. JSON is one list of `{ caption, rows: [{heading: value}] }` (repeated or missing headings become `Item (2)` / `column 3`).
- **Metadata** - `extractMetadata`: title (social-card title, else headline), `<title>` tag, description, canonical, language, author (meta tag, author element, else JSON-LD), site name, robots, keywords, published/modified (article tags, else JSON-LD, else `<time>`), Open Graph / Twitter / article tags, JSON-LD blocks (up to 20, 20,000 characters each; broken or oversize ones are counted in `jsonLdSkipped`), icons, and the H1-H6 outline (300). The page warns when there is not exactly one H1. It reports what the page declares; it is not an SEO audit (use the SEO and Lighthouse tools).
- **CSV rules** (`toCsv` in `webExtractorTools.mjs`) - quotes and commas escaped, CRLF line ends, a byte-order mark so Excel keeps accents, and a leading `'` on any cell that starts with `=`, `+`, `@`, tab, CR or `-` followed by a non-number (spreadsheet formula injection); plain negative numbers are left alone.
- **Extract images** - the largest `srcset` candidate, lazy-load attributes, `<picture>`, video posters, inline background images, `twitter:image`/`og:image` first; tracking pixels (1-2 px) skipped.
- **How a page is read (2026-10):** `runExtraction` uses the CSS tool's fetcher (`restyle/pageFetch.js`: other identities when a firewall refuses the first, the www/http alternates when a connection fails, never a text-only copy; see docs/restyle.md). Only **Article content** falls back to the old text-only readers (`htmlFetch.fetchHtml`: Serper, the WordPress API, Jina) when the real page is refused, and then says so ("this text comes from a reading service"). Every other tool needs the real markup, and for those a refusal is an honest error, not a page of unstyled text that looks like the site. Relative addresses resolve against where the page ended up after redirects. A refusal reads: "That website refused to give us the page (it turns away automatic visitors)...".
- **Exact scrape** (`restyle/selfContainedPage.js`, `npm run test:restyle-selfcontained`) now returns ONE self-contained page: addresses made complete, scripts removed, each linked style file fetched (12, 1.5 MB each) and placed as a `<style>` where its `<link>` was (print-only files dropped, others wrapped in `@media`), then pictures copied in as `data:` addresses (the preview inherits Vault's CSP, whose `img-src` only allows its own, `data:` and `blob:`; before this the pictures were empty boxes). A picture over 2.5 MB, or past 12 MB in all, stays a link. The response also carries the page as fetched (`sourceHtml`, 2 MB cap), `stats` and a `notice` for anything that could not be loaded. The page has a **Preview / HTML source** switch (the same viewer as the CSS tool: as fetched, or the copy with long `data:` addresses shortened for reading).
- **Exact scrape (older description)** - original HTML with every address made absolute (also inside `<style>` and `style=""`, `@import`, `<base>` honoured then removed), scripts and `<meta refresh>` removed, blur-up placeholders replaced by the real picture. Shown in `sandbox=""` iframe.

A thin result says why (`notice`): pages built by JavaScript are not run.

## Limits and safety

- Fetching: `htmlFetch.fetchHtml` (2 MB cap, SSRF check, redirects re-checked); pictures `fetchBinary` (20 MB each, pinned DNS). Downloads refuse anything whose content type is not an image.
- Zip: up to 60 pictures, 4 at a time, about 150 MB in all; the response carries `X-Images-Total` / `X-Images-Failed` and the page says how many failed.
- PDF: text only, built-in Helvetica. Letters it cannot draw become `?` and the response carries `X-Pdf-Replaced`. Text over 500,000 characters is refused (413).
- Errors: 400 (bad or private address), 502 (the other website failed or refused), 500 (ours).
- `npm run test:web-extractor` (extraction on HTML fixtures), `npm run test:web-extractor-tutor` (guide, page and speech helpers), `npm run test:guides`, `npm run test:safe-fetch`.

## Not done

No headless browser, so JavaScript-built pages stay empty. No crawling, history or saved results. No broken-link check, no contact-info or media (video/audio/file) listing, no XPath or point-and-click selection, no Markdown/DOCX output: ideas from the feature wish-list that were left for later.
