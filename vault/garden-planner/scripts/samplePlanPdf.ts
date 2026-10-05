// Builds a sample planting plan PDF from a small demo garden (for eyeballing the layout): npx vite-node scripts/samplePlanPdf.ts out.pdf [a4|a3]
import { writeFileSync } from 'node:fs';
import { apply, setItem } from '../src/domain/commands';
import { addBed, addLawn, addPath, addService, addZone } from '../src/domain/edit';
import { boundaryFromPoints, newGardenProject, rectanglePoints } from '../src/domain/projectFactory';
import type { GardenProject, Structure } from '../src/domain/types';
import { makePlanPdf } from '../src/schedule/planPdf';

let n = 0;
const ids = (): string => `x${++n}`;
const rect = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const structure = (kind: Structure['kind'], x: number, y: number, w: number, l: number, h: number, rotation = 0): Structure => ({ id: ids(), kind, name: kind.replace('_', ' '), position: { x, y }, width: w, length: l, height: h, rotation } as Structure);

let p: GardenProject = { ...newGardenProject('Michael\'s backyard', { label: 'Brisbane QLD', lat: -27.47, lng: 153.03, state: 'QLD' }, 'g1'), boundary: boundaryFromPoints(rectanglePoints(24, 20), 'timber_paling') };
p = { ...p, pets: true, house: { id: 'h', vertices: rect(7, 13, 17, 19).map((position, i) => ({ id: `v${i}`, position })), height: 3.2, fixtures: [] } };
p = apply(addLawn(rect(2, 3, 14, 11), true, ids, 1), p);
p = apply(addBed(rect(15, 2, 22, 9), true, ids, 1), p);
p = apply(addBed(rect(1, 13, 5.5, 18), false, ids, 2), p);
p = apply(addZone(rect(0, 0, 24, 12), ids, 1), p);
p = apply(addPath([{ x: 12, y: 0 }, { x: 12, y: 6 }, { x: 15, y: 12 }], ids, 1), p);
p = apply(addService([{ x: 1, y: 12.5 }, { x: 23, y: 12.5 }], 'water', ids, 1), p);
for (const s of [structure('gate', 12, 0, 0.9, 0.1, 1.5), structure('shed', 21, 16, 2.4, 1.8, 2.2), structure('pool', 4, 7, 3, 2, 0.1), structure('deck', 12, 11.2, 4, 1.2, 0.3)]) p = apply(setItem('structures', s.id, null, s), p);
const put = (plantId: string, x: number, y: number, note?: string): void => { const id = ids(); p = apply(setItem('plants', id, null, { id, plantId, position: { x, y }, ...(note ? { note } : {}) }), p); };
put('syzygium-smithii', 20, 12, 'screening the neighbour');
put('syzygium-smithii', 22.5, 14);
for (const x of [16, 17.5, 19, 20.5]) put('lavandula-angustifolia', x, 3.5);
for (const [x, y] of [[16.5, 6], [18.5, 6.5], [20.5, 7]] as const) put('callistemon-little-john', x, y);
for (const [x, y] of [[2, 14], [3, 16.5], [4.5, 14.5]] as const) put('grevillea-robyn-gordon', x, y);
put('ficus-carica', 2.5, 20 - 0.5);
for (const [x, y] of [[9, 5], [10, 7]] as const) put('dichondra-repens', x, y, 'between pavers');

const paper = (process.argv[3] ?? 'a4') as 'a4' | 'a3';
const bytes = await makePlanPdf(p, { paper, stage: 'mature', dimensions: true, includeSchedule: true, date: '2026-10-19' });
writeFileSync(process.argv[2] ?? 'plan.pdf', bytes);
console.log(`wrote ${bytes.length} bytes`);
