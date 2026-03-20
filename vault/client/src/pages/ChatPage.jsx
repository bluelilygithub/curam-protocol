import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useChat } from '../hooks/useChat';
import { useVoice } from '../hooks/useVoice';
import { useFileAttachment } from '../hooks/useFileAttachment';
import { useUrlAttachment } from '../hooks/useUrlAttachment';
import useProjectStore from '../store/projectStore';
import useSettingsStore from '../store/settingsStore';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import MessageBubble from '../components/MessageBubble';
import AtMentionDropdown from '../components/AtMentionDropdown';
import ExportMenu from '../components/ExportMenu';
import ChatFileBar from '../components/ChatFileBar';
import ChatFilePicker from '../components/ChatFilePicker';
import UrlBar from '../components/UrlBar';
import ArtifactPanel from '../components/ArtifactPanel';
import ProjectFilesPanel from '../components/ProjectFilesPanel';
import FollowUpChips from '../components/FollowUpChips';
import { downloadChatMd } from '../utils/exportMd';
import { calcCost, formatCost, formatTokens } from '../utils/pricing';
import { useModels } from '../hooks/useModels';
import SelectionToolbar from '../components/SelectionToolbar';
import PromptVariableModal from '../components/PromptVariableModal';
import ConfirmModal from '../components/ConfirmModal';
import { extractVariables } from '../utils/promptVariables';
import ModelAdvisorModal from '../components/ModelAdvisorModal';
import CheckinModal from '../components/mood/CheckinModal';

const EMOTION_COLOURS = {
  joy: '#C9A84C', trust: '#6B9E70', fear: '#507A60', surprise: '#6B97B5',
  sadness: '#5B6FAD', disgust: '#8A5C8A', anger: '#A85C5C', anticipation: '#C48B3C',
};

const TEMPERATURES = [
  { label: 'Precise', value: 0.2, desc: 'Focused, deterministic' },
  { label: 'Balanced', value: 0.7, desc: 'Default' },
  { label: 'Creative', value: 1.0, desc: 'Varied, imaginative' },
];

// Memoised message list — only re-renders when messages, streaming state, or actions change,
// not when the user types in the input field.
const MemoMessageList = React.memo(function MemoMessageList({
  messages, isStreaming, isAiSearching, sessionId,
  suggestions, onDelete, onBranch, onOpenArtifact, onSuggestionSelect,
  messagesEndRef, bookmarkedMap, onToggleBookmark,
  isTTSAvailable, isSpeaking, isPaused, speak, pauseSpeaking, resumeSpeaking, stopSpeaking,
}) {
  const getIcon = useIcon();
  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {messages.map((msg, i) => {
        const isLastAssistant = msg.role === 'assistant' && i === messages.length - 1;
        return (
          <div key={i}>
            <MessageBubble
              message={msg}
              messageIndex={i}
              onDelete={msg.role === 'user' && !isStreaming ? onDelete : undefined}
              onOpenArtifact={msg.role === 'assistant' ? onOpenArtifact : undefined}
              onBranch={msg.role === 'user' && !!sessionId && !isStreaming ? onBranch : undefined}
              searching={isLastAssistant && isAiSearching}
              bookmarked={msg.id ? !!bookmarkedMap[msg.id] : false}
              onToggleBookmark={onToggleBookmark}
              isLatest={isLastAssistant}
              isSpeaking={isLastAssistant && isTTSAvailable ? isSpeaking : false}
              isPaused={isLastAssistant && isTTSAvailable ? isPaused : false}
              onSpeak={isLastAssistant && isTTSAvailable && msg.role === 'assistant' ? () => speak(msg.content) : undefined}
              onPause={isLastAssistant && isTTSAvailable ? pauseSpeaking : undefined}
              onResume={isLastAssistant && isTTSAvailable ? resumeSpeaking : undefined}
              onStop={isLastAssistant && isTTSAvailable ? stopSpeaking : undefined}
            />
            {isLastAssistant && !isStreaming && (
              <FollowUpChips suggestions={suggestions} onSelect={onSuggestionSelect} />
            )}
          </div>
        );
      })}
      <div ref={messagesEndRef} />
    </div>
  );
});

