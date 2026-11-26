'use strict';

// HTML Content Check: was a requested set of edits made to web pages? Mounted at /api/html-content-check behind requireAuth and
// requireFeature("htmlContentCheck"). Only the match route calls a model, and only it sits behind aiLimiter (reads and fetches do not
// count). Every query filters by "userId" and every id from the request is checked against its owner. Logs never carry page content or
// request text. A job holds one or more pages (content_check_pages, milestone 4b); a round reads them all, one row per page.
// See docs/html-content-check.md.

const zlib = require('zlib');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const bin = require('../services/recycleBin');
const { loadFeatureAccess } = require('../middleware/auth');
const { getLogger } = require('../middleware/requestContext');
const { splitRequest, findDuplicates } = require('../services/htmlContentCheck/splitRequest');
const { loadPage, readUpload, lessTextOf, DEFAULT_DEPS } = require('../services/htmlContentCheck/fetchPage');
const { MAX_UPLOAD_BYTES } = require('../services/htmlContentCheck/config');
const { ensureDiffs } = require('../services/htmlContentCheck/roundDiff');
const { matchRound, setByPerson, summarize } = require('../services/htmlContentCheck/match');
const { keepStatus } = require('../services/htmlContentCheck/keeps');
const { lineStatuses, scopedItems } = require('../services/htmlContentCheck/summary');
const { aiLimiter } = require('../middleware/aiRateLimit');

const router = express.Router();
let pageDeps = DEFAULT_DEPS; // tests swap the fetchers (no live site in automated tests)
let matchDeps = {}; // tests swap the model (no live model in automated tests)

// Fetching and rendering are slow and reach outside sites: their own modest limit, on the DocCompare fetch pattern. Reads are not counted.
const fetchLimit = rateLimit({
  windowMs: 10 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Too many pages fetched in a short time. Wait a few minutes and try again.' },
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => cb(/\.(html?|xhtml)$/i.test(file.originalname || '') ? null : Object.assign(new Error('Choose a saved web page (.html or .htm).'), { isPublic: true, status: 400 }), true),
});
const uploadOne = (req, res, next) => upload.single('file')(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `That file is bigger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` });
  return res.status(err.status || 400).json({ error: err.isPublic ? err.message : 'That file could not be read.' });
});

const KINDS = ['request', 'compare'];
const LINE_KINDS = ['request_line', 'held_over', 'keep'];
const STATUSES = ['open', 'with_client', 'closed'];
const FETCH_MODES = ['auto', 'plain', 'browser'];
const LIMITS = { name: 200, url: 2048, label: 200, section: 200, requestText: 50000, previousText: 200000, items: 200, lineText: 5000, settings: 20000, pages: 12 };
const BIN_MAX_BYTES = 25 * 1024 * 1024; // a job carries its rounds' snapshots; bigger than the bin's 5 MB default

const bad = (status, message) => Object.assign(new Error(message), { status, isPublic: true });
function fail(res, err, where) {
  if (err.isPublic) return res.status(err.status).json({ error: err.message });
  getLogger().error({ err }, `[html-content-check] ${where}`);
  return res.status(500).json({ error: 'Something went wrong with HTML Content Check. Try again.' });
}
const idOf = (v) => (/^\d{1,9}$/.test(String(v)) ? Number(v) : null);

function cleanUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) throw bad(400, 'Enter the page address.');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { throw bad(400, 'That does not look like a web address.'); }
  if (!/^https?:$/.test(u.protocol)) throw bad(400, 'Only http and https addresses can be checked.');
  if (u.href.length > LIMITS.url) throw bad(400, 'That address is too long.');
  return u.href;
}
function cleanText(raw, field, label, { required = false } = {}) {
  if (raw == null || raw === '') { if (required) throw bad(400, `${label} is empty.`); return null; }
  if (typeof raw !== 'string') throw bad(400, `${label} must be text.`);
  const s = raw.replace(/\r\n?/g, '\n').trim();
  if (!s) { if (required) throw bad(400, `${label} is empty.`); return null; }
  if (s.length > LIMITS[field]) throw bad(400, `${label} is too long (${LIMITS[field].toLocaleString('en-AU')} characters at most).`);
  return s;
}
const defaultName = (url) => { const u = new URL(url); return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`.slice(0, LIMITS.name); };
const fold = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

async function checkClient(db, userId, raw) {
  if (raw == null || raw === '') return null;
  const id = idOf(raw);
  if (!id) throw bad(400, 'Unknown client.');
  const { rows } = await db.query('SELECT id FROM clients WHERE id = $1 AND "userId" = $2', [id, userId]);
  if (!rows[0]) throw bad(404, 'That client is not in your CRM.');
  return id;
}
// Tickets are shared across the workspace by design (docs/tickets.md), so the check is "can this person use Tickets", not ownership.
async function checkTicket(db, user, raw) {
  if (raw == null || raw === '') return null;
  const id = idOf(raw);
  if (!id) throw bad(400, 'Unknown ticket.');
  if (!user.isAdmin && !(await loadFeatureAccess(user.id)).tickets) throw bad(403, 'Tickets is not switched on for you.');
  const { rows } = await db.query('SELECT id FROM tickets WHERE id = $1', [id]);
  if (!rows[0]) throw bad(404, 'That ticket does not exist.');
  return id;
}

async function inTx(fn) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const out = await fn(db);
    await db.query('COMMIT');
    return out;
  } catch (err) { await db.query('ROLLBACK').catch(() => {}); throw err; } finally { db.release(); }
}

async function ownJob(db, userId, rawId, { lock = false } = {}) {
  const id = idOf(rawId);
  if (!id) throw bad(404, 'Not found');
  const { rows } = await db.query(`SELECT * FROM content_check_jobs WHERE id = $1 AND "userId" = $2${lock ? ' FOR UPDATE' : ''}`, [id, userId]);
  if (!rows[0]) throw bad(404, 'Not found');
  return rows[0];
}
const pagesOf = (db, userId, jobId) => db.query('SELECT id, url, label, position, "fetchMode" FROM content_check_pages WHERE "jobId" = $1 AND "userId" = $2 ORDER BY position, id', [jobId, userId]).then((r) => r.rows);

async function jobDetail(db, userId, id) {
  const job = await ownJob(db, userId, id);
  await ensureDiffs(db, userId, job.id); // one small query when every round already has its changes
  const [pages, items, rounds, client, ticket, notes] = await Promise.all([
    pagesOf(db, userId, job.id),
    db.query('SELECT id, ref, kind, "lineText", source, position, "pageId", section FROM content_check_items WHERE "jobId" = $1 AND "userId" = $2 ORDER BY position, id', [job.id, userId]),
    db.query(`SELECT id, "pageId", number, "fetchedAt", "fetchedVia", "finalUrl", status, error,
                     snapshot->'meta'->>'title' AS title, (snapshot->'meta'->>'words')::int AS words, (snapshot->'meta'->>'chars')::int AS chars,
                     jsonb_array_length(COALESCE(snapshot->'blocks', '[]'::jsonb)) AS blocks,
                     results->'diff'->'vsPrevious'->'stats' AS "sincePrevious", COALESCE(results->'diff'->'vsBaseline', results->'diff'->'vsPrevious')->'stats' AS "sinceBaseline",
                     (results->'diff'->>'previousNumber')::int AS "previousNumber", results->'fetch' AS "fetchNote"
                FROM content_check_rounds WHERE "jobId" = $1 AND "userId" = $2 ORDER BY number, "pageId"`, [job.id, userId]),
    job.clientId ? db.query('SELECT name FROM clients WHERE id = $1 AND "userId" = $2', [job.clientId, userId]) : { rows: [] },
    job.ticketId ? db.query('SELECT title FROM tickets WHERE id = $1', [job.ticketId]) : { rows: [] },
    db.query(`SELECT COUNT(*) AS n FROM content_check_client_notes WHERE "jobId" = $1 AND "userId" = $2 AND status = 'open'`, [job.id, userId]),
  ]);
  // lines that look like a repeat of an earlier line, to merge on review
  const dupes = findDuplicates(items.rows.map((it) => it.lineText));
  const lines = items.rows.map((it, i) => (dupes[i] != null ? { ...it, likelyDuplicateOf: items.rows[dupes[i]].ref } : it));
  return {
    ...job, clientName: client.rows[0]?.name || null, ticketTitle: ticket.rows[0]?.title || null,
    pages, items: lines, rounds: rounds.rows, openNotes: Number(notes.rows[0].n),
  };
}

// ── Pages ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function cleanPages(raw, existing = new Map()) {
  if (!Array.isArray(raw) || !raw.length) throw bad(400, 'A job needs at least one page address.');
  if (raw.length > LIMITS.pages) throw bad(400, `A job can have ${LIMITS.pages} pages at most.`);
  const seenUrl = new Set();
  const seenId = new Set();
  return raw.map((p, i) => {
    const url = cleanUrl(p?.url);
    if (seenUrl.has(url)) throw bad(400, `The address of page ${i + 1} is already in this job.`);
    seenUrl.add(url);
    const label = cleanText(p?.label, 'label', `The name of page ${i + 1}`);
    const fetchMode = p?.fetchMode == null ? 'auto' : p.fetchMode;
    if (!FETCH_MODES.includes(fetchMode)) throw bad(400, 'Unknown way of loading the page.');
    if (p?.id == null) return { url, label, fetchMode };
    const id = idOf(p.id);
    if (!id || !existing.has(id) || seenId.has(id)) throw bad(400, 'One of the pages does not belong to this job.');
    seenId.add(id);
    return { id, url, label, fetchMode };
  });
}

// A line labelled "Under The Artist" goes on the page named "The Artist" (or whose name contains it, or is contained in it).
function pageForSection(section, pages) {
  const s = fold(String(section || '').split('›')[0]);
  if (!s) return null;
  const hit = pages.find((p) => p.label && fold(p.label) === s) || pages.find((p) => p.label && (fold(p.label).includes(s) || s.includes(fold(p.label))));
  return hit ? hit.id : null;
}

async function writePages(db, job, userId, list) {
  const { rows: existing } = await db.query('SELECT id, url FROM content_check_pages WHERE "jobId" = $1 AND "userId" = $2', [job.id, userId]);
  const keep = list.filter((p) => p.id).map((p) => p.id);
  // a page whose address was read keeps that address: its rounds would no longer match
  const { rows: read } = await db.query(`SELECT DISTINCT "pageId" FROM content_check_rounds WHERE "jobId" = $1 AND status = 'ready'`, [job.id]);
  const readIds = new Set(read.map((r) => r.pageId));
  for (const p of list) {
    const was = existing.find((e) => e.id === p.id);
    if (was && was.url !== p.url && readIds.has(p.id)) throw bad(409, `The address of "${p.label || was.url}" cannot change once the page has been read. Remove it and add the new address as another page.`);
  }
  await db.query('DELETE FROM content_check_pages WHERE "jobId" = $1 AND "userId" = $2 AND NOT (id = ANY($3::int[]))', [job.id, userId, keep]);
  for (const [position, p] of list.entries()) {
    if (p.id) await db.query('UPDATE content_check_pages SET url = $2, label = $3, position = $4, "fetchMode" = $5 WHERE id = $1', [p.id, p.url, p.label, position, p.fetchMode]);
    else await db.query('INSERT INTO content_check_pages ("jobId", "userId", url, label, position, "fetchMode") VALUES ($1, $2, $3, $4, $5, $6)', [job.id, userId, p.url, p.label, position, p.fetchMode]);
  }
  await db.query('UPDATE content_check_jobs SET url = $2, "updatedAt" = NOW() WHERE id = $1', [job.id, list[0].url]); // page 1, for the list
  // lines with no page whose "Under …" label now names a page go on that page
  const pages = await pagesOf(db, userId, job.id);
  const { rows: loose } = await db.query('SELECT id, section FROM content_check_items WHERE "jobId" = $1 AND "pageId" IS NULL AND section IS NOT NULL', [job.id]);
  for (const it of loose) { const pageId = pageForSection(it.section, pages); if (pageId) await db.query('UPDATE content_check_items SET "pageId" = $2 WHERE id = $1', [it.id, pageId]); }
}

// ── Request lines ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

// Writes the request lines. Before the first client report (refsLockedAt is null) refs follow the order: R1, R2, ... After it, a line
// keeps its ref, a new line gets the next number never issued, and a removed line's ref is never used again.
async function writeItems(db, job, userId, lines) {
  const { rows: existing } = await db.query('SELECT id, ref, source FROM content_check_items WHERE "jobId" = $1 AND "userId" = $2', [job.id, userId]);
  const byId = new Map(existing.map((r) => [r.id, r]));
  const keep = new Set(lines.filter((l) => l.id).map((l) => l.id));
  await db.query('DELETE FROM content_check_items WHERE "jobId" = $1 AND "userId" = $2 AND NOT (id = ANY($3::int[]))', [job.id, userId, [...keep]]);
  let counter = job.refsLockedAt ? job.refCounter : 0;
  // move kept refs out of the way first, so renumbering never trips the ("jobId", ref) unique key
  if (!job.refsLockedAt && keep.size) await db.query(`UPDATE content_check_items SET ref = '~' || id WHERE id = ANY($1::int[])`, [[...keep]]);
  for (const [position, l] of lines.entries()) {
    const kind = l.kind || 'request_line';
    if (l.id) {
      const ref = job.refsLockedAt ? byId.get(l.id).ref : `R${++counter}`;
      await db.query('UPDATE content_check_items SET ref = $2, "lineText" = $3, position = $4, kind = $5, "pageId" = $6, section = $7 WHERE id = $1',
        [l.id, ref, l.lineText, position, kind, l.pageId ?? null, l.section ?? null]);
    } else {
      await db.query('INSERT INTO content_check_items ("jobId", "userId", ref, "lineText", source, position, kind, "pageId", section) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [job.id, userId, `R${++counter}`, l.lineText, l.source || 'manual', position, kind, l.pageId ?? null, l.section ?? null]);
    }
  }
  await db.query('UPDATE content_check_jobs SET "refCounter" = GREATEST("refCounter", $2), "updatedAt" = NOW() WHERE id = $1', [job.id, counter]);
}

// The request split into lines (with their "Under …" labels and kinds), refused (never cut) when a line or the count is over the limit.
// A label that names one of the job's pages puts the line on that page.
function splitLines(text, pages) {
  const lines = splitRequest(text);
  if (lines.length > LIMITS.items) throw bad(400, `That request splits into ${lines.length} lines; ${LIMITS.items} is the most a job can have.`);
  const long = lines.findIndex((l) => l.lineText.length > LIMITS.lineText);
  if (long >= 0) throw bad(400, `Line ${long + 1} of the request is longer than ${LIMITS.lineText.toLocaleString('en-AU')} characters. Break it into smaller requests.`);
  return lines.map((l) => ({ ...l, section: l.section ? l.section.slice(0, LIMITS.section) : null, pageId: pageForSection(l.section, pages), source: 'request' }));
}

function cleanLines(rawItems, existingIds, pageIds) {
  if (!Array.isArray(rawItems)) throw bad(400, 'Send the list of request lines.');
  if (rawItems.length > LIMITS.items) throw bad(400, `A job can have ${LIMITS.items} request lines at most.`);
  const seen = new Set();
  return rawItems.map((it, i) => {
    const lineText = cleanText(it?.lineText, 'lineText', `Request line ${i + 1}`, { required: true });
    const kind = it?.kind == null ? 'request_line' : it.kind;
    if (!LINE_KINDS.includes(kind)) throw bad(400, `Request line ${i + 1} has an unknown kind.`);
    let pageId = null;
    if (it?.pageId != null && it.pageId !== '') {
      pageId = idOf(it.pageId);
      if (!pageId || !pageIds.has(pageId)) throw bad(400, `Request line ${i + 1} is on a page that is not in this job.`);
    }
    const section = cleanText(it?.section, 'section', `The label of request line ${i + 1}`);
    if (it?.id == null) return { lineText, kind, pageId, section };
    const id = idOf(it.id);
    if (!id || !existingIds.has(id) || seen.has(id)) throw bad(400, 'One of the request lines does not belong to this job.');
    seen.add(id);
    return { id, lineText, kind, pageId, section };
  });
}

// ── Rounds ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

// Reads one page for a round. Read every round the same way as that page's starting point where we can: a plain copy and a browser copy
// of the same page differ by themselves (share buttons, "Log in", lazy-loaded pictures), which would look like edits. So in auto mode, a
// starting point that needed the real browser makes that page's later rounds use it too.
async function readOne(job, page, buffer) {
  const { rows: base } = await pool.query(`SELECT "fetchedVia", (snapshot->'meta'->>'words')::int AS words FROM content_check_rounds
                                             WHERE "jobId" = $1 AND "pageId" = $2 AND status = 'ready' ORDER BY number LIMIT 1`, [job.id, page.id]);
  let mode = page.fetchMode || 'auto';
  if (!buffer && mode === 'auto' && base[0]?.fetchedVia === 'browser') mode = 'browser';
  const expectWords = base[0]?.words || 0;
  try {
    const got = buffer ? readUpload(buffer) : await loadPage(page.url, mode, pageDeps, { expectWords });
    const lessText = lessTextOf(got.snapshot, expectWords);
    const note = lessText || got.retried ? { ...(lessText ? { lessText } : {}), ...(got.retried ? { retriedInBrowser: true } : {}) } : null;
    return { pageId: page.id, got, note };
  } catch (err) {
    if (!err.isPublic) getLogger().error({ err, jobId: job.id, pageId: page.id }, '[html-content-check] round');
    return { pageId: page.id, failure: { message: err.isPublic ? err.message : 'The page could not be read. Try again, or upload a saved copy.', via: err.fetchedVia || (buffer ? 'upload' : mode === 'browser' ? 'browser' : 'plain') } };
  }
}

// One round: read every page (one after another; a real browser takes one page at a time anyway), outside any transaction, then store a
// row per page under one number. Numbers run 0, 1, 2 ...; a page's first good read is its starting point. A round where every page
// failed is replaced by the next attempt, so the numbers stay without gaps. An uploaded saved copy is for one page: it fills that page's
// place in the latest round when the page is missing or failed there, otherwise it starts a new round with that page only.
async function runRound(userId, job, { buffer, pageId } = {}) {
  const pages = await pagesOf(pool, userId, job.id);
  let targets = pages;
  if (buffer) {
    const page = pageId == null ? pages[0] : pages.find((p) => p.id === pageId);
    if (!page) throw bad(400, 'Choose which page this saved copy is.');
    targets = [page];
  }
  const reads = [];
  for (const page of targets) reads.push(await readOne(job, page, buffer));
  return inTx(async (db) => {
    await ownJob(db, userId, job.id, { lock: true });
    const { rows: lastRows } = await db.query(`SELECT number, "pageId", status FROM content_check_rounds WHERE "jobId" = $1
                                                 AND number = (SELECT MAX(number) FROM content_check_rounds WHERE "jobId" = $1)`, [job.id]);
    const last = lastRows[0]?.number;
    let number;
    if (last == null) number = 0;
    else if (buffer) {
      const there = lastRows.find((r) => r.pageId === targets[0].id);
      number = !there || there.status === 'failed' ? last : last + 1;
      if (there?.status === 'failed') await db.query('DELETE FROM content_check_rounds WHERE "jobId" = $1 AND number = $2 AND "pageId" = $3', [job.id, last, targets[0].id]);
    } else if (lastRows.every((r) => r.status === 'failed')) {
      number = last;
      await db.query('DELETE FROM content_check_rounds WHERE "jobId" = $1 AND number = $2', [job.id, last]);
    } else number = last + 1;
    for (const r of reads) {
      await db.query(`
        INSERT INTO content_check_rounds ("jobId", "userId", "pageId", number, "finalUrl", "fetchedVia", snapshot, "rawHtml", status, error, results)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [job.id, userId, r.pageId, number, r.got?.finalUrl || null, r.got ? r.got.fetchedVia : r.failure.via, r.got ? JSON.stringify(r.got.snapshot) : null,
        r.got ? zlib.gzipSync(r.got.html) : null, r.got ? 'ready' : 'failed', r.failure?.message || null, JSON.stringify(r.note ? { fetch: r.note } : {})]);
    }
    await ensureDiffs(db, userId, job.id, number); // what changed, kept with the round
    await db.query('UPDATE content_check_jobs SET "updatedAt" = NOW() WHERE id = $1', [job.id]);
    const { rows } = await db.query(`SELECT "pageId", status, error, "fetchedVia", "finalUrl", "fetchedAt", results->'fetch' AS "fetchNote"
                                       FROM content_check_rounds WHERE "jobId" = $1 AND number = $2 ORDER BY "pageId"`, [job.id, number]);
    return { number, pages: rows };
  });
}

