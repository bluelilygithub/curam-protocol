import { Fragment, useMemo, useState } from 'react';
import type { LayoutPage } from '../compare/layout';
import { CATEGORY_ICON, CATEGORY_LABEL, type Category, type Change, type ComparisonResult, type Severity, type SimilarityResult } from '../report/model';
import { exportPdf } from '../report/pdfExport';
import { SEVERITY_RANK } from '../report/severity';
import type { Settings } from '../settings';

type SortKey = 'id' | 'location' | 'category' | 'severity';
const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];
const SEVERITIES: Severity[] = ['high', 'medium', 'low'];
const EXCERPT = 300;
const SEV_TIP: Record<Severity, string> = {
  high: 'Show High changes: removed content, removed sections or table rows, changed numbers or dates, a big word-count drop.',
  medium: 'Show Medium changes: added content, wording, moved text, heading or list changes, layout.',
  low: 'Show Low changes: typo fixes, bold/italic/font changes and informational file details.',
};

interface Props {
  result: ComparisonResult;
  layoutChanges: Change[];
  layout: { status: string; done: number; total: number; pages: LayoutPage[]; error?: string };
  isPdf: boolean;
  sim: SimilarityResult;
  override: boolean;
  settings: Settings;
  onShowTrivial: (v: boolean) => void;
  fileNames: [string, string];
  onRunLayout: () => void;
  onOpenPage: (page: number) => void;
}

