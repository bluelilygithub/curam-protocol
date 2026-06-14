'use strict';

const pptxgen = require('pptxgenjs');

const COLORS = {
  bg: 'F7F3EE',
  ink: '1F2937',
  muted: '6B7280',
  accent: '8A5A2B',
  card: 'FFFFFF',
  border: 'E5D8CA',
};

function cleanText(value) {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentence(value, maxLength = 190) {
  const text = cleanText(value);
  if (!text) return '';
  const sentence = text.match(/^(.+?[.!?])(\s|$)/)?.[1] || text;
  return sentence.length > maxLength ? `${sentence.slice(0, maxLength - 1).trim()}...` : sentence;
}

function sentenceFragments(value) {
  return cleanText(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isConcreteTakeaway(value) {
  const text = cleanText(value).toLowerCase();
  return /\b(score|scored|range|band|highest|strongest|signals?|evidence|pattern|suggests?|appears|high|low|elevated|lower|higher|balance|endorsed|behaviourally|behaviorally|stress)\b/.test(text)
    && !/\bproof-of-concept|not a diagnosis|not clinical advice|not a substitute\b/.test(text);
}

function truncateTakeaway(value, maxLength = 220) {
  const text = cleanText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function takeawaysFromProfile(profile, limit = 5) {
  const safeProfile = profile && typeof profile === 'object' ? profile : {};
  const concrete = [];
  const fallback = [];
  const seen = new Set();

  const addCandidate = (value, forceFallback = false) => {
    const text = truncateTakeaway(value);
    const key = text.toLowerCase().replace(/^[^:]{1,48}:\s*/, '');
    if (!text || seen.has(key)) return;
    seen.add(key);
    if (!forceFallback && isConcreteTakeaway(text)) concrete.push(text);
    else fallback.push(text);
  };

  const summaryBlocks = String(safeProfile.summary || '')
    .split(/\n{2,}/)
    .flatMap(sentenceFragments)
    .map((sentence) => truncateTakeaway(sentence, 220))
    .filter(Boolean);

  const sections = Array.isArray(safeProfile.sections) ? safeProfile.sections : [];
  for (const section of sections) {
    const title = cleanText(section?.title);
    const concreteSentences = sentenceFragments(section?.body).filter(isConcreteTakeaway).slice(0, 6);
    if (concreteSentences.length) {
      concreteSentences.forEach((sentence, idx) => {
        addCandidate(title && idx === 0 ? `${title}: ${sentence}` : sentence);
      });
    } else {
      const body = firstSentence(section?.body, 190);
      if (title && body) addCandidate(`${title}: ${body}`);
      else addCandidate(title || body);
    }
  }

  summaryBlocks.forEach((sentence) => addCandidate(sentence));

  const questions = Array.isArray(safeProfile.questions) ? safeProfile.questions : [];
  if (questions[0]) addCandidate(`Reflection question: ${firstSentence(questions[0], 180)}`, true);

  return [...concrete, ...fallback].slice(0, limit);
}

function sectionTakeaways(section, limit = 6) {
  if (!section || typeof section !== 'object') return [];
  return sentenceFragments(section.body)
    .filter((sentence) => !/not a diagnosis|not clinical advice|not a substitute|proof-of-concept/i.test(sentence))
    .map((sentence) => truncateTakeaway(sentence, 230))
    .filter(Boolean)
    .slice(0, limit);
}

function buildFinalSlides(finalProfile) {
  if (!finalProfile) return [];
  const slides = [{
    type: 'final',
    title: 'Final overall report',
    subtitle: 'Cross-module synthesis',
    bullets: takeawaysFromProfile(finalProfile, 6),
  }];

  const sections = Array.isArray(finalProfile?.sections) ? finalProfile.sections : [];
  sections
    .filter((section) => section?.title && section?.body)
    .slice(0, 4)
    .forEach((section) => {
      const bullets = sectionTakeaways(section, 6);
      if (!bullets.length) return;
      slides.push({
        type: 'final-section',
        title: cleanText(section.title),
        subtitle: 'Final profile detail',
        bullets,
      });
    });

  return slides;
}

function buildDeckPayload({ moduleReports, finalProfile, testReports, chart, nextSteps, scopeLabel }) {
  const modules = (moduleReports || []).map((report) => ({
    title: cleanText(report.moduleLabel || report.title || 'Wellbeing module'),
    takeaways: takeawaysFromProfile(report, 6),
  }));
  const tests = (testReports || []).map((report) => ({
    title: cleanText(report.title || 'Individual test finding'),
    subtitle: cleanText(report.subtitle || 'Individual test finding'),
    takeaways: Array.isArray(report.takeaways)
      ? report.takeaways.map((item) => truncateTakeaway(item, 230)).filter(Boolean).slice(0, 6)
      : [],
  }));
  const finalSlides = buildFinalSlides(finalProfile);
  const hasFinalProfile = !!finalProfile;
  const chartSlide = chart?.items?.length ? [{
    type: 'chart',
    title: cleanText(chart.title || 'Summary chart'),
    subtitle: cleanText(chart.subtitle || 'Relative score/load map'),
    chartItems: chart.items
      .map((item) => ({
        label: cleanText(item.label),
        value: Math.max(0, Math.min(1, Number(item.value) || 0)),
        valueLabel: cleanText(item.valueLabel || `${Math.round((Number(item.value) || 0) * 100)}%`),
        group: cleanText(item.group),
      }))
      .filter((item) => item.label)
      .slice(0, 12),
  }] : [];
  const nextStepSlides = nextSteps?.bullets?.length ? [{
    type: 'next-steps',
    title: cleanText(nextSteps.title || 'Suggested next steps'),
    subtitle: cleanText(nextSteps.subtitle || 'Supportive habits and reflection steps'),
    bullets: nextSteps.bullets.map((item) => truncateTakeaway(item, 230)).filter(Boolean).slice(0, 6),
  }] : [];
  const slides = [
    {
      type: 'title',
      title: scopeLabel ? `${scopeLabel} Slideshow` : 'Wellbeing Results Walkthrough',
      subtitle: hasFinalProfile
        ? 'Module synthesis, individual test findings, and final cross-module interpretation.'
        : 'Module synthesis, summary chart, individual test findings, and suggested next steps.',
      bullets: [
        ...(chartSlide.length ? ['Summary chart slide'] : []),
        `${modules.length} module synthesis slides`,
        `${tests.length} individual test finding slides`,
        ...(finalSlides.length ? [`${finalSlides.length} final synthesis/detail slides`] : []),
        ...(nextStepSlides.length ? ['Suggested next steps slide'] : []),
      ],
    },
    ...chartSlide,
    ...modules.map((module) => ({
      type: 'module',
      title: module.title,
      subtitle: 'Module synthesis',
      bullets: module.takeaways,
    })),
    ...tests.map((test) => ({
      type: 'test',
      title: test.title,
      subtitle: test.subtitle,
      bullets: test.takeaways,
    })),
    ...finalSlides,
    ...nextStepSlides,
  ];

  return {
    title: scopeLabel ? `${scopeLabel} Slideshow` : 'Wellbeing Takeaway Slideshow',
    subtitle: hasFinalProfile
      ? 'Module synthesis, individual test findings, and final-report takeaway points from the completed wellbeing checks.'
      : 'Module synthesis, individual test findings, and suggested next steps from the completed module checks.',
    slides,
    modules,
    tests,
    final: {
      title: 'Final overall report',
      takeaways: takeawaysFromProfile(finalProfile, 6),
    },
  };
}

function buildWellbeingSlideshowData({ moduleReports, finalProfile, testReports, chart, nextSteps, scopeLabel }) {
  return buildDeckPayload({ moduleReports, finalProfile, testReports, chart, nextSteps, scopeLabel });
}

function addText(slide, text, opts = {}) {
  slide.addText(String(text || ''), {
    x: opts.x,
    y: opts.y,
    w: opts.w,
    h: opts.h,
    fontFace: 'Aptos',
    fontSize: opts.fontSize || 14,
    bold: !!opts.bold,
    color: opts.color || COLORS.ink,
    valign: opts.valign || 'top',
    align: opts.align || 'left',
    fit: 'shrink',
    margin: opts.margin ?? 0.04,
    breakLine: false,
  });
}

function addBackground(slide) {
  slide.background = { color: COLORS.bg };
}

function addFooter(slide, index, total) {
  addText(slide, 'Proof-of-concept self-report summary. Not clinical advice.', {
    x: 0.72, y: 7.0, w: 7.2, h: 0.25, fontSize: 8, color: COLORS.muted,
  });
  addText(slide, `${index}/${total}`, {
    x: 11.4, y: 7.0, w: 1.2, h: 0.25, fontSize: 8, color: COLORS.muted, align: 'right',
  });
}

function addTitleSlide(pptx, data, total) {
  const slide = pptx.addSlide();
  addBackground(slide);
  addText(slide, data.title || 'Wellbeing Takeaways', {
    x: 0.85, y: 1.25, w: 10.8, h: 0.7, fontSize: 34, bold: true, color: COLORS.accent,
  });
  addText(slide, data.subtitle || '', {
    x: 0.88, y: 2.05, w: 10.3, h: 0.5, fontSize: 16,
  });
  addText(slide, 'Included sections', {
    x: 0.9, y: 3.2, w: 4.9, h: 0.45, fontSize: 16, bold: true,
  });

  const sectionNames = data.bullets || [
    ...(data.modules || []).map((module) => module.title || 'Module'),
    'Final overall report',
  ];
  sectionNames.slice(0, 6).forEach((name, idx) => {
    addText(slide, `- ${name}`, {
      x: 1.05, y: 3.78 + idx * 0.36, w: 9.5, h: 0.28, fontSize: 13,
    });
  });
  addFooter(slide, 1, total);
}

function addBulletSlide(pptx, { title, subtitle, bullets, index, total }) {
  const slide = pptx.addSlide();
  addBackground(slide);
  addText(slide, subtitle, {
    x: 0.7, y: 0.45, w: 11.5, h: 0.45, fontSize: 11, color: COLORS.muted,
  });
  addText(slide, title, {
    x: 0.7, y: 0.84, w: 11.6, h: 0.65, fontSize: 28, bold: true, color: COLORS.accent,
  });

  let top = 1.72;
  (bullets || []).slice(0, 6).forEach((bullet) => {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.78,
      y: top,
      w: 11.75,
      h: 0.72,
      fill: { color: COLORS.card },
      line: { color: COLORS.border, transparency: 0 },
      radius: 0.12,
    });
    addText(slide, bullet, {
      x: 1.05, y: top + 0.12, w: 11.1, h: 0.48, fontSize: 13,
    });
    top += 0.82;
  });

  addFooter(slide, index, total);
}

function addChartSlide(pptx, { title, subtitle, chartItems, index, total }) {
  const slide = pptx.addSlide();
  addBackground(slide);
  addText(slide, subtitle, {
    x: 0.7, y: 0.45, w: 11.5, h: 0.45, fontSize: 11, color: COLORS.muted,
  });
  addText(slide, title, {
    x: 0.7, y: 0.84, w: 11.6, h: 0.65, fontSize: 28, bold: true, color: COLORS.accent,
  });

  const items = (chartItems || []).slice(0, 12);
  const maxWidth = 7.5;
  let top = 1.7;
  items.forEach((item) => {
    const value = Math.max(0, Math.min(1, Number(item.value) || 0));
    addText(slide, item.label, {
      x: 0.88, y: top + 0.04, w: 2.55, h: 0.25, fontSize: 10, color: COLORS.ink,
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: 3.6, y: top, w: maxWidth, h: 0.24, fill: { color: 'E8DED3' }, line: { color: 'E8DED3' },
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: 3.6, y: top, w: Math.max(0.05, maxWidth * value), h: 0.24, fill: { color: COLORS.accent }, line: { color: COLORS.accent },
    });
    addText(slide, item.valueLabel || `${Math.round(value * 100)}%`, {
      x: 11.25, y: top - 0.01, w: 0.9, h: 0.26, fontSize: 10, color: COLORS.muted, align: 'right',
    });
    top += 0.42;
  });

  addFooter(slide, index, total);
}

async function buildWellbeingSlideshowBuffer({ moduleReports, finalProfile, testReports, chart, nextSteps, scopeLabel }) {
  const data = buildWellbeingSlideshowData({ moduleReports, finalProfile, testReports, chart, nextSteps, scopeLabel });
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Curam Vault';
  pptx.subject = 'Wellbeing takeaway slideshow';
  pptx.title = data.title;
  pptx.company = 'Curam';
  pptx.lang = 'en-AU';
  pptx.theme = {
    headFontFace: 'Aptos Display',
    bodyFontFace: 'Aptos',
    lang: 'en-AU',
  };

  const slides = Array.isArray(data.slides) ? data.slides : [];
  const total = slides.length;
  slides.forEach((slide, idx) => {
    if (slide.type === 'title') {
      addTitleSlide(pptx, slide, total);
      return;
    }
    if (slide.type === 'chart') {
      addChartSlide(pptx, {
        title: slide.title || 'Summary chart',
        subtitle: slide.subtitle || 'Relative score/load map',
        chartItems: slide.chartItems,
        index: idx + 1,
        total,
      });
      return;
    }
    addBulletSlide(pptx, {
      title: slide.title || 'Wellbeing takeaways',
      subtitle: slide.subtitle || 'Takeaway points',
      bullets: slide.bullets,
      index: idx + 1,
      total,
    });
  });

  const output = await pptx.write({ outputType: 'nodebuffer' });
  if (Buffer.isBuffer(output)) return output;
  return Buffer.from(output);
}

module.exports = {
  buildWellbeingSlideshowData,
  buildWellbeingSlideshowBuffer,
};
