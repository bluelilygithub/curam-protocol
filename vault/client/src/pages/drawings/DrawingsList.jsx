import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import PlanClientPicker, { useClientOptions } from '../plans/PlanClientPicker';
import { loadExcalidraw } from './loadExcalidraw';
import TemplateGallery from './TemplateGallery';
import { STARTS } from './drawingsStarts.mjs';
import { filterDrawings, arrangeDrawings, pieceCount, readSceneFile, titleFromFileName } from './sceneLogic.mjs';

const BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border transition-opacity duration-200 hover:opacity-60 disabled:opacity-40';
const BTN_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' };
const FIELD = 'px-2 py-1.5 rounded-lg border text-xs';
const FIELD_STYLE = { borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' };
const MUTED = { color: 'var(--color-muted)' };
const OPEN_ON_KEY = 'vault:drawings:openOn'; // 'diagrams' to skip the start screen

const SECTIONS = [
  { id: 'start', label: 'What do you want to do?', icon: 'layout-grid', tip: 'Suggestions to start from: describe it for the AI, an org chart, a process, a timeline, a mind map and more.' },
  { id: 'diagrams', label: 'Your diagrams', icon: 'folder', tip: 'Every diagram you have saved. Search, file them under a client or project, filter and sort.' },
  { id: 'templates', label: 'Your templates', icon: 'copy', tip: 'The templates you saved with Save as template. Start a new diagram from one, rename or delete it.' },
];

const readLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };

