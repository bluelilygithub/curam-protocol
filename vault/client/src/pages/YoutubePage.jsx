import React, { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';

const TABS = [
  { id: 'search',     label: 'Search'     },
  { id: 'history',    label: 'History'    },
  { id: 'favourites', label: 'Favourites' },
];

const ORDER_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'date',      label: 'Newest'    },
  { value: 'viewCount', label: 'Views'     },
  { value: 'rating',    label: 'Rating'    },
];

const DURATION_OPTIONS = [
  { value: 'any',    label: 'Any length' },
  { value: 'short',  label: '< 4 min'   },
  { value: 'medium', label: '4–20 min'  },
  { value: 'long',   label: '> 20 min'  },
];

function parseDuration(iso) {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const h   = parseInt(m[1] || 0);
  const min = parseInt(m[2] || 0);
  const sec = parseInt(m[3] || 0);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(min)}:${pad(sec)}` : `${min}:${pad(sec)}`;
}

function fmtViews(n) {
  if (!n) return null;
  const v = Number(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M views`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(0)}K views`;
  return `${v} views`;
}

function fmtDate(iso) {
  if (!iso) return null;
  try { return new Date(iso).toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return null; }
}

function VideoCard({ video, activeId, onPlay, favSet, onSave, onUnsave }) {
  const dur = parseDuration(video.duration || video.dur);
  const views = fmtViews(video.viewCount || video.view_count);
  const isActive = activeId === (video.id || video.videoId || video.video_id);
  const videoId = video.id || video.videoId || video.video_id;
  const isFav = favSet.has(videoId);

  return (
    <div
      onClick={() => onPlay(video)}
      className="rounded-lg overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
      style={{
        background: 'var(--color-surface)',
        border: isActive ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
      }}
    >
      <div className="relative">
        {video.thumbnail ? (
          <img src={video.thumbnail} alt={video.title} className="w-full object-cover" style={{ aspectRatio: '16/9' }} />
        ) : (
          <div className="w-full flex items-center justify-center text-3xl" style={{ aspectRatio: '16/9', background: 'var(--color-border)' }}>📺</div>
        )}
        {dur && (
          <span className="absolute bottom-1 right-1 text-[11px] font-mono text-white px-1 rounded" style={{ background: 'rgba(0,0,0,0.75)' }}>
            {dur}
          </span>
        )}
      </div>
      <div className="p-2">
        <p className="text-xs font-medium leading-snug mb-1 line-clamp-2" style={{ color: 'var(--color-text)' }}>{video.title}</p>
        <p className="text-[11px] mb-1" style={{ color: 'var(--color-muted)' }}>{video.channel || video.channelTitle}</p>
        {views && <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{views}</p>}
      </div>
      <div className="flex items-center justify-end px-2 pb-2">
        <button
          onClick={(e) => { e.stopPropagation(); isFav ? onUnsave(videoId) : onSave(video); }}
          className="text-sm hover:opacity-60 transition-opacity"
          title={isFav ? 'Remove from favourites' : 'Save to favourites'}
          style={{ color: isFav ? '#ef4444' : 'var(--color-muted)' }}
        >
          {isFav ? '♥' : '♡'}
        </button>
      </div>
    </div>
  );
}

function VideoPlayer({ video, onClose }) {
  const videoId = video.id || video.videoId || video.video_id;
  return (
    <div className="mb-4 rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
        <iframe
          className="absolute inset-0 w-full h-full"
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`}
          title={video.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
      <div className="flex items-start justify-between px-3 py-2">
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{video.title}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{video.channel || video.channelTitle}</p>
        </div>
        <button onClick={onClose} className="ml-3 text-lg leading-none hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>✕</button>
      </div>
    </div>
  );
}

