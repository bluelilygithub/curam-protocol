import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { loadExcalidraw } from './loadExcalidraw';
import { filterDrawings, pieceCount, readSceneFile, titleFromFileName } from './sceneLogic.mjs';

const BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border transition-opacity duration-200 hover:opacity-60 disabled:opacity-40';
const BTN_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' };

function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return `today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

/** The list of the person's drawings: open, start, bring in a file, rename, copy, delete (with Undo). */
export default function DrawingsList() {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const [items, setItems] = useState(null); // null while loading
  const [max, setMax] = useState(300);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(null); // { id, title }
  const [confirmId, setConfirmId] = useState(null); // the drawing whose "Delete? Yes / No" is showing
  const [notesMenu, setNotesMenu] = useState(null); // { id, notes } while a card's list of notes is open
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/drawings');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load your diagrams.');
      setItems(data.drawings || []);
      if (data.max) setMax(data.max);
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load your diagrams.');
      setItems((prev) => prev || []);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = (id) => navigate(`/drawings/${id}`);

  // The notes a drawing was sent to: one goes straight there, several show a short list under the card's buttons.
  const showNotes = async (d) => {
    if (notesMenu && notesMenu.id === d.id) { setNotesMenu(null); return; }
    try {
      const res = await api.get(`/api/drawings/${d.id}/notes`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not find the notes.');
      if (data.notes.length === 1) navigate(`/notes?note=${data.notes[0].id}`);
      else if (data.notes.length === 0) addToast('No note links to this diagram any more.', 'info');
      else setNotesMenu({ id: d.id, notes: data.notes });
    } catch (err) { addToast(err.message, 'error'); }
  };
  const warm = () => { loadExcalidraw().catch(() => {}); }; // start fetching the editor while the person is still choosing

  const create = async (body = {}) => {
    setBusy(true);
    try {
      const res = await api.post('/api/drawings', body);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not make a new diagram.');
      open(data.drawing.id);
    } catch (err) {
      addToast(err.message, 'error');
      setBusy(false);
    }
  };

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) { addToast('That file is too big (the limit is 6 MB).', 'error'); return; }
    const text = await file.text();
    const checked = readSceneFile(text);
    if (!checked.ok) { addToast(checked.error, 'error'); return; }
    await create({ title: titleFromFileName(file.name), scene: text });
  };

  const rename = async () => {
    if (!renaming) return;
    const { id, title } = renaming;
    setRenaming(null);
    const current = (items || []).find((d) => d.id === id);
    if (!current || !title.trim() || title.trim() === current.title) return;
    try {
      const res = await api.put(`/api/drawings/${id}`, { title });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not rename it.');
      setItems((prev) => prev.map((d) => (d.id === id ? { ...d, ...data.drawing } : d)));
    } catch (err) { addToast(err.message, 'error'); }
  };

  const copy = async (d) => {
    try {
      const res = await api.post(`/api/drawings/${d.id}/duplicate`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not make a copy.');
      await load();
      addToast(`Made "${data.drawing.title}".`, 'success');
    } catch (err) { addToast(err.message, 'error'); }
  };

  const undo = async (binId) => {
    try {
      const res = await api.post(`/api/recycle-bin/${binId}/restore`);
      if (!res.ok) throw new Error('restore failed');
      await load();
      addToast('Diagram restored ✓', 'success');
    } catch { addToast('That could not be restored. Look in the recycle bin in Settings.', 'error'); }
  };

  const remove = async (d) => {
    setConfirmId(null);
    try {
      const res = await api.delete(`/api/drawings/${d.id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The diagram could not be deleted. Try again.');
      setItems((prev) => prev.filter((x) => x.id !== d.id));
      addToast(`"${d.title}" deleted. Kept 30 days in the recycle bin.`, 'success', undefined, data.binId ? { label: 'Undo', onClick: () => undo(data.binId) } : undefined);
    } catch (err) { addToast(err.message, 'error'); }
  };

  const shown = useMemo(() => filterDrawings(items || [], query), [items, query]);

  return (
    <div className="p-6 space-y-4 max-w-[1700px]">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip text="Start an empty diagram and open it straight away. It saves by itself as you draw.">
          <button
            type="button" data-tour="drawings-new" onClick={() => create()} onPointerEnter={warm} disabled={busy || (items || []).length >= max}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity duration-200 hover:opacity-80 disabled:opacity-40"
            style={{ background: 'var(--color-primary)' }}
          >
            {getIcon('plus', { size: 15 })} New diagram
          </button>
        </Tooltip>
        <Tooltip text="Bring in a diagram file ending in .excalidraw (from Excalidraw or an earlier export). It is saved as a new diagram in your list.">
          <button type="button" data-tour="drawings-open-file" className={BTN} style={BTN_STYLE} disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>
            {getIcon('upload', { size: 14 })} Open a file
          </button>
        </Tooltip>
        <input ref={fileRef} type="file" accept=".excalidraw,.json,application/json" className="hidden" onChange={onFile} aria-label="Choose a diagram file" />
        <div className="flex-1 min-w-[12rem] max-w-md ml-auto">
          <Tooltip text="Narrow the list to diagrams whose name has all the words you type. The microphone lets you say them.">
            <div className="w-full">
              <VoiceInput value={query} onChange={setQuery} placeholder="Search your diagrams…" label="Search your diagrams" />
            </div>
          </Tooltip>
        </div>
      </div>

      {error && <p className="text-sm" role="alert" style={{ color: '#ef4444' }}>{error}</p>}

      <div data-tour="drawings-list">
        {items === null && (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-48" label="Loading your diagrams" />)}
          </div>
        )}
        {items !== null && items.length === 0 && !error && (
          <EmptyState
            icon="pen-tool"
            title="No diagrams yet"
            body="Sketch an idea, a diagram or a plan on an endless page. Diagrams save by themselves and are private to you."
            action={<button type="button" onClick={() => create()} disabled={busy} className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity duration-200 hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>New diagram</button>}
          />
        )}
        {items !== null && items.length > 0 && shown.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No diagram has all of those words in its name.</p>
        )}
        {shown.length > 0 && (
          <ul className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map((d) => (
              <li key={d.id} className="rounded-xl border overflow-hidden flex flex-col" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <Tooltip text="Open this diagram.">
                  <button
                    type="button" onClick={() => open(d.id)} onPointerEnter={warm} aria-label={`Open ${d.title}`}
                    className="block w-full h-40 transition-opacity duration-200 hover:opacity-80"
                    style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}
                  >
                    {d.thumbnail
                      ? <img src={d.thumbnail} alt="" className="w-full h-full object-contain" />
                      : <span className="flex items-center justify-center h-full" style={{ color: 'var(--color-muted)' }}>{getIcon('pen-tool', { size: 28 })}</span>}
                  </button>
                </Tooltip>
                <div className="p-3 space-y-2 flex-1 flex flex-col">
                  {renaming && renaming.id === d.id ? (
                    <div onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); rename(); } else if (e.key === 'Escape') setRenaming(null); }}>
                      <VoiceInput value={renaming.title} onChange={(v) => setRenaming({ id: d.id, title: v })} onBlur={rename} placeholder="Name" label={`New name for ${d.title}`} />
                    </div>
                  ) : (
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }} title={d.title}>{d.title}</p>
                  )}
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{pieceCount(d.elementCount)} · {d.look === 'clean' ? 'clean look' : 'sketch look'} · changed {when(d.updatedAt)}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-auto pt-1">
                    {confirmId === d.id ? (
                      <>
                        <span className="text-xs" style={{ color: 'var(--color-text)' }}>Delete?</span>
                        <Tooltip text="Yes, delete it. It waits 30 days in the recycle bin and an Undo button appears.">
                          <button type="button" className={BTN} style={{ ...BTN_STYLE, color: '#ef4444', borderColor: '#ef4444' }} onClick={() => remove(d)}>Yes</button>
                        </Tooltip>
                        <Tooltip text="No, keep it.">
                          <button type="button" className={BTN} style={BTN_STYLE} onClick={() => setConfirmId(null)}>No</button>
                        </Tooltip>
                      </>
                    ) : (
                      <>
                        <Tooltip text="Change the name of this diagram.">
                          <button type="button" className={BTN} style={BTN_STYLE} onClick={() => setRenaming({ id: d.id, title: d.title })}>{getIcon('edit', { size: 13 })} Rename</button>
                        </Tooltip>
                        {d.noteCount > 0 && (
                          <Tooltip text={d.noteCount === 1 ? 'Go to the note this diagram is in.' : `This diagram is in ${d.noteCount} notes. Choose one to go to it.`}>
                            <button type="button" className={BTN} style={BTN_STYLE} aria-expanded={d.noteCount > 1 ? !!(notesMenu && notesMenu.id === d.id) : undefined} onClick={() => showNotes(d)}>
                              {getIcon('file-text', { size: 13 })} {d.noteCount === 1 ? 'In a note' : `In ${d.noteCount} notes`}
                            </button>
                          </Tooltip>
                        )}
                        <Tooltip text="Make another diagram with the same pieces. The two are separate afterwards.">
                          <button type="button" className={BTN} style={BTN_STYLE} onClick={() => copy(d)}>{getIcon('copy', { size: 13 })} Copy</button>
                        </Tooltip>
                        <Tooltip text="Delete this diagram. You are asked first, and you can undo it.">
                          <button type="button" className={BTN} style={BTN_STYLE} onClick={() => setConfirmId(d.id)} aria-label={`Delete ${d.title}`}>{getIcon('trash', { size: 13 })} Delete</button>
                        </Tooltip>
                      </>
                    )}
                  </div>
                  {notesMenu && notesMenu.id === d.id && (
                    <ul role="menu" className="rounded-xl border p-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                      {notesMenu.notes.map((n) => (
                        <li key={n.id} role="none">
                          <button type="button" role="menuitem" onClick={() => navigate(`/notes?note=${n.id}`)} className="block w-full text-left px-3 py-1.5 rounded-lg text-xs truncate transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-text)' }}>{n.title || 'Untitled'}</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
