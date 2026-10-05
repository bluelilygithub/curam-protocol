// Furniture schedule (M5): what is in the room (or in every room), grouped, with quantities, sizes, supplier details and a cost total.
// Pure. The same rows feed the on-screen table, the CSV file and the PDF.
import type { FurnitureInstance, Project, Room } from '../engine/types';

export type ScheduleScope = 'room' | 'all';

export interface ScheduleRow {
  /** 1, 2, 3 … The number printed on the plan beside each piece of this kind. */
  no: number;
  category: string;
  name: string;
  qty: number;
  /** Metres. Doors and windows have no length. */
  width: number;
  length?: number;
  height: number;
  vendor: string;
  sku: string;
  finishCode: string;
  unitCost?: number;
  /** unitCost × qty, when there is a cost. */
  total?: number;
  notes: string;
  /** Room name → how many are in it (for the "all rooms" scope; one entry for a single room). */
  rooms: Record<string, number>;
  instanceIds: string[];
}

export interface Schedule {
  scope: ScheduleScope;
  roomNames: string[];
  furniture: ScheduleRow[];
  openings: ScheduleRow[];
  totals: { pieces: number; kinds: number; openings: number; cost: number; priced: number; unpriced: number };
}

const mm = (v: number): number => Math.round(v * 1000);
const clean = (s: string | undefined): string => (s ?? '').trim().replace(/\s+/g, ' ');

/** The rooms a scope covers: the active one (or the first), or all of them. */
export function scopeRooms(project: Project, scope: ScheduleScope, activeRoomId: string | null): Room[] {
  if (scope === 'all') return project.rooms;
  const r = project.rooms.find((x) => x.id === activeRoomId) ?? project.rooms[0];
  return r ? [r] : [];
}

export function buildSchedule(project: Project, rooms: Room[], scope: ScheduleScope = rooms.length > 1 ? 'all' : 'room'): Schedule {
  const defs = new Map(project.furnitureDefinitions.map((d) => [d.id, d]));
  const groups = new Map<string, ScheduleRow>();
  const noteSets = new Map<string, Set<string>>();
  const order: string[] = [];

  for (const room of rooms) {
    // creation order of ids is the stable order (collections are sorted by id, C18)
    for (const f of room.furniture as FurnitureInstance[]) {
      const def = defs.get(f.definitionId);
      const m = f.metadata ?? {};
      const vendor = clean(m.vendor), sku = clean(m.sku), finishCode = clean(m.finishCode);
      const unit = typeof m.unitCost === 'number' && Number.isFinite(m.unitCost) && m.unitCost >= 0 ? m.unitCost : undefined;
      const key = [f.definitionId, mm(f.width), mm(f.length), mm(f.height), vendor, sku, finishCode, unit ?? ''].join('|');
      let row = groups.get(key);
      if (!row) {
        row = {
          no: 0, category: def?.category ?? 'other', name: def?.name ?? 'Object', qty: 0, width: f.width, length: f.length, height: f.height,
          vendor, sku, finishCode, unitCost: unit, notes: '', rooms: {}, instanceIds: [],
        };
        groups.set(key, row);
        noteSets.set(key, new Set());
        order.push(key);
      }
      row.qty += 1;
      row.rooms[room.name] = (row.rooms[room.name] ?? 0) + 1;
      row.instanceIds.push(f.id);
      const note = clean(m.notes);
      if (note) noteSets.get(key)!.add(note);
    }
  }

  const furniture = order
    .map((k) => {
      const row = groups.get(k)!;
      row.notes = [...(noteSets.get(k) ?? [])].join('; ');
      row.total = row.unitCost === undefined ? undefined : Math.round(row.unitCost * row.qty * 100) / 100;
      return row;
    })
    // by kind of thing, then name, then size: a schedule reads better grouped than in the order things were placed
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : a.width - b.width || (a.length ?? 0) - (b.length ?? 0) || a.height - b.height));
  furniture.forEach((r, i) => { r.no = i + 1; });

  // doors and windows, grouped by kind and size
  const openMap = new Map<string, ScheduleRow>();
  for (const room of rooms) {
    for (const fx of room.fixtures) {
      const key = `${fx.type}|${mm(fx.width)}|${mm(fx.height)}`;
      let row = openMap.get(key);
      if (!row) {
        row = { no: 0, category: fx.type === 'door' ? 'door' : 'window', name: fx.type === 'door' ? 'Door' : 'Window', qty: 0, width: fx.width, height: fx.height, vendor: '', sku: '', finishCode: '', notes: '', rooms: {}, instanceIds: [] };
        openMap.set(key, row);
      }
      row.qty += 1;
      row.rooms[room.name] = (row.rooms[room.name] ?? 0) + 1;
      row.instanceIds.push(fx.id);
    }
  }
  const openings = [...openMap.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.width - b.width));

  const pieces = furniture.reduce((n, r) => n + r.qty, 0);
  const priced = furniture.filter((r) => r.unitCost !== undefined).reduce((n, r) => n + r.qty, 0);
  const cost = Math.round(furniture.reduce((s, r) => s + (r.total ?? 0), 0) * 100) / 100;
  return {
    scope, roomNames: rooms.map((r) => r.name), furniture, openings,
    totals: { pieces, kinds: furniture.length, openings: openings.reduce((n, r) => n + r.qty, 0), cost, priced, unpriced: pieces - priced },
  };
}

