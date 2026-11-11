'use strict';

/**
 * JSON-LD extraction and validation for the AI Visibility audit.
 *
 * This is deliberately stricter than the SEO audit's "is there a name key anywhere"
 * check: an LLM reading a page benefits from a complete entity (a LocalBusiness with
 * an address, a Product with an offer), and a half-filled block is worse than none
 * because it teaches the model the wrong thing. Each entity is checked on its own.
 */

const REQUIRED = {
  organization: {
    label: 'Organization',
    required: ['name', 'url'],
    recommended: ['logo', 'sameAs', 'description', 'contactPoint'],
  },
  localbusiness: {
    label: 'LocalBusiness',
    required: ['name', 'address'],
    recommended: ['telephone', 'url', 'image', 'openingHoursSpecification', 'priceRange', 'geo', 'areaServed'],
  },
  product: {
    label: 'Product',
    required: ['name'],
    recommended: ['image', 'description', 'brand', 'sku'],
  },
  offer: {
    label: 'Offer',
    required: ['price', 'priceCurrency'],
    recommended: ['availability', 'url', 'priceValidUntil'],
  },
  faqpage: {
    label: 'FAQPage',
    required: ['mainEntity'],
    recommended: [],
  },
  article: {
    label: 'Article',
    required: ['headline', 'author', 'datePublished'],
    recommended: ['image', 'publisher', 'dateModified'],
  },
  breadcrumblist: {
    label: 'BreadcrumbList',
    required: ['itemListElement'],
    recommended: [],
  },
  website: {
    label: 'WebSite',
    required: ['name', 'url'],
    recommended: ['potentialAction'],
  },
  service: {
    label: 'Service',
    required: ['name'],
    recommended: ['provider', 'areaServed', 'description', 'offers'],
  },
};

const LOCAL_BUSINESS_SUBTYPES = new Set([
  'localbusiness', 'store', 'restaurant', 'foodestablishment', 'cafeorcoffeeshop',
  'barorclub', 'bakery', 'winery', 'liquorstore', 'homeandconstructionbusiness',
  'professionalservice', 'healthandbeautybusiness', 'autodealer', 'furniturestore',
  'hardwarestore', 'hobbyshop', 'wholesalestore', 'medicalbusiness', 'legalservice',
  'financialservice', 'realestateservice', 'travelagency', 'lodgingbusiness',
]);

const SCRIPT_RE = /<script\b[^>]*type\s*=\s*["']application\/ld\+json(?:\s*;[^"']*)?["'][^>]*>([\s\S]*?)<\/script>/gi;

function typeList(node) {
  const raw = node && node['@type'];
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw])
    .map((t) => String(t || '').trim())
    .filter(Boolean);
}

function typeKey(type) {
  return String(type || '').trim().toLowerCase();
}

function ruleForType(type) {
  const key = typeKey(type);
  if (!key) return null;
  if (key === 'organization' || key.endsWith('organization')) return REQUIRED.organization;
  if (LOCAL_BUSINESS_SUBTYPES.has(key) || key.endsWith('business') || key.endsWith('store')) return REQUIRED.localbusiness;
  if (key === 'product' || key.endsWith('product')) return REQUIRED.product;
  if (key === 'offer') return REQUIRED.offer;
  if (key === 'faqpage') return REQUIRED.faqpage;
  if (key === 'article' || key === 'newsarticle' || key === 'blogposting' || key.endsWith('article')) return REQUIRED.article;
  if (key === 'breadcrumblist') return REQUIRED.breadcrumblist;
  if (key === 'website' || key === 'webpage') return REQUIRED.website;
  if (key === 'service') return REQUIRED.service;
  return null;
}

function hasValue(node, key) {
  if (!node || typeof node !== 'object') return false;
  const v = node[key];
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

/** Some entities keep the useful values one level down (offers.price, location.address). */
function hasDeep(node, key, depth = 0) {
  if (hasValue(node, key)) return true;
  if (!node || typeof node !== 'object' || depth >= 2) return false;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      if (value.some((v) => v && typeof v === 'object' && hasDeep(v, key, depth + 1))) return true;
    } else if (value && typeof value === 'object' && hasDeep(value, key, depth + 1)) {
      return true;
    }
  }
  return false;
}

