'use strict';

// The docs that can go to Claude with CLAUDE.md (Code Map → Context, docs/code-map.md "Context"): which exist, how big each is, a
// one-sentence summary, which are ticked (the admin's saved choice, else DEFAULT_BRIEFING_DOCS), the copied block, and the
// "Docs not included in this copy" list that tells Claude what it was not given.
//
// Paths: only DEFAULT_BRIEFING_DOCS, EXTRA_BRIEFING_DOCS and docs/*.md are offered. A path is used only if it is relative, has no "..",
// no backslash and no drive or leading slash, and its real path (after symlinks) is a file inside the repo root (same rules as explain.js).

const fs = require('fs');
const path = require('path');
const { VAULT_ROOT, DEFAULT_BRIEFING_DOCS, EXTRA_BRIEFING_DOCS } = require('./sources');
const { purposeFrom, curatedPurposes } = require('./snapshot');

const SETTINGS_KEY = 'code_map_briefing_docs';
const DOC_NOTES = {
  'docs/finance.md': 'holds real business figures',
  // Mostly ffmpeg detail for single tools; the conventions it shows are already in CLAUDE.md, client/DESIGN.md and docs/guide-chat.md.
  'docs/video-tools.md': 'tick only for a media-heavy tool or one with background jobs',
};
const MAX_SUMMARY = 180;
const DOCS_NAME_RX = /^[A-Za-z0-9][\w.-]*\.md$/;
const NOT_INCLUDED_TITLE = 'Docs not included in this copy';
const NOT_INCLUDED_END = 'If the work needs any of these, ask me to include them next time.';

const tokensOf = (chars) => Math.ceil(chars / 4);

/** The real path of a repo-relative file, or null if the path is unsafe, missing, not a file, or resolves outside the repo. */
function safePath(rel, root = VAULT_ROOT) {
  const r = String(rel || '');
  if (!r || path.isAbsolute(r) || /^[A-Za-z]:/.test(r) || r.startsWith('/') || r.includes('\\') || r.split('/').some((p) => p === '..' || p === '')) return null;
  try {
    const realRoot = fs.realpathSync(root);
    const real = fs.realpathSync(path.join(root, r));
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
    return fs.statSync(real).isFile() ? real : null;
  } catch { return null; }
}

const readText = (real) => fs.readFileSync(real, 'utf8').replace(/\r\n?/g, '\n');

/** docs/<name>.md -> the tool it documents, from DOC_ALIAS or the kebab-case id (for its tool-purposes.md line). */
function docToolMap() {
  let alias = {};
  try { alias = require('../rules').DOC_ALIAS || {}; } catch { /* kebab names only */ }
  const out = {};
  for (const id of Object.keys(curatedPurposes())) {
    const name = Object.prototype.hasOwnProperty.call(alias, id) ? alias[id] : `${id.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}.md`;
    if (name) out[`docs/${name}`] = id;
  }
  return out;
}

