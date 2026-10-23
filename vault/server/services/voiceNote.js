'use strict';

// Voice notes: a spoken recording becomes a note. The recording itself is never stored: the route turns it into text and the
// audio is gone with its temp directory. This file holds the pieces that need no ffmpeg or network (so they are unit-tested):
// turning the spoken transcript into a tidy note with the workspace's light model, and putting the note together.
//
// The model only restructures what was said; it must not add facts, tasks or names that are not in the transcript, and its
// answer is treated as untrusted (parsed, trimmed, length-bounded). If tidying fails or is switched off, the raw transcript is
// saved as the note, so a recording is never lost to a model error.

const MAX_TIDY_INPUT_CHARS = 60000;
const MAX_TITLE_CHARS = 80;
const MAX_BODY_CHARS = 100000;
const TRANSCRIPT_DIVIDER = '— What was said —';

const TIDY_SYSTEM = `You turn a spoken, rambling recording of someone dictating plans or ideas into a clear written note. The person was talking to themselves or to a colleague, so expect false starts, repeats and filler words.

Rules:
- Keep the person's meaning, and their own wording where it reads well. Do NOT add facts, decisions, names, dates or tasks that are not in the transcript. If something is unclear, leave it out or put it under "Open questions".
- Write plain text only (no markdown symbols such as #, ** or backticks). Use short section headings on their own line ending with a colon, and "- " for bullet points.
- Use only the sections that apply, in this order: Summary: (1 to 3 sentences) / Ideas: / Plan: (steps in order) / To do: (things the person said they need to do) / Open questions: (things they were unsure about).
- Keep it as short as it can be without losing anything the person said they wanted to remember.
- If it was a conversation between people, keep who said what only where it matters, and do not invent speaker names.

Also give the note a short title (at most 8 words) that says what it is about.

Reply with ONLY a JSON object, no other text:
{"title":"...","body":"..."}`;

// Other ways to write the same recording up. The rules about not adding anything are the same; only the sections differ. Chosen in the recorder
// ("Write it up as") and remembered there. 'words' (no model at all) and 'notes' (the original, above) are the other two.
const STYLE_COMMON = `Rules:
- Keep the person's meaning and, where it reads well, their own wording. Do NOT add facts, decisions, names, dates or tasks that are not in the transcript. If something is unclear, leave it out or put it under Open questions.
- Plain text only (no markdown symbols such as #, ** or backticks). Section headings on their own line ending with a colon, and "- " for bullet points.
- Use only the sections that apply, in the order given. Keep it as short as it can be without losing anything the person wanted to remember.
- Give the note a short title (at most 8 words) that says what it is about.

Reply with ONLY a JSON object, no other text:
{"title":"...","body":"..."}`;

const STYLE_SYSTEMS = {
  update: `You turn a spoken recording of someone giving a status update (to themselves, a colleague or a client) into a short written update. Expect false starts, repeats and filler words.

Sections, in this order: Summary: (1 to 3 sentences) / What happened: / Decisions: / Next steps: (what the person said still has to be done) / Open questions: or Blockers:.

${STYLE_COMMON}`,
  todo: `You turn a spoken recording of someone listing things they need to do into a clean checklist. Expect false starts, repeats and filler words.

Write one section, "To do:", with one "- " bullet per separate thing, in the order spoken, each a short action starting with a verb. Merge repeats. If the person grouped things by project or person, keep the grouping as extra headings ending with a colon. Add an "Other notes:" section only for things that are not actions.

${STYLE_COMMON}`,
  meeting: `You turn a spoken recording of a meeting or a conversation between people into meeting notes. Expect crosstalk, false starts and filler words. Do not invent speaker names; only say who said or owns something where the recording makes it clear.

Sections, in this order: Summary: (1 to 3 sentences) / Discussion: / Decisions: / Actions: (what, and who if said) / Open questions:.

${STYLE_COMMON}`,
};

/** The names of the styles that rewrite with the model, and the one that does not. */
const STYLES = ['notes', 'update', 'todo', 'meeting', 'words'];
const parseStyle = (value, tidy) => {
  const v = String(value || '').toLowerCase();
  if (STYLES.includes(v)) return v;
  return tidy === 'false' || tidy === false ? 'words' : 'notes';
};

const clean = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

function extractJson(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a !== -1 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch { /* fall through */ }
  }
  return null;
}

