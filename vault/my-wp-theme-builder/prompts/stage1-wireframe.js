/**
 * Stage 1a — homepage wireframe (structure only).
 */

const {
  buildIntakeBrief,
  buildNavigationRequirements,
  buildFunctionalityRequirements,
  pageToSectionId,
  formatBrandFonts,
  DEFAULT_PAGES,
} = require('./stage1-design');

const WIREFRAME_RESPONSIVE_SCAFFOLD = `
.container { width: 100%; max-width: 72rem; margin: 0 auto; padding: 0 1.25rem; }
.wf-grid { display: grid; gap: 1.5rem; grid-template-columns: 1fr; }
.header-inner { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; }
@media (min-width: 768px) {
  .wf-grid--2 { grid-template-columns: repeat(2, 1fr); }
  .wf-grid--3 { grid-template-columns: repeat(3, 1fr); }
  .header-inner { flex-direction: row; justify-content: space-between; }
  nav ul { flex-direction: row; }
}
@media (max-width: 767px) {
  .header-inner { flex-direction: column; align-items: stretch; }
  nav ul { flex-direction: column; width: 100%; }
  .side-tab, .wf-side-cta { display: none !important; }
}`;

const WIREFRAME_SYSTEM_PROMPT = `You are a senior UX designer producing a homepage wireframe for client review.

SCOPE — homepage wireframe only:
- Build the HOME page layout in full wireframe detail (hero, key sections, CTAs)
- Other wizard pages: include in nav AND as minimal stub sections (single labelled box: "About — stub")
- USE brand colours and fonts from the brief (Google Fonts @import when specified)
- Wireframe = clear page structure, not a pile of random dashed boxes

FUNCTIONALITY (first pass — never defer to a later phase):
- Every item under "MANDATORY FUNCTIONALITY" in the user brief MUST appear as visible HTML in this wireframe
- SEARCH → <form role="search"> with <input type="search"> and submit button on the SAME ROW (flex row, no wrap)
- SOCIAL FEEDS → labelled links/icons for major networks in header or footer
- GOOGLE MAP → .map-ph placeholder box (min-height 280px) on Contact section
- GOOGLE REVIEWS → 2–3 review cards with stars on Home
- Forms, newsletter, booking, etc. → complete visible UI per the brief requirements

LAYOUT ARCHITECTURE (required — prevents broken desktop/mobile layouts):
- Use a consistent page shell: header → main → footer
- Header structure: <header><div class="container header-inner">…nav…search if selected…</div></header>
- Every homepage section: <section class="wf-section"> containing <div class="container"> (max-width: 72rem; margin: 0 auto; padding: 0 1.25rem; width: 100%)
- Grids: display: grid; gap: 1.5rem; grid-template-columns: 1fr by default
- Images/placeholders: aspect-ratio + width 100%; never fixed pixel widths that overflow 320px viewports
- No absolute-positioned orphans that break document flow

RESPONSIVE (non-negotiable — mobile first, then scale up):
- Default CSS = mobile layout (320px): 1 column, stacked header/nav, no overflow
- Desktop columns ONLY inside @media (min-width: 768px) — never set multi-column grids in base styles
- Include BOTH @media (min-width: 768px) AND @media (max-width: 767px) blocks in your <style>
- Header nav: stack vertically on mobile; horizontal nav only from 768px up
- Fixed side tabs / rotated CTAs: hide below 768px — never overlap content on mobile
- Include this responsive scaffold (adapt class names if needed, do not omit the @media blocks):
${WIREFRAME_RESPONSIVE_SCAFFOLD}

WIREFRAME VISUAL LANGUAGE (this is NOT the final designed site — keep it clearly structural):
- Muted wireframe palette: light grey page background (#f4f4f5), white sections, dark grey text (#334155)
- Do NOT apply full brand polish — no gradients, shadows, or marketing photography
- Brand primary colour: accents ONLY on buttons and nav active state (sparingly)
- Section labels as small .wf-label tags — do not wrap every element in dashed boxes
- Image areas: single .img-ph placeholder per slot (grey fill, centred label)
- Realistic sample headline in hero (business-appropriate length)
- Nav labels must match wizard page names exactly

TECHNICAL:
- Single HTML file with inline <style> in <head>
- Shared utility classes: .container, .wf-section, .wf-grid, .img-ph, .stub-box, .btn-ph, .map-ph
- Keep CSS ≤160 lines — utilities first, minimal per-section overrides
- Semantic HTML5; no <script> tags
- html { scroll-behavior: smooth; }
- Complete document ending with </body></html>

REGION IDs (required for targeted edits — preserve on every iteration):
- <header id="tb-header" data-tb-region="header">
- <nav id="site-navigation" data-tb-region="navigation">
- <footer id="tb-footer" data-tb-region="footer">
- Search form: id="tb-search" data-tb-region="search"
- Map placeholder: id="tb-map" data-tb-region="map"
- Each page section: id matching page slug (home, about, services, blog, portfolio, contact) plus data-tb-region
- NEVER remove or rename these ids when updating the wireframe

OUTPUT — return ONLY:
---HTML---
<!DOCTYPE html>...complete document...`;

