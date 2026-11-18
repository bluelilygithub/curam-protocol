import React, { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import Tooltip from '../../components/Tooltip';
import { STATUS_COLOR, fmt, scoreColor, toolLines } from './shared';

// Dependency map: one circle per tool (area grows with lines of code, so radius is √lines; colour is the score band). A solid line means one
// tool calls the other's API, a dashed line that they share code files. Click a tool to highlight its links, click it again to open it.
// Loaded on its own (React.lazy in CodeMapPage.jsx) so the graph library is only fetched when this tab is opened.

const cssVar = (name, fallback) => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
};
const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

export default function DependencyMap({ data, onOpenTool }) {
  const boxRef = useRef(null);
  const fgRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [hideIso, setHideIso] = useState(false);
  const [sel, setSel] = useState(null);
  const still = useMemo(reducedMotion, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const graph = useMemo(() => {
    const tools = data.tools || [];
    const edges = data.edges || [];
    const linked = new Set(edges.flatMap((e) => [e.a, e.b]));
    const nodes = tools.filter((t) => !hideIso || linked.has(t.id)).map((t) => ({ id: t.id, label: t.label, score: t.score, size: toolLines(t) }));
    const ids = new Set(nodes.map((n) => n.id));
    const max = Math.max(1, ...nodes.map((n) => n.size));
    for (const n of nodes) n.r = 4 + 24 * Math.sqrt(n.size / max);
    const links = edges.filter((e) => ids.has(e.a) && ids.has(e.b)).map((e) => ({
      source: e.a, target: e.b, api: (e.api || []).length > 0, w: (e.api || []).length + Math.min(e.n || 0, 6),
    }));
    return { nodes, links };
  }, [data, hideIso]);

  const neighbours = useMemo(() => {
    if (!sel) return null;
    const nb = new Set([sel]);
    for (const l of graph.links) {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      if (s === sel) nb.add(t);
      if (t === sel) nb.add(s);
    }
    return nb;
  }, [sel, graph]);

  const fitted = useRef(false);
  useEffect(() => {
    fitted.current = false; // fit again when the set of tools changes
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('charge')?.strength(-260);
    fg.d3Force('link')?.distance(110);
    // a gentle pull to the middle so tools with no links do not drift off (the prototype's forceX/forceY, written by hand: no new package)
    let nodes = [];
    const gravity = (alpha) => { for (const n of nodes) { n.vx -= n.x * 0.06 * alpha; n.vy -= n.y * 0.08 * alpha; } };
    gravity.initialize = (ns) => { nodes = ns; };
    fg.d3Force('gravity', gravity);
    fg.d3ReheatSimulation?.();
  }, [graph]);
  const fit = () => {
    if (fitted.current || !fgRef.current) return;
    fitted.current = true;
    fgRef.current.zoomToFit(still ? 0 : 400, 40);
  };

  // keep the selection only while that tool is on the map
  useEffect(() => { if (sel && !graph.nodes.some((n) => n.id === sel)) setSel(null); }, [graph, sel]);

  const colors = useMemo(() => ({
    text: cssVar('--color-text', '#222'), surface: cssVar('--color-surface', '#fff'), muted: cssVar('--color-muted', '#777'), primary: cssVar('--color-primary', '#9B5B46'),
  }), [data]); // re-read when a run loads; a theme change takes effect on the next visit to the tab

  const endId = (x) => (typeof x === 'object' ? x.id : x);
  const linkOn = (l) => !sel || endId(l.source) === sel || endId(l.target) === sel;

  const clickNode = (n) => {
    if (sel === n.id) onOpenTool(n.id);
    else setSel(n.id);
  };

  const sorted = useMemo(() => [...graph.nodes].sort((a, b) => a.label.localeCompare(b.label)), [graph]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--color-muted)' }}>
          <span className="inline-flex items-center gap-1.5"><svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeOpacity=".6" /></svg>calls its API</span>
          <span className="inline-flex items-center gap-1.5"><svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--color-primary)" strokeDasharray="4 3" /></svg>shares code files</span>
          <span>circle size = lines of code · colour = rules score (
            <span style={{ color: STATUS_COLOR.pass }}>90+</span>, <span style={{ color: STATUS_COLOR.warn }}>70+</span>, <span style={{ color: STATUS_COLOR.fail }}>below 70</span>)</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Tooltip text="Highlight one tool's links, the same as clicking it on the map (for the keyboard).">
            <select
              value={sel || ''} onChange={(e) => setSel(e.target.value || null)} aria-label="Highlight a tool"
              className="px-3 py-1.5 rounded-xl border text-sm"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              <option value="">Highlight a tool…</option>
              {sorted.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
          </Tooltip>
          {sel && (
            <Tooltip text="Open the highlighted tool's detail.">
              <button type="button" onClick={() => onOpenTool(sel)} className="text-sm px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Open</button>
            </Tooltip>
          )}
          <Tooltip text="Leave out tools that neither call another tool's API nor share code with one.">
            <label className="text-sm inline-flex items-center gap-1.5 cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={hideIso} onChange={(e) => setHideIso(e.target.checked)} />
              Hide tools with no links
            </label>
          </Tooltip>
        </div>
      </div>
      <div
        ref={boxRef}
        className="relative rounded-xl border overflow-hidden h-[70vh] min-h-[480px]"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        role="img"
        aria-label={`Map of ${graph.nodes.length} tools and ${graph.links.length} links between them. The Tools and Conventions tabs list the same tools as text.`}
        data-tour="cm-map"
      >
        <ForceGraph2D
          ref={fgRef}
          graphData={graph}
          width={size.w}
          height={size.h}
          backgroundColor="rgba(0,0,0,0)"
          autoPauseRedraw={false}
          warmupTicks={still ? 300 : 0}
          cooldownTicks={still ? 0 : 200}
          nodeLabel={(n) => `${n.label}: ${n.score}% of rules, ${fmt(n.size)} lines`}
          nodeCanvasObject={(n, ctx, scale) => {
            const faded = neighbours && !neighbours.has(n.id);
            ctx.globalAlpha = faded ? 0.12 : 1;
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.r, 0, 2 * Math.PI);
            ctx.fillStyle = scoreColor(n.score);
            ctx.fill();
            ctx.lineWidth = (n.id === sel ? 3 : 1.5) / scale;
            ctx.strokeStyle = n.id === sel ? colors.text : colors.surface;
            ctx.stroke();
            const fs = 11 / scale;
            ctx.font = `${fs}px sans-serif`;
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 3 / scale;
            ctx.strokeStyle = colors.surface;
            ctx.strokeText(n.label, n.x + n.r + 3 / scale, n.y);
            ctx.fillStyle = colors.text;
            ctx.fillText(n.label, n.x + n.r + 3 / scale, n.y);
            ctx.globalAlpha = 1;
          }}
          nodePointerAreaPaint={(n, color, ctx) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.r + 2, 0, 2 * Math.PI);
            ctx.fill();
          }}
          linkColor={(l) => {
            const a = linkOn(l) ? (l.api ? 0.55 : 0.7) : 0.06;
            const hex = l.api ? colors.muted : colors.primary;
            return hexAlpha(hex, a);
          }}
          linkWidth={(l) => 1 + Math.min(l.w, 4) * 0.5}
          linkLineDash={(l) => (l.api ? null : [4, 3])}
          onNodeClick={clickNode}
          onBackgroundClick={() => setSel(null)}
          onEngineStop={fit}
        />
        <div className="absolute left-3 bottom-2.5 text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}>
          Drag to move · scroll to zoom · click a tool to highlight its links, click again to open it
        </div>
      </div>
    </div>
  );
}

// "#rrggbb" (or any CSS colour the canvas understands) at an opacity
function hexAlpha(c, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(c || '');
  if (!m) return c;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
