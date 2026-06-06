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

function fmtBytes(n) {
  if (!n) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

// ── Thread panel ─────────────────────────────────────────────────────────────
function ThreadPanel({ email, onClose, addToast, getIcon }) {
  const [thread, setThread] = useState(null);
  const [loading, setLoading] = useState(true);
  const [askQ, setAskQ] = useState('');
  const [askResp, setAskResp] = useState('');
  const [askStreaming, setAskStreaming] = useState(false);
  const askInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setThread(null);
    setLoading(true);
    setAskResp('');
    setAskQ('');
    api.get(`/api/gmail/thread/${email.threadId}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setThread(d); })
      .catch(err => { if (!cancelled) addToast('Failed to load thread: ' + err.message, 'error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [email.threadId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAsk = async () => {
    if (!askQ.trim() || askStreaming) return;
    setAskStreaming(true);
    setAskResp('');
    try {
      const res = await api.stream('/api/gmail/ask', { threadId: email.threadId, question: askQ });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.delta) setAskResp(p => p + parsed.delta);
            if (parsed.error) addToast('AI error: ' + parsed.error, 'error');
          } catch {}
        }
      }
    } catch (err) {
      addToast('Ask failed: ' + err.message, 'error');
    } finally {
      setAskStreaming(false);
    }
  };

  const openAttachment = async (messageId, att) => {
    try {
      const params = new URLSearchParams({ filename: att.filename, mimeType: att.mimeType });
      const res = await api.get(`/api/gmail/attachment/${messageId}/${att.attachmentId}?${params}`);
      if (!res.ok) throw new Error('Failed to fetch attachment');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const viewable = att.mimeType?.startsWith('image/') || att.mimeType === 'application/pdf';
      if (viewable) {
        window.open(url, '_blank');
        // Revoke after a short delay to allow the tab to load
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = att.filename;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      addToast('Failed to open attachment: ' + err.message, 'error');
    }
  };

  return (
    <div
      className="fixed top-0 right-0 bottom-0 flex flex-col z-50 border-l shadow-2xl"
      style={{
        width: 'min(560px, 100vw)',
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
      }}
    >
      {/* Panel header */}
      <div
        className="flex items-start gap-3 px-5 py-4 border-b flex-shrink-0"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <button
          onClick={onClose}
          className="flex-shrink-0 mt-0.5 hover:opacity-60 transition-opacity"
          style={{ color: 'var(--color-muted)' }}
        >
          {getIcon('x', { size: 16 })}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold leading-snug" style={{ color: 'var(--color-text)' }}>
            {email.subject || '(no subject)'}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            {cleanSender(email.sender)} · {email.age}
          </div>
        </div>
        <span
          className="flex-shrink-0 text-xs font-bold uppercase px-2 py-0.5 rounded mt-0.5"
          style={{ background: CATEGORY_BG[email.category], color: CATEGORY_COLOR[email.category] }}
        >
          {email.category}
        </span>
      </div>

      {/* Panel body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="flex items-center gap-2 py-8 justify-center" style={{ color: 'var(--color-muted)' }}>
            <style>{`@keyframes vault-spin{to{transform:rotate(360deg)}}`}</style>
            <div className="w-5 h-5 rounded-full border-2" style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-primary)', animation: 'vault-spin 0.7s linear infinite' }} />
            <span className="text-sm">Loading…</span>
          </div>
        ) : thread?.messages?.length ? (
          <>
            {thread.messages.map((msg, i) => (
              <div
                key={msg.id}
                className={`pb-5 ${i < thread.messages.length - 1 ? 'mb-5 border-b' : ''}`}
                style={{ borderColor: 'var(--color-border)' }}
              >
                <div className="flex items-baseline justify-between gap-2 mb-3">
                  <div className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
                    {msg.from}
                  </div>
                  <div className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                    {msg.date ? new Date(msg.date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                  </div>
                </div>

                <div
                  className="text-sm whitespace-pre-wrap leading-relaxed"
                  style={{ color: 'var(--color-text)' }}
                >
                  {msg.body || <span style={{ color: 'var(--color-muted)', fontStyle: 'italic' }}>No text content</span>}
                </div>

                {msg.attachments?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {msg.attachments.map(att => {
                      const viewable = att.mimeType?.startsWith('image/') || att.mimeType === 'application/pdf';
                      return (
                        <button
                          key={att.attachmentId}
                          onClick={() => openAttachment(msg.id, att)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border hover:opacity-70 transition-opacity"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' }}
                          title={viewable ? 'Open in new tab' : 'Download'}
                        >
                          {getIcon(viewable ? 'external-link' : 'file-down', { size: 12 })}
                          <span className="truncate max-w-[160px]">{att.filename}</span>
                          {att.size > 0 && <span style={{ color: 'var(--color-muted)' }}>{fmtBytes(att.size)}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}

            {/* Ask AI */}
            <div
              className="mt-2 pt-4 border-t"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <div className="text-xs font-semibold mb-2" style={{ color: 'var(--color-muted)' }}>
                Ask AI about this email
              </div>
              <div className="flex gap-2">
                <input
                  ref={askInputRef}
                  value={askQ}
                  onChange={e => setAskQ(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk(); } }}
                  placeholder="Summarise, extract dates, action items…"
                  className="flex-1 px-3 py-2 rounded-lg text-xs border outline-none transition-colors"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                  disabled={askStreaming}
                />
                <button
                  onClick={handleAsk}
                  disabled={!askQ.trim() || askStreaming}
                  className="px-3 py-2 rounded-lg text-xs font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-40"
                  style={{ background: 'var(--color-primary)' }}
                >
                  {askStreaming ? '…' : 'Ask'}
                </button>
              </div>
              {askResp && (
                <div className="mt-3 text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--color-text)' }}>
                  {askResp}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="text-sm text-center py-8" style={{ color: 'var(--color-muted)' }}>
            Could not load email content.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Email row ─────────────────────────────────────────────────────────────────
function EmailRow({ email, onClick, getIcon }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors text-left hover:opacity-80"
      style={{
        borderColor: email.isUnread ? 'var(--color-primary)' : 'var(--color-border)',
        borderLeft: email.isUnread ? '3px solid var(--color-primary)' : undefined,
        background: 'var(--color-surface)',
      }}
    >
      <span
        className="flex-shrink-0 text-xs font-bold uppercase px-2 py-0.5 rounded mt-0.5 tracking-wide"
        style={{ background: CATEGORY_BG[email.category], color: CATEGORY_COLOR[email.category] }}
      >
        {email.category}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
            {cleanSender(email.sender)}
          </span>
          {email.replyCount > 0 && (
            <span
              className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
            >
              {email.replyCount + 1}
            </span>
          )}
          {email.hasAttachment && (
            <span className="flex-shrink-0" style={{ color: 'var(--color-muted)' }} title="Has attachment">
              {getIcon('file', { size: 11 })}
            </span>
          )}
        </div>
        <div className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>
          {email.one_line_summary}
        </div>
      </div>
      <div className="flex-shrink-0 text-xs pt-0.5" style={{ color: 'var(--color-muted)' }}>
        {email.age}
      </div>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function GmailIntelPage() {
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [classificationFailed, setClassificationFailed] = useState(false);
  const [notConnected, setNotConnected] = useState(false);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [diag, setDiag] = useState(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [cachedAt, setCachedAt] = useState(null);
  const [countdown, setCountdown] = useState(REFRESH_MS / 1000);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const getIcon = useIcon();
  const refreshTimer = useRef(null);
  const countdownInterval = useRef(null);

  const load = useCallback(async (silent = false, forceRefresh = false) => {
    if (!silent) setLoading(true);
    try {
      const url = `/api/gmail/inbox/classify${forceRefresh ? '?refresh=1' : ''}`;
      const res = await api.get(url);
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'gmail_token_expired' || data.error?.includes('invalid_grant')) {
          setTokenExpired(true); return;
        }
        if (data.error?.includes('not connected') || data.error?.includes('not configured')) {
          setNotConnected(true); return;
        }
        throw new Error(data.error || 'Failed to load inbox');
      }
      setEmails(data.emails || []);
      setClassificationFailed(!!data.classificationFailed);
      setLastRefresh(new Date());
      setCachedAt(data.cachedAt ? new Date(data.cachedAt) : null);
    } catch (err) {
      if (err.message?.includes('invalid_grant')) setTokenExpired(true);
      else if (err.message?.includes('not connected')) setNotConnected(true);
      else addToast('Failed to load inbox: ' + err.message, 'error');
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
    const params = new URLSearchParams(window.location.search);
    const err = params.get('gmailError');
    if (err) {
      setAuthError(decodeURIComponent(err));
      window.history.replaceState({}, '', '/gmail-intel');
    }
  }, []);

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
    if (activeFilter !== 'all' && e.category !== activeFilter) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      e.one_line_summary?.toLowerCase().includes(q) ||
      e.sender?.toLowerCase().includes(q) ||
      e.subject?.toLowerCase().includes(q)
    );
  });

  const grouped = activeFilter === 'all'
    ? CATEGORY_ORDER.map(cat => ({ cat, rows: filtered.filter(e => e.category === cat) })).filter(g => g.rows.length > 0)
    : [{ cat: activeFilter, rows: filtered }];

  const mins = Math.floor(countdown / 60);
  const secs = Math.floor(countdown % 60);

  // ── Auth / reconnect screen ─────────────────────────────────────────────
  if (tokenExpired || notConnected) {
    const runDiag = async () => {
      setDiagLoading(true);
      try {
        const res = await api.get('/api/gmail/diagnose');
        setDiag(await res.json());
      } catch (err) {
        setDiag({ error: err.message });
      } finally {
        setDiagLoading(false);
      }
    };

    const startAuth = async () => {
      try {
        await api.post('/api/gmail/disconnect');
        const res = await api.get('/api/gmail/auth?returnTo=/gmail-intel');
        const data = await res.json();
        if (data.authUrl) window.location.href = data.authUrl;
        else addToast(data.error || 'No auth URL returned', 'error');
      } catch (err) {
        addToast('Failed: ' + err.message, 'error');
      }
    };

    return (
      <div className="flex flex-col items-center justify-center gap-4 px-6" style={{ height: '100%', color: 'var(--color-muted)' }}>
        <div style={{ fontSize: 40 }}>{tokenExpired ? '🔑' : '📬'}</div>
        <div className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
          {tokenExpired ? 'Gmail session expired' : 'Gmail not connected'}
        </div>
        <div className="text-sm text-center max-w-xs">
          {tokenExpired ? 'Token invalid. Reconnect to continue.' : 'Connect your Gmail account to use Inbox Intel.'}
        </div>
        {authError && (
          <div className="w-full max-w-md rounded-xl border px-4 py-3 text-xs font-mono" style={{ borderColor: '#ef4444', background: 'rgba(239,68,68,0.06)', color: '#ef4444', wordBreak: 'break-all' }}>
            OAuth error: {authError}
          </div>
        )}
        <button onClick={startAuth} className="px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-opacity" style={{ background: 'var(--color-primary)' }}>
          Reconnect Gmail
        </button>
        <button onClick={runDiag} disabled={diagLoading} className="text-xs underline hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>
          {diagLoading ? 'Running diagnostics…' : 'Run diagnostics'}
        </button>
        {diag && (
          <div className="w-full max-w-md flex flex-col gap-2">
            {diag.authUrlPreview && (
              <div className="rounded-xl border px-4 py-3 text-xs" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-muted)', wordBreak: 'break-all' }}>
                <div className="font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Auth URL preview</div>
                {diag.authUrlPreview}
              </div>
            )}
            <div className="rounded-xl border p-4 text-xs font-mono" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {JSON.stringify({ ...diag, authUrlPreview: undefined }, null, 2)}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Main dashboard ──────────────────────────────────────────────────────
  return (
    <div className="flex overflow-hidden" style={{ height: '100%' }}>
      {/* Left: email list */}
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        {/* Header */}
        <div className="flex-shrink-0 px-6 pt-5 pb-4 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Inbox Intel</h1>
              {lastRefresh && (
                <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  {cachedAt
                    ? `Cached · refreshes in ${mins}:${String(secs).padStart(2, '0')}`
                    : `Updated ${lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · next in ${mins}:${String(secs).padStart(2, '0')}`}
                </div>
              )}
            </div>
            <button
              onClick={() => load(true, true).then(scheduleRefresh)}
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
              <div key={key} className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--color-muted)' }}>{label}</div>
                <div className="text-2xl font-bold" style={{ color: loading ? 'var(--color-muted)' : color }}>{loading ? '—' : counts[key]}</div>
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
                  <span className="ml-1 opacity-75">{cat === 'all' ? counts.all : counts[cat]}</span>
                </button>
              ))}
            </div>
            <div className="flex-1 relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-muted)' }}>
                {getIcon('search', { size: 12 })}
              </span>
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search summaries, senders…"
                className="w-full pl-7 pr-3 py-1.5 rounded-lg text-xs border outline-none transition-colors"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
              />
            </div>
          </div>
        </div>

        {classificationFailed && (
          <div className="flex-shrink-0 flex items-center gap-2 px-6 py-2 text-xs" style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a', color: '#92400e' }}>
            {getIcon('alert-triangle', { size: 12 })}
            Classification unavailable — showing raw emails.
          </div>
        )}

        {/* Email list */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: 'var(--color-muted)' }}>
              <style>{`@keyframes vault-spin{to{transform:rotate(360deg)}}`}</style>
              <div className="w-6 h-6 rounded-full border-2" style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-primary)', animation: 'vault-spin 0.7s linear infinite' }} />
              <span className="text-sm">Fetching and classifying 100 emails…</span>
            </div>
          ) : emails.length === 0 ? (
            <div className="text-center py-16 text-sm" style={{ color: 'var(--color-muted)' }}>No emails in inbox.</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-sm" style={{ color: 'var(--color-muted)' }}>No emails match this filter.</div>
          ) : (
            grouped.map(({ cat, rows }) => (
              <div key={cat} className="mb-6">
                {activeFilter === 'all' && (
                  <div className="text-xs font-bold uppercase tracking-wide mb-2 px-1" style={{ color: CATEGORY_COLOR[cat] }}>
                    {CATEGORY_LABELS[cat]} · {rows.length}
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  {rows.map(e => (
                    <EmailRow
                      key={e.id}
                      email={e}
                      onClick={() => setSelectedEmail(e)}
                      getIcon={getIcon}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right: thread panel */}
      {selectedEmail && (
        <>
          <div
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.15)' }}
            onClick={() => setSelectedEmail(null)}
          />
          <div className="relative z-50 flex-shrink-0" style={{ width: 'min(560px, 100vw)' }}>
            <ThreadPanel
              email={selectedEmail}
              onClose={() => setSelectedEmail(null)}
              addToast={addToast}
              getIcon={getIcon}
            />
          </div>
        </>
      )}
    </div>
  );
}
