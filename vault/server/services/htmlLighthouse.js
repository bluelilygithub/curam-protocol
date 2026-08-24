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
    .map((a) => ({
      id: a.id,
      title: a.title,
      displayValue: a.displayValue || '',
      score: a.score,
      savingsMs: a.details?.overallSavingsMs || 0,
    }))
    .sort((a, b) => (b.savingsMs || 0) - (a.savingsMs || 0))
    .slice(0, 12);
}

function failedAudits(lr) {
  const skip = new Set(['valid-source-maps', 'bf-cache']);
  const audits = lr?.audits || {};
  return Object.values(audits)
    .filter((a) => a && a.score != null && a.score < 0.5 && a.scoreDisplayMode === 'binary' && !skip.has(a.id))
    .map((a) => ({
      id: a.id,
      title: a.title,
      description: String(a.description || '').replace(/\[.*?\]\(.*?\)/g, '').slice(0, 220),
    }))
    .slice(0, 15);
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
  const crux = data.loadingExperience?.metrics || {};
  return {
    strategy,
    fetchTime: lr.fetchTime || null,
    finalUrl: lr.finalRequestedUrl || lr.requestedUrl || lr.finalUrl || '',
    lighthouseVersion: lr.lighthouseVersion || '',
    categories,
    metrics: METRIC_IDS.map((id) => pickAudit(lr, id)).filter(Boolean),
    opportunities: opportunities(lr),
    failedAudits: failedAudits(lr),
    fieldData: Object.keys(crux).length ? crux : null,
    score,
    summary: `${strategy} · Perf ${categories.performance ?? '—'} · A11y ${categories.accessibility ?? '—'} · BP ${categories.bestPractices ?? '—'} · SEO ${categories.seo ?? '—'}`,
  };
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

module.exports = { runLighthouse };
