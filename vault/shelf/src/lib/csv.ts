// Reads delimited text (CSV, TSV, semicolon or pipe separated) into a grid for the table preview. Quote-aware: "a, b" stays one cell and ""
// inside quotes is a quote. Never evaluates anything; a cell is just text.

export type Delimiter = ',' | '\t' | ';' | '|';
export const MAX_ROWS = 200;
export const MAX_COLS = 30;

export function parseDelimited(text: string, delimiter: Delimiter, maxRows = MAX_ROWS): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  const pushCell = () => { row.push(cell); cell = ''; };
  const pushRow = () => { pushCell(); rows.push(row); row = []; };
  while (i < text.length) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { inQuotes = true; i++; continue; }
    if (ch === delimiter) { pushCell(); i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { pushRow(); i++; if (rows.length >= maxRows) return rows; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length > 0) pushRow();
  return rows;
}

const SEPARATOR_ROW = /^\s*\|?[\s:|-]+\|?\s*$/; // a markdown table's |---|---| line

/**
 * Is this text a table? Returns the delimiter and the grid, or null. Deliberately cautious: prose with a few commas must not become a table, so
 * every row needs the same number of columns (at least 2), few cells may be empty, and cells must be short. `partial` says the text was cut
 * off (a card preview), so a half-read last row is ignored.
 */
export function detectTable(text: string, partial = false): { delimiter: Delimiter; rows: string[][] } | null {
  let lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
  if (partial && lines.length > 1) lines = lines.slice(0, -1);
  if (lines.length < 2 || lines.length > 5000) return null;
  const candidates: Delimiter[] = ['\t', '|', ';', ','];
  for (const d of candidates) {
    if (!lines.every((l) => l.includes(d) || SEPARATOR_ROW.test(l))) continue;
    const body = d === '|' ? lines.filter((l) => !SEPARATOR_ROW.test(l)).map((l) => l.trim().replace(/^\||\|$/g, '')) : lines;
    if (body.length < 2) continue;
    let rows = parseDelimited(body.join('\n'), d);
    if (d === '|') rows = rows.map((r) => r.map((c) => c.trim())); // markdown pads its cells: | Item | Qty |
    const width = rows[0]?.length ?? 0;
    if (width < 2 || width > MAX_COLS) continue;
    if (!rows.every((r) => r.length === width)) continue;
    const cells = rows.flat();
    const empty = cells.filter((c) => c.trim() === '').length;
    if (empty / cells.length > 0.2) continue;
    if (cells.some((c) => c.length > 120)) continue;
    // a comma list across lines of ordinary sentences is prose, not data: tabs and pipes are intentional, commas must look like fields
    if (d === ',' && cells.filter((c) => /\s{2,}|[.!?]$/.test(c.trim())).length / cells.length > 0.3) continue;
    return { delimiter: d, rows };
  }
  return null;
}