// Docs that are not about one tool, where the first sentence is usually housekeeping ("Moved out of CLAUDE.md."): written by hand.
const DOC_SUMMARIES = {
  'client/DESIGN.md': 'The UI rules for client code: theme variables, layout and width, typography, spacing, hover and transitions, icons, shared components, z-index.',
  'docs/hardening.md': 'The checklist every new feature goes through: auth and ownership, limits, SSRF, cron locks, logging, recycle bin, tests.',
  'docs/guide-chat.md': 'How a tool\'s guide chat is built: one TutorChat component, the guides registry, catalogues kept in step with the page, tests.',
  'docs/core-conventions.md': 'The full text of the core conventions: auth, feature access, database, AI streaming, model selection, RAG, context, UI, suggestions.',
  'docs/deploy-speed.md': 'Why deploys take 2-3 minutes (a GHCR base image built by GitHub Actions) and what makes them slow; read before any build change.',
  'docs/env-vars.md': 'Every environment variable and what it is for.',
  'docs/features.md': 'What each larger feature does and its gotchas (Finance, Shares, Video Tools, PDF, Property Scenario and others).',
  'docs/key-files.md': 'Notes on every key file and tool: where the code lives and what to read before changing it.',
  'docs/schema-notes.md': 'Table and column quirks in the database schema.',
  'docs/changelog.md': 'How the admin Changelog works and the rules for writing an entry for every commit.',
  'docs/observability.md': 'Logging and request tracing: pino logger, request ids, what is logged and what never is.',
  'docs/recycle-bin.md': 'The shared 30-day recycle bin: moveToBin, restore adapters, and when a tool may skip it.',
  'BACKUP.md': 'Backup and restore: what the built-in Google Drive backup covers (it is partial), a full backup, rolling back a deploy, and emergency restore.',
  'planner-core/README.md': 'Code shared by Room Planner and Garden Planner (and speech and OCR for Vault\'s client), imported by alias rather than as a package.',
  'room-planner/README.md': 'The Room Planner app: a professional interior-design planner built as its own app and shown inside Vault.',
  'ROADMAP.md': 'The agreed plan and decisions for the Shares app, with its status.',
  // Docs whose first sentence is a status line, a date or a fragment (named by the owner's review, 2026-11-19, and found alongside them)
  'docs/crm-deals-schema.md': 'CRM phase 3 schema: deals, contact roles, activity and tasks on top of the clients tables, with what is built and the scoping decisions.',
  'docs/ponytail-report.md': 'The admin Ponytail report: what the Claude Code plugin sends per task, what Vault stores, the hashed key, the CSV backfill and the day-matching caveat.',
  'docs/gmail-routing-removed.md': 'A Gmail shop/deliveries routing feature that was added and removed on 2026-10-31, and why; nothing in Vault uses it.',
  'docs/brand-from-url.md': 'Reads a website\'s brand (colours, fonts, logo) from its address so the Graphics text tools, Batch, Pipeline and saved recipes can use it.',
  'docs/vault-shelf.md': 'Vault Shelf, a Windows clipboard companion that sends chosen clips into Vault (notes, Invoice Review, CRM, redaction checks): the Vault side and the app milestones.',
  'docs/email-follow-up-case-model.md': 'The locked case model (v1.0.1) for the commitments-ledger product behind Email Follow-Up: the rules and the assertions its fixtures must pass.',
  'docs/crm-migration.md': 'The merge of the CRM clients table and Finance\'s fin_clients into one canonical clients table, done with a bridge so no data was deleted.',
  'docs/email-follow-up-use-cases.md': 'Ten industries where the Email Follow-Up engine applies (extract an obligation, anchor it, compare, draft a cited nudge) and what differs in each.',
  'docs/email-follow-up-context.md': 'The context and decision record for Email Follow-Up: why it was designed as it was and which decisions the built version overrides.',
  'docs/email-follow-up-fixture-plan.md': 'The plan for turning the Email Follow-Up case model\'s 22 assertions into runnable fixtures (none executed yet).',
  'docs/email-follow-up-risk-register.md': 'Ten risks in the Email Follow-Up design, the mitigation kept, the one rejected and what each still fails to cover.',
  'docs/fitness-library-review.md': 'A review sheet for the 47 exercises in the Fitness library, generated from the seed file, for an experienced trainer to approve or change.',
  'docs/local-database-recovery.md': 'Old notes for a Mac Mini setup with a Docker PostgreSQL container; no longer used (local development now runs on Windows).',
  'docs/local-dev-windows.md': 'How to run Vault locally on the Windows machine: a private PostgreSQL cluster on port 15433 and npm run dev.',
  'docs/music-plan.md': 'A staged plan (not built yet) to give Music the same look as Video Tools and extend it with sound effects and voiceover.',
  'docs/project-naming.md': 'A decision record on the six different meanings of "project" in Vault and the wording chosen for each.',
  'docs/shares-statement-import.md': 'Uploading broker statements to Shares and reconciling them, narrowed to dividends after trade matching proved unreliable.',
  'docs/vault-shelf-release.md': 'The runbook for releasing and installing a new Vault Shelf version, step by step.',
  'docs/voice-notes.md': 'Recording voice notes in Notes: the recorder, what is kept (words by default, audio optional), the limits, and that it is not a legal record.',
  'docs/cross-user-test.md': 'The test that boots the real app and checks every route against one member reaching another member\'s data, and how to run it.',
};
// Sentences that say where a doc came from rather than what it covers.
const META = /\b(moved (out|here)|referenced from|can ignore|read this before|holds the short rules|started \d{4}|added \d{4}|renamed \d{4})\b|^(see|also)\b/i;

