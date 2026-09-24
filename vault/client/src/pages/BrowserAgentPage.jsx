import { useEffect, useRef, useState, useCallback } from 'react';
import useAuthStore from '../store/authStore';
import { getIcon } from '../providers/IconProvider';

const PROFILE_FIELDS = [
  { name: 'name', label: 'Name', autoComplete: 'name' },
  { name: 'phone', label: 'Phone', autoComplete: 'tel' },
  { name: 'email', label: 'Email', autoComplete: 'email', type: 'email', wide: true },
  { name: 'address', label: 'Address', wide: true },
];

const PROFILE_STORAGE_KEY = 'vault:browserAgentProfile';

function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export default function BrowserAgentPage() {
  const token = useAuthStore((s) => s.token);
  const [profile, setProfile] = useState(loadProfile);
  const [instruction, setInstruction] = useState('');
  const [log, setLog] = useState([]);
  const [control, setControl] = useState('idle'); // idle | agent | user | review
  const [who, setWho] = useState('Ready');
  const [hint, setHint] = useState('Type what you want done.');
  const [url, setUrl] = useState('No page open');
  const [question, setQuestion] = useState(null);
  const [answer, setAnswer] = useState('');
  const [connected, setConnected] = useState(false);

  const wsRef = useRef(null);
  const imgRef = useRef(null);
  const viewerRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile)); } catch {}
  }, [profile]);

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
          setControl('review'); setWho('Your turn'); setHint("Check the form, then press the site's own send button.");
        } else if (m.type === 'question') {
          setQuestion(m.text);
          setLog((prev) => [...prev, { kind: 'thought', text: m.text }]);
        } else if (m.type === 'question_done') {
          setQuestion(null);
        } else if (m.type === 'error') {
          setLog((prev) => [...prev, { kind: 'error', text: m.text }]);
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
    send({ type: 'start', instruction: instruction.trim(), profile });
    setLog([{ kind: 'user', text: instruction.trim() }]);
  }

  function submitAnswer() {
    if (!answer.trim()) return;
    send({ type: 'answer', text: answer.trim() });
    setLog((prev) => [...prev, { kind: 'user', text: answer.trim() }]);
    setAnswer('');
  }

  function takeover() {
    send({ type: 'takeover' });
    setControl('user'); setWho('You have control'); setHint('Click and type in the browser view.');
  }

  function posFromEvent(e) {
    const r = imgRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  const interactive = control === 'review' || control === 'user';

  return (
    <div className="flex flex-col lg:flex-row gap-5 p-5 max-w-[1400px] mx-auto">
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
          onWheel={(e) => { if (interactive) send({ type: 'wheel', dy: e.deltaY, ...posFromEvent(e) }); }}
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
        <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <h1 className="text-lg font-semibold mb-1">Browser Agent</h1>
          <p className="text-sm mb-3" style={{ color: 'var(--color-muted)' }}>
            Fills a form on a real site, then hands the browser back to you before anything is sent. The agent never presses submit — you do, after reviewing.
          </p>
          <textarea
            className="w-full min-h-[84px] rounded-lg border p-2.5 text-sm"
            style={{ borderColor: 'var(--color-border)' }}
            placeholder="Go to example.com.au and fill out the enquiry form for a quote"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
          <button
            className="mt-2.5 w-full rounded-lg px-4 py-2.5 text-sm font-medium hover:opacity-70 disabled:opacity-40"
            style={{ background: 'var(--color-text)', color: 'var(--color-bg)' }}
            disabled={control === 'agent' || !connected}
            onClick={start}
          >
            Start
          </button>
        </div>

        {question && (
          <div className="rounded-2xl border p-4" style={{ background: 'color-mix(in srgb, var(--color-primary) 10%, var(--color-surface))', borderColor: 'var(--color-primary)' }}>
            <p className="text-sm font-medium mb-2">{question}</p>
            <input
              className="w-full rounded-lg border px-3 py-2 text-sm mb-2"
              style={{ borderColor: 'var(--color-border)' }}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitAnswer()}
              placeholder="Your answer"
              autoFocus
            />
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
                  {entry.text}
                </li>
              ))}
            </ol>
          )}
        </div>

        <details className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <summary className="text-sm font-medium cursor-pointer flex items-center gap-2">
            {getIcon('user', { size: 15 })} Your details for forms
          </summary>
          <div className="grid grid-cols-2 gap-2 mt-3">
            {PROFILE_FIELDS.map((f) => (
              <label key={f.name} className={`flex flex-col gap-1 text-xs ${f.wide ? 'col-span-2' : ''}`} style={{ color: 'var(--color-muted)' }}>
                {f.label}
                <input
                  type={f.type || 'text'}
                  autoComplete={f.autoComplete}
                  className="rounded-lg border px-2.5 py-1.5 text-sm"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  value={profile[f.name] || ''}
                  onChange={(e) => setProfile((p) => ({ ...p, [f.name]: e.target.value }))}
                />
              </label>
            ))}
          </div>
        </details>
      </aside>
    </div>
  );
}
