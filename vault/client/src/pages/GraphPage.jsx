import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ForceGraph2D from 'react-force-graph-2d';
import { useIcon } from '../providers/IconProvider';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';

// ── Constants ─────────────────────────────────────────────────────────────────

const NODE_COLORS = {
  project: '#6366f1',
  file:    '#3b82f6',
  note:    '#f59e0b',
  session: '#22c55e',
  task:    '#f97316',
  goal:    '#a855f7',
  url:     '#14b8a6',
};

const NODE_SIZES = {
  project: 16,
  file:    7,
  note:    7,
  session: 8,
  task:    8,
  goal:    10,
  url:     6,
};

const LABEL_ZOOM_THRESHOLD = 0.55; // hide labels when zoomed out past this

const LINK_COLORS = {
  contains:   'rgba(148,163,184,0.35)',
  subtask:    'rgba(249,115,22,0.55)',
  branch:     'rgba(20,184,166,0.55)',
  created:    'rgba(34,197,94,0.55)',
  tracks:     'rgba(168,85,247,0.55)',
  key_result: 'rgba(168,85,247,0.65)',
  blocks:     'rgba(239,68,68,0.55)',
};

const SEMANTIC_COLOR = '#ec4899'; // pink — dashed lines

const NODE_LABELS = {
  project: 'Project',
  file:    'File',
  note:    'Note',
  session: 'Chat Session',
  task:    'Task',
  goal:    'Goal',
  url:     'Pinned URL',
};

const FILTER_ORDER = ['project', 'file', 'note', 'session', 'task', 'goal', 'url'];

// ── SSE reader ────────────────────────────────────────────────────────────────

