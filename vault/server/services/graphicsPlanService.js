'use strict';

// Parses a plain-English/voice request ("make it lighter and change the background to blue")
// into a plan of Graphics steps, against the catalog the client sends (client/src/utils/
// graphicsPlanCatalog.js) — the server never keeps its own copy of the mode/param list, so it
// can't drift out of sync with what the client actually renders and executes.
//
// Same pattern as server/services/restyle/aiEdit.js: light tier (this is intent classification,
// not generation), strict JSON-only system prompt, server-side validation that never trusts the
// model's output blindly even though the prompt already constrains it.

const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver');

function buildSystemPrompt(catalog) {
  const modeList = catalog.map((m) => {
    const params = Object.entries(m.paramSchema || {}).map(([name, schema]) => {
      const range = schema.type === 'enum' ? `one of: ${schema.values.join(', ')}`
        : schema.type === 'float' || schema.type === 'int' ? `${schema.type} ${schema.min}-${schema.max}${schema.default != null ? `, default ${schema.default}` : ''}`
        : schema.type;
      return `${name} (${range}${schema.note ? ` — ${schema.note}` : ''})`;
    }).join('; ');
    return `- "${m.id}" (${m.label}): ${m.description}${m.requiresMask ? ' [NEEDS A PAINTED MASK — the user must select the region by hand, you cannot locate it from text]' : ''}${params ? `\n  params: ${params}` : ''}`;
  }).join('\n');

  return `You turn a plain-English or voice request about editing a photo into a plan of steps, using ONLY the modes listed below. You never invent a mode or a param name that isn't listed.

Available modes:
${modeList}

Respond with STRICT JSON ONLY — an object, nothing else. No prose, no markdown fences, no explanation outside the JSON.

Format:
{
  "steps": [
    {
      "mode": "<one of the mode ids above>",
      "candidates": ["<mode id>", "<alternate mode id>"],
      "params": { "<param name>": <value> },
      "note": "<one short sentence explaining this step to the user>"
    }
  ]
}

Rules:
- One step per distinct thing the user asked to change. A request naming several changes ("lighter, and change the background, and fix the shirt") produces several steps, in the order mentioned.
- "candidates" is required. If you're confident which mode fits, it's a single-item array with just that mode. If a request is genuinely ambiguous between two modes that would produce meaningfully different results (e.g. "change the background to blue" could mean replacing it with a flat colour — background — or tinting the whole image — colorgrade/adjust), list both, most-likely first, and set "mode" to your top pick.
- "params" must only use param names from that mode's list above, with values in range. Omit a param entirely rather than guess outside its documented range or a value you're not confident about — the executor will fill in each param's own default.
- For a mode flagged [NEEDS A PAINTED MASK], still include a "params.prompt" describing what should happen if the mode has a prompt param (inpaint does) — the user will paint the region themselves, you're only drafting the text.
- "recolor" swaps one exact color to another EVERYWHERE it appears in the whole image — it has no idea what a "person" or "shirt" is, it only matches color values. Use it only when the user names a color change that is safe to apply globally (a logo, a single-color background, a product's whole surface). For "change [a specific person/object]'s clothing/item to a color" — anything where the same or a similar color might also appear elsewhere in the photo (skin tones, background, other people) — use "inpaint" instead (mask + prompt describing the new color), since it's the only mode that targets one region rather than one color value everywhere. When in doubt whether a color is unique to the target in the photo, prefer inpaint.
- "augment" is the only mode that regenerates the whole image from a prompt — use it for weather/atmosphere changes ("make it rainy", "add fog", "golden hour lighting"), colourizing a black-and-white photo, or a broad stylistic reinterpretation that isn't a targeted region edit and isn't one of the named colour-grade presets. It has no mask and no memory of specific objects/people, so it's the wrong choice for "add a specific new person" (that's inpaint) — but the right choice for a whole-scene mood/weather/colour shift.
- If nothing in the request maps to any mode above, return {"steps": []} — never force a mapping onto an unrelated mode.
- Never return a mode id, param name, or param value type that isn't in the list above.`;
}

