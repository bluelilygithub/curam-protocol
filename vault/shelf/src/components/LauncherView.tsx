import { useEffect, useMemo, useRef, useState } from 'react';
import { loadBridge } from '../bridge';
import type { Bridge, Settings } from '../bridge/types';
import { useToast } from '../hooks';
import { chosenTiles, clampColumns } from '../lib/launcher';
import { DEFAULT_SETTINGS } from '../lib/settings';
import { applyLook, resolveLook } from '../lib/theme';
import { TIPS } from '../lib/tips';
import Icon from './Icon';
import Toast from './Toast';
import Tooltip from './Tooltip';

/**
 * The quick launcher: a grid of the Vault tools the person chose in Settings. Click a tile (or press its number, or Enter on it) and the tool opens in their
 * browser; the launcher closes. It is a second window of the same page, chosen by ?view=launcher in the address.
 */
export default function LauncherView() {
  const [bridge, setBridge] = useState<Bridge | null | undefined>(undefined);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const { toast, show } = useToast();
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    loadBridge().then(async (b) => {
      if (!live) return;
      setBridge(b);
      if (!b) return;
      const s = await b.getSettings();
      if (!live) return;
      setSettings(s); setLoaded(true);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => { applyLook(resolveLook(settings.theme, settings.font)); }, [settings.theme, settings.font]);

  const tiles = useMemo(() => chosenTiles(settings.launcherTiles), [settings.launcherTiles]);
  const columns = clampColumns(settings.launcherColumns);

  const open = async (path: string) => {
    if (!bridge) return;
    try { await bridge.openPage(path); } catch (e) { show(e instanceof Error && e.message ? e.message : 'Could not open that.', 'error'); }
  };

  // the first tile is ready to press as soon as the window shows
  useEffect(() => { if (loaded) grid.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [loaded]);

  // Esc closes, 1 to 9 open that tile, arrows move between tiles
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!bridge || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'Escape') { e.preventDefault(); void bridge.hide(); return; }
      if (/^[1-9]$/.test(e.key)) { const t = tiles[Number(e.key) - 1]; if (t) { e.preventDefault(); void open(t.path); } return; }
      const buttons = Array.from(grid.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
      const at = buttons.findIndex((b) => b === document.activeElement);
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? columns : e.key === 'ArrowUp' ? -columns : 0;
      if (step !== 0 && buttons.length > 0) { e.preventDefault(); buttons[Math.min(buttons.length - 1, Math.max(0, at + step))]?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, tiles, columns]);

  if (bridge === undefined) return null;
  if (bridge === null) return <div className="h-screen flex items-center justify-center p-6 text-center text-sm text-shelf-muted">The quick launcher opens from the Windows app. Press its shortcut or choose Quick launcher from the tray icon.</div>;

  return (
    <div className="h-screen w-screen box-border p-2.5 outline-none">
      <div className="relative h-full flex flex-col rounded-tray border border-shelf-line bg-shelf-bg/70 shadow-2xl overflow-hidden" {...(loaded ? { 'data-launcher-ready': '' } : {})}>
        <header className="px-5 pt-4 pb-2 flex items-center">
          <h1 className="m-0 text-base font-semibold">Open in Vault</h1>
          <Tooltip text={TIPS.launcherClose}><button type="button" onClick={() => void bridge.hide()} className="ml-auto p-1.5 rounded-lg hover:opacity-60 transition-opacity" aria-label="Close the launcher"><Icon name="x" size={16} /></button></Tooltip>
        </header>
        <main className="flex-1 min-h-0 overflow-y-auto px-5 pb-3">
          {loaded && tiles.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-shelf-muted text-center px-6">No tiles chosen yet. Open the shelf, then Settings, then Quick launcher, and tick the tools you want here.</div>
          ) : (
            <div ref={grid} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} role="list" aria-label="Vault tools">
              {tiles.map((t, i) => (
                <Tooltip key={t.id} text={TIPS.launcherTile(t.label)}>
                  <button
                    type="button"
                    role="listitem"
                    onClick={() => void open(t.path)}
                    className="relative flex flex-col items-center justify-center gap-2 aspect-[5/3] min-h-[84px] rounded-card border border-shelf-line bg-shelf-card/70 p-3 text-center hover:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-accent"
                  >
                    <span className="h-9 w-9 rounded-full bg-shelf-accent text-shelf-onaccent flex items-center justify-center text-base font-semibold" aria-hidden="true">{t.label.charAt(0).toUpperCase()}</span>
                    <span className="text-sm font-medium leading-tight">{t.label}</span>
                    {i < 9 && <span className="absolute top-1.5 right-2 text-[10px] text-shelf-muted font-mono" aria-hidden="true">{i + 1}</span>}
                  </button>
                </Tooltip>
              ))}
            </div>
          )}
        </main>
        <footer className="px-5 pb-2 text-[10.5px] text-shelf-muted flex gap-4">
          <span>Click or press 1–9</span><span>Arrows move</span><span>Enter open</span><span>Esc close</span>
          {bridge.isMock && <span className="ml-auto text-shelf-danger font-medium">Sample data (development)</span>}
        </footer>
        <Toast toast={toast} />
      </div>
    </div>
  );
}
