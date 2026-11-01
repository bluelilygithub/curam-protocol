// The quick launcher's tile list: every page in Vault's own navigation catalog (client/src/config/appNavigation.js), so a tool added there is offered here
// with no change. Which tiles show, and how many columns, are the person's choice (Settings); the shell stores them.

import { APP_NAV_GROUPS, HABITS_NAV_GROUP } from '@vault-client/config/appNavigation';

export interface LauncherTile { id: string; label: string; path: string; group: string; icon: string }
export interface LauncherGroup { id: string; label: string; tiles: LauncherTile[] }

export const COLUMNS_MIN = 2;
export const COLUMNS_MAX = 6;
export const DEFAULT_LAUNCHER_HOTKEY = 'Ctrl+Alt+Space';
export const DEFAULT_LAUNCHER_TILES = ['clients', 'finance', 'shares', 'youtube'];
export const DEFAULT_LAUNCHER_COLUMNS = 4;

/** Pages that open inside Vault. Links to other sites are left out (the launcher opens Vault), and so is any item whose path is not a plain in-site path. */
const plainPath = (p: string) => /^\/[A-Za-z0-9/_-]*(\?[A-Za-z0-9_-]+=[A-Za-z0-9_-]+(&[A-Za-z0-9_-]+=[A-Za-z0-9_-]+)*)?$/.test(p);

export function buildLauncherGroups(): LauncherGroup[] {
  const seen = new Set<string>();
  const groups: LauncherGroup[] = [];
  for (const g of [...APP_NAV_GROUPS, HABITS_NAV_GROUP]) {
    const tiles: LauncherTile[] = [];
    for (const item of g.items) {
      if (item.external || !plainPath(item.path) || seen.has(item.id)) continue;
      seen.add(item.id);
      tiles.push({ id: item.id, label: item.label, path: item.path, group: g.label, icon: item.icon ?? '' });
    }
    if (tiles.length > 0) groups.push({ id: g.id, label: g.label, tiles });
  }
  return groups;
}

export const LAUNCHER_GROUPS: LauncherGroup[] = buildLauncherGroups();
export const LAUNCHER_TILES: LauncherTile[] = LAUNCHER_GROUPS.flatMap((g) => g.tiles);

export const clampColumns = (n: number) => Math.min(COLUMNS_MAX, Math.max(COLUMNS_MIN, Math.round(Number.isFinite(n) ? n : DEFAULT_LAUNCHER_COLUMNS)));

/** The tiles to draw: the chosen ids that still exist in Vault's catalog, in the catalog's order (so the grid is the same on every PC and a removed tool just vanishes). */
export function chosenTiles(ids: readonly string[], catalog: readonly LauncherTile[] = LAUNCHER_TILES): LauncherTile[] {
  const want = new Set(ids);
  return catalog.filter((t) => want.has(t.id));
}

/** Turn one tile on or off, keeping ids that this page does not know (a newer Vault's tool) rather than dropping them. */
export function toggleTile(ids: readonly string[], id: string, on: boolean): string[] {
  const rest = ids.filter((x) => x !== id);
  return on ? [...rest, id] : rest;
}
