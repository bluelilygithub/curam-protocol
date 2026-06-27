/**
 * Stage 1 (templates) — design prompts for page / single / cpt templates.
 *
 * These templates inherit the design language locked by the approved homepage.
 * The model reuses the homepage header/footer and token system, and designs
 * ONLY the template's <main> region as a polished, complete page — pure UI.
 * CMS wiring (ACF/meta field binding) is a SEPARATE, later step, so the design
 * phase stays focused entirely on visual quality.
 */

const { buildFunctionalityRequirements } = require('./stage1-design');

const TEMPLATE_MAIN_ID = 'tb-template-main';

const TEMPLATE_SYSTEM_PROMPT = `You are a senior UI/UX designer extending an EXISTING, approved website theme with a new page. The visual language — palette, typography, spacing, buttons, cards, motion — is already locked by the homepage. Design this page so it looks like it was always part of the same theme, with the same craft and polish as the homepage.

NON-NEGOTIABLES:
- Reuse the provided header and footer EXACTLY as given — do not redesign the site chrome.
- Inherit the existing CSS custom properties (tokens) and utility/class conventions. Reuse classes like .container, .btn, card classes where they exist. Do NOT invent a new palette or type scale.
- Design ONLY the main region: <main id="${TEMPLATE_MAIN_ID}" data-tb-region="template-main"> … </main>. Everything page-specific lives inside it.
- This is PURE UI DESIGN. Design a complete, finished page: real sections, genuinely good layout, realistic copy, and picsum.photos imagery — exactly as you would design any polished page of the site. Do NOT add CMS field markers, binding attributes, or "dynamic slot" placeholders. Content is wired to WordPress fields in a later step; right now, focus 100% on the visual design.
- Keep it production-quality and fully responsive (mobile-first; desktop layout in @media (min-width: 768px)).
- The only script permitted is the inherited inline IntersectionObserver (id="tb-inview"); do not add other scripts.

OUTPUT — return ONLY this format (no markdown fences, no commentary):
---HTML---
<!DOCTYPE html>...complete document reusing the given header/footer, with the designed <main id="${TEMPLATE_MAIN_ID}">...
---CSS---
/* ADDITIONS ONLY — extra rules for #${TEMPLATE_MAIN_ID} and its children. Do NOT repeat the inherited stylesheet. Reuse existing tokens via var(--…). */`;

function formatMiniBrief(miniBrief = {}, descriptor) {
  const lines = [];

  if (miniBrief.banner?.enabled) {
    const caption = miniBrief.banner.caption?.trim();
    const pos = miniBrief.banner.captionPosition || 'center';
    const style = miniBrief.banner.style || 'image';
    const styleText = style === 'image'
      ? 'a full-width header image banner (use a picsum.photos image) with the page title overlaid and a readable contrast treatment'
      : style === 'solid'
        ? 'a solid-colour banner band (use an existing theme token/accent colour) with the page title'
        : 'a prominent page-title banner';
    lines.push(`- Banner: include ${styleText}. Align the heading/caption to the ${pos}${caption ? ` and use the caption/subtitle: "${caption}"` : ''}.`);
  } else {
    lines.push('- Banner: no large hero banner — start with a compact, left-aligned page heading.');
  }

  if (miniBrief.pageBackground) {
    lines.push(`- Page background: set the overall page background colour to ${miniBrief.pageBackground} (ensure text/contrast remains accessible against it).`);
  }

  if (miniBrief.altBlockBackground) {
    lines.push(`- Alternating sections: give every other content block/section a ${miniBrief.altBlockBackground} background to create visual rhythm down the page.`);
  }

  const widthMap = { narrow: 'a narrow ~720px', standard: 'a standard ~960px', wide: 'a wide ~1200px', full: 'a full-width, edge-to-edge' };
  if (miniBrief.contentWidth) {
    const w = widthMap[miniBrief.contentWidth] || `a ${miniBrief.contentWidth}`;
    lines.push(`- Content width: constrain the main content column to ${w} max-width${miniBrief.contentWidth === 'full' ? ' (sections may still use inner padding)' : ''}.`);
  }

  const sidebar = miniBrief.sidebar || 'none';
  if (sidebar === 'left' || sidebar === 'right') {
    lines.push(`- Sidebar: two-column content layout with the sidebar on the ${sidebar} (widgets/secondary content). Collapse to a single column on mobile.`);
    const sidebarContent = String(miniBrief.sidebarContent || '').trim();
    if (sidebarContent) {
      lines.push(`- Sidebar content: present these as styled widget cards — ${sidebarContent}.`);
    } else {
      lines.push('- Sidebar content: include typical widgets (recent posts, categories, a search box and an enquiry CTA), styled as cards consistent with the theme.');
    }
  } else {
    lines.push('- Sidebar: none — single, centred content column.');
  }

  const components = Array.isArray(miniBrief.components) ? miniBrief.components.filter(Boolean) : [];
  if (components.length) {
    lines.push(`- Components to include in the main region: ${components.join(', ')}.`);
  } else {
    lines.push('- Components: none beyond the core content for this template.');
  }

  let componentSpec = '';
  if (components.length) {
    const spec = buildFunctionalityRequirements(components);
    if (spec) componentSpec = `\n\n## Component build specs (apply inside the main region)\n${spec}`;
  }

  return { miniBriefText: lines.join('\n'), componentSpec };
}

