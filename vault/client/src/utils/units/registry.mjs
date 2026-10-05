/**
 * Measurement registry — the single source of truth for every unit, conversion, ingredient density
 * and formula shown anywhere in the Measurements app (converter, formula library, voice parser,
 * document scanner). No conversion constants live anywhere else.
 *
 * Unit shape: see `makeUnit`. Conversion types:
 *   factor  — multiply by a constant (most units; constant may depend on the cup standard)
 *   offset  — scale + offset (temperature)
 *   inverse — reciprocal relationship (fuel economy)
 *   lookup  — table, not formula (gas marks)
 *   compound — several parts summed/decomposed (ft + in, st + lb, h + min, degrees/minutes/seconds)
 *
 * Defined constants use the exact legal values (0.3048, 0.45359237, 3.785411784 ...).
 */

// ── Reference data ────────────────────────────────────────────────────────────
export const CUP_STANDARDS = {
  au: { id: 'au', label: 'Australian', cupMl: 250, tbspMl: 20, tspMl: 5 },
  us: { id: 'us', label: 'US', cupMl: 236.588, tbspMl: 14.787, tspMl: 4.929 },
  uk: { id: 'uk', label: 'UK / metric', cupMl: 250, tbspMl: 15, tspMl: 5 },
};
export const DEFAULT_CUP_STANDARD = 'au';

const SRC = {
  SI: 'SI Brochure, 9th edition (BIPM)',
  YARD: 'International yard and pound agreement, 1959',
  NIST: 'NIST Handbook 44, Appendix C (US customary units)',
  UKWM: 'UK Weights and Measures Act 1985 (imperial units)',
  CUPS: 'Cup standards: Australian (250 ml cup, 20 ml tablespoon), US customary, UK/metric (15 ml tablespoon)',
  NMI: 'International Hydrographic Conference, 1929 (1 nautical mile = 1852 m)',
  TEMP: 'SI Brochure (BIPM): kelvin and degree Celsius; Fahrenheit defined from Celsius',
  JULIAN: 'Julian year (365.25 days) — IAU convention; calendar years vary',
  IEC: 'IEC 80000-13 (decimal SI prefixes vs binary IEC prefixes)',
  ISO: 'ISO 80000 (quantities and units)',
  NIST811: 'NIST Special Publication 811 (guide for SI use / conversion factors)',
  GAS: 'Common UK gas mark chart (Celsius equivalents are standard published values; not a formula)',
  FUEL: 'Derived from litre, mile and gallon definitions (US 3.785411784 L; imperial 4.54609 L; mile 1609.344 m)',
};

export const GROUPS = [
  { id: 'length', name: 'Length', base: 'metre' },
  { id: 'area', name: 'Area', base: 'square metre' },
  { id: 'volume', name: 'Volume', base: 'litre' },
  { id: 'mass', name: 'Mass', base: 'kilogram' },
  { id: 'temperature', name: 'Temperature', base: 'kelvin', note: 'Includes oven gas marks (a lookup table, not a formula).' },
  { id: 'speed', name: 'Speed', base: 'metre per second' },
  { id: 'time', name: 'Time', base: 'second' },
  { id: 'pressure', name: 'Pressure', base: 'pascal' },
  { id: 'energy', name: 'Energy', base: 'joule' },
  { id: 'power', name: 'Power', base: 'watt' },
  { id: 'data', name: 'Data size', base: 'byte' },
  { id: 'datarate', name: 'Data rate', base: 'bit per second' },
  { id: 'angle', name: 'Angle', base: 'radian' },
  { id: 'fuel', name: 'Fuel economy', base: 'litres per 100 km' },
  { id: 'cooking', name: 'Cooking (cups, spoons, grams)', base: 'gram', note: 'Volume to weight needs an ingredient. For oven temperatures use Temperature → gas mark.' },
  { id: 'force', name: 'Force', base: 'newton' },
  { id: 'torque', name: 'Torque', base: 'newton metre' },
  { id: 'flow', name: 'Flow rate', base: 'litre per minute' },
];
const GROUP_BY_ID = Object.fromEntries(GROUPS.map((g) => [g.id, g]));

// ── Ingredient densities (cooking group) ──────────────────────────────────────
// Grams per metric cup (250 ml). These are *typical published baking-chart values* and vary with
// brand, packing and humidity — hence `approximate: true` everywhere they are shown.
const ING_SOURCE = 'Typical Australian baking conversion charts (approximate; varies with brand and packing)';
export const INGREDIENTS = [
  { id: 'plain-flour', name: 'Plain flour', aliases: ['plain flour', 'flour', 'all purpose flour', 'all-purpose flour'], gPerCup: 150 },
  { id: 'self-raising-flour', name: 'Self-raising flour', aliases: ['self raising flour', 'self-raising flour', 'self rising flour'], gPerCup: 150 },
  { id: 'wholemeal-flour', name: 'Wholemeal flour', aliases: ['wholemeal flour', 'whole wheat flour', 'wholewheat flour'], gPerCup: 160 },
  { id: 'cornflour', name: 'Cornflour (cornstarch)', aliases: ['cornflour', 'corn flour', 'cornstarch', 'corn starch'], gPerCup: 150 },
  { id: 'caster-sugar', name: 'Caster sugar', aliases: ['caster sugar', 'castor sugar', 'superfine sugar'], gPerCup: 220 },
  { id: 'white-sugar', name: 'White sugar', aliases: ['white sugar', 'sugar', 'granulated sugar'], gPerCup: 220 },
  { id: 'brown-sugar', name: 'Brown sugar (firmly packed)', aliases: ['brown sugar'], gPerCup: 200 },
  { id: 'icing-sugar', name: 'Icing sugar', aliases: ['icing sugar', 'powdered sugar', 'confectioners sugar'], gPerCup: 160 },
  { id: 'butter', name: 'Butter', aliases: ['butter'], gPerCup: 250 },
  { id: 'rice', name: 'Rice (uncooked)', aliases: ['rice', 'white rice'], gPerCup: 220 },
  { id: 'rolled-oats', name: 'Rolled oats', aliases: ['rolled oats', 'oats', 'porridge oats'], gPerCup: 90 },
  { id: 'milk', name: 'Milk', aliases: ['milk'], gPerCup: 258 },
  { id: 'water', name: 'Water', aliases: ['water'], gPerCup: 250 },
  { id: 'honey', name: 'Honey', aliases: ['honey'], gPerCup: 350 },
  { id: 'vegetable-oil', name: 'Vegetable oil', aliases: ['vegetable oil', 'oil', 'olive oil', 'canola oil'], gPerCup: 230 },
  { id: 'cocoa', name: 'Cocoa powder', aliases: ['cocoa', 'cocoa powder', 'cacao'], gPerCup: 100 },
  { id: 'salt', name: 'Table salt', aliases: ['salt', 'table salt', 'fine salt'], gPerCup: 300 },
  { id: 'almond-meal', name: 'Almond meal', aliases: ['almond meal', 'ground almonds', 'almond flour'], gPerCup: 100 },
  { id: 'desiccated-coconut', name: 'Desiccated coconut', aliases: ['desiccated coconut', 'shredded coconut', 'coconut'], gPerCup: 90 },
  { id: 'yoghurt', name: 'Yoghurt', aliases: ['yoghurt', 'yogurt'], gPerCup: 260 },
  { id: 'cream', name: 'Cream', aliases: ['cream', 'thickened cream', 'pouring cream'], gPerCup: 250 },
  { id: 'breadcrumbs', name: 'Dry breadcrumbs', aliases: ['breadcrumbs', 'bread crumbs', 'dry breadcrumbs'], gPerCup: 110 },
].map((i) => ({ ...i, source: ING_SOURCE, approximate: true, gPerMl: i.gPerCup / 250 }));
const INGREDIENT_BY_ID = Object.fromEntries(INGREDIENTS.map((i) => [i.id, i]));
export const getIngredient = (id) => INGREDIENT_BY_ID[id] || null;

