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

## Behaviour changes belong in the shared files

Change how all guides look or behave in `TutorChat.jsx` (client) or `tutorEmail.js` (server), never in a wrapper. Tooltip behaviour belongs in `Tooltip.jsx` and applies to the whole app.

## Guides built on the shared server pieces

New guides can skip copying the older guides' server code: `server/services/guideCore.js` (`createGuide({ catalog, rules, notPossible, system, ... })` gives the prompt, message cleaning, the safe reply normaliser and the model call) and `server/routes/guideRouter.js` (`makeGuideRouter`, which also files the "something is missing" note). The Cellar Planner guide is the example (`server/services/cellarTutor.js`, `server/routes/cellarTutor.js`). The **public website** guide for the Cellar Planner is the one guide that is not this shared chat: it has no login, so it is plain JavaScript on the website page with its own limits, see `docs/cellar-planner.md` ("Website help chat").
