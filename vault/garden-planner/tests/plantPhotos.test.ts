import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PLANTS } from '../src/plants/plants';
import { photoSearchName } from '../src/plants/photoName';
import { createPlantPhotos, creditsCsv, type PlantPhoto } from '../src/state/plantPhotos';

const store = (token: string | null) => ({ getItem: (k: string) => (k === 'vault-auth' && token ? JSON.stringify({ state: { token } }) : null) });
const photo = (id: string, o: Partial<PlantPhoto> = {}): PlantPhoto => ({
  id, source: 'inaturalist', sourceLabel: 'iNaturalist', sourceUrl: 'https://www.inaturalist.org/observations/1', imageUrl: 'https://x/l.jpeg', thumbUrl: 'https://x/m.jpeg',
  creator: 'Jo', licenceCode: 'CC BY 4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/', displayOnly: false, title: 't', role: 'plant', width: 2000, height: 1000, modified: false,
  credit: 'Photo: Jo, CC BY 4.0 via iNaturalist', defaultFor: [], ...o,
});
type Init = { headers: Record<string, string> };
const reply = (body: unknown, status = 200) => async (_url: string, _init: Init) => ({ ok: status < 300, status, json: async () => body });
const noWait = async () => undefined;

describe('plant photos (client)', () => {
  it('server plant-name list matches the dataset (regenerate: npx vite-node scripts/exportPlantNames.ts ../server/config/plantNames.json)', () => {
    const file = JSON.parse(readFileSync(new URL('../../server/config/plantNames.json', import.meta.url), 'utf8')) as Record<string, string>;
    expect(Object.keys(file).sort()).toEqual(PLANTS.map((p) => p.id).sort());
    for (const p of PLANTS) expect(file[p.id]).toBe(photoSearchName(p));
  });

  it('searches cultivars by full name and species by species name', () => {
    expect(photoSearchName({ botanical: 'Grevillea robusta' })).toBe('Grevillea robusta');
    expect(photoSearchName({ botanical: 'Grevillea', cultivar: 'Robyn Gordon' })).toBe("Grevillea 'Robyn Gordon'");
    expect(photoSearchName({ botanical: 'Fragaria x ananassa' })).toBe('Fragaria x ananassa');
  });

  it('asks the server with the Vault token, never a photo site', async () => {
    const f = vi.fn(reply({ status: 'ready', images: [photo('1')] }));
    const a = await createPlantPhotos(store('tok'), f, noWait).get('grevillea-robusta');
    expect(a.status).toBe('ready');
    expect(f.mock.calls[0][0]).toBe('/api/plant-images/grevillea-robusta');
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('polls while pending, then settles; the same plant is not asked again', async () => {
    const answers = [{ status: 'pending', images: [] }, { status: 'pending', images: [] }, { status: 'ready', images: [photo('1')] }];
    const f = vi.fn(async (_url: string, _init: Init) => ({ ok: true, status: 200, json: async () => answers.shift()! }));
    const p = createPlantPhotos(store('tok'), f, noWait);
    const seen: string[] = [];
    const a = await p.get('x', (u) => seen.push(u.status));
    expect(a.status).toBe('ready');
    expect(seen).toEqual(['pending', 'pending', 'ready']);
    await p.get('x');
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('gives up quietly after a few pending answers and asks again next time', async () => {
    const f = vi.fn(reply({ status: 'pending', images: [] }));
    const p = createPlantPhotos(store('tok'), f, noWait);
    expect((await p.get('x')).status).toBe('pending');
    expect(f).toHaveBeenCalledTimes(5);
    await p.get('x');
    expect(f.mock.calls.length).toBe(10);
  });

  it('signed out, offline or server error: no photos, no throw (the card keeps its swatch)', async () => {
    expect((await createPlantPhotos(store(null), reply({}), noWait).get('x')).status).toBe('offline');
    expect((await createPlantPhotos(store('t'), async () => { throw new Error('down'); }, noWait).get('x')).status).toBe('error');
    expect((await createPlantPhotos(store('t'), reply({}, 500), noWait).get('x')).status).toBe('error');
    expect((await createPlantPhotos(store('t'), reply({}, 404), noWait).get('x')).status).toBe('unknown_plant');
  });

  it('never shows a photo that arrives without creator, licence, or source link', async () => {
    const bad = [photo('a', { creator: '' }), photo('b', { licenceCode: '' }), photo('c', { sourceUrl: '' }), photo('d', { imageUrl: '' }), photo('ok')];
    const a = await createPlantPhotos(store('t'), reply({ status: 'ready', images: bad }), noWait).get('x');
    expect(a.images.map((i) => i.id)).toEqual(['ok']);
  });

  it('credits CSV has creator, licence, links and share-alike flag, quoted safely', () => {
    const csv = creditsCsv([{ ...photo('1', { creator: 'Jo "JB" Bloggs', displayOnly: true }), plantId: 'grevillea-robusta' }]);
    const [head, row] = csv.split('\r\n');
    expect(head).toContain('licence link');
    expect(row).toContain('"Jo ""JB"" Bloggs"');
    expect(row).toContain('"https://creativecommons.org/licenses/by/4.0/"');
    expect(row.endsWith('"yes"')).toBe(true);
  });
});