// ── Gas mark lookup (°C) ──────────────────────────────────────────────────────
export const GAS_MARKS = [[0.25, 110], [0.5, 120], [1, 140], [2, 150], [3, 170], [4, 180], [5, 190], [6, 200], [7, 220], [8, 230], [9, 240]];

// ── Number display (decimal-safe) ─────────────────────────────────────────────
/** Remove binary floating-point noise (0.30000000000000004 → 0.3). */
export function clean(x) {
  if (!Number.isFinite(x)) return x;
  if (x === 0) return 0;
  return Number(x.toPrecision(12));
}

/** Format for display. precision: { mode: 'sig'|'dp', n }. Trailing zeros are trimmed. */
export function formatNumber(x, precision = { mode: 'sig', n: 6 }) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '-∞';
  x = clean(x);
  if (x === 0) return '0';
  const mode = precision?.mode === 'dp' ? 'dp' : 'sig';
  const n = Math.max(0, Math.min(15, Number.isFinite(precision?.n) ? Math.round(precision.n) : mode === 'dp' ? 4 : 6));
  const abs = Math.abs(x);
  let out;
  if (mode === 'dp') {
    out = x.toFixed(Math.min(n, 20));
    if (Number(out) === 0 && x !== 0) {
      // tiny value that rounds to zero at this precision: keep it visible
      out = x.toExponential(Math.max(1, Math.min(n, 6)));
      return out.replace(/\.?0+e/, 'e').replace('e+', 'e');
    }
  } else {
    const sig = Math.max(1, n);
    if (abs < 1e-6 || abs >= 1e15) {
      return x.toExponential(sig - 1).replace(/\.?0+e/, 'e').replace('e+', 'e');
    }
    const decimals = Math.max(0, sig - 1 - Math.floor(Math.log10(abs)));
    out = Number(x.toPrecision(sig)).toFixed(Math.min(decimals, 20));
  }
  if (out.includes('.')) out = out.replace(/0+$/, '').replace(/\.$/, '');
  if (out === '-0') out = '0';
  return out;
}

// ── Unit construction ─────────────────────────────────────────────────────────
const UNITS = [];

function defaultFormula(u, baseSymbol, factor) {
  return `1 ${u.symbols[0] || u.name} = ${formatNumber(factor, { mode: 'sig', n: 12 })} ${baseSymbol}`;
}

/**
 * Register a unit. spec:
 *   number                       → factor to the group base
 *   { fn: ctx => number }        → context-dependent factor (cup standard)
 *   { scale, offset }            → base = v*scale + offset
 *   { inverse: k }               → base = k / v   (fuel economy)
 *   { lookup: [[v, baseValue]] } → table
 *   { compound: [unitKey...] }   → parts, largest first
 *   { custom: { toBase, fromBase } }
 */
function makeUnit(group, key, name, plural, symbols, aliases, system, spec, extra = {}) {
  const id = `${group}.${key}`;
  const u = {
    id, group, key, name, plural, symbols, aliases, system,
    variant: extra.variant || null,
    alsoUS: !!extra.alsoUS,
    hidden: !!extra.hidden,
    minorDecimals: extra.minorDecimals ?? 4,
    needsContext: extra.needsContext || null,
    ambiguity: extra.ambiguity || null,
    exampleValue: extra.ex ?? 1,
    source: extra.source || SRC.SI,
    note: extra.note || null,
    generic: extra.generic || null, // generic alias family ('gallon', 'pint' ...) resolved by region
  };
  if (typeof spec === 'number') {
    u.type = 'factor'; u.factor = spec;
    u.toBase = (v) => v * spec; u.fromBase = (b) => b / spec;
  } else if (spec.fn) {
    u.type = 'factor'; u.factorFn = spec.fn;
    u.toBase = (v, ctx) => v * spec.fn(ctx || {}); u.fromBase = (b, ctx) => b / spec.fn(ctx || {});
  } else if ('scale' in spec) {
    u.type = 'offset'; u.scale = spec.scale; u.offset = spec.offset;
    u.toBase = (v, ctx) => (ctx?.tempMode === 'difference' ? v * spec.scale : v * spec.scale + spec.offset);
    u.fromBase = (b, ctx) => (ctx?.tempMode === 'difference' ? b / spec.scale : (b - spec.offset) / spec.scale);
  } else if ('inverse' in spec) {
    u.type = 'inverse'; u.k = spec.inverse;
    u.toBase = (v) => (v === 0 ? Infinity : spec.inverse / v);
    u.fromBase = (b) => (b === 0 ? Infinity : spec.inverse / b);
  } else if (spec.lookup) {
    u.type = 'lookup'; u.table = spec.lookup;
    u.toBase = (v, ctx) => {
      if (ctx?.tempMode === 'difference') return NaN;
      const row = spec.lookup.find(([k]) => k === v);
      return row ? row[1] + 273.15 : NaN;
    };
    u.fromBase = (b, ctx) => {
      if (ctx?.tempMode === 'difference') return NaN;
      const c = b - 273.15;
      let best = spec.lookup[0];
      for (const row of spec.lookup) if (Math.abs(row[1] - c) < Math.abs(best[1] - c)) best = row;
      return best[0];
    };
  } else if (spec.compound) {
    u.type = 'compound'; u.parts = spec.compound.map((k) => `${group}.${k}`);
  } else if (spec.custom) {
    u.type = 'factor'; u.toBase = spec.custom.toBase; u.fromBase = spec.custom.fromBase; u.needsContext = extra.needsContext;
  }
  u.formulaText = extra.formula || null;
  u.exampleText = extra.example || null;
  UNITS.push(u);
  return u;
}

