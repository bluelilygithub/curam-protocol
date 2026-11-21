import { Fragment, useMemo, useState } from 'react';
import type { LayoutPage } from '../compare/layout';
import { CATEGORY_ICON, CATEGORY_LABEL, type Category, type Change, type ComparisonResult, type Severity, type SimilarityResult } from '../report/model';
import { authorItems, downloadAuthorPdf } from '../report/authorReport';
import { exportPdf } from '../report/pdfExport';
import { SEVERITY_RANK } from '../report/severity';
import type { Settings } from '../settings';

type SortKey = 'id' | 'location' | 'category' | 'severity';
export type ViewId = 'compare' | 'changes' | 'metadata' | 'pages' | 'report' | 'settings';
export interface FilterPreset { categories?: string[]; severities?: string[] }

const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];
const SEVERITIES: Severity[] = ['high', 'medium', 'low'];
const EXCERPT = 300;
const SEV_TIP: Record<Severity, string> = {
  high: 'Show High (red) changes: removed content, removed sections or table rows, changed numbers or dates, a word count down more than 5% overall or 15% in a section.',
  medium: 'Show Medium (amber) changes: added content, rewording, moved text, heading or list changes.',
  low: 'Show Low (info) changes: typo fixes, bold/italic/font changes, PDF page layout and file details.',
};

export type Layout = { status: 'off' | 'waiting' | 'running' | 'done' | 'error'; done: number; total: number; pages: LayoutPage[]; error?: string };

/** The Changes filters, owned by App so they survive switching views and the PDF report uses them. */
export function useChangeFilters(all: Change[], showTrivial: boolean) {
  const [cats, setCats] = useState<Set<Category>>(new Set());
  const [sevs, setSevs] = useState<Set<Severity>>(new Set());
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'id', dir: 1 });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = all.filter((c) => (showTrivial || !c.trivial)
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
  }, [all, cats, sevs, search, sort, showTrivial]);

  const note = [cats.size ? `type: ${[...cats].map((c) => CATEGORY_LABEL[c]).join(', ')}` : '', sevs.size ? `severity: ${[...sevs].join(', ')}` : '', search.trim() ? `search: "${search.trim()}"` : '', showTrivial ? 'trivial changes shown' : ''].filter(Boolean).join('; ');
  const apply = (p: FilterPreset) => {
    setCats(new Set((p.categories ?? []).filter((c): c is Category => (CATEGORIES as string[]).includes(c))));
    setSevs(new Set((p.severities ?? []).filter((s): s is Severity => (SEVERITIES as string[]).includes(s))));
    setSearch('');
  };
  const clear = () => { setCats(new Set()); setSevs(new Set()); setSearch(''); };
  return { cats, setCats, sevs, setSevs, search, setSearch, sort, setSort, visible, note, apply, clear };
}
export type Filters = ReturnType<typeof useChangeFilters>;

/** "Compare two files first" and similar: what the view is for, and the one next step. */
export function EmptyView({ title, text, onAction, action }: { title: string; text: string; onAction?: () => void; action?: string }) {
  return (
    <div className="empty-view">
      <h2>{title}</h2>
      <p className="muted">{text}</p>
      {onAction && <button className="btn primary" onClick={onAction} title="Go to Compare documents to choose the two files.">{action ?? 'Go to Compare documents'}</button>}
    </div>
  );
}

// ---------- summary bar (Compare documents and Changes) ----------

