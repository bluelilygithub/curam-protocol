import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useProjectStore from '../store/projectStore';
import useToastStore from '../store/toastStore';
import AtMentionDropdown from '../components/AtMentionDropdown';
import Tooltip from '../components/Tooltip';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { startNotesTour, TOUR_KEY as NOTES_TOUR_KEY } from '../utils/tours/notesTour';
import VoiceNoteRecorder from './notes/VoiceNoteRecorder';
import NotesTutorChat from './notes/NotesTutorChat';
import NewNoteChooser from './notes/NewNoteChooser';
import NotesListPanel from './notes/NotesListPanel';
import InsertSourceModal from './notes/InsertSourceModal';
import NoteAiPanel from './notes/NoteAiPanel';
import NoteMarkdownView from './notes/NoteMarkdownView';
import NoteTagsEditor from './notes/NoteTagsEditor';
import NoteFilesStrip from './notes/NoteFilesStrip';
import useNoteAttachments from './notes/useNoteAttachments';
import NoteReminderPanel from './notes/NoteReminderPanel';
import AskNotesPanel from './notes/AskNotesPanel';
import { NOTE_TIPS } from './notes/noteTips.mjs';
import { NOTES_INTRO, HOW_IT_WORKS, NOTES_NOT } from './notes/notesInfo.mjs';
import { reminderState, reminderText, repeatOf, localZone } from './notes/noteReminders.mjs';
import TemplatePicker from './notes/TemplatePicker';
import RecentlyDeletedModal from './notes/RecentlyDeletedModal';
import { dailyPayload, templateToNote } from './notes/noteTemplates.mjs';
import TagManager from './notes/TagManager';
import { DEFAULT_FILTERS, sameFilters, isPlain, describeFilters } from './notes/noteViews.mjs';
import { addTag } from './notes/noteTags.mjs';
import { toggleTaskLine, taskCounts } from './notes/noteMarkdown.mjs';
import { AI_ACTIONS, applyText } from './notes/noteAiActions.mjs';
import useNotesList, { toRow } from './notes/useNotesList';
import useDictation from './notes/useDictation';
import { NOTES_TOOLS } from './notes/notesTools.mjs';

const NOTE_BODY_LIMIT = 500;
const AUTOSAVE_DELAY = 1000; // ms after the last keystroke
const MODE_KEY = 'vault:notes:mode'; // 'write' | 'preview', remembered on this device

function readMode() {
  try { return localStorage.getItem(MODE_KEY) === 'preview' ? 'preview' : 'write'; } catch { return 'write'; }
}

