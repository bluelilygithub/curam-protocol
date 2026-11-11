'use strict';

/**
 * The AI Visibility report as Markdown. This is the copy/download artifact and the
 * source the PDF is rendered from, so the two cannot drift.
 */

function fmtDate(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return String(value || '');
  return d.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function scoreLine(label, value) {
  return `| ${label} | ${value == null ? 'not measured' : `${value}/100`} |`;
}

function cell(value) {
  return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function robotsTable(robots) {
  const bots = (robots && robots.bots) || [];
  if (!bots.length) return '_No robots.txt check was run._';
  const rows = bots.map((b) => `| ${cell(b.bot)} | ${b.allowed ? 'Allowed' : 'Blocked'} | ${cell(b.rule || '—')} | ${cell(b.label)} |`);
  return [
    '| Crawler | Verdict | Rule | What it does |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function readabilitySection(js) {
  if (!js) return '_Not measured._';
  if (js.renderError) {
    return [
      `The page could not be rendered with JavaScript: ${js.renderError}`,
      '',
      `Raw HTML: ${js.raw.words} words, ${js.raw.headings} headings.`,
    ].join('\n');
  }
  return [
    `- Raw HTML (no JavaScript): **${js.raw.words} words**, ${js.raw.headings} headings`,
    `- Rendered page (JavaScript on): **${js.rendered.words} words**, ${js.rendered.headings} headings`,
    `- Share of the page readable without JavaScript: **${Math.round((js.ratio || 0) * 100)}%**`,
    '',
    js.ratio >= 0.85
      ? 'The page is readable without JavaScript. An AI crawler that does not run scripts still sees the offer.'
      : js.ratio >= 0.6
        ? 'Most of the page is in the HTML, but some content is added by JavaScript. Move the offer, prices and specifications into the initial HTML.'
        : 'Most of the page only exists after JavaScript runs. A crawler that does not run scripts sees little or none of the offer.',
  ].join('\n');
}

function schemaSection(schema) {
  if (!schema) return '_Not measured._';
  const types = Array.isArray(schema.types) ? schema.types : [];
  const errors = Array.isArray(schema.errors) ? schema.errors : [];
  const entities = Array.isArray(schema.entities) ? schema.entities : [];
  const lines = [];
  const blockCount = Number(schema.blockCount) || 0;
  lines.push(`${blockCount} JSON-LD block${blockCount === 1 ? '' : 's'} found. Types: ${types.length ? types.join(', ') : 'none'}.`);
  lines.push('');
  if (errors.length) {
    lines.push('**Parse errors**');
    for (const e of errors) lines.push(`- ${e}`);
    lines.push('');
  }
  if (entities.length) {
    lines.push('| Entity | Required properties | Useful properties missing |');
    lines.push('| --- | --- | --- |');
    for (const e of entities) {
      const required = e.checked
        ? (e.missingRequired.length ? `Missing: ${e.missingRequired.join(', ')}` : 'Complete')
        : 'Not checked';
      const recommended = e.missingRecommended.length ? e.missingRecommended.join(', ') : '—';
      lines.push(`| ${cell(e.label)} | ${cell(required)} | ${cell(recommended)} |`);
    }
    lines.push('');
  }
  for (const f of schema.findings || []) {
    lines.push(`- **${f.severity.toUpperCase()}** ${f.title} — ${f.detail} _Fix:_ ${f.recommendation}`);
  }
  return lines.join('\n');
}

function querySection(query, index) {
  const lines = [];
  lines.push(`### ${index + 1}. ${query.query}`);
  lines.push('');
  lines.push(`Source: ${query.source === 'generated' ? 'generated from the page' : 'supplied'}${query.model ? ` · Model: ${query.model}` : ''}`);
  lines.push('');

  if (query.search.error) {
    lines.push(`**Search:** unavailable — ${query.search.error}`);
  } else {
    lines.push(`**Search (${query.search.provider || 'provider'}):** ${query.search.results.length} result${query.search.results.length === 1 ? '' : 's'}.`);
    if (query.citation && query.citation.inSearchResults) {
      lines.push(`The site appeared at position ${query.citation.domainRank} in those results.`);
    } else if (query.search.results.length) {
      lines.push('The site did not appear in those results.');
    }
  }
  lines.push('');

  if (query.citation) {
    lines.push(`- Named in the answer: ${query.citation.mentioned ? 'yes' : 'no'}${query.citation.brandMentioned ? ' (brand)' : ''}${query.citation.domainMentioned ? ' (domain)' : ''}`);
    lines.push(`- Linked in the answer: ${query.citation.citedInAnswer ? 'yes' : 'no'}${query.citation.urlsCited.length ? ` (${query.citation.urlsCited.join(', ')})` : ''}`);
    lines.push(`- Citation score: ${query.citation.score}/100`);
    lines.push('');
  }

  if (query.facts && query.facts.length) {
    lines.push('**Key facts**');
    for (const f of query.facts) {
      lines.push(`- ${f.present ? 'Present' : 'Missing'}: ${f.statement}${f.present ? ` (${Math.round(f.confidence * 100)}% match)` : ''}`);
    }
    lines.push('');
  }

  if (query.answer) {
    lines.push('**Answer**');
    lines.push('');
    lines.push('> ' + query.answer.split(/\r?\n/).join('\n> '));
    lines.push('');
  } else if (query.error) {
    lines.push(`_${query.error}_`);
    lines.push('');
  }

  if (query.search.results && query.search.results.length) {
    lines.push('**Results given to the model**');
    for (const r of query.search.results) lines.push(`- [${r.title || r.url}](${r.url})${r.snippet ? ` — ${r.snippet}` : ''}`);
    lines.push('');
  }

  return lines.join('\n');
}

function buildMarkdown(report, meta = {}) {
  const r = report || {};
  const scores = r.scores || {};
  const lines = [];

  lines.push(`# AI Visibility report: ${r.host || r.url || 'website'}`);
  lines.push('');
  lines.push(`- **Site:** ${r.url || meta.url || ''}`);
  if (r.brand) lines.push(`- **Brand:** ${r.brand}`);
  lines.push(`- **Run:** ${fmtDate(r.auditedAt || meta.createdAt)}`);
  if (r.model) lines.push(`- **Model used for answers:** ${r.model}`);
  lines.push(`- **Overall score:** **${scores.overall == null ? '—' : `${scores.overall}/100`}**`);
  lines.push('');
  lines.push(r.summary || '');
  lines.push('');

  lines.push('## Scores');
  lines.push('');
  lines.push('| Area | Score |');
  lines.push('| --- | --- |');
  lines.push(scoreLine('Technical access', scores.technical));
  lines.push(scoreLine('No-JavaScript readability', scores.readability));
  lines.push(scoreLine('Structured data', scores.schema));
  lines.push(scoreLine('Citation in answers', scores.citation));
  lines.push(scoreLine('Key-fact accuracy', scores.accuracy));
  lines.push('');
  if (scores.measured && scores.measured.length) {
    lines.push(`Measured: ${scores.measured.join(', ')}. Unmeasured areas are left out of the overall score rather than scored zero.`);
    lines.push('');
  }

  lines.push('## Suggestions');
  lines.push('');
  const suggestions = r.suggestions || [];
  if (!suggestions.length) {
    lines.push('No suggestions — every check passed.');
  } else {
    for (const s of suggestions) {
      lines.push(`### ${s.severity === 'fail' ? 'Fix' : s.severity === 'warn' ? 'Improve' : 'Consider'} · ${s.area}: ${s.title}`);
      lines.push('');
      if (s.detail) lines.push(s.detail);
      if (s.recommendation) {
        lines.push('');
        lines.push(`**What to do:** ${s.recommendation}`);
      }
      lines.push('');
    }
  }
  lines.push('');

  lines.push('## 1. Technical access');
  lines.push('');
  const http = (r.technical && r.technical.http) || {};
  lines.push(`- HTTP status: ${http.status || '—'}${http.finalUrl && http.finalUrl !== r.url ? ` (final URL: ${http.finalUrl})` : ''}`);
  const metaInfo = (r.technical && r.technical.meta) || {};
  lines.push(`- Title: ${metaInfo.title ? metaInfo.title : 'missing'}`);
  lines.push(`- Meta description: ${metaInfo.description ? metaInfo.description : 'missing'}`);
  lines.push(`- Robots meta: ${metaInfo.robots || 'none'}`);
  lines.push(`- Language: ${metaInfo.lang || 'missing'}`);
  if (r.technical && r.technical.robots && r.technical.robots.sitemaps && r.technical.robots.sitemaps.length) {
    lines.push(`- Sitemaps in robots.txt: ${r.technical.robots.sitemaps.join(', ')}`);
  }
  lines.push('');
  lines.push('### robots.txt and AI crawlers');
  lines.push('');
  lines.push(robotsTable(r.technical && r.technical.robots));
  lines.push('');
  if (r.technical && r.technical.robots && !r.technical.robots.found) {
    lines.push(`No usable robots.txt was found${r.technical.robots.statusCode ? ` (HTTP ${r.technical.robots.statusCode})` : ''}. With no file, every crawler is allowed by default.`);
    lines.push('');
  }
  lines.push('> Google-Extended does not control Google Search; it controls Gemini/Vertex training. Blocking GPTBot does not remove a page from Google search results.');
  lines.push('');

  lines.push('## 2. Readability without JavaScript');
  lines.push('');
  lines.push(readabilitySection(r.technical && r.technical.js));
  lines.push('');

  lines.push('## 3. Structured data');
  lines.push('');
  lines.push(schemaSection(r.schema));
  lines.push('');

  lines.push('## 4. Simulated questions');
  lines.push('');
  if (!(r.queries || []).length) {
    lines.push('_No questions were run._');
  } else {
    (r.queries || []).forEach((q, i) => {
      lines.push(querySection(q, i));
    });
  }
  lines.push('');

  if ((r.facts || []).length) {
    lines.push('## 5. Key facts across all answers');
    lines.push('');
    lines.push('| Fact | Present | Answers containing it |');
    lines.push('| --- | --- | --- |');
    for (const f of r.facts) {
      lines.push(`| ${cell(f.statement)} | ${f.present ? 'Yes' : 'No'} | ${f.answersFound || 0} |`);
    }
    lines.push('');
    lines.push('Fact matching is a heuristic: it checks numbers (with units) and distinctive words, not meaning. Use it as a prompt to re-read the answer, not as proof.');
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`Generated by Curam Vault · AI Visibility · ${fmtDate(r.auditedAt || meta.createdAt)}`);
  lines.push('');
  return lines.join('\n');
}

module.exports = { buildMarkdown, fmtDate };
