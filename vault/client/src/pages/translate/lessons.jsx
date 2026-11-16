import React, { useState, useEffect } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import { LANGUAGES } from '../../utils/translateLanguages';
import { Modal, Btn, Sel } from './shared';

export const SEVERITY = {
  CRITICAL: { level: 'CRITICAL', color: '#dc2626' },
  MODERATE: { level: 'MODERATE', color: '#d97706' },
  MINOR: { level: 'MINOR', color: 'var(--color-muted)' },
};
export const SEVERITY_RANK = { CRITICAL: 3, MODERATE: 2, MINOR: 1 };
export const CODE_SEVERITY_RULES = [
  { level: 'CRITICAL', re: /dnt_term_missing|hallucinated_redaction|redaction_token_missing|empty_target/ },
  { level: 'MODERATE', re: /stray_source_word|truncated_short|too_many_identical/ },
];
export const TEXT_SEVERITY_RULES = [
  { level: 'CRITICAL', re: /omit|omitted|missing|dropped|redact|coercive|legal|compliance/i },
  { level: 'MODERATE', re: /meaning|logic|revers|shift|mistranslat|incorrect|wrong|drift|truncat/i },
];
export function tagSeverity(text, { floor } = {}) {
  const t = String(text || '');
  let level = 'MINOR';
  for (const rule of CODE_SEVERITY_RULES) { if (rule.re.test(t)) { level = rule.level; break; } }
  if (level === 'MINOR') {
    for (const rule of TEXT_SEVERITY_RULES) { if (rule.re.test(t)) { level = rule.level; break; } }
  }
  if (floor && SEVERITY_RANK[floor] > SEVERITY_RANK[level]) level = floor;
  return SEVERITY[level];
}

// Turn a finished job's QA findings into HITL-reviewable "lessons" — process-level fixes for
// the global instruction prompt (every future job, every language) vs. term-level fixes for
// this job's target-language glossary (this language only). Nothing is written until the user
// checks a box and hits Apply — this only proposes. Every item carries a `disposition` (the
// recommended action, in one short phrase) alongside its evidence, so the reviewer isn't
// re-deriving what to do from prose each time.
//
// Findings are grouped by ROOT CAUSE, not flattened to sibling checkboxes:
//  - DNT: every garbledOrIncompleteRows row flagging the SAME missing do-not-translate term
//    (e.g. "21 News" leaking as "21 Actualités" across several rows) is one enforcement-rule
//    finding with N instances, not N separate "lock this rendering" checkboxes — the real fix is
//    a doNotTranslate:true glossary rule, not per-occurrence locks a reviewer could check some of
//    and miss others.
//  - LOCK: only from a genuine `proposedTarget` (proposeGlossary's own suggestion). Gating on
//    this field, and only this field, is deliberate — `target = it.proposedTarget || it.renderedAs`
//    used to fall through to `renderedAs`, which is "what the model actually (wrongly) rendered",
//    turning "here's what's wrong" into "here's what to do" the moment proposedTarget was empty.
//  - DRIFT, split by what the reader actually needs to do next:
//    - enforcement: glossaryDriftTerms — the term is already locked (`lockedTarget`), some rows
//      just didn't apply it. Not a glossary problem; a pipeline/engineering one.
//    - linguistic: review-pass uncertainTerms (`renderedAs`/`issue`, no proposedTarget) — genuine
//      ambiguity with no confirmed correction. Needs a human linguistic call, not a ticket.
//  - STYLE: dialectalChoices — an accepted regional choice, not an error; lockable as-is.
// The model saying a term is already glossary-mandated means "lock" is a no-op, not a suggestion.
export const ALREADY_IN_GLOSSARY_RE = /already (?:in |mandated by |present in |part of )?(?:the )?glossary|already (?:standard|locked|mandated)/i;

// A real term/short phrase, not a sentence of explanation. Catches the same field-conflation
// failure the original proposedTarget/renderedAs bug had — this time the MODEL putting
// explanatory prose ("Dre is Quebec French feminine for Dr; in European French...") into a field
// meant to hold a short rendering, rather than client code picking the wrong field. Length +
// explanatory-language heuristics; not perfect, but "42-char sentence with a semicolon" is never
// a real term to lock.
export function looksMalformedTerm(s) {
  const t = String(s || '').trim();
  if (!t) return false;
  if (t.length > 40) return true;
  if (/[;]/.test(t)) return true;
  if (/\b(is|means|refers to|in European|in Quebec|standard form|feminine for|masculine for)\b/i.test(t)) return true;
  return false;
}

