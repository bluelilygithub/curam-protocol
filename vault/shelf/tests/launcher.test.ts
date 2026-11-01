import { describe, expect, it } from 'vitest';
import { APP_NAV_GROUPS } from '@vault-client/config/appNavigation';
import { COLUMNS_MAX, COLUMNS_MIN, DEFAULT_LAUNCHER_TILES, LAUNCHER_TILES, buildLauncherGroups, chosenTiles, clampColumns, toggleTile } from '../src/lib/launcher';

describe('the quick launcher tiles', () => {
  it('come from Vault\'s own navigation catalog, so a new tool appears with no change here', () => {
    const catalogIds = new Set(APP_NAV_GROUPS.flatMap((g) => g.items).filter((i) => !i.external).map((i) => i.id));
    for (const id of ['clients', 'finance', 'shares', 'youtube', 'notes']) expect(LAUNCHER_TILES.map((t) => t.id), id).toContain(id);
    for (const t of LAUNCHER_TILES) expect(catalogIds.has(t.id) || t.id.startsWith('habits-'), t.id).toBe(true);
  });

  it('never offer another site or an odd path: the shell would refuse them', () => {
    for (const t of LAUNCHER_TILES) expect(t.path, t.id).toMatch(/^\/[A-Za-z0-9/_-]*(\?[A-Za-z0-9_-]+=[A-Za-z0-9_-]+)?$/);
    expect(LAUNCHER_TILES.find((t) => t.id === 'showcase')).toBeUndefined();
  });

  it('have one entry per id', () => {
    const ids = LAUNCHER_TILES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(buildLauncherGroups().every((g) => g.tiles.length > 0)).toBe(true);
  });

  it('start with the four tools named by the owner, and all of them exist', () => {
    expect(DEFAULT_LAUNCHER_TILES).toEqual(['clients', 'finance', 'shares', 'youtube']);
    expect(chosenTiles(DEFAULT_LAUNCHER_TILES).map((t) => t.id).sort()).toEqual([...DEFAULT_LAUNCHER_TILES].sort());
  });

  it('are drawn in the catalog order, and a tool that no longer exists just disappears', () => {
    const shown = chosenTiles(['youtube', 'gone', 'clients']).map((t) => t.id);
    expect(shown).toEqual(['clients', 'youtube']);
  });

  it('switch on and off without losing ids this page does not know', () => {
    expect(toggleTile(['clients', 'future'], 'shares', true)).toEqual(['clients', 'future', 'shares']);
    expect(toggleTile(['clients', 'future'], 'clients', false)).toEqual(['future']);
    expect(toggleTile(['clients'], 'clients', true)).toEqual(['clients']);
  });

  it('keep the columns between two and six', () => {
    expect(clampColumns(1)).toBe(COLUMNS_MIN);
    expect(clampColumns(99)).toBe(COLUMNS_MAX);
    expect(clampColumns(3)).toBe(3);
    expect(clampColumns(Number.NaN)).toBe(4);
  });
});
