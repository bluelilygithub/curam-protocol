'use strict';

const https = require('https');
const { checkSsrf, normaliseHttpUrl } = require('./htmlFetch');

const METRIC_IDS = [
  'first-contentful-paint',
  'largest-contentful-paint',
  'total-blocking-time',
  'cumulative-layout-shift',
  'speed-index',
  'interactive',
];

function readPsiKey() {
  const raw = String(process.env.PAGESPEED_API_KEY || process.env.GOOGLE_PAGESPEED_API_KEY || '').trim();
  return raw.replace(/^['"]|['"]$/g, '').trim();
}

function googleErrorReason(data) {
  const details = data?.error?.details;
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d && d.reason) return String(d.reason);
    }
  }
  return String(data?.error?.status || data?.error?.errors?.[0]?.reason || '');
}

function getJson(url, { timeoutMs, headers, redirectsLeft = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: `${u.pathname}${u.search}`,
      method: 'GET',
      timeout: timeoutMs,
      headers: { Accept: 'application/json', ...headers },
    };
    const req = https.get(opts, (res) => {
      const loc = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc && redirectsLeft > 0) {
        res.resume();
        const next = loc.startsWith('http') ? loc : `${u.protocol}//${u.host}${loc}`;
        getJson(next, { timeoutMs, headers, redirectsLeft: redirectsLeft - 1 }).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data;
        try { data = JSON.parse(text); } catch {
          reject(new Error(`PageSpeed returned invalid JSON (HTTP ${res.statusCode})`));
          return;
        }
        resolve({ statusCode: res.statusCode, data });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('PageSpeed request timed out')); });
  });
}

function catScore(lr, id) {
  const s = lr?.categories?.[id]?.score;
  if (s == null) return null;
  return Math.round(Number(s) * 100);
}

function stripMd(s) {
  return String(s || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
}

function firstDocLink(s) {
  const m = String(s || '').match(/\((https?:\/\/[^)\s]+)\)/);
  return m ? m[1] : '';
}

function categoryForAudit(lr, auditId) {
  const cats = lr?.categories || {};
  for (const [cid, cat] of Object.entries(cats)) {
    if ((cat.auditRefs || []).some((r) => r.id === auditId)) return cid;
  }
  return '';
}

function itemRow(item) {
  const node = item.node || {};
  const src = item.source && typeof item.source === 'object' ? item.source : {};
  const url = item.url || src.url || item.source || '';
  return {
    url: typeof url === 'string' ? url.slice(0, 400) : '',
    label: String(item.label || item.entity || item.name || node.selector || '').slice(0, 220),
    snippet: String(node.snippet || item.snippet || '').slice(0, 280),
    wastedMs: item.wastedMs != null ? Math.round(Number(item.wastedMs)) : null,
    wastedBytes: item.wastedBytes != null ? Math.round(Number(item.wastedBytes)) : null,
    totalBytes: item.totalBytes != null ? Math.round(Number(item.totalBytes)) : null,
  };
}

function tableRows(details, max = 20) {
  const items = details?.items;
  if (!Array.isArray(items) || !items.length) return [];
  return items.slice(0, max).map(itemRow).filter((r) => r.url || r.label || r.snippet);
}

function expandAudit(lr, a) {
  if (!a) return null;
  return {
    id: a.id,
    title: a.title || a.id,
    category: categoryForAudit(lr, a.id),
    description: stripMd(a.description).slice(0, 900),
    docsUrl: firstDocLink(a.description),
    displayValue: a.displayValue || '',
    score: a.score == null ? null : Number(a.score),
    numericValue: a.numericValue,
    savingsMs: Math.round(Number(a.details?.overallSavingsMs) || 0),
    savingsBytes: Math.round(Number(a.details?.overallSavingsBytes) || 0),
    items: tableRows(a.details),
  };
}

function pickAudit(lr, id) {
  const a = lr?.audits?.[id];
  if (!a) return null;
  return {
    id,
    title: a.title || id,
    displayValue: a.displayValue || '',
    score: a.score == null ? null : Number(a.score),
    numericValue: a.numericValue,
  };
}

function opportunities(lr) {
  const audits = lr?.audits || {};
  return Object.values(audits)
    .filter((a) => a && a.details?.type === 'opportunity' && a.score != null && a.score < 1)
    .map((a) => expandAudit(lr, a))
    .sort((a, b) => (b.savingsMs || 0) - (a.savingsMs || 0) || (b.savingsBytes || 0) - (a.savingsBytes || 0));
}

function diagnostics(lr) {
  const skip = new Set(METRIC_IDS);
  const audits = lr?.audits || {};
  return Object.values(audits)
    .filter((a) => a
      && !skip.has(a.id)
      && a.details
      && a.details.type !== 'opportunity'
      && a.details.type !== 'screenshot'
      && a.details.type !== 'filmstrip'
      && a.details.type !== 'debugdata'
      && a.scoreDisplayMode === 'numeric'
      && a.score != null
      && a.score < 0.9)
    .map((a) => expandAudit(lr, a))
    .sort((a, b) => (a.score ?? 1) - (b.score ?? 1));
}