function collectNodes(value, out, seen) {
  if (Array.isArray(value)) {
    for (const v of value) collectNodes(v, out, seen);
    return;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (typeList(value).length) out.push(value);
  for (const [key, child] of Object.entries(value)) {
    if (key === '@context') continue;
    if (child && typeof child === 'object') collectNodes(child, out, seen);
  }
}

/**
 * Pull every application/ld+json block out of the HTML and flatten @graph and nested
 * entities into one node list. Returns { blocks, nodes, errors }.
 */
function extractJsonLd(html) {
  const blocks = [];
  const errors = [];
  const text = String(html || '');
  let match;
  SCRIPT_RE.lastIndex = 0;
  while ((match = SCRIPT_RE.exec(text))) {
    const raw = String(match[1] || '').trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch (err) {
      errors.push(`A JSON-LD block could not be parsed: ${err.message}`);
    }
  }

  const nodes = [];
  const seen = new Set();
  for (const block of blocks) collectNodes(block, nodes, seen);
  return { blocks, nodes, errors };
}

function checkEntity(node) {
  const types = typeList(node);
  const rules = [];
  for (const type of types) {
    const rule = ruleForType(type);
    if (rule) rules.push({ type, rule });
  }
  if (!rules.length) {
    return {
      type: types[0] || 'Unknown',
      types,
      label: types[0] || 'Unknown',
      required: [],
      missingRequired: [],
      missingRecommended: [],
      ok: true,
      checked: false,
    };
  }

  const primary = rules[0];
  const required = primary.rule.required;
  const recommended = primary.rule.recommended;
  const missingRequired = required.filter((key) => !hasValue(node, key));
  const missingRecommended = recommended.filter((key) => !hasDeep(node, key));

  // A Product without an offer cannot quote a price; a Product with neither an offer
  // nor a review has nothing an answer engine can cite.
  if (primary.rule === REQUIRED.product && !hasValue(node, 'offers') && !hasValue(node, 'review') && !hasValue(node, 'aggregateRating')) {
    missingRequired.push('offers (or review/aggregateRating)');
  }

  return {
    type: primary.type,
    types,
    label: primary.rule.label,
    required,
    missingRequired,
    missingRecommended,
    ok: missingRequired.length === 0,
    checked: true,
  };
}

function schemaScore(entities, errors, blockCount) {
  if (!blockCount) return 0;
  let score = 100;
  score -= Math.min(30, errors.length * 15);
  for (const entity of entities) {
    if (!entity.checked) continue;
    score -= Math.min(60, entity.missingRequired.length * 25);
    score -= Math.min(20, entity.missingRecommended.length * 4);
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildFindings({ blocks, entities, errors, types }) {
  const findings = [];

  if (!blocks.length) {
    findings.push({
      severity: 'fail',
      title: 'No JSON-LD structured data found',
      detail: 'The page has no application/ld+json block, so an AI answer has no machine-readable entity to cite.',
      recommendation: 'Add JSON-LD for the page type (Organization or LocalBusiness on the homepage, Product on product pages, FAQPage where questions are answered).',
    });
    return findings;
  }

  for (const message of errors) {
    findings.push({
      severity: 'warn',
      title: 'A JSON-LD block is invalid',
      detail: message,
      recommendation: 'Fix the JSON so the block parses. A broken block is ignored by every crawler.',
    });
  }

  const labels = new Set(entities.map((e) => e.label));
  if (!labels.has('Organization') && !labels.has('LocalBusiness')) {
    findings.push({
      severity: 'warn',
      title: 'No Organization or LocalBusiness entity',
      detail: `Found: ${types.join(', ') || 'none'}.`,
      recommendation: 'Add one Organization or LocalBusiness block with name, url and address (plus logo and sameAs) so the business is unambiguous.',
    });
  }

  for (const entity of entities) {
    if (!entity.checked) continue;
    if (entity.missingRequired.length) {
      findings.push({
        severity: 'fail',
        title: `${entity.label} is missing required properties`,
        detail: `Missing: ${entity.missingRequired.join(', ')}.`,
        recommendation: `Add ${entity.missingRequired.join(', ')} to the ${entity.label} JSON-LD.`,
      });
    }
    if (entity.missingRecommended.length) {
      findings.push({
        severity: 'warn',
        title: `${entity.label} is missing useful properties`,
        detail: `Missing: ${entity.missingRecommended.join(', ')}.`,
        recommendation: `Add ${entity.missingRecommended.slice(0, 4).join(', ')} to the ${entity.label} JSON-LD — these are what answer engines quote.`,
      });
    }
  }

  if (!labels.has('FAQPage') && blocks.length) {
    findings.push({
      severity: 'info',
      title: 'No FAQPage markup',
      detail: 'FAQ markup is optional, but it is one of the easiest ways to have a question answered and cited.',
      recommendation: 'Add an FAQPage block for the questions buyers actually ask, with a short direct answer in acceptedAnswer.text.',
    });
  }

  if (!findings.length) {
    findings.push({
      severity: 'pass',
      title: 'Structured data is complete',
      detail: `Checked ${entities.length} entity block(s): ${types.join(', ')}.`,
      recommendation: 'Keep the entity values in step with the page copy and the business details.',
    });
  }

  return findings;
}

function validateSchema(html) {
  const { blocks, nodes, errors } = extractJsonLd(html);
  const entities = nodes.map(checkEntity);
  const types = [...new Set(nodes.flatMap((n) => typeList(n)))];
  const findings = buildFindings({ blocks, entities, errors, types });
  return {
    blockCount: blocks.length,
    blocks,
    types,
    entities,
    errors,
    findings,
    score: schemaScore(entities, errors, blocks.length),
  };
}

module.exports = {
  REQUIRED,
  extractJsonLd,
  validateSchema,
  checkEntity,
  schemaScore,
};
