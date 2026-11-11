# Guide chats (the round "guide" button)

PDF Tools, Graphics, Video Tools and Finance each have a round button at the bottom right that opens a small chat: the person says what they want to do and the guide points at the real tools, in order, or says plainly that one is missing. There is **one shared component**, so anything done to the chat (a readable tooltip, emailing the conversation, dragging, wide/narrow, the microphone) is done once and every guide gets it, including guides added later.

| Piece | Where |
|---|---|
| The chat itself | `client/src/components/tutor/TutorChat.jsx` (never copied) |
| A guide's wording | a small wrapper per page: `client/src/pages/<page>/…TutorChat.jsx` with a `CONFIG` |
| Which guides exist | `server/config/guides.js` (id, name, endpoint) |
| The answer | a server service + route per guide (`server/services/pdfTutor.js`, `server/routes/pdfTutor.js`, …) |
| Email the conversation | the panel in `TutorChat.jsx` + `server/routes/tutorEmail.js` (`POST /api/tutor-email`) |
| Tooltips | `client/src/components/Tooltip.jsx` (sizes to its text, stays inside the window, also in a corner) |
| The guard | `npm run test:guides` (`server/config/guides.test.js`) |

## What every guide gets for free

- **Readable tooltip** on the button and every control (240px wide, 320px for long text, always inside the window).
- **Email this conversation**: after the first answer, a link opens "Email this conversation to: Me / The admin". Nothing is sent until the person presses Send. The admin copy is a separate email with the person as Reply-To. 10 emails an hour per person. The text is bounded and escaped. The guides never see files, so only what was typed is emailed.
- Draggable button and chat (position remembered), wide/narrow, microphone, Esc/Clear, a fault in the guide never takes the page down.

## Adding a guide to a new page or app

