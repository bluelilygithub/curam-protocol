'use strict';

/**
 * Template-type descriptors.
 *
 * A theme is built as a sequence of templates that all run the SAME design
 * pipeline (mini-brief -> design -> slop gate -> approve) and inherit the
 * design language locked by the homepage. The only things that differ per type
 * are captured here:
 *   - which WordPress template file(s) it compiles to in Stage 2
 *   - the dynamic wrapper around the designed main region (none / the post loop)
 *   - where its dynamic content comes from (ACF page fields / core post / CPT)
 *   - which already-approved templates it inherits as visual references
 *
 * Binding markers used in the designed HTML (consumed by Stage 2):
 *   data-tb-bind="post_title"     -> the_title()
 *   data-tb-bind="post_content"   -> the_content()
 *   data-tb-bind="post_thumbnail" -> the_post_thumbnail()
 *   data-tb-bind="post_date"      -> get_the_date()
 *   data-tb-bind="acf:field_name" -> get_field('field_name')
 *   data-tb-loop="cpt:slug"       -> WP_Query loop over a CPT (archive)
 */

const TEMPLATE_TYPES = {
  page: {
    id: 'page',
    label: 'Page',
    description: 'A static WordPress Page (About, Services, Contact). Editor/ACF-managed content, no loop.',
    wrapper: 'none',
    fieldSource: 'acf-page',
    emitsArchive: false,
    inheritsFrom: ['home'],
    // Guidance injected into the design prompt for what the main region should bind to.
    bindingGuidance: [
      'The page-title banner heading carries data-tb-bind="post_title".',
      'The primary body/content area carries data-tb-bind="post_content".',
      'Any additional designed sections (feature rows, callouts) carry data-tb-bind="acf:<field_name>" with a short snake_case field name.',
    ],
    // Stage 2 target file(s). slug is the page slug; cptSlug unused here.
    stage2Files: ({ slug }) => [`page-${slug}.php`],
    requiresCptRegistration: false,
  },

  single: {
    id: 'single',
    label: 'Blog post (single)',
    description: 'The single blog post reading view. Wraps the core post loop and binds to core post data.',
    wrapper: 'post-loop',
    fieldSource: 'post',
    emitsArchive: true,
    inheritsFrom: ['home', 'page'],
    bindingGuidance: [
      'The article title carries data-tb-bind="post_title".',
      'The featured image carries data-tb-bind="post_thumbnail".',
      'The publish date carries data-tb-bind="post_date" and author data-tb-bind="post_author".',
      'The article body carries data-tb-bind="post_content".',
      'Design a FRAME around the content — do not bake a fake full article that would replace real post content.',
    ],
    stage2Files: () => ['single.php', 'home.php'],
    requiresCptRegistration: false,
  },

  cpt: {
    id: 'cpt',
    label: 'Custom post type',
    description: 'A custom post type single view plus its archive listing. Binds to the CPT\'s ACF fields.',
    wrapper: 'post-loop',
    fieldSource: 'cpt-acf',
    emitsArchive: true,
    inheritsFrom: ['home', 'page'],
    bindingGuidance: [
      'The item title carries data-tb-bind="post_title" and featured image data-tb-bind="post_thumbnail".',
      'Each custom detail carries data-tb-bind="acf:<field_name>" using the CPT field names.',
      'The archive grid item is marked with data-tb-loop="cpt:<slug>" on the repeating card.',
      'Design a FRAME around dynamic content — placeholders only stand in for real CPT data.',
    ],
    stage2Files: ({ cptSlug }) => [`single-${cptSlug}.php`, `archive-${cptSlug}.php`],
    requiresCptRegistration: true,
  },
};

function getTemplateType(id) {
  return TEMPLATE_TYPES[id] || null;
}

function isValidTemplateType(id) {
  return Boolean(TEMPLATE_TYPES[id]);
}

function listTemplateTypes() {
  return Object.values(TEMPLATE_TYPES).map(({ id, label, description }) => ({ id, label, description }));
}

module.exports = {
  TEMPLATE_TYPES,
  getTemplateType,
  isValidTemplateType,
  listTemplateTypes,
};
