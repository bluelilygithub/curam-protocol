import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/apiClient';
import useToastStore from '../store/toastStore';
import { useIcon } from '../providers/IconProvider';

const CATEGORY_ORDER = ['urgent', 'waiting', 'fyi', 'noise'];
const CATEGORY_LABELS = { urgent: 'Urgent', waiting: 'Waiting', fyi: 'FYI', noise: 'Noise' };
const CATEGORY_COLOR = { urgent: '#ef4444', waiting: '#f59e0b', fyi: '#3b82f6', noise: '#94a3b8' };
const CATEGORY_BG = {
  urgent: 'rgba(239,68,68,0.1)',
  waiting: 'rgba(245,158,11,0.1)',
  fyi: 'rgba(59,130,246,0.1)',
  noise: 'rgba(148,163,184,0.1)',
};

const REFRESH_MS = 5 * 60 * 1000;

function cleanSender(from) {
  const nameMatch = from.match(/^"?([^"<]+)"?\s*</);
  if (nameMatch) return nameMatch[1].trim();
  const emailMatch = from.match(/<([^>]+)>/);
  if (emailMatch) return emailMatch[1];
  return from;
}

function EmailRow({ email: e }) {
  return (
    <div
      className="flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors"
      style={{
        borderColor: e.isUnread ? 'var(--color-primary)' : 'var(--color-border)',
        borderLeft: e.isUnread ? '3px solid var(--color-primary)' : undefined,
        background: 'var(--color-surface)',
      }}
    >
      <span
        className="flex-shrink-0 text-xs font-bold uppercase px-2 py-0.5 rounded mt-0.5 tracking-wide"
        style={{ background: CATEGORY_BG[e.category], color: CATEGORY_COLOR[e.category] }}
      >
        {e.category}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
          {cleanSender(e.sender)}
        </div>
        <div className="text-xs truncate mt-0.5" style={{ color: 'var(--color-muted)' }}>
          {e.one_line_summary}
        </div>
      </div>
      <div className="flex-shrink-0 text-xs pt-0.5" style={{ color: 'var(--color-muted)' }}>
        {e.age}
      </div>
    </div>
  );
}

