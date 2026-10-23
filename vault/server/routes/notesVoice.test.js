'use strict';

// node server/routes/notesVoice.test.js   (npm run test:notes-voice)
// Voice notes: the pure pieces, and POST /api/notes/voice through the real router with ffmpeg, speech-to-text and the model
// faked (so it runs anywhere, with no database or network).

const assert = require('assert');
const path = require('path');
const fsp = require('fs/promises');

const V = path.join(__dirname, '..');
const inserts = [];
const attachmentInserts = [];
let quotaUsed = 0;
let knownNames = [];
const os = require('os');
process.env.UPLOAD_DIR = require('fs').mkdtempSync(path.join(os.tmpdir(), 'vault-voice-test-'));
const dbPath = require.resolve(path.join(V, 'db'));
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    pool: {
      query: async (sql, params) => {
        if (/INSERT INTO notes/.test(sql)) {
          inserts.push({ sql, params });
          return { rows: [{ id: 41, user_id: params[0], title: params[1], body: params[2], source: 'voice', project_id: null, client_id: null }] };
        }
        if (/SUM\("sizeBytes"\)/.test(sql)) return { rows: [{ total: quotaUsed }] };
        if (/INSERT INTO attachments/.test(sql)) {
          attachmentInserts.push({ sql, params });
          return { rows: [{ id: 99, entityId: params[1], filename: params[2], mimeType: params[4], sizeBytes: params[5], kind: 'voice', expiresAt: params[6] }] };
        }
        if (/FROM clients WHERE/.test(sql)) return { rows: knownNames.map((name) => ({ name })) };
        return { rows: [] };
      },
    },
  },
};

const ffmpeg = require(path.join(V, 'services/videoFfmpeg'));
const speechDirs = [];
let speechBytes = 1000;
ffmpeg.checkFfmpeg = async () => true;
ffmpeg.toSpeechMp3 = async (inPath, outPath) => { speechDirs.push(path.dirname(outPath)); await fsp.writeFile(outPath, Buffer.alloc(speechBytes, 1)); };

const gen = require(path.join(V, 'services/videoGenerateService'));
let geminiOk = true;
let transcriptText = 'so I was thinking we should move the launch to March um and maybe call Sam about the budget';
const transcribed = [];
gen.isGeminiTranscribeAvailable = async () => geminiOk;
gen.transcribeAudioWithGemini = async (userId, b64, mime, opts) => { transcribed.push({ userId, mime, opts, bytes: Buffer.from(b64, 'base64').length }); return transcriptText; };

// the model used for tidying (loaded lazily by voiceNote.js, so patching the module objects is enough)
let modelReply = JSON.stringify({ title: 'Move the launch to March', body: 'Summary:\nMove the launch to March.\n\nTo do:\n- Call Sam about the budget' });
let modelFails = false;
const modelCalls = [];
require(path.join(V, 'services/modelResolver')).getModelsForUser = async () => ({ light: 'light-model' });
require(path.join(V, 'services/callModel')).callModel = async (model, prompt, opts) => {
  modelCalls.push({ model, prompt, opts });
  if (modelFails) throw new Error('model down');
  return { text: modelReply, model, inputTokens: 5, outputTokens: 5 };
};
require(path.join(V, 'utils/logUsage')).logUsage = () => {};

const VN = require(path.join(V, 'services/voiceNote'));
const express = require('express');
const router = require(path.join(V, 'routes/notes.js'));

let passed = 0;
const ok = (name) => { passed += 1; console.log(`ok - ${name}`); };

