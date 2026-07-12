import React, { useCallback, useEffect, useState } from 'react';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';

const FIELD = 'w-full px-3 py-2.5 rounded-xl border text-sm outline-none';
const FIELD_STYLE = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

function formatWhen(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function Section({ title, children }) {
  return (
    <div
      className="rounded-2xl border p-6 space-y-4"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
      {children}
    </div>
  );
}

function MemoryRow({ memory, onDelete, deleting, getIcon }) {
  const [expanded, setExpanded] = useState(false);
  const content = memory.content ?? '';
  const long = content.length > 220;
  const shown = expanded || !long ? content : `${content.slice(0, 220)}…`;

  return (
    <div
      className="rounded-xl border p-4 space-y-2 group"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
    >
      <div className="flex items-start gap-3">
        <p className="flex-1 text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>
          {shown}
        </p>
        <button
          type="button"
          onClick={() => onDelete(memory.id)}
          disabled={deleting}
          className="shrink-0 opacity-60 hover:opacity-100 transition-opacity disabled:opacity-30"
          style={{ color: 'var(--color-muted)' }}
          title="Delete memory"
        >
          {getIcon('trash', { size: 14 })}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--color-muted)' }}>
        <span>{formatWhen(memory.createdAt)}</span>
        {memory.similarity != null && <span>match {memory.similarity}</span>}
        {long && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="underline hover:opacity-70"
            style={{ color: 'var(--color-primary)' }}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
}

function MemoryPage() {
  const getIcon = useIcon();
  const [memories, setMemories] = useState([]);
  const [stats, setStats] = useState(null);
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    const [listRes, statsRes] = await Promise.all([
      api.get('/api/memory'),
      api.get('/api/memory/stats'),
    ]);
    setMemories(await listRes.json());
    setStats(await statsRes.json());
  }, []);

  useEffect(() => {
    load()
      .catch((err) => setMessage({ type: 'error', text: err.message }))
      .finally(() => setLoading(false));
  }, [load]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!input.trim() || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await api.post('/api/memory', { content: input.trim() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save');
      }
      setInput('');
      setSearchResults(null);
      setSearchQuery('');
      await load();
      setMessage({ type: 'success', text: 'Memory saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    setMessage(null);
    try {
      const res = await api.get(`/api/memory/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');
      setSearchResults(data.results ?? []);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSearching(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this memory?')) return;
    setDeletingId(id);
    setMessage(null);
    try {
      const res = await api.delete(`/api/memory/${id}`);
      if (!res.ok) throw new Error('Delete failed');
      setMemories((prev) => prev.filter((m) => m.id !== id));
      setSearchResults((prev) => (prev ? prev.filter((m) => m.id !== id) : null));
      const statsRes = await api.get('/api/memory/stats');
      setStats(await statsRes.json());
      setMessage({ type: 'success', text: 'Memory deleted.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setDeletingId(null);
    }
  };

  const displayed = searchResults ?? memories;
  const inSearchMode = searchResults !== null;

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-8">
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}
        >
          {getIcon('brain', { size: 18 })}
        </div>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Memory</h1>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Personal facts Claude can recall across every conversation
          </p>
        </div>
      </div>

      {message && (
        <div
          className="px-4 py-2.5 rounded-xl border text-xs"
          style={{
            borderColor: message.type === 'error' ? '#fca5a5' : 'var(--color-border)',
            color: message.type === 'error' ? '#991b1b' : 'var(--color-text)',
            background: message.type === 'error' ? '#fff1f2' : 'var(--color-surface)',
          }}
        >
          {message.text}
        </div>
      )}

      <Section title="How memory works">
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          Your private notebook. Add facts manually below, or tell Claude in chat to remember something.
          Vault does not log whole conversations — only short notes you save or ask to be kept.
        </p>
        <ul className="text-sm leading-relaxed space-y-2 list-disc pl-5" style={{ color: 'var(--color-muted)' }}>
          <li>
            <strong style={{ color: 'var(--color-text)' }}>Local testing</strong> — embeddings use Ollama
            ({stats?.embedding?.model || 'nomic-embed-text'}) when <code>APP_ENV=local</code>.
          </li>
          <li>
            <strong style={{ color: 'var(--color-text)' }}>Production (Railway)</strong> — embeddings use the
            Gemini model set in Settings → AI Models → Embedding model.
          </li>
          <li>
            <strong style={{ color: 'var(--color-text)' }}>In chat</strong> — relevant memories are picked by
            meaning for each message, not the full list every time.
          </li>
        </ul>
        {stats?.embedding && (
          <p className="text-xs" style={{ color: stats.embedding.available ? 'var(--color-muted)' : '#b45309' }}>
            Current: {stats.embedding.hint}
            {!stats.embedding.available ? ' — semantic search unavailable until configured.' : ''}
          </p>
        )}
        {stats && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {stats.total === 0
              ? 'No memories stored yet.'
              : `${stats.total} memor${stats.total === 1 ? 'y' : 'ies'} stored`}
            {stats.embedded != null && stats.total > 0 ? ` · ${stats.embedded} searchable` : ''}
            {stats.newest ? ` · latest ${formatWhen(stats.newest)}` : ''}
          </p>
        )}
      </Section>

      <Section title="Add a memory">
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. I prefer TypeScript; my timezone is Australia/Sydney"
            className={`${FIELD} flex-1`}
            style={FIELD_STYLE}
          />
          <button
            type="submit"
            disabled={!input.trim() || saving}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-40"
            style={{ background: 'var(--color-primary)' }}
          >
            {getIcon('plus', { size: 14 })}
            {saving ? 'Saving…' : 'Add'}
          </button>
        </form>
      </Section>

      <Section title="Search memories">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by meaning, not just keywords…"
            className={`${FIELD} flex-1`}
            style={FIELD_STYLE}
          />
          <div className="flex gap-2 shrink-0">
            {inSearchMode && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); setSearchResults(null); }}
                className="px-4 py-2.5 rounded-xl text-sm font-medium border"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                Clear
              </button>
            )}
            <button
              type="submit"
              disabled={searching || !searchQuery.trim()}
              className="px-4 py-2.5 rounded-xl text-sm font-medium border disabled:opacity-40"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>
        </form>
      </Section>

      <Section title={inSearchMode ? 'Search results' : 'Recent memories'}>
        {displayed.length === 0 ? (
          <div
            className="text-center py-12 rounded-xl border"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            {getIcon('brain', { size: 32, className: 'mx-auto mb-3 opacity-30' })}
            <p className="text-sm">{inSearchMode ? 'No matching memories.' : 'No memories yet.'}</p>
            <p className="text-xs mt-1 opacity-60">
              {inSearchMode ? 'Try different wording.' : 'Add a fact above or ask Claude to remember something in chat.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayed.map((m) => (
              <MemoryRow
                key={m.id}
                memory={m}
                onDelete={handleDelete}
                deleting={deletingId === m.id}
                getIcon={getIcon}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

export default MemoryPage;
