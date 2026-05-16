import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import MessageBubble from '../components/MessageBubble';
import StudentDeckPanel from '../components/StudentDeckPanel';
import EmailModal from '../components/EmailModal';
import { useChat } from '../hooks/useChat';
import { useModels } from '../hooks/useModels';
import { useVoice } from '../hooks/useVoice';
import useAuthStore from '../store/authStore';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import ExportMenu from '../components/ExportMenu';
import useToastStore from '../store/toastStore';
import { extractLatestVaultDeck, extractLatestVaultChoices, stripVaultMachineBlocks } from '../utils/studyDeckParse';

const TEMPERATURES = [
  { label: 'Precise', value: 0.2 },
  { label: 'Balanced', value: 0.7 },
  { label: 'Creative', value: 1.0 },
];

const FAMILIARITY = [
  { id: 'beginner', label: 'Beginner' },
  { id: 'some', label: 'Some background' },
  { id: 'confident', label: 'Fairly confident' },
  { id: 'review', label: 'Quick review' },
];

const GOALS = [
  { id: 'flashcards', label: 'Flashcards' },
  { id: 'slides', label: 'Slide deck' },
  { id: 'both', label: 'Both' },
  { id: 'unsure', label: 'Not sure yet' },
];

const INITIAL_SETUP = {
  source: null,
  detail: '',
  familiarity: null,
  goal: null,
  count: '',
};

function famLabel(id) {
  return FAMILIARITY.find((f) => f.id === id)?.label || id;
}

function goalLabel(id) {
  return GOALS.find((g) => g.id === id)?.label || id;
}