async function readSSEStream(res, onEvent) {
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer    = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') { reader.cancel(); return; }
          try { onEvent(JSON.parse(raw)); } catch (_) {}
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

// ── Canvas drawing helpers ────────────────────────────────────────────────────

function drawShape(ctx, type, x, y, r) {
  ctx.beginPath();
  switch (type) {
    case 'project':
    case 'session':
    case 'url':
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      break;
    case 'file': {
      const w = r * 1.7, h = r * 1.3;
      ctx.rect(x - w / 2, y - h / 2, w, h);
      break;
    }
    case 'note': {
      const w = r * 1.7, h = r * 1.3, rad = Math.min(3, r * 0.4);
      if (ctx.roundRect) {
        ctx.roundRect(x - w / 2, y - h / 2, w, h, rad);
      } else {
        ctx.rect(x - w / 2, y - h / 2, w, h);
      }
      break;
    }
    case 'task': {
      ctx.moveTo(x, y - r * 1.1);
      ctx.lineTo(x + r * 1.1, y);
      ctx.lineTo(x, y + r * 1.1);
      ctx.lineTo(x - r * 1.1, y);
      ctx.closePath();
      break;
    }
    case 'goal': {
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const px = x + r * Math.cos(angle);
        const py = y + r * Math.sin(angle);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    default:
      ctx.arc(x, y, r, 0, 2 * Math.PI);
  }
}

// ── Mock dataset for scale testing (50 nodes) ────────────────────────────────

const MOCK_DATA = (() => {
  const nodes = [];
  const edges = [];

  const projects = [
    { id: 'project_1', label: 'Website Redesign' },
    { id: 'project_2', label: 'Mobile App' },
    { id: 'project_3', label: 'Marketing Campaign' },
    { id: 'project_4', label: 'Internal Tools' },
    { id: 'project_5', label: 'Research Project' },
  ];
  projects.forEach(p => nodes.push({ ...p, type: 'project', url: '/' }));

  const children = [
    // files
    { id: 'file_1',    type: 'file',    label: 'Design Brief.pdf',         meta: { projectId: 1 } },
    { id: 'file_2',    type: 'file',    label: 'Wireframes v3.fig',         meta: { projectId: 1 } },
    { id: 'file_3',    type: 'file',    label: 'API Spec.md',               meta: { projectId: 2 } },
    { id: 'file_4',    type: 'file',    label: 'User Research.pdf',         meta: { projectId: 2 } },
    { id: 'file_5',    type: 'file',    label: 'Brand Guidelines.pdf',      meta: { projectId: 3 } },
    { id: 'file_6',    type: 'file',    label: 'Budget Forecast.xlsx',      meta: { projectId: 3 } },
    { id: 'file_7',    type: 'file',    label: 'Onboarding Flow.pdf',       meta: { projectId: 4 } },
    { id: 'file_8',    type: 'file',    label: 'Competitor Analysis.docx',  meta: { projectId: 5 } },
    // sessions
    { id: 'session_1', type: 'session', label: 'Landing page copy',         meta: { projectId: 1 } },
    { id: 'session_2', type: 'session', label: 'Nav structure discussion',  meta: { projectId: 1 } },
    { id: 'session_3', type: 'session', label: 'Push notification UX',      meta: { projectId: 2 } },
    { id: 'session_4', type: 'session', label: 'Campaign messaging',        meta: { projectId: 3 } },
    { id: 'session_5', type: 'session', label: 'Automation ideas',          meta: { projectId: 4 } },
    { id: 'session_6', type: 'session', label: 'Market sizing',             meta: { projectId: 5 } },
    { id: 'session_7', type: 'session', label: 'General brainstorm',        meta: {} },
    // tasks
    { id: 'task_1',    type: 'task',    label: 'Redesign homepage',         meta: { projectId: 1 } },
    { id: 'task_2',    type: 'task',    label: 'Build component library',   meta: { projectId: 1 } },
    { id: 'task_3',    type: 'task',    label: 'Auth screen mockups',       meta: { projectId: 2 } },
    { id: 'task_4',    type: 'task',    label: 'Write email sequence',      meta: { projectId: 3 } },
    { id: 'task_5',    type: 'task',    label: 'Set up CI pipeline',        meta: { projectId: 4 } },
    { id: 'task_6',    type: 'task',    label: 'Interview 5 users',         meta: { projectId: 5 } },
    { id: 'task_7',    type: 'task',    label: 'Update docs',               meta: {} },
    // notes
    { id: 'note_1',    type: 'note',    label: 'UX principles',             meta: { projectId: 1 } },
    { id: 'note_2',    type: 'note',    label: 'Typography choices',        meta: { projectId: 1 } },
    { id: 'note_3',    type: 'note',    label: 'Accessibility checklist',   meta: {} },
    { id: 'note_4',    type: 'note',    label: 'Mobile patterns to avoid',  meta: { projectId: 2 } },
    { id: 'note_5',    type: 'note',    label: 'SEO strategy notes',        meta: { projectId: 3 } },
    { id: 'note_6',    type: 'note',    label: 'Hiring criteria',           meta: {} },
    // goals
    { id: 'goal_1',    type: 'goal',    label: 'Grow organic traffic 40%',  meta: {} },
    { id: 'goal_2',    type: 'goal',    label: 'Launch mobile app Q3',      meta: {} },
    { id: 'kr_1',      type: 'goal',    label: 'KR: 10k monthly visits',    meta: {} },
    { id: 'kr_2',      type: 'goal',    label: 'KR: App store rating 4.5+', meta: {} },
    // urls
    { id: 'url_1',     type: 'url',     label: 'Figma workspace',           meta: { projectId: 1 }, url: '#', external: true },
    { id: 'url_2',     type: 'url',     label: 'Analytics dashboard',       meta: { projectId: 3 }, url: '#', external: true },
    { id: 'url_3',     type: 'url',     label: 'Design system docs',        meta: {},                url: '#', external: true },
  ];
  children.forEach(c => nodes.push({ ...c, url: c.url || '/' }));

  // Explicit edges
  const contains = [
    ['project_1','file_1'],['project_1','file_2'],['project_1','session_1'],
    ['project_1','session_2'],['project_1','task_1'],['project_1','task_2'],
    ['project_1','note_1'],['project_1','note_2'],['project_1','url_1'],
    ['project_2','file_3'],['project_2','file_4'],['project_2','session_3'],
    ['project_2','task_3'],['project_2','note_4'],
    ['project_3','file_5'],['project_3','file_6'],['project_3','session_4'],
    ['project_3','task_4'],['project_3','note_5'],['project_3','url_2'],
    ['project_4','file_7'],['project_4','session_5'],['project_4','task_5'],
    ['project_5','file_8'],['project_5','session_6'],['project_5','task_6'],
  ];
  contains.forEach(([s, t]) => edges.push({ source: s, target: t, type: 'contains' }));

  // Goal/KR edges
  edges.push({ source: 'kr_1', target: 'goal_1', type: 'key_result' });
  edges.push({ source: 'kr_2', target: 'goal_2', type: 'key_result' });
  edges.push({ source: 'task_4', target: 'kr_1', type: 'tracks' });
  edges.push({ source: 'task_3', target: 'kr_2', type: 'tracks' });
  edges.push({ source: 'task_2', target: 'task_1', type: 'subtask' });

  // Semantic edges (cross-project)
  const semantic = [
    ['file_1', 'file_5', 0.91],
    ['note_1', 'note_4', 0.88],
    ['session_1', 'note_5', 0.85],
    ['file_3', 'file_7', 0.84],
    ['note_3', 'note_1', 0.87],
    ['session_3', 'note_4', 0.83],
    ['file_8', 'file_4', 0.86],
    ['session_6', 'session_5', 0.84],
    ['note_5', 'session_4', 0.89],
    ['file_5', 'note_5', 0.88],
  ];
  semantic.forEach(([s, t, sim]) => edges.push({ source: s, target: t, type: 'semantic', similarity: sim }));

  return { nodes, edges, semanticCount: semantic.length };
})();

// ── Deterministic position spread (no Math.random — stable across re-renders) ─

function nodeAngle(id, total, index) {
  // Use node index for even angular distribution; type-group by hashing id prefix
  return (index / Math.max(total, 1)) * 2 * Math.PI;
}

// ── Inline forceCollide (avoids needing d3-force as a direct dep) ─────────────

function forceCollide(radiusFn) {
  let nodes = [];
  function force(alpha) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const ri = radiusFn(a) + radiusFn(b);
        const dx = (b.x ?? 0) - (a.x ?? 0);
        const dy = (b.y ?? 0) - (a.y ?? 0);
        const d2 = dx * dx + dy * dy;
        if (d2 < ri * ri) {
          const d = Math.sqrt(d2) || 1e-6;
          const push = (ri - d) / d * alpha * 0.5;
          const mx = dx * push, my = dy * push;
          a.vx -= mx; a.vy -= my;
          b.vx += mx; b.vy += my;
        }
      }
    }
  }
  force.initialize = n => { nodes = n; };
  return force;
}