function validateStep(step, catalogById) {
  if (!step || typeof step !== 'object') return null;
  const modeId = String(step.mode || '').trim();
  const mode = catalogById.get(modeId);
  if (!mode) return { dropped: true, reason: `Unknown mode "${modeId || '(none)'}"` };

  const candidates = Array.isArray(step.candidates) && step.candidates.length
    ? step.candidates.filter((c) => catalogById.has(c))
    : [modeId];
  if (!candidates.includes(modeId)) candidates.unshift(modeId);

  const schema = mode.paramSchema || {};
  const rawParams = (step.params && typeof step.params === 'object') ? step.params : {};
  const params = {};
  for (const [key, val] of Object.entries(rawParams)) {
    const paramSchema = schema[key];
    if (!paramSchema) continue; // silently drop unknown params rather than reject the whole step
    if (paramSchema.type === 'float' || paramSchema.type === 'int') {
      const n = Number(val);
      if (!Number.isFinite(n)) continue;
      if (n < paramSchema.min || n > paramSchema.max) continue;
      params[key] = paramSchema.type === 'int' ? Math.round(n) : n;
    } else if (paramSchema.type === 'enum') {
      if (paramSchema.values.includes(val)) params[key] = val;
    } else if (paramSchema.type === 'bool') {
      params[key] = Boolean(val);
    } else if (paramSchema.type === 'hexcolor') {
      if (/^#[0-9a-f]{6}$/i.test(String(val))) params[key] = val;
    } else if (paramSchema.type === 'hexcolor-or-transparent') {
      if (val === 'transparent' || /^#[0-9a-f]{6}$/i.test(String(val))) params[key] = val;
    } else if (paramSchema.type === 'string') {
      const s = String(val || '').trim().slice(0, 500);
      if (s) params[key] = s;
    }
  }
  // Fill in defaults for anything the model omitted or that failed validation.
  for (const [key, paramSchema] of Object.entries(schema)) {
    if (!(key in params) && paramSchema.default !== undefined) params[key] = paramSchema.default;
  }

  return {
    dropped: false,
    mode: modeId,
    candidates,
    requiresMask: !!mode.requiresMask,
    endpoint: mode.endpoint,
    params,
    note: String(step.note || '').trim().slice(0, 200) || mode.description,
  };
}

/**
 * @param {number} userId
 * @param {string} transcript - the plain-English/voice request
 * @param {Array} catalog - GRAPHICS_PLAN_CATALOG from the client, sent per-request
 * @returns {Promise<{steps: Array, droppedNotes: string[]}>}
 */
async function planGraphicsRequest(userId, transcript, catalog) {
  const text = String(transcript || '').trim();
  if (!text) throw new Error('Describe what you want to change');
  if (!Array.isArray(catalog) || !catalog.length) throw new Error('No plannable modes were provided');

  // standard, not light — this is compound instruction-following over a multi-sentence request
  // (parse several distinct intents, map each to the right mode, judge ambiguity), the same
  // shape of task server/services/restyle/aiEdit.js uses standard for. light is tuned for
  // simple/short classification (session summaries, suggestion chips) and was collapsing
  // multi-part requests to zero steps instead of actually reasoning through them.
  const tiers = await getModelsForUser(userId);
  const modelId = tiers.standard || tiers.light;
  if (!modelId) throw new Error('No AI model is configured for this workspace yet — ask your admin to set one up in Settings.');

  const systemPrompt = buildSystemPrompt(catalog);
  const raw = await callModel(modelId, text, { system: systemPrompt, maxTokens: 1024 });

  let parsed;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : raw);
  } catch {
    console.warn(`[graphics-plan] user=${userId} model=${modelId} unparseable response: ${raw.slice(0, 500)}`);
    throw new Error("Couldn't understand that as a set of edits — try describing what should change more plainly.");
  }
  if (!parsed || !Array.isArray(parsed.steps)) {
    console.warn(`[graphics-plan] user=${userId} model=${modelId} no steps array in response: ${raw.slice(0, 500)}`);
    throw new Error("Couldn't understand that as a set of edits — try describing what should change more plainly.");
  }

  const catalogById = new Map(catalog.map((m) => [m.id, m]));
  const steps = [];
  const droppedNotes = [];
  for (const rawStep of parsed.steps) {
    const validated = validateStep(rawStep, catalogById);
    if (!validated) continue;
    if (validated.dropped) {
      droppedNotes.push(validated.reason);
      continue;
    }
    steps.push(validated);
  }

  if (!steps.length) {
    console.warn(`[graphics-plan] user=${userId} model=${modelId} transcript="${text}" produced zero usable steps. Raw model output: ${raw.slice(0, 800)}`);
  }

  return { steps, droppedNotes };
}

module.exports = { planGraphicsRequest, buildSystemPrompt };
