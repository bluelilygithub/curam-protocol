import { describe, expect, it } from 'vitest';
import { applyRackType, staffPrice, type Catalogue } from '../src/app/catalogue';
import { analyseApp, fullRuns, sampleProject, testCaseProject, type AppProject } from '../src/app/model';
import { DEFAULT_RULES, profileOf } from '../src/engine/defaults';
import { doorLayout, doorLeafWidthMm, glassFraction, internalSize } from '../src/enclosure/enclosure';
import { footprint } from '../src/placement';
import { rackDepthNeededMm } from '../src/rack';
import { calcToText, explainCalculations, type CalcLine, type CalcSection } from '../src/help/calcExplain';
import { DEFAULT_CONFIG, type RackType } from '../src/lite/config';

const T: RackType = { ...DEFAULT_CONFIG.rackTypes[0]!, id: 'std', name: 'Standard 600', unitDepthMm: 350, rowPitchMm: 100, postsPerUnit: 2, pricePerUnit: 900, confirmed: true };
const cat = (types: RackType[] = [T]): Catalogue => ({
  rackTypes: types, defaultRackType: types[0]!.id, doors: { singleMm: 970, doubleMm: 1500 },
  pricing: { ...DEFAULT_CONFIG.pricing, fixed: 2000, doorSingle: 500, doorDouble: 900, rangePct: 10, roundTo: 100 }, quote: { ...DEFAULT_CONFIG.quote },
});

const base = (): AppProject => testCaseProject();
const labelForward = (): AppProject => { const p = base(); return { ...p, rackSpec: { ...p.rackSpec, orientation: 'LABEL_FORWARD', bottlesPerRowLabelForward: 5, unitDepthMm: 380 }, estimated: [] }; };
const doubleOffset = (): AppProject => { const p = base(); return { ...p, enclosure: { ...p.enclosure, door: { ...p.enclosure.door, leaves: 2, widthMm: 1500, offsetMm: 300, swing: 'IN' } } }; };
const glassy = (): AppProject => { const p = base(); return { ...p, enclosure: { ...p.enclosure, walls: { ...p.enclosure.walls, NORTH: { ...p.enclosure.walls.NORTH, kind: 'GLASS' }, EAST: { ...p.enclosure.walls.EAST, kind: 'GLASS' } }, door: { ...p.enclosure.door, glazed: true } } }; };
const withErrors = (): AppProject => { const p = base(); return { ...p, rackSpec: { ...p.rackSpec, unitHeightMm: 99999 } }; };
const rowsGiven = (): AppProject => { const p = base(); return { ...p, rackSpec: { ...p.rackSpec, rowsPerUnit: 18, bottlesPerRow: 6 }, estimated: [] }; };
const cases: Array<[string, () => AppProject, Catalogue | null]> = [
  ['the test case (neck-out, calculated bottles per row)', base, null],
  ['the blank sample (everything not set)', sampleProject, null],
  ['label-forward racks', labelForward, null],
  ['a double door, offset, swinging in', doubleOffset, null],
  ['glass walls and a glazed door', glassy, null],
  ['a design with errors (a run left out of the total)', withErrors, null],
  ['rows and bottles per row given by the supplier', rowsGiven, null],
  ['a confirmed catalogue rack type with a price', () => applyRackType(base(), T), cat()],
  ['an unconfirmed catalogue rack type', () => applyRackType(base(), { ...T, confirmed: false }), cat([{ ...T, confirmed: false }])],
];
const section = (s: CalcSection[], id: string): CalcSection => { const x = s.find((q) => q.id === id); if (!x) throw new Error(`no section ${id}`); return x; };
const line = (s: CalcSection, label: RegExp | string): CalcLine => { const l = s.lines.find((q) => (typeof label === 'string' ? q.label === label : label.test(q.label))); if (!l) throw new Error(`no line ${String(label)} in ${s.id}`); return l; };

