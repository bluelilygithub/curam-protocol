# Finance guide

A small chat opened from a round graduation-cap button fixed at the bottom right of the Finance page. Ask where to do something or how part of
Finance works; it points at the real tabs (with an "Open" button per step), says when Finance does not do something, or says the
question is for the accountant. Same design as the Video Tools tutor (`docs/video-tools.md`).

* **Server:** `POST /api/finance-tutor` (`server/routes/financeTutor.js`), behind `requireFeature('finance')` and the AI rate limit;
  logic in `server/services/financeTutor.js`; model = the workspace `standard` tier via `getModelsForUser`.
* **Client:** `client/src/pages/finance/FinanceTutorChat.jsx` only supplies Finance's wording and a microphone provider; the chat itself is the
  shared `client/src/components/tutor/TutorChat.jsx` (below). Mounted at the end of `FinancePage.jsx`; `onOpenTab` is the page's `setTab`.
* **It cannot see the person's books and reads/writes no Finance data.** The only input is the conversation.
* **It never gives tax advice.** Tax, GST, super, entity and "how should this be treated" questions get the `accountant` verdict.
* **Knowledge** lives in `financeTutor.js`: `CATALOG` (one entry per Finance tab), `RULES` (how the app and the bookkeeping behave),
  `NOT_POSSIBLE` (what Finance does not do). **When a Finance tab is added or removed, or a rule changes, update this file:**
  `financeTutor.test.js` fails if the catalogue and the page's `TABS` list differ, or if a tab has no help text.
* A `missing` or `partly` answer is noted once per gap in the Suggestions inbox (source `financeTutor`).
* Tests: `npm run test:finance-tutor` (no database, no model: a fake model is injected).
* Not built yet: answering from the person's own figures. If that is added it must go through the existing ownership checks, and the
  cross-user test (`npm run test:cross-user`) will require the new route to be classified.

## One shared chat for every guide (keep them consistent)

Video Tools and Finance use the same component, `client/src/components/tutor/TutorChat.jsx`: the round button fixed bottom-right (the established
corner for guides; checked in a browser to sit at the same position on both pages), the panel, the verdict labels, the "Open" buttons, the
wide/narrow toggle, the error guard. A page never copies it. **To add a guide to another page:** write the server service and route in the
shape `{ verdict, answer, steps:[{tool,label,do}], missing, tip }`, then add a thin wrapper like `pages/finance/FinanceTutorChat.jsx` that passes
its `config` (endpoint, wording, starter questions, verdict labels) and mount it once at the end of the page. Do not add a second floating
button in the bottom-right corner of the same page without checking it against this one.
