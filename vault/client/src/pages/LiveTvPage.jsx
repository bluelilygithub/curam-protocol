import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import { useIcon } from '../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import Tooltip from '../components/Tooltip';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { VoiceInput, VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import { downloadBlob } from '../utils/exportHelpers';
import LiveTvTutorChat from './liveTv/LiveTvTutorChat';
import { HOW_IT_WORKS, GUIDE_TOOLS } from './liveTv/liveTvTools.mjs';
import { pickStream, lastResult, m3uFor, m3uFileName, HOW_LABEL, initials } from './liveTv/liveTvHelpers.mjs';
import { startLiveTvTour, TOUR_KEY as LIVE_TV_TOUR_KEY } from '../utils/tours/liveTvTour';

// Live TV (docs/live-tv.md): free channels listed by the public iptv-org project. The picture plays in a separate frame
// (/api/live-tv-player/, its own security rules) that this page talks to with same-origin messages; Vault never relays video.

const PLAYER_SRC = '/api/live-tv-player/';
const PAGE_SIZE = 60;
const PREFS_KEY = 'vault:live-tv:prefs';
const FIELD = 'px-3 py-2 rounded-xl border text-sm outline-none';
const FIELD_STYLE = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
// Status colours are deliberately outside the theme (see client/DESIGN.md).
const GOOD = '#16a34a';
const WARN = '#f59e0b';
const BAD = '#ef4444';
const VIEWS = [
  { id: 'all', label: 'All', tip: 'Every channel, narrowed by country, kind and name.' },
  { id: 'favourites', label: 'Favourites', tip: 'The channels you starred.' },
  { id: 'recent', label: 'Recent', tip: 'The channels you played lately, newest first.' },
];

function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
}

function StarButton({ on, onClick, size = 15 }) {
  const getIcon = useIcon();
  return (
    <Tooltip text={on ? 'Take off Favourites' : 'Add to Favourites'}>
      <button
        type="button" onClick={onClick} aria-pressed={on} aria-label={on ? 'Take off Favourites' : 'Add to Favourites'}
        className="shrink-0 p-1.5 rounded-lg hover:opacity-70 transition-opacity duration-200"
        style={{ color: on ? WARN : 'var(--color-muted)' }}
      >
        {getIcon('star', { size, fill: on ? WARN : 'none' })}
      </button>
    </Tooltip>
  );
}

function ChannelRow({ channel, active, onPlay, onStar }) {
  const last = lastResult(channel);
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-xl border transition-colors duration-200"
      style={{ borderColor: active ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-bg)' }}
    >
      <button type="button" onClick={() => onPlay(channel)} className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-70 transition-opacity duration-200" aria-label={`Play ${channel.name}`}>
        <span className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-xs font-semibold" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }} aria-hidden="true">
          {initials(channel.name)}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{channel.name}</span>
          <span className="block text-xs truncate" style={{ color: 'var(--color-muted)' }}>
            {channel.flag} {channel.countryName}{channel.categories.length ? ` · ${channel.categories.slice(0, 2).join(', ')}` : ''}
          </span>
          <span className="flex flex-wrap gap-1.5 mt-0.5">
            {!channel.browserOk && <span className="text-[11px]" style={{ color: WARN }}>Needs VLC</span>}
            {last === 'ok' && <span className="text-[11px]" style={{ color: GOOD }}>Played last time</span>}
            {last === 'failed' && <span className="text-[11px]" style={{ color: BAD }}>Did not play last time</span>}
          </span>
        </span>
      </button>
      <StarButton on={channel.favourite} onClick={() => onStar(channel)} />
    </div>
  );
}

