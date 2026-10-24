# Talk it through

Speak a question, hear the answer, go on, and when you end it get a note with a summary and everything that was said. Page `client/src/pages/TalkPage.jsx` (`/talk`), pieces in `client/src/pages/talk/`, server `server/services/conversationNote.js` and `POST /api/notes/from-conversation`.

**Design decision (2026-10-24):** it is a mode of **Chat** (the engine: model, history, "My notes", Chat History) with a front door in **Notes** (the output lands there; Notes is the foundation tool). It is not a separate app. Launched from Notes' **+** choice (*Talk it through*), the phone home Notes tile (**Talk**), and the Apps menu (**Talk**, also pickable as a landing page).

## How it works

1. Tap the big button and talk (`useTurnListener.js`: the browser's speech recognition, one spoken turn at a time; your words show greyed while you talk). Pause, and the browser ends the turn.
2. The words go to `POST /api/chat` as an ordinary message with `voiceMode: true`. The server adds one block before today's date (never cached): reply as *speech*, short natural sentences, no lists/headings/code/links, say numbers aloud (`chat.js`). With the **My notes** switch on, `useNotes: true` goes too, so the reply can draw on matching notes (see `docs/notes.md`).
3. When the reply has finished arriving, it is spoken (`useSpeaker.js`: the browser's own voice, preferring the person's language; long replies spoken in pieces; `toSpeakable` removes markdown symbols, code blocks and addresses first).
4. If **Listen again** is on, it starts listening again after the voice finishes, so the conversation continues hands-free. **On an iPhone/iPad this is switched off by default and does not work** (the browser cannot listen while speaking): each turn needs a tap. Tapping the button while it speaks **interrupts** it and listens.
5. **End conversation** (needs at least one reply): `POST /api/notes/from-conversation { sessionId }` reads the saved session (the caller's own, or a project they own; not deleted), at least two messages, and returns a **proposal**: `{ title, body, todos, summarised, count }` where `body` is `Summary:`, `Decisions:`, `To do:` (as `- [ ]` tick-boxes), then `— Conversation —` and the whole exchange by speaker. The light model writes the summary from what was said only (no invented decisions or to-dos); if it fails or returns nothing usable, the proposal is the exchange alone (`summarised: false`) and can still be saved. The chat saves its messages just after a reply, so the screen retries once if it asks too quickly.
6. **TalkReviewPanel**: edit the title and text, pick a project and a client, then **Save as a note** (an ordinary `POST /api/notes`; then the note opens, where **Make tasks** turns the to-do lines into linked tasks), **Keep talking**, or **Do not save** (the conversation stays in Chat History).

Switches (remembered per device, `vault:talk:prefs`): **Read aloud** (on), **Listen again** (on, off on iPhone), **My notes** (off). **Type instead** sends typed questions the same way. The screen is kept awake (Wake Lock) while talking.

## Help built in (keep these in step with the screen)

Like Notes and the other tools: a hover tip on every control (`talk/talkTips.mjs`, the shared Tooltip, never a native `title`), the (i) **How Talk it through works** box that opens once per browser (`talk/talkInfo.mjs`, key `vault_talk_info_seen`), a 6-step compass tour (`client/src/utils/tours/talkTour.js`, key `vault_tour_talk_completed`, retake from **Settings -> Tours -> Talk Tour** which opens `/talk?tour=1`), and the **Notes guide** round button (the same guide as Notes, which knows Talk it through: `POST /api/notes-tutor`, catalogue entry `talk` in `server/services/notesTutor.js` and `client/src/pages/notes/notesTools.mjs`; its Open buttons for Notes controls take the person to Notes). `talk/talkTips.test.mjs` fails if a tip is unused or missing, a native title appears, a tour step points at nothing on the screen, the step count is wrong, or the Settings card is gone. **When the screen changes, update the tips, the info box, the tour, the guide entry and this file together.** The Notes tour, the Notes info box and the User Guide page also mention it.

## Limits

- Browser speech: Chrome, Edge and Safari can listen; Firefox cannot (the typing box is offered). The voice is the browser's built-in one (free, plain). A nicer server voice (the Music tool already has a text-to-speech provider) is a later option, with a small cost per reply.
- Speech recognition in Chrome sends the audio to Google; the questions and replies go to the AI service like any chat.
- Not built: speaking over the voice to interrupt (a tap is needed), starting a conversation from inside a project or with a chosen model, a spoken "end the conversation" command, saving the audio, speaker names.
- **Not verified on a phone**: only a desktop browser and the tests below. The iPhone behaviour above is from how that browser works, not from a device.

## Tests

`npm run test:notes`: `conversationNote.test.js` (the summary rules and fallbacks), the route test in `notes.test.js` (own conversation only, proposal not saved, nothing-to-write-up), `chatNotes.test.js` (the spoken-style block, only when exactly `true`, with My notes), `talkUtils.test.mjs` (spoken text, pieces, iPhone check, switches), `talkTips.test.mjs` (a tip on every control).
