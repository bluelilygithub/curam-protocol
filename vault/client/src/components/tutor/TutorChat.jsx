import React, { useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import { VoiceInput } from '../voiceInput/VoiceInput';
import useDraggable from '../../hooks/useDraggable';
import Tooltip from '../Tooltip';
import useAuthStore from '../../store/authStore';

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
 *   guideId,                         // 'pdf' | 'graphics' | 'video' | 'finance': which guide an emailed conversation came from
 *   positionKey,                     // optional: localStorage key stem for where the button and chat were dragged to
 * }
 *
 * After at least one answer, "Email this conversation" lets the person send the log to themselves and/or the workspace admin
 * (POST /api/tutor-email, server/routes/tutorEmail.js). Nothing is sent unless they press Send.
 *
 * Both the round button and the open chat can be dragged out of the way (hooks/useDraggable.js): drag the button, or the chat's
 * title bar; double-click the title bar to put the chat back. Positions are remembered in this browser only.
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
  // Emailing the conversation: panel open?, who to, and the outcome
  const user = useAuthStore((s) => s.user);
  const [emailOpen, setEmailOpen] = useState(false);
  const [toMe, setToMe] = useState(true);
  const [toAdmin, setToAdmin] = useState(true);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailStatus, setEmailStatus] = useState(null); // { kind: 'ok'|'error', text }
  // Where the button and the chat were dragged to (this browser only). Pages need not configure anything.
  const posKey = config.positionKey || (config.wideKey ? config.wideKey.replace(/:wide$/, '') : 'vault:guide');
  const buttonDrag = useDraggable({ storageKey: `${posKey}:pos-button` });
  const panelDrag = useDraggable({
    storageKey: `${posKey}:pos-panel`,
    ignore: 'button, input, textarea, select, a, [data-nodrag]',
    resetOnDoubleClick: true,
  });
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
      setEmailStatus(null);
    } catch (err) {
      setTurns([...next, { role: 'error', text: err.message }]);
    } finally {
      setBusy(false);
    }
  };

  const canEmail = !!config.guideId && !busy && turns.some((t) => t.role === 'assistant');

  const emailLog = async () => {
    if (emailBusy || (!toMe && !toAdmin)) return;
    setEmailBusy(true);
    setEmailStatus(null);
    try {
      const log = turns.filter((t) => t.role === 'user' || t.role === 'assistant').map((t) => (t.role === 'user'
        ? { role: 'user', text: t.text }
        : { role: 'guide', verdictLabel: config.verdicts[t.reply.verdict]?.label || '', answer: t.reply.answer, steps: (t.reply.steps || []).map((s) => ({ label: s.label, do: s.do })), missing: t.reply.missing, tip: t.reply.tip }));
      const res = await api.post('/api/tutor-email', { guide: config.guideId, turns: log, toMe, toAdmin });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The conversation could not be emailed.');
      const who = [data.me ? 'you' : '', data.admins ? (data.admins === 1 ? 'the admin' : `${data.admins} admins`) : ''].filter(Boolean).join(' and ');
      setEmailStatus({ kind: 'ok', text: `Sent to ${who || 'the recipients'}.` });
      setEmailOpen(false);
    } catch (err) {
      setEmailStatus({ kind: 'error', text: err.message });
    } finally {
      setEmailBusy(false);
    }
  };

  if (!open) {
    return (
      <Tooltip text={`${config.buttonTip} Drag it if it is in the way.`}>
        <button
          type="button"
          ref={buttonDrag.ref}
          {...buttonDrag.handleProps}
          onClick={buttonDrag.guardClick(() => setOpen(true))}
          aria-label={`Open the ${config.name}`}
          className="fixed bottom-5 right-5 z-30 w-12 h-12 rounded-full flex items-center justify-center text-white shadow-lg hover:opacity-80 transition-opacity duration-200"
          style={{ ...buttonDrag.handleProps.style, ...buttonDrag.style, background: 'var(--color-primary)' }}
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
      ref={panelDrag.ref}
      className="fixed bottom-5 right-5 z-40 flex flex-col rounded-2xl border shadow-xl h-[80vh] transition-[width] duration-200"
      style={{
        ...panelDrag.style,
        // 80% of the screen height (dvh where supported, the vh class above where not); never taller than the screen.
        height: '80dvh',
        maxHeight: 'calc(100dvh - 2.5rem)',
        width: wide ? 'min(700px, calc(100vw - 2rem))' : 'min(390px, calc(100vw - 2rem))',
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
      }}
    >
      {/* The title bar is the drag handle (its buttons and links still just click). Double-click puts the chat back. */}
      <div
        className="flex items-center gap-2 px-4 py-3 border-b rounded-t-2xl"
        {...panelDrag.handleProps}
        style={{ ...panelDrag.handleProps.style, borderColor: 'var(--color-border)' }}
      >
        <Tooltip text="Drag this bar to move the guide out of the way. Double-click it to put it back.">
          <span aria-hidden="true" style={{ color: 'var(--color-muted)' }}>{getIcon('grip-vertical', { size: 14 })}</span>
        </Tooltip>
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
            <button type="button" onClick={() => { setTurns([]); setEmailOpen(false); setEmailStatus(null); }} className="text-[11px] hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>Clear</button>
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

      {canEmail && (
        <div className="px-3 pt-2 border-t text-xs" style={{ borderColor: 'var(--color-border)' }}>
          {!emailOpen ? (
            <div className="flex items-center gap-2 flex-wrap">
              <Tooltip text="Send a copy of this conversation by email: to yourself, to the admin, or both. Nothing is sent until you press Send.">
                <button
                  type="button"
                  onClick={() => { setEmailOpen(true); setEmailStatus(null); }}
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium underline underline-offset-2 hover:opacity-60 transition-opacity"
                  style={{ color: 'var(--color-primary)' }}
                >
                  {getIcon('mail', { size: 13 })}
                  Email this conversation
                </button>
              </Tooltip>
              {emailStatus?.kind === 'ok' && <span role="status" style={{ color: '#16a34a' }}>{emailStatus.text}</span>}
            </div>
          ) : (
            <div className="space-y-2 rounded-xl border p-2.5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <p className="font-semibold" style={{ color: 'var(--color-text)' }}>Email this conversation to:</p>
              <Tooltip text="Send a copy to the email address on your account.">
                <label className="flex items-center gap-2 cursor-pointer" style={{ color: 'var(--color-text)' }}>
                  <input type="checkbox" checked={toMe} onChange={(e) => setToMe(e.target.checked)} />
                  <span className="min-w-0 break-words">Me{user?.email ? ` (${user.email})` : ''}</span>
                </label>
              </Tooltip>
              <Tooltip text="Send a copy to the workspace admin. They can reply to you directly from it.">
                <label className="flex items-center gap-2 cursor-pointer" style={{ color: 'var(--color-text)' }}>
                  <input type="checkbox" checked={toAdmin} onChange={(e) => setToAdmin(e.target.checked)} />
                  <span>The admin</span>
                </label>
              </Tooltip>
              <div className="flex items-center gap-2">
                <Tooltip text="Email the whole conversation to the people ticked above.">
                  <button
                    type="button"
                    onClick={emailLog}
                    disabled={emailBusy || (!toMe && !toAdmin)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-white hover:opacity-80 transition-opacity disabled:opacity-40"
                    style={{ background: 'var(--color-primary)' }}
                  >
                    {emailBusy ? 'Sending…' : 'Send'}
                  </button>
                </Tooltip>
                <Tooltip text="Close this without sending anything.">
                  <button type="button" onClick={() => setEmailOpen(false)} className="text-[11px] hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>Cancel</button>
                </Tooltip>
              </div>
              {emailStatus?.kind === 'error' && <p role="alert" style={{ color: '#ef4444' }}>{emailStatus.text}</p>}
            </div>
          )}
        </div>
      )}

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
