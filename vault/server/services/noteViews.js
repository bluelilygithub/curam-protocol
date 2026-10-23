'use strict';

// Saved views on Notes: a name for a combination of search, date range, project, client, tags and grouping, so one tap brings it
// back. The server is the one place that decides what a saved view may contain: whatever the browser sends is cut down to exactly
// these fields with known values, so a view can never hold anything else. Unit-tested: node server/services/noteViews.test.js

const { normalizeTags } = require('./noteTags');
const { validDay } = require('./noteDaily');

const PRESETS = ['all', 'today', '7d', '30d', 'year', 'custom'];
const GROUP_MODES = ['date', 'project', 'client', 'tag'];
const DATE_FIELDS = ['updated', 'created'];
const REMINDERS = ['', 'any', 'due', 'upcoming']; // '' = not filtered by reminder
const FILES = ['', 'with', 'without']; // '' = not filtered by attached files
const MAX_NAME = 40;
const MAX_SEARCH = 200;
const MAX_VIEWS = 30;

/** The view's filters made safe: every field present, known values only. Returns null if `input` is not an object. */
function normalizeFilters(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const preset = PRESETS.includes(input.preset) ? input.preset : 'all';
  const custom = preset === 'custom'
    ? { from: validDay(input.custom?.from) || '', to: validDay(input.custom?.to) || '' }
    : { from: '', to: '' };
  const id = (v) => (/^\d{1,9}$/.test(String(v ?? '')) ? String(Number(v)) : '');
  return {
    search: typeof input.search === 'string' ? input.search.trim().slice(0, MAX_SEARCH) : '',
    preset,
    custom,
    field: DATE_FIELDS.includes(input.field) ? input.field : 'updated',
    projectId: id(input.projectId),
    clientId: id(input.clientId),
    tags: normalizeTags(input.tags) || [],
    reminder: REMINDERS.includes(input.reminder) ? input.reminder : '',
    files: FILES.includes(input.files) ? input.files : '',
    groupMode: GROUP_MODES.includes(input.groupMode) ? input.groupMode : 'date',
  };
}

/** A view's name: trimmed, one space between words, at most 40 characters. '' when nothing is left. */
function normalizeName(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim() : '';
}

module.exports = { PRESETS, GROUP_MODES, DATE_FIELDS, REMINDERS, FILES, MAX_NAME, MAX_SEARCH, MAX_VIEWS, normalizeFilters, normalizeName };
