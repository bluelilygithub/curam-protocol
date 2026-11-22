import React, { useEffect, useState } from 'react';
import api from '../../../utils/apiClient';
import EmptyState from '../../../components/EmptyState';
import Tooltip from '../../../components/Tooltip';
import {
  addHistory, getHistoryDeck, listHistory, removeHistory,
} from '../historyStore.mjs';
import {
  CARD_STYLE, FIELD_STYLE, DeckHandoff, Notice, ToolHeader, readJson, usePresentations,
} from '../shared';

const when = (value) => {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : '—';
};

export default function MyDecks() {
  const {
    deck, setDeck, setSavedDeckId, historyOn, setHistoryOn, saveDeck, loadDeck, openTool, toast,
  } = usePresentations();
  const [decks, setDecks] = useState([]);
  const [max, setMax] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const refresh = async () => {
    const res = await api.get('/api/presentations/decks');
    const data = await readJson(res, 'Could not load saved decks.');
    setDecks(Array.isArray(data.decks) ? data.decks : []);
    setMax(data.max ?? null);
  };
  const refreshHistory = async () => {
    try { setRecent(await listHistory()); } catch { setRecent([]); }
  };
  useEffect(() => {
    refresh().catch((err) => toast(err.message || 'Could not load saved decks.', 'error')).finally(() => setLoading(false));
    refreshHistory();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (id) => {
    try {
      await loadDeck(id);
      openTool('slides');
    } catch (err) {
      toast(err.message || 'Could not open that deck.', 'error');
    }
  };

  const duplicate = async (id) => {
    setBusy(true);
    try {
      const res = await api.post(`/api/presentations/decks/${encodeURIComponent(id)}/duplicate`, {});
      await readJson(res, 'Could not duplicate that deck.');
      await refresh();
      toast('Deck duplicated.', 'success');
    } catch (err) {
      toast(err.message || 'Could not duplicate that deck.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    setBusy(true);
    try {
      await api.delete(`/api/presentations/decks/${encodeURIComponent(id)}`);
      setConfirmDelete(null);
      await refresh();
      toast('Deck deleted (it stays in the recycle bin for 30 days).', 'success');
    } catch (err) {
      toast(err.message || 'Could not delete that deck.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveCurrent = async () => {
    setBusy(true);
    try {
      await saveDeck({ asNew: true });
      await refresh();
    } catch (err) {
      toast(err.message || 'Could not save the deck.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleHistory = async (on) => {
    setHistoryOn(on);
    if (on && deck.slides.length) {
      try { await addHistory({ title: deck.title, deck, sourceType: 'brief' }); } catch { /* best effort */ }
    }
    refreshHistory();
  };

  const openRecent = async (id) => {
    try {
      const saved = await getHistoryDeck(id);
      if (!saved) throw new Error('That history entry is no longer available.');
      setDeck(saved);
      setSavedDeckId(null);
      openTool('slides');
    } catch (err) {
      toast(err.message || 'Could not open that deck.', 'error');
    }
  };

  const deleteRecent = async (id) => {
    try { await removeHistory(id); refreshHistory(); } catch { toast('Could not remove that history entry.', 'error'); }
  };

  return (
    <section className="space-y-4">
      <ToolHeader id="decks" title="My decks" blurb="Saved decks live on the server. Recent decks are an opt-in list kept only in this browser." />

      <div className="rounded-2xl border p-4 space-y-3" style={CARD_STYLE}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Saved decks{max == null ? '' : ` (${max} limit)`}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip text="Save the deck you are working on as a new entry, even if it was saved before.">
              <button type="button" onClick={saveCurrent} disabled={busy || !deck.slides.length} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70 disabled:opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>Save current as new</button>
            </Tooltip>
            {deck.slides.length > 0 && <DeckHandoff deck={deck} />}
          </div>
        </div>

        {loading ? <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading decks…</p> : decks.length === 0 ? (
          <EmptyState
            icon="layers"
            title="No saved decks yet"
            body="Make a deck from a brief or import, then save it here so you can come back to it."
            action={<button type="button" onClick={() => openTool('create')} className="px-3 py-2 rounded-xl text-sm font-medium" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>Create a deck</button>}
          />
        ) : (
          <ul className="space-y-2">
            {decks.map((item) => {
              const id = String(item.id);
              const saved = item.data || item.deck || {};
              return (
                <li key={id} className="rounded-xl border p-3 space-y-2" style={FIELD_STYLE}>
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-[12rem] flex-1">
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{item.title || saved.title || 'Untitled deck'}</p>
                      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        {saved.themeId || item.themeId || 'paper'} · {Array.isArray(saved.slides) ? saved.slides.length : 0} slides · updated {when(item.updatedAt)}
                      </p>
                    </div>
                    <Tooltip text="Open this deck in the slide editor.">
                      <button type="button" onClick={() => open(id)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>Open</button>
                    </Tooltip>
                    <Tooltip text="Make a copy before changing this one.">
                      <button type="button" onClick={() => duplicate(id)} disabled={busy} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70 disabled:opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Duplicate</button>
                    </Tooltip>
                    {confirmDelete === id ? (
                      <>
                        <button type="button" onClick={() => remove(id)} className="text-xs px-2 py-1 rounded-lg" style={{ color: '#991b1b' }}>Delete</button>
                        <button type="button" onClick={() => setConfirmDelete(null)} className="text-xs px-2 py-1 rounded-lg" style={{ color: 'var(--color-muted)' }}>Cancel</button>
                      </>
                    ) : (
                      <Tooltip text="Delete this deck (it goes to the recycle bin).">
                        <button type="button" onClick={() => setConfirmDelete(id)} className="text-xs px-2 py-1 rounded-lg hover:opacity-70" style={{ color: 'var(--color-muted)' }}>Delete</button>
                      </Tooltip>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border p-4 space-y-3" style={CARD_STYLE}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>On this device</h3>
          <Tooltip text="Keep a list of decks you open recently in this browser only. This is a convenience, never a backup.">
            <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
              <input type="checkbox" checked={historyOn} onChange={(e) => toggleHistory(e.target.checked)} />
              Keep recent decks (up to 40)
            </label>
          </Tooltip>
        </div>
        {!historyOn ? (
          <Notice>Recent decks are off. Turn them on if you want a quick way back to decks you opened in this browser.</Notice>
        ) : recent.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No decks opened recently on this device.</p>
        ) : (
          <ul className="space-y-1">
            {recent.map((entry) => (
              <li key={entry.id} className="rounded-xl border px-3 py-2 flex flex-wrap items-center gap-2" style={FIELD_STYLE}>
                <span className="flex-1 min-w-[10rem] text-xs" style={{ color: 'var(--color-text)' }}>{entry.title || 'Untitled deck'}</span>
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{when(entry.createdAt)}</span>
                <Tooltip text="Open this recently viewed deck.">
                  <button type="button" onClick={() => openRecent(entry.id)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>Open</button>
                </Tooltip>
                <Tooltip text="Forget this deck on this device (the server copy is untouched).">
                  <button type="button" onClick={() => deleteRecent(entry.id)} className="text-xs px-2 py-1 rounded-lg hover:opacity-70" style={{ color: 'var(--color-muted)' }}>Remove</button>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
