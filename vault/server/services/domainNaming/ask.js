'use strict';

// "Talk it through": the person adds detail or asks a question about the names so far. The answer is grounded in the names and what is
// known about them (a few lines each), never in anything the AI remembers about real availability. Nothing here changes a set: the page
// decides whether to keep the answer or to add the detail to the brief and make new names.

const { askPrompt } = require('./brief');

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

async function askAboutNames({ userId, brief, cards, history, question }, deps) {
  const q = clip(question, 800);
  if (q.length < 3) throw Object.assign(new Error('Type your question or the extra detail first.'), { status: 400 });
  const tiers = await deps.getModels(userId);
  const model = tiers && (tiers.standard || tiers.light);
  if (!model) throw Object.assign(new Error('No AI model is set up in Settings → AI & Chat.'), { status: 400 });
  let result;
  try {
    result = await deps.callModel(model, askPrompt(brief, cards, history, q), { maxTokens: 700, returnUsage: true, timeoutMs: 90000 });
  } catch (e) {
    const msg = String((e && e.message) || '');
    throw Object.assign(new Error(/timed out/i.test(msg) ? 'The AI took too long to answer. Try again, or choose a faster model in Settings → AI & Chat.' : `The AI could not answer just now: ${msg || 'no answer'}`), { status: /timed out/i.test(msg) ? 504 : 502 });
  }
  deps.logUsage({ userId, model: result.model || model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'domains_ask' });
  const answer = String(result.text || '').replace(/\r\n/g, '\n').trim().slice(0, 1500);
  if (!answer) throw Object.assign(new Error('The AI did not answer. Please try again.'), { status: 502 });
  return { answer, model: result.model || model };
}

module.exports = { askAboutNames };
