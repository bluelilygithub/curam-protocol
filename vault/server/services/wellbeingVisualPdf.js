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
    { id: 'centre', label: 'Combined pattern', detail: 'Latest result from all eight checks', x: 298, y: 300, color: colour('#6366f1'), strength: 1 },
    { id: 'mood', label: 'Mood load', detail: `${moodScore}/63 - ${visuals?.mood?.bandLabel || 'Mood score'}`, x: 298, y: 150, color: colour('#ef4444'), strength: moodStrength },
    { id: 'anxiety', label: 'Anxiety load', detail: `${anxietyScore}/21 - ${visuals?.gad7?.bandLabel || 'Anxiety score'}`, x: 145, y: 150, color: colour('#f59e0b'), strength: anxietyStrength },
    { id: 'affect', label: 'Affect tone', detail: positiveAffect || negativeAffect ? `Positive ${positiveAffect?.score || 0}/${positiveAffect?.max || 50}; negative ${negativeAffect?.score || 0}/${negativeAffect?.max || 50}` : 'Positive and negative affect', x: 298, y: 210, color: colour('#a855f7'), strength: Number(negativeAffect?.normalized ?? positiveAffect?.normalized ?? 0.35) },
    { id: 'attention', label: 'Attention', detail: attentionPressure.length ? attentionPressure.map((scale) => scale.label).join(', ') : 'ASRS-5-style attention signals', x: 455, y: 520, color: colour('#0ea5e9'), strength: nodeStrength(attentionPressure, 0.35) },
    { id: 'sensitivity', label: 'Emotional sensitivity', detail: hexacoByKey.EM ? `${hexacoByKey.EM.label}: ${Math.round(Number(hexacoByKey.EM.normalized || 0) * 100)}%` : domainByKey.N ? `${domainByKey.N.label}: ${Math.round(Number(domainByKey.N.normalized || 0) * 100)}%` : 'Emotionality / Neuroticism domain', x: 455, y: 230, color: colour('#f97316'), strength: Number(hexacoByKey.EM?.normalized ?? domainByKey.N?.normalized ?? 0.35) },
    { id: 'resources', label: 'Cognitive resources', detail: helpful.length ? helpful.map((scale) => scale.label).join(', ') : 'Helpful CERQ strategies', x: 440, y: 390, color: colour('#3b82f6'), strength: nodeStrength(helpful, 0.35) },
    { id: 'loops', label: 'Cognitive loops', detail: lessHelpful.length ? lessHelpful.map((scale) => scale.label).join(', ') : 'Less-helpful CERQ strategies', x: 135, y: 230, color: colour('#dc2626'), strength: nodeStrength(lessHelpful, 0.35) },
    { id: 'coping', label: 'Active/support coping', detail: active.length ? active.map((scale) => scale.label).join(', ') : 'Adaptive coping strategies', x: 298, y: 470, color: colour('#22c55e'), strength: nodeStrength(active, 0.35) },
    { id: 'avoidance', label: 'Avoidant pressure', detail: avoidant.length ? avoidant.map((scale) => scale.label).join(', ') : 'Avoidant coping strategies', x: 145, y: 390, color: colour('#ea580c'), strength: nodeStrength(avoidant, 0.35) },
    { id: 'humility', label: 'Fairness/modesty', detail: hexacoByKey.HH ? `${hexacoByKey.HH.label}: ${Math.round(Number(hexacoByKey.HH.normalized || 0) * 100)}%` : 'Honesty-Humility domain', x: 145, y: 520, color: colour('#8b5cf6'), strength: Number(hexacoByKey.HH?.normalized || 0.35) },
    { id: 'structure', label: 'Structure', detail: hexacoByKey.CO ? `${hexacoByKey.CO.label}: ${Math.round(Number(hexacoByKey.CO.normalized || 0) * 100)}%` : domainByKey.C ? `${domainByKey.C.label}: ${Math.round(Number(domainByKey.C.normalized || 0) * 100)}%` : 'Conscientiousness domain', x: 298, y: 620, color: colour('#14b8a6'), strength: Number(hexacoByKey.CO?.normalized ?? domainByKey.C?.normalized ?? 0.35) },
  ];

  const links = [
    ['centre', 'mood'], ['centre', 'anxiety'], ['centre', 'affect'], ['centre', 'attention'], ['centre', 'sensitivity'], ['centre', 'resources'], ['centre', 'loops'],
    ['centre', 'coping'], ['centre', 'avoidance'], ['centre', 'structure'], ['mood', 'loops'],
    ['centre', 'humility'], ['mood', 'affect'], ['mood', 'avoidance'], ['anxiety', 'affect'], ['anxiety', 'loops'], ['attention', 'structure'], ['attention', 'avoidance'], ['resources', 'coping'], ['structure', 'coping'], ['sensitivity', 'loops'], ['humility', 'resources'],
  ];

  const notes = [
    moodStrength >= 0.32 && lessHelpful.length
      ? 'Mood load and less-helpful cognitive strategies are both prominent, suggesting a possible reinforcing loop between mood pressure and repeated interpretations of stress.'
      : 'Mood load is shown alongside thinking patterns so you can see whether mood severity is isolated or connected to repeated cognitive strategies.',
    avoidant.length && nodeStrength(avoidant) >= 0.5
      ? 'Avoidant coping is linked to mood load because avoidance can reduce distress briefly while leaving the original stressor unresolved.'
      : 'Avoidant coping is included separately so it does not get hidden inside the broader coping profile.',
    helpful.length || active.length
      ? 'Helpful cognitive strategies and active/support coping are grouped as potential resources that may interrupt less-helpful patterns.'
      : 'Resource nodes stay visible because low use of adaptive strategies can be as informative as high use of difficult patterns.',
  ];

  return { nodes, links, notes };
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
    const map = buildMindMapData(visuals);
    const nodeById = Object.fromEntries(map.nodes.map((node) => [node.id, node]));
    ensureSpace(500);
    const top = y;
    const scale = 0.76;
    const offsetX = margin + 25;
    const offsetY = top - 35;
    const px = (n) => offsetX + n * scale;
    const py = (n) => offsetY - n * scale;

    map.links.forEach(([fromId, toId]) => {
      const from = nodeById[fromId];
      const to = nodeById[toId];
      page.drawLine({ start: { x: px(from.x), y: py(from.y) }, end: { x: px(to.x), y: py(to.y) }, thickness: 1, color: rgb(0.72, 0.72, 0.72) });
    });
    map.nodes.forEach((node) => {
      const radius = (node.id === 'centre' ? 42 : 26 + node.strength * 10) * scale;
      page.drawCircle({ x: px(node.x), y: py(node.y), size: radius, borderColor: node.color, borderWidth: 1.5, color: rgb(0.98, 0.98, 0.98) });
      page.drawText(cleanPdfText(node.label).slice(0, 24), { x: px(node.x) - radius + 4, y: py(node.y) + 2, size: 7, font: boldFont, color: rgb(0.1, 0.1, 0.1) });
      page.drawText(`${Math.round(node.strength * 100)}%`, { x: px(node.x) - 8, y: py(node.y) - 9, size: 7, font, color: rgb(0.35, 0.35, 0.35) });
    });
    y = top - 500;

    addHeading('Node Details');
    map.nodes.filter((node) => node.id !== 'centre').forEach((node) => addText(`${node.label}: ${node.detail} (${Math.round(node.strength * 100)}%)`, { size: 9 }));
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