// ---- the pure pieces ----
assert.deepStrictEqual(VN.normalizeTidyReply('{"title":"  A  plan \\n","body":"Summary:\\nHello"}'), { title: 'A plan', body: 'Summary:\nHello' });
assert.deepStrictEqual(VN.normalizeTidyReply('```json\n{"title":"T","body":"Some body"}\n```'), { title: 'T', body: 'Some body' }, 'a fenced reply works');
assert.strictEqual(VN.normalizeTidyReply('{"title":"T","body":""}'), null, 'no body, no note');
assert.strictEqual(VN.normalizeTidyReply('sorry'), null);
assert.strictEqual(VN.normalizeTidyReply('{"title":"' + 'x'.repeat(300) + '","body":"b b b"}').title.length, 80, 'a title is bounded');
assert.match(VN.defaultVoiceTitle(new Date(2026, 9, 19, 14, 35)), /^Voice note, 19 Oct 2:35 pm$/);
assert.strictEqual(VN.composeBody({ tidy: 'Summary:\nX', transcript: 'raw words' }), `Summary:\nX\n\n${VN.TRANSCRIPT_DIVIDER}\nraw words`, 'the tidy version first, then what was said');
assert.strictEqual(VN.composeBody({ tidy: null, transcript: 'raw words' }), 'raw words');
assert.match(VN.TIDY_SYSTEM, /Do NOT add facts/);
ok('voice note: tidy reply is bounded and checked; title and body are put together');

