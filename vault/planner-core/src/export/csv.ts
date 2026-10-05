// CSV and file-saving helpers shared by the planners' schedules (Room Planner's furniture schedule, Garden Planner's plant schedule).
// Moved here from room-planner/src/schedule/schedule.ts so the two cannot drift apart: the spreadsheet-formula guard in particular must be the
// same everywhere, because notes and names are typed by people.

/** A spreadsheet runs text that starts with = + - @ as a formula; a leading apostrophe keeps it as plain text. */
export function safeCell(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** One CSV field: quoted when it holds a comma, quote or line break, quotes doubled (RFC 4180). */
export function csvField(v: string | number | undefined): string {
  const s = v === undefined ? '' : typeof v === 'number' ? String(v) : safeCell(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows of cells as CSV text, one record per line (CRLF, as spreadsheets expect), with a trailing line break. */
export function csvText(rows: ReadonlyArray<ReadonlyArray<string | number | undefined>>): string {
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

/** Blob parts for a CSV file with a UTF-8 byte-order mark, which makes Excel read accents and symbols correctly. */
export const csvBlobParts = (text: string): string[] => ['﻿', text];

/** A file name stem from free text: accents dropped, lower case, dashes, at most 40 characters. */
export const slug = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** Offer a blob to the person as a download. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
