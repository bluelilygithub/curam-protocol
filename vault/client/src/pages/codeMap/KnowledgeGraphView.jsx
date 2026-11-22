import React, { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { fmt, fmtWhen } from './shared';

// Knowledge graph tab: the graph Understand-Anything (github.com/Egonex-AI/Understand-Anything) wrote to .ua/knowledge-graph.json.
// Vault never makes it: the owner runs /understand in Claude Code and commits .ua/. API: GET /api/code-map/knowledge-graph
// (server/services/codeMap/knowledgeGraph.js). Loaded on its own (React.lazy in CodeMapPage.jsx) like the Dependency map.

const cssVar = (name, fallback) => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
};
const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

// node types in groups, one colour each (types.ts NodeType); readable on light and dark surfaces
const GROUPS = [
  { label: 'Files and modules', color: '#3b82f6', types: ['file', 'module'] },
  { label: 'Functions and classes', color: '#14b8a6', types: ['function', 'class'] },
  { label: 'Services, endpoints, data', color: '#f59e0b', types: ['service', 'endpoint', 'pipeline', 'table', 'schema', 'resource', 'config'] },
  { label: 'Domains and flows', color: '#a855f7', types: ['domain', 'flow', 'step'] },
  { label: 'Docs and concepts', color: '#ec4899', types: ['document', 'concept', 'article', 'entity', 'topic', 'claim', 'source'] },
];
const OTHER = '#9ca3af';
const typeColor = (t) => (GROUPS.find((g) => g.types.includes(t)) || {}).color || OTHER;
const COMPLEXITY_R = { simple: 3, moderate: 4.5, complex: 6 };
const endId = (x) => (typeof x === 'object' ? x.id : x);

export default function KnowledgeGraphView() {
  const [graph, setGraph] = useState(undefined); // undefined while loading, null when none is committed
  const [error, setError] = useState(null);

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const r = await api.get('/api/code-map/knowledge-graph');
        const d = await r.json().catch(() => ({}));
        if (stop) return;
        if (!r.ok) throw new Error(d.error || 'The knowledge graph could not be loaded.');
        setGraph(d.graph || null);
      } catch (err) {
        if (!stop) { setError(err.message || 'The knowledge graph could not be loaded.'); setGraph(null); }
      }
    })();
    return () => { stop = true; };
  }, []);

  if (graph === undefined) return <Skeleton className="h-[70vh]" label="Loading the knowledge graph" />;
  if (error) return <p className="text-xs px-3 py-2 rounded-md" style={{ background: '#fff1f2', color: '#ef4444' }}>{error}</p>;
  if (!graph) return <HowToMake />;
  return <GraphExplorer g={graph} />;
}

function HowToMake() {
  return (
    <EmptyState
      icon="code-map"
      title="No knowledge graph yet"
      body={(
        <span className="block text-left space-y-1.5 max-w-xl mx-auto">
          <span className="block">This tab shows the graph Understand-Anything makes of the code: every file, function and class with a plain summary, the layers and a guided tour. Vault does not make it; you do, in Claude Code, and commit it.</span>
          <span className="block">1. In Claude Code: <code>/plugin marketplace add Egonex-AI/Understand-Anything</code> then <code>/plugin install understand-anything</code></span>
          <span className="block">2. In the <code>vault</code> folder: <code>/understand</code> (it uses model calls on your Claude plan; later runs only read changed files)</span>
          <span className="block">3. Commit <code>.ua/</code> and push. The tab reads it after the deploy.</span>
        </span>
      )}
    />
  );
}

