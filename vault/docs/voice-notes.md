# Voice notes

A **mic button** beside "+" (New note) in the Notes list, and a **New Voice Note** button on the empty Notes screen, open a recorder. Talk through a plan, an idea, or a chat across a table; when you press **Stop and make the note**, the words are written into a new note. Notes made this way show an **audio-lines icon** in the list and a "Voice note" chip above the editor.

Private-use tool, not a legal record: there is no consent workflow, speaker identification or audit trail. The recorder says "let people know you are recording".

## What is kept

**Only the text.** The recording is held in memory while it is turned into text, then discarded (the temporary folder is removed after the request). No audio is stored, so the icon means "made from a recording", not "has audio to play". If you ever want replayable audio, that is a new storage decision (attachments quota, `server/utils/attachments.js`).

## How it works

1. `client/src/pages/notes/VoiceNoteRecorder.jsx`: `MediaRecorder` (WebM/Opus, or MP4 on Safari), pause/resume, a level bar so you can see the mic is picking you up, a one-hour limit (auto-stops and makes the note), a leave-the-page warning. If the upload or write-up fails the recording is kept in memory and **Try again** resends it. Pure helpers in `voiceNoteUtils.mjs`.
2. `POST /api/notes/voice` (`server/routes/notes.js`, multipart `audio`, optional `tidy=false`): `ffmpeg` turns the recording into a small mono MP3 (`toSpeechMp3`), over about 18 MB of speech (about 75 minutes) is refused, and it is sent to Gemini for a word-for-word transcript (`transcribeAudioWithGemini`, the same service as Video Tools' Audio to transcript). Silence gives a 422 and nothing is saved.
3. **Tidy up** (default on, `server/services/voiceNote.js`): the workspace `light` model rewrites the rambling transcript as a note with plain-text sections (Summary / Ideas / Plan / To do / Open questions, only those that apply) and a short title. It is told not to add facts, names or tasks that were not said. The reply is bounded and checked.
4. The note body is the tidy version, then a divider (`— What was said —`) and the original words, so nothing is lost and it all stays searchable. With tidy off (or if the model fails or returns nothing usable) the body is just the words as spoken, titled "Voice note, 19 Oct 2:35 pm".

`notes.source` (`'text'` or `'voice'`, new column in `server/db.js`) marks voice notes.

## Needs

- **ffmpeg** (Railway has it) and the **Gemini speech setup** (`GEMINI_API_KEY` and a Gemini model in Settings). Without them the route answers 503 with a plain message. Not usable on a dev machine without both.
- A secure page (https or localhost) and a browser that allows the microphone.
- Cost: one speech-to-text call and, with tidy on, one light-model call per note.

## Limits and not built

- About an hour per recording; split longer ones.
- The transcript may label speakers ("Speaker 1:") when it can, but it does not know names.
- Not built: replayable audio, converting action items to Tasks in one click (Notes already has "Convert to task" on a note), linking a recording to a calendar event or a client, a background job for very long recordings.

## The Notes guide

A round guide button on the Notes page (`NotesTutorChat.jsx`, `POST /api/notes-tutor`) answers "how do I..." questions about Notes, including voice notes and the difference between the two mic buttons. See `docs/guide-chat.md` ("The Notes guide"); `npm run test:notes-tutor`.

## Tests

`npm run test:notes-voice`: `server/routes/notesVoice.test.js` (the route with ffmpeg, speech-to-text and the model faked: no file, service not set up, the normal case, tidy off, model failure, silence, too long, audio files deleted) and `client/src/pages/notes/voiceNoteUtils.test.mjs`.

**Not verified:** a real recording in a browser, real Gemini transcription, and the tidy result on real speech.
