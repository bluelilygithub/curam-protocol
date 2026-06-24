/**
 * Stage 1 — flat HTML/CSS skin generation and iteration prompts.
 */

const { summarizeWireframeStructure, compactWireframeHtmlForDesign } = require('../utils/wireframeStructure');

const DEFAULT_PAGES = ['Home', 'About', 'Services', 'Blog', 'Portfolio', 'Contact'];

const STAGE1_SYSTEM_PROMPT = `You are a senior UI/UX designer and front-end developer producing client-ready website skins for agency sign-off.

QUALITY BAR (non-negotiable):
- The design must look bespoke, polished, and intentional — suitable for a paying client presentation
- NEVER output generic "AI template" layouts (cookie-cutter hero + 3 icon cards + CTA band) unless the brief explicitly asks for that structure
- NEVER ignore inspiration references — if URLs or likes/dislikes are provided, the result must visibly pay homage to those references in layout rhythm, typography, spacing, navigation treatment, and mood
- Avoid: purple-on-white clichés, timid typography, cramped or randomly spaced sections, unstyled lists, placeholder lorem without context, visually flat pages with no hierarchy

DESIGN EXECUTION:
- Establish a clear visual hierarchy on every page: dominant hero, supporting sections, deliberate whitespace
- Typography must feel designed: distinct heading/body pairing, thoughtful scale (clamp() encouraged), letter-spacing and line-height tuned per level
- Colour must feel art-directed: use CSS custom properties for a cohesive palette derived from brand + inspiration cues (not default blue links on grey)
- Layout must feel editorial: asymmetry, grid-breaking moments, and section contrast are encouraged when they serve the brief
- Navigation must match the site type and inspiration tone (not always a horizontal pill bar)
- Imagery: use https://picsum.photos with purposeful crops/sizes; images should support composition, not fill holes

BRIEF COMPLIANCE (non-negotiable):
- The header navigation MUST list EXACTLY the pages named in the brief — same labels, same order, no extras, no omissions
- Each named page MUST exist as its own <section id="..."> in index.html; nav hrefs MUST point to those ids
- Every functionality item nominated in the brief (search, forms, newsletter, etc.) MUST appear as visible, styled HTML in the prototype — not omitted, not mentioned only in comments
- Use static HTML forms (method="get" action="#") for contact, newsletter, search — they are visual prototypes, but must look complete and be usable in preview

TECHNICAL:
- Semantic HTML5 throughout
- CSS custom properties for colours, fonts, spacing, radii, shadows
- CSS Grid and Flexbox — mobile-first, fully responsive
- html { scroll-behavior: smooth; } — in style.css only
- Each page as a clearly commented section in one index.html; in-page anchor navigation between sections
- External stylesheets only: <link rel="stylesheet" href="style.css"> then <link rel="stylesheet" href="responsive.css">
- responsive.css will be generated separately — focus style.css on desktop layout; do not rely on mobile @media in style.css
- Load Google Fonts via @import in CSS when specified
- No <script> tags — static HTML/CSS prototype only; never put CSS inside <script>
- No WordPress, PHP, React, Tailwind, or CSS frameworks

REGION IDs (preserve from wireframe — required for targeted client edits):
- Keep id and data-tb-region on: tb-header, site-navigation, tb-footer, tb-search, tb-map, tb-reviews, tb-social
- Keep section ids: home, about, services, blog, portfolio, contact (with data-tb-region)
- Never remove or rename these ids when polishing the design
- Default styles = mobile (320px): single column, stacked nav, no horizontal scroll
- Add desktop layout ONLY inside @media (min-width: 768px) — never multi-column grids in base CSS
- Include BOTH @media (min-width: 768px) AND @media (max-width: 767px) blocks
- Use .container (max-width ~72rem, horizontal padding) inside every full-width section band
- Grids start as 1 column; add columns only inside min-width media queries
- No horizontal overflow at 320px; images max-width: 100%
- Header nav must work on mobile — a hamburger toggle will be added post-generation; leave room in the header for a menu button beside the logo
- Fixed/side elements must not overlap content on narrow screens

OUTPUT — return ONLY this format (no markdown fences, no commentary before or after):
---HTML---
<!DOCTYPE html>...complete document...
---CSS---
/* full style.css */`;

