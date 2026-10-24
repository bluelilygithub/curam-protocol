import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { useChat } from '../hooks/useChat';
import { useIcon } from '../providers/IconProvider';
import useToastStore from '../store/toastStore';
import Tooltip from '../components/Tooltip';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import NotesTutorChat from './notes/NotesTutorChat';
import { startTalkTour } from '../utils/tours/talkTour';
import useSpeaker from './talk/useSpeaker';
import useTurnListener from './talk/useTurnListener';
import TalkReviewPanel from './talk/TalkReviewPanel';
import { TALK_TIPS } from './talk/talkTips.mjs';
import { TALK_INTRO, HOW_TALK_WORKS, TALK_NOT } from './talk/talkInfo.mjs';
import { toSpeakable, isIOS, readPrefs, savePrefs, stateLabel } from './talk/talkUtils.mjs';

/**
 * Talk it through (docs/talk.md): speak a question, hear the answer, go on, and when you end it get a note with a summary and everything that was said.
 * It is an ordinary Chat session underneath (same model, history, Chat History, "My notes"), asked to reply as speech; this screen is only the
 * hands-free loop around it:  tap and talk -> pause -> sent -> the reply is spoken -> (listens again by itself, or waits for a tap).
 * The browser's own speech recognition and voice are used, so it costs nothing extra and nothing is installed.
 */
