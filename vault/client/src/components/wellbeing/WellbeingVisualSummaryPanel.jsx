import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../utils/apiClient';
import { BdiSeverityGauge, DomainRadarChart, StrategyBarChart } from './WellbeingCharts';

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function parseMaybeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function strongest(scales = [], predicate = () => true, limit = 3) {
  return scales
    .filter(predicate)
    .sort((a, b) => Number(b.normalized || 0) - Number(a.normalized || 0))
    .slice(0, limit);
}

function nodeStrength(items = [], fallback = 0) {
  if (!items.length) return fallback;
  return items.reduce((sum, item) => sum + Number(item.normalized || 0), 0) / items.length;
}

function buildMindMap(data) {
  const moodScore = Number(data?.mood?.totalScore || 0);
  const moodStrength = Math.min(1, moodScore / 63);
  const domains = parseMaybeJson(data?.ipip?.domainScores, []);
  const cerq = parseMaybeJson(data?.cerq?.scaleScores, []);
  const cope = parseMaybeJson(data?.cope?.scaleScores, []);
  const domainByKey = Object.fromEntries(domains.map((domain) => [domain.key, domain]));
  const lessHelpful = strongest(cerq, (scale) => scale.family === 'less-helpful');
  const helpful = strongest(cerq, (scale) => scale.family === 'helpful');
  const avoidant = strongest(cope, (scale) => scale.family === 'avoidant');
  const active = strongest(cope, (scale) => !['avoidant', 'self-evaluative'].includes(scale.family));

  const nodes = [
    {
      id: 'centre',
      label: 'Combined wellbeing pattern',
      detail: 'Latest result from all four checks',
      x: 300,
      y: 210,
      color: 'var(--color-primary)',
      strength: 1,
    },
    {
      id: 'mood',
      label: 'Mood load',
      detail: `${moodScore}/63 · ${data?.mood?.bandLabel || 'Mood score'}`,
      x: 300,
      y: 55,
      color: '#ef4444',
      strength: moodStrength,
    },
    {
      id: 'sensitivity',
      label: 'Emotional sensitivity',
      detail: domainByKey.N ? `${domainByKey.N.label}: ${Math.round(Number(domainByKey.N.normalized || 0) * 100)}%` : 'Neuroticism domain',
      x: 505,
      y: 130,
      color: '#f97316',
      strength: Number(domainByKey.N?.normalized || 0.35),
    },
    {
      id: 'resources',
      label: 'Cognitive resources',
      detail: helpful.length ? helpful.map((scale) => scale.label).join(', ') : 'Helpful CERQ strategies',
      x: 485,
      y: 310,
      color: '#3b82f6',
      strength: nodeStrength(helpful, 0.35),
    },
    {
      id: 'loops',
      label: 'Cognitive loops',
      detail: lessHelpful.length ? lessHelpful.map((scale) => scale.label).join(', ') : 'Less-helpful CERQ strategies',
      x: 115,
      y: 130,
      color: '#dc2626',
      strength: nodeStrength(lessHelpful, 0.35),
    },
    {
      id: 'coping',
      label: 'Active/support coping',
      detail: active.length ? active.map((scale) => scale.label).join(', ') : 'Adaptive coping strategies',
      x: 310,
      y: 390,
      color: '#22c55e',
      strength: nodeStrength(active, 0.35),
    },
    {
      id: 'avoidance',
      label: 'Avoidant pressure',
      detail: avoidant.length ? avoidant.map((scale) => scale.label).join(', ') : 'Avoidant coping strategies',
      x: 95,
      y: 310,
      color: '#ea580c',
      strength: nodeStrength(avoidant, 0.35),
    },
    {
      id: 'structure',
      label: 'Structure and follow-through',
      detail: domainByKey.C ? `${domainByKey.C.label}: ${Math.round(Number(domainByKey.C.normalized || 0) * 100)}%` : 'Conscientiousness domain',
      x: 300,
      y: 565,
      color: '#14b8a6',
      strength: Number(domainByKey.C?.normalized || 0.35),
    },
  ];

  const links = [
    ['centre', 'mood'],
    ['centre', 'sensitivity'],
    ['centre', 'resources'],
    ['centre', 'loops'],
    ['centre', 'coping'],
    ['centre', 'avoidance'],
    ['centre', 'structure'],
    ['mood', 'loops'],
    ['mood', 'avoidance'],
    ['resources', 'coping'],
    ['structure', 'coping'],
    ['sensitivity', 'loops'],
  ];

  const notes = [
    moodStrength >= 0.32 && lessHelpful.length
      ? 'Mood load and less-helpful cognitive strategies are both prominent, so the map highlights a possible reinforcing loop between mood pressure and repeated interpretations of stress.'
      : 'Mood load is shown alongside thinking patterns so you can see whether mood severity is isolated or connected to repeated cognitive strategies.',
    avoidant.length && nodeStrength(avoidant) >= 0.5
      ? 'Avoidant coping is visually linked to mood load because avoidance can reduce distress briefly while leaving the original stressor unresolved.'
      : 'Avoidant coping is included as a separate node so it does not get hidden inside the broader coping profile.',
    helpful.length || active.length
      ? 'Helpful cognitive strategies and active/support coping are grouped as potential resources: these are the levers most likely to interrupt the less-helpful parts of the map.'
      : 'Resource nodes stay visible even when scores are lower, because low use of adaptive strategies can be just as informative as high use of difficult patterns.',
  ].filter(Boolean);

  return { nodes, links, notes };
}

