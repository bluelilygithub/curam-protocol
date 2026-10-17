import React, { useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import { VoiceInput, VoiceInputProvider } from '../../components/voiceInput/VoiceInput';
import Tooltip from '../../components/Tooltip';

/**
 * The Finance guide: a button in the Finance header that opens a small chat. Ask, in your own words, where to do something in
 * Finance or how part of it works; it points at the real tabs (with an "Open" button for each step), says when Finance does not
 * do something, or says the question is one for your accountant. It cannot see your books, never gives tax advice, and never
 * acts on its own: it only points.
 *
 * Wrapped in an error boundary so a fault in the guide can never take the Finance page down with it.
 */

const STARTERS = [
  'Where do I record money I put into the business myself?',
  'I took money out for myself. Is that a wage or a drawing?',
  'Why can I not edit an invoice?',
  'How do I give my accountant everything for the year?',
];

// Status colours are deliberately outside the theme (see client/DESIGN.md).
const VERDICT = {
  doable: { label: 'You can do this', color: '#16a34a' },
  partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
  missing: { label: 'Finance does not do this yet', color: '#f59e0b' },
  beyond: { label: 'Beyond Finance', color: null },
  accountant: { label: 'A question for your accountant', color: '#2563eb' },
};

function historyText(reply) {
  const steps = (reply.steps || []).map((s, i) => `${i + 1}. ${s.label}: ${s.do}`).join(' ');
  return [reply.answer, steps, reply.missing ? `Missing: ${reply.missing}` : ''].filter(Boolean).join(' ');
}

function Reply({ reply, onOpenTab }) {
  const v = VERDICT[reply.verdict];
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
                <Tooltip text={`Open the ${s.label} tab. This chat stays open so you can keep following the steps.`}>
                  <button
                    type="button"
                    onClick={() => onOpenTab(s.tool)}
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

function TutorInner({ currentTab, onOpenTab }) {
  const getIcon = useIcon();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState([]); // { role: 'user', text } | { role: 'assistant', reply } | { role: 'error', text }
  const endRef = useRef(null);

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
      const res = await api.post('/api/finance-tutor', { messages, currentTab });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The Finance guide could not answer just now.');
      setTurns([...next, { role: 'assistant', reply: data }]);
    } catch (err) {
      setTurns([...next, { role: 'error', text: err.message }]);
    } finally {
      setBusy(false);
    }
  };

  const button = (
    <Tooltip text="Ask the Finance guide where to do something, or how part of Finance works. It cannot see your books and does not give tax advice.">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Open the Finance guide"
        aria-expanded={open}
        className="w-5 h-5 flex items-center justify-center rounded-full border hover:opacity-60 transition-opacity flex-shrink-0"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
      >
        {getIcon('graduation-cap', { size: 12 })}
      </button>
    </Tooltip>
  );

  if (!open) return button;

  return (
    <>
      {button}
      <div
        role="dialog"
        aria-label="Finance guide"
        className="fixed bottom-5 right-5 z-40 flex flex-col rounded-2xl border shadow-xl"
        style={{
          height: '80dvh',
          maxHeight: 'calc(100dvh - 2.5rem)',
          width: 'min(420px, calc(100vw - 2rem))',
          background: 'var(--color-surface)',
          borderColor: 'var(--color-border)',
        }}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <span style={{ color: 'var(--color-primary)' }}>{getIcon('graduation-cap', { size: 18 })}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight" style={{ color: 'var(--color-text)' }}>Finance guide</p>
            <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>Where to do things, and how Finance works</p>
          </div>
          {turns.length > 0 && (
            <Tooltip text="Clear this conversation and start again.">
              <button type="button" onClick={() => setTurns([])} className="text-[11px] hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>Clear</button>
            </Tooltip>
          )}
          <Tooltip text="Close the guide. Your conversation is kept until you leave this page.">
            <button type="button" onClick={() => setOpen(false)} aria-label="Close the Finance guide" className="hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>
              {getIcon('x', { size: 18 })}
            </button>
          </Tooltip>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" aria-live="polite">
          {turns.length === 0 && (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>
                Ask me where to do something in Finance, or how part of it works. I cannot see your figures, and I do not give tax advice: for anything about tax, GST or how something should be treated, I will tell you to ask your accountant.
              </p>
              <div className="flex flex-col gap-1.5">
                {STARTERS.map((s) => (
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
                <Reply reply={t.reply} onOpenTab={onOpenTab} />
              </div>
            );
          })}
          {busy && <p className="text-xs italic" style={{ color: 'var(--color-muted)' }}>Checking Finance…</p>}
          <div ref={endRef} />
        </div>

        <div className="p-3 border-t flex items-end gap-2" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex-1 min-w-0">
            <VoiceInput
              type="textarea"
              append
              rows={3}
              value={input}
              onChange={setInput}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)"
              label="Ask the Finance guide"
              className="!text-xs"
            />
          </div>
          <Tooltip text="Send your question to the Finance guide.">
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
    </>
  );
}

class Guard extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* the guide is optional; the page carries on without it */ }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function FinanceTutorChat(props) {
  return (
    <Guard>
      <VoiceInputProvider lang="en-AU">
        <TutorInner {...props} />
      </VoiceInputProvider>
    </Guard>
  );
}
