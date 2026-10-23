import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { mdComponents } from '../../utils/mdComponents';
import useDictation from './useDictation';
import { NOTE_TIPS } from './noteTips.mjs';
import { citeLinks, historyFor, buildMap, STARTERS, SCOPES, RELATED_KINDS } from './askNotes.mjs';

const MARKDOWN_PLUGINS = [remarkBreaks];
const RELATED_KEY = 'vault:notes-ask-related';
const readRelatedPref = () => { try { return localStorage.getItem(RELATED_KEY) !== '0'; } catch { return true; } };

/** One line of the map: a record you can open, with the notes filed on it and the records hanging off it. */
function MapNode({ node, depth, sources, getIcon, onOpenNote, onGo }) {
  const { item } = node;
  const kind = RELATED_KINDS[item.kind] || RELATED_KINDS.task;
  const noteLinks = (item.notes || []).map((n) => sources.find((s) => s.n === n)).filter(Boolean);
  return (
    <li>
      <div className="flex items-start gap-1.5 py-0.5" style={{ paddingLeft: depth * 14 }}>
        <span className="mt-0.5 flex-shrink-0" style={{ color: item.cited ? 'var(--color-primary)' : 'var(--color-muted)' }}>{getIcon(kind.icon, { size: 13 })}</span>
        <div className="min-w-0 text-xs" style={{ overflowWrap: 'anywhere' }}>
          <Tooltip text={NOTE_TIPS.askMapItem}>
            <button type="button" onClick={() => onGo(item.href)} className="text-left font-medium hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-text)' }}>
              <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>{kind.noun} </span>{item.label}
            </button>
          </Tooltip>
          {item.detail && <span style={{ color: 'var(--color-muted)' }}> · {item.detail}</span>}
          {noteLinks.map((s) => (
            <Tooltip key={s.n} text={NOTE_TIPS.askMapNote}>
              <button type="button" onClick={() => onOpenNote(s.id)} className="ml-1.5 px-1.5 rounded-md hover:opacity-70 transition-opacity duration-200" style={{ background: 'var(--color-surface-2)', color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}>note {s.n}</button>
            </Tooltip>
          ))}
        </div>
      </div>
      {node.children.length > 0 && (
        <ul>{node.children.map((c) => <MapNode key={c.item.key} node={c} depth={depth + 1} sources={sources} getIcon={getIcon} onOpenNote={onOpenNote} onGo={onGo} />)}</ul>
      )}
    </li>
  );
}

/**
 * "Ask your notes": a chat that answers from your own notes only, with numbered notes to open. It reads notes and changes none.
 *   scopeQuery   the filters the list is showing now (what "This list" means), plain list parameters
 *   openNoteId   the note open in the editor, if any (what "This note" means); null disables that choice
 *   onOpenNote(id)  open a cited note in the editor
 * A phone gets a full-height sheet, a bigger screen a large centred card (like the other Notes dialogs).
 */
export default function AskNotesPanel({ scopeQuery, openNoteId, listCount, mobile, onOpenNote, onClose }) {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const [relatedOn, setRelatedOn] = useState(readRelatedPref);
  const [mapOpen, setMapOpen] = useState(null); // message id whose map is open
  const [messages, setMessages] = useState([]); // { id, question, answer, sources, scope, searched, stage, pending?, error? }
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [scopeId, setScopeId] = useState(openNoteId ? 'note' : 'all');
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showAll, setShowAll] = useState(null); // message id whose "also looked at" list is open
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const dictation = useDictation({ onText: (said) => setText((prev) => (prev ? `${prev} ${said}` : said)) });

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await api.get('/api/notes/ask');
      if (res.ok) setMessages((await res.json()).map((m) => ({ ...m, sources: Array.isArray(m.sources) ? m.sources : [], related: Array.isArray(m.related) ? m.related : [] })));
    } catch { /* the chat just starts empty */ }
    setLoading(false);
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [messages, busy]);
  // "This note" only makes sense while a note is open: if it closes, fall back to everything
  useEffect(() => { if (scopeId === 'note' && !openNoteId) setScopeId('all'); }, [openNoteId, scopeId]);

  async function send(question) {
    const q = String(question ?? text).replace(/\s+/g, ' ').trim();
    if (!q || busy) return;
    setText('');
    setBusy(true);
    const tempId = `pending-${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempId, question: q, answer: '', sources: [], pending: true }]);
    const now = new Date();
    try {
      const res = await api.post('/api/notes/ask', {
        question: q,
        history: historyFor(messages),
        scope: scopeId === 'note' ? { mode: 'note', noteId: openNoteId } : scopeId === 'filters' ? { mode: 'filters', query: scopeQuery } : { mode: 'all' },
        today: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
        tzOffset: now.getTimezoneOffset(),
        related: relatedOn,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The answer could not be found just now.');
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...data, id: data.id ?? tempId, question: q } : m)));
    } catch (err) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, pending: false, error: err.message || 'The answer could not be found just now.' } : m)));
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function toggleRelated() {
    const next = !relatedOn;
    setRelatedOn(next);
    try { localStorage.setItem(RELATED_KEY, next ? '1' : '0'); } catch { /* the choice just is not remembered */ }
  }

  async function forget(m) {
    if (typeof m.id === 'number') { try { await api.delete(`/api/notes/ask/${m.id}`); } catch { /* removed from the screen anyway */ } }
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
  }

  async function clearAll() {
    try { await api.delete('/api/notes/ask'); } catch { /* cleared on screen anyway */ }
    setMessages([]);
    setConfirmClear(false);
  }

  const border = { borderColor: 'var(--color-border)' };
  const chip = (on) => ({ background: on ? 'var(--color-primary)' : 'var(--color-bg)', color: on ? '#fff' : 'var(--color-text)', border: `1px solid ${on ? 'var(--color-primary)' : 'var(--color-border)'}`, minHeight: mobile ? 40 : 30 });
  const scopes = useMemo(() => SCOPES.map((s) => ({ ...s, disabled: s.id === 'note' && !openNoteId, label: s.id === 'filters' && listCount != null ? `${s.label} (${listCount})` : s.label })), [openNoteId, listCount]);

  return (
    <div className={`fixed inset-0 z-50 flex ${mobile ? 'items-end' : 'items-center'} justify-center`} style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div
        className={`w-full flex flex-col shadow-xl ${mobile ? 'rounded-t-2xl' : 'rounded-2xl m-4 max-w-2xl'}`}
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', height: mobile ? '92dvh' : '85dvh', maxHeight: '92dvh' }}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Ask your notes"
      >
        {/* header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0">
          <h3 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <span style={{ color: 'var(--color-primary)' }}>{getIcon('message-circle', { size: 18 })}</span>Ask your notes
          </h3>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (confirmClear ? (
              <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text)' }}>
                Clear this conversation?
                <button type="button" onClick={clearAll} className="px-3 rounded-lg font-medium hover:opacity-80 transition-opacity duration-200" style={{ background: '#ef4444', color: '#fff', minHeight: mobile ? 40 : 28 }}>Yes</button>
                <button type="button" onClick={() => setConfirmClear(false)} className="px-3 rounded-lg hover:opacity-70 transition-opacity duration-200" style={chip(false)}>No</button>
              </span>
            ) : (
              <Tooltip text={NOTE_TIPS.askClear} side="bottom">
                <button type="button" onClick={() => setConfirmClear(true)} className="text-xs px-2 hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)', minHeight: mobile ? 40 : 28 }}>Clear</button>
              </Tooltip>
            ))}
            <button type="button" onClick={onClose} aria-label="Close" className="hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)', minWidth: 40, minHeight: 40 }}>{getIcon('x', { size: 18 })}</button>
          </div>
        </div>

        {/* what to look through */}
        <div className="px-4 pb-2 flex-shrink-0">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Which notes to look through">
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Look through</span>
            {scopes.map((s) => (
              <Tooltip key={s.id} text={s.disabled ? NOTE_TIPS.askScopeNoNote : NOTE_TIPS.askScope[s.id]} side="bottom">
                <button type="button" disabled={s.disabled} onClick={() => setScopeId(s.id)} aria-pressed={scopeId === s.id} className="text-xs px-2.5 rounded-full transition-opacity duration-200 hover:opacity-80 disabled:opacity-40" style={chip(scopeId === s.id)}>{s.label}</button>
              </Tooltip>
            ))}
            <Tooltip text={NOTE_TIPS.askRelated} side="bottom">
              <button type="button" onClick={toggleRelated} aria-pressed={relatedOn} className="text-xs px-2.5 rounded-full transition-opacity duration-200 hover:opacity-80 inline-flex items-center gap-1.5 sm:ml-2" style={chip(relatedOn)}>{getIcon('link', { size: 12 })}Linked records</button>
            </Tooltip>
          </div>
        </div>

        {/* conversation */}
        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-2 space-y-4 border-t" style={border} aria-live="polite">
          {loading && <p className="text-sm text-center py-6" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
          {!loading && messages.length === 0 && (
            <div className="py-4">
              <p className="text-sm" style={{ color: 'var(--color-text)' }}>Ask a question in your own words. I will look through your notes by their words and by what they are about, read the ones that fit, and answer from them, showing which notes I used. With Linked records on, I also map the projects, clients, tasks and deals tied to those notes.</p>
              <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>I only use what is written in your notes. If it is not there, I will say so. Nothing in your notes is changed.</p>
              <div className="flex flex-wrap gap-2 mt-3" role="group" aria-label="Questions to try">
                {STARTERS.map((q) => (
                  <Tooltip key={q} text={NOTE_TIPS.askStarter}>
                    <button type="button" onClick={() => send(q)} className="text-sm text-left px-3 py-2 rounded-xl hover:opacity-80 transition-opacity duration-200" style={{ ...chip(false), minHeight: mobile ? 44 : 34 }}>{q}</button>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => {
            const cited = m.sources.filter((s) => s.cited);
            const others = m.sources.filter((s) => !s.cited);
            const related = Array.isArray(m.related) ? m.related : [];
            const map = related.length ? buildMap(related) : [];
            return (
              <div key={m.id} className="space-y-2">
                <div className="flex justify-end">
                  <p className="text-sm rounded-2xl px-3 py-2 max-w-[85%]" style={{ background: 'var(--color-primary)', color: '#fff', overflowWrap: 'anywhere' }}>{m.question}</p>
                </div>
                <div className="rounded-2xl px-3 py-2.5" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                  {m.pending && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Looking through your notes…</p>}
                  {m.error && (
                    <p className="text-sm" style={{ color: '#ef4444' }} role="alert">
                      {m.error}{' '}
                      <button type="button" onClick={() => { setMessages((prev) => prev.filter((x) => x.id !== m.id)); send(m.question); }} className="underline hover:opacity-70 transition-opacity duration-200">Try again</button>
                    </p>
                  )}
                  {m.answer && (
                    <div className="text-sm leading-relaxed" style={{ color: 'var(--color-text)', overflowWrap: 'anywhere' }}>
                      <ReactMarkdown
                        remarkPlugins={MARKDOWN_PLUGINS}
                        components={{
                          ...mdComponents,
                          a: ({ href, children }) => {
                            const relKey = /^#rel-([CPTDA]\d+)$/.exec(href || '')?.[1];
                            if (relKey) {
                              const rec = related.find((i) => i.key === relKey);
                              if (!rec) return null; // a citation of a record that is not on the map is not displayed
                              return (
                                <Tooltip text={NOTE_TIPS.askMapItem}>
                                  <button type="button" onClick={() => navigate(rec.href)} className="align-baseline text-xs font-semibold px-1.5 mx-0.5 rounded-md hover:opacity-70 transition-opacity duration-200" style={{ background: 'var(--color-surface-2)', color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}>{relKey}</button>
                                </Tooltip>
                              );
                            }
                            const n = /^#src-(\d+)$/.exec(href || '')?.[1];
                            const src = n && m.sources.find((s) => s.n === Number(n));
                            if (n && !src) return null; // a citation that matches none of the notes shown is not displayed
                            if (!n) return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>{children}</a>;
                            return (
                              <Tooltip text={NOTE_TIPS.askSource}>
                                <button type="button" onClick={() => onOpenNote(src.id)} className="align-baseline text-xs font-semibold px-1.5 mx-0.5 rounded-md hover:opacity-70 transition-opacity duration-200" style={{ background: 'var(--color-surface-2)', color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}>{n}</button>
                              </Tooltip>
                            );
                          },
                        }}
                      >{citeLinks(m.answer)}</ReactMarkdown>
                    </div>
                  )}

                  {m.answer && (
                    <div className="mt-2 pt-2 border-t space-y-1.5" style={border}>
                      {cited.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {cited.map((s) => (
                            <Tooltip key={s.n} text={NOTE_TIPS.askSource}>
                              <button type="button" onClick={() => onOpenNote(s.id)} className="inline-flex items-center gap-1.5 text-xs px-2 rounded-lg hover:opacity-70 transition-opacity duration-200 max-w-full" style={{ ...chip(false), minHeight: mobile ? 36 : 26 }}>
                                <strong style={{ color: 'var(--color-primary)' }}>{s.n}</strong><span className="truncate">{s.title}</span><span style={{ color: 'var(--color-muted)' }}>{s.updated}</span>
                              </button>
                            </Tooltip>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                          {m.looked != null || m.sources.length ? `Read ${m.looked ?? m.sources.length} note${(m.looked ?? m.sources.length) === 1 ? '' : 's'}` : ''}{m.scope ? ` from ${m.scope}` : ''}{m.searched ? ` · looked for ${m.searched}` : ''}{m.stage === 'wider' ? ' · searched wider' : ''}{m.stage === 'recent' ? ' · nothing matched, so the latest notes' : ''}{m.unindexed > 0 ? ` · ${m.unindexed} note${m.unindexed === 1 ? ' is' : 's are'} still being prepared for search by meaning` : ''}{(() => { const n = m.sources.reduce((sum, s) => sum + (Array.isArray(s.files) ? s.files.length : 0), 0); return n > 0 ? ` · read inside ${n} attached file${n === 1 ? '' : 's'}` : ''; })()}{m.filesPending > 0 ? ` · ${m.filesPending} attached file${m.filesPending === 1 ? ' is' : 's are'} still being read, so ask again in a minute` : ''}
                        </p>
                        <span className="flex items-center gap-2">
                          {others.length > 0 && (
                            <button type="button" onClick={() => setShowAll(showAll === m.id ? null : m.id)} className="text-xs underline hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>{showAll === m.id ? 'Hide' : `Also read ${others.length}`}</button>
                          )}
                          <Tooltip text={NOTE_TIPS.askForget}>
                            <button type="button" onClick={() => forget(m)} aria-label="Remove this answer" className="hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>{getIcon('trash', { size: 13 })}</button>
                          </Tooltip>
                        </span>
                      </div>
                      {map.length > 0 && (
                        <div>
                          <Tooltip text={NOTE_TIPS.askMap}>
                            <button type="button" onClick={() => setMapOpen(mapOpen === m.id ? null : m.id)} aria-expanded={mapOpen === m.id} className="text-xs inline-flex items-center gap-1 hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-primary)', minHeight: mobile ? 32 : 22 }}>
                              {getIcon(mapOpen === m.id ? 'chevron-down' : 'chevron-right', { size: 13 })}Around these notes ({related.length})
                            </button>
                          </Tooltip>
                          {mapOpen === m.id && (
                            <ul className="mt-1 rounded-xl px-2.5 py-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                              {map.map((node) => <MapNode key={node.item.key} node={node} depth={0} sources={m.sources} getIcon={getIcon} onOpenNote={onOpenNote} onGo={(href) => navigate(href)} />)}
                            </ul>
                          )}
                        </div>
                      )}
                      {showAll === m.id && (
                        <ul className="space-y-1">
                          {others.map((s) => (
                            <li key={s.n}><button type="button" onClick={() => onOpenNote(s.id)} className="text-xs text-left hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>{s.n}. {s.title} · {s.updated}</button></li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* the question box */}
        <div className="px-4 pt-2 pb-3 border-t flex-shrink-0" style={{ ...border, paddingBottom: mobile ? 'max(12px, env(safe-area-inset-bottom))' : undefined }}>
          <div className="flex items-end gap-2">
            <Tooltip text={NOTE_TIPS.askInput}>
              <textarea
                ref={inputRef} value={text} rows={mobile ? 2 : 1} maxLength={500} aria-label="Your question" autoFocus={!mobile}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Ask about your notes…"
                className="flex-1 min-w-0 rounded-xl px-3 py-2 outline-none resize-none"
                style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', fontSize: 16, minHeight: mobile ? 56 : 40, maxHeight: 120 }}
              />
            </Tooltip>
            {dictation.supported && (
              <Tooltip text={dictation.listening ? 'Stop. What you said is added to your question.' : NOTE_TIPS.askMic}>
                <button type="button" onClick={() => (dictation.listening ? dictation.stop() : dictation.start('ask'))} aria-label={dictation.listening ? 'Stop dictating' : 'Dictate your question'} className="flex items-center justify-center rounded-xl hover:opacity-70 transition-opacity duration-200" style={{ ...chip(false), minWidth: mobile ? 48 : 40, minHeight: mobile ? 48 : 40, background: dictation.listening ? '#fee2e2' : 'var(--color-bg)', color: dictation.listening ? '#b91c1c' : 'var(--color-text)' }}>{getIcon('mic', { size: 16 })}</button>
              </Tooltip>
            )}
            <Tooltip text={NOTE_TIPS.askSend}>
              <button type="button" disabled={busy || !text.trim()} onClick={() => send()} className="text-sm font-medium px-4 rounded-xl hover:opacity-80 transition-opacity duration-200 disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff', minHeight: mobile ? 48 : 40 }}>{busy ? '…' : 'Ask'}</button>
            </Tooltip>
          </div>
          <p className="text-xs mt-1.5" style={{ color: 'var(--color-muted)' }}>The text of the notes it reads is sent to the AI to answer, with a small cost each time. Notes are also sent once to the embedding service so they can be found by meaning. Nothing is changed.</p>
        </div>
      </div>
    </div>
  );
}
