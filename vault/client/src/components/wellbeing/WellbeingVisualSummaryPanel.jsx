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

const MODULE_VISUALS = {
  'mood-emotional': {
    label: 'Mood & Emotional State',
    chartKeys: ['mood', 'gad7', 'panas'],
    nodeIds: ['centre', 'mood', 'anxiety', 'affect'],
    description: 'Mood load, anxiety/worry load, and affect tone.',
  },
  'personality-traits': {
    label: 'Personality & Traits',
    chartKeys: ['ipip', 'hexaco'],
    nodeIds: ['centre', 'sensitivity', 'humility', 'structure'],
    description: 'Stable dispositional patterns and trait posture.',
  },
  'regulation-coping': {
    label: 'Regulation & Coping',
    chartKeys: ['gad7', 'asrs5', 'cerq', 'cope'],
    nodeIds: ['centre', 'anxiety', 'attention', 'resources', 'loops', 'coping', 'avoidance', 'structure'],
    description: 'Stress-response, attention/self-regulation, cognitive regulation, and behavioural coping.',
  },
};

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

function emphasisLabel(value) {
  const score = Number(value || 0);
  if (score >= 0.75) return 'High prominence in this result';
  if (score >= 0.55) return 'Moderate-high prominence';
  if (score >= 0.35) return 'Moderate prominence';
  return 'Not prominent in this result';
}

function labelList(items = [], fallback = 'not strongly differentiated') {
  const labels = items.map((item) => item.label).filter(Boolean);
  return labels.length ? labels.join(', ') : fallback;
}

function buildMindMapSynthesis({
  moduleKey,
  moodScore,
  anxietyScore,
  positiveAffect,
  negativeAffect,
  attentionPressure,
  lessHelpful,
  helpful,
  avoidant,
  active,
  domainByKey,
  hexacoByKey,
  data,
}) {
  const moodBand = data?.mood?.bandLabel || 'mood range not available';
  const anxietyBand = data?.gad7?.bandLabel || 'anxiety range not available';
  const positiveScore = Number(positiveAffect?.score || 0);
  const negativeScore = Number(negativeAffect?.score || 0);
  const affectTone = positiveAffect || negativeAffect
    ? positiveScore >= negativeScore
      ? `positive affect is higher than negative affect (${positiveScore}/${positiveAffect?.max || 50} vs ${negativeScore}/${negativeAffect?.max || 50})`
      : `negative affect is higher than positive affect (${negativeScore}/${negativeAffect?.max || 50} vs ${positiveScore}/${positiveAffect?.max || 50})`
    : 'affect tone is not available';
  const moodLow = moodScore <= 13;
  const anxietyLow = anxietyScore <= 4;
  const attentionText = labelList(attentionPressure);
  const lessHelpfulText = labelList(lessHelpful);
  const helpfulText = labelList(helpful);
  const avoidantText = labelList(avoidant);
  const activeText = labelList(active);
  const traitText = [
    hexacoByKey.EM?.label || domainByKey.N?.label,
    hexacoByKey.CO?.label || domainByKey.C?.label,
    hexacoByKey.HH?.label,
  ].filter(Boolean).join(', ') || 'no dominant trait anchor';

  if (moduleKey === 'mood-emotional') {
    const body = moodLow && anxietyLow && positiveScore >= negativeScore
      ? `Your mood and anxiety scores are both low (${moodScore}/63, ${moodBand}; ${anxietyScore}/21, ${anxietyBand}), and ${affectTone}. Taken together, this suggests the current emotional-state module is not showing an overlapping mood/anxiety burden right now. The useful role of this visual index is mainly as a baseline: it shows what "relatively settled" looks like for comparison if future results change.`
      : `This module should be read as the current emotional weather: mood scored ${moodScore}/63 (${moodBand}), anxiety scored ${anxietyScore}/21 (${anxietyBand}), and ${affectTone}. The useful question is whether mood load, worry load, and affect tone are telling the same story or pulling in different directions.`;
    return {
      title: 'What this combination means',
      body,
      prompts: [
        moodLow && anxietyLow ? 'Use this as a baseline rather than a problem label: what usually helps you maintain this emotional steadiness?' : 'Which part is most driving the current emotional load: mood, worry, or affect tone?',
        'Would someone close to you recognise this current emotional-state picture?',
        'What would be the earliest sign that this pattern was shifting?',
      ],
    };
  }

  if (moduleKey === 'personality-traits') {
    return {
      title: 'What this combination means',
      body: `This module is a style profile rather than a current-symptom reading. The visual index is useful if it helps you ask how trait posture may affect relationships, decisions, stress, and recovery. The strongest anchors visible here are ${traitText}. The "so what" is not that these traits are good or bad; it is whether they make some support strategies, communication styles, or stress responses easier to access than others.`,
      prompts: [
        'Which part of this style is usually helpful under low stress?',
        'Which part becomes harder to use under pressure?',
        'What kind of environment or communication helps the best part of this style show up?',
      ],
    };
  }

  if (moduleKey === 'regulation-coping') {
    return {
      title: 'What this combination means',
      body: `This module is about sequence: what happens after stress or emotion arrives. Attention/self-regulation signals include ${attentionText}; cognitive loop signals include ${lessHelpfulText}; resource strategies include ${helpfulText}; active/support coping includes ${activeText}; avoidant pressure includes ${avoidantText}. The practical value is spotting whether stress moves toward clarification, support, and action, or toward replay, delay, withdrawal, or short-term relief that leaves the problem alive.`,
      prompts: [
        'What is usually the first move after stress arrives: thinking, avoiding, planning, asking, or acting?',
        'Which response helps immediately but may still have a delayed cost?',
        'Which resource strategy is available but easy to forget when pressure is high?',
      ],
    };
  }

  return {
    title: 'What this combination means',
    body: `Read this as a guided synthesis rather than a diagram result. Current mood/anxiety context is ${moodScore}/63 (${moodBand}) and ${anxietyScore}/21 (${anxietyBand}); affect tone says ${affectTone}; attention signals include ${attentionText}; cognitive loops include ${lessHelpfulText}; coping resources include ${helpfulText}; and avoidant pressure includes ${avoidantText}. The useful story is whether these areas converge into one repeated pattern or whether some areas are stable while others are doing most of the work.`,
    prompts: [
      'Which pattern appears in more than one area?',
      'Which result is most likely to be a current state rather than a stable style?',
      'What is one support or habit that would help the strongest pattern move in a better direction?',
    ],
  };
}