export function buildLessonCandidates(qa) {
  if (!qa) return { global: [], dnt: [], lock: [], driftEnforcement: [], driftLinguistic: [], alreadyStandard: [], style: [] };

  const excerptOf = (it) => it.issue || it.reason || it.why || it.excerpt || it.source || '';
  const snippetOf = (it) => (it.sourceExcerpt || it.targetExcerpt)
    ? { source: it.sourceExcerpt, target: it.targetExcerpt }
    : (it.source && it.target ? { source: it.source, target: it.target } : null);

  // ── DNT root-cause grouping — pull matching rows out of garbledOrIncompleteRows first ──────
  const dntGroups = new Map();
  const dntRowKeys = new Set();
  (qa.garbledOrIncompleteRows || []).forEach((it, i) => {
    const m = String(it.issue || '').match(/dnt_term_missing:([^;]+)/);
    if (!m) return;
    const term = m[1].trim();
    if (!term) return;
    dntRowKeys.add(i);
    const key = term.toLowerCase();
    const g = dntGroups.get(key) || { term, instances: [] };
    g.instances.push({ index: it.index, source: it.source, target: it.target, excerpt: it.excerpt });
    dntGroups.set(key, g);
  });
  const dnt = [...dntGroups.values()].map((g, i) => ({
    id: `dnt-${i}`,
    disposition: 'Do-not-translate rule',
    detail: `"${g.term}" leaked into the translation in ${g.instances.length} row(s) instead of staying untranslated — a per-row lock wouldn't stop the next occurrence; the fix is one doNotTranslate rule.`,
    instances: g.instances,
    severity: SEVERITY.CRITICAL,
    term: { source: g.term, target: '', doNotTranslate: true, note: 'Added from Lessons learnt — do-not-translate enforcement gap' },
  }));
  // Same term can independently surface from garbledOrIncompleteRows (above, grouped into `dnt`)
  // AND from the review pass's own uncertainTerms — two different data sources describing the
  // same root cause. Without this, e.g. "21 News" showed up once as a grouped DNT finding and
  // again as a standalone "needs linguistic decision" item: same story, two disconnected bullets.
  const dntTermKeys = new Set(dntGroups.keys());

  const global = (qa.polarityOrSentenceTypeIssues || []).map((it, i) => ({
    id: `polarity-${i}`,
    disposition: 'Global rule',
    text: `Watch for meaning/logic reversals — e.g. "${excerptOf(it)}".`,
    severity: tagSeverity(excerptOf(it), { floor: 'MODERATE' }),
  })).concat((qa.restructuredSentences || []).map((it, i) => ({
    id: `restructured-${i}`,
    disposition: 'Global rule',
    text: `Keep original sentence structure where the source allows it — flagged: "${excerptOf(it)}".`,
    severity: tagSeverity(excerptOf(it)),
  }))).concat((qa.audienceFlags || []).map((it, i) => ({
    id: `audience-${i}`,
    disposition: 'Global rule',
    text: `Grammar/localization flag for this audience — "${excerptOf(it)}".`,
    severity: tagSeverity(excerptOf(it)),
  }))).concat((qa.garbledOrIncompleteRows || [])
    .filter((it, i) => it?.check !== 'deterministic_completeness' && !dntRowKeys.has(i))
    .map((it, i) => ({
      id: `garbled-${i}`,
      disposition: 'Global rule',
      text: `Don't leave source markup/content untranslated — seen: "${excerptOf(it)}".`,
      severity: tagSeverity(excerptOf(it)),
    })));

  const lock = [];
  const driftEnforcement = [];
  const driftLinguistic = [];
  const alreadyStandard = [];
  (qa.uncertainTerms || []).forEach((it, i) => {
    if (!it?.source) return;
    if (dntTermKeys.has(it.source.trim().toLowerCase())) return; // already covered by the dnt group above
    if (ALREADY_IN_GLOSSARY_RE.test(it.reason || '')) {
      // The model's own reason says this is already glossary-mandated — locking it "again" is
      // not a new suggestion, it's a no-op dressed up as one. Route to informational, not Lock.
      alreadyStandard.push({
        id: `already-${i}`,
        disposition: 'No action — already in glossary',
        source: it.source,
        detail: it.reason,
        severity: SEVERITY.MINOR,
      });
    } else if (it.proposedTarget && it.proposedTarget !== '(varies)') {
      if (looksMalformedTerm(it.source) || looksMalformedTerm(it.proposedTarget)) {
        // Same field-conflation failure mode as the original proposedTarget/renderedAs bug, just
        // from the model itself this time: explanatory prose landed in a value field that's
        // supposed to hold a short term. Don't trust it as a lockable pair — flag it instead.
        driftLinguistic.push({
          id: `malformed-lock-${i}`,
          disposition: 'Needs manual entry (malformed field)',
          source: it.source,
          detail: `Looks like explanatory text landed in a term field, not a real term — raw: source="${it.source}", proposedTarget="${it.proposedTarget}".`,
          snippet: snippetOf(it),
          severity: SEVERITY.MODERATE,
        });
      } else {
        lock.push({
          id: `lock-${i}`,
          disposition: 'Lock rendering',
          label: `Lock "${it.source}" → "${it.proposedTarget}"${it.reason ? ` (${it.reason})` : ''}`,
          severity: tagSeverity(it.reason),
          snippet: snippetOf(it),
          term: { source: it.source, target: it.proposedTarget, note: it.reason || undefined },
        });
      }
    } else if (it.lockedTarget) {
      // glossaryDriftTerms — a KNOWN, already-locked glossary term some rows didn't apply.
      // Not a glossary action; an enforcement/pipeline bug to ticket.
      driftEnforcement.push({
        id: `drift-enf-${i}`,
        disposition: 'Enforcement gap (engineering)',
        source: it.source,
        detail: `Already locked to "${it.lockedTarget}" — some rows didn't use it${it.rows?.length ? ` (rows ${it.rows.join(', ')})` : ''}.`,
        severity: tagSeverity(it.issue, { floor: 'MODERATE' }),
      });
    } else {
      // renderedAs/issue shape — flagged, no confirmed correction. Genuine linguistic call.
      driftLinguistic.push({
        id: `drift-ling-${i}`,
        disposition: 'Needs linguistic decision',
        source: it.source,
        detail: it.issue || `Rendered as "${it.renderedAs}" — flagged, no confirmed correction.`,
        snippet: snippetOf(it),
        severity: tagSeverity(it.issue),
      });
    }
  });

  const style = [];
  (qa.dialectalChoices || []).filter((it) => it.used).forEach((it, i) => {
    const sourceVal = it.standardForm || it.used;
    if (ALREADY_IN_GLOSSARY_RE.test(it.context || '')) {
      alreadyStandard.push({
        id: `already-dialect-${i}`,
        disposition: 'No action — already in glossary',
        source: it.used,
        detail: it.context,
        severity: SEVERITY.MINOR,
      });
      return;
    }
    if (looksMalformedTerm(sourceVal) || looksMalformedTerm(it.used)) {
      driftLinguistic.push({
        id: `malformed-dialect-${i}`,
        disposition: 'Needs manual entry (malformed field)',
        source: it.used,
        detail: `Looks like explanatory text landed in a term field, not a real term — raw: standardForm="${it.standardForm || ''}", used="${it.used}".`,
        snippet: snippetOf(it),
        severity: SEVERITY.MODERATE,
      });
      return;
    }
    style.push({
      id: `dialect-${i}`,
      disposition: 'Lock regional form',
      label: `Lock "${sourceVal}" → "${it.used}" as the standard rendering${it.context ? ` (${it.context})` : ''}`,
      severity: SEVERITY.MINOR,
      snippet: snippetOf(it),
      term: { source: sourceVal, target: it.used, note: it.context || undefined },
    });
  });

  return { global, dnt, lock, driftEnforcement, driftLinguistic, alreadyStandard, style };
}