const HOME_DESIGN_SYSTEM_PROMPT = `You polish an APPROVED wireframe into a client-ready visual design. The client already signed off the STRUCTURE — your job is styling, not re-architecting.

FIDELITY (non-negotiable — violations fail client sign-off):
- Keep every section id, region id (tb-header, site-navigation, tb-footer, tb-search, tb-map, etc.), and data-tb-region from the wireframe
- Keep sections in the EXACT same order — do not reorder, merge, split, or remove sections
- Keep navigation labels, href targets, and header/footer layout slots identical to the wireframe
- Keep the same grid/column structure per section (same number of columns; you may style them)
- Apply inspiration and brand via colour, typography, imagery, spacing, and copy — NOT by inventing a new layout
- If the wireframe has a two-column hero, the design must keep two columns; if stubs exist for About/Services, keep them as stubs

POLISH (what you SHOULD change):
- Replace wireframe greys with the brand palette and refined CSS custom properties
- Upgrade typography scale, weights, and pairing per the brief
- Replace .img-ph / placeholders with purposeful picsum.photos images
- Improve placeholder copy (realistic, audience-appropriate — not lorem ipsum)
- Move inline wireframe CSS into a proper external style.css; add <link rel="stylesheet" href="style.css">

TECHNICAL:
- Semantic HTML5; preserve the wireframe DOM tree — refine classes and content, do not rebuild from scratch
- External stylesheets only: <link rel="stylesheet" href="style.css"> (responsive.css is generated later)
- No <script> tags; no WordPress/PHP/React/Tailwind
- html { scroll-behavior: smooth; } in style.css only

OUTPUT — return ONLY:
---HTML---
<!DOCTYPE html>...complete document...
---CSS---
/* full style.css */`;

function yesNo(value) {
  return value ? 'Yes' : 'No';
}

function listOrNone(items) {
  if (!items || !items.length) return 'None specified';
  return items.join(', ');
}

function formatBrandFonts(brand) {
  if (brand.aiChooseFonts) return 'Choose distinctive Google Fonts pairing appropriate to inspiration and feel words';
  const heading = brand.headingFont || '';
  const body = brand.bodyFont || '';
  if (heading && body) {
    return `Heading: ${heading}; Body: ${body} — load both via Google Fonts @import in CSS`;
  }
  if (heading || body) {
    const parts = [];
    if (heading) parts.push(`Heading: ${heading}`);
    if (body) parts.push(`Body: ${body}`);
    return `${parts.join('; ')} — Google Fonts @import in CSS`;
  }
  if (brand.fonts) return brand.fonts;
  return 'Choose distinctive Google Fonts pairing appropriate to inspiration and feel words';
}

function formatStyleHints(styles = {}) {
  const lines = [];
  if (styles.body?.fontFamily) lines.push(`Body: ${styles.body.fontFamily} @ ${styles.body.fontSize}`);
  if (styles.h1?.fontFamily) lines.push(`H1: ${styles.h1.fontFamily} @ ${styles.h1.fontSize}, weight ${styles.h1.fontWeight}`);
  if (styles.header?.backgroundColor) lines.push(`Header bg: ${styles.header.backgroundColor}`);
  if (styles.nav?.color) lines.push(`Nav text: ${styles.nav.color}`);
  return lines.length ? lines.join('; ') : '';
}