function buildMindMap(data, moduleKey = '') {
  const module = MODULE_VISUALS[moduleKey] || null;
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
      label: module ? `${module.label} pattern` : 'Overall wellbeing pattern',
      detail: module
        ? 'Combined reading from this module.'
        : 'Combined reading from the latest completed checks.',
      x: 300,
      y: 210,
      color: 'var(--color-primary)',
      strength: 1,
      emphasis: 'Synthesis node',
    },
    {
      id: 'anxiety',
      label: 'Anxiety load',
      detail: `${anxietyScore}/21 · ${data?.gad7?.bandLabel || 'Anxiety score'}`,
      x: 95,
      y: 45,
      color: '#f59e0b',
      strength: anxietyStrength,
      emphasis: emphasisLabel(anxietyStrength),
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
      emphasis: 'Current affect snapshot',
    },
    {
      id: 'mood',
      label: 'Mood load',
      detail: `${moodScore}/63 · ${data?.mood?.bandLabel || 'Mood score'}`,
      x: 300,
      y: 45,
      color: '#ef4444',
      strength: moodStrength,
      emphasis: emphasisLabel(moodStrength),
    },
    {
      id: 'attention',
      label: 'Attention regulation',
      detail: attentionPressure.length ? attentionPressure.map((scale) => scale.label).join(', ') : 'ASRS-5-style attention signals',
      x: 505,
      y: 470,
      color: '#0ea5e9',
      strength: nodeStrength(attentionPressure, 0.35),
      emphasis: emphasisLabel(nodeStrength(attentionPressure, 0.35)),
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
      emphasis: emphasisLabel(Number(hexacoByKey.EM?.normalized ?? domainByKey.N?.normalized ?? 0.35)),
    },
    {
      id: 'humility',
      label: 'Fairness and modesty',
      detail: hexacoByKey.HH ? `${hexacoByKey.HH.label}: ${Math.round(Number(hexacoByKey.HH.normalized || 0) * 100)}%` : 'Honesty-Humility domain',
      x: 95,
      y: 470,
      color: '#8b5cf6',
      strength: Number(hexacoByKey.HH?.normalized || 0.35),
      emphasis: emphasisLabel(Number(hexacoByKey.HH?.normalized || 0.35)),
    },
    {
      id: 'resources',
      label: 'Cognitive resources',
      detail: helpful.length ? helpful.map((scale) => scale.label).join(', ') : 'Helpful CERQ strategies',
      x: 485,
      y: 310,
      color: '#3b82f6',
      strength: nodeStrength(helpful, 0.35),
      emphasis: emphasisLabel(nodeStrength(helpful, 0.35)),
    },
    {
      id: 'loops',
      label: 'Cognitive loops',
      detail: lessHelpful.length ? lessHelpful.map((scale) => scale.label).join(', ') : 'Less-helpful CERQ strategies',
      x: 115,
      y: 130,
      color: '#dc2626',
      strength: nodeStrength(lessHelpful, 0.35),
      emphasis: emphasisLabel(nodeStrength(lessHelpful, 0.35)),
    },
    {
      id: 'coping',
      label: 'Active/support coping',
      detail: active.length ? active.map((scale) => scale.label).join(', ') : 'Adaptive coping strategies',
      x: 310,
      y: 390,
      color: '#22c55e',
      strength: nodeStrength(active, 0.35),
      emphasis: emphasisLabel(nodeStrength(active, 0.35)),
    },
    {
      id: 'avoidance',
      label: 'Avoidant pressure',
      detail: avoidant.length ? avoidant.map((scale) => scale.label).join(', ') : 'Avoidant coping strategies',
      x: 95,
      y: 310,
      color: '#ea580c',
      strength: nodeStrength(avoidant, 0.35),
      emphasis: emphasisLabel(nodeStrength(avoidant, 0.35)),
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
      emphasis: emphasisLabel(Number(hexacoByKey.CO?.normalized ?? domainByKey.C?.normalized ?? 0.35)),
    },
  ];

  const links = [
    { from: 'centre', to: 'mood', label: 'included in synthesis' },
    { from: 'centre', to: 'anxiety', label: 'included in synthesis' },
    { from: 'centre', to: 'affect', label: 'included in synthesis' },
    { from: 'centre', to: 'attention', label: 'included in synthesis' },
    { from: 'centre', to: 'sensitivity', label: 'included in synthesis' },
    { from: 'centre', to: 'resources', label: 'included in synthesis' },
    { from: 'centre', to: 'loops', label: 'included in synthesis' },
    { from: 'centre', to: 'coping', label: 'included in synthesis' },
    { from: 'centre', to: 'avoidance', label: 'included in synthesis' },
    { from: 'centre', to: 'structure', label: 'included in synthesis' },
    { from: 'centre', to: 'humility', label: 'included in synthesis' },
    { from: 'mood', to: 'loops', label: 'interpret together' },
    { from: 'mood', to: 'affect', label: 'shared emotional context' },
    { from: 'anxiety', to: 'loops', label: 'interpret together' },
    { from: 'anxiety', to: 'affect', label: 'shared emotional context' },
    { from: 'attention', to: 'structure', label: 'self-regulation context' },
    { from: 'attention', to: 'avoidance', label: 'possible stress-response sequence' },
    { from: 'mood', to: 'avoidance', label: 'possible stress-response sequence' },
    { from: 'resources', to: 'coping', label: 'potential support route' },
    { from: 'structure', to: 'coping', label: 'potential support route' },
    { from: 'sensitivity', to: 'loops', label: 'interpret together' },
    { from: 'humility', to: 'resources', label: 'interpersonal context' },
  ];

  const patternNote = moodStrength >= 0.32 && lessHelpful.length
    ? 'Mood load and less-helpful cognitive strategies are both prominent enough to read mood pressure alongside repeated interpretations of stress.'
    : 'Mood load is shown alongside thinking patterns so you can consider whether mood severity is isolated or part of a broader interpretation pattern.';
  const resourceNote = helpful.length || active.length
    ? 'Helpful cognitive strategies and active/support coping are shown as practical resources, while avoidant coping stays visible because it may offer short-term relief while leaving the original stressor unresolved.'
    : 'Resource and coping areas stay visible because low use of adaptive strategies can be as informative as high use of difficult patterns.';
  const notes = [patternNote, resourceNote].filter(Boolean);
  const synthesis = buildMindMapSynthesis({
    moduleKey,
    moodScore,
    anxietyScore,
    positiveAffect,
    negativeAffect,
    attentionPressure,
    lessHelpful,
    helpful,
    avoidant,
    active,
    domainByKey,
    hexacoByKey,
    data,
  });

  if (!module) return { nodes, links, notes, synthesis };

  const allowed = new Set(module.nodeIds);
  const filteredNodes = nodes.filter((node) => allowed.has(node.id));
  const filteredLinks = links.filter((link) => allowed.has(link.from) && allowed.has(link.to));
  const filteredNotes = [`${module.label} focuses this visual index on ${module.description}`, ...notes.slice(0, 1)];
  return { nodes: filteredNodes, links: filteredLinks, notes: filteredNotes, synthesis };
}

