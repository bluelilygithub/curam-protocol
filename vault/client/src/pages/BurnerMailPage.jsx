import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import { useIcon } from '../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import ToolSidebar from '../components/ToolSidebar';
import Tooltip from '../components/Tooltip';
import EmptyState from '../components/EmptyState';
import Skeleton from '../components/Skeleton';
import { VoiceInput, VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import BurnerMailTutorChat from './burnerMail/BurnerMailTutorChat';
import { BURNER_TOOLS, GROUPS, GROUP_TIPS, TOOL_TIPS, TOOL_BLURBS, HOW_IT_WORKS, GUIDE_TOOLS, burnNo, matchesBurn } from './burnerMail/burnerMailTools.mjs';
import { startBurnerMailTour, TOUR_KEY as BURNER_TOUR_KEY } from '../utils/tours/burnerMailTour';

const FIELD = 'px-3 py-2.5 rounded-xl border text-sm outline-none';
const FIELD_STYLE = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const POLL_MS = 5000;
const MUTED = { color: 'var(--color-muted)' };
const PRIMARY_BTN = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity duration-200 disabled:opacity-40';
const MENU = GROUPS.map((label) => ({
  label, tip: GROUP_TIPS[label],
  tools: BURNER_TOOLS.filter((t) => t.group === label).map((t) => ({ ...t, tip: TOOL_TIPS[t.id] })),
}));

function formatWhen(iso) {
  if (!iso) return '';
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); } catch { return iso; }
}