(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _r, n) => { req.user = { id: 7 }; n(); });
  app.use('/api/notes', router);
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}/api/notes`;
  const send = async (opts = {}) => {
    const fd = new FormData();
    if (opts.audio !== false) fd.append('audio', new Blob([Buffer.from('fake-recording')], { type: 'audio/webm' }), 'recording.webm');
    if (opts.tidy !== undefined) fd.append('tidy', opts.tidy);
    if (opts.style !== undefined) fd.append('style', opts.style);
    if (opts.keep !== undefined) fd.append('keep', opts.keep);
    return fetch(`${base}/voice`, { method: 'POST', body: fd });
  };
  const reset = () => { attachmentInserts.length = 0; quotaUsed = 0; knownNames = []; inserts.length = 0; transcribed.length = 0; modelCalls.length = 0; speechDirs.length = 0; modelFails = false; geminiOk = true; speechBytes = 1000; modelReply = JSON.stringify({ title: 'Move the launch to March', body: 'Summary:\nMove the launch to March.\n\nTo do:\n- Call Sam about the budget' }); };

  try {
    // nothing recorded
    reset();
    let r = await send({ audio: false });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(inserts.length, 0);
    ok('no recording -> 400, nothing saved');

    // speech-to-text not set up
    reset(); geminiOk = false;
    r = await send();
    assert.strictEqual(r.status, 503);
    assert.match((await r.json()).error, /speech-to-text/);
    assert.strictEqual(inserts.length, 0);
    ok('speech-to-text not set up -> 503 with a plain message');

    // the normal case: tidy on
    reset();
    r = await send();
    let note = await r.json();
    assert.strictEqual(r.status, 201);
    assert.strictEqual(inserts.length, 1);
    assert.strictEqual(inserts[0].params[0], 7, 'saved for the signed-in person');
    assert.strictEqual(note.source, 'voice');
    assert.strictEqual(note.tidied, true);
    assert.strictEqual(note.title, 'Move the launch to March');
    assert.ok(note.body.startsWith('Summary:\nMove the launch to March.') && note.body.includes(VN.TRANSCRIPT_DIVIDER) && note.body.endsWith(transcriptText), 'tidy version, then the words as spoken');
    assert.deepStrictEqual([transcribed[0].userId, transcribed[0].mime, transcribed[0].opts], [7, 'audio/mp3', { format: 'text', hints: '' }]);
    assert.strictEqual(modelCalls[0].model, 'light-model', 'the workspace light model does the tidying');
    assert.match(modelCalls[0].prompt, /move the launch to March/);
    ok('a recording becomes a tidied voice note with the original words kept below');

    // the audio does not outlive the request
    let gone = false;
    for (let i = 0; i < 30 && !gone; i += 1) { // the folder is removed just after the request finishes
      gone = await fsp.access(speechDirs[0]).then(() => false, () => true);
      if (!gone) await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(gone, 'the temporary folder holding the audio is deleted');
    ok('the recording\'s temporary files are deleted');

    // tidy off
    reset();
    r = await send({ tidy: 'false' });
    note = await r.json();
    assert.strictEqual(r.status, 201);
    assert.strictEqual(note.body, transcriptText, 'the words exactly as spoken');
    assert.match(note.title, /^Voice note, /);
    assert.strictEqual(note.tidied, false);
    assert.strictEqual(modelCalls.length, 0, 'no model call when tidy is off');
    ok('tidy off: the words as spoken, no model used');

    // the model fails: the words are still saved
    reset(); modelFails = true;
    r = await send();
    note = await r.json();
    assert.strictEqual(r.status, 201);
    assert.strictEqual(note.body, transcriptText);
    assert.strictEqual(note.tidied, false);
    ok('a failed tidy-up still saves what was said');

    // nonsense from the model
    reset(); modelReply = 'I cannot do that';
    r = await send();
    note = await r.json();
    assert.strictEqual(note.body, transcriptText);
    ok('an unusable tidy-up reply falls back to the words as spoken');

    // the write-up style: a different instruction for the model, the same rules about not adding anything
    reset();
    r = await send({ style: 'update' });
    note = await r.json();
    assert.strictEqual(r.status, 201);
    assert.match(modelCalls[0].opts.system, /status update/);
    assert.match(modelCalls[0].opts.system, /Do NOT add facts/);
    assert.deepStrictEqual(note.todos, ['Call Sam about the budget'], 'to-dos are offered, not made');
    ok('a chosen style changes what the model is asked to write, and the to-dos are listed');
    reset();
    r = await send({ style: 'words' });
    note = await r.json();
    assert.strictEqual(modelCalls.length, 0, 'the words-only style uses no model');
    assert.strictEqual(note.body, transcriptText);
    assert.deepStrictEqual(note.todos, []);
    ok('"just the words" uses no model');

    // names from the person's own data go to the speech-to-text and the write-up
    reset(); knownNames = ['Acme Pty Ltd', 'Hendersons'];
    r = await send();
    await r.json();
    assert.match(transcribed[0].opts.hints, /Acme Pty Ltd, Hendersons/);
    assert.match(modelCalls[0].opts.system, /Names that may be spoken.*Acme Pty Ltd/);
    ok('the client and project names are given to the transcription and the write-up');

    // keeping the audio: not by default, for a while, or for good; a full store never loses the note
    reset();
    r = await send();
    note = await r.json();
    assert.strictEqual(attachmentInserts.length, 0, 'by default nothing is kept');
    assert.strictEqual(note.audio, null);
    reset();
    r = await send({ keep: '7d' });
    note = await r.json();
    assert.strictEqual(attachmentInserts.length, 1);
    const days = (new Date(attachmentInserts[0].params[6]) - Date.now()) / 86400000;
    assert.ok(days > 6.9 && days < 7.1, 'removed after about seven days');
    assert.match(attachmentInserts[0].params[2], /^Voice note .*\.webm$/);
    assert.strictEqual(note.audio.kind, 'voice');
    assert.strictEqual(note.attachments.length, 1);
    reset();
    r = await send({ keep: 'forever' });
    note = await r.json();
    assert.strictEqual(attachmentInserts[0].params[6], null, 'no expiry');
    reset(); quotaUsed = 10 * 1024 * 1024 * 1024;
    r = await send({ keep: 'forever' });
    note = await r.json();
    assert.strictEqual(r.status, 201, 'the note is still made');
    assert.strictEqual(note.audio, null);
    assert.match(note.audioNotKept, /storage is full/);
    assert.strictEqual(attachmentInserts.length, 0);
    ok('audio is kept only when asked: for seven days or for good; a full store keeps the note and says so');

    // silence
    reset(); transcriptText = '   ';
    r = await send();
    assert.strictEqual(r.status, 422);
    assert.match((await r.json()).error, /No speech was heard/);
    assert.strictEqual(inserts.length, 0, 'nothing is saved for silence');
    transcriptText = 'back to normal';
    ok('silence -> 422, nothing saved');

    // too long
    reset(); speechBytes = 19 * 1024 * 1024;
    r = await send();
    assert.strictEqual(r.status, 413);
    assert.match((await r.json()).error, /too long/);
    assert.strictEqual(inserts.length, 0);
    assert.strictEqual(transcribed.length, 0, 'too-long audio is not sent to the speech service');
    ok('over about an hour -> 413, not sent for transcription');
  } catch (err) {
    console.error(err);
    server.close();
    process.exit(1);
  }
  server.close();
  console.log(`${passed} passed`);
  process.exit(0);
})();
