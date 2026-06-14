import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../utils/apiClient';
import { BdiSeverityGauge, Gad7SeverityGauge, DomainRadarChart, StrategyBarChart } from './WellbeingCharts';

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

const SOURCE_CHARTS = [
  { key: 'mood', label: 'Mood', targetId: 'wellbeing-chart-mood' },
  { key: 'gad7', label: 'GAD-7', targetId: 'wellbeing-chart-gad7' },
  { key: 'panas', label: 'PANAS', targetId: 'wellbeing-chart-panas' },
  { key: 'asrs5', label: 'ASRS-5', targetId: 'wellbeing-chart-asrs5' },
  { key: 'ipip', label: 'IPIP', targetId: 'wellbeing-chart-ipip' },
  { key: 'hexaco', label: 'HEXACO', targetId: 'wellbeing-chart-hexaco' },
  { key: 'cerq', label: 'CERQ', targetId: 'wellbeing-chart-cerq' },
  { key: 'cope', label: 'COPE', targetId: 'wellbeing-chart-cope' },
];

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
  const anxietyScore = Number(data?.gad7?.totalScore || 0);
  const anxietyStrength = Math.min(1, anxietyScore / 21);
  const panas = parseMaybeJson(data?.panas?.scaleScores, []);
  const asrs5 = parseMaybeJson(data?.asrs5?.scaleScores, []);
  const domains = parseMaybeJson(data?.ipip?.domainScores, []);
  const hexacoDomains = parseMaybeJson(data?.hexaco?.domainScores, []);
  const cerq = parseMaybeJson(data?.cerq?.scaleScores, []);
  const cope = parseMaybeJson(data?.cope?.scaleScores, []);
  const domainByKey = Object.fromEntries(domains.map((domain) => [domain.key, domain]));
  const hexacoByKey = Object.fromEntries(hexacoDomains.map((domain) => [domain.key, domain]));
  const positiveAffect = panas.find((scale) => scale.key === 'positiveAffect');
  const negativeAffect = panas.find((scale) => scale.key === 'negativeAffect');
  const attentionPressure = strongest(asrs5, () => true, 2);
  const lessHelpful = strongest(cerq, (scale) => scale.family === 'less-helpful');
  const helpful = strongest(cerq, (scale) => scale.family === 'helpful');
  const avoidant = strongest(cope, (scale) => scale.family === 'avoidant');
  const active = strongest(cope, (scale) => !['avoidant', 'self-evaluative'].includes(scale.family));

  const nodes = [
    {
      id: 'centre',
      label: 'Combined wellbeing pattern',
      detail: 'Latest result from all eight checks',
      x: 300,
      y: 210,
      color: 'var(--color-primary)',
      strength: 1,
    },
    {
      id: 'anxiety',
      label: 'Anxiety load',
      detail: `${anxietyScore}/21 · ${data?.gad7?.bandLabel || 'Anxiety score'}`,
      x: 95,
      y: 45,
      color: '#f59e0b',
      strength: anxietyStrength,
    },
    {
      id: 'affect',
      label: 'Affect tone',
      detail: positiveAffect || negativeAffect
        ? `Positive ${positiveAffect?.score || 0}/${positiveAffect?.max || 50}; negative ${negativeAffect?.score || 0}/${negativeAffect?.max || 50}`
        : 'Positive and negative affect',
      x: 300,
      y: 125,
      color: '#a855f7',
      strength: Number(negativeAffect?.normalized ?? positiveAffect?.normalized ?? 0.35),
    },
    {
      id: 'mood',
      label: 'Mood load',
      detail: `${moodScore}/63 · ${data?.mood?.bandLabel || 'Mood score'}`,
      x: 300,
      y: 45,
      color: '#ef4444',
      strength: moodStrength,
    },
    {
      id: 'attention',
      label: 'Attention regulation',
      detail: attentionPressure.length ? attentionPressure.map((scale) => scale.label).join(', ') : 'ASRS-5-style attention signals',
      x: 505,
      y: 470,
      color: '#0ea5e9',
      strength: nodeStrength(attentionPressure, 0.35),
    },
    {
      id: 'sensitivity',
      label: 'Emotional sensitivity',
      detail: hexacoByKey.EM
        ? `${hexacoByKey.EM.label}: ${Math.round(Number(hexacoByKey.EM.normalized || 0) * 100)}%`
        : domainByKey.N ? `${domainByKey.N.label}: ${Math.round(Number(domainByKey.N.normalized || 0) * 100)}%` : 'Emotionality / Neuroticism domain',
      x: 505,
      y: 130,
      color: '#f97316',
      strength: Number(hexacoByKey.EM?.normalized ?? domainByKey.N?.normalized ?? 0.35),
    },
    {
      id: 'humility',
      label: 'Fairness and modesty',
      detail: hexacoByKey.HH ? `${hexacoByKey.HH.label}: ${Math.round(Number(hexacoByKey.HH.normalized || 0) * 100)}%` : 'Honesty-Humility domain',
      x: 95,
      y: 470,
      color: '#8b5cf6',
      strength: Number(hexacoByKey.HH?.normalized || 0.35),
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
      detail: hexacoByKey.CO
        ? `${hexacoByKey.CO.label}: ${Math.round(Number(hexacoByKey.CO.normalized || 0) * 100)}%`
        : domainByKey.C ? `${domainByKey.C.label}: ${Math.round(Number(domainByKey.C.normalized || 0) * 100)}%` : 'Conscientiousness domain',
      x: 300,
      y: 565,
      color: '#14b8a6',
      strength: Number(hexacoByKey.CO?.normalized ?? domainByKey.C?.normalized ?? 0.35),
    },
  ];

  const links = [
    ['centre', 'mood'],
    ['centre', 'anxiety'],
    ['centre', 'affect'],
    ['centre', 'attention'],
    ['centre', 'sensitivity'],
    ['centre', 'resources'],
    ['centre', 'loops'],
    ['centre', 'coping'],
    ['centre', 'avoidance'],
    ['centre', 'structure'],
    ['centre', 'humility'],
    ['mood', 'loops'],
    ['mood', 'affect'],
    ['anxiety', 'loops'],
    ['anxiety', 'affect'],
    ['attention', 'structure'],
    ['attention', 'avoidance'],
    ['mood', 'avoidance'],
    ['resources', 'coping'],
    ['structure', 'coping'],
    ['sensitivity', 'loops'],
    ['humility', 'resources'],
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
      <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Eight-test mind map</h2>
      <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
        A relationship map that groups related signals from mood, affect tone, attention/self-regulation, two personality lenses, cognitive coping, and behavioural coping.
      </p>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
        <svg viewBox="0 0 600 620" className="w-full max-w-[680px] mx-auto" role="img" aria-label="Mind map connecting the eight wellbeing test patterns">
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
                <text x={node.x} y={node.y + 13} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--color-text)">
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
  const panasScales = parseMaybeJson(data?.panas?.scaleScores, []);
  const asrs5Scales = parseMaybeJson(data?.asrs5?.scaleScores, []);
  const hexacoDomains = parseMaybeJson(data?.hexaco?.domainScores, []);
  const cerqScales = parseMaybeJson(data?.cerq?.scaleScores, []);
  const copeScales = parseMaybeJson(data?.cope?.scaleScores, []);

  const scrollToChart = (targetId) => {
    setView('charts');
    window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

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
            Uses the latest completed result from each of the eight wellbeing checks.
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
            <div className="grid sm:grid-cols-2 lg:grid-cols-8 gap-2">
              {SOURCE_CHARTS.map((source) => {
                const attempt = data.sourceAttempts?.[source.key];
                return (
                  <button
                    key={source.key}
                    type="button"
                    onClick={() => scrollToChart(source.targetId)}
                    className="rounded-xl border p-3 text-left transition-colors hover:bg-[var(--color-surface)] hover:border-[var(--color-primary)]"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                  >
                    <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{source.label}</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                      {attempt?.createdAt ? formatDate(attempt.createdAt) : 'Latest completed result'}
                    </p>
                    <p className="text-[11px] mt-2 font-semibold" style={{ color: 'var(--color-primary)' }}>Jump to chart</p>
                  </button>
                );
              })}
            </div>
          </section>

          {view === 'mindmap' ? (
            <MindMap data={data} />
          ) : (
            <div className="space-y-4">
              <div id="wellbeing-chart-mood" className="scroll-mt-6">
                <BdiSeverityGauge score={Number(data.mood?.totalScore || 0)} label={data.mood?.bandLabel} />
              </div>
              <div id="wellbeing-chart-gad7" className="scroll-mt-6">
                <Gad7SeverityGauge score={Number(data.gad7?.totalScore || 0)} label={data.gad7?.bandLabel} />
              </div>
              <div id="wellbeing-chart-panas" className="scroll-mt-6">
                <StrategyBarChart scales={panasScales} responseMax={5} variant="panas" title="PANAS-style affect profile" />
              </div>
              <div id="wellbeing-chart-asrs5" className="scroll-mt-6">
                <StrategyBarChart scales={asrs5Scales} responseMax={4} minValue={0} variant="asrs5" title="ASRS-5-style attention/self-regulation profile" />
              </div>
              <div id="wellbeing-chart-ipip" className="scroll-mt-6">
                <DomainRadarChart domains={domains} />
              </div>
              <div id="wellbeing-chart-hexaco" className="scroll-mt-6">
                <DomainRadarChart
                  domains={hexacoDomains}
                  title="HEXACO six-domain radar"
                  description="Relative HEXACO-style domain endorsement. Outer ring is higher endorsement."
                  ariaLabel="HEXACO six-domain radar chart"
                />
              </div>
              <div id="wellbeing-chart-cerq" className="scroll-mt-6">
                <StrategyBarChart scales={cerqScales} responseMax={5} variant="cerq" title="CERQ-style strategy profile" />
              </div>
              <div id="wellbeing-chart-cope" className="scroll-mt-6">
                <StrategyBarChart scales={copeScales} responseMax={4} variant="cope" title="Brief COPE-style strategy profile" />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