// One round with every page's row (owner-checked; changes worked out if they were not yet), the job's pages and lines, and per line where
// it stands (summary.js). Snapshots are read here for the Keep checks but never sent back.
async function loadRound(userId, rawJobId, rawNumber) {
  const job = await ownJob(pool, userId, rawJobId);
  const n = idOf(rawNumber);
  if (n === null) throw bad(404, 'Not found');
  await ensureDiffs(pool, userId, job.id, n); // rounds kept before changes were worked out get theirs now
  const { rows } = await pool.query(`SELECT id, "pageId", number, "fetchedAt", "fetchedVia", "finalUrl", status, error, results
                                       FROM content_check_rounds WHERE "jobId" = $1 AND "userId" = $2 AND number = $3 ORDER BY "pageId"`, [job.id, userId, n]);
  if (!rows.length) throw bad(404, 'Not found');
  for (const r of rows) {
    const diff = r.results?.diff;
    if (diff && !diff.vsBaseline) diff.vsBaseline = diff.vsPrevious; // stored once when the round before is the starting point
  }
  const [pages, items] = await Promise.all([
    pagesOf(pool, userId, job.id),
    pool.query('SELECT id, ref, kind, "lineText", "pageId", section FROM content_check_items WHERE "jobId" = $1 AND "userId" = $2 ORDER BY position, id', [job.id, userId]).then((r) => r.rows),
  ]);
  return { job, number: n, rows, pages, items };
}

