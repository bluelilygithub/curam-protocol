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
| CSS guide | `css` | `/api/restyle-tutor` (flag `restyle`) | `server/services/restyleTutor.js` | `npm run test:restyle-tutor` |

They see no fonts, values, documents or pages. The CSS guide follows that tool's rule of no code words in anything a person reads (its test checks the catalogue, rules and page wording). The three tests use `server/services/guideTestKit.js` (`checkGuide`), which also checks the page's menu against the catalogue (every menu tool has a tip, a blurb and the same group in the guide); use it for the next page guide. The pages' menu is the shared `client/src/components/ToolSidebar.jsx` (see client/DESIGN.md).

## Behaviour changes belong in the shared files

Change how all guides look or behave in `TutorChat.jsx` (client) or `tutorEmail.js` (server), never in a wrapper. Tooltip behaviour belongs in `Tooltip.jsx` and applies to the whole app.

## Guides built on the shared server pieces

New guides can skip copying the older guides' server code: `server/services/guideCore.js` (`createGuide({ catalog, rules, notPossible, system, ... })` gives the prompt, message cleaning, the safe reply normaliser and the model call) and `server/routes/guideRouter.js` (`makeGuideRouter`, which also files the "something is missing" note). The Cellar Planner guide is the example (`server/services/cellarTutor.js`, `server/routes/cellarTutor.js`). The **public website** guide for the Cellar Planner is the one guide that is not this shared chat: it has no login, so it is plain JavaScript on the website page with its own limits, see `docs/cellar-planner.md` ("Website help chat").
