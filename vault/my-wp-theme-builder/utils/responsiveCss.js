const { createDesignMessage, resolveStage2Model } = require('./modelCall');
const { MOBILE_BASELINE_CSS } = require('./mobileBaseline');
const { NAV_TOGGLE_CSS } = require('./mobileNav');

const RESPONSIVE_GUARANTEES = `
/* theme-builder responsive guarantees */
@media (max-width: 767px) {
  .footer-grid,
  footer .footer-grid,
  footer [class*="footer-grid"],
  footer [class*="grid"] {
    grid-template-columns: 1fr !important;
    gap: 1.5rem !important;
  }
}
${NAV_TOGGLE_CSS}
`.trim();

const RESPONSIVE_SYSTEM = `You are a CSS specialist writing responsive.css for an existing website.

RULES:
- Output ONLY valid CSS — no HTML, no markdown fences, no commentary
- Do NOT change desktop layout above 768px — only add @media (max-width: 767px) rules
- Target the ACTUAL class names and structure in the provided HTML
- Mobile (≤767px): stack nav vertically, hero columns become 1 column, all grids 1 column, no horizontal overflow at 320px
- Footer grids (e.g. .footer-grid with 4 columns) MUST become 1 column on mobile — never leave 2fr 1fr 1fr 1fr on narrow screens
- Header nav: hamburger button (.nav-toggle) hidden on desktop; on mobile nav is collapsed until .is-open is toggled (script already in HTML)
- Use !important only where needed to override existing rules
- Include @media (min-width: 768px) only if needed to restore desktop behaviour your mobile rules affect
- Start with a comment: /* responsive.css — generated for mobile stacking */`;

function truncate(text, max) {
  const s = String(text || '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n/* … truncated … */`;
}

function buildResponsivePrompt(html, css) {
  return `Write responsive.css for this site. Analyse the HTML class names and the existing style.css, then output mobile stacking rules.

Requirements at max-width: 767px:
- Header and nav stack vertically; links full width
- Multi-column heroes and grids become single column
- Footer .footer-grid and similar must stack to one column with readable spacing
- Header: respect .nav-toggle / #site-navigation.is-open hamburger pattern if present
- Images and embeds max-width 100%
- No horizontal scroll at 320px viewport
- Preserve tb-* component blocks (search, social, forms, reviews, etc.)

HTML:
${truncate(html, 14000)}

Existing style.css:
${truncate(css, 10000)}

Return ONLY the contents of responsive.css.`;
}

function parseResponsiveCss(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return '';

  const fenced = text.match(/```(?:css)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  const cssStart = text.search(/\/\*|@media|:root|[a-z#.[\]]/i);
  if (cssStart > 0) return text.slice(cssStart).trim();

  return text;
}

function appendResponsiveGuarantees(css) {
  const trimmed = String(css || '').trim();
  if (/theme-builder responsive guarantees/i.test(trimmed)) return trimmed;
  return `${trimmed}\n\n${RESPONSIVE_GUARANTEES}`.trim();
}

function fallbackResponsiveCss() {
  return `/* responsive.css — fallback mobile rules */\n${MOBILE_BASELINE_CSS}\n\n${RESPONSIVE_GUARANTEES}`;
}

async function generateResponsiveCss({ html, css, userId, model, onProgress, sessionId, writeFile } = {}) {
  const prompt = {
    system: RESPONSIVE_SYSTEM,
    user: buildResponsivePrompt(html, css),
  };

  let modelUsed = model || null;

  try {
    if (typeof onProgress === 'function') {
      onProgress('Generating responsive.css with Qwen…');
    }

    const resolvedModel = model || await resolveStage2Model({ userId });
    modelUsed = resolvedModel;

    if (writeFile && sessionId) {
      await writeFile(sessionId, 'stage1/responsive-prompt.json', JSON.stringify({
        model: resolvedModel,
        recordedAt: new Date().toISOString(),
        ...prompt,
      }, null, 2));
    }

    const { text, model: used } = await createDesignMessage({
      ...prompt,
      model: resolvedModel,
      userId,
      stage: 'stage2',
      maxTokens: 8000,
      onProgress,
    });
    modelUsed = used || resolvedModel;

    if (writeFile && sessionId) {
      await writeFile(sessionId, 'stage1/responsive-raw.txt', text.slice(0, 50000));
    }

    const responsiveCss = appendResponsiveGuarantees(parseResponsiveCss(text));
    if (responsiveCss.length < 80 || !/@media/i.test(responsiveCss)) {
      throw new Error('Qwen responsive.css was too short or missing @media rules');
    }

    return { responsiveCss, model: modelUsed, fallback: false };
  } catch (err) {
    if (typeof onProgress === 'function') {
      onProgress(`Responsive fallback (${err.message})`);
    }
    return {
      responsiveCss: fallbackResponsiveCss(),
      model: modelUsed || 'fallback',
      fallback: true,
      error: err.message,
    };
  }
}

function ensureStylesheetLinks(html) {
  let out = html;

  if (!/<link[^>]+href=["']style\.css["']/i.test(out)) {
    const link = '<link rel="stylesheet" href="style.css">';
    if (/<\/head>/i.test(out)) {
      out = out.replace(/<\/head>/i, `${link}\n</head>`);
    } else {
      out = `${link}\n${out}`;
    }
  }

  if (!/<link[^>]+href=["']responsive\.css["']/i.test(out)) {
    out = out.replace(
      /<link[^>]+href=["']style\.css["'][^>]*>/i,
      (m) => `${m}\n<link rel="stylesheet" href="responsive.css">`
    );
  }

  return out;
}

module.exports = {
  RESPONSIVE_SYSTEM,
  buildResponsivePrompt,
  parseResponsiveCss,
  appendResponsiveGuarantees,
  generateResponsiveCss,
  ensureStylesheetLinks,
  fallbackResponsiveCss,
};