export default function TalkPage() {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const info = useToolInfoModal('vault_talk_info_seen'); // the (i) box opens by itself the first time, like the other tools
  const addToast = useToastStore((s) => s.addToast);
  const ios = useMemo(() => (typeof navigator !== 'undefined' ? isIOS(navigator) : false), []);
  const [prefs, setPrefsState] = useState(() => readPrefs(typeof localStorage !== 'undefined' ? localStorage : null, ios));
  const [typed, setTyped] = useState('');
  const [showType, setShowType] = useState(false);
  const [ending, setEnding] = useState(false);
  const [proposal, setProposal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);

  const { messages, isStreaming, sessionId, sendMessage, stopStreaming, streamError, clearStreamError } = useChat({ projectId: undefined });
  const speaker = useSpeaker();

  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const endedRef = useRef(false); // set while ending, so nothing starts listening or speaking again
  const wakeRef = useRef(null);
  const scrollRef = useRef(null);
  const prevStreaming = useRef(false);

  const setPref = (patch) => {
    const next = { ...prefsRef.current, ...patch };
    setPrefsState(next);
    savePrefs(typeof localStorage !== 'undefined' ? localStorage : null, next);
  };

  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Settings -> Tours -> Talk Tour opens /talk?tour=1
  useEffect(() => {
    if (!searchParams.get('tour')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('tour');
    setSearchParams(next, { replace: true });
    setTimeout(() => startTalkTour(), 500);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- sending a turn ----
  const submit = useCallback(async (text) => {
    const t = String(text || '').trim();
    if (!t || endedRef.current) return;
    clearStreamError();
    speaker.cancel();
    await sendMessage(t, [], [], null, [], 0.7, null, false, [], false, prefsRef.current.useNotes, true);
  }, [sendMessage, speaker, clearStreamError]);

  const listener = useTurnListener({ onUtterance: submit });

  // ---- when a reply has finished arriving: say it, then listen again if asked to ----
  const listenAgain = useCallback(() => {
    if (!endedRef.current && prefsRef.current.autoListen && listener.supported) listener.listen();
  }, [listener]);

  useEffect(() => {
    if (prevStreaming.current && !isStreaming && !endedRef.current) {
      const last = messagesRef.current[messagesRef.current.length - 1];
      const spoken = last?.role === 'assistant' ? toSpeakable(last.content) : '';
      if (spoken && prefsRef.current.readAloud && speaker.supported) speaker.speak(spoken, listenAgain);
      else if (spoken) listenAgain();
    }
    prevStreaming.current = isStreaming;
  }, [isStreaming]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the newest line in view
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, listener.interim]);

  // keep the screen on while talking: a phone that locks its screen stops listening
  useEffect(() => {
    const hold = async () => { try { if (navigator.wakeLock && !wakeRef.current) wakeRef.current = await navigator.wakeLock.request('screen'); } catch { /* the screen may lock */ } };
    hold();
    const onVisible = () => { if (document.visibilityState === 'visible') { wakeRef.current = null; hold(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); try { wakeRef.current?.release(); } catch { /* already released */ } wakeRef.current = null; };
  }, []);

  // ---- the big button ----
  const phase = listener.listening ? 'listening' : isStreaming ? 'thinking' : speaker.speaking ? 'speaking' : 'idle';
  function onMic() {
    if (!listener.supported) { setShowType(true); return; }
    if (phase === 'listening') listener.stop();            // use what was heard so far
    else if (phase === 'speaking') { speaker.cancel(); listener.listen(); } // talk over it
    else if (phase === 'thinking') stopStreaming();
    else listener.listen();
  }

  // ---- ending ----
  async function endConversation() {
    if (!sessionId) { addToast('Say something first, then end the conversation.', 'error'); return; }
    endedRef.current = true;
    speaker.cancel();
    listener.abort();
    setEnding(true);
    try {
      // The chat saves its messages just after the reply finishes: try again once if it has not yet.
      let res = await api.post('/api/notes/from-conversation', { sessionId });
      if (res.status === 400) { await new Promise((r) => setTimeout(r, 1500)); res = await api.post('/api/notes/from-conversation', { sessionId }); }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The note could not be made.');
      setProposal(data);
    } catch (err) {
      endedRef.current = false;
      addToast(err.message || 'The note could not be made. Try again.', 'error');
    } finally {
      setEnding(false);
    }
  }

  async function saveNote(fields) {
    setSaving(true);
    try {
      const res = await api.post('/api/notes', fields);
      const note = await res.json().catch(() => ({}));
      if (!res.ok || !note?.id) throw new Error('save failed');
      addToast('Saved to Notes ✓', 'success');
      navigate(`/notes?note=${note.id}`);
    } catch {
      addToast('The note could not be saved. Try again.', 'error');
      setSaving(false);
    }
  }

  function keepTalking() { endedRef.current = false; setProposal(null); }
  function discard() { navigate('/notes'); }

  const heard = messages.filter((m) => m.content);
  const canEnd = !!sessionId && heard.some((m) => m.role === 'assistant') && !isStreaming;
  const micColour = phase === 'listening' ? '#ef4444' : 'var(--color-primary)';
  const toggle = (on) => ({ minHeight: mobile ? 40 : 30, background: on ? 'var(--color-primary)' : 'var(--color-bg)', color: on ? '#fff' : 'var(--color-text)', border: `1px solid ${on ? 'var(--color-primary)' : 'var(--color-border)'}` });

  return (
    <div className="flex flex-col h-full min-h-0" style={{ background: 'var(--color-bg)' }}>
      <style>{'@keyframes talkpulse { 0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.45); } 50% { box-shadow: 0 0 0 18px rgba(239,68,68,0); } }'}</style>

      <div className="flex items-center justify-between gap-2 px-4 py-3 flex-shrink-0 flex-wrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Talk it through</h1>
            <Tooltip text={TALK_TIPS.info}>
              <button type="button" data-tour="talk-info" onClick={info.open} aria-label="How Talk it through works" className="flex items-center justify-center transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-muted)', minWidth: mobile ? 32 : 20, minHeight: mobile ? 32 : 20 }}>{getIcon('info', { size: 14 })}</button>
            </Tooltip>
            <Tooltip text={TALK_TIPS.tour}>
              <button type="button" onClick={() => startTalkTour()} aria-label="Take the Talk it through tour" className="flex items-center justify-center transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-muted)', minWidth: mobile ? 32 : 20, minHeight: mobile ? 32 : 20 }}>{getIcon('compass', { size: 14 })}</button>
            </Tooltip>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Speak, listen, and keep the conversation as a note.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Talk settings" data-tour="talk-settings">
          <Tooltip text={TALK_TIPS.readAloud}><button type="button" aria-pressed={prefs.readAloud} onClick={() => { setPref({ readAloud: !prefs.readAloud }); if (prefs.readAloud) speaker.cancel(); }} className="text-xs px-3 rounded-full transition-opacity duration-200 hover:opacity-80" style={toggle(prefs.readAloud)}>Read aloud</button></Tooltip>
          <Tooltip text={TALK_TIPS.autoListen}><button type="button" aria-pressed={prefs.autoListen} onClick={() => setPref({ autoListen: !prefs.autoListen })} className="text-xs px-3 rounded-full transition-opacity duration-200 hover:opacity-80" style={toggle(prefs.autoListen)}>Listen again</button></Tooltip>
          <Tooltip text={TALK_TIPS.useNotes}><button type="button" aria-pressed={prefs.useNotes} onClick={() => setPref({ useNotes: !prefs.useNotes })} className="text-xs px-3 rounded-full transition-opacity duration-200 hover:opacity-80" style={toggle(prefs.useNotes)}>My notes</button></Tooltip>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3" aria-live="polite" aria-label="The conversation">
        {!heard.length && !listener.interim && (
          <p className="text-sm text-center pt-8" style={{ color: 'var(--color-muted)' }}>
            {ios ? 'Tap the button, say your question, then pause. The reply is spoken. Tap again to go on.' : 'Tap the button and ask your question. The reply is spoken, and it listens again so you can answer back.'}
          </p>
        )}
        {heard.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap" style={{ background: m.role === 'user' ? 'var(--color-primary)' : 'var(--color-surface)', color: m.role === 'user' ? '#fff' : 'var(--color-text)', border: m.role === 'user' ? 'none' : '1px solid var(--color-border)', fontSize: mobile ? 16 : 14, lineHeight: 1.5 }}>{m.content}</div>
          </div>
        ))}
        {listener.interim && (
          <div className="flex justify-end"><div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm" style={{ border: '1px dashed var(--color-primary)', color: 'var(--color-muted)', fontSize: mobile ? 16 : 14 }}>{listener.interim}</div></div>
        )}
        {(listener.error || streamError) && (
          <p className="text-xs text-center" style={{ color: '#ef4444' }} role="alert">{listener.error || streamError.message}</p>
        )}
      </div>

      <div className="flex-shrink-0 flex flex-col items-center gap-3 px-4 pt-3" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)', paddingBottom: mobile ? 'max(16px, env(safe-area-inset-bottom))' : 16 }}>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }} aria-live="polite">{stateLabel(phase, { autoListen: prefs.autoListen, supported: listener.supported })}</p>
        <Tooltip text={phase === 'thinking' ? TALK_TIPS.stop : TALK_TIPS.mic}>
          <button
            type="button" onClick={onMic} data-tour="talk-mic" aria-label={phase === 'listening' ? 'Stop listening and send' : phase === 'thinking' ? 'Stop the reply' : phase === 'speaking' ? 'Interrupt and talk' : 'Talk'}
            className="flex items-center justify-center rounded-full transition-opacity duration-200 hover:opacity-90"
            style={{ width: mobile ? 112 : 88, height: mobile ? 112 : 88, background: micColour, color: '#fff', animation: phase === 'listening' ? 'talkpulse 1.4s ease-in-out infinite' : undefined, opacity: phase === 'thinking' ? 0.7 : 1 }}
          >
            {phase === 'thinking' ? getIcon('loader', { size: mobile ? 40 : 32, className: 'animate-spin' }) : phase === 'speaking' ? getIcon('volume-2', { size: mobile ? 40 : 32 }) : getIcon('mic', { size: mobile ? 44 : 34 })}
          </button>
        </Tooltip>

        <div className="flex flex-wrap items-center justify-center gap-2 w-full">
          <Tooltip text={TALK_TIPS.type}>
            <button type="button" data-tour="talk-type" onClick={() => setShowType((v) => !v)} aria-expanded={showType} className="text-xs underline hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-primary)', minHeight: mobile ? 40 : 28 }}>{showType ? 'Hide typing' : 'Type instead'}</button>
          </Tooltip>
          <Tooltip text={TALK_TIPS.end}>
            <button type="button" data-tour="talk-end" disabled={!canEnd || ending} onClick={endConversation} className="px-4 rounded-lg text-sm font-medium hover:opacity-80 transition-opacity duration-200 disabled:opacity-40" style={{ minHeight: mobile ? 44 : 34, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}>{ending ? 'Writing it up…' : 'End conversation'}</button>
          </Tooltip>
        </div>
        {showType && (
          <form className="flex gap-2 w-full max-w-xl" onSubmit={(e) => { e.preventDefault(); const t = typed; setTyped(''); submit(t); }}>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your question…" aria-label="Type your question" className="flex-1 min-w-0 rounded-lg px-3" style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', fontSize: 16, minHeight: mobile ? 48 : 38 }} />
            <button type="submit" disabled={!typed.trim() || isStreaming} className="px-4 rounded-lg text-sm font-medium hover:opacity-80 transition-opacity duration-200 disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff', minHeight: mobile ? 48 : 38 }}>Send</button>
          </form>
        )}
      </div>

      {info.show && (
        <ToolInfoModal title="How Talk it through works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>{TALK_INTRO}</p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_TALK_WORKS.map(([heading, text]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
            ))}
          </div>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>{TALK_NOT}</p>
        </ToolInfoModal>
      )}
      {/* the Notes guide knows Talk it through: Open buttons for Notes controls take the person to Notes */}
      <NotesTutorChat currentTool="talk" onOpenTool={(id) => { if (id !== 'talk') navigate('/notes'); }} />
      {proposal && <TalkReviewPanel proposal={proposal} mobile={mobile} saving={saving} onSave={saveNote} onKeepTalking={keepTalking} onDiscard={discard} />}
    </div>
  );
}
