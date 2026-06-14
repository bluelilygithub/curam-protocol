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

function takeawaysFromProfile(profile, limit = 5) {
  const safeProfile = profile && typeof profile === 'object' ? profile : {};
  const takeaways = [];

  const summaryBlocks = String(safeProfile.summary || '')
    .split(/\n{2,}/)
    .map((block) => firstSentence(block, 210))
    .filter(Boolean);
  takeaways.push(...summaryBlocks.slice(0, 2));

  const sections = Array.isArray(safeProfile.sections) ? safeProfile.sections : [];
  for (const section of sections) {
    if (takeaways.length >= limit) break;
    const title = cleanText(section?.title);
    const body = firstSentence(section?.body, 190);
    if (!title && !body) continue;
    takeaways.push(title && body ? `${title}: ${body}` : title || body);
  }

  const questions = Array.isArray(safeProfile.questions) ? safeProfile.questions : [];
  if (takeaways.length < limit && questions[0]) {
    takeaways.push(`Reflection question: ${firstSentence(questions[0], 180)}`);
  }

  return takeaways.slice(0, limit);
}

function buildDeckPayload({ moduleReports, finalProfile }) {
  return {
    title: 'Wellbeing Takeaway Slideshow',
    subtitle: 'Module-level and final-report takeaway points from the completed wellbeing checks.',
    modules: (moduleReports || []).map((report) => ({
      title: cleanText(report.moduleLabel || report.title || 'Wellbeing module'),
      takeaways: takeawaysFromProfile(report, 5),
    })),
    final: {
      title: 'Final overall report',
      takeaways: takeawaysFromProfile(finalProfile, 5),
    },
  };
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

  const sectionNames = [
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

  let top = 1.82;
  (bullets || []).slice(0, 5).forEach((bullet) => {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.78,
      y: top,
      w: 11.75,
      h: 0.78,
      fill: { color: COLORS.card },
      line: { color: COLORS.border, transparency: 0 },
      radius: 0.12,
    });
    addText(slide, bullet, {
      x: 1.05, y: top + 0.15, w: 11.1, h: 0.45, fontSize: 15,
    });
    top += 0.92;
  });

  addFooter(slide, index, total);
}

async function buildWellbeingSlideshowBuffer({ moduleReports, finalProfile }) {
  const data = buildDeckPayload({ moduleReports, finalProfile });
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

  const total = 2 + (data.modules || []).length;
  addTitleSlide(pptx, data, total);

  let index = 2;
  (data.modules || []).forEach((module) => {
    addBulletSlide(pptx, {
      title: module.title || 'Module takeaways',
      subtitle: 'Module takeaway points',
      bullets: module.takeaways,
      index,
      total,
    });
    index += 1;
  });

  addBulletSlide(pptx, {
    title: data.final?.title || 'Final overall report',
    subtitle: 'Final report takeaway points',
    bullets: data.final?.takeaways || [],
    index,
    total,
  });

  const output = await pptx.write({ outputType: 'nodebuffer' });
  if (Buffer.isBuffer(output)) return output;
  return Buffer.from(output);
}

module.exports = {
  buildWellbeingSlideshowBuffer,
};
