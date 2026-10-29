import { useEffect, useMemo, useState } from 'react';
import type { CodeLanguage } from '../lib/classify';
import { classifyText } from '../lib/classify';
import { MAX_ROWS } from '../lib/csv';
import { hexToRgba, hslText, rgbText } from '../lib/color';
import { highlightCode } from '../lib/highlight';
import { htmlPreviewDocument, sanitizeHtml, sanitizeSvg, svgBlobUrl } from '../lib/sanitize';
import type { RedactFinding } from '../bridge/types';
import Icon from './Icon';

export const MAX_SHOWN_CHARS = 50000;
const LANGUAGE_NAMES: Record<CodeLanguage, string> = { javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', sql: 'SQL', json: 'JSON', css: 'CSS', xml: 'HTML / XML' };

const shown = (t: string) => (t.length > MAX_SHOWN_CHARS ? t.slice(0, MAX_SHOWN_CHARS) : t);
const Cut = ({ text }: { text: string }) => (text.length > MAX_SHOWN_CHARS ? <p className="text-xs text-shelf-muted mt-2">Showing the first {MAX_SHOWN_CHARS.toLocaleString('en-AU')} characters. Copy gives you all of it.</p> : null);

export function PlainText({ text }: { text: string }) {
  return (
    <div className="h-full overflow-auto">
      <pre className="m-0 whitespace-pre-wrap break-words text-[13px] leading-[1.5] font-sans text-shelf-text">{shown(text)}</pre>
      <Cut text={text} />
    </div>
  );
}

export function CodeView({ text, language }: { text: string; language: CodeLanguage | undefined }) {
  // highlight.js escapes the code itself; the result is only spans of class names
  const html = useMemo(() => highlightCode(shown(text), language), [text, language]);
  return (
    <div className="h-full flex flex-col min-h-0">
      {language && <div className="text-[11px] text-shelf-muted mb-1.5 font-medium">{LANGUAGE_NAMES[language]}</div>}
      <div className="flex-1 min-h-0 overflow-auto rounded-card bg-shelf-text/[0.045] border border-shelf-line/10 p-3">
        <pre className="m-0 font-mono text-[12.5px] leading-[1.5] text-shelf-text whitespace-pre"><code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /></pre>
      </div>
      <Cut text={text} />
    </div>
  );
}

const NUMERIC = /^[-+$€£]?\s*[\d,]+(?:\.\d+)?%?$/;

export function TableView({ rows, capped }: { rows: string[][]; capped: boolean }) {
  const header = rows[0] && rows[0].every((c) => c.trim() !== '' && !NUMERIC.test(c.trim())) && rows.length > 1;
  const body = header ? rows.slice(1) : rows;
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="text-[11px] text-shelf-muted mb-1.5">{capped ? `First ${rows.length} rows` : `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`} × {rows[0]?.length ?? 0} columns</div>
      <div className="flex-1 min-h-0 overflow-auto rounded-card border border-shelf-line/10">
        <table className="w-full text-[12.5px] border-collapse">
          {header && (
            <thead className="sticky top-0 bg-shelf-card">
              <tr>{(rows[0] ?? []).map((c, i) => <th key={i} className="text-left font-semibold px-2.5 py-1.5 border-b border-shelf-line/15 whitespace-nowrap">{c}</th>)}</tr>
            </thead>
          )}
          <tbody>
            {body.map((r, i) => (
              <tr key={i} className={i % 2 ? 'bg-shelf-text/[0.03]' : ''}>
                {r.map((c, j) => <td key={j} className={`px-2.5 py-1 border-b border-shelf-line/10 ${NUMERIC.test(c.trim()) ? 'text-right tabular-nums' : ''}`}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ColorView({ color }: { color: string }) {
  const rgba = hexToRgba(color);
  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex-1 min-h-[80px] rounded-card border border-shelf-line/15" style={{ backgroundImage: 'conic-gradient(#0002 25%, #0000 0 50%, #0002 0 75%, #0000 0)', backgroundSize: '16px 16px' }}>
        <div className="w-full h-full rounded-card" style={{ background: color }} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px] font-mono">
        <dt className="text-shelf-muted">HEX</dt><dd className="m-0 select-all">{color}</dd>
        {rgba && <><dt className="text-shelf-muted">RGB</dt><dd className="m-0 select-all">{rgbText(rgba)}</dd><dt className="text-shelf-muted">HSL</dt><dd className="m-0 select-all">{hslText(rgba)}</dd></>}
      </dl>
    </div>
  );
}

export function LinkView({ url }: { url: string }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-shelf-muted font-medium">Link (shown, not opened)</div>
      <div className="rounded-card border border-shelf-line/10 bg-shelf-text/[0.045] p-3 font-mono text-[12.5px] break-all select-all text-shelf-accent">{url}</div>
    </div>
  );
}

export function ImageView({ src, caption }: { src: string; caption?: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 min-h-0">
      <img src={src} alt="" style={{ maxWidth: 300 }} className="max-h-full w-auto rounded-card border border-shelf-line/15 bg-[repeating-conic-gradient(#0001_0_25%,#0000_0_50%)] [background-size:14px_14px] object-contain" draggable={false} />
      {caption && <span className="text-[11px] text-shelf-muted">{caption}</span>}
    </div>
  );
}

/** An SVG, cleaned and then shown as a picture from a blob: address (the browser refuses to run script or load anything for a picture). */
export function SvgView({ svg }: { svg: string }) {
  const [state, setState] = useState<{ url: string | null; changed: boolean } | null>(null);
  useEffect(() => {
    const clean = sanitizeSvg(svg);
    if (!clean) { setState({ url: null, changed: true }); return undefined; }
    const url = svgBlobUrl(clean);
    setState({ url, changed: clean.replace(/\s+/g, '') !== svg.replace(/\s+/g, '') });
    return () => { URL.revokeObjectURL(url); }; // nothing lingers once the preview closes
  }, [svg]);
  if (!state) return null;
  if (!state.url) return <p className="text-sm text-shelf-muted">This drawing could not be shown safely. Copy still gives you the original text.</p>;
  return <ImageView src={state.url} caption={state.changed ? 'Unsafe parts were removed from this preview' : 'Vector drawing'} />;
}

/** HTML: cleaned, then shown inside a frame that cannot run script or reach the network. */
export function HtmlView({ html }: { html: string }) {
  const doc = useMemo(() => htmlPreviewDocument(sanitizeHtml(shown(html))), [html]);
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="text-[11px] text-shelf-muted mb-1.5">Web content, cleaned: no scripts, forms, links or remote pictures</div>
      <iframe title="HTML preview" sandbox="" referrerPolicy="no-referrer" srcDoc={doc} className="flex-1 min-h-0 w-full rounded-card border border-shelf-line/15 bg-white" />
    </div>
  );
}

/** The copied text with the sensitive-looking parts marked, and a count of what was found. */
export function RedactionView({ text, findings, note, truncated, onBack }: { text: string; findings: RedactFinding[]; note?: string; truncated?: boolean; onBack: () => void }) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of findings) m.set(f.category, (m.get(f.category) ?? 0) + 1);
    return [...m.entries()];
  }, [findings]);
  const segments = useMemo(() => {
    const out: { text: string; hit: RedactFinding | null }[] = [];
    let at = 0;
    for (const f of findings) {
      if (f.start < at || f.end > text.length) continue; // offsets that do not fit this text are ignored, never trusted
      if (f.start > at) out.push({ text: text.slice(at, f.start), hit: null });
      out.push({ text: text.slice(f.start, f.end), hit: f });
      at = f.end;
    }
    if (at < text.length) out.push({ text: text.slice(at), hit: null });
    return out;
  }, [text, findings]);
  return (
    <div className="h-full flex flex-col min-h-0 gap-2">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[12px] text-shelf-accent hover:opacity-70 transition-opacity"><Icon name="back" size={14} /> Back to preview</button>
        <span className="ml-auto text-[12px] font-medium">{findings.length === 0 ? 'Nothing sensitive-looking found' : `${findings.length} possible ${findings.length === 1 ? 'detail' : 'details'} found`}</span>
      </div>
      {counts.length > 0 && <div className="flex flex-wrap gap-1.5">{counts.map(([cat, n]) => <span key={cat} className="text-[11px] px-2 py-0.5 rounded-full bg-shelf-danger/15 text-shelf-danger font-medium">{cat.replace(/_/g, ' ')} · {n}</span>)}</div>}
      <div className="flex-1 min-h-0 overflow-auto rounded-card border border-shelf-line/10 bg-shelf-text/[0.04] p-3">
        <pre className="m-0 whitespace-pre-wrap break-words font-sans text-[13px] leading-[1.6]">
          {segments.map((s, i) => (s.hit
            ? <mark key={i} title={`${s.hit.category.replace(/_/g, ' ')} (${Math.round(s.hit.confidence * 100)}%)`} className="rounded px-0.5 bg-shelf-danger/25 text-shelf-text">{s.text}</mark>
            : <span key={i}>{s.text}</span>))}
        </pre>
      </div>
      {truncated && <p className="text-[11px] text-shelf-muted m-0">Only the start of a very long text was checked.</p>}
      {note && <p className="text-[11px] text-shelf-muted m-0">{note}</p>}
    </div>
  );
}

/** Picks the right view for a text clip from what the text is. */
export function TextClipView({ text }: { text: string }) {
  const c = useMemo(() => classifyText(text), [text]);
  if (c.type === 'color' && c.color) return <ColorView color={c.color} />;
  if (c.type === 'link' && c.url) return <LinkView url={c.url} />;
  if (c.type === 'table' && c.table) return <TableView rows={c.table.rows} capped={c.table.rows.length >= MAX_ROWS} />;
  if (c.type === 'code') return <CodeView text={text} language={c.language} />;
  return <PlainText text={text} />;
}
