import { staffPrice, typeById, matchesType, type Catalogue } from '../app/catalogue';
import { analyseApp, fullRuns, type AppProject } from '../app/model';
import { DEFAULT_RULES, profileOf } from '../engine/defaults';
import { doorLayout, doorLeafCount, doorLeafWidthMm, glassFraction, internalSize, wallLengthMm } from '../enclosure/enclosure';
import { doorOpening, footprint } from '../placement';
import { effectiveBottlesPerRow, rackCapacity, rackDepthNeededMm } from '../rack';

// "How the numbers are calculated": for a technician. Every step is worked through with the OPEN design's own numbers, so it shows exactly what the
// planner did for this design. The maths is the planner's own (the same functions the drawings and checks use); this file only lays the working out in
// words. `value` carries the number each step arrives at so a test can prove the explanation never drifts from the engine.

export interface CalcLine { label: string; formula: string; working: string; result: string; value?: number | null }
export interface CalcSection { id: string; title: string; summary: string; lines: CalcLine[]; notes: string[] }

const mm = (n: number): string => `${n} mm`;
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;
const side = (s: string): string => s.charAt(0) + s.slice(1).toLowerCase();

export function explainCalculations(p: AppProject, cat: Catalogue | null): CalcSection[] {
  const e = p.enclosure;
  const a = analyseApp(p);
  const out: CalcSection[] = [];

  // ---------------------------------------------------------------- inside size
  const iz = internalSize(e);
  out.push({
    id: 'inside', title: 'Inside size',
    summary: 'Sizes you type are to the OUTER faces of the walls. The inside is the outer size less each wall\'s build-up (panel, stud or glass frame), and the ceiling and floor build-up for the height.',
    lines: [
      { label: 'Inside width', formula: 'outer width − west wall build-up − east wall build-up', working: `${e.outerWidthMm} − ${e.walls.WEST.buildUpMm} − ${e.walls.EAST.buildUpMm}`, result: mm(iz.widthMm), value: iz.widthMm },
      { label: 'Inside depth', formula: 'outer depth − north wall build-up − south wall build-up', working: `${e.outerDepthMm} − ${e.walls.NORTH.buildUpMm} − ${e.walls.SOUTH.buildUpMm}`, result: mm(iz.depthMm), value: iz.depthMm },
      { label: 'Inside height', formula: 'height − ceiling build-up − floor build-up', working: `${e.heightMm} − ${e.ceilingBuildUpMm} − ${e.floorBuildUpMm}`, result: mm(iz.heightMm), value: iz.heightMm },
    ],
    notes: ['Everything inside (rack runs, the door opening, the walkway) is measured from the inside faces, from the north-west inside corner. A build-up that is not on the sample drawings is marked unconfirmed in the specification.'],
  });

  // ---------------------------------------------------------------- the door
  const dl = doorLayout(e);
  const dw = e.door.wall;
  const free = dl.wallLengthMm - e.door.widthMm;
  const op = doorOpening(e);
  out.push({
    id: 'door', title: 'The door and its wall',
    summary: 'The door wall is split into a fixed section, the door, and a fixed section. A door is centred unless it has an offset.',
    lines: [
      { label: 'Door wall length (outer face)', formula: 'north/south wall = outer width; east/west wall = outer depth', working: `${side(dw)} wall`, result: mm(dl.wallLengthMm), value: dl.wallLengthMm },
      { label: 'Fixed section before the door', formula: e.door.offsetMm === undefined ? '(wall length − door width) ÷ 2, rounded down' : 'the door\'s offset from the start of the wall', working: e.door.offsetMm === undefined ? `(${dl.wallLengthMm} − ${e.door.widthMm}) ÷ 2` : `offset ${e.door.offsetMm}`, result: mm(dl.beforeMm), value: dl.beforeMm },
      { label: 'Fixed section after the door', formula: 'wall length − before − door width (an odd millimetre goes here)', working: `${dl.wallLengthMm} − ${dl.beforeMm} − ${e.door.widthMm}`, result: mm(dl.afterMm), value: dl.afterMm },
      { label: 'Door opening, inside the enclosure', formula: 'the door\'s position on the outer face less the build-up of the wall at the start', working: `${side(op.wall)} wall`, result: `${op.aMm} to ${op.bMm} mm along the wall`, value: op.bMm - op.aMm },
      { label: doorLeafCount(e) === 2 ? 'Width of each leaf' : 'Door leaf width', formula: doorLeafCount(e) === 2 ? 'opening width ÷ 2' : 'the whole door width', working: doorLeafCount(e) === 2 ? `${e.door.widthMm} ÷ 2` : `${e.door.widthMm}`, result: mm(doorLeafWidthMm(e)), value: doorLeafWidthMm(e) },
    ],
    notes: [
      `Free wall left over once the door is taken out: ${wallLengthMm(e, dw)} − ${e.door.widthMm} = ${free} mm.`,
      e.door.swing === 'IN'
        ? `The door swings IN, so each leaf sweeps a quarter circle inside with a radius equal to the leaf width (${doorLeafWidthMm(e)} mm), centred on its hinge. Racks may not stand in it.`
        : 'The door swings OUT, so nothing inside needs to stay clear of it.',
      'The hinge side is as seen from outside, facing the door.',
    ],
  });

  // ---------------------------------------------------------------- glass
  let area = 0, glass = 0;
  for (const s of ['NORTH', 'EAST', 'SOUTH', 'WEST'] as const) {
    const wa = wallLengthMm(e, s) * e.heightMm;
    area += wa;
    const doorHere = e.door.wall === s ? e.door.widthMm * Math.min(e.door.heightMm, e.heightMm) : 0;
    glass += (e.walls[s].kind === 'GLASS' ? wa - doorHere : 0) + (doorHere && e.door.glazed ? doorHere : 0);
  }
  const frac = glassFraction(e);
  out.push({
    id: 'glass', title: 'Glass share of the walls',
    summary: 'The share of the outer wall area that is glass: framed-glass walls plus a glazed door. The door replaces wall area on its own wall.',
    lines: [
      { label: 'Total outer wall area', formula: 'sum over the four walls of wall length × height', working: `${Math.round(area / 1e6 * 100) / 100} m²`, result: `${Math.round(area / 1e6 * 100) / 100} m²`, value: area },
      { label: 'Glass area', formula: 'glass walls (less the door opening on the door wall) + a glazed door', working: `${Math.round(glass / 1e6 * 100) / 100} m²`, result: `${Math.round(glass / 1e6 * 100) / 100} m²`, value: glass },
      { label: 'Glass share', formula: 'glass area ÷ total wall area', working: `${Math.round(glass / 1e6 * 100) / 100} ÷ ${Math.round(area / 1e6 * 100) / 100}`, result: `${(frac * 100).toFixed(1)}%`, value: frac },
    ],
    notes: ['Over 50% only adds an advisory note (higher cooling load). It never blocks a design. Climate and glass guidance always needs mechanical engineer / HVAC sign-off.'],
  });

  // ---------------------------------------------------------------- rack capacity
  const s = p.rackSpec;
  const pr = profileOf(p.bottle);
  const perRow = effectiveBottlesPerRow(s, p.bottle);
  const capLines: CalcLine[] = [];
  capLines.push({
    label: 'Rows in one unit', formula: 'rows per unit if the supplier gave it, otherwise unit height ÷ row pitch, rounded down',
    working: s.rowsPerUnit !== null && s.rowsPerUnit !== undefined ? `${s.rowsPerUnit} (given)` : s.unitHeightMm !== null && s.rowPitchMm !== null ? `${s.unitHeightMm} ÷ ${s.rowPitchMm}` : 'height or pitch not set',
    result: s.rowsPerUnit !== null && s.rowsPerUnit !== undefined ? String(s.rowsPerUnit) : s.unitHeightMm !== null && s.rowPitchMm !== null ? String(Math.floor(s.unitHeightMm / s.rowPitchMm)) : 'not set',
    value: s.rowsPerUnit ?? (s.unitHeightMm !== null && s.rowPitchMm !== null ? Math.floor(s.unitHeightMm / s.rowPitchMm) : null),
  });
  capLines.push({
    label: 'Bottles in one row',
    formula: s.orientation === 'LABEL_FORWARD' ? 'label-forward: the supplier\'s figure only, never calculated' : 'the supplier\'s figure if typed, otherwise unit width ÷ the bottle\'s slot pitch, rounded down',
    working: s.orientation === 'LABEL_FORWARD' ? (s.bottlesPerRowLabelForward ?? 'not set').toString()
      : perRow?.source === 'typed' ? `${perRow.value} (typed)` : s.unitWidthMm !== null && s.orientation === 'NECK_OUT' ? `${s.unitWidthMm} ÷ ${pr.slotPitchMm} (${pr.label} slot pitch)` : 'unit width or orientation not set',
    result: perRow ? `${perRow.value}${perRow.source === 'calculated' ? ' (calculated: an estimate)' : ''}` : 'not set', value: perRow?.value ?? null,
  });
  for (const r of fullRuns(p)) {
    const c = rackCapacity(r.spec, r.units, r.bottle);
    capLines.push(c.status === 'OK'
      ? { label: `Run ${r.id} (${side(r.wall)} wall)`, formula: 'rows × bottles per row × units', working: `${c.rowsPerUnit} × ${c.bottlesPerRow} × ${r.units}`, result: `${c.capacity} bottles`, value: c.capacity }
      : { label: `Run ${r.id} (${side(r.wall)} wall)`, formula: 'rows × bottles per row × units', working: `missing: ${c.missing.join(', ')}`, result: 'not set', value: null });
  }
  const t = a.racks.total;
  capLines.push({
    label: 'Total bottles', formula: 'the sum of the runs that have no error',
    working: p.runs.length ? 'all counted runs added together' : 'no racks placed', result: t.status === 'OK' ? `${t.capacity} bottles` : `not set (${plural(t.unsetRuns, 'run')} without values)`, value: t.status === 'OK' ? t.capacity : null,
  });
  out.push({
    id: 'capacity', title: 'Rack capacity (bottles)',
    summary: 'Bottles = rows × bottles per row × units, for every run. A blank value is "not set": it is never counted as zero, so a total only appears when every run has what it needs.',
    lines: capLines,
    notes: [
      `Bottle slot pitches used when bottles per row is calculated (side-by-side spacing): Bordeaux 85, Burgundy 100, Champagne 105, Magnum 125 mm. This design uses ${pr.label}.`,
      'Calculated bottles per row is an ESTIMATE: the real pin spacing comes from the rack fabricator. A typed value is the supplier\'s and always wins.',
      t.status === 'OK' && t.uncounted ? `${t.uncounted.bottles} bottles in ${plural(t.uncounted.runs, 'run')} with an error are left OUT of the total, and the panel says so. A run the tool says cannot be built is never added into a clean-looking number.` : 'A run with an error (too tall, too shallow for the bottle, across the door, off the end of its wall) is left out of the total and reported, never silently counted.',
    ],
  });

  // ---------------------------------------------------------------- depth the bottle needs
  const need = s.orientation ? rackDepthNeededMm(s.orientation, p.bottle) : null;
  const R = DEFAULT_RULES;
  out.push({
    id: 'depth', title: 'Depth the bottle needs',
    summary: 'A unit must be deep enough for the bottle it holds. The check compares the unit depth with the depth the bottle needs.',
    lines: [
      s.orientation === 'LABEL_FORWARD'
        ? { label: 'Depth needed, label-forward', formula: 'bottle length × cos(angle) + bottle diameter × sin(angle) + front lip', working: `${pr.lengthMm} × cos ${R.displayAngleDeg}° + ${pr.diameterMm} × sin ${R.displayAngleDeg}° + ${R.displayLipMm}`, result: need === null ? 'not set' : `${Math.round(need)} mm`, value: need }
        : { label: 'Depth needed, neck-out', formula: 'bottle length + clearance', working: `${pr.lengthMm} + ${R.depthClearanceMm}`, result: need === null ? 'orientation not set' : `${Math.round(need)} mm`, value: need },
      { label: 'Unit depth entered', formula: 'from the rack type or typed', working: s.unitDepthMm === null ? 'not set' : String(s.unitDepthMm), result: s.unitDepthMm === null ? 'not set' : mm(s.unitDepthMm), value: s.unitDepthMm },
    ],
    notes: ['If the unit depth is less than the depth needed the design shows RACK_DEPTH_TOO_SHALLOW. The label-forward angle and lip are a joinery assumption until the fabricator confirms how their rods hold the bottle. Row pitch must also be at least the bottle diameter.'],
  });

  // ---------------------------------------------------------------- where racks stand
  const runLines: CalcLine[] = [];
  const iwid = iz.widthMm, idep = iz.depthMm;
  for (const r of fullRuns(p)) {
    const fp = footprint(e, r);
    const len = r.wall === 'NORTH' || r.wall === 'SOUTH' ? iwid : idep;
    runLines.push(fp.status === 'OK'
      ? { label: `Run ${r.id} (${side(r.wall)} wall)`, formula: 'length = units × unit width; it must fit between 0 and the inside wall length', working: `${r.units} × ${r.spec.unitWidthMm} = ${fp.lengthMm}; starts ${r.startMm}, ends ${r.startMm + fp.lengthMm}, wall ${len}`, result: `${fp.lengthMm} mm long, ${fp.depthMm} mm deep`, value: fp.lengthMm }
      : { label: `Run ${r.id} (${side(r.wall)} wall)`, formula: 'length = units × unit width', working: `missing: ${fp.missing.join(', ')}`, result: 'no footprint (not set)', value: null });
  }
  out.push({
    id: 'runs', title: 'Where racks stand, and the checks',
    summary: 'Each run is a line of whole units against one wall, measured from the inside north-west corner. The checks are plain geometry.',
    lines: runLines.length ? runLines : [{ label: 'Rack runs', formula: '', working: 'none placed', result: 'no racks yet', value: null }],
    notes: [
      '"Fill" a wall: whole units that fit = rounded down (free length ÷ unit width). The door wall is filled either side of the opening, so it can have two runs.',
      'Dragging a run on the plan snaps to: the start and end of its wall, the door opening\'s edges, the ends of other runs on the wall, and clear of runs on the end walls (the second run starts after the first one\'s depth). It only lands where the run has no more errors than it had.',
      'Checks that are errors: RUN_OUTSIDE (past the end of its wall), RUN_TOO_DEEP (deeper than the enclosure), RACK_TOO_TALL (taller than the inside), RUN_ON_DOOR (across the opening), RUN_IN_DOOR_SWING (inside an inward door\'s arc), DOOR_PATH_BLOCKED (inside the landing the walkway needs), RUN_OVERLAP (two runs share floor; at a corner the second starts after the first\'s depth).',
      `Walkway: the clear space in front of a run = across the enclosure − the run's depth − the depth of any run facing it. A gap smaller than the minimum walkway is only a WARNING. ${p.walkwayMm === null ? 'No minimum is set for this project, so the walkway is not checked.' : `The minimum for this project is ${p.walkwayMm} mm.`}`,
    ],
  });

  // ---------------------------------------------------------------- price
  const pl = staffPrice(p, cat);
  const priceLines: CalcLine[] = [];
  if (pl.status === 'OK') {
    for (const l of pl.lines) priceLines.push({ label: l.label, formula: l.detail ? 'units × price per unit' : 'a fixed amount from Settings', working: l.detail || 'from Settings, Cellar Planner', result: `${pl.currency}${l.amount.toLocaleString('en-AU')}`, value: l.amount });
    priceLines.push({ label: 'Total', formula: 'the lines added together', working: pl.lines.map((l) => `${pl.currency}${l.amount.toLocaleString('en-AU')}`).join(' + '), result: `${pl.currency}${pl.total.toLocaleString('en-AU')}`, value: pl.total });
    const pct = cat?.pricing.rangePct ?? 0, step = cat?.pricing.roundTo ?? 1;
    priceLines.push({ label: 'Range a customer sees', formula: 'total − and + the range %, each end rounded to the nearest step', working: `${pl.total} × (1 ∓ ${pct}%), nearest ${step}`, result: pl.text, value: null });
  } else priceLines.push({ label: 'Price', formula: 'fixed + units × price per unit + door price', working: '', result: pl.reason, value: null });
  out.push({
    id: 'price', title: 'Price',
    summary: 'Price = fixed amount + (rack units × the chosen rack type\'s price per unit) + the door price (single or double). All amounts come from Settings, Cellar Planner. The planner never invents a price.',
    lines: priceLines,
    notes: [
      'Units are the whole rack units across ALL runs. A blank amount is left out, never counted as zero, and the Price panel says so.',
      'The public planner shows only the rounded range, and only when the owner switches prices on. Staff always see the breakdown.',
      'This is an indicative guide, not a quote: a site measure and the finishes still decide the final price.',
    ],
  });

  // ---------------------------------------------------------------- what the markers mean / when a quote is allowed
  const t2 = typeById(cat, p.rackType?.id);
  out.push({
    id: 'trust', title: 'Estimated, confirmed, and when a quote is allowed',
    summary: 'The planner is strict about which numbers it trusts, because a quote must never rest on guesses.',
    lines: [
      { label: 'This design\'s rack type', formula: 'chosen in Rack specification', working: p.rackType ? p.rackType.name : 'custom (typed by hand)', result: !t2 ? (p.rackType ? 'no longer in the catalogue' : 'not priced') : t2.confirmed ? 'confirmed by the supplier' : 'NOT confirmed', value: null },
      { label: 'Values match the catalogue type', formula: 'every rack value equals the type\'s value', working: t2 ? 'compared field by field' : 'no type', result: t2 ? (matchesType(p, t2) ? 'yes' : 'no, edited') : 'n/a', value: null },
      { label: 'Values marked estimated', formula: 'best guesses, or values of an unconfirmed rack type', working: p.estimated?.length ? p.estimated.join(', ') : 'none', result: String(p.estimated?.length ?? 0), value: p.estimated?.length ?? 0 },
    ],
    notes: [
      'ESTIMATED: a value that is a best guess (the Test case) or belongs to a rack type the supplier has not confirmed. Typing your own number over it removes the mark. The drawing package says plainly when values are estimated.',
      'CALCULATED: bottles per row worked out from unit width and bottle pitch. NOT SET: blank, never zero.',
      'A customer quote is made only when: the catalogue loaded; the design uses a catalogue rack type that is confirmed by the supplier; its values still match that type; nothing is estimated; racks are placed with no errors and a bottle count; a price exists; and the business name is set in Settings.',
    ],
  });
  return out;
}

/** The same explanation as plain text, for pasting into a ticket or an email to the fabricator. */
export function calcToText(sections: CalcSection[], projectName: string): string {
  const out: string[] = [`How the numbers were calculated: ${projectName}`, ''];
  for (const sec of sections) {
    out.push(sec.title.toUpperCase(), sec.summary);
    for (const l of sec.lines) out.push(`- ${l.label}: ${l.formula ? `${l.formula}; ` : ''}${l.working ? `${l.working} ` : ''}= ${l.result}`.replace(/ {2,}/g, ' '));
    for (const n of sec.notes) out.push(`  Note: ${n}`);
    out.push('');
  }
  return out.join('\n').trim() + '\n';
}