function parseRequestedFlashcardCount(setup) {
  const c = (setup.count || '').trim().toLowerCase();
  if (!c || c.includes('decide')) return null;
  const m = c.match(/(\d+)\s*(?:flash)?cards?/i) || c.match(/\b(\d+)\s*x\b/i) || c.match(/^\s*(\d+)\s*$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(100, n);
}

function buildStudyBootstrap(setup, deckTitle) {
  const src = setup.source === 'topic' ? 'TOPIC' : setup.source === 'document' ? 'DOCUMENT' : '';
  const heading = setup.source === 'topic' ? 'Topic / focus' : 'Document (pasted below)';
  const countLine = (setup.count && setup.count.trim()) ? setup.count.trim() : 'you decide';
  const titleBlock = (deckTitle && deckTitle.trim()) ? `Deck title: ${deckTitle.trim()}\n\n` : '';
  const nCards = parseRequestedFlashcardCount(setup);
  const exactFlash = (setup.goal === 'flashcards' || setup.goal === 'both') && nCards
    ? `\n\nImportant: I want exactly ${nCards} flashcards. Put all ${nCards} in one \`vault-deck\` JSON snapshot (flashcards array length = ${nCards}) in your first substantive reply that includes cards. If you truly cannot, say why and give the closest you can.`
    : '';
  return `${titleBlock}I've completed the setup cards. Use my answers below — do not repeat onboarding questions I already answered; continue from the appropriate point in your flow.

1. Source: ${src}
2. ${heading}:
${setup.detail.trim()}

3. Familiarity: ${famLabel(setup.familiarity)}
4. Today I want: ${goalLabel(setup.goal)}
5. Target size: ${countLine}
${exactFlash}

Please acknowledge briefly and proceed.`;
}

function truncateText(s, max) {
  const t = (s || '').trim();
  if (!t) return '';
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function buildSetupSummaryItems(setup, { includeCountIfEmpty = false } = {}) {
  const items = [];
  if (setup.source) {
    items.push({
      key: 'source',
      q: 'Working from',
      a: setup.source === 'topic' ? 'A topic to explore' : 'A document (pasted text)',
    });
  }
  const d = (setup.detail || '').trim();
  if (d) {
    items.push({
      key: 'detail',
      q: setup.source === 'topic' ? 'Topic / content' : 'Document',
      a: truncateText(d, 220),
    });
  }
  if (setup.familiarity) {
    items.push({ key: 'familiarity', q: 'Familiarity', a: famLabel(setup.familiarity) });
  }
  if (setup.goal) {
    items.push({ key: 'goal', q: 'Output', a: goalLabel(setup.goal) });
  }
  const c = (setup.count || '').trim();
  if (c || includeCountIfEmpty) {
    items.push({ key: 'count', q: 'Target size', a: c || 'Assistant decides' });
  }
  return items;
}

/** Answers the user has already committed by advancing past each step (wizard). */
function wizardProgressItems(setup, setupStep) {
  const items = [];
  if (setupStep >= 1 && setup.source) {
    items.push({ key: 'source', q: 'Working from', a: setup.source === 'topic' ? 'Topic' : 'Document' });
  }
  if (setupStep >= 2 && (setup.detail || '').trim()) {
    items.push({
      key: 'detail',
      q: setup.source === 'topic' ? 'Topic / content' : 'Document',
      a: truncateText(setup.detail, 140),
    });
  }
  if (setupStep >= 3 && setup.familiarity) {
    items.push({ key: 'familiarity', q: 'Familiarity', a: famLabel(setup.familiarity) });
  }
  if (setupStep >= 4 && setup.goal) {
    items.push({ key: 'goal', q: 'Output', a: goalLabel(setup.goal) });
  }
  if (setupStep >= 4 && (setup.count || '').trim()) {
    items.push({ key: 'count', q: 'Target size', a: truncateText(setup.count, 100) });
  }
  return items;
}

function SetupSummaryStrip({ items }) {
  if (!items.length) return null;
  return (
    <div className="w-full overflow-x-auto pb-1">
      <div className="flex gap-2 min-w-min py-1">
        {items.map((row) => (
          <div
            key={row.key}
            className="rounded-xl border px-3 py-2.5 flex-shrink-0 min-w-[108px] max-w-[260px] shadow-sm"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wide leading-tight" style={{ color: 'var(--color-muted)' }}>{row.q}</div>
            <div className="text-xs mt-1.5 whitespace-pre-wrap break-words leading-snug" style={{ color: 'var(--color-text)' }}>{row.a}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function choiceCardStyle(active) {
  return {
    borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
    color: active ? 'var(--color-primary)' : 'var(--color-text)',
    background: active ? 'var(--color-bg)' : 'var(--color-surface)',
  };
}

export default function StudentCardsChatPage() {
  const { user } = useAuthStore();
  const isAdmin = !!user?.isAdmin;
  const getIcon = useIcon();
  const { models: MODELS, defaultModel } = useModels();
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canSelectModel = isAdmin || featureAccess.memberModelSelection !== false;
  const canUseStudent = isAdmin || featureAccess.student !== false;

  const {
    messages, isStreaming, sessionId, sessionUsage, sendMessage, stopStreaming, clearMessages, loadHistory, streamError, clearStreamError,
  } = useChat({
    projectId: null,
    studentCards: true,
  });

  const { isSTTAvailable, isTTSAvailable, isListening, transcript, interimText, startListening, stopListening, speak, pauseSpeaking, resumeSpeaking, stopSpeaking, isSpeaking, isPaused } = useVoice();

  const [phase, setPhase] = useState('setup');
  const [setupStep, setSetupStep] = useState(0);
  const [setup, setSetup] = useState(() => ({ ...INITIAL_SETUP }));
  const [savedSetup, setSavedSetup] = useState(null);
  const [deckTitle, setDeckTitle] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [pageTab, setPageTab] = useState('session');
  const [libraryRows, setLibraryRows] = useState([]);
  const [libraryLoad, setLibraryLoad] = useState(false);
  const [libraryDetail, setLibraryDetail] = useState(null);
  const [savedDeckId, setSavedDeckId] = useState(null);
  const [showDeckEmail, setShowDeckEmail] = useState(false);
  const [deckEmailTargetId, setDeckEmailTargetId] = useState(null);
  const [deckEmailSubjectHint, setDeckEmailSubjectHint] = useState('');
  const [deckSaveBusy, setDeckSaveBusy] = useState(false);
  const sessionBootRef = useRef(false);

  const [input, setInput] = useState('');
  const [chatModel, setChatModel] = useState(null);
  const [temperature, setTemperature] = useState(0.7);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showTempPicker, setShowTempPicker] = useState(false);
  const [wideCards, setWideCards] = useState(() => {
    try { return localStorage.getItem('studentCardsWide') === 'true'; } catch { return false; }
  });

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const detailTextareaRef = useRef(null);
  const countTextareaRef = useRef(null);

  const effectiveModel = chatModel || defaultModel || MODELS[0]?.id;
  const msgWidthClass = wideCards ? 'max-w-[80%] mx-auto' : 'max-w-3xl mx-auto';

  const toggleWideCards = () => setWideCards((v) => {
    try { localStorage.setItem('studentCardsWide', String(!v)); } catch { /* ignore */ }
    return !v;
  });

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((data) => {
        if (data?.flags && typeof data.flags === 'object') {
          setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...data.flags });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const sid = searchParams.get('session');
    if (!sid || sessionBootRef.current) return;
    sessionBootRef.current = true;
    loadHistory(sid)
      .then(() => { setPhase('chat'); })
      .catch(() => {});
  }, [searchParams, loadHistory]);

  const parsedDeck = useMemo(() => extractLatestVaultDeck(messages), [messages]);
  const deckHasPersistableContent = useMemo(() => {
    if (!parsedDeck || typeof parsedDeck !== 'object') return false;
    const fc = Array.isArray(parsedDeck.flashcards) ? parsedDeck.flashcards.length : 0;
    const sl = Array.isArray(parsedDeck.slides) ? parsedDeck.slides.length : 0;
    const qz = Array.isArray(parsedDeck.quiz) ? parsedDeck.quiz.length : 0;
    return fc + sl + qz > 0;
  }, [parsedDeck]);
  const choicePrompt = useMemo(() => {
    if (isStreaming) return null;
    return extractLatestVaultChoices(messages);
  }, [messages, isStreaming]);

  const displayMessages = useMemo(() => messages.map((m) => {
    if (m.role !== 'assistant' || !m.content) return m;
    const stripped = stripVaultMachineBlocks(m.content);
    if (stripped === m.content) return m;
    return { ...m, content: stripped };
  }), [messages]);

  const refreshLibrary = useCallback(async () => {
    setLibraryLoad(true);
    try {
      const res = await api.get('/api/study-decks');
      const data = await res.json();
      setLibraryRows(Array.isArray(data) ? data : []);
    } catch {
      setLibraryRows([]);
    } finally {
      setLibraryLoad(false);
    }
  }, []);

  const clearDeckSearchParam = useCallback(() => {
    setSearchParams((prev) => {
      const n = new URLSearchParams(prev);
      if (!n.has('deck')) return prev;
      n.delete('deck');
      return n;
    }, { replace: true });
  }, [setSearchParams]);

  const dismissLibraryDetail = useCallback(() => {
    setLibraryDetail(null);
    clearDeckSearchParam();
  }, [clearDeckSearchParam]);

  const deckSearchId = searchParams.get('deck');

  useEffect(() => {
    if (!deckSearchId) return;
    const id = Number(deckSearchId);
    if (!Number.isFinite(id) || id <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/api/study-decks/${id}`);
        if (!res.ok) return;
        const d = await res.json();
        if (cancelled || !d?.id) return;
        setPageTab('library');
        setLibraryDetail(d);
        refreshLibrary();
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [deckSearchId, refreshLibrary]);

  useEffect(() => {
    if (pageTab === 'library') refreshLibrary();
  }, [pageTab, refreshLibrary]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  useEffect(() => {
    if (!transcript) return;
    if (phase === 'chat') {
      setInput((prev) => (prev.trimEnd() ? `${prev.trimEnd()} ${transcript.trim()}` : transcript.trim()));
      return;
    }
    if (setupStep === 1) {
      setSetup((s) => ({
        ...s,
        detail: s.detail.trimEnd() ? `${s.detail.trimEnd()} ${transcript.trim()}` : transcript.trim(),
      }));
    } else if (setupStep === 4) {
      setSetup((s) => ({
        ...s,
        count: s.count.trimEnd() ? `${s.count.trimEnd()} ${transcript.trim()}` : transcript.trim(),
      }));
    }
  }, [transcript, phase, setupStep]);

  const resetWizard = useCallback(() => {
    setPhase('setup');
    setSetupStep(0);
    setSetup({ ...INITIAL_SETUP });
    setSavedSetup(null);
    setDeckTitle('');
    setSavedDeckId(null);
  }, []);

  const handleEditSetup = useCallback(() => {
    if (isListening) stopListening();
    stopSpeaking();
    if (savedSetup) setSetup({ ...savedSetup });
    setPhase('setup');
    setSetupStep(0);
  }, [savedSetup, isListening, stopListening, stopSpeaking]);

  const handleNewSession = useCallback(() => {
    sessionBootRef.current = false;
    setSearchParams({});
    clearMessages();
    clearStreamError();
    resetWizard();
  }, [clearMessages, clearStreamError, resetWizard, setSearchParams]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming || phase !== 'chat') return;
    setInput('');
    await sendMessage(text, [], [], effectiveModel, [], temperature, null, false, [], false);
  }, [input, isStreaming, phase, sendMessage, effectiveModel, temperature]);

  const handleChoice = useCallback(async (opt) => {
    const label = opt.label || opt.id;
    if (!label || isStreaming || phase !== 'chat') return;
    await sendMessage(`My selection: ${label}`, [], [], effectiveModel, [], temperature, null, false, [], false);
  }, [isStreaming, phase, sendMessage, effectiveModel, temperature]);

  const handleDeckSaved = useCallback((row) => {
    if (row?.id) setSavedDeckId(row.id);
    refreshLibrary();
  }, [refreshLibrary]);

  const handleLibraryDeckSaved = useCallback((row) => {
    if (row?.id) {
      setLibraryDetail((d) => (d && Number(d.id) === Number(row.id) ? { ...d, ...row } : d));
    }
    refreshLibrary();
  }, [refreshLibrary]);

  const handlePersistDeck = useCallback(async () => {
    if (!parsedDeck || !deckHasPersistableContent || deckSaveBusy || phase !== 'chat') return;
    setDeckSaveBusy(true);
    try {
      const title = (deckTitle || '').trim() || 'Study deck';
      const kind = parsedDeck.kind || 'mixed';
      const body = { title, kind, payload: parsedDeck };
      if (sessionId) body.sessionId = sessionId;
      const res = savedDeckId
        ? await api.patch(`/api/study-decks/${savedDeckId}`, body)
        : await api.post('/api/study-decks', body);
      if (!res.ok) {
        useToastStore.getState().addToast('Could not save deck', 'error');
        return;
      }
      const data = await res.json();
      if (data?.id) handleDeckSaved(data);
      useToastStore.getState().addToast(savedDeckId ? 'Deck updated' : 'Deck saved');
    } catch {
      useToastStore.getState().addToast('Could not save deck', 'error');
    } finally {
      setDeckSaveBusy(false);
    }
  }, [parsedDeck, deckHasPersistableContent, deckSaveBusy, phase, deckTitle, sessionId, savedDeckId, handleDeckSaved]);

  const canAdvanceFromStep = useCallback(() => {
    if (setupStep === 0) return !!setup.source;
    if (setupStep === 1) return setup.detail.trim().length > 0;
    if (setupStep === 2) return !!setup.familiarity;
    if (setupStep === 3) return !!setup.goal;
    return true;
  }, [setupStep, setup]);

  const handleBeginStudySession = useCallback(async () => {
    if (!setup.source || !setup.detail.trim() || !setup.familiarity || !setup.goal || isStreaming) return;
    setSavedSetup({ ...setup });
    setSavedDeckId(null);
    const text = buildStudyBootstrap(setup, deckTitle);
    setPhase('chat');
    await sendMessage(text, [], [], effectiveModel, [], temperature, null, false, [], false);
  }, [setup, deckTitle, isStreaming, sendMessage, effectiveModel, temperature]);

  if (!canUseStudent) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 py-12" style={{ background: 'var(--color-bg)' }}>
        <p className="text-sm text-center max-w-sm" style={{ color: 'var(--color-muted)' }}>
          Student (Cards) is turned off for member accounts in this workspace. Ask an admin to enable it under Settings → Feature Access.
        </p>
      </div>
    );
  }

  const renderSetupMic = () => {
    if (!isSTTAvailable || (setupStep !== 1 && setupStep !== 4)) return null;
    return (
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <button
          type="button"
          onClick={startListening}
          disabled={isListening}
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-all relative"
          style={{ color: isListening ? '#ef4444' : 'var(--color-muted)', background: 'var(--color-bg)' }}
          title="Voice input"
        >
          {getIcon('mic', { size: 16 })}
          {isListening && (
            <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full animate-pulse" style={{ background: '#ef4444' }} />
          )}
        </button>
        {isListening && (
          <>
            <span className="text-xs max-w-[200px] truncate" style={{ color: '#ef4444' }}>{interimText || 'Listening…'}</span>
            <button
              type="button"
              onClick={stopListening}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-white"
              style={{ background: '#ef4444' }}
            >
              {getIcon('square', { size: 10, color: '#fff' })}
              Stop
            </button>
          </>
        )}
      </div>
    );
  };

  const setupCard = (
    <div className="max-w-2xl w-full mx-auto px-4 py-6 space-y-4">
      <div
        className="rounded-2xl border p-4 shadow-sm"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
          Deck title (optional)
        </label>
        <input
          type="text"
          value={deckTitle}
          onChange={(e) => setDeckTitle(e.target.value)}
          placeholder="Name this set of cards…"
          className="w-full text-sm px-3 py-2 rounded-xl border outline-none"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
        />
      </div>

      <div
        className="rounded-2xl border p-5 shadow-sm"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-muted)' }}>
          Setup · Step {setupStep + 1} of 5
        </p>

        <SetupSummaryStrip items={wizardProgressItems(setup, setupStep)} />

        <div
          className="rounded-xl border p-4 shadow-sm mt-2"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
        >
          {setupStep === 0 && (
            <>
              <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--color-text)' }}>What are we working from?</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSetup((s) => ({ ...s, source: 'topic' }))}
                  className="p-4 rounded-xl border text-left text-sm font-medium transition-opacity hover:opacity-80 shadow-sm"
                  style={choiceCardStyle(setup.source === 'topic')}
                >
                  A topic to explore
                </button>
                <button
                  type="button"
                  onClick={() => setSetup((s) => ({ ...s, source: 'document' }))}
                  className="p-4 rounded-xl border text-left text-sm font-medium transition-opacity hover:opacity-80 shadow-sm"
                  style={choiceCardStyle(setup.source === 'document')}
                >
                  A document (paste)
                </button>
              </div>
            </>
          )}

          {setupStep === 1 && (
            <>
              <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
                {setup.source === 'topic' ? 'What is the topic?' : 'Paste your document'}
              </h2>
              <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
                {setup.source === 'topic'
                  ? 'Give as much or as little detail as you like.'
                  : 'Paste the full text here, or the longest excerpt you have.'}
              </p>
              <textarea
                ref={detailTextareaRef}
                value={setup.detail}
                onChange={(e) => setSetup((s) => ({ ...s, detail: e.target.value }))}
                rows={8}
                className="w-full text-sm px-3 py-2 rounded-xl border outline-none resize-y min-h-[120px]"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
              />
              {renderSetupMic()}
            </>
          )}

          {setupStep === 2 && (
            <>
              <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--color-text)' }}>How familiar are you with this subject?</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {FAMILIARITY.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSetup((s) => ({ ...s, familiarity: f.id }))}
                    className="p-3 rounded-xl border text-sm text-left transition-opacity hover:opacity-80 shadow-sm"
                    style={choiceCardStyle(setup.familiarity === f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {setupStep === 3 && (
            <>
              <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--color-text)' }}>What would you like to create today?</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {GOALS.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setSetup((s) => ({ ...s, goal: g.id }))}
                    className="p-3 rounded-xl border text-sm text-left transition-opacity hover:opacity-80 shadow-sm"
                    style={choiceCardStyle(setup.goal === g.id)}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {setupStep === 4 && (
            <>
              <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--color-text)' }}>How many cards or slides?</h2>
              <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>Leave blank or type &quot;you decide&quot; if you want the assistant to choose.</p>
              <textarea
                ref={countTextareaRef}
                value={setup.count}
                onChange={(e) => setSetup((s) => ({ ...s, count: e.target.value }))}
                rows={3}
                placeholder="e.g. 20 cards, or you decide"
                className="w-full text-sm px-3 py-2 rounded-xl border outline-none resize-y"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
              />
              <div className="flex gap-2 mt-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setSetup((s) => ({ ...s, count: 'you decide' }))}
                  className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                >
                  You decide
                </button>
              </div>
              {renderSetupMic()}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 mt-6 pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <button
            type="button"
            onClick={() => { if (setupStep > 0) setSetupStep((s) => s - 1); }}
            disabled={setupStep === 0}
            className="text-xs px-3 py-2 rounded-lg border hover:opacity-70 disabled:opacity-30"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Back
          </button>
          {setupStep < 4 ? (
            <button
              type="button"
              onClick={() => canAdvanceFromStep() && setSetupStep((s) => s + 1)}
              disabled={!canAdvanceFromStep()}
              className="text-sm px-4 py-2 rounded-lg font-medium text-white hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={handleBeginStudySession}
              disabled={!canAdvanceFromStep() || isStreaming}
              className="text-sm px-4 py-2 rounded-lg font-medium text-white hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              Begin study session
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      <div className="flex-shrink-0 px-4 h-12 flex items-center gap-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <span className="text-sm font-medium flex-shrink-0" style={{ color: 'var(--color-text)' }}>Cards</span>
        <div className="flex items-center gap-1 ml-2">
          <button
            type="button"
            onClick={() => { setPageTab('session'); setLibraryDetail(null); clearDeckSearchParam(); }}
            className="text-xs px-2 py-1 rounded-lg border transition-opacity hover:opacity-70"
            style={{
              borderColor: 'var(--color-border)',
              color: pageTab === 'session' ? 'var(--color-primary)' : 'var(--color-muted)',
              background: pageTab === 'session' ? 'var(--color-surface)' : 'transparent',
            }}
          >
            Session
          </button>
          <button
            type="button"
            onClick={() => { setPageTab('library'); setLibraryDetail(null); clearDeckSearchParam(); }}
            className="text-xs px-2 py-1 rounded-lg border transition-opacity hover:opacity-70 flex items-center gap-1"
            style={{
              borderColor: 'var(--color-border)',
              color: pageTab === 'library' ? 'var(--color-primary)' : 'var(--color-muted)',
              background: pageTab === 'library' ? 'var(--color-surface)' : 'transparent',
            }}
          >
            {getIcon('library', { size: 12 })}
            Saved
          </button>
        </div>
        <Link
          to="/student/saved-decks"
          className="text-xs px-2 py-1 rounded-lg border transition-opacity hover:opacity-70 flex items-center gap-1 flex-shrink-0"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          {getIcon('library', { size: 12 })}
          <span className="hidden sm:inline">All saved</span>
        </Link>
        {phase === 'chat' && pageTab === 'session' && deckHasPersistableContent && (
          <button
            type="button"
            onClick={handlePersistDeck}
            disabled={deckSaveBusy}
            className="text-xs px-2 py-1 rounded-lg border transition-opacity hover:opacity-70 disabled:opacity-40 flex items-center gap-1 flex-shrink-0 font-medium"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' }}
            title={savedDeckId ? 'Update this deck in your library' : 'Save this deck to your library'}
          >
            {deckSaveBusy ? getIcon('loader', { size: 12 }) : getIcon('archive', { size: 12 })}
            <span className="hidden sm:inline">{savedDeckId ? 'Update saved' : 'Save deck'}</span>
            <span className="sm:hidden">{savedDeckId ? 'Update' : 'Save'}</span>
          </button>
        )}
        <span className="flex-1" />
        {canSelectModel && (
          <div className="relative">
            <button
              type="button"
              onClick={() => { setShowModelPicker((v) => !v); setShowTempPicker(false); }}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)' }}
            >
              {(() => {
                const m = MODELS.find((x) => x.id === effectiveModel);
                return m ? `${m.emoji} ${m.name}` : effectiveModel;
              })()}
            </button>
            {showModelPicker && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowModelPicker(false)} />
                <div
                  className="absolute right-0 top-full mt-1 w-52 rounded-xl border shadow-lg py-1.5 z-40 max-h-64 overflow-y-auto"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
                >
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { setChatModel(m.id); setShowModelPicker(false); }}
                      className="w-full text-left px-3 py-2 text-xs hover:opacity-70"
                      style={{ color: effectiveModel === m.id ? 'var(--color-primary)' : 'var(--color-text)' }}
                    >
                      {m.emoji} {m.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <div className="relative hidden sm:block">
          <button
            type="button"
            onClick={() => { setShowTempPicker((v) => !v); setShowModelPicker(false); }}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)' }}
          >
            {getIcon('flame', { size: 12 })}
            {TEMPERATURES.find((t) => t.value === temperature)?.label || 'Balanced'}
          </button>
          {showTempPicker && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowTempPicker(false)} />
              <div
                className="absolute right-0 top-full mt-1 w-40 rounded-xl border shadow-lg py-1 z-40"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
              >
                {TEMPERATURES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => { setTemperature(t.value); setShowTempPicker(false); }}
                    className="w-full text-left px-3 py-2 text-xs hover:opacity-70"
                    style={{ color: temperature === t.value ? 'var(--color-primary)' : 'var(--color-text)' }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={handleNewSession}
          className="text-xs px-2 py-1 rounded-lg border hover:opacity-70"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          New session
        </button>
        {phase === 'chat' && pageTab === 'session' && (
          <ExportMenu
            sessionId={sessionId}
            pdfTitle={deckTitle.trim() || 'Study cards'}
            emailDefaultSubject={`${deckTitle.trim() || 'Study cards'} — Study session`}
            minimal
            pendingSession={!sessionId}
          />
        )}
      </div>

      {streamError && (
        <div className="flex-shrink-0 px-4 py-2 text-xs border-b flex items-center justify-between gap-2" style={{ background: '#fff1f2', borderColor: '#fca5a5', color: '#991b1b' }}>
          <span>{streamError.message}</span>
          <button type="button" onClick={clearStreamError} className="hover:opacity-70 font-bold">✕</button>
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {pageTab === 'library' && (
          <div className="flex-1 overflow-y-auto min-h-0 px-4 py-6">
            <div className={`${msgWidthClass} mx-auto w-full`}>
              <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Saved decks & quizzes</h2>
              {libraryLoad ? (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading…</p>
              ) : libraryRows.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No saved decks yet. In Cards, after the assistant generates a deck, use Save deck in the top bar or under Current deck.</p>
              ) : (
                <ul className="space-y-2">
                  {libraryRows.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const res = await api.get(`/api/study-decks/${row.id}`);
                            const d = await res.json();
                            setLibraryDetail(d);
                          } catch { /* ignore */ }
                        }}
                        className="w-full text-left rounded-xl border px-4 py-3 transition-opacity hover:opacity-70"
                        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                      >
                        <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{row.title || 'Untitled deck'}</div>
                        <div className="text-[10px] mt-1 uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                          {row.kind || 'mixed'}
                          {row.updatedAt ? ` · ${new Date(row.updatedAt).toLocaleDateString()}` : ''}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        {pageTab === 'session' && phase === 'setup' && (
          <div className="flex-1 overflow-y-auto min-h-0 py-8">
            {setupCard}
          </div>
        )}
        {pageTab === 'session' && phase === 'chat' && (
          <>
            {savedSetup && (
              <div
                className="flex-shrink-0 z-10 border-b px-4 py-3"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              >
                <div className={`${msgWidthClass} mx-auto w-full space-y-2`}>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex-1 min-w-[160px]">
                      <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
                        Deck title
                      </label>
                      <input
                        type="text"
                        value={deckTitle}
                        onChange={(e) => setDeckTitle(e.target.value)}
                        placeholder="Name this set of cards…"
                        className="w-full text-sm px-3 py-2 rounded-xl border outline-none"
                        style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleEditSetup}
                      disabled={isStreaming}
                      className="text-xs px-3 py-2 rounded-lg border transition-opacity hover:opacity-70 disabled:opacity-40 flex-shrink-0"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                    >
                      Edit setup
                    </button>
                  </div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide pt-1" style={{ color: 'var(--color-muted)' }}>Your setup answers</p>
                  <SetupSummaryStrip items={buildSetupSummaryItems(savedSetup, { includeCountIfEmpty: true })} />
                </div>
              </div>
            )}
            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="hidden sm:block flex-shrink-0 px-4 pt-2 pb-0">
                <div className={`${msgWidthClass} flex justify-end`}>
                  <button
                    type="button"
                    onClick={toggleWideCards}
                    title={wideCards ? 'Collapse to narrow layout' : 'Expand to wide layout'}
                    className="w-8 h-8 flex items-center justify-center rounded-lg transition-opacity hover:opacity-90"
                    style={{ color: '#15803d' }}
                  >
                    {getIcon(wideCards ? 'collapse-horizontal' : 'expand-horizontal', { size: 18 })}
                  </button>
                </div>
              </div>
              <div className={`${msgWidthClass} px-4 py-4 w-full space-y-4`}>
                {displayMessages.map((msg, i) => {
                  const isLastAssistant = msg.role === 'assistant' && i === displayMessages.length - 1;
                  const orig = messages[i];
                  const speakContent = orig?.role === 'assistant' ? stripVaultMachineBlocks(orig.content || '') : '';
                  return (
                    <MessageBubble
                      key={i}
                      message={msg}
                      messageIndex={i}
                      isLatest={isLastAssistant}
                      searching={false}
                      isSpeaking={isLastAssistant && isTTSAvailable ? isSpeaking : false}
                      isPaused={isLastAssistant && isTTSAvailable ? isPaused : false}
                      onSpeak={isLastAssistant && isTTSAvailable && msg.role === 'assistant' ? () => speak(speakContent) : undefined}
                      onPause={isLastAssistant && isTTSAvailable ? pauseSpeaking : undefined}
                      onResume={isLastAssistant && isTTSAvailable ? resumeSpeaking : undefined}
                      onStop={isLastAssistant && isTTSAvailable ? stopSpeaking : undefined}
                    />
                  );
                })}
                {choicePrompt && choicePrompt.options?.length > 0 && (
                  <div
                    className="rounded-xl border p-4 shadow-sm"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                  >
                    {choicePrompt.prompt && (
                      <p className="text-sm font-medium mb-3" style={{ color: 'var(--color-text)' }}>{choicePrompt.prompt}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {choicePrompt.options.map((opt) => (
                        <button
                          key={opt.id || opt.label}
                          type="button"
                          disabled={isStreaming}
                          onClick={() => handleChoice(opt)}
                          className="text-sm px-4 py-2 rounded-xl border transition-opacity hover:opacity-70 disabled:opacity-40"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' }}
                        >
                          {opt.label || opt.id}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {parsedDeck && (
                  <div
                    className="rounded-xl border p-4 shadow-sm space-y-3"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Current deck</h3>
                      {savedDeckId && (
                        <button
                          type="button"
                          onClick={() => { setDeckEmailSubjectHint(deckTitle.trim() || 'Study deck'); setDeckEmailTargetId(savedDeckId); setShowDeckEmail(true); }}
                          className="text-xs px-2 py-1 rounded-lg border transition-opacity hover:opacity-70 flex items-center gap-1"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                        >
                          {getIcon('mail', { size: 12 })}
                          Email deck
                        </button>
                      )}
                    </div>
                    <StudentDeckPanel
                      title={deckTitle}
                      payload={parsedDeck}
                      sessionId={sessionId}
                      savedDeckId={savedDeckId}
                      onSaved={handleDeckSaved}
                    />
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
          </>
        )}
      </div>

      {phase === 'chat' && pageTab === 'session' && (
        <div className="flex-shrink-0 border-t px-4 py-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className={`${msgWidthClass} flex gap-2 items-end mx-auto w-full px-0`}>
            <div className="flex-1 rounded-2xl border relative" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Message your study assistant…"
                rows={1}
                className="w-full text-sm px-3 py-2.5 pb-11 bg-transparent outline-none resize-none min-h-[52px] max-h-[160px]"
                style={{ color: 'var(--color-text)' }}
                disabled={isStreaming}
              />
              <div className="absolute bottom-2 left-2 flex items-center gap-1">
                {isSTTAvailable && (
                  <>
                    <button
                      type="button"
                      onClick={startListening}
                      disabled={isListening || isStreaming}
                      className="w-8 h-8 flex items-center justify-center rounded-lg relative transition-opacity hover:opacity-80 disabled:opacity-40"
                      style={{ color: isListening ? '#ef4444' : 'var(--color-muted)' }}
                      title="Voice input"
                    >
                      {getIcon('mic', { size: 16 })}
                      {isListening && (
                        <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full animate-pulse" style={{ background: '#ef4444' }} />
                      )}
                    </button>
                    {isListening && (
                      <>
                        <span className="text-xs max-w-[100px] sm:max-w-[160px] truncate" style={{ color: '#ef4444' }}>{interimText || 'Listening…'}</span>
                        <button
                          type="button"
                          onClick={stopListening}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-white"
                          style={{ background: '#ef4444' }}
                        >
                          {getIcon('square', { size: 10, color: '#fff' })}
                          Stop
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
            {isStreaming ? (
              <button
                type="button"
                onClick={stopStreaming}
                className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white hover:opacity-90 transition-opacity"
                style={{ background: 'var(--color-primary)' }}
                title="Stop"
              >
                {getIcon('stop-circle', { size: 18, color: '#fff' })}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim()}
                className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white hover:opacity-90 transition-opacity disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
                title="Send"
              >
                {getIcon('send', { size: 18, color: '#fff' })}
              </button>
            )}
          </div>
          {sessionUsage.inputTokens > 0 && (
            <p className={`text-center text-xs mt-2 ${msgWidthClass} mx-auto`} style={{ color: 'var(--color-muted)' }}>
              Session: {(sessionUsage.inputTokens + sessionUsage.outputTokens).toLocaleString()} tokens
              {sessionId ? ` · ${sessionId.slice(-8)}` : ''}
            </p>
          )}
        </div>
      )}

      {showDeckEmail && deckEmailTargetId && (
        <EmailModal
          studyDeckId={deckEmailTargetId}
          onClose={() => { setShowDeckEmail(false); setDeckEmailTargetId(null); setDeckEmailSubjectHint(''); }}
          defaultSubject={`${deckEmailSubjectHint || 'Study deck'} — Deck export`}
        />
      )}

      {libraryDetail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => dismissLibraryDetail()}
        >
          <div
            role="dialog"
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border shadow-2xl p-5"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{libraryDetail.title || 'Saved deck'}</h3>
              <button type="button" className="text-xs hover:opacity-70" style={{ color: 'var(--color-muted)' }} onClick={() => dismissLibraryDetail()}>Close</button>
            </div>
            <StudentDeckPanel
              title={libraryDetail.title}
              payload={libraryDetail.payload}
              sessionId={libraryDetail.sessionId}
              savedDeckId={libraryDetail.id}
              onSaved={handleLibraryDeckSaved}
            />
            <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
              {libraryDetail.sessionId && (
                <button
                  type="button"
                  onClick={() => {
                    const sid = libraryDetail.sessionId;
                    dismissLibraryDetail();
                    setSearchParams({ session: sid });
                    sessionBootRef.current = false;
                    loadHistory(sid).then(() => {
                      setPhase('chat');
                      setPageTab('session');
                    }).catch(() => {});
                  }}
                  className="text-xs px-3 py-2 rounded-lg text-white transition-opacity hover:opacity-90"
                  style={{ background: 'var(--color-primary)' }}
                >
                  Resume chat session
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setDeckEmailSubjectHint(libraryDetail.title || 'Study deck');
                  setDeckEmailTargetId(libraryDetail.id);
                  setShowDeckEmail(true);
                  dismissLibraryDetail();
                }}
                className="text-xs px-3 py-2 rounded-lg border transition-opacity hover:opacity-70 flex items-center gap-1"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                {getIcon('mail', { size: 12 })}
                Email this deck
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