export default function NotesPage() {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { projects, fetchProjects, create: createProject } = useProjectStore();
  const addToast = useToastStore((s) => s.addToast);

  const projectParam = searchParams.get('project') || '';
  const noteParam = searchParams.get('note') || '';
  const list = useNotesList({ initialProjectId: projectParam });
  const { patchNote, removeNote } = list;

  const [viewportMobile, setViewportMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);

  // The open note. `selected` holds its details (id, project, client...); the text is in title/body so typing never re-renders the list.
  const [selected, setSelected] = useState(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [bodyLoading, setBodyLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState('saved'); // saved | dirty | saving | error

  const [showChatPicker, setShowChatPicker] = useState(false);
  const [showRecorder, setShowRecorder] = useState(false);
  const [showNewChooser, setShowNewChooser] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [convertedNoteIds, setConvertedNoteIds] = useState(new Set());
  const [insertKind, setInsertKind] = useState(null); // 'web' | 'gmail' | 'calendar'
  const [showMention, setShowMention] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [clients, setClients] = useState([]);
  const [mode, setModeState] = useState(readMode); // Write (the text box) or Preview (formatted)
  const [allTags, setAllTags] = useState([]); // [{ tag, count }] for the filter, the suggestions and Manage tags
  const [showTagManager, setShowTagManager] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState(null); // the person's own; null while loading
  const [showBin, setShowBin] = useState(false);
  const [showReminder, setShowReminder] = useState(false);
  const [dragging, setDragging] = useState(false); // files are being dragged over the open note
  const [showAsk, setShowAsk] = useState(false);
  const info = useToolInfoModal('vault_notes_info_seen'); // the (i) box opens by itself the first time, like the other tools
  const [views, setViews] = useState([]); // saved views: [{ id, name, filters }]
  const [appliedViewId, setAppliedViewId] = useState(null); // the view last opened, so changes to it can be saved back
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [aiAction, setAiAction] = useState(null); // which AI action's panel is open
  const [aiBackup, setAiBackup] = useState(null); // { id, title, body } from just before an AI change, for Undo

  const pendingConvertNoteIdRef = useRef(null);
  const bodyRef = useRef(null);
  const titleRef = useRef(null);
  const searchRef = useRef(null);
  const keyboardRef = useRef(null); // phones: focusing this inside the tap keeps the keyboard up while a new note opens
  const mentionTimerRef = useRef(null);
  const mentionAtIndexRef = useRef(-1);
  const selectedRef = useRef(null);
  const bodyValueRef = useRef('');
  const titleValueRef = useRef('');
  const selectToken = useRef(0);

  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { bodyValueRef.current = body; }, [body]);
  useEffect(() => { titleValueRef.current = title; }, [title]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  useEffect(() => { list.setProjectId(projectParam); }, [projectParam]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const check = () => setViewportMobile(window.innerWidth < 640);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    const handler = () => {
      if (pendingConvertNoteIdRef.current) {
        const id = pendingConvertNoteIdRef.current;
        setConvertedNoteIds((prev) => new Set([...prev, id]));
        pendingConvertNoteIdRef.current = null;
      }
    };
    document.addEventListener('vault:task-created', handler);
    return () => document.removeEventListener('vault:task-created', handler);
  }, []);

  // ── Saving ────────────────────────────────────────────────────────────────
  // One edit waiting at a time (pending). Saves run one after another so a slow one can never land after a newer one. Switching
  // notes, hiding the tab or leaving the page saves straight away instead of waiting for the pause.
  const pending = useRef(null); // { id, title, body }
  const timer = useRef(null);
  const chain = useRef(Promise.resolve());

  const runSave = useCallback(() => {
    clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return chain.current;
    pending.current = null;
    chain.current = chain.current.then(async () => {
      const mine = selectedRef.current?.id === p.id;
      if (mine) setSaveState('saving');
      try {
        const res = await api.put(`/api/notes/${p.id}`, { title: p.title, body: p.body });
        if (!res.ok) throw new Error('save failed');
        patchNote(toRow(await res.json()));
        if (selectedRef.current?.id === p.id) setSaveState(pending.current?.id === p.id ? 'dirty' : 'saved');
      } catch {
        if (!pending.current) pending.current = p; // keep the words so Try again can send them
        if (selectedRef.current?.id === p.id) setSaveState('error');
      }
    });
    return chain.current;
  }, [patchNote]);

  const scheduleSave = useCallback((id, nextTitle, nextBody) => {
    pending.current = { id, title: nextTitle, body: nextBody };
    setSaveState('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(runSave, AUTOSAVE_DELAY);
  }, [runSave]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') runSave(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', runSave);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', runSave);
      runSave();
    };
  }, [runSave]);

  // ── Dictation ─────────────────────────────────────────────────────────────
  const dictation = useDictation({
    onText: async (text, noteId) => {
      if (selectedRef.current?.id === noteId) {
        const current = bodyValueRef.current;
        const next = current + (current ? '\n' : '') + text;
        setBody(next);
        scheduleSave(noteId, titleValueRef.current, next);
        return;
      }
      // The person opened another note while speaking: the words still belong to the first one.
      try {
        const res = await api.get(`/api/notes/${noteId}`);
        const note = await res.json();
        await api.put(`/api/notes/${noteId}`, { body: (note.body ? `${note.body}\n` : '') + text });
      } catch { addToast('Your dictated words could not be added to that note.', 'error'); }
    },
  });

  // ── Opening a note ────────────────────────────────────────────────────────
  const selectNote = useCallback(async (row, { focusTitle = false } = {}) => {
    runSave();
    dictation.stop();
    setConfirmDelete(false);
    setShowChatPicker(false);
    setAiMenuOpen(false);
    setAiBackup(null);
    const token = ++selectToken.current;
    const needsBody = row.body === undefined;
    setSelected(row);
    setTitle(row.title || '');
    setBody(row.body ?? '');
    setSaveState('saved');
    setLoadError('');
    setBodyLoading(needsBody);
    if (needsBody) {
      try {
        const res = await api.get(`/api/notes/${row.id}`);
        if (!res.ok) throw new Error('load failed');
        const full = await res.json();
        if (token !== selectToken.current) return;
        setSelected(full);
        setTitle(full.title);
        setBody(full.body);
      } catch {
        if (token === selectToken.current) setLoadError('This note could not be opened.');
      } finally {
        if (token === selectToken.current) setBodyLoading(false);
      }
    }
    if (token !== selectToken.current) return;
    setTimeout(() => {
      if (focusTitle === 'end') { const el = titleRef.current; el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); }
      else if (focusTitle) { titleRef.current?.focus(); titleRef.current?.select(); } else if (!viewportMobile) bodyRef.current?.focus();
    }, 0);
  }, [runSave, dictation, viewportMobile]);

  const closeNote = useCallback(() => {
    runSave();
    dictation.stop();
    selectToken.current++;
    setAiBackup(null);
    setSelected(null);
    setTitle('');
    setBody('');
    setConfirmDelete(false);
  }, [runSave, dictation]);

  // A link to /notes?note=ID opens that note once (not again each time the list changes).
  useEffect(() => {
    if (!noteParam) return;
    const id = Number(noteParam);
    if (id && selectedRef.current?.id !== id) selectNote({ id, title: '', project_id: null, client_id: null });
  }, [noteParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Creating ──────────────────────────────────────────────────────────────
  async function createNote({ focusTitle = false } = {}) {
    runSave();
    try {
      const res = await api.post('/api/notes', {
        title: 'Untitled', body: '',
        project_id: list.projectId ? Number(list.projectId) : null, // a note made while looking at a project belongs to it
        client_id: list.clientId ? Number(list.clientId) : null,
      });
      if (!res.ok) throw new Error('create failed');
      const note = await res.json();
      const project = projects.find((p) => p.id === note.project_id);
      const client = clients.find((c) => c.id === note.client_id);
      const full = { ...note, project_name: project?.name || null, client_name: client?.name || null, tags: [] };
      patchNote(toRow(full));
      await selectNote(full, { focusTitle });
    } catch {
      addToast('The note could not be created. Try again.', 'error');
    }
  }

  async function startWrittenNote() {
    keyboardRef.current?.focus(); // inside the tap, so a phone keeps its keyboard up while the note is made
    setShowNewChooser(false);
    await createNote({ focusTitle: true });
  }

  // ── Templates and the daily note ──────────────────────────────────────────
  async function loadTemplates() {
    try {
      const res = await api.get('/api/notes/templates');
      setTemplates(res.ok ? await res.json() : []);
    } catch { setTemplates([]); }
  }

  function openTemplates() {
    setShowNewChooser(false);
    setTemplates(null);
    setShowTemplates(true);
    loadTemplates();
  }

  async function createFromTemplate(template) {
    setShowTemplates(false);
    runSave();
    const spec = templateToNote(template);
    try {
      const res = await api.post('/api/notes', {
        title: spec.title, body: spec.body,
        project_id: list.projectId ? Number(list.projectId) : null, // like a new blank note: filed under what you are looking at
        client_id: list.clientId ? Number(list.clientId) : null,
      });
      if (!res.ok) throw new Error('create failed');
      const note = await res.json();
      let tags = [];
      if (spec.tags.length) {
        const r2 = await api.put(`/api/notes/${note.id}/tags`, { tags: spec.tags });
        if (r2.ok) tags = (await r2.json()).tags;
        refreshTags();
      }
      const project = projects.find((p) => p.id === note.project_id);
      const client = clients.find((c) => c.id === note.client_id);
      const full = { ...note, project_name: project?.name || null, client_name: client?.name || null, tags };
      patchNote(toRow(full));
      setMode('write');
      await selectNote(full, { focusTitle: /\s$/.test(spec.title) ? 'end' : false });
    } catch {
      addToast('The note could not be made from that template. Try again.', 'error');
    }
  }

  // The open note becomes a template: its title, text and tags as they are now ({{date}} written in it is filled in each use).
  async function saveAsTemplate(name) {
    const open = selectedRef.current;
    if (!open) return false;
    try { await ensureSaved(); } catch { addToast('Save the note first, then try again.', 'error'); return false; }
    try {
      const res = await api.post('/api/notes/templates', { name, title: titleValueRef.current, body: bodyValueRef.current, tags: open.tags || [] });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { addToast(data.error || 'The template could not be saved.', 'error'); return false; }
      setTemplates((prev) => [...(prev || []), data].sort((a, b) => a.name.localeCompare(b.name)));
      addToast(`Template "${name}" saved ✓`, 'success');
      return true;
    } catch {
      addToast('The template could not be saved. Try again.', 'error');
      return false;
    }
  }

  async function deleteTemplate(template) {
    try {
      const res = await api.delete(`/api/notes/templates/${template.id}`);
      if (!res.ok) throw new Error('delete failed');
      const { binId } = await res.json();
      setTemplates((prev) => (prev || []).filter((t) => t.id !== template.id));
      addToast(`Template "${template.name}" deleted. Kept 30 days.`, 'success', undefined, { label: 'Undo', onClick: () => undoDelete(binId, 'Template restored ✓', loadTemplates) });
    } catch {
      addToast('The template could not be deleted. Try again.', 'error');
    }
  }

  // Today's note: opened if it exists, otherwise made for today with last time's unfinished to-dos carried over.
  async function openDaily() {
    runSave();
    try {
      const res = await api.post('/api/notes/daily', dailyPayload());
      if (!res.ok) throw new Error('daily failed');
      const { note, created, carried } = await res.json();
      patchNote(toRow(note));
      if (created) setMode('write');
      await selectNote(note);
      refreshTags();
      if (carried) addToast(`Carried over ${carried} unfinished to-do${carried === 1 ? '' : 's'} from your last daily note.`, 'success');
    } catch {
      addToast("Today's note could not be opened. Try again.", 'error');
    }
  }

  // Undo from a "deleted" toast, or any restore done outside the Recently deleted window.
  async function undoDelete(binId, message = 'Note restored ✓', after) {
    try {
      const res = await api.post(`/api/recycle-bin/${binId}/restore`);
      if (!res.ok) throw new Error('restore failed');
      list.reload();
      refreshTags();
      after?.();
      addToast(message, 'success');
    } catch {
      addToast('That could not be restored. Look in Recently deleted.', 'error');
    }
  }

  async function handleVoiceNote(note) {
    patchNote(toRow(note));
    selectNote(note);
  }

  // ── Delete / convert / chat ───────────────────────────────────────────────
  async function deleteNote(note) {
    try {
      const res = await api.delete(`/api/notes/${note.id}`);
      if (!res.ok && res.status !== 404) throw new Error('delete failed');
      const { binId } = await res.json().catch(() => ({}));
      if (pending.current?.id === note.id) { pending.current = null; clearTimeout(timer.current); }
      removeNote(note.id);
      refreshTags();
      if (selectedRef.current?.id === note.id) closeNote();
      if (binId) addToast('Note deleted. Kept 30 days in Recently deleted.', 'success', undefined, { label: 'Undo', onClick: () => undoDelete(binId) });
    } catch {
      addToast('The note could not be deleted. Try again.', 'error');
    }
  }

  function convertToTask(note) {
    pendingConvertNoteIdRef.current = note.id;
    const text = note.id === selected?.id ? body : (note.body ?? note.preview ?? '');
    document.dispatchEvent(new CustomEvent('vault:open-quick-capture', {
      detail: {
        title: note.title === 'Untitled' ? '' : note.title,
        notes: (text || '').substring(0, NOTE_BODY_LIMIT),
        projectId: note.project_id || null,
        toastMessage: 'Task created from note ✓',
      },
    }));
  }

  function takeToChatWith(projectId) {
    if (!selected) return;
    const text = [title !== 'Untitled' ? title : '', body].filter(Boolean).join('\n\n');
    setShowChatPicker(false);
    setNewProjectName('');
    setCreatingProject(false);
    navigate(projectId ? `/projects/${projectId}/chat` : '/chat', { state: { draft: text } });
  }

  async function handleCreateProjectAndChat() {
    if (!newProjectName.trim()) return;
    setCreatingProject(true);
    try {
      const project = await createProject({ name: newProjectName.trim() });
      takeToChatWith(project.id);
    } catch {
      setCreatingProject(false);
    }
  }

  // ── Write / Preview ───────────────────────────────────────────────────────
  const setMode = useCallback((next) => {
    setModeState(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* not remembered in a private window */ }
    if (next === 'write') setTimeout(() => bodyRef.current?.focus(), 0);
  }, []);

  // A to-do ticked in Preview is written back into the note's text like any other edit.
  const toggleTask = useCallback((line) => {
    const id = selectedRef.current?.id;
    if (!id) return;
    const next = toggleTaskLine(bodyValueRef.current, line);
    if (next === bodyValueRef.current) return;
    setAiBackup(null);
    bodyValueRef.current = next;
    setBody(next);
    scheduleSave(id, titleValueRef.current, next);
  }, [scheduleSave]);

  // ── Saved views ───────────────────────────────────────────────────────────
  const loadViews = useCallback(async () => {
    try {
      const res = await api.get('/api/notes/views');
      if (res.ok) setViews(await res.json());
    } catch { /* the Views menu just starts empty */ }
  }, []);
  useEffect(() => { loadViews(); }, [loadViews]);

  const current = list.filters;
  const activeView = views.find((v) => sameFilters(v.filters, current)) || null;
  const appliedView = views.find((v) => v.id === appliedViewId) || null;
  const changedView = appliedView && !activeView ? appliedView : null; // opened a view, then changed something
  const nameOfProject = (id) => projects.find((p) => String(p.id) === String(id))?.name;
  const nameOfClient = (id) => clients.find((c) => String(c.id) === String(id))?.name;

  const viewsApi = {
    views,
    activeId: activeView?.id ?? null,
    plain: isPlain(current),
    changedView,
    canSave: !isPlain(current),
    summaryFor: (v) => describeFilters(v.filters, { projectName: nameOfProject(v.filters.projectId), clientName: nameOfClient(v.filters.clientId) }),
    clear() { list.clearFilters(); setAppliedViewId(null); },
    async apply(view) {
      const f = { ...DEFAULT_FILTERS, ...view.filters };
      const left = [];
      // a project or client deleted since the view was saved would show nothing: leave it out and say so
      if (f.projectId && projects.length > 0 && !projects.some((p) => String(p.id) === f.projectId)) { f.projectId = ''; left.push('project'); }
      if (f.clientId) {
        const known = await ensureClients();
        if (known.length > 0 && !known.some((c) => String(c.id) === f.clientId)) { f.clientId = ''; left.push('client'); }
      }
      list.applyFilters(f);
      setAppliedViewId(view.id);
      if (left.length) addToast(`The ${left.join(' and ')} in this view no longer exists, so it was left out.`, 'warn');
    },
    async save(name) {
      try {
        const res = await api.post('/api/notes/views', { name, filters: current });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return data.error || 'The view could not be saved.';
        setViews((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
        setAppliedViewId(data.id);
        addToast(`View "${data.name}" saved ✓`, 'success');
        return '';
      } catch { return 'The view could not be saved. Try again.'; }
    },
    async update(view) {
      try {
        const res = await api.put(`/api/notes/views/${view.id}`, { filters: current });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return data.error || 'The view could not be updated.';
        setViews((prev) => prev.map((v) => (v.id === data.id ? data : v)));
        addToast(`View "${data.name}" updated ✓`, 'success');
        return '';
      } catch { return 'The view could not be updated. Try again.'; }
    },
    async rename(id, name) {
      try {
        const res = await api.put(`/api/notes/views/${id}`, { name });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return data.error || 'The view could not be renamed.';
        setViews((prev) => prev.map((v) => (v.id === data.id ? data : v)).sort((a, b) => a.name.localeCompare(b.name)));
        return '';
      } catch { return 'The view could not be renamed. Try again.'; }
    },
    async remove(view) {
      try {
        const res = await api.delete(`/api/notes/views/${view.id}`);
        if (!res.ok) throw new Error('delete failed');
        const { binId } = await res.json();
        setViews((prev) => prev.filter((v) => v.id !== view.id));
        if (appliedViewId === view.id) setAppliedViewId(null);
        addToast(`View "${view.name}" deleted. Kept 30 days.`, 'success', undefined, { label: 'Undo', onClick: () => undoDelete(binId, 'View restored ✓', loadViews) });
      } catch {
        addToast('The view could not be deleted. Try again.', 'error');
      }
    },
  };

  // ── Tags ──────────────────────────────────────────────────────────────────
  const refreshTags = useCallback(async () => {
    try {
      const res = await api.get('/api/notes/tags');
      if (res.ok) setAllTags(await res.json());
    } catch { /* the filter and suggestions just stay as they were */ }
  }, []);
  useEffect(() => { refreshTags(); }, [refreshTags]);

  // Tags are filing, like the project: saved the moment they change (no waiting for the typing pause), and put back if the save fails.
  async function changeTags(next) {
    const note = selectedRef.current;
    if (!note) return;
    const previous = note.tags || [];
    setSelected((prev) => (prev && prev.id === note.id ? { ...prev, tags: next } : prev));
    patchNote({ id: note.id, tags: next });
    try {
      const res = await api.put(`/api/notes/${note.id}/tags`, { tags: next });
      if (!res.ok) throw new Error('save failed');
      const saved = (await res.json()).tags;
      setSelected((prev) => (prev && prev.id === note.id ? { ...prev, tags: saved } : prev));
      patchNote({ id: note.id, tags: saved });
      refreshTags();
    } catch {
      setSelected((prev) => (prev && prev.id === note.id ? { ...prev, tags: previous } : prev));
      patchNote({ id: note.id, tags: previous });
      addToast('The tags could not be saved. Try again.', 'error');
    }
  }

  // A tag was renamed or removed everywhere (Manage tags): follow it in the filter, the list and the open note.
  async function tagsChanged({ type, from, to }) {
    list.setTags((prev) => {
      const next = type === 'rename' ? prev.map((t) => (t === from ? to : t)) : prev.filter((t) => t !== from);
      return [...new Set(next)];
    });
    refreshTags();
    list.reload();
    const open = selectedRef.current;
    if (open) {
      try {
        const res = await api.get(`/api/notes/${open.id}`);
        if (res.ok) {
          const { tags } = await res.json();
          setSelected((prev) => (prev && prev.id === open.id ? { ...prev, tags } : prev));
        }
      } catch { /* the chips refresh next time the note is opened */ }
    }
  }

  // ── Files on the note ─────────────────────────────────────────────────────
  // Filing, like tags and reminders: saved at once, and the note's own text and edited date are left alone.
  const updateAttachments = useCallback((noteId, update) => {
    setSelected((prev) => (prev && prev.id === noteId ? { ...prev, attachments: update(Array.isArray(prev.attachments) ? prev.attachments : []) } : prev));
  }, []);
  const files = useNoteAttachments({ noteId: selected?.id, attachments: Array.isArray(selected?.attachments) ? selected.attachments : [], onChange: updateAttachments });
  const attachCount = Array.isArray(selected?.attachments) ? selected.attachments.length : null;
  useEffect(() => { // the paperclip count on the list row follows
    if (selected && attachCount !== null) patchNote({ id: selected.id, attachment_count: attachCount });
  }, [selected?.id, attachCount]); // eslint-disable-line react-hooks/exhaustive-deps
  const dragFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

  // ── Reminders ─────────────────────────────────────────────────────────────
  // Filing, like pinning and tags: saved at once, and the note's own text is left alone.
  const mergeReminder = useCallback((r) => {
    const fields = { remind_at: r.remind_at, remind_email: r.remind_email, remind_repeat: r.remind_repeat || 'none', reminder_done_at: r.reminder_done_at };
    setSelected((prev) => (prev && prev.id === r.id ? { ...prev, ...fields } : prev));
    patchNote({ id: r.id, ...fields });
  }, [patchNote]);

  // Returns '' when it worked, or the message to show in the dialog.
  async function saveReminder(iso, email, repeat) {
    const note = selectedRef.current;
    if (!note) return 'Open a note first.';
    try {
      const res = await api.put(`/api/notes/${note.id}/reminder`, { remindAt: iso, email, repeat: repeat || 'none', tz: localZone() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data.error || 'The reminder could not be saved.';
      mergeReminder(data);
      addToast(iso ? `Reminder set for ${reminderText(data)} ✓` : 'Reminder removed.', 'success');
      return '';
    } catch { return 'The reminder could not be saved. Try again.'; }
  }

  async function finishReminder() {
    const note = selectedRef.current;
    if (!note) return;
    try {
      const res = await api.post(`/api/notes/${note.id}/reminder/done`);
      if (!res.ok) throw new Error('done failed');
      const data = await res.json();
      mergeReminder(data);
      addToast(data.advanced ? `Done for this time. Next: ${reminderText(data)} ✓` : 'Reminder marked done ✓', 'success');
    } catch { addToast('The reminder could not be marked done. Try again.', 'error'); }
  }

  // ── Tour ──────────────────────────────────────────────────────────────────
  // The tour only looks: it brings the list or an open note into view (opening the first note if none is open) and creates nothing.
  const notesRef = useRef([]);
  const mobileRef = useRef(false);
  notesRef.current = list.notes;
  mobileRef.current = viewportMobile;
  const tourControls = {
    list: () => { if (mobileRef.current && selectedRef.current) closeNote(); },
    editor: async () => {
      if (selectedRef.current) return;
      const first = notesRef.current[0];
      if (first) await selectNote(first);
    },
  };
  const startTour = () => {
    try { localStorage.removeItem(NOTES_TOUR_KEY); } catch (_) { /* ignore */ }
    startNotesTour(tourControls);
  };
  // Settings -> Tours -> Notes Tour opens /notes?tour=1
  useEffect(() => {
    if (!searchParams.get('tour')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('tour');
    setSearchParams(next, { replace: true });
    setTimeout(() => startNotesTour(tourControls), 500);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pin ───────────────────────────────────────────────────────────────────
  async function togglePin(note) {
    try {
      const res = await api.patch(`/api/notes/${note.id}/pin`, { pinned: !note.pinned_at });
      if (!res.ok) throw new Error('pin failed');
      const { pinned_at } = await res.json();
      patchNote({ id: note.id, pinned_at });
      setSelected((prev) => (prev && prev.id === note.id ? { ...prev, pinned_at } : prev));
    } catch {
      addToast('The note could not be pinned. Try again.', 'error');
    }
  }

  // ── AI actions ────────────────────────────────────────────────────────────
  // The panel only proposes. These run when the person chooses to use what it proposed, and keep the old text for one Undo.
  const ensureSaved = useCallback(async () => {
    await runSave();
    if (pending.current) throw new Error('unsaved'); // a failed save would make the AI read old text
  }, [runSave]);

  function applyAiText(mode, text) {
    const id = selectedRef.current.id;
    setAiBackup({ id, title: titleValueRef.current, body: bodyValueRef.current });
    const next = applyText(bodyValueRef.current, mode, text);
    bodyValueRef.current = next;
    setBody(next);
    scheduleSave(id, titleValueRef.current, next);
  }

  function applyAiTags(picked) {
    changeTags(picked.reduce((list_, t) => addTag(list_, t), selectedRef.current?.tags || []));
  }

  function applyAiTitle(next) {
    const id = selectedRef.current.id;
    setAiBackup({ id, title: titleValueRef.current, body: bodyValueRef.current });
    titleValueRef.current = next;
    setTitle(next);
    scheduleSave(id, next, bodyValueRef.current);
  }

  function undoAi() {
    if (!aiBackup || aiBackup.id !== selectedRef.current?.id) return;
    setTitle(aiBackup.title);
    setBody(aiBackup.body);
    titleValueRef.current = aiBackup.title;
    bodyValueRef.current = aiBackup.body;
    scheduleSave(aiBackup.id, aiBackup.title, aiBackup.body);
    setAiBackup(null);
  }

  function tasksMade(n) {
    addToast(`${n} task${n === 1 ? '' : 's'} created from this note ✓`, 'success');
    const id = selectedRef.current?.id;
    if (id) setConvertedNoteIds((prev) => new Set([...prev, id]));
  }

  // ── Project / client of the open note ─────────────────────────────────────
  const ensureClients = useCallback(async () => {
    if (clients.length) return clients;
    try {
      const res = await api.get('/api/notes/options');
      if (res.ok) {
        const found = (await res.json()).clients || [];
        setClients(found);
        return found;
      }
    } catch { /* the pickers just stay short */ }
    return [];
  }, [clients]);

  async function changeFiling(changes, names) {
    if (!selected) return;
    try {
      const res = await api.put(`/api/notes/${selected.id}`, changes);
      if (!res.ok) throw new Error('save failed');
      const saved = await res.json();
      setSelected((prev) => ({ ...prev, project_id: saved.project_id, client_id: saved.client_id, ...names }));
      patchNote(toRow(saved, names));
    } catch {
      addToast('That change could not be saved. Try again.', 'error');
    }
  }

  const handleProjectChange = (e) => {
    const id = e.target.value ? Number(e.target.value) : null;
    changeFiling({ project_id: id }, { project_name: projects.find((p) => p.id === id)?.name || null });
  };
  const handleClientChange = (e) => {
    const id = e.target.value ? Number(e.target.value) : null;
    changeFiling({ client_id: id }, { client_name: clients.find((c) => c.id === id)?.name || null });
  };

  // ── Typing ────────────────────────────────────────────────────────────────
  function handleTitleChange(e) {
    setAiBackup(null);
    setTitle(e.target.value);
    scheduleSave(selected.id, e.target.value, body);
  }

  function handleBodyChange(e) {
    const val = e.target.value;
    setAiBackup(null);
    setBody(val);
    scheduleSave(selected.id, title, val);

    // "@" opens the pull-in menu, but only at the start of a word, so typing an email address does not
    const cursorPos = e.target.selectionStart;
    const textBefore = val.slice(0, cursorPos);
    const atIndex = textBefore.lastIndexOf('@');
    const startsWord = atIndex === 0 || /\s/.test(textBefore[atIndex - 1]);
    if (atIndex !== -1 && startsWord && !/\s/.test(textBefore.slice(atIndex + 1))) {
      mentionAtIndexRef.current = atIndex;
      setShowMention(true);
      clearTimeout(mentionTimerRef.current);
      mentionTimerRef.current = setTimeout(() => setMentionQuery(textBefore.slice(atIndex + 1)), 150);
    } else {
      setShowMention(false);
      clearTimeout(mentionTimerRef.current);
    }
  }

  const cursor = () => bodyRef.current?.selectionStart ?? body.length;

  function insertAtMention(text) {
    const atIndex = mentionAtIndexRef.current;
    const next = body.slice(0, atIndex) + text + body.slice(cursor());
    setBody(next);
    setShowMention(false);
    scheduleSave(selected.id, title, next);
    setTimeout(() => bodyRef.current?.focus(), 0);
  }

  // Append text to the end of the open note (the web / Gmail / Calendar pull-ins). Reads the latest text, so several can be added in a row.
  function appendToBody(text) {
    const current = bodyValueRef.current;
    const next = current + (current && !current.endsWith('\n') ? '\n' : '') + text;
    bodyValueRef.current = next;
    setBody(next);
    scheduleSave(selectedRef.current.id, titleValueRef.current, next);
  }

  // Choosing Search web / Gmail / Calendar from the @ menu: remove the "@query" that was typed, then open that search.
  function openInsert(kind) {
    const atIndex = mentionAtIndexRef.current;
    if (atIndex !== -1) {
      const next = body.slice(0, atIndex) + body.slice(cursor());
      setBody(next);
      scheduleSave(selected.id, title, next);
    }
    setShowMention(false);
    setInsertKind(kind);
  }

  function openGuideTool(id) {
    const tool = NOTES_TOOLS.find((t) => t.id === id);
    if (!tool) return;
    if (tool.open === 'chooser') { setShowNewChooser(true); return; }
    if (tool.open === 'recorder') { setShowRecorder(true); return; }
    if (tool.open === 'ask') { setShowAsk(true); return; }
    if (tool.open === 'search' || tool.open === 'list') {
      if (viewportMobile) closeNote();
      setTimeout(() => searchRef.current?.focus(), 60);
      return;
    }
    setTimeout(() => bodyRef.current?.focus(), 60);
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  const showList = !viewportMobile || !selected;
  const showEditor = !viewportMobile || !!selected;
  const clientOptions = clients.length ? clients : (selected?.client_id ? [{ id: selected.client_id, name: selected.client_name || `Client ${selected.client_id}` }] : []);
  const border = { borderColor: 'var(--color-border)' };
  const selectStyle = { background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', minHeight: viewportMobile ? 40 : 28, fontSize: viewportMobile ? 14 : 12 };
  const toolBtn = { background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)', minHeight: viewportMobile ? 40 : undefined };

  // Moods are only drawn on hover (desktop), so a phone does not ask for them at all.
  const [moodMap, setMoodMap] = useState({});
  const idsKey = viewportMobile ? '' : list.notes.map((n) => n.id).join(',');
  useEffect(() => {
    const missing = idsKey ? idsKey.split(',').filter((id) => !(`note:${id}` in moodMap)) : [];
    if (!missing.length) return;
    api.post('/api/mood/dominant/batch', { entities: missing.map((id) => ({ entityType: 'note', entityId: String(id) })) })
      .then((r) => r.json())
      .then((batch) => setMoodMap((prev) => { const next = { ...prev }; for (const id of missing) next[`note:${id}`] = batch[`note:${id}`] || null; return next; }))
      .catch(() => setMoodMap((prev) => { const next = { ...prev }; for (const id of missing) next[`note:${id}`] = null; return next; }));
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusText = { saved: 'Saved', dirty: 'Unsaved…', saving: 'Saving…', error: '' }[saveState];

  return (
    <div className="flex overflow-hidden" style={{ height: '100%' }}>
      {showList && (
        <div className="flex-shrink-0 border-r flex flex-col min-h-0" style={{ ...border, width: viewportMobile ? '100%' : 288 }}>
          <NotesListPanel
            list={list}
            projects={projects}
            clients={clients}
            onNeedClients={ensureClients}
            selectedId={selected?.id}
            mobile={viewportMobile}
            moodMap={viewportMobile ? null : moodMap}
            convertedIds={convertedNoteIds}
            onSelect={(row) => selectNote(row)}
            onNew={() => setShowNewChooser(true)}
            onToday={openDaily}
            onBin={() => setShowBin(true)}
            onConvert={convertToTask}
            onDelete={deleteNote}
            onPin={togglePin}
            onInfo={info.open}
            onTour={startTour}
            onAsk={() => setShowAsk(true)}
            allTags={allTags}
            onManageTags={() => setShowTagManager(true)}
            viewsApi={viewsApi}
            searchRef={searchRef}
            bottomPad={viewportMobile ? 84 : 0 /* the guide button sits bottom-right on a phone */}
          />
        </div>
      )}

      {showEditor && (selected ? (
        <div
          className="flex-1 min-w-0 flex flex-col overflow-hidden relative"
          onDragEnter={(e) => { if (dragFiles(e)) { e.preventDefault(); setDragging(true); } }}
          onDragOver={(e) => { if (dragFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
          onDrop={(e) => { if (dragFiles(e)) { e.preventDefault(); setDragging(false); files.upload(e.dataTransfer.files); } }}
        >
          {dragging && (
            <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none" style={{ background: 'rgba(0,0,0,0.25)' }} aria-hidden="true">
              <p className="px-4 py-3 rounded-xl text-sm font-medium" style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '2px dashed var(--color-primary)' }}>Drop files to attach them to this note</p>
            </div>
          )}
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-x-2 gap-y-1 flex-wrap px-3 sm:px-4 py-2 border-b flex-shrink-0" style={border} data-tour="notes-toolbar">
            <div className="flex items-center gap-2 min-w-0">
              {viewportMobile && (
                <Tooltip text={NOTE_TIPS.back} side="bottom">
                  <button type="button" onClick={closeNote} aria-label="Back to all notes" className="flex items-center gap-1 text-sm px-2 rounded-lg hover:opacity-70 transition-opacity duration-200 flex-shrink-0" style={{ color: 'var(--color-primary)', minHeight: 44 }}>
                    {getIcon('arrow-left', { size: 18 })} Notes
                  </button>
                </Tooltip>
              )}
              {selected.source === 'voice' && (
                <Tooltip text={NOTE_TIPS.rowVoice} side="bottom">
                  <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-md flex-shrink-0" style={{ color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}>
                    {getIcon('audio-lines', { size: 12 })}{!viewportMobile && ' Voice note'}
                  </span>
                </Tooltip>
              )}
              {saveState === 'error' ? (
                <span className="text-xs flex items-center gap-1.5 min-w-0" style={{ color: '#ef4444' }} role="alert">
                  Not saved
                  <Tooltip text={NOTE_TIPS.retrySave} side="bottom"><button type="button" onClick={runSave} className="underline hover:opacity-70 transition-opacity duration-200">Try again</button></Tooltip>
                </span>
              ) : (
                <Tooltip text={NOTE_TIPS.saveState} side="bottom"><span className="text-xs" style={{ color: 'var(--color-muted)' }} aria-live="polite">{statusText}</span></Tooltip>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-end">
              {aiBackup && aiBackup.id === selected.id && (
                <Tooltip text={NOTE_TIPS.undoAi} side="bottom">
                  <button type="button" onClick={undoAi} className="flex items-center gap-1 text-xs px-2.5 rounded-md hover:opacity-70 transition-opacity duration-200" style={{ ...toolBtn, minHeight: viewportMobile ? 40 : 28 }}>
                    {getIcon('rotate-ccw', { size: 12 })} Undo AI change
                  </button>
                </Tooltip>
              )}
              <Tooltip text={NOTE_TIPS.pin} side="bottom">
                <button
                  type="button" onClick={() => togglePin(selected)}
                  className="flex items-center justify-center rounded-md hover:opacity-60 transition-opacity duration-200"
                  style={{ color: selected.pinned_at ? 'var(--color-primary)' : 'var(--color-muted)', width: viewportMobile ? 40 : 28, height: viewportMobile ? 40 : 28 }}
                  aria-label={selected.pinned_at ? 'Unpin note' : 'Pin note'} aria-pressed={!!selected.pinned_at}
                >{getIcon('pin', { size: 16 })}</button>
              </Tooltip>
              <div className="relative" data-tour="notes-ai">
                <Tooltip text={NOTE_TIPS.ai} side="bottom">
                  <button
                    type="button" onClick={() => setAiMenuOpen((v) => !v)} aria-expanded={aiMenuOpen} aria-haspopup="menu"
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-opacity duration-200 hover:opacity-80 whitespace-nowrap" style={toolBtn}
                    aria-label="AI actions"
                  >{getIcon('wand', { size: viewportMobile ? 18 : 12 })}{!viewportMobile && 'AI'}{getIcon('chevron-down', { size: 11 })}</button>
                </Tooltip>
                {aiMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-30" style={viewportMobile ? { background: 'rgba(0,0,0,0.4)' } : undefined} onClick={() => setAiMenuOpen(false)} />
                    <div
                      className={viewportMobile ? 'fixed left-0 right-0 bottom-0 z-40 rounded-t-2xl border shadow-xl overflow-hidden' : 'absolute right-0 top-full mt-1 z-40 rounded-xl border shadow-xl overflow-hidden'}
                      role="menu"
                      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', ...(viewportMobile ? { paddingBottom: 'max(12px, env(safe-area-inset-bottom))' } : { minWidth: 230 }) }}
                    >
                      {AI_ACTIONS.map((a) => (
                        <button
                          key={a.id} type="button" role="menuitem"
                          onClick={() => { setAiMenuOpen(false); setAiAction(a.id); }}
                          className="w-full text-left px-4 py-3 flex items-start gap-3 hover:opacity-70 transition-opacity duration-200"
                        >
                          <span className="mt-0.5" style={{ color: 'var(--color-primary)' }}>{getIcon(a.icon, { size: 15 })}</span>
                          <span className="min-w-0">
                            <span className="block text-sm" style={{ color: 'var(--color-text)' }}>{a.label}</span>
                            <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>{a.hint}</span>
                          </span>
                        </button>
                      ))}
                      <p className="px-3 py-2 text-xs border-t" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>Sends this note's text to the AI. Nothing changes until you choose.</p>
                    </div>
                  </>
                )}
              </div>
              {dictation.supported && !viewportMobile && (
                <Tooltip text={dictation.listening ? 'Stop dictating. What you said is added to the note.' : NOTE_TIPS.dictate} side="bottom">
                  <button
                    type="button"
                    onClick={() => (dictation.listening ? dictation.stop() : dictation.start(selected.id))}
                    className="w-7 h-7 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity duration-200 flex-shrink-0"
                    aria-label={dictation.listening ? 'Stop dictation' : 'Dictate into this note'}
                    style={{ color: dictation.listening ? '#ef4444' : 'var(--color-muted)', background: dictation.listening ? '#fee2e2' : undefined, animation: dictation.listening ? 'pulse 1.2s ease-in-out infinite' : undefined }}
                  >{getIcon('mic', { size: 16 })}</button>
                </Tooltip>
              )}
              <Tooltip text={NOTE_TIPS.convertTask} side="bottom">
                <button type="button" onClick={() => convertToTask({ ...selected, title, body })} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-opacity duration-200 hover:opacity-80 whitespace-nowrap" style={toolBtn} aria-label="Convert to task">
                  {getIcon('list-checks', { size: viewportMobile ? 18 : 12 })}{!viewportMobile && 'Convert to Task'}
                </button>
              </Tooltip>

              <div className="relative">
                <Tooltip text={NOTE_TIPS.takeToChat} side="bottom">
                  <button type="button" onClick={() => { setShowChatPicker((v) => !v); setNewProjectName(''); setCreatingProject(false); }} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-opacity duration-200 hover:opacity-80 whitespace-nowrap" style={{ background: 'var(--color-primary)', color: '#fff', minHeight: viewportMobile ? 40 : undefined }} aria-label="Take to chat">
                    {getIcon('chat', { size: viewportMobile ? 18 : 12 })}{!viewportMobile && 'Take to Chat'}{getIcon('chevron-down', { size: 11 })}
                  </button>
                </Tooltip>
                {showChatPicker && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowChatPicker(false)} />
                    <div className="absolute right-0 top-full mt-1 z-40 rounded-xl border shadow-xl overflow-hidden" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minWidth: 220 }}>
                      {selected.project_id && (() => {
                        const proj = projects.find((p) => p.id === selected.project_id);
                        return proj ? (
                          <button onClick={() => takeToChatWith(proj.id)} className="w-full text-left px-3 py-2.5 text-xs flex items-center gap-2 hover:opacity-70 transition-opacity duration-200 border-b" style={{ ...border, color: 'var(--color-primary)', fontWeight: 500 }}>
                            {getIcon('folder', { size: 12 })}{proj.name}
                          </button>
                        ) : null;
                      })()}
                      <div className="max-h-40 overflow-y-auto">
                        {projects.filter((p) => p.id !== selected.project_id).map((p) => (
                          <button key={p.id} onClick={() => takeToChatWith(p.id)} className="w-full text-left px-3 py-2.5 text-xs flex items-center gap-2 hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-text)' }}>
                            {getIcon('folder', { size: 12 })}{p.name}
                          </button>
                        ))}
                      </div>
                      <div className="border-t" style={border}>
                        {!creatingProject ? (
                          <button onClick={() => setCreatingProject(true)} className="w-full text-left px-3 py-2.5 text-xs flex items-center gap-2 hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-primary)' }}>
                            {getIcon('plus', { size: 12 })}New project…
                          </button>
                        ) : (
                          <div className="px-3 py-2 flex items-center gap-1.5">
                            <input
                              autoFocus value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateProjectAndChat(); if (e.key === 'Escape') setCreatingProject(false); }}
                              placeholder="Project name…" className="flex-1 min-w-0 px-2 py-1 rounded border outline-none"
                              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-primary)', color: 'var(--color-text)', fontSize: 16 }}
                            />
                            <button onClick={handleCreateProjectAndChat} disabled={!newProjectName.trim()} className="text-xs px-2 py-1.5 rounded hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff' }}>Go</button>
                          </div>
                        )}
                      </div>
                      <div className="border-t" style={border}>
                        <button onClick={() => takeToChatWith(null)} className="w-full text-left px-3 py-2.5 text-xs flex items-center gap-2 hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>
                          {getIcon('message-circle', { size: 12 })}General Chat
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {confirmDelete ? (
                <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text)' }}>
                  Delete?
                  <button type="button" onClick={() => deleteNote(selected)} className="px-2.5 rounded-md hover:opacity-80 transition-opacity duration-200 font-medium" style={{ background: '#ef4444', color: '#fff', minHeight: viewportMobile ? 40 : 28 }}>Yes</button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="px-2.5 rounded-md hover:opacity-70 transition-opacity duration-200" style={{ ...toolBtn, minHeight: viewportMobile ? 40 : 28 }}>No</button>
                </span>
              ) : (
                <Tooltip text={NOTE_TIPS.deleteNote} side="bottom">
                  <button type="button" onClick={() => setConfirmDelete(true)} className="flex items-center justify-center rounded-md hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)', width: viewportMobile ? 40 : 28, height: viewportMobile ? 40 : 28 }} aria-label="Delete note">
                    {getIcon('trash', { size: 16 })}
                  </button>
                </Tooltip>
              )}
            </div>
          </div>

          {/* Title */}
          <Tooltip text={NOTE_TIPS.title}>
            <input
              ref={titleRef}
              value={title}
              onChange={handleTitleChange}
              onFocus={(e) => { if (title === 'Untitled') e.target.select(); }}
              placeholder="Title"
              aria-label="Note title"
              readOnly={bodyLoading}
              className={`px-4 ${viewportMobile ? 'pt-3 pb-2' : 'pt-4 pb-1'} text-xl font-semibold bg-transparent outline-none flex-shrink-0`}
              style={{ color: 'var(--color-text)' }}
            />
          </Tooltip>

          {/* Filing: project and client */}
          <div className="px-4 pb-2 border-b flex-shrink-0 space-y-2" style={border} data-tour="notes-filing">
            <div className="flex items-center gap-2 flex-wrap">
            <Tooltip text={NOTE_TIPS.projectPick}>
              <select value={selected.project_id || ''} onChange={handleProjectChange} aria-label="Project" className="rounded px-2 outline-none min-w-0 flex-1 sm:flex-none sm:max-w-[180px]" style={selectStyle}>
                <option value="">No project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Tooltip>
            <Tooltip text={NOTE_TIPS.clientPick}>
              <select value={selected.client_id || ''} onChange={handleClientChange} onFocus={ensureClients} onMouseDown={ensureClients} aria-label="Client" className="rounded px-2 outline-none min-w-0 flex-1 sm:flex-none sm:max-w-[180px]" style={selectStyle}>
                <option value="">No client</option>
                {clientOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Tooltip>
            {(() => {
              const rs = reminderState(selected);
              const live = rs === 'due' || rs === 'upcoming';
              const text = live ? reminderText(selected) : '';
              const repeats = live && repeatOf(selected) !== 'none';
              return (
                <Tooltip text={live ? NOTE_TIPS.reminderChip(text, rs === 'due') : NOTE_TIPS.reminderButton}>
                  <button
                    type="button" onClick={() => setShowReminder(true)} data-tour="notes-reminder" aria-label={live ? `Reminder: ${text}` : 'Set a reminder'}
                    className="flex items-center gap-1.5 text-xs px-2.5 rounded transition-opacity duration-200 hover:opacity-70 flex-shrink-0"
                    style={{ ...selectStyle, color: rs === 'due' ? '#f59e0b' : live ? 'var(--color-primary)' : 'var(--color-muted)', borderColor: rs === 'due' ? '#f59e0b' : 'var(--color-border)' }}
                  >{getIcon(repeats ? 'rotate-ccw' : 'clock', { size: 13 })}{live ? text : 'Remind me'}</button>
                </Tooltip>
              );
            })()}
            </div>
            <NoteTagsEditor tags={selected.tags || []} allTags={allTags} mobile={viewportMobile} onChange={changeTags} />
            <NoteFilesStrip attachments={selected.attachments} uploading={files.uploading} error={files.error} mobile={viewportMobile} onPick={files.upload} onRemove={files.remove} onClearError={files.clearError} />
          </div>

          {/* Write / Preview */}
          {reminderState(selected) === 'due' && (
            <div className="flex items-center justify-between gap-2 flex-wrap px-4 py-2 text-xs flex-shrink-0" style={{ background: '#f59e0b22', borderBottom: '1px solid #f59e0b', color: 'var(--color-text)' }} role="status">
              <span className="flex items-center gap-1.5">{getIcon('clock', { size: 13 })} Reminder due: {reminderText(selected)}</span>
              <span className="flex items-center gap-2">
                <Tooltip text={NOTE_TIPS.reminderDone}>
                  <button type="button" onClick={finishReminder} className="px-3 rounded-lg font-medium hover:opacity-80 transition-opacity duration-200" style={{ background: 'var(--color-primary)', color: '#fff', minHeight: viewportMobile ? 40 : 28 }}>Done</button>
                </Tooltip>
                <Tooltip text={NOTE_TIPS.reminderSnooze}>
                  <button type="button" onClick={() => setShowReminder(true)} className="px-3 rounded-lg hover:opacity-70 transition-opacity duration-200" style={{ ...toolBtn, minHeight: viewportMobile ? 40 : 28 }}>Snooze…</button>
                </Tooltip>
              </span>
            </div>
          )}

          {/* Write / Preview */}
          <div className="flex items-center justify-between gap-2 px-4 py-1.5 flex-shrink-0">
            <div className="flex rounded-lg overflow-hidden" role="group" aria-label="How to show this note" style={{ border: '1px solid var(--color-border)' }} data-tour="notes-mode">
              {[['write', 'Write', 'pen-line'], ['preview', 'Preview', 'eye']].map(([id, label, icon]) => (
                <Tooltip key={id} text={NOTE_TIPS[id]}>
                  <button
                    type="button" onClick={() => setMode(id)} aria-pressed={mode === id}
                    className="flex items-center gap-1.5 text-xs px-3 transition-opacity duration-200 hover:opacity-80"
                    style={{ minHeight: viewportMobile ? 36 : 26, background: mode === id ? 'var(--color-primary)' : 'var(--color-bg)', color: mode === id ? '#fff' : 'var(--color-text)' }}
                  >{getIcon(icon, { size: 12 })}{label}</button>
                </Tooltip>
              ))}
            </div>
            {(() => {
              const c = taskCounts(body);
              if (c.total) return <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{c.done} of {c.total} done</span>;
              return !viewportMobile && mode === 'write'
                ? <span className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>Formatting works: # heading, **bold**, - list, - [ ] to-do</span>
                : null;
            })()}
          </div>

          {/* Body */}
          <div className="flex-1 relative overflow-hidden flex flex-col min-h-0">
            <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
            {dictation.listening && (
              <div className="flex-shrink-0 flex flex-col gap-1 px-4 py-2 text-xs font-medium border-b" style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#b91c1c' }}>
                <div className="flex items-center gap-2">
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block', flexShrink: 0, animation: 'pulse 1.2s ease-in-out infinite' }} />
                  Listening… tap mic to stop
                </div>
                {dictation.interim && <div style={{ color: '#dc2626', opacity: 0.8, fontStyle: 'italic', paddingLeft: 16 }}>{dictation.interim}</div>}
              </div>
            )}
            {dictation.error && (
              <div className="flex-shrink-0 px-4 py-2 text-xs border-b" style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#b91c1c' }}>{dictation.error}</div>
            )}
            {loadError && (
              <div className="flex-shrink-0 px-4 py-2 text-xs border-b flex items-center gap-2" style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#b91c1c' }}>
                {loadError}
                <button type="button" onClick={() => selectNote(selected)} className="underline hover:opacity-70 transition-opacity duration-200">Try again</button>
              </div>
            )}
            {mode === 'preview' ? (
              <div
                className="flex-1 overflow-y-auto px-4 py-2 text-sm leading-relaxed"
                style={viewportMobile ? { margin: '10px 12px', padding: '12px 14px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, fontSize: 16 } : undefined}
                onDoubleClick={() => { if (!viewportMobile && !window.getSelection()?.toString()) setMode('write'); }}
                aria-label="Note preview"
              >
                {bodyLoading
                  ? <p style={{ color: 'var(--color-muted)' }}>Opening…</p>
                  : body.trim()
                    ? <NoteMarkdownView body={body} onToggleTask={toggleTask} />
                    : <p style={{ color: 'var(--color-muted)' }}>Nothing to preview yet. Switch to Write and start typing.</p>}
              </div>
            ) : (
            <textarea
              ref={bodyRef}
              value={body}
              onChange={handleBodyChange}
              readOnly={bodyLoading || !!loadError}
              onKeyDown={(e) => { if (e.key === 'Escape' && showMention) { setShowMention(false); e.preventDefault(); } }}
              onPaste={(e) => { const pasted = Array.from(e.clipboardData?.files || []); if (pasted.length && !bodyLoading) { e.preventDefault(); files.upload(pasted); } }}
              placeholder={bodyLoading ? 'Opening…' : viewportMobile ? 'Tap here to type, or press Dictate below and speak…' : 'Start writing… type @ to search emails, calendar, tasks & web'}
              aria-label="Note text"
              className="flex-1 px-4 py-2 bg-transparent outline-none resize-none text-sm leading-relaxed"
              style={{
                color: 'var(--color-text)',
                // 16px stops iPhones zooming the page when the keyboard opens
                ...(viewportMobile ? { margin: '10px 12px', padding: '12px 14px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, fontSize: 16 } : {}),
              }}
            />
            )}

            {showMention && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMention(false)} />
                <div className="absolute bottom-2 left-4 z-50">
                  <AtMentionDropdown
                    query={mentionQuery}
                    onSelect={(token, extra = '') => insertAtMention(token + extra)}
                    onSearch={() => openInsert('web')}
                    onGmailSearch={() => openInsert('gmail')}
                    onCalendarSearch={() => openInsert('calendar')}
                    onPromptSelect={(prompt) => insertAtMention(prompt.content || prompt.title)}
                    onClose={() => setShowMention(false)}
                  />
                </div>
              </>
            )}
          </div>

          {viewportMobile && (
            <div className="flex-shrink-0 flex gap-3 px-3 pt-3 border-t" style={{ ...border, background: 'var(--color-surface)', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', paddingRight: 84 /* the guide button sits bottom-right */ }}>
              <Tooltip text={NOTE_TIPS.typeButton}>
                <button type="button" onClick={() => (mode === 'preview' ? setMode('write') : bodyRef.current?.focus())} className="flex-1 flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-opacity duration-200 hover:opacity-80" style={{ minHeight: 48, background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} aria-label="Type into this note">
                  {getIcon('pen-line', { size: 16 })} Type
                </button>
              </Tooltip>
              {dictation.supported && (
                <Tooltip text={dictation.listening ? 'Stop dictating. What you said is added to the note.' : NOTE_TIPS.dictate}>
                  <button type="button" onClick={() => (dictation.listening ? dictation.stop() : dictation.start(selected.id))} className="flex-1 flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-opacity duration-200 hover:opacity-80" style={{ minHeight: 48, background: dictation.listening ? '#fee2e2' : 'var(--color-primary)', color: dictation.listening ? '#b91c1c' : '#fff' }} aria-label={dictation.listening ? 'Stop dictation' : 'Dictate into this note'}>
                    {getIcon('mic', { size: 16 })} {dictation.listening ? 'Stop' : 'Dictate'}
                  </button>
                </Tooltip>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--color-muted)' }}>
          <div className="text-center">
            <div className="mb-3 flex justify-center">{getIcon('pen-line', { size: 32, style: { opacity: 0.3 } })}</div>
            <p className="text-sm">Select a note or create a new one</p>
            <div className="flex gap-2 justify-center mt-3">
              <button onClick={() => createNote({ focusTitle: true })} className="text-sm px-4 py-2 rounded-md hover:opacity-80 transition-opacity duration-200" style={{ background: 'var(--color-primary)', color: '#fff' }}>New Note</button>
              <button onClick={() => setShowRecorder(true)} className="text-sm px-4 py-2 rounded-md hover:opacity-80 transition-opacity duration-200 flex items-center gap-1.5" style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                {getIcon('mic', { size: 14 })} New Voice Note
              </button>
            </div>
          </div>
        </div>
      ))}

      {showTagManager && <TagManager tags={allTags} mobile={viewportMobile} onChanged={tagsChanged} onClose={() => setShowTagManager(false)} />}
      {aiAction && selected && (
        <NoteAiPanel
          key={`${selected.id}:${aiAction}`}
          action={aiAction}
          note={{ id: selected.id, title: titleValueRef.current, project_id: selected.project_id, client_id: selected.client_id, tags: selected.tags || [] }}
          mobile={viewportMobile}
          ensureSaved={ensureSaved}
          onApplyText={applyAiText}
          onApplyTitle={applyAiTitle}
          onApplyTags={applyAiTags}
          onTasksMade={tasksMade}
          onClose={() => setAiAction(null)}
        />
      )}
      {insertKind && <InsertSourceModal kind={insertKind} onInsert={appendToBody} onClose={() => { setInsertKind(null); setTimeout(() => bodyRef.current?.focus(), 0); }} />}
      {showRecorder && <VoiceNoteRecorder onClose={() => setShowRecorder(false)} onCreated={handleVoiceNote} />}
      {viewportMobile && (
        <input ref={keyboardRef} aria-hidden="true" tabIndex={-1} style={{ position: 'fixed', top: 0, left: 0, width: 1, height: 1, opacity: 0, border: 0, padding: 0, fontSize: 16, pointerEvents: 'none' }} />
      )}
      {showNewChooser && (
        <NewNoteChooser mobile={viewportMobile} onClose={() => setShowNewChooser(false)} onWrite={startWrittenNote} onVoice={() => { setShowNewChooser(false); setShowRecorder(true); }} onTemplate={openTemplates} />
      )}
      {showTemplates && (
        <TemplatePicker
          templates={templates} mobile={viewportMobile} canSave={!!selected}
          onUse={createFromTemplate} onSave={saveAsTemplate} onDelete={deleteTemplate} onClose={() => setShowTemplates(false)}
        />
      )}
      {info.show && (
        <ToolInfoModal title="How Notes Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>{NOTES_INTRO}</p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, text]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
            ))}
          </div>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>{NOTES_NOT}</p>
        </ToolInfoModal>
      )}
      {showAsk && (
        <AskNotesPanel
          scopeQuery={list.scopeQuery} openNoteId={selected?.id ?? null} listCount={list.hasMore ? null : list.notes.length} mobile={viewportMobile}
          onOpenNote={(id) => { setShowAsk(false); selectNote({ id, title: '', project_id: null, client_id: null }); }}
          onClose={() => setShowAsk(false)}
        />
      )}
      {showReminder && selected && <NoteReminderPanel note={selected} mobile={viewportMobile} onSet={saveReminder} onClear={() => saveReminder(null, false)} onDone={finishReminder} onClose={() => setShowReminder(false)} />}
      {showBin && <RecentlyDeletedModal mobile={viewportMobile} onRestored={() => { list.reload(); refreshTags(); }} onClose={() => setShowBin(false)} />}
      <NotesTutorChat currentTool="" onOpenTool={openGuideTool} />
    </div>
  );
}