function formatInspirationResearch(research = []) {
  if (!research.length) return '';

  const blocks = research.map((site) => {
    if (!site.ok) {
      return `- ${site.url}: (could not load — use the client's written likes/dislikes for this reference${site.error ? `; ${site.error}` : ''})`;
    }

    const lines = [`- ${site.url} [captured via ${site.method || 'unknown'}]`];
    if (site.title) lines.push(`  Title: ${site.title}`);
    if (site.description) lines.push(`  Description: ${site.description}`);
    if (site.themeColor) lines.push(`  Theme colour: ${site.themeColor}`);
    if (site.fontHints?.length) lines.push(`  Google Fonts in source: ${site.fontHints.join(', ')}`);
    if (site.navLinks?.length) {
      lines.push(`  Rendered nav: ${site.navLinks.map((l) => l.text).join(' · ')}`);
    }
    const styleHint = formatStyleHints(site.styles);
    if (styleHint) lines.push(`  Computed styles: ${styleHint}`);
    if (site.colors?.length) lines.push(`  Palette samples: ${site.colors.join(', ')}`);
    if (site.vision?.ok && site.vision.designBrief) {
      lines.push(`  Visual design analysis:\n${site.vision.designBrief.split('\n').map((l) => `    ${l}`).join('\n')}`);
    }
    return lines.join('\n');
  });

  return `

### Inspiration site research (browser capture + visual analysis)
${blocks.join('\n\n')}

HOMAGE REQUIREMENT: The visual analysis and computed styles above describe what these sites actually look like. Your design must echo their layout language, navigation treatment, typography feel, colour palette, density, and mood — adapted to this client's content, not copied pixel-for-pixel.`;
}

function buildInspirationDirective(inspiration, research) {
  const hasUrls = inspiration.urls?.length > 0;
  const hasLikes = Boolean(inspiration.likes?.trim());
  const hasFeel = Boolean(inspiration.feelWords?.trim());

  if (!hasUrls && !hasLikes && !hasFeel) {
    return 'No specific inspiration provided — still avoid generic templates; infer a strong art direction from site type and audience.';
  }

  return `INSPIRATION IS PRIMARY INPUT — treat this as the main creative direction:
- Reference URLs: ${listOrNone(inspiration.urls)}
- What the client likes: ${inspiration.likes || 'Not specified — infer from URLs'}
- What to avoid: ${inspiration.dislikes || 'Not specified'}
- Desired feel: ${inspiration.feelWords || 'Not specified'}
${formatInspirationResearch(research)}`;
}

