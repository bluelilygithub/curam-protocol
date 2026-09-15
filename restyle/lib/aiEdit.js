'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { getRestyleModelId } = require('./vaultModel');

// Allow-list matching exactly what the property panel supports — the model is constrained to
// these so the frontend never receives a change it doesn't know how to apply.
const ALLOWED_PROPERTIES = [
  'fontFamily', 'fontSize', 'fontWeight', 'color', 'lineHeight',
  'backgroundColor', 'borderRadius', 'padding', 'boxShadow',
];

const SYSTEM_PROMPT = `You edit the visual style of a single HTML element based on a plain-English request from a non-technical user.

Respond with STRICT JSON ONLY — a JSON array, nothing else. No prose, no markdown fences, no explanation outside the JSON.

Each array item must be exactly:
{ "property": "<one of the allowed properties>", "value": "<a valid CSS value for that property>", "explanation": "<one plain-English sentence, no CSS jargon>" }

Allowed "property" values (use these exact camelCase names, matching JS style.<property> — nothing else is accepted):
${ALLOWED_PROPERTIES.join(', ')}

Rules:
- Only include properties the user's request actually implies changing. Don't add unrelated changes.
- "value" must be a real, valid CSS value for that property (e.g. backgroundColor: "#0F172A", padding: "16px", boxShadow: "0 4px 12px rgba(0,0,0,0.15)", borderRadius: "12px", fontWeight: "600", fontFamily: "'Inter', sans-serif").
- "explanation" must be one short sentence a non-developer would understand — no words like "padding", "specificity", "hex", "rem/em", "flexbox". Say things like "the space around it", "the rounded corners", "the text size".
- If the request is ambiguous, make a reasonable, visually sensible choice rather than asking a question — you cannot ask follow-up questions.
- Never return a property outside the allowed list. Never return prose outside the JSON array.`;

/**
 * @param {object} element - { tag, classList, inlineStyles, computedStyles }
 * @param {string} userRequest - plain-English request
 * @returns {Promise<Array<{property:string, value:string, explanation:string}>>}
 */
async function requestAiEdit(element, userRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('The AI editor isn’t set up yet — an API key is missing on the server.');
  }

  const model = await getRestyleModelId();
  const client = new Anthropic({ apiKey });

  const userMessage = JSON.stringify({
    element: {
      tag: element.tag,
      classes: element.classList || [],
      currentInlineStyles: element.inlineStyles || {},
      currentAppearance: element.computedStyles || {},
    },
    request: userRequest,
  }, null, 2);

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim();

  let changes;
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    changes = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    throw new Error('The AI editor gave back something we couldn’t understand — try rephrasing your request.');
  }
  if (!Array.isArray(changes)) {
    throw new Error('The AI editor gave back something we couldn’t understand — try rephrasing your request.');
  }

  // Server-side allow-list enforcement — never trust the model's output blindly, even though
  // the system prompt already constrains it.
  const safeChanges = changes.filter(c =>
    c && typeof c === 'object' &&
    ALLOWED_PROPERTIES.includes(c.property) &&
    typeof c.value === 'string' && c.value.trim() &&
    typeof c.explanation === 'string' && c.explanation.trim()
  );

  if (!safeChanges.length) {
    throw new Error('The AI editor couldn’t come up with a safe change for that request — try describing it differently.');
  }

  return safeChanges;
}

module.exports = { requestAiEdit, ALLOWED_PROPERTIES };