export function SummaryBar({ all, layoutChanges, result, settings, onShowTrivial, onPick, activeCats }: {
  all: Change[]; layoutChanges: Change[]; result: ComparisonResult; settings: Settings; onShowTrivial: (v: boolean) => void;
  onPick: (cat?: Category) => void; activeCats?: Set<Category>;
}) {
  const real = all.filter((c) => !c.trivial);
  const count = (f: (c: Change) => boolean) => real.filter(f).length;
  const sections = count((c) => c.category === 'removed' && c.group === 'section');
  const items: { label: string; n: number; cat?: Category; strong?: boolean }[] = [
    { label: `section${sections === 1 ? '' : 's'} missing`, n: sections, cat: 'removed', strong: true },
    { label: 'removed', n: count((c) => c.category === 'removed' && c.group !== 'section'), cat: 'removed', strong: true },
    { label: 'number/date changes', n: count((c) => c.category === 'number'), cat: 'number', strong: true },
    { label: 'added', n: count((c) => c.category === 'added'), cat: 'added' },
    { label: 'moved', n: count((c) => c.category === 'moved'), cat: 'moved' },
    { label: 'wording changes', n: count((c) => c.category === 'wording'), cat: 'wording' },
    { label: 'typos', n: count((c) => c.category === 'typo'), cat: 'typo' },
    { label: 'formatting changes', n: count((c) => c.category === 'formatting'), cat: 'formatting' },
    { label: 'pages with layout changes', n: layoutChanges.length, cat: 'layout' },
    { label: 'metadata flags', n: count((c) => c.category === 'metadata'), cat: 'metadata' },
  ];
  return (
    <div className="summary" role="group" aria-label="Summary — click an item to see only those changes" data-guide="summary">
      {real.length === 0 && <span className="summary-ok">✓ No differences found</span>}
      {items.filter((s) => s.n > 0).map((s) => (
        <button key={s.label} className={`chip${s.strong ? ' chip-alert' : ''}${s.cat && activeCats?.size === 1 && activeCats.has(s.cat) ? ' active' : ''}`} onClick={() => onPick(s.cat)} title={`Show only ${s.label} in Changes.`}>
          <strong>{s.n}</strong> {s.label}
        </button>
      ))}
      {result.trivialCount > 0 && (
        <label className="chip chip-quiet" data-guide="trivial" title="Differences only in spaces, line breaks, quotes, dashes or invisible characters. Tick to list them in Changes. Settings chooses which count as trivial.">
          <input type="checkbox" checked={settings.showTrivial} onChange={(e) => onShowTrivial(e.target.checked)} />
          {result.trivialCount} trivial change{result.trivialCount === 1 ? '' : 's'} {settings.showTrivial ? 'shown' : 'hidden'}
        </label>
      )}
    </div>
  );
}

// ---------- Changes ----------

