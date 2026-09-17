'use strict';

// Thin read-only wrapper around Sentry's REST API for the admin dashboard
// overview panel. Gated on SENTRY_AUTH_TOKEN — no-op (throws a clear error)
// until that's set. Org/project default to this workspace's Sentry project
// but can be overridden without redeploying secrets.
const SENTRY_ORG = process.env.SENTRY_ORG || 'curam-ai';
const SENTRY_PROJECT = process.env.SENTRY_PROJECT || 'python-flask';
const SENTRY_API_BASE = 'https://sentry.io/api/0';

function enabled() {
  return Boolean(process.env.SENTRY_AUTH_TOKEN);
}

async function sentryFetch(path) {
  const res = await fetch(`${SENTRY_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Sentry API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Overview for the admin dashboard: unresolved issue count, 24h event count,
// and the top unresolved issues by event volume (last 14 days).
async function getOverview() {
  if (!enabled()) {
    const err = new Error('SENTRY_AUTH_TOKEN not set');
    err.code = 'SENTRY_DISABLED';
    throw err;
  }

  const [unresolvedIssues, statsRows] = await Promise.all([
    sentryFetch(
      `/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?query=${encodeURIComponent('is:unresolved')}&statsPeriod=14d&sort=freq&limit=10`
    ),
    sentryFetch(`/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/stats/?stat=received&resolution=1h&since=${Math.floor(Date.now() / 1000) - 86400}`),
  ]);

  const events24h = Array.isArray(statsRows)
    ? statsRows.reduce((sum, [, count]) => sum + Number(count || 0), 0)
    : 0;

  const issues = (unresolvedIssues || []).map((i) => ({
    id: i.id,
    title: i.title,
    culprit: i.culprit,
    level: i.level,
    count: Number(i.count || 0),
    userCount: Number(i.userCount || 0),
    firstSeen: i.firstSeen,
    lastSeen: i.lastSeen,
    permalink: i.permalink,
  }));

  return {
    org: SENTRY_ORG,
    project: SENTRY_PROJECT,
    projectUrl: `https://${SENTRY_ORG}.sentry.io/projects/${SENTRY_PROJECT}/`,
    unresolvedCount: issues.length === 10 ? null : issues.length, // exact only when under the page limit
    events24h,
    issues,
  };
}

module.exports = { enabled, getOverview, SENTRY_ORG, SENTRY_PROJECT };