// shorthand for the common case
const U = (g, k, n, p, sy, al, sys, spec, ex) => makeUnit(g, k, n, p, sy, al, sys, spec, ex);

// Length (base m)
U('length', 'micrometre', 'micrometre', 'micrometres', ['µm', 'μm'], ['micrometre', 'micrometres', 'micrometer', 'micrometers', 'micron', 'microns'], 'metric', 1e-6);
U('length', 'millimetre', 'millimetre', 'millimetres', ['mm'], ['millimetre', 'millimetres', 'millimeter', 'millimeters'], 'metric', 0.001, { ex: 25 });
U('length', 'centimetre', 'centimetre', 'centimetres', ['cm'], ['centimetre', 'centimetres', 'centimeter', 'centimeters'], 'metric', 0.01, { ex: 100 });
U('length', 'metre', 'metre', 'metres', ['m'], ['metre', 'metres', 'meter', 'meters'], 'metric', 1, { ex: 2, ambiguity: '"m" can mean metres or minutes' });
U('length', 'kilometre', 'kilometre', 'kilometres', ['km'], ['kilometre', 'kilometres', 'kilometer', 'kilometers'], 'metric', 1000, { ex: 5 });
U('length', 'inch', 'inch', 'inches', ['in', '″', '"'], ['inch', 'inches'], 'imperial', 0.0254, { alsoUS: true, source: SRC.YARD, ex: 12, ambiguity: 'A straight quote (") or "in" can be a quotation mark or the word "in", not inches' });
U('length', 'foot', 'foot', 'feet', ['ft', '′', "'"], ['foot', 'feet'], 'imperial', 0.3048, { alsoUS: true, source: SRC.YARD, ex: 6, ambiguity: "A straight apostrophe (') can be a quotation mark, not feet" });
U('length', 'yard', 'yard', 'yards', ['yd'], ['yard', 'yards'], 'imperial', 0.9144, { alsoUS: true, source: SRC.YARD, ex: 10 });
U('length', 'mile', 'mile', 'miles', ['mi'], ['mile', 'miles'], 'imperial', 1609.344, { alsoUS: true, source: SRC.YARD, ex: 26.2 });
U('length', 'nauticalmile', 'nautical mile', 'nautical miles', ['nmi', 'NM'], ['nautical mile', 'nautical miles'], 'other', 1852, { source: SRC.NMI, ex: 10 });
U('length', 'ftin', 'feet + inches', 'feet + inches', [], ['feet and inches', 'feet inches'], 'imperial', { compound: ['foot', 'inch'] }, { alsoUS: true, source: SRC.YARD });

// Area (base m²)
U('area', 'mm2', 'square millimetre', 'square millimetres', ['mm²', 'mm2'], ['square millimetre', 'square millimetres', 'square millimeter', 'square millimeters'], 'metric', 1e-6);
U('area', 'cm2', 'square centimetre', 'square centimetres', ['cm²', 'cm2'], ['square centimetre', 'square centimetres', 'square centimeter', 'square centimeters'], 'metric', 1e-4);
U('area', 'm2', 'square metre', 'square metres', ['m²', 'm2', 'sqm', 'sq m'], ['square metre', 'square metres', 'square meter', 'square meters'], 'metric', 1, { ex: 20 });
U('area', 'hectare', 'hectare', 'hectares', ['ha'], ['hectare', 'hectares'], 'metric', 10000);
U('area', 'km2', 'square kilometre', 'square kilometres', ['km²', 'km2'], ['square kilometre', 'square kilometres', 'square kilometer', 'square kilometers'], 'metric', 1e6);
U('area', 'in2', 'square inch', 'square inches', ['in²', 'sq in'], ['square inch', 'square inches'], 'imperial', 0.00064516, { alsoUS: true, source: SRC.YARD });
U('area', 'ft2', 'square foot', 'square feet', ['ft²', 'sq ft', 'sqft'], ['square foot', 'square feet'], 'imperial', 0.09290304, { alsoUS: true, source: SRC.YARD, ex: 100 });
U('area', 'yd2', 'square yard', 'square yards', ['yd²', 'sq yd'], ['square yard', 'square yards'], 'imperial', 0.83612736, { alsoUS: true, source: SRC.YARD });
U('area', 'acre', 'acre', 'acres', ['ac'], ['acre', 'acres'], 'imperial', 4046.8564224, { alsoUS: true, source: SRC.YARD });
U('area', 'mi2', 'square mile', 'square miles', ['mi²', 'sq mi'], ['square mile', 'square miles'], 'imperial', 2589988.110336, { alsoUS: true, source: SRC.YARD });
U('area', 'square', 'square (100 ft²)', 'squares (100 ft²)', [], ['roofing square', 'roofing squares', 'building square'], 'imperial', 9.290304, { source: 'Australian building trade: one "square" = 100 ft² = 9.290304 m²', note: 'Roofing / building "square"' });

