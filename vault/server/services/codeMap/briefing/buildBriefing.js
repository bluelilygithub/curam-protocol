'use strict';

// The Code Map "Context" briefing (docs/code-map.md "Context"): a Markdown description of how Vault is built, written for a Claude
// conversation that knows nothing about it, plus the same sections as data for the page's report. Pure: a snapshot goes in (gathered by
// snapshot.js), { markdown, sections, stats } comes out. No database, no files, no environment.
//
// PRIVACY: it describes how Vault is built, never what is in it. Only the fields named below are read from the snapshot: tool names,
// groups, sizes, scores, finding titles, changelog dates/areas/subjects/concerns, configured YES/NO, package names, Ponytail totals and the
// owner's own notes. Test: node server/services/codeMap/briefing/buildBriefing.test.js

// Only docs.js's formatting is used here; it reads files only when its catalog functions are called, so this module stays pure.
const { notIncludedSection, NOT_INCLUDED_TITLE } = require('./docs');

const MAX_CHARS = 60000;
const TRIMMED_CHANGELOG_DAYS = 14;
const MAX_CONCERN_CHARS = 300;
const MAX_CONCERNS = 40;
const TOP_FINDINGS = 10;
const MAX_LINKS = 5;

const clean = (s, max = 400) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const cell = (s, max) => clean(s, max).replace(/\|/g, '/');
const num = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-AU') : '?');
// Dates are Brisbane days (UTC+10 all year), like the Changelog page; plain toISOString() gave the day before for anything after 2 pm UTC.
const BRISBANE_MS = 10 * 3600 * 1000;
const day = (d) => { try { return new Date(new Date(d).getTime() + BRISBANE_MS).toISOString().slice(0, 10); } catch { return '?'; } };

/** ga / preview / parked / admin, from the run's tool record. */
const statusOf = (t) => (t.adminOnly ? 'admin' : ['preview', 'parked'].includes(t.lifecycle) ? t.lifecycle : 'ga');

/** Tools linked to this one (shared code or API calls), strongest first. */
function linksOf(id, edges, labels) {
  return (edges || [])
    .filter((e) => e.a === id || e.b === id)
    .sort((x, y) => (y.n || 0) - (x.n || 0))
    .slice(0, MAX_LINKS)
    .map((e) => labels[e.a === id ? e.b : e.a] || (e.a === id ? e.b : e.a));
}

function toolRows(run, purposes) {
  const tools = run?.tools || [];
  const labels = Object.fromEntries(tools.map((t) => [t.id, t.label]));
  return tools.map((t) => ({
    id: clean(t.id, 60), name: clean(t.label, 80), group: clean(t.group, 60), status: statusOf(t),
    purpose: clean(purposes?.[t.id] || t.label, 200),
    lines: (Number(t.locClient) || 0) + (Number(t.locServer) || 0),
    tests: Array.isArray(t.tests) ? t.tests.length : Number(t.tests) || 0,
    score: Number.isFinite(Number(t.score)) ? Number(t.score) : null,
    links: linksOf(t.id, run?.edges, labels).map((x) => clean(x, 60)),
  }));
}

function findingRows(run) {
  const labels = Object.fromEntries((run?.tools || []).map((t) => [t.id, t.label]));
  const order = { high: 0, medium: 1, low: 2 };
  return (run?.findings || [])
    .slice()
    .sort((a, b) => (order[a.sev] ?? 3) - (order[b.sev] ?? 3) || (b.tools?.length || 0) - (a.tools?.length || 0))
    .slice(0, TOP_FINDINGS)
    .map((f) => ({ title: clean(f.title, 160), severity: ['high', 'medium', 'low'].includes(f.sev) ? f.sev : 'low', tools: (f.tools || []).map((id) => clean(labels[id] || id, 60)) }));
}

/**
 * @param {object} s  snapshot (snapshot.js): { generatedAt, commitHint, run, curated: { about, rules, buildingBlocks }, purposes, packages,
 *                    services: [{ service, configured, usedFor }], changelog: [{ committedAt, area, subject, concerns }], ponytail, notes,
 *                    cronJobs, rulesStale }
 * @param {{ maxChars?: number }} [opts]
 */
