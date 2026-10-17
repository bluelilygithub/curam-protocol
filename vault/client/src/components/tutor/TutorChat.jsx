import React, { useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import { VoiceInput } from '../voiceInput/VoiceInput';
import Tooltip from '../Tooltip';

/**
 * The shared "guide" chat used by Video Tools and Finance (and any page that gets one later): a round button fixed at the bottom
 * right that opens a small chat. The person types (or speaks) what they want to do; the server answers with a verdict and an
 * ordered list of steps, each with an "Open" button that opens that tab/tool in the page. It never acts on its own; it only points.
 *
 * Pages do not copy this file. They pass their wording and endpoint in `config` (see client/src/pages/videos/TutorChat.jsx and
 * client/src/pages/finance/FinanceTutorChat.jsx), so every guide looks and behaves the same. Server side, the same shape is
 * produced by server/services/videoTutor.js and financeTutor.js ({ verdict, answer, steps:[{tool,label,do}], missing, tip }).
 *
 * Must sit inside a VoiceInputProvider (for the microphone); the page or the wrapper supplies it.
 *
 * config: {
 *   endpoint, payloadKey,            // POST endpoint, and the key the current tool/tab is sent under
 *   name, subtitle, intro, starters, // header, first message, example questions
 *   verdicts,                        // { verdict: { label, color|null } }
 *   what,                            // "tool" | "tab", used in the Open tooltip
 *   buttonTip, openTip(label), busyText, placeholder, inputLabel, errorText,
 *   wideKey,                         // localStorage key remembering wide/narrow
 * }
 */

function historyText(reply) {
  const steps = (reply.steps || []).map((s, i) => `${i + 1}. ${s.label}: ${s.do}`).join(' ');
  return [reply.answer, steps, reply.missing ? `Missing: ${reply.missing}` : ''].filter(Boolean).join(' ');
}

function Reply({ reply, onOpen, config }) {
  const v = config.verdicts[reply.verdict];
  return (
    <div className="space-y-2">
      {v && (
        <span
          className="inline-block text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border"
          style={{ color: v.color || 'var(--color-muted)', borderColor: v.color || 'var(--color-border)' }}
        >
          {v.label}
        </span>
      )}
      {reply.answer && <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>{reply.answer}</p>}
      {reply.steps?.length > 0 && (
        <ol className="space-y-2">
          {reply.steps.map((s, i) => (
            <li key={`${s.tool}-${i}`} className="flex gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
              <span className="flex-shrink-0 w-5 h-5 rounded-full text-[10px] font-semibold flex items-center justify-center text-white" style={{ background: 'var(--color-primary)' }}>{i + 1}</span>
              <span className="min-w-0 flex-1">
                <strong>{s.label}</strong>
                <span className="block" style={{ color: 'var(--color-muted)' }}>{s.do}</span>
                <Tooltip text={config.openTip(s.label)}>
                  <button
                    type="button"
                    onClick={() => onOpen(s.tool)}
                    className="mt-1 text-[11px] font-medium underline underline-offset-2 hover:opacity-60 transition-opacity"
                    style={{ color: 'var(--color-primary)' }}
                  >
                    Open {s.label} →
                  </button>
                </Tooltip>
              </span>
            </li>
          ))}
        </ol>
      )}
      {reply.missing && (
        <p className="text-xs rounded-lg border px-2 py-1.5" style={{ borderColor: '#f59e0b', color: 'var(--color-text)' }}>
          <strong>What is missing:</strong> {reply.missing}
          <span className="block text-[10px]" style={{ color: 'var(--color-muted)' }}>I have noted this in your Suggestions inbox.</span>
        </p>
      )}
      {reply.tip && <p className="text-[11px] italic" style={{ color: 'var(--color-muted)' }}>Tip: {reply.tip}</p>}
    </div>
  );
}

function TutorInner({ config, current, onOpen }) {
  const getIcon = useIcon();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState([]); // { role: 'user', text } | { role: 'assistant', reply } | { role: 'error', text }
  const endRef = useRef(null);
  // Wider/narrower is remembered in this browser only (a convenience, never needed for the page to work).
  const [wide, setWide] = useState(() => {
    try { return localStorage.getItem(config.wideKey) === '1'; } catch { return false; }
  });
  const toggleWide = () => {
    setWide((w) => {
      try { localStorage.setItem(config.wideKey, w ? '0' : '1'); } catch { /* storage unavailable */ }
      return !w;
    });
  };

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [turns, busy, open]);

  const send = async (textArg) => {
    const text = String(textArg ?? input).trim();
    if (!text || busy) return;
    const next = [...turns, { role: 'user', text }];
    setTurns(next);
    setInput('');
    setBusy(true);
    try {
      const messages = next
        .filter((t) => t.role === 'user' || t.role === 'assistant')
        .map((t) => ({ role: t.role, content: t.role === 'user' ? t.text : historyText(t.reply) }));
      const res = await api.post(config.endpoint, { messages, [config.payloadKey]: current });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || config.errorText);
      setTurns([...next, { role: 'assistant', reply: data }]);
    } catch (err) {
      setTurns([...next, { role: 'error', text: err.message }]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Tooltip text={config.buttonTip}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Open the ${config.name}`}
          className="fixed bottom-5 right-5 z-30 w-12 h-12 rounded-full flex items-center justify-center text-white shadow-lg hover:opacity-80 transition-opacity duration-200"
          style={{ background: 'var(--color-primary)' }}
        >
          {getIcon('graduation-cap', { size: 22 })}
        </button>
      </Tooltip>
    );
  }

  return (
    <div
      role="dialog"
      aria-label={config.name}
      className="fixed bottom-5 right-5 z-40 flex flex-col rounded-2xl border shadow-xl h-[80vh] transition-[width] duration-200"
      style={{
        // 80% of the screen height (dvh where supported, the vh class above where not); never taller than the screen.
        height: '80dvh',
        maxHeight: 'calc(100dvh - 2.5rem)',
        width: wide ? 'min(700px, calc(100vw - 2rem))' : 'min(390px, calc(100vw - 2rem))',
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
      }}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <span style={{ color: 'var(--color-primary)' }}>{getIcon('graduation-cap', { size: 18 })}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight" style={{ color: 'var(--color-text)' }}>{config.name}</p>
          <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>{config.subtitle}</p>
        </div>
        <Tooltip text={wide ? `Make the ${config.shortName} narrower again.` : `Make the ${config.shortName} wider, so there is more room to read and to speak into.`}>
          <button
            type="button"
            onClick={toggleWide}
            aria-label={wide ? `Make the ${config.shortName} narrower` : `Make the ${config.shortName} wider`}
            aria-pressed={wide}
            className="hover:opacity-60 transition-opacity duration-200"
            style={{ color: 'var(--color-muted)' }}
          >
            {getIcon(wide ? 'minimize-2' : 'maximize-2', { size: 16 })}
          </button>
        </Tooltip>
        {turns.length > 0 && (
          <Tooltip text="Clear this conversation and start again.">
            <button type="button" onClick={() => setTurns([])} className="text-[11px] hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>Clear</button>
          </Tooltip>
        )}
        <Tooltip text={`Close the ${config.shortName}. Your conversation is kept until you leave this page.`}>
          <button type="button" onClick={() => setOpen(false)} aria-label={`Close the ${config.shortName}`} className="hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>
            {getIcon('x', { size: 18 })}
          </button>
        </Tooltip>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" aria-live="polite">
        {turns.length === 0 && (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>{config.intro}</p>
            <div className="flex flex-col gap-1.5">
              {config.starters.map((s) => (
                <Tooltip key={s} text="Ask this question.">
                  <button
                    type="button"
                    onClick={() => send(s)}
                    className="text-left text-xs px-3 py-2 rounded-xl border hover:opacity-70 transition-opacity"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' }}
                  >
                    {s}
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => {
          if (t.role === 'user') {
            return (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] text-xs px-3 py-2 rounded-2xl rounded-br-sm text-white" style={{ background: 'var(--color-primary)' }}>{t.text}</p>
              </div>
            );
          }
          if (t.role === 'error') {
            return <p key={i} className="text-xs" role="alert" style={{ color: '#ef4444' }}>{t.text}</p>;
          }
          return (
            <div key={i} className="max-w-[95%] px-3 py-2 rounded-2xl rounded-bl-sm border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <Reply reply={t.reply} onOpen={onOpen} config={config} />
            </div>
          );
        })}
        {busy && <p className="text-xs italic" style={{ color: 'var(--color-muted)' }}>{config.busyText}</p>}
        <div ref={endRef} />
      </div>

      <div className="p-3 border-t flex items-end gap-2" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex-1 min-w-0">
          {/* A taller, multi-line box: what you say is added to the end of what is already there, and you can see all of it. */}
          <VoiceInput
            type="textarea"
            append
            rows={4}
            value={input}
            onChange={setInput}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={config.placeholder}
            label={config.inputLabel}
            className="!text-xs"
          />
        </div>
        <Tooltip text={`Send your question to the ${config.shortName}.`}>
          <button
            type="button"
            onClick={() => send()}
            disabled={!input.trim() || busy}
            aria-label="Send"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white hover:opacity-80 transition-opacity disabled:opacity-40"
            style={{ background: 'var(--color-primary)' }}
          >
            {getIcon('send', { size: 16 })}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

// A fault in a guide must never take its page down: the guide is optional, the page carries on without it.
class Guard extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* nothing to do */ }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function TutorChat(props) {
  return (
    <Guard>
      <TutorInner {...props} />
    </Guard>
  );
}
