// Furniture schedule: grouping, totals, CSV, the plan sheet geometry and the PDF.
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { FURNITURE_LIBRARY } from '../../src/data/furnitureLibrary';
import { buildSchedule, csvField, money, roomsText, safeCell, scheduleFileName, scopeRooms, sizeText, toCsv } from '../../src/schedule/schedule';
import { A4, chooseScale, numbersFor, planSheet } from '../../src/schedule/plan';
import { makePdf, winAnsi } from '../../src/schedule/pdf';
import { makeDoor, makeInstance, makeProject, makeRoom } from '../helpers';

const sofa = (over = {}) => makeInstance({ id: 's1', definitionId: 'sofa-3', position: { x: 2, y: 1 }, width: 2.2, length: 0.95, height: 0.85, ...over });
const chair = (id: string, over = {}) => makeInstance({ id, definitionId: 'dining-chair', position: { x: 1, y: 3 }, width: 0.45, length: 0.52, height: 0.85, ...over });
const win = { id: 'w1', type: 'window' as const, wallId: 'w2', offsetAlongWall: 2.5, width: 1.2, height: 1.2, elevation: 0.9 };

const room = (furniture = [sofa(), chair('c1'), chair('c2', { position: { x: 2, y: 3 } })], over = {}) => makeRoom({ furniture, fixtures: [makeDoor({ id: 'd', wallId: 'w1', offsetAlongWall: 1.2, width: 0.9, height: 2.04 }), win], ...over });
const project = (rooms = [room()]) => makeProject(rooms, FURNITURE_LIBRARY);

describe('grouping and totals', () => {
  it('groups identical pieces with a quantity and numbers the kinds', () => {
    const p = project();
    const s = buildSchedule(p, p.rooms);
    expect(s.furniture.map((r) => [r.no, r.name, r.qty])).toEqual([[1, '3-seat sofa', 1], [2, 'Dining chair', 2]]); // seating, by name
    expect(s.totals).toMatchObject({ pieces: 3, kinds: 2, openings: 2 });
    expect(s.openings.map((r) => [r.name, r.qty])).toEqual([['Door', 1], ['Window', 1]]);
  });
  it('keeps pieces of the same kind apart when their size, supplier, finish code or price differ', () => {
    const p = project([room([chair('a'), chair('b', { width: 0.5 }), chair('c', { metadata: { vendor: 'Acme' } }), chair('d', { metadata: { unitCost: 120 } })])]);
    expect(buildSchedule(p, p.rooms).furniture).toHaveLength(4);
  });
  it('adds costs: quantity × unit cost, a total, and says how many pieces have no cost', () => {
    const p = project([room([chair('a', { metadata: { unitCost: 125.5 } }), chair('b', { metadata: { unitCost: 125.5 } }), sofa({ metadata: { unitCost: 1899 } }), makeInstance({ id: 'x', definitionId: 'desk', position: { x: 3, y: 3 }, width: 1.4, length: 0.7, height: 0.74 })])]);
    const s = buildSchedule(p, p.rooms);
    const c = s.furniture.find((r) => r.name === 'Dining chair')!;
    expect(c.qty).toBe(2);
    expect(c.total).toBe(251);
    expect(s.totals.cost).toBe(2150);
    expect(s.totals).toMatchObject({ priced: 3, unpriced: 1 });
    expect(s.furniture.find((r) => r.name === 'Desk')!.total).toBeUndefined();
  });
  it('rounds money to the cent and ignores a nonsense cost', () => {
    const p = project([room([chair('a', { metadata: { unitCost: 0.1 } }), chair('b', { metadata: { unitCost: 0.1 } }), chair('c', { metadata: { unitCost: 0.1 } })]), ]);
    expect(buildSchedule(p, p.rooms).totals.cost).toBe(0.3);
    const bad = project([room([chair('a', { metadata: { unitCost: -5 } }), chair('b', { metadata: { unitCost: Number.NaN } })])]);
    expect(buildSchedule(bad, bad.rooms).totals.priced).toBe(0);
  });
  it('joins different notes for the same kind and lists the rooms in the all-rooms scope', () => {
    const r1 = room([chair('a', { metadata: { notes: 'oak' } })], { id: 'r1', name: 'Dining' });
    const r2 = room([chair('b', { metadata: { notes: 'to reupholster' } }), chair('c')], { id: 'r2', name: 'Kitchen' });
    const p = project([r1, r2]);
    const s = buildSchedule(p, p.rooms, 'all');
    expect(s.furniture).toHaveLength(1);
    expect(s.furniture[0].notes).toBe('oak; to reupholster');
    expect(roomsText(s.furniture[0])).toBe('Dining (1), Kitchen (2)');
    expect(s.roomNames).toEqual(['Dining', 'Kitchen']);
  });
  it('picks the rooms for a scope', () => {
    const p = project([room([], { id: 'r1', name: 'A' }), room([], { id: 'r2', name: 'B' })]);
    expect(scopeRooms(p, 'all', 'r2').map((r) => r.name)).toEqual(['A', 'B']);
    expect(scopeRooms(p, 'room', 'r2').map((r) => r.name)).toEqual(['B']);
    expect(scopeRooms(p, 'room', null).map((r) => r.name)).toEqual(['A']);
    expect(scopeRooms(makeProject([]), 'room', null)).toEqual([]);
  });
  it('an empty room gives an empty schedule', () => {
    const p = project([room([], { fixtures: [] })]);
    const s = buildSchedule(p, p.rooms);
    expect(s.furniture).toEqual([]);
    expect(s.totals).toMatchObject({ pieces: 0, cost: 0 });
  });
  it('formats sizes and money', () => {
    expect(sizeText({ width: 2.2, length: 0.95, height: 0.85 })).toBe('2.2 × 0.95 × 0.85 m');
    expect(sizeText({ width: 0.82, height: 2.04 })).toBe('0.82 × 2.04 m');
    expect(money(12)).toBe('12.00');
    expect(money(undefined)).toBe('');
  });
});

