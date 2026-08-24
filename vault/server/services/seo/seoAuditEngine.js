'use strict';

function attr(html, tagRe) {
  const m = String(html || '').match(tagRe);
  return m ? String(m[1] || '').trim() : '';
}

function countTags(html, re) {
  const m = String(html || '').match(re);
  return m ? m.length : 0;
}

function imagesMissingAlt(html) {
  const imgs = String(html || '').match(/<img\b[^>]*>/gi) || [];
  let missing = 0;
  for (const tag of imgs) {
    const alt = tag.match(/\balt\s*=\s*(["'])([\s\S]*?)\1/i);
    if (!alt || !String(alt[2] || '').trim()) missing += 1;
  }
  return { total: imgs.length, missing };
}

function headingCount(headings, level) {
  return (headings || []).filter((h) => Number(h.level) === level).length;
}

function addFinding(list, { id, severity, title, detail }) {
  list.push({ id, severity, title, detail });
}

function scoreFromFindings(findings) {
  let score = 100;
  for (const f of findings) {
    if (f.severity === 'fail') score -= 12;
    else if (f.severity === 'warn') score -= 5;
  }
  return Math.max(0, Math.min(100, score));
}

function buildSeoAudit({ snapshot, html, robots }) {
  const findings = [];
  const title = String(snapshot?.title || '').trim();
  const description = String(snapshot?.description || '').trim();
  const headings = snapshot?.headings || [];
  const pages = snapshot?.pages || [];
  const finalUrl = snapshot?.finalUrl || snapshot?.url || '';
  const charCount = Number(snapshot?.charCount || snapshot?.text?.length || 0);
  const h1s = headingCount(headings, 1);
  const viewport = attr(html, /<meta[^>]+name=["']viewport["'][^>]*content=["']([^"']*)["']/i)
    || attr(html, /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']viewport["']/i);
  const canonical = attr(html, /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
    || attr(html, /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  const robotsMeta = (
    attr(html, /<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["']/i)
    || attr(html, /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']robots["']/i)
  ).toLowerCase();
  const htmlLang = attr(html, /<html[^>]*\blang=["']([^"']+)["']/i);
  const ogTitle = attr(html, /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i)
    || attr(html, /<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:title["']/i);
  const hasJsonLd = /application\/ld\+json/i.test(html || '') || Boolean(snapshot?.jsonLd);
  const img = imagesMissingAlt(html);
  const https = /^https:/i.test(finalUrl);

  if (snapshot?.statusCode && snapshot.statusCode >= 400) {
    addFinding(findings, {
      id: 'status',
      severity: 'fail',
      title: `Homepage returned HTTP ${snapshot.statusCode}`,
      detail: 'Search engines may not index a page that errors on fetch.',
    });
  } else {
    addFinding(findings, {
      id: 'status',
      severity: 'pass',
      title: `Homepage fetched${snapshot?.statusCode ? ` (HTTP ${snapshot.statusCode})` : ''}`,
      detail: `${pages.length} page${pages.length === 1 ? '' : 's'} read from this host.`,
    });
  }

  if (!https) {
    addFinding(findings, {
      id: 'https',
      severity: 'fail',
      title: 'Site is not on HTTPS',
      detail: 'Google treats HTTPS as a ranking signal and browsers warn on HTTP.',
    });
  } else {
    addFinding(findings, {
      id: 'https',
      severity: 'pass',
      title: 'HTTPS is in use',
      detail: finalUrl,
    });
  }

  if (!title) {
    addFinding(findings, {
      id: 'title',
      severity: 'fail',
      title: 'Missing title tag',
      detail: 'Every indexable page needs a unique, descriptive title.',
    });
  } else if (title.length < 12 || title.length > 65) {
    addFinding(findings, {
      id: 'title',
      severity: 'warn',
      title: `Title is ${title.length} characters (aim 15–60)`,
      detail: title,
    });
  } else {
    addFinding(findings, {
      id: 'title',
      severity: 'pass',
      title: 'Title looks usable',
      detail: title,
    });
  }

  if (!description) {
    addFinding(findings, {
      id: 'description',
      severity: 'warn',
      title: 'No meta description',
      detail: 'Google can invent a snippet. A 70–160 character description is clearer.',
    });
  } else if (description.length < 50 || description.length > 170) {
    addFinding(findings, {
      id: 'description',
      severity: 'warn',
      title: `Meta description is ${description.length} characters (aim 70–160)`,
      detail: description,
    });
  } else {
    addFinding(findings, {
      id: 'description',
      severity: 'pass',
      title: 'Meta description present',
      detail: description,
    });
  }

  if (h1s === 0) {
    addFinding(findings, {
      id: 'h1',
      severity: 'fail',
      title: 'No H1 heading',
      detail: 'The homepage should have one clear H1 that names the offer.',
    });
  } else if (h1s > 1) {
    addFinding(findings, {
      id: 'h1',
      severity: 'warn',
      title: `${h1s} H1 headings on the homepage`,
      detail: 'Prefer a single H1; extra H1s dilute what the page is about.',
    });
  } else {
    const h1 = headings.find((h) => Number(h.level) === 1);
    addFinding(findings, {
      id: 'h1',
      severity: 'pass',
      title: 'Single H1 found',
      detail: h1?.text || '',
    });
  }

  if (!viewport) {
    addFinding(findings, {
      id: 'viewport',
      severity: 'fail',
      title: 'No viewport meta tag',
      detail: 'Mobile Google uses a smartphone crawler. Add width=device-width.',
    });
  } else {
    addFinding(findings, {
      id: 'viewport',
      severity: 'pass',
      title: 'Viewport meta tag present',
      detail: viewport,
    });
  }

  if (!htmlLang) {
    addFinding(findings, {
      id: 'lang',
      severity: 'warn',
      title: 'html lang attribute missing',
      detail: 'Set lang (e.g. en-AU) so browsers and assistive tech know the language.',
    });
  } else {
    addFinding(findings, {
      id: 'lang',
      severity: 'pass',
      title: `Language set to ${htmlLang}`,
      detail: '',
    });
  }

  if (!canonical) {
    addFinding(findings, {
      id: 'canonical',
      severity: 'warn',
      title: 'No canonical URL',
      detail: 'A canonical link helps Google pick the preferred homepage URL (www vs non-www).',
    });
  } else {
    addFinding(findings, {
      id: 'canonical',
      severity: 'pass',
      title: 'Canonical URL present',
      detail: canonical,
    });
  }

  if (robotsMeta.includes('noindex')) {
    addFinding(findings, {
      id: 'robots-meta',
      severity: 'fail',
      title: 'Homepage is set to noindex',
      detail: robotsMeta,
    });
  } else {
    addFinding(findings, {
      id: 'robots-meta',
      severity: 'pass',
      title: robotsMeta ? `Robots meta: ${robotsMeta}` : 'No noindex on the homepage',
      detail: '',
    });
  }

  const robotsBody = String(robots?.body || '');
  const robotsOk = robots?.ok && /user-agent/i.test(robotsBody);
  if (!robotsOk) {
    addFinding(findings, {
      id: 'robots-txt',
      severity: 'warn',
      title: robots?.statusCode >= 400 ? `robots.txt returned HTTP ${robots.statusCode}` : 'robots.txt not found or empty',
      detail: 'A robots.txt is optional but useful. Missing is not a fail by itself.',
    });
  } else if (/disallow:\s*\/\s*$/im.test(robotsBody) && /user-agent:\s*\*/i.test(robotsBody)) {
    addFinding(findings, {
      id: 'robots-txt',
      severity: 'fail',
      title: 'robots.txt appears to block all crawlers',
      detail: 'A Disallow: / under User-agent: * will keep Google out.',
    });
  } else {
    addFinding(findings, {
      id: 'robots-txt',
      severity: 'pass',
      title: 'robots.txt is reachable',
      detail: robotsBody.split('\n').slice(0, 8).join('\n').slice(0, 400),
    });
  }

  if (!ogTitle) {
    addFinding(findings, {
      id: 'og',
      severity: 'warn',
      title: 'No Open Graph title',
      detail: 'og:title improves link previews. Not a ranking factor, but worth adding.',
    });
  } else {
    addFinding(findings, {
      id: 'og',
      severity: 'pass',
      title: 'Open Graph title present',
      detail: ogTitle,
    });
  }

  if (!hasJsonLd) {
    addFinding(findings, {
      id: 'jsonld',
      severity: 'warn',
      title: 'No JSON-LD structured data on the homepage',
      detail: 'LocalBusiness / Organization schema helps rich results. Optional for a first pass.',
    });
  } else {
    addFinding(findings, {
      id: 'jsonld',
      severity: 'pass',
      title: 'JSON-LD found',
      detail: String(snapshot.jsonLd || 'JSON-LD script present').slice(0, 240),
    });
  }

  if (img.total > 0 && img.missing > 0) {
    addFinding(findings, {
      id: 'alt',
      severity: img.missing / img.total > 0.5 ? 'fail' : 'warn',
      title: `${img.missing} of ${img.total} images missing alt text`,
      detail: 'Alt text helps image search and accessibility.',
    });
  } else if (img.total > 0) {
    addFinding(findings, {
      id: 'alt',
      severity: 'pass',
      title: `All ${img.total} homepage images have alt text`,
      detail: '',
    });
  }

  if (charCount < 400) {
    addFinding(findings, {
      id: 'thin',
      severity: 'fail',
      title: 'Very little readable text on the scrape',
      detail: `${charCount} characters across ${pages.length} page(s). JS-rendered sites often look empty to this HTML-only audit.`,
    });
  } else if (charCount < 1200) {
    addFinding(findings, {
      id: 'thin',
      severity: 'warn',
      title: 'Thin on-page copy',
      detail: `${charCount} characters scraped. Add unique service/copy on the homepage if this is a real site, not a JS app.`,
    });
  } else {
    addFinding(findings, {
      id: 'thin',
      severity: 'pass',
      title: 'Enough text to work with',
      detail: `${charCount} characters across ${pages.length} page(s).`,
    });
  }

  const titles = pages.map((p) => String(p.title || '').trim()).filter(Boolean);
  const dup = titles.length >= 2 && new Set(titles.map((t) => t.toLowerCase())).size < titles.length;
  if (dup) {
    addFinding(findings, {
      id: 'dup-title',
      severity: 'warn',
      title: 'Duplicate titles across scraped pages',
      detail: titles.join(' · '),
    });
  }

  const scriptCount = countTags(html, /<script\b/gi);
  if (scriptCount > 25 && charCount < 800) {
    addFinding(findings, {
      id: 'js-heavy',
      severity: 'warn',
      title: 'Page looks script-heavy with little HTML text',
      detail: `${scriptCount} script tags. A headless crawl would see more; this pass only reads HTML.`,
    });
  }

  const fails = findings.filter((f) => f.severity === 'fail').length;
  const warns = findings.filter((f) => f.severity === 'warn').length;
  const passes = findings.filter((f) => f.severity === 'pass').length;

  return {
    score: scoreFromFindings(findings),
    summary: `${fails} fail · ${warns} warn · ${passes} pass`,
    findings,
    pages: pages.map((p) => ({ url: p.url, title: p.title || '' })),
  };
}

module.exports = { buildSeoAudit };