async function roundView(userId, loaded) {
  const { job, number, rows, pages, items } = loaded;
  const order = new Map(pages.map((p, i) => [p.id, i]));
  rows.sort((a, b) => (order.get(a.pageId) ?? 99) - (order.get(b.pageId) ?? 99));
  // request lines may have been edited since matching: each page's unasked changes follow the current lines
  for (const r of rows) {
    if (r.results?.matches && r.results?.diff) r.results.matches = summarize(r.results.matches, scopedItems(items, r.pageId), r.results.diff.vsBaseline.changes);
  }
  // Keep lines: the starting-point and current text of each page (read here only)
  let keepOf = () => ({ status: 'notRead', pageIds: [] });
  if (items.some((it) => it.kind === 'keep')) {
    const { rows: snaps } = await pool.query(`
      SELECT DISTINCT ON ("pageId") "pageId", snapshot FROM content_check_rounds
       WHERE "jobId" = $1 AND "userId" = $2 AND status = 'ready' ORDER BY "pageId", number`, [job.id, userId]);
    const { rows: now } = await pool.query(`SELECT "pageId", snapshot FROM content_check_rounds WHERE "jobId" = $1 AND "userId" = $2 AND number = $3 AND status = 'ready'`, [job.id, userId, number]);
    const inputs = pages.map((p) => ({ pageId: p.id, baseline: snaps.find((s) => s.pageId === p.id)?.snapshot || null, current: now.find((s) => s.pageId === p.id)?.snapshot || null }));
    keepOf = (it) => keepStatus(it.lineText, it.pageId, inputs);
  }
  const ready = rows.filter((r) => r.status === 'ready').map((r) => ({ pageId: r.pageId, matches: r.results?.matches || null }));
  return {
    number, fetchedAt: rows[0].fetchedAt,
    pages: rows.map((r) => {
      const page = pages.find((p) => p.id === r.pageId);
      return { ...r, label: page?.label || null, url: page?.url || null };
    }),
    lines: job.kind === 'request' ? lineStatuses(items, ready, keepOf) : [],
  };
}