// Volume (base L). Cup/tbsp/tsp follow the selected cup standard.
const cupFn = (key) => (ctx) => (CUP_STANDARDS[ctx.cupStandard] || CUP_STANDARDS[DEFAULT_CUP_STANDARD])[key] / 1000;
U('volume', 'millilitre', 'millilitre', 'millilitres', ['ml', 'mL'], ['millilitre', 'millilitres', 'milliliter', 'milliliters'], 'metric', 0.001, { ex: 250 });
U('volume', 'litre', 'litre', 'litres', ['L', 'l', 'lt'], ['litre', 'litres', 'liter', 'liters'], 'metric', 1);
U('volume', 'm3', 'cubic metre', 'cubic metres', ['m³', 'm3'], ['cubic metre', 'cubic metres', 'cubic meter', 'cubic meters'], 'metric', 1000);
U('volume', 'tsp', 'teaspoon', 'teaspoons', ['tsp', 't'], ['teaspoon', 'teaspoons'], 'other', { fn: cupFn('tspMl') }, { needsContext: 'cupStandard', source: SRC.CUPS, ambiguity: 'Regional variant: teaspoon size depends on the cup standard (AU/UK 5 ml, US 4.929 ml); "t" can also mean tonne', formula: '1 tsp = 5 ml (Australian/UK) · 4.929 ml (US)' });
U('volume', 'tbsp', 'tablespoon', 'tablespoons', ['tbsp', 'T', 'Tbsp'], ['tablespoon', 'tablespoons'], 'other', { fn: cupFn('tbspMl') }, { needsContext: 'cupStandard', source: SRC.CUPS, ambiguity: 'Regional variant: Australian tablespoon is 20 ml, UK/metric 15 ml, US 14.787 ml', formula: '1 tbsp = 20 ml (Australian) · 15 ml (UK/metric) · 14.787 ml (US)' });
U('volume', 'cup', 'cup', 'cups', ['cup'], ['cup', 'cups'], 'other', { fn: cupFn('cupMl') }, { needsContext: 'cupStandard', source: SRC.CUPS, ambiguity: 'Regional variant: cup size depends on the cup standard (AU/UK 250 ml, US 236.588 ml)', formula: '1 cup = 250 ml (Australian/UK) · 236.588 ml (US)' });
U('volume', 'floz_us', 'fluid ounce (US)', 'fluid ounces (US)', ['fl oz (US)', 'US fl oz'], ['us fluid ounce', 'us fluid ounces', 'american fluid ounce', 'us fl oz'], 'us', 3.785411784 / 128, { variant: 'us', source: SRC.NIST, generic: 'floz', ambiguity: 'US and imperial fluid ounces differ (29.574 ml vs 28.413 ml)' });
U('volume', 'pint_us', 'pint (US)', 'pints (US)', ['pt (US)', 'US pt'], ['us pint', 'us pints', 'american pint'], 'us', 3.785411784 / 8, { variant: 'us', source: SRC.NIST, generic: 'pint', ambiguity: 'US pint (473 ml) ≠ imperial pint (568 ml)' });
U('volume', 'quart_us', 'quart (US)', 'quarts (US)', ['qt (US)', 'US qt'], ['us quart', 'us quarts', 'american quart'], 'us', 3.785411784 / 4, { variant: 'us', source: SRC.NIST, generic: 'quart', ambiguity: 'US quart (946 ml) ≠ imperial quart (1.137 L)' });
U('volume', 'gallon_us', 'gallon (US)', 'gallons (US)', ['gal (US)', 'US gal'], ['us gallon', 'us gallons', 'american gallon'], 'us', 3.785411784, { variant: 'us', source: SRC.NIST, generic: 'gallon', ex: 5, ambiguity: 'US gallon (3.785 L) ≠ imperial gallon (4.546 L)' });
U('volume', 'floz_imp', 'fluid ounce (imperial)', 'fluid ounces (imperial)', ['fl oz (imp)', 'imp fl oz'], ['imperial fluid ounce', 'imperial fluid ounces', 'uk fluid ounce', 'uk fluid ounces', 'imperial fl oz', 'fluid ounce', 'fluid ounces', 'fl oz'], 'imperial', 4.54609 / 160, { variant: 'imperial', source: SRC.UKWM, generic: 'floz', ambiguity: 'US and imperial fluid ounces differ (29.574 ml vs 28.413 ml)' });
U('volume', 'pint_imp', 'pint (imperial)', 'pints (imperial)', ['pt (imp)', 'imp pt'], ['imperial pint', 'imperial pints', 'uk pint', 'uk pints', 'pint', 'pints'], 'imperial', 4.54609 / 8, { variant: 'imperial', source: SRC.UKWM, generic: 'pint', ambiguity: 'US pint (473 ml) ≠ imperial pint (568 ml)' });
U('volume', 'quart_imp', 'quart (imperial)', 'quarts (imperial)', ['qt (imp)', 'imp qt'], ['imperial quart', 'imperial quarts', 'uk quart', 'quart', 'quarts'], 'imperial', 4.54609 / 4, { variant: 'imperial', source: SRC.UKWM, generic: 'quart', ambiguity: 'US quart (946 ml) ≠ imperial quart (1.137 L)' });
U('volume', 'gallon_imp', 'gallon (imperial)', 'gallons (imperial)', ['gal (imp)', 'imp gal'], ['imperial gallon', 'imperial gallons', 'uk gallon', 'uk gallons', 'gallon', 'gallons'], 'imperial', 4.54609, { variant: 'imperial', source: SRC.UKWM, generic: 'gallon', ex: 5, ambiguity: 'US gallon (3.785 L) ≠ imperial gallon (4.546 L)' });
U('volume', 'in3', 'cubic inch', 'cubic inches', ['in³', 'cu in'], ['cubic inch', 'cubic inches'], 'imperial', 0.016387064, { alsoUS: true, source: SRC.YARD });
U('volume', 'ft3', 'cubic foot', 'cubic feet', ['ft³', 'cu ft'], ['cubic foot', 'cubic feet'], 'imperial', 28.316846592, { alsoUS: true, source: SRC.YARD });

// Mass (base kg)
U('mass', 'milligram', 'milligram', 'milligrams', ['mg'], ['milligram', 'milligrams'], 'metric', 1e-6);
U('mass', 'gram', 'gram', 'grams', ['g'], ['gram', 'grams', 'gramme', 'grammes'], 'metric', 0.001, { ex: 500 });
U('mass', 'kilogram', 'kilogram', 'kilograms', ['kg'], ['kilogram', 'kilograms', 'kilo', 'kilos', 'kilogramme', 'kilogrammes'], 'metric', 1, { ex: 75 });
U('mass', 'tonne', 'tonne', 'tonnes', ['t', 'tonne'], ['tonne', 'tonnes', 'metric ton', 'metric tons'], 'metric', 1000, { ambiguity: '"t" can mean tonne or teaspoon; "T" can mean tablespoon or tonne' });
U('mass', 'ounce', 'ounce', 'ounces', ['oz'], ['ounce', 'ounces'], 'imperial', 0.028349523125, { alsoUS: true, source: SRC.YARD, ambiguity: '"oz" can be weight or fluid ounces' });
U('mass', 'pound', 'pound', 'pounds', ['lb', 'lbs'], ['pound', 'pounds', 'lb', 'lbs'], 'imperial', 0.45359237, { alsoUS: true, source: SRC.YARD, ex: 150 });
U('mass', 'stone', 'stone', 'stone', ['st'], ['stone', 'stones'], 'imperial', 6.35029318, { source: 'Defined as 14 avoirdupois pounds (International yard and pound agreement, 1959)' });
U('mass', 'shortton', 'short ton (US)', 'short tons (US)', ['short ton'], ['short ton', 'short tons', 'us ton', 'us tons'], 'us', 907.18474, { variant: 'us', source: 'Defined as 2000 lb', generic: 'ton' });
U('mass', 'longton', 'long ton (imperial)', 'long tons (imperial)', ['long ton'], ['long ton', 'long tons', 'imperial ton', 'imperial tons', 'uk ton'], 'imperial', 1016.0469088, { variant: 'imperial', source: 'Defined as 2240 lb', generic: 'ton' });
U('mass', 'stlb', 'stones + pounds', 'stones + pounds', [], ['stone and pounds', 'stones and pounds', 'stone pounds'], 'imperial', { compound: ['stone', 'pound'] }, { source: SRC.YARD });

