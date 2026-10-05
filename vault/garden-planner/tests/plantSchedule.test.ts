import { describe, expect, it } from 'vitest';
import { csvBlobParts, csvField, safeCell } from '@planner-core/export/csv';
import { apply, setItem } from '../src/domain/commands';
import { addBed, addLawn, addZone } from '../src/domain/edit';
import { boundaryFromPoints, newGardenProject, rectanglePoints } from '../src/domain/projectFactory';
import type { GardenProject, Location } from '../src/domain/types';
import { PLANTS, plantById } from '../src/plants/plants';
import { buildPlantSchedule, CSV_COLUMNS, DRAFT_STATUS, monthRanges, placeOf, scheduleCsv, scheduleFileName } from '../src/schedule/plantSchedule';

const BRISBANE: Location = { label: 'Brisbane QLD', lat: -27.47, lng: 153.03, state: 'QLD' };
let n = 0;
const ids = (): string => `id${++n}`;
const garden = (): GardenProject => ({ ...newGardenProject('Test garden', BRISBANE, 'g1'), boundary: boundaryFromPoints(rectanglePoints(20, 20)) });
const put = (p: GardenProject, plantId: string, x: number, y: number, note?: string): GardenProject => {
  const id = `pl${++n}`;
  return apply(setItem('plants', id, null, { id, plantId, position: { x, y }, ...(note ? { note } : {}) }), p);
};
const withBed = (p: GardenProject, x0: number, y0: number, x1: number, y1: number): GardenProject => apply(addBed([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], false, ids, 1), p);
const parse = (csv: string): string[][] => {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < csv.length; i += 1) {
    const c = csv[i];
    if (q) { if (c === '"' && csv[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\r' && csv[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 1; } else cell += c;
  }
  return rows;
};

describe('plant schedule rows', () => {
  it('one row per kind of plant with the quantity, numbered, biggest kinds of plant first (trees, then shrubs...)', () => {
    let p = garden();
    p = put(p, 'lavandula-angustifolia', 2, 2); p = put(p, 'lavandula-angustifolia', 3, 2); p = put(p, 'lavandula-angustifolia', 4, 2);
    p = put(p, 'syzygium-smithii', 10, 10);
    const s = buildPlantSchedule(p);
    expect(s.total).toBe(4);
    expect(s.species).toBe(2);
    expect(s.rows.map((r) => [r.ref, r.plantId, r.qty])).toEqual([['P1', 'syzygium-smithii', 1], ['P2', 'lavandula-angustifolia', 3]]);
    expect(s.rows[0].type).toBe('Tree');
  });

  it('carries the plant record: names, mature size, spacing, needs, flowering, cautions', () => {
    const rec = plantById('lavandula-angustifolia')!;
    const r = buildPlantSchedule(put(garden(), rec.id, 5, 5)).rows[0];
    expect(r.common).toBe(rec.common[0]);
    expect(r.botanical).toBe(rec.botanical);
    expect(r.height).toEqual(rec.height);
    expect(r.spread).toEqual(rec.spread);
    expect(r.spacing).toBeGreaterThan(0);
    expect(r.spacing).toBeLessThanOrEqual(rec.spread[1]);
    expect(r.sun).toBe(rec.sun.map((s) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())).join(', '));
    expect(r.flowers).toBe(monthRanges(rec.flowerMonths));
    expect(r.frost).toMatch(/frost/i);
  });

  it('a variety shows its name in the botanical column', () => {
    const rec = PLANTS.find((x) => x.cultivar)!;
    expect(buildPlantSchedule(put(garden(), rec.id, 5, 5)).rows[0].botanical).toBe(`${rec.botanical} '${rec.cultivar}'`);
  });

  it('says where each plant is: bed, lawn, zone, open ground, or outside the boundary, with counts', () => {
    let p = garden();
    p = withBed(p, 1, 1, 6, 4);
    p = apply(addLawn([{ x: 10, y: 10 }, { x: 18, y: 10 }, { x: 18, y: 18 }, { x: 10, y: 18 }], false, ids, 1), p);
    p = apply(addZone([{ x: 0, y: 12 }, { x: 8, y: 12 }, { x: 8, y: 19 }, { x: 0, y: 19 }], ids, 1), p);
    const bedName = p.beds[0].name, lawnName = p.lawns[0].name, zoneName = p.zones[0].name;
    expect(placeOf(p, { x: 3, y: 2 })).toBe(bedName);
    expect(placeOf(p, { x: 14, y: 14 })).toBe(lawnName);
    expect(placeOf(p, { x: 2, y: 15 })).toBe(zoneName);
    expect(placeOf(p, { x: 9, y: 6 })).toBe('Open ground');
    expect(placeOf(p, { x: 30, y: 30 })).toBe('Outside the boundary');
    for (const [x, y] of [[2, 2], [3, 2], [14, 14], [40, 40]]) p = put(p, 'lavandula-angustifolia', x, y);
    const where = buildPlantSchedule(p).rows[0].where;
    expect(where).toBe(`${bedName} (2), ${lawnName} (1), Outside the boundary (1)`);
  });

  it('a single plant in one place is just the place', () => {
    expect(buildPlantSchedule(put(garden(), 'lavandula-angustifolia', 9, 9)).rows[0].where).toBe('Open ground');
  });

  it('collects different notes once each', () => {
    let p = garden();
    p = put(p, 'lavandula-angustifolia', 1, 1, 'bought at Bunnings'); p = put(p, 'lavandula-angustifolia', 2, 1, 'bought at Bunnings'); p = put(p, 'lavandula-angustifolia', 3, 1, 'grow in pots first'); p = put(p, 'lavandula-angustifolia', 4, 1);
    expect(buildPlantSchedule(p).rows[0].notes).toBe('bought at Bunnings; grow in pots first');
  });

  it('weed status is listed, or unknown: never "not a weed" for a plant whose weed list was not checked', () => {
    const rows = PLANTS.map((r) => buildPlantSchedule(put(garden(), r.id, 5, 5)).rows[0]);
    expect(rows.every((r) => /^Listed as a weed in QLD$|^Not listed in QLD \(checked\)$|^Unknown in QLD \(not checked\)$/.test(r.weed))).toBe(true);
    const unchecked = PLANTS.filter((r) => !r.weedChecked.includes('QLD') && !r.weedStates.includes('QLD'));
    expect(unchecked.length).toBeGreaterThan(100);
    for (const r of unchecked.slice(0, 20)) expect(buildPlantSchedule(put(garden(), r.id, 5, 5)).rows[0].weed).toBe('Unknown in QLD (not checked)');
    const listed = PLANTS.find((r) => r.weedStates.includes('QLD'));
    if (listed) expect(buildPlantSchedule(put(garden(), listed.id, 5, 5)).rows[0].weed).toBe('Listed as a weed in QLD');
  });

  it('every row is marked draft, unverified; a plant no longer in the library is listed, not dropped', () => {
    let p = put(garden(), 'lavandula-angustifolia', 5, 5);
    p = put(p, 'plant-that-was-removed', 6, 6);
    const s = buildPlantSchedule(p);
    expect(s.rows.every((r) => r.status === DRAFT_STATUS)).toBe(true);
    expect(s.missing).toBe(1);
    expect(s.total).toBe(2);
    expect(s.rows.find((r) => r.plantId === 'plant-that-was-removed')!.notes).toMatch(/no longer in the plant library/i);
  });

  it('an empty garden is an empty schedule', () => {
    const s = buildPlantSchedule(garden());
    expect(s).toEqual({ rows: [], total: 0, species: 0, missing: 0 });
  });
});

describe('flowering months', () => {
  it('runs, wraps over the new year, gaps and all-year', () => {
    expect(monthRanges([9, 10, 11, 12])).toBe('Sep-Dec');
    expect(monthRanges([11, 12, 1, 2])).toBe('Nov-Feb');
    expect(monthRanges([3, 4, 8])).toBe('Mar-Apr, Aug');
    expect(monthRanges([6])).toBe('Jun');
    expect(monthRanges([])).toBe('');
    expect(monthRanges([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe('All year');
    expect(monthRanges([12, 1, 5, 6])).toBe('May-Jun, Dec-Jan'); // earliest run in the year first, a wrapping run stays whole
  });
});

describe('the CSV', () => {
  const sample = (): GardenProject => {
    let p = garden();
    p = put(p, 'lavandula-angustifolia', 2, 2, '=HYPERLINK("http://evil.example")');
    p = put(p, 'lavandula-angustifolia', 3, 2);
    p = put(p, 'syzygium-smithii', 10, 10, 'near the "back" fence, shady');
    return p;
  };

  it('has the header, one row per kind of plant, a total and a draft note, every row the same width', () => {
    const rows = parse(scheduleCsv(buildPlantSchedule(sample())));
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
    expect(rows).toHaveLength(1 + 2 + 2);
    expect(rows.every((r) => r.length === CSV_COLUMNS.length)).toBe(true);
    const total = rows[rows.length - 2];
    expect(total[1]).toBe('Total plants');
    expect(total[3]).toBe('3');
    expect(total[4]).toBe('2 kinds');
    const note = rows[rows.length - 1];
    expect(note[CSV_COLUMNS.indexOf('Notes')]).toMatch(/draft and has not been verified/);
    expect(note[CSV_COLUMNS.indexOf('Notes')]).toMatch(/not the same as safe/);
  });

  it('every data row carries "Draft, unverified"', () => {
    const rows = parse(scheduleCsv(buildPlantSchedule(sample())));
    const col = CSV_COLUMNS.indexOf('Data status');
    expect(rows.slice(1).every((r) => r[col] === DRAFT_STATUS)).toBe(true);
  });

  it('numbers stay numbers (sortable in a spreadsheet) and quantities add up', () => {
    const rows = parse(scheduleCsv(buildPlantSchedule(sample())));
    const lav = rows.find((r) => r[2] === 'Lavandula angustifolia')!;
    const rec = plantById('lavandula-angustifolia')!;
    expect(lav[3]).toBe('2');
    expect(Number(lav[CSV_COLUMNS.indexOf('Height max (m)')])).toBe(rec.height[1]);
    expect(Number(lav[CSV_COLUMNS.indexOf('Spacing (m)')])).toBeGreaterThan(0);
  });

  it('commas, quotes and line breaks in notes survive a round trip', () => {
    const rows = parse(scheduleCsv(buildPlantSchedule(sample())));
    const lilly = rows.find((r) => r[2] === 'Syzygium smithii')!;
    expect(lilly[CSV_COLUMNS.indexOf('Notes')]).toBe('near the "back" fence, shady');
  });

  it('a note that starts like a spreadsheet formula is made harmless', () => {
    const csv = scheduleCsv(buildPlantSchedule(sample()));
    const lav = parse(csv).find((r) => r[2] === 'Lavandula angustifolia')!;
    expect(lav[CSV_COLUMNS.indexOf('Notes')].startsWith("'=")).toBe(true);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it('uses line breaks spreadsheets expect, and the file gets a byte-order mark for accents', () => {
    const csv = scheduleCsv(buildPlantSchedule(sample()));
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n').length).toBeGreaterThan(4);
    expect(csvBlobParts(csv)[0]).toBe('﻿');
  });

  it('file names come from the garden name', () => {
    expect(scheduleFileName('Michael\'s Backyard (2026)!')).toBe('michael-s-backyard-2026-plant-schedule.csv');
    expect(scheduleFileName('')).toBe('garden-plant-schedule.csv');
    expect(scheduleFileName('Café Ñandú')).toBe('cafe-nandu-plant-schedule.csv');
  });

  it('the shared CSV helpers quote and guard cells (the same ones Room Planner uses)', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField(5)).toBe('5');
    expect(csvField(undefined)).toBe('');
    for (const bad of ['=1+1', '+1', '-1', '@sum', '\tx']) expect(safeCell(bad).startsWith("'")).toBe(true);
    expect(safeCell('plain')).toBe('plain');
  });
});