export default function YoutubePage() {
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const addToast = useToastStore((s) => s.addToast);
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.youtube !== false;

  const [tab, setTab] = useState('search');
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState('relevance');
  const [duration, setDuration] = useState('any');
  const [publishedAfter, setPublishedAfter] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeVideo, setActiveVideo] = useState(null);

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [favourites, setFavourites] = useState([]);
  const [favsLoading, setFavsLoading] = useState(false);
  const [favSet, setFavSet] = useState(new Set());

  useEffect(() => {
    api.get('/api/settings/feature-access').then(r => r.json()).then(data => {
      if (data?.flags && typeof data.flags === 'object') {
        setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...data.flags });
      }
    }).catch(() => {});
  }, []);

  const loadFavourites = useCallback(async () => {
    setFavsLoading(true);
    try {
      const data = await api.get('/api/youtube/favourites').then(r => r.json());
      setFavourites(Array.isArray(data) ? data : []);
      setFavSet(new Set((Array.isArray(data) ? data : []).map(v => v.videoId)));
    } catch {
      addToast({ type: 'error', message: 'Failed to load favourites.' });
    } finally {
      setFavsLoading(false);
    }
  }, [addToast]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await api.get('/api/youtube/history').then(r => r.json());
      setHistory(Array.isArray(data) ? data : []);
    } catch {
      addToast({ type: 'error', message: 'Failed to load history.' });
    } finally {
      setHistoryLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadFavourites();
  }, [loadFavourites]);

  useEffect(() => {
    if (tab === 'history') loadHistory();
    if (tab === 'favourites') loadFavourites();
  }, [tab, loadHistory, loadFavourites]);

  if (!canUse) return <Navigate to="/" replace />;

  async function doSearch(q, opts = {}) {
    const searchQ = q ?? query;
    if (!searchQ.trim()) return;
    setSearching(true);
    setActiveVideo(null);
    try {
      const params = new URLSearchParams({ q: searchQ.trim(), order: opts.order ?? order, duration: opts.duration ?? duration });
      if (opts.publishedAfter ?? publishedAfter) params.set('publishedAfter', new Date(opts.publishedAfter ?? publishedAfter).toISOString());
      const data = await api.get(`/api/youtube/search?${params}`).then(r => r.json());
      if (data.error) throw new Error(data.error);
      setResults(data.videos ?? []);
      setHasSearched(true);
      setTab('search');
    } catch (err) {
      addToast({ type: 'error', message: err.message });
    } finally {
      setSearching(false);
    }
  }

  async function handleSave(video) {
    const videoId = video.id || video.videoId || video.video_id;
    try {
      await api.post('/api/youtube/favourites', {
        videoId,
        title: video.title,
        channel: video.channel || video.channelTitle || null,
        thumbnail: video.thumbnail || null,
        duration: video.duration || null,
        viewCount: video.viewCount || video.view_count || null,
        publishedAt: video.publishedAt || null,
      });
      setFavSet(prev => new Set([...prev, videoId]));
      addToast({ type: 'success', message: 'Saved to favourites.' });
    } catch {
      addToast({ type: 'error', message: 'Failed to save.' });
    }
  }

  async function handleUnsave(videoId) {
    try {
      await api.delete(`/api/youtube/favourites/${videoId}`);
      setFavSet(prev => { const n = new Set(prev); n.delete(videoId); return n; });
      setFavourites(prev => prev.filter(v => v.videoId !== videoId));
      addToast({ type: 'success', message: 'Removed from favourites.' });
    } catch {
      addToast({ type: 'error', message: 'Failed to remove.' });
    }
  }

  async function deleteHistory(id) {
    try {
      await api.delete(`/api/youtube/history/${id}`);
      setHistory(prev => prev.filter(h => h.id !== id));
    } catch {
      addToast({ type: 'error', message: 'Failed to delete.' });
    }
  }

  const cardProps = { activeId: activeVideo?.id || activeVideo?.videoId, onPlay: setActiveVideo, favSet, onSave: handleSave, onUnsave: handleUnsave };

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <h1 className="font-semibold text-base" style={{ color: 'var(--color-text)' }}>YouTube</h1>
      </div>

      {/* Search bar — always visible */}
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <form
          onSubmit={(e) => { e.preventDefault(); doSearch(); }}
          className="flex gap-2 mb-2"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search YouTube…"
            className="flex-1 px-3 py-1.5 text-sm rounded-md border"
            style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          />
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="px-4 py-1.5 text-sm rounded-md font-medium hover:opacity-80 transition-opacity disabled:opacity-40"
            style={{ background: 'var(--color-primary)', color: '#fff' }}
          >
            {searching ? '…' : 'Search'}
          </button>
        </form>
        <div className="flex flex-wrap gap-2">
          <select
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            className="text-xs rounded px-2 py-1 border"
            style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          >
            {ORDER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="text-xs rounded px-2 py-1 border"
            style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          >
            {DURATION_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <input
            type="date"
            value={publishedAfter}
            onChange={(e) => setPublishedAfter(e.target.value)}
            title="Published after"
            className="text-xs rounded px-2 py-1 border"
            style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-4 py-2 text-sm transition-opacity hover:opacity-70"
            style={{
              color: tab === t.id ? 'var(--color-primary)' : 'var(--color-muted)',
              borderBottom: tab === t.id ? '2px solid var(--color-primary)' : '2px solid transparent',
              fontWeight: tab === t.id ? 600 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">

        {/* Search tab */}
        {tab === 'search' && (
          <>
            {activeVideo && (
              <VideoPlayer video={activeVideo} onClose={() => setActiveVideo(null)} />
            )}
            {searching && (
              <p className="text-sm text-center py-8" style={{ color: 'var(--color-muted)' }}>Searching…</p>
            )}
            {!searching && hasSearched && results.length === 0 && (
              <p className="text-sm text-center py-8" style={{ color: 'var(--color-muted)' }}>No results found.</p>
            )}
            {!searching && !hasSearched && (
              <p className="text-sm text-center py-12" style={{ color: 'var(--color-muted)' }}>Enter a query above to search YouTube.</p>
            )}
            {!searching && results.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {results.map(v => (
                  <VideoCard key={v.id} video={v} {...cardProps} />
                ))}
              </div>
            )}
          </>
        )}

        {/* History tab */}
        {tab === 'history' && (
          <>
            {historyLoading && <p className="text-sm text-center py-8" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
            {!historyLoading && history.length === 0 && (
              <p className="text-sm text-center py-12" style={{ color: 'var(--color-muted)' }}>No search history yet.</p>
            )}
            {!historyLoading && history.length > 0 && (
              <div className="space-y-1">
                {history.map(h => (
                  <div
                    key={h.id}
                    className="flex items-center justify-between px-3 py-2 rounded-md"
                    style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                  >
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => { setQuery(h.query); doSearch(h.query); }}
                        className="text-sm font-medium text-left hover:opacity-70 transition-opacity truncate block max-w-full"
                        style={{ color: 'var(--color-text)' }}
                      >
                        {h.query}
                      </button>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                        {h.resultCount ?? h.result_count} results · {fmtDate(h.createdAt || h.created_at)}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteHistory(h.id)}
                      className="ml-3 text-sm hover:opacity-60 transition-opacity"
                      title="Delete"
                      style={{ color: 'var(--color-muted)' }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Favourites tab */}
        {tab === 'favourites' && (
          <>
            {favsLoading && <p className="text-sm text-center py-8" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
            {!favsLoading && favourites.length === 0 && (
              <p className="text-sm text-center py-12" style={{ color: 'var(--color-muted)' }}>No saved videos yet. Click ♡ on a video to save it.</p>
            )}
            {!favsLoading && favourites.length > 0 && (
              <>
                {activeVideo && tab === 'favourites' && (
                  <VideoPlayer video={activeVideo} onClose={() => setActiveVideo(null)} />
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {favourites.map(v => (
                    <VideoCard key={v.videoId} video={{ ...v, id: v.videoId }} {...cardProps} />
                  ))}
                </div>
              </>
            )}
          </>
        )}

      </div>
    </div>
  );
}