function GraphExplorer({ g }) {
  const boxRef = useRef(null);
  const fgRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [layer, setLayer] = useState('');
  const [hidden, setHidden] = useState(() => new Set(['function', 'class'])); // files first: functions and classes can be thousands
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(null);
  const [step, setStep] = useState(null); // index into g.tour
  const still = useMemo(reducedMotion, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byId = useMemo(() => new Map(g.nodes.map((n) => [n.id, n])), [g]);
  const presentGroups = useMemo(() => {
    const types = new Set(g.nodes.map((n) => n.type));
    return [...GROUPS.filter((gr) => gr.types.some((t) => types.has(t))), ...(g.nodes.some((n) => typeColor(n.type) === OTHER) ? [{ label: 'Other', color: OTHER, types: null }] : [])];
  }, [g]);
  const isHidden = (t) => hidden.has(t) || (hidden.has('__other') && typeColor(t) === OTHER);
  const toggleGroup = (gr) => setHidden((h) => {
    const next = new Set(h);
    const keys = gr.types || ['__other'];
    const on = keys.some((k) => next.has(k));
    for (const k of keys) { if (on) next.delete(k); else next.add(k); }
    return next;
  });

  const data = useMemo(() => {
    const inLayer = layer ? new Set((g.layers.find((l) => l.id === layer) || {}).nodeIds || []) : null;
    const nodes = g.nodes.filter((n) => !isHidden(n.type) && (!inLayer || inLayer.has(n.id))).map((n) => ({ id: n.id, name: n.name, type: n.type, r: COMPLEXITY_R[n.complexity] || 4 }));
    const ids = new Set(nodes.map((n) => n.id));
    const links = g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ source: e.source, target: e.target, type: e.type, w: e.weight || 0.5 }));
    return { nodes, links };
  }, [g, layer, hidden]); // eslint-disable-line react-hooks/exhaustive-deps

  // what is lit: the selected node and its neighbours, or the tour step's nodes, or the search matches
  const lit = useMemo(() => {
    if (sel) {
      const s = new Set([sel]);
      for (const l of data.links) { if (endId(l.source) === sel) s.add(endId(l.target)); if (endId(l.target) === sel) s.add(endId(l.source)); }
      return s;
    }
    if (step !== null && g.tour[step]) return new Set(g.tour[step].nodeIds || []);
    const q = query.trim().toLowerCase();
    if (q) return new Set(data.nodes.filter((n) => n.name.toLowerCase().includes(q) || (byId.get(n.id).filePath || '').toLowerCase().includes(q)).map((n) => n.id));
    return null;
  }, [sel, step, query, data, g, byId]);

  const fitted = useRef(false);
  useEffect(() => {
    fitted.current = false;
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('charge')?.strength(-40);
    fg.d3Force('link')?.distance(30);
    fg.d3ReheatSimulation?.();
  }, [data]);
  const fit = () => {
    if (fitted.current || !fgRef.current) return;
    fitted.current = true;
    fgRef.current.zoomToFit(still ? 0 : 400, 30);
  };

  // a tour step zooms to its nodes when they are on the map
  useEffect(() => {
    if (step === null || !fgRef.current || !lit) return;
    if (data.nodes.some((n) => lit.has(n.id))) fgRef.current.zoomToFit(still ? 0 : 500, 60, (n) => lit.has(n.id));
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const colors = useMemo(() => ({ text: cssVar('--color-text', '#222'), surface: cssVar('--color-surface', '#fff'), muted: cssVar('--color-muted', '#777') }), []);
  const selected = sel ? byId.get(sel) : null;
  const p = g.project || {};
  const selectStyle = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

  return (
    <div className="space-y-3" data-guide="knowledge-graph">
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        {p.name || 'Project'}{p.analyzedAt ? <> · made {fmtWhen(p.analyzedAt)}</> : null}{p.gitCommitHash ? <> at commit <code>{String(p.gitCommitHash).slice(0, 8)}</code></> : null}
        {' '}· {fmt(g.nodes.length)} nodes, {fmt(g.edges.length)} links · <code>{g.file}</code>. Summaries were written by an AI model when the graph was made; check them against the code.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {g.layers.length > 0 && (
          <Tooltip text="Show one layer of the code, as Understand-Anything grouped it.">
            <select value={layer} onChange={(e) => { setLayer(e.target.value); setSel(null); }} aria-label="Layer" className="px-3 py-1.5 rounded-xl border text-sm" style={selectStyle}>
              <option value="">All layers</option>
              {g.layers.map((l) => <option key={l.id} value={l.id}>{l.name} ({fmt((l.nodeIds || []).length)})</option>)}
            </select>
          </Tooltip>
        )}
        <Tooltip text="Light up nodes whose name or file path contains this.">
          <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setSel(null); setStep(null); }} placeholder="Find a file or function…" aria-label="Find a node"
            className="px-3 py-1.5 rounded-xl border text-sm w-56" style={selectStyle} />
        </Tooltip>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" role="group" aria-label="Node types shown">
          {presentGroups.map((gr) => {
            const on = !(gr.types || ['__other']).some((k) => hidden.has(k));
            return (
              <label key={gr.label} className="inline-flex items-center gap-1.5 cursor-pointer" style={{ color: 'var(--color-text)' }}>
                <input type="checkbox" checked={on} onChange={() => toggleGroup(gr)} />
                <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: gr.color }} />
                {gr.label}
              </label>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <div ref={boxRef} className="relative rounded-xl border overflow-hidden h-[70vh] min-h-[480px]" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          role="img" aria-label={`Knowledge graph of ${data.nodes.length} nodes and ${data.links.length} links. The panel beside it lists the selected node and the tour as text.`}>
          <ForceGraph2D
            ref={fgRef}
            graphData={data}
            width={size.w}
            height={size.h}
            backgroundColor="rgba(0,0,0,0)"
            warmupTicks={still ? 300 : 0}
            cooldownTicks={still ? 0 : 200}
            nodeLabel={(n) => `${n.name} (${n.type})`}
            nodeCanvasObject={(n, ctx, scale) => {
              const on = !lit || lit.has(n.id);
              ctx.globalAlpha = on ? 1 : 0.1;
              ctx.beginPath();
              ctx.arc(n.x, n.y, n.r, 0, 2 * Math.PI);
              ctx.fillStyle = typeColor(n.type);
              ctx.fill();
              if (n.id === sel) { ctx.lineWidth = 2 / scale; ctx.strokeStyle = colors.text; ctx.stroke(); }
              // names only when zoomed in or lit, so a big graph stays readable
              if ((lit && lit.has(n.id)) || scale > 2.2) {
                ctx.font = `${11 / scale}px sans-serif`;
                ctx.textBaseline = 'middle';
                ctx.lineWidth = 3 / scale;
                ctx.strokeStyle = colors.surface;
                ctx.strokeText(n.name, n.x + n.r + 2 / scale, n.y);
                ctx.fillStyle = colors.text;
                ctx.fillText(n.name, n.x + n.r + 2 / scale, n.y);
              }
              ctx.globalAlpha = 1;
            }}
            nodePointerAreaPaint={(n, color, ctx) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 2, 0, 2 * Math.PI); ctx.fill(); }}
            linkColor={(l) => (!lit || (lit.has(endId(l.source)) && lit.has(endId(l.target))) ? colors.muted : 'rgba(128,128,128,0.06)')}
            linkWidth={(l) => 0.5 + l.w}
            linkDirectionalArrowLength={sel ? 3 : 0}
            linkDirectionalArrowRelPos={1}
            onNodeClick={(n) => { setSel(n.id === sel ? null : n.id); setStep(null); }}
            onBackgroundClick={() => setSel(null)}
            onEngineStop={fit}
          />
          <div className="absolute left-3 bottom-2.5 text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}>
            Drag to move · scroll to zoom · click a node to see what it is and what it links to · circle size = complexity
          </div>
        </div>

        <aside className="rounded-xl border p-3 text-sm space-y-3 overflow-y-auto max-h-[70vh]" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}>
          {selected ? <NodeDetail n={selected} g={g} byId={byId} onPick={(id) => { setSel(id); setStep(null); }} onClose={() => setSel(null)} /> : (
            <TourList tour={g.tour} step={step} byId={byId} onStep={(i) => { setStep(i === step ? null : i); setSel(null); }} onPick={setSel} />
          )}
        </aside>
      </div>
    </div>
  );
}

