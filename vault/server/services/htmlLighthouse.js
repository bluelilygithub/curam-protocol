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

function getJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data;
        try { data = JSON.parse(text); } catch {
          reject(new Error('PageSpeed returned invalid JSON'));
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

async function runLighthouse(rawUrl, { strategy = 'mobile' } = {}) {
  const url = normaliseHttpUrl(rawUrl);
  const parsed = new URL(url);
  await checkSsrf(parsed.hostname);

  const strat = strategy === 'desktop' ? 'desktop' : 'mobile';
  const params = new URLSearchParams({ url, strategy: strat });
  ['performance', 'accessibility', 'best-practices', 'seo'].forEach((c) => params.append('category', c));
  const key = String(process.env.PAGESPEED_API_KEY || process.env.GOOGLE_PAGESPEED_API_KEY || '').trim();
  if (key) params.set('key', key);

  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`;
  const { statusCode, data } = await getJson(endpoint, 120000);
  if (statusCode >= 400) {
    throw new Error(data?.error?.message || `PageSpeed HTTP ${statusCode}`);
  }
  return summarisePsi(data, strat);
}

module.exports = { runLighthouse };