function ChatPage({ general = false }) {
  const { id: projectIdParam } = useParams();
  const location = useLocation();
  const { activeProjectId, projects, setActive, fetchProjects } = useProjectStore();
  const projectId = general ? null : (projectIdParam ? Number(projectIdParam) : activeProjectId);

  const { messages, isStreaming, isSearching: isAiSearching, sessionId, sessionUsage, sendMessage, stopStreaming, loadHistory, clearMessages, deleteMessagePair, streamError, clearStreamError, ragFallbackActive } = useChat({ projectId });
  const { models: MODELS } = useModels();
  const { isSTTAvailable, isTTSAvailable, isListening, transcript, interimText, isSpeaking, isPaused, startListening, stopListening, speak, pauseSpeaking, resumeSpeaking, stopSpeaking } = useVoice();
  const { attachments, uploading, error: attachError, uploadAndAttach, attachExisting, remove: removeAttachment, clear: clearAttachments } = useFileAttachment(projectId);
  const { urlAttachments, addUrl, addManual: addManualAttachment, remove: removeUrl, clear: clearUrls } = useUrlAttachment();
  const getIcon = useIcon();

  const [input, setInput] = useState('');
  const [showMention, setShowMention] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInputValue, setUrlInputValue] = useState('');
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // Gmail search state
  const [showGmailSearch, setShowGmailSearch] = useState(false);
  const [gmailQuery, setGmailQuery] = useState('');
  const [isGmailSearching, setIsGmailSearching] = useState(false);
  const [gmailError, setGmailError] = useState('');
  const [gmailResults, setGmailResults] = useState([]);
  const [gmailAttached, setGmailAttached] = useState([]); // threadIds already attached
  const [gmailTranslatedQuery, setGmailTranslatedQuery] = useState('');

  // Calendar search state
  const [showCalendarSearch, setShowCalendarSearch] = useState(false);
  const [calendarQuery, setCalendarQuery] = useState('');
  const [isCalendarSearching, setIsCalendarSearching] = useState(false);
  const [calendarError, setCalendarError] = useState('');
  const [calendarResults, setCalendarResults] = useState([]);
  const [calendarAttached, setCalendarAttached] = useState([]); // eventIds already attached
  const [calendarAskEventId, setCalendarAskEventId] = useState(null);
  const [calendarAskQuestion, setCalendarAskQuestion] = useState('');
  const [calendarAskAnswer, setCalendarAskAnswer] = useState('');
  const [isCalendarAsking, setIsCalendarAsking] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [inlineImages, setInlineImages] = useState([]);

  // Title editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');

  // Session deletion
  const [confirmDeleteSession, setConfirmDeleteSession] = useState(false);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [confirmDeleteSid, setConfirmDeleteSid] = useState(null);

  // Model + temperature
  const [chatModel, setChatModel] = useState(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [temperature, setTemperature] = useState(0.7);
  const [showTempPicker, setShowTempPicker] = useState(false);

  // Files panel
  const [showFilesPanel, setShowFilesPanel] = useState(false);
  const [sessionFiles, setSessionFiles] = useState([]); // files attached from library this session
  const [pinnedFiles, setPinnedFiles] = useState([]);   // project files pinned (always in context)
  const [showContextBar, setShowContextBar] = useState(true);

  // Summarize
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [showSummaryPanel, setShowSummaryPanel] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [summaryText, setSummaryText] = useState('');
  const [saveSummaryToNote, setSaveSummaryToNote] = useState(true);
  const [summaryNoteSaved, setSummaryNoteSaved] = useState(false);

  // Budget alert dismiss state (resets on session change)
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [alertDismissedMsgCount, setAlertDismissedMsgCount] = useState(0);

  // Artifacts
  const [activeArtifacts, setActiveArtifacts] = useState(null); // { artifacts, initialIndex }

  // Follow-up suggestions
  const [suggestions, setSuggestions] = useState([]);

  // Prompt picker
  const [showPromptPicker, setShowPromptPicker] = useState(false);
  const [prompts, setPrompts] = useState([]);
  const [promptSearch, setPromptSearch] = useState('');

  // Prompt variable modal — { content, onInsert } or null
  const [promptVarModal, setPromptVarModal] = useState(null);

  // Bookmarks — { [messageId]: true } map for current session
  const [bookmarkedMap, setBookmarkedMap] = useState({});

  // Reasoning mode
  const [reasoning, setReasoning] = useState(false);

  // Web search
  const [webSearch, setWebSearch] = useState(true);

  // Model availability (null = unknown, true = configured, false = missing key)
  const [modelStatus, setModelStatus] = useState({ anthropic: null, gemini: null });
  const [preflightError, setPreflightError] = useState(null);

  // Persona picker
  const [personas, setPersonas] = useState([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState(null);
  const [showPersonaPicker, setShowPersonaPicker] = useState(false);

  // Project feeling
  const [projectDominant, setProjectDominant] = useState(null);
  const [showFeelingModal, setShowFeelingModal] = useState(false);

  // Smart Model Advisor
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [advisorData, setAdvisorData] = useState(null);
  const [pendingSendPayload, setPendingSendPayload] = useState(null);
  const [advisorPendingSwitch, setAdvisorPendingSwitch] = useState(null);

  const messagesEndRef = useRef(null);
  const messageListRef = useRef(null);
  const textareaRef = useRef(null);
  const titleInputRef = useRef(null);
  const mentionTimerRef = useRef(null);
  const handleSendRef = useRef(null);

  const project = projects.find((p) => p.id === projectId);
  const currentSession = sessions.find(s => s.sessionId === sessionId);
  const sessionTitle = currentSession?.title || '';
  const isSummarized = !!(currentSession?.isSummarized);
  const isStarred = !!(currentSession?.starred);

  const totalContentSize = messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
  const contextWarning = messages.length >= 20 && !isSummarized && totalContentSize > 12000;

  // Pre-fill input from Notes "Take to Chat"
  useEffect(() => {
    if (location.state?.draft) {
      setInput(location.state.draft);
      window.history.replaceState({}, '');
    }
  }, []);

  // Fetch pinned files for context bar
  useEffect(() => {
    if (!projectId) { setPinnedFiles([]); return; }
    api.get(`/api/files/${projectId}`)
      .then(r => r.json())
      .then(files => setPinnedFiles(files.filter(f => f.pinned)))
      .catch(() => {});
  }, [projectId]);

  // Load session files from DB when sessionId becomes known
  // Also flush any files selected before sessionId was established
  useEffect(() => {
    if (!sessionId) return;
    // Flush any in-memory selections that couldn't be saved yet (sessionId was null)
    setSessionFiles(prev => {
      prev.forEach(f => {
        api.post(`/api/session-files/${sessionId}`, { fileId: f.id }).catch(() => {});
      });
      return prev;
    });
    // Merge DB state (for page refresh / returning to session)
    api.get(`/api/session-files/${sessionId}`)
      .then(r => r.json())
      .then(files => {
        if (!Array.isArray(files) || files.length === 0) return;
        setSessionFiles(prev => {
          const existing = new Set(prev.map(f => f.id));
          const incoming = files.filter(f => !existing.has(f.id)).map(f => ({ id: f.id, name: f.name }));
          return incoming.length > 0 ? [...prev, ...incoming] : prev;
        });
      })
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    fetchProjects();
    if (general) { fetchSessions(); }
    else if (projectId) { setActive(projectId); fetchSessions(); }
    api.get('/api/chat/model-status').then(r => r.json()).then(setModelStatus).catch(() => {});
  }, [projectId, general]);

  // Reset alert dismiss state when switching sessions
  useEffect(() => { setAlertDismissed(false); setAlertDismissedMsgCount(0); }, [sessionId]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    if (transcript) {
      setInput(prev => prev.trimEnd() ? prev.trimEnd() + ' ' + transcript.trim() : transcript.trim());
      textareaRef.current?.focus();
    }
  }, [transcript]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [input]);

  useEffect(() => {
    if (sessionId) { setSummaryText(''); setShowSummaryPanel(false); setSuggestions([]); }
  }, [sessionId]);

  // Fetch follow-up suggestions and refresh session/project lists after stream ends
  useEffect(() => {
    if (!isStreaming && sessionId && messages.length >= 2) {
      api.post('/api/chat/suggestions', { sessionId })
        .then(r => r.json()).then(d => setSuggestions(d.suggestions || [])).catch(() => {});
      fetchSessions();
      fetchProjects();
    } else if (isStreaming) {
      setSuggestions([]);
    }
  }, [isStreaming]);

  // Cmd+N new chat listener
  useEffect(() => {
    const handler = () => { clearMessages(); setSuggestions([]); setActiveArtifacts(null); };
    document.addEventListener('vault:new-chat', handler);
    return () => document.removeEventListener('vault:new-chat', handler);
  }, [clearMessages]);

  // Load a specific session (from sidebar or history page)
  useEffect(() => {
    const handler = (e) => {
      if (!e.detail) return;
      setShowSummaryPanel(false);
      setSummaryText('');
      setSuggestions([]);
      setActiveArtifacts(null);
      loadHistory(e.detail);
    };
    document.addEventListener('vault:load-session', handler);
    return () => document.removeEventListener('vault:load-session', handler);
  }, [loadHistory]);

  // Handle ?session= query param (e.g. from "Created from chat" links in TasksPage)
  useEffect(() => {
    const sessionParam = new URLSearchParams(location.search).get('session');
    if (sessionParam) {
      setShowSummaryPanel(false);
      setSummaryText('');
      setSuggestions([]);
      setActiveArtifacts(null);
      loadHistory(sessionParam);
    }
  }, [location.search, loadHistory]);

  const fetchSessions = useCallback(async () => {
    if (general) {
      const res = await api.get('/api/chat/sessions/general');
      setSessions(await res.json());
    } else if (projectId) {
      const res = await api.get(`/api/chat/sessions/${projectId}`);
      setSessions(await res.json());
    }
  }, [general, projectId]);

  const loadPrompts = async () => {
    const res = await api.get(`/api/prompts${projectId ? `?projectId=${projectId}` : ''}`);
    setPrompts(await res.json());
  };

  // Load bookmark state for the active session
  useEffect(() => {
    if (!sessionId) { setBookmarkedMap({}); return; }
    api.get(`/api/bookmarks/session/${sessionId}`)
      .then(r => r.json())
      .then(ids => {
        const map = {};
        ids.forEach(id => { map[id] = true; });
        setBookmarkedMap(map);
      })
      .catch(() => {});
  }, [sessionId]);

  const handleToggleBookmark = useCallback(async (messageId) => {
    if (!sessionId || !messageId) return;
    const res = await api.post(`/api/bookmarks/${messageId}`, { sessionId });
    const data = await res.json();
    setBookmarkedMap(prev => {
      const next = { ...prev };
      if (data.bookmarked) { next[messageId] = true; } else { delete next[messageId]; }
      return next;
    });
    // Notify Layout to refresh badge
    window.dispatchEvent(new CustomEvent('vault:bookmark-changed'));
  }, [sessionId]);

  const loadPersonas = async () => {
    const res = await api.get('/api/personas');
    setPersonas(await res.json());
  };

  useEffect(() => {
    if (!projectId) { setProjectDominant(null); return; }
    api.get(`/api/mood/dominant/project/${projectId}`)
      .then(r => r.json())
      .then(d => setProjectDominant(d.coreEmotion ? d : null))
      .catch(() => {});
  }, [projectId]);

  const effectiveModel = chatModel || project?.model || 'claude-sonnet-4-6';
  // Clear preflight error when model changes
  const prevEffectiveModelRef = useRef(effectiveModel);
  if (prevEffectiveModelRef.current !== effectiveModel) { prevEffectiveModelRef.current = effectiveModel; setPreflightError(null); }

  const handlePaste = (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    imageItems.forEach(item => {
      const file = item.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        setInlineImages(prev => [...prev, {
          id: Math.random().toString(36).slice(2),
          mimeType: file.type,
          data: dataUrl.split(',')[1],
          preview: dataUrl,
        }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleSend = async (overrideText) => {
    const text = (overrideText || input).trim();
    if (!text && inlineImages.length === 0) return;
    if (isStreaming) return;
    if (urlAttachments.some(u => u.status === 'fetching')) return;
    // Pre-flight: block send if the provider key is confirmed missing
    const modelIsGemini = effectiveModel.startsWith('gemini-');
    const provider = modelIsGemini ? 'gemini' : 'anthropic';
    if (modelStatus[provider] === false) {
      const hint = modelIsGemini
        ? 'Add GEMINI_API_KEY to your Railway environment variables.'
        : 'Add ANTHROPIC_API_KEY to your Railway environment variables.';
      setPreflightError({ code: 'auth', message: `${modelIsGemini ? 'Gemini' : 'Anthropic'} API key is not configured.`, hint });
      return;
    }
    setPreflightError(null);
    const ids = attachments.map(a => a.id);
    const meta = attachments.map(a => ({ id: a.id, name: a.name, mimetype: a.mimetype, preview: a.preview }));
    const readyUrls = urlAttachments.filter(u => u.status === 'ready');
    const imgPayload = inlineImages.map(i => ({ mimeType: i.mimeType, data: i.data }));
    setInput('');
    setShowMention(false);
    setShowUrlInput(false);
    setUrlInputValue('');
    setShowSearchInput(false);
    setSearchQuery('');
    setSearchResults([]);
    setShowGmailSearch(false);
    setGmailQuery('');
    setGmailResults([]);
    setGmailAttached([]);
    setGmailTranslatedQuery('');
    setShowCalendarSearch(false);
    setCalendarQuery('');
    setCalendarResults([]);
    setCalendarAttached([]);
    setShowPromptPicker(false);
    clearAttachments();
    clearUrls();
    setInlineImages([]);
    setSuggestions([]);
    setActiveArtifacts(null);
    await sendMessage(text, ids, meta, effectiveModel, readyUrls, temperature, selectedPersonaId, reasoning, imgPayload, webSearch);
    setTimeout(fetchSessions, 2000);
  };

  handleSendRef.current = handleSend;
  const stableSuggestionSelect = useCallback((s) => handleSendRef.current?.(s), []);

  // After a model switch from the advisor, fire the send once the new chatModel value has committed
  useEffect(() => {
    if (advisorPendingSwitch !== null && chatModel === advisorPendingSwitch) {
      setAdvisorPendingSwitch(null);
      handleSendRef.current?.();
    }
  }, [chatModel, advisorPendingSwitch]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkModelBeforeSend = async () => {
    const text = input.trim();
    if (!text && inlineImages.length === 0) { handleSend(); return; }
    if (isStreaming) { handleSend(); return; }
    const currentPersona = personas.find(p => p.id === selectedPersonaId);
    const personaModelHint = currentPersona?.model || undefined;
    try {
      const res = await api.post('/api/chat/analyse-prompt', {
        prompt: text,
        currentModelId: effectiveModel,
        sessionId,
        ...(personaModelHint ? { personaModelHint } : {}),
      });
      const data = await res.json();
      if (data?.mismatch) {
        setAdvisorData(data);
        setAdvisorOpen(true);
        return;
      }
    } catch { /* fall through */ }
    handleSend();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); checkModelBeforeSend(); }
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInput(val);
    const cursorPos = e.target.selectionStart;
    const textBefore = val.slice(0, cursorPos);
    const atIndex = textBefore.lastIndexOf('@');
    if (atIndex !== -1 && !textBefore.slice(atIndex + 1).includes(' ')) {
      setShowMention(true);
      clearTimeout(mentionTimerRef.current);
      mentionTimerRef.current = setTimeout(() => {
        setMentionQuery(textBefore.slice(atIndex + 1));
      }, 150);
    } else {
      setShowMention(false);
      clearTimeout(mentionTimerRef.current);
    }
  };

  const handleMentionSelect = (token, extraContext = '') => {
    const cursorPos = textareaRef.current?.selectionStart || input.length;
    const atIndex = input.lastIndexOf('@', cursorPos);
    const replacement = token + extraContext;
    setInput(input.slice(0, atIndex) + replacement + input.slice(cursorPos));
    setShowMention(false);
    textareaRef.current?.focus();
  };

  // Resolve a prompt's content: if it has {{variables}}, open the fill-in modal;
  // otherwise insert it immediately. The onInsert callback handles what to do with the text.
  const resolvePrompt = (content, onInsert) => {
    if (extractVariables(content).length > 0) {
      setPromptVarModal({ content, onInsert });
    } else {
      onInsert(content);
    }
  };

  // Called when user picks a prompt from the @mention dropdown
  const handlePromptMentionSelect = (prompt) => {
    setShowMention(false);
    const cursorPos = textareaRef.current?.selectionStart || input.length;
    const atIndex = input.lastIndexOf('@', cursorPos);
    const before = input.slice(0, atIndex);
    const after = input.slice(cursorPos);
    resolvePrompt(prompt.content, (filled) => {
      setInput(before + filled + after);
      textareaRef.current?.focus();
    });
  };

  const handleOpenSearch = () => {
    // Strip the @... mention text the user typed
    const cursorPos = textareaRef.current?.selectionStart || input.length;
    const atIndex = input.lastIndexOf('@', cursorPos);
    if (atIndex !== -1) setInput(input.slice(0, atIndex) + input.slice(cursorPos));
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
      if (data.error) {
        setSearchError(data.error);
        return;
      }
      const results = data.results || [];
      if (results.length === 0) {
        setSearchError('No results found. Try a different query.');
        return;
      }
      setSearchResults(results);
      for (const result of results) {
        addUrl(result.url);
      }
    } catch (err) {
      setSearchError(err.message || 'Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchDone = () => {
    setShowSearchInput(false);
    setSearchQuery('');
    setSearchResults([]);
    textareaRef.current?.focus();
  };

  const handleOpenGmailSearch = () => {
    const cursorPos = textareaRef.current?.selectionStart || input.length;
    const atIndex = input.lastIndexOf('@', cursorPos);
    if (atIndex !== -1) setInput(input.slice(0, atIndex) + input.slice(cursorPos));
    setShowMention(false);
    setGmailQuery('');
    setGmailError('');
    setGmailResults([]);
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
      const threadText = (data.messages || []).map(m =>
        `From: ${m.from}\nDate: ${m.date}\nSubject: ${m.subject}\n\n${m.body}`
      ).join('\n\n---\n\n');
      addManualAttachment({
        url: `gmail://thread/${result.threadId}`,
        title: `📧 ${result.subject}`,
        content: threadText,
      });
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
    textareaRef.current?.focus();
  };

  const handleOpenCalendarSearch = () => {
    const cursorPos = textareaRef.current?.selectionStart || input.length;
    const atIndex = input.lastIndexOf('@', cursorPos);
    if (atIndex !== -1) setInput(input.slice(0, atIndex) + input.slice(cursorPos));
    setShowMention(false);
    setCalendarQuery('');
    setCalendarError('');
    setCalendarResults([]);
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
      addManualAttachment({
        url: `calendar://event/${event.id}`,
        title: `📅 ${event.title || 'Event'}`,
        content: data.text || '',
      });
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
    textareaRef.current?.focus();
  };

  const startEditTitle = () => {
    setTitleInput(sessionTitle);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  };

  const saveTitle = async () => {
    setEditingTitle(false);
    if (!sessionId || !titleInput.trim() || titleInput.trim() === sessionTitle) return;
    await api.patch(`/api/chat/sessions/${sessionId}/title`, { title: titleInput.trim() });
    fetchSessions();
  };

  const handleDeleteSession = async () => {
    if (!sessionId) return;
    await api.delete(`/api/chat/sessions/${sessionId}`);
    clearMessages();
    setConfirmDeleteSession(false);
    fetchSessions();
  };

  const handleDeleteSessionById = async (sid) => {
    await api.delete(`/api/chat/sessions/${sid}`);
    if (sid === sessionId) clearMessages();
    setConfirmDeleteSid(null);
    fetchSessions();
  };

  const handleToggleStar = async () => {
    if (!sessionId) return;
    await api.patch(`/api/chat/sessions/${sessionId}/star`);
    fetchSessions();
  };

  const handleSummarize = async () => {
    if (!sessionId || isSummarizing || messages.length < 4) return;
    setIsSummarizing(true);
    try {
      const res = await api.post(`/api/chat/sessions/${sessionId}/summarize`);
      const data = await res.json();
      if (data.summary) {
        setSummaryText(data.summary);
        await fetchSessions();
        setShowSummaryPanel(true);
        if (saveSummaryToNote && projectId) {
          try {
            const today = new Date().toISOString().slice(0, 10);
            const noteTitle = `${sessionTitle || 'Chat'} — Summary ${today}`;
            await api.post('/api/notes', { title: noteTitle, body: data.summary, project_id: projectId });
            setSummaryNoteSaved(true);
            setTimeout(() => setSummaryNoteSaved(false), 3500);
          } catch (_) {}
        }
      }
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleViewSummary = async () => {
    if (summaryText) { setShowSummaryPanel(v => !v); return; }
    const res = await api.get(`/api/chat/sessions/${sessionId}/summary`);
    const data = await res.json();
    setSummaryText(data.summaryContent || '');
    setShowSummaryPanel(true);
  };

  const handleRevertSummary = async () => {
    if (!sessionId) return;
    await api.delete(`/api/chat/sessions/${sessionId}/summary`);
    setSummaryText('');
    setShowSummaryPanel(false);
    fetchSessions();
  };

  const handleOpenArtifact = useCallback((idx, blocks) => {
    setActiveArtifacts({ artifacts: blocks, initialIndex: idx });
  }, []);

  const handleBranch = useCallback(async (messageIndex) => {
    if (!sessionId) return;
    try {
      const res = await api.post(`/api/chat/sessions/${sessionId}/branch`, { messageIndex });
      const data = await res.json();
      if (data.newSessionId) {
        loadHistory(data.newSessionId);
        setSuggestions([]);
        setActiveArtifacts(null);
        setTimeout(fetchSessions, 500);
      }
    } catch (err) {
      console.error('Branch error:', err);
    }
  }, [sessionId, loadHistory, fetchSessions]);

  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant');
  const hasInput = input.trim().length > 0;

  // Token budget
  const sessionBudget = useSettingsStore(s => s.sessionBudget);
  const budgetAlertThreshold = useSettingsStore(s => s.budgetAlertThreshold ?? 80);
  const budgetCriticalThreshold = useSettingsStore(s => s.budgetCriticalThreshold ?? 100);
  const budgetReAlertFrequency = useSettingsStore(s => s.budgetReAlertFrequency ?? 'session');
  const sessionCost = sessionUsage.inputTokens > 0
    ? calcCost(sessionUsage.model || effectiveModel, sessionUsage.inputTokens, sessionUsage.outputTokens)
    : 0;
  const budgetPct = sessionBudget ? (sessionCost / sessionBudget) * 100 : 0;

  const shouldShowBudgetAlert = (() => {
    if (!alertDismissed) return true;
    if (budgetReAlertFrequency === 'session') return false;
    if (budgetReAlertFrequency === 'every10') return messages.length >= alertDismissedMsgCount + 10;
    if (budgetReAlertFrequency === 'every20') return messages.length >= alertDismissedMsgCount + 20;
    if (budgetReAlertFrequency === 'at95') return budgetPct >= 95;
    return false;
  })();

  const dismissBudgetAlert = () => { setAlertDismissed(true); setAlertDismissedMsgCount(messages.length); };

  const currentTempLabel = TEMPERATURES.find(t => t.value === temperature)?.label || 'Balanced';
  const costDisplay = sessionUsage.inputTokens > 0
    ? `${formatTokens(sessionUsage.inputTokens + sessionUsage.outputTokens)} tokens · ${formatCost(calcCost(sessionUsage.model || effectiveModel, sessionUsage.inputTokens, sessionUsage.outputTokens))}`
    : null;

  const filteredPrompts = promptSearch
    ? prompts.filter(p => p.title.toLowerCase().includes(promptSearch.toLowerCase()) || p.content.toLowerCase().includes(promptSearch.toLowerCase()))
    : prompts;

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div
        className="flex-shrink-0 px-4 h-12 flex items-center gap-2 border-b"
        style={{
          borderColor: 'var(--color-border)',
          background: MODELS.find(x => x.id === effectiveModel)?.label === 'Premium' ? '#fee2e2' : undefined,
        }}
      >
        {general ? (
          <span className="text-sm font-medium flex-shrink-0" style={{ color: 'var(--color-text)' }}>
            General
          </span>
        ) : project ? (
          <span className="text-sm font-medium flex-shrink-0 truncate max-w-[120px]" style={{ color: 'var(--color-text)' }}>
            {project.name}
          </span>
        ) : null}

        {(general ? sessionId : (project && sessionId)) && (
          <span style={{ color: 'var(--color-border)' }} className="flex-shrink-0">/</span>
        )}

        {sessionId && (
          editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleInput}
              onChange={e => setTitleInput(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
              className="text-xs px-2 py-1 rounded-lg border outline-none flex-1 min-w-0 max-w-[200px]"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-primary)', color: 'var(--color-text)' }}
            />
          ) : (
            <button
              onClick={startEditTitle}
              className="hidden sm:block text-xs truncate max-w-[180px] hover:opacity-70 transition-opacity text-left"
              style={{ color: 'var(--color-muted)' }}
              title="Click to rename"
            >
              {sessionTitle || (sessions.length > 0 ? 'Untitled chat' : '')}
            </button>
          )
        )}

        {sessions.length > 0 && (
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setShowSessionPicker(v => !v)}
              className="text-xs px-2 py-1 rounded-lg border outline-none flex items-center gap-1 max-w-[140px]"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              <span className="truncate">
                {currentSession
                  ? (currentSession.starred ? '⭐ ' : '') + (currentSession.title || `${new Date(currentSession.startedAt).toLocaleDateString()} · ${currentSession.sessionId.slice(-6)}`) + (currentSession.isSummarized ? ' ✦' : '')
                  : '+ New chat'}
              </span>
              {getIcon('chevron-down', { size: 10 })}
            </button>
            {showSessionPicker && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => { setShowSessionPicker(false); setConfirmDeleteSid(null); }} />
                <div
                  className="absolute left-0 top-full mt-1 z-20 rounded-xl border shadow-lg overflow-hidden"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minWidth: '220px', maxWidth: '300px', maxHeight: '320px', overflowY: 'auto' }}
                >
                  <button
                    onClick={() => { clearMessages(); setShowSummaryPanel(false); setSummaryText(''); setSuggestions([]); setActiveArtifacts(null); setShowSessionPicker(false); }}
                    className="w-full text-left px-3 py-2 text-xs hover:opacity-70 border-b"
                    style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                  >
                    + New chat
                  </button>
                  {sessions.map((s) => (
                    <div
                      key={s.sessionId}
                      className="group flex items-center gap-1 px-3 py-2 border-b last:border-b-0 hover:opacity-80"
                      style={{ background: s.sessionId === sessionId ? 'var(--color-bg)' : 'transparent', borderColor: 'var(--color-border)' }}
                    >
                      {confirmDeleteSid === s.sessionId ? (
                        <div className="flex items-center gap-2 flex-1">
                          <span className="text-xs text-red-500 flex-1">Delete?</span>
                          <button onClick={() => handleDeleteSessionById(s.sessionId)} className="text-xs px-2 py-0.5 rounded bg-red-500 text-white">Yes</button>
                          <button onClick={() => setConfirmDeleteSid(null)} className="text-xs" style={{ color: 'var(--color-muted)' }}>No</button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => { setShowSummaryPanel(false); setSummaryText(''); setSuggestions([]); setActiveArtifacts(null); loadHistory(s.sessionId); setShowSessionPicker(false); }}
                            className="flex-1 text-left text-xs truncate"
                            style={{ color: 'var(--color-text)' }}
                          >
                            {s.starred ? '⭐ ' : ''}{s.title || `${new Date(s.startedAt).toLocaleDateString()} · ${s.sessionId.slice(-6)}`}{s.isSummarized ? ' ✦' : ''}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteSid(s.sessionId); }}
                            className="opacity-0 group-hover:opacity-100 flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:opacity-60 transition-opacity"
                            style={{ color: 'var(--color-muted)' }}
                            title="Delete chat"
                          >
                            {getIcon('trash', { size: 12 })}
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex-1" />

        {/* Usage display */}
        {costDisplay && (
          <span className="text-xs hidden md:block" style={{ color: 'var(--color-muted)', opacity: 0.6 }}>
            {costDisplay}
          </span>
        )}

        {/* Temperature picker */}
        <div className="relative hidden sm:block">
          <button
            onClick={() => { setShowTempPicker(v => !v); setShowModelPicker(false); }}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)' }}
            title="Response temperature"
          >
            {getIcon('flame', { size: 12 })}
            {currentTempLabel}
          </button>
          {showTempPicker && (
            <div
              className="absolute right-0 top-full mt-1 w-44 rounded-xl border shadow-lg py-1.5 z-40"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              {TEMPERATURES.map(t => (
                <button
                  key={t.value}
                  onClick={() => { setTemperature(t.value); setShowTempPicker(false); }}
                  className="w-full text-left px-3 py-2 flex items-center justify-between hover:opacity-70 transition-opacity"
                >
                  <div>
                    <div className="text-xs font-medium" style={{ color: temperature === t.value ? 'var(--color-primary)' : 'var(--color-text)' }}>{t.label}</div>
                    <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{t.desc}</div>
                  </div>
                  {temperature === t.value && <span className="text-xs" style={{ color: 'var(--color-primary)' }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Model picker */}
        <div className="relative">
          <button
            onClick={() => { setShowModelPicker(v => !v); setShowTempPicker(false); }}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors hover:opacity-70"
            style={{
              borderColor: modelStatus[effectiveModel.startsWith('gemini-') ? 'gemini' : 'anthropic'] === false ? '#f59e0b' : 'var(--color-border)',
              color: 'var(--color-muted)',
              background: 'var(--color-surface)',
            }}
            title={modelStatus[effectiveModel.startsWith('gemini-') ? 'gemini' : 'anthropic'] === false ? 'API key not configured — click to switch model' : 'Switch AI model'}
          >
            {(() => { const m = MODELS.find(x => x.id === effectiveModel); return m ? `${m.emoji} ${m.name}` : effectiveModel; })()}
            {modelStatus[effectiveModel.startsWith('gemini-') ? 'gemini' : 'anthropic'] === false && <span style={{ color: '#f59e0b' }}>⚠️</span>}
          </button>
          {showModelPicker && (
            <div
              className="absolute right-0 top-full mt-1 w-52 rounded-xl border shadow-lg py-1.5 z-40"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              {MODELS.map(m => {
                const unavailable = modelStatus[m.provider] === false;
                return (
                  <button
                    key={m.id}
                    onClick={() => { setChatModel(m.id); setShowModelPicker(false); }}
                    className="w-full text-left px-3 py-2 flex items-start gap-2.5 hover:opacity-70 transition-opacity"
                    title={unavailable ? `${m.provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'} not configured` : undefined}
                  >
                    <span className="text-base flex-shrink-0 mt-0.5">{m.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold flex items-center gap-1.5" style={{ color: effectiveModel === m.id ? 'var(--color-primary)' : unavailable ? 'var(--color-muted)' : 'var(--color-text)' }}>
                        {m.label} · {m.name}
                        {unavailable && <span title="API key not configured" style={{ color: '#f59e0b' }}>⚠️</span>}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{unavailable ? 'API key not configured' : m.tagline}</div>
                    </div>
                    {effectiveModel === m.id && <span className="ml-auto text-xs flex-shrink-0" style={{ color: 'var(--color-primary)' }}>✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Reasoning mode toggle — only for sonnet/opus, hidden on mobile */}
        {(effectiveModel.includes('sonnet') || effectiveModel.includes('opus')) && (
          <button
            onClick={() => setReasoning(v => !v)}
            className="hidden sm:flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-all hover:opacity-70"
            style={{
              borderColor: reasoning ? 'var(--color-primary)' : 'var(--color-border)',
              color: reasoning ? 'var(--color-primary)' : 'var(--color-muted)',
              background: reasoning ? 'var(--color-primary)10' : 'var(--color-surface)',
            }}
            title={reasoning ? 'Disable extended reasoning' : 'Enable extended reasoning (slower, more thorough)'}
          >
            {getIcon('cpu', { size: 12 })}
            Reason
          </button>
        )}

        {/* Web search toggle */}
        <button
          onClick={() => setWebSearch(v => !v)}
          className="hidden sm:flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-all hover:opacity-70"
          style={{
            borderColor: webSearch ? 'var(--color-primary)' : 'var(--color-border)',
            color: webSearch ? 'var(--color-primary)' : 'var(--color-muted)',
            background: webSearch ? 'var(--color-primary)10' : 'var(--color-surface)',
          }}
          title={webSearch ? 'Disable web search' : 'Enable web search'}
        >
          {getIcon('globe', { size: 12 })}
          Search
        </button>

        {/* Persona picker — hidden on mobile */}
        <div className="relative hidden sm:block">
          <button
            onClick={() => { setShowPersonaPicker(v => !v); if (!showPersonaPicker) loadPersonas(); setShowModelPicker(false); setShowTempPicker(false); }}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors hover:opacity-70"
            style={{
              borderColor: selectedPersonaId ? 'var(--color-primary)' : 'var(--color-border)',
              color: selectedPersonaId ? 'var(--color-primary)' : 'var(--color-muted)',
              background: 'var(--color-surface)',
            }}
            title="Select persona"
          >
            {getIcon('user', { size: 12 })}
            {selectedPersonaId ? (personas.find(p => p.id === selectedPersonaId)?.name || 'Persona') : 'Persona'}
          </button>
          {showPersonaPicker && (
            <div
              className="absolute right-0 top-full mt-1 w-56 rounded-xl border shadow-lg py-1.5 z-40"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <button
                onClick={() => { setSelectedPersonaId(null); setShowPersonaPicker(false); }}
                className="w-full text-left px-3 py-2 text-xs hover:opacity-70 transition-opacity"
                style={{ color: selectedPersonaId === null ? 'var(--color-primary)' : 'var(--color-muted)' }}
              >
                {selectedPersonaId === null ? '✓ ' : ''}No persona
              </button>
              {personas.map(p => (
                <button
                  key={p.id}
                  onClick={() => { setSelectedPersonaId(p.id); setShowPersonaPicker(false); }}
                  className="w-full text-left px-3 py-2 flex items-start gap-2 hover:opacity-70 transition-opacity"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium" style={{ color: selectedPersonaId === p.id ? 'var(--color-primary)' : 'var(--color-text)' }}>
                      {selectedPersonaId === p.id ? '✓ ' : ''}{p.name}
                    </div>
                    {p.description && (
                      <div className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>{p.description}</div>
                    )}
                  </div>
                </button>
              ))}
              {personas.length === 0 && (
                <p className="text-xs px-3 py-2" style={{ color: 'var(--color-muted)' }}>No personas yet. Create some in Personas.</p>
              )}
            </div>
          )}
        </div>

        {/* Feeling button — project chats only, hidden on mobile */}
        {projectId && (
          <>
            <button
              onClick={() => setShowFeelingModal(true)}
              className="hidden sm:flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border transition-colors hover:opacity-70"
              style={{
                borderColor: projectDominant ? (EMOTION_COLOURS[projectDominant.coreEmotion] || 'var(--color-border)') : 'var(--color-border)',
                color: projectDominant ? (EMOTION_COLOURS[projectDominant.coreEmotion] || 'var(--color-muted)') : 'var(--color-muted)',
                background: 'var(--color-surface)',
              }}
              title="Log how you're feeling about this project"
            >
              {projectDominant ? (
                <>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: EMOTION_COLOURS[projectDominant.coreEmotion] || '#888' }} />
                  <span className="capitalize">{projectDominant.coreEmotion}</span>
                </>
              ) : (
                <>
                  {getIcon('smile', { size: 12 })}
                  Feeling
                </>
              )}
            </button>
            {showFeelingModal && (
              <CheckinModal
                entityType="project"
                entityId={projectId}
                entityTitle={project?.name || 'Project'}
                onClose={() => setShowFeelingModal(false)}
                onSave={() => {
                  setShowFeelingModal(false);
                  api.get(`/api/mood/dominant/project/${projectId}`)
                    .then(r => r.json())
                    .then(d => setProjectDominant(d.coreEmotion ? d : null))
                    .catch(() => {});
                }}
              />
            )}
          </>
        )}

        {/* Star — hidden on mobile */}
        {sessionId && (
          <button
            onClick={handleToggleStar}
            className="hidden sm:flex w-7 h-7 items-center justify-center rounded-lg transition-colors hover:opacity-70"
            style={{ color: isStarred ? '#f59e0b' : 'var(--color-muted)' }}
            title={isStarred ? 'Unstar chat' : 'Star chat'}
          >
            {getIcon('star', { size: 14 })}
          </button>
        )}

        {sessionId && messages.length >= 4 && !isSummarized && (
          <button
            onClick={handleSummarize}
            disabled={isSummarizing}
            className="hidden sm:flex w-7 h-7 items-center justify-center rounded-lg transition-colors hover:opacity-70"
            style={{ color: 'var(--color-primary)' }}
            title="Summarize this conversation"
          >
            {isSummarizing ? getIcon('loader', { size: 14 }) : getIcon('sparkles', { size: 14 })}
          </button>
        )}

        {sessionId && (
          <button
            onClick={() => downloadChatMd(messages, sessionTitle || sessionId, project?.name)}
            className="hidden sm:flex w-7 h-7 items-center justify-center rounded-lg transition-colors hover:opacity-70"
            style={{ color: 'var(--color-muted)' }}
            title="Save chat as Markdown"
          >
            {getIcon('file-down', { size: 14 })}
          </button>
        )}

        <div className="hidden sm:block"><ExportMenu sessionId={sessionId} projectId={projectId} /></div>

        {projectId && (
          <button
            onClick={() => setShowFilesPanel(v => !v)}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:opacity-70"
            style={{
              color: showFilesPanel ? 'var(--color-primary)' : 'var(--color-muted)',
              background: showFilesPanel ? 'var(--color-primary)15' : 'transparent',
            }}
            title="Project files"
          >
            {getIcon('files', { size: 14 })}
          </button>
        )}

        {sessionId && (
          <button
            onClick={() => setConfirmDeleteSession(true)}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:opacity-70"
            style={{ color: 'var(--color-muted)' }}
            title="Delete this chat"
          >
            {getIcon('trash', { size: 14 })}
          </button>
        )}
      </div>

      {/* Banners */}
      {confirmDeleteSession && (
        <div className="flex-shrink-0 mx-4 mt-3 px-4 py-3 rounded-xl border flex items-center gap-3" style={{ background: '#fff1f2', borderColor: '#fca5a5' }}>
          <span className="text-sm text-red-700 flex-1">Delete this chat? All messages will be permanently removed.</span>
          <button onClick={handleDeleteSession} className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-red-500">Delete</button>
          <button onClick={() => setConfirmDeleteSession(false)} className="text-xs" style={{ color: 'var(--color-muted)' }}>Cancel</button>
        </div>
      )}

      {isSummarized && (
        <div className="flex-shrink-0 mx-4 mt-3 px-4 py-2.5 rounded-xl border flex items-center gap-2.5 text-xs" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <span style={{ color: 'var(--color-primary)' }}>✦</span>
          <span className="flex-1" style={{ color: 'var(--color-text)' }}>Conversation summarized — Claude is working from the summary.</span>
          <button onClick={handleViewSummary} className="font-medium hover:opacity-70" style={{ color: 'var(--color-primary)' }}>{showSummaryPanel ? 'Hide' : 'View'}</button>
          <button onClick={() => totalContentSize > 150000 ? setConfirmRevert(true) : handleRevertSummary()} className="hover:opacity-70" style={{ color: 'var(--color-muted)' }}>Revert to full thread</button>
          {confirmRevert && (
            <ConfirmModal
              title="Revert to full thread"
              message="This is a very long conversation. Reverting may approach context limits."
              confirmLabel="Continue"
              onConfirm={() => { setConfirmRevert(false); handleRevertSummary(); }}
              onCancel={() => setConfirmRevert(false)}
            />
          )}
        </div>
      )}

      {isSummarized && showSummaryPanel && summaryText && (
        <div className="flex-shrink-0 mx-4 mt-2 px-4 py-3 rounded-xl border text-xs leading-relaxed max-h-48 overflow-y-auto" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', whiteSpace: 'pre-wrap' }}>
          {summaryText}
        </div>
      )}

      {/* Session budget banners */}
      {sessionBudget && shouldShowBudgetAlert && budgetPct >= budgetCriticalThreshold && (
        <div className="flex-shrink-0 mx-4 mt-3 px-4 py-2.5 rounded-xl border flex items-center gap-2.5 text-xs" style={{ background: '#fff1f2', borderColor: '#fca5a5', color: '#991b1b' }}>
          <span>💸</span>
          <span className="flex-1">Session budget reached ({formatCost(sessionCost)} of {formatCost(sessionBudget)}) — consider summarising this chat.</span>
          {messages.length >= 4 && !isSummarized && (
            <label className="flex items-center gap-1.5 cursor-pointer flex-shrink-0" style={{ color: '#991b1b' }}>
              <input
                type="checkbox"
                checked={saveSummaryToNote}
                onChange={e => setSaveSummaryToNote(e.target.checked)}
                className="cursor-pointer"
              />
              Save to Notes
            </label>
          )}
          {messages.length >= 4 && !isSummarized && (
            <button
              onClick={handleSummarize}
              disabled={isSummarizing}
              className="flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium text-white"
              style={{ background: '#ef4444' }}
            >
              {isSummarizing ? 'Summarising…' : 'Summarise now'}
            </button>
          )}
          <button onClick={dismissBudgetAlert} className="flex-shrink-0 hover:opacity-60 transition-opacity font-bold" style={{ color: '#991b1b' }} title="Dismiss">✕</button>
        </div>
      )}

      {sessionBudget && shouldShowBudgetAlert && budgetPct >= budgetAlertThreshold && budgetPct < budgetCriticalThreshold && (
        <div className="flex-shrink-0 mx-4 mt-3 px-4 py-2.5 rounded-xl border flex items-center gap-2.5 text-xs" style={{ background: '#fffbeb', borderColor: '#fde68a', color: '#78350f' }}>
          <span>⚠️</span>
          <span className="flex-1">You've used {Math.round(budgetPct)}% of your session budget ({formatCost(sessionCost)} of {formatCost(sessionBudget)}).</span>
          <button onClick={dismissBudgetAlert} className="flex-shrink-0 hover:opacity-60 transition-opacity font-bold" style={{ color: '#78350f' }} title="Dismiss">✕</button>
        </div>
      )}

      {/* Summary saved to Notes toast */}
      {summaryNoteSaved && (
        <div className="fixed bottom-20 right-6 z-50 px-4 py-2 rounded-xl shadow-lg text-sm font-medium text-white pointer-events-none" style={{ background: 'var(--color-primary)' }}>
          Summary saved to Notes ✓
        </div>
      )}

      {/* Main content area — flex row when artifact panel open */}
      <div className="flex flex-1 overflow-hidden">

        {/* Chat column */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

          {/* Context bar — shows files available to this chat */}
          {(pinnedFiles.length > 0 || sessionFiles.length > 0 || ragFallbackActive) && (
            <div
              className="flex-shrink-0 border-b px-4 py-1.5"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setShowContextBar(v => !v)}
                  className="text-xs font-medium flex items-center gap-1 hover:opacity-70 flex-shrink-0"
                  style={{ color: 'var(--color-muted)' }}
                >
                  {getIcon(showContextBar ? 'chevron-down' : 'chevron-right', { size: 11 })}
                  Files in context
                </button>
                {showContextBar && (
                  <>
                    {ragFallbackActive && (
                      <span
                        className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
                        style={{ borderColor: '#f59e0b', color: '#f59e0b', background: '#f59e0b11' }}
                        title="Embeddings unavailable — full file text is being injected instead of semantic chunks. Re-upload files to restore RAG context."
                      >
                        ⚠ RAG unavailable — full-text fallback active
                      </span>
                    )}
                    {pinnedFiles.map(f => (
                      <span
                        key={`pin-${f.id}`}
                        className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                        title="Pinned — available in all chats in this project"
                      >
                        📌 {f.name}
                      </span>
                    ))}
                    {sessionFiles.map(f => (
                      <span
                        key={`sess-${f.id}`}
                        className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
                        style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
                        title="Attached this session"
                      >
                        📎 {f.name}
                        <button
                          onClick={() => {
                            if (sessionId) api.delete(`/api/session-files/${sessionId}/${f.id}`).catch(() => {});
                            setSessionFiles(prev => prev.filter(x => x.id !== f.id));
                          }}
                          className="hover:opacity-60 ml-0.5"
                        >×</button>
                      </span>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Messages */}
          <SelectionToolbar projectId={projectId} sessionId={sessionId} contextRef={messageListRef} />
          <div ref={messageListRef} className="flex-1 overflow-y-auto">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full pb-16 px-6 text-center">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}>
                  {getIcon('chat', { size: 22 })}
                </div>
                <p className="text-base font-medium mb-1" style={{ color: 'var(--color-text)' }}>
                  {project ? `Chat with ${project.name}` : 'Start a conversation'}
                </p>
                <p className="text-sm max-w-xs" style={{ color: 'var(--color-muted)' }}>
                  {project ? 'Claude has full context of your project. Attach files, ask anything.' : 'Select a project from the sidebar to load context.'}
                </p>
              </div>
            ) : (
              <MemoMessageList
                messages={messages}
                isStreaming={isStreaming}
                isAiSearching={isAiSearching}
                sessionId={sessionId}
                suggestions={suggestions}
                onDelete={deleteMessagePair}
                onBranch={handleBranch}
                onOpenArtifact={handleOpenArtifact}
                onSuggestionSelect={stableSuggestionSelect}
                messagesEndRef={messagesEndRef}
                bookmarkedMap={bookmarkedMap}
                onToggleBookmark={handleToggleBookmark}
                isTTSAvailable={isTTSAvailable}
                isSpeaking={isSpeaking}
                isPaused={isPaused}
                speak={speak}
                pauseSpeaking={pauseSpeaking}
                resumeSpeaking={resumeSpeaking}
                stopSpeaking={stopSpeaking}
              />
            )}
          </div>

          {/* Context warning */}
          {contextWarning && (
            <div className="flex-shrink-0 mx-4 mb-2 px-4 py-2.5 rounded-xl flex items-center gap-2.5 text-xs" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#78350f' }}>
              {getIcon('alert-triangle', { size: 13 })}
              <span className="flex-1">This conversation is getting long ({messages.length} messages). Summarizing keeps Claude focused.</span>
              <button onClick={handleSummarize} disabled={isSummarizing} className="px-2.5 py-1 rounded-lg text-xs font-medium text-white flex-shrink-0" style={{ background: '#d97706' }}>
                {isSummarizing ? 'Summarizing…' : 'Summarize'}
              </button>
            </div>
          )}

          {/* Error banner — stream errors and pre-send preflight errors */}
          {(streamError || preflightError) && (() => {
            const err = streamError || preflightError;
            const isRed = err.code === 'auth' || err.code === 'model' || err.code === 'billing';
            const isOrange = err.code === 'billing';
            const bg = isOrange ? '#fff7ed' : isRed ? '#fff1f2' : '#fffbeb';
            const border = isOrange ? '#fed7aa' : isRed ? '#fca5a5' : '#fde68a';
            const color = isOrange ? '#9a3412' : isRed ? '#991b1b' : '#78350f';
            const icon = err.code === 'auth' ? '🔑' : err.code === 'billing' ? '💳' : err.code === 'model' ? '🤖' : err.code === 'rate_limit' ? '⏳' : '⚠️';
            return (
              <div
                className="flex-shrink-0 mx-4 mb-2 px-4 py-3 rounded-xl border flex items-start gap-3 text-xs"
                style={{ background: bg, borderColor: border, color }}
              >
                <span className="text-sm leading-none mt-0.5 flex-shrink-0">{icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{err.message}</p>
                  {err.hint && <p className="mt-0.5 opacity-80">{err.hint}</p>}
                </div>
                <button
                  onClick={() => { clearStreamError(); setPreflightError(null); }}
                  className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity leading-none"
                  style={{ color: 'inherit' }}
                  title="Dismiss"
                >
                  {getIcon('x', { size: 12 })}
                </button>
              </div>
            );
          })()}

          {/* Input area */}
          <div className="flex-shrink-0 px-4 pb-safe pt-1">
            <div className="max-w-3xl mx-auto">
              <div className="relative">

                {/* File picker */}
                {showFilePicker && (
                  <ChatFilePicker
                    projectId={projectId}
                    attachedIds={attachments.map(a => a.id)}
                    onUpload={(file) => { uploadAndAttach(file); setShowFilePicker(false); }}
                    onAttachExisting={(file) => { attachExisting(file); setShowFilePicker(false); }}
                    onClose={() => setShowFilePicker(false)}
                  />
                )}

                {/* URL input popover */}
                {showUrlInput && (
                  <div
                    className="absolute bottom-full mb-2 left-0 right-0 sm:right-auto z-50 flex items-center gap-2 px-3 py-2 rounded-xl border shadow-lg"
                    style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minWidth: '320px' }}
                  >
                    {getIcon('link', { size: 14, color: 'var(--color-primary)' })}
                    <input
                      autoFocus
                      type="url"
                      value={urlInputValue}
                      onChange={e => setUrlInputValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); if (urlInputValue.trim()) { addUrl(urlInputValue.trim()); setUrlInputValue(''); setShowUrlInput(false); } }
                        if (e.key === 'Escape') { setShowUrlInput(false); setUrlInputValue(''); }
                      }}
                      placeholder="Paste a URL and press Enter…"
                      className="flex-1 bg-transparent outline-none text-sm"
                      style={{ color: 'var(--color-text)' }}
                    />
                    {urlInputValue && (
                      <button type="button" onClick={() => { addUrl(urlInputValue.trim()); setUrlInputValue(''); setShowUrlInput(false); }} className="text-xs font-medium px-2 py-1 rounded-lg" style={{ background: 'var(--color-primary)', color: '#fff' }}>Add</button>
                    )}
                  </div>
                )}

                {/* Web search input */}
                {showSearchInput && (
                  <div
                    className="absolute bottom-full mb-2 left-0 right-0 sm:right-auto z-50 rounded-xl border shadow-lg overflow-hidden"
                    style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minWidth: '340px', maxWidth: '480px' }}
                  >
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      {getIcon('search', { size: 14, color: 'var(--color-primary)' })}
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
                        <button
                          type="button"
                          onClick={handleSearchDone}
                          className="text-xs font-medium px-2.5 py-1 rounded-lg flex-shrink-0"
                          style={{ background: 'var(--color-primary)', color: '#fff' }}
                        >
                          Done
                        </button>
                      ) : searchQuery.trim() ? (
                        <button
                          type="button"
                          onClick={handleSearch}
                          className="text-xs font-medium px-2.5 py-1 rounded-lg flex-shrink-0"
                          style={{ background: 'var(--color-primary)', color: '#fff' }}
                        >
                          Search
                        </button>
                      ) : null}
                    </div>
                    {searchError && (
                      <p className="px-3 pb-2.5 text-xs" style={{ color: '#ef4444' }}>{searchError}</p>
                    )}
                    {searchResults.length > 0 ? (
                      <div className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                        {searchResults.map((r, i) => (
                          <div key={i} className="px-3 py-2 border-b last:border-b-0 text-xs" style={{ borderColor: 'var(--color-border)' }}>
                            <p className="font-medium truncate" style={{ color: 'var(--color-text)' }}>{r.title || r.url}</p>
                            {r.snippet && <p className="mt-0.5 line-clamp-2" style={{ color: 'var(--color-muted)' }}>{r.snippet}</p>}
                            <a href={r.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 truncate block opacity-60 hover:opacity-100 hover:underline" style={{ color: 'var(--color-primary)' }}>{r.url}</a>
                          </div>
                        ))}
                        <p className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                          {searchResults.length} page{searchResults.length !== 1 ? 's' : ''} added to context · press Done or Enter
                        </p>
                      </div>
                    ) : (
                      <p className="px-3 pb-2.5 text-xs" style={{ color: 'var(--color-muted)' }}>
                        Top 3 results will be fetched and attached as context · Esc to cancel
                      </p>
                    )}
                  </div>
                )}

                {/* Gmail search */}
                {showGmailSearch && (
                  <div className="fixed inset-0 z-40" onClick={() => { setShowGmailSearch(false); setGmailQuery(''); setGmailResults([]); setGmailAttached([]); setGmailTranslatedQuery(''); }} />
                )}
                {showGmailSearch && (
                  <div
                    className="absolute bottom-full mb-2 left-0 right-0 sm:right-auto z-50 rounded-xl border shadow-lg overflow-hidden"
                    style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minWidth: '340px', maxWidth: '520px' }}
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
                    {gmailError && (
                      <p className="px-3 pb-2.5 text-xs" style={{ color: '#ef4444' }}>{gmailError}</p>
                    )}
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
                                  : <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-primary)' }}>Attach</span>
                                }
                              </div>
                              <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-muted)' }}>{r.from} · {r.date ? new Date(r.date).toLocaleDateString() : ''}</p>
                              {r.snippet && <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--color-muted)' }}>{r.snippet}</p>}
                            </button>
                          );
                        })}
                        {gmailAttached.length > 0 && (
                          <p className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                            {gmailAttached.length} thread{gmailAttached.length !== 1 ? 's' : ''} added to context · press Done or Enter
                          </p>
                        )}
                      </div>
                    ) : !gmailError && (
                      <p className="px-3 pb-2.5 text-xs" style={{ color: 'var(--color-muted)' }}>
                        Search your inbox and attach emails as context · Esc to cancel
                      </p>
                    )}
                  </div>
                )}

                {/* Calendar search */}
                {showCalendarSearch && (
                  <div className="fixed inset-0 z-40" onClick={() => { setShowCalendarSearch(false); setCalendarQuery(''); setCalendarResults([]); setCalendarAttached([]); }} />
                )}
                {showCalendarSearch && (
                  <div
                    className="absolute bottom-full mb-2 left-0 right-0 sm:right-auto z-50 rounded-xl border shadow-lg overflow-hidden"
                    style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minWidth: '340px', maxWidth: '520px' }}
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
                    {calendarError && (
                      <p className="px-3 pb-2.5 text-xs" style={{ color: '#ef4444' }}>{calendarError}</p>
                    )}
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
                                  : <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-primary)' }}>Attach</span>
                                }
                              </div>
                              {startLabel && <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{startLabel}{event.location ? ` · ${event.location}` : ''}</p>}
                            </button>
                          );
                        })}
                        {calendarAttached.length > 0 && (
                          <p className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                            {calendarAttached.length} event{calendarAttached.length !== 1 ? 's' : ''} added to context · press Done or Enter
                          </p>
                        )}
                      </div>
                    ) : !calendarError && (
                      <p className="px-3 pb-2.5 text-xs" style={{ color: 'var(--color-muted)' }}>
                        Search your calendar and attach events as context · Esc to cancel
                      </p>
                    )}
                  </div>
                )}

                {/* Prompt picker */}
                {showPromptPicker && (
                  <div className="fixed inset-0 z-40" onClick={() => { setShowPromptPicker(false); setPromptSearch(''); }} />
                )}
                {showPromptPicker && (
                  <div
                    className="absolute bottom-full mb-2 left-0 z-50 rounded-xl border shadow-lg overflow-hidden"
                    style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', width: '340px', maxHeight: '300px' }}
                  >
                    <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
                      <input
                        autoFocus
                        value={promptSearch}
                        onChange={e => setPromptSearch(e.target.value)}
                        placeholder="Search prompts…"
                        className="w-full bg-transparent outline-none text-xs"
                        style={{ color: 'var(--color-text)' }}
                      />
                    </div>
                    <div className="overflow-y-auto" style={{ maxHeight: '240px' }}>
                      {filteredPrompts.length === 0 ? (
                        <p className="text-xs px-3 py-4 text-center" style={{ color: 'var(--color-muted)' }}>
                          {prompts.length === 0 ? 'No saved prompts. Add some in the Prompt Library.' : 'No matches.'}
                        </p>
                      ) : filteredPrompts.map(p => (
                        <button
                          key={p.id}
                          onClick={() => { setShowPromptPicker(false); setPromptSearch(''); resolvePrompt(p.content, (filled) => { setInput(filled); textareaRef.current?.focus(); }); }}
                          className="w-full text-left px-3 py-2.5 hover:opacity-70 transition-opacity border-b last:border-0"
                          style={{ borderColor: 'var(--color-border)' }}
                        >
                          <div className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{p.title}</div>
                          <div className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>{p.content}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Mention dropdown */}
                {showMention && (
                  <div className="absolute bottom-full mb-2 left-0 w-56 z-50">
                    <AtMentionDropdown query={mentionQuery} onSelect={handleMentionSelect} onSearch={handleOpenSearch} onGmailSearch={handleOpenGmailSearch} onCalendarSearch={handleOpenCalendarSearch} onPromptSelect={handlePromptMentionSelect} onClose={() => setShowMention(false)} />
                  </div>
                )}

                {/* Input box */}
                <div className="rounded-2xl border shadow-sm" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                  <ChatFileBar attachments={attachments} onRemove={removeAttachment} />
                  <UrlBar urlAttachments={urlAttachments} onRemove={removeUrl} />

                  {inlineImages.length > 0 && (
                    <div className="flex flex-wrap gap-2 px-3 pt-2">
                      {inlineImages.map(img => (
                        <div key={img.id} className="relative">
                          <img
                            src={img.preview}
                            alt="pasted"
                            className="w-16 h-16 object-cover rounded-lg border"
                            style={{ borderColor: 'var(--color-border)' }}
                          />
                          <button
                            onClick={() => setInlineImages(prev => prev.filter(i => i.id !== img.id))}
                            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center text-white text-xs font-bold"
                            style={{ background: 'var(--color-muted)', lineHeight: 1 }}
                            title="Remove image"
                          >×</button>
                        </div>
                      ))}
                    </div>
                  )}

                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder={
                      urlAttachments.length > 0
                        ? 'What would you like to know about this page?'
                        : attachments.length > 0
                        ? `What would you like to do with ${attachments.length === 1 ? 'this file' : 'these files'}?`
                        : project ? `Message ${project.name}…` : 'Message…'
                    }
                    rows={1}
                    className="w-full px-4 pt-3.5 pb-12 bg-transparent outline-none resize-none text-sm leading-relaxed"
                    style={{ color: 'var(--color-text)', minHeight: '56px' }}
                  />

                  <div className="flex items-center justify-between px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      {/* File picker */}
                      <button
                        onClick={() => { setShowFilePicker(v => !v); setShowUrlInput(false); setShowPromptPicker(false); }}
                        className="relative w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
                        style={{ color: showFilePicker || attachments.length > 0 ? 'var(--color-primary)' : 'var(--color-muted)', background: showFilePicker ? 'var(--color-bg)' : 'transparent' }}
                        title="Attach file"
                      >
                        {uploading ? getIcon('loader', { size: 14 }) : getIcon('upload', { size: 14 })}
                        {attachments.length > 0 && (
                          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full text-white flex items-center justify-center font-medium" style={{ background: 'var(--color-primary)', fontSize: '9px', lineHeight: 1 }}>
                            {attachments.length}
                          </span>
                        )}
                      </button>

                      {/* URL attachment */}
                      <button
                        type="button"
                        onClick={() => { setShowUrlInput(v => !v); setShowFilePicker(false); setShowPromptPicker(false); }}
                        className="relative w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
                        style={{ color: showUrlInput || urlAttachments.length > 0 ? 'var(--color-primary)' : 'var(--color-muted)', background: showUrlInput ? 'var(--color-bg)' : 'transparent' }}
                        title="Attach a web page"
                      >
                        {getIcon('link', { size: 14 })}
                        {urlAttachments.length > 0 && (
                          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full text-white flex items-center justify-center font-medium" style={{ background: 'var(--color-primary)', fontSize: '9px', lineHeight: 1 }}>
                            {urlAttachments.length}
                          </span>
                        )}
                      </button>

                      {/* Prompt library */}
                      <button
                        type="button"
                        onClick={() => { setShowPromptPicker(v => !v); if (!showPromptPicker) loadPrompts(); setShowFilePicker(false); setShowUrlInput(false); }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
                        style={{ color: showPromptPicker ? 'var(--color-primary)' : 'var(--color-muted)', background: showPromptPicker ? 'var(--color-bg)' : 'transparent' }}
                        title="Prompt library"
                      >
                        {getIcon('book', { size: 14 })}
                      </button>

                      {isSTTAvailable && (
                        <>
                          {/* Mic — starts recording; pulsing red dot while active */}
                          <button
                            onClick={startListening}
                            disabled={isListening}
                            className="w-7 h-7 flex items-center justify-center rounded-lg transition-all relative"
                            style={{
                              color: isListening ? '#ef4444' : 'var(--color-muted)',
                              background: 'transparent',
                              opacity: isListening ? 1 : undefined,
                            }}
                            title="Voice input"
                          >
                            {getIcon('mic', { size: 14 })}
                            {isListening && (
                              <span
                                className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full animate-pulse"
                                style={{ background: '#ef4444' }}
                              />
                            )}
                          </button>

                          {/* Live transcript preview + Stop button */}
                          {isListening && (
                            <>
                              <span
                                className="text-xs max-w-[120px] truncate"
                                style={{ color: '#ef4444' }}
                              >
                                {interimText || 'Listening…'}
                              </span>
                              <button
                                onClick={stopListening}
                                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all"
                                style={{
                                  background: '#ef4444',
                                  color: '#fff',
                                  border: 'none',
                                  cursor: 'pointer',
                                }}
                                title="Stop recording"
                              >
                                {getIcon('square', { size: 10 })}
                                Stop
                              </button>
                            </>
                          )}
                        </>
                      )}


                      {attachError && <span className="text-xs ml-1" style={{ color: '#ef4444' }}>{attachError}</span>}
                    </div>

                    <button
                      type="button"
                      onClick={isStreaming ? stopStreaming : () => checkModelBeforeSend()}
                      disabled={!isStreaming && !hasInput}
                      className="w-8 h-8 flex items-center justify-center rounded-xl transition-all"
                      style={{
                        background: isStreaming ? '#fee2e2' : hasInput ? 'var(--color-primary)' : 'var(--color-border)',
                        color: isStreaming ? '#ef4444' : hasInput ? '#fff' : 'var(--color-muted)',
                      }}
                      title={isStreaming ? 'Stop' : 'Send'}
                    >
                      {isStreaming ? getIcon('stop-circle', { size: 16 }) : getIcon('send', { size: 15 })}
                    </button>
                  </div>
                </div>
              </div>

              <p className="hidden sm:block text-center text-xs mt-2" style={{ color: 'var(--color-muted)', opacity: 0.5 }}>
                Shift+Enter or Ctrl+Enter to send · Enter for new line · @ mention · ⌘/ shortcuts
              </p>
            </div>
          </div>
        </div>

        {/* Artifact panel — fullscreen overlay on mobile, side panel on desktop */}
        {activeArtifacts && (
          <div className="fixed inset-0 z-30 sm:static sm:inset-auto sm:z-auto sm:flex sm:h-full">
            <ArtifactPanel
              artifacts={activeArtifacts.artifacts}
              initialIndex={activeArtifacts.initialIndex}
              onClose={() => setActiveArtifacts(null)}
            />
          </div>
        )}

        {/* Project files panel — fullscreen overlay on mobile, side panel on desktop */}
        {showFilesPanel && projectId && (
          <div className="fixed inset-0 z-30 sm:static sm:inset-auto sm:z-auto">
            <ProjectFilesPanel
              projectId={projectId}
              onClose={() => setShowFilesPanel(false)}
              onAttach={(file) => {
                attachExisting(file);
                const sid = sessionId;
                if (sid) api.post(`/api/session-files/${sid}`, { fileId: file.id }).catch(() => {});
                setSessionFiles(prev => prev.some(f => f.id === file.id) ? prev : [...prev, { id: file.id, name: file.name }]);
                setShowFilesPanel(false);
              }}
              onAttachUrl={(attachment) => {
                addManualAttachment(attachment);
                setShowFilesPanel(false);
              }}
              sessionFileIds={sessionFiles.map(f => f.id)}
            />
          </div>
        )}
      </div>

      {/* Prompt variable fill-in modal */}
      {promptVarModal && (
        <PromptVariableModal
          content={promptVarModal.content}
          onInsert={(filled) => { promptVarModal.onInsert(filled); setPromptVarModal(null); }}
          onClose={() => setPromptVarModal(null)}
        />
      )}

      {/* Smart Model Advisor modal */}
      <ModelAdvisorModal
        isOpen={advisorOpen}
        currentModelName={MODELS.find(m => m.id === effectiveModel)?.name || effectiveModel}
        reason={advisorData?.reason || ''}
        needsImage={advisorData?.needsImage || false}
        suggestedModels={advisorData?.suggestedModels || []}
        onSwitch={(id) => { setAdvisorOpen(false); setChatModel(id); setAdvisorPendingSwitch(id); }}
        onConfirm={() => { setAdvisorOpen(false); setPendingSendPayload(null); handleSend(); }}
        onDismiss={() => { setAdvisorOpen(false); setPendingSendPayload(null); }}
      />
    </div>
  );
}

export default ChatPage;
