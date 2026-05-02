import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useProjectStore from '../store/projectStore';
import AtMentionDropdown from '../components/AtMentionDropdown';
import MoodDot from '../components/mood/MoodDot';

const NOTE_BODY_LIMIT = 500;

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
  const [convertedNoteIds, setConvertedNoteIds] = useState(new Set());
  const pendingConvertNoteIdRef = useRef(null);

  const autosaveTimer = useRef(null);
  const bodyRef = useRef(null);
  const mentionTimerRef = useRef(null);
  const mentionAtIndexRef = useRef(-1);
  const recognitionRef = useRef(null);
  const bodyValueRef = useRef(body);
  const titleValueRef = useRef(title);
  const selectedRef = useRef(selected);
  const finalTranscriptRef = useRef('');
  const isListeningRef = useRef(false); // ref version avoids stale closure in recognition callbacks

  const [viewportMobile, setViewportMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [micError, setMicError] = useState('');

  // @mention state
  const [showMention, setShowMention] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');

  // Web search state
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // Gmail state
  const [showGmailSearch, setShowGmailSearch] = useState(false);
  const [gmailQuery, setGmailQuery] = useState('');
  const [isGmailSearching, setIsGmailSearching] = useState(false);
  const [gmailError, setGmailError] = useState('');
  const [gmailResults, setGmailResults] = useState([]);
  const [gmailAttached, setGmailAttached] = useState([]);
  const [gmailTranslatedQuery, setGmailTranslatedQuery] = useState('');

  // Calendar state
  const [showCalendarSearch, setShowCalendarSearch] = useState(false);
  const [calendarQuery, setCalendarQuery] = useState('');
  const [isCalendarSearching, setIsCalendarSearching] = useState(false);
  const [calendarError, setCalendarError] = useState('');
  const [calendarResults, setCalendarResults] = useState([]);
  const [calendarAttached, setCalendarAttached] = useState([]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  useEffect(() => {
    const handler = () => {
      if (pendingConvertNoteIdRef.current) {
        setConvertedNoteIds(prev => new Set([...prev, pendingConvertNoteIdRef.current]));
        pendingConvertNoteIdRef.current = null;
      }
    };
    document.addEventListener('vault:task-created', handler);
    return () => document.removeEventListener('vault:task-created', handler);
  }, []);

  const loadNotes = useCallback(async (q = '') => {
    const url = q ? `/api/notes?q=${encodeURIComponent(q)}` : '/api/notes';
    const res = await api.get(url);
    setNotes(await res.json());
  }, []);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  // Keep value refs current for mic callbacks (avoids stale closures)
  useEffect(() => { bodyValueRef.current = body; }, [body]);
  useEffect(() => { titleValueRef.current = title; }, [title]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  useEffect(() => {
    const check = () => setViewportMobile(window.innerWidth < 640);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Auto-open notes drawer on mobile when page first loads
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 640) setMobileListOpen(true);
  }, []); // eslint-disable-line

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setMicSupported(!!SR);
  }, []);

  function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    setMicError('');

    if (isListeningRef.current) {
      isListeningRef.current = false;
      recognitionRef.current?.abort();
      return;
    }

    finalTranscriptRef.current = '';
    isListeningRef.current = true;
    setIsListening(true);
    setInterimText('');

    function startSession() {
      if (!isListeningRef.current) return;
      const recognition = new SR();
      recognition.continuous = false;
      // interimResults:true is required on iOS Safari — it never marks results
      // as isFinal, so with false we receive nothing at all.
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.lang = navigator.language || 'en';

      let sessionFinal = '';
      let sessionInterim = '';

      recognition.onresult = (event) => {
        sessionFinal = '';
        sessionInterim = '';
        for (let i = 0; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            sessionFinal += event.results[i][0].transcript;
          } else {
            sessionInterim += event.results[i][0].transcript;
          }
        }
        // Show live partial text in the listening banner
        setInterimText(sessionFinal || sessionInterim);
      };

      recognition.onend = () => {
        setInterimText('');
        // iOS often never sets isFinal — fall back to interim text
        const text = (sessionFinal || sessionInterim).trim();
        if (text) finalTranscriptRef.current += text + ' ';

        if (isListeningRef.current) {
          setTimeout(startSession, 80);
        } else {
          setIsListening(false);
          const transcript = finalTranscriptRef.current.trim();
          finalTranscriptRef.current = '';
          if (!transcript) return;
          const current = bodyValueRef.current;
          const newBody = current + (current ? '\n' : '') + transcript;
          setBody(newBody);
          setDirty(true);
          const sel = selectedRef.current;
          if (sel) {
            clearTimeout(autosaveTimer.current);
            autosaveTimer.current = setTimeout(async () => {
              setSaving(true);
              try {
                await api.put(`/api/notes/${sel.id}`, { title: titleValueRef.current, body: newBody });
                setDirty(false);
              } catch {}
              setSaving(false);
            }, AUTOSAVE_DELAY);
          }
        }
      };

      recognition.onerror = (event) => {
        setInterimText('');
        if (event.error === 'no-speech' || event.error === 'aborted') {
          if (isListeningRef.current) setTimeout(startSession, 80);
          return;
        }
        isListeningRef.current = false;
        setIsListening(false);
        finalTranscriptRef.current = '';
        setMicError(event.error === 'not-allowed' ? 'Microphone permission denied' : `Mic error: ${event.error}`);
      };

      recognitionRef.current = recognition;
      try { recognition.start(); } catch {}
    }

    startSession();
  }

  const [moodMap, setMoodMap] = useState(null);
  useEffect(() => {
    if (notes.length === 0) { setMoodMap({}); return; }
    const entities = notes.map(n => ({ entityType: 'note', entityId: String(n.id) }));
    api.post('/api/mood/dominant/batch', { entities })
      .then(r => r.json())
      .then(batch => {
        const map = {};
        for (const n of notes) map[`note:${n.id}`] = batch[`note:${n.id}`] || null;
        setMoodMap(map);
      })
      .catch(() => setMoodMap({}));
  }, [notes]);

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
    if (viewportMobile) setMobileListOpen(false);
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
    const val = e.target.value;
    setBody(val);
    setDirty(true);
    scheduleAutosave(selected.id, title, val);

    // @mention detection
    const cursorPos = e.target.selectionStart;
    const textBefore = val.slice(0, cursorPos);
    const atIndex = textBefore.lastIndexOf('@');
    if (atIndex !== -1 && !textBefore.slice(atIndex + 1).includes(' ')) {
      mentionAtIndexRef.current = atIndex;
      setShowMention(true);
      clearTimeout(mentionTimerRef.current);
      mentionTimerRef.current = setTimeout(() => {
        setMentionQuery(textBefore.slice(atIndex + 1));
      }, 150);
    } else {
      setShowMention(false);
      clearTimeout(mentionTimerRef.current);
    }
  }

  // Insert text at the @ position, replacing the @query
  function insertAtMention(text) {
    const atIndex = mentionAtIndexRef.current;
    const cursorPos = bodyRef.current?.selectionStart || body.length;
    const newBody = body.slice(0, atIndex) + text + body.slice(cursorPos);
    setBody(newBody);
    setShowMention(false);
    setDirty(true);
    scheduleAutosave(selected.id, title, newBody);
    setTimeout(() => bodyRef.current?.focus(), 0);
  }

  // Append text at the end of the body
  function appendToBody(text) {
    const newBody = body + (body && !body.endsWith('\n') ? '\n' : '') + text;
    setBody(newBody);
    setDirty(true);
    scheduleAutosave(selected.id, title, newBody);
  }

  const handleMentionSelect = (token, extraContext = '') => {
    insertAtMention(token + extraContext);
  };

  // Web search
  const handleOpenSearch = () => {
    const atIndex = mentionAtIndexRef.current;
    const cursorPos = bodyRef.current?.selectionStart || body.length;
    if (atIndex !== -1) {
      const newBody = body.slice(0, atIndex) + body.slice(cursorPos);
      setBody(newBody);
    }
    setShowMention(false);
    setSearchQuery('');
    setSearchError('');
    setSearchResults([]);
    setShowSearchInput(true);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim() || isSearching) return;
    setIsSearching(true);
    setSearchError('');
    setSearchResults([]);
    try {
      const res = await api.get(`/api/web-search?q=${encodeURIComponent(searchQuery.trim())}`);
      const data = await res.json();
      if (data.error) { setSearchError(data.error); return; }
      const results = data.results || [];
      if (results.length === 0) { setSearchError('No results found. Try a different query.'); return; }
      setSearchResults(results);
    } catch (err) {
      setSearchError(err.message || 'Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchDone = () => {
    if (searchResults.length > 0) {
      const block = '\n\n**Web Search: ' + searchQuery + '**\n' +
        searchResults.map(r => `- [${r.title}](${r.url})${r.snippet ? '\n  ' + r.snippet : ''}`).join('\n');
      appendToBody(block);
    }
    setShowSearchInput(false);
    setSearchQuery('');
    setSearchResults([]);
    setTimeout(() => bodyRef.current?.focus(), 0);
  };

  // Gmail
  const handleOpenGmailSearch = () => {
    const atIndex = mentionAtIndexRef.current;
    const cursorPos = bodyRef.current?.selectionStart || body.length;
    if (atIndex !== -1) {
      const newBody = body.slice(0, atIndex) + body.slice(cursorPos);
      setBody(newBody);
    }
    setShowMention(false);
    setGmailQuery('');
    setGmailError('');
    setGmailResults([]);
    setGmailAttached([]);
    setGmailTranslatedQuery('');
    setShowGmailSearch(true);
  };

  const handleGmailSearch = async () => {
    if (!gmailQuery.trim() || isGmailSearching) return;
    setIsGmailSearching(true);
    setGmailError('');
    setGmailResults([]);
    setGmailTranslatedQuery('');
    try {
      const res = await api.get(`/api/gmail/search?q=${encodeURIComponent(gmailQuery.trim())}&max=10`);
      const data = await res.json();
      if (data.error) { setGmailError(data.error); return; }
      if (data.translatedQuery && data.translatedQuery !== gmailQuery.trim()) {
        setGmailTranslatedQuery(data.translatedQuery);
      }
      const results = data.results || [];
      if (results.length === 0) { setGmailError(`No emails found${data.translatedQuery ? ` for: ${data.translatedQuery}` : ''}. Try rephrasing.`); return; }
      setGmailResults(results);
    } catch (err) {
      setGmailError(err.message || 'Gmail search failed');
    } finally {
      setIsGmailSearching(false);
    }
  };

  const handleGmailAttachThread = async (result) => {
    if (gmailAttached.includes(result.threadId)) return;
    try {
      const res = await api.get(`/api/gmail/thread/${result.threadId}`);
      const data = await res.json();
      if (data.error) { setGmailError(data.error); return; }
      const threadText = '\n\n**Email: ' + result.subject + '**\n' +
        (data.messages || []).map(m =>
          `From: ${m.from}\nDate: ${m.date}\n\n${m.body}`
        ).join('\n\n---\n\n');
      appendToBody(threadText);
      setGmailAttached(prev => [...prev, result.threadId]);
    } catch (err) {
      setGmailError(err.message || 'Failed to load email thread');
    }
  };

  const handleGmailDone = () => {
    setShowGmailSearch(false);
    setGmailQuery('');
    setGmailResults([]);
    setGmailAttached([]);
    setGmailTranslatedQuery('');
    setTimeout(() => bodyRef.current?.focus(), 0);
  };

  // Calendar
  const handleOpenCalendarSearch = () => {
    const atIndex = mentionAtIndexRef.current;
    const cursorPos = bodyRef.current?.selectionStart || body.length;
    if (atIndex !== -1) {
      const newBody = body.slice(0, atIndex) + body.slice(cursorPos);
      setBody(newBody);
    }
    setShowMention(false);
    setCalendarQuery('');
    setCalendarError('');
    setCalendarResults([]);
    setCalendarAttached([]);
    setShowCalendarSearch(true);
  };

  const handleCalendarSearch = async () => {
    if (!calendarQuery.trim() || isCalendarSearching) return;
    setIsCalendarSearching(true);
    setCalendarError('');
    setCalendarResults([]);
    try {
      const res = await api.get(`/api/calendar/search?q=${encodeURIComponent(calendarQuery.trim())}&max=10`);
      const data = await res.json();
      if (data.error) { setCalendarError(data.error); return; }
      const results = data.results || [];
      if (results.length === 0) { setCalendarError('No events found. Try rephrasing.'); return; }
      setCalendarResults(results);
    } catch (err) {
      setCalendarError(err.message || 'Calendar search failed');
    } finally {
      setIsCalendarSearching(false);
    }
  };

  const handleCalendarAttachEvent = async (event) => {
    if (calendarAttached.includes(event.id)) return;
    try {
      const res = await api.get(`/api/calendar/event/${event.id}`);
      const data = await res.json();
      if (data.error) { setCalendarError(data.error); return; }
      appendToBody('\n\n' + (data.text || ''));
      setCalendarAttached(prev => [...prev, event.id]);
    } catch (err) {
      setCalendarError(err.message || 'Failed to load event');
    }
  };

  const handleCalendarDone = () => {
    setShowCalendarSearch(false);
    setCalendarQuery('');
    setCalendarResults([]);
    setCalendarAttached([]);
    setTimeout(() => bodyRef.current?.focus(), 0);
  };

  function handleSearchChange(e) {
    setSearch(e.target.value);
    loadNotes(e.target.value);
  }

  function convertToTask(note, e) {
    if (e) e.stopPropagation();
    pendingConvertNoteIdRef.current = note.id;
    document.dispatchEvent(new CustomEvent('vault:open-quick-capture', {
      detail: {
        title: note.title === 'Untitled' ? '' : note.title,
        notes: (note.body || '').substring(0, NOTE_BODY_LIMIT),
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
      {/* ── List panel — desktop: static, mobile: slide-in drawer ── */}
      {viewportMobile && mobileListOpen && (
        <div
          className="fixed inset-0 z-40"
          style={{ background: 'rgba(0,0,0,0.35)' }}
          onClick={() => setMobileListOpen(false)}
        />
      )}
      <div
        className="flex-shrink-0 border-r flex flex-col"
        style={viewportMobile ? {
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 50,
          width: '285px',
          background: 'var(--color-surface)',
          borderColor: 'var(--color-border)',
          transform: mobileListOpen ? 'translateX(0)' : 'translateX(-285px)',
          transition: 'transform 0.2s ease',
        } : {
          width: '256px',
          borderColor: 'var(--color-border)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Notes</span>
          <div className="flex items-center gap-1">
            {viewportMobile && (
              <button
                onClick={() => setMobileListOpen(false)}
                className="w-6 h-6 flex items-center justify-center rounded hover:opacity-60 transition-opacity"
                style={{ color: 'var(--color-muted)' }}
                title="Close"
              >
                {getIcon('x', { size: 14 })}
              </button>
            )}
            <button
              onClick={createNote}
              className="w-6 h-6 flex items-center justify-center rounded hover:opacity-60 transition-opacity"
              style={{ color: 'var(--color-primary)' }}
              title="New note"
            >
              {getIcon('plus', { size: 16 })}
            </button>
          </div>
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
              className="group cursor-pointer border-b"
              style={{
                borderColor: 'var(--color-border)',
                background: selected?.id === note.id ? 'var(--color-surface-2)' : 'transparent',
              }}
              onClick={() => { selectNote(note); if (viewportMobile) setMobileListOpen(false); }}
            >
              <div className="flex items-start justify-between px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{note.title}</div>
                  <div className="text-xs truncate mt-0.5" style={{ color: 'var(--color-muted)' }}>
                    {note.body ? note.body.slice(0, 60) : <span className="italic">empty</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-1 mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100">
                  {moodMap !== null && <MoodDot entityType="note" entityId={note.id} entityTitle={note.title} dominantEmotion={moodMap[`note:${note.id}`]} />}
                  <button
                    onClick={(e) => convertToTask(note, e)}
                    className="hover:opacity-60 transition-opacity"
                    style={{ color: 'var(--color-primary)' }}
                    title="Convert to task"
                  >
                    {getIcon('list-checks', { size: 13 })}
                  </button>
                  <button
                    onClick={(e) => deleteNote(note.id, e)}
                    className="hover:opacity-60 transition-opacity"
                    style={{ color: 'var(--color-muted)' }}
                    title="Delete"
                  >
                    {getIcon('trash', { size: 13 })}
                  </button>
                </div>
              </div>
              {convertedNoteIds.has(note.id) && (
                <div className="px-3 pb-1.5">
                  <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-primary)22', color: 'var(--color-primary)' }}>
                    ↳ task created
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Editor panel ── */}
      {selected ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-2 flex-wrap">
              {viewportMobile && (
                <button
                  onClick={() => setMobileListOpen(true)}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-md hover:opacity-70 transition-opacity flex-shrink-0 border"
                  style={{ color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}
                  title="Show notes list"
                >
                  {getIcon('menu', { size: 12 })} Notes
                </button>
              )}
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

            <div className="flex items-center gap-2">
              {micSupported && (
                <button
                  onClick={toggleMic}
                  className="w-7 h-7 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity flex-shrink-0"
                  style={{
                    color: isListening ? '#ef4444' : 'var(--color-muted)',
                    background: isListening ? '#fee2e2' : undefined,
                    animation: isListening ? 'pulse 1.2s ease-in-out infinite' : undefined,
                  }}
                  title={isListening ? 'Stop dictation' : 'Dictate (voice input)'}
                >
                  {getIcon('mic', { size: 16 })}
                </button>
              )}
              <button
                onClick={(e) => convertToTask(selected, e)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                title="Convert to task"
              >
                {getIcon('list-checks', { size: 12 })}
                Convert to Task
              </button>

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
          <div className="flex-1 relative overflow-hidden flex flex-col">
            {isListening && (
              <div
                className="flex-shrink-0 flex flex-col gap-1 px-4 py-2 text-xs font-medium border-b"
                style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#b91c1c' }}
              >
                <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
                <div className="flex items-center gap-2">
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block', flexShrink: 0, animation: 'pulse 1.2s ease-in-out infinite' }} />
                  Listening… tap mic to stop
                </div>
                {interimText && (
                  <div style={{ color: '#dc2626', opacity: 0.8, fontStyle: 'italic', paddingLeft: 16 }}>
                    {interimText}
                  </div>
                )}
              </div>
            )}
            {micError && (
              <div className="flex-shrink-0 px-4 py-2 text-xs border-b" style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#b91c1c' }}>
                {micError}
              </div>
            )}
            <textarea
              ref={bodyRef}
              value={body}
              onChange={handleBodyChange}
              onKeyDown={e => { if (e.key === 'Escape' && showMention) { setShowMention(false); e.preventDefault(); } }}
              placeholder="Start writing… type @ to search emails, calendar, tasks & web"
              className="flex-1 px-4 py-2 bg-transparent outline-none resize-none text-sm leading-relaxed"
              style={{ color: 'var(--color-text)' }}
            />

            {/* @mention dropdown */}
            {showMention && (
              <div className="absolute bottom-2 left-4 z-50">
                <AtMentionDropdown
                  query={mentionQuery}
                  onSelect={handleMentionSelect}
                  onSearch={handleOpenSearch}
                  onGmailSearch={handleOpenGmailSearch}
                  onCalendarSearch={handleOpenCalendarSearch}
                  onPromptSelect={(prompt) => insertAtMention(prompt.content || prompt.title)}
                  onClose={() => setShowMention(false)}
                />
              </div>
            )}
            {showMention && (
              <div className="fixed inset-0 z-40" onClick={() => setShowMention(false)} />
            )}

            {/* Web search modal */}
            {showSearchInput && (
              <div className="fixed inset-0 z-40" onClick={() => { setShowSearchInput(false); setSearchQuery(''); setSearchResults([]); }} />
            )}
            {showSearchInput && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ pointerEvents: 'none' }}>
                <div
                  className="rounded-xl border shadow-xl overflow-hidden"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', width: '100%', maxWidth: '520px', pointerEvents: 'auto' }}
                >
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    {getIcon('search', { size: 14, style: { color: 'var(--color-primary)', flexShrink: 0 } })}
                    <input
                      autoFocus
                      type="text"
                      value={searchQuery}
                      onChange={e => { setSearchQuery(e.target.value); setSearchError(''); setSearchResults([]); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); searchResults.length > 0 ? handleSearchDone() : handleSearch(); }
                        if (e.key === 'Escape') { setShowSearchInput(false); setSearchQuery(''); setSearchResults([]); }
                      }}
                      placeholder="What do you want to search for?"
                      className="flex-1 bg-transparent outline-none text-sm"
                      style={{ color: 'var(--color-text)' }}
                      disabled={isSearching}
                    />
                    {isSearching ? (
                      <span style={{ color: 'var(--color-primary)' }}>{getIcon('loader', { size: 14 })}</span>
                    ) : searchResults.length > 0 ? (
                      <button type="button" onClick={handleSearchDone}
                        className="text-xs font-medium px-2.5 py-1 rounded-lg flex-shrink-0"
                        style={{ background: 'var(--color-primary)', color: '#fff' }}>
                        Insert
                      </button>
                    ) : searchQuery.trim() ? (
                      <button type="button" onClick={handleSearch}
                        className="text-xs font-medium px-2.5 py-1 rounded-lg flex-shrink-0"
                        style={{ background: 'var(--color-primary)', color: '#fff' }}>
                        Search
                      </button>
                    ) : null}
                  </div>
                  {searchError && <p className="px-3 pb-2.5 text-xs" style={{ color: '#ef4444' }}>{searchError}</p>}
                  {searchResults.length > 0 ? (
                    <div className="border-t" style={{ borderColor: 'var(--color-border)', maxHeight: '260px', overflowY: 'auto' }}>
                      {searchResults.map((r, i) => (
                        <div key={i} className="px-3 py-2.5 border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
                          <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{r.title}</p>
                          {r.snippet && <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--color-muted)' }}>{r.snippet}</p>}
                          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-primary)', opacity: 0.7 }}>{r.url}</p>
                        </div>
                      ))}
                      <p className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                        {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} · press Insert or Enter to add to note
                      </p>
                    </div>
                  ) : !searchError && (
                    <p className="px-3 pb-2.5 text-xs" style={{ color: 'var(--color-muted)' }}>
                      Search the web and insert results into your note · Esc to cancel
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Gmail search modal */}
            {showGmailSearch && (
              <div className="fixed inset-0 z-40" onClick={() => { setShowGmailSearch(false); setGmailQuery(''); setGmailResults([]); setGmailAttached([]); setGmailTranslatedQuery(''); }} />
            )}
            {showGmailSearch && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ pointerEvents: 'none' }}>
                <div
                  className="rounded-xl border shadow-xl overflow-hidden"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', width: '100%', maxWidth: '520px', pointerEvents: 'auto' }}
                >
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <span style={{ fontSize: 13, flexShrink: 0 }}>✉️</span>
                    <input
                      autoFocus
                      type="text"
                      value={gmailQuery}
                      onChange={e => { setGmailQuery(e.target.value); setGmailError(''); setGmailResults([]); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); gmailResults.length > 0 ? handleGmailDone() : handleGmailSearch(); }
                        if (e.key === 'Escape') { setShowGmailSearch(false); setGmailQuery(''); setGmailResults([]); setGmailAttached([]); }
                      }}
                      placeholder="Search Gmail (e.g. from:boss@company.com invoice)"
                      className="flex-1 bg-transparent outline-none text-sm"
                      style={{ color: 'var(--color-text)' }}
                      disabled={isGmailSearching}
                    />
                    {isGmailSearching ? (
                      <span style={{ color: 'var(--color-primary)' }}>{getIcon('loader', { size: 14 })}</span>
                    ) : gmailResults.length > 0 ? (
                      <button type="button" onClick={handleGmailDone}
                        className="text-xs font-medium px-2.5 py-1 rounded-lg flex-shrink-0"
                        style={{ background: 'var(--color-primary)', color: '#fff' }}>
                        Done
                      </button>
                    ) : gmailQuery.trim() ? (
                      <button type="button" onClick={handleGmailSearch}
                        className="text-xs font-medium px-2.5 py-1 rounded-lg flex-shrink-0"
                        style={{ background: 'var(--color-primary)', color: '#fff' }}>
                        Search
                      </button>
                    ) : null}
                  </div>
                  {gmailError && <p className="px-3 pb-2.5 text-xs" style={{ color: '#ef4444' }}>{gmailError}</p>}
                  {gmailTranslatedQuery && (
                    <p className="px-3 pb-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                      Query: <code style={{ color: 'var(--color-primary)' }}>{gmailTranslatedQuery}</code>
                    </p>
                  )}
                  {gmailResults.length > 0 ? (
                    <div className="border-t" style={{ borderColor: 'var(--color-border)', maxHeight: '260px', overflowY: 'auto' }}>
                      {gmailResults.map((r) => {
                        const attached = gmailAttached.includes(r.threadId);
                        return (
                          <button
                            key={r.id}
                            onClick={() => handleGmailAttachThread(r)}
                            disabled={attached}
                            className="w-full text-left px-3 py-2.5 border-b last:border-b-0 transition-opacity"
                            style={{ borderColor: 'var(--color-border)', opacity: attached ? 0.5 : 1 }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{r.subject}</p>
                              {attached
                                ? <span className="text-xs flex-shrink-0" style={{ color: '#22c55e' }}>✓ Added</span>
                                : <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-primary)' }}>Insert</span>
                              }
                            </div>
                            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-muted)' }}>{r.from} · {r.date ? new Date(r.date).toLocaleDateString() : ''}</p>
                            {r.snippet && <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--color-muted)' }}>{r.snippet}</p>}
                          </button>
                        );
                      })}
                      {gmailAttached.length > 0 && (
                        <p className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                          {gmailAttached.length} thread{gmailAttached.length !== 1 ? 's' : ''} inserted into note · press Done or Enter
                        </p>
                      )}
                    </div>
                  ) : !gmailError && (
                    <p className="px-3 pb-2.5 text-xs" style={{ color: 'var(--color-muted)' }}>
                      Search your inbox and insert emails into your note · Esc to cancel
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Calendar search modal */}
            {showCalendarSearch && (
              <div className="fixed inset-0 z-40" onClick={() => { setShowCalendarSearch(false); setCalendarQuery(''); setCalendarResults([]); setCalendarAttached([]); }} />
            )}
            {showCalendarSearch && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ pointerEvents: 'none' }}>
                <div
                  className="rounded-xl border shadow-xl overflow-hidden"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', width: '100%', maxWidth: '520px', pointerEvents: 'auto' }}
                >
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <span style={{ fontSize: 13, flexShrink: 0 }}>📅</span>
                    <input
                      autoFocus
                      type="text"
                      value={calendarQuery}
                      onChange={e => { setCalendarQuery(e.target.value); setCalendarError(''); setCalendarResults([]); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); calendarResults.length > 0 ? handleCalendarDone() : handleCalendarSearch(); }
                        if (e.key === 'Escape') { setShowCalendarSearch(false); setCalendarQuery(''); setCalendarResults([]); setCalendarAttached([]); }
                      }}
                      placeholder="Search Calendar (e.g. meetings next week)"
                      className="flex-1 bg-transparent outline-none text-sm"
                      style={{ color: 'var(--color-text)' }}
                      disabled={isCalendarSearching}
                    />
                    {isCalendarSearching ? (
                      <span style={{ color: 'var(--color-primary)' }}>{getIcon('loader', { size: 14 })}</span>
                    ) : calendarResults.length > 0 ? (
                      <button type="button" onClick={handleCalendarDone}
                        className="text-xs font-medium px-2.5 py-1 rounded-lg flex-shrink-0"
                        style={{ background: 'var(--color-primary)', color: '#fff' }}>
                        Done
                      </button>
                    ) : calendarQuery.trim() ? (
                      <button type="button" onClick={handleCalendarSearch}
                        className="text-xs font-medium px-2.5 py-1 rounded-lg flex-shrink-0"
                        style={{ background: 'var(--color-primary)', color: '#fff' }}>
                        Search
                      </button>
                    ) : null}
                  </div>
                  {calendarError && <p className="px-3 pb-2.5 text-xs" style={{ color: '#ef4444' }}>{calendarError}</p>}
                  {calendarResults.length > 0 ? (
                    <div className="border-t" style={{ borderColor: 'var(--color-border)', maxHeight: '260px', overflowY: 'auto' }}>
                      {calendarResults.map((event) => {
                        const attached = calendarAttached.includes(event.id);
                        const start = event.start?.dateTime || event.start?.date || '';
                        const startLabel = start ? new Date(start).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                        return (
                          <button
                            key={event.id}
                            onClick={() => handleCalendarAttachEvent(event)}
                            disabled={attached}
                            className="w-full text-left px-3 py-2.5 border-b last:border-b-0 transition-opacity"
                            style={{ borderColor: 'var(--color-border)', opacity: attached ? 0.5 : 1 }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{event.title || '(No title)'}</p>
                              {attached
                                ? <span className="text-xs flex-shrink-0" style={{ color: '#22c55e' }}>✓ Added</span>
                                : <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-primary)' }}>Insert</span>
                              }
                            </div>
                            {startLabel && <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{startLabel}{event.location ? ` · ${event.location}` : ''}</p>}
                          </button>
                        );
                      })}
                      {calendarAttached.length > 0 && (
                        <p className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                          {calendarAttached.length} event{calendarAttached.length !== 1 ? 's' : ''} inserted into note · press Done or Enter
                        </p>
                      )}
                    </div>
                  ) : !calendarError && (
                    <p className="px-3 pb-2.5 text-xs" style={{ color: 'var(--color-muted)' }}>
                      Search your calendar and insert events into your note · Esc to cancel
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--color-muted)' }}>
          <div className="text-center">
            <div className="mb-3 flex justify-center">{getIcon('pen-line', { size: 32, style: { opacity: 0.3 } })}</div>
            <p className="text-sm">Select a note or create a new one</p>
            <div className="flex gap-2 justify-center mt-3">
              {viewportMobile && (
                <button
                  onClick={() => setMobileListOpen(true)}
                  className="text-sm px-4 py-2 rounded-md hover:opacity-80 transition-opacity"
                  style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                >
                  Show Notes
                </button>
              )}
              <button
                onClick={createNote}
                className="text-sm px-4 py-2 rounded-md hover:opacity-80 transition-opacity"
                style={{ background: 'var(--color-primary)', color: '#fff' }}
              >
                New Note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
