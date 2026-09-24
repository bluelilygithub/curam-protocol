import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { useIcon } from '../providers/IconProvider';
import { useVoice } from '../hooks/useVoice';
import api from '../utils/apiClient';

const OUTCOME_LABEL = {
  handed_off: 'Handed off',
  cancelled: 'Cancelled',
  stopped: 'Stopped early',
  error: 'Error',
};

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
  const [runs, setRuns] = useState([]);
  const [expandedRun, setExpandedRun] = useState(null);

  const wsRef = useRef(null);
  const imgRef = useRef(null);
  const viewerRef = useRef(null);
  const micTargetRef = useRef(null); // 'instruction' | 'answer'

  const loadRuns = useCallback(() => {
    api.get('/api/browser-agent/runs').then((res) => (res.ok ? res.json() : [])).then(setRuns).catch(() => {});
  }, []);

  useEffect(() => { loadRuns(); }, [loadRuns]);

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
          else { setControl((c) => (c === 'review' ? c : 'user')); loadRuns(); }
        } else if (m.type === 'handoff') {
          setLog((prev) => [...prev, { kind: 'handoff', text: m.summary }]);
          setControl('review'); setWho('Your turn'); setHint("Scroll (or use the ↑↓ buttons) to check the form, then press the site's own send button.");
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
    send({ type: 'start', instruction: instruction.trim() });
    setLog([{ kind: 'user', text: instruction.trim() }]);
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
          {interactive && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-1.5">
              <button
                type="button"
                title="Scroll up"
                className="w-8 h-8 rounded-full grid place-items-center text-sm font-bold shadow hover:opacity-80"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                onClick={(e) => { e.stopPropagation(); send({ type: 'wheel', dy: -400, x: 0.5, y: 0.5 }); }}
              >
                ↑
              </button>
              <button
                type="button"
                title="Scroll down"
                className="w-8 h-8 rounded-full grid place-items-center text-sm font-bold shadow hover:opacity-80"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                onClick={(e) => { e.stopPropagation(); send({ type: 'wheel', dy: 400, x: 0.5, y: 0.5 }); }}
              >
                ↓
              </button>
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
            onFocus={() => { micTargetRef.current = 'instruction'; }}
          />
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
                  {entry.text}
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="rounded-2xl border p-4 flex items-center gap-2" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          {getIcon('user', { size: 15 })}
          <span className="text-sm flex-1" style={{ color: 'var(--color-muted)' }}>
            Name/city/state/phone/email are pulled from your Settings profile.
          </span>
          <Link to="/settings" className="text-sm font-medium hover:opacity-60" style={{ color: 'var(--color-primary)' }}>
            Edit
          </Link>
        </div>

        <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            {getIcon('archive', { size: 15 })} Archive
          </h2>
          {runs.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Past attempts will show up here.</p>
          ) : (
            <ul className="space-y-1.5 max-h-[40vh] overflow-y-auto">
              {runs.map((r) => (
                <li key={r.id} className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                  <button
                    className="w-full text-left px-3 py-2 hover:opacity-70"
                    onClick={() => setExpandedRun(expandedRun === r.id ? null : r.id)}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded flex-none"
                        style={{
                          background: r.outcome === 'handed_off' ? '#f9e8cf' : r.outcome === 'error' ? '#fee2e2' : 'var(--color-bg)',
                          color: r.outcome === 'handed_off' ? '#9a5a12' : r.outcome === 'error' ? '#b91c1c' : 'var(--color-muted)',
                        }}
                      >
                        {OUTCOME_LABEL[r.outcome] || r.outcome}
                      </span>
                      <span className="text-xs truncate flex-1" style={{ color: 'var(--color-muted)' }}>
                        {new Date(r.startedAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm mt-1 truncate">{r.instruction}</p>
                  </button>
                  {expandedRun === r.id && (
                    <div className="px-3 pb-3 text-sm" style={{ borderTop: '1px solid var(--color-border)' }}>
                      {r.summary && <p className="mt-2 italic" style={{ color: 'var(--color-muted)' }}>{r.summary}</p>}
                      <RunLog runId={r.id} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

function RunLog({ runId }) {
  const [entries, setEntries] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get(`/api/browser-agent/runs/${runId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled) setEntries(data?.log || []); })
      .catch(() => { if (!cancelled) setEntries([]); });
    return () => { cancelled = true; };
  }, [runId]);

  if (entries === null) return <p className="mt-2 text-xs" style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  return (
    <ol className="mt-2 space-y-1 text-xs">
      {entries.map((e, i) => (
        <li key={i} style={{ color: e.kind === 'error' ? '#ef4444' : e.kind === 'guard' ? '#9a5a12' : 'var(--color-muted)' }}>
          {e.text}
        </li>
      ))}
    </ol>
  );
}