function MindMap({ data }) {
  const map = useMemo(() => buildMindMap(data), [data]);
  const nodeById = Object.fromEntries(map.nodes.map((node) => [node.id, node]));

  return (
    <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Four-test mind map</h2>
      <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
        A relationship map that groups related signals from mood, personality, cognitive coping, and behavioural coping.
      </p>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
        <svg viewBox="0 0 600 620" className="w-full max-w-[680px] mx-auto" role="img" aria-label="Mind map connecting the four wellbeing test patterns">
          {map.links.map(([fromId, toId]) => {
            const from = nodeById[fromId];
            const to = nodeById[toId];
            const weight = Math.max(from?.strength || 0.25, to?.strength || 0.25);
            return (
              <line
                key={`${fromId}-${toId}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="var(--color-border)"
                strokeWidth={1 + weight * 2}
              />
            );
          })}
          {map.nodes.map((node) => {
            const radius = node.id === 'centre' ? 62 : 38 + node.strength * 16;
            return (
              <g key={node.id}>
                <circle cx={node.x} cy={node.y} r={radius} fill={node.color} opacity={node.id === 'centre' ? 0.18 : 0.14} stroke={node.color} strokeWidth="2" />
                <text x={node.x} y={node.y - 5} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--color-text)">
                  {node.label}
                </text>
                <text x={node.x} y={node.y + 13} textAnchor="middle" fontSize="10" fill="var(--color-muted)">
                  {Math.round(node.strength * 100)}%
                </text>
              </g>
            );
          })}
        </svg>
        <div className="space-y-3">
          {map.nodes.filter((node) => node.id !== 'centre').map((node) => (
            <div key={node.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{node.label}</p>
                <span className="text-xs font-semibold tabular-nums" style={{ color: node.color }}>{Math.round(node.strength * 100)}%</span>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{node.detail}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="grid md:grid-cols-3 gap-3 mt-4">
        {map.notes.map((note, idx) => (
          <p key={idx} className="rounded-xl border p-3 text-xs leading-relaxed" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-muted)' }}>
            {note}
          </p>
        ))}
      </div>
    </section>
  );
}

export default function WellbeingVisualSummaryPanel({ onBack, initialView = 'charts' }) {
  const [view, setView] = useState(initialView);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/api/wellbeing/profile/visuals');
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Could not load visual summary');
      setData(payload);
    } catch (err) {
      setError(err.message || 'Could not load visual summary');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const downloadPdf = async () => {
    if (pdfLoading) return;
    setPdfLoading(true);
    setError('');
    try {
      const pdfView = view === 'mindmap' ? 'mindmap' : 'charts';
      const res = await api.get(`/api/wellbeing/profile/visuals/pdf?view=${pdfView}`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || 'PDF generation failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = pdfView === 'mindmap' ? 'wellbeing-mind-map.pdf' : 'wellbeing-visual-summary.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Could not download PDF');
    } finally {
      setPdfLoading(false);
    }
  };

  const domains = parseMaybeJson(data?.ipip?.domainScores, []);
  const cerqScales = parseMaybeJson(data?.cerq?.scaleScores, []);
  const copeScales = parseMaybeJson(data?.cope?.scaleScores, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity mb-3"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}
          >
            Back to wellbeing tools
          </button>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
            {view === 'mindmap' ? 'Wellbeing Mind Map' : 'Wellbeing Visual Summary'}
          </h2>
          <p className="text-sm mt-1 max-w-3xl" style={{ color: 'var(--color-muted)' }}>
            Uses the latest completed result from each of the four wellbeing checks.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setView('charts')}
            className="px-4 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity"
            style={{
              borderColor: view === 'charts' ? 'var(--color-primary)' : 'var(--color-border)',
              color: view === 'charts' ? 'var(--color-primary)' : 'var(--color-muted)',
              background: 'var(--color-surface)',
            }}
          >
            Charts
          </button>
          <button
            type="button"
            onClick={() => setView('mindmap')}
            className="px-4 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity"
            style={{
              borderColor: view === 'mindmap' ? 'var(--color-primary)' : 'var(--color-border)',
              color: view === 'mindmap' ? 'var(--color-primary)' : 'var(--color-muted)',
              background: 'var(--color-surface)',
            }}
          >
            Mind map
          </button>
          <button
            type="button"
            onClick={downloadPdf}
            disabled={!data || pdfLoading}
            className="px-4 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 disabled:opacity-50 transition-opacity"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}
          >
            {pdfLoading ? 'Preparing PDF...' : `Download ${view === 'mindmap' ? 'mind map' : 'charts'} PDF`}
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl px-3 py-2 text-sm" style={{ color: '#991b1b', background: '#fee2e2' }}>{error}</div>}

      {loading && <div className="p-4 text-sm" style={{ color: 'var(--color-muted)' }}>Loading visual summary...</div>}

      {!loading && data && (
        <>
          <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>Source results</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {Object.entries(data.sourceAttempts || {}).map(([key, attempt]) => (
                <div key={key} className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                  <p className="text-sm font-semibold capitalize" style={{ color: 'var(--color-text)' }}>{key}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{formatDate(attempt.createdAt)}</p>
                </div>
              ))}
            </div>
          </section>

          {view === 'mindmap' ? (
            <MindMap data={data} />
          ) : (
            <div className="space-y-4">
              <BdiSeverityGauge score={Number(data.mood?.totalScore || 0)} label={data.mood?.bandLabel} />
              <DomainRadarChart domains={domains} />
              <StrategyBarChart scales={cerqScales} responseMax={5} variant="cerq" title="CERQ-style strategy profile" />
              <StrategyBarChart scales={copeScales} responseMax={4} variant="cope" title="Brief COPE-style strategy profile" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