// Temperature (base K). base = v*scale + offset
U('temperature', 'celsius', 'degree Celsius', 'degrees Celsius', ['°C', '℃', 'ºC', 'C'], ['degrees celsius', 'degree celsius', 'celsius', 'centigrade', 'degrees centigrade', 'deg c', 'degrees c'], 'metric', { scale: 1, offset: 273.15 }, { source: SRC.TEMP, ex: 25, formula: '°F = °C × 9/5 + 32 · K = °C + 273.15', example: '25 °C = 77 °F = 298.15 K', ambiguity: 'A bare "C" is assumed to mean Celsius' });
U('temperature', 'fahrenheit', 'degree Fahrenheit', 'degrees Fahrenheit', ['°F', '℉', 'ºF', 'F'], ['degrees fahrenheit', 'degree fahrenheit', 'fahrenheit', 'deg f', 'degrees f'], 'us', { scale: 5 / 9, offset: 273.15 - (32 * 5) / 9 }, { source: SRC.TEMP, ex: 350, formula: '°C = (°F − 32) × 5/9', example: '350 °F = 176.67 °C', ambiguity: 'A bare "F" is assumed to mean Fahrenheit' });
U('temperature', 'kelvin', 'kelvin', 'kelvin', ['K'], ['kelvin', 'kelvins'], 'metric', { scale: 1, offset: 0 }, { source: SRC.TEMP, ex: 300, formula: '°C = K − 273.15', ambiguity: '"K" can also mean thousand (kilo)' });
U('temperature', 'gasmark', 'gas mark', 'gas marks', [], ['gas mark', 'gas marks', 'gas'], 'other', { lookup: GAS_MARKS }, { source: SRC.GAS, ex: 4, formula: 'Lookup table (no formula): ¼=110, ½=120, 1=140, 2=150, 3=170, 4=180, 5=190, 6=200, 7=220, 8=230, 9=240 °C', example: 'Gas mark 4 = 180 °C = 356 °F', note: 'Converting a temperature to gas mark picks the nearest mark.' });

// Speed (base m/s)
U('speed', 'ms', 'metre per second', 'metres per second', ['m/s'], ['metres per second', 'meters per second', 'metre per second', 'meter per second'], 'metric', 1);
U('speed', 'kmh', 'kilometre per hour', 'kilometres per hour', ['km/h', 'kph', 'kmh', 'km/hr'], ['kilometres per hour', 'kilometers per hour', 'kilometre per hour', 'kilometer per hour', 'kph'], 'metric', 1 / 3.6, { ex: 100, formula: '1 km/h = 1/3.6 m/s' });
U('speed', 'mph', 'mile per hour', 'miles per hour', ['mph'], ['miles per hour', 'mile per hour', 'mph'], 'imperial', 0.44704, { alsoUS: true, source: SRC.YARD, ex: 60 });
U('speed', 'knot', 'knot', 'knots', ['kn', 'kt', 'kts'], ['knot', 'knots'], 'other', 1852 / 3600, { source: SRC.NMI, ex: 10, formula: '1 kn = 1852/3600 m/s (1 nautical mile per hour)' });
U('speed', 'fts', 'foot per second', 'feet per second', ['ft/s', 'fps'], ['feet per second', 'foot per second'], 'imperial', 0.3048, { alsoUS: true, source: SRC.YARD });

// Time (base s)
U('time', 'second', 'second', 'seconds', ['s', 'sec', 'secs'], ['second', 'seconds'], 'metric', 1);
U('time', 'minute', 'minute', 'minutes', ['min', 'mins'], ['minute', 'minutes'], 'other', 60, { ex: 90 });
U('time', 'hour', 'hour', 'hours', ['h', 'hr', 'hrs'], ['hour', 'hours'], 'other', 3600);
U('time', 'day', 'day', 'days', [], ['day', 'days'], 'other', 86400);
U('time', 'week', 'week', 'weeks', ['wk'], ['week', 'weeks'], 'other', 604800);
U('time', 'year', 'year', 'years', ['yr'], ['year', 'years'], 'other', 31557600, { source: SRC.JULIAN, formula: '1 year = 365.25 days = 31 557 600 s (Julian year)' });
U('time', 'hmin', 'hours + minutes', 'hours + minutes', [], ['hours and minutes', 'hours minutes'], 'other', { compound: ['hour', 'minute'] }, { source: SRC.ISO });

// Pressure (base Pa)
U('pressure', 'pascal', 'pascal', 'pascals', ['Pa'], ['pascal', 'pascals'], 'metric', 1);
U('pressure', 'kilopascal', 'kilopascal', 'kilopascals', ['kPa'], ['kilopascal', 'kilopascals'], 'metric', 1000, { ex: 200 });
U('pressure', 'bar', 'bar', 'bar', ['bar'], ['bar', 'bars'], 'metric', 100000, { source: SRC.ISO });
U('pressure', 'psi', 'pound per square inch', 'pounds per square inch', ['psi'], ['psi', 'pounds per square inch', 'pound per square inch'], 'imperial', 6894.757293168, { alsoUS: true, source: SRC.NIST811, ex: 32 });
U('pressure', 'atm', 'standard atmosphere', 'standard atmospheres', ['atm'], ['atmosphere', 'atmospheres', 'standard atmosphere', 'atm'], 'other', 101325, { source: 'Defined as exactly 101 325 Pa (CGPM 1954)' });
U('pressure', 'mmhg', 'millimetre of mercury', 'millimetres of mercury', ['mmHg'], ['millimetres of mercury', 'millimeters of mercury', 'mm of mercury', 'mmhg'], 'other', 133.322387415, { source: 'Conventional value 133.322387415 Pa (NIST SP 811)', ex: 120 });

// Energy (base J)
U('energy', 'joule', 'joule', 'joules', ['J'], ['joule', 'joules'], 'metric', 1);
U('energy', 'kilojoule', 'kilojoule', 'kilojoules', ['kJ'], ['kilojoule', 'kilojoules'], 'metric', 1000, { ex: 500 });
U('energy', 'kcal', 'kilocalorie', 'kilocalories', ['kcal', 'Cal'], ['kilocalorie', 'kilocalories', 'calorie', 'calories', 'food calorie', 'food calories'], 'other', 4184, { source: 'Thermochemical calorie: 1 cal = 4.184 J exactly (NIST SP 811)', ex: 100 });
U('energy', 'kwh', 'kilowatt hour', 'kilowatt hours', ['kWh'], ['kilowatt hour', 'kilowatt hours', 'kwh'], 'metric', 3.6e6, { source: SRC.ISO, formula: '1 kWh = 3 600 000 J' });
U('energy', 'btu', 'British thermal unit', 'British thermal units', ['BTU', 'Btu'], ['btu', 'btus', 'british thermal unit', 'british thermal units'], 'imperial', 1055.05585262, { alsoUS: true, source: 'International Table BTU: 1 BTU = 1055.05585262 J (ISO 31-4 / NIST SP 811)', ex: 12000 });

