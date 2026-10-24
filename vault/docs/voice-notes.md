# Voice notes

Press **+** in the Notes list and choose **Record a voice note** (or use the **New Voice Note** button on the empty Notes screen) to open a recorder. Talk through a plan, an idea, or a chat across a table; when you press **Stop and make the note**, the words are written into a new note. Notes made this way show an **audio-lines icon** in the list and a "Voice note" chip above the editor.

Private-use tool, not a legal record: there is no consent workflow, speaker identification or audit trail. The recorder says "let people know you are recording".

## Starting a note: the + choice

The **+** at the top of the notes list (on a phone it reads **+ New**) opens a small choice (`client/src/pages/notes/NewNoteChooser.jsx`; a sheet from the bottom on a phone, a centred card on a bigger screen): **Write a note** or **Record a voice note**.

- **Write a note** makes the note and opens it with the cursor in the **title** (the word "Untitled" is selected, so typing replaces it), then the text. On a phone, tapping the choice keeps the keyboard up while the note is made (a hidden input is focused inside the tap), so the title is ready to type into.
- **Record a voice note** opens the recorder. The tidied-up note comes with a title; edit it in the editor.

The empty "Select a note" screen still has direct **New Note** and **New Voice Note** buttons.

## On a phone

The Notes page has its own phone layout (under 640 px wide). The list opens as a drawer. An open note has a clear title field, a visible writing box, and a bar at the bottom in thumb reach with **Type** (opens the keyboard) and **Dictate** (speaks into the note; it says **Stop** while listening). The bar leaves room for the guide's round button. The toolbar is icons only (Convert to task, Take to chat). A note that has no title is listed by its first line (`client/src/pages/notes/noteListText.mjs`; display only, nothing is renamed). Checked at 390 px wide in a real browser (Playwright, fake microphone), not on a physical phone; whether an iPhone keeps its keyboard up through the + choice is not confirmed.

## What is kept

**By default, only the text.** The recording is held in memory while it is turned into text, then discarded (the temporary folder is removed after the request).

**Audio kept on purpose (2026-10-24).** Before recording, the recorder asks **The recording itself**: *Don't keep the audio* (the default), *Keep it for 7 days* (`VOICE_AUDIO_DAYS` changes the 7), or *Keep it until I delete it* (field `keep` = `no` | `7d` | `forever`; remembered per device in `localStorage` `vault:notes:voice-prefs`). The choice has to be made **before** recording: audio that is thrown away cannot be kept afterwards.
- Stored as a note attachment (`attachments.kind = 'voice'`, `attachments."expiresAt"` NULL for "until deleted"): same disk folder and per-person quota as other note files (`saveVoiceAudio` in `server/utils/attachments.js`), original format (WebM/MP4), named "Voice note 24 Oct 2.35 pm.webm". If the quota is full or the disk fails the **note is still made** and the response says `audioNotKept` (the screen shows it).
- On the note: a **Recording** box (`VoiceAudioCard.jsx`) with a Play button (the audio is only downloaded when pressed, good on mobile data), how long it has left, **Keep it for good** (`PATCH /api/notes/:id/audio/:attachmentId { keep }`) and **Remove the recording** (`DELETE /api/attachments/:id`). It is not shown among the file chips and is not read by Ask (it is audio, there is no text in it).
- When the time is up: the list leaves it out and the download refuses it at once (`expiresAt > NOW()` checks), and `server/cron/attachmentExpiryCron.js` (hourly, runs on every server) deletes the file and the row. A note in the recycle bin keeps no audio past its expiry.
- Deleting the note keeps its files in the bin like any other attachment (see `docs/notes.md`).

## How it works