function failedAudits(lr) {
  const skip = new Set(['valid-source-maps', 'bf-cache']);
  const audits = lr?.audits || {};
  return Object.values(audits)
    .filter((a) => a && a.score != null && a.score < 0.5 && a.scoreDisplayMode === 'binary' && !skip.has(a.id))
    .map((a) => expandAudit(lr, a));
}

function warningAudits(lr) {
  const audits = lr?.audits || {};
  return Object.values(audits)
    .filter((a) => a && a.scoreDisplayMode === 'binary' && a.score != null && a.score >= 0.5 && a.score < 1)
    .map((a) => expandAudit(lr, a));
}

function cruxMetrics(data) {
  const crux = data?.loadingExperience?.metrics || {};
  return Object.entries(crux).map(([id, m]) => ({
    id,
    category: m?.category || '',
    percentile: m?.percentile,
  }));
}

function environment(lr) {
  const env = lr?.environment || {};
  const cfg = lr?.configSettings || {};
  return {
    lighthouseVersion: lr?.lighthouseVersion || '',
    fetchTime: lr?.fetchTime || null,
    formFactor: cfg.formFactor || cfg.emulatedFormFactor || '',
    throttlingMethod: cfg.throttlingMethod || '',
    hostUserAgent: String(env.hostUserAgent || '').slice(0, 180),
    benchmarkIndex: env.benchmarkIndex || null,
  };
}

function briefLines(view) {
  const lines = [
    `# Lighthouse developer brief (${view.strategy})`,
    `URL: ${view.finalUrl}`,
    `Lighthouse ${view.lighthouseVersion || ''} · ${view.fetchTime || ''}`,
    `Scores — Performance ${view.categories.performance ?? '—'} · Accessibility ${view.categories.accessibility ?? '—'} · Best practices ${view.categories.bestPractices ?? '—'} · SEO ${view.categories.seo ?? '—'}`,
    '',
    '## Lab metrics',
  ];
  for (const m of view.metrics || []) lines.push(`- ${m.title}: ${m.displayValue || '—'}`);
  const addBlock = (title, items) => {
    lines.push('', `## ${title}`);
    if (!items.length) {
      lines.push('- None');
      return;
    }
    for (const o of items) {
      const save = [
        o.savingsMs ? `${o.savingsMs} ms` : '',
        o.savingsBytes ? `${Math.round(o.savingsBytes / 1024)} KiB` : '',
        o.displayValue || '',
      ].filter(Boolean).join(', ');
      lines.push(`### ${o.title}${save ? ` (${save})` : ''}`);
      if (o.description) lines.push(o.description);
      if (o.docsUrl) lines.push(`Docs: ${o.docsUrl}`);
      for (const it of o.items || []) {
        const bits = [it.url || it.label, it.snippet, it.wastedMs != null ? `${it.wastedMs} ms wasted` : '', it.wastedBytes != null ? `${it.wastedBytes} bytes wasted` : '']
          .filter(Boolean);
        if (bits.length) lines.push(`- ${bits.join(' · ')}`);
      }
    }
  };
  addBlock('Performance opportunities', view.opportunities || []);
  addBlock('Diagnostics', view.diagnostics || []);
  addBlock('Failed checks (fix these)', view.failedAudits || []);
  addBlock('Warnings', view.warnings || []);
  return lines.join('\n');
}

function summarisePsi(data, strategy) {
  const lr = data?.lighthouseResult;
  if (!lr) {
    const msg = data?.error?.message || data?.lighthouseError || 'No Lighthouse result';
    throw new Error(msg);
  }
  const categories = {
    performance: catScore(lr, 'performance'),
    accessibility: catScore(lr, 'accessibility'),
    bestPractices: catScore(lr, 'best-practices'),
    seo: catScore(lr, 'seo'),
  };
  const score = categories.performance != null ? categories.performance : 0;
  const view = {
    strategy,
    fetchTime: lr.fetchTime || null,
    finalUrl: lr.finalRequestedUrl || lr.requestedUrl || lr.finalUrl || '',
    lighthouseVersion: lr.lighthouseVersion || '',
    environment: environment(lr),
    categories,
    metrics: METRIC_IDS.map((id) => pickAudit(lr, id)).filter(Boolean),
    fieldData: cruxMetrics(data),
    opportunities: opportunities(lr),
    diagnostics: diagnostics(lr),
    failedAudits: failedAudits(lr),
    warnings: warningAudits(lr),
    score,
    summary: `${strategy} · Perf ${categories.performance ?? '—'} · A11y ${categories.accessibility ?? '—'} · BP ${categories.bestPractices ?? '—'} · SEO ${categories.seo ?? '—'}`,
  };
  view.developerBrief = briefLines(view);
  return view;
}

