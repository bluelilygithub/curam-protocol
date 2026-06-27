'use strict';

/**
 * Deterministic "AI slop" detector for generated theme skins.
 *
 * No LLM — these are fast, high-precision regex rules tuned to THIS builder's
 * output (plain semantic HTML + CSS, no frameworks). They encode the same
 * anti-slop intent already expressed in prompts/stage1-design.js so the design
 * the model returns can be checked, and optionally repaired, before it is saved.
 *
 * Errors are high-confidence tells that justify an automatic repair pass.
 * Warnings are softer signals reported for transparency.
 */

// Stereotyped "AI default" indigo/violet palette (the purple-on-white cliché).
const AI_PURPLE_HEXES = [
  '#6366f1', '#818cf8', '#4f46e5', '#4338ca',
  '#7c3aed', '#6d28d9', '#5b21b6', '#8b5cf6',
  '#a855f7', '#9333ea', '#7e22ce', '#c084fc',
];

const GENERIC_COPY_PHRASES = [
  'welcome to our website',
  'welcome to our site',
  'boost your productivity',
  'take your business to the next level',
  'take it to the next level',
  'your tagline here',
  'your text here',
  'insert text here',
  'placeholder text',
  'lorem ipsum',
  'click here',
  'company name here',
  'your company name',
  'add your text',
];

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2190}-\u{21FF}]/u;

