'use strict';

/**
 * robots.txt parsing for the AI Visibility audit.
 *
 * The blueprint version of this check (`Disallow: /` anywhere in the file plus a bot
 * name anywhere in the file) is wrong: a site can block Googlebot but allow GPTBot,
 * or allow everything except one path. This parser follows the robots.txt grouping
 * rules properly:
 *
 *  - consecutive `User-agent` lines share the rules that follow them;
 *  - a bot uses the groups whose user-agent matches it, and only falls back to `*`
 *    when no specific group matches;
 *  - the longest matching Allow/Disallow path wins, and Allow wins a tie.
 *
 * It is intentionally small: robots.txt has no official grammar beyond this, and a
 * malformed file should never stop an audit.
 */

// The crawlers an LLM/search answer can be built from. `purpose` is what the person
// reading the report needs to know, not what the RFC says.
const AI_BOTS = [
  { bot: 'GPTBot', label: 'OpenAI training crawler', purpose: 'Collects pages OpenAI may use for model training.' },
  { bot: 'OAI-SearchBot', label: 'OpenAI search crawler', purpose: 'Builds the index used by ChatGPT search answers.' },
  { bot: 'ChatGPT-User', label: 'ChatGPT browsing', purpose: 'Fetches a page when someone asks ChatGPT to open it.' },
  { bot: 'ClaudeBot', label: 'Anthropic crawler', purpose: 'Collects pages Anthropic may use for model training.' },
  { bot: 'Claude-Web', label: 'Claude browsing (legacy)', purpose: 'Older Anthropic browsing user-agent; still seen in the wild.' },
  { bot: 'anthropic-ai', label: 'Anthropic (legacy)', purpose: 'Older Anthropic training user-agent; still seen in the wild.' },
  { bot: 'PerplexityBot', label: 'Perplexity index', purpose: 'Builds the index Perplexity cites in its answers.' },
  { bot: 'Perplexity-User', label: 'Perplexity browsing', purpose: 'Fetches a page when someone asks Perplexity to open it.' },
  { bot: 'Google-Extended', label: 'Google AI training', purpose: 'Controls Gemini and Vertex AI training use of a page. It does not affect Google Search.' },
  { bot: 'Applebot-Extended', label: 'Apple AI training', purpose: 'Controls Apple Intelligence training use of a page.' },
  { bot: 'CCBot', label: 'Common Crawl', purpose: 'Feeds the public Common Crawl corpus many models are trained on.' },
  { bot: 'Bingbot', label: 'Bing / Copilot index', purpose: 'Builds the Bing index Copilot answers from.' },
  { bot: 'Bytespider', label: 'ByteDance crawler', purpose: 'Collects pages for ByteDance models and products.' },
  { bot: 'meta-externalagent', label: 'Meta AI crawler', purpose: 'Collects pages Meta may use for model training.' },
];

function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;

  for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }

    lastWasAgent = false;

    if (field === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }

    if (!current) {
      current = { agents: ['*'], rules: [] };
      groups.push(current);
    }

    if (field === 'allow' || field === 'disallow') {
      // `Disallow:` with no path means "no restriction", not "block everything".
      if (field === 'disallow' && !value) continue;
      current.rules.push({ type: field, path: value || '/' });
      continue;
    }

    if (field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }

  return { groups, sitemaps };
}

function normaliseBot(bot) {
  return String(bot || '').trim().toLowerCase();
}

/** Does a User-agent token in the file select this bot? */
function agentMatches(token, bot) {
  const t = normaliseBot(token);
  const b = normaliseBot(bot);
  if (!t || !b) return false;
  if (t === '*') return true;
  if (t === b) return true;
  // Some files write "Claude" for ClaudeBot, or include a version/product suffix.
  if (t.length >= 5 && (b.startsWith(t) || t.startsWith(b))) return true;
  return false;
}

function escapeRegExp(s) {
  return String(s).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** Does a robots path pattern match a URL path? Supports `*` wildcards and a trailing `$`. */
function pathMatches(pattern, pathname) {
  let p = String(pattern || '').trim();
  if (!p) return false;
  if (p === '/') return true;
  let anchored = false;
  if (p.endsWith('$')) {
    anchored = true;
    p = p.slice(0, -1);
  }
  const re = new RegExp(`^${escapeRegExp(p).replace(/\*/g, '.*')}${anchored ? '$' : ''}`);
  return re.test(pathname);
}

function groupsForBot(parsed, bot) {
  const all = (parsed && parsed.groups) || [];
  const specific = all.filter((g) => g.agents.some((a) => a !== '*' && agentMatches(a, bot)));
  if (specific.length) return specific;
  return all.filter((g) => g.agents.includes('*'));
}

/**
 * Is `pathname` allowed for `bot`? Returns the winning rule (or null when the bot is
 * allowed by default), so the report can say why.
 */
function checkBot(parsed, bot, pathname = '/') {
  const groups = groupsForBot(parsed, bot);
  if (!groups.length) {
    return { allowed: true, rule: null, reason: 'No robots.txt group applies, so the page is open to this crawler.' };
  }

  let best = null;
  for (const group of groups) {
    for (const rule of group.rules) {
      if (!pathMatches(rule.path, pathname)) continue;
      const length = rule.path.length;
      if (!best || length > best.length || (length === best.length && rule.type === 'allow')) {
        best = { ...rule, length };
      }
    }
  }

  if (!best) {
    return { allowed: true, rule: null, reason: 'No rule on this path, so the page is open to this crawler.' };
  }
  if (best.type === 'allow') {
    return { allowed: true, rule: best, reason: `Allowed by "Allow: ${best.path}".` };
  }
  return { allowed: false, rule: best, reason: `Blocked by "Disallow: ${best.path}".` };
}

/**
 * The per-bot verdicts used by the report. `found: false` means there was no usable
 * robots.txt, which is treated as "everything allowed" (the crawler's default).
 */
function auditRobots(parsed, { pathname = '/', found = true, statusCode = 200, url = '', error = '' } = {}) {
  const bots = AI_BOTS.map((entry) => {
    const verdict = found
      ? checkBot(parsed, entry.bot, pathname)
      : { allowed: true, rule: null, reason: 'No usable robots.txt, so the page is open to this crawler.' };
    return {
      bot: entry.bot,
      label: entry.label,
      purpose: entry.purpose,
      allowed: verdict.allowed,
      rule: verdict.rule ? `${verdict.rule.type === 'allow' ? 'Allow' : 'Disallow'}: ${verdict.rule.path}` : null,
      reason: verdict.reason,
    };
  });

  return {
    found,
    statusCode,
    url,
    error,
    sitemaps: (parsed && parsed.sitemaps) || [],
    groups: (parsed && parsed.groups) || [],
    bots,
    blocked: bots.filter((b) => !b.allowed).map((b) => b.bot),
  };
}

module.exports = {
  AI_BOTS,
  parseRobots,
  pathMatches,
  checkBot,
  auditRobots,
};