function psiErrorMessage(statusCode, data, { keyConfigured } = {}) {
  const err = data?.error || {};
  const reason = googleErrorReason(data).toUpperCase();
  const msg = String(err.message || '');
  if (!keyConfigured) {
    return 'PAGESPEED_API_KEY is not set on this Railway service. Add it on the web app (not Postgres), then redeploy. Boot log must show [env] PAGESPEED_API_KEY: set. Calls without a key from Railway IPs are often blocked by Google.';
  }
  if (reason.includes('SERVICE_BLOCKED') || /requests to this api/i.test(msg)) {
    return 'Google blocked this key for PageSpeed (API_KEY_SERVICE_BLOCKED). Application restrictions = None is not enough. Edit the key → API restrictions: either “Don\'t restrict key”, or Restrict key with PageSpeed Insights API ticked. Also enable PageSpeed Insights API in the Library on the same project as the key.';
  }
  if (reason.includes('HTTP_REFERRER') || /referer|referrer/i.test(msg)) {
    return 'Google blocked this API key because it is restricted to HTTP referrers. Application restrictions → None. Vault calls Google from the server, not the browser.';
  }
  if (reason.includes('IP_ADDRESS') || /IP address/i.test(msg)) {
    return 'Google blocked this API key because of an IP restriction. Do not lock it to a Railway IP. Application restrictions → None.';
  }
  if (/has not been used|is disabled/i.test(msg) || reason.includes('SERVICE_DISABLED')) {
    return 'Enable PageSpeed Insights API on this Google Cloud project, then wait a minute and retry.';
  }
  if (reason.includes('API_KEY_INVALID') || /api key not valid/i.test(msg)) {
    return 'Google rejected PAGESPEED_API_KEY (invalid or from a different project). Paste the key with no quotes, confirm it is on the Railway web service, and that PageSpeed Insights API is enabled on that key’s project.';
  }
  return msg || `PageSpeed HTTP ${statusCode}`;
}

async function runLighthouse(rawUrl, { strategy = 'mobile' } = {}) {
  const url = normaliseHttpUrl(rawUrl);
  const parsed = new URL(url);
  await checkSsrf(parsed.hostname);

  const key = readPsiKey();
  if (!key) {
    throw new Error(psiErrorMessage(403, {}, { keyConfigured: false }));
  }

  const strat = strategy === 'desktop' ? 'desktop' : 'mobile';
  const params = new URLSearchParams({ url, strategy: strat });
  ['performance', 'accessibility', 'best-practices', 'seo'].forEach((c) => params.append('category', c));
  params.set('key', key);

  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`;
  const { statusCode, data } = await getJson(endpoint, {
    timeoutMs: 120000,
    headers: { 'X-Goog-Api-Key': key },
  });
  if (statusCode >= 400) {
    const reason = googleErrorReason(data);
    console.error('[html/psi]', JSON.stringify({
      statusCode,
      reason: reason || null,
      message: data?.error?.message || null,
      keyConfigured: true,
    }));
    throw new Error(psiErrorMessage(statusCode, data, { keyConfigured: true }));
  }
  return summarisePsi(data, strat);
}

async function runLighthousePair(rawUrl) {
  const url = normaliseHttpUrl(rawUrl);
  const settled = await Promise.allSettled([
    runLighthouse(url, { strategy: 'mobile' }),
    runLighthouse(url, { strategy: 'desktop' }),
  ]);
  const mobile = settled[0].status === 'fulfilled' ? settled[0].value : null;
  const desktop = settled[1].status === 'fulfilled' ? settled[1].value : null;
  if (!mobile && !desktop) {
    const a = settled[0].reason?.message || 'mobile failed';
    const b = settled[1].reason?.message || 'desktop failed';
    throw new Error(`Mobile: ${a} Desktop: ${b}`);
  }
  const errors = {
    mobile: settled[0].status === 'rejected' ? (settled[0].reason?.message || 'failed') : null,
    desktop: settled[1].status === 'rejected' ? (settled[1].reason?.message || 'failed') : null,
  };
  const score = mobile?.score ?? desktop?.score ?? 0;
  const finalUrl = mobile?.finalUrl || desktop?.finalUrl || url;
  const parts = [];
  if (mobile) parts.push(`Mobile perf ${mobile.score}`);
  else parts.push(`Mobile failed`);
  if (desktop) parts.push(`Desktop perf ${desktop.score}`);
  else parts.push(`Desktop failed`);
  return {
    version: 2,
    strategy: 'both',
    finalUrl,
    score,
    summary: parts.join(' · '),
    mobile,
    desktop,
    errors: (errors.mobile || errors.desktop) ? errors : null,
    developerBrief: [
      mobile?.developerBrief || '# Mobile\n(no result)',
      '',
      '---',
      '',
      desktop?.developerBrief || '# Desktop\n(no result)',
    ].join('\n'),
  };
}

module.exports = { runLighthouse, runLighthousePair };