function formatReferences(references = []) {
  if (!references.length) return '';
  const blocks = references.map((ref) => `### Approved ${ref.label} (visual reference — match this language)
${String(ref.html || '').slice(0, 6000)}`);
  return `\n\n## Already-approved templates to stay consistent with\n${blocks.join('\n\n')}`;
}

function buildTemplateDesignPrompt({
  descriptor,
  label,
  miniBrief = {},
  homepageHeader = '',
  homepageFooter = '',
  tokensCss = '',
  homepageCssExcerpt = '',
  references = [],
  intakeSummary = '',
}) {
  const { miniBriefText, componentSpec } = formatMiniBrief(miniBrief, descriptor);

  const user = `Design the "${label}" page (${descriptor.label} — ${descriptor.description}) for the existing theme. This is pure visual/UI design — make it as polished as the homepage.

## Inherited site chrome — reuse EXACTLY
HEADER (place immediately inside <body>):
${homepageHeader || '<!-- (no header captured — keep a simple <header> consistent with the theme) -->'}

FOOTER (place at the end of <body>, before scripts):
${homepageFooter || '<!-- (no footer captured) -->'}

## Inherited design tokens (use via var(--…) — do not redefine the palette)
${tokensCss || '/* no :root tokens captured — match the reference CSS below */'}

## Inherited stylesheet excerpt (reuse these classes/conventions)
${String(homepageCssExcerpt || '').slice(0, 3500)}

## This page's mini-brief
${miniBriefText}
${componentSpec}
${intakeSummary ? `\n\n## Site context\n${intakeSummary}` : ''}${formatReferences(references)}

Return ---HTML--- (full document reusing the header/footer above, with the designed <main id="${TEMPLATE_MAIN_ID}">) then ---CSS--- with ADDITIONS ONLY.`;

  return { system: TEMPLATE_SYSTEM_PROMPT, user };
}

function buildTemplateIteratePrompt({ currentHtml, currentCss, changeRequest, label }) {
  return {
    system: TEMPLATE_SYSTEM_PROMPT,
    user: `Apply this change to the "${label}" page. Keep the inherited header/footer and design tokens intact. This is still pure UI design — do not add CMS field markers. Only change what is asked.

Change request: ${changeRequest}

Current HTML:
${currentHtml}

Current CSS additions:
${currentCss}

Return ---HTML--- (full document) then ---CSS--- with the template's additional rules.`,
  };
}

module.exports = {
  TEMPLATE_SYSTEM_PROMPT,
  TEMPLATE_MAIN_ID,
  buildTemplateDesignPrompt,
  buildTemplateIteratePrompt,
  formatMiniBrief,
};
