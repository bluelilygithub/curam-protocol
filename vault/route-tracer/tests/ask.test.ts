import { describe, expect, it } from 'vitest';
import { looksLikeRequest, planFromIntent, type Intent, type PlanActions } from '../src/ask';
import { spokenEmail, tidySpoken } from '../src/voice';

describe('is it a request or a place?', () => {
  it('plain requests are requests', () => {
    for (const t of ['give me a route from Morningside to Carindale', 'Morningside to Carindale', 'a 10 km loop from Bulimba', 'cycle from Bulimba to New Farm', 'loop from Mount Coot-tha', 'walk', 'how do I get to the airport', 'directions to Carindale', 'plan a ride', '5 miles from Toowong']) expect(looksLikeRequest(t), t).toBe(true);
  });
  it('a place, address or landmark stays a place search', () => {
    for (const t of ['Carindale', 'Mount Coot-tha', '12 Smith St, Morningside', 'Story Bridge', 'Roma Street Parkland', 'Brisbane', '', '   ']) expect(looksLikeRequest(t), JSON.stringify(t)).toBe(false);
  });
});

const place = (label: string, lng: number, lat: number) => ({ label, lng, lat });
function fakePlan() {
  const calls: unknown[][] = [];
  const plan: PlanActions = {
    start: () => calls.push(['start']), setKind: (k) => calls.push(['kind', k]), setProfile: (p) => calls.push(['profile', p]),
    setLengthKm: (n) => calls.push(['length', n]), setDetourKm: (n) => calls.push(['detour', n]),
    setFrom: (p, n) => calls.push(['from', p, n]), setTo: (p, n) => calls.push(['to', p, n]),
  };
  return { plan, calls };
}
const places: Record<string, ReturnType<typeof place>> = { Morningside: place('Morningside, Brisbane', 153.07, -27.46), Carindale: place('Carindale, Brisbane', 153.1, -27.5), Bulimba: place('Bulimba, Brisbane', 153.06, -27.45) };
const find = async (n: string) => places[n] ?? null;
const intent = (o: Partial<Intent>): Intent => ({ kind: 'direct', from: 'Morningside', to: 'Carindale', lengthKm: null, profile: null, ...o });

describe('setting Plan route up from a request', () => {
  it('A to B: starts a plan, sets both points with their names, in order', async () => {
    const { plan, calls } = fakePlan();
    const r = await planFromIntent(intent({ profile: 'cycling' }), find, plan);
    expect(r).toMatchObject({ ok: true, summary: 'Planning a cycling route from Morningside, Brisbane to Carindale, Brisbane…' });
    expect(calls).toEqual([['start'], ['kind', 'direct'], ['profile', 'cycling'], ['from', [153.07, -27.46], 'Morningside, Brisbane'], ['to', [153.1, -27.5], 'Carindale, Brisbane']]);
  });
  it('a longer route carries its length, a loop has no end and carries its own', async () => {
    let { plan, calls } = fakePlan();
    await planFromIntent(intent({ kind: 'detour', lengthKm: 12 }), find, plan);
    expect(calls).toContainEqual(['detour', 12]);
    expect(calls).toContainEqual(['kind', 'detour']);
    ({ plan, calls } = fakePlan());
    const r = await planFromIntent(intent({ kind: 'loop', from: 'Bulimba', to: null, lengthKm: 10, profile: 'walking' }), find, plan);
    expect(calls.map((c) => c[0])).toEqual(['start', 'kind', 'profile', 'length', 'from']);
    expect(r).toMatchObject({ ok: true, summary: 'Planning a walking loop of about 10 km from Bulimba, Brisbane…', points: [[153.06, -27.45]] });
  });
  it('a way of travelling or a length that was not asked for is left as the person had it', async () => {
    const { plan, calls } = fakePlan();
    await planFromIntent(intent({ kind: 'loop', from: 'Bulimba', to: null }), find, plan);
    expect(calls.map((c) => c[0])).toEqual(['start', 'kind', 'from']);
  });
  it('changes nothing when a place cannot be found, and names the one it could not', async () => {
    for (const [i, missing] of [[intent({ from: 'Nowhereville' }), 'Nowhereville'], [intent({ to: 'Atlantis' }), 'Atlantis']] as const) {
      const { plan, calls } = fakePlan();
      const r = await planFromIntent(i, find, plan);
      expect(r.ok).toBe(false);
      expect(r.ok ? '' : r.message).toContain(`"${missing}"`);
      expect(calls).toEqual([]);
    }
  });
  it('refuses what is not a route, or has no second place', async () => {
    for (const i of [intent({ kind: 'none' }), intent({ from: null }), intent({ to: null })]) {
      const { plan, calls } = fakePlan();
      expect((await planFromIntent(i, find, plan)).ok).toBe(false);
      expect(calls).toEqual([]);
    }
  });
});

describe('what the microphone hears', () => {
  it('tidies a spoken line', () => {
    expect(tidySpoken('  Morning   loop. ')).toBe('Morning loop');
    expect(tidySpoken('Park here!')).toBe('Park here');
  });
  it('turns a spoken email address into an address', () => {
    expect(spokenEmail('michael at example dot com')).toBe('michael@example.com');
    expect(spokenEmail('Michael Barrett at Blue Lily dot com dot au')).toBe('michaelbarrett@bluelily.com.au');
    expect(spokenEmail('jo underscore smith plus maps at mail dot com.')).toBe('jo_smith+maps@mail.com');
    expect(spokenEmail('a dash b at c dot org')).toBe('a-b@c.org');
    expect(spokenEmail('already@typed.com')).toBe('already@typed.com');
    expect(spokenEmail('no address here')).toBe('noaddresshere');
    expect(spokenEmail('a at b at c dot com')).toBe('a@bc.com'); // only one @
  });
});
