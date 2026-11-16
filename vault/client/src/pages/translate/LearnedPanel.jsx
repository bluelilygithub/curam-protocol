import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import EmptyState from '../../components/EmptyState';
import Skeleton from '../../components/Skeleton';
import { LANGUAGES } from '../../utils/translateLanguages';
import { Sel, Tip, saveFromApi } from './shared';

// "What it has learned": (1) every rule and word applied from a result's Lessons learnt, newest first, and (2) how many translated
// passages are stored per pair of languages and how often they were reused, with the TMX download. Read-only: a learned word is
// changed in its learned glossary (Glossaries). The Translate guide describes this screen (server/services/translateTutor.js).

const langName = (code) => LANGUAGES.find((l) => l.code === code)?.label || code || 'Worked out automatically';
const CARD = 'rounded-2xl border p-5 space-y-3';
const CARD_STYLE = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };

/** The log's stored labels, in the words the page uses. */
export function lessonKind(row) {
  if (row.scope === 'global') return 'Rule for every translation';
  if (/do.?not.?translate|dnt|keep/i.test(row.disposition || '')) return 'Word to leave as it is';
  return 'Word to translate one way';
}

export default function LearnedPanel({ onOpenGlossaries }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const [scope, setScope] = useState('all'); // all | global | language
  const [lang, setLang] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [memory, setMemory] = useState(null);
  const [memoryError, setMemoryError] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    setRows(null);
    setError('');
    const params = new URLSearchParams();
    if (scope !== 'all') params.set('scope', scope);
    if (scope !== 'global' && lang) params.set('targetLanguage', lang);
    api.get(`/api/translate/lessons?${params.toString()}`)
      .then(async (r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { if (live) setRows(Array.isArray(d) ? d : []); })
      .catch(() => { if (live) setError('Could not load what has been learned. Try again in a moment.'); });
    return () => { live = false; };
  }, [scope, lang]);

  useEffect(() => {
    api.get('/api/translate/memory/stats')
      .then(async (r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => setMemory(Array.isArray(d) ? d : []))
      .catch(() => { setMemory([]); setMemoryError(true); });
  }, []);

  const downloadMemory = async () => {
    setSaving(true);
    try { await saveFromApi(api, '/api/translate/memory/export.tmx', 'translation-memory.tmx', 'Could not download the translation memory'); }
    catch (e) { addToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const totalPassages = (memory || []).reduce((n, m) => n + Number(m.segmentCount || 0), 0);

  return (
    <div className="flex flex-col xl:grid xl:grid-cols-3 xl:items-start gap-4" data-tour="translate-learned">
      {/* ── Rules and words applied from Lessons learnt ── */}
      <section className={`${CARD} xl:col-span-2`} style={CARD_STYLE}>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Rules and words you applied</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            Everything applied from “Lessons learnt” in a translation’s result, newest first. These change later translations only.
            {onOpenGlossaries && <> To change a learned word, edit the learned glossary under{' '}
              <button type="button" onClick={onOpenGlossaries} className="underline transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }}>Glossaries</button>.</>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Tip text="Show everything, only the rules that apply to every language, or only the words fixed for one language." className="w-56">
            <Sel value={scope} onChange={setScope} aria-label="Which lessons to show">
              <option value="all">Everything</option>
              <option value="global">Rules for all languages</option>
              <option value="language">Words for one language</option>
            </Sel>
          </Tip>
          {scope !== 'global' && (
            <Tip text="Show only what was learned for this language." className="w-56">
              <Sel value={lang} onChange={setLang} aria-label="Language">
                <option value="">Any language</option>
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </Sel>
            </Tip>
          )}
        </div>

        {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}
        {!error && rows === null && <Skeleton lines={4} className="h-6" label="Loading what has been learned" />}
        {!error && rows && rows.length === 0 && (
          <EmptyState
            icon="lightbulb"
            title={scope === 'all' && !lang ? 'Nothing learned yet' : 'Nothing for this choice'}
            body="Open a finished translation in My translations, press Lessons learnt, tick what you agree with and press Apply selected. It is then listed here."
          />
        )}
        {!error && rows && rows.length > 0 && (
          <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--color-border)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Date', 'Applies to', 'Kind', 'What was learned', 'From'].map((h) => (
                    <th key={h} className="text-left px-2.5 py-2 font-medium" style={{ color: 'var(--color-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                    <td className="px-2.5 py-2 whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>{new Date(r.createdAt).toLocaleDateString('en-AU')}</td>
                    <td className="px-2.5 py-2 whitespace-nowrap">{r.scope === 'global' ? 'All languages' : langName(r.targetLanguage)}</td>
                    <td className="px-2.5 py-2 whitespace-nowrap" style={{ color: 'var(--color-primary)' }}>{lessonKind(r)}</td>
                    <td className="px-2.5 py-2">
                      {r.sourceTerm ? <strong>“{r.sourceTerm}”{r.targetTerm ? ` → “${r.targetTerm}”` : ''}</strong> : null}
                      {r.detail && <div style={{ color: r.sourceTerm ? 'var(--color-muted)' : 'var(--color-text)' }}>{r.detail}</div>}
                    </td>
                    <td className="px-2.5 py-2" style={{ color: 'var(--color-muted)', maxWidth: 180 }}>
                      <span className="block truncate" title={r.jobFilename || ''}>{r.jobFilename || (r.jobId ? `Translation ${r.jobId}` : 'Not recorded')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Reused wording (translation memory) ── */}
      <section className={CARD} style={CARD_STYLE} data-tour="translate-memory">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Wording it reuses</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            Translate stores every passage it translates with Vault AI. When the same passage appears again, word for word, it gets the same translation as last time. Only exact matches are reused.
          </p>
        </div>
        {memory === null && <Skeleton lines={3} className="h-6" label="Loading stored wording" />}
        {memory && memoryError && <p className="text-sm" style={{ color: '#ef4444' }}>Could not load the stored wording. Try again in a moment.</p>}
        {memory && !memoryError && memory.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Nothing stored yet. It fills up as you translate.</p>
        )}
        {memory && memory.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                {['From → to', 'Passages stored', 'Times reused'].map((h, i) => (
                  <th key={h} className={`px-1 py-1.5 font-medium ${i ? 'text-right' : 'text-left'}`} style={{ color: 'var(--color-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {memory.map((m) => (
                <tr key={`${m.sourceLang}-${m.targetLang}`} style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                  <td className="px-1 py-1.5">{langName(m.sourceLang)} → {langName(m.targetLang)}</td>
                  <td className="px-1 py-1.5 text-right">{Number(m.segmentCount || 0).toLocaleString('en-AU')}</td>
                  <td className="px-1 py-1.5 text-right">{Number(m.totalReuses || 0).toLocaleString('en-AU')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Tooltip text="Save every stored passage and its translation as a TMX file, the format other translation software reads. Nothing is removed from here.">
          <button type="button" onClick={downloadMemory} disabled={saving || totalPassages === 0}
            className="text-xs px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5 transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' }}>
            {getIcon('download', { size: 13 })} {saving ? 'Preparing…' : 'Download translation memory'}
          </button>
        </Tooltip>
      </section>
    </div>
  );
}
