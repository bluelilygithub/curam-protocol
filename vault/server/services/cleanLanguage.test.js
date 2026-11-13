// node server/services/cleanLanguage.test.js
// "Remove swearing": which words count, transcript cleaning, reading word times from Whisper outputs, bleep windows and the
// ffmpeg filter. The ffmpeg part runs for real when ffmpeg is installed (LOCAL_FFMPEG_COMMAND / LOCAL_FFPROBE_COMMAND locally).
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const cl = require('./cleanLanguage');

(async () => {
  // ---- which words ----
  const strong = cl.makeMatcher();
  for (const w of ['fuck', 'Fucking', 'motherfucker', 'shit!', 'bullshit', 'cunt', 'bitch', 'arsehole', 'dickhead', 'wankers']) assert.ok(strong(w), `${w} should count`);
  for (const w of ['class', 'assess', 'Scunthorpe', 'cocktail', 'hello', 'shell', 'Dickens', 'passed', 'title', 'bass', 'hell', 'damn']) assert.ok(!strong(w), `${w} should not count`);
  const mild = cl.makeMatcher({ mild: true });
  for (const w of ['damn', 'hell', 'bloody', 'crap', 'pissed', 'bugger']) assert.ok(mild(w), `${w} should count with mild on`);
  assert.ok(!mild('hello') && !mild('shell'), 'mild words are whole words only');
  const own = cl.makeMatcher({ extra: 'frick, heck*', allow: 'dick' });
  assert.ok(own('frick') && own('heckin') && !own('dick') && own('dickhead'), 'own words and allowed words');
  assert.ok(!strong('f***'), 'an already masked word is left alone');

  // ---- transcripts ----
  assert.strictEqual(cl.cleanText('What the fuck is this shit?').text, 'What the f*** is this s***?');
  assert.strictEqual(cl.cleanText('Oh fuck, no.', { style: 'bleep' }).text, 'Oh [bleep], no.');
  assert.strictEqual(cl.cleanText('Oh fuck, no.', { style: 'remove' }).text, 'Oh, no.');
  const srt = '1\n00:00:01,000 --> 00:00:02,500\nWhat the fuck\n\n2\n00:00:03,000 --> 00:00:04,000\nall good\n';
  const cs = cl.cleanTranscript(srt);
  assert.strictEqual(cs.format, 'srt');
  assert.ok(cs.text.includes('00:00:01,000 --> 00:00:02,500\nWhat the f***'), 'times kept, words masked');
  assert.deepStrictEqual(cs.found, ['fuck']);

  // ---- word times from different Whisper outputs ----
  const fast = { text: 'oh shit', chunks: [{ text: ' oh', timestamp: [0.5, 0.8] }, { text: ' shit', timestamp: [0.9, 1.3] }] };
  assert.deepStrictEqual(cl.wordsFromOutput(fast), [{ word: 'oh', start: 0.5, end: 0.8 }, { word: 'shit', start: 0.9, end: 1.3 }]);
  const wx = { segments: [{ start: 0, end: 2, text: 'it is 2 shit', words: [{ word: 'it', start: 0.1, end: 0.2 }, { word: 'is', start: 0.3, end: 0.4 }, { word: '2' }, { word: 'shit', start: 1.0, end: 1.4 }] }] };
  const wxw = cl.wordsFromOutput(wx);
  assert.strictEqual(wxw.length, 4);
  assert.deepStrictEqual([wxw[2].start, wxw[2].end], [0.4, 1.0], 'an untimed word takes its neighbours\' times');
  assert.strictEqual(cl.wordsFromOutput({ word_segments: [{ word: 'fuck', start: 2, end: 2.3 }] })[0].start, 2);
  assert.deepStrictEqual(cl.wordsFromOutput('not json'), []);
  assert.deepStrictEqual(cl.wordsFromOutput({ transcription: 'no times here' }), []);

  // ---- model input from its schema ----
  assert.deepStrictEqual(cl.buildWhisperInput({ audio: {}, timestamp: { enum: ['chunk', 'word'] }, task: { enum: ['transcribe', 'translate'] } }, 'U'), { audio: 'U', timestamp: 'word', task: 'transcribe' });
  assert.deepStrictEqual(cl.buildWhisperInput({ audio_file: {}, align_output: {} }, 'U'), { audio_file: 'U', align_output: true });
  assert.deepStrictEqual(cl.buildWhisperInput({}, 'U'), { audio: 'U' });

  // ---- trying models in order ----
  const calls = [];
  const r = await cl.transcribeWords({
    audio: Buffer.from('x'), token: 't', models: ['a/broken', 'b/works'],
    deps: {
      upload: async () => 'https://api.replicate.com/v1/files/x',
      inputProps: async () => ({ audio: {}, timestamp: { enum: ['chunk', 'word'] } }),
      run: async ({ model, input }) => { calls.push([model, input.timestamp]); if (model === 'a/broken') throw new Error('boom'); return fast; },
    },
  });
  assert.strictEqual(r.model, 'b/works');
  assert.deepStrictEqual(calls, [['a/broken', 'word'], ['b/works', 'word']]);
  await assert.rejects(cl.transcribeWords({ audio: Buffer.from('x'), token: '' }), /REPLICATE_API_TOKEN/);
  await assert.rejects(cl.transcribeWords({ audio: Buffer.from('x'), token: 't', models: ['a/x'], deps: { upload: async () => 'u', inputProps: async () => ({}), run: async () => ({ text: 'no words' }) } }), (e) => /not working/.test(e.message) && /no timed words/.test(e.failures[0]));

  // ---- bleep windows and the filter ----
  const hits = cl.findSwearWords([{ word: 'oh', start: 0.5, end: 0.8 }, { word: 'fuck', start: 1, end: 1.3 }, { word: 'shit', start: 1.32, end: 1.6 }, { word: 'crap', start: 3, end: 3.2 }]);
  assert.deepStrictEqual(hits.map((h) => h.word), ['fuck', 'shit']);
  assert.deepStrictEqual(cl.bleepWindows(hits), [[0.94, 1.66]], 'touching words are merged');
  assert.deepStrictEqual(cl.bleepWindows([{ start: 0.02, end: 0.2 }], { durationSec: 0.15 }), [[0, 0.15]], 'never before 0 or past the end');
  assert.strictEqual(cl.audioFilter([], 'bleep'), '[0:a]anull[aout]');
  assert.ok(cl.audioFilter([[1, 2]], 'mute').endsWith('[aout]') && !cl.audioFilter([[1, 2]], 'mute').includes('sine'));
  assert.ok(cl.audioFilter([[1, 2], [3, 4]], 'bleep').includes("between(t,1,2)+between(t,3,4)"));
  const srtOut = cl.wordsToSrt([{ word: 'Hello', start: 0, end: 0.4 }, { word: 'there.', start: 0.5, end: 0.9 }, { word: 'Next', start: 1.2, end: 1.5 }]);
  assert.ok(srtOut.startsWith('1\n00:00:00,000 --> 00:00:00,900\nHello there.\n\n2\n00:00:01,200 --> 00:00:01,500\nNext'), srtOut);

  // ---- real ffmpeg (skipped when it is not installed) ----
  const { execFileSync, spawnSync } = require('child_process');
  const ffmpeg = process.env.LOCAL_FFMPEG_COMMAND || 'ffmpeg';
  let haveFfmpeg = true;
  try { execFileSync(ffmpeg, ['-version'], { stdio: 'ignore' }); } catch { haveFfmpeg = false; }
  if (haveFfmpeg) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-lang-'));
    try {
      const src = path.join(dir, 'src.mp4');
      // 4 s of a 440 Hz tone (stands in for speech) with a picture
      execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:d=4', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', src], { stdio: 'ignore' });
      const meanDb = (file, from, to) => {
        const res = spawnSync(ffmpeg, ['-ss', String(from), '-t', String(to - from), '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
        const m = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(res.stderr || '');
        return m ? (m[1] === '-inf' ? -200 : Number(m[1])) : NaN;
      };
      for (const mode of ['mute', 'bleep']) {
        const out = path.join(dir, `${mode}.mp4`);
        execFileSync(ffmpeg, cl.cleanArgs({ inputPath: src, outputPath: out, windows: [[1.5, 2.5]], mode, hasVideo: true }), { stdio: 'ignore' });
        const before = meanDb(out, 0.2, 1.2);
        const inside = meanDb(out, 1.7, 2.3);
        if (mode === 'mute') assert.ok(inside < before - 40, `mute: ${inside} dB inside vs ${before} dB before`);
        else assert.ok(inside > -40 && Math.abs(inside - before) < 20, `bleep: a tone inside (${inside} dB vs ${before} dB)`);
        const streams = spawnSync(ffmpeg, ['-i', out], { encoding: 'utf8' }).stderr;
        assert.ok(/Video: h264/.test(streams) && /Audio: aac/.test(streams), `${mode}: picture copied, sound re-encoded`);
      }
      // an audio file in -> an MP3 out
      const wav = path.join(dir, 'a.wav');
      execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=2', wav], { stdio: 'ignore' });
      const mp3 = path.join(dir, 'a.mp3');
      execFileSync(ffmpeg, cl.cleanArgs({ inputPath: wav, outputPath: mp3, windows: [[0.5, 1]], mode: 'bleep', hasVideo: false }), { stdio: 'ignore' });
      assert.ok(fs.statSync(mp3).size > 1000, 'audio result written');
      console.log('cleanLanguage: ffmpeg mute, bleep and audio checks ran');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } else {
    console.log('cleanLanguage: ffmpeg not installed, real-file checks skipped');
  }
  console.log('cleanLanguage: ok');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
