'use strict';

// Provider SDKs put their own status and JSON in `err.message` ("401 {"type":"error",
// "error":{"message":"invalid x-api-key"}}"). Callers must not pass that straight to the browser:
// a provider 401 is not a Vault login failure, and the raw body is noise. This turns either shape
// into one readable, admin-actionable message with a safe HTTP 502 status. No hard-coded model ids.

function providerReason(err) {
  const raw = String((err && err.message) || err || 'Unknown model error');
  const jsonAt = raw.indexOf('{');
  if (jsonAt >= 0) {
    try {
      const data = JSON.parse(raw.slice(jsonAt));
      const msg = (data.error && (data.error.message || data.error.type)) || data.message;
      const status = raw.slice(0, jsonAt).trim().match(/^(\d{3})/);
      if (msg) return `${status ? `${status[1]}: ` : ''}${String(msg).replace(/\s+/g, ' ').trim()}`.slice(0, 240);
    } catch { /* not JSON; fall through */ }
  }
  const gemini = raw.match(/\[(\d{3})[^\]]*\]\s*([^[]+)/);
  if (gemini) return `${gemini[1]}: ${gemini[2].trim()}`.slice(0, 240);
  return raw.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function modelCallError(err, modelId) {
  const why = providerReason(err);
  const status = Number(err?.status) || Number((why.match(/^(\d{3}):/) || [])[1]) || 0;
  const name = String(modelId || 'the selected model').slice(0, 120);
  let lead = `The AI model (${name}) returned an error.`;
  if (/timed out|timeout|ETIMEDOUT|ECONNRESET/i.test(why)) {
    lead = `The AI model (${name}) took too long. Try again in a moment.`;
  } else if (status === 401 || status === 403 || /invalid.api.key|authentication.error|api.key.not.valid/i.test(why)) {
    lead = `The AI provider rejected Vault's key for ${name}. An admin needs to check the provider API key.`;
  } else if (status === 429 || /rate.limit|too.many.request|quota.exceeded/i.test(why)) {
    lead = `Too many requests to the AI model (${name}) just now. Try again in a minute.`;
  } else if (status === 404 || /model.not.found|unknown model|does not exist/i.test(why)) {
    lead = `The AI provider does not know the model ${name}. An admin can choose another in Settings → AI & Chat.`;
  }
  return Object.assign(new Error(why ? `${lead} Reason: ${why}` : lead), {
    status: 502,
    code: 'model_call',
    cause: err,
  });
}

module.exports = { providerReason, modelCallError };
