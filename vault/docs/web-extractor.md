# Web Extractor

`/web-extractor`, flag `webExtractor`. Pulls content out of one public web page. Stateless: nothing is saved.

## Layout (same as Graphics and Video Tools)

Left-hand list of tools in groups (**Text**, **Pictures**, **Page**) with a search box (`/` jumps to it, Esc clears it) and a hover tip on every group and tool; an (i) "How the Web Extractor works" box that opens once; a round guide button bottom right; a microphone on every text field (address, sections, tool search). Each tool keeps its own result while you switch tools. `?tool=article|images|styled` opens a tool.

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

## The three tools

- **Article content** - readable text with `#` headings, `•`/`1.` list items and ` | ` between table cells. Title is the social-card title, else the headline inside the article, else `<title>`. Author is the `author` meta tag or a short author element (a long bio block is ignored). Removed: menus, page header/footer, adverts, sidebars, comments, "most read"/"related" boxes, small forms, all pictures. Kept: the article's own `<header>` (the headline), and any `<form>` that wraps the article (ASP.NET WebForms). The biggest `<article>`/`<main>` is used; with none, the block with the most text in its own paragraphs (never the whole page).
- **Also exclude sections** - names matched as whole heading words ("Date" does not remove "Updates"). A match removes the heading's own box only if the heading leads it and it is not page-sized; otherwise only the heading goes.
- **Extract images** - the largest `srcset` candidate, lazy-load attributes, `<picture>`, video posters, inline background images, `twitter:image`/`og:image` first; tracking pixels (1-2 px) skipped.
- **Exact scrape** - original HTML with every address made absolute (also inside `<style>` and `style=""`, `@import`, `<base>` honoured then removed), scripts and `<meta refresh>` removed, blur-up placeholders replaced by the real picture. Shown in `sandbox=""` iframe.

A thin result says why (`notice`): pages built by JavaScript are not run.

## Limits and safety

- Fetching: `htmlFetch.fetchHtml` (2 MB cap, SSRF check, redirects re-checked); pictures `fetchBinary` (20 MB each, pinned DNS). Downloads refuse anything whose content type is not an image.
- Zip: up to 60 pictures, 4 at a time, about 150 MB in all; the response carries `X-Images-Total` / `X-Images-Failed` and the page says how many failed.
- PDF: text only, built-in Helvetica. Letters it cannot draw become `?` and the response carries `X-Pdf-Replaced`. Text over 500,000 characters is refused (413).
- Errors: 400 (bad or private address), 502 (the other website failed or refused), 500 (ours).
- `npm run test:web-extractor` (extraction on HTML fixtures), `npm run test:web-extractor-tutor` (guide, page and speech helpers), `npm run test:guides`, `npm run test:safe-fetch`.

## Not done

No headless browser, so JavaScript-built pages stay empty. No crawling, history or saved results.
