import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import Dialog from '../../components/Dialog';
import EmptyState from '../../components/EmptyState';
import Skeleton from '../../components/Skeleton';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { LANGUAGES } from '../../utils/translateLanguages';
import { Sel, Tip } from './shared';
import { offerUndo } from '../../utils/binUndo';

// House styles (admins only): per language, sets of approved examples for the whole workspace. A set is a kind of content with a
// comment on how it is translated, and pairs of an original and its approved translation. When a translation into or out of the
// language runs, one set is used (picked on New translation, or the closest one) as the standard the translator matches and the
// checker judges by. Most languages need none. Server: services/translateStyles.js. The names here ("House styles", "New set",
// "Test this set") are the ones the Translate guide quotes (server/services/translateTutor.js).

const langLabel = (code) => LANGUAGES.find((l) => l.code === code)?.label || code;
const CARD = 'rounded-2xl border p-4 space-y-3';
const CARD_STYLE = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
const BTN = 'text-sm px-3.5 py-2 rounded-lg border font-medium inline-flex items-center gap-1.5 transition-opacity duration-200 hover:opacity-70 disabled:opacity-40';
const BTN_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' };
const PRIMARY = { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)', borderColor: 'var(--color-primary)' };
const AREA = 'w-full text-sm px-3 py-2 rounded-lg border';
const AREA_STYLE = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const emptyExample = (languageCode) => ({ originalLanguage: languageCode === 'en' ? 'mi' : 'en', original: '', approved: '', note: '' });