const saveMatches = (db, userId, jobId, number, pageId, matches) => db.query(
  `UPDATE content_check_rounds SET results = COALESCE(results, '{}'::jsonb) || jsonb_build_object('matches', $5::jsonb)
    WHERE "jobId" = $1 AND "userId" = $2 AND number = $3 AND "pageId" = $4`, [jobId, userId, number, pageId, JSON.stringify(matches)]);

// ── Jobs ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

router.get('/jobs', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 200);
    const { rows } = await pool.query(`
      SELECT j.id, j.kind, j.name, j.url, j.status, j."createdAt", j."updatedAt",
             (SELECT COUNT(*) FROM content_check_items i WHERE i."jobId" = j.id) AS "itemCount",
             (SELECT COUNT(*) FROM content_check_pages p WHERE p."jobId" = j.id) AS "pageCount",
             (SELECT COUNT(DISTINCT r.number) FROM content_check_rounds r WHERE r."jobId" = j.id) AS "roundCount",
             (SELECT MAX(r."fetchedAt") FROM content_check_rounds r WHERE r."jobId" = j.id) AS "lastFetchedAt",
             (SELECT COUNT(*) FROM content_check_client_notes n WHERE n."jobId" = j.id AND n.status = 'open') AS "openNotes"
        FROM content_check_jobs j
       WHERE j."userId" = $1 AND ($2 = '' OR j.name ILIKE '%' || $2 || '%' OR j.url ILIKE '%' || $2 || '%'
             OR EXISTS (SELECT 1 FROM content_check_pages p WHERE p."jobId" = j.id AND (p.url ILIKE '%' || $2 || '%' OR p.label ILIKE '%' || $2 || '%')))
       ORDER BY j."updatedAt" DESC LIMIT 200`, [req.user.id, q.replace(/[\\%_]/g, (c) => `\\${c}`)]);
    res.json({ jobs: rows.map((r) => ({ ...r, itemCount: Number(r.itemCount), pageCount: Number(r.pageCount), roundCount: Number(r.roundCount), openNotes: Number(r.openNotes) })) });
  } catch (err) { fail(res, err, 'list'); }
});