// ------------------------------------------------------------------ text for the table, CSV and PDF

const dim = (v: number | undefined): string => (v === undefined ? '' : String(Number(v.toFixed(3))));
export const money = (v: number | undefined): string => (v === undefined ? '' : v.toFixed(2));

/** "2.2 × 0.95 × 0.85 m" (a door or window: "0.82 × 2.04 m"). */
export function sizeText(r: Pick<ScheduleRow, 'width' | 'length' | 'height'>): string {
  const parts = r.length === undefined ? [r.width, r.height] : [r.width, r.length, r.height];
  return `${parts.map((v) => String(Number(v.toFixed(3)))).join(' × ')} m`;
}

export const roomsText = (r: ScheduleRow): string => Object.entries(r.rooms).map(([n, c]) => (Object.keys(r.rooms).length > 1 || c > 1 ? `${n} (${c})` : n)).join(', ');

// ------------------------------------------------------------------ CSV

const CSV_COLUMNS = ['No.', 'Category', 'Item', 'Qty', 'Width (m)', 'Length (m)', 'Height (m)', 'Vendor', 'SKU', 'Finish code', 'Unit cost', 'Total cost', 'Rooms', 'Notes'] as const;

// the cell guard and quoting live in planner-core, shared with Garden Planner's plant schedule
export { safeCell, csvField } from '@planner-core/export/csv';
import { csvField } from '@planner-core/export/csv';

/** The schedule as CSV text: furniture, then doors and windows, then totals. A byte-order mark is added by `csvBlobParts`. */
export function toCsv(s: Schedule): string {
  const line = (cells: Array<string | number | undefined>): string => cells.map(csvField).join(',');
  const row = (r: ScheduleRow): string => line([r.no || '', r.category, r.name, r.qty, dim(r.width), dim(r.length), dim(r.height), r.vendor, r.sku, r.finishCode, money(r.unitCost), money(r.total), roomsText(r), r.notes]);
  const out: string[] = [line([...CSV_COLUMNS])];
  for (const r of s.furniture) out.push(row(r));
  for (const r of s.openings) out.push(row(r));
  out.push(line(['', '', 'Total pieces', s.totals.pieces, '', '', '', '', '', '', '', money(s.totals.cost), '', s.totals.unpriced > 0 ? `${s.totals.unpriced} piece${s.totals.unpriced === 1 ? '' : 's'} without a unit cost are not in the total` : '']));
  return out.join('\r\n') + '\r\n';
}

/** The CSV with a UTF-8 byte-order mark, which makes Excel read accents and symbols correctly. */
export const csvBlobParts = (s: Schedule): string[] => ['﻿', toCsv(s)];

// ------------------------------------------------------------------ file names

const slug = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** `<project>-<room>-<kind>.<ext>` (the room is left out for all rooms or when it repeats the project name). */
export function scheduleFileName(project: string, room: string | null, kind: 'schedule' | 'plan', ext: 'csv' | 'pdf'): string {
  const p = slug(project) || 'room';
  const r = room ? slug(room) : '';
  return `${[p, r && r !== p ? r : '', kind].filter(Boolean).join('-')}.${ext}`;
}