/** One sentence on what a doc covers: the written line above, its tool's line in tool-purposes.md, else its first real prose sentence, else its title. */
function summaryOf(rel, text, purposes = curatedPurposes(), toolOf = docToolMap()) {
  const id = toolOf[rel];
  let s = DOC_SUMMARIES[rel] || (id && purposes[id]) || '';
  if (!s) {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !/^(#|\||```|<|>|[-*]{3,}$)/.test(l)).slice(0, 15);
    for (const line of lines) {
      s = line.split(/(?<=[.!?])\s+(?=[A-Z"(])/).find((x) => !META.test(x) && purposeFrom(x)) || '';
      if (s) { s = purposeFrom(s); break; }
    }
  }
  if (!s) s = (/^#\s+(.+)$/m.exec(text)?.[1] || '').trim();
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > MAX_SUMMARY ? `${s.slice(0, MAX_SUMMARY - 1).replace(/\s+\S*$/, '')}…` : s;
}

/**
 * Every doc that can be offered, defaults first: [{ path, chars, tokens, summary, isDefault, linked, extra, note }], plus `missing`
 * (allow-listed or default paths that do not exist) and the CLAUDE.md text.
 */
function docCatalog(root = VAULT_ROOT) {
  const claudeReal = safePath('CLAUDE.md', root);
  const claude = claudeReal ? readText(claudeReal) : '';
  const linked = new Set([...claude.matchAll(/docs\/([A-Za-z0-9][\w.-]*\.md)/g)].map((m) => `docs/${m[1]}`));
  let docsDir = [];
  try { docsDir = fs.readdirSync(path.join(root, 'docs')).filter((f) => DOCS_NAME_RX.test(f)).sort().map((f) => `docs/${f}`); } catch { /* none */ }
  const wanted = [...new Set([...DEFAULT_BRIEFING_DOCS, ...EXTRA_BRIEFING_DOCS, ...docsDir])];
  const purposes = curatedPurposes();
  const toolOf = docToolMap();
  const docs = [];
  const missing = [];
  for (const rel of wanted) {
    const real = safePath(rel, root);
    if (!real) { if (DEFAULT_BRIEFING_DOCS.includes(rel) || EXTRA_BRIEFING_DOCS.includes(rel)) missing.push(rel); continue; }
    const text = readText(real);
    docs.push({
      path: rel, chars: text.length, tokens: tokensOf(text.length), summary: summaryOf(rel, text, purposes, toolOf),
      isDefault: DEFAULT_BRIEFING_DOCS.includes(rel), linked: linked.has(rel), extra: EXTRA_BRIEFING_DOCS.includes(rel), note: DOC_NOTES[rel] || null,
    });
  }
  // defaults first (in their listed order), then docs CLAUDE.md links to or that carry a note, then the extras, then the rest by name
  const rank = (d) => (d.isDefault ? 0 : d.linked || d.note ? 1 : d.extra ? 2 : 3);
  docs.sort((a, b) => rank(a) - rank(b) || (a.isDefault ? DEFAULT_BRIEFING_DOCS.indexOf(a.path) - DEFAULT_BRIEFING_DOCS.indexOf(b.path) : a.path.localeCompare(b.path)));
  return { claude, claudeChars: claude.length, docs, missing };
}

/** The ticked paths: the saved list (only paths still offered), else the defaults that exist. */
function resolveSelection(saved, catalog) {
  const offered = new Set(catalog.docs.map((d) => d.path));
  if (!Array.isArray(saved)) return DEFAULT_BRIEFING_DOCS.filter((p) => offered.has(p));
  return [...new Set(saved.map(String))].filter((p) => offered.has(p));
}

/** "## Docs not included in this copy": path, ~tokens and one sentence per unticked doc. A list only: never a doc's contents. */
function notIncludedSection(leftOut, { lead = '' } = {}) {
  const lines = leftOut.map((d) => `- ${d.path} (~${d.tokens.toLocaleString('en-AU')} tokens)${d.note ? ` [${d.note}]` : ''}${d.summary ? ` — ${d.summary}` : ''}`);
  return [`## ${NOT_INCLUDED_TITLE}`, '', ...(lead ? [lead, ''] : []), ...(lines.length ? lines : ['- None: every doc on offer is included.']), '', NOT_INCLUDED_END].join('\n');
}

/** CLAUDE.md, then each ticked doc under "## File: <path>", then the not-included list. */
function copyBlock(selection, catalog, root = VAULT_ROOT) {
  const ticked = new Set(selection);
  const parts = [`## File: CLAUDE.md\n\n${catalog.claude.trim()}`];
  for (const d of catalog.docs) {
    if (!ticked.has(d.path)) continue;
    const real = safePath(d.path, root);
    if (real) parts.push(`## File: ${d.path}\n\n${readText(real).trim()}`);
  }
  parts.push(notIncludedSection(catalog.docs.filter((d) => !ticked.has(d.path))));
  const text = `${parts.join('\n\n')}\n`;
  return { text, chars: text.length, tokens: tokensOf(text.length), included: catalog.docs.filter((d) => ticked.has(d.path)).map((d) => d.path) };
}

module.exports = {
  SETTINGS_KEY, NOT_INCLUDED_TITLE, NOT_INCLUDED_END, DOC_NOTES,
  safePath, docCatalog, resolveSelection, notIncludedSection, copyBlock, summaryOf, tokensOf,
};
