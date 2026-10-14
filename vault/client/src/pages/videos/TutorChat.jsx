import React, { useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import Tooltip from '../../components/Tooltip';

/**
 * The Video Tools tutor: a floating button that opens a small chat. Type (or use the microphone) what you want to make; the
 * tutor says which of the real tools to use, in what order, with an "Open" button for each step, or says that a tool is
 * missing, or that the job is beyond Video Tools. It never acts on its own; it only points at tools.
 *
 * Must sit inside the page's VoiceInputProvider (for the microphone). `onOpenTool(id)` opens a tool in the page.
 */

const STARTERS = [
  'Cut a 12 second clip out of a long video',
  'Put my script on a video as captions',
  'Get the speech out of audio that has music',
  'Join four clips into one video',
];

// Status colours are deliberately outside the theme (see client/DESIGN.md).
const VERDICT = {
  doable: { label: 'You can do this', color: '#16a34a' },
  partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
  missing: { label: 'A tool is missing', color: '#f59e0b' },
  beyond: { label: 'Beyond Video Tools', color: null },
};

function historyText(reply) {
  const steps = (reply.steps || []).map((s, i) => `${i + 1}. ${s.label}: ${s.do}`).join(' ');
  return [reply.answer, steps, reply.missing ? `Missing: ${reply.missing}` : ''].filter(Boolean).join(' ');
}

function Reply({ reply, onOpenTool }) {
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
                <Tooltip text={`Open ${s.label} in the Video Tools list. This chat stays open so you can keep following the steps.`}>
                  <button
                    type="button"
                    onClick={() => onOpenTool(s.tool)}
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

export default function TutorChat({ currentTool, onOpenTool }) {
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
      const res = await api.post('/api/videos/tutor', { messages, currentTool });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The tutor could not answer just now.');
      setTurns([...next, { role: 'assistant', reply: data }]);
    } catch (err) {
      setTurns([...next, { role: 'error', text: err.message }]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Tooltip text="Ask the Video Tools tutor. Tell it what you want to make, by typing or talking, and it tells you which tools to use and in what order.">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open the Video Tools tutor"
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
      aria-label="Video Tools tutor"
      className="fixed bottom-5 right-5 z-40 flex flex-col rounded-2xl border shadow-xl"
      style={{
        width: 'min(390px, calc(100vw - 2rem))',
        height: 'min(580px, calc(100dvh - 6rem))',
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
      }}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <span style={{ color: 'var(--color-primary)' }}>{getIcon('graduation-cap', { size: 18 })}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight" style={{ color: 'var(--color-text)' }}>Video Tools tutor</p>
          <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>Tell me what you want to make</p>
        </div>
        {turns.length > 0 && (
          <Tooltip text="Clear this conversation and start again.">
            <button type="button" onClick={() => setTurns([])} className="text-[11px] hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>Clear</button>
          </Tooltip>
        )}
        <Tooltip text="Close the tutor. Your conversation is kept until you leave this page.">
          <button type="button" onClick={() => setOpen(false)} aria-label="Close the tutor" className="hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>
            {getIcon('x', { size: 18 })}
          </button>
        </Tooltip>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" aria-live="polite">
        {turns.length === 0 && (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>
              Hi! Tell me what you want to do with your video or audio, in your own words. I will check the tools we have, and give you the steps. If a tool is missing, or the job is outside Video Tools, I will say so.
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
              <Reply reply={t.reply} onOpenTool={onOpenTool} />
            </div>
          );
        })}
        {busy && <p className="text-xs italic" style={{ color: 'var(--color-muted)' }}>Checking the tools…</p>}
        <div ref={endRef} />
      </div>

      <div className="p-3 border-t flex items-center gap-2" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex-1 min-w-0">
          <VoiceInput
            value={input}
            onChange={setInput}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Type or tap the mic: what do you want to do?"
            label="Ask the tutor"
            className="!text-xs"
          />
        </div>
        <Tooltip text="Send your question to the tutor.">
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
