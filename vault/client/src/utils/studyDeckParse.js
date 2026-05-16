/**
 * Parse machine blocks from Student / Cards assistant messages (see server/prompts/studentCardsRoutine.js).
 * Uses brace-balanced JSON extraction so ``` inside string values does not truncate the deck.
 */

const VAULT_DECK_OPEN = '```vault-deck';

function safeParse(json) {
  try {
    return JSON.parse(json.trim());
  } catch {
    return null;
  }
}

/** Extract a top-level JSON object starting at startIdx (must point at '{'). */
export function extractBalancedJsonObject(content, startIdx) {
  if (!content || startIdx < 0 || startIdx >= content.length || content[startIdx] !== '{') return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = startIdx; i < content.length; i += 1) {
    const ch = content[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return content.slice(startIdx, i + 1);
    }
  }
  return null;
}

export function extractAllVaultDeckPayloads(content) {
  if (!content || typeof content !== 'string') return [];
  const out = [];
  let from = 0;
  for (let safety = 0; safety < 80; safety += 1) {
    const start = content.indexOf(VAULT_DECK_OPEN, from);
    if (start === -1) break;
    let i = start + VAULT_DECK_OPEN.length;
    while (i < content.length && /[\s\r\n\t]/.test(content[i])) i += 1;
    if (content[i] !== '{') {
      from = start + VAULT_DECK_OPEN.length;
      continue;
    }
    const jsonStr = extractBalancedJsonObject(content, i);
    if (!jsonStr) break;
    const parsed = safeParse(jsonStr);
    if (parsed && typeof parsed === 'object') out.push(normalizeDeckPayload(parsed));
    const afterJson = i + jsonStr.length;
    const fence = content.indexOf('```', afterJson);
    from = fence !== -1 ? fence + 3 : afterJson;
  }
  return out;
}

export function normalizeDeckPayload(raw) {
  const kind = raw.kind && String(raw.kind) ? String(raw.kind) : 'mixed';
  let flashcards = Array.isArray(raw.flashcards) ? raw.flashcards : [];
  let slides = Array.isArray(raw.slides) ? raw.slides : [];
  let quiz = Array.isArray(raw.quiz) ? raw.quiz : [];
  if (!flashcards.length && Array.isArray(raw.items)) {
    flashcards = raw.items.filter((x) => x && (x.front || x.q) && (x.back || x.a));
  }
  return {
    version: raw.version || 1,
    kind,
    flashcards,
    slides,
    quiz,
  };
}

/** Merge every vault-deck in the thread (dedupe cards/slides/quiz by stable keys). */
export function extractMergedVaultDeck(messages) {
  if (!Array.isArray(messages)) return null;
  const merged = {
    version: 1,
    kind: 'mixed',
    flashcards: [],
    slides: [],
    quiz: [],
  };
  const seenF = new Set();
  const seenS = new Set();
  const seenQ = new Set();
  let lastKind = 'mixed';

  for (const m of messages) {
    if (m.role !== 'assistant' || !m.content) continue;
    for (const p of extractAllVaultDeckPayloads(m.content)) {
      if (p.kind && p.kind !== 'mixed') lastKind = p.kind;
      for (const c of p.flashcards) {
        const k = (c.id != null && String(c.id))
          ? `id:${String(c.id)}`
          : `fb:${String(c.front ?? c.q ?? '').trim()}||${String(c.back ?? c.a ?? '').trim()}`;
        if (seenF.has(k)) continue;
        seenF.add(k);
        merged.flashcards.push(c);
      }
      for (const s of p.slides) {
        const k = (s.id != null && String(s.id)) ? `sid:${s.id}` : `st:${String(s.title || '').trim()}`;
        if (seenS.has(k)) continue;
        seenS.add(k);
        merged.slides.push(s);
      }
      for (const q of p.quiz) {
        const k = (q.id != null && String(q.id)) ? `qid:${q.id}` : `qt:${String(q.question || '').trim()}`;
        if (seenQ.has(k)) continue;
        seenQ.add(k);
        merged.quiz.push(q);
      }
    }
  }
  merged.kind = lastKind;
  if (!merged.flashcards.length && !merged.slides.length && !merged.quiz.length) return null;
  return merged;
}

/** Alias: merged snapshot across the thread (recommended for UI). */
export function extractLatestVaultDeck(messages) {
  return extractMergedVaultDeck(messages);
}

export function stripVaultMachineBlocks(content) {
  if (!content || typeof content !== 'string') return content || '';
  let out = content;
  for (let safety = 0; safety < 80; safety += 1) {
    const start = out.indexOf(VAULT_DECK_OPEN);
    if (start === -1) break;
    let i = start + VAULT_DECK_OPEN.length;
    while (i < out.length && /[\s\r\n\t]/.test(out[i])) i += 1;
    if (out[i] !== '{') {
      out = out.slice(0, start) + out.slice(start + VAULT_DECK_OPEN.length);
      continue;
    }
    const jsonStr = extractBalancedJsonObject(out, i);
    if (!jsonStr) break;
    const afterJson = i + jsonStr.length;
    let removeEnd = afterJson;
    const fence = out.indexOf('```', afterJson);
    if (fence !== -1) removeEnd = fence + 3;
    out = out.slice(0, start) + out.slice(removeEnd);
  }
  out = out.replace(/```vault-choices\s*\n[\s\S]*?```/gi, '');
  return out.replace(/\n{3,}/g, '\n\n').trimEnd();
}

export function extractLatestVaultChoices(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== 'assistant' || !m.content) continue;
    const matches = [...m.content.matchAll(/```vault-choices\s*\n([\s\S]*?)```/gi)];
    const block = matches.length ? matches[matches.length - 1][1] : null;
    if (!block) return null;
    const parsed = safeParse(block);
    if (!parsed || typeof parsed !== 'object') return null;
    const prompt = typeof parsed.prompt === 'string' ? parsed.prompt : '';
    const options = Array.isArray(parsed.options) ? parsed.options.filter((o) => o && (o.id || o.label)) : [];
    if (!options.length) return null;
    return { prompt, options };
  }
  return null;
}
