import React, { useEffect, useState } from 'react';
import api from '../../../utils/apiClient';
import EmptyState from '../../../components/EmptyState';
import Skeleton from '../../../components/Skeleton';
import Tooltip from '../../../components/Tooltip';
import {
  addHistory, getHistoryDeck, listHistory, removeHistory,
} from '../historyStore.mjs';
import {
  BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, CARD, CARD_STYLE, FIELD_STYLE, PRIMARY_STYLE, ROW, SECONDARY_STYLE,
  DeckHandoff, InlineDelete, Notice, ToolHeader, readJson, usePresentations,
} from '../shared';

const when = (value) => {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
};
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

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
  const [versions, setVersions] = useState({});
  const [downloads, setDownloads] = useState({});
  const [historyBusy, setHistoryBusy] = useState(null);

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

  const loadHistory = async (id) => {
    setHistoryBusy(id);
    try {
      const [vRes, eRes] = await Promise.all([
        api.get(`/api/presentations/decks/${encodeURIComponent(id)}/versions`),
        api.get(`/api/presentations/decks/${encodeURIComponent(id)}/exports`),
      ]);
      const [vData, eData] = await Promise.all([
        readJson(vRes, 'Could not load versions.'),
        readJson(eRes, 'Could not load downloads.'),
      ]);
      setVersions((prev) => ({ ...prev, [id]: Array.isArray(vData.versions) ? vData.versions : [] }));
      setDownloads((prev) => ({ ...prev, [id]: Array.isArray(eData.exports) ? eData.exports : [] }));
    } catch (err) {
      toast(err.message || 'Could not load that deck history.', 'error');
    } finally {
      setHistoryBusy(null);
    }
  };

  const restore = async (id, versionId) => {
    setHistoryBusy(id);
    try {
      await readJson(
        await api.post(`/api/presentations/decks/${encodeURIComponent(id)}/restore`, { versionId }),
        'Could not restore that version.',
      );
      await loadDeck(id);
      await loadHistory(id);
      toast('Version restored. The previous state is kept as a version too.', 'success');
      openTool('slides');
    } catch (err) {
      toast(err.message || 'Could not restore that version.', 'error');
    } finally {
      setHistoryBusy(null);
    }
  };

  // Auth is a Bearer header, so a plain <a href> would 401. api.download attaches the token and saves the file.
  const downloadExport = (file) => api.download(`/api/presentations/exports/${encodeURIComponent(file.id)}/file`, file.fileName)
    .catch((err) => toast(err.message || 'Could not download that export.', 'error'));

  const remove = async (id) => {
    setBusy(true);
    try {
      await readJson(await api.delete(`/api/presentations/decks/${encodeURIComponent(id)}`), 'Could not delete that deck.');
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
      <ToolHeader id="decks" title="My decks" />

      <div className={CARD} style={CARD_STYLE}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Saved decks{max == null ? '' : ` (${decks.length} of ${max})`}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip text="Save the deck you are working on as a new entry, even if it was saved before.">
              <button type="button" onClick={saveCurrent} disabled={busy || !deck.slides.length} className={BTN_SECONDARY} style={{ ...SECONDARY_STYLE, color: 'var(--color-primary)' }}>Save current as new</button>
            </Tooltip>
            {deck.slides.length > 0 && <DeckHandoff deck={deck} />}
          </div>
        </div>

        {loading ? <Skeleton lines={3} className="h-14" label="Loading saved decks" /> : decks.length === 0 ? (
          <EmptyState
            icon="layers"
            title="No saved decks yet"
            body="Make a deck from a brief or an import, then save it here so you can come back to it."
            action={(
              <Tooltip text="Write a brief and make a first deck.">
                <button type="button" onClick={() => openTool('create')} className={BTN_PRIMARY} style={PRIMARY_STYLE}>Create a deck</button>
              </Tooltip>
            )}
          />
        ) : (
          <ul className="space-y-2">
            {decks.map((item) => {
              const id = String(item.id);
              const saved = item.data || item.deck || {};
              return (
                <li key={id} className={ROW} style={FIELD_STYLE}>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-[12rem] flex-1">
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{item.title || saved.title || 'Untitled deck'}</p>
                      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        {cap(saved.themeId || item.themeId || 'paper')} · {Array.isArray(saved.slides) ? saved.slides.length : 0} slides · updated {when(item.updatedAt)}
                      </p>
                    </div>
                    <Tooltip text="Open this deck in the slide editor.">
                      <button type="button" onClick={() => open(id)} className={BTN_SECONDARY} style={{ ...SECONDARY_STYLE, color: 'var(--color-primary)' }}>Open</button>
                    </Tooltip>
                    <Tooltip text="Make a copy before changing this one.">
                      <button type="button" onClick={() => duplicate(id)} disabled={busy} className={BTN_SECONDARY} style={SECONDARY_STYLE}>Duplicate</button>
                    </Tooltip>
                    <InlineDelete
                      pending={confirmDelete === id}
                      onAsk={() => setConfirmDelete(id)}
                      onConfirm={() => remove(id)}
                      onCancel={() => setConfirmDelete(null)}
                      what="this deck"
                      disabled={busy}
                    />
                  </div>

                  <details className="mt-3 border-t pt-3" style={{ borderColor: 'var(--color-border)' }} onToggle={(e) => { if (e.target.open) loadHistory(id); }}>
                    <summary className="cursor-pointer text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
                      Version history &amp; downloads ({(versions[id] || []).length} versions, {(downloads[id] || []).length} files)
                    </summary>
                    {historyBusy === id && <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
                    <div className="grid gap-3 mt-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <p className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Saved versions (newest first)</p>
                        {(versions[id] || []).length === 0 ? (
                          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No versions yet. Edits and autosaves appear here.</p>
                        ) : (
                          <ul className="space-y-1">
                            {(versions[id] || []).map((version) => (
                              <li key={version.id} className={`${ROW} flex flex-wrap items-center gap-2`} style={FIELD_STYLE}>
                                <span className="flex-1 min-w-[8rem] text-xs" style={{ color: 'var(--color-text)' }}>
                                  {version.label} · {version.slides} slides · {when(version.createdAt)}
                                </span>
                                <Tooltip text="Replace this deck with this saved state. The current state is saved first.">
                                  <button type="button" onClick={() => restore(id, version.id)} disabled={historyBusy === id} className={BTN_SECONDARY} style={{ ...SECONDARY_STYLE, color: 'var(--color-primary)' }}>Restore</button>
                                </Tooltip>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Re-downloadable exports</p>
                        {(downloads[id] || []).length === 0 ? (
                          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No exports for this deck yet.</p>
                        ) : (
                          <ul className="space-y-1">
                            {(downloads[id] || []).map((file) => (
                              <li key={file.id} className={`${ROW} flex flex-wrap items-center gap-2`} style={FIELD_STYLE}>
                                <span className="flex-1 min-w-[8rem] text-xs" style={{ color: 'var(--color-text)' }}>
                                  {file.format.toUpperCase()} · {Math.max(1, Math.round(file.bytes / 1024))} KB · {when(file.createdAt)}
                                </span>
                                <Tooltip text="Download this export again from the server.">
                                  <button type="button" onClick={() => downloadExport(file)} className={BTN_SECONDARY} style={{ ...SECONDARY_STYLE, color: 'var(--color-primary)' }}>
                                    {file.fileName}
                                  </button>
                                </Tooltip>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={CARD} style={CARD_STYLE}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>On this device</h3>
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
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No decks opened recently on this device. Decks you open or make appear here.</p>
        ) : (
          <ul className="space-y-2">
            {recent.map((entry) => (
              <li key={entry.id} className={`${ROW} flex flex-wrap items-center gap-2`} style={FIELD_STYLE}>
                <span className="flex-1 min-w-[10rem] text-sm" style={{ color: 'var(--color-text)' }}>{entry.title || 'Untitled deck'}</span>
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{when(entry.createdAt)}</span>
                <Tooltip text="Open this recently viewed deck.">
                  <button type="button" onClick={() => openRecent(entry.id)} className={BTN_SECONDARY} style={{ ...SECONDARY_STYLE, color: 'var(--color-primary)' }}>Open</button>
                </Tooltip>
                <Tooltip text="Forget this deck on this device (the server copy is untouched).">
                  <button type="button" onClick={() => deleteRecent(entry.id)} className={BTN_QUIET} style={{ color: 'var(--color-muted)' }}>Remove</button>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
