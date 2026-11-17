import React, { useRef, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import EmptyState from '../../components/EmptyState';
import { LANGUAGES } from '../../utils/translateLanguages';
import { Btn, Modal, Field, Input, Tip } from './shared';
import { offerUndo } from '../../utils/binUndo';

// Glossaries: the lists of words that must always be translated one way, or left as they are. The ones marked "Learned" are built by
// Translate itself, one per language, and are edited the same way. The names of the controls here ("New glossary", "Keep as is",
// "Learned") are quoted by the Translate guide (server/services/translateTutor.js): change both together.

const SMALL_BTN = 'text-xs px-2.5 py-1 rounded-lg border inline-flex items-center gap-1 transition-opacity duration-200 hover:opacity-70';
const CELL_INPUT = 'text-xs px-2 py-1.5 rounded-lg border w-full';
const CELL_STYLE = { background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

/** Rows from a CSV: the word, its translation, and "keep" (or the older "DNT") in a third column to leave the word as it is. */
export function parseGlossaryCsv(text) {
  return String(text || '').split(/\r?\n/).filter((l) => l.trim()).map((line) => {
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    return { source: cols[0] || '', target: cols[1] || '', doNotTranslate: /^(dnt|keep)$/i.test(cols[2] || '') };
  }).filter((t) => t.source);
}

export default function GlossariesPanel({ glossaries, setGlossaries, onOpenLearned, onReload }) {
  const getIcon = useIcon();
  const [modal, setModal] = useState(null); // null | 'new' | the glossary being changed
  const [form, setForm] = useState({ name: '', terms: [] });
  const [saving, setSaving] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const addToast = useToastStore((s) => s.addToast);
  const csvRef = useRef(null);

  const openNew = () => { setForm({ name: '', terms: [] }); setModal('new'); };
  const openEdit = (g) => { setForm({ name: g.name, terms: g.terms || [] }); setModal(g); };

  const addTerm = () => setForm((f) => ({ ...f, terms: [...f.terms, { source: '', target: '', doNotTranslate: false }] }));
  const setTerm = (i, key, val) => setForm((f) => {
    const terms = [...f.terms];
    terms[i] = { ...terms[i], [key]: val };
    return { ...f, terms };
  });
  const removeTerm = (i) => setForm((f) => ({ ...f, terms: f.terms.filter((_, idx) => idx !== i) }));

  const importCsv = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const terms = parseGlossaryCsv(ev.target.result);
      setForm((f) => ({ ...f, terms: [...f.terms, ...terms] }));
      addToast(terms.length ? `Added ${terms.length} row${terms.length === 1 ? '' : 's'} from the file` : 'No rows found in that file', terms.length ? 'success' : 'error');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const save = async () => {
    if (!form.name.trim()) { addToast('Give the glossary a name first', 'error'); return; }
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), terms: form.terms.filter((t) => t.source?.trim()) };
      const res = modal === 'new'
        ? await api.post('/api/translate/glossaries', payload)
        : await api.put(`/api/translate/glossaries/${modal.id}`, payload);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not save the glossary');
      const row = { ...body, termCount: (body.terms || []).length };
      setGlossaries((prev) => (modal === 'new' ? [row, ...prev] : prev.map((g) => (g.id === row.id ? { ...g, ...row } : g))));
      setModal(null);
      addToast('Glossary saved. It applies from the next translation.', 'success');
    } catch (e) { addToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const deleteGlossary = async (id) => {
    setDeleting(id);
    try {
      const res = await api.delete(`/api/translate/glossaries/${id}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not delete the glossary');
      setGlossaries((prev) => prev.filter((g) => g.id !== id));
      offerUndo({ message: 'Glossary moved to the recycle bin. It stays there for 30 days.', binIds: body.binId, restoredMessage: 'Glossary put back', after: onReload });
    } catch (e) { addToast(e.message, 'error'); }
    finally { setDeleting(null); setConfirmId(null); }
  };

  return (
    <div className="space-y-4" data-tour="translate-glossaries">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip text="Start a new list of words. Give it a name, then add the words and how each must be translated.">
          <button type="button" onClick={openNew}
            className="text-sm px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1.5 transition-opacity duration-200 hover:opacity-70"
            style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>
            {getIcon('plus', { size: 14 })} New glossary
          </button>
        </Tooltip>
        {onOpenLearned && (
          <Tooltip text="See every rule and word Translate has picked up from the checks on your earlier translations, with dates.">
            <button type="button" onClick={onOpenLearned} className={SMALL_BTN} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' }}>
              {getIcon('lightbulb', { size: 13 })} What it has learned
            </button>
          </Tooltip>
        )}
      </div>

      {glossaries.length === 0 ? (
        <EmptyState
          icon="book"
          title="No glossaries yet"
          body="A glossary is a list of words that must always be translated one way, or left as they are (brand names, product codes). Translate also builds one learned glossary per language after your first translation."
        />
      ) : (
        <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                {['Name', 'Language', 'Words', 'Changed', ''].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {glossaries.map((g) => (
                <tr key={g.id} className="group" style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="px-3 py-2 font-medium" style={{ color: 'var(--color-text)' }}>
                    {g.name}
                    {g.isGlobal && (
                      <Tooltip text="Built by Translate itself: every translation into this language that uses the learned glossary adds its new words here. You can change or remove any of them.">
                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full border" style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}>Learned</span>
                      </Tooltip>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                    {g.targetLanguage ? (LANGUAGES.find((l) => l.code === g.targetLanguage)?.label || g.targetLanguage) : 'Any language'}
                  </td>
                  <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>{Number(g.termCount ?? g.terms?.length ?? 0)}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>{new Date(g.updatedAt).toLocaleDateString('en-AU')}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2 justify-end items-center">
                      {confirmId === g.id ? (
                        <span className="text-xs inline-flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                          Delete?
                          <button type="button" onClick={() => deleteGlossary(g.id)} disabled={deleting === g.id} className="underline transition-opacity duration-200 hover:opacity-60" style={{ color: '#ef4444' }}>{deleting === g.id ? 'Deleting…' : 'Yes'}</button>
                          <button type="button" onClick={() => setConfirmId(null)} className="underline transition-opacity duration-200 hover:opacity-60">No</button>
                        </span>
                      ) : (
                        <>
                          <Tooltip text="Open this glossary to add, change or remove its words.">
                            <button type="button" onClick={() => openEdit(g)} className={SMALL_BTN} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Open</button>
                          </Tooltip>
                          <Tooltip text={g.isGlobal ? 'Delete this learned glossary. It asks first, then keeps it in the recycle bin for 30 days. Translate starts a new, empty one for the language at the next translation.' : 'Delete this glossary. It asks first, then keeps it in the recycle bin for 30 days (Settings, Recycle bin) in case you want it back.'}>
                            <button type="button" onClick={() => setConfirmId(g.id)} className={SMALL_BTN} style={{ borderColor: 'var(--color-border)', color: '#ef4444' }}>Delete</button>
                          </Tooltip>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal === 'new' ? 'New glossary' : modal.name} onClose={() => setModal(null)} wide>
          <div className="flex flex-col gap-4">
            <Field label="Name">
              <Input value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="For example: Legal terms" />
            </Field>

            <div>
              <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Words ({form.terms.length})</span>
                <div className="flex gap-2">
                  <input ref={csvRef} type="file" accept=".csv,text/csv" className="hidden" onChange={importCsv} />
                  <Tooltip text="Add many rows at once from a spreadsheet saved as CSV. One row per line: the word, its translation, and the word “keep” in a third column to leave it untranslated.">
                    <button type="button" onClick={() => csvRef.current?.click()} className={SMALL_BTN} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                      {getIcon('upload', { size: 12 })} Add from a CSV file
                    </button>
                  </Tooltip>
                  <Tooltip text="Add one empty row to fill in.">
                    <button type="button" onClick={addTerm} className={SMALL_BTN} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                      {getIcon('plus', { size: 12 })} Add a word
                    </button>
                  </Tooltip>
                </div>
              </div>

              {form.terms.length === 0 ? (
                <p className="text-xs text-center py-4" style={{ color: 'var(--color-muted)' }}>No words yet. Press “Add a word”.</p>
              ) : (
                <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-1">
                  <div className="grid gap-2 text-xs font-medium px-1" style={{ gridTemplateColumns: '1fr 1fr 4.5rem 1.75rem', color: 'var(--color-muted)' }}>
                    <span>In the original</span><span>Must be translated as</span><span className="text-center">Keep as is</span><span />
                  </div>
                  {form.terms.map((t, i) => (
                    <div key={i} className="grid gap-2 items-center" style={{ gridTemplateColumns: '1fr 1fr 4.5rem 1.75rem' }}>
                      <input value={t.source || ''} onChange={(e) => setTerm(i, 'source', e.target.value)} placeholder="Word or phrase" aria-label="Word in the original" className={CELL_INPUT} style={CELL_STYLE} />
                      <input value={t.target || ''} onChange={(e) => setTerm(i, 'target', e.target.value)} placeholder={t.doNotTranslate ? 'Left as it is' : 'Its translation'} aria-label="Must be translated as"
                        disabled={!!t.doNotTranslate} className={CELL_INPUT} style={{ ...CELL_STYLE, opacity: t.doNotTranslate ? 0.4 : 1 }} />
                      <Tip text="Tick to leave this word exactly as written (a brand name, a product code)." className="flex justify-center">
                        <input type="checkbox" checked={!!t.doNotTranslate} onChange={(e) => setTerm(i, 'doNotTranslate', e.target.checked)} aria-label="Keep as is" />
                      </Tip>
                      <Tooltip text="Remove this row.">
                        <button type="button" onClick={() => removeTerm(i)} aria-label="Remove this row" className="w-7 h-7 flex items-center justify-center rounded transition-opacity duration-200 hover:opacity-60" style={{ color: '#ef4444' }}>
                          {getIcon('x', { size: 14 })}
                        </button>
                      </Tooltip>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Changes apply from the next translation. Finished translations stay as they are.</p>
            <div className="flex gap-2 justify-end">
              <Btn variant="secondary" onClick={() => setModal(null)}>Cancel</Btn>
              <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save glossary'}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