function buildBrandWireframeHints(intakeData) {
  const brand = intakeData?.brand || {};
  const primary = brand.primaryColor || 'Use neutral grey wireframe chrome unless a single accent is needed';
  return `- Wireframe palette first; brand primary (${primary}) only for 1–2 accent elements (e.g. main CTA)
- Fonts: ${formatBrandFonts(brand)} — may use in wireframe but keep layout clearly structural, not final design
- Logo: ${brand.hasLogo ? 'leave a labelled logo placeholder in the header' : 'text site name in header using heading font'}`;
}

function buildHomeSectionsHint(intakeData) {
  const pages = intakeData?.structure?.pages?.length
    ? intakeData.structure.pages
    : DEFAULT_PAGES;
  const home = pages.find((p) => /^home$/i.test(p)) || 'Home';
  const pageSections = intakeData?.structure?.pageSections || {};
  const homeSections = pageSections[home] || pageSections.Home || '';
  if (homeSections) {
    return `Home page sections requested: ${homeSections}`;
  }
  return 'Propose 3–5 homepage sections that match the site type and inspiration (hero, value prop, services teaser, social proof, CTA).';
}

function buildWireframeFunctionalityBlock(intakeData) {
  const functionality = intakeData?.functionality || [];
  if (!functionality.length) return '';

  return `
## WIREFRAME FUNCTIONALITY — include on first generation (checklist)
Selected: ${functionality.join(', ')}

Placement guide:
- Search → header (inside .header-inner, visible on all breakpoints)
- Social feeds → footer social row AND/OR header utility area
- Google Map → Contact stub/section as .map-ph embed box
- Google Reviews → Home section with star-rated review cards
- Contact / newsletter / booking → visible forms in the relevant section

${buildFunctionalityRequirements(functionality)}`;
}

function buildWireframePrompt(intakeData, inspirationResearch = [], shellHtml = '') {
  const pages = intakeData?.structure?.pages?.length
    ? intakeData.structure.pages
    : DEFAULT_PAGES;
  const stubList = pages
    .filter((p) => !/^home$/i.test(p))
    .map((p) => `  - "${p}" → <section id="${pageToSectionId(p)}"> with one dashed box labelled "${p} — stub"`)
    .join('\n');

  const shellBlock = shellHtml ? `

## REQUIRED SKELETON (non-negotiable)
The HTML below includes mandatory nav, functionality components, stub sections, and mobile-first CSS.
- You MAY redesign the HOME section interior (#home-interior) with wireframe styling
- You MUST NOT remove any nav link, tb-* component, stub section, or @media rules
- Preserve every element from the skeleton; add wireframe styling only

${shellHtml}` : '';

  return {
    system: WIREFRAME_SYSTEM_PROMPT,
    user: `Create a homepage wireframe from this brief. Build a coherent page layout (container + sections + grids) — not disconnected blocks.

${buildIntakeBrief(intakeData, inspirationResearch)}
${buildWireframeFunctionalityBlock(intakeData)}
${shellBlock}

## Wireframe-specific instructions
- ${buildHomeSectionsHint(intakeData)}
${buildBrandWireframeHints(intakeData)}
- Home section id must be "${pageToSectionId('Home')}" (nav label "Home")

## Stub sections (not full wireframes — one box each)
${stubList || '  - (no other pages selected)'}

Before returning: confirm viewport meta, both @media breakpoints, and every selected functionality item is visible in the HTML.

Return only ---HTML--- with a complete document.`,
  };
}

function buildWireframeIteratePrompt({ currentHtml, changeRequest }) {
  return {
    system: WIREFRAME_SYSTEM_PROMPT,
    user: `Update this homepage wireframe. Preserve the container/section/grid structure and responsive @media rules unless the change request requires layout change.

Change request: ${changeRequest}

Current wireframe HTML:
${currentHtml}

Return only ---HTML--- with the updated complete document.

FORMAT (strict):
---HTML---
<!DOCTYPE html>
<html>…entire document…</html>

Do not wrap in markdown code fences. Do not add commentary before or after.`,
  };
}

module.exports = {
  WIREFRAME_SYSTEM_PROMPT,
  buildWireframePrompt,
  buildWireframeIteratePrompt,
};