function pageToSectionId(pageName) {
  const slug = String(pageName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'page';
}

function buildNavigationRequirements(pages = []) {
  if (!pages.length) {
    return '';
  }

  const mapping = pages.map((page) => `  - Nav label "${page}" → <section id="${pageToSectionId(page)}">`);
  return `

## MANDATORY NAVIGATION — wizard pages (exact match required)
The client selected exactly these pages: ${pages.join(', ')}

Requirements:
- The site header/nav MUST contain exactly ${pages.length} links, one per page above — same names, same order
- Do NOT add nav items that were not selected (e.g. no Blog if Blog was not selected)
- Do NOT omit any selected page from the nav
- Each page MUST be a separate <section id="..."> in index.html
- Nav links MUST be <a href="#section-id"> using these mappings:
${mapping.join('\n')}`;
}

function buildFunctionalityRequirements(functionality = []) {
  if (!functionality.length) {
    return '';
  }

  const items = functionality.map((f) => String(f).toLowerCase());
  const reqs = [];

  if (items.some((f) => f === 'search')) {
    reqs.push('- SEARCH: Visible search UI in the header (preferred) or top of page — <form role="search"> with <input type="search" name="q" placeholder="Search…"> and a submit button, fully styled.');
  }
  if (items.some((f) => f.includes('contact form'))) {
    reqs.push('- CONTACT FORM: A complete styled contact form on the Contact page/section — fields: name, email, message (minimum), labels, submit button. Use <form> with appropriate input types.');
  }
  if (items.some((f) => f.includes('newsletter'))) {
    reqs.push('- NEWSLETTER SIGNUP: Email capture form (email input + submit, optional name) in footer and/or a dedicated section, styled to match.');
  }
  if (items.some((f) => f === 'blog')) {
    reqs.push('- BLOG: Include a Blog page/section with at least 2–3 article preview cards (title, excerpt, date, read link).');
  }
  if (items.some((f) => f.includes('portfolio') || f.includes('gallery'))) {
    reqs.push('- PORTFOLIO/GALLERY: Image grid or gallery section with at least 6 placeholder images on the relevant page.');
  }
  if (items.some((f) => f === 'booking')) {
    reqs.push('- BOOKING: Include a booking request form (date, name, email, service) or clear booking CTA with form fields.');
  }
  if (items.some((f) => f.includes('social'))) {
    reqs.push('- SOCIAL FEEDS: Visible social presence — icon or text links for Facebook, Instagram, and LinkedIn in the header AND a labelled social row in the footer (href="#"). Do not omit.');
  }
  if (items.some((f) => f.includes('google map'))) {
    reqs.push('- GOOGLE MAP: Map placeholder on Contact section — <div class="map-ph tb-map"> containing a visible map illustration (use an <img> with a map-style placeholder, not an empty box). Min-height 280px, full width, ready to swap for a real embed.');
  }
  if (items.some((f) => f.includes('google review'))) {
    reqs.push('- GOOGLE REVIEWS: Reviews strip with 2–3 cards — star rating (★★★★★), reviewer name, short quote, and "Google Review" label. Place on Home or Testimonials section.');
  }
  if (items.some((f) => f.includes('multilingual'))) {
    reqs.push('- MULTILINGUAL: Language switcher UI in header (e.g. EN | FR links), styled but static.');
  }
  if (items.some((f) => f === 'ecommerce')) {
    reqs.push('- ECOMMERCE: Product card grid with image, title, price, and add-to-cart button styling on shop section.');
  }

  const isHandled = (lower) => (
    lower === 'search'
    || lower.includes('contact form')
    || lower.includes('newsletter')
    || lower === 'blog'
    || lower.includes('portfolio')
    || lower.includes('gallery')
    || lower === 'booking'
    || lower.includes('social')
    || lower.includes('google map')
    || lower.includes('google review')
    || lower.includes('multilingual')
    || lower === 'ecommerce'
  );

  functionality.forEach((feature) => {
    const lower = String(feature).toLowerCase();
    if (!isHandled(lower)) {
      reqs.push(`- ${String(feature).toUpperCase()}: Include visible UI for "${feature}" as appropriate to the site type.`);
    }
  });

  return `

## MANDATORY FUNCTIONALITY — wizard selections (must appear in HTML)
${reqs.join('\n')}

Every item above MUST be implemented as visible HTML/CSS in the prototype — not skipped.`;
}

function buildPreSubmitChecklist(pages, functionality) {
  return `

## Before you return JSON — self-check
- [ ] Nav has exactly ${pages.length || 'N'} items matching: ${listOrNone(pages)}
- [ ] Each page has a matching <section id="...">
- [ ] All functionality items implemented: ${listOrNone(functionality)}`;
}

function buildIntakeBrief(intakeData, inspirationResearch = []) {
  const purpose = intakeData.purpose || {};
  const inspiration = intakeData.inspiration || {};
  const brand = intakeData.brand || {};
  const structure = intakeData.structure || {};
  const functionality = intakeData.functionality || [];
  const pages = structure.pages?.length ? structure.pages : DEFAULT_PAGES;

  const pageSections = structure.pageSections || {};
  const sectionsText = Object.keys(pageSections).length
    ? Object.entries(pageSections)
        .map(([page, sections]) => `  - ${page}: ${sections || 'AI to propose sections that match inspiration'}`)
        .join('\n')
    : '  - AI to propose sections per page that match inspiration and site type';

  return `## Creative direction (read first)
${buildInspirationDirective(inspiration, inspirationResearch)}

## Purpose
- Site type: ${purpose.siteFor || 'Not specified'}
- Target audience: ${purpose.targetAudience || 'Not specified'}
- Primary visitor action: ${purpose.primaryAction || 'Not specified'}

## Brand
- Has logo: ${yesNo(brand.hasLogo)}
- Primary colour: ${brand.primaryColor || 'Derive palette from inspiration + feel words'}
- Fonts: ${formatBrandFonts(brand)}

## Pages & structure
- Pages required: ${listOrNone(pages)} (standard site structure)
- Sections per page:
${sectionsText}

## Content
- Client has NOT supplied final copy or images — use realistic placeholder text and picsum.photos throughout
- Site will be updated by a non-technical client in WordPress after theme build — use clear text blocks (headings, paragraphs, lists), not text inside images
- Placeholder copy must match the business and audience; never lorem ipsum

## Functionality
${functionality.length ? functionality.map((f) => `- ${f}`).join('\n') : '- None specified'}
${buildNavigationRequirements(pages)}
${buildFunctionalityRequirements(functionality)}
${buildPreSubmitChecklist(pages, functionality)}

Deliver a production-quality static prototype. Write realistic placeholder copy for the audience — not lorem ipsum. The client must recognise the inspiration references in the finished design.`;
}

function buildStage1GeneratePrompt(intakeData, inspirationResearch = []) {
  return {
    system: STAGE1_SYSTEM_PROMPT,
    user: `Create the complete HTML/CSS site skin from this design brief.\n\n${buildIntakeBrief(intakeData, inspirationResearch)}`,
  };
}

function buildHomeDesignPrompt(intakeData, inspirationResearch, wireframeHtml, wireframeIterateCss = '') {
  const pages = intakeData?.structure?.pages || [];
  const otherPages = pages.filter((p) => !/^home$/i.test(p));
  const structure = summarizeWireframeStructure(wireframeHtml);
  const compactHtml = compactWireframeHtmlForDesign(wireframeHtml);
  const iterateBlock = String(wireframeIterateCss || '').trim()
    ? `\n\n## Approved element styles from wireframe (preserve on the same ids)\n\`\`\`css\n${wireframeIterateCss.trim()}\n\`\`\``
    : '';

  return {
    system: HOME_DESIGN_SYSTEM_PROMPT,
    user: `Polish this APPROVED wireframe into a designed homepage. The client approved the structure below — do not replace it with a different layout.

${buildIntakeBrief(intakeData, inspirationResearch)}

## Structure lock (from approved wireframe — must match exactly)
${structure.summary}

## Homepage-first scope
- Polish the HOME section interior to production quality (colour, type, imagery, copy)
- Other pages (${otherPages.join(', ') || 'none'}): keep as the same minimal stubs as the wireframe — do not fully design yet
- Every MANDATORY FUNCTIONALITY item must remain visible and styled — do not drop search, social, map, or reviews
- Inspiration URLs inform palette and detail — they do NOT override the approved section order or layout

## Approved wireframe HTML (preserve structure — polish only)
${compactHtml}${iterateBlock}

Return ---HTML--- and ---CSS--- only. The HTML tree must retain the same section ids and order as above.`,
  };
}

function buildStage1IteratePrompt({ currentHtml, currentCss, changeRequest }) {
  const cssBlock = currentCss
    ? `\n\nCurrent CSS:\n${currentCss}`
    : '';

  return {
    system: STAGE1_SYSTEM_PROMPT,
    user: `Apply this change request to the current site design. Return ---HTML--- and ---CSS--- only.
Preserve and improve responsive behaviour — every change must still work at 320px, 768px, and 1280px.

Change request:\n${changeRequest}\n\nCurrent HTML:\n${currentHtml}${cssBlock}`,
  };
}

module.exports = {
  STAGE1_SYSTEM_PROMPT,
  HOME_DESIGN_SYSTEM_PROMPT,
  DEFAULT_PAGES,
  buildIntakeBrief,
  buildNavigationRequirements,
  buildFunctionalityRequirements,
  pageToSectionId,
  formatBrandFonts,
  buildStage1GeneratePrompt,
  buildHomeDesignPrompt,
  buildStage1IteratePrompt,
};
