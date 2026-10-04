import { useMemo, useState } from 'react';
import { FIXTURE_LIBRARY } from '../data/furnitureLibrary';
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

export function LibraryPanel() {
  const app = useApp();
  const defs = useProject((s) => s.project?.furnitureDefinitions ?? []);
  const hasRoom = useProject((s) => !!s.project?.rooms.length);
  const placing = useUi((s) => s.placing);
  const recents = useUi((s) => s.recents);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');

  const categories = useMemo(() => ['all', ...[...new Set(defs.map((d) => d.category))].sort()], [defs]);
  const q = query.trim().toLowerCase();
  const matches = (name: string, cat: string): boolean => (category === 'all' || cat === category) && (!q || name.toLowerCase().includes(q));
  const shown = defs.filter((d) => matches(d.name, d.category)).sort((a, b) => (a.name < b.name ? -1 : 1)); // explicit sort (C18)
  const recent = recents.map((id) => defs.find((d) => d.id === id)).filter((d) => !!d);
  const fixtures = FIXTURE_LIBRARY.filter((f) => !q || f.name.toLowerCase().includes(q));

  const start = (kind: 'furniture' | 'fixture', definitionId: string): void => {
    app.interaction.cancel();
    app.ui.getState().startPlacing({ kind, definitionId });
  };
  const active = (kind: string, id: string): boolean =>
    placing?.kind === kind && placing.definitionId === id && !(placing.kind === 'furniture' && placing.template);

  return (
    <aside className="panel left" aria-label="Library" data-tour="rp-library">
      <div className="panel-head">
        <h2>Library</h2>
      </div>
      <div className="panel-body">
        <input className="search" type="search" title="Type part of a name, for example “sofa” or “desk”" placeholder="Search furniture" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search library" />
        <div className="chips" role="group" aria-label="Category">
          {categories.map((c) => (
            <button key={c} className={`chip ${category === c ? 'active' : ''}`} aria-pressed={category === c} title={c === 'all' ? 'Show every piece' : `Show only ${c}`} onClick={() => setCategory(c)}>
              {c === 'all' ? 'All' : c}
            </button>
          ))}
        </div>

        {!hasRoom && <p className="hint">Create a room first, then pick something to place.</p>}

        {fixtures.length > 0 && category === 'all' && (
          <section>
            <h3>Doors &amp; windows</h3>
            <div className="grid">
              {fixtures.map((f) => (
                <button key={f.id} className={`card ${active('fixture', f.id) ? 'active' : ''}`} disabled={!hasRoom} onClick={() => start('fixture', f.id)} title={`Place a ${f.name.toLowerCase()} on a wall`}>
                  <span className="thumb fixture-thumb">{f.type === 'door' ? Icons.door : Icons.window}</span>
                  <span className="name">{f.name}</span>
                  <span className="dims">{fmt(f.width)} × {fmt(f.height)} m</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {recent.length > 0 && !q && category === 'all' && (
          <section>
            <h3>Recently used</h3>
            <div className="grid">
              {recent.map((d) => d && (
                <button key={`r-${d.id}`} className={`card ${active('furniture', d.id) ? 'active' : ''}`} disabled={!hasRoom} onClick={() => start('furniture', d.id)}>
                  <GlyphThumb id={d.id} w={d.defaultWidth} l={d.defaultLength} />
                  <span className="name">{d.name}</span>
                  <span className="dims" title="Width × length, metres">{fmt(d.defaultWidth)}×{fmt(d.defaultLength)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section>
          <h3>Furniture</h3>
          {shown.length === 0 ? <p className="hint">Nothing matches “{query}”.</p> : (
            <div className="grid">
              {shown.map((d) => (
                <button key={d.id} className={`card ${active('furniture', d.id) ? 'active' : ''}`} disabled={!hasRoom} onClick={() => start('furniture', d.id)} title={`Place ${d.name}`}>
                  <GlyphThumb id={d.id} w={d.defaultWidth} l={d.defaultLength} />
                  <span className="name">{d.name}</span>
                  <span className="dims" title="Width × length × height, metres">{fmt(d.defaultWidth)}×{fmt(d.defaultLength)}×{fmt(d.defaultHeight)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {placing && (
          <p className="hint placing">
            Move into the plan and click to place. <kbd>R</kbd> rotates{placing.kind === 'fixture' ? <>, <kbd>H</kbd> flips the hinge</> : null}. <kbd>Esc</kbd> cancels.
          </p>
        )}
      </div>
    </aside>
  );
}
