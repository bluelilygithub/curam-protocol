import { describe, expect, it } from 'vitest';
import { PLANTS, botanicalLabel, plantById } from '../src/plants/plants';
import { compareFacts, isAmbiguous, matchTag, parseTagFacts, tokens } from '../src/plants/tagMatch';

const top = (text: string) => matchTag(text, PLANTS);

describe('reading a tag: which plant is it?', () => {
  it('a clean tag with the botanical and common name is a strong match for exactly that plant', () => {
    const m = top('English Lavender\nLavandula angustifolia\nFull sun. Height 60cm. Width 60cm.');
    expect(m[0].plant.id).toBe('lavandula-angustifolia');
    expect(m[0].confidence).toBe('strong');
    expect(m[0].reasons.join(' ')).toMatch(/botanical name Lavandula angustifolia/);
  });

  it('survives what a camera does to letters: 1 for l, 0 for o, rn for m, a dropped letter', () => {
    expect(top('Lavandu1a angust1folia')[0].plant.id).toBe('lavandula-angustifolia');
    expect(top('LAVANDULA ANGUSTIFOLIA')[0].plant.id).toBe('lavandula-angustifolia');
    expect(top('Lavandula   angustifolia  (English lavender)')[0].plant.id).toBe('lavandula-angustifolia');
    const fuzzy = top('Lavandula angustifol1a')[0];
    expect(fuzzy.plant.id).toBe('lavandula-angustifolia');
    expect(fuzzy.reasons.join(' ')).toMatch(/Reads like|botanical name/);
  });

  it('works when the two words of the name are on separate lines, with a barcode and price in between', () => {
    expect(top('Lavandula\n$12.95  9300000012345\nangustifolia')[0].plant.id).toBe('lavandula-angustifolia');
  });

  it('a variety known by genus and name is found by both, and by its name alone only as a weaker match', () => {
    const full = top("Grevillea 'Robyn Gordon'\nNative shrub, bird attracting");
    expect(full[0].plant.id).toBe('grevillea-robyn-gordon');
    expect(full[0].confidence).toBe('strong');
    const nameOnly = top('Robyn Gordon');
    expect(nameOnly[0].plant.id).toBe('grevillea-robyn-gordon');
    expect(nameOnly[0].confidence).not.toBe('strong');
  });

  it('a common name alone is only a possible match, and a shared common name offers every plant that has it, for the person to choose', () => {
    const m = top('Lilly Pilly');
    expect(m.length).toBeGreaterThan(1);
    expect(m.every((x) => x.confidence !== 'strong')).toBe(true);
    expect(isAmbiguous(m)).toBe(true);
    expect(m.map((x) => x.plant.id)).toContain('syzygium-smithii');
  });

  it('only the genus is a weak hint, never an answer', () => {
    const m = top('Banksia');
    expect(m.length).toBeGreaterThan(0);
    expect(m.every((x) => x.confidence === 'weak' || x.confidence === 'possible')).toBe(true);
    expect(m.every((x) => x.score < 85)).toBe(true);
  });

  it('nonsense, a barcode, a price, or nothing at all matches nothing', () => {
    expect(top('')).toEqual([]);
    expect(top('   \n  ')).toEqual([]);
    expect(top('$12.95  GST included  9300000012345  Keep moist')).toEqual([]);
    expect(top('qzxv wlkj mmnb')).toEqual([]);
    expect(top('Plant in spring. Water well. Made in Australia.')).toEqual([]);
  });

  it('a plant that is not in the library is not guessed: the closest genus is only a weak hint', () => {
    const m = top('Eucalyptus zzzzensis');
    expect(m.every((x) => x.confidence === 'weak')).toBe(true);
  });

  it('every plant in the library is found by its own botanical name (and variety), as a top result', () => {
    const misses: string[] = [];
    for (const p of PLANTS) {
      const text = botanicalLabel(p);
      const m = matchTag(text, PLANTS, 12);
      const best = m[0]?.score ?? 0;
      const tied = m.filter((x) => x.score === best).map((x) => x.plant.id);
      if (!tied.includes(p.id) || best < 85) misses.push(`${p.id} <- "${text}" gave ${m.slice(0, 3).map((x) => `${x.plant.id}:${x.score}`).join(', ')}`);
    }
    expect(misses).toEqual([]);
  });

  it('every plant is among the candidates when only its first common name is on the tag', () => {
    const misses: string[] = [];
    for (const p of PLANTS) {
      const name = p.common[0];
      if (!name || name.replace(/[^a-z]/gi, '').length < 4) continue;
      const m = matchTag(name, PLANTS, 40);
      if (!m.some((x) => x.plant.id === p.id)) misses.push(`${p.id} <- "${name}"`);
    }
    expect(misses).toEqual([]);
  });

  it('tokens drop accents, punctuation and one-letter noise', () => {
    expect(tokens("Grevillea 'Robyn Gordon' – 1.5m")).toEqual(['grevillea', 'robyn', 'gordon', '5m']);
    expect(tokens('Café  Ñandú')).toEqual(['cafe', 'nandu']);
  });
});