export default function GmailIntelPage() {
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [classificationFailed, setClassificationFailed] = useState(false);
  const [notConnected, setNotConnected] = useState(false);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [countdown, setCountdown] = useState(REFRESH_MS / 1000);
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const getIcon = useIcon();
  const refreshTimer = useRef(null);
  const countdownInterval = useRef(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.get('/api/gmail/inbox/classify');
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'gmail_token_expired' || data.error?.includes('invalid_grant')) {
          setTokenExpired(true);
          return;
        }
        if (data.error?.includes('not connected') || data.error?.includes('not configured')) {
          setNotConnected(true);
          return;
        }
        throw new Error(data.error || 'Failed to load inbox');
      }
      setEmails(data.emails || []);
      setClassificationFailed(!!data.classificationFailed);
      setLastRefresh(new Date());
    } catch (err) {
      if (err.message?.includes('invalid_grant')) {
        setTokenExpired(true);
      } else if (err.message?.includes('not connected') || err.message?.includes('not configured')) {
        setNotConnected(true);
      } else {
        addToast('Failed to load inbox: ' + err.message, 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current);
    clearInterval(countdownInterval.current);
    let secs = REFRESH_MS / 1000;
    setCountdown(secs);
    countdownInterval.current = setInterval(() => {
      secs -= 1;
      setCountdown(Math.max(0, secs));
      if (secs <= 0) clearInterval(countdownInterval.current);
    }, 1000);
    refreshTimer.current = setTimeout(() => {
      load(true).then(scheduleRefresh);
    }, REFRESH_MS);
  }, [load]);

  useEffect(() => {
    load().then(scheduleRefresh);
    return () => {
      clearTimeout(refreshTimer.current);
      clearInterval(countdownInterval.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = {
    all: emails.length,
    urgent: emails.filter(e => e.category === 'urgent').length,
    waiting: emails.filter(e => e.category === 'waiting').length,
    fyi: emails.filter(e => e.category === 'fyi').length,
    noise: emails.filter(e => e.category === 'noise').length,
    unread: emails.filter(e => e.isUnread).length,
  };

  const filtered = emails.filter(e => {
    const matchCat = activeFilter === 'all' || e.category === activeFilter;
    if (!matchCat) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      e.one_line_summary?.toLowerCase().includes(q) ||
      e.sender?.toLowerCase().includes(q) ||
      e.subject?.toLowerCase().includes(q)
    );
  });

  const grouped = activeFilter === 'all'
    ? CATEGORY_ORDER
        .map(cat => ({ cat, rows: filtered.filter(e => e.category === cat) }))
        .filter(g => g.rows.length > 0)
    : [{ cat: activeFilter, rows: filtered }];

  const mins = Math.floor(countdown / 60);
  const secs = Math.floor(countdown % 60);

  if (tokenExpired) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-4"
        style={{ height: '100%', color: 'var(--color-muted)' }}
      >
        <div style={{ fontSize: 40 }}>🔑</div>
        <div className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Gmail session expired</div>
        <div className="text-sm text-center max-w-xs">
          Your Gmail token is no longer valid. Reconnect to continue.
        </div>
        <button
          onClick={async () => {
            try {
              const res = await api.get('/api/gmail/auth?returnTo=/gmail-intel');
              const data = await res.json();
              if (data.authUrl) window.location.href = data.authUrl;
            } catch {
              addToast('Failed to start Gmail auth', 'error');
            }
          }}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-opacity"
          style={{ background: 'var(--color-primary)' }}
        >
          Reconnect Gmail
        </button>
      </div>
    );
  }

  if (notConnected) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-4"
        style={{ height: '100%', color: 'var(--color-muted)' }}
      >
        <div style={{ fontSize: 40 }}>📬</div>
        <div className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Gmail not connected</div>
        <div className="text-sm text-center max-w-xs">
          Connect your Gmail account in Settings to use Inbox Intel.
        </div>
        <button
          onClick={() => navigate('/settings')}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-opacity"
          style={{ background: 'var(--color-primary)' }}
        >
          Go to Settings
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: '100%' }}>
      {/* Header */}
      <div
        className="flex-shrink-0 px-6 pt-5 pb-4 border-b"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        {/* Title row */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Inbox Intel</h1>
            {lastRefresh && (
              <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                Updated {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {' · '}next in {mins}:{String(secs).padStart(2, '0')}
              </div>
            )}
          </div>
          <button
            onClick={() => load(true).then(scheduleRefresh)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border hover:opacity-70 transition-opacity"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            {getIcon('refresh-cw', { size: 12 })}
            Refresh
          </button>
        </div>

        {/* Metric cards */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            { key: 'urgent', label: 'Urgent', color: '#ef4444' },
            { key: 'waiting', label: 'Waiting', color: '#f59e0b' },
            { key: 'unread', label: 'Unread', color: 'var(--color-primary)' },
            { key: 'noise', label: 'Noise', color: '#94a3b8' },
          ].map(({ key, label, color }) => (
            <div
              key={key}
              className="rounded-xl border px-4 py-3"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
            >
              <div
                className="text-xs font-semibold uppercase tracking-wide mb-1"
                style={{ color: 'var(--color-muted)' }}
              >
                {label}
              </div>
              <div className="text-2xl font-bold" style={{ color: loading ? 'var(--color-muted)' : color }}>
                {loading ? '—' : counts[key]}
              </div>
            </div>
          ))}
        </div>

        {/* Filter pills + search */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            {['all', ...CATEGORY_ORDER].map(cat => (
              <button
                key={cat}
                onClick={() => setActiveFilter(cat)}
                className="px-3 py-1 rounded-full text-xs font-medium transition-all"
                style={{
                  background: activeFilter === cat ? 'var(--color-primary)' : 'var(--color-bg)',
                  color: activeFilter === cat ? '#fff' : 'var(--color-muted)',
                  border: `1px solid ${activeFilter === cat ? 'var(--color-primary)' : 'var(--color-border)'}`,
                }}
              >
                {cat === 'all' ? 'All' : CATEGORY_LABELS[cat]}
                <span className="ml-1 opacity-75">
                  {cat === 'all' ? counts.all : counts[cat]}
                </span>
              </button>
            ))}
          </div>
          <div className="flex-1 relative">
            <span
              className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--color-muted)' }}
            >
              {getIcon('search', { size: 12 })}
            </span>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search summaries, senders…"
              className="w-full pl-7 pr-3 py-1.5 rounded-lg text-xs border outline-none transition-colors"
              style={{
                borderColor: 'var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
              }}
            />
          </div>
        </div>
      </div>

      {/* Classification failed banner */}
      {classificationFailed && (
        <div
          className="flex-shrink-0 flex items-center gap-2 px-6 py-2 text-xs"
          style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a', color: '#92400e' }}
        >
          {getIcon('alert-triangle', { size: 12 })}
          Classification unavailable — Claude API error. Emails shown without AI categorisation.
        </div>
      )}

      {/* Email list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div
            className="flex flex-col items-center justify-center py-16 gap-3"
            style={{ color: 'var(--color-muted)' }}
          >
            <style>{`@keyframes vault-spin { to { transform: rotate(360deg); } }`}</style>
            <div
              className="w-6 h-6 rounded-full border-2"
              style={{
                borderColor: 'var(--color-border)',
                borderTopColor: 'var(--color-primary)',
                animation: 'vault-spin 0.7s linear infinite',
              }}
            />
            <span className="text-sm">Fetching and classifying emails…</span>
          </div>
        ) : emails.length === 0 ? (
          <div className="text-center py-16 text-sm" style={{ color: 'var(--color-muted)' }}>
            No emails in inbox.
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-sm" style={{ color: 'var(--color-muted)' }}>
            No emails match this filter.
          </div>
        ) : (
          grouped.map(({ cat, rows }) => (
            <div key={cat} className="mb-6">
              {activeFilter === 'all' && (
                <div
                  className="text-xs font-bold uppercase tracking-wide mb-2 px-1"
                  style={{ color: CATEGORY_COLOR[cat] }}
                >
                  {CATEGORY_LABELS[cat]} · {rows.length}
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                {rows.map(e => (
                  <EmailRow key={e.id} email={e} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
