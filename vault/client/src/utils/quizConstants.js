export const ACADEMIC_LEVELS = [
  { value: '1st year', label: '1st year' },
  { value: '2nd year', label: '2nd year' },
  { value: '3rd year', label: '3rd year' },
  { value: 'Postgraduate', label: 'Postgraduate' },
];

export const QUESTION_TYPE_OPTIONS = [
  { value: 'true_false', label: 'True / False' },
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'short_answer', label: 'Short answer' },
];

export const CONFIDENCE_LEVELS = ['Low', 'Medium', 'High'];

/** Confidence is useful for MC / short answer — not for quick T/F. */
export function usesConfidence(type) {
  return type === 'multiple_choice' || type === 'short_answer';
}

/** Parse AI/student text to true | false | null. */
export function parseBoolish(value) {
  const t = String(value ?? '').trim().toLowerCase();
  if (!t) return null;
  if (t === 'true' || t === 't' || t === 'yes' || t === '1') return 'true';
  if (t === 'false' || t === 'f' || t === 'no' || t === '0') return 'false';
  if (/^true\b/.test(t) || (t.includes('true') && !t.includes('false'))) return 'true';
  if (/^false\b/.test(t) || t.includes('false')) return 'false';
  return null;
}

export function formatBoolAnswer(value) {
  const b = parseBoolish(value);
  if (b === 'true') return 'True';
  if (b === 'false') return 'False';
  return String(value ?? '').trim() || '—';
}

export function formatQuizTypes(types) {
  if (!Array.isArray(types) || !types.length) return '—';
  return types
    .map((t) => QUESTION_TYPE_OPTIONS.find((o) => o.value === t)?.label || t)
    .join(', ');
}

export function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickQuestions(pool, count) {
  if (!Array.isArray(pool) || !pool.length) return [];
  const n = Math.min(Math.max(1, count || 10), pool.length);
  return shuffleArray(pool).slice(0, n);
}

/** Client-side mark for T/F and MC. */
export function markObjective(question, studentAnswer) {
  const correct = String(question.correct_answer ?? '').trim().toLowerCase();
  const given = String(studentAnswer ?? '').trim().toLowerCase();
  if (question.type === 'true_false') {
    const expected = parseBoolish(correct);
    const actual = parseBoolish(given);
    if (expected && actual) return expected === actual;
    return given === correct;
  }
  if (question.type === 'multiple_choice') {
    if (given === correct) return true;
    const opts = Array.isArray(question.options) ? question.options : [];
    const byLabel = opts.find((o) => String(o).trim().toLowerCase() === given);
    const byLetter = opts[given.charCodeAt(0) - 97];
    if (byLabel && String(byLabel).trim().toLowerCase() === correct) return true;
    if (byLetter && String(byLetter).trim().toLowerCase() === correct) return true;
    return given === String(correct).trim().toLowerCase();
  }
  return false;
}

export function formatDuration(ms) {
  const sec = Math.max(0, Math.floor((ms || 0) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