describe('CSV', () => {
  it('has a header, one line per kind, the openings and a totals line', () => {
    const p = project();
    const lines = toCsv(buildSchedule(p, p.rooms)).trim().split('\r\n');
    expect(lines[0]).toBe('No.,Category,Item,Qty,Width (m),Length (m),Height (m),Vendor,SKU,Finish code,Unit cost,Total cost,Rooms,Notes');
    expect(lines).toHaveLength(1 + 2 + 2 + 1);
    expect(lines[1]).toBe('1,seating,3-seat sofa,1,2.2,0.95,0.85,,,,,,Room,');
    expect(lines[lines.length - 1]).toMatch(/^,,Total pieces,3,/);
  });
  it('quotes commas, quotes and line breaks', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    expect(csvField(3)).toBe('3');
    expect(csvField(undefined)).toBe('');
  });
  it('stops a spreadsheet running text as a formula', () => {
    for (const bad of ['=SUM(A1)', '+1', '-2', '@cmd', '\tx']) expect(safeCell(bad).startsWith("'")).toBe(true);
    expect(safeCell('Oak')).toBe('Oak');
    const p = project([room([chair('a', { metadata: { vendor: '=HYPERLINK("http://x")', notes: '@evil' } })])]);
    const csv = toCsv(buildSchedule(p, p.rooms));
    expect(csv).toContain("\"'=HYPERLINK(");
    expect(csv).toContain(",'@evil");
  });
  it('says when pieces are not priced', () => {
    const p = project();
    expect(toCsv(buildSchedule(p, p.rooms))).toContain('3 pieces without a unit cost are not in the total');
  });
  it('names the files after the project and room', () => {
    expect(scheduleFileName('Smith House', 'Living Room', 'schedule', 'csv')).toBe('smith-house-living-room-schedule.csv');
    expect(scheduleFileName('Room 1', 'Room 1', 'plan', 'pdf')).toBe('room-1-plan.pdf');
    expect(scheduleFileName('', null, 'plan', 'pdf')).toBe('room-plan.pdf');
  });
});

