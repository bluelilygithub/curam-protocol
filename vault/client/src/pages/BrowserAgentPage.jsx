import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import useAuthStore from '../store/authStore';
import { useIcon } from '../providers/IconProvider';
import { useVoice } from '../hooks/useVoice';
import api from '../utils/apiClient';

const MD_COMPONENTS = {
  p: ({ children }) => <span>{children}</span>,
  ul: ({ children }) => <ul className="list-disc pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4">{children}</ol>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline">{children}</a>,
};

const PROFILE_FIELDS = [
  { key: 'user_name', label: 'Name' },
  { key: 'user_city', label: 'City' },
  { key: 'user_state', label: 'State' },
  { key: 'browser_agent_phone', label: 'Phone' },
  { key: 'browser_agent_email', label: 'Email' },
  { key: 'browser_agent_address', label: 'Address' },
];

export default function BrowserAgentPage() {
  const getIcon = useIcon();
  const token = useAuthStore((s) => s.token);
  const voice = useVoice();
  const [instruction, setInstruction] = useState('');
  const [log, setLog] = useState([]);
  const [control, setControl] = useState('idle'); // idle | agent | user | review
  const [who, setWho] = useState('Ready');
  const [hint, setHint] = useState('Type or speak what you want done.');
  const [url, setUrl] = useState('No page open');
  const [question, setQuestion] = useState(null);
  const [answer, setAnswer] = useState('');
  const [connected, setConnected] = useState(false);
  const [profile, setProfile] = useState(null);

  const wsRef = useRef(null);
  const imgRef = useRef(null);
  const viewerRef = useRef(null);
  const micTargetRef = useRef(null); // 'instruction' | 'answer'
  const scrollDragRef = useRef(null); // { startY, startFrac } while dragging the scrollbar thumb
  const [scrollFrac, setScrollFrac] = useState(0.5); // no real scroll-position feed from the server, so this just tracks intent for the thumb's look

  useEffect(() => {
    api.get('/api/settings').then((res) => (res.ok ? res.json() : {})).then(setProfile).catch(() => setProfile({}));
  }, []);

  // Voice input: mic feeds whichever box was last focused (instruction or the
  // ask_user answer box), reusing the shared STT hook (same one CSS/Restyle uses).
  useEffect(() => {
    if (!voice.transcript) return;
    if (micTargetRef.current === 'answer') setAnswer(voice.transcript);
    else setInstruction((prev) => (prev ? `${prev} ${voice.transcript}` : voice.transcript));
  }, [voice.transcript]);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    let reconnectTimer = null;

    function connect() {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${window.location.host}/api/browser-agent/ws?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => { if (!cancelled) setConnected(true); };
      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        setControl('idle'); setWho('Disconnected'); setHint('Reconnecting…');
        reconnectTimer = setTimeout(connect, 1500);
      };
      ws.onmessage = (e) => {
        if (cancelled) return;
        const m = JSON.parse(e.data);
        if (m.type === 'frame') {
          if (imgRef.current) imgRef.current.src = 'data:image/jpeg;base64,' + m.data;
        } else if (m.type === 'url') {
          setUrl(m.url);
        } else if (m.type === 'log') {
          setLog((prev) => [...prev, { kind: m.kind, text: m.text }]);
        } else if (m.type === 'control') {
          if (m.who === 'agent') { setControl('agent'); setWho('Agent is driving'); setHint("Watch the browser. It won't press send."); }
          else setControl((c) => (c === 'review' ? c : 'user'));
        } else if (m.type === 'handoff') {
          setLog((prev) => [...prev, { kind: 'handoff', text: m.summary }]);
          setControl('review'); setWho('Your turn'); setHint("Drag the scrollbar to check the whole form, then press the site's own send button.");
        } else if (m.type === 'question') {
          setQuestion(m.text);
          setLog((prev) => [...prev, { kind: 'thought', text: m.text }]);
        } else if (m.type === 'question_done') {
          setQuestion(null);
        } else if (m.type === 'error') {
          setLog((prev) => [...prev, { kind: 'error', text: m.text }]);
        } else if (m.type === 'session_cleared') {
          setLog([]);
        }
      };
    }
    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [token]);

  const send = useCallback((m) => {
    if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify(m));
  }, []);

  function start() {
    if (!instruction.trim() || control === 'agent') return;
    // Reset the log for this run — the server sends its own 'log' message
    // (kind: 'user') for the instruction, so it isn't added here too.
    setLog([]);
    setScrollFrac(0.5);
    send({ type: 'start', instruction: instruction.trim() });
  }

  function submitAnswer() {
    if (!answer.trim()) return;
    send({ type: 'answer', text: answer.trim() });
    setLog((prev) => [...prev, { kind: 'user', text: answer.trim() }]);
    setAnswer('');
  }

  function toggleMic(target) {
    if (voice.isListening) { voice.stopListening(); return; }
    micTargetRef.current = target;
    voice.startListening();
  }

  function takeover() {
    send({ type: 'takeover' });
    setControl('user'); setWho('You have control'); setHint('Click and type in the browser view.');
  }

  function clearSession() {
    send({ type: 'clear_session' });
  }

  function posFromEvent(e) {
    const r = imgRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  function scrollBy(dy) {
    setScrollFrac((f) => Math.min(1, Math.max(0, f + dy / 3000)));
    send({ type: 'wheel', dy, x: 0.5, y: 0.5 });
  }

  function onThumbPointerDown(e) {
    e.stopPropagation();
    scrollDragRef.current = { startY: e.clientY, startFrac: scrollFrac };
    e.target.setPointerCapture(e.pointerId);
  }
  function onThumbPointerMove(e) {
    if (!scrollDragRef.current) return;
    const trackHeight = e.currentTarget.parentElement.clientHeight || 1;
    const deltaFrac = (e.clientY - scrollDragRef.current.startY) / trackHeight;
    const nextFrac = Math.min(1, Math.max(0, scrollDragRef.current.startFrac + deltaFrac));
    setScrollFrac(nextFrac);
    send({ type: 'wheel', dy: deltaFrac * 3000, x: 0.5, y: 0.5 });
    scrollDragRef.current = { startY: e.clientY, startFrac: nextFrac };
  }
  function onThumbPointerUp() {
    scrollDragRef.current = null;
  }

  const interactive = control === 'review' || control === 'user';

  return (
    <div className="flex flex-col lg:flex-row lg:items-start gap-5 p-5 max-w-[1400px] mx-auto">
      <section className="flex-1 min-w-0 flex flex-col rounded-2xl border overflow-hidden" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-b text-xs truncate" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
          {url}
        </div>
        <div
          ref={viewerRef}
          tabIndex={interactive ? 0 : -1}
          className="relative"
          style={{ aspectRatio: '1280 / 800', background: '#f6f8fa', outline: interactive ? '3px solid var(--color-primary)' : 'none', cursor: interactive ? 'pointer' : 'default' }}
          onClick={(e) => { if (interactive) send({ type: 'mouse', ...posFromEvent(e) }); }}
          onWheel={(e) => { if (interactive) scrollBy(e.deltaY); }}
          onKeyDown={(e) => {
            if (!interactive) return;
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { e.preventDefault(); send({ type: 'text', text: e.key }); }
            else if (['Backspace', 'Delete', 'Enter', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
              e.preventDefault(); send({ type: 'key', key: e.key });
            }
          }}
        >
          <img ref={imgRef} alt="" className="block w-full h-full object-contain select-none" />
          {!connected && (
            <div className="absolute inset-0 grid place-items-center text-center px-6" style={{ color: 'var(--color-muted)' }}>
              <p>Connecting…</p>
            </div>
          )}
          {interactive && (
            <>
              {/* The stream is a video, not a real DOM page, so there's no native
                  scrollbar — this is a stand-in: drag the thumb, or click the
                  track, to scroll the actual page (server-side wheel events). */}
              <div
                className="absolute right-1.5 top-2 bottom-2 w-3 rounded-full"
                style={{ background: 'rgba(0,0,0,0.08)' }}
                onClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  const clickFrac = (e.clientY - r.top) / r.height;
                  scrollBy((clickFrac - scrollFrac) * 3000);
                }}
              >
                <div
                  role="scrollbar"
                  aria-orientation="vertical"
                  className="absolute left-0 w-3 rounded-full cursor-grab active:cursor-grabbing"
                  style={{
                    top: `calc(${scrollFrac * 85}% )`,
                    height: '15%',
                    background: 'var(--color-primary)',
                    opacity: 0.85,
                  }}
                  onPointerDown={onThumbPointerDown}
                  onPointerMove={onThumbPointerMove}
                  onPointerUp={onThumbPointerUp}
                  onPointerLeave={onThumbPointerUp}
                />
              </div>
              <div className="absolute right-8 top-1/2 -translate-y-1/2 flex flex-col gap-1.5">
                <button
                  type="button"
                  title="Scroll up"
                  className="w-8 h-8 rounded-full grid place-items-center text-sm font-bold shadow hover:opacity-80"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                  onClick={(e) => { e.stopPropagation(); scrollBy(-400); }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  title="Scroll down"
                  className="w-8 h-8 rounded-full grid place-items-center text-sm font-bold shadow hover:opacity-80"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                  onClick={(e) => { e.stopPropagation(); scrollBy(400); }}
                >
                  ↓
                </button>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-3.5 px-4 py-3.5 border-t" style={{ borderColor: 'var(--color-border)', background: control === 'agent' ? 'color-mix(in srgb, var(--color-primary) 12%, transparent)' : control === 'review' ? '#f9e8cf' : 'transparent' }}>
          <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: control === 'agent' ? 'var(--color-primary)' : control === 'review' ? '#d9892b' : 'var(--color-muted)' }} />
          <span className="font-semibold text-sm">{who}</span>
          <span className="text-sm flex-1" style={{ color: 'var(--color-muted)' }}>{hint}</span>
          {control === 'agent' && (
            <button className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-60" style={{ borderColor: 'var(--color-border)' }} onClick={takeover}>Take over</button>
          )}
        </div>
      </section>

      <aside className="w-full lg:w-[380px] flex-none flex flex-col gap-4">
        <div className="rounded-2xl border p-4 flex items-center justify-between" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <h1 className="text-lg font-semibold">Browser Agent</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              title="Clear what the agent remembers from earlier instructions this session (the open page is unaffected)"
              disabled={control === 'agent'}
              className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-60 flex items-center gap-1.5 disabled:opacity-40"
              style={{ borderColor: 'var(--color-border)' }}
              onClick={clearSession}
            >
              {getIcon('rotate-ccw', { size: 14 })} Clear session
            </button>
            <Link
              to="/browser-agent/settings"
              className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-60 flex items-center gap-1.5"
              style={{ borderColor: 'var(--color-border)' }}
            >
              {getIcon('settings', { size: 14 })} Settings
            </Link>
            <Link
              to="/browser-agent/archive"
              className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-60 flex items-center gap-1.5"
              style={{ borderColor: 'var(--color-border)' }}
            >
              {getIcon('archive', { size: 14 })} Archive
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <p className="text-sm mb-3" style={{ color: 'var(--color-muted)' }}>
            Fills a form on a real site, then hands the browser back to you before anything is sent. The agent never presses submit — you do, after reviewing.
          </p>
          <div className="relative">
            <textarea
              className="w-full min-h-[84px] rounded-lg border p-2.5 pr-8 text-sm"
              style={{ borderColor: 'var(--color-border)' }}
              placeholder="Go to example.com.au and fill out the enquiry form for a quote"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onFocus={() => { micTargetRef.current = 'instruction'; }}
            />
            {instruction && (
              <button
                type="button"
                title="Clear"
                className="absolute top-2 right-2 w-5 h-5 rounded-full grid place-items-center text-xs hover:opacity-70"
                style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}
                onClick={() => setInstruction('')}
              >
                ✕
              </button>
            )}
          </div>
          {voice.voiceError && (
            <p className="text-xs mt-1.5" style={{ color: '#ef4444' }}>{voice.voiceError}</p>
          )}
          {voice.isListening && micTargetRef.current === 'instruction' && voice.interimText && (
            <p className="text-xs mt-1.5 italic" style={{ color: 'var(--color-muted)' }}>{voice.interimText}</p>
          )}
          <div className="flex gap-2 mt-2.5">
            {(voice.isSTTAvailable || voice.isLocalSTTAvailable) && (
              <button
                type="button"
                title="Speak your instruction"
                aria-pressed={voice.isListening && micTargetRef.current === 'instruction'}
                className="rounded-lg px-3.5 py-2.5 text-sm font-medium border hover:opacity-70 flex-none"
                style={{
                  borderColor: 'var(--color-border)',
                  background: voice.isListening && micTargetRef.current === 'instruction' ? '#ef4444' : 'var(--color-surface)',
                  color: voice.isListening && micTargetRef.current === 'instruction' ? '#fff' : 'var(--color-text)',
                }}
                onClick={() => toggleMic('instruction')}
              >
                {getIcon('mic', { size: 16 })}
              </button>
            )}
            <button
              className="flex-1 rounded-lg px-4 py-2.5 text-sm font-medium hover:opacity-70 disabled:opacity-40"
              style={{ background: 'var(--color-text)', color: 'var(--color-bg)' }}
              disabled={control === 'agent' || !connected}
              onClick={start}
            >
              Start
            </button>
          </div>
        </div>

        {question && (
          <div className="rounded-2xl border p-4" style={{ background: 'color-mix(in srgb, var(--color-primary) 10%, var(--color-surface))', borderColor: 'var(--color-primary)' }}>
            <p className="text-sm font-medium mb-2">{question}</p>
            <div className="flex gap-2 mb-2">
              <input
                className="flex-1 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--color-border)' }}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitAnswer()}
                onFocus={() => { micTargetRef.current = 'answer'; }}
                placeholder="Your answer"
                autoFocus
              />
              {(voice.isSTTAvailable || voice.isLocalSTTAvailable) && (
                <button
                  type="button"
                  title="Speak your answer"
                  className="rounded-lg px-3 py-2 text-sm border hover:opacity-70 flex-none"
                  style={{
                    borderColor: 'var(--color-border)',
                    background: voice.isListening && micTargetRef.current === 'answer' ? '#ef4444' : 'var(--color-surface)',
                    color: voice.isListening && micTargetRef.current === 'answer' ? '#fff' : 'var(--color-text)',
                  }}
                  onClick={() => toggleMic('answer')}
                >
                  {getIcon('mic', { size: 16 })}
                </button>
              )}
            </div>
            <button className="w-full rounded-lg px-3 py-2 text-sm font-medium hover:opacity-70" style={{ background: 'var(--color-text)', color: 'var(--color-bg)' }} onClick={submitAnswer}>
              Answer
            </button>
          </div>
        )}

        <div className="rounded-2xl border p-2 flex-1 min-h-[200px] max-h-[52vh] overflow-y-auto" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          {log.length === 0 ? (
            <p className="text-sm px-2 py-2" style={{ color: 'var(--color-muted)' }}>Steps will show here as the agent works.</p>
          ) : (
            <ol className="text-sm">
              {log.map((entry, i) => (
                <li
                  key={i}
                  className="py-2 px-2 border-b last:border-0"
                  style={{
                    borderColor: 'var(--color-border)',
                    fontWeight: entry.kind === 'user' ? 600 : 400,
                    color: entry.kind === 'error' ? '#ef4444' : entry.kind === 'guard' ? '#9a5a12' : entry.kind === 'action' ? 'var(--color-muted)' : 'var(--color-text)',
                    paddingLeft: entry.kind === 'action' ? '1rem' : undefined,
                    background: entry.kind === 'handoff' ? '#f9e8cf' : undefined,
                  }}
                >
                  <ReactMarkdown components={MD_COMPONENTS}>{entry.text}</ReactMarkdown>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2 mb-2.5">
            {getIcon('user', { size: 15 })}
            <span className="text-sm font-medium flex-1">Your details for forms</span>
            <Link to="/browser-agent/settings" className="text-xs font-medium hover:opacity-60" style={{ color: 'var(--color-primary)' }}>
              Edit
            </Link>
          </div>
          {!profile ? (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading…</p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              {PROFILE_FIELDS.map((f) => (
                <div key={f.key}>
                  <dt style={{ color: 'var(--color-muted)' }}>{f.label}</dt>
                  <dd className="truncate">{profile[f.key] || <span style={{ color: 'var(--color-muted)' }}>—</span>}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </aside>
    </div>
  );
}
