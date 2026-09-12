import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import { useVoice } from '../hooks/useVoice';
import Tooltip from '../components/Tooltip';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDuration(iso) {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return iso;
  const h   = parseInt(m[1] || 0);
  const min = parseInt(m[2] || 0);
  const s   = parseInt(m[3] || 0);
  if (h > 0) return `${h}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${min}:${String(s).padStart(2, '0')}`;
}

function fmtViews(n) {
  if (!n) return null;
  const v = parseInt(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M views`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(0)}K views`;
  return `${v} views`;
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86_400_000);
  if (d < 1)   return 'today';
  if (d < 7)   return `${d}d ago`;
  if (d < 30)  return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function looksLikeNLP(text) {
  if (text.trim().split(/\s+/).length > 3) return true;
  const keywords = /\b(short|medium|long|video|tutorial|today|week|month|year|hour|recent|latest|popular|views|rating|new|old)\b/i;
  return keywords.test(text);
}

function youtubeUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

// ── Filter options ────────────────────────────────────────────────────────────

const PUBLISHED_AFTER_OPTIONS = [
  { label: 'Any time',   key: '',      getIso: null },
  { label: 'Past hour',  key: 'hour',  getIso: () => new Date(Date.now() - 3_600_000).toISOString() },
  { label: 'Today',      key: 'today', getIso: () => new Date(Date.now() - 86_400_000).toISOString() },
  { label: 'This week',  key: 'week',  getIso: () => new Date(Date.now() - 7 * 86_400_000).toISOString() },
  { label: 'This month', key: 'month', getIso: () => new Date(Date.now() - 30 * 86_400_000).toISOString() },
  { label: 'This year',  key: 'year',  getIso: () => new Date(Date.now() - 365 * 86_400_000).toISOString() },
];

const DURATION_OPTIONS = [
  { label: 'Any duration',      value: 'any'    },
  { label: 'Short (< 4 min)',   value: 'short'  },
  { label: 'Medium (4–20 min)', value: 'medium' },
  { label: 'Long (> 20 min)',   value: 'long'   },
];

const ORDER_OPTIONS = [
  { label: 'Relevance',  value: 'relevance' },
  { label: 'Date',       value: 'date'      },
  { label: 'View count', value: 'viewCount' },
  { label: 'Rating',     value: 'rating'    },
];

const PUBLISHED_LABEL = Object.fromEntries(PUBLISHED_AFTER_OPTIONS.map(o => [o.key, o.label]));
const DURATION_LABEL  = Object.fromEntries(DURATION_OPTIONS.map(o => [o.value, o.label]));
const ORDER_LABEL     = Object.fromEntries(ORDER_OPTIONS.map(o => [o.value, o.label]));

// A short curated list of YouTube's supported regionCode ISO values — not exhaustive.
const REGION_OPTIONS = [
  { label: 'United States', value: 'US' },
  { label: 'United Kingdom', value: 'GB' },
  { label: 'Australia',      value: 'AU' },
  { label: 'Canada',         value: 'CA' },
  { label: 'India',          value: 'IN' },
];

// ── Shared styles ─────────────────────────────────────────────────────────────

const selectStyle = {
  padding: '0.4rem 0.6rem',
  borderRadius: '0.5rem',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  fontSize: '0.8rem',
  fontFamily: 'inherit',
  outline: 'none',
  cursor: 'pointer',
};

const btnBase = {
  fontFamily: 'inherit',
  borderRadius: '0.5rem',
  border: 'none',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.875rem',
};

// ── Video Card ────────────────────────────────────────────────────────────────

function VideoCard({ video, isFav, onPlay, onToggleFav }) {
  const dur   = parseDuration(video.duration);
  const views = fmtViews(video.viewCount);
  const ago   = timeAgo(video.publishedAt);

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '0.75rem',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        transition: 'transform 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.12)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
    >
      <div
        style={{ position: 'relative', aspectRatio: '16/9', background: '#000', overflow: 'hidden' }}
        onClick={() => onPlay(video)}
      >
        {video.thumbnail && (
          <img src={video.thumbnail} alt={video.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        )}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.2)' }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#ef4444"><polygon points="5,3 19,12 5,21"/></svg>
          </div>
        </div>
        {dur && (
          <span style={{ position: 'absolute', bottom: 6, right: 6, background: 'rgba(0,0,0,0.8)', color: '#fff', fontSize: '0.7rem', fontWeight: 600, padding: '1px 5px', borderRadius: 4 }}>
            {dur}
          </span>
        )}
      </div>

      <div style={{ padding: '0.6rem 0.75rem', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.3, margin: 0 }} onClick={() => onPlay(video)} title={video.title}>
          {video.title.length > 80 ? video.title.slice(0, 80) + '…' : video.title}
        </p>
        <p style={{ fontSize: '0.7rem', color: 'var(--color-muted)', margin: 0 }}>{video.channel}</p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--color-muted)' }}>
            {[views, ago].filter(Boolean).join(' · ')}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Tooltip text={isFav ? 'Remove from favourites' : 'Save to favourites'}>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleFav(video); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: isFav ? '#ef4444' : 'var(--color-muted)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Favourites row ────────────────────────────────────────────────────────────

function FavCard({ fav, onPlay, onRemove }) {
  const dur     = parseDuration(fav.duration);
  const views   = fmtViews(fav.viewCount || fav.view_count);
  const videoId = fav.videoId || fav.video_id;

  const playable = {
    id:          videoId,
    title:       fav.title,
    channel:     fav.channel,
    thumbnail:   fav.thumbnail,
    duration:    fav.duration,
    viewCount:   fav.viewCount || fav.view_count,
    publishedAt: fav.publishedAt || fav.published_at,
  };

  return (
    <div style={{ display: 'flex', gap: '0.75rem', padding: '0.6rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)', background: 'var(--color-surface)', alignItems: 'center' }}>
      <div onClick={() => onPlay(playable)} style={{ position: 'relative', flexShrink: 0, width: 112, height: 63, borderRadius: 6, overflow: 'hidden', background: '#000', cursor: 'pointer' }}>
        {fav.thumbnail && <img src={fav.thumbnail} alt={fav.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
        {dur && (
          <span style={{ position: 'absolute', bottom: 3, right: 4, background: 'rgba(0,0,0,0.8)', color: '#fff', fontSize: '0.65rem', fontWeight: 600, padding: '1px 4px', borderRadius: 3 }}>
            {dur}
          </span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p onClick={() => onPlay(playable)} style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)', margin: 0, cursor: 'pointer' }}>
          {fav.title.length > 90 ? fav.title.slice(0, 90) + '…' : fav.title}
        </p>
        <p style={{ fontSize: '0.7rem', color: 'var(--color-muted)', margin: '2px 0 0' }}>
          {fav.channel}{views ? ` · ${views}` : ''}
        </p>
      </div>
      <Tooltip text="Remove this video from your saved favourites.">
        <button onClick={() => onRemove(videoId)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', color: 'var(--color-muted)', flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </Tooltip>
    </div>
  );
}

// ── Transcript panel ──────────────────────────────────────────────────────────

function TranscriptPanel({ video, onClose }) {
  const addToast = useToastStore((s) => s.addToast);
  const [loading, setLoading] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState('');
  const [summary, setSummary] = useState('');
  const [showSummary, setShowSummary] = useState(false);
  const [languages, setLanguages] = useState([]);
  const [languageCode, setLanguageCode] = useState('');

  async function loadTranscript(summarize, langOverride) {
    if (summarize) setSummarizing(true); else setLoading(true);
    setError('');
    try {
      const data = await api.post('/api/youtube/transcript', {
        videoId: video.id,
        summarize,
        languageCode: langOverride ?? languageCode ?? undefined,
      }).then(r => r.json());
      if (data.error) throw new Error(data.error);
      setTranscript(data.transcript || '');
      if (data.summary) { setSummary(data.summary); setShowSummary(true); }
      else if (!summarize) { setSummary(''); setShowSummary(false); }
    } catch (err) {
      setError(err.message || 'Could not load the transcript.');
    } finally {
      setLoading(false);
      setSummarizing(false);
    }
  }

  useEffect(() => {
    loadTranscript(false);
    api.get(`/api/youtube/transcript-languages/${video.id}`).then(r => r.json()).then((data) => {
      const langs = Array.isArray(data.languages) ? data.languages : [];
      setLanguages(langs);
      const def = langs.find((l) => l.isDefault) || langs[0];
      if (def) setLanguageCode(def.languageCode);
    }).catch(() => {});
  }, [video.id]);

  function changeLanguage(code) {
    setLanguageCode(code);
    loadTranscript(false, code);
  }

  function copyText(text) {
    navigator.clipboard?.writeText(text).then(
      () => addToast({ type: 'success', message: 'Copied to clipboard.' }),
      () => addToast({ type: 'error', message: 'Could not copy.' })
    );
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '1rem', width: '100%', maxWidth: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '0.9rem 1.1rem', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text)', flex: 1, minWidth: 0 }}>{video.title}</p>
          <Tooltip text="Close this panel.">
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', fontSize: '1rem' }}>✕</button>
          </Tooltip>
        </div>

        <div style={{ padding: '0.75rem 1.1rem', display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
          {languages.length > 1 && (
            <Tooltip text="Choose which caption language to fetch the transcript in.">
              <select
                value={languageCode}
                onChange={(e) => changeLanguage(e.target.value)}
                disabled={loading}
                style={{ ...selectStyle, padding: '0.3rem 0.5rem', fontSize: '0.75rem' }}
              >
                {languages.map((l) => <option key={l.languageCode} value={l.languageCode}>{l.name}</option>)}
              </select>
            </Tooltip>
          )}
          <Tooltip text="Show the full transcript text.">
            <button
              onClick={() => setShowSummary(false)}
              disabled={loading}
              style={{ ...btnBase, padding: '0.35rem 0.75rem', fontSize: '0.75rem', background: !showSummary ? 'var(--color-primary)' : 'var(--color-bg)', color: !showSummary ? '#fff' : 'var(--color-muted)', border: '1px solid var(--color-border)' }}
            >
              Transcript
            </button>
          </Tooltip>
          <Tooltip text="Ask the AI for a short summary of this transcript instead of the full text.">
            <button
              onClick={() => summary ? setShowSummary(true) : loadTranscript(true)}
              disabled={loading || summarizing || !transcript}
              style={{ ...btnBase, padding: '0.35rem 0.75rem', fontSize: '0.75rem', background: showSummary ? 'var(--color-primary)' : 'var(--color-bg)', color: showSummary ? '#fff' : 'var(--color-muted)', border: '1px solid var(--color-border)', opacity: (loading || summarizing || !transcript) ? 0.6 : 1 }}
            >
              {summarizing ? 'Summarizing…' : 'Summarize'}
            </button>
          </Tooltip>
          <Tooltip text="Copy the text shown below to your clipboard.">
            <button
              onClick={() => copyText(showSummary ? summary : transcript)}
              disabled={loading || (!transcript && !summary)}
              style={{ ...btnBase, marginLeft: 'auto', padding: '0.35rem 0.75rem', fontSize: '0.75rem', background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
            >
              Copy
            </button>
          </Tooltip>
        </div>

        <div style={{ padding: '1rem 1.1rem', overflowY: 'auto', flex: 1 }}>
          {loading && <p style={{ color: 'var(--color-muted)', fontSize: '0.85rem' }}>Fetching transcript…</p>}
          {!loading && error && <p style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{error}</p>}
          {!loading && !error && (
            <p style={{ whiteSpace: 'pre-wrap', fontSize: '0.82rem', lineHeight: 1.55, color: 'var(--color-text)', margin: 0 }}>
              {showSummary ? summary : transcript}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Comments panel ────────────────────────────────────────────────────────────

function CommentsPanel({ video, onClose }) {
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [comments, setComments] = useState([]);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  async function load(pageToken) {
    if (pageToken) setLoadingMore(true); else setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (pageToken) params.set('pageToken', pageToken);
      const data = await api.get(`/api/youtube/comments/${video.id}?${params}`).then(r => r.json());
      if (data.error) throw new Error(data.error);
      setComments((prev) => pageToken ? [...prev, ...(data.comments || [])] : (data.comments || []));
      setNextPageToken(data.nextPageToken || null);
    } catch (err) {
      setError(err.message || 'Could not load comments.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => { load(null); }, [video.id]);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '1rem', width: '100%', maxWidth: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '0.9rem 1.1rem', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text)', flex: 1, minWidth: 0 }}>Comments — {video.title}</p>
          <Tooltip text="Close this panel.">
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', fontSize: '1rem' }}>✕</button>
          </Tooltip>
        </div>
        <div style={{ padding: '1rem 1.1rem', overflowY: 'auto', flex: 1 }}>
          {loading && <p style={{ color: 'var(--color-muted)', fontSize: '0.85rem' }}>Loading comments…</p>}
          {!loading && error && <p style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{error}</p>}
          {!loading && !error && comments.length === 0 && (
            <p style={{ color: 'var(--color-muted)', fontSize: '0.85rem' }}>No comments found.</p>
          )}
          {!loading && !error && comments.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              {comments.map((c) => (
                <div key={c.id} style={{ display: 'flex', gap: '0.6rem' }}>
                  {c.authorImage && <img src={c.authorImage} alt={c.author} style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0 }} />}
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text)' }}>
                      {c.author} <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>· {timeAgo(c.publishedAt)}{c.likeCount ? ` · ${c.likeCount} likes` : ''}</span>
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--color-text)', whiteSpace: 'pre-wrap' }}>{c.text}</p>
                  </div>
                </div>
              ))}
              {nextPageToken && (
                <Tooltip text="Load the next page of comments.">
                  <button
                    onClick={() => load(nextPageToken)}
                    disabled={loadingMore}
                    style={{ ...btnBase, alignSelf: 'center', padding: '0.35rem 0.9rem', fontSize: '0.75rem', background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                  >
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </Tooltip>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Video Modal ───────────────────────────────────────────────────────────────

function VideoModal({ video, isFav, onClose, onToggleFav, onMoreFromChannel }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [showComments, setShowComments]     = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    api.post('/api/youtube/watch-history', {
      videoId:     video.id,
      title:       video.title,
      channel:     video.channel,
      thumbnail:   video.thumbnail,
      duration:    video.duration,
      viewCount:   video.viewCount,
      publishedAt: video.publishedAt,
    }).catch(() => {});
  }, [video.id]);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-surface)', borderRadius: '1rem', overflow: 'hidden', width: '100%', maxWidth: 900, boxShadow: '0 25px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ position: 'relative', aspectRatio: '16/9', background: '#000' }}>
          <iframe
            src={`https://www.youtube.com/embed/${video.id}?rel=0`}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
          />
        </div>
        <div style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text)', margin: 0, lineHeight: 1.3 }}>{video.title}</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: '3px 0 0' }}>
              {video.channel}{video.viewCount ? ` · ${fmtViews(video.viewCount)}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Tooltip text="Fetch the caption transcript for this video, or an AI summary of it.">
              <button onClick={() => setShowTranscript(true)} style={{ ...btnBase, padding: '0.35rem 0.75rem', fontSize: '0.75rem', background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                Transcript
              </button>
            </Tooltip>
            <Tooltip text="See this video's top-level public comments.">
              <button onClick={() => setShowComments(true)} style={{ ...btnBase, padding: '0.35rem 0.75rem', fontSize: '0.75rem', background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                Comments
              </button>
            </Tooltip>
            {video.channelId && onMoreFromChannel && (
              <Tooltip text="See other videos from this same channel.">
                <button onClick={() => onMoreFromChannel(video)} style={{ ...btnBase, padding: '0.35rem 0.75rem', fontSize: '0.75rem', background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                  More from this channel
                </button>
              </Tooltip>
            )}
            <Tooltip text={isFav ? 'Remove this video from your saved favourites.' : 'Save this video to your favourites for quick access later.'}>
              <button onClick={() => onToggleFav(video)} style={{ ...btnBase, padding: '0.35rem 0.75rem', fontSize: '0.75rem', background: isFav ? '#fee2e2' : 'var(--color-bg)', border: `1px solid ${isFav ? '#fca5a5' : 'var(--color-border)'}`, color: isFav ? '#ef4444' : 'var(--color-muted)' }}>
                {isFav ? '♥ Saved' : '♡ Save'}
              </button>
            </Tooltip>
            <Tooltip text="Open this video directly on YouTube in a new tab.">
              <a href={youtubeUrl(video.id)} target="_blank" rel="noopener noreferrer" style={{ ...btnBase, padding: '0.35rem 0.75rem', fontSize: '0.75rem', background: '#ef4444', color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                Open on YouTube
              </a>
            </Tooltip>
            <Tooltip text="Close this preview.">
              <button onClick={onClose} style={{ ...btnBase, padding: '0.35rem 0.75rem', fontSize: '0.75rem', background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                Close
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
      {showTranscript && <TranscriptPanel video={video} onClose={() => setShowTranscript(false)} />}
      {showComments && <CommentsPanel video={video} onClose={() => setShowComments(false)} />}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function YoutubePage() {
  const { user } = useAuthStore();
  const isAdmin  = user?.isAdmin;
  const addToast = useToastStore((s) => s.addToast);
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.youtube !== false;

  const { isSTTAvailable, isListening, transcript, interimText, startListening, stopListening } = useVoice();
  const prevTranscriptRef = useRef('');

  const [tab, setTab] = useState('search');

  const [query,        setQuery]        = useState('');
  const [order,        setOrder]        = useState('relevance');
  const [duration,     setDuration]     = useState('any');
  const [publishedKey, setPublishedKey] = useState('');
  const [liveOnly,     setLiveOnly]     = useState(false);
  const [parsing,      setParsing]      = useState(false);
  const [interpreted,  setInterpreted]  = useState(null); // { q, order, duration, publishedKey, reasoning }
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [videos,       setVideos]       = useState([]);
  const [totalResults, setTotalResults] = useState(0);

  const [favs,    setFavs]    = useState([]);
  const [favSet,  setFavSet]  = useState(new Set());
  const [history, setHistory] = useState([]);
  const [watchHistory, setWatchHistory] = useState([]);
  const [showWatchHistory, setShowWatchHistory] = useState(false);

  const [activeVideo, setActiveVideo] = useState(null);

  // Channel view — "More from this channel" swaps the results grid to a channel feed
  const [channelView,  setChannelView]  = useState(null); // { channelId, channelName }
  const [channelVideos, setChannelVideos] = useState([]);
  const [channelLoading, setChannelLoading] = useState(false);

  // Playlist view — open a playlist URL/id as an ordered set, same grid + back affordance
  const [playlistInput,   setPlaylistInput]   = useState('');
  const [playlistView,    setPlaylistView]    = useState(null); // { title }
  const [playlistVideos,  setPlaylistVideos]  = useState([]);
  const [playlistLoading, setPlaylistLoading] = useState(false);

  // Saved lists
  const [lists,        setLists]        = useState([]);
  const [openList,     setOpenList]     = useState(null); // { id, title, videos }
  const [listLoading,  setListLoading]  = useState(false);

  // Trending
  const [trendingRegion,   setTrendingRegion]   = useState('US');
  const [trendingCategory, setTrendingCategory] = useState('');
  const [categories,       setCategories]       = useState([]);
  const [trendingVideos,   setTrendingVideos]   = useState([]);
  const [trendingLoading,  setTrendingLoading]  = useState(false);
  const [trendingLoaded,   setTrendingLoaded]   = useState(false);

  useEffect(() => {
    api.get('/api/settings/feature-access').then(r => r.json()).then(data => {
      if (data?.flags && typeof data.flags === 'object') {
        setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...data.flags });
      }
    }).catch(() => {});
    loadFavs();
    loadHistory();
    loadLists();
    loadWatchHistory();
    loadCategories('US');
  }, []);

  // When mic finishes, populate query and auto-search
  useEffect(() => {
    if (transcript && transcript !== prevTranscriptRef.current) {
      prevTranscriptRef.current = transcript;
      setQuery(transcript);
      runSearch(transcript);
    }
  }, [transcript]);

  function loadFavs() {
    api.get('/api/youtube/favourites').then(r => r.json()).then((rows) => {
      setFavs(Array.isArray(rows) ? rows : []);
      setFavSet(new Set((Array.isArray(rows) ? rows : []).map((r) => r.videoId || r.video_id)));
    }).catch(() => {});
  }

  function loadHistory() {
    api.get('/api/youtube/history').then(r => r.json()).then((rows) => {
      setHistory(Array.isArray(rows) ? rows : []);
    }).catch(() => {});
  }

  function loadLists() {
    api.get('/api/youtube/lists').then(r => r.json()).then((rows) => {
      setLists(Array.isArray(rows) ? rows : []);
    }).catch(() => {});
  }

  function loadWatchHistory() {
    api.get('/api/youtube/watch-history').then(r => r.json()).then((rows) => {
      setWatchHistory(Array.isArray(rows) ? rows : []);
    }).catch(() => {});
  }

  function loadCategories(regionCode) {
    api.get(`/api/youtube/categories?regionCode=${encodeURIComponent(regionCode)}`).then(r => r.json()).then((data) => {
      setCategories(Array.isArray(data.categories) ? data.categories : []);
    }).catch(() => {});
  }

  async function loadTrending(regionCode = trendingRegion, categoryId = trendingCategory) {
    setTrendingLoading(true);
    setTrendingLoaded(true);
    try {
      const params = new URLSearchParams({ regionCode });
      if (categoryId) params.set('categoryId', categoryId);
      const data = await api.get(`/api/youtube/trending?${params}`).then(r => r.json());
      if (data.error) throw new Error(data.error);
      setTrendingVideos(data.videos ?? []);
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Could not load trending videos.' });
    } finally {
      setTrendingLoading(false);
    }
  }

  function openTrendingTab() {
    setTab('trending');
    if (!trendingLoaded) loadTrending();
  }

  function changeTrendingRegion(regionCode) {
    setTrendingRegion(regionCode);
    setTrendingCategory('');
    loadCategories(regionCode);
    loadTrending(regionCode, '');
  }

  function changeTrendingCategory(categoryId) {
    setTrendingCategory(categoryId);
    loadTrending(trendingRegion, categoryId);
  }

  async function openPlaylist(rawInput) {
    const input = (rawInput ?? playlistInput).trim();
    if (!input) return;
    setActiveVideo(null);
    setChannelView(null);
    setPlaylistView({ title: 'Playlist' });
    setPlaylistLoading(true);
    setPlaylistVideos([]);
    setTab('search');
    try {
      const data = await api.get(`/api/youtube/playlist/${encodeURIComponent(input)}`).then(r => r.json());
      if (data.error) throw new Error(data.error);
      setPlaylistVideos(data.videos ?? []);
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Could not open this playlist.' });
      setPlaylistView(null);
    } finally {
      setPlaylistLoading(false);
    }
  }

  function backFromPlaylist() {
    setPlaylistView(null);
    setPlaylistVideos([]);
  }

  async function openMoreFromChannel(video) {
    if (!video.channelId) return;
    setActiveVideo(null);
    setPlaylistView(null);
    setPlaylistVideos([]);
    setChannelView({ channelId: video.channelId, channelName: video.channel });
    setChannelLoading(true);
    setChannelVideos([]);
    setTab('search');
    try {
      const data = await api.get(`/api/youtube/channel/${encodeURIComponent(video.channelId)}`).then(r => r.json());
      if (data.error) throw new Error(data.error);
      setChannelVideos(data.videos ?? []);
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Could not load this channel.' });
    } finally {
      setChannelLoading(false);
    }
  }

  function backToSearch() {
    setChannelView(null);
    setChannelVideos([]);
  }

  async function saveCurrentSearchAsList() {
    const source = channelView ? channelVideos : (playlistView ? playlistVideos : videos);
    if (!source.length) return;
    const title = window.prompt('Name this list:', channelView ? `${channelView.channelName} videos` : (playlistView ? 'Playlist videos' : query));
    if (!title?.trim()) return;
    try {
      await api.post('/api/youtube/lists', { title: title.trim(), videos: source });
      addToast({ type: 'success', message: 'Saved as a list.' });
      loadLists();
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Could not save this list.' });
    }
  }

  async function openSavedList(list) {
    setListLoading(true);
    setOpenList(null);
    try {
      const data = await api.get(`/api/youtube/lists/${list.id}`).then(r => r.json());
      if (data.error) throw new Error(data.error);
      setOpenList(data);
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Could not load this list.' });
    } finally {
      setListLoading(false);
    }
  }

  async function deleteSavedList(id) {
    await api.delete(`/api/youtube/lists/${id}`).catch(() => {});
    setLists((l) => l.filter((x) => x.id !== id));
    setOpenList((o) => (o && o.id === id ? null : o));
  }

  async function runSearch(rawInput, overrideParams = null) {
    const input = (rawInput ?? query).trim();
    if (!input) return;

    setLoading(true);
    setError('');
    setVideos([]);
    setInterpreted(null);

    let searchQ        = input;
    let searchOrder    = order;
    let searchDuration = duration;
    let searchPubKey   = publishedKey;

    if (overrideParams) {
      searchQ        = overrideParams.q;
      searchOrder    = overrideParams.order;
      searchDuration = overrideParams.duration;
      searchPubKey   = overrideParams.publishedKey;
    } else if (looksLikeNLP(input)) {
      setParsing(true);
      try {
        const parsed = await api.post('/api/youtube/parse-query', { input }).then(r => r.json());
        if (!parsed.error) {
          searchQ        = parsed.q;
          searchOrder    = parsed.order;
          searchDuration = parsed.duration;
          searchPubKey   = parsed.publishedKey;
          setQuery(parsed.q);
          setOrder(parsed.order);
          setDuration(parsed.duration);
          setPublishedKey(parsed.publishedKey);
          setInterpreted(parsed);
        }
      } catch { /* fall through with raw input */ }
      setParsing(false);
    }

    try {
      const pub = PUBLISHED_AFTER_OPTIONS.find((o) => o.key === searchPubKey);
      const publishedAfter = pub?.getIso ? pub.getIso() : '';
      const params = new URLSearchParams({ q: searchQ, order: searchOrder, duration: searchDuration });
      if (publishedAfter) params.set('publishedAfter', publishedAfter);
      if (liveOnly) params.set('eventType', 'live');

      const data = await api.get(`/api/youtube/search?${params}`).then(r => r.json());
      if (data.error) throw new Error(data.error);
      setVideos(data.videos ?? []);
      setTotalResults(data.totalResults ?? 0);
      loadHistory();
      setTab('search');
    } catch (err) {
      setError(err.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch(e) {
    e?.preventDefault();
    await runSearch(query);
  }

  const toggleFav = useCallback(async (video) => {
    const isFav = favSet.has(video.id);
    try {
      if (isFav) {
        await api.delete(`/api/youtube/favourites/${video.id}`);
        setFavSet((s) => { const n = new Set(s); n.delete(video.id); return n; });
        setFavs((f) => f.filter((x) => (x.videoId || x.video_id) !== video.id));
      } else {
        await api.post('/api/youtube/favourites', {
          videoId:     video.id,
          title:       video.title,
          channel:     video.channel,
          thumbnail:   video.thumbnail,
          duration:    video.duration,
          viewCount:   video.viewCount,
          publishedAt: video.publishedAt,
        });
        setFavSet((s) => new Set([...s, video.id]));
        loadFavs();
      }
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed.' });
    }
  }, [favSet, addToast]);

  async function deleteHistory(id) {
    await api.delete(`/api/youtube/history/${id}`).catch(() => {});
    setHistory((h) => h.filter((r) => r.id !== id));
  }

  async function replaySearch(row) {
    const filters = row.filters || {};
    const q   = row.query;
    const ord = filters.order    || 'relevance';
    const dur = filters.duration || 'any';

    setQuery(q);
    setOrder(ord);
    setDuration(dur);
    setPublishedKey('');
    setInterpreted(null);

    await runSearch(q, { q, order: ord, duration: dur, publishedKey: '' });
  }

  const TAB_TOOLTIPS = {
    search: 'This search\'s results.',
    trending: 'What\'s popular right now, by region and category.',
    favourites: 'Videos you\'ve saved for quick access.',
    history: 'Your past searches — click Re-run to search again.',
    lists: 'Named lists of results you\'ve saved to come back to later.',
  };

  const tabBtn = (key, label, badge, onClick) => (
    <Tooltip key={key} text={TAB_TOOLTIPS[key]}>
    <button
      onClick={onClick || (() => setTab(key))}
      style={{
        padding: '0.35rem 0.85rem', fontSize: '0.8rem', fontWeight: 500,
        fontFamily: 'inherit', borderRadius: '0.5rem', cursor: 'pointer', border: 'none',
        background: tab === key ? 'var(--color-primary)' : 'transparent',
        color:      tab === key ? '#fff' : 'var(--color-muted)',
      }}
    >
      {label}
      {badge > 0 && (
        <span style={{ marginLeft: 5, fontSize: '0.65rem', fontWeight: 700, background: tab === key ? 'rgba(255,255,255,0.3)' : 'var(--color-border)', padding: '0px 5px', borderRadius: 10, color: tab === key ? '#fff' : 'var(--color-muted)' }}>
          {badge}
        </span>
      )}
    </button>
    </Tooltip>
  );

  if (!canUse) return <Navigate to="/" replace />;

  const isBusy = loading || parsing;

  return (
    <div className="p-5 max-w-7xl mx-auto" style={{ fontFamily: 'inherit' }}>

      {/* Header */}
      <div className="mb-5">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: 4 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="#ef4444">
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
          </svg>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>YouTube</h1>
        </div>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Search YouTube videos, save favourites, and replay past searches.
        </p>
      </div>

      {/* Search form */}
      <form onSubmit={handleSearch} style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 240px', minWidth: 200, position: 'relative' }}>
            <Tooltip text="Type a topic, or describe what you want in plain language — filters like duration or date get picked up automatically.">
              <input
                type="text"
                value={isListening ? (interimText || query) : query}
                onChange={(e) => { setQuery(e.target.value); setInterpreted(null); }}
                placeholder={isListening ? 'Listening…' : 'Search or describe what you want…'}
                style={{
                  width: '100%', padding: '0.5rem 2.5rem 0.5rem 0.75rem',
                  borderRadius: '0.5rem', border: `2px solid ${isListening ? '#ef4444' : 'var(--color-border)'}`,
                  background: 'var(--color-bg)', color: 'var(--color-text)',
                  fontSize: '0.875rem', fontFamily: 'inherit', outline: 'none',
                  boxSizing: 'border-box',
                }}
                onFocus={(e)  => { if (!isListening) e.target.style.borderColor = 'var(--color-primary)'; }}
                onBlur={(e)   => { if (!isListening) e.target.style.borderColor = 'var(--color-border)'; }}
                readOnly={isListening}
              />
            </Tooltip>
            {/* Mic button inside input */}
            {isSTTAvailable && (
              <Tooltip text={isListening ? 'Stop recording.' : 'Search by speaking instead of typing.'}>
                <button
                  type="button"
                  onClick={() => isListening ? stopListening() : startListening()}
                  style={{
                    position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                    color: isListening ? '#ef4444' : 'var(--color-muted)',
                    animation: isListening ? 'pulse 1s infinite' : 'none',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill={isListening ? '#ef4444' : 'currentColor'}>
                    <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v6a2 2 0 0 0 4 0V5a2 2 0 0 0-2-2zm-7 9a7 7 0 0 0 14 0h2a9 9 0 0 1-8 8.94V23h-2v-2.06A9 9 0 0 1 3 12h2z"/>
                  </svg>
                </button>
              </Tooltip>
            )}
          </div>

          <Tooltip text="How to sort the results — relevance, newest first, most viewed, or highest rated.">
            <select value={order}        onChange={(e) => setOrder(e.target.value)}        style={selectStyle}>
              {ORDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Tooltip>

          <Tooltip text="Only show videos of roughly this length.">
            <select value={duration}     onChange={(e) => setDuration(e.target.value)}     style={selectStyle}>
              {DURATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Tooltip>

          <Tooltip text="Only show videos published within this time window.">
            <select value={publishedKey} onChange={(e) => setPublishedKey(e.target.value)} style={selectStyle}>
              {PUBLISHED_AFTER_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </Tooltip>

          <Tooltip text="Only show streams that are currently broadcasting live, matching your query.">
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8rem', color: 'var(--color-muted)', cursor: 'pointer', padding: '0.4rem 0.2rem' }}>
              <input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} />
              Live now
            </label>
          </Tooltip>

          <Tooltip text="Run the search with the query and filters above.">
            <button
              type="submit"
              disabled={isBusy || !query.trim()}
              style={{
                ...btnBase,
                padding: '0.5rem 1.25rem',
                background: isBusy || !query.trim() ? 'var(--color-border)' : '#ef4444',
                color: '#fff',
                cursor: isBusy || !query.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {parsing ? 'Thinking…' : loading ? 'Searching…' : 'Search'}
            </button>
          </Tooltip>
        </div>
      </form>

      {/* Playlist entry */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <Tooltip text="Paste a full YouTube playlist URL, or just its playlist id, to open it as an ordered set of videos.">
          <input
            type="text"
            value={playlistInput}
            onChange={(e) => setPlaylistInput(e.target.value)}
            placeholder="Paste a YouTube playlist URL or id…"
            style={{ flex: '1 1 260px', minWidth: 200, padding: '0.4rem 0.6rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.8rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
          />
        </Tooltip>
        <Tooltip text="Open this playlist's videos.">
          <button
            type="button"
            onClick={() => openPlaylist()}
            disabled={!playlistInput.trim()}
            style={{ ...btnBase, padding: '0.4rem 0.9rem', fontSize: '0.8rem', background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)', opacity: !playlistInput.trim() ? 0.6 : 1 }}
          >
            Open playlist
          </button>
        </Tooltip>
      </div>

      {/* Interpreted strip */}
      {interpreted && !isBusy && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
          marginBottom: '1rem', padding: '0.5rem 0.75rem',
          borderRadius: '0.5rem', background: 'var(--color-surface)',
          border: '1px solid var(--color-border)', fontSize: '0.75rem',
        }}>
          <span style={{ color: 'var(--color-primary)', fontWeight: 700, flexShrink: 0 }}>✦ AI</span>
          <span style={{ color: 'var(--color-muted)' }}>
            Searched for <strong style={{ color: 'var(--color-text)' }}>"{interpreted.q}"</strong>
            {interpreted.order !== 'relevance' && <> · sorted by <strong style={{ color: 'var(--color-text)' }}>{ORDER_LABEL[interpreted.order]}</strong></>}
            {interpreted.duration !== 'any' && <> · <strong style={{ color: 'var(--color-text)' }}>{DURATION_LABEL[interpreted.duration]}</strong></>}
            {interpreted.publishedKey && <> · <strong style={{ color: 'var(--color-text)' }}>{PUBLISHED_LABEL[interpreted.publishedKey]}</strong></>}
            {interpreted.reasoning && <> — <em>{interpreted.reasoning}</em></>}
          </span>
          <Tooltip text="Dismiss this — it doesn't change your search.">
            <button onClick={() => setInterpreted(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', marginLeft: 'auto', flexShrink: 0 }}>✕</button>
          </Tooltip>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem' }}>
        {tabBtn('search',     'Results',    videos.length)}
        {tabBtn('trending',   'Trending',   0, openTrendingTab)}
        {tabBtn('favourites', 'Favourites', favs.length)}
        {tabBtn('history',    'History',    history.length)}
        {tabBtn('lists',      'Lists',      lists.length)}
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '1rem' }}>
          <p style={{ fontSize: '0.875rem', color: '#b91c1c', margin: 0 }}>{error}</p>
        </div>
      )}

      {/* ── Search Results ─────────────────────────────────────────────────── */}
      {tab === 'search' && (() => {
        const inChannel  = !!channelView;
        const inPlaylist = !!playlistView && !inChannel;
        const extraView  = inChannel || inPlaylist;
        const extraLoading = inChannel ? channelLoading : (inPlaylist ? playlistLoading : false);
        const extraVideos  = inChannel ? channelVideos  : (inPlaylist ? playlistVideos  : []);
        const extraBack    = inChannel ? backToSearch   : backFromPlaylist;
        const extraLabel   = inChannel ? <>Videos from <strong style={{ color: 'var(--color-text)' }}>{channelView.channelName}</strong></> : 'Playlist videos';

        return (
        <div>
          {extraView && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <Tooltip text="Go back to your search results.">
                <button onClick={extraBack} style={{ ...btnBase, padding: '0.3rem 0.7rem', fontSize: '0.75rem', background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                  ← Back to search
                </button>
              </Tooltip>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', margin: 0 }}>{extraLabel}</p>
            </div>
          )}

          {(extraView ? extraLoading : isBusy) && (
            <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--color-muted)', fontSize: '0.9rem' }}>
              {inChannel ? 'Loading channel videos…' : inPlaylist ? 'Loading playlist videos…' : (parsing ? 'Understanding your request…' : 'Searching YouTube…')}
            </div>
          )}
          {!extraView && !isBusy && videos.length === 0 && (
            <div style={{ textAlign: 'center', padding: '4rem 2rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '1rem' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="#d1d5db" style={{ margin: '0 auto 1rem' }}>
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/>
              </svg>
              <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem' }}>
                Enter a topic above or describe what you want to find.
              </p>
            </div>
          )}
          {extraView && !extraLoading && extraVideos.length === 0 && (
            <div style={{ textAlign: 'center', padding: '4rem 2rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '1rem' }}>
              <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem' }}>{inChannel ? 'No videos found for this channel.' : 'No videos found in this playlist.'}</p>
            </div>
          )}
          {((extraView && !extraLoading && extraVideos.length > 0) || (!extraView && !isBusy && videos.length > 0)) && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: 0 }}>
                  {extraView
                    ? `Showing ${extraVideos.length} videos`
                    : `Showing ${videos.length} of ~${totalResults.toLocaleString()} results`}
                </p>
                <Tooltip text="Save this whole set of results as a named list you can come back to later.">
                  <button onClick={saveCurrentSearchAsList} style={{ ...btnBase, padding: '0.3rem 0.7rem', fontSize: '0.75rem', background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                    Save this search as a list
                  </button>
                </Tooltip>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
                {(extraView ? extraVideos : videos).map((v) => (
                  <VideoCard key={v.id} video={v} isFav={favSet.has(v.id)} onPlay={setActiveVideo} onToggleFav={toggleFav} />
                ))}
              </div>
            </>
          )}
        </div>
        );
      })()}

      {/* ── Trending ───────────────────────────────────────────────────────── */}
      {tab === 'trending' && (
        <div>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <Tooltip text="Show what's popular in this region.">
              <select value={trendingRegion} onChange={(e) => changeTrendingRegion(e.target.value)} style={selectStyle}>
                {REGION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Tooltip>
            <Tooltip text="Only show trending videos in this category.">
              <select value={trendingCategory} onChange={(e) => changeTrendingCategory(e.target.value)} style={selectStyle}>
                <option value="">All categories</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </Tooltip>
          </div>

          {trendingLoading && (
            <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--color-muted)', fontSize: '0.9rem' }}>Loading trending videos…</div>
          )}
          {!trendingLoading && trendingVideos.length === 0 && (
            <div style={{ textAlign: 'center', padding: '4rem 2rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '1rem' }}>
              <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem' }}>No trending videos found for this region/category.</p>
            </div>
          )}
          {!trendingLoading && trendingVideos.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
              {trendingVideos.map((v) => (
                <VideoCard key={v.id} video={v} isFav={favSet.has(v.id)} onPlay={setActiveVideo} onToggleFav={toggleFav} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Favourites ─────────────────────────────────────────────────────── */}
      {tab === 'favourites' && (
        <div>
          {favs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '4rem 2rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '1rem' }}>
              <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem' }}>No saved videos yet. Click the heart icon on any video to save it.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {favs.map((fav) => (
                <FavCard
                  key={fav.videoId || fav.video_id}
                  fav={fav}
                  onPlay={setActiveVideo}
                  onRemove={async (videoId) => {
                    await api.delete(`/api/youtube/favourites/${videoId}`).catch(() => {});
                    setFavSet((s) => { const n = new Set(s); n.delete(videoId); return n; });
                    setFavs((f) => f.filter((x) => (x.videoId || x.video_id) !== videoId));
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── History ────────────────────────────────────────────────────────── */}
      {tab === 'history' && (
        <div>
          <div style={{ marginBottom: '1rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '1rem', overflow: 'hidden' }}>
            <Tooltip text="Videos you've opened recently, most recent first.">
              <button
                onClick={() => setShowWatchHistory((s) => !s)}
                style={{ ...btnBase, width: '100%', textAlign: 'left', padding: '0.75rem 1rem', background: 'none', color: 'var(--color-text)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <span>Recently watched {watchHistory.length > 0 && `(${watchHistory.length})`}</span>
                <span style={{ color: 'var(--color-muted)', fontSize: '0.75rem' }}>{showWatchHistory ? '▲ Hide' : '▼ Show'}</span>
              </button>
            </Tooltip>
            {showWatchHistory && (
              <div style={{ borderTop: '1px solid var(--color-border)', padding: '0.75rem 1rem' }}>
                {watchHistory.length === 0 ? (
                  <p style={{ color: 'var(--color-muted)', fontSize: '0.85rem', margin: 0 }}>Nothing watched yet — opening a video records it here.</p>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
                      <Tooltip text="Remove every entry from your watch history.">
                        <button
                          onClick={async () => { await api.delete('/api/youtube/watch-history/all').catch(() => {}); setWatchHistory([]); }}
                          style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 5, border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          Clear all
                        </button>
                      </Tooltip>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
                      {watchHistory.map((v) => (
                        <VideoCard
                          key={v.videoId}
                          video={{ id: v.videoId, title: v.title, channel: v.channel, thumbnail: v.thumbnail, duration: v.duration, viewCount: v.viewCount, publishedAt: v.publishedAt }}
                          isFav={favSet.has(v.videoId)}
                          onPlay={setActiveVideo}
                          onToggleFav={toggleFav}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '1rem', overflow: 'hidden' }}>
          {history.length === 0 ? (
            <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-muted)', fontSize: '0.875rem' }}>No search history yet.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: 'var(--color-bg)' }}>
                  {['Query', 'Filters', 'Results', 'When', ''].map((h) => (
                    <th key={h} style={{ padding: '0.6rem 0.9rem', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((row) => {
                  const f = row.filters || {};
                  const filterParts = [
                    f.order && f.order !== 'relevance' ? f.order : null,
                    f.duration && f.duration !== 'any' ? f.duration : null,
                    f.publishedAfter ? 'date filtered' : null,
                  ].filter(Boolean);
                  return (
                    <tr key={row.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '0.6rem 0.9rem', color: 'var(--color-text)', fontWeight: 600 }}>{row.query}</td>
                      <td style={{ padding: '0.6rem 0.9rem', color: 'var(--color-muted)' }}>{filterParts.length ? filterParts.join(', ') : '—'}</td>
                      <td style={{ padding: '0.6rem 0.9rem', color: 'var(--color-muted)' }}>{row.resultCount ?? row.result_count}</td>
                      <td style={{ padding: '0.6rem 0.9rem', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>{timeAgo(row.createdAt || row.created_at)}</td>
                      <td style={{ padding: '0.6rem 0.9rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <Tooltip text="Run this search again with the same query and filters.">
                          <button onClick={() => replaySearch(row)} style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: 5, border: '1px solid var(--color-primary)', background: 'none', color: 'var(--color-primary)', cursor: 'pointer', marginRight: 6, fontFamily: 'inherit' }}>Re-run</button>
                        </Tooltip>
                        <Tooltip text="Remove this entry from your search history.">
                          <button onClick={() => deleteHistory(row.id)} style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: 5, border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>×</button>
                        </Tooltip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        </div>
      )}

      {/* ── Lists ──────────────────────────────────────────────────────────── */}
      {tab === 'lists' && (
        <div>
          {openList ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <Tooltip text="Go back to your saved lists.">
                  <button onClick={() => setOpenList(null)} style={{ ...btnBase, padding: '0.3rem 0.7rem', fontSize: '0.75rem', background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                    ← Back to lists
                  </button>
                </Tooltip>
                <p style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>{openList.title}</p>
                <Tooltip text="Permanently delete this saved list.">
                  <button onClick={() => deleteSavedList(openList.id)} style={{ ...btnBase, marginLeft: 'auto', padding: '0.3rem 0.7rem', fontSize: '0.75rem', background: '#fee2e2', border: '1px solid #fca5a5', color: '#ef4444' }}>
                    Delete list
                  </button>
                </Tooltip>
              </div>
              {openList.videos.length === 0 ? (
                <p style={{ color: 'var(--color-muted)', fontSize: '0.85rem' }}>This list has no videos.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
                  {openList.videos.map((v) => (
                    <VideoCard
                      key={v.videoId}
                      video={{ id: v.videoId, title: v.title, channel: v.channel, thumbnail: v.thumbnail, duration: v.duration, viewCount: v.viewCount, publishedAt: v.publishedAt }}
                      isFav={favSet.has(v.videoId)}
                      onPlay={setActiveVideo}
                      onToggleFav={toggleFav}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : listLoading ? (
            <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--color-muted)', fontSize: '0.9rem' }}>Loading list…</div>
          ) : lists.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '4rem 2rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '1rem' }}>
              <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem' }}>No saved lists yet. Run a search, then use "Save this search as a list".</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {lists.map((l) => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>{l.title}</p>
                    <p style={{ fontSize: '0.7rem', color: 'var(--color-muted)', margin: '2px 0 0' }}>{l.itemCount} video{l.itemCount === 1 ? '' : 's'} · {timeAgo(l.createdAt)}</p>
                  </div>
                  <Tooltip text="Open this list's videos.">
                    <button onClick={() => openSavedList(l)} style={{ fontSize: '0.75rem', fontWeight: 600, padding: '4px 10px', borderRadius: 5, border: '1px solid var(--color-primary)', background: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontFamily: 'inherit' }}>Open</button>
                  </Tooltip>
                  <Tooltip text="Permanently delete this saved list.">
                    <button onClick={() => deleteSavedList(l.id)} style={{ fontSize: '0.75rem', padding: '4px 8px', borderRadius: 5, border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>×</button>
                  </Tooltip>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Video Modal */}
      {activeVideo && (
        <VideoModal
          video={activeVideo}
          isFav={favSet.has(activeVideo.id)}
          onClose={() => setActiveVideo(null)}
          onToggleFav={toggleFav}
          onMoreFromChannel={openMoreFromChannel}
        />
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