export function SeverityBadge({ severity }) {
  if (!severity) return null;
  return (
    <span className="text-xs font-semibold px-1.5 py-0.5 rounded shrink-0"
      style={{ color: '#fff', background: severity.color }}>
      {severity.level}
    </span>
  );
}

export const DISPOSITION_WORDS = {
  'Global rule': 'Rule for every translation',
  'Do-not-translate rule': 'Leave as it is',
  'Lock rendering': 'Always translate this way',
  'No action — already in glossary': 'Already in the glossary',
  'Needs manual entry (malformed field)': 'Needs typing in by hand',
};
export const dispositionWords = (text) => DISPOSITION_WORDS[text] || text;

export function DispositionTag({ text }) {
  if (!text) return null;
  return (
    <span className="text-xs font-medium px-1.5 py-0.5 rounded shrink-0"
      style={{ color: 'var(--color-primary)', background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      {dispositionWords(text)}
    </span>
  );
}

// A term drifting once is noise; the same term recurring across jobs (2+) is a pattern worth
// actually fixing rather than re-triaging by eye every time. Only shown once frequency data has
// loaded (driftFreq !== null) and only when it's actually recurred.
export function FrequencyBadge({ count }) {
  if (!count || count < 2) return null;
  return (
    <span className="text-xs font-medium px-1.5 py-0.5 rounded shrink-0"
      style={{ color: '#7c3aed', border: '1px solid #7c3aed', opacity: 0.9 }}
      title="How many separate translations this same word has gone wrong in">
      in {count} translations
    </span>
  );
}

export const SNIPPET_TRUNCATE_AT = 140;

export function Snippet({ snippet }) {
  const [expanded, setExpanded] = useState(false);
  if (!snippet || (!snippet.source && !snippet.target)) return null;
  const long = (snippet.source && snippet.source.length > SNIPPET_TRUNCATE_AT)
    || (snippet.target && snippet.target.length > SNIPPET_TRUNCATE_AT);
  const clip = (s) => (s && !expanded && s.length > SNIPPET_TRUNCATE_AT) ? `${s.slice(0, SNIPPET_TRUNCATE_AT)}…` : s;
  return (
    <div className="text-xs mt-0.5 pl-2 border-l-2" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
      {snippet.source && <div>SRC: {clip(snippet.source)}</div>}
      {snippet.target && <div>TGT: {clip(snippet.target)}</div>}
      {long && (
        <button onClick={() => setExpanded(v => !v)}
          className="text-xs font-medium hover:opacity-70 mt-0.5"
          style={{ color: 'var(--color-primary)' }}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

// Visible hint next to a section heading — a bare `title` attribute on plain text has no visual
// affordance telling the reader there's anything to hover, so it goes unnoticed in practice. This
// pairs the heading with a small `info` icon that carries the tooltip instead.
export function HeaderHint({ text }) {
  const getIcon = useIcon();
  return (
    <span title={text} className="inline-flex items-center hover:opacity-70 cursor-help" style={{ color: 'var(--color-muted)' }}>
      {getIcon('info', { size: 13 })}
    </span>
  );
}

export function LessonsLearntModal({ qa, job, appVersion, onClose }) {
  const addToast = useToastStore(s => s.addToast);
  const { global, dnt, lock, driftEnforcement, driftLinguistic, alreadyStandard, style } = buildLessonCandidates(qa);
  const [checkedGlobal, setCheckedGlobal] = useState(() => new Set());
  const [checkedDnt, setCheckedDnt] = useState(() => new Set());
  const [checkedLock, setCheckedLock] = useState(() => new Set());
  const [checkedStyle, setCheckedStyle] = useState(() => new Set());
  const [applying, setApplying] = useState(false);
  // Cross-job frequency (termKey -> jobCount) — a term drifting once is noise, drifting across
  // several jobs is a pattern. Tells the reader which enforcement/linguistic items are worth
  // acting on without them eyeballing single reports over time.
  const [driftFreq, setDriftFreq] = useState(null);
  const [confirmDrafts, setConfirmDrafts] = useState({}); // id -> typed "confirmed standard" value
  const [confirming, setConfirming] = useState(null); // id currently saving

  useEffect(() => {
    if (!job?.targetLanguage) return;
    api.get(`/api/translate/drift-frequency/${job.targetLanguage}`)
      .then(r => r.json())
      .then(rows => {
        const map = {};
        (rows || []).forEach(r => { map[r.termKey] = r.jobCount; });
        setDriftFreq(map);
      })
      .catch(() => setDriftFreq({}));
  }, [job?.targetLanguage]);

  const freqFor = (source) => driftFreq?.[String(source || '').trim().toLowerCase()] || 0;

  const toggle = (setSet, id) => {
    setSet(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Select-all / clear toggle for a section — flips based on current state (if everything's
  // already checked, clicking clears instead of re-checking, so it's one button either way).
  const selectAll = (setSet, items) => {
    setSet(prev => (prev.size === items.length ? new Set() : new Set(items.map(i => i.id))));
  };

  const [logOpen, setLogOpen] = useState(false);

  // "Confirm as standard" — for a Needs-linguistic-decision item, the reviewer (a human who
  // actually knows the target language) supplies the correct rendering the tool couldn't
  // determine on its own; that becomes a real glossary lock, same destination as Lock/style, just
  // gated on explicit human confirmation instead of the model's own proposedTarget.
  const confirmAsStandard = async (item) => {
    const value = (confirmDrafts[item.id] || '').trim();
    if (!value) { addToast('Type the correct translation first', 'error'); return; }
    if (!job?.targetLanguage) return;
    setConfirming(item.id);
    try {
      const res = await api.post('/api/translate/lessons/apply', {
        targetLanguage: job.targetLanguage,
        terms: [{
          source: item.source, target: value, disposition: 'Confirmed as standard',
          note: 'Confirmed as standard from Lessons learnt',
        }],
        jobId: job?.id,
        jobFilename: job?.filename,
      });
      if (!res.ok) throw new Error('Could not save glossary term');
      addToast(`"${item.source}" → "${value}" will be used from now on`, 'success');
      setConfirmDrafts(prev => { const n = { ...prev }; delete n[item.id]; return n; });
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setConfirming(null);
    }
  };

  const nothingToShow = global.length === 0 && dnt.length === 0 && lock.length === 0
    && driftEnforcement.length === 0 && driftLinguistic.length === 0
    && alreadyStandard.length === 0 && style.length === 0;
  const nothingChecked = checkedGlobal.size === 0 && checkedDnt.size === 0
    && checkedLock.size === 0 && checkedStyle.size === 0;
  const selectedCount = checkedGlobal.size + checkedDnt.size + checkedLock.size + checkedStyle.size;

  const apply = async () => {
    setApplying(true);
    try {
      const globalLines = global.filter(g => checkedGlobal.has(g.id)).map(g => g.text);
      const checkedTerms = [
        ...dnt.filter(d => checkedDnt.has(d.id)).map(d => ({ ...d.term, disposition: d.disposition })),
        ...lock.filter(l => checkedLock.has(l.id)).map(l => ({ ...l.term, disposition: l.disposition })),
        ...style.filter(s => checkedStyle.has(s.id)).map(s => ({ ...s.term, disposition: s.disposition })),
      ];
      const res = await api.post('/api/translate/lessons/apply', {
        targetLanguage: job?.targetLanguage,
        globalLines,
        terms: checkedTerms,
        jobId: job?.id,
        jobFilename: job?.filename,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not apply what you ticked');

      const parts = [];
      if (data.globalApplied) parts.push(`${data.globalApplied} rule${data.globalApplied === 1 ? '' : 's'} added for every translation`);
      if (data.termsApplied) parts.push(`${data.termsApplied} word${data.termsApplied === 1 ? '' : 's'} added to the learned glossary`);
      addToast(parts.length ? parts.join(' · ') : 'Nothing ticked', parts.length ? 'success' : 'error');
      if (parts.length) onClose();
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal title="Lessons learnt" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm" style={{ color: 'var(--color-text)' }}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            What you apply here changes later translations only. This one stays as it is.
          </p>
          <button onClick={() => setLogOpen(true)}
            className="text-xs font-medium hover:opacity-70 shrink-0"
            style={{ color: 'var(--color-primary)' }}>
            See everything applied so far
          </button>
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          What the checks found on this translation, turned into things Translate can remember. Tick the ones you agree
          with and press Apply selected. A rule applies to every later translation; a word applies to later translations
          into the same language. Anything without a tick box needs you to decide first.
        </p>

        {nothingToShow ? (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>The checks found nothing on this translation to learn from.</p>
        ) : (
          <>
            {dnt.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold flex items-center gap-1">Words to always leave as they are — {dnt.length}
                    <HeaderHint text="A word that should have been left as written was translated. Ticking one tells Translate to leave that word as it is in every later translation into this language." /></p>
                  <button onClick={() => selectAll(setCheckedDnt, dnt)} className="text-xs font-medium hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
                    {checkedDnt.size === dnt.length ? 'Clear' : 'Select all'}
                  </button>
                </div>
                <ul className="space-y-2">
                  {dnt.map(d => (
                    <li key={d.id} className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={checkedDnt.has(d.id)}
                        onChange={() => toggle(setCheckedDnt, d.id)} />
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <SeverityBadge severity={d.severity} />
                          <DispositionTag text={d.disposition} />
                          <span className="text-xs">
                            <strong>"{d.term.source}"</strong> — {d.detail}
                          </span>
                        </div>
                        <div className="text-xs mt-1 pl-2 border-l-2" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                          {d.instances.slice(0, 3).map((inst, i) => (
                            <div key={i}>
                              {typeof inst.index === 'number' ? `#${inst.index} ` : ''}
                              {inst.target ? `TGT: ${inst.target.slice(0, 140)}` : (inst.excerpt || '').slice(0, 140)}
                            </div>
                          ))}
                          {d.instances.length > 3 && <div>…and {d.instances.length - 3} more</div>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold flex items-center gap-1">Rules for every future translation — {global.length}
                  <HeaderHint text="Problems of style or consistency that are not about one word. Ticking one adds a rule that every later translation follows, in every language. The rules are kept in Settings, AI & Chat, Translate agent." /></p>
                {global.length > 0 && (
                  <button onClick={() => selectAll(setCheckedGlobal, global)} className="text-xs font-medium hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
                    {checkedGlobal.size === global.length ? 'Clear' : 'Select all'}
                  </button>
                )}
              </div>
              {global.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Nothing found.</p>
              ) : (
                <ul className="space-y-1.5">
                  {global.map(g => (
                    <li key={g.id} className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={checkedGlobal.has(g.id)}
                        onChange={() => toggle(setCheckedGlobal, g.id)} />
                      <SeverityBadge severity={g.severity} />
                      <DispositionTag text={g.disposition} />
                      <span className="text-xs">{g.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold flex items-center gap-1">
                  Words to always translate one way — {lock.length}
                  <HeaderHint text="The translator found a good translation for this word but did not use it every time. Ticking one saves that translation in the learned glossary, so later translations into this language use it throughout." />
                </p>
                {lock.length > 0 && (
                  <button onClick={() => selectAll(setCheckedLock, lock)} className="text-xs font-medium hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
                    {checkedLock.size === lock.length ? 'Clear' : 'Select all'}
                  </button>
                )}
              </div>
              {lock.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Nothing found.</p>
              ) : (
                <ul className="space-y-1.5">
                  {lock.map(l => (
                    <li key={l.id} className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={checkedLock.has(l.id)}
                        onChange={() => toggle(setCheckedLock, l.id)} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <SeverityBadge severity={l.severity} />
                          <DispositionTag text={l.disposition} />
                          <span className="text-xs">{l.label}</span>
                        </div>
                        <Snippet snippet={l.snippet} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold flex items-center gap-1">
                  Regional word choices to keep — {style.length}
                  <HeaderHint text="A regional word the translator chose on purpose (not a mistake). Ticking one saves it in the learned glossary as the word to use from now on." />
                </p>
                {style.length > 0 && (
                  <button onClick={() => selectAll(setCheckedStyle, style)} className="text-xs font-medium hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
                    {checkedStyle.size === style.length ? 'Clear' : 'Select all'}
                  </button>
                )}
              </div>
              {style.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Nothing found.</p>
              ) : (
                <ul className="space-y-1.5">
                  {style.map(s => (
                    <li key={s.id} className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={checkedStyle.has(s.id)}
                        onChange={() => toggle(setCheckedStyle, s.id)} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <SeverityBadge severity={s.severity} />
                          <DispositionTag text={s.disposition} />
                          <span className="text-xs">{s.label}</span>
                        </div>
                        <Snippet snippet={s.snippet} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {driftEnforcement.length > 0 && (
              <details>
                <summary className="text-xs font-semibold mb-2 cursor-pointer select-none flex items-center gap-1">
                  Already in the glossary but not followed ({driftEnforcement.length}) — nothing to tick
                  <HeaderHint text="The glossary already says how to translate this word, but some parts of this translation did not follow it. There is nothing to add. If it keeps happening, tell whoever looks after Vault." />
                </summary>
                {driftFreq && (
                  <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
                    Ignore one-offs; a "seen in N jobs" badge means it's a real pattern, not this job's noise.
                  </p>
                )}
                <ul className="space-y-1.5">
                  {[...driftEnforcement].sort((a, b) => freqFor(b.source) - freqFor(a.source)).map(d => (
                    <li key={d.id} className="flex items-start gap-2">
                      <SeverityBadge severity={d.severity} />
                      <DispositionTag text={d.disposition} />
                      <FrequencyBadge count={freqFor(d.source)} />
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        <strong style={{ color: 'var(--color-text)' }}>{d.source}</strong> — {d.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {driftLinguistic.length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-2 flex items-center gap-1">
                  Needs your decision ({driftLinguistic.length}) — type the right translation
                  <HeaderHint text="The translator was unsure about this word and has no suggestion. Someone who knows the language needs to type the correct translation and press Always use this." />
                </p>
                <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
                  If you (or a translator) know the right rendering, type it and confirm — that locks it into the {job?.targetLanguage || 'target-language'} glossary immediately, same as Lock above.
                </p>
                <ul className="space-y-1.5">
                  {[...driftLinguistic].sort((a, b) => freqFor(b.source) - freqFor(a.source)).map(d => (
                    <li key={d.id} className="flex items-start gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <SeverityBadge severity={d.severity} />
                          <DispositionTag text={d.disposition} />
                          <FrequencyBadge count={freqFor(d.source)} />
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                            <strong style={{ color: 'var(--color-text)' }}>{d.source}</strong> — {d.detail}
                          </span>
                        </div>
                        <Snippet snippet={d.snippet} />
                        <div className="flex items-center gap-2 mt-1">
                          <input type="text" placeholder="The correct translation…" aria-label="The correct translation"
                            value={confirmDrafts[d.id] || ''}
                            onChange={(e) => setConfirmDrafts(prev => ({ ...prev, [d.id]: e.target.value }))}
                            className="text-xs px-2 py-1 rounded border flex-1 min-w-40"
                            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
                          <button onClick={() => confirmAsStandard(d)} disabled={confirming === d.id || !(confirmDrafts[d.id] || '').trim()}
                            className="text-xs px-2.5 py-1 rounded font-medium hover:opacity-90 disabled:opacity-50"
                            style={{ background: 'var(--color-primary)', color: '#fff' }}>
                            {confirming === d.id ? 'Saving…' : 'Always use this'}
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {alreadyStandard.length > 0 && (
              <details>
                <summary className="text-xs font-semibold mb-2 cursor-pointer select-none flex items-center gap-1">
                  Already in the glossary ({alreadyStandard.length}) — nothing to do
                  <HeaderHint text="The checks listed this, but the translation used is the one your glossary asks for, so it is not a real problem. Shown so nothing is hidden; there is nothing to apply." />
                </summary>
                <ul className="space-y-1.5">
                  {alreadyStandard.map(d => (
                    <li key={d.id} className="flex items-start gap-2">
                      <SeverityBadge severity={d.severity} />
                      <DispositionTag text={d.disposition} />
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        <strong style={{ color: 'var(--color-text)' }}>{d.source}</strong> — {d.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="h-14" />
          </>
        )}
      </div>
      {!nothingToShow && (
        <div className="sticky bottom-0 -mx-5 -mb-5 px-5 py-2.5 flex items-center justify-between gap-3 border-t"
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {selectedCount === 0 ? 'Nothing ticked' : `${selectedCount} ticked`}
          </span>
          <button onClick={apply} disabled={applying || nothingChecked}
            className="text-sm px-4 py-2 rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
            style={{ background: 'var(--color-primary)', color: '#fff' }}>
            {applying ? 'Applying…' : 'Apply selected'}
          </button>
        </div>
      )}
      {logOpen && <LessonsLogModal defaultLanguage={job?.targetLanguage} onClose={() => setLogOpen(false)} />}
    </Modal>
  );
}

// Audit trail for everything applied via "Lessons learnt" — the apply action itself only writes
// to a free-text Settings blob (global) or a learned glossary's term list (per language), neither
// of which carries history. This reads translate_lessons_log, one row per applied item, so
// "what did we apply, and when" doesn't require reconstructing it from a growing text blob and
// term `note` fields.
export function LessonsLogModal({ defaultLanguage, onClose }) {
  const [scope, setScope] = useState('all'); // 'all' | 'global' | 'language'
  const [lang, setLang] = useState(defaultLanguage || '');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setRows(null);
    setError('');
    const params = new URLSearchParams();
    if (scope !== 'all') params.set('scope', scope);
    if (scope !== 'global' && lang) params.set('targetLanguage', lang);
    api.get(`/api/translate/lessons?${params.toString()}`)
      .then(r => r.json())
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setError('Could not load what has been applied. Try again in a moment.'));
  }, [scope, lang]);

  return (
    <Modal title="Everything applied so far" onClose={onClose} wide>
      <div className="flex flex-col gap-3 text-sm" style={{ color: 'var(--color-text)' }}>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Every rule and word applied from Lessons learnt, newest first, with the translation it came from. The same list is on the screen “What it has learned”.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-44">
            <Sel value={scope} onChange={setScope}>
              <option value="all">Everything</option>
              <option value="global">Rules for all languages</option>
              <option value="language">Words for one language</option>
            </Sel>
          </div>
          {scope !== 'global' && (
            <div className="w-44">
              <Sel value={lang} onChange={setLang}>
                <option value="">Any language</option>
                {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </Sel>
            </div>
          )}
        </div>

        {error && <p className="text-xs" style={{ color: '#dc2626' }}>{error}</p>}
        {!error && rows === null && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
        {!error && rows && rows.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Nothing applied yet for this choice.</p>
        )}
        {!error && rows && rows.length > 0 && (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                  {['Date', 'Applies to', 'Kind', 'What was learned', 'From'].map(h => (
                    <th key={h} className="text-left px-2 py-1.5 font-medium" style={{ color: 'var(--color-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
                      {new Date(r.createdAt).toLocaleDateString('en-AU')}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {r.scope === 'global' ? 'All languages' : (LANGUAGES.find(l => l.code === r.targetLanguage)?.label || r.targetLanguage)}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-primary)' }}>{dispositionWords(r.disposition)}</td>
                    <td className="px-2 py-1.5">
                      {r.sourceTerm ? <strong>"{r.sourceTerm}"{r.targetTerm ? ` → "${r.targetTerm}"` : ''}</strong> : null}
                      {r.detail && <div style={{ color: r.sourceTerm ? 'var(--color-muted)' : 'var(--color-text)' }}>{r.detail}</div>}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-muted)' }} title={r.jobFilename || ''}>
                      {r.jobFilename || (r.jobId ? `Translation ${r.jobId}` : 'Not recorded')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── PDF generation (client-side) ──────────────────────────────────────────────
// Font-selection logic lives in translatePdfFonts.js (plain JS, unit-tested with node — see
// translatePdfFonts.test.js) so the font-fallback regression it guards against (mi → en font
// selection checking target only, missing that source needed Noto) can be tested without a
// bundler/JSX. Imported here, not duplicated, so the test suite verifies the logic this page
// actually runs.
// react-pdf/textkit runs every word through a hyphenation callback to compute line-wrap
// candidates — by default an English-syllable hyphenator. Fed a word in a language it
// doesn't recognise (te reo Māori, Polish, etc.), it can split and reconstruct the word
// wrong, corrupting letters around the break — not only at actual wrap points, since the
// callback also runs during width-fitting for words that never end up wrapping. Confirmed
// on a real mi → en job: "Māori" rendered as "M ori" and "Kōhanga" as "KMhanga" throughout
// the PDF even though the correct Noto font was already selected and its glyphs are all
// present — the corruption was happening in text-layout, not glyph rendering. Disabling
// hyphenation (treat every word as unbreakable) removes the callback from the picture
// entirely. Registered once; @react-pdf de-dupes repeat calls internally. This is a
// module-level Font singleton local to THIS bundle — server-side PDF generators
// (textToPdf.js, webExtractorPdf.js, propertyScenarioPdf.js, invoicePdf.js) are separate
// processes and each needs (or already has) its own registerHyphenationCallback call; this
// one only protects client-side renders in this page.