export default function HouseStylesPanel({ isAdmin }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [sets, setSets] = useState(null);
  const [budget, setBudget] = useState(6000);
  const [lang, setLang] = useState('mi');
  const [editing, setEditing] = useState(null); // { id?, languageCode, name, comment, examples }
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [test, setTest] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/translate/styles');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not load house styles');
      setSets(body.sets || []);
      if (body.budget) setBudget(body.budget);
    } catch (e) { setSets([]); addToast(e.message, 'error'); }
  }, [addToast]);
  useEffect(() => { load(); }, [load]);

  const byLang = useMemo(() => {
    const m = {};
    for (const s of sets || []) (m[s.languageCode] = m[s.languageCode] || []).push(s);
    return m;
  }, [sets]);
  const ordered = useMemo(() => [...LANGUAGES].sort((a, b) => (byLang[b.code]?.length ? 1 : 0) - (byLang[a.code]?.length ? 1 : 0)), [byLang]);

  const open = async (id) => {
    setConfirmDelete(false);
    const res = await api.get(`/api/translate/styles/${id}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { addToast(body.error || 'Could not open that set', 'error'); return; }
    setEditing({ ...body, examples: body.examples.length ? body.examples : [emptyExample(body.languageCode)] });
  };
  const startNew = () => { setConfirmDelete(false); setEditing({ languageCode: lang, name: '', comment: '', examples: [emptyExample(lang)] }); };
  const setField = (k, v) => setEditing((e) => ({ ...e, [k]: v }));
  const setExample = (i, k, v) => setEditing((e) => ({ ...e, examples: e.examples.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));

  const save = async ({ quiet = false } = {}) => {
    if (!editing.name.trim()) { addToast('Give the set a name first', 'error'); return null; }
    setSaving(true);
    try {
      const payload = { ...editing, examples: editing.examples.filter((x) => x.original.trim() && x.approved.trim()) };
      const res = editing.id ? await api.put(`/api/translate/styles/${editing.id}`, payload) : await api.post('/api/translate/styles', payload);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not save the set');
      setEditing({ ...body, examples: body.examples.length ? body.examples : [emptyExample(body.languageCode)] });
      if (!quiet) addToast('House style saved. It is used from the next translation.', 'success');
      load();
      return body;
    } catch (e) { addToast(e.message, 'error'); return null; }
    finally { setSaving(false); }
  };

  const remove = async () => {
    const res = await api.delete(`/api/translate/styles/${editing.id}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { addToast(body.error || 'Could not delete the set', 'error'); return; }
    setEditing(null);
    setConfirmDelete(false);
    load();
    offerUndo({ message: 'House style moved to the recycle bin. It stays there for 30 days.', binIds: body.binId, restoredMessage: 'House style put back', after: load });
  };

  const runTest = async () => {
    const saved = await save({ quiet: true }); // test what is on screen
    if (!saved) return;
    if (!saved.examples.length) { addToast('Add at least one example with both sides filled in first.', 'error'); return; }
    startProcessing('Testing this house style…', `Translating ${Math.min(saved.examples.length, 10)} example${saved.examples.length === 1 ? '' : 's'} the way a real translation would, each without seeing its own approved answer.`);
    try {
      const res = await api.post(`/api/translate/styles/${saved.id}/test`, {});
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'The test could not run');
      setTest(body);
    } catch (e) { addToast(e.message, 'error'); }
    finally { stopProcessing(); }
  };

  if (!isAdmin) {
    return <EmptyState icon="palette" title="House styles are set by an admin" body="An admin can add approved examples for a language here. Your translations into and out of that language then follow them; New translation shows which one is used." />;
  }
  if (sets === null) return <Skeleton lines={6} className="h-6" label="Loading house styles" />;

  const exampleChars = editing ? editing.examples.reduce((n, x) => n + x.original.length + x.approved.length + (x.note || '').length + 40, 0) : 0;
  const fits = editing && exampleChars > budget;

  return (
    <div className="flex flex-col xl:grid xl:grid-cols-3 xl:items-start gap-4" data-tour="translate-styles">
      {/* ── Languages and their sets ── */}
      <section className={CARD} style={CARD_STYLE}>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Most languages need nothing here. Add a set where translations must match an approved way of writing, for example
          corporate te reo Māori in an elevated register.
        </p>
        <Tip text="The language the approved translations are in. A set guides translations into this language, and out of it.">
          <Sel value={lang} onChange={(v) => { setLang(v); setEditing(null); }} aria-label="Language">
            {ordered.map((l) => <option key={l.code} value={l.code}>{l.label}{byLang[l.code]?.length ? ` (${byLang[l.code].length})` : ''}</option>)}
          </Sel>
        </Tip>
        {(byLang[lang] || []).length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No house style for {langLabel(lang)} yet. Translations into and out of it work as before.</p>
        ) : (
          <ul className="space-y-1.5">
            {byLang[lang].map((s) => (
              <li key={s.id}>
                <Tooltip text={s.comment || 'Open this set to see or change its examples.'}>
                  <button type="button" onClick={() => open(s.id)}
                    className="w-full text-left rounded-lg border px-3 py-2 transition-opacity duration-200 hover:opacity-70"
                    style={{ borderColor: editing?.id === s.id ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
                    <span className="block text-sm font-medium">{s.name}</span>
                    <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>{s.exampleCount} example{s.exampleCount === 1 ? '' : 's'}</span>
                  </button>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
        <Tooltip text={`Start a new set of approved examples for ${langLabel(lang)}: one kind of content, with a comment on how it is translated.`}>
          <button type="button" onClick={startNew} className={BTN} style={PRIMARY}>{getIcon('plus', { size: 14 })} New set</button>
        </Tooltip>
      </section>

      {/* ── One set ── */}
      {!editing ? (
        <section className={`${CARD} xl:col-span-2`} style={CARD_STYLE}>
          <EmptyState icon="palette" title="Pick a set, or start a new one"
            body="A set is one kind of content (a vision statement, job adverts, policies) with a comment on how it is translated and pairs of an original and its approved translation." />
        </section>
      ) : (
        <section className={`${CARD} xl:col-span-2`} style={CARD_STYLE}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-medium space-y-1" style={{ color: 'var(--color-muted)' }}>
              <span>Name of this kind of content</span>
              <input value={editing.name} onChange={(e) => setField('name', e.target.value)} placeholder="e.g. Corporate vision statements" className={AREA} style={AREA_STYLE} aria-label="Name of this kind of content" />
            </label>
            <label className="text-xs font-medium space-y-1" style={{ color: 'var(--color-muted)' }}>
              <span>Language of the approved translations</span>
              <Sel value={editing.languageCode} onChange={(v) => setField('languageCode', v)} aria-label="Language of the approved translations">
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </Sel>
            </label>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>How this content is translated (the translator reads this)</span>
            <Tip text="Say what matters: register (formal, everyday), whether to re-express ideas rather than translate word for word, names to keep, words to prefer. Type it or press the microphone and say it.">
              <VoiceInput type="textarea" append rows={3} value={editing.comment || ''} onChange={(v) => setField('comment', v)} label="How this content is translated"
                placeholder="e.g. Elevated ōkawa register. Re-express the ideas idiomatically, do not translate word for word. Keep Taumata as written; use te rōpū Taumata." />
            </Tip>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Approved examples ({editing.examples.length})</p>
            {editing.examples.map((x, i) => (
              <div key={i} className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                  <span>Example {i + 1}. Original in</span>
                  <Tip text="The language of the original text in this pair." className="w-40">
                    <Sel value={x.originalLanguage} onChange={(v) => setExample(i, 'originalLanguage', v)} aria-label={`Example ${i + 1} original language`}>
                      {LANGUAGES.filter((l) => l.code !== editing.languageCode).map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </Sel>
                  </Tip>
                  <span className="flex-1" />
                  <Tooltip text="Remove this example.">
                    <button type="button" onClick={() => setEditing((e) => ({ ...e, examples: e.examples.filter((_, j) => j !== i) }))} aria-label={`Remove example ${i + 1}`} className="transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-muted)' }}>
                      {getIcon('x', { size: 14 })}
                    </button>
                  </Tooltip>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <textarea rows={5} value={x.original} onChange={(e) => setExample(i, 'original', e.target.value)} className={AREA} style={AREA_STYLE}
                    placeholder={`Original (${langLabel(x.originalLanguage)})`} aria-label={`Example ${i + 1} original`} />
                  <textarea rows={5} value={x.approved} onChange={(e) => setExample(i, 'approved', e.target.value)} className={AREA} style={AREA_STYLE}
                    placeholder={`Approved translation (${langLabel(editing.languageCode)})`} aria-label={`Example ${i + 1} approved translation`} />
                </div>
                <input value={x.note || ''} onChange={(e) => setExample(i, 'note', e.target.value)} className={AREA} style={AREA_STYLE}
                  placeholder="Optional: why it is worded this way (e.g. “search and selection” becomes mahi whai tangata, not a dictionary phrase)" aria-label={`Example ${i + 1} note`} />
              </div>
            ))}
            <button type="button" onClick={() => setEditing((e) => ({ ...e, examples: [...e.examples, emptyExample(e.languageCode)] }))} className={BTN} style={BTN_STYLE}>
              {getIcon('plus', { size: 14 })} Add example
            </button>
          </div>

          <p className="text-xs" style={{ color: fits ? '#b45309' : 'var(--color-muted)' }}>
            The comment and examples are sent with every part of a translation that uses this set, so they add to its cost.
            {' '}{fits
              ? `These examples come to about ${exampleChars.toLocaleString()} characters; about ${budget.toLocaleString()} are sent, so the later ones are left out. Put the best first, or split them into two sets.`
              : `About ${exampleChars.toLocaleString()} of ${budget.toLocaleString()} characters used.`}
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Tooltip text="Save the set. Translations started from now on use it.">
              <button type="button" onClick={() => save()} disabled={saving} className={BTN} style={PRIMARY}>{getIcon('check', { size: 14 })} {saving ? 'Saving…' : 'Save'}</button>
            </Tooltip>
            <Tooltip text="Save, then translate each example's original (up to 10) using this set, without letting the translator see that example's approved answer, and show the result beside your approved translation. Costs about as much as translating that text.">
              <button type="button" onClick={runTest} disabled={saving} className={BTN} style={BTN_STYLE}>{getIcon('play', { size: 14 })} Test this set</button>
            </Tooltip>
            <span className="flex-1" />
            {editing.id && (confirmDelete ? (
              <span className="text-sm inline-flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                Delete this set?
                <button type="button" onClick={remove} className="underline transition-opacity duration-200 hover:opacity-60" style={{ color: '#ef4444' }}>Yes</button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="underline transition-opacity duration-200 hover:opacity-60">No</button>
              </span>
            ) : (
              <Tooltip text="Delete this set. It asks first, then keeps it in your recycle bin for 30 days.">
                <button type="button" onClick={() => setConfirmDelete(true)} className={BTN} style={{ ...BTN_STYLE, color: '#ef4444' }}>{getIcon('trash', { size: 14 })} Delete</button>
              </Tooltip>
            ))}
          </div>
        </section>
      )}

      {test && (
        <Dialog title={`Test: ${test.set.name}`} size="2xl" onClose={() => setTest(null)}
          footer={<button type="button" onClick={() => setTest(null)} className={BTN} style={PRIMARY}>Close</button>}>
          <div className="space-y-4 text-sm" style={{ color: 'var(--color-text)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Each original was translated into {langLabel(test.set.languageCode)} with this set, without the translator seeing that example's
              own approved translation. Compare the two; a fluent reader should judge which is closer. {test.tested < test.total ? `The first ${test.tested} of ${test.total} examples were tested.` : ''}
            </p>
            {test.results.map((r, i) => (
              <div key={r.id} className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>Example {i + 1}</p>
                <p className="whitespace-pre-wrap" style={{ color: 'var(--color-muted)' }}>{r.original}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>Your approved translation</p>
                    <p className="whitespace-pre-wrap">{r.approved}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-primary)' }}>Translate's version, with this set</p>
                    {r.error ? <p style={{ color: '#ef4444' }}>{r.error}</p> : <p className="whitespace-pre-wrap">{r.got}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  );
}