function NodeDetail({ n, g, byId, onPick, onClose }) {
  const links = useMemo(() => g.edges.filter((e) => e.source === n.id || e.target === n.id).slice(0, 60), [g, n]);
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold break-words">{n.name}</div>
          <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
            <span style={{ color: typeColor(n.type) }}>{n.type}</span>{n.complexity ? ` · ${n.complexity}` : ''}
          </div>
        </div>
        <button type="button" onClick={onClose} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70 transition-opacity duration-200" style={{ borderColor: 'var(--color-border)' }}>Back to tour</button>
      </div>
      {n.filePath && <code className="block text-xs break-all">{n.filePath}{n.lineRange ? `:${n.lineRange[0]}-${n.lineRange[1]}` : ''}</code>}
      {n.summary && <p>{n.summary}</p>}
      {n.languageNotes && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{n.languageNotes}</p>}
      {(n.tags || []).length > 0 && <div className="flex flex-wrap gap-1">{n.tags.map((t) => <span key={t} className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg)' }}>{t}</span>)}</div>}
      {links.length > 0 && (
        <div>
          <div className="text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Links</div>
          <ul className="space-y-0.5">
            {links.map((e, i) => {
              const out = e.source === n.id;
              const other = byId.get(out ? e.target : e.source);
              return (
                <li key={i} className="text-xs">
                  <span style={{ color: 'var(--color-muted)' }}>{out ? e.type : `${e.type} ←`}</span>{' '}
                  <button type="button" onClick={() => onPick(other.id)} className="underline hover:opacity-70 transition-opacity duration-200 break-all text-left">{other.name}</button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function TourList({ tour, step, byId, onStep, onPick }) {
  if (!tour.length) return <p className="text-xs" style={{ color: 'var(--color-muted)' }}>This graph has no tour. Click a node to see what it is.</p>;
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Guided tour ({tour.length} steps). Pick a step to light up its code.</div>
      <ol className="space-y-1.5">
        {tour.map((s, i) => (
          <li key={i}>
            <button type="button" onClick={() => onStep(i)} aria-pressed={step === i}
              className="w-full text-left rounded-lg px-2 py-1.5 border hover:opacity-70 transition-opacity duration-200"
              style={{ borderColor: step === i ? 'var(--color-primary)' : 'var(--color-border)' }}>
              <span className="font-medium">{i + 1}. {s.title}</span>
            </button>
            {step === i && (
              <div className="px-2 pt-1.5 space-y-1.5">
                <p>{s.description}</p>
                {s.languageLesson && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{s.languageLesson}</p>}
                <div className="flex flex-wrap gap-1">
                  {(s.nodeIds || []).filter((id) => byId.has(id)).map((id) => (
                    <button key={id} type="button" onClick={() => onPick(id)} className="text-xs px-1.5 py-0.5 rounded border hover:opacity-70 transition-opacity duration-200" style={{ borderColor: 'var(--color-border)' }}>{byId.get(id).name}</button>
                  ))}
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
