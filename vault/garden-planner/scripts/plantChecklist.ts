// Writes the plant verification checklist: one row per plant, with the fields the checks and filters depend on, the draft values as
// currently held, and blank columns for whoever verifies them. It READS the dataset and never changes it.
//   cd garden-planner && npx vite-node scripts/plantChecklist.ts ../docs/plant-verification-checklist.csv
import { writeFileSync } from 'node:fs';
import { AU_STATES } from '../src/domain/types';
import { PLANTS, botanicalLabel } from '../src/plants/plants';

const out = process.argv[2] ?? 'plant-verification-checklist.csv';
const esc = (v: string | number): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Weed status per state. The dataset only records states a plant is LISTED in; absence is not evidence, so every other state is "unknown".
const weedCols = AU_STATES.map((s) => `weed_${s}_draft`);
const header = [
  'id', 'botanical_name', 'common_names', 'native', 'origin_states', 'type',
  'height_min_m', 'height_max_m', 'spread_min_m', 'spread_max_m', 'years_to_mature',
  'sun_tolerated', 'frost_tolerance_draft', 'climate_zones_draft', 'cautions_draft', 'pet_safe_flag_draft',
  ...weedCols,
  'size_verified (Y/N)', 'sun_verified (Y/N)', 'frost_verified (Y/N)', 'zones_verified (Y/N)', 'weed_verified_all_states (Y/N)',
  'weed_list_sources_checked', 'horticultural_source_url', 'verified_by', 'verified_on', 'corrections_needed',
];

const rows = PLANTS.map((p) => [
  p.id, botanicalLabel(p), p.common.join('; '), p.native ? 'yes' : 'no', p.origin.join(' '), p.type,
  p.height[0], p.height[1], p.spread[0], p.spread[1], p.yearsToMature,
  p.sun.join(' / '), p.frost, p.zones.join(' / '), p.cautions.join(' / '), p.features.includes('pet_safe') ? 'marked pet-safe' : 'not marked',
  ...AU_STATES.map((s) => (p.weedStates.includes(s) ? 'LISTED (draft, unverified)' : 'unknown')),
  '', '', '', '', '', '', '', '', '', '',
]);

writeFileSync(out, `﻿${[header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')}\r\n`, 'utf8');
console.log(`wrote ${rows.length} plants to ${out}`);