// Power (base W)
U('power', 'watt', 'watt', 'watts', ['W'], ['watt', 'watts'], 'metric', 1);
U('power', 'kilowatt', 'kilowatt', 'kilowatts', ['kW'], ['kilowatt', 'kilowatts'], 'metric', 1000, { ex: 5 });
U('power', 'hp', 'horsepower (mechanical)', 'horsepower (mechanical)', ['hp'], ['horsepower', 'mechanical horsepower', 'hp'], 'imperial', 745.69987158227022, { alsoUS: true, source: 'Mechanical horsepower = 550 ft·lbf/s = 745.699 871 582 W (NIST SP 811)', ex: 100, note: 'Metric horsepower (PS) is 735.499 W and is not the same.' });

// Data size (base byte)
const dataSrc = SRC.IEC;
U('data', 'bit', 'bit', 'bits', ['bit', 'bits'], ['bit', 'bits'], 'other', 0.125, { source: dataSrc });
U('data', 'byte', 'byte', 'bytes', ['B'], ['byte', 'bytes'], 'other', 1, { source: dataSrc });
U('data', 'kb', 'kilobyte (decimal)', 'kilobytes (decimal)', ['KB', 'kB'], ['kilobyte', 'kilobytes'], 'metric', 1e3, { source: dataSrc, variant: 'decimal', ambiguity: '"KB" is sometimes used for 1024 bytes; here KB = 1000 B and KiB = 1024 B' });
U('data', 'mb', 'megabyte (decimal)', 'megabytes (decimal)', ['MB'], ['megabyte', 'megabytes'], 'metric', 1e6, { source: dataSrc, variant: 'decimal', ambiguity: '"MB" is sometimes used for 1024² bytes; here MB = 10⁶ B and MiB = 2²⁰ B' });
U('data', 'gb', 'gigabyte (decimal)', 'gigabytes (decimal)', ['GB'], ['gigabyte', 'gigabytes'], 'metric', 1e9, { source: dataSrc, variant: 'decimal', ex: 128, ambiguity: '"GB" is sometimes used for 1024³ bytes; here GB = 10⁹ B and GiB = 2³⁰ B' });
U('data', 'tb', 'terabyte (decimal)', 'terabytes (decimal)', ['TB'], ['terabyte', 'terabytes'], 'metric', 1e12, { source: dataSrc, variant: 'decimal', ambiguity: '"TB" is sometimes used for 1024⁴ bytes; here TB = 10¹² B and TiB = 2⁴⁰ B' });
U('data', 'kib', 'kibibyte (binary)', 'kibibytes (binary)', ['KiB'], ['kibibyte', 'kibibytes'], 'other', 1024, { source: dataSrc, variant: 'binary' });
U('data', 'mib', 'mebibyte (binary)', 'mebibytes (binary)', ['MiB'], ['mebibyte', 'mebibytes'], 'other', 1024 ** 2, { source: dataSrc, variant: 'binary' });
U('data', 'gib', 'gibibyte (binary)', 'gibibytes (binary)', ['GiB'], ['gibibyte', 'gibibytes'], 'other', 1024 ** 3, { source: dataSrc, variant: 'binary' });
U('data', 'tib', 'tebibyte (binary)', 'tebibytes (binary)', ['TiB'], ['tebibyte', 'tebibytes'], 'other', 1024 ** 4, { source: dataSrc, variant: 'binary' });

// Data rate (base bit/s)
U('datarate', 'bps', 'bit per second', 'bits per second', ['bps', 'bit/s'], ['bits per second', 'bit per second'], 'other', 1, { source: dataSrc });
U('datarate', 'kbps', 'kilobit per second', 'kilobits per second', ['kbps', 'Kbps'], ['kilobits per second', 'kilobit per second'], 'other', 1e3, { source: dataSrc });
U('datarate', 'mbps', 'megabit per second', 'megabits per second', ['Mbps', 'Mb/s'], ['megabits per second', 'megabit per second', 'mbps'], 'other', 1e6, { source: dataSrc, ex: 100 });
U('datarate', 'gbps', 'gigabit per second', 'gigabits per second', ['Gbps', 'Gb/s'], ['gigabits per second', 'gigabit per second', 'gbps'], 'other', 1e9, { source: dataSrc });
U('datarate', 'bytes', 'byte per second', 'bytes per second', ['B/s'], ['bytes per second', 'byte per second'], 'other', 8, { source: dataSrc });
U('datarate', 'kbytes', 'kilobyte per second', 'kilobytes per second', ['KB/s', 'kB/s'], ['kilobytes per second', 'kilobyte per second'], 'other', 8e3, { source: dataSrc });
U('datarate', 'mbytes', 'megabyte per second', 'megabytes per second', ['MB/s'], ['megabytes per second', 'megabyte per second'], 'other', 8e6, { source: dataSrc });
U('datarate', 'gbytes', 'gigabyte per second', 'gigabytes per second', ['GB/s'], ['gigabytes per second', 'gigabyte per second'], 'other', 8e9, { source: dataSrc });

// Angle (base radian)
U('angle', 'degree', 'degree', 'degrees', ['°', 'deg'], ['degree', 'degrees'], 'other', Math.PI / 180, { source: SRC.SI, ex: 90, formula: '1° = π/180 rad', ambiguity: 'A bare ° could be an angle or a temperature' });
U('angle', 'radian', 'radian', 'radians', ['rad'], ['radian', 'radians'], 'other', 1, { source: SRC.SI });
U('angle', 'gradian', 'gradian', 'gradians', ['grad', 'gon'], ['gradian', 'gradians', 'gon'], 'other', Math.PI / 200, { source: SRC.ISO, formula: '1 grad = π/200 rad (400 grad = full circle)' });
U('angle', 'arcminute', 'arcminute', 'arcminutes', [], [], 'other', Math.PI / 10800, { hidden: true });
U('angle', 'arcsecond', 'arcsecond', 'arcseconds', [], [], 'other', Math.PI / 648000, { hidden: true });
U('angle', 'dms', 'degrees ° ′ ″', 'degrees ° ′ ″', [], ['degrees minutes seconds', 'd m s'], 'other', { compound: ['degree', 'arcminute', 'arcsecond'] }, { source: SRC.ISO });