describe.each(cases)('the explanation for %s', (_name, make, c) => {
  const p = make();
  const a = analyseApp(p);
  const secs = explainCalculations(p, c);

  it('has every section, in a fixed order', () => {
    expect(secs.map((s) => s.id)).toEqual(['inside', 'door', 'glass', 'capacity', 'depth', 'runs', 'price', 'trust']);
    for (const s of secs) { expect(s.title.length).toBeGreaterThan(3); expect(s.summary.length).toBeGreaterThan(20); }
  });
  it('never prints NaN, undefined, null or [object]', () => {
    // the words only: the numeric `value` field is allowed to be null (that is how "not set" is carried)
    const text = secs.flatMap((x) => [x.title, x.summary, ...x.notes, ...x.lines.flatMap((l) => [l.label, l.formula, l.working, l.result])]).join('\n');
    expect(text).not.toMatch(/NaN|undefined|\bnull\b|\[object/);
  });
  it('inside size equals the engine\'s', () => {
    const iz = internalSize(p.enclosure), s = section(secs, 'inside');
    expect([line(s, 'Inside width').value, line(s, 'Inside depth').value, line(s, 'Inside height').value]).toEqual([iz.widthMm, iz.depthMm, iz.heightMm]);
  });
  it('the working of each inside line really adds up to its result', () => {
    for (const l of section(secs, 'inside').lines) {
      const [first, ...rest] = (l.working.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
      const sum = rest.reduce((n, x) => n - x, first as number);
      expect(sum, l.label).toBe(l.value);
    }
  });
  it('the door split equals the engine\'s', () => {
    const dl = doorLayout(p.enclosure), s = section(secs, 'door');
    expect([line(s, 'Door wall length (outer face)').value, line(s, 'Fixed section before the door').value, line(s, 'Fixed section after the door').value]).toEqual([dl.wallLengthMm, dl.beforeMm, dl.afterMm]);
    expect(line(s, /leaf/i).value).toBe(doorLeafWidthMm(p.enclosure));
    expect(dl.beforeMm + dl.doorMm + dl.afterMm).toBe(dl.wallLengthMm);
  });
  it('the glass share equals the engine\'s', () => {
    expect(line(section(secs, 'glass'), 'Glass share').value).toBeCloseTo(glassFraction(p.enclosure), 12);
  });
  it('every run\'s capacity and the total equal the analysis', () => {
    const s = section(secs, 'capacity');
    for (const r of fullRuns(p)) {
      const got = a.racks.runs.find((x) => x.runId === r.id)!.capacity;
      expect(line(s, new RegExp(`^Run ${r.id} `)).value, r.id).toBe(got.status === 'OK' ? got.capacity : null);
    }
    expect(line(s, 'Total bottles').value).toBe(a.racks.total.status === 'OK' ? a.racks.total.capacity : null);
  });
  it('the depth the bottle needs equals the rack module\'s', () => {
    const l = section(secs, 'depth').lines[0]!;
    expect(l.value).toBe(p.rackSpec.orientation ? rackDepthNeededMm(p.rackSpec.orientation, p.bottle) : null);
  });
  it('every run\'s length equals its footprint', () => {
    const s = section(secs, 'runs');
    for (const r of fullRuns(p)) {
      const fp = footprint(p.enclosure, r);
      expect(line(s, new RegExp(`^Run ${r.id} `)).value, r.id).toBe(fp.status === 'OK' ? fp.lengthMm : null);
    }
  });
  it('the price total and every line equal the staff price', () => {
    const sp = staffPrice(p, c), s = section(secs, 'price');
    if (sp.status === 'OK') {
      expect(line(s, 'Total').value).toBe(sp.total);
      expect(s.lines.filter((l) => l.label !== 'Total' && l.label !== 'Range a customer sees').map((l) => l.value)).toEqual(sp.lines.map((l) => l.amount));
      expect(line(s, 'Range a customer sees').result).toBe(sp.text);
    } else expect(s.lines[0]!.result).toBe(sp.reason);
  });
});

describe('what the explanation says in particular', () => {
  it('the test case: 1120 bottles, the working shows rows x bottles per row x units', () => {
    const s = explainCalculations(base(), null);
    expect(line(section(s, 'capacity'), 'Total bottles').result).toBe('1120 bottles');
    expect(line(section(s, 'capacity'), /^Run north/).working).toMatch(/^20 × 7 × 4$/);
    expect(line(section(s, 'capacity'), 'Bottles in one row').result).toMatch(/calculated/);
  });
  it('the blank sample says "not set", not zero', () => {
    const blank = { ...sampleProject(), runs: [{ id: 'run-1', wall: 'NORTH' as const, startMm: 0, units: 2 }] };
    const s = explainCalculations(blank, null);
    expect(section(s, 'capacity').lines.at(-1)!.result).toBe('not set (1 run without values)');
    expect(line(section(s, 'capacity'), /^Run run-1/).result).toBe('not set');
    expect(explainCalculations(sampleProject(), null).map((x) => x.id)).toContain('capacity'); // with no runs at all it still explains
    expect(line(section(s, 'capacity'), 'Rows in one unit').result).toBe('not set');
    expect(section(s, 'depth').lines[1]!.result).toBe('not set');
  });
  it('label-forward shows its own formula, never the calculated one', () => {
    const l = line(section(explainCalculations(labelForward(), null), 'capacity'), 'Bottles in one row');
    expect(l.formula).toMatch(/never calculated/); expect(l.result).toBe('5');
    expect(section(explainCalculations(labelForward(), null), 'depth').lines[0]!.formula).toMatch(/cos\(angle\)/);
  });
  it('an error run is named as left out of the total', () => {
    expect(section(explainCalculations(withErrors(), null), 'capacity').notes.join(' ')).toMatch(/bottles in \d+ runs? with an error are left OUT/);
  });
  it('an inward door explains the swing radius; an outward one says nothing needs to stay clear', () => {
    expect(section(explainCalculations(doubleOffset(), null), 'door').notes.join(' ')).toMatch(/swings IN.*750 mm/);
    expect(section(explainCalculations(base(), null), 'door').notes.join(' ')).toMatch(/swings OUT|swings IN/);
  });
  it('the offset door uses the offset, the centred one uses the half-difference rule', () => {
    expect(line(section(explainCalculations(doubleOffset(), null), 'door'), 'Fixed section before the door').working).toBe('offset 300');
    expect(line(section(explainCalculations(base(), null), 'door'), 'Fixed section before the door').formula).toMatch(/÷ 2, rounded down/);
  });
  it('the rules quoted in the notes are the real ones (so the text cannot go stale)', () => {
    expect([profileOf('BORDEAUX').slotPitchMm, profileOf('BURGUNDY').slotPitchMm, profileOf('CHAMPAGNE').slotPitchMm, profileOf('MAGNUM').slotPitchMm]).toEqual([85, 100, 105, 125]);
    expect(section(explainCalculations(base(), null), 'capacity').notes[0]).toContain('Bordeaux 85, Burgundy 100, Champagne 105, Magnum 125');
    const neck = section(explainCalculations(base(), null), 'depth').lines[0]!;
    expect(neck.working).toBe(`${profileOf('BORDEAUX').lengthMm} + ${DEFAULT_RULES.depthClearanceMm}`);
    const lf = section(explainCalculations(labelForward(), null), 'depth').lines[0]!;
    expect(lf.working).toContain(`${DEFAULT_RULES.displayAngleDeg}°`); expect(lf.working).toContain(`+ ${DEFAULT_RULES.displayLipMm}`);
  });
  it('the trust section reflects the design\'s rack type and markers', () => {
    const conf = section(explainCalculations(applyRackType(base(), T), cat()), 'trust');
    expect(conf.lines.map((l) => l.result)).toEqual(['confirmed by the supplier', 'yes', '0']);
    const unc = section(explainCalculations(applyRackType(base(), { ...T, confirmed: false }), cat([{ ...T, confirmed: false }])), 'trust');
    expect(unc.lines[0]!.result).toBe('NOT confirmed'); expect(Number(unc.lines[2]!.result)).toBeGreaterThan(0);
    const custom = section(explainCalculations(sampleProject(), cat()), 'trust');
    expect(custom.lines[0]!.working).toBe('custom (typed by hand)');
  });
  it('the price section says why when there is no price', () => {
    expect(section(explainCalculations(base(), null), 'price').lines[0]!.result).toMatch(/could not be loaded/);
  });
});

describe('the plain-text copy', () => {
  it('has every section heading, every step with its result, and the project name', () => {
    const p = base(); const secs = explainCalculations(p, null);
    const t = calcToText(secs, p.name);
    expect(t.startsWith(`How the numbers were calculated: ${p.name}`)).toBe(true);
    for (const s of secs) { expect(t).toContain(s.title.toUpperCase()); for (const l of s.lines) expect(t).toContain(`- ${l.label}:`); }
    expect(t).toContain('= 1120 bottles');
    expect(t).not.toMatch(/NaN|undefined|\bnull\b/);
    expect(t.endsWith('\n')).toBe(true);
  });
  it('shows the working and the result on each line', () => {
    const t = calcToText(explainCalculations(base(), null), 'X');
    expect(t).toMatch(/- Inside width: outer width − west wall build-up − east wall build-up; 2850 − \d+ − \d+ = 2750 mm/);
  });
});