export function ChangesView({ all, f, isPdf, onOpenPage }: { all: Change[]; f: Filters; isPdf: boolean; onOpenPage: (p: number) => void }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const real = all.filter((c) => !c.trivial);
  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => { const s = new Set(set); if (s.has(v)) s.delete(v); else s.add(v); apply(s); };
  const sortBy = (key: SortKey) => f.setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }));
  const ariaSort = (key: SortKey) => (f.sort.key === key ? (f.sort.dir === 1 ? 'ascending' : 'descending') : 'none');
  return (
    <>
      <div className="filters" role="group" aria-label="Filters" data-guide="filters">
        <input type="search" placeholder="Search changes…" value={f.search} onChange={(e) => f.setSearch(e.target.value)} aria-label="Search changes" title="Search the location, original text, edited text and details of every change." />
        <div className="chips">
          {CATEGORIES.filter((c) => all.some((x) => x.category === c)).map((c) => (
            <button key={c} className={`chip${f.cats.has(c) ? ' active' : ''}`} aria-pressed={f.cats.has(c)} onClick={() => toggle(f.cats, c, f.setCats)} title={`${f.cats.has(c) ? 'Stop showing only' : 'Show'} ${CATEGORY_LABEL[c].toLowerCase()} changes. Press several types to combine them.`}>
              <span className={`cat-icon cat-${c}`} aria-hidden="true">{CATEGORY_ICON[c]}</span> {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
        <div className="chips">
          {SEVERITIES.map((s) => (
            <button key={s} className={`chip${f.sevs.has(s) ? ' active' : ''}`} aria-pressed={f.sevs.has(s)} onClick={() => toggle(f.sevs, s, f.setSevs)} title={SEV_TIP[s]}>{s[0].toUpperCase() + s.slice(1)}</button>
          ))}
          {(f.cats.size > 0 || f.sevs.size > 0 || f.search) && <button className="btn ghost" onClick={f.clear} title="Show every change again.">Clear filters</button>}
          <span className="muted small">{f.visible.length} of {real.length} shown</span>
        </div>
      </div>

      <div className="table-wrap" data-guide="changes-table">
        <table className="changes">
          <thead>
            <tr>
              {([['id', '#'], ['location', 'Location'], ['category', 'Change type']] as [SortKey, string][]).map(([k, l]) => (
                <th key={k} scope="col" aria-sort={ariaSort(k)}><button className="th-btn" onClick={() => sortBy(k)} title={`Sort by ${l === '#' ? 'number (document order)' : l.toLowerCase()}. Press again to reverse.`}>{l}{f.sort.key === k ? (f.sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button></th>
              ))}
              <th scope="col">Original</th>
              <th scope="col">Edited</th>
              <th scope="col" aria-sort={ariaSort('severity')}><button className="th-btn" onClick={() => sortBy('severity')} title="Sort by severity, High first. Press again to reverse.">Severity{f.sort.key === 'severity' ? (f.sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button></th>
            </tr>
          </thead>
          <tbody>
            {f.visible.length === 0 && <tr><td colSpan={6} className="empty">{real.length ? 'No changes match these filters.' : 'The documents match.'}</td></tr>}
            {f.visible.map((c) => (
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
                  <tr className="detail-row"><td colSpan={6}><Detail c={c} onOpenPage={isPdf ? onOpenPage : undefined} /></td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
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

// ---------- File details ----------

export function MetadataView({ result }: { result: ComparisonResult }) {
  return (
    <div className="table-wrap" data-guide="metadata-table">
      <table>
        <thead><tr><th scope="col">Detail</th><th scope="col">Original</th><th scope="col">Edited</th><th scope="col">Difference</th></tr></thead>
        <tbody>
          {result.metadata.map((m) => (
            <tr key={m.label} className={m.flagged ? 'flagged' : ''}>
              <th scope="row">{m.flagged && <span title="Flagged: worth a look." aria-label="flagged">⚑ </span>}{m.label}</th><td>{m.original}</td><td>{m.edited}</td><td>{m.difference}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- PDF pages ----------

export function PagesView({ layout, threshold, maxPages, onRunLayout, onOpenPage }: { layout: Layout; threshold: number; maxPages: number; onRunLayout: () => void; onOpenPage: (p: number) => void }) {
  const changed = layout.pages.filter((p) => p.ratio > threshold);
  return (
    <>
      <div className="layout-status" data-guide="layout">
        {layout.status === 'running' && <span role="status"><span className="spinner" aria-hidden="true" /> Comparing page layout… {layout.done}/{layout.total}</span>}
        {layout.status === 'waiting' && <span>These PDFs have more than {maxPages} pages, so the pages were not compared automatically. <button className="btn" onClick={onRunLayout} title="Draw and compare every page pixel by pixel. This can take a few minutes on long documents.">Compare layout (slow)</button></span>}
        {layout.status === 'error' && <span className="text-removed">Page comparison failed: {layout.error}</span>}
        {layout.status === 'done' && (
          <span>
            {changed.length ? `${changed.length} of ${layout.pages.length} page${layout.pages.length === 1 ? '' : 's'} look different.` : `All ${layout.pages.length} page${layout.pages.length === 1 ? '' : 's'} look the same.`}{' '}
            <button className="btn" data-guide="page-viewer" onClick={() => onOpenPage(changed[0]?.a ?? changed[0]?.b ?? 1)} title="See the original and edited pages side by side, with the changed pixels in red.">Open page viewer</button>
          </span>
        )}
      </div>
      {layout.pages.length > 0 && (
        <ul className="page-list">
          {layout.pages.map((p, i) => {
            const isChanged = p.ratio > threshold;
            const label = p.a && p.b ? (p.a === p.b ? `Page ${p.a}` : `Page ${p.a} → ${p.b}`) : p.a ? `Page ${p.a} (only in the original)` : `Page ${p.b} (only in the edited file)`;
            return (
              <li key={i} className={isChanged ? 'changed' : ''}>
                {p.thumb ? <img src={p.thumb} alt={`Changes on ${label}`} /> : <span className="thumb-blank" aria-hidden="true">{isChanged ? '▦' : '✓'}</span>}
                <span className="page-label"><strong>{label}</strong><span className="muted">{p.a && p.b ? `${(p.ratio * 100).toFixed(1)}% of the page changed` : 'no matching page'}{isChanged ? ' · changed' : ''}</span></span>
                <button className="btn" onClick={() => onOpenPage(p.a ?? p.b ?? 1)} title="Open this page pair side by side in the page viewer.">View</button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

// ---------- PDF report ----------

export function ReportView(p: {
  result: ComparisonResult; all: Change[]; layoutChanges: Change[]; layout: Layout; sim: SimilarityResult; override: boolean;
  settings: Settings; fileNames: [string, string]; f: Filters; onEditFilters: () => void;
}) {
  const [landscape, setLandscape] = useState(true);
  const real = p.all.filter((c) => !c.trivial).length;
  const pages = p.layout.pages.filter((x) => x.thumb).length;
  return (
    <>
    <AuthorReviewCard all={p.all} trivialCount={p.result.trivialCount} fileNames={p.fileNames} sim={p.sim} override={p.override} />
    <div className="report-card">
      <h2>Comparison report</h2>
      <p>For your own records. The report is a PDF with:</p>
      <ul>
        <li>the two file names, the date, and the two checks (similarity {p.sim.score}/100{p.override ? ', compared anyway' : ''});</li>
        <li>counts of each kind of change by severity, and the file details table;</li>
        <li><strong>{p.f.visible.length} of {real} changes</strong> {p.f.note ? <>(filters: {p.f.note}) </> : null}with removed text in red and added text in green;</li>
        {pages > 0 && <li>pictures of the {pages} changed PDF page{pages === 1 ? '' : 's'}.</li>}
      </ul>
      <div className="row">
        <button className="btn ghost" onClick={p.onEditFilters} title="Go to Changes to choose which changes go in the report.">Change which changes are included</button>
      </div>
      <div className="toolbar">
        <button className="btn primary" data-guide="report-button" onClick={() => exportPdf({ ...p, all: p.all, visible: p.f.visible, filtersNote: p.f.note, landscape })} title="Save the PDF report to your computer. It is made here, in this browser tab.">Download PDF report</button>
        <label className="inline" title="Put the report's changes table on wide (landscape) pages so long text has more room."><input type="checkbox" checked={landscape} onChange={(e) => setLandscape(e.target.checked)} /> Landscape table</label>
      </div>
    </div>
    </>
  );
}

// ---------- Review for the author ----------

export const AUTHOR_TIP = 'Download a PDF to send back to whoever made the edit: every change (not just the filtered ones), most serious first, each with what to do, a tick box, and the original and edited text. Made here, in this browser tab.';

export function AuthorReviewButton({ all, trivialCount, fileNames, sim, override, primary = true }: {
  all: Change[]; trivialCount: number; fileNames: [string, string]; sim: SimilarityResult; override: boolean; primary?: boolean;
}) {
  return (
    <button className={`btn${primary ? ' primary' : ''}`} data-guide="author-report"
      onClick={() => downloadAuthorPdf({ changes: all, trivialCount, fileNames, similarity: sim.score, override: override && sim.score < 100 })}
      title={AUTHOR_TIP}>
      Download review for the author
    </button>
  );
}

function AuthorReviewCard(p: { all: Change[]; trivialCount: number; fileNames: [string, string]; sim: SimilarityResult; override: boolean }) {
  const items = authorItems(p.all);
  const n = (s: Severity) => items.filter((c) => c.severity === s).length;
  return (
    <div className="report-card author-card">
      <h2>Review for the author</h2>
      <p>A complete to-do list to send back to whoever made the edit: <strong>{n('high')} must fix</strong>, {n('medium')} to review and {n('low')} minor, each with what to do, where it is, a tick box, and the original and edited text (removed words in red, added in green). It always lists every change, whatever filters are set in Changes; tiny spacing and quote differences are only counted.</p>
      <div className="toolbar"><AuthorReviewButton {...p} /></div>
    </div>
  );
}