0. **Start first, choices tucked away** (idle screen): a big Start button, then one line ("Written up as Notes, audio not kept") with **Change** that opens the two choices below. The write-up style is not final: **Write up again…** (toolbar of any voice note, `VoiceRewritePanel.jsx`, `POST /api/notes/:id/rewrite { style }`) writes the same recording up another way from the words that were said (`splitSpoken`: everything under the "What was said" divider), shows a line diff of what would change, and only on **Use this version** applies it through the AI-change path (`versionReason: 'ai'`: Undo AI change and Earlier versions bring the old text back). *Just my words* needs no model; a failed write-up is a 502, never a blank note. The audio choice cannot be changed afterwards, because audio that was not kept is gone. The two choices: *Write it up as* (Notes / Update / To-do list / Meeting notes / Just my words; field `style`, the old `tidy=false` still means Just my words) and *The recording itself* (above). Both remembered on the device. Styles are in `server/services/voiceNote.js` (`STYLE_SYSTEMS`); every style keeps the no-inventing rule and the original words below the write-up.
1. `client/src/pages/notes/VoiceNoteRecorder.jsx`: `MediaRecorder` (WebM/Opus, or MP4 on Safari), pause/resume, a level bar so you can see the mic is picking you up, a one-hour limit (auto-stops and makes the note), a leave-the-page warning. If the upload or write-up fails the recording is kept in memory and **Try again** resends it. Pure helpers in `voiceNoteUtils.mjs`.
2. `POST /api/notes/voice` (`server/routes/notes.js`, multipart `audio`, optional `tidy=false`): `ffmpeg` turns the recording into a small mono MP3 (`toSpeechMp3`), over about 18 MB of speech (about 75 minutes) is refused, and it is sent to Gemini for a word-for-word transcript (`transcribeAudioWithGemini`, the same service as Video Tools' Audio to transcript). Silence gives a 422 and nothing is saved.
3. **Tidy up** (default on, `server/services/voiceNote.js`): the workspace `light` model rewrites the rambling transcript as a note with plain-text sections (Summary / Ideas / Plan / To do / Open questions, only those that apply) and a short title. It is told not to add facts, names or tasks that were not said. The reply is bounded and checked.
4. The note body is the tidy version, then a divider (`— What was said —`) and the original words, so nothing is lost and it all stays searchable. With tidy off (or if the model fails or returns nothing usable) the body is just the words as spoken, titled "Voice note, 19 Oct 2:35 pm".

`notes.source` (`'text'` or `'voice'`, new column in `server/db.js`) marks voice notes.

## Phone and safety (2026-10-24)

- **Never lose a recording**: every second of audio is also written to the browser's own storage on the device (`voiceRecovery.js`, IndexedDB). If the page closes, the phone crashes or the tab is killed, opening the recorder again offers **Make the note** or **Throw it away** (a stray second or two is ignored). Cleared when the note is made or the recording discarded. A new recording replaces an older leftover.
- **Screen stays on** while recording (Wake Lock, where the phone supports it). If the phone stops the recorder anyway (screen locked, another app took the microphone), what was recorded so far is kept and the recorder offers **Make the note** from it.
- **Phone layout**: the recorder and the to-dos list open as bottom sheets, big buttons and 16 px fields. `/notes?record=1` opens the recorder straight away; the mobile home screen's Notes tile has a **Record** button that goes there. **Not checked on a physical phone** (only a desktop browser with a fake microphone).
- **Names**: the person's client, project and contact names are sent to the speech-to-text and the write-up (`voiceAudio.js` `namesLine`, up to 80, sanitised so a name can never add a line to the instruction) so they are spelled right.
- **To-dos**: after the note is made, the to-dos the write-up found (the bullets under *To do*, *Next steps* or *Actions*, `extractTodos`) are listed with a tick each (`VoiceTodosPanel.jsx`); *Add to Tasks* creates a task for each ticked one (`POST /api/tasks`, filed under the note's project and client). Nothing is created until pressed; the note is not changed.

## Needs

- **ffmpeg** (Railway has it) and the **Gemini speech setup** (`GEMINI_API_KEY` and a Gemini model in Settings). Without them the route answers 503 with a plain message. Not usable on a dev machine without both.
- A secure page (https or localhost) and a browser that allows the microphone.
- Cost: one speech-to-text call and, with tidy on, one light-model call per note.

## Limits and not built

- About an hour per recording; split longer ones.
- The transcript may label speakers ("Speaker 1:") when it can, but it does not know names.
- Not built: keeping a recording **after** the note is made (the choice is made before), live words on screen while recording (iPhones cannot run speech recognition and a recording at once), choosing the client/project by voice, linking a recording to a calendar event, a background job for very long recordings, dictation (the other mic) inserting at the cursor.

## The Notes guide

A round guide button on the Notes page (`NotesTutorChat.jsx`, `POST /api/notes-tutor`) answers "how do I..." questions about Notes, including voice notes and the difference between the two mic buttons. See `docs/guide-chat.md` ("The Notes guide"); `npm run test:notes-tutor`.

## Tests

`npm run test:notes-voice`: `server/routes/notesVoice.test.js` (the route with ffmpeg, speech-to-text and the model faked: no file, service not set up, the normal case, tidy off, model failure, silence, too long, audio files deleted) and `client/src/pages/notes/voiceNoteUtils.test.mjs`.

`server/services/voiceAudio.test.js` (keep rules, names, styles, to-do extraction), the voice route test (styles, names, keep for a week / for good / storage full), and in `server/routes/notes.test.js` kept audio against the real database (listed, played, kept for good, extended, expired, cleaned up, private). `client/src/pages/notes/voiceNoteUtils.test.mjs` covers the remembered choices and wording.

**Checked in a real desktop browser with a fake microphone** (a generated tone): options remembered, recording saved on the device each second, a force-closed page offered the recording back, the right `style`/`keep` and the recovered audio sent, the to-dos list creating tasks, the Recording box playing and keeping for good.

**Not verified:** a real microphone on a phone (iPhone Safari especially), real Gemini transcription, and the write-up styles on real speech.
