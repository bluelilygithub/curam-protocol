import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadBridge } from './bridge';
import type { ActionId, Bridge, ClipMeta, Settings, VerifyResult } from './bridge/types';
import CardStrip from './components/CardStrip';
import FilterBar from './components/FilterBar';
import Inspector, { type RedactState } from './components/Inspector';
import SettingsView from './components/SettingsView';
import Toast from './components/Toast';
import { useClipContent, useThumbs, useToast } from './hooks';
import { countByFilter, describeClip, matchesFilter, type Described, type FilterId } from './lib/describe';
import { ACTION_DONE, DEFAULT_SETTINGS, visibleActions } from './lib/settings';

const AUTO_DISMISS_DELAY_MS = 800; // long enough to read "Pushed to Vault" before the tray slides away

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export default function App() {
  const [bridge, setBridge] = useState<Bridge | null | undefined>(undefined);
  const [clips, setClips] = useState<ClipMeta[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [filter, setFilter] = useState<FilterId>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'shelf' | 'settings'>('shelf');
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [redact, setRedact] = useState<RedactState | null>(null);
  const [visiblePictures, setVisiblePictures] = useState<string[]>([]);
  const { toast, show } = useToast();
  const root = useRef<HTMLDivElement>(null);

  // ---- loading
  const refreshClips = useCallback(async (b: Bridge) => { setClips(await b.listClips()); }, []);
  const refreshVerify = useCallback(async (b: Bridge) => { setVerify(await b.verify()); }, []);

  useEffect(() => {
    let live = true;
    loadBridge().then(async (b) => {
      if (!live) return;
      setBridge(b);
      if (!b) return;
      const [s] = await Promise.all([b.getSettings(), refreshClips(b)]);
      if (!live) return;
      setSettings(s);
      void refreshVerify(b);
    });
    return () => { live = false; };
  }, [refreshClips, refreshVerify]);

  useEffect(() => {
    if (!bridge) return undefined;
    return bridge.subscribe((event) => {
      void refreshClips(bridge);
      if (event === 'show') { setView('shelf'); setFilter('all'); setSelectedId(null); setRedact(null); void refreshVerify(bridge); root.current?.focus(); }
    });
  }, [bridge, refreshClips, refreshVerify]);

  // ---- what is on the shelf
  const described = useMemo(() => new Map<string, Described>(clips.map((c) => [c.id, describeClip(c)])), [clips]);
  const counts = useMemo(() => countByFilter([...described.values()]), [described]);
  const shown = useMemo(() => clips.filter((c) => { const d = described.get(c.id); return d ? matchesFilter(d, filter) : false; }), [clips, described, filter]);

  // keep a valid card chosen: the newest one when nothing is, or when the chosen one left the list / the filter
  useEffect(() => {
    if (shown.length === 0) { if (selectedId !== null) setSelectedId(null); return; }
    if (!selectedId || !shown.some((c) => c.id === selectedId)) setSelectedId((shown[0] as ClipMeta).id);
  }, [shown, selectedId]);
  useEffect(() => { setRedact(null); }, [selectedId]);

  const selected = shown.find((c) => c.id === selectedId) ?? null;
  const content = useClipContent(bridge ?? null, selected?.id ?? null);
  const thumbs = useThumbs(bridge ?? null, visiblePictures);
  const actions = useMemo(() => visibleActions(settings, verify), [settings, verify]);
  const onVisiblePictures = useCallback((ids: string[]) => setVisiblePictures(ids), []);

  // ---- doing things
  const hideSoon = useCallback((b: Bridge) => { window.setTimeout(() => { void b.hide(); }, AUTO_DISMISS_DELAY_MS); }, []);

  const runAction = useCallback(async (action: ActionId) => {
    if (!bridge || !selected || busy) return;
    const state = actions.find((a) => a.id === action);
    if (!state?.enabled) return;
    setBusy(action);
    try {
      const r = await bridge.dispatch(action, selected.id);
      if (!r.ok) { show(r.error || 'Vault did not take that. Try again.', 'error'); return; }
      if (action === 'redact') {
        setRedact({ clipId: selected.id, result: r });
        const n = r.findings?.length ?? 0;
        show(n === 0 ? 'Checked: nothing sensitive-looking found' : `Checked: ${n} possible ${n === 1 ? 'detail' : 'details'} found`, 'info');
        return; // the answer is for reading: the tray stays open
      }
      show(r.duplicate ? 'Already in Vault' : ACTION_DONE[action]);
      if (settings.autoDismiss) hideSoon(bridge);
    } catch {
      show('Could not reach the Shelf app. Try again.', 'error');
    } finally {
      setBusy(null);
    }
  }, [bridge, selected, busy, actions, settings.autoDismiss, show, hideSoon]);

  const copy = useCallback(async (andClose: boolean) => {
    if (!bridge || !selected) return;
    try { await bridge.copyClip(selected.id); show('Copied'); if (andClose) hideSoon(bridge); } catch { show('Could not copy that.', 'error'); }
  }, [bridge, selected, show, hideSoon]);

  const remove = useCallback(async () => {
    if (!bridge || !selected) return;
    const index = shown.findIndex((c) => c.id === selected.id);
    const next = shown[index + 1] ?? shown[index - 1] ?? null;
    try { await bridge.deleteClip(selected.id); setSelectedId(next ? next.id : null); await refreshClips(bridge); show('Removed from the shelf', 'info'); } catch { show('Could not remove that.', 'error'); }
  }, [bridge, selected, shown, refreshClips, show]);

  // ---- keyboard: arrows move, 1 to 9 pick, Enter copies and closes, Delete removes, Esc backs out
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!bridge) return;
      if (e.key === 'Escape') {
        if (typing(e.target) && view !== 'settings') return;
        e.preventDefault();
        if (view === 'settings') setView('shelf'); else if (redact) setRedact(null); else void bridge.hide();
        return;
      }
      if (view !== 'shelf' || typing(e.target) || e.ctrlKey || e.altKey || e.metaKey) return;
      const index = shown.findIndex((c) => c.id === selectedId);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); const n = shown[Math.min(shown.length - 1, index + 1)]; if (n) setSelectedId(n.id); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); const n = shown[Math.max(0, index - 1)]; if (n) setSelectedId(n.id); }
      else if (e.key === 'Home') { const n = shown[0]; if (n) setSelectedId(n.id); }
      else if (e.key === 'End') { const n = shown[shown.length - 1]; if (n) setSelectedId(n.id); }
      else if (/^[1-9]$/.test(e.key)) { const n = shown[Number(e.key) - 1]; if (n) { e.preventDefault(); setSelectedId(n.id); } }
      // Enter copies and closes. On a card or filter chip (which are buttons only so they can be clicked) it does the same; on any other button
      // (Copy, a send button, the gear) it keeps its normal job of pressing that button.
      else if (e.key === 'Enter') { if (e.target instanceof HTMLButtonElement && !e.target.closest('[role=option],[role=tab]')) return; e.preventDefault(); void copy(true); }
      else if (e.key === 'Delete') { e.preventDefault(); void remove(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bridge, view, redact, shown, selectedId, copy, remove]);

  // ---- screens
  if (bridge === undefined) return null;
  if (bridge === null) {
    return <div className="h-screen flex items-center justify-center p-6 text-center text-sm text-shelf-muted">Vault Shelf opens from the Windows app. Press the shortcut or choose Open from the tray icon.</div>;
  }

  return (
    <div ref={root} tabIndex={-1} className="h-screen w-screen box-border p-2.5 outline-none">
      <div className="relative h-full flex flex-col rounded-tray border border-shelf-line/10 bg-shelf-bg/70 backdrop-blur-xl shadow-2xl overflow-hidden">
        {view === 'settings' ? (
          <div className="flex-1 min-h-0 p-4">
            <SettingsView bridge={bridge} settings={settings} verify={verify} onSettings={setSettings} onVerify={setVerify} onBack={() => setView('shelf')} onCleared={() => { void refreshClips(bridge); show('History cleared', 'info'); }} />
          </div>
        ) : (
          <>
            <header className="px-4 pt-3 pb-2"><FilterBar filter={filter} counts={counts} onFilter={setFilter} onSettings={() => setView('settings')} /></header>
            <main className="flex-1 min-h-0 grid grid-cols-2 gap-4 px-4 pb-2">
              <section className="min-w-0 min-h-0" aria-label="Recent copies">
                {shown.length === 0
                  ? <div className="h-full flex items-center justify-center text-sm text-shelf-muted text-center px-6">{clips.length === 0 ? 'Nothing copied yet. Copy something and it will appear here.' : 'Nothing of this kind on the shelf.'}</div>
                  : <CardStrip clips={shown} described={described} selectedId={selectedId} thumbs={thumbs} onSelect={setSelectedId} onVisiblePictures={onVisiblePictures} />}
              </section>
              <section className="min-w-0 min-h-0 border-l border-shelf-line/10 pl-4" aria-label="Preview">
                <Inspector
                  meta={selected} desc={selected ? described.get(selected.id) ?? null : null} content={content}
                  actions={actions} busy={busy} redact={redact}
                  onAction={(a) => void runAction(a)} onCloseRedact={() => setRedact(null)} onCopy={() => void copy(false)} onDelete={() => void remove()}
                />
              </section>
            </main>
            <footer className="px-4 pb-2 text-[10.5px] text-shelf-muted flex gap-4">
              <span>← → choose</span><span>1–9 pick</span><span>Enter copy and close</span><span>Delete remove</span><span>Esc close</span>
              {bridge.isMock && <span className="ml-auto text-shelf-danger font-medium">Sample data (development)</span>}
            </footer>
          </>
        )}
        <Toast toast={toast} />
      </div>
    </div>
  );
}