export function Results(p: Props) {
  const [cats, setCats] = useState<Set<Category>>(new Set());
  const [sevs, setSevs] = useState<Set<Severity>>(new Set());
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'id', dir: 1 });
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [landscape, setLandscape] = useState(true);

  const all = useMemo(() => [...p.result.changes, ...p.layoutChanges], [p.result.changes, p.layoutChanges]);
  const real = all.filter((c) => !c.trivial);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = all.filter((c) => (p.settings.showTrivial || !c.trivial)
      && (!cats.size || cats.has(c.category))
      && (!sevs.size || sevs.has(c.severity))
      && (!q || [c.location, c.original, c.edited, c.detail, CATEGORY_LABEL[c.category]].some((s) => s?.toLowerCase().includes(q))));
    const cmp = (a: Change, b: Change) => {
      switch (sort.key) {
        case 'location': return a.location.localeCompare(b.location, undefined, { numeric: true });
        case 'category': return CATEGORY_LABEL[a.category].localeCompare(CATEGORY_LABEL[b.category]);
        case 'severity': return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.id - b.id;
        default: return a.id - b.id;
      }
    };
    return rows.sort((a, b) => cmp(a, b) * sort.dir);
  }, [all, cats, sevs, search, sort, p.settings.showTrivial]);

  const count = (f: (c: Change) => boolean) => real.filter(f).length;
  const sections = count((c) => c.category === 'removed' && c.group === 'section');
  const summary: { label: string; n: number; cat?: Category; strong?: boolean }[] = [
    { label: `section${sections === 1 ? '' : 's'} missing`, n: sections, cat: 'removed', strong: true },
    { label: 'removed', n: count((c) => c.category === 'removed' && c.group !== 'section'), cat: 'removed', strong: true },
    { label: 'number/date changes', n: count((c) => c.category === 'number'), cat: 'number', strong: true },
    { label: 'added', n: count((c) => c.category === 'added'), cat: 'added' },
    { label: 'moved', n: count((c) => c.category === 'moved'), cat: 'moved' },
    { label: 'wording changes', n: count((c) => c.category === 'wording'), cat: 'wording' },
    { label: 'typos', n: count((c) => c.category === 'typo'), cat: 'typo' },
    { label: 'formatting changes', n: count((c) => c.category === 'formatting'), cat: 'formatting' },
    { label: 'pages with layout changes', n: p.layoutChanges.length, cat: 'layout' },
    { label: 'metadata flags', n: count((c) => c.category === 'metadata'), cat: 'metadata' },
  ];

  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => { const s = new Set(set); if (s.has(v)) s.delete(v); else s.add(v); apply(s); };
  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }));
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none');
  const filtersNote = [cats.size ? `type: ${[...cats].map((c) => CATEGORY_LABEL[c]).join(', ')}` : '', sevs.size ? `severity: ${[...sevs].join(', ')}` : '', search.trim() ? `search: "${search.trim()}"` : '', p.settings.showTrivial ? 'trivial changes shown' : ''].filter(Boolean).join('; ');

  return (
    <section className="results" aria-label="Comparison results">
      <div className="summary" role="group" aria-label="Summary — click an item to filter" data-guide="summary">
        {real.length === 0 && <span className="summary-ok">✓ No differences found</span>}
        {summary.filter((s) => s.n > 0).map((s) => (
          <button key={s.label} className={`chip${s.strong ? ' chip-alert' : ''}${s.cat && cats.size === 1 && cats.has(s.cat) ? ' active' : ''}`} onClick={() => setCats(s.cat ? new Set([s.cat]) : new Set())} title={`Show only ${s.label} in the table below.`}>
            <strong>{s.n}</strong> {s.label}
          </button>
        ))}
        {p.result.trivialCount > 0 && (
          <label className="chip chip-quiet" data-guide="trivial" title="Differences only in spaces, line breaks, quotes, dashes or invisible characters. Tick to list them in the table. Settings chooses which count as trivial.">
            <input type="checkbox" checked={p.settings.showTrivial} onChange={(e) => p.onShowTrivial(e.target.checked)} />
            {p.result.trivialCount} trivial change{p.result.trivialCount === 1 ? '' : 's'} {p.settings.showTrivial ? 'shown' : 'hidden'}
          </label>
        )}
      </div>

      <div className="gate-summary muted">
        File types match ✓ · Similarity {p.sim.score}/100{p.override ? ' · compared anyway (below threshold)' : ''}
      </div>

      <div className="toolbar">
        <button className="btn primary" data-guide="report" onClick={() => exportPdf({ ...p, all, visible, filtersNote, landscape })} title="Save a PDF with the checks, summary, metadata, the changes table (using the filters set now) and any changed PDF pages.">Download PDF report</button>
        <label className="inline" title="Put the report's changes table on wide (landscape) pages so long text has more room."><input type="checkbox" checked={landscape} onChange={(e) => setLandscape(e.target.checked)} /> Landscape table</label>
      </div>

      {p.isPdf && (
        <div className="layout-status" data-guide="layout">
          {p.layout.status === 'running' && <span role="status"><span className="spinner" aria-hidden="true" /> Comparing page layout… {p.layout.done}/{p.layout.total}</span>}
          {p.layout.status === 'waiting' && <span>These PDFs have more than {p.settings.maxPagesForLayout} pages, so page layout wasn't compared automatically. <button className="btn" onClick={p.onRunLayout} title="Draw and compare every page pixel by pixel. This can take a few minutes on long documents.">Compare layout (slow)</button></span>}
          {p.layout.status === 'error' && <span className="text-removed">Layout comparison failed: {p.layout.error}</span>}
          {p.layout.status === 'done' && <span>Layout compared on {p.layout.pages.length} page{p.layout.pages.length === 1 ? '' : 's'}. <button className="btn" data-guide="page-viewer" onClick={() => p.onOpenPage(p.layoutChanges[0]?.page ?? 1)} title="See the original and edited pages side by side, with the changed pixels in red.">Open page viewer</button></span>}
        </div>
      )}

      <details className="meta" data-guide="metadata">
        <summary title="Compare file details: size, dates, author, and counts of pages, words, headings, tables and images. Flagged rows are marked ⚑.">Metadata {p.result.metadata.some((m) => m.flagged) ? <span className="badge sev-medium">flags</span> : null}</summary>
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Field</th><th scope="col">Original</th><th scope="col">Edited</th><th scope="col">Difference</th></tr></thead>
            <tbody>
              {p.result.metadata.map((m) => (
                <tr key={m.label} className={m.flagged ? 'flagged' : ''}>
                  <th scope="row">{m.flagged && <span aria-label="flagged">⚑ </span>}{m.label}</th><td>{m.original}</td><td>{m.edited}</td><td>{m.difference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <div className="filters" role="group" aria-label="Filters" data-guide="filters">
        <input type="search" placeholder="Search changes…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search changes" title="Search the location, original text, edited text and details of every change." />
        <div className="chips">
          {CATEGORIES.filter((c) => all.some((x) => x.category === c)).map((c) => (
            <button key={c} className={`chip${cats.has(c) ? ' active' : ''}`} aria-pressed={cats.has(c)} onClick={() => toggle(cats, c, setCats)} title={`${cats.has(c) ? 'Stop showing only' : 'Show'} ${CATEGORY_LABEL[c].toLowerCase()} changes. Press several types to combine them.`}>
              <span className={`cat-icon cat-${c}`} aria-hidden="true">{CATEGORY_ICON[c]}</span> {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
        <div className="chips">
          {SEVERITIES.map((s) => (
            <button key={s} className={`chip${sevs.has(s) ? ' active' : ''}`} aria-pressed={sevs.has(s)} onClick={() => toggle(sevs, s, setSevs)} title={SEV_TIP[s]}>{s[0].toUpperCase() + s.slice(1)}</button>
          ))}
          {(cats.size > 0 || sevs.size > 0 || search) && <button className="btn ghost" onClick={() => { setCats(new Set()); setSevs(new Set()); setSearch(''); }} title="Show every change again.">Clear filters</button>}
        </div>
      </div>

      <div className="table-wrap" data-guide="changes">
        <table className="changes">
          <thead>
            <tr>
              {([['id', '#'], ['location', 'Location'], ['category', 'Change type']] as [SortKey, string][]).map(([k, l]) => (
                <th key={k} scope="col" aria-sort={ariaSort(k)}><button className="th-btn" onClick={() => sortBy(k)} title={`Sort by ${l === '#' ? 'number (document order)' : l.toLowerCase()}. Press again to reverse.`}>{l}{sort.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button></th>
              ))}
              <th scope="col">Original</th>
              <th scope="col">Edited</th>
              <th scope="col" aria-sort={ariaSort('severity')}><button className="th-btn" onClick={() => sortBy('severity')} title="Sort by severity, High first. Press again to reverse.">Severity{sort.key === 'severity' ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && <tr><td colSpan={6} className="empty">{real.length ? 'No changes match these filters.' : 'The documents match.'}</td></tr>}
            {visible.map((c) => (
              <Fragment key={c.id}>
                <tr
                  className={`row-${c.category}${c.trivial ? ' trivial' : ''}`}
                  tabIndex={0}
                  aria-label={`Change ${c.id}: ${CATEGORY_LABEL[c.category]} at ${c.location}, ${c.severity} severity. Press Enter for details.`}
                  aria-expanded={open.has(c.id)}
                  onClick={() => toggle(open, c.id, setOpen)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(open, c.id, setOpen); } }}
                >
                  <td>{c.id}</td>
                  <td>{c.location}</td>
                  <td><span className={`cat-icon cat-${c.category}`} aria-hidden="true">{CATEGORY_ICON[c.category]}</span> {CATEGORY_LABEL[c.category]}{c.trivial ? ' (trivial)' : ''}{c.group === 'section' ? ' — section' : c.group === 'tableRow' ? ' — table row' : ''}</td>
                  <td className="text-removed-soft">{excerpt(c.original) || <span className="muted">{c.category === 'added' ? '—' : c.detail ?? '—'}</span>}</td>
                  <td className="text-added-soft">{excerpt(c.edited) || <span className="muted">{c.category === 'removed' ? '—' : c.original ? '—' : c.detail ?? '—'}</span>}</td>
                  <td><span className={`badge sev-${c.severity}`}>{c.severity === 'high' ? '▲ High' : c.severity === 'medium' ? '■ Medium' : '● Low'}</span></td>
                </tr>
                {open.has(c.id) && (
                  <tr className="detail-row"><td colSpan={6}><Detail c={c} onOpenPage={p.isPdf ? p.onOpenPage : undefined} /></td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const excerpt = (s?: string) => (s ? (s.length > 120 ? `${s.slice(0, 119)}…` : s) : '');

function Detail({ c, onOpenPage }: { c: Change; onOpenPage?: (p: number) => void }) {
  return (
    <div className="detail">
      {c.detail && <p><strong>{c.detail}</strong></p>}
      {c.diffHtml ? (
        // diffHtml is built from escaped text with only <del>/<ins> added (compare/content.ts)
        <div className="diff" dangerouslySetInnerHTML={{ __html: c.diffHtml }} />
      ) : (
        <div className="detail-cols">
          {c.original !== undefined && <div><h4>Original</h4><LongText text={c.original} className="text-removed" /></div>}
          {c.edited !== undefined && <div><h4>Edited</h4><LongText text={c.edited} className="text-added" /></div>}
        </div>
      )}
      {c.children && (
        <ol className="children">
          {c.children.map((k) => <li key={k.id}><span className="muted">{k.location}:</span> {k.detail ? `${k.detail} ` : ''}{k.original ?? k.edited ?? ''}</li>)}
        </ol>
      )}
      {c.page !== undefined && onOpenPage && <button className="btn" onClick={() => onOpenPage(c.page!)} title="Open this page in the page viewer, side by side with the changed pixels in red.">View page {c.page}</button>}
    </div>
  );
}

function LongText({ text, className }: { text: string; className: string }) {
  const [more, setMore] = useState(false);
  const long = text.length > EXCERPT;
  return (
    <p className={className}>
      {long && !more ? `${text.slice(0, EXCERPT)}…` : text}
      {long && <> <button className="link" onClick={() => setMore(!more)} title={more ? 'Fold the text back to a short preview.' : 'Show the whole text.'}>{more ? 'show less' : 'show more'}</button></>}
    </p>
  );
}