// Creates the job with its pages (`pages: [{ url, label, fetchMode }]`, or one `url`), then reads round 0 (the starting point) unless
// `fetch: false` (the page then uploads a saved copy). A failed read still leaves the job, with that page's row stored as failed.
router.post('/jobs', fetchLimit, async (req, res) => {
  const b = req.body || {};
  try {
    const kind = b.kind == null ? 'request' : b.kind;
    if (!KINDS.includes(kind)) throw bad(400, 'Unknown kind of job.');
    const fetchMode = b.fetchMode == null ? 'auto' : b.fetchMode;
    if (!FETCH_MODES.includes(fetchMode)) throw bad(400, 'Unknown way of loading the page.');
    const pageList = cleanPages(Array.isArray(b.pages) ? b.pages.map((p) => ({ fetchMode, ...p })) : [{ url: b.url, fetchMode }]);
    const name = cleanText(b.name, 'name', 'The name') || defaultName(pageList[0].url);
    const requestText = kind === 'request' ? cleanText(b.requestText, 'requestText', 'The change request', { required: true }) : null;
    const previousText = cleanText(b.previousText, 'previousText', 'The previous text');
    const id = await inTx(async (db) => {
      const clientId = await checkClient(db, req.user.id, b.clientId);
      const ticketId = await checkTicket(db, req.user, b.ticketId);
      const { rows } = await db.query(`
        INSERT INTO content_check_jobs ("userId", kind, name, url, "requestText", "previousText", "clientId", "ticketId", "fetchMode")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [req.user.id, kind, name, pageList[0].url, requestText, previousText, clientId, ticketId, fetchMode]);
      await writePages(db, rows[0], req.user.id, pageList);
      const pages = await pagesOf(db, req.user.id, rows[0].id);
      await writeItems(db, rows[0], req.user.id, requestText ? splitLines(requestText, pages) : []);
      return rows[0].id;
    });
    if (b.fetch !== false) await runRound(req.user.id, await ownJob(pool, req.user.id, id));
    res.status(201).json(await jobDetail(pool, req.user.id, id));
  } catch (err) { fail(res, err, 'create'); }
});

router.get('/jobs/:id', async (req, res) => {
  try { res.json(await jobDetail(pool, req.user.id, req.params.id)); } catch (err) { fail(res, err, 'get'); }
});

router.patch('/jobs/:id', async (req, res) => {
  const b = req.body || {};
  try {
    await inTx(async (db) => {
      const job = await ownJob(db, req.user.id, req.params.id, { lock: true });
      const set = {};
      if ('name' in b) set.name = cleanText(b.name, 'name', 'The name', { required: true });
      if ('url' in b) { // page 1's address (older callers; the pages list is the way now)
        const pages = await pagesOf(db, req.user.id, job.id);
        await writePages(db, job, req.user.id, pages.map((p, i) => ({ ...p, url: i === 0 ? cleanUrl(b.url) : p.url })));
      }
      if ('requestText' in b) set.requestText = cleanText(b.requestText, 'requestText', 'The change request', { required: job.kind === 'request' });
      if ('previousText' in b) set.previousText = cleanText(b.previousText, 'previousText', 'The previous text');
      if ('clientId' in b) set.clientId = await checkClient(db, req.user.id, b.clientId);
      if ('ticketId' in b) set.ticketId = await checkTicket(db, req.user, b.ticketId);
      if ('status' in b) { if (!STATUSES.includes(b.status)) throw bad(400, 'Unknown status.'); set.status = b.status; }
      if ('fetchMode' in b) { if (!FETCH_MODES.includes(b.fetchMode)) throw bad(400, 'Unknown way of loading the page.'); set.fetchMode = b.fetchMode; }
      if ('settings' in b) {
        if (!b.settings || typeof b.settings !== 'object' || Array.isArray(b.settings)) throw bad(400, 'Settings must be an object.');
        if (JSON.stringify(b.settings).length > LIMITS.settings) throw bad(400, 'Those settings are too big.');
        set.settings = JSON.stringify(b.settings);
      }
      const cols = Object.keys(set);
      if (!cols.length) return;
      await db.query(`UPDATE content_check_jobs SET ${cols.map((c, i) => `"${c}" = $${i + 2}`).join(', ')}, "updatedAt" = NOW() WHERE id = $1`,
        [job.id, ...cols.map((c) => set[c])]);
    });
    res.json(await jobDetail(pool, req.user.id, req.params.id));
  } catch (err) { fail(res, err, 'update'); }
});

// Replace the pages list (add, rename, reorder, remove, reading method). A page that has been read keeps its address; removing a page
// removes its reads; its request lines stay, with no page.
router.put('/jobs/:id/pages', async (req, res) => {
  try {
    await inTx(async (db) => {
      const job = await ownJob(db, req.user.id, req.params.id, { lock: true });
      const existing = new Map((await pagesOf(db, req.user.id, job.id)).map((p) => [p.id, p]));
      await writePages(db, job, req.user.id, cleanPages(req.body?.pages, existing));
    });
    res.json(await jobDetail(pool, req.user.id, req.params.id));
  } catch (err) { fail(res, err, 'pages'); }
});

router.put('/jobs/:id/items', async (req, res) => {
  const b = req.body || {};
  try {
    await inTx(async (db) => {
      const job = await ownJob(db, req.user.id, req.params.id, { lock: true });
      if (job.kind !== 'request') throw bad(400, 'Only a change-request job has request lines.');
      const pages = await pagesOf(db, req.user.id, job.id);
      let lines;
      if (b.resplit === true) {
        if (job.refsLockedAt) throw bad(409, 'These request lines are on a client report, so their R numbers are fixed. Edit the lines instead of splitting the request again.');
        lines = splitLines(job.requestText, pages);
        await db.query('DELETE FROM content_check_items WHERE "jobId" = $1 AND "userId" = $2', [job.id, req.user.id]);
      } else {
        const { rows } = await db.query('SELECT id FROM content_check_items WHERE "jobId" = $1 AND "userId" = $2', [job.id, req.user.id]);
        lines = cleanLines(b.items, new Set(rows.map((r) => r.id)), new Set(pages.map((p) => p.id)));
      }
      await writeItems(db, job, req.user.id, lines);
    });
    res.json(await jobDetail(pool, req.user.id, req.params.id));
  } catch (err) { fail(res, err, 'items'); }
});

// ── Rounds ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

// Check again: read every page as its reading method says, or read an uploaded saved copy (field `file`) for one page (field `pageId`).
router.post('/jobs/:id/rounds', fetchLimit, uploadOne, async (req, res) => {
  try {
    const job = await ownJob(pool, req.user.id, req.params.id);
    const pageId = req.body?.pageId == null || req.body.pageId === '' ? null : idOf(req.body.pageId);
    if (req.body?.pageId && pageId == null) throw bad(400, 'Unknown page.');
    const round = await runRound(req.user.id, job, req.file ? { buffer: req.file.buffer, pageId } : {});
    res.status(201).json({ round, job: await jobDetail(pool, req.user.id, job.id) });
  } catch (err) { fail(res, err, 'round'); }
});

router.get('/jobs/:id/rounds/:number', async (req, res) => {
  try { res.json(await roundView(req.user.id, await loadRound(req.user.id, req.params.id, req.params.number))); } catch (err) { fail(res, err, 'get round'); }
});

// Match to request: per page, the AI labels which of that page's changes (since its starting point) look like they answer that page's
// lines and the lines with no page. The only route that calls a model, so the only one behind aiLimiter. Lines the person linked by
// hand are kept. A page with no changes, or no lines to match, is not sent.
router.post('/jobs/:id/rounds/:number/match', aiLimiter, async (req, res) => {
  try {
    const loaded = await loadRound(req.user.id, req.params.id, req.params.number);
    if (loaded.job.kind !== 'request') throw bad(400, 'A page comparison has no request to match.');
    const pagesToMatch = loaded.rows.filter((r) => r.status === 'ready' && r.results?.diff);
    if (!pagesToMatch.length) throw bad(400, 'Round 0 is the starting point: check the pages again after the edits, then match that round.');
    const usage = { pages: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
    for (const r of pagesToMatch) {
      const scope = scopedItems(loaded.items, r.pageId);
      const changes = r.results.diff.vsBaseline.changes;
      if (!scope.length || !changes.length) continue;
      let matches;
      try {
        matches = await matchRound(req.user.id, { items: scope, changes, previous: r.results.matches }, matchDeps);
      } catch (err) {
        if (err.cause) getLogger().error({ err: err.cause, jobId: loaded.job.id, pageId: r.pageId }, '[html-content-check] match model call');
        throw err;
      }
      await saveMatches(pool, req.user.id, loaded.job.id, loaded.number, r.pageId, matches);
      r.results.matches = matches;
      usage.pages++; usage.calls += matches.usage.calls; usage.inputTokens += matches.usage.inputTokens; usage.outputTokens += matches.usage.outputTokens;
    }
    getLogger().info({ jobId: loaded.job.id, round: loaded.number, ...usage }, '[html-content-check] matched');
    res.json({ ...(await roundView(req.user.id, loaded)), usage });
  } catch (err) { fail(res, err, 'match'); }
});

// Link or unlink by hand on one page: `changeIds` (that page's change ids) replaces the line's links there (by: 'person').
router.put('/jobs/:id/rounds/:number/pages/:pageId/matches/:ref', async (req, res) => {
  try {
    const loaded = await loadRound(req.user.id, req.params.id, req.params.number);
    if (loaded.job.kind !== 'request') throw bad(400, 'A page comparison has no request to match.');
    const r = loaded.rows.find((x) => x.pageId === idOf(req.params.pageId));
    if (!r) throw bad(404, 'That page was not read in this round.');
    if (r.status !== 'ready' || !r.results?.diff) throw bad(400, 'This page has nothing to link yet: it is the starting point, or it could not be read.');
    const scope = scopedItems(loaded.items, r.pageId);
    const matches = setByPerson(r.results.matches, scope, r.results.diff.vsBaseline.changes, String(req.params.ref), req.body?.changeIds);
    await saveMatches(pool, req.user.id, loaded.job.id, loaded.number, r.pageId, matches);
    r.results.matches = matches;
    res.json(await roundView(req.user.id, loaded));
  } catch (err) { fail(res, err, 'link'); }
});

router.delete('/jobs/:id', async (req, res) => {
  try {
    const binId = await inTx(async (db) => {
      const job = await ownJob(db, req.user.id, req.params.id, { lock: true });
      const q = (table, cols = '*') => db.query(`SELECT ${cols} FROM ${table} WHERE "jobId" = $1 AND "userId" = $2 ORDER BY id`, [job.id, req.user.id]).then((r) => r.rows);
      // the gzipped page ("rawHtml") and the worked-out changes stay out of the bin copy: the page is only for re-reading old rounds,
      // and the changes are worked out again on read with the same ids (so AI and hand links still fit); both would crowd the 25 MB limit
      const [pages, items, rounds, notes] = [await q('content_check_pages'), await q('content_check_items'),
        await q('content_check_rounds', `id, "jobId", "userId", "pageId", number, "fetchedAt", "finalUrl", "fetchedVia", snapshot, results - 'diff' AS results, status, error`),
        await q('content_check_client_notes')];
      let id;
      try {
        id = await bin.moveToBin(db, {
          userId: req.user.id, type: 'html-content-check-job', id: job.id, title: job.name,
          detail: `HTML Content Check: ${pages.length} page${pages.length === 1 ? '' : 's'}, ${job.kind === 'compare' ? 'page comparison' : `${items.length} request line${items.length === 1 ? '' : 's'}`}, ${new Set(rounds.map((r) => r.number)).size} round${new Set(rounds.map((r) => r.number)).size === 1 ? '' : 's'}`,
          payload: { job, pages, items, rounds, notes }, maxBytes: BIN_MAX_BYTES,
        });
      } catch (err) {
        if (err.code === 'TOO_LARGE') throw bad(413, 'This job is too big to keep in the recycle bin.');
        throw err;
      }
      await db.query('DELETE FROM content_check_jobs WHERE id = $1 AND "userId" = $2', [job.id, req.user.id]);
      return id;
    });
    res.json({ ok: true, binId, retentionDays: bin.RETENTION_DAYS });
  } catch (err) { fail(res, err, 'delete'); }
});

module.exports = router;
module.exports.LIMITS = LIMITS;
module.exports._setMatchDeps = (deps) => { matchDeps = deps || {}; }; // tests only
module.exports._setPageDeps = (deps) => { pageDeps = deps ? { ...DEFAULT_DEPS, ...deps } : DEFAULT_DEPS; }; // tests only
