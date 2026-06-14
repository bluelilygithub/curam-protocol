'use strict';

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

function parseMaybeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function cleanPdfText(value) {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
}

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

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function colour(hex) {
  const cleaned = String(hex || '').replace('#', '');
  const n = parseInt(cleaned, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function strategyAverage(scale, responseMax) {
  const itemCount = Number(scale.max) > 0 ? Number(scale.max) / responseMax : 1;
  return itemCount > 0 ? Number(scale.score || 0) / itemCount : 0;
}

function strategyColour(scale, variant) {
  const family = String(scale.family || '').toLowerCase();
  if (variant === 'panas') {
    if (family === 'positive') return colour('#22c55e');
    if (family === 'negative') return colour('#ef4444');
    return colour('#64748b');
  }
  if (variant === 'asrs5') {
    if (family === 'attention') return colour('#3b82f6');
    if (family === 'activation') return colour('#f97316');
    if (family === 'impulsivity') return colour('#ef4444');
    if (family === 'planning') return colour('#a855f7');
    if (family === 'organisation') return colour('#14b8a6');
    return colour('#64748b');
  }
  if (variant === 'cerq') {
    if (family === 'helpful') return colour('#3b82f6');
    if (family === 'less-helpful') return colour('#ef4444');
    return colour('#64748b');
  }
  if (family === 'avoidant') return colour('#ef4444');
  if (['self-evaluative', 'emotion-focused', 'attention'].includes(family)) return colour('#f97316');
  return colour('#22c55e');
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

function emphasisLabel(value) {
  const score = Number(value || 0);
  if (score >= 0.75) return 'high prominence in this result';
  if (score >= 0.55) return 'moderate-high prominence';
  if (score >= 0.35) return 'moderate prominence';
  return 'not prominent in this result';
}

function labelList(items = [], fallback = 'not strongly differentiated') {
  const labels = items.map((item) => item.label).filter(Boolean);
  return labels.length ? labels.join(', ') : fallback;
}

function buildMindMapSynthesis({
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
  visuals,
}) {
  const moodBand = visuals?.mood?.bandLabel || 'mood range not available';
  const anxietyBand = visuals?.gad7?.bandLabel || 'anxiety range not available';
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
  const traitText = [
    hexacoByKey.EM?.label || domainByKey.N?.label,
    hexacoByKey.CO?.label || domainByKey.C?.label,
    hexacoByKey.HH?.label,
  ].filter(Boolean).join(', ') || 'no dominant trait anchor';

  const body = moodLow && anxietyLow && positiveScore >= negativeScore
    ? `Your mood and anxiety scores are both low (${moodScore}/63, ${moodBand}; ${anxietyScore}/21, ${anxietyBand}), and ${affectTone}. Across the broader profile, attention signals include ${attentionText}, cognitive loops include ${lessHelpfulText}, coping resources include ${helpfulText}, avoidant pressure includes ${avoidantText}, and trait anchors include ${traitText}. This map is most useful as a baseline and as a prompt to notice what changes if future results shift.`
    : `Read this as a guided synthesis rather than a graph result. Current mood/anxiety context is ${moodScore}/63 (${moodBand}) and ${anxietyScore}/21 (${anxietyBand}); affect tone says ${affectTone}; attention signals include ${attentionText}; cognitive loops include ${lessHelpfulText}; coping resources include ${helpfulText}; avoidant pressure includes ${avoidantText}; and trait anchors include ${traitText}. The useful story is whether these areas converge into one repeated pattern or whether some areas are stable while others are doing most of the work.`;

  return {
    title: 'What this combination means',
    body,
    prompts: [
      'Which pattern appears in more than one area?',
      'Which result is most likely to be a current state rather than a stable style?',
      'What is one support or habit that would help the strongest pattern move in a better direction?',
    ],
  };
}

function buildMindMapData(visuals) {
  const moodScore = Number(visuals?.mood?.totalScore || 0);
  const moodStrength = Math.min(1, moodScore / 63);
  const anxietyScore = Number(visuals?.gad7?.totalScore || 0);
  const anxietyStrength = Math.min(1, anxietyScore / 21);
  const panas = parseMaybeJson(visuals?.panas?.scaleScores, []);
  const asrs5 = parseMaybeJson(visuals?.asrs5?.scaleScores, []);
  const domains = parseMaybeJson(visuals?.ipip?.domainScores, []);
  const hexacoDomains = parseMaybeJson(visuals?.hexaco?.domainScores, []);
  const cerq = parseMaybeJson(visuals?.cerq?.scaleScores, []);
  const cope = parseMaybeJson(visuals?.cope?.scaleScores, []);
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
    { id: 'centre', label: 'Overall pattern', detail: 'Visual index of the latest completed checks. Not a score.', x: 298, y: 300, color: colour('#6366f1'), strength: 1, emphasis: 'synthesis node' },
    { id: 'mood', label: 'Mood load', detail: `${moodScore}/63 - ${visuals?.mood?.bandLabel || 'Mood score'}`, x: 298, y: 150, color: colour('#ef4444'), strength: moodStrength, emphasis: emphasisLabel(moodStrength) },
    { id: 'anxiety', label: 'Anxiety load', detail: `${anxietyScore}/21 - ${visuals?.gad7?.bandLabel || 'Anxiety score'}`, x: 145, y: 150, color: colour('#f59e0b'), strength: anxietyStrength, emphasis: emphasisLabel(anxietyStrength) },
    { id: 'affect', label: 'Affect tone', detail: positiveAffect || negativeAffect ? `Positive ${positiveAffect?.score || 0}/${positiveAffect?.max || 50}; negative ${negativeAffect?.score || 0}/${negativeAffect?.max || 50}` : 'Positive and negative affect', x: 298, y: 210, color: colour('#a855f7'), strength: Number(negativeAffect?.normalized ?? positiveAffect?.normalized ?? 0.35), emphasis: 'current affect snapshot' },
    { id: 'attention', label: 'Attention', detail: attentionPressure.length ? attentionPressure.map((scale) => scale.label).join(', ') : 'ASRS-5-style attention signals', x: 455, y: 520, color: colour('#0ea5e9'), strength: nodeStrength(attentionPressure, 0.35), emphasis: emphasisLabel(nodeStrength(attentionPressure, 0.35)) },
    { id: 'sensitivity', label: 'Emotional sensitivity', detail: hexacoByKey.EM ? `${hexacoByKey.EM.label} (${hexacoByKey.EM.band || 'domain score'})` : domainByKey.N ? `${domainByKey.N.label} (${domainByKey.N.band || 'domain score'})` : 'Emotionality / Neuroticism domain', x: 455, y: 230, color: colour('#f97316'), strength: Number(hexacoByKey.EM?.normalized ?? domainByKey.N?.normalized ?? 0.35), emphasis: emphasisLabel(Number(hexacoByKey.EM?.normalized ?? domainByKey.N?.normalized ?? 0.35)) },
    { id: 'resources', label: 'Cognitive resources', detail: helpful.length ? helpful.map((scale) => scale.label).join(', ') : 'Helpful CERQ strategies', x: 440, y: 390, color: colour('#3b82f6'), strength: nodeStrength(helpful, 0.35), emphasis: emphasisLabel(nodeStrength(helpful, 0.35)) },
    { id: 'loops', label: 'Cognitive loops', detail: lessHelpful.length ? lessHelpful.map((scale) => scale.label).join(', ') : 'Less-helpful CERQ strategies', x: 135, y: 230, color: colour('#dc2626'), strength: nodeStrength(lessHelpful, 0.35), emphasis: emphasisLabel(nodeStrength(lessHelpful, 0.35)) },
    { id: 'coping', label: 'Active/support coping', detail: active.length ? active.map((scale) => scale.label).join(', ') : 'Adaptive coping strategies', x: 298, y: 470, color: colour('#22c55e'), strength: nodeStrength(active, 0.35), emphasis: emphasisLabel(nodeStrength(active, 0.35)) },
    { id: 'avoidance', label: 'Avoidant pressure', detail: avoidant.length ? avoidant.map((scale) => scale.label).join(', ') : 'Avoidant coping strategies', x: 145, y: 390, color: colour('#ea580c'), strength: nodeStrength(avoidant, 0.35), emphasis: emphasisLabel(nodeStrength(avoidant, 0.35)) },
    { id: 'humility', label: 'Fairness/modesty', detail: hexacoByKey.HH ? `${hexacoByKey.HH.label} (${hexacoByKey.HH.band || 'domain score'})` : 'Honesty-Humility domain', x: 145, y: 520, color: colour('#8b5cf6'), strength: Number(hexacoByKey.HH?.normalized || 0.35), emphasis: emphasisLabel(Number(hexacoByKey.HH?.normalized || 0.35)) },
    { id: 'structure', label: 'Structure', detail: hexacoByKey.CO ? `${hexacoByKey.CO.label} (${hexacoByKey.CO.band || 'domain score'})` : domainByKey.C ? `${domainByKey.C.label} (${domainByKey.C.band || 'domain score'})` : 'Conscientiousness domain', x: 298, y: 620, color: colour('#14b8a6'), strength: Number(hexacoByKey.CO?.normalized ?? domainByKey.C?.normalized ?? 0.35), emphasis: emphasisLabel(Number(hexacoByKey.CO?.normalized ?? domainByKey.C?.normalized ?? 0.35)) },
  ];

  const links = [
    { from: 'centre', to: 'mood', label: 'included in synthesis' }, { from: 'centre', to: 'anxiety', label: 'included in synthesis' }, { from: 'centre', to: 'affect', label: 'included in synthesis' }, { from: 'centre', to: 'attention', label: 'included in synthesis' }, { from: 'centre', to: 'sensitivity', label: 'included in synthesis' }, { from: 'centre', to: 'resources', label: 'included in synthesis' }, { from: 'centre', to: 'loops', label: 'included in synthesis' },
    { from: 'centre', to: 'coping', label: 'included in synthesis' }, { from: 'centre', to: 'avoidance', label: 'included in synthesis' }, { from: 'centre', to: 'structure', label: 'included in synthesis' }, { from: 'mood', to: 'loops', label: 'interpret together' },
    { from: 'centre', to: 'humility', label: 'included in synthesis' }, { from: 'mood', to: 'affect', label: 'shared emotional context' }, { from: 'mood', to: 'avoidance', label: 'possible stress-response sequence' }, { from: 'anxiety', to: 'affect', label: 'shared emotional context' }, { from: 'anxiety', to: 'loops', label: 'interpret together' }, { from: 'attention', to: 'structure', label: 'self-regulation context' }, { from: 'attention', to: 'avoidance', label: 'possible stress-response sequence' }, { from: 'resources', to: 'coping', label: 'potential support route' }, { from: 'structure', to: 'coping', label: 'potential support route' }, { from: 'sensitivity', to: 'loops', label: 'interpret together' }, { from: 'humility', to: 'resources', label: 'interpersonal context' },
  ];

  const notes = [
    'This is a conceptual orientation map, not a statistical network. Node positions, circle sizes, and connections do not prove correlation, causation, or clinical significance.',
    moodStrength >= 0.32 && lessHelpful.length
      ? 'Mood load and less-helpful cognitive strategies are both visible, so the map invites you to read mood pressure alongside repeated interpretations of stress.'
      : 'Mood load is shown alongside thinking patterns so you can consider whether mood severity is isolated or part of a broader interpretation pattern.',
    avoidant.length && nodeStrength(avoidant) >= 0.5
      ? 'Avoidant coping is shown separately because it may provide short-term relief while leaving the original stressor unresolved.'
      : 'Avoidant coping is included separately so it does not get hidden inside the broader coping profile.',
    helpful.length || active.length
      ? 'Helpful cognitive strategies and active/support coping are grouped as potential resources that may interrupt less-helpful patterns.'
      : 'Resource nodes stay visible because low use of adaptive strategies can be as informative as high use of difficult patterns.',
  ];

  const synthesis = buildMindMapSynthesis({
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
    visuals,
  });

  return { nodes, links, notes, synthesis };
}

async function buildWellbeingVisualPdfBuffer({ visuals, view = 'charts' }) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 42;
  const contentWidth = pageWidth - margin * 2;
  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const ensureSpace = (height = 40) => {
    if (y < margin + height) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  };

  const addText = (text, options = {}) => {
    const { size = 10, bold = false, color = rgb(0.15, 0.15, 0.15), lineGap = 4, indent = 0 } = options;
    const usedFont = bold ? boldFont : font;
    const maxWidth = contentWidth - indent;
    const words = cleanPdfText(text).trim().split(/\s+/);
    let line = '';
    const lines = [];

    for (const word of words) {
      if (!word) continue;
      const testLine = line ? `${line} ${word}` : word;
      if (usedFont.widthOfTextAtSize(testLine, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) lines.push(line);
    if (!lines.length) lines.push('');

    for (const l of lines) {
      ensureSpace(size + lineGap + 8);
      page.drawText(l, { x: margin + indent, y, size, font: usedFont, color });
      y -= size + lineGap;
    }
    y -= 4;
  };

  const addHeading = (title) => {
    y -= 8;
    ensureSpace(44);
    addText(title, { size: 13, bold: true, color: rgb(0.1, 0.1, 0.1) });
  };

  const drawBar = ({ label, value, max, x = margin, width = contentWidth, barColor = colour('#6366f1'), detail = '' }) => {
    ensureSpace(38);
    page.drawText(cleanPdfText(label), { x, y, size: 9, font: boldFont, color: rgb(0.15, 0.15, 0.15) });
    page.drawText(cleanPdfText(detail || `${value}/${max}`), { x: x + width - 72, y, size: 8, font, color: rgb(0.35, 0.35, 0.35) });
    y -= 12;
    page.drawRectangle({ x, y, width, height: 8, color: rgb(0.92, 0.92, 0.92) });
    page.drawRectangle({ x, y, width: width * clamp01(Number(value) / Number(max || 1)), height: 8, color: barColor });
    y -= 16;
  };

  addText(view === 'mindmap' ? 'Wellbeing Mind Map' : 'Wellbeing Visual Summary', { size: 18, bold: true });
  addText(`Generated: ${formatDate(new Date())}`, { size: 9, color: rgb(0.45, 0.45, 0.45) });
  addText('Uses the latest completed result from each of the eight wellbeing checks.', { size: 9, color: rgb(0.45, 0.45, 0.45) });

  addHeading('Source Results');
  [
    ['Mood check', visuals?.sourceAttempts?.mood?.createdAt],
    ['GAD-7-style check', visuals?.sourceAttempts?.gad7?.createdAt],
    ['PANAS-style check', visuals?.sourceAttempts?.panas?.createdAt],
    ['ASRS-5-style check', visuals?.sourceAttempts?.asrs5?.createdAt],
    ['IPIP-NEO-120', visuals?.sourceAttempts?.ipip?.createdAt],
    ['HEXACO-60-style check', visuals?.sourceAttempts?.hexaco?.createdAt],
    ['CERQ-style check', visuals?.sourceAttempts?.cerq?.createdAt],
    ['Brief COPE-style check', visuals?.sourceAttempts?.cope?.createdAt],
  ].forEach(([label, createdAt]) => addText(`${label}: ${createdAt ? formatDate(createdAt) : 'latest completed result'}`, { size: 9 }));

  if (view === 'mindmap') {
    addHeading('Relationship Map');
    addText('This diagram is a visual index for the text below, not the insight by itself. Lines mean "interpret these results together"; they do not prove one result caused another. Circle placement is for readability only.', { size: 9, color: rgb(0.45, 0.45, 0.45) });
    const map = buildMindMapData(visuals);
    addHeading(map.synthesis.title);
    addText(map.synthesis.body, { size: 9 });
    addHeading('How to use this');
    map.synthesis.prompts.forEach((prompt) => addText(`- ${prompt}`, { size: 9 }));
    const nodeById = Object.fromEntries(map.nodes.map((node) => [node.id, node]));
    ensureSpace(500);
    const top = y;
    const scale = 0.76;
    const offsetX = margin + 25;
    const offsetY = top - 35;
    const px = (n) => offsetX + n * scale;
    const py = (n) => offsetY - n * scale;

    map.links.forEach((link) => {
      const from = nodeById[link.from];
      const to = nodeById[link.to];
      page.drawLine({ start: { x: px(from.x), y: py(from.y) }, end: { x: px(to.x), y: py(to.y) }, thickness: 1, color: rgb(0.72, 0.72, 0.72) });
    });
    map.nodes.forEach((node) => {
      const radius = (node.id === 'centre' ? 40 : 30) * scale;
      page.drawCircle({ x: px(node.x), y: py(node.y), size: radius, borderColor: node.color, borderWidth: 1.5, color: rgb(0.98, 0.98, 0.98) });
      page.drawText(cleanPdfText(node.label).slice(0, 24), { x: px(node.x) - radius + 4, y: py(node.y) + 2, size: 7, font: boldFont, color: rgb(0.1, 0.1, 0.1) });
      page.drawText(node.id === 'centre' ? 'synthesis' : 'result area', { x: px(node.x) - 18, y: py(node.y) - 9, size: 6, font, color: rgb(0.35, 0.35, 0.35) });
    });
    y = top - 500;

    addHeading('Node Details');
    map.nodes.filter((node) => node.id !== 'centre').forEach((node) => addText(`${node.label}: ${node.detail}. ${node.emphasis}.`, { size: 9 }));
    addHeading('Connection Guide');
    [...new Set(map.links.map((link) => link.label))].forEach((label) => addText(`${label}: conceptual reading link, not a measured statistical relationship.`, { size: 9 }));
    addHeading('Interpretive Notes');
    map.notes.forEach((note) => addText(`- ${note}`, { size: 9 }));
  } else {
    addHeading('BDI-Style Mood Gauge');
    const moodScore = Number(visuals?.mood?.totalScore || 0);
    const bands = [
      ['Minimal', 0, 13, '#22c55e'],
      ['Mild', 14, 19, '#eab308'],
      ['Moderate', 20, 28, '#f97316'],
      ['Severe', 29, 63, '#ef4444'],
    ];
    const gaugeX = margin;
    const gaugeWidth = contentWidth;
    const gaugeY = y - 26;
    bands.forEach(([label, from, to, hex]) => {
      const x = gaugeX + (from / 64) * gaugeWidth;
      const width = ((to - from + 1) / 64) * gaugeWidth;
      page.drawRectangle({ x, y: gaugeY, width, height: 14, color: colour(hex) });
      page.drawText(`${label} ${from}-${to}`, { x, y: gaugeY - 12, size: 7, font, color: rgb(0.35, 0.35, 0.35) });
    });
    page.drawLine({ start: { x: gaugeX + clamp01(moodScore / 63) * gaugeWidth, y: gaugeY - 3 }, end: { x: gaugeX + clamp01(moodScore / 63) * gaugeWidth, y: gaugeY + 22 }, thickness: 1.5, color: rgb(0.05, 0.05, 0.05) });
    y -= 62;
    addText(`Score: ${moodScore}/63 - ${visuals?.mood?.bandLabel || ''}`, { size: 10, bold: true });

    addHeading('GAD-7-Style Anxiety Gauge');
    const anxietyScore = Number(visuals?.gad7?.totalScore || 0);
    const anxietyBands = [
      ['Minimal', 0, 4, '#22c55e'],
      ['Mild', 5, 9, '#eab308'],
      ['Moderate', 10, 14, '#f97316'],
      ['Severe', 15, 21, '#ef4444'],
    ];
    const anxietyGaugeY = y - 18;
    anxietyBands.forEach(([label, from, to, hex]) => {
      const x = gaugeX + (from / 21) * gaugeWidth;
      const width = ((to - from + 1) / 22) * gaugeWidth;
      page.drawRectangle({ x, y: anxietyGaugeY, width, height: 14, color: colour(hex) });
      page.drawText(`${label} ${from}-${to}`, { x, y: anxietyGaugeY - 12, size: 7, font, color: rgb(0.35, 0.35, 0.35) });
    });
    page.drawLine({ start: { x: gaugeX + clamp01(anxietyScore / 21) * gaugeWidth, y: anxietyGaugeY - 3 }, end: { x: gaugeX + clamp01(anxietyScore / 21) * gaugeWidth, y: anxietyGaugeY + 22 }, thickness: 1.5, color: rgb(0.05, 0.05, 0.05) });
    y -= 62;
    addText(`Score: ${anxietyScore}/21 - ${visuals?.gad7?.bandLabel || ''}`, { size: 10, bold: true });

    addHeading('PANAS-Style Affect Bars');
    parseMaybeJson(visuals?.panas?.scaleScores, [])
      .sort((a, b) => strategyAverage(b, 5) - strategyAverage(a, 5))
      .forEach((scale) => drawBar({ label: scale.label, value: strategyAverage(scale, 5) - 1, max: 4, barColor: strategyColour(scale, 'panas'), detail: `${strategyAverage(scale, 5).toFixed(1)}/5 - ${scale.family}` }));

    addHeading('ASRS-5-Style Attention Bars');
    parseMaybeJson(visuals?.asrs5?.scaleScores, [])
      .sort((a, b) => strategyAverage(b, 4) - strategyAverage(a, 4))
      .forEach((scale) => drawBar({ label: scale.label, value: strategyAverage(scale, 4), max: 4, barColor: strategyColour(scale, 'asrs5'), detail: `${strategyAverage(scale, 4).toFixed(1)}/4 - ${scale.family}` }));

    addHeading('IPIP-NEO Five-Domain Radar');
    const domains = parseMaybeJson(visuals?.ipip?.domainScores, []);
    const cx = pageWidth / 2;
    const cy = y - 110;
    const radius = 78;
    const points = domains.map((domain, idx) => {
      const angle = -Math.PI / 2 + (idx / Math.max(domains.length, 1)) * Math.PI * 2;
      const value = clamp01(domain.normalized);
      return { domain, angle, x: cx + Math.cos(angle) * radius * value, y: cy + Math.sin(angle) * radius * value, ax: cx + Math.cos(angle) * radius, ay: cy + Math.sin(angle) * radius };
    });
    [0.25, 0.5, 0.75, 1].forEach((ring) => {
      const ringPoints = domains.map((_, idx) => {
        const angle = -Math.PI / 2 + (idx / Math.max(domains.length, 1)) * Math.PI * 2;
        return { x: cx + Math.cos(angle) * radius * ring, y: cy + Math.sin(angle) * radius * ring };
      });
      ringPoints.forEach((point, idx) => page.drawLine({ start: point, end: ringPoints[(idx + 1) % ringPoints.length], thickness: 0.5, color: rgb(0.78, 0.78, 0.78) }));
    });
    points.forEach((point, idx) => {
      page.drawLine({ start: { x: cx, y: cy }, end: { x: point.ax, y: point.ay }, thickness: 0.5, color: rgb(0.78, 0.78, 0.78) });
      page.drawLine({ start: { x: point.x, y: point.y }, end: { x: points[(idx + 1) % points.length].x, y: points[(idx + 1) % points.length].y }, thickness: 1.5, color: colour('#6366f1') });
      page.drawText(cleanPdfText(point.domain.label).slice(0, 16), { x: point.ax - 20, y: point.ay, size: 7, font, color: rgb(0.35, 0.35, 0.35) });
    });
    y -= 210;
    domains.sort((a, b) => Number(b.normalized) - Number(a.normalized)).forEach((domain) => addText(`${domain.label}: ${Math.round(clamp01(domain.normalized) * 100)}% (${domain.band})`, { size: 9 }));

    addHeading('HEXACO-Style Six-Domain Radar');
    const hexacoDomains = parseMaybeJson(visuals?.hexaco?.domainScores, []);
    const hx = pageWidth / 2;
    const hy = y - 110;
    const hRadius = 78;
    const hexacoPoints = hexacoDomains.map((domain, idx) => {
      const angle = -Math.PI / 2 + (idx / Math.max(hexacoDomains.length, 1)) * Math.PI * 2;
      const value = clamp01(domain.normalized);
      return { domain, angle, x: hx + Math.cos(angle) * hRadius * value, y: hy + Math.sin(angle) * hRadius * value, ax: hx + Math.cos(angle) * hRadius, ay: hy + Math.sin(angle) * hRadius };
    });
    [0.25, 0.5, 0.75, 1].forEach((ring) => {
      const ringPoints = hexacoDomains.map((_, idx) => {
        const angle = -Math.PI / 2 + (idx / Math.max(hexacoDomains.length, 1)) * Math.PI * 2;
        return { x: hx + Math.cos(angle) * hRadius * ring, y: hy + Math.sin(angle) * hRadius * ring };
      });
      ringPoints.forEach((point, idx) => page.drawLine({ start: point, end: ringPoints[(idx + 1) % ringPoints.length], thickness: 0.5, color: rgb(0.78, 0.78, 0.78) }));
    });
    hexacoPoints.forEach((point, idx) => {
      page.drawLine({ start: { x: hx, y: hy }, end: { x: point.ax, y: point.ay }, thickness: 0.5, color: rgb(0.78, 0.78, 0.78) });
      page.drawLine({ start: { x: point.x, y: point.y }, end: { x: hexacoPoints[(idx + 1) % hexacoPoints.length].x, y: hexacoPoints[(idx + 1) % hexacoPoints.length].y }, thickness: 1.5, color: colour('#8b5cf6') });
      page.drawText(cleanPdfText(point.domain.label).slice(0, 16), { x: point.ax - 20, y: point.ay, size: 7, font, color: rgb(0.35, 0.35, 0.35) });
    });
    y -= 210;
    hexacoDomains.sort((a, b) => Number(b.normalized) - Number(a.normalized)).forEach((domain) => addText(`${domain.label}: ${Math.round(clamp01(domain.normalized) * 100)}% (${domain.band})`, { size: 9 }));

    addHeading('CERQ-Style Strategy Bars');
    parseMaybeJson(visuals?.cerq?.scaleScores, [])
      .sort((a, b) => strategyAverage(b, 5) - strategyAverage(a, 5))
      .forEach((scale) => drawBar({ label: scale.label, value: strategyAverage(scale, 5) - 1, max: 4, barColor: strategyColour(scale, 'cerq'), detail: `${strategyAverage(scale, 5).toFixed(1)}/5 - ${scale.family}` }));

    addHeading('Brief COPE-Style Strategy Bars');
    parseMaybeJson(visuals?.cope?.scaleScores, [])
      .sort((a, b) => strategyAverage(b, 4) - strategyAverage(a, 4))
      .forEach((scale) => drawBar({ label: scale.label, value: strategyAverage(scale, 4) - 1, max: 3, barColor: strategyColour(scale, 'cope'), detail: `${strategyAverage(scale, 4).toFixed(1)}/4 - ${scale.family}` }));
  }

  addHeading('Caveat');
  addText('These visuals are proof-of-concept self-report summaries. They are not clinical diagnoses, risk assessments, or substitutes for qualified professional advice.', { size: 9, color: rgb(0.45, 0.45, 0.45) });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

module.exports = { buildWellbeingVisualPdfBuffer };