1. **Server answer.** Copy the pattern of `server/services/pdfTutor.js` (CATALOG of the real tools, RULES, NOT_POSSIBLE, a `SYSTEM` prompt that says what the guide must never do, `normalizeTutorReply` that treats the model's answer as untrusted and checks tool ids against the catalogue, a drift test) and `server/routes/pdfTutor.js` (also files a Suggestions-inbox note when something is missing). Use `getModelsForUser` (never a hardcoded model id) and `logUsage`. Mount it in `server/index.js` behind `aiLimiter` (and `requireFeature(...)` if the page has a flag) and add `POST /api/<x>-tutor` to `server/testing/routeManifest.json` (`authed`).
2. **Register it** in `server/config/guides.js`: `myguide: { name: 'My guide', endpoint: '/api/myguide-tutor' }`.
3. **Client wrapper.** Copy `client/src/pages/pdf/PdfTutorChat.jsx`: the `CONFIG` keys are listed in the header comment of `TutorChat.jsx`. Set `guideId` to the registry id and the same `name` and `endpoint`. Put `<MyGuideChat currentTool={...} onOpenTool={...} />` in the page, inside a `VoiceInputProvider` (the page's, or one the wrapper adds).
4. Run `npm run test:guides`. It fails, with the reason, if a wrapper lacks a required config key (including `guideId`), is missing from the registry, disagrees with it on name or endpoint, reuses another guide's `wideKey`, or has an endpoint that is not mounted or not in the route manifest.

Nothing about tooltips or email needs wiring: the wrapper hands its `CONFIG` to the shared component and both are already there.

## One brain, two pages: Video Tools and Music

The **Music tutor** (`guideId` `music`, `POST /api/music/tutor`, `client/src/pages/music/MusicTutorChat.jsx`) has its own wrapper and registry entry (the guards require one wrapper per guide) but uses the **same server brain and catalogue as the Video Tools tutor** (`server/services/videoTutor.js`). That catalogue lists the Music page's tools (ids `music-score`, `music-own-track`, `music-voiceover`, group `Music`) beside the Video Tools ones, so either chat can send a person to a tool on the other page: an Open button for a Music tool on `/videos` goes to `/music?tool=<id>`, and a Video Tools tool from `/music` goes to `/videos?tool=<id>`. When a Music tool is added to `music/musicTools.mjs`, add its `music-` entry to `CATALOG` (`videoTutor.test.js` fails otherwise).

## The Notes guide

The **Notes guide** (`guideId` `notes`, `POST /api/notes-tutor`, `server/services/notesTutor.js` on `guideCore.js`, `server/routes/notesTutor.js` on `guideRouter.js`, wrapper `client/src/pages/notes/NotesTutorChat.jsx`) knows the controls Notes really has: New note, Talk it through (also shown on the Talk screen itself, where this guide's round button appears), New voice note, Search notes, Dictate, the @ menu, Project, Live to-dos (Make tasks), Convert to task, Open as chat, using Notes from Chat (My notes, saving a reply or chat to Notes) and Delete. It knows the two microphone buttons apart (New voice note records and writes up a whole recording; Dictate types live into the open note), that by default only the words of a voice note are kept (the audio can be kept for 7 days or until deleted if chosen before recording), and the limits (about an hour per recording, no speaker names, no folders or sharing, not a legal record). It sees no notes. `client/src/pages/notes/notesTools.mjs` is the list of controls the page can show and what each Open button does (create / open the recorder / focus the search box / bring the open note into focus; none changes or deletes a note); `npm run test:notes-tutor` fails if that list and the guide's catalogue drift apart. When a Notes control is added or changed, update `notesTools.mjs` and `CATALOG` together.

## The Web Extractor guide

The **Web Extractor guide** (`guideId` `web-extractor`, `POST /api/web-extractor-tutor`, `server/services/webExtractorTutor.js` on `guideCore.js`, wrapper `client/src/pages/webExtractor/WebExtractorTutorChat.jsx`) knows the six tools (Article content with its CSS selector, Extract images, Links, Tables, Metadata, Exact scrape) and their buttons. It sees no page or result. `client/src/pages/webExtractor/webExtractorTools.mjs` lists the tools, tips and the controls the Open buttons can switch to; `npm run test:web-extractor-tutor` fails if that list and the catalogue drift. See `docs/web-extractor.md`.

## The Font Customizer, Measurements and CSS guides

Three more page guides on `guideCore.js`/`guideRouter.js`, each with a tools list the page and the guide share (`client/src/pages/fonts/fontsTools.mjs`, `measurements/measurementsTools.mjs`, `restyle/restyleTools.mjs`: the left-hand menu, hover tips, blurbs, the (i) text and `GUIDE_TOOLS`, the controls the Open buttons can switch to):

| Guide | `guideId` | Endpoint | Service | Test |
|---|---|---|---|---|
| Font Customizer guide | `fonts` | `/api/fonts-tutor` (flag `fonts`) | `server/services/fontsTutor.js` | `npm run test:fonts-tutor` |
| Measurements guide | `measurements` | `/api/measurements-tutor` (flag `measurements`) | `server/services/measurementsTutor.js` | `npm run test:measurements-tutor` |
| Drawings guide | `drawings` | `/api/drawings-tutor` (flag `drawings`) | `server/services/drawingsTutor.js` | `node server/services/drawingsTutor.test.js` (no npm script on purpose: it would change `package.json`) |
| Sketchbook guide | `sketchbook` | `/api/sketchbook-tutor` (flag `sketchbook`) | `server/services/sketchbookTutor.js` | `node server/services/sketchbookTutor.test.js` (no npm script, to keep `package.json` unchanged) |
| Plans guide | `plans` | `/api/plans-tutor` (flag `plans`) | `server/services/plansTutor.js` | `node server/services/plansTutor.test.js` (no npm script, to keep `package.json` unchanged) |
| CSS guide | `css` | `/api/restyle-tutor` (flag `restyle`) | `server/services/restyleTutor.js` | `npm run test:restyle-tutor` |

They see no fonts, values, documents or pages. The CSS guide follows that tool's rule of no code words in anything a person reads (its test checks the catalogue, rules and page wording). The three tests use `server/services/guideTestKit.js` (`checkGuide`), which also checks the page's menu against the catalogue (every menu tool has a tip, a blurb and the same group in the guide); use it for the next page guide. The pages' menu is the shared `client/src/components/ToolSidebar.jsx` (see client/DESIGN.md).

## The Device preview guide

**Device preview guide** (`guideId` `device-preview`, `POST /api/device-preview-tutor`, flag `restyle` because the page uses the Style editor's page loader, `server/services/devicePreviewTutor.js` on `guideCore.js`, `server/routes/devicePreviewTutor.js` on `guideRouter.js`, wrapper `client/src/pages/devicePreview/DevicePreviewTutorChat.jsx`). It knows the address box, the JavaScript option, Show the page, Choose screens (up to four), Your own size, Turn on its side and Size on screen, and says plainly that it only looks (no scripts, no logins, no styling changes: that is the Style editor). It sees no address or page. `client/src/pages/devicePreview/devicePreviewTools.mjs` is the list the page and guide share (three areas the Open buttons scroll to: `data-guide="show"`, `"choose-screens"`, `"turn"`); `npm run test:device-preview-tutor` fails if it and the catalogue drift, tested with `guideTestKit.js`.

## The YouTube guide

**YouTube guide** (`guideId` `youtube`, `POST /api/youtube-tutor`, flag `youtube`, `server/services/youtubeTutor.js` on `guideCore.js`, wrapper `client/src/pages/youtube/YoutubeTutorChat.jsx`). It knows the search box, filters, Open playlist, the tabs (Results, Trending, Favourites, History, Lists), the watch window, Insights, Ask this video, Save to Notes, Transcript and Comments, and the daily search limit. It sees no searches, videos or notes. `client/src/pages/youtube/youtubeTools.mjs` is the list the page and guide share; `npm run test:youtube-tutor` fails if it and the catalogue drift.

## The CRM, Shares and Settings guides

Three guides on `guideCore.js`/`guideRouter.js`, tested with `server/services/guideBasicsKit.js` (`checkBasics`: prompt, untrusted answers, model call, safety wording) plus a drift check against the page. They see no clients, holdings, settings, keys or users.

| Guide | `guideId` | Endpoint | Where the button shows | Test |
|---|---|---|---|---|
| CRM guide | `crm` | `/api/crm-tutor` (flag `clients`) | `ClientsPage`, `ClientDetailPage`, `PipelinePage` | `npm run test:crm-tutor` |
| Shares guide | `shares` | `/api/shares-tutor` (flag `shares`) | `SharesPage` | `npm run test:shares-tutor` |
| Settings guide | `settings` | `/api/settings-tutor` (any login) | `SettingsPage`, `AdminPage` | `npm run test:settings-tutor` |

- **CRM:** controls are listed in `client/src/pages/crm/crmGuideTools.mjs` (list, New client, the client-page sections, Pipeline); an Open button for a client-page section only works on a client's page (elsewhere a toast says to open a client first). Update that file and `CATALOG` in `server/services/crmTutor.js` together.
- **Shares:** ids are the page's own `TABS`; never recommends buy/sell, no tax advice. The test fails if `TABS` and `CATALOG` drift.
- **Settings:** ids are the Settings section ids (`utils/settingsGroups.mjs`) plus six `admin-…` parts of the Admin page. Admin-only sections must say "Admin only" (tested). From another page an Open button stores `settingsTab` and goes to `/settings`; `admin-…` goes to `/admin`. A new Settings tab needs a `CATALOG` entry or the test fails.
- The Finance guide already existed (`finance`); it is hidden for accountant logins.

## The Domain guide

**Domain guide** (`guideId` `domains`, `POST /api/domains-tutor`, flag `domains`, `server/services/domainsTutor.js` on `guideCore.js`, `server/routes/domainsTutor.js` on `guideRouter.js`, wrapper `client/src/pages/domains/DomainsTutorChat.jsx`). The Domain page is a guided journey (Brief, Names, Shortlist, Saved sets), and the guide knows the steps and their controls: what it is, names I already have, tone, naming style, what must be free, Generate names, the microphone, filters, more/less like this, variations, Save set and Saved sets. It says plainly that Domain never buys or registers anything, that a free name is not a safe name (trade marks and business names are not checked yet), and that it cannot see what you type. It sees no descriptions, names or results. `client/src/pages/domains/domainsTools.mjs` is the list the page and guide share (an Open button switches to a step); `node server/services/domainsTutor.test.js` (tested with `guideTestKit.js`) fails if it and the catalogue drift. **Every text box on the Domain page has the shared microphone** (`VoiceInput`); in a name or domain box `client/src/pages/domains/spoken.mjs` turns "acme wine dot com dot au" into acmewine.com.au (`node client/src/pages/domains/spoken.test.mjs`) and only touches what is spoken. When a Domain step or control changes, update `domainsTools.mjs` and `CATALOG` together (later stages add Check and Decide).

## The Guitar guide

**Guitar guide** (`guideId` `guitar`, `POST /api/guitar-tutor`, flag `guitar`, `server/services/guitarTutor.js` on `guideCore.js`, `server/routes/guitarTutor.js` on `guideRouter.js`, wrapper `client/src/pages/guitar/GuitarTutorChat.jsx`). It knows the four tabs (Coach, Drills, Strum, Library; a song opens inside Library) and the controls in them: I played this, song status, adding a song, transpose, capo, the chord chart, the key and Roman numerals, the easiest capo, Make it easier, practice loops, the tempo trainer, the session builder, drills with progressions and finger moves, strumming arrows and the pattern ladder, the backing band, the glossary, set lists and play mode. (Today, Learn, Ear and Player were removed 2026-11-03.) Full feature list: `docs/guitar.md`. It sees no songs, chords or scores. `client/src/pages/guitar/guitarTools.mjs` is the list the page and guide share (an Open button switches to a tab); `node server/services/guitarTutor.test.js` fails if it and the catalogue drift. `guitarTips.mjs` holds the hover tip for every control and `node client/src/pages/guitar/guitarTips.test.mjs` fails if a control has no tooltip, a native `title=""` is used, or the (i) box, the tour (`utils/tours/guitarTour.js`, Settings -> Guitar Tour) or the guide is missing. The two small dialogs (correct a chord, I played this) are left out of the tooltip check because a tooltip sits below a dialog. The Guitar page also has Ear training (`EarTraining.jsx`, rules in `earQuestions.mjs`, scores in `guitar_ear_sessions`) and play mode with set lists (`GigMode.jsx`, `SetLists.jsx`, `gigPlay.mjs`, tables `guitar_setlists` and `guitar_setlist_songs`), served by `server/routes/guitarPlay.js` at `/api/guitar-play`. **Keep a component and a logic module from sharing a name** (for example `EarTraining.jsx` and `earTraining.mjs`): on Windows and Mac the import of the component then picks the `.mjs` and the page goes blank; `guitarTips.test.mjs` fails if two files in `pages/guitar/` match apart from capitals or extension. When a Guitar control is added or changed, update `guitarTools.mjs`, `CATALOG`, `guitarTips.mjs` and the tour together.

## Behaviour changes belong in the shared files

Change how all guides look or behave in `TutorChat.jsx` (client) or `tutorEmail.js` (server), never in a wrapper. Tooltip behaviour belongs in `Tooltip.jsx` and applies to the whole app.

## Guides built on the shared server pieces

New guides can skip copying the older guides' server code: `server/services/guideCore.js` (`createGuide({ catalog, rules, notPossible, system, ... })` gives the prompt, message cleaning, the safe reply normaliser and the model call) and `server/routes/guideRouter.js` (`makeGuideRouter`, which also files the "something is missing" note). The Cellar Planner guide is the example (`server/services/cellarTutor.js`, `server/routes/cellarTutor.js`). The **public website** guide for the Cellar Planner is the one guide that is not this shared chat: it has no login, so it is plain JavaScript on the website page with its own limits, see `docs/cellar-planner.md` ("Website help chat").

## The Usage & Cost guide

**Usage & Cost guide** (`guideId` `usage`, `POST /api/usage-tutor`, flag `usage`, `server/services/usageTutor.js` on `guideCore.js`, `server/routes/usageTutor.js` on `guideRouter.js`, wrapper `client/src/pages/usage/UsageTutorChat.jsx`). It knows the two tabs and their parts: the period buttons and Custom dates, the headline numbers, the over-time chart, By model, By feature, the Calls list, and the Advice tab with its four kinds of card (Save money, Check quality, Tune, Good to know). It says plainly that every cost is an estimate, that the Advice tab is fixed rules and not an AI, and that changing a model is done in Settings, not on this page. It sees no spending, calls or settings. `client/src/pages/usage/usageTools.mjs` is the list the page and guide share (the two tabs are the "tools"; an Open button shows the tab and scrolls to the part marked `data-guide="<id>"`, and `custom-dates` also switches the period to Custom); `node server/services/usageTutor.test.js` fails if it and the catalogue drift (tested with `guideTestKit.js`). The page also has the (i) "How Usage & Cost Works" box (`HOW_IT_WORKS`, shown once per browser, key `vault_usage_info_seen`) and a Tooltip on every control. When a part of the page or an Advice kind changes, update `usageTools.mjs` and `CATALOG` together.

## The SERP Tracker guide

**SERP Tracker guide** (`guideId` `serp-tracker`, `POST /api/serp-tracker-tutor`, flag `serpTracker`, `server/services/serpTrackerTutor.js` on `guideCore.js`, `server/routes/serpTrackerTutor.js` on `guideRouter.js`, wrapper `client/src/pages/serpTracker/SerpTrackerTutorChat.jsx`). It knows the three tabs (Site setup, Lookup, Runs) and their controls, says every lookup is a paid search, that a search with no ordinary results is a failure and never "not ranked", and that daily ranking collection, history, reports and alerts are not built yet. It sees no site, searches, results or costs. `client/src/pages/serpTracker/serpTrackerTools.mjs` is the list the page and guide share; `node server/services/serpTrackerTutor.test.js` (with `guideTestKit.js`) fails if it and the catalogue drift. When a SERP Tracker control is added or changed, update `serpTrackerTools.mjs` and `CATALOG` together. See `docs/serp-tracker.md`.

## The Page speed guide

**Page speed guide** (`guideId` `page-speed`, `POST /api/page-speed-tutor`, flag `html`, `server/services/pageSpeedTutor.js` on `guideCore.js`, `server/routes/pageSpeedTutor.js` on `guideRouter.js`, wrapper `client/src/pages/pageSpeed/PageSpeedTutorChat.jsx`). It knows New run, Saved runs, the Mobile/Desktop buttons, the copy buttons (Copy for AI, Copy mobile + desktop, Copy action list), the PDF report, the Report tab (scores, progress chart, lab metrics, field data, findings) and the Actions tab (Fix first / Do next / When there is time, category filter, Mark as done, For your developer). It says plainly that Page speed only reports (it never changes the site), that ticks and notes are saved with the run so they are shared rather than per browser, that ticking does not re-test, and that it tests one public page at a time. It sees no address, score or report. `client/src/pages/pageSpeed/pageSpeedTools.mjs` is the list the page and guide share; an Open button for a Report/Actions part needs a saved run open (otherwise a toast says to open one). `node server/services/pageSpeedTutor.test.js` (with `guideTestKit.js`) fails if it and the catalogue drift. See `docs/html-agent.md`.

## The Memory guide

**Memory guide** (`guideId` `memory`, `POST /api/memory-tutor`, flag `memory`, `server/services/memoryTutor.js` on `guideCore.js`, `server/routes/memoryTutor.js` on `guideRouter.js`, wrapper `client/src/pages/memory/MemoryTutorChat.jsx`). Memory is one page with one tool, so the guide knows the page and its parts (summary line, Add a memory, the microphone, Search, Clear, Recent memories, Show more, Delete). It says plainly that memories are added on the page only (Chat reads them but never saves them), that Search by meaning needs an embedding model (without one it shows recent memories), that there is no edit, and that Delete is permanent. It sees no memory, search or setting. `client/src/pages/memory/memoryTools.mjs` is the list the page and guide share (every id is also a `data-guide` on the page); `node server/services/memoryTutor.test.js` (with `guideTestKit.js`) fails if it and the catalogue drift, and `node client/src/pages/memory/memoryPage.test.mjs` checks the page keeps its tooltips, (i) box, tour, microphone and guide. When a Memory control is added or changed, update `memoryTools.mjs` and `CATALOG` together. See `docs/semantic-memory.md`.
