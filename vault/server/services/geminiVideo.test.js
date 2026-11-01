'use strict';
// node server/services/geminiVideo.test.js   (part of npm run test:youtube). No network: a fake `send` stands in for Google.
const assert = require('node:assert/strict');
const G = require('./geminiVideo');

// ---- the request
const req = G.buildRequest({ url: 'https://www.youtube.com/watch?v=abc', prompt: 'P', maxOutputTokens: 1234 });
assert.equal(req.contents[0].parts[0].fileData.fileUri, 'https://www.youtube.com/watch?v=abc', 'the video is given as a YouTube address');
assert.equal(req.contents[0].parts[1].text, 'P');
assert.equal(req.generationConfig.mediaResolution, 'MEDIA_RESOLUTION_LOW');
assert.equal(req.generationConfig.responseMimeType, 'application/json');
assert.equal(req.generationConfig.temperature, 0);
assert.equal(req.generationConfig.maxOutputTokens, 1234);
assert.equal(G.buildRequest({ url: 'u', prompt: 'p', maxOutputTokens: 1, lowResolution: false }).generationConfig.mediaResolution, undefined);

// ---- errors in plain words
assert.match(G.explainError(429, 'x'), /allowance is used up or it is busy/);
assert.match(G.explainError(400, 'Video is private'), /private, age-restricted or blocked/);
assert.match(G.explainError(403, 'permission denied'), /private, age-restricted or blocked/);
assert.match(G.explainError(401, 'bad key'), /Gemini key/);
assert.match(G.explainError(500, 'boom'), /could not write the transcript: boom/);
assert.match(G.explainError(500, ''), /could not write the transcript\.$/);

(async () => {
  const ok = (text, extra = {}) => ({ status: 200, json: { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 60000, candidatesTokenCount: 3000 }, ...extra } });

  // happy path
  let seen = null;
  let r = await G.watchVideo({ apiKey: 'k', model: 'gemini-x', url: 'u', prompt: 'p', maxOutputTokens: 10, send: async (model, key, body) => { seen = { model, key, body }; return ok('[{"start":"0:00","text":"hi"}]'); } });
  assert.deepEqual(r, { text: '[{"start":"0:00","text":"hi"}]', inputTokens: 60000, outputTokens: 3000, finishReason: 'STOP' });
  assert.equal(seen.model, 'gemini-x');
  assert.equal(seen.key, 'k');

  // a model that does not know the picture-quality setting: asked again without it
  const bodies = [];
  r = await G.watchVideo({ apiKey: 'k', model: 'm', url: 'u', prompt: 'p', maxOutputTokens: 10, send: async (model, key, body) => {
    bodies.push(body);
    return bodies.length === 1 ? { status: 400, json: { error: { message: 'Unknown name "mediaResolution" at generation_config' } } } : ok('[]');
  } });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].generationConfig.mediaResolution, 'MEDIA_RESOLUTION_LOW');
  assert.equal(bodies[1].generationConfig.mediaResolution, undefined, 'the retry leaves the setting out');

  // other failures are not retried
  let calls = 0;
  await assert.rejects(() => G.watchVideo({ apiKey: 'k', model: 'm', url: 'u', prompt: 'p', maxOutputTokens: 10, send: async () => { calls += 1; return { status: 429, json: { error: { message: 'quota' } } }; } }), /allowance is used up/);
  assert.equal(calls, 1);

  // an empty or blocked answer
  await assert.rejects(() => G.watchVideo({ apiKey: 'k', model: 'm', url: 'u', prompt: 'p', maxOutputTokens: 10, send: async () => ({ status: 200, json: { candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] } }) }), /returned nothing \(SAFETY\)/);

  // not set up
  await assert.rejects(() => G.watchVideo({ apiKey: '', model: 'm', url: 'u', prompt: 'p', maxOutputTokens: 1 }), /GEMINI_API_KEY/);
  await assert.rejects(() => G.watchVideo({ apiKey: 'k', model: '', url: 'u', prompt: 'p', maxOutputTokens: 1 }), /No Gemini model/);

  console.log('geminiVideo: ok');
})().catch((e) => { console.error(e); process.exit(1); });
