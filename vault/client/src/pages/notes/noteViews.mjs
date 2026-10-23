// Saved views on Notes: pure helpers for comparing the current filters with a saved view and describing a view in words.
// What a saved view may contain is decided by the server (server/services/noteViews.js); this only reads and compares.
// Unit-tested: node client/src/pages/notes/noteViews.test.mjs

import { DATE_PRESETS, GROUP_MODES } from './noteGroups.mjs';

export const DEFAULT_FILTERS = {
  search: '', preset: 'all', custom: { from: '', to: '' }, field: 'updated', projectId: '', clientId: '', tags: [], groupMode: 'date',
};

/** The filters in one fixed shape, so two of them can be compared: trimmed search, dates only for "Pick dates", tags sorted. */
export function snapshot(f) {
  const x = f || {};
  const preset = DATE_PRESETS.some((p) => p.id === x.preset) ? x.preset : 'all';
  return {
    search: String(x.search || '').trim(),
    preset,
    custom: preset === 'custom' ? { from: x.custom?.from || '', to: x.custom?.to || '' } : { from: '', to: '' },
    field: x.field === 'created' ? 'created' : 'updated',
    projectId: x.projectId ? String(x.projectId) : '',
    clientId: x.clientId ? String(x.clientId) : '',
    tags: [...new Set(Array.isArray(x.tags) ? x.tags : [])].sort(),
    groupMode: GROUP_MODES.some((m) => m.id === x.groupMode) ? x.groupMode : 'date',
  };
}

export const sameFilters = (a, b) => JSON.stringify(snapshot(a)) === JSON.stringify(snapshot(b));

/** True when nothing is filtered and the grouping is the plain default. */
export const isPlain = (f) => sameFilters(f, DEFAULT_FILTERS);

/** A view in words: "30 days · tagged budget + q3 · Acme · grouped by tag". `names` gives { projectName, clientName } for the ids. */
export function describeFilters(filters, names = {}) {
  const f = snapshot(filters);
  const parts = [];
  if (f.search) parts.push(`"${f.search}"`);
  if (f.preset === 'custom') {
    const { from, to } = f.custom;
    if (from || to) parts.push(from && to ? `${from} to ${to}` : from ? `from ${from}` : `up to ${to}`);
  } else if (f.preset !== 'all') {
    parts.push(DATE_PRESETS.find((p) => p.id === f.preset).label.toLowerCase());
  }
  if (f.preset !== 'all' && f.field === 'created') parts.push('by created date');
  if (f.tags.length) parts.push(`tagged ${f.tags.join(' + ')}`);
  if (f.projectId) parts.push(names.projectName || 'a project');
  if (f.clientId) parts.push(names.clientName || 'a client');
  if (f.groupMode !== 'date') parts.push(`grouped by ${GROUP_MODES.find((m) => m.id === f.groupMode).label.toLowerCase()}`);
  return parts.length ? parts.join(' · ') : 'Every note, newest first';
}