describe('plan sheet', () => {
  const opts = (p = project()) => ({ projectName: 'Smith House', date: '2026-10-05', sheet: 1, sheets: 2, numbers: numbersFor(buildSchedule(p, p.rooms)) });
  it('chooses the biggest standard scale that fits', () => {
    const { denom, k } = chooseScale(4, 5, 400, 600);
    expect([10, 20, 25, 50, 75, 100, 150, 200, 250, 500, 1000]).toContain(denom);
    expect(4 * k).toBeLessThanOrEqual(400);
    expect(5 * k).toBeLessThanOrEqual(600);
    const smaller = [10, 20, 25, 50, 75, 100, 150, 200].filter((d) => d < denom);
    for (const d of smaller) expect(5 * (1000 / d) * (72 / 25.4) > 600 || 4 * (1000 / d) * (72 / 25.4) > 400, `1:${d}`).toBe(true);
    expect(chooseScale(200, 200, 400, 400).denom).toBe(1000); // far too big for any scale: the smallest is used
  });
  it('is a portrait A4 for a tall room and landscape for a wide one, with everything inside the page', () => {
    const p = project();
    const tall = planSheet(p, p.rooms[0], opts(p)); // 4 wide × 5 tall
    expect(tall.width).toBeCloseTo(A4.w, 1);
    expect(tall.height).toBeCloseTo(A4.h, 1);
    expect(tall.scaleLabel).toMatch(/^1:\d+$/);
    const wide = makeRoom({ vertices: [{ id: 'a', position: { x: 0, y: 0 } }, { id: 'b', position: { x: 6, y: 0 } }, { id: 'c', position: { x: 6, y: 3 } }, { id: 'd', position: { x: 0, y: 3 } }] });
    const pw = makeProject([wide], FURNITURE_LIBRARY);
    const ws = planSheet(pw, pw.rooms[0], { ...opts(pw), numbers: new Map() });
    expect(ws.width).toBeCloseTo(A4.h, 1);
    for (const sheet of [tall, ws]) {
      for (const pr of sheet.prims) {
        const pts = pr.t === 'poly' ? pr.pts : pr.t === 'line' ? [pr.a, pr.b] : [{ x: pr.x, y: pr.y }];
        for (const q of pts) { expect(q.x, pr.t).toBeGreaterThanOrEqual(-1); expect(q.x, pr.t).toBeLessThanOrEqual(sheet.width + 1); expect(q.y, pr.t).toBeGreaterThanOrEqual(-1); expect(q.y, pr.t).toBeLessThanOrEqual(sheet.height + 1); }
      }
    }
  });
  it('draws walls, one outline per piece, a number for each piece that matches the schedule, dimensions and the title block', () => {
    const p = project();
    const s = buildSchedule(p, p.rooms);
    const sheet = planSheet(p, p.rooms[0], opts(p));
    const texts = sheet.prims.filter((x) => x.t === 'text').map((x) => (x as { text: string }).text);
    expect(texts).toEqual(expect.arrayContaining(['Smith House', `Scale ${sheet.scaleLabel}`, '2026-10-05', 'Sheet 1 of 2']));
    expect(texts.some((t) => /^\d+\.\d\d m$/.test(t))).toBe(true); // dimension labels
    expect(sheet.prims.filter((x) => x.t === 'circle')).toHaveLength(3); // one numbered marker per piece
    const numberTexts = sheet.prims.filter((x) => x.t === 'text' && /^[1-9]$/.test(x.text)).map((x) => (x as { text: string }).text).sort();
    expect(numberTexts).toEqual(['1', '2', '2']); // the sofa is 1, the two chairs 2
    expect(s.furniture.find((r) => r.name === '3-seat sofa')!.no).toBe(1);
    expect(sheet.prims.some((x) => x.t === 'poly' && x.dash)).toBe(true); // the door's swing arc is dashed
  });
  it('shows raised pieces dashed and leaves rugs without a number', () => {
    const art = makeInstance({ id: 'art', definitionId: 'art-landscape', position: { x: 2, y: 4.985 }, width: 0.9, length: 0.03, height: 0.6, elevation: 1.3 });
    const rug = makeInstance({ id: 'rug', definitionId: 'rug-rect', position: { x: 2, y: 2.5 }, width: 2.4, length: 1.7, height: 0.015 });
    const p = project([room([art, rug], { fixtures: [] })]);
    const sheet = planSheet(p, p.rooms[0], { ...opts(p), numbers: numbersFor(buildSchedule(p, p.rooms)) });
    expect(sheet.prims.filter((x) => x.t === 'circle')).toHaveLength(1); // the picture only
    expect(sheet.prims.filter((x) => x.t === 'poly' && x.dash).length).toBeGreaterThanOrEqual(1);
  });
});

describe('PDF', () => {
  it('makes a valid PDF: one plan sheet per room, then the schedule', async () => {
    const p = project([room([chair('a', { metadata: { unitCost: 99 } }), sofa({ metadata: { vendor: 'Acme Furniture', sku: 'SOFA-3', unitCost: 1899 } })], { id: 'r1', name: 'Living' }), room([chair('b')], { id: 'r2', name: 'Dining' })]);
    const s = buildSchedule(p, p.rooms, 'all');
    const bytes = await makePdf({ project: p, rooms: p.rooms, schedule: s, projectName: 'Smith House', date: '2026-10-05' });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3); // two plans and a one-page schedule
    expect(doc.getTitle()).toMatch(/Smith House/);
  });
  it('paginates a long schedule', async () => {
    const many = Array.from({ length: 70 }, (_, i) => makeInstance({ id: `p${i}`, definitionId: 'dining-chair', position: { x: 0.5 + (i % 7) * 0.5, y: 0.5 + Math.floor(i / 7) * 0.5 }, width: 0.3 + i * 0.001, length: 0.3, height: 0.85 }));
    const p = project([room(many, { fixtures: [] })]);
    const s = buildSchedule(p, p.rooms);
    expect(s.furniture.length).toBe(70);
    const doc = await PDFDocument.load(await makePdf({ project: p, rooms: p.rooms, schedule: s, projectName: 'Big', date: '2026-10-05' }));
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);
  });
  it('copes with an empty room and with text the standard fonts cannot draw', async () => {
    const p = project([room([chair('a', { metadata: { vendor: '日本 Café ✓', notes: 'très «bon»' } })], { fixtures: [] }), ]);
    const doc = await PDFDocument.load(await makePdf({ project: p, rooms: p.rooms, schedule: buildSchedule(p, p.rooms), projectName: 'Café 日本', date: '2026-10-05' }));
    expect(doc.getPageCount()).toBe(2);
    const empty = project([room([], { fixtures: [] })]);
    const d2 = await PDFDocument.load(await makePdf({ project: empty, rooms: empty.rooms, schedule: buildSchedule(empty, empty.rooms), projectName: 'Empty', date: '2026-10-05' }));
    expect(d2.getPageCount()).toBe(2);
    expect(winAnsi('Café ✓ “x” – …')).toBe('Café ? "x" - ...');
  });
});
