/**
 * Parse machine blocks from Student / Cards assistant messages (see server/prompts/studentCardsRoutine.js).
 */

export function stripVaultMachineBlocks(content) {
  if (!content || typeof content !== 'string') return content || '';
  return content
    .replace(/```vault-deck\s*\n[\s\S]*?```/gi, '')
    .replace(/```vault-choices\s*\n[\s\S]*?```/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function safeParse(json) {
  try {
    return JSON.parse(json.trim());
  } catch {
    return null;
  }
}

export function extractLatestVaultDeck(messages) {
  if (!Array.isArray(messages)) return null;
  let last = null;
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.content) continue;
    const matches = [...m.content.matchAll(/```vault-deck\s*\n([\s\S]*?)```/gi)];
    for (const match of matches) {
      const parsed = safeParse(match[1]);
      if (parsed && typeof parsed === 'object') last = normalizeDeckPayload(parsed);
    }
  }
  return last;
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
