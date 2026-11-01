'use strict';

// One call to Gemini with a public YouTube address as the video input ("Gemini watches the video"). Plain https, no SDK, so the exact request is
// visible and testable. The request and the error wording are pure and tested in geminiVideo.test.js; `send` (the real network call) is passed in.
// Pictures are not needed for a transcript, so the video is read at LOW media resolution, which is about a third of the input tokens. A model that
// does not know that setting answers 400 naming it; we then ask again without it (and the cost estimate shown to the person already allows for it).
// When Google says the model is overloaded (503, "high demand") the request is repeated after a short wait, up to three tries in all, because those spikes
// are usually over within a minute; a job that still cannot run says so plainly and has cost nothing.

const https = require('https');

/** The JSON body for generateContent. */
function buildRequest({ url, prompt, maxOutputTokens, lowResolution = true }) {
  const generationConfig = { temperature: 0, maxOutputTokens, responseMimeType: 'application/json' };
  if (lowResolution) generationConfig.mediaResolution = 'MEDIA_RESOLUTION_LOW';
  return {
    contents: [{ role: 'user', parts: [{ fileData: { fileUri: url } }, { text: prompt }] }],
    generationConfig,
  };
}

const BUSY_WAITS_MS = [5000, 15000]; // before the second and third tries

/** Google's "try again later" answers: the model is overloaded or briefly unavailable. */
function isBusy(status, message) {
  return status === 503 || /high demand|overloaded|currently experiencing|try again later|temporarily unavailable/i.test(String(message || '')) && status >= 500;
}

/** Gemini's failure as a sentence a person can act on. */
function explainError(status, message) {
  const m = String(message || '');
  if (isBusy(status, m)) return 'Gemini is very busy right now (Google says demand is high). Nothing was charged. Try again in a few minutes.';
  if (status === 429 || /quota|resource.?exhausted|rate.?limit/i.test(m)) return "Gemini's allowance is used up or it is busy. Try again in a few minutes.";
  if (/private|unavailable|not found|cannot access|can't access|permission|forbidden|age|blocked/i.test(m) && status >= 400 && status < 500) {
    return 'Gemini could not open this video. It may be private, age-restricted or blocked. Only public videos work.';
  }
  if (status === 401 || status === 403) return 'Gemini refused the request. Check that the Gemini key is set up and allowed to read YouTube videos.';
  return `Gemini could not write the transcript${m ? `: ${m.slice(0, 200)}` : '.'}`;
}

function defaultSend(model, apiKey, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'x-goog-api-key': apiKey },
      timeout: timeoutMs,
    }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(out); } catch (_) { /* not JSON */ }
        resolve({ status: res.statusCode, json, raw: out });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Gemini took too long to answer.')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Ask Gemini to watch a video and return what it wrote.
 * @returns {Promise<{ text:string, inputTokens:number, outputTokens:number, finishReason:string }>}
 */
async function watchVideo({ apiKey, model, url, prompt, maxOutputTokens, timeoutMs = 9 * 60 * 1000, send = defaultSend, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), busyWaits = BUSY_WAITS_MS }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');
  if (!model) throw new Error('No Gemini model is set up in Settings.');
  let resolution = true;
  let busyTries = 0;
  for (let attempt = 0; attempt < 2 + busyWaits.length; attempt++) {
    const r = await send(model, apiKey, buildRequest({ url, prompt, maxOutputTokens, lowResolution: resolution }), timeoutMs);
    if (r.status >= 200 && r.status < 300 && r.json) {
      const cand = r.json.candidates && r.json.candidates[0];
      const text = ((cand && cand.content && cand.content.parts) || []).map((p) => p.text || '').join('').trim();
      if (!text) {
        const why = (r.json.promptFeedback && r.json.promptFeedback.blockReason) || (cand && cand.finishReason) || 'an empty answer';
        throw new Error(`Gemini returned nothing (${why}).`);
      }
      const u = r.json.usageMetadata || {};
      return { text, inputTokens: Number(u.promptTokenCount) || 0, outputTokens: Number(u.candidatesTokenCount) || 0, finishReason: (cand && cand.finishReason) || '' };
    }
    const message = r.json && r.json.error && r.json.error.message;
    if (resolution && r.status === 400 && /media.?resolution/i.test(String(message || ''))) { resolution = false; continue; }
    if (isBusy(r.status, message) && busyTries < busyWaits.length) { await sleep(busyWaits[busyTries]); busyTries += 1; continue; }
    throw new Error(explainError(r.status, message));
  }
  throw new Error('Gemini could not write the transcript.');
}

module.exports = { BUSY_WAITS_MS, isBusy, buildRequest, explainError, watchVideo };
