import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import Tooltip from '../components/Tooltip';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { VoiceInput, VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import MemoryTutorChat from './memory/MemoryTutorChat';
import { HOW_IT_WORKS } from './memory/memoryTools.mjs';
import { startMemoryTour, TOUR_KEY as MEMORY_TOUR_KEY } from '../utils/tours/memoryTour';

// Memory (docs/semantic-memory.md): short facts the person saves here, and which Claude reads (the ones that fit each message) in every chat. Help the
// same way as the other tools: a Tooltip on every control, the (i) "How Memory works" box (opens once), a guided tour (Settings -> Tours, or
// /memory?tour=1), the microphone on the text boxes, and the round guide button (memory/memoryTools.mjs is the list the page and guide share).

const FIELD_STYLE = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

function formatWhen(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function Section({ title, children, guide, tour }) {
  return (
    <div
      className="rounded-2xl border p-6 space-y-4"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      data-guide={guide}
      data-tour={tour}
    >
      <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
      {children}
    </div>
  );
}

function MemoryRow({ memory, onDelete, deleting, getIcon, first }) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const content = memory.content ?? '';
  const long = content.length > 220;
  const shown = expanded || !long ? content : `${content.slice(0, 220)}…`;
  const smallBtn = 'px-2.5 py-1 rounded-lg border text-xs font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-50';

  return (
    <div
      className="rounded-xl border p-4 space-y-2 group"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
    >
      <div className="flex items-start gap-3">
        <p className="flex-1 text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>
          {shown}
        </p>
        {confirming ? (
          <span className="shrink-0 flex items-center gap-2 text-xs" role="alert" style={{ color: 'var(--color-text)' }}>
            Delete?
            <button type="button" disabled={deleting} onClick={() => { setConfirming(false); onDelete(memory.id); }} className={smallBtn} style={{ borderColor: '#ef4444', color: '#991b1b' }}>Yes</button>
            <button type="button" disabled={deleting} onClick={() => setConfirming(false)} className={smallBtn} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>No</button>
          </span>
        ) : (
          <Tooltip text="Delete this memory for good. It asks Delete? Yes / No first. It does not go to the recycle bin, so it cannot be brought back, and Claude stops using it from your next message.">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={deleting}
              aria-label="Delete this memory"
              data-guide="delete-memory"
              data-tour={first ? 'memory-delete' : undefined}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity duration-200 disabled:opacity-30"
              style={{ color: 'var(--color-muted)' }}
            >
              {getIcon('trash', { size: 14 })}
            </button>
          </Tooltip>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--color-muted)' }}>
        <span>{formatWhen(memory.createdAt)}</span>
        {memory.similarity != null && (
          <Tooltip text="How close this memory is to what you searched for, from 0 to 1. Closer to 1 means a better match.">
            <span>match {memory.similarity}</span>
          </Tooltip>
        )}
        {long && (
          <Tooltip text={expanded ? 'Fold this long memory back to a short preview.' : 'Show the whole memory instead of the first part.'}>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              data-guide="show-more"
              className="underline transition-opacity duration-200 hover:opacity-70"
              style={{ color: 'var(--color-primary)' }}
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          </Tooltip>
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

  // Help: the (i) box (opens once), the guided tour (also from Settings -> Tours: /memory?tour=1) and the guide chat's Open buttons
  const info = useToolInfoModal('vault_memory_info_seen');
  const [params, setParams] = useSearchParams();

  const load = useCallback(async () => {
    const [listRes, statsRes] = await Promise.all([
      api.get('/api/memory'),
      api.get('/api/memory/stats'),
    ]);
    const listData = await listRes.json().catch(() => null);
    const statsData = await statsRes.json().catch(() => null);
    // An error reply is { error } with a 4xx or 5xx status. It used to be stored as if it were the list or the figures, which is how the page
    // came to say "undefined memories stored" with nothing to show what was wrong.
    if (!listRes.ok) throw new Error((listData && listData.error) || 'Your memories could not be loaded.');
    setMemories(Array.isArray(listData) ? listData : []);
    if (statsRes.ok && statsData) {
      setStats(statsData);
    } else {
      setStats(null);
      setMessage({ type: 'error', text: `The memory summary could not be loaded: ${(statsData && statsData.error) || 'the server did not answer properly'}` });
    }
  }, []);

  useEffect(() => {
    load()
      .catch((err) => setMessage({ type: 'error', text: err.message }))
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    if (!loading && params.get('tour')) {
      const next = new URLSearchParams(params); next.delete('tour');
      setParams(next, { replace: true });
      setTimeout(startMemoryTour, 300);
    }
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const startTour = () => {
    try { localStorage.removeItem(MEMORY_TOUR_KEY); } catch (_) { /* ignore */ }
    startMemoryTour();
  };

  // The guide's Open buttons: scroll to the part of the page (the page is one tool, so every id is a part of it).
  const openToolById = (id) => {
    const el = document.querySelector(`[data-guide="${id}"]`) || document.querySelector('[data-guide="memory"]');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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

  // The Yes / No is asked on the row itself (MemoryRow), so there is no browser pop-up here.
  const handleDelete = async (id) => {
    setDeletingId(id);
    setMessage(null);
    try {
      const res = await api.delete(`/api/memory/${id}`);
      if (!res.ok) throw new Error('Delete failed');
      setMemories((prev) => prev.filter((m) => m.id !== id));
      setSearchResults((prev) => (prev ? prev.filter((m) => m.id !== id) : null));
      const statsRes = await api.get('/api/memory/stats');
      const statsData = await statsRes.json().catch(() => null);
      if (statsRes.ok && statsData) setStats(statsData);
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
    <VoiceInputProvider lang="en-AU">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6" data-guide="memory">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}
          >
            {getIcon('brain', { size: 18 })}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Memory</h1>
              <Tooltip text="How Memory works: what it is for, how to add and find a memory, which ones Claude sees, and what deleting does.">
                <button
                  type="button"
                  onClick={info.open}
                  aria-label="How Memory works"
                  data-tour="memory-info"
                  className="transition-opacity duration-200 hover:opacity-60"
                  style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  {getIcon('info', { size: 16 })}
                </button>
              </Tooltip>
              <Tooltip text="Take the guided tour of this page: adding, searching, the list, deleting and where to get help (6 steps).">
                <button
                  type="button"
                  onClick={startTour}
                  className="text-xs underline transition-opacity duration-200 hover:opacity-70"
                  style={{ color: 'var(--color-primary)' }}
                >
                  Take the tour
                </button>
              </Tooltip>
            </div>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Short facts about you that Claude can recall in every chat
            </p>
          </div>
        </div>

        {message && (
          <div
            role={message.type === 'error' ? 'alert' : 'status'}
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
            Your private notebook. Add short facts below. In every chat, Vault picks the ones that fit what you asked and shows them to Claude in the background.
            Memories are added here only: Chat reads them but does not save new ones, and Vault does not keep whole conversations.
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
              <strong style={{ color: 'var(--color-text)' }}>In chat</strong> — up to 8 relevant memories are picked
              by meaning for each message, not the full list every time.
            </li>
          </ul>
          <div data-guide="memory-status" className="space-y-1">
            {stats?.embedding && (
              <Tooltip text="Which embedding setup is in use. An embedding is how Vault turns a memory into numbers so it can be found by meaning. If it says search is unavailable, Search shows your recent memories instead of real matches.">
                <p className="text-xs w-fit" style={{ color: stats.embedding.available ? 'var(--color-muted)' : '#b45309' }}>
                  Current: {stats.embedding.hint}
                  {!stats.embedding.available ? ' — semantic search unavailable until configured.' : ''}
                </p>
              </Tooltip>
            )}
            {stats && (
              <Tooltip text="How many memories you have, how many are ready for search by meaning ('searchable'), and when the newest was saved.">
                <p className="text-xs w-fit" style={{ color: 'var(--color-muted)' }}>
                  {stats.total === 0
                    ? 'No memories stored yet.'
                    : `${stats.total} memor${stats.total === 1 ? 'y' : 'ies'} stored`}
                  {stats.embedded != null && stats.total > 0 ? ` · ${stats.embedded} searchable` : ''}
                  {stats.newest ? ` · latest ${formatWhen(stats.newest)}` : ''}
                </p>
              </Tooltip>
            )}
          </div>
        </Section>

        <Section title="Add a memory" guide="add-memory" tour="memory-add">
          <form onSubmit={handleAdd} className="flex gap-2" data-guide="memory-mic">
            <div className="flex-1 min-w-0">
              <Tooltip text="Type one short fact about one thing, or tap the microphone and say it. Press Enter or Add to save it. The same words saved twice are kept once.">
                <VoiceInput
                  value={input}
                  onChange={setInput}
                  label="A fact to remember"
                  placeholder="e.g. I prefer TypeScript; my timezone is Australia/Sydney"
                  style={FIELD_STYLE}
                />
              </Tooltip>
            </div>
            <Tooltip text="Save this fact to your memory. It appears at the top of Recent memories. Memories are added on this page only: Chat does not save them.">
              <button
                type="submit"
                disabled={!input.trim() || saving}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                {getIcon('plus', { size: 14 })}
                {saving ? 'Saving…' : 'Add'}
              </button>
            </Tooltip>
          </form>
        </Section>

        <Section title="Search memories" guide="search-memory" tour="memory-search">
          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 min-w-0">
              <Tooltip text="Search by meaning, not only exact words: 'where do I live' can find 'my home is in Brisbane'. Type or tap the microphone. If search by meaning is not set up, it shows your most recent memories instead.">
                <VoiceInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  label="Search your memories"
                  placeholder="Search by meaning, not just keywords…"
                  style={FIELD_STYLE}
                />
              </Tooltip>
            </div>
            <div className="flex gap-2 shrink-0">
              {inSearchMode && (
                <Tooltip text="Empty the search box and go back to the list of recent memories.">
                  <button
                    type="button"
                    onClick={() => { setSearchQuery(''); setSearchResults(null); }}
                    data-guide="clear-search"
                    className="px-4 py-2.5 rounded-xl text-sm font-medium border transition-opacity duration-200 hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    Clear
                  </button>
                </Tooltip>
              )}
              <Tooltip text="Find the memories closest in meaning to what you typed. The matches replace the list below and show how close each one is.">
                <button
                  type="submit"
                  disabled={searching || !searchQuery.trim()}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium border transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {searching ? 'Searching…' : 'Search'}
                </button>
              </Tooltip>
            </div>
          </form>
        </Section>

        <Section title={inSearchMode ? 'Search results' : 'Recent memories'} guide="memory-list" tour="memory-list">
          {displayed.length === 0 ? (
            <div
              className="text-center py-12 rounded-xl border"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              {getIcon('brain', { size: 32, className: 'mx-auto mb-3 opacity-30' })}
              <p className="text-sm">{inSearchMode ? 'No matching memories.' : 'No memories yet.'}</p>
              <p className="text-xs mt-1 opacity-60">
                {inSearchMode ? 'Try different wording.' : 'Add a fact above. Memories are saved on this page only.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {displayed.map((m, i) => (
                <MemoryRow
                  key={m.id}
                  memory={m}
                  onDelete={handleDelete}
                  deleting={deletingId === m.id}
                  getIcon={getIcon}
                  first={i === 0}
                />
              ))}
            </div>
          )}
        </Section>

        {info.show && (
          <ToolInfoModal title="How Memory works" onClose={info.close}>
            {HOW_IT_WORKS.map(([heading, text]) => (
              <div key={heading}>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{heading}</h3>
                <p className="text-sm leading-relaxed mt-1" style={{ color: 'var(--color-muted)' }}>{text}</p>
              </div>
            ))}
          </ToolInfoModal>
        )}

        <MemoryTutorChat currentTool="memory" onOpenTool={openToolById} />
      </div>
    </VoiceInputProvider>
  );
}

export default MemoryPage;