// Fuel economy (base L/100 km) — reciprocal relationships
U('fuel', 'l100', 'litres per 100 km', 'litres per 100 km', ['L/100km', 'L/100 km', 'l/100km'], ['litres per 100 kilometres', 'liters per 100 kilometers', 'litres per hundred kilometres', 'l per 100 km'], 'metric', 1, { source: SRC.FUEL, ex: 8, formula: 'mpg (US) = 235.214583 ÷ (L/100 km) · km/L = 100 ÷ (L/100 km)' });
U('fuel', 'kml', 'kilometres per litre', 'kilometres per litre', ['km/L', 'km/l'], ['kilometres per litre', 'kilometers per liter', 'km per litre'], 'metric', { inverse: 100 }, { source: SRC.FUEL, ex: 12, formula: 'L/100 km = 100 ÷ (km/L)' });
U('fuel', 'mpg_us', 'miles per gallon (US)', 'miles per gallon (US)', ['mpg (US)', 'US mpg'], ['us miles per gallon', 'us mpg', 'american miles per gallon'], 'us', { inverse: (100 * 3.785411784) / 1.609344 }, { variant: 'us', source: SRC.FUEL, ex: 30, generic: 'mpg', formula: 'L/100 km = 235.214583 ÷ mpg (US)', ambiguity: 'US mpg ≠ imperial mpg (US gallons are smaller)' });
U('fuel', 'mpg_imp', 'miles per gallon (imperial)', 'miles per gallon (imperial)', ['mpg (imp)', 'imp mpg'], ['imperial miles per gallon', 'imperial mpg', 'uk mpg', 'miles per gallon', 'mpg'], 'imperial', { inverse: (100 * 4.54609) / 1.609344 }, { variant: 'imperial', source: SRC.FUEL, ex: 40, generic: 'mpg', formula: 'L/100 km = 282.480936 ÷ mpg (imperial)', ambiguity: 'US mpg ≠ imperial mpg (US gallons are smaller)' });

// Cooking (base g) — volume ↔ weight needs an ingredient; spoons/cups follow the cup standard
const cookMl = (key) => (ctx) => (CUP_STANDARDS[ctx.cupStandard] || CUP_STANDARDS[DEFAULT_CUP_STANDARD])[key];
function cookVolume(mlFn) {
  return {
    custom: {
      toBase: (v, ctx) => {
        const ing = getIngredient(ctx?.ingredient);
        return ing ? v * mlFn(ctx || {}) * ing.gPerMl : NaN;
      },
      fromBase: (b, ctx) => {
        const ing = getIngredient(ctx?.ingredient);
        return ing ? b / (mlFn(ctx || {}) * ing.gPerMl) : NaN;
      },
    },
  };
}
const cookNeeds = { needsContext: 'ingredient', source: `${ING_SOURCE}; volumes per ${SRC.CUPS}`, formula: 'grams = volume (ml) × ingredient density (g/ml)', example: 'Plain flour: 1 cup (250 ml) = 150 g' };
U('cooking', 'ml', 'millilitre', 'millilitres', ['ml', 'mL'], ['millilitre', 'millilitres', 'milliliter', 'milliliters'], 'metric', cookVolume(() => 1), cookNeeds);
U('cooking', 'cup', 'cup', 'cups', [], ['cup', 'cups'], 'other', cookVolume(cookMl('cupMl')), cookNeeds);
U('cooking', 'tbsp', 'tablespoon', 'tablespoons', [], ['tablespoon', 'tablespoons'], 'other', cookVolume(cookMl('tbspMl')), cookNeeds);
U('cooking', 'tsp', 'teaspoon', 'teaspoons', [], ['teaspoon', 'teaspoons'], 'other', cookVolume(cookMl('tspMl')), cookNeeds);
U('cooking', 'g', 'gram', 'grams', ['g'], ['gram', 'grams'], 'metric', 1, { source: SRC.SI, ex: 150 });
U('cooking', 'kg', 'kilogram', 'kilograms', ['kg'], ['kilogram', 'kilograms', 'kilo', 'kilos'], 'metric', 1000, { source: SRC.SI });
U('cooking', 'oz', 'ounce (weight)', 'ounces (weight)', ['oz'], ['ounce', 'ounces'], 'imperial', 28.349523125, { alsoUS: true, source: SRC.YARD });
U('cooking', 'lb', 'pound', 'pounds', ['lb'], ['pound', 'pounds'], 'imperial', 453.59237, { alsoUS: true, source: SRC.YARD });

// Force (base N) / torque (base N·m)
U('force', 'newton', 'newton', 'newtons', ['N'], ['newton', 'newtons'], 'metric', 1);
U('force', 'kgf', 'kilogram-force', 'kilograms-force', ['kgf'], ['kilogram force', 'kilograms force', 'kgf'], 'other', 9.80665, { source: 'Standard gravity g₀ = 9.80665 m/s² (CGPM 1901)' });
U('force', 'lbf', 'pound-force', 'pounds-force', ['lbf'], ['pound force', 'pounds force', 'lbf'], 'imperial', 4.4482216152605, { alsoUS: true, source: SRC.NIST811 });
U('torque', 'nm', 'newton metre', 'newton metres', ['N·m', 'Nm', 'N m'], ['newton metre', 'newton metres', 'newton meter', 'newton meters'], 'metric', 1);
U('torque', 'kgfm', 'kilogram-force metre', 'kilogram-force metres', ['kgf·m', 'kgfm'], ['kilogram force metre', 'kilogram force metres'], 'other', 9.80665, { source: 'Standard gravity g₀ = 9.80665 m/s² (CGPM 1901)' });
U('torque', 'ftlb', 'foot pound-force', 'foot pounds-force', ['ft·lb', 'ft-lb', 'ft lb', 'ft·lbf', 'lb-ft', 'lb·ft'], ['foot pound', 'foot pounds', 'foot pound force', 'pound feet', 'pound foot'], 'imperial', 1.3558179483314004, { alsoUS: true, source: SRC.NIST811, ex: 80 });
U('torque', 'inlb', 'inch pound-force', 'inch pounds-force', ['in·lb', 'in-lb', 'in lb'], ['inch pound', 'inch pounds', 'inch pound force'], 'imperial', 0.1129848290276167, { alsoUS: true, source: SRC.NIST811 });

