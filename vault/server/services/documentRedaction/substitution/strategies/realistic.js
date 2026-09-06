'use strict';

/**
 * Realistic strategy — plausible synthetic values (current default behaviour).
 * Satisfies: must-remain-readable
 * When arithmetic constraint is active, linked generation runs after this (see arithmeticConsistency.js).
 */

const { callModel } = require('../../../callModel');
const { REQUIREMENTS } = require('../target');
const { validateAndRepair } = require('../../validators');

const id = 'realistic';
const satisfies = [REQUIREMENTS.MUST_REMAIN_READABLE];

const SYSTEM = `You invent synthetic but plausible redaction replacements for a document.
Return ONLY valid JSON (no markdown fences):
{
  "replacements": [
    { "entityKey": "...", "syntheticValue": "..." }
  ]
}
Rules:
- Same category → same style of fake (person name → other person name; $12,400 → another dollar amount of similar magnitude; email → plausible email; phone → plausible phone; address → plausible address; org → other org name).
- Do NOT use placeholders like [NAME], XXX, REDACTED, [REDACTED_*], or black bars.
- Do NOT use ranges/buckets like "$1.1M–$1.2M" — pick a specific plausible value.
- Preserve format cues (currency symbols, date order, ID punctuation) when present.
- Keep length roughly similar so layout survives.
- Each entityKey appears exactly once.
- Values must differ from the realValue.`;

function parseJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  let jsonText = raw;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) jsonText = fence[1].trim();
  const start = jsonText.indexOf('{');
  const end = jsonText.lastIndexOf('}');
  if (start >= 0 && end > start) jsonText = jsonText.slice(start, end + 1);
  const parsed = JSON.parse(jsonText);
  if (Array.isArray(parsed?.replacements)) return parsed.replacements;
  if (Array.isArray(parsed)) return parsed;
  return [];
}

function heuristicFallback(realValue, categoryLabel, seed) {
  const cat = String(categoryLabel || '').toLowerCase();
  const real = String(realValue || '');
  if (seed && seed !== real && !/^\[.*\]$|^REDACTED/i.test(seed) && !/[–-]/.test(seed)) {
    return seed;
  }

  if (/email/.test(cat) || /@/.test(real)) {
    return 'person.example@example.com';
  }
  if (/phone|mobile|tel/.test(cat) || /\d{3}[\s-]?\d{3}/.test(real)) {
    return '555-0100';
  }
  if (/financial|money|amount|dollar|invoice|salary|price|capacity|surplus|income|loan|limit|buffer/.test(cat) || /^\$/.test(real.trim())) {
    const digits = real.replace(/[^\d]/g, '');
    const n = Number(digits) || 1000;
    const approx = Math.max(100, Math.round(n * 0.87));
    if (real.includes('$')) {
      return `$${approx.toLocaleString('en-US')}`;
    }
    return String(approx);
  }
  if (/dob|date_of_birth|birth/.test(cat)) return '01/01/1975';
  if (/date/.test(cat)) return '15/06/2020';
  if (/address|street|suburb/.test(cat)) return '100 Example Street';
  if (/bank/.test(cat)) return 'Pacific Capital';
  if (/org|company|hospital|clinic|employer/.test(cat)) return 'Northbridge Services';
  if (/person|name|client|patient|employee/.test(cat)) return 'Alex Morgan';
  if (/id|tfn|abn|ssn|national/.test(cat)) {
    return real.replace(/\d/g, (d, i) => String((Number(d) + 3 + i) % 10));
  }
  if (real.length <= 2) return 'Xx';
  return `${real[0]}${'x'.repeat(Math.min(6, real.length - 1))}${real[real.length - 1]}`;
}

async function generate({ modelId, entities, skipLlm = false }) {
  const list = entities || [];
  const map = new Map();
  const errors = [];

  const needLlm = [];
  for (const e of list) {
    const seed = e.seedReplacement ? String(e.seedReplacement).trim() : '';
    if (e.userLocked && seed && seed !== e.realValue) {
      map.set(e.entityKey, seed);
    } else {
      needLlm.push(e);
    }
  }

  if (!skipLlm && needLlm.length && modelId) {
    try {
      const payload = needLlm.map((e) => ({
        entityKey: e.entityKey,
        realValue: e.realValue,
        categoryLabel: e.categoryLabel,
        seedReplacement: e.seedReplacement || null,
      }));
      const userPrompt = `Produce synthetic replacements for these approved redaction entities:\n${JSON.stringify(payload, null, 2)}`;
      const text = await callModel(modelId, userPrompt, { system: SYSTEM, maxTokens: 3000 });
      const rows = parseJson(text);
      for (const row of rows) {
        const key = String(row.entityKey || '').trim();
        const syn = String(row.syntheticValue || row.replacement || '').trim();
        if (!key || !syn) continue;
        const ent = needLlm.find((x) => x.entityKey === key);
        if (ent && syn === ent.realValue) continue;
        if (/^\[REDACTED/i.test(syn)) continue;
        map.set(key, syn);
      }
    } catch (err) {
      errors.push(err.message || String(err));
    }
  }

  for (const e of list) {
    if (map.has(e.entityKey)) continue;
    map.set(e.entityKey, heuristicFallback(e.realValue, e.categoryLabel, e.seedReplacement));
  }

  // Format-validate + repair (ABN checksum, email, AU phone shape) — never fabricate a
  // value that fails a basic format check the brief's category implies.
  const repairedKeys = [];
  const byKey = new Map(list.map((e) => [e.entityKey, e]));
  for (const [key, value] of map.entries()) {
    const entity = byKey.get(key);
    if (!entity) continue;
    const { value: repaired, wasInvalid } = validateAndRepair(entity.categoryLabel, value, entity.realValue);
    if (wasInvalid) {
      map.set(key, repaired);
      repairedKeys.push(key);
    }
  }

  return {
    map,
    errors,
    meta: { strategyId: id, fabricatedValues: true, formatRepairedKeys: repairedKeys },
  };
}

module.exports = {
  id,
  satisfies,
  generate,
  heuristicFallback,
};
