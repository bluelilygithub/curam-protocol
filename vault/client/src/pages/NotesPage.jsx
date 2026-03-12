import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useProjectStore from '../store/projectStore';

const AUTOSAVE_DELAY = 1000; // ms after last keystroke

export default function NotesPage() {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const { projects, fetchProjects, create: createProject } = useProjectStore();

  const [notes, setNotes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showChatPicker, setShowChatPicker] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);

  const autosaveTimer = useRef(null);
  const bodyRef = useRef(null);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const loadNotes = useCallback(async (q = '') => {
    const url = q ? `/api/notes?q=${encodeURIComponent(q)}` : '/api/notes';
    const res = await api.get(url);
    setNotes(await res.json());
  }, []);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const scheduleAutosave = useCallback((noteId, newTitle, newBody) => {
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      if (!noteId) return;
      setSaving(true);
      try {
        await api.put(`/api/notes/${noteId}`, { title: newTitle, body: newBody });
        setDirty(false);
        loadNotes(search);
      } catch (_) {}
      setSaving(false);
    }, AUTOSAVE_DELAY);
  }, [search, loadNotes]);

  function selectNote(note) {
    clearTimeout(autosaveTimer.current);
    setSelected(note);
    setTitle(note.title);
    setBody(note.body);
    setDirty(false);
    setTimeout(() => bodyRef.current?.focus(), 0);
  }

  async function createNote() {
    const res = await api.post('/api/notes', { title: 'Untitled', body: '' });
    const note = await res.json();
    await loadNotes(search);
    selectNote(note);
  }

  async function deleteNote(noteId, e) {
    e.stopPropagation();
    await api.delete(`/api/notes/${noteId}`);
    if (selected?.id === noteId) {
      setSelected(null);
      setTitle('');
      setBody('');
    }
    loadNotes(search);
  }

  function handleTitleChange(e) {
    setTitle(e.target.value);
    setDirty(true);
    scheduleAutosave(selected.id, e.target.value, body);
  }

  function handleBodyChange(e) {
    setBody(e.target.value);
    setDirty(true);
    scheduleAutosave(selected.id, title, e.target.value);
  }

  function handleSearchChange(e) {
    setSearch(e.target.value);
    loadNotes(e.target.value);
  }

  function takeToChatWith(projectId) {
    if (!selected) return;
    const text = [title !== 'Untitled' ? title : '', body].filter(Boolean).join('\n\n');
    setShowChatPicker(false);
    setNewProjectName('');
    setCreatingProject(false);
    if (projectId) {
      navigate(`/projects/${projectId}/chat`, { state: { draft: text } });
    } else {
      navigate('/chat', { state: { draft: text } });
    }
  }

  async function handleCreateProjectAndChat() {
    if (!newProjectName.trim()) return;
    setCreatingProject(true);
    try {
      const project = await createProject({ name: newProjectName.trim() });
      takeToChatWith(project.id);
    } catch (_) {
      setCreatingProject(false);
    }
  }

  async function handleProjectChange(e) {
    const pid = e.target.value ? Number(e.target.value) : null;
    await api.put(`/api/notes/${selected.id}`, { project_id: pid });
    setSelected(prev => ({ ...prev, project_id: pid }));
    loadNotes(search);
  }

  return (
    <div className="flex overflow-hidden" style={{ height: '100%' }}>
      {/* ── List panel ── */}
      <div className="w-64 flex-shrink-0 border-r flex flex-col" style={{ borderColor: 'var(--color-border)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Notes</span>
          <button
            onClick={createNote}
            className="w-6 h-6 flex items-center justify-center rounded hover:opacity-60 transition-opacity"
            style={{ color: 'var(--color-primary)' }}
            title="New note"
          >
            {getIcon('plus', { size: 16 })}
          </button>
        </div>

        {/* Search */}
        <div className="px-2 py-1.5 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-1.5 rounded px-2 py-1" style={{ background: 'var(--color-surface-2)' }}>
            {getIcon('search', { size: 13, style: { color: 'var(--color-muted)' } })}
            <input
              value={search}
              onChange={handleSearchChange}
              placeholder="Search notes…"
              className="bg-transparent text-xs outline-none flex-1"
              style={{ color: 'var(--color-text)' }}
            />
          </div>
        </div>

        {/* Note list */}
        <div className="flex-1 overflow-y-auto">
          {notes.length === 0 && (
            <p className="text-xs px-3 py-4" style={{ color: 'var(--color-muted)' }}>
              {search ? 'No results' : 'No notes yet'}
            </p>
          )}
          {notes.map(note => (
            <div
              key={note.id}
              onClick={() => selectNote(note)}
              className="group flex items-start justify-between px-3 py-2 cursor-pointer border-b"
              style={{
                borderColor: 'var(--color-border)',
                background: selected?.id === note.id ? 'var(--color-surface-2)' : 'transparent',
              }}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{note.title}</div>
                <div className="text-xs truncate mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  {note.body ? note.body.slice(0, 60) : <span className="italic">empty</span>}
                </div>
              </div>
              <button
                onClick={(e) => deleteNote(note.id, e)}
                className="opacity-0 group-hover:opacity-100 ml-1 mt-0.5 flex-shrink-0 hover:opacity-60 transition-opacity"
                style={{ color: 'var(--color-muted)' }}
                title="Delete"
              >
                {getIcon('trash', { size: 13 })}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Editor panel ── */}
      {selected ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-3">
              <select
                value={selected.project_id || ''}
                onChange={handleProjectChange}
                className="text-xs rounded px-2 py-1 outline-none"
                style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
              >
                <option value="">No project</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>

              {saving && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Saving…</span>}
              {!saving && !dirty && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Saved</span>}
            </div>

            <div className="relative">
              <button
                onClick={() => { setShowChatPicker(v => !v); setNewProjectName(''); setCreatingProject(false); }}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-primary)', color: '#fff' }}
                title="Open this note as a chat"
              >
                {getIcon('chat', { size: 12 })}
                Take to Chat
                {getIcon('chevron-down', { size: 11 })}
              </button>

              {showChatPicker && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowChatPicker(false)} />
                  <div
                    className="absolute right-0 top-full mt-1 z-40 rounded-xl border shadow-xl overflow-hidden"
                    style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minWidth: '220px' }}
                  >
                    {/* Associated project shortcut */}
                    {selected.project_id && (() => {
                      const proj = projects.find(p => p.id === selected.project_id);
                      return proj ? (
                        <button
                          onClick={() => takeToChatWith(proj.id)}
                          className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:opacity-70 transition-opacity border-b"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', fontWeight: 500 }}
                        >
                          {getIcon('folder', { size: 12 })}
                          {proj.name}
                        </button>
                      ) : null;
                    })()}

                    {/* Existing projects */}
                    <div className="max-h-40 overflow-y-auto">
                      {projects
                        .filter(p => p.id !== selected.project_id)
                        .map(p => (
                          <button
                            key={p.id}
                            onClick={() => takeToChatWith(p.id)}
                            className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:opacity-70 transition-opacity"
                            style={{ color: 'var(--color-text)' }}
                          >
                            {getIcon('folder', { size: 12 })}
                            {p.name}
                          </button>
                        ))}
                    </div>

                    {/* Create new project */}
                    <div className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                      {!creatingProject ? (
                        <button
                          onClick={() => setCreatingProject(true)}
                          className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:opacity-70 transition-opacity"
                          style={{ color: 'var(--color-primary)' }}
                        >
                          {getIcon('plus', { size: 12 })}
                          New project…
                        </button>
                      ) : (
                        <div className="px-3 py-2 flex items-center gap-1.5">
                          <input
                            autoFocus
                            value={newProjectName}
                            onChange={e => setNewProjectName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleCreateProjectAndChat();
                              if (e.key === 'Escape') setCreatingProject(false);
                            }}
                            placeholder="Project name…"
                            className="flex-1 text-xs px-2 py-1 rounded border outline-none"
                            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-primary)', color: 'var(--color-text)' }}
                          />
                          <button
                            onClick={handleCreateProjectAndChat}
                            disabled={!newProjectName.trim()}
                            className="text-xs px-2 py-1 rounded hover:opacity-80 disabled:opacity-40"
                            style={{ background: 'var(--color-primary)', color: '#fff' }}
                          >
                            Go
                          </button>
                        </div>
                      )}
                    </div>

                    {/* General chat */}
                    <div className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                      <button
                        onClick={() => takeToChatWith(null)}
                        className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:opacity-70 transition-opacity"
                        style={{ color: 'var(--color-muted)' }}
                      >
                        {getIcon('message-circle', { size: 12 })}
                        General Chat
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Title */}
          <input
            value={title}
            onChange={handleTitleChange}
            placeholder="Title"
            className="px-4 pt-4 pb-1 text-xl font-semibold bg-transparent outline-none flex-shrink-0"
            style={{ color: 'var(--color-text)' }}
          />

          {/* Body */}
          <textarea
            ref={bodyRef}
            value={body}
            onChange={handleBodyChange}
            placeholder="Start writing…"
            className="flex-1 px-4 py-2 bg-transparent outline-none resize-none text-sm leading-relaxed"
            style={{ color: 'var(--color-text)' }}
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--color-muted)' }}>
          <div className="text-center">
            <div className="mb-3 flex justify-center">{getIcon('pen-line', { size: 32, style: { opacity: 0.3 } })}</div>
            <p className="text-sm">Select a note or create a new one</p>
            <button
              onClick={createNote}
              className="mt-3 text-sm px-4 py-2 rounded-md hover:opacity-80 transition-opacity"
              style={{ background: 'var(--color-primary)', color: '#fff' }}
            >
              New Note
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