function MindMap({ data, moduleKey = '' }) {
  const module = MODULE_VISUALS[moduleKey] || null;
  const map = useMemo(() => buildMindMap(data, moduleKey), [data, moduleKey]);
  const synthesisNode = map.nodes.find((node) => node.id === 'centre');
  const contributors = map.nodes.filter((node) => node.id !== 'centre');

  return (
    <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>{module ? `${module.label} visual index` : 'Eight-test visual index'}</h2>
      <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
        {module ? `A module-specific index showing which inputs feed the ${module.label} synthesis.` : 'An index showing which result areas feed the overall wellbeing synthesis.'}
      </p>
      <p className="text-xs mb-4 rounded-xl border p-3" style={{ color: 'var(--color-muted)', borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
        This diagram is not a relationship network. It is a simple input-to-synthesis guide: the cards on the left are the source areas, and the card on the right is the combined reading.
      </p>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-3 mb-4">
        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          <p className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>{map.synthesis.title}</p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>{map.synthesis.body}</p>
        </div>
        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          <p className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>How to use this</p>
          <ul className="space-y-2 text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            {map.synthesis.prompts.map((prompt) => (
              <li key={prompt}>- {prompt}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_96px_320px] gap-4 items-center">
        <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          <p className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: 'var(--color-muted)' }}>Inputs</p>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {contributors.map((node) => (
              <div key={node.id} className="rounded-xl border p-3" style={{ borderColor: node.color, background: 'var(--color-surface)' }}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{node.label}</p>
                </div>
                <p className="text-xs mt-1" style={{ color: node.color }}>{node.emphasis}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="hidden lg:flex items-center justify-center text-3xl font-semibold" style={{ color: 'var(--color-primary)' }} aria-hidden="true">
          →
        </div>
        <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--color-primary)', background: 'var(--color-surface)' }}>
          <p className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: 'var(--color-primary)' }}>Synthesis</p>
          <p className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{synthesisNode?.label || 'Combined pattern'}</p>
          <p className="text-xs mt-3 font-semibold" style={{ color: 'var(--color-primary)' }}>
            Read the synthesis text above for the meaning.
          </p>
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

export default function WellbeingVisualSummaryPanel({ onBack, initialView = 'charts', moduleKey = '' }) {
  const activeModule = MODULE_VISUALS[moduleKey] || null;
  const [view, setView] = useState(initialView);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const suffix = moduleKey ? `?moduleKey=${encodeURIComponent(moduleKey)}` : '';
      const res = await api.get(`/api/wellbeing/profile/visuals${suffix}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Could not load visual summary');
      setData(payload);
    } catch (err) {
      setError(err.message || 'Could not load visual summary');
    } finally {
      setLoading(false);
    }
  }, [moduleKey]);

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
      a.download = pdfView === 'mindmap' ? 'wellbeing-visual-index.pdf' : 'wellbeing-visual-summary.pdf';
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
  const sourceCharts = activeModule
    ? SOURCE_CHARTS.filter((source) => activeModule.chartKeys.includes(source.key))
    : SOURCE_CHARTS;
  const hasChart = (key) => sourceCharts.some((source) => source.key === key);

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
            {activeModule ? `${activeModule.label} ${view === 'mindmap' ? 'Visual Index' : 'Visual Summary'}` : (view === 'mindmap' ? 'Wellbeing Visual Index' : 'Wellbeing Visual Summary')}
          </h2>
          <p className="text-sm mt-1 max-w-3xl" style={{ color: 'var(--color-muted)' }}>
            {activeModule ? activeModule.description : 'Uses the latest completed result from each of the eight wellbeing checks.'}
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
            Visual index
          </button>
          <button
            type="button"
            onClick={downloadPdf}
            disabled={!data || pdfLoading}
            className="px-4 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 disabled:opacity-50 transition-opacity"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}
          >
            {pdfLoading ? 'Preparing PDF...' : `Download ${view === 'mindmap' ? 'visual index' : 'charts'} PDF`}
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl px-3 py-2 text-sm" style={{ color: '#991b1b', background: '#fee2e2' }}>{error}</div>}

      {loading && <div className="p-4 text-sm" style={{ color: 'var(--color-muted)' }}>Loading visual summary...</div>}

      {!loading && data && (
        <>
          <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>Source results</p>
            <div className={`grid sm:grid-cols-2 ${sourceCharts.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-2`}>
              {sourceCharts.map((source) => {
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
            <MindMap data={data} moduleKey={moduleKey} />
          ) : (
            <div className="space-y-4">
              {hasChart('mood') && (
                <div id="wellbeing-chart-mood" className="scroll-mt-6">
                  <BdiSeverityGauge score={Number(data.mood?.totalScore || 0)} label={data.mood?.bandLabel} />
                </div>
              )}
              {hasChart('gad7') && (
                <div id="wellbeing-chart-gad7" className="scroll-mt-6">
                  <Gad7SeverityGauge score={Number(data.gad7?.totalScore || 0)} label={data.gad7?.bandLabel} />
                </div>
              )}
              {hasChart('panas') && (
                <div id="wellbeing-chart-panas" className="scroll-mt-6">
                  <StrategyBarChart scales={panasScales} responseMax={5} variant="panas" title="PANAS-style affect profile" />
                </div>
              )}
              {hasChart('asrs5') && (
                <div id="wellbeing-chart-asrs5" className="scroll-mt-6">
                  <StrategyBarChart scales={asrs5Scales} responseMax={4} minValue={0} variant="asrs5" title="ASRS-5-style attention/self-regulation profile" />
                </div>
              )}
              {hasChart('ipip') && (
                <div id="wellbeing-chart-ipip" className="scroll-mt-6">
                  <DomainRadarChart domains={domains} />
                </div>
              )}
              {hasChart('hexaco') && (
                <div id="wellbeing-chart-hexaco" className="scroll-mt-6">
                  <DomainRadarChart
                    domains={hexacoDomains}
                    title="HEXACO six-domain radar"
                    description="Relative HEXACO-style domain endorsement. Outer ring is higher endorsement."
                    ariaLabel="HEXACO six-domain radar chart"
                  />
                </div>
              )}
              {hasChart('cerq') && (
                <div id="wellbeing-chart-cerq" className="scroll-mt-6">
                  <StrategyBarChart scales={cerqScales} responseMax={5} variant="cerq" title="CERQ-style strategy profile" />
                </div>
              )}
              {hasChart('cope') && (
                <div id="wellbeing-chart-cope" className="scroll-mt-6">
                  <StrategyBarChart scales={copeScales} responseMax={4} variant="cope" title="Brief COPE-style strategy profile" />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