function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return `today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

/**
 * The Diagrams dashboard (like Graphics and Video Tools): a sidebar with What do you want to do? (suggestion cards, drawingsStarts.mjs),
 * Your diagrams (the repository: search, file under a CRM client / client project, filter, sort, open, rename, copy, delete with Undo) and
 * Your templates (Save as template). The section is in the URL (?view=), so Back and links work. `header` is the page's title row.
 */
export default function DrawingsList({ header }) {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const addToast = useToastStore((s) => s.addToast);
  const { clients, projects, available: crmOn } = useClientOptions();
  const [items, setItems] = useState(null); // null while loading
  const [max, setMax] = useState(300);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(null); // { id, title }
  const [confirmId, setConfirmId] = useState(null); // the drawing whose "Delete? Yes / No" is showing
  const [notesMenu, setNotesMenu] = useState(null); // { id, notes } while a card's list of notes is open
  const [filing, setFiling] = useState(null); // the drawing whose client / project pickers are showing
  const [gallery, setGallery] = useState(null); // null closed; { initialId } open (initialId: a built-in template to pick first)
  const [filter, setFilter] = useState({ clientId: '', clientProjectId: '', sort: 'recent' });
  const [openOn, setOpenOn] = useState(() => readLocal(OPEN_ON_KEY) || 'start');
  const fileRef = useRef(null);

  const section = SECTIONS.some((s) => s.id === params.get('view')) ? params.get('view') : (openOn === 'diagrams' ? 'diagrams' : 'start');
  const go = (id) => { const next = new URLSearchParams(params); next.set('view', id); setParams(next); };

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
  const warm = () => { loadExcalidraw().catch(() => {}); }; // start fetching the editor while the person is still choosing
  const full = (items || []).length >= max;

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

  // `state` goes to the editor: { template } (a built-in template to draw once the board is ready) or { openDraw } (open Draw it for me)
  const create = async (body = {}, state = null) => {
    setBusy(true);
    try {
      const res = await api.post('/api/drawings', body);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not make a new diagram.');
      navigate(`/drawings/${data.drawing.id}`, state ? { state } : undefined);
    } catch (err) {
      addToast(err.message, 'error');
      setBusy(false);
    }
  };

  // a diagram from one of the person's own templates (Save as template): a copy of it, named after it
  const fromOwnTemplate = async (t) => {
    setBusy(true);
    try {
      const res = await api.post(`/api/drawings/${t.id}/duplicate`, { title: t.title });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not make a diagram from that template.');
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
  const pickFile = () => fileRef.current && fileRef.current.click();

  const startFrom = (s) => {
    if (full && s.action !== 'gallery') { addToast(`You already have ${max} diagrams and templates. Delete some to make a new one.`, 'error'); return; }
    if (s.action === 'describe') create({}, { openDraw: true });
    else if (s.action === 'blank') create();
    else if (s.action === 'file') pickFile();
    else setGallery({ initialId: s.action === 'template' ? s.template : null });
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

  // file a diagram under a client / client project (the server applies the Plans rules: a project also chooses its client)
  const fileUnder = async (d, fields) => {
    try {
      const res = await api.put(`/api/drawings/${d.id}`, fields);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not file it.');
      await load(); // brings the client and project names with it
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

  // the person's own templates live in the same list (isTemplate); they show under Your templates and in the gallery, not with the diagrams
  const diagrams = useMemo(() => (items || []).filter((d) => !d.isTemplate), [items]);
  const templates = useMemo(() => (items || []).filter((d) => d.isTemplate), [items]);
  const shown = useMemo(() => arrangeDrawings(filterDrawings(diagrams, query), filter), [diagrams, query, filter]);
  const filtered = query.trim() || filter.clientId || filter.clientProjectId;
  const filterProjects = filter.clientId && filter.clientId !== 'none' ? projects.filter((p) => p.clientId === Number(filter.clientId)) : projects;

  const chooseOpenOn = (v) => { setOpenOn(v); writeLocal(OPEN_ON_KEY, v); };

  // ---- one card: a diagram, or (template = true) one of the person's own templates ----
  const card = (d, template = false) => (
    <li key={d.id} className="rounded-xl border overflow-hidden flex flex-col" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <Tooltip text={template ? 'Start a new diagram from this template. The template itself stays as it is.' : 'Open this diagram.'}>
        <button
          type="button" onClick={() => (template ? fromOwnTemplate(d) : open(d.id))} onPointerEnter={warm} disabled={template && (busy || full)}
          aria-label={template ? `New diagram from ${d.title}` : `Open ${d.title}`}
          className="block w-full h-40 transition-opacity duration-200 hover:opacity-80 disabled:opacity-40"
          style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}
        >
          {d.thumbnail
            ? <img src={d.thumbnail} alt="" className="w-full h-full object-contain" />
            : <span className="flex items-center justify-center h-full" style={MUTED}>{getIcon('pen-tool', { size: 28 })}</span>}
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
        <p className="text-xs" style={MUTED}>{pieceCount(d.elementCount)} · {d.look === 'clean' ? 'clean look' : 'sketch look'} · changed {when(d.updatedAt)}</p>
        {!template && (d.clientName || d.clientProjectName) && (
          <p className="text-xs truncate" style={{ color: 'var(--color-primary)' }} title={[d.clientName, d.clientProjectName].filter(Boolean).join(' · ')}>
            {getIcon('briefcase', { size: 11 })} {[d.clientName, d.clientProjectName].filter(Boolean).join(' · ')}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 mt-auto pt-1">
          {confirmId === d.id ? (
            <>
              <span className="text-xs" style={{ color: 'var(--color-text)' }}>Delete?</span>
              <Tooltip text={template ? 'Yes, delete this template. Diagrams made from it are not touched. It waits 30 days in the recycle bin and an Undo button appears.' : 'Yes, delete it. It waits 30 days in the recycle bin and an Undo button appears.'}>
                <button type="button" className={BTN} style={{ ...BTN_STYLE, color: '#ef4444', borderColor: '#ef4444' }} onClick={() => remove(d)}>Yes</button>
              </Tooltip>
              <Tooltip text="No, keep it.">
                <button type="button" className={BTN} style={BTN_STYLE} onClick={() => setConfirmId(null)}>No</button>
              </Tooltip>
            </>
          ) : (
            <>
              {template && (
                <Tooltip text="Start a new diagram that is a copy of this template, and open it.">
                  <button type="button" className={BTN} style={BTN_STYLE} disabled={busy || full} onClick={() => fromOwnTemplate(d)}>{getIcon('plus', { size: 13 })} Use</button>
                </Tooltip>
              )}
              <Tooltip text={template ? 'Change the name of this template.' : 'Change the name of this diagram.'}>
                <button type="button" className={BTN} style={BTN_STYLE} onClick={() => setRenaming({ id: d.id, title: d.title })}>{getIcon('edit', { size: 13 })} Rename</button>
              </Tooltip>
              {!template && crmOn && (
                <Tooltip text="File this diagram under one of your clients, and optionally one of its projects, so you can find it with the filters above.">
                  <button type="button" className={BTN} style={BTN_STYLE} aria-expanded={filing === d.id} onClick={() => setFiling(filing === d.id ? null : d.id)}>{getIcon('briefcase', { size: 13 })} File</button>
                </Tooltip>
              )}
              {!template && d.noteCount > 0 && (
                <Tooltip text={d.noteCount === 1 ? 'Go to the note this diagram is in.' : `This diagram is in ${d.noteCount} notes. Choose one to go to it.`}>
                  <button type="button" className={BTN} style={BTN_STYLE} aria-expanded={d.noteCount > 1 ? !!(notesMenu && notesMenu.id === d.id) : undefined} onClick={() => showNotes(d)}>
                    {getIcon('file-text', { size: 13 })} {d.noteCount === 1 ? 'In a note' : `In ${d.noteCount} notes`}
                  </button>
                </Tooltip>
              )}
              {!template && (
                <Tooltip text="Make another diagram with the same pieces. The two are separate afterwards.">
                  <button type="button" className={BTN} style={BTN_STYLE} onClick={() => copy(d)}>{getIcon('copy', { size: 13 })} Copy</button>
                </Tooltip>
              )}
              <Tooltip text={template ? 'Delete this template. You are asked first, and you can undo it.' : 'Delete this diagram. You are asked first, and you can undo it.'}>
                <button type="button" className={BTN} style={BTN_STYLE} onClick={() => setConfirmId(d.id)} aria-label={`Delete ${d.title}`}>{getIcon('trash', { size: 13 })} Delete</button>
              </Tooltip>
            </>
          )}
        </div>
        {filing === d.id && (
          <div className="flex flex-wrap items-end gap-2 rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <PlanClientPicker what="diagram" clientId={d.clientId} clientProjectId={d.clientProjectId} clientName={d.clientName} clientProjectName={d.clientProjectName} onChange={(fields) => fileUnder(d, fields)} />
          </div>
        )}
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
  );

  const grid = 'grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
  const loading = items === null && (
    <div className={grid}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-48" label="Loading your diagrams" />)}</div>
  );
  const count = { diagrams: diagrams.length, templates: templates.length };

  return (
    <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
      <aside className="w-full sm:w-60 shrink-0 border-b sm:border-b-0 sm:border-r p-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        {header}
        <Tooltip text="Start a diagram: a blank page, or a ready-made template (org chart, timeline, process, mind map and more) you then change. It saves by itself as you draw.">
          <button
            type="button" data-tour="drawings-new" onClick={() => setGallery({ initialId: null })} onPointerEnter={warm} disabled={busy || full}
            className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity duration-200 hover:opacity-80 disabled:opacity-40"
            style={{ background: 'var(--color-primary)' }}
          >
            {getIcon('plus', { size: 15 })} New diagram
          </button>
        </Tooltip>
        <Tooltip text="Bring in a diagram file ending in .excalidraw (from Excalidraw or an earlier export). It is saved as a new diagram in your list.">
          <button type="button" data-tour="drawings-open-file" className={`${BTN} w-full justify-center`} style={BTN_STYLE} disabled={busy || full} onClick={pickFile}>
            {getIcon('upload', { size: 14 })} Open a file
          </button>
        </Tooltip>
        <input ref={fileRef} type="file" accept=".excalidraw,.json,application/json" className="hidden" onChange={onFile} aria-label="Choose a diagram file" />
        <nav aria-label="Diagrams sections" className="space-y-1 pt-1">
          {SECTIONS.map((s) => (
            <Tooltip key={s.id} text={s.tip} side="right">
              <button
                type="button" onClick={() => go(s.id)} aria-current={section === s.id ? 'page' : undefined}
                className="w-full flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
                style={{ borderColor: section === s.id ? 'var(--color-primary)' : 'transparent', color: section === s.id ? 'var(--color-primary)' : 'var(--color-text)', background: section === s.id ? 'var(--color-bg)' : 'transparent' }}
              >
                {getIcon(s.icon, { size: 13 })}
                <span className="flex-1 text-left">{s.label}</span>
                {count[s.id] !== undefined && items !== null && <span style={MUTED}>{count[s.id]}</span>}
              </button>
            </Tooltip>
          ))}
        </nav>
        {full && <p className="text-xs" style={{ color: '#b45309' }}>You have {max} diagrams and templates, the most you can keep. Delete some to make new ones.</p>}
      </aside>

      <main className="flex-1 min-w-0 p-6 space-y-4 max-w-[1700px]">
        {gallery && (
          <TemplateGallery
            busy={busy} own={templates} initialId={gallery.initialId} onClose={() => setGallery(null)}
            onCreate={({ title, look, diagram }) => create({ title, look }, diagram ? { template: diagram } : null)}
            onUseOwn={fromOwnTemplate} onDeleteOwn={remove}
          />
        )}
        {error && <p className="text-sm" role="alert" style={{ color: '#ef4444' }}>{error}</p>}

        {section === 'start' && (
          <section className="space-y-5" data-tour="drawings-start">
            <div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>What do you want to do?</h2>
              <p className="text-sm mt-1" style={MUTED}>Pick a starting point and it opens straight away, ready to change. Every box can be renamed, moved or deleted.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {STARTS.map((s) => (
                <button
                  key={s.id} type="button" onClick={() => startFrom(s)} onPointerEnter={warm} disabled={busy}
                  className="text-left rounded-2xl border p-4 transition-opacity hover:opacity-70 disabled:opacity-40"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                >
                  <span className="flex items-center gap-2 mb-1.5" style={{ color: 'var(--color-primary)' }}>
                    {getIcon(s.icon, { size: 16 })}
                    <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{s.title}</span>
                  </span>
                  <span className="block text-xs" style={MUTED}>{s.blurb}</span>
                </button>
              ))}
            </div>
            {templates.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide" style={MUTED}>From your templates</h3>
                <div className="flex flex-wrap gap-2">
                  {templates.slice(0, 6).map((t) => (
                    <Tooltip key={t.id} text="Start a new diagram from this template of yours.">
                      <button type="button" className={BTN} style={BTN_STYLE} disabled={busy || full} onClick={() => fromOwnTemplate(t)}>{getIcon('copy', { size: 13 })} {t.title}</button>
                    </Tooltip>
                  ))}
                  {templates.length > 6 && <button type="button" className={BTN} style={BTN_STYLE} onClick={() => go('templates')}>All {templates.length}…</button>}
                </div>
              </div>
            )}
            {diagrams.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide" style={MUTED}>Carry on with</h3>
                  <button type="button" onClick={() => go('diagrams')} className="text-xs underline hover:opacity-60" style={{ color: 'var(--color-primary)' }}>All your diagrams ({diagrams.length})</button>
                </div>
                <ul className="grid gap-3 grid-cols-2 md:grid-cols-4">
                  {arrangeDrawings(diagrams, { sort: 'recent' }).slice(0, 4).map((d) => (
                    <li key={d.id}>
                      <Tooltip text="Open this diagram.">
                        <button type="button" onClick={() => open(d.id)} onPointerEnter={warm} className="w-full text-left rounded-xl border overflow-hidden transition-opacity hover:opacity-80" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                          <span className="block h-24" style={{ background: 'var(--color-bg)' }}>
                            {d.thumbnail ? <img src={d.thumbnail} alt="" className="w-full h-full object-contain" /> : <span className="flex items-center justify-center h-full" style={MUTED}>{getIcon('pen-tool', { size: 20 })}</span>}
                          </span>
                          <span className="block px-2 py-1.5 text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{d.title}</span>
                        </button>
                      </Tooltip>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <label className="flex items-center gap-2 text-xs cursor-pointer" style={MUTED}>
              <Tooltip text="Skip this screen from now on: Diagrams opens on Your diagrams. What do you want to do? in the list on the left brings this screen back.">
                <input type="checkbox" checked={openOn === 'diagrams'} onChange={(e) => chooseOpenOn(e.target.checked ? 'diagrams' : 'start')} />
              </Tooltip>
              Next time, open on Your diagrams instead of this screen
            </label>
          </section>
        )}

        {section === 'diagrams' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[12rem] max-w-md">
                <Tooltip text="Narrow the list to diagrams whose name has all the words you type. The microphone lets you say them.">
                  <div className="w-full">
                    <VoiceInput value={query} onChange={setQuery} placeholder="Search your diagrams…" label="Search your diagrams" />
                  </div>
                </Tooltip>
              </div>
              {crmOn && (
                <>
                  <Tooltip text="Show only the diagrams filed under one client, or those not filed under any.">
                    <select value={filter.clientId} onChange={(e) => setFilter((f) => ({ ...f, clientId: e.target.value, clientProjectId: '' }))} aria-label="Filter by client" className={FIELD} style={FIELD_STYLE}>
                      <option value="">All clients</option>
                      <option value="none">Not filed</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Tooltip>
                  <Tooltip text="Show only the diagrams filed under one client project.">
                    <select value={filter.clientProjectId} onChange={(e) => setFilter((f) => ({ ...f, clientProjectId: e.target.value }))} disabled={filter.clientId === 'none' || filterProjects.length === 0} aria-label="Filter by client project" className={FIELD} style={FIELD_STYLE}>
                      <option value="">All projects</option>
                      {filterProjects.map((p) => <option key={p.id} value={p.id}>{filter.clientId ? p.name : `${p.clientName ? `${p.clientName} · ` : ''}${p.name}`}</option>)}
                    </select>
                  </Tooltip>
                </>
              )}
              <Tooltip text="The order of the diagrams.">
                <select value={filter.sort} onChange={(e) => setFilter((f) => ({ ...f, sort: e.target.value }))} aria-label="Sort diagrams" className={FIELD} style={FIELD_STYLE}>
                  <option value="recent">Newest change first</option>
                  <option value="oldest">Oldest change first</option>
                  <option value="name">Name, A to Z</option>
                </select>
              </Tooltip>
            </div>
            <div data-tour="drawings-list">
              {loading}
              {items !== null && diagrams.length === 0 && !error && (
                <EmptyState
                  icon="pen-tool"
                  title="No diagrams yet"
                  body="Sketch an idea, a diagram or a plan on an endless page. Diagrams save by themselves and are private to you."
                  action={<button type="button" onClick={() => go('start')} className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity duration-200 hover:opacity-80" style={{ background: 'var(--color-primary)' }}>See where to start</button>}
                />
              )}
              {items !== null && diagrams.length > 0 && shown.length === 0 && (
                <p className="text-sm" style={MUTED}>{filtered ? 'No diagram matches the search and filters.' : 'No diagrams.'}</p>
              )}
              {shown.length > 0 && <ul className={grid}>{shown.map((d) => card(d))}</ul>}
            </div>
          </section>
        )}

        {section === 'templates' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm flex-1 min-w-[16rem]" style={MUTED}>Your own templates. Make one from any diagram with Save as template above its board. Starting from one makes a new diagram; the template stays as it is.</p>
              <Tooltip text="Open the gallery of built-in templates: org charts, projects, timelines, processes, mind maps and more.">
                <button type="button" className={BTN} style={BTN_STYLE} onClick={() => setGallery({ initialId: null })}>{getIcon('layout-grid', { size: 13 })} Built-in templates</button>
              </Tooltip>
            </div>
            {loading}
            {items !== null && templates.length === 0 && (
              <EmptyState icon="copy" title="No templates of your own yet" body="Open a diagram you would like to reuse and press Save as template above its board. It then shows here and under New diagram." />
            )}
            {templates.length > 0 && <ul className={grid}>{arrangeDrawings(templates, { sort: 'name' }).map((t) => card(t, true))}</ul>}
          </section>
        )}
      </main>
    </div>
  );
}
