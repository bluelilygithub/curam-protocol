import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';

/**
 * The "@" pull-ins: search the web, Gmail or Calendar and put what is found into the open note. One component for all three
 * (they used to be three copies). `onInsert(text)` appends to the note; the modal stays open for Gmail and Calendar so several
 * can be added, and closes after Insert for the web.
 */

const KINDS = {
  web: {
    icon: 'search',
    placeholder: 'What do you want to search for?',
    hint: 'Search the web and insert results into your note · Esc to cancel',
    empty: 'No results found. Try a different query.',
    url: (q) => `/api/web-search?q=${encodeURIComponent(q)}`,
    failed: 'Search failed',
  },
  gmail: {
    icon: 'mail',
    placeholder: 'Search Gmail (e.g. from:boss@company.com invoice)',
    hint: 'Search your inbox and insert emails into your note · Esc to cancel',
    empty: (data) => `No emails found${data.translatedQuery ? ` for: ${data.translatedQuery}` : ''}. Try rephrasing.`,
    url: (q) => `/api/gmail/search?q=${encodeURIComponent(q)}&max=10`,
    failed: 'Gmail search failed',
  },
  calendar: {
    icon: 'calendar',
    placeholder: 'Search Calendar (e.g. meetings next week)',
    hint: 'Search your calendar and insert events into your note · Esc to cancel',
    empty: 'No events found. Try rephrasing.',
    url: (q) => `/api/calendar/search?q=${encodeURIComponent(q)}&max=10`,
    failed: 'Calendar search failed',
  },
};

const resultId = (kind, r) => (kind === 'gmail' ? r.threadId : r.id);

export default function InsertSourceModal({ kind, onInsert, onClose }) {
  const getIcon = useIcon();
  const cfg = KINDS[kind];
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState([]);
  const [translated, setTranslated] = useState('');
  const [added, setAdded] = useState([]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function search() {
    if (!query.trim() || busy) return;
    setBusy(true); setError(''); setResults([]); setTranslated('');
    try {
      const res = await api.get(cfg.url(query.trim()));
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      if (kind === 'gmail' && data.translatedQuery && data.translatedQuery !== query.trim()) setTranslated(data.translatedQuery);
      const found = data.results || [];
      if (!found.length) { setError(typeof cfg.empty === 'function' ? cfg.empty(data) : cfg.empty); return; }
      setResults(found);
    } catch (err) {
      setError(err.message || cfg.failed);
    } finally {
      setBusy(false);
    }
  }

  function insertWeb() {
    onInsert('\n\n**Web Search: ' + query + '**\n' +
      results.map((r) => `- [${r.title}](${r.url})${r.snippet ? '\n  ' + r.snippet : ''}`).join('\n'));
    onClose();
  }

  async function addOne(r) {
    const id = resultId(kind, r);
    if (added.includes(id)) return;
    try {
      if (kind === 'gmail') {
        const res = await api.get(`/api/gmail/thread/${r.threadId}`);
        const data = await res.json();
        if (data.error) { setError(data.error); return; }
        onInsert('\n\n**Email: ' + r.subject + '**\n' + (data.messages || []).map((m) => `From: ${m.from}\nDate: ${m.date}\n\n${m.body}`).join('\n\n---\n\n'));
      } else {
        const res = await api.get(`/api/calendar/event/${r.id}`);
        const data = await res.json();
        if (data.error) { setError(data.error); return; }
        onInsert('\n\n' + (data.text || ''));
      }
      setAdded((prev) => [...prev, id]);
    } catch (err) {
      setError(err.message || 'Could not load that one');
    }
  }

  const done = kind === 'web' ? insertWeb : onClose;
  const doneLabel = kind === 'web' ? 'Insert' : 'Done';

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-4" style={{ background: 'rgba(0,0,0,0.35)' }} onClick={onClose}>
      <div
        className="rounded-xl border shadow-xl overflow-hidden w-full mt-12 sm:mt-0"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', maxWidth: 520 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={cfg.placeholder}
      >
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="flex-shrink-0" style={{ color: 'var(--color-primary)' }}>{getIcon(cfg.icon, { size: 14 })}</span>
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setError(''); setResults([]); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); results.length ? done() : search(); } }}
            placeholder={cfg.placeholder}
            className="flex-1 bg-transparent outline-none"
            style={{ color: 'var(--color-text)', fontSize: 16 }}
            disabled={busy}
            aria-label={cfg.placeholder}
          />
          {busy ? (
            <span style={{ color: 'var(--color-primary)' }}>{getIcon('loader', { size: 14 })}</span>
          ) : results.length > 0 ? (
            <button type="button" onClick={done} className="text-xs font-medium px-3 py-2 rounded-lg flex-shrink-0 hover:opacity-80 transition-opacity duration-200" style={{ background: 'var(--color-primary)', color: '#fff' }}>{doneLabel}</button>
          ) : query.trim() ? (
            <button type="button" onClick={search} className="text-xs font-medium px-3 py-2 rounded-lg flex-shrink-0 hover:opacity-80 transition-opacity duration-200" style={{ background: 'var(--color-primary)', color: '#fff' }}>Search</button>
          ) : null}
        </div>
        {error && <p className="px-3 pb-2.5 text-xs" style={{ color: '#ef4444' }}>{error}</p>}
        {translated && (
          <p className="px-3 pb-1 text-xs" style={{ color: 'var(--color-muted)' }}>Query: <code style={{ color: 'var(--color-primary)' }}>{translated}</code></p>
        )}
        {results.length > 0 ? (
          <div className="border-t" style={{ borderColor: 'var(--color-border)', maxHeight: 280, overflowY: 'auto' }}>
            {kind === 'web' && results.map((r, i) => (
              <div key={i} className="px-3 py-2.5 border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
                <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{r.title}</p>
                {r.snippet && <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--color-muted)' }}>{r.snippet}</p>}
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-primary)', opacity: 0.7 }}>{r.url}</p>
              </div>
            ))}
            {kind !== 'web' && results.map((r) => {
              const isAdded = added.includes(resultId(kind, r));
              const start = r.start?.dateTime || r.start?.date || '';
              const when = kind === 'calendar' && start
                ? new Date(start).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + (r.location ? ` · ${r.location}` : '')
                : kind === 'gmail' ? `${r.from} · ${r.date ? new Date(r.date).toLocaleDateString() : ''}` : '';
              return (
                <button
                  key={resultId(kind, r)}
                  onClick={() => addOne(r)}
                  disabled={isAdded}
                  className="w-full text-left px-3 py-3 border-b last:border-b-0 transition-opacity duration-200"
                  style={{ borderColor: 'var(--color-border)', opacity: isAdded ? 0.5 : 1 }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{kind === 'gmail' ? r.subject : (r.title || '(No title)')}</p>
                    {isAdded
                      ? <span className="text-xs flex-shrink-0" style={{ color: '#22c55e' }}>✓ Added</span>
                      : <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-primary)' }}>Insert</span>}
                  </div>
                  {when && <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-muted)' }}>{when}</p>}
                  {kind === 'gmail' && r.snippet && <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--color-muted)' }}>{r.snippet}</p>}
                </button>
              );
            })}
            <p className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>
              {kind === 'web'
                ? `${results.length} result${results.length !== 1 ? 's' : ''} · press Insert or Enter to add to note`
                : added.length > 0 ? `${added.length} added to note · press Done or Enter` : 'Tap one to add it to the note'}
            </p>
          </div>
        ) : !error && (
          <p className="px-3 pb-2.5 text-xs" style={{ color: 'var(--color-muted)' }}>{cfg.hint}</p>
        )}
      </div>
    </div>
  );
}
