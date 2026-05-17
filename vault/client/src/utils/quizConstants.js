export const ACADEMIC_LEVELS = [
  { value: '1st year', label: '1st year' },
  { value: '2nd year', label: '2nd year' },
  { value: '3rd year', label: '3rd year' },
  { value: 'Postgraduate', label: 'Postgraduate' },
];

export const QUESTION_TYPE_OPTIONS = [
  { value: 'true_false', label: 'True / False' },
  { value: 'multiple_choice', label: 'Multiple choice (one answer)' },
  { value: 'multiple_select', label: 'Multiple choice (select all that apply)' },
  { value: 'short_answer', label: 'Short answer' },
];

export const CONFIDENCE_LEVELS = ['Low', 'Medium', 'High'];

/** Confidence is useful for MC / short answer — not for quick T/F. */
export function usesConfidence(type) {
  return type === 'multiple_choice' || type === 'multiple_select' || type === 'short_answer';
}

export function isMultiSelectQuestion(question) {
  if (!question) return false;
  if (question.type === 'multiple_select') return true;
  if (question.allow_multiple) return true;
  if (question.type === 'multiple_choice') {
    const ca = question.correct_answers ?? question.correct_answer;
    if (Array.isArray(ca) && ca.length > 1) return true;
    if (typeof ca === 'string' && (ca.includes('|') || ca.includes(';'))) return true;
  }
  return false;
}

export function isSingleChoiceQuestion(question) {
  return question?.type === 'multiple_choice' && !isMultiSelectQuestion(question);
}

export function parseCorrectAnswers(question) {
  const raw = question.correct_answers ?? question.correct_answer;
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    if (s.startsWith('[')) {
      try {
        const p = JSON.parse(s);
        if (Array.isArray(p)) return p.map((x) => String(x).trim()).filter(Boolean);
      } catch { /* ignore */ }
    }
    if (s.includes('|')) return s.split('|').map((x) => x.trim()).filter(Boolean);
    if (s.includes(';')) return s.split(';').map((x) => x.trim()).filter(Boolean);
    return [s];
  }
  return [];
}

export function normalizeOptionText(text, options = []) {
  const t = String(text ?? '').trim().toLowerCase();
  if (t.length === 1 && t >= 'a' && t <= 'z') {
    const idx = t.charCodeAt(0) - 97;
    if (options[idx] != null) return String(options[idx]).trim().toLowerCase();
  }
  const match = options.find((o) => String(o).trim().toLowerCase() === t);
  return match ? String(match).trim().toLowerCase() : t;
}

export function serializeMultiAnswer(selected) {
  return (selected || []).map((s) => String(s).trim()).filter(Boolean).join('|||');
}

export function parseMultiAnswer(value) {
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
  if (!value) return [];
  return String(value).split('|||').map((s) => s.trim()).filter(Boolean);
}

export function formatAnswerDisplay(question, answer) {
  if (isMultiSelectQuestion(question)) {
    return parseMultiAnswer(answer).join(', ') || '—';
  }
  if (question?.type === 'true_false') return formatBoolAnswer(answer);
  return String(answer ?? '').trim() || '—';
}

export function formatCorrectAnswersDisplay(question) {
  if (isMultiSelectQuestion(question)) {
    return parseCorrectAnswers(question).join(', ') || '—';
  }
  if (question?.type === 'true_false') return formatBoolAnswer(question.correct_answer);
  return String(question?.correct_answer ?? '').trim() || '—';
}

export function markMultiSelect(question, selectedList) {
  const correct = parseCorrectAnswers(question).map((s) => normalizeOptionText(s, question.options));
  const selected = (selectedList || []).map((s) => normalizeOptionText(s, question.options));
  const cSet = new Set(correct.filter(Boolean));
  const sSet = new Set(selected.filter(Boolean));
  if (!cSet.size || sSet.size !== cSet.size) return false;
  for (const c of cSet) {
    if (!sSet.has(c)) return false;
  }
  return true;
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

/** Client-side mark for T/F, MC, and multi-select. */
export function markObjective(question, studentAnswer) {
  if (isMultiSelectQuestion(question)) {
    const selected = Array.isArray(studentAnswer)
      ? studentAnswer
      : parseMultiAnswer(studentAnswer);
    return markMultiSelect(question, selected);
  }

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