function snippetAround(text, index, span = 48) {
  const start = Math.max(0, index - span);
  const end = Math.min(text.length, index + span);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function collectMatches(text, regex, limit = 3) {
  const samples = [];
  let count = 0;
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
  let match = re.exec(text);
  while (match) {
    count += 1;
    if (samples.length < limit) samples.push(snippetAround(text, match.index));
    if (match.index === re.lastIndex) re.lastIndex += 1;
    match = re.exec(text);
  }
  return { count, samples };
}

const RULES = [
  {
    id: 'gradient-text',
    severity: 'error',
    label: 'Gradient-filled text',
    fix: 'Remove gradient text effects (background-clip:text + linear-gradient). Use a solid, art-directed brand colour for headings.',
    test: ({ all }) => {
      if (!/background-clip\s*:\s*text/i.test(all)) return null;
      return collectMatches(all, /(-webkit-)?background-clip\s*:\s*text/i);
    },
  },
  {
    id: 'lorem-ipsum',
    severity: 'error',
    label: 'Lorem ipsum placeholder copy',
    fix: 'Replace every lorem ipsum passage with realistic, audience-appropriate copy that matches the brief.',
    test: ({ html }) => {
      if (!/lorem\s+ipsum/i.test(html)) return null;
      return collectMatches(html, /lorem\s+ipsum[\s\w,.]*/i);
    },
  },
  {
    id: 'no-css-variables',
    severity: 'error',
    label: 'No CSS custom properties',
    fix: 'Introduce a :root token system (custom properties) for colours, fonts, spacing, radii and shadows, and use them throughout.',
    test: ({ css }) => {
      const count = (css.match(/--[a-z][\w-]*\s*:/gi) || []).length;
      return count === 0 ? { count: 1, samples: ['No "--token:" declarations found in CSS'] } : null;
    },
  },
  {
    id: 'ai-purple-palette',
    severity: 'warn',
    label: 'Default indigo/purple palette',
    fix: 'Replace the stock indigo/violet-on-white palette with a palette derived from the brand and inspiration references.',
    test: ({ css }) => {
      const lower = css.toLowerCase();
      const hits = AI_PURPLE_HEXES.filter((hex) => lower.includes(hex));
      if (!hits.length) return null;
      const onWhite = /#fff(?:fff)?\b/i.test(css) || /background[^;]*:\s*white/i.test(css);
      if (!onWhite) return null;
      return { count: hits.length, samples: hits.slice(0, 3) };
    },
  },
  {
    id: 'no-clamp-type',
    severity: 'warn',
    label: 'No fluid type scale',
    fix: 'Use a modular type scale with clamp() for headings instead of fixed pixel sizes.',
    test: ({ css }) => (/(font-size\s*:)/i.test(css) && !/clamp\s*\(/i.test(css)
      ? { count: 1, samples: ['Font sizes set without any clamp() usage'] }
      : null),
  },
  {
    id: 'glassmorphism',
    severity: 'warn',
    label: 'Glassmorphism (backdrop blur)',
    fix: 'Remove frosted-glass panels (backdrop-filter: blur on translucent surfaces); use solid, considered backgrounds.',
    test: ({ css }) => {
      if (!/backdrop-filter\s*:\s*[^;]*blur/i.test(css)) return null;
      return collectMatches(css, /backdrop-filter\s*:\s*[^;]*blur[^;]*/i);
    },
  },
  {
    id: 'transition-all',
    severity: 'warn',
    label: 'Lazy "transition: all"',
    fix: 'Replace "transition: all" with explicit properties (e.g. transform, box-shadow, color) and intentional easing.',
    test: ({ css }) => {
      if (!/transition\s*:\s*all\b/i.test(css)) return null;
      return collectMatches(css, /transition\s*:\s*all\b[^;]*/i);
    },
  },
  {
    id: 'emoji-icons',
    severity: 'warn',
    label: 'Emoji used as icons',
    fix: 'Replace emoji used as icons or bullets with proper inline SVG or styled markup.',
    test: ({ html }) => {
      if (!EMOJI_RE.test(html)) return null;
      return collectMatches(html, EMOJI_RE);
    },
  },
  {
    id: 'generic-copy',
    severity: 'warn',
    label: 'Generic filler copy',
    fix: 'Rewrite generic marketing filler into specific, audience-appropriate copy.',
    test: ({ html }) => {
      const lower = html.toLowerCase();
      const hits = GENERIC_COPY_PHRASES.filter((p) => lower.includes(p));
      if (!hits.length) return null;
      return { count: hits.length, samples: hits.slice(0, 3) };
    },
  },
];

function gradeFor(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 65) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

/**
 * Run all rules over an HTML document + CSS string.
 * @returns {{score:number, grade:string, errorCount:number, warnCount:number, findings:Array}}
 */
function detectSlop(html = '', css = '') {
  const ctx = { html: String(html || ''), css: String(css || ''), all: `${html}\n${css}` };
  const findings = [];

  for (const rule of RULES) {
    let result = null;
    try {
      result = rule.test(ctx);
    } catch {
      result = null;
    }
    if (result && result.count > 0) {
      findings.push({
        id: rule.id,
        severity: rule.severity,
        label: rule.label,
        fix: rule.fix,
        count: result.count,
        samples: result.samples || [],
      });
    }
  }

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warnCount = findings.filter((f) => f.severity === 'warn').length;
  const score = Math.max(0, Math.min(100, 100 - errorCount * 15 - warnCount * 5));

  return { score, grade: gradeFor(score), errorCount, warnCount, findings };
}

/**
 * Build a focused desloppification prompt that fixes ONLY the detected issues
 * while preserving the approved structure, region ids, and the single inline script.
 */
function buildDesloppifyPrompt({ html, css, findings }) {
  const issueList = findings
    .map((f, i) => `${i + 1}. [${f.severity}] ${f.label} — ${f.fix}${f.samples?.length ? `\n   e.g. ${f.samples[0]}` : ''}`)
    .join('\n');

  return {
    system: `You are a senior front-end designer performing a DESLOPPIFICATION pass on an already-built website skin. You are NOT redesigning — you are removing the tells that make a design look AI-generated.

STRICT RULES:
- Fix ONLY the issues listed. Do not restructure the page, reorder sections, or change layout intent.
- Preserve EVERY id="…" and data-tb-region attribute exactly. Keep section ids (home, about, services, blog, portfolio, contact) and region ids (tb-header, site-navigation, tb-footer, tb-search, tb-map, tb-reviews, tb-social) untouched.
- Keep navigation labels, hrefs, and the header/footer structure identical.
- Preserve the single inline IntersectionObserver script (id="tb-inview") and any card hover / entrance animations.
- Keep all functional UI (forms, search, maps, reviews) present and visible.
- No markdown fences, no commentary.

OUTPUT — return ONLY this format:
---HTML---
<!DOCTYPE html>…complete document…
---CSS---
/* full style.css */`,
    user: `Fix these detected slop issues and nothing else:

${issueList}

Return the corrected full document and stylesheet.

Current HTML:
${html}

Current CSS:
${css}`,
  };
}

module.exports = {
  detectSlop,
  buildDesloppifyPrompt,
  RULES,
};