// ── GraphPage ─────────────────────────────────────────────────────────────────

function GraphPage() {
  const navigate = useNavigate();
  const getIcon  = useIcon();
  const fgRef    = useRef(null);
  const containerRef = useRef(null);

  // ── Data state ────────────────────────────────────────────────────────────
  const [rawData,   setRawData]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [loadError, setLoadError] = useState('');

  // ── Semantic compute state ────────────────────────────────────────────────
  const [computing,       setComputing]       = useState(false);
  const [computeProgress, setComputeProgress] = useState(null); // {stage, message, percent}
  const [computeError,    setComputeError]    = useState('');

  // ── UI state ──────────────────────────────────────────────────────────────
  const [selectedNode, setSelectedNode] = useState(null);
  const [search,       setSearch]       = useState('');
  const [showFilters,  setShowFilters]  = useState(false);
  const [showSemantic, setShowSemantic] = useState(true);
  const [filters, setFilters] = useState(
    Object.fromEntries(FILTER_ORDER.map(t => [t, true]))
  );
  const [dimensions,  setDimensions]  = useState({ width: 800, height: 600 });
  const [useMockData, setUseMockData] = useState(false);

  // ── Insights state ────────────────────────────────────────────────────────
  const [insights,        setInsights]        = useState(null); // { insights: [...], generatedAt }
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError,   setInsightsError]   = useState('');
  const [showInsights,    setShowInsights]    = useState(false);
  const [focusActive,     setFocusActive]     = useState(false); // triggers canvas refresh

  // ── Refs for canvas ───────────────────────────────────────────────────────
  const hoveredNodeIdRef  = useRef(null);
  const selectedNodeIdRef = useRef(null);
  const searchRef         = useRef('');
  const focusNodeIdsRef   = useRef(null); // Set<string> or null
  const nodePositionsRef  = useRef(new Map()); // id → {x, y} — persists across filter changes

  useEffect(() => { searchRef.current = search; }, [search]);

  // ── Fetch graph data ──────────────────────────────────────────────────────
  const loadGraph = useCallback(() => {
    api.get('/api/graph')
      .then(r => r.json())
      .then(data => { setRawData(data); setLoading(false); })
      .catch(err => { setLoadError(err.message); setLoading(false); });
  }, []);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  // ── Insights ──────────────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/api/graph/insights')
      .then(r => r.json())
      .then(d => { if (d.insights?.length > 0) setInsights(d); })
      .catch(() => {});
  }, []);

  const handleRefreshInsights = useCallback(async () => {
    setInsightsLoading(true);
    setInsightsError('');
    try {
      const r    = await api.post('/api/graph/insights/refresh');
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setInsights(data);
    } catch (err) {
      setInsightsError(err.message || 'Failed to generate insights');
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  // ── Container resize — read eagerly on mount, then track changes ──────────
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    if (width > 0 && height > 0) setDimensions({ width, height });
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDimensions({ width, height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // ── Filtered graph data — positions seeded HERE before ForceGraph2D sees data ─
  const sourceData = useMockData ? MOCK_DATA : rawData;

  const filteredData = useMemo(() => {
    if (!sourceData) return { nodes: [], links: [] };

    const activeTypes = new Set(FILTER_ORDER.filter(t => filters[t]));
    const rawNodes = sourceData.nodes.filter(n => activeTypes.has(n.type));
    const total = rawNodes.length;

    // Spread radius scales with node count so nodes start with breathing room
    const spread = Math.max(150, Math.sqrt(total) * 65);

    const nodes = rawNodes.map((n, i) => {
      const cached = nodePositionsRef.current.get(n.id);
      if (cached) {
        // Reuse last known position from a previous simulation tick
        return { ...n, x: cached.x, y: cached.y };
      }
      // First time: place on a circle with project nodes at inner ring,
      // leaf nodes on an outer ring — deterministic, no Math.random
      const isProject = n.type === 'project';
      const r = isProject ? spread * 0.4 : spread;
      const angle = nodeAngle(n.id, total, i);
      return { ...n, x: Math.cos(angle) * r, y: Math.sin(angle) * r };
    });

    const nodeIdSet = new Set(nodes.map(n => n.id));
    const links = sourceData.edges
      .filter(e => {
        if (!nodeIdSet.has(e.source) || !nodeIdSet.has(e.target)) return false;
        if (e.type === 'semantic' && !showSemantic) return false;
        return true;
      })
      .map(e => ({ source: e.source, target: e.target, type: e.type, similarity: e.similarity }));

    return { nodes, links };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceData, filters, showSemantic]);

  // ── Focus helpers (depend on filteredData) ───────────────────────────────
  const handleShowMe = useCallback((nodeIds) => {
    if (!nodeIds?.length) return;
    focusNodeIdsRef.current = new Set(nodeIds);
    setFocusActive(true);
    fgRef.current?.zoomToFit(400, 80, n => focusNodeIdsRef.current.has(n.id));
  }, []);

  const clearFocus = useCallback(() => {
    focusNodeIdsRef.current = null;
    setFocusActive(false);
  }, []);

  // ── Adjacency map ─────────────────────────────────────────────────────────
  const adjacencyRef = useRef({});
  useEffect(() => {
    const adj = {};
    filteredData.links.forEach(link => {
      const src = typeof link.source === 'object' ? link.source.id : link.source;
      const tgt = typeof link.target === 'object' ? link.target.id : link.target;
      if (!adj[src]) adj[src] = new Set();
      if (!adj[tgt]) adj[tgt] = new Set();
      adj[src].add(tgt);
      adj[tgt].add(src);
    });
    adjacencyRef.current = adj;
  }, [filteredData]);

  // ── Save node positions after each simulation tick ────────────────────────
  // This lets filteredData reuse last-known positions when filters change,
  // so nodes don't teleport back to the circle on a filter toggle.
  const handleNodeTick = useCallback(() => {
    for (const node of filteredData.nodes) {
      if (node.x !== undefined && node.y !== undefined) {
        nodePositionsRef.current.set(node.id, { x: node.x, y: node.y });
      }
    }
  }, [filteredData.nodes]);

  // ── Force simulation config ───────────────────────────────────────────────
  // Positions are already seeded in filteredData useMemo — this effect only
  // configures force strengths and distances, scaled logarithmically so the
  // graph looks good at 5 nodes, 20 nodes, and 50+ nodes without manual tuning.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    const n = Math.max(filteredData.nodes.length, 1);
    // log scaling: grows quickly for small n, levels off for large n
    const logN = Math.log(n + 1);

    // Repulsion: projects push ~2× harder than leaf nodes
    fg.d3Force('charge').strength(node =>
      node.type === 'project' ? -35 * logN * 2 : -35 * logN
    );

    // Link distances
    fg.d3Force('link')
      .distance(link => {
        const base = 25 * logN + 30;
        if (link.type === 'contains')   return base;
        if (link.type === 'semantic')   return base * 0.75;
        if (link.type === 'key_result') return base * 0.85;
        return base * 0.65;
      })
      .strength(link => link.type === 'semantic' ? 0.08 : 0.6);

    // Collision: node radius + breathing room, also log-scaled
    fg.d3Force('collide', forceCollide(node =>
      (NODE_SIZES[node.type] ?? 7) + 8 + logN * 1.5
    ));

    // No d3ReheatSimulation() here — positions were already seeded in the memo,
    // so the simulation starts cold from good positions rather than re-exploding.
  }, [filteredData]);

  // ── Semantic compute ──────────────────────────────────────────────────────
  const handleCompute = useCallback(async () => {
    setComputing(true);
    setComputeError('');
    setComputeProgress({ stage: 'init', message: 'Starting…', percent: 0 });
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch('/api/graph/compute-semantic', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Compute failed');
      }
      await readSSEStream(res, (event) => {
        setComputeProgress(event);
        if (event.stage === 'complete') {
          // Reload graph to pull in new semantic edges
          setTimeout(() => {
            api.get('/api/graph').then(r => r.json()).then(setRawData).catch(() => {});
          }, 600);
        }
        if (event.stage === 'error') {
          setComputeError(event.message);
        }
      });
    } catch (err) {
      setComputeError(err.message || 'Compute failed');
      setComputeProgress(null);
    } finally {
      setComputing(false);
    }
  }, []);

  // ── Canvas: draw nodes ────────────────────────────────────────────────────
  const nodeCanvasObject = useCallback((node, ctx, globalScale) => {
    const { x, y, id, type, label } = node;
    const r     = NODE_SIZES[type] ?? 7;
    const color = NODE_COLORS[type] ?? '#888';

    const isHovered     = hoveredNodeIdRef.current === id;
    const isSelected    = selectedNodeIdRef.current === id;
    const hoverActive   = hoveredNodeIdRef.current !== null;
    const adj           = adjacencyRef.current[hoveredNodeIdRef.current];
    const isAdjacent    = adj ? adj.has(id) : false;
    const isHighlighted = isHovered || isAdjacent;
    const isFocused     = focusNodeIdsRef.current ? focusNodeIdsRef.current.has(id) : true;
    const isDimmed      = (hoverActive && !isHighlighted) || (!hoverActive && focusNodeIdsRef.current && !isFocused);

    const q             = searchRef.current.trim().toLowerCase();
    const isSearchMatch = q.length > 0 && label.toLowerCase().includes(q);

    ctx.save();
    ctx.globalAlpha = isDimmed ? 0.15 : 1;

    if (isHovered || isSelected || isSearchMatch) {
      ctx.shadowColor = isSearchMatch ? '#fbbf24' : color;
      ctx.shadowBlur  = 12;
    }

    drawShape(ctx, type, x, y, r);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = isSelected
      ? '#ffffff'
      : isHovered
      ? 'rgba(255,255,255,0.9)'
      : isSearchMatch
      ? '#fbbf24'
      : 'rgba(255,255,255,0.2)';
    ctx.lineWidth = isSelected || isHovered ? 2 : 1;
    drawShape(ctx, type, x, y, r);
    ctx.stroke();

    if (isSelected) {
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }

    // Only render label if zoomed in enough, or node is actively highlighted
    const alwaysShow = isHovered || isSelected || isSearchMatch;
    if (globalScale >= LABEL_ZOOM_THRESHOLD || alwaysShow) {
      const fontSize = Math.max(6, 8.5 / Math.sqrt(globalScale));
      ctx.font         = `${fontSize}px Inter, system-ui, sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      const maxLen = 20;
      const displayLabel = label.length > maxLen ? label.slice(0, maxLen - 1) + '…' : label;
      const labelY = y + r + 4;

      if (!isDimmed) {
        const textWidth = ctx.measureText(displayLabel).width;
        const padX = 3, padY = 1.5;
        const bgX = x - textWidth / 2 - padX;
        const bgY = labelY - padY;
        const bgW = textWidth + padX * 2;
        const bgH = fontSize + padY * 2;
        const rad = 2;
        ctx.beginPath();
        ctx.moveTo(bgX + rad, bgY);
        ctx.lineTo(bgX + bgW - rad, bgY);
        ctx.arcTo(bgX + bgW, bgY, bgX + bgW, bgY + rad, rad);
        ctx.lineTo(bgX + bgW, bgY + bgH - rad);
        ctx.arcTo(bgX + bgW, bgY + bgH, bgX + bgW - rad, bgY + bgH, rad);
        ctx.lineTo(bgX + rad, bgY + bgH);
        ctx.arcTo(bgX, bgY + bgH, bgX, bgY + bgH - rad, rad);
        ctx.lineTo(bgX, bgY + rad);
        ctx.arcTo(bgX, bgY, bgX + rad, bgY, rad);
        ctx.closePath();
        ctx.fillStyle = alwaysShow ? 'rgba(0,0,0,0.78)' : 'rgba(0,0,0,0.55)';
        ctx.fill();
      }

      ctx.fillStyle = isDimmed
        ? 'rgba(255,255,255,0.15)'
        : isSearchMatch
        ? '#fbbf24'
        : 'rgba(255,255,255,1)';
      ctx.fillText(displayLabel, x, labelY);
    }

    ctx.restore();
  }, []);

  // ── Canvas: draw semantic links as dashed lines ───────────────────────────
  const linkCanvasObjectMode = useCallback(
    (link) => link.type === 'semantic' ? 'replace' : undefined,
    []
  );

  const linkCanvasObject = useCallback((link, ctx) => {
    if (link.type !== 'semantic') return;
    const src = link.source;
    const tgt = link.target;
    if (!src || !tgt || typeof src !== 'object' || typeof tgt !== 'object') return;

    const hovId       = hoveredNodeIdRef.current;
    const srcId       = src.id;
    const tgtId       = tgt.id;
    const isConnected = !hovId || srcId === hovId || tgtId === hovId;
    const focusSet    = focusNodeIdsRef.current;
    const inFocus     = !focusSet || (focusSet.has(srcId) && focusSet.has(tgtId));

    ctx.save();
    ctx.globalAlpha = !hovId && inFocus ? 0.45 : isConnected && inFocus ? 0.9 : 0.04;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(tgt.x, tgt.y);
    ctx.strokeStyle = SEMANTIC_COLOR;
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }, []);

  // ── Node pointer area ─────────────────────────────────────────────────────
  const nodePointerAreaPaint = useCallback((node, color, ctx) => {
    const r = (NODE_SIZES[node.type] ?? 7) + 3;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  // ── Hover ─────────────────────────────────────────────────────────────────
  const handleNodeHover = useCallback((node) => {
    hoveredNodeIdRef.current = node ? node.id : null;
  }, []);

  // ── Explicit link colour (semantic handled by linkCanvasObject) ───────────
  const getLinkColor = useCallback((link) => {
    if (link.type === 'semantic') return 'transparent';
    const hovId = hoveredNodeIdRef.current;
    if (!hovId) return LINK_COLORS[link.type] ?? 'rgba(148,163,184,0.3)';
    const src = typeof link.source === 'object' ? link.source.id : link.source;
    const tgt = typeof link.target === 'object' ? link.target.id : link.target;
    if (src === hovId || tgt === hovId) return LINK_COLORS[link.type] ?? 'rgba(148,163,184,0.7)';
    return 'rgba(148,163,184,0.04)';
  }, []);

  const getLinkWidth = useCallback((link) => {
    if (link.type === 'semantic') return 0;
    const hovId = hoveredNodeIdRef.current;
    if (!hovId) return 1;
    const src = typeof link.source === 'object' ? link.source.id : link.source;
    const tgt = typeof link.target === 'object' ? link.target.id : link.target;
    if (src === hovId || tgt === hovId) return 2;
    return 0.5;
  }, []);

  // ── Click ─────────────────────────────────────────────────────────────────
  const handleNodeClick = useCallback((node) => {
    const next = selectedNodeIdRef.current === node.id ? null : node.id;
    setSelectedNode(next ? node : null);
    selectedNodeIdRef.current = next;
  }, []);

  const handleBackgroundClick = useCallback(() => {
    setSelectedNode(null);
    selectedNodeIdRef.current = null;
    focusNodeIdsRef.current = null;
    setFocusActive(false);
  }, []);

  // ── Navigate from side panel ──────────────────────────────────────────────
  const handleGoTo = useCallback((node) => {
    if (!node) return;
    if (node.external) {
      window.open(node.url, '_blank', 'noopener,noreferrer');
    } else {
      navigate(node.url);
    }
  }, [navigate]);

  // ── Derived counts ────────────────────────────────────────────────────────
  const nodeCount     = filteredData.nodes.length;
  const edgeCount     = filteredData.links.length;
  const semanticCount = sourceData?.semanticCount ?? 0;
  const computeDone   = computeProgress?.stage === 'complete';

  // ── Loading / error / empty ───────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: 'var(--color-muted)' }}>
        <div className="text-center space-y-3">
          <div className="text-3xl animate-pulse">🕸</div>
          <p className="text-sm">Building knowledge graph…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm" style={{ color: '#ef4444' }}>{loadError}</p>
      </div>
    );
  }

  if (sourceData && sourceData.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: 'var(--color-muted)' }}>
        <div className="text-center space-y-3 max-w-xs">
          <div className="text-4xl">🕸</div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>No content yet</p>
          <p className="text-xs">Create projects, add files, take notes, or start a chat — your knowledge graph will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--color-bg)' }}>

      {/* ── Graph canvas ─────────────────────────────────────────────────── */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">

        {/* Top toolbar */}
        <div
          className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 px-3 py-2 flex-wrap"
          style={{ background: 'linear-gradient(to bottom, var(--color-bg) 70%, transparent)' }}
        >
          {/* Search */}
          <div className="relative flex-1 min-w-0" style={{ maxWidth: 220 }}>
            <span
              className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--color-muted)' }}
            >
              {getIcon('search', { size: 13 })}
            </span>
            <input
              type="text"
              placeholder="Search nodes…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-7 pr-3 py-1.5 rounded-lg border text-xs outline-none"
              style={{
                background: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)',
              }}
            />
          </div>

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs flex-shrink-0"
            style={{
              background: showFilters
                ? 'color-mix(in srgb, var(--color-primary) 12%, var(--color-surface))'
                : 'var(--color-surface)',
              borderColor: showFilters ? 'var(--color-primary)' : 'var(--color-border)',
              color: showFilters ? 'var(--color-primary)' : 'var(--color-muted)',
            }}
          >
            {getIcon('settings', { size: 13 })}
            Filter
          </button>

          {/* Insights button */}
          <button
            onClick={() => setShowInsights(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs flex-shrink-0"
            style={{
              background: showInsights
                ? 'color-mix(in srgb, #f59e0b 12%, var(--color-surface))'
                : 'var(--color-surface)',
              borderColor: showInsights ? '#f59e0b' : 'var(--color-border)',
              color: showInsights ? '#f59e0b' : 'var(--color-muted)',
            }}
            title="AI-generated insights about your knowledge graph"
          >
            {getIcon('lightbulb', { size: 13 })}
            Insights
            {insights?.insights?.length > 0 && (
              <span
                className="inline-flex items-center justify-center w-4 h-4 rounded-full text-xs font-bold text-white"
                style={{ background: '#f59e0b', fontSize: 10 }}
              >
                {insights.insights.length}
              </span>
            )}
          </button>

          {/* Semantic compute button */}
          {!computing && (
            <button
              onClick={handleCompute}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs flex-shrink-0"
              style={{
                background: semanticCount > 0 ? 'var(--color-surface)' : 'color-mix(in srgb, #ec4899 12%, var(--color-surface))',
                borderColor: '#ec4899',
                color: '#ec4899',
              }}
              title="Find semantic connections between files, notes and sessions using AI embeddings"
            >
              {getIcon('share-2', { size: 13 })}
              {semanticCount > 0 ? 'Re-compute' : 'Find connections'}
            </button>
          )}

          {/* Semantic toggle (show when connections exist) */}
          {semanticCount > 0 && !computing && (
            <label className="flex items-center gap-1.5 text-xs cursor-pointer flex-shrink-0" style={{ color: '#ec4899' }}>
              <input
                type="checkbox"
                checked={showSemantic}
                onChange={() => setShowSemantic(v => !v)}
                style={{ accentColor: '#ec4899' }}
              />
              {semanticCount} semantic
            </label>
          )}

          {/* Node/edge count */}
          <span className="text-xs ml-auto flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
            {nodeCount.toLocaleString()} nodes · {edgeCount.toLocaleString()} connections
          </span>

          {/* Mock data toggle — for scale testing */}
          <button
            onClick={() => {
              nodePositionsRef.current.clear();
              setUseMockData(v => !v);
            }}
            className="flex-shrink-0 text-xs px-2 py-1 rounded border transition-opacity hover:opacity-70"
            style={{
              borderColor: useMockData ? '#f59e0b' : 'var(--color-border)',
              color:        useMockData ? '#f59e0b' : 'var(--color-muted)',
              background:   useMockData ? 'rgba(245,158,11,0.08)' : 'transparent',
            }}
            title="Toggle 50-node mock dataset for layout testing"
          >
            {useMockData ? '⚗ Mock' : '⚗ Test'}
          </button>
        </div>

        {/* Compute progress bar */}
        {computing && computeProgress && (
          <div
            className="absolute top-11 left-3 right-3 z-10 rounded-xl border p-3 space-y-2"
            style={{ background: 'var(--color-surface)', borderColor: '#ec4899' }}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs" style={{ color: computeProgress.stage === 'error' ? '#ef4444' : 'var(--color-muted)' }}>
                {computeProgress.message}
              </p>
              <span className="text-xs font-medium" style={{ color: '#ec4899' }}>
                {computeProgress.percent ?? 0}%
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${computeProgress.percent ?? 0}%`, background: '#ec4899' }}
              />
            </div>
          </div>
        )}

        {/* Compute result flash */}
        {!computing && computeDone && (
          <div
            className="absolute top-11 left-3 z-10 rounded-xl border px-3 py-2 text-xs"
            style={{ background: 'var(--color-surface)', borderColor: '#ec4899', color: '#ec4899' }}
          >
            {computeProgress.message}
          </div>
        )}

        {/* Compute error */}
        {computeError && !computing && (
          <div
            className="absolute top-11 left-3 z-10 rounded-xl border px-3 py-2 text-xs"
            style={{ background: 'var(--color-surface)', borderColor: '#ef4444', color: '#ef4444' }}
          >
            {computeError}
          </div>
        )}

        {/* Filter panel */}
        {showFilters && (
          <div
            className="absolute z-10 rounded-xl border p-3 space-y-2"
            style={{
              top: (computing && computeProgress) ? 88 : 44,
              left: 12,
              background: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              minWidth: 180,
            }}
          >
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
              Show node types
            </p>
            {FILTER_ORDER.map(type => (
              <label key={type} className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters[type]}
                  onChange={() => setFilters(prev => ({ ...prev, [type]: !prev[type] }))}
                  className="rounded"
                  style={{ accentColor: NODE_COLORS[type] }}
                />
                <span className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
                  <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: NODE_COLORS[type] }} />
                  {NODE_LABELS[type]}
                </span>
              </label>
            ))}
          </div>
        )}

        {/* Insights panel */}
        {showInsights && (
          <div
            className="absolute z-10 flex flex-col rounded-xl border overflow-hidden"
            style={{
              top: 44,
              right: 12,
              width: 280,
              maxHeight: 'calc(100% - 60px)',
              background: 'var(--color-surface)',
              borderColor: '#f59e0b',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-3 py-2.5 border-b flex-shrink-0"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <span className="text-xs font-semibold" style={{ color: '#f59e0b' }}>
                {getIcon('lightbulb', { size: 13 })} Insights
              </span>
              <div className="flex items-center gap-2">
                {focusActive && (
                  <button
                    onClick={clearFocus}
                    className="text-xs px-2 py-0.5 rounded border transition-opacity hover:opacity-70"
                    style={{ borderColor: '#f59e0b', color: '#f59e0b' }}
                  >
                    Clear highlight
                  </button>
                )}
                <button
                  onClick={() => setShowInsights(false)}
                  className="w-5 h-5 flex items-center justify-center rounded hover:opacity-60"
                  style={{ color: 'var(--color-muted)' }}
                >
                  {getIcon('x', { size: 12 })}
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
              {insightsLoading && (
                <div className="flex items-center gap-2 text-xs py-4 justify-center" style={{ color: 'var(--color-muted)' }}>
                  <span className="animate-spin inline-block w-3 h-3 border-2 rounded-full" style={{ borderColor: '#f59e0b', borderTopColor: 'transparent' }} />
                  Analysing your graph…
                </div>
              )}

              {insightsError && !insightsLoading && (
                <p className="text-xs py-2" style={{ color: '#ef4444' }}>{insightsError}</p>
              )}

              {!insightsLoading && !insightsError && (!insights || insights.insights.length === 0) && (
                <div className="text-center py-4 space-y-2">
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    No insights yet. Click Generate to discover patterns in your vault.
                  </p>
                </div>
              )}

              {!insightsLoading && insights?.insights?.map((insight, i) => (
                <div
                  key={i}
                  className="rounded-lg border p-2.5 space-y-2"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                >
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>
                    {insight.text}
                  </p>
                  {insight.nodeIds?.length > 0 && (
                    <button
                      onClick={() => handleShowMe(insight.nodeIds)}
                      className="flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
                      style={{ color: '#f59e0b' }}
                    >
                      {getIcon('crosshair', { size: 11 })}
                      Show me
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Footer */}
            <div
              className="flex-shrink-0 px-3 py-2.5 border-t flex items-center justify-between"
              style={{ borderColor: 'var(--color-border)' }}
            >
              {insights?.generatedAt && (
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {new Date(insights.generatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <button
                onClick={handleRefreshInsights}
                disabled={insightsLoading}
                className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ background: '#f59e0b', color: '#fff' }}
              >
                {getIcon('refresh-cw', { size: 11 })}
                {insights?.insights?.length ? 'Refresh' : 'Generate'}
              </button>
            </div>
          </div>
        )}

        {/* Force graph */}
        <ForceGraph2D
          ref={fgRef}
          graphData={filteredData}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor="transparent"
          nodeId="id"
          nodeCanvasObject={nodeCanvasObject}
          nodePointerAreaPaint={nodePointerAreaPaint}
          nodeRelSize={8}
          linkColor={getLinkColor}
          linkWidth={getLinkWidth}
          linkCanvasObjectMode={linkCanvasObjectMode}
          linkCanvasObject={linkCanvasObject}
          linkDirectionalArrowLength={3.5}
          linkDirectionalArrowRelPos={1}
          linkDirectionalArrowColor={getLinkColor}
          linkCurvature={0.1}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          onBackgroundClick={handleBackgroundClick}
          enableNodeDrag
          autoPauseRedraw={false}
          warmupTicks={0}
          cooldownTicks={120}
          d3AlphaDecay={0.04}
          d3VelocityDecay={0.35}
          onEngineTick={handleNodeTick}
          onEngineStop={() => {
            handleNodeTick();
            fgRef.current?.zoomToFit(500, 60);
          }}
        />
      </div>

      {/* ── Side panel ───────────────────────────────────────────────────── */}
      {selectedNode && (
        <div
          className="flex-shrink-0 w-64 border-l flex flex-col overflow-hidden"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <div
            className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Node details</span>
            <button
              onClick={() => { setSelectedNode(null); selectedNodeIdRef.current = null; }}
              className="w-6 h-6 flex items-center justify-center rounded hover:opacity-60 transition-opacity"
              style={{ color: 'var(--color-muted)' }}
            >
              {getIcon('x', { size: 14 })}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
                style={{ background: NODE_COLORS[selectedNode.type] ?? '#888' }}
              >
                {NODE_LABELS[selectedNode.type] ?? selectedNode.type}
              </span>
            </div>

            <p className="text-sm font-medium leading-snug" style={{ color: 'var(--color-text)' }}>
              {selectedNode.label}
            </p>

            <div className="space-y-1">
              {(() => {
                const adj   = adjacencyRef.current[selectedNode.id];
                const total = adj ? adj.size : 0;
                // Count semantic connections specifically
                const semanticLinks = (rawData?.edges ?? []).filter(e =>
                  e.type === 'semantic' && (e.source === selectedNode.id || e.target === selectedNode.id)
                );
                return (
                  <>
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      {total} direct connection{total !== 1 ? 's' : ''}
                    </p>
                    {semanticLinks.length > 0 && (
                      <p className="text-xs" style={{ color: '#ec4899' }}>
                        {semanticLinks.length} semantic link{semanticLinks.length !== 1 ? 's' : ''}
                      </p>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          <div className="flex-shrink-0 p-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <button
              onClick={() => handleGoTo(selectedNode)}
              className="w-full px-3 py-2 rounded-lg text-sm font-medium text-white text-center transition-opacity hover:opacity-80"
              style={{ background: NODE_COLORS[selectedNode.type] ?? 'var(--color-primary)' }}
            >
              {selectedNode.external ? 'Open URL ↗' : `Go to ${NODE_LABELS[selectedNode.type] ?? 'item'}`}
            </button>
          </div>
        </div>
      )}

      {/* ── Legend ───────────────────────────────────────────────────────── */}
      {!selectedNode && (
        <div
          className="absolute bottom-4 right-4 z-10 rounded-xl border p-3 space-y-1.5"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Legend</p>
          {FILTER_ORDER.filter(t => filters[t]).map(type => (
            <div key={type} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: NODE_COLORS[type] }} />
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{NODE_LABELS[type]}</span>
            </div>
          ))}
          {showSemantic && semanticCount > 0 && (
            <div className="flex items-center gap-2 pt-1 mt-1 border-t" style={{ borderColor: 'var(--color-border)' }}>
              {/* Dashed line swatch */}
              <svg width="10" height="10" viewBox="0 0 10 10">
                <line x1="0" y1="5" x2="10" y2="5" stroke={SEMANTIC_COLOR} strokeWidth="2" strokeDasharray="3,2" />
              </svg>
              <span className="text-xs" style={{ color: SEMANTIC_COLOR }}>Semantic</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default GraphPage;