export default function LiveTvPage() {
  const getIcon = useIcon();
  const isAdmin = useAuthStore((s) => s.user?.isAdmin);
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const [accessKnown, setAccessKnown] = useState(false);
  const canUse = isAdmin || featureAccess.liveTv !== false;
  const info = useToolInfoModal('vault_live_tv_info_seen');
  const [params, setParams] = useSearchParams();

  const prefs = useRef(readPrefs());
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState('');
  const [view, setView] = useState(prefs.current.view || null);
  const [country, setCountry] = useState(prefs.current.country ?? 'AU');
  const [category, setCategory] = useState(prefs.current.category || '');
  const [browserOnly, setBrowserOnly] = useState(prefs.current.browserOnly ?? true);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');

  const [channel, setChannel] = useState(null);
  const [stream, setStream] = useState(null);
  const [state, setState] = useState({ phase: 'idle', problem: '' });
  const [copied, setCopied] = useState(false);
  const frameRef = useRef(null);
  const readyRef = useRef(false);
  const pendingRef = useRef(null);
  const attemptRef = useRef(null); // { channelId, url, reported }

  useEffect(() => {
    api.get('/api/settings/feature-access').then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); })
      .catch(() => {}).finally(() => setAccessKnown(true));
  }, []);

  // Settings -> Live TV Tour opens /live-tv?tour=1
  useEffect(() => {
    if (params.get('tour')) {
      const next = new URLSearchParams(params); next.delete('tour');
      setParams(next, { replace: true });
      setTimeout(startLiveTvTour, 600);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get('/api/live-tv/meta').then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'The channel list could not be loaded.');
      setMeta(d);
      setView((v) => v || (d.favouriteCount > 0 ? 'favourites' : 'all'));
    }).catch((e) => setMetaError(e.message || 'The channel list could not be loaded.'));
  }, []);

  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (view) savePrefs({ view, country, category, browserOnly }); }, [view, country, category, browserOnly]);

  const load = useCallback(async (offset = 0) => {
    if (!view) return;
    setLoading(true); setListError('');
    try {
      const qs = new URLSearchParams({ view, offset: String(offset), limit: String(PAGE_SIZE) });
      if (view === 'all' && country) qs.set('country', country);
      if (category) qs.set('category', category);
      if (query) qs.set('q', query);
      if (browserOnly) qs.set('browserOnly', '1');
      const r = await api.get(`/api/live-tv/channels?${qs}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'The channel list could not be loaded.');
      setTotal(d.total);
      setList((cur) => (offset ? [...cur, ...d.channels] : d.channels));
    } catch (e) {
      setListError(e.message || 'The channel list could not be loaded.');
    } finally { setLoading(false); }
  }, [view, country, category, query, browserOnly]);

  useEffect(() => { load(0); }, [load]);

  // ---- the player frame ----
  const send = useCallback((message) => {
    const win = frameRef.current?.contentWindow;
    if (!win || !readyRef.current) { pendingRef.current = message; return; }
    win.postMessage(message, window.location.origin);
  }, []);

  const report = useCallback((ok, problem) => {
    const a = attemptRef.current;
    if (!a || a.reported) return;
    a.reported = true;
    const lastPlay = { ok, at: new Date().toISOString() };
    const mark = (c) => (c && c.id === a.channelId
      ? { ...c, streams: c.streams.map((s) => (s.url === a.url ? { ...s, lastPlay } : s)) } : c);
    setList((cur) => cur.map(mark));
    setChannel(mark);
    api.post('/api/live-tv/plays', { channelId: a.channelId, url: a.url, ok, problem }).catch(() => { /* a missed record is harmless */ });
  }, []);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      const d = event.data || {};
      if (d.source !== 'vault-live-tv-player') return;
      if (d.type === 'ready') {
        readyRef.current = true;
        if (pendingRef.current) { const m = pendingRef.current; pendingRef.current = null; send(m); }
        return;
      }
      if (d.type !== 'status' || d.url !== attemptRef.current?.url) return;
      if (d.state === 'loading') setState({ phase: 'loading', problem: '' });
      if (d.state === 'playing') { setState({ phase: 'playing', problem: '' }); report(true); }
      if (d.state === 'failed') { setState({ phase: 'failed', problem: d.problem || 'This link did not play here.' }); report(false, d.problem); }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [send, report]);

  const playStream = (ch, s) => {
    setChannel(ch); setStream(s); setCopied(false);
    if (!s) { setState({ phase: 'none', problem: '' }); send({ type: 'stop' }); return; }
    if (s.how !== 'browser') {
      attemptRef.current = null;
      setState({ phase: 'vlc', problem: '' });
      send({ type: 'stop' });
      return;
    }
    attemptRef.current = { channelId: ch.id, url: s.url, reported: false };
    setState({ phase: 'loading', problem: '' });
    send({ type: 'play', url: s.url });
    if (window.matchMedia && !window.matchMedia('(min-width: 1280px)').matches) {
      document.querySelector('[data-guide="player"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  const playChannel = (ch) => playStream(ch, pickStream(ch));

  const toggleStar = async (ch) => {
    const on = !ch.favourite;
    const flip = (c) => (c && c.id === ch.id ? { ...c, favourite: on } : c);
    setList((cur) => (view === 'favourites' && !on ? cur.filter((c) => c.id !== ch.id) : cur.map(flip)));
    setChannel(flip);
    const r = on
      ? await api.post('/api/live-tv/favourites', { channelId: ch.id }).catch(() => null)
      : await api.delete(`/api/live-tv/favourites/${encodeURIComponent(ch.id)}`).catch(() => null);
    if (!r || !r.ok) {
      const back = (c) => (c && c.id === ch.id ? { ...c, favourite: !on } : c);
      setChannel(back); load(0);
    }
  };

  const copyLink = async () => {
    if (!stream) return;
    try { await navigator.clipboard.writeText(stream.url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  const openInVlc = () => {
    if (!channel || !stream) return;
    downloadBlob(new Blob([m3uFor(channel, stream)], { type: 'audio/x-mpegurl' }), m3uFileName(channel));
  };

  const openToolById = (id) => {
    const target = GUIDE_TOOLS.find((t) => t.id === id);
    document.querySelector(`[data-guide="${target ? target.tool : id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const startTour = () => {
    try { localStorage.removeItem(LIVE_TV_TOUR_KEY); } catch (_) { /* ignore */ }
    startLiveTvTour();
  };

  if (accessKnown && !canUse) return <Navigate to="/" replace />;

  const chip = (on) => ({
    borderColor: on ? 'var(--color-primary)' : 'var(--color-border)',
    color: on ? 'var(--color-primary)' : 'var(--color-muted)',
    background: 'transparent',
  });
  const btn = 'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border hover:opacity-70 transition-opacity duration-200 disabled:opacity-40';
  const phaseLine = {
    idle: ['Choose a channel to watch.', 'var(--color-muted)'],
    none: ['This channel has no links left.', BAD],
    loading: ['Connecting…', 'var(--color-muted)'],
    playing: ['Playing', GOOD],
    failed: [state.problem, BAD],
    vlc: ['This link cannot play in a browser. Use Open in VLC or Copy link below.', WARN],
  }[state.phase];

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
        <div className="w-full max-w-[1700px] mx-auto space-y-5">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Live TV</h1>
              <button type="button" title="How Live TV works" aria-label="How Live TV works" onClick={info.open} className="opacity-60 hover:opacity-100 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>{getIcon('info', { size: 16 })}</button>
              <button type="button" title="Take the guided tour of Live TV" aria-label="Take the guided tour of Live TV" onClick={startTour} className="opacity-60 hover:opacity-100 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>{getIcon('compass', { size: 16 })}</button>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
              Free channels from around the world, from the public{' '}
              <a href="https://github.com/iptv-org/iptv" target="_blank" rel="noopener noreferrer" className="underline hover:opacity-70 transition-opacity duration-200">iptv-org</a>{' '}
              list. Your browser plays them straight from the broadcaster; many links fail, so expect to try a few.
            </p>
          </div>

          {metaError && (
            <div className="rounded-xl border p-4 text-sm" style={{ borderColor: BAD, color: 'var(--color-text)', background: 'var(--color-surface)' }} role="alert">{metaError}</div>
          )}

          <div className="grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start">
            {/* ---- Watch ---- */}
            <section className="xl:order-2 xl:sticky xl:top-0 rounded-2xl border p-4 space-y-3" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }} data-guide="player" data-tour="live-tv-player">
              <div className="relative w-full rounded-xl overflow-hidden" style={{ aspectRatio: '16 / 9', background: '#000' }}>
                <iframe
                  ref={frameRef} src={PLAYER_SRC} title="Live TV player" className="absolute inset-0 w-full h-full border-0"
                  allow="autoplay; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="no-referrer"
                />
              </div>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold truncate" style={{ color: 'var(--color-text)' }}>{channel ? channel.name : 'Nothing playing'}</p>
                  {channel && (
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      {channel.flag} {channel.countryName}{channel.network ? ` · ${channel.network}` : ''}
                      {channel.website && <> · <a href={channel.website} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-70 transition-opacity duration-200">website</a></>}
                    </p>
                  )}
                  <p className="text-sm mt-1" style={{ color: phaseLine[1] }} role="status" aria-live="polite">{phaseLine[0]}</p>
                </div>
                {channel && <StarButton on={channel.favourite} onClick={() => toggleStar(channel)} size={18} />}
              </div>

              {channel && stream && (
                <div className="flex flex-wrap gap-2">
                  <Tooltip text="Download a small playlist file for this link and open it with VLC, a free video player that plays many links a browser cannot.">
                    <button type="button" onClick={openInVlc} className={btn} style={chip(state.phase === 'vlc' || state.phase === 'failed')}>
                      {getIcon('download', { size: 14 })}Open in VLC
                    </button>
                  </Tooltip>
                  <Tooltip text="Copy this link to paste into VLC (Media, Open Network Stream) or another player.">
                    <button type="button" onClick={copyLink} className={btn} style={chip(false)}>
                      {getIcon(copied ? 'check' : 'copy', { size: 14 })}{copied ? 'Copied' : 'Copy link'}
                    </button>
                  </Tooltip>
                </div>
              )}

              {channel && channel.streams.length > 1 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Other links</p>
                  {channel.streams.map((s, i) => {
                    const on = stream && s.url === stream.url;
                    return (
                      <Tooltip key={s.url} text={`${HOW_LABEL[s.how]}${s.notes.length ? `. ${s.notes.join(', ')}` : ''}`}>
                        <button
                          type="button" onClick={() => playStream(channel, s)} aria-pressed={on}
                          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg border text-left text-xs hover:opacity-70 transition-opacity duration-200"
                          style={{ borderColor: on ? 'var(--color-primary)' : 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' }}
                        >
                          <span className="font-medium">Link {i + 1}</span>
                          <span style={{ color: 'var(--color-muted)' }}>{s.quality || 'quality not given'}{s.feed ? ` · ${s.feed}` : ''}</span>
                          <span className="ml-auto" style={{ color: s.how === 'browser' ? 'var(--color-muted)' : WARN }}>{s.how === 'browser' ? '' : 'Needs VLC'}</span>
                          {s.lastPlay && <span style={{ color: s.lastPlay.ok ? GOOD : BAD }}>{s.lastPlay.ok ? 'played' : 'failed'} last time</span>}
                        </button>
                      </Tooltip>
                    );
                  })}
                </div>
              )}
            </section>

            {/* ---- Find a channel ---- */}
            <section className="xl:order-1 rounded-2xl border p-4 space-y-3" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }} data-guide="browse">
              <div className="space-y-2.5" data-tour="live-tv-filters">
                <div className="flex gap-1.5" role="tablist" aria-label="Which channels">
                  {VIEWS.map((v) => (
                    <Tooltip key={v.id} text={v.tip}>
                      <button
                        type="button" role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}
                        className="px-3 py-1.5 rounded-lg border text-sm font-medium hover:opacity-70 transition-opacity duration-200" style={chip(view === v.id)}
                      >{v.label}</button>
                    </Tooltip>
                  ))}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {view === 'all' && (
                    <Tooltip text="Narrow the list to one country. A channel's country is where it broadcasts from.">
                      <select className={FIELD} style={FIELD_STYLE} aria-label="Country" value={country} onChange={(e) => setCountry(e.target.value)}>
                        <option value="">All countries</option>
                        {(meta?.countries || []).map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name} ({c.count})</option>)}
                      </select>
                    </Tooltip>
                  )}
                  <Tooltip text="Narrow the list to one kind of channel, such as news, sport or music.">
                    <select className={FIELD} style={FIELD_STYLE} aria-label="Kind of channel" value={category} onChange={(e) => setCategory(e.target.value)}>
                      <option value="">Every kind</option>
                      {(meta?.categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Tooltip>
                </div>
                <VoiceInput value={q} onChange={setQ} label="Search channels by name" placeholder="Search by channel name or network" maxLength={100} />
                <Tooltip text="Hide channels whose every link needs VLC. A channel that can play here may still fail.">
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
                    <input type="checkbox" checked={browserOnly} onChange={(e) => setBrowserOnly(e.target.checked)} />
                    Only ones that can play here
                  </label>
                </Tooltip>
              </div>

              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {view && !loading && !listError && `${total.toLocaleString()} channel${total === 1 ? '' : 's'}`}
                {meta?.fetchedAt && ` · list from ${new Date(meta.fetchedAt).toLocaleDateString()}`}
              </p>
              {listError && <p className="text-sm" style={{ color: BAD }} role="alert">{listError}</p>}

              <div className="space-y-2" data-tour="live-tv-list">
                {loading && list.length === 0 && Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
                {!loading && !listError && view && list.length === 0 && (
                  <EmptyState
                    icon="tv"
                    title={view === 'favourites' ? 'No favourites yet' : view === 'recent' ? 'Nothing watched yet' : 'No channels match'}
                    body={view === 'favourites' ? 'Press the star on a channel to keep it here.' : view === 'recent' ? 'Channels you play will show here.' : 'Try another country or kind, untick "Only ones that can play here", or clear the search.'}
                  />
                )}
                {list.map((c) => (
                  <ChannelRow key={c.id} channel={c} active={channel?.id === c.id} onPlay={playChannel} onStar={toggleStar} />
                ))}
                {list.length < total && (
                  <button type="button" onClick={() => load(list.length)} disabled={loading} className={`${btn} w-full`} style={chip(false)}>
                    {loading ? 'Loading…' : `Show more (${(total - list.length).toLocaleString()} left)`}
                  </button>
                )}
              </div>
            </section>
          </div>
        </div>

        {info.show && (
          <ToolInfoModal title="How Live TV Works" onClose={info.close}>
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>
              Watch free TV channels from around the world. Not sure where to start? Press the round button at the bottom right and tell the guide what you want to watch.
            </p>
            <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              {HOW_IT_WORKS.map(([heading, text]) => (
                <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
              ))}
            </div>
          </ToolInfoModal>
        )}

        <LiveTvTutorChat currentTool={channel ? 'player' : 'browse'} onOpenTool={openToolById} />
      </div>
    </VoiceInputProvider>
  );
}
