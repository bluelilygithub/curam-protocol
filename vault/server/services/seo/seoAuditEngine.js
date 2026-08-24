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

function extractHeadings(html) {
  const out = [];
  const re = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(html || '')) && out.length < 40) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) out.push({ level: Number(m[1]), text: text.slice(0, 160) });
  }
  return out;
}

function addFinding(list, item) {
  list.push({
    id: item.id,
    severity: item.severity,
    title: item.title,
    detail: item.detail || '',
    recommendation: item.recommendation || '',
  });
}

function scoreFromFindings(findings) {
  let score = 100;
  for (const f of findings) {
    if (f.severity === 'fail') score -= 12;
    else if (f.severity === 'warn') score -= 5;
  }
  return Math.max(0, Math.min(100, score));
}

function recommendationsFrom(findings) {
  return (findings || [])
    .filter((f) => f.severity !== 'pass' && f.recommendation)
    .map((f) => ({
      id: f.id,
      severity: f.severity,
      action: f.recommendation,
      why: f.detail || f.title,
    }));
}

function auditPage({ url, html, statusCode, title: fetchedTitle, text, error, isHome }) {
  const findings = [];
  const htmlStr = String(html || '');
  const title = String(fetchedTitle || attr(htmlStr, /<title[^>]*>([^<]{1,200})<\/title>/i)).trim();
  const description = attr(htmlStr, /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)
    || attr(htmlStr, /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i);
  const headings = extractHeadings(htmlStr);
  const h1s = headings.filter((h) => h.level === 1).length;
  const viewport = attr(htmlStr, /<meta[^>]+name=["']viewport["'][^>]*content=["']([^"']*)["']/i)
    || attr(htmlStr, /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']viewport["']/i);
  const canonical = attr(htmlStr, /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
    || attr(htmlStr, /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  const robotsMeta = (
    attr(htmlStr, /<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["']/i)
    || attr(htmlStr, /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']robots["']/i)
  ).toLowerCase();
  const htmlLang = attr(htmlStr, /<html[^>]*\blang=["']([^"']+)["']/i);
  const ogTitle = attr(htmlStr, /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i)
    || attr(htmlStr, /<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:title["']/i);
  const hasJsonLd = /application\/ld\+json/i.test(htmlStr);
  const img = imagesMissingAlt(htmlStr);
  const https = /^https:/i.test(url || '');
  const charCount = String(text || '').replace(/\s+/g, ' ').trim().length;
  const where = isHome ? 'this page (homepage)' : 'this page';
  const noHtml = !error && statusCode < 400 && !title && charCount < 40;

  if (error) {
    addFinding(findings, {
      id: 'fetch',
      severity: 'fail',
      title: 'Could not fetch this URL',
      detail: error,
      recommendation: `Check the URL is public and not blocked. Retry after fixing hosting or robots rules. (${url})`,
    });
  } else if (statusCode >= 400) {
    addFinding(findings, {
      id: 'status',
      severity: 'fail',
      title: `HTTP ${statusCode}`,
      detail: `${url} returned ${statusCode}.`,
      recommendation: 'Fix or redirect this URL so crawlers get 200 (or a 301 to the live page).',
    });
  } else if (noHtml || statusCode === 202 || statusCode === 204) {
    addFinding(findings, {
      id: 'fetch',
      severity: 'fail',
      title: statusCode === 202
        ? 'Host returned HTTP 202 with no usable HTML'
        : 'No HTML in the response',
      detail: 'The live site may show a full page in a browser while this crawl gets an empty or challenge response. Without HTML there are no links to follow.',
      recommendation: 'Allow unknown crawlers (or Railway IPs) on the host/WAF, then run the audit again. Do not treat missing titles on this result as the real page.',
    });
  } else {
    addFinding(findings, {
      id: 'status',
      severity: 'pass',
      title: `Fetched (HTTP ${statusCode || 200})`,
      detail: url,
    });
  }

  if (error || (statusCode >= 400) || noHtml || statusCode === 202 || statusCode === 204) {
    const score = scoreFromFindings(findings);
    return {
      url,
      title,
      statusCode: statusCode || 0,
      error: error || null,
      isHome: Boolean(isHome),
      score,
      charCount,
      findings,
      recommendations: recommendationsFrom(findings),
    };
  }

  if (!https) {
    addFinding(findings, {
      id: 'https',
      severity: 'fail',
      title: 'Not on HTTPS',
      detail: url,
      recommendation: 'Serve this URL over HTTPS and redirect HTTP to HTTPS.',
    });
  }

  if (!title) {
    addFinding(findings, {
      id: 'title',
      severity: 'fail',
      title: 'Missing title tag',
      detail: where,
      recommendation: `Add a unique <title> of about 15–60 characters that names the page topic.`,
    });
  } else if (title.length < 12 || title.length > 65) {
    addFinding(findings, {
      id: 'title',
      severity: 'warn',
      title: `Title is ${title.length} characters (aim 15–60)`,
      detail: title,
      recommendation: `Rewrite the title so it is specific and roughly 15–60 characters. Current: “${title}”.`,
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
      detail: where,
      recommendation: 'Add a meta description of about 70–160 characters summarising this page.',
    });
  } else if (description.length < 50 || description.length > 170) {
    addFinding(findings, {
      id: 'description',
      severity: 'warn',
      title: `Meta description is ${description.length} characters (aim 70–160)`,
      detail: description,
      recommendation: 'Tighten or expand the meta description to about 70–160 characters.',
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
      detail: where,
      recommendation: 'Add one H1 that matches the page topic (usually similar to the title, not identical fluff).',
    });
  } else if (h1s > 1) {
    addFinding(findings, {
      id: 'h1',
      severity: 'warn',
      title: `${h1s} H1 headings`,
      detail: headings.filter((h) => h.level === 1).map((h) => h.text).join(' · '),
      recommendation: 'Keep a single H1; demote extras to H2.',
    });
  } else {
    addFinding(findings, {
      id: 'h1',
      severity: 'pass',
      title: 'Single H1 found',
      detail: headings.find((h) => h.level === 1)?.text || '',
    });
  }

  if (!viewport) {
    addFinding(findings, {
      id: 'viewport',
      severity: 'fail',
      title: 'No viewport meta tag',
      detail: where,
      recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
    });
  }

  if (!htmlLang) {
    addFinding(findings, {
      id: 'lang',
      severity: 'warn',
      title: 'html lang missing',
      detail: where,
      recommendation: 'Set lang on <html> (e.g. en-AU).',
    });
  }

  if (!canonical) {
    addFinding(findings, {
      id: 'canonical',
      severity: 'warn',
      title: 'No canonical URL',
      detail: where,
      recommendation: `Add <link rel="canonical" href="${url}"> (or the preferred version of this URL).`,
    });
  }

  if (robotsMeta.includes('noindex')) {
    addFinding(findings, {
      id: 'robots-meta',
      severity: isHome ? 'fail' : 'warn',
      title: 'noindex is set',
      detail: robotsMeta,
      recommendation: isHome
        ? 'Remove noindex from the homepage unless you intend to hide the whole site.'
        : 'Keep noindex only if this page should stay out of Google (thank-you, cart, login).',
    });
  }

  if (!ogTitle) {
    addFinding(findings, {
      id: 'og',
      severity: 'warn',
      title: 'No Open Graph title',
      detail: where,
      recommendation: 'Add og:title (and og:description / og:image) for link previews.',
    });
  }

  if (!hasJsonLd && isHome) {
    addFinding(findings, {
      id: 'jsonld',
      severity: 'warn',
      title: 'No JSON-LD on the homepage',
      detail: '',
      recommendation: 'Add Organization or LocalBusiness JSON-LD on the homepage.',
    });
  }

  if (img.total > 0 && img.missing > 0) {
    addFinding(findings, {
      id: 'alt',
      severity: img.missing / img.total > 0.5 ? 'fail' : 'warn',
      title: `${img.missing} of ${img.total} images missing alt text`,
      detail: where,
      recommendation: 'Write descriptive alt text for informative images; use empty alt="" only for decorative ones.',
    });
  }

  if (!error && statusCode < 400 && charCount < 250) {
    addFinding(findings, {
      id: 'thin',
      severity: 'fail',
      title: 'Very little readable text',
      detail: `${charCount} characters. JS-rendered pages often look empty to this HTML crawl.`,
      recommendation: 'Put the main copy in HTML (or server-render it) so crawlers can read the topic.',
    });
  } else if (!error && charCount < 800) {
    addFinding(findings, {
      id: 'thin',
      severity: 'warn',
      title: 'Thin on-page copy',
      detail: `${charCount} characters.`,
      recommendation: 'Add unique copy that explains this page’s offer, not a near-duplicate of other URLs.',
    });
  }

  const scriptCount = countTags(htmlStr, /<script\b/gi);
  if (scriptCount > 25 && charCount < 800) {
    addFinding(findings, {
      id: 'js-heavy',
      severity: 'warn',
      title: 'Script-heavy with little HTML text',
      detail: `${scriptCount} script tags.`,
      recommendation: 'Ensure important headings and copy exist in the initial HTML, not only after JS.',
    });
  }

  const score = scoreFromFindings(findings);
  return {
    url,
    title,
    statusCode: statusCode || 0,
    error: error || null,
    isHome: Boolean(isHome),
    score,
    charCount,
    findings,
    recommendations: recommendationsFrom(findings),
  };
}

function buildSiteAudit({ crawl }) {
  const startUrl = crawl.startUrl;
  let origin = '';
  try { origin = new URL(startUrl).origin; } catch { origin = ''; }
  const pageReports = (crawl.pages || []).map((p, i) => auditPage({
    url: p.url || p.requestedUrl,
    html: p.html,
    statusCode: p.statusCode,
    title: p.title,
    text: p.text,
    error: p.error,
    isHome: i === 0 || p.url === startUrl,
  }));

  const siteFindings = [];
  const robots = crawl.robots || {};
  const robotsBody = String(robots.body || '');
  const hostBlocked = pageReports.some((p) => p.statusCode === 202 || p.statusCode === 204)
    || pageReports[0]?.findings?.some((f) => f.id === 'fetch' && f.severity === 'fail');
  if (hostBlocked && (!robots.ok || robots.statusCode === 202)) {
    addFinding(siteFindings, {
      id: 'robots-txt',
      severity: 'warn',
      title: 'Could not check robots.txt (host blocked this crawler)',
      detail: 'The same empty or HTTP 202 response that stopped the HTML crawl also blocked robots.txt. This is not proof the file is missing.',
    });
  } else if (!robots.ok) {
    addFinding(siteFindings, {
      id: 'robots-txt',
      severity: 'warn',
      title: robots.statusCode >= 400 ? `robots.txt returned HTTP ${robots.statusCode}` : 'robots.txt not found or empty',
      detail: 'Optional, but useful for crawlers.',
      recommendation: `Publish ${origin}/robots.txt with User-agent: * and allow public pages.`,
    });
  } else if (/disallow:\s*\/\s*$/im.test(robotsBody) && /user-agent:\s*\*/i.test(robotsBody)) {
    addFinding(siteFindings, {
      id: 'robots-txt',
      severity: 'fail',
      title: 'robots.txt appears to block all crawlers',
      detail: 'Disallow: / under User-agent: * keeps Google out.',
      recommendation: 'Remove the site-wide Disallow: / unless the site is meant to be private.',
    });
  } else {
    addFinding(siteFindings, {
      id: 'robots-txt',
      severity: 'pass',
      title: 'robots.txt is reachable',
      detail: robotsBody.split('\n').slice(0, 8).join('\n').slice(0, 400),
    });
  }

  const titles = pageReports.map((p) => String(p.title || '').trim().toLowerCase()).filter(Boolean);
  const titleCounts = new Map();
  titles.forEach((t) => titleCounts.set(t, (titleCounts.get(t) || 0) + 1));
  const dupTitles = [...titleCounts.entries()].filter(([, n]) => n > 1).map(([t, n]) => `"${t}" ×${n}`);
  if (dupTitles.length) {
    addFinding(siteFindings, {
      id: 'dup-title',
      severity: 'warn',
      title: 'Duplicate titles across crawled pages',
      detail: dupTitles.join(' · '),
      recommendation: 'Give each URL a unique title that matches that page’s topic.',
    });
  }

  if (crawl.discovered > crawl.crawled) {
    addFinding(siteFindings, {
      id: 'crawl-cap',
      severity: 'warn',
      title: `Found ${crawl.discovered} URLs; crawled ${crawl.crawled} (limit ${crawl.pageLimit})`,
      detail: 'Raise Pages to crawl to cover more of the site.',
      recommendation: `Run again with a higher page limit if important URLs were skipped.`,
    });
  } else {
    addFinding(siteFindings, {
      id: 'crawl-cap',
      severity: 'pass',
      title: `Crawled ${crawl.crawled} page${crawl.crawled === 1 ? '' : 's'}`,
      detail: `Discovered ${crawl.discovered} same-origin URLs (HTML links only).`,
    });
  }

  const pageScores = pageReports.map((p) => p.score);
  const avg = pageScores.length
    ? Math.round(pageScores.reduce((a, b) => a + b, 0) / pageScores.length)
    : 0;
  const siteScore = scoreFromFindings(siteFindings);
  const score = Math.round((avg * 0.75) + (siteScore * 0.25));

  const fails = [...siteFindings, ...pageReports.flatMap((p) => p.findings)].filter((f) => f.severity === 'fail').length;
  const warns = [...siteFindings, ...pageReports.flatMap((p) => p.findings)].filter((f) => f.severity === 'warn').length;

  const siteRecommendations = recommendationsFrom(siteFindings);
  const pageRecommendations = pageReports.flatMap((p) => p.recommendations.map((r) => ({ ...r, url: p.url, pageTitle: p.title })));

  return {
    score,
    summary: `${crawl.crawled} pages · ${fails} fail · ${warns} warn`,
    pageLimit: crawl.pageLimit,
    crawled: crawl.crawled,
    discovered: crawl.discovered,
    findings: siteFindings,
    recommendations: siteRecommendations,
    pages: pageReports.map((p) => ({
      url: p.url,
      title: p.title,
      statusCode: p.statusCode,
      score: p.score,
      isHome: p.isHome,
      findings: p.findings,
      recommendations: p.recommendations,
    })),
    allRecommendations: [...siteRecommendations.map((r) => ({ ...r, url: startUrl, pageTitle: 'Site' })), ...pageRecommendations],
  };
}

module.exports = { auditPage, buildSiteAudit };
