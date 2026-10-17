# Finance guide

A small chat in the Finance header (graduation-cap button beside the `?` help button). Ask where to do something or how part of
Finance works; it points at the real tabs (with an "Open" button per step), says when Finance does not do something, or says the
question is for the accountant. Same design as the Video Tools tutor (`docs/video-tools.md`).

* **Server:** `POST /api/finance-tutor` (`server/routes/financeTutor.js`), behind `requireFeature('finance')` and the AI rate limit;
  logic in `server/services/financeTutor.js`; model = the workspace `standard` tier via `getModelsForUser`.
* **Client:** `client/src/pages/finance/FinanceTutorChat.jsx` (own microphone provider and an error guard so it can never break the
  page); mounted in `FinancePage.jsx` next to the help button; `onOpenTab` is the page's `setTab`.
* **It cannot see the person's books and reads/writes no Finance data.** The only input is the conversation.
* **It never gives tax advice.** Tax, GST, super, entity and "how should this be treated" questions get the `accountant` verdict.
* **Knowledge** lives in `financeTutor.js`: `CATALOG` (one entry per Finance tab), `RULES` (how the app and the bookkeeping behave),
  `NOT_POSSIBLE` (what Finance does not do). **When a Finance tab is added or removed, or a rule changes, update this file:**
  `financeTutor.test.js` fails if the catalogue and the page's `TABS` list differ, or if a tab has no help text.
* A `missing` or `partly` answer is noted once per gap in the Suggestions inbox (source `financeTutor`).
* Tests: `npm run test:finance-tutor` (no database, no model: a fake model is injected).
* Not built yet: answering from the person's own figures. If that is added it must go through the existing ownership checks, and the
  cross-user test (`npm run test:cross-user`) will require the new route to be classified.
