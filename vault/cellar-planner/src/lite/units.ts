// Lengths for people who do not think in millimetres. The design always stores whole millimetres; this file only turns what the visitor types into
// millimetres and turns millimetres back into text in the unit they chose. Nothing here changes a design code.

export type LengthUnit = 'm' | 'ft' | 'mm';
export const LENGTH_UNITS: readonly LengthUnit[] = ['m', 'ft', 'mm'];
export const UNIT_NAMES: Record<LengthUnit, string> = { m: 'Metres', ft: 'Feet and inches', mm: 'Millimetres' };
const MM_PER_INCH = 25.4;

const num = (t: string): number | null => {
  // "2,75" (comma as the decimal mark) and "1 234" / "1,234" (grouping) are both read the way a person means them
  let x = t.trim();
  if (!x) return null;
  // a space between digits is only a thousands separator ("2 750"); anything else with a space ("9 6") is not one number
  if (/^\d{1,3}(\s\d{3})+(\.\d+)?$/.test(x)) x = x.replace(/\s+/g, '');
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(x)) x = x.replace(/,/g, '');
  else x = x.replace(',', '.');
  if (!/^\d*\.?\d+$/.test(x) && !/^\d+\.$/.test(x)) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

/**
 * What the visitor typed to whole millimetres, or null if it is not a length. The unit is the one they chose, but a written unit always wins:
 * "275cm", "2.75m", "2750mm", "9ft", "9'6\"", "9 ft 6 in" all mean what they say whichever unit is selected.
 */
export function parseLength(text: string, unit: LengthUnit): number | null {
  const t = text.trim().toLowerCase().replace(/[”“″]/g, '"').replace(/[’‘′]/g, "'");
  if (!t) return null;

  // feet and inches written out: 9'6", 9' 6, 9ft 6in, 9 ft 6 in, 9ft, 6in
  const imperial = /^(?:(\d+(?:[.,]\d+)?)\s*(?:'|ft|feet|foot))?\s*(?:(\d+(?:[.,]\d+)?)\s*(?:"|in|ins|inch|inches)?)?$/.exec(t);
  if (imperial && (imperial[1] !== undefined || /(?:"|in|ins|inch|inches)$/.test(t)) && (imperial[1] !== undefined || imperial[2] !== undefined)) {
    // a bare trailing number counts as inches only when feet came first ("9 6" is not accepted; "9'6" is)
    if (imperial[1] === undefined || /['a-z]/.test(t)) {
      const ft = imperial[1] !== undefined ? num(imperial[1]) : 0, inch = imperial[2] !== undefined ? num(imperial[2]) : 0;
      if (ft === null || inch === null) return null;
      return Math.round((ft * 12 + inch) * MM_PER_INCH);
    }
  }

  const m = /^([\d.,\s]+?)\s*(mm|cm|m|metres|meters|metre|meter)?$/.exec(t);
  if (!m) return null;
  const n = num(m[1]);
  if (n === null) return null;
  const u = m[2];
  if (u === 'mm') return Math.round(n);
  if (u === 'cm') return Math.round(n * 10);
  if (u) return Math.round(n * 1000);
  if (unit === 'mm') return Math.round(n);
  if (unit === 'm') return Math.round(n * 1000);
  return Math.round(n * 12 * MM_PER_INCH); // feet, possibly with a decimal: 9.5 = nine and a half feet
}

const trim = (n: number, places: number): string => n.toFixed(places).replace(/\.?0+$/, '');

/** Millimetres as the text for an input box in the chosen unit (no unit word: the box shows that). */
export function formatLength(mm: number, unit: LengthUnit): string {
  if (unit === 'mm') return String(Math.round(mm));
  if (unit === 'm') return trim(mm / 1000, 3);
  const totalIn = Math.round(mm / MM_PER_INCH);
  const ft = Math.floor(totalIn / 12), inch = totalIn % 12;
  return inch === 0 ? `${ft}'` : `${ft}' ${inch}"`;
}

/** The same length in words, for sentences ("about 0.97 m", "about 3 ft 2 in"). */
export function describeLength(mm: number, unit: LengthUnit): string {
  if (unit === 'mm') return `${Math.round(mm)} mm`;
  if (unit === 'm') return `${trim(mm / 1000, 2)} m`;
  const totalIn = Math.round(mm / MM_PER_INCH);
  const ft = Math.floor(totalIn / 12), inch = totalIn % 12;
  return ft === 0 ? `${inch} in` : inch === 0 ? `${ft} ft` : `${ft} ft ${inch} in`;
}

/** What the box suffix says. */
export const unitSuffix = (unit: LengthUnit): string => (unit === 'ft' ? 'ft / in' : unit);

/** An example to type, per unit, shown as a hint. */
export const unitExample = (unit: LengthUnit): string => (unit === 'm' ? 'for example 2.75' : unit === 'ft' ? "for example 9' 6\"" : 'for example 2750');

/** "Between 1 and 8 m" in the chosen unit. */
export function rangeText([lo, hi]: readonly [number, number], unit: LengthUnit): string {
  return `Between ${describeLength(lo, unit)} and ${describeLength(hi, unit)}.`;
}
