import React, { useState, useRef, useEffect } from 'react';
import api from '../../utils/apiClient';
import EmotionWheel from './EmotionWheel';
import useToastStore from '../../store/toastStore';
import { useVoice } from '../../hooks/useVoice';
import { useIcon } from '../../providers/IconProvider';

const BODY_LOCATIONS = ['Head', 'Chest', 'Throat', 'Stomach', 'Shoulders', 'Arms', 'Hands', 'Legs', 'Whole body'];
const BODY_QUALITIES  = ['Tight', 'Heavy', 'Light', 'Fluttery', 'Hot', 'Cold', 'Hollow', 'Numb', 'Racing', 'Aching', 'Expansive', 'Buzzing'];

// ── Sub-components ─────────────────────────────────────────────────────────────

function StageDots({ current }) {
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3, 4, 5].map(i => {
        const done    = i < current;
        const active  = i === current;
        return (
          <span
            key={i}
            className="rounded-full transition-all duration-200"
            style={{
              width:      active ? 16 : 6,
              height:     6,
              background: done   ? 'var(--color-primary)'
                        : active ? 'var(--color-primary)'
                        : 'var(--color-border)',
              opacity: done ? 0.45 : 1,
            }}
          />
        );
      })}
    </div>
  );
}

function Chip({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs px-2.5 py-1 rounded-full border transition-colors"
      style={{
        background:  active ? 'var(--color-surface)' : 'transparent',
        borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
        color:       active ? 'var(--color-text)'    : 'var(--color-muted)',
      }}
    >
      {label}
    </button>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-1 py-0.5">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full animate-pulse"
          style={{ background: 'var(--color-muted)', animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

function useToggleSet(initial = []) {
  const [set, setSet] = useState(initial);
  const toggle = (val) => setSet(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  return [set, toggle, setSet];
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function InquirySession({ onClose, onComplete }) {
  const addToast = useToastStore(s => s.addToast);

  // Navigation
  const [stage, setStage]               = useState(1);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  // Session metadata
  const [sessionId,      setSessionId]      = useState(null);
  const [recentPatterns, setRecentPatterns] = useState(null);
  const [startLoading,   setStartLoading]   = useState(false);
  const [startError,     setStartError]     = useState('');

  // Stage 1 — Arrival
  const [arrivalText, setArrivalText] = useState('');

  // Stage 2 — Body Scan
  const [scanLocations, toggleScanLocation, setScanLocations] = useToggleSet([]);
  const [scanQualities, toggleScanQuality,  setScanQualities]  = useToggleSet([]);
  const [scanDescription, setScanDescription] = useState('');

  // Stage 3 — Patterns (no input, just display)
  const [patternsResponse, setPatternsResponse] = useState('');

  // Stage 4 — The Inquiry (chat)
  const [messages,        setMessages]        = useState([]);
  const [aiTyping,        setAiTyping]        = useState(false);
  const [userInput,       setUserInput]       = useState('');
  const [inquiryStarted,  setInquiryStarted]  = useState(false);
  const conversationRef = useRef([]);
  const messagesEndRef  = useRef(null);

  const {
    isSTTAvailable, isTTSAvailable,
    isListening, transcript, interimText,
    isSpeaking, isPaused,
    startListening, stopListening,
    speak, pauseSpeaking, resumeSpeaking, stopSpeaking,
  } = useVoice();
  const getIcon = useIcon();

  // Stage 5 — What Emerged
  const [wheelResult,  setWheelResult]  = useState(null);
  const [userSummary,  setUserSummary]  = useState('');

  // Completion
  const [completing,    setCompleting]    = useState(false);
  const [completedData, setCompletedData] = useState(null);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, aiTyping]);

  // Commit voice transcript into the input field
  useEffect(() => {
    if (transcript) {
      setUserInput(prev => prev.trimEnd() ? prev.trimEnd() + ' ' + transcript.trim() : transcript.trim());
    }
  }, [transcript]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const userMsgCount = messages.filter(m => m.role === 'user').length;
  const aiHasResponded = messages.some(m => m.role === 'assistant' && m.content.length > 0);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleCloseAttempt = () => {
    if (stage >= 4 && !completedData) {
      setShowLeaveConfirm(true);
    } else {
      onClose();
    }
  };

  const handleForceClose = () => {
    setShowLeaveConfirm(false);
    onClose();
  };

  // Stage 1 → 2: Start session
  const handleStartSession = async () => {
    setStartLoading(true);
    setStartError('');
    try {
      const res = await api.post('/api/mood/inquiry/start', {});
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setSessionId(data.sessionId);
      setRecentPatterns(data.recentPatterns);
      setStage(2);
    } catch {
      setStartError('Could not start session. Please try again.');
    } finally {
      setStartLoading(false);
    }
  };

  // Stage 2 → 3: Move to patterns
  const handleBodyScanNext = () => {
    setStage(3);
  };

  // Stage 3 → 4: Begin inquiry (sends opening message to AI)
  const handleBeginInquiry = async () => {
    setStage(4);
    setInquiryStarted(true);
    await sendToAI('');
  };

  // SSE streaming helper
  const sendToAI = async (userMessage) => {
    if (userMessage.trim()) {
      const userMsg = { role: 'user', content: userMessage.trim() };
      const updated = [...conversationRef.current, userMsg];
      conversationRef.current = updated;
      setMessages(updated);
    }

    const placeholderMsg = { role: 'assistant', content: '' };
    const withPlaceholder = [...conversationRef.current, placeholderMsg];
    conversationRef.current = withPlaceholder;
    setMessages(withPlaceholder);
    setAiTyping(true);

    try {
      const res = await api.stream(
        '/api/mood/inquiry/message',
        {
          sessionId,
          userMessage: userMessage.trim() || '',
          bodyScan: {
            locations:        scanLocations,
            qualities:        scanQualities,
            body_description: [scanDescription, arrivalText].filter(Boolean).join('\n\n'),
          },
          conversation: conversationRef.current
            .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content))
            .map(m => ({ role: m.role, content: m.content })),
        }
      );

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      loop: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') break loop;
          try {
            const token = JSON.parse(payload);
            accumulated += token;
            setMessages(prev => {
              const u = [...prev];
              u[u.length - 1] = { role: 'assistant', content: accumulated };
              return u;
            });
          } catch {}
        }
      }

      // Sync ref to final state
      conversationRef.current = conversationRef.current.map((m, i) =>
        i === conversationRef.current.length - 1 && m.role === 'assistant'
          ? { ...m, content: accumulated }
          : m
      );
    } catch {
      addToast('Connection interrupted', 'error');
    } finally {
      setAiTyping(false);
    }
  };

  const handleSendMessage = async () => {
    const msg = userInput.trim();
    if (!msg || aiTyping) return;
    setUserInput('');
    await sendToAI(msg);
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Stage 4 → 5: Close conversation
  const handleReadyToClose = () => {
    setStage(5);
  };

  // Stage 5 wheel selection
  const handleWheelSelect = (result) => {
    setWheelResult(result);
  };

  // Complete session
  const handleComplete = async () => {
    setCompleting(true);
    const startTime = Date.now();

    try {
      // Complete the session
      const fullConversation = conversationRef.current
        .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content))
        .map(m => ({ role: m.role, content: m.content }));

      await api.put(`/api/mood/inquiry/${sessionId}/complete`, {
        userSummary:      userSummary.trim() || null,
        dominantEmotions: [wheelResult?.coreEmotion, wheelResult?.secondaryEmotion, wheelResult?.tertiaryEmotion].filter(Boolean),
        durationSeconds:  Math.floor((Date.now() - startTime) / 1000),
        conversation:     fullConversation,
      });

      // Optionally log a check-in if emotion was selected
      if (wheelResult?.coreEmotion) {
        try {
          await api.post('/api/mood/checkin', {
            entityType:       'general',
            entityId:         null,
            coreEmotion:      wheelResult.coreEmotion,
            secondaryEmotion: wheelResult.secondaryEmotion || null,
            tertiaryEmotion:  wheelResult.tertiaryEmotion  || null,
            intensity:        wheelResult.intensity ?? 5,
            bodyLocations:    scanLocations.length > 0 ? scanLocations : null,
            bodyQualities:    scanQualities.length > 0 ? scanQualities : null,
            bodyDescription:  [scanDescription, arrivalText].filter(Boolean).join('\n\n') || null,
            checkInType:      'inquiry',
            inquirySessionId: sessionId,
          });
        } catch {
          // non-fatal
        }
      }

      setCompletedData({ summary: userSummary.trim() });
      setStage('complete');
      if (onComplete) onComplete();
    } catch {
      addToast('Failed to save session', 'error');
    } finally {
      setCompleting(false);
    }
  };

  // ── Stage labels ──────────────────────────────────────────────────────────

  const stageLabel = stage === 1 ? 'Arriving'
                   : stage === 2 ? 'Body Scan'
                   : stage === 3 ? 'Recent Patterns'
                   : stage === 4 ? 'The Inquiry'
                   : stage === 5 ? 'What Emerged'
                   : 'Complete';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) handleCloseAttempt(); }}
    >
      <div
        className="w-full max-w-xl rounded-2xl border shadow-2xl flex flex-col"
        style={{
          background:   'var(--color-surface)',
          borderColor:  'var(--color-border)',
          height:       stage === 4 ? '85vh' : 'auto',
          maxHeight:    '90vh',
        }}
      >

        {/* ── Header ── */}
        <div
          className="px-5 py-4 border-b flex items-center justify-between flex-shrink-0"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
              Guided Inquiry
            </h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
              {stageLabel}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 ml-4 flex-shrink-0">
            <button
              onClick={handleCloseAttempt}
              className="hover:opacity-60 p-1 leading-none"
              style={{ color: 'var(--color-muted)' }}
            >
              ✕
            </button>
            {stage !== 'complete' && <StageDots current={typeof stage === 'number' ? stage : 5} />}
          </div>
        </div>

        {/* ── Leave confirm overlay ── */}
        {showLeaveConfirm && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl"
            style={{ background: 'rgba(0,0,0,0.55)' }}
          >
            <div
              className="mx-5 rounded-xl border p-5 max-w-sm w-full"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
                Leave this session?
              </p>
              <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
                Your conversation won't be saved if you leave now.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowLeaveConfirm(false)}
                  className="px-3 py-1.5 rounded-lg text-xs border"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                >
                  Stay
                </button>
                <button
                  onClick={handleForceClose}
                  className="px-3 py-1.5 rounded-lg text-xs text-white"
                  style={{ background: 'var(--color-danger, #ef4444)' }}
                >
                  Leave
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Body ── */}

        {/* Stage 1 — Arrival */}
        {stage === 1 && (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                Take a breath before we begin. What do you notice right now — in your body, your thoughts, your mood? There is no right answer.
              </p>
              <div>
                <textarea
                  rows={3}
                  value={arrivalText}
                  onChange={e => setArrivalText(e.target.value)}
                  placeholder="Whatever is here right now... a thought, a tension, a feeling. Don't think about it — just write."
                  className="w-full text-sm px-3 py-2 rounded-lg border outline-none resize-none"
                  style={{
                    background:  'var(--color-bg)',
                    borderColor: 'var(--color-border)',
                    color:       'var(--color-text)',
                    fontFamily:  'inherit',
                  }}
                />
              </div>
              {startError && (
                <p className="text-xs" style={{ color: 'var(--color-danger, #ef4444)' }}>{startError}</p>
              )}
            </div>
            <div
              className="px-5 py-3 border-t flex items-center justify-end flex-shrink-0"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <button
                type="button"
                onClick={handleStartSession}
                disabled={startLoading}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-opacity"
                style={{ background: 'var(--color-primary)' }}
              >
                {startLoading ? 'Starting…' : 'Begin →'}
              </button>
            </div>
          </>
        )}

        {/* Stage 2 — Body Scan */}
        {stage === 2 && (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Take a moment to notice where this lands in your body. There's no need to name an emotion yet.
              </p>

              <div>
                <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>
                  Location <span className="font-normal">(optional)</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {BODY_LOCATIONS.map(loc => (
                    <Chip
                      key={loc}
                      label={loc}
                      active={scanLocations.includes(loc)}
                      onClick={() => toggleScanLocation(loc)}
                    />
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>
                  Quality <span className="font-normal">(optional)</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {BODY_QUALITIES.map(q => (
                    <Chip
                      key={q}
                      label={q}
                      active={scanQualities.includes(q)}
                      onClick={() => toggleScanQuality(q)}
                    />
                  ))}
                </div>
              </div>

              <textarea
                rows={2}
                value={scanDescription}
                onChange={e => setScanDescription(e.target.value)}
                placeholder="Describe the sensation in your own words (optional)"
                className="w-full text-sm px-3 py-2 rounded-lg border outline-none resize-none"
                style={{
                  background:  'var(--color-bg)',
                  borderColor: 'var(--color-border)',
                  color:       'var(--color-text)',
                  fontFamily:  'inherit',
                }}
              />
            </div>
            <div
              className="px-5 py-3 border-t flex items-center justify-between flex-shrink-0"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <button
                type="button"
                onClick={() => setStage(1)}
                className="px-4 py-2 rounded-xl text-sm border"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={handleBodyScanNext}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                style={{ background: 'var(--color-primary)' }}
              >
                Next →
              </button>
            </div>
          </>
        )}

        {/* Stage 3 — Recent Patterns */}
        {stage === 3 && (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Here's a look at your recent emotional patterns. Take a moment to notice what stands out.
              </p>

              {recentPatterns && recentPatterns.length > 0 ? (
                <div className="space-y-2">
                  {recentPatterns.map((pattern, i) => (
                    <div
                      key={i}
                      className="rounded-xl px-3 py-2.5 text-xs"
                      style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium capitalize" style={{ color: 'var(--color-text)' }}>
                          {pattern.core_emotion}
                        </span>
                        <span style={{ color: 'var(--color-muted)' }}>
                          {pattern.count}× in 7 days
                        </span>
                      </div>
                      {pattern.avg_intensity && (
                        <div className="mt-0.5" style={{ color: 'var(--color-muted)' }}>
                          avg intensity {Math.round(pattern.avg_intensity * 10) / 10}/10
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  className="rounded-xl px-3 py-3 text-xs"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                >
                  Not enough recent check-ins to show patterns yet — that's okay.
                </div>
              )}

              <p className="text-xs italic" style={{ color: 'var(--color-muted)' }}>
                Is there anything here that surprises you, or feels familiar?
              </p>
            </div>
            <div
              className="px-5 py-3 border-t flex items-center justify-between flex-shrink-0"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <button
                type="button"
                onClick={() => setStage(2)}
                className="px-4 py-2 rounded-xl text-sm border"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={handleBeginInquiry}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                style={{ background: 'var(--color-primary)' }}
              >
                Begin inquiry →
              </button>
            </div>
          </>
        )}

        {/* Stage 4 — The Inquiry (chat) */}
        {stage === 4 && (
          <div className="flex flex-col flex-1 min-h-0">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {(() => {
                // Index of the last completed AI message (for active speaker controls)
                const lastAiIdx = messages.reduce((last, m, i) =>
                  (m.role === 'assistant' && m.content) ? i : last, -1);
                return messages.map((msg, i) => {
                  const isLastAI = msg.role === 'assistant' && i === lastAiIdx;
                  return (
                    <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div
                        className="max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
                        style={
                          msg.role === 'user'
                            ? { background: 'var(--color-primary)', color: '#fff' }
                            : { background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }
                        }
                      >
                        {msg.content || (msg.role === 'assistant' && aiTyping && i === messages.length - 1
                          ? <TypingDots />
                          : null
                        )}
                      </div>

                      {/* Speaker controls — only on completed AI messages */}
                      {msg.role === 'assistant' && msg.content && isTTSAvailable && (
                        <div className={`flex items-center gap-1 mt-1 transition-opacity ${(isLastAI && isSpeaking) ? 'opacity-100' : 'opacity-0 hover:opacity-100'}`}
                          style={{ ['--tw-group-hover-opacity']: 1 }}
                        >
                          {isLastAI && isSpeaking ? (
                            <>
                              <button
                                onClick={isPaused ? resumeSpeaking : pauseSpeaking}
                                className="w-6 h-6 flex items-center justify-center rounded-md"
                                style={{ background: 'color-mix(in srgb, var(--color-primary) 12%, var(--color-surface))', border: '1px solid var(--color-primary)', color: 'var(--color-primary)' }}
                                title={isPaused ? 'Resume' : 'Pause'}
                              >
                                {isPaused ? getIcon('play', { size: 11 }) : getIcon('pause', { size: 11 })}
                              </button>
                              <button
                                onClick={stopSpeaking}
                                className="w-6 h-6 flex items-center justify-center rounded-md"
                                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                                title="Stop reading"
                              >
                                {getIcon('x', { size: 11 })}
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => speak(msg.content)}
                              className="w-6 h-6 flex items-center justify-center rounded-md"
                              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                              title="Read aloud"
                            >
                              {getIcon('speaker', { size: 11 })}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
              {aiTyping && messages[messages.length - 1]?.role !== 'assistant' && (
                <div className="flex justify-start">
                  <div
                    className="rounded-2xl px-3.5 py-2.5"
                    style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
                  >
                    <TypingDots />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input area — appears after AI has responded */}
            {aiHasResponded && (
              <div
                className="flex-shrink-0 border-t px-4 py-3"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <div className="flex gap-2 items-end">
                  <textarea
                    rows={2}
                    value={isListening ? interimText || '' : userInput}
                    onChange={e => { if (!isListening) setUserInput(e.target.value); }}
                    onKeyDown={handleInputKeyDown}
                    placeholder={isListening ? 'Listening…' : 'Respond…'}
                    readOnly={isListening}
                    className="flex-1 text-sm px-3 py-2 rounded-xl border outline-none resize-none"
                    style={{
                      background:  'var(--color-bg)',
                      borderColor: isListening ? '#ef4444' : 'var(--color-border)',
                      color:       isListening ? '#ef4444' : 'var(--color-text)',
                      fontFamily:  'inherit',
                    }}
                  />

                  {/* Mic button */}
                  {isSTTAvailable && (
                    <>
                      <button
                        type="button"
                        onClick={startListening}
                        disabled={isListening}
                        className="w-9 h-9 flex items-center justify-center rounded-xl border flex-shrink-0 relative transition-all"
                        style={{
                          background:  'var(--color-bg)',
                          borderColor: isListening ? '#ef4444' : 'var(--color-border)',
                          color:       isListening ? '#ef4444' : 'var(--color-muted)',
                        }}
                        title="Voice input"
                      >
                        {getIcon('mic', { size: 14 })}
                        {isListening && (
                          <span
                            className="absolute top-1 right-1 w-2 h-2 rounded-full animate-pulse"
                            style={{ background: '#ef4444' }}
                          />
                        )}
                      </button>
                      {isListening && (
                        <button
                          type="button"
                          onClick={stopListening}
                          className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs font-medium flex-shrink-0"
                          style={{ background: '#ef4444', color: '#fff' }}
                          title="Stop recording"
                        >
                          {getIcon('square', { size: 10 })}
                          Stop
                        </button>
                      )}
                    </>
                  )}

                  <button
                    type="button"
                    onClick={handleSendMessage}
                    disabled={!userInput.trim() || aiTyping || isListening}
                    className="px-3 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-90 flex-shrink-0"
                    style={{ background: 'var(--color-primary)' }}
                  >
                    Send
                  </button>
                </div>
                {userMsgCount >= 1 && !aiTyping && (
                  <div className="flex justify-end mt-2">
                    <button
                      type="button"
                      onClick={handleReadyToClose}
                      className="text-xs hover:opacity-80 transition-opacity"
                      style={{ color: 'var(--color-muted)' }}
                    >
                      I'm ready to close →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Stage 5 — What Emerged */}
        {stage === 5 && (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Take a moment to notice what shifted, what came up, or what you're left with.
              </p>

              {/* Optional emotion wheel */}
              <div>
                <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>
                  Name what's present now <span className="font-normal">(optional)</span>
                </p>
                {wheelResult ? (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[wheelResult.coreEmotion, wheelResult.secondaryEmotion, wheelResult.tertiaryEmotion]
                      .filter(Boolean)
                      .map((em, i) => (
                        <React.Fragment key={em}>
                          {i > 0 && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>›</span>}
                          <span
                            className="text-xs px-2.5 py-1 rounded-full capitalize"
                            style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                          >
                            {em}
                          </span>
                        </React.Fragment>
                      ))}
                    <button
                      type="button"
                      onClick={() => setWheelResult(null)}
                      className="text-xs hover:opacity-60 ml-1"
                      style={{ color: 'var(--color-muted)' }}
                    >
                      change
                    </button>
                  </div>
                ) : (
                  <EmotionWheel
                    mode="interactive"
                    onSelect={handleWheelSelect}
                    onCancel={() => {}}
                    hideIntensity
                    hideBodyLocations
                  />
                )}
              </div>

              {/* Summary note */}
              <div>
                <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>
                  Anything you want to capture from this session? <span className="font-normal">(optional)</span>
                </p>
                <textarea
                  rows={3}
                  value={userSummary}
                  onChange={e => setUserSummary(e.target.value)}
                  placeholder="A key insight, something that surprised you, or a next step…"
                  className="w-full text-sm px-3 py-2 rounded-lg border outline-none resize-none"
                  style={{
                    background:  'var(--color-bg)',
                    borderColor: 'var(--color-border)',
                    color:       'var(--color-text)',
                    fontFamily:  'inherit',
                  }}
                />
              </div>
            </div>
            <div
              className="px-5 py-3 border-t flex items-center justify-between flex-shrink-0"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <button
                type="button"
                onClick={() => setStage(4)}
                className="px-4 py-2 rounded-xl text-sm border"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={handleComplete}
                disabled={completing}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-opacity"
                style={{ background: 'var(--color-primary)' }}
              >
                {completing ? 'Saving…' : 'Complete session'}
              </button>
            </div>
          </>
        )}

        {/* Completion screen */}
        {stage === 'complete' && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-xl"
              style={{ background: 'var(--color-bg)', border: '2px solid var(--color-primary)' }}
            >
              ✓
            </div>
            <div>
              <p className="text-base font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
                Session complete
              </p>
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                Well done for taking this time with yourself.
              </p>
            </div>
            {completedData?.summary && (
              <div
                className="rounded-xl px-4 py-3 text-xs text-left w-full max-w-sm"
                style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
              >
                <span className="font-medium" style={{ color: 'var(--color-text)' }}>You noted: </span>
                {completedData.summary}
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-2 px-5 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
              style={{ background: 'var(--color-primary)' }}
            >
              Done
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
