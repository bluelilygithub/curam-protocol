import { useMemo, useState } from 'react';
import { FIXTURE_LIBRARY, LIGHT_EMITTERS } from '../data/furnitureLibrary';
import { isRealModel, thumbUrl } from '../data/realModels';
import { glyphFor, type GlyphShape } from '../render2d/glyphs';
import { useApp, useProject, useUi } from './AppContext';
import { Icons } from './icons';

/** A small SVG of the same blueprint glyph the canvas uses (local frame: +Y is front, flipped for the screen). */
export function GlyphThumb({ id, w, l, box = { w: 60, h: 42 } }: { id: string; w: number; l: number; box?: { w: number; h: number } }) {
  const g = glyphFor(id, w, l);
  const k = Math.min((box.w - 8) / w, (box.h - 8) / l);
  const sw = (wt: GlyphShape['weight']) => (wt === 'outline' ? 1.5 : wt === 'detail' ? 1 : 0.8);
  return (
    <svg width={box.w} height={box.h} viewBox={`${-box.w / 2} ${-box.h / 2} ${box.w} ${box.h}`} aria-hidden="true" className="thumb">
      <g transform={`scale(${k} ${-k})`} fill="none" stroke="currentColor">
        {g.shapes.map((s, i) => {
          const common = { strokeWidth: sw(s.weight), vectorEffect: 'non-scaling-stroke' as const };
          if (s.t === 'rect') return <rect key={i} {...common} x={s.x} y={s.y} width={s.w} height={s.h} />;
          if (s.t === 'line') {
            const p = s.pts;
            return <polyline key={i} {...common} points={p.map((v, j) => (j % 2 ? '' : `${v},${p[j + 1]}`)).filter(Boolean).join(' ')} />;
          }
          return <circle key={i} {...common} cx={s.x} cy={s.y} r={s.r} />;
        })}
        <polygon points={g.frontMarker.pts.map((v, j) => (j % 2 ? '' : `${v},${g.frontMarker.pts[j + 1]}`)).filter(Boolean).join(' ')} fill="currentColor" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
}

/** 2.2 → "2.2", 1 → "1", 0.95 → "0.95" */
const fmt = (n: number): string => String(Number(n.toFixed(2)));

const OPEN_KEY = 'room-planner:library-open:v1';
/** Groups, in the order shown; any other category goes after these. */
const CATEGORY_ORDER = ['seating', 'tables', 'storage', 'bedroom', 'office', 'decor', 'lighting', 'rugs', 'wall art'];
const DEFAULT_OPEN: Record<string, boolean> = { doors: true, seating: true, tables: true };
const label = (c: string): string => c.charAt(0).toUpperCase() + c.slice(1);

function loadOpen(): Record<string, boolean> {
  try { const raw = window.localStorage.getItem(OPEN_KEY); return { ...DEFAULT_OPEN, ...(raw ? (JSON.parse(raw) as Record<string, boolean>) : {}) }; } catch { return { ...DEFAULT_OPEN }; }
}

/** The library: search, then collapsible groups (doors and windows, then each kind of furniture). Open groups are remembered per browser. */
export function LibraryPanel() {
  const app = useApp();
  const defs = useProject((s) => s.project?.furnitureDefinitions ?? []);
  const hasRoom = useProject((s) => !!s.project?.rooms.length);
  const placing = useUi((s) => s.placing);
  const recents = useUi((s) => s.recents);
  const [query, setQuery] = useState('');
  const [open, setOpenState] = useState<Record<string, boolean>>(loadOpen);
  const setOpen = (id: string, on: boolean): void => {
    setOpenState((prev) => {
      if (!!prev[id] === on) return prev;
      const next = { ...prev, [id]: on };
      try { window.localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const q = query.trim().toLowerCase();
  const byName = (a: { name: string }, b: { name: string }): number => (a.name < b.name ? -1 : 1); // explicit sort (C18)
  const groups = useMemo(() => {
    const cats = [...new Set(defs.map((d) => d.category))];
    cats.sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || (a < b ? -1 : 1);
    });
    return cats.map((c) => ({ id: c, items: defs.filter((d) => d.category === c && (!q || d.name.toLowerCase().includes(q))).sort(byName) })).filter((g) => g.items.length > 0);
  }, [defs, q]);
  const recent = recents.map((id) => defs.find((d) => d.id === id)).filter((d) => !!d);
  const fixtures = FIXTURE_LIBRARY.filter((f) => !q || f.name.toLowerCase().includes(q));

  const start = (kind: 'furniture' | 'fixture', definitionId: string): void => {
    app.interaction.cancel();
    app.ui.getState().startPlacing({ kind, definitionId });
  };
  const active = (kind: string, id: string): boolean =>
    placing?.kind === kind && placing.definitionId === id && !(placing.kind === 'furniture' && placing.template);
  /** A search opens every group that has a match, whatever was remembered. */
  const isOpen = (id: string): boolean => (q ? true : !!open[id]);
  const group = (id: string, title: string, count: number, children: React.ReactNode): React.ReactNode => (
    <details key={id} className="lib-group" open={isOpen(id)} onToggle={(e) => { if (!q) setOpen(id, (e.currentTarget as HTMLDetailsElement).open); }}>
      <summary>{title}<span className="count">{count}</span></summary>
      <div className="grid">{children}</div>
    </details>
  );
  const card = (d: (typeof defs)[number], keyPrefix = ''): React.ReactNode => (
    <button key={`${keyPrefix}${d.id}`} className={`card ${active('furniture', d.id) ? 'active' : ''}`} disabled={!hasRoom} onClick={() => start('furniture', d.id)} title={`Place ${d.name}: ${fmt(d.defaultWidth)} × ${fmt(d.defaultLength)} × ${fmt(d.defaultHeight)} m${LIGHT_EMITTERS[d.id] ? '. Gives light: shows in the Realistic 3D look and in Render photo.' : ''}${isRealModel(d.id) ? '. A real 3D model: it shows as the real thing in the Realistic 3D look and in Render photo, and as a plain shape elsewhere.' : ''}`}>
      {isRealModel(d.id)
        ? <img className="thumb-3d" src={thumbUrl(d.id)} width={88} height={60} alt="" draggable={false} />
        : <GlyphThumb id={d.id} w={d.defaultWidth} l={d.defaultLength} />}
      <span className="name">{d.name}</span>
      <span className="dims">{fmt(d.defaultWidth)}×{fmt(d.defaultLength)}×{fmt(d.defaultHeight)}</span>
    </button>
  );

  return (
    <aside className="panel left" aria-label="Library" data-tour="rp-library">
      <div className="panel-head">
        <h2>Library</h2>
      </div>
      <div className="panel-body">
        <input className="search" type="search" title="Type part of a name, for example “sofa” or “desk”" placeholder="Search furniture" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search library" />

        {!hasRoom && <p className="hint">Create a room first, then pick something to place.</p>}

        {recent.length > 0 && !q && (
          <details className="lib-group" open={isOpen('recent')} onToggle={(e) => setOpen('recent', (e.currentTarget as HTMLDetailsElement).open)}>
            <summary>Recently used<span className="count">{recent.length}</span></summary>
            <div className="grid">{recent.map((d) => d && card(d, 'r-'))}</div>
          </details>
        )}

        {fixtures.length > 0 && group('doors', 'Doors & windows', fixtures.length, fixtures.map((f) => (
          <button key={f.id} className={`card ${active('fixture', f.id) ? 'active' : ''}`} disabled={!hasRoom} onClick={() => start('fixture', f.id)} title={`Place a ${f.name.toLowerCase()} on a wall`}>
            <span className="thumb fixture-thumb">{f.type === 'door' ? Icons.door : Icons.window}</span>
            <span className="name">{f.name}</span>
            <span className="dims">{fmt(f.width)} × {fmt(f.height)} m</span>
          </button>
        )))}

        {groups.map((g) => group(g.id, label(g.id), g.items.length, g.items.map((d) => card(d))))}

        {q && fixtures.length === 0 && groups.length === 0 && <p className="hint">Nothing matches “{query}”.</p>}

        <p className="hint credits-link">Pieces marked “3D model” are real models, shown in the Realistic look and Render photo. <button className="link" onClick={() => app.ui.getState().setCreditsOpen(true)}>Credits</button></p>

        {placing && (
          <p className="hint placing">
            Move into the plan and click to place. <kbd>R</kbd> rotates{placing.kind === 'fixture' ? <>, <kbd>H</kbd> flips the hinge</> : null}. <kbd>Esc</kbd> cancels.
          </p>
        )}
      </div>
    </aside>
  );
}