/** The model's reply made safe: { title, body } with bounded text, or null when there is no usable body. */
function normalizeTidyReply(raw) {
  const parsed = typeof raw === 'string' ? extractJson(raw) : raw;
  if (!parsed || typeof parsed !== 'object') return null;
  const body = clean(parsed.body, MAX_BODY_CHARS);
  if (body.length < 3) return null;
  return { title: clean(parsed.title, MAX_TITLE_CHARS).replace(/\s+/g, ' '), body };
}

/** "Voice note, 19 Oct 2:35 pm": the title used when there is no better one. */
function defaultVoiceTitle(date = new Date()) {
  const day = date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  const time = date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s/g, ' ').toLowerCase();
  return `Voice note, ${day} ${time}`;
}

/** The note body: the tidy version first, then the original words so nothing said is lost (and it stays searchable). */
function composeBody({ tidy, transcript }) {
  const raw = clean(transcript, MAX_BODY_CHARS);
  if (!tidy) return raw;
  return `${tidy}\n\n${TRANSCRIPT_DIVIDER}\n${raw}`.slice(0, MAX_BODY_CHARS * 2);
}

/**
 * Tidy a transcript into { title, body } with the light model. Throws if the model call fails or returns nothing usable
 * (the caller then saves the raw transcript). `deps` ({ getModels, callModel, logUsage }) lets tests run without a database.
 */
async function tidyTranscript(userId, transcript, deps = {}) {
  const text = clean(transcript, MAX_TIDY_INPUT_CHARS);
  const names = require('./voiceAudio').namesLine(deps.names);
  const base = STYLE_SYSTEMS[deps.style] || TIDY_SYSTEM;
  const system = names ? `${base}

${names} (They are the person's own clients, projects and contacts.)` : base;
  const getModels = deps.getModels || require('./modelResolver').getModelsForUser;
  const call = deps.callModel || require('./callModel').callModel;
  const log = deps.logUsage || require('../utils/logUsage').logUsage;
  const { light: modelId } = await getModels(userId);
  const result = await call(modelId, `THE RECORDING (transcribed):\n${text}`, {
    system, maxTokens: 4000, returnUsage: true, timeoutMs: 90000,
  });
  log({ userId, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'notes' });
  const reply = normalizeTidyReply(String(result.text || ''));
  if (!reply) throw new Error('The tidy-up returned nothing usable');
  return reply;
}

/**
 * Build the note to save from a transcript. `tidy` false (or a failed/too-long tidy) saves the words as spoken, with the
 * default title. Returns { title, body, tidied } where `tidied` says whether the model's version was used.
 */
async function buildVoiceNote(userId, transcript, { tidy = true, style = 'notes', names = [], now = new Date() } = {}, deps = {}) {
  const spoken = clean(transcript, MAX_BODY_CHARS);
  const fallback = { title: defaultVoiceTitle(now), body: spoken, tidied: false, todos: [] };
  if (!tidy || style === 'words' || spoken.length > MAX_TIDY_INPUT_CHARS) return fallback;
  try {
    const t = await (deps.tidy || tidyTranscript)(userId, spoken, { ...deps, style, names });
    return { title: t.title || fallback.title, body: composeBody({ tidy: t.body, transcript: spoken }), tidied: true, todos: extractTodos(t.body) };
  } catch {
    return fallback;
  }
}

const TODO_HEADING = /^(to do|to-do|todo|next steps|actions?)\s*:\s*$/i;
const ANY_HEADING = /^[A-Za-z][A-Za-z /&-]{0,40}:\s*$/;

/**
 * The to-dos in a written-up note: the bullets under "To do:", "Next steps:" or "Actions:" (several sections are joined), cleaned, repeats
 * dropped, at most 20, each at most 200 characters. The note's own text is not changed; the person chooses which become tasks.
 */
function extractTodos(body) {
  const out = [];
  let inList = false;
  for (const raw of String(body || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (TODO_HEADING.test(line)) { inList = true; continue; }
    if (!line) continue;
    if (ANY_HEADING.test(line)) { inList = false; continue; }
    if (!inList) continue;
    const m = /^(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line);
    const text = (m ? m[1] : line).replace(/^\[[ xX]\]\s*/, '').trim().slice(0, 200);
    if (text.length < 2 || out.some((t) => t.toLowerCase() === text.toLowerCase())) continue;
    out.push(text);
    if (out.length >= 20) break;
  }
  return out;
}

module.exports = {
  STYLES, STYLE_SYSTEMS, parseStyle, extractTodos,
  TIDY_SYSTEM, TRANSCRIPT_DIVIDER, MAX_TIDY_INPUT_CHARS,
  normalizeTidyReply, defaultVoiceTitle, composeBody, tidyTranscript, buildVoiceNote,
};