function CopyButton({ value, label = 'Copy', className = '' }) {
  const getIcon = useIcon();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <button
      type="button" onClick={copy}
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs hover:opacity-70 transition-opacity ${className}`}
      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
    >
      {getIcon(done ? 'check' : 'copy', { size: 12 })}{done ? 'Copied' : label}
    </button>
  );
}

function MessageCard({ message, onDelete }) {
  const getIcon = useIcon();
  const [showBody, setShowBody] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const codes = message.codes || [];
  const links = message.links || [];
  return (
    <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium break-words" style={{ color: 'var(--color-text)' }}>{message.subject || '(no subject)'}</p>
          <p className="text-xs break-all" style={{ color: 'var(--color-muted)' }}>{message.fromAddr} · {formatWhen(message.receivedAt)}</p>
        </div>
        {confirming ? (
          <span className="text-xs shrink-0" style={{ color: 'var(--color-muted)' }}>
            Delete?{' '}
            <button type="button" className="underline hover:opacity-70" style={{ color: '#ef4444' }} onClick={() => onDelete(message.id)}>Yes</button>
            {' / '}
            <button type="button" className="underline hover:opacity-70" onClick={() => setConfirming(false)}>No</button>
          </span>
        ) : (
          <Tooltip text="Delete this email for good (asks Yes / No first).">
            <button type="button" aria-label="Delete email" onClick={() => setConfirming(true)} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>
              {getIcon('trash', { size: 14 })}
            </button>
          </Tooltip>
        )}
      </div>

      {codes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{codes.length === 1 ? 'Code' : 'Possible codes'}</span>
          {codes.map((c) => (
            <span key={c} className="inline-flex items-center gap-2 rounded-lg border px-2.5 py-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <span className="font-mono text-base font-semibold tracking-widest" style={{ color: 'var(--color-text)' }}>{c}</span>
              <CopyButton value={c} />
            </span>
          ))}
        </div>
      )}

      {links.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Links in this email. Check the site name before you open one.</span>
          {links.map((l) => (
            <div key={l.url} className="flex items-center gap-2 text-xs">
              <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--color-text)' }} title={l.url}>
                {l.likely && <span className="mr-1.5 px-1.5 py-0.5 rounded" style={{ background: 'var(--color-primary)', color: '#fff' }}>confirm</span>}
                <strong>{l.host}</strong>{l.label ? ` · ${l.label}` : ''}
              </span>
              <CopyButton value={l.url} label="Copy link" />
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border hover:opacity-70 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                {getIcon('external-link', { size: 12 })}Open
              </a>
            </div>
          ))}
        </div>
      )}

      {message.bodyText && (
        <div>
          <button type="button" className="text-xs underline hover:opacity-70" style={{ color: 'var(--color-primary)' }} onClick={() => setShowBody((v) => !v)}>
            {showBody ? 'Hide full text' : 'Show full text'}
          </button>
          {showBody && <pre className="mt-2 text-xs whitespace-pre-wrap break-words leading-relaxed" style={{ color: 'var(--color-text)', fontFamily: 'inherit' }}>{message.bodyText}</pre>}
        </div>
      )}
    </div>
  );
}

/**
 * Burner Mail (docs/burner-mail.md), laid out like the other tool pages: the menu on the left (ToolSidebar) and the work on the right.
 * /burner-mail?view=make|live|saved shows a menu item; /burner-mail/:id shows one burn (B-12) with its address and inbox.
 */
export default function BurnerMailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const isAdmin = useAuthStore((s) => s.user?.isAdmin);
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.burnerMail !== false;
  const [status, setStatus] = useState(null);
  const info = useToolInfoModal('vault_burner_mail_info_seen');
  const asked = params.get('view');
  const view = id ? null : BURNER_TOOLS.some((t) => t.id === asked) ? asked : 'live';

  useEffect(() => {
    api.get('/api/settings/feature-access').then((r) => r.json()).then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); }).catch(() => {});
    api.get('/api/burner-mail/status').then((r) => r.json()).then(setStatus).catch(() => setStatus({ configured: false }));
  }, []);

  const show = useCallback((v) => navigate(`/burner-mail?view=${v}`), [navigate]);
  // the tour walks through the views; 'burn' opens the newest burn if there is one
  const tourGo = useCallback(async (v) => {
    if (v !== 'burn') return show(v);
    try {
      const r = await api.get('/api/burner-mail/addresses');
      const list = r.ok ? await r.json() : [];
      if (list[0]) navigate(`/burner-mail/${list[0].id}`); else show('live');
    } catch { show('live'); }
  }, [navigate, show]);

  // Settings -> Burner Mail Tour opens /burner-mail?tour=1
  useEffect(() => {
    if (params.get('tour')) {
      const next = new URLSearchParams(params); next.delete('tour');
      setParams(next, { replace: true });
      setTimeout(() => startBurnerMailTour(tourGo), 300);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startTour = () => {
    try { localStorage.removeItem(BURNER_TOUR_KEY); } catch (_) { /* ignore */ }
    startBurnerMailTour(tourGo);
  };

  // The guide's Open buttons: a control inside a burn stays put when a burn is open; otherwise show its menu item.
  const openToolById = (toolId) => {
    const target = GUIDE_TOOLS.find((t) => t.id === toolId);
    if (!target) return;
    if (id && target.tool === 'live' && toolId !== 'live') return;
    show(target.tool);
  };

  if (!canUse) return <Navigate to="/" replace />;

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
        <ToolSidebar
          title="Burner Mail"
          icon="mail"
          groups={MENU}
          current={view}
          onSelect={show}
          onInfo={info.open}
          infoTip="How Burner Mail works: making a burn, burn numbers, saving, codes and links."
          onTour={startTour}
          tourTip="Take the guided tour of Burner Mail."
        />

        <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6" style={{ background: 'var(--color-bg)' }}>
          <div className="w-full max-w-5xl space-y-5">
            {status && !status.configured && (
              <div className="rounded-xl border p-4 text-sm leading-relaxed" style={{ borderColor: '#f59e0b', background: '#fef3c7', color: '#b45309' }}>
                Burner Mail is not set up yet. The owner needs to add a mail domain and a secret on the server. The steps are in <strong>docs/burner-mail.md</strong>.
              </div>
            )}
            {id && <BurnDetail key={id} id={id} onGone={() => show('live')} />}
            {view === 'make' && <NewBurn status={status} onMade={(b) => navigate(`/burner-mail/${b.id}`)} />}
            {(view === 'live' || view === 'saved') && <BurnList key={view} savedOnly={view === 'saved'} onNew={() => show('make')} onOpen={(b) => navigate(`/burner-mail/${b.id}`)} />}
          </div>
        </main>
      </div>

      {info.show && (
        <ToolInfoModal title="How Burner Mail Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Throw-away email addresses for web sign-ups. Not sure where to start? Press the round button at the bottom right and tell the guide what you want to do.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, text]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
            ))}
          </div>
        </ToolInfoModal>
      )}

      <BurnerMailTutorChat currentTool={id ? 'live' : view} onOpenTool={openToolById} />
    </VoiceInputProvider>
  );
}

function ViewHeader({ title, blurb, action }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{title}</h1>
        <p className="text-xs mt-0.5" style={MUTED}>{blurb}</p>
      </div>
      {action}
    </div>
  );
}

function NewBurn({ status, onMade }) {
  const getIcon = useIcon();
  const [label, setLabel] = useState('');
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.post('/api/burner-mail/addresses', { label, days });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Could not make a burn.'); return; }
      onMade(d);
    } catch { setError('Could not reach the server.'); } finally { setBusy(false); }
  };

  return (
    <>
      <ViewHeader title="Burner Mail · New burn" blurb={TOOL_BLURBS.make} />
      <div className="rounded-2xl border p-6 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }} data-tour="burner-make">
        <div className="flex flex-col sm:flex-row gap-2">
          <Tooltip text="What the burn is for, so you can recognise it later (for example Spotify). It also starts the address. Optional; the microphone lets you say it.">
            <div className="flex-1">
              <VoiceInput
                value={label} onChange={(v) => setLabel(v.slice(0, 60))} label="What the burn is for"
                placeholder="What is it for? (optional, e.g. Spotify)"
                onKeyDown={(e) => e.key === 'Enter' && !busy && create()}
              />
            </div>
          </Tooltip>
          <Tooltip text="How long the address receives mail. Keep for good saves it straight away, for accounts you will keep; you can also Save a burn later.">
            <select className={FIELD} style={FIELD_STYLE} aria-label="How long to keep it" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {(status?.lifetimes || [1, 7, 30]).map((d) => <option key={d} value={d}>{d === 1 ? 'Keep 1 day' : `Keep ${d} days`}</option>)}
              <option value={0}>Keep for good</option>
            </select>
          </Tooltip>
          <Tooltip text="Make the address and open the burn, ready to copy.">
            <button type="button" onClick={create} disabled={busy || (status && !status.configured)} className={PRIMARY_BTN} style={{ background: 'var(--color-primary)', color: '#fff' }}>
              {getIcon('plus', { size: 14 })}Make burn
            </button>
          </Tooltip>
        </div>
        {error && <p className="text-sm" role="alert" style={{ color: '#ef4444' }}>{error}</p>}
      </div>
    </>
  );
}

function BurnList({ savedOnly, onNew, onOpen }) {
  const [burns, setBurns] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/burner-mail/addresses')
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Burns could not be loaded.'); setBurns(d); })
      .catch((e) => { setError(e.message); setBurns([]); });
  }, []);

  const shown = (burns || []).filter((b) => (!savedOnly || b.savedAt) && matchesBurn(b, q));
  const newBtn = (
    <Tooltip text="Make a new throw-away address.">
      <button type="button" onClick={onNew} className={PRIMARY_BTN} style={{ background: 'var(--color-primary)', color: '#fff' }}>+ New burn</button>
    </Tooltip>
  );

  return (
    <>
      <ViewHeader title={`Burner Mail · ${savedOnly ? 'Saved burns' : 'Live burns'}`} blurb={TOOL_BLURBS[savedOnly ? 'saved' : 'live']} action={newBtn} />
      <Tooltip text="Find a burn by what it is for, its address, or its number (B-12). The microphone lets you say it.">
        <div className="sm:max-w-sm">
          <VoiceInput value={q} onChange={setQ} label="Search burns" placeholder="Search names and addresses, or B-12…" />
        </div>
      </Tooltip>
      {burns === null && <Skeleton className="h-16 w-full" />}
      {error && <p className="text-sm" role="alert" style={{ color: '#ef4444' }}>{error}</p>}
      {burns && !error && shown.length === 0 && (
        <EmptyState
          icon={savedOnly ? 'star' : 'mail'}
          title={q ? 'No burns match that search.' : savedOnly ? 'No saved burns yet' : 'No burns yet'}
          body={q ? undefined : savedOnly ? 'Open a burn and press Save to keep it for good. It shows here.' : 'Make a burn, use its address on a sign-up form, and the code shows up here.'}
          action={q ? undefined : newBtn}
        />
      )}
      <div className="flex flex-col gap-2" data-tour="burner-list">
        {shown.map((b) => (
          <button key={b.id} type="button" onClick={() => onOpen(b)} className="text-left p-4 rounded-xl border w-full transition-opacity duration-200 hover:opacity-70"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs shrink-0" style={MUTED}>{burnNo(b)}</span>
              <span className="font-semibold text-sm truncate" style={{ color: 'var(--color-text)' }}>{b.label || 'Sign-up'}</span>
              {b.savedAt && <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>Saved</span>}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs mt-1.5" style={MUTED}>
              <span className="font-mono break-all">{b.address}</span>
              <span>{b.messageCount} email{b.messageCount === 1 ? '' : 's'}</span>
              <span>{b.savedAt ? 'Kept until you delete it' : `Expires ${formatWhen(b.expiresAt)}`}</span>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

function BurnDetail({ id, onGone }) {
  const getIcon = useIcon();
  const [burn, setBurn] = useState(null);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState([]);
  const [checkedAt, setCheckedAt] = useState(null);
  const [label, setLabel] = useState('');
  const [confirming, setConfirming] = useState(false);
  const labelRef = useRef('');

  useEffect(() => {
    api.get(`/api/burner-mail/addresses/${id}`)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Burn not found.'); setBurn(d); setLabel(d.label || ''); labelRef.current = d.label || ''; })
      .catch((e) => setError(e.message));
  }, [id]);

  const loadMessages = useCallback(async () => {
    try {
      const r = await api.get(`/api/burner-mail/addresses/${id}/messages`);
      if (r.ok) { setMessages(await r.json()); setCheckedAt(new Date()); }
    } catch { /* try again on the next check */ }
  }, [id]);

  // check for new mail every few seconds while the burn is open and the tab visible
  useEffect(() => {
    loadMessages();
    const t = setInterval(() => { if (!document.hidden) loadMessages(); }, POLL_MS);
    return () => clearInterval(t);
  }, [loadMessages]);

  const patch = async (body) => {
    try {
      const r = await api.patch(`/api/burner-mail/addresses/${id}`, body);
      const d = await r.json();
      if (r.ok) { setBurn(d); labelRef.current = d.label || ''; setError(''); } else setError(d.error || 'Could not save that.');
    } catch { setError('Could not reach the server.'); }
  };
  const saveLabel = () => { if (label.trim() !== labelRef.current) patch({ label }); };

  const remove = async () => {
    try { await api.delete(`/api/burner-mail/addresses/${id}`); } catch { /* the list shows the truth */ }
    onGone();
  };
  const removeMessage = async (mid) => {
    try { await api.delete(`/api/burner-mail/messages/${mid}`); } catch { /* reload shows the truth */ }
    loadMessages();
  };

  if (error && !burn) return <EmptyState icon="mail" title={error} body="It may have been deleted." />;
  if (!burn) return <Skeleton className="h-24 w-full" />;
  const expired = !burn.savedAt && new Date(burn.expiresAt) < new Date();

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm" style={MUTED}>{burnNo(burn)}</span>
        <Tooltip text="What this burn is for. Click to rename; it saves when you leave the box.">
          <input value={label} onChange={(e) => setLabel(e.target.value.slice(0, 60))} onBlur={saveLabel} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            placeholder="Sign-up" aria-label="Burn name"
            className="flex-1 min-w-[10rem] text-lg font-bold bg-transparent border-b border-transparent hover:border-current focus:border-current transition-colors duration-200"
            style={{ color: 'var(--color-text)' }} />
        </Tooltip>
        <span data-tour="burner-save">
          <Tooltip text={burn.savedAt ? 'Unsave: the burn expires again, seven days from now at the earliest.' : 'Save: keep this burn for good. It never expires and keeps receiving mail until you delete it.'}>
            <button type="button" onClick={() => patch({ saved: !burn.savedAt })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm hover:opacity-70 transition-opacity duration-200"
              style={burn.savedAt ? { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)', borderColor: 'var(--color-primary)' } : { borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              {getIcon('star', { size: 14 })}{burn.savedAt ? 'Saved' : 'Save'}
            </button>
          </Tooltip>
        </span>
        {confirming ? (
          <span className="text-xs" style={MUTED}>
            Delete this burn and its emails?{' '}
            <button type="button" className="underline hover:opacity-70" style={{ color: '#ef4444' }} onClick={remove}>Yes</button>
            {' / '}
            <button type="button" className="underline hover:opacity-70" onClick={() => setConfirming(false)}>No</button>
          </span>
        ) : (
          <Tooltip text="Delete this burn and all its emails for good (asks Yes / No first).">
            <button type="button" aria-label="Delete burn" onClick={() => setConfirming(true)} className="opacity-60 hover:opacity-100 transition-opacity duration-200" style={MUTED}>
              {getIcon('trash', { size: 15 })}
            </button>
          </Tooltip>
        )}
      </div>
      {error && <p className="text-sm" role="alert" style={{ color: '#ef4444' }}>{error}</p>}

      <div className="rounded-2xl border p-4 space-y-2" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }} data-tour="burner-address">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm break-all flex-1 min-w-0" style={{ color: 'var(--color-text)' }}>{burn.address}</span>
          <Tooltip text="Copy the address to paste into the sign-up form on the other website.">
            <span><CopyButton value={burn.address} label="Copy address" /></span>
          </Tooltip>
        </div>
        <p className="text-xs" style={MUTED}>
          {expired
            ? 'This burn has expired and no longer receives mail. Save it to bring it back. '
            : `Waiting for mail. Checks every few seconds${checkedAt ? `, last at ${checkedAt.toLocaleTimeString()}` : ''}. `}
          {burn.savedAt ? 'Saved: kept until you delete it.' : `Expires ${formatWhen(burn.expiresAt)}.`} Made {formatWhen(burn.createdAt)}.
        </p>
      </div>

      <div className="space-y-3" data-tour="burner-inbox">
        {messages.length === 0 && <p className="text-sm" style={MUTED}>Nothing has arrived yet. Use the address on the sign-up form, then wait here.</p>}
        {messages.map((m) => <MessageCard key={m.id} message={m} onDelete={removeMessage} />)}
      </div>
    </>
  );
}
