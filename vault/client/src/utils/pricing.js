// Pricing in USD per million tokens, for cost display only. Anthropic list prices checked 2026-11-18
// (the server's table is server/services/costCalculator.js; keep the two in step).
export const MODEL_PRICING = {
  'claude-fable-5-2':                   { input: 8.00,  output: 40.00 },
  'claude-opus-5-5':                    { input: 4.00,  output: 20.00 },
  'claude-opus-5':                      { input: 5.00,  output: 25.00 },
  'claude-opus-4-6':                    { input: 5.00,  output: 25.00 },
  'claude-sonnet-5-5':                  { input: 2.00,  output: 10.00 },
  'claude-sonnet-5':                    { input: 2.00,  output: 10.00 },
  'claude-sonnet-4-6':                  { input: 3.00,  output: 15.00 },
  'claude-haiku-5-5':                   { input: 0.10,  output: 0.50 },
  'claude-haiku-4-5-20251001':          { input: 1.00,  output: 5.00 },
  'claude-haiku-4-5':                   { input: 1.00,  output: 5.00 },
  'gemini-2.0-flash':                   { input: 0.10,  output: 0.40 },
  'gemini-2.5-pro-preview-05-06':       { input: 1.25,  output: 10.00 },
};

// An id not in the table is priced at the higher rate of its family.
function familyPrice(model) {
  const id = String(model || '').toLowerCase();
  if (id.includes('fable') || id.includes('mythos')) return { input: 10.00, output: 50.00 };
  if (id.includes('opus')) return { input: 5.00, output: 25.00 };
  if (id.includes('haiku')) return { input: 1.00, output: 5.00 };
  return MODEL_PRICING['claude-sonnet-4-6'];
}

export function calcCost(model, inputTokens, outputTokens) {
  const p = MODEL_PRICING[model] || familyPrice(model);
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
}

export function formatCost(usd) {
  if (usd < 0.001) return '<$0.001';
  if (usd < 0.01)  return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export function formatTokens(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