describe('what the tag says about size and sun', () => {
  it('reads labelled heights and widths in metres and centimetres', () => {
    expect(parseTagFacts('Height: 1-1.5m  Width: 1m')).toMatchObject({ height: [1, 1.5], spread: [1, 1] });
    expect(parseTagFacts('Height 60cm Width 60cm')).toMatchObject({ height: [0.6, 0.6], spread: [0.6, 0.6] });
    expect(parseTagFacts('Grows to 3m high and 2m wide')).toMatchObject({ height: [3, 3], spread: [2, 2] });
    expect(parseTagFacts('H: 4m  W: 2.5m')).toMatchObject({ height: [4, 4], spread: [2.5, 2.5] });
    expect(parseTagFacts('Height up to 2 to 3 m')).toMatchObject({ height: [2, 3] });
  });

  it('reads "1.5 x 1 m" as height then width, with the unit shared', () => {
    expect(parseTagFacts('Size 1.5 x 1 m')).toMatchObject({ height: [1.5, 1.5], spread: [1, 1] });
    expect(parseTagFacts('2m x 1.5m')).toMatchObject({ height: [2, 2], spread: [1.5, 1.5] });
  });

  it('ignores numbers that are not sizes (prices, barcodes, pot sizes) and silly values', () => {
    expect(parseTagFacts('$12.95  9300000012345  140mm pot')).toEqual({});
    expect(parseTagFacts('Height 500m')).toEqual({});
    expect(parseTagFacts('')).toEqual({});
  });

  it('reads sun', () => {
    expect(parseTagFacts('Full sun').sun).toEqual(['full_sun']);
    expect(parseTagFacts('Part shade to full sun').sun?.sort()).toEqual(['full_sun', 'part_shade']);
    expect(parseTagFacts('Partial shade').sun).toEqual(['part_shade']);
    expect(parseTagFacts('Shade lover').sun).toEqual(['shade']);
    expect(parseTagFacts('Water weekly').sun).toBeUndefined();
  });

  it('compares with our draft data and says so only where they really disagree', () => {
    const lav = plantById('lavandula-angustifolia')!;
    expect(compareFacts(lav, { height: [lav.height[0], lav.height[1]], sun: ['full_sun'] })).toEqual([]);
    const notes = compareFacts(lav, { height: [4, 5], spread: [3, 3], sun: ['shade'] });
    expect(notes).toHaveLength(3);
    expect(notes[0]).toMatch(/tag says 4 to 5 m high; our draft data says/);
    expect(notes[2]).toMatch(/tag says shade; our draft data says/);
    expect(compareFacts(lav, { height: [lav.height[1] * 1.2, lav.height[1] * 1.2] })).toEqual([]); // tags describe a typical plant: small differences are fine
  });
});
