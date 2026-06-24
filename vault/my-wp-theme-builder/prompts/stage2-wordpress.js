/**
 * Stage 2 — WordPress theme generation prompts (one call per artifact).
 */

const STAGE2_BASE_SYSTEM = `You are an expert WordPress theme developer using Classic PHP, ACF Pro, and acf-json sync.
Generate production-ready code only. No Node.js, React, or build tools.
Use WordPress coding standards, escape output, and prefix functions with the theme slug.
Return ONLY the requested format — no extra commentary.`;

function buildCall1AnalysisPrompt({ approvedHtml, approvedCss, intakeData, wpData }) {
  return {
    system: `${STAGE2_BASE_SYSTEM}
Analyze the approved HTML/CSS and WordPress brief. Return ONLY valid JSON:
{
  "sections": [{ "id": "", "page": "", "label": "", "htmlSnippet": "", "suggestedFields": [{ "key": "", "label": "", "type": "text|textarea|image|wysiwyg|url" }] }],
  "editableAreas": [{ "selector": "", "fieldKey": "", "label": "" }],
  "acfFields": { "PageName": [{ "key": "", "label": "", "type": "" }] },
  "repeatingElements": [{ "type": "", "suggestedCpt": "", "fields": [] }],
  "blocks": [{ "slug": "", "title": "", "sectionId": "" }],
  "navMenus": [{ "location": "", "label": "" }],
  "templateParts": [{ "slug": "", "page": "", "section": "" }]
}`,
    user: `Analyze this design for WordPress conversion.

intakeData:
${JSON.stringify(intakeData || {}, null, 2)}

wpData:
${JSON.stringify(wpData || {}, null, 2)}

HTML:
${approvedHtml.slice(0, 80000)}

CSS:
${(approvedCss || '').slice(0, 20000)}`,
  };
}

function buildCall2StylePrompt({ analysis, wpData, approvedCss, themeSlug }) {
  const setup = wpData?.setup || {};
  return {
    system: `${STAGE2_BASE_SYSTEM}
Return ONLY valid JSON: { "style.css": "full file contents including WordPress theme header comment block" }`,
    user: `Convert this CSS into a WordPress theme stylesheet with a proper theme header.

Theme slug: ${themeSlug}
Theme name: ${setup.themeName || themeSlug}
Version: ${setup.themeVersion || '1.0.0'}
Author: ${setup.authorName || 'Theme Builder'}

Analysis:
${JSON.stringify(analysis, null, 2)}

Approved CSS:
${approvedCss || '/* generate from analysis */'}`,
  };
}

function buildCall3FunctionsPrompt({ analysis, wpData, themeSlug }) {
  return {
    system: `${STAGE2_BASE_SYSTEM}
Return ONLY valid JSON: { "functions.php": "<?php ... full file" }
Register nav menus, enqueue styles/scripts, custom post types from wpData, ACF blocks, ACF options page if requested, theme supports.`,
    user: `Generate functions.php for theme "${themeSlug}".

wpData:
${JSON.stringify(wpData, null, 2)}

Analysis:
${JSON.stringify(analysis, null, 2)}`,
  };
}

function buildCall4HeaderFooterPrompt({ analysis, approvedHtml, themeSlug }) {
  return {
    system: `${STAGE2_BASE_SYSTEM}
Return ONLY valid JSON: { "header.php": "...", "footer.php": "..." }
Use wp_head(), wp_footer(), wp_nav_menu(), bloginfo(), language_attributes(), body_class().`,
    user: `Extract header and footer from this HTML and convert to WordPress PHP templates for theme "${themeSlug}".

Analysis:
${JSON.stringify(analysis, null, 2)}

HTML:
${approvedHtml.slice(0, 60000)}`,
  };
}

function buildCall5TemplatesPrompt({ analysis, wpData, approvedHtml, themeSlug }) {
  return {
    system: `${STAGE2_BASE_SYSTEM}
Return ONLY valid JSON:
{
  "front-page.php": "...",
  "page.php": "...",
  "template-parts": {
    "slug-name.php": "..."
  }
}
Replace hardcoded content with get_field() / the_field() using field keys from analysis and wpData.
Use get_template_part() for sections.`,
    user: `Convert homepage and page templates for theme "${themeSlug}".

wpData:
${JSON.stringify(wpData, null, 2)}

Analysis:
${JSON.stringify(analysis, null, 2)}

HTML:
${approvedHtml.slice(0, 80000)}`,
  };
}

function buildCall6AcfJsonPrompt({ analysis, wpData, themeSlug }) {
  return {
    system: `${STAGE2_BASE_SYSTEM}
Return ONLY valid JSON:
{
  "acf-json": {
    "group_xxxxx.json": { ... valid ACF export field group object ... }
  }
}
Generate importable ACF Pro JSON for each page, each CPT from wpData, and options page if enabled.
Use location rules, field keys matching analysis, and acf-json sync compatible structure.`,
    user: `Generate ACF field group JSON files for theme "${themeSlug}".

wpData:
${JSON.stringify(wpData, null, 2)}

Analysis:
${JSON.stringify(analysis, null, 2)}`,
  };
}

function buildCall7BlocksPrompt({ analysis, wpData, themeSlug }) {
  return {
    system: `${STAGE2_BASE_SYSTEM}
Return ONLY valid JSON:
{
  "blocks": [
    {
      "slug": "hero",
      "block.json": { ... },
      "render.php": "<?php ...",
      "style.css": "..."
    }
  ]
}
One entry per ACF block section from analysis/wpData.`,
    user: `Generate ACF block files for theme "${themeSlug}".

wpData:
${JSON.stringify(wpData, null, 2)}

Analysis:
${JSON.stringify(analysis, null, 2)}`,
  };
}

function buildCall8ReadmePrompt({ analysis, wpData, themeSlug }) {
  const setup = wpData?.setup || {};
  return {
    system: `${STAGE2_BASE_SYSTEM}
Return ONLY valid JSON: { "README.md": "markdown content" }
Include install steps, ACF sync, field guide, menu locations, required plugins.`,
    user: `Write README.md for theme "${themeSlug}".

Theme name: ${setup.themeName || themeSlug}
Author: ${setup.authorName || ''}
Include README: ${setup.includeReadme !== false}

wpData:
${JSON.stringify(wpData, null, 2)}

Analysis:
${JSON.stringify(analysis, null, 2)}`,
  };
}

module.exports = {
  STAGE2_BASE_SYSTEM,
  buildCall1AnalysisPrompt,
  buildCall2StylePrompt,
  buildCall3FunctionsPrompt,
  buildCall4HeaderFooterPrompt,
  buildCall5TemplatesPrompt,
  buildCall6AcfJsonPrompt,
  buildCall7BlocksPrompt,
  buildCall8ReadmePrompt,
};