// Flow rate (base L/min)
U('flow', 'lmin', 'litre per minute', 'litres per minute', ['L/min', 'l/min', 'lpm'], ['litres per minute', 'liters per minute', 'litre per minute'], 'metric', 1);
U('flow', 'ls', 'litre per second', 'litres per second', ['L/s', 'l/s'], ['litres per second', 'liters per second', 'litre per second'], 'metric', 60);
U('flow', 'm3h', 'cubic metre per hour', 'cubic metres per hour', ['m³/h', 'm3/h'], ['cubic metres per hour', 'cubic meters per hour'], 'metric', 1000 / 60, { formula: '1 m³/h = 1000/60 L/min' });
U('flow', 'gpm_us', 'US gallon per minute', 'US gallons per minute', ['gpm (US)', 'US gpm'], ['us gallons per minute', 'us gpm', 'gallons per minute'], 'us', 3.785411784, { variant: 'us', source: SRC.NIST, generic: 'gpm', ambiguity: 'US gpm ≠ imperial gpm' });
U('flow', 'gpm_imp', 'imperial gallon per minute', 'imperial gallons per minute', ['gpm (imp)', 'imp gpm'], ['imperial gallons per minute', 'imperial gpm', 'uk gpm'], 'imperial', 4.54609, { variant: 'imperial', source: SRC.UKWM, generic: 'gpm', ambiguity: 'US gpm ≠ imperial gpm' });

// ── Derived text + lookups ────────────────────────────────────────────────────
const UNIT_BY_ID = Object.fromEntries(UNITS.map((u) => [u.id, u]));
const BASE_SYMBOL = {
  length: 'm', area: 'm²', volume: 'L', mass: 'kg', temperature: 'K', speed: 'm/s', time: 's', pressure: 'Pa',
  energy: 'J', power: 'W', data: 'B', datarate: 'bit/s', angle: 'rad', fuel: 'L/100 km', cooking: 'g', force: 'N',
  torque: 'N·m', flow: 'L/min',
};

export const getUnit = (id) => UNIT_BY_ID[id] || null;
export const getGroup = (id) => GROUP_BY_ID[id] || null;
export const unitsOfGroup = (groupId, { includeHidden = false } = {}) =>
  UNITS.filter((u) => u.group === groupId && (includeHidden || !u.hidden));
export const allUnits = () => UNITS.filter((u) => !u.hidden);
export const baseSymbol = (groupId) => BASE_SYMBOL[groupId] || '';
export const unitLabel = (u) => (u.symbols.find((s) => s && s.length > 0) && !u.variant ? `${u.name} (${u.symbols[0]})` : u.name);
export const unitShort = (u) => u.symbols[0] || u.name;

// Fill in generated formula / example text so every entry is complete.
for (const u of UNITS) {
  if (u.type === 'compound') {
    const names = u.parts.map((p) => UNIT_BY_ID[p].name).join(' + ');
    u.formulaText = u.formulaText || `Sum of parts: ${names}. Converted through ${GROUP_BY_ID[u.group].base}s.`;
    u.exampleText = u.exampleText || (u.id === 'length.ftin' ? '5 ft 11 in = 1.8034 m' : u.id === 'mass.stlb' ? '10 st 4 lb = 65.3173 kg' : u.id === 'time.hmin' ? '1 h 30 min = 1.5 h' : '45° 30′ 0″ = 45.5°');
    continue;
  }
  const bs = BASE_SYMBOL[u.group];
  if (!u.formulaText) {
    if (u.type === 'factor' && u.factor !== undefined) u.formulaText = defaultFormula(u, bs, u.factor);
    else if (u.type === 'inverse') u.formulaText = `${bs} = ${formatNumber(u.k, { mode: 'sig', n: 9 })} ÷ value`;
    else u.formulaText = '';
  }
  if (!u.exampleText) {
    try {
      const v = u.exampleValue;
      const ctx = { cupStandard: DEFAULT_CUP_STANDARD, ingredient: 'plain-flour' };
      const base = u.toBase(v, ctx);
      u.exampleText = `${formatNumber(v)} ${unitShort(u)} = ${formatNumber(base, { mode: 'sig', n: 8 })} ${bs}`;
    } catch (_) { u.exampleText = ''; }
  }
}

// Scanner target units per group and system, ordered smallest → largest.
export const SCAN_TARGETS = {
  length: { metric: ['millimetre', 'centimetre', 'metre', 'kilometre'], imperial: ['inch', 'foot', 'mile'] },
  area: { metric: ['cm2', 'm2', 'hectare', 'km2'], imperial: ['in2', 'ft2', 'acre', 'mi2'] },
  volume: { metric: ['millilitre', 'litre'], us: ['floz_us', 'cup', 'gallon_us'], imperial: ['floz_imp', 'pint_imp', 'gallon_imp'] },
  mass: { metric: ['gram', 'kilogram', 'tonne'], imperial: ['ounce', 'pound'] },
  temperature: { metric: ['celsius'], imperial: ['fahrenheit'] },
  speed: { metric: ['kmh'], imperial: ['mph'] },
  pressure: { metric: ['kilopascal'], imperial: ['psi'] },
  energy: { metric: ['kilojoule'], imperial: ['btu'] },
  power: { metric: ['kilowatt'], imperial: ['hp'] },
  fuel: { metric: ['l100'], us: ['mpg_us'], imperial: ['mpg_imp'] },
  force: { metric: ['newton'], imperial: ['lbf'] },
  torque: { metric: ['nm'], imperial: ['ftlb'] },
  flow: { metric: ['lmin'], us: ['gpm_us'], imperial: ['gpm_imp'] },
};

// Generic alias families (resolved by the user's US/imperial region choice).
export const GENERIC_FAMILIES = {
  gallon: { us: 'volume.gallon_us', imperial: 'volume.gallon_imp', words: ['gallon', 'gallons', 'gal'] },
  quart: { us: 'volume.quart_us', imperial: 'volume.quart_imp', words: ['quart', 'quarts', 'qt'] },
  pint: { us: 'volume.pint_us', imperial: 'volume.pint_imp', words: ['pint', 'pints', 'pt'] },
  floz: { us: 'volume.floz_us', imperial: 'volume.floz_imp', words: ['fl oz', 'fluid ounce', 'fluid ounces', 'floz'] },
  mpg: { us: 'fuel.mpg_us', imperial: 'fuel.mpg_imp', words: ['mpg', 'miles per gallon'] },
  gpm: { us: 'flow.gpm_us', imperial: 'flow.gpm_imp', words: ['gpm', 'gallons per minute'] },
  ton: { us: 'mass.shortton', imperial: 'mass.longton', words: ['ton', 'tons'] },
};

export function systemMatches(unit, targetSystem) {
  if (!unit) return false;
  if (unit.system === targetSystem) return true;
  if (targetSystem === 'us' && unit.alsoUS) return true;
  return false;
}