function buildBriefing(s, { maxChars = MAX_CHARS } = {}) {
  const generatedAt = s.generatedAt ? new Date(s.generatedAt) : new Date();
  const date = day(generatedAt);
  const commit = s.commitHint ? clean(s.commitHint, 40).slice(0, 12) : 'unknown';
  const run = s.run || null;
  const summary = run?.summary || {};
  const tools = toolRows(run, s.purposes);
  const findings = findingRows(run);
  const services = (s.services || []).map((x) => ({ service: clean(x.service, 60), configured: !!x.configured, usedFor: clean(x.usedFor, 200) }));
  const packages = [...new Set((s.packages || []).map((p) => clean(p, 80)).filter(Boolean))].sort();
  const entries = (s.changelog || [])
    .map((e) => ({ date: day(e.committedAt), area: clean(e.area, 60), subject: clean(e.subject, 200), concerns: clean(e.concerns, MAX_CONCERN_CHARS + 1) }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const since = (days) => day(generatedAt.getTime() - days * 86400000);
  const pt = s.ponytail && Number(s.ponytail.tasks) > 0 ? s.ponytail : null;
  const notes = String(s.notes || '').replace(/\r\n?/g, '\n').trim();
  const cycles = Array.isArray(run?.cycles) ? run.cycles.length : Number(summary.cycles) || 0;
  const hotspots = (run?.hotspots || []).slice(0, 5).map((h) => clean(h.file || h, 120));
  const largest = (run?.largest || []).slice(0, 5).map((l) => ({ file: clean(l.file, 120), lines: Number(l.loc) || 0 }));
  const counts = {
    tools: tools.length || Number(summary.tools) || 0, mounts: Number(summary.mounts) || 0, routeFiles: Number(summary.routesFiles) || 0,
    files: Number(summary.files) || 0, linesServer: Number(summary.locServer) || 0, linesClient: Number(summary.locClient) || 0,
    linesTests: Number(summary.locTests) || 0, testFiles: Number(summary.tests) || 0, cycles, cronJobs: Number(s.cronJobs) || 0,
    preview: tools.filter((t) => t.status === 'preview').length, parked: tools.filter((t) => t.status === 'parked').length,
  };

  const build = (trimmed) => {
    const sec = [];
    const add = (id, title, body, data) => sec.push({ id, title, body: body.trim(), data });

    add('use', '0. How to use this', [
      `This describes an existing app called Vault as of ${date}, commit ${commit}. I am planning a new feature or app. Before suggesting designs: check what already exists and what can be reused, follow Vault's rules, keep to installed packages where possible, and ask me rather than assume when something isn't covered here.`,
      trimmed ? `\n_This briefing was shortened to fit: section 5 lists one line per tool and section 8 covers the last ${TRIMMED_CHANGELOG_DAYS} days._` : '',
      s.rulesStale?.length ? `\n_Note: the rules summary in section 3 may be out of date (${s.rulesStale.join(', ')} changed since it was written)._` : '',
    ].join(''));

    add('about', '1. About Vault', s.curated?.about || '');

    add('architecture', '2. Architecture and stack', [
      '- **Server:** Node.js + Express, raw SQL through `pg`, idempotent schema in `server/db.js` run on every boot.',
      '- **Client:** React 18 + Vite, Zustand, React Router v6, Tailwind for layout, theme colours from CSS variables.',
      '- **Database:** PostgreSQL 15 with pgvector (RAG embeddings).',
      '- **AI:** Anthropic Claude (primary) and Google Gemini; model ids come from Settings via `getModelsForUser()`, never hardcoded.',
      `- **Background work:** node-cron jobs (${num(counts.cronJobs)} cron files), \`withCronLock\` for side effects, background jobs and worker threads for long tasks.`,
      '- **Hosting and deploy:** Railway, push to `version-7`; dependencies live in a GHCR base image built by GitHub Actions, so normal deploys take 2-3 minutes.',
      `- **Size (Code Map run):** ${num(counts.tools)} tools (${counts.preview} preview, ${counts.parked} parked), ${num(counts.mounts)} API mounts in ${num(counts.routeFiles)} route files, ${num(counts.files)} source files, ${num(counts.linesServer)} server lines, ${num(counts.linesClient)} client lines, ${num(counts.testFiles)} test files (${num(counts.linesTests)} lines), ${counts.cycles} import cycles.`,
    ].join('\n'), counts);

    add('rules', '3. Rules every tool follows', s.curated?.rules || '');

    add('blocks', '4. Building blocks to reuse', `${s.curated?.buildingBlocks || ''}\n\n**Installed packages to reuse** (prefer these to adding new ones): ${packages.map((p) => `\`${p}\``).join(', ') || 'none listed'}.`, { packages });

    const toolBody = !tools.length ? 'No Code Map run yet.' : trimmed
      ? tools.map((t) => `- ${t.name} (${t.group || 'no group'}, ${t.status}): ${t.purpose}`).join('\n')
      : ['Preview tools are works in progress; parked tools are switched off; admin tools are only for admins.', '',
        '| Tool | Group | Status | Purpose | Lines | Tests | Score | Linked tools |', '|---|---|---|---|---|---|---|---|',
        ...tools.map((t) => `| ${cell(t.name, 80)} | ${cell(t.group, 60)} | ${t.status === 'preview' ? 'preview (work in progress)' : t.status} | ${cell(t.purpose, 200)} | ${num(t.lines)} | ${t.tests} | ${t.score ?? '–'} | ${cell(t.links.join(', '), 200) || '–'} |`)].join('\n');
    add('tools', '5. Existing tools', toolBody, { tools });

    add('services', '6. Outside services', !services.length ? 'None recorded.' : services.map((x) => `- **${x.service}:** ${x.configured ? 'YES' : 'NO'} — ${x.usedFor}`).join('\n'), { services });

    add('state', '7. Current state', [
      findings.length ? `**Top ${findings.length} Code Map findings:**\n${findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.title}${f.tools.length ? ` — ${f.tools.slice(0, 8).join(', ')}${f.tools.length > 8 ? ` and ${f.tools.length - 8} more` : ''}` : ''}`).join('\n')}` : 'No findings (or no Code Map run yet).',
      `\n**Import cycles:** ${cycles}.`,
      `**Hotspots:** ${hotspots.length ? hotspots.join(', ') : 'not available (the deployed server has no git history)'}.`,
      largest.length ? `**Largest files:** ${largest.map((l) => `\`${l.file}\` (${num(l.lines)})`).join(', ')}.` : '',
    ].filter(Boolean).join('\n'), { findings, cycles, hotspots, largest });

    const fromDay = since(trimmed ? TRIMMED_CHANGELOG_DAYS : 30);
    const recent = entries.filter((e) => e.date >= fromDay);
    const concerns = entries.filter((e) => e.concerns && !/^none noted\.?$/i.test(e.concerns)).slice(0, MAX_CONCERNS);
    add('direction', '8. Recent direction', [
      `**Changelog since ${fromDay}:**`,
      recent.length ? recent.map((e) => `- ${e.date} · ${e.area || 'General'} · ${e.subject}`).join('\n') : '- Nothing in that time.',
      '', '**Open concerns** (from changelog entries; newest first):',
      concerns.length ? concerns.map((e) => `- ${e.date} · ${e.subject}: ${e.concerns.length > MAX_CONCERN_CHARS ? `${e.concerns.slice(0, MAX_CONCERN_CHARS)}…` : e.concerns}`).join('\n') : '- None recorded.',
    ].join('\n'), { recent, concerns, fromDay });

    add('pattern', '9. Working pattern', pt
      ? `Ponytail (a Claude Code plugin that tracks each coding task) over the last 30 days: ${num(pt.tasks)} tasks, $${Number(pt.cost || 0).toFixed(2)} in all ($${(Number(pt.cost || 0) / Number(pt.tasks)).toFixed(2)} a task), average function reuse ${pt.avgReuse == null ? 'not measured' : `${Math.round(Number(pt.avgReuse))}%`}.`
      : 'No Ponytail data for the last 30 days.', pt ? { tasks: Number(pt.tasks), cost: Number(pt.cost || 0), avgReuse: pt.avgReuse == null ? null : Number(pt.avgReuse) } : null);

    add('notes', '10. Owner notes', notes || 'None.');

    add('handoff', '11. When we agree a design',
      'Write it as a brief for Claude Code with these sections: Decisions already made (table), Data model (SQL), API (routes, auth, limits), UI (page, views, Vault UI rules), Conventions checklist, Milestones (one Claude Code session each), Tests. Follow the rules in section 3.');

    // Last: the docs the owner left unticked, as a list (path, size, one sentence; never contents), so Claude can ask for them.
    if (s.docs) {
      const included = (s.docs.included || []).map((p) => clean(p, 120));
      const leftOut = (s.docs.leftOut || []).map((d) => ({ path: clean(d.path, 120), tokens: Number(d.tokens) || 0, summary: clean(d.summary, 160), note: d.note ? clean(d.note, 80) : null }));
      const lead = `This briefing holds no doc contents. CLAUDE.md${included.length ? ` and ${included.join(', ')}` : ''} may come as a separate paste.`;
      const body = notIncludedSection(leftOut, { lead }).replace(/^## [^\n]*\n\n/, '');
      add('docs', NOT_INCLUDED_TITLE, body, { included, leftOut });
    }

    const markdown = `<vault_briefing>\n# Vault briefing (${date})\n\n${sec.map((x) => `## ${x.title}\n\n${x.body}`).join('\n\n')}\n</vault_briefing>\n`;
    // The "Docs not included" list is outside the size limit: it is a short line per doc (about 3,000 tokens for ~90 docs), and letting it
    // count would trim the tool table, the part Claude needs most.
    const docsSec = sec.find((x) => x.id === 'docs');
    const docsChars = docsSec ? `## ${docsSec.title}\n\n${docsSec.body}\n\n`.length : 0;
    return { markdown, sections: sec, docsChars };
  };

  let out = build(false);
  let trimmed = false;
  if (out.markdown.length - out.docsChars > maxChars) { out = build(true); trimmed = true; }
  const counted = out.markdown.length - out.docsChars;
  return {
    markdown: out.markdown,
    sections: out.sections,
    stats: {
      chars: out.markdown.length, tokens: Math.ceil(out.markdown.length / 4), trimmed, overLimit: counted > maxChars,
      docsListChars: out.docsChars, date, commit,
    },
  };
}

module.exports = { buildBriefing, MAX_CHARS, statusOf };
