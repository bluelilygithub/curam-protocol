'use strict';

// HTML Content Check: was a requested set of edits made to a web page? Mounted at /api/html-content-check behind requireAuth and
// requireFeature("htmlContentCheck"). Only the match route calls a model, and only it sits behind aiLimiter (reads and fetches do not count). Every query filters by "userId"
// and every id from the request is checked against its owner. Logs never carry page content or request text. See docs/html-content-check.md.

const zlib = require('zlib');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const bin = require('../services/recycleBin');
const { loadFeatureAccess } = require('../middleware/auth');
const { getLogger } = require('../middleware/requestContext');
const { splitRequest } = require('../services/htmlContentCheck/splitRequest');
const { loadPage, readUpload, lessTextOf, DEFAULT_DEPS } = require('../services/htmlContentCheck/fetchPage');
const { MAX_UPLOAD_BYTES } = require('../services/htmlContentCheck/config');
const { ensureDiffs } = require('../services/htmlContentCheck/roundDiff');
const { matchRound, setByPerson, summarize } = require('../services/htmlContentCheck/match');
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
const STATUSES = ['open', 'with_client', 'closed'];
const FETCH_MODES = ['auto', 'plain', 'browser'];
const LIMITS = { name: 200, url: 2048, requestText: 50000, previousText: 200000, items: 200, lineText: 5000, settings: 20000 };
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

async function jobDetail(db, userId, id) {
  const job = await ownJob(db, userId, id);
  await ensureDiffs(db, userId, job.id); // one small query when every round already has its changes
  const [items, rounds, client, ticket, notes] = await Promise.all([
    db.query('SELECT id, ref, kind, "lineText", source, position FROM content_check_items WHERE "jobId" = $1 AND "userId" = $2 ORDER BY position, id', [job.id, userId]),
    db.query(`SELECT id, number, "fetchedAt", "fetchedVia", "finalUrl", status, error,
                     snapshot->'meta'->>'title' AS title, (snapshot->'meta'->>'words')::int AS words, (snapshot->'meta'->>'chars')::int AS chars,
                     jsonb_array_length(COALESCE(snapshot->'blocks', '[]'::jsonb)) AS blocks,
                     results->'diff'->'vsPrevious'->'stats' AS "sincePrevious", COALESCE(results->'diff'->'vsBaseline', results->'diff'->'vsPrevious')->'stats' AS "sinceBaseline",
                     (results->'diff'->>'previousNumber')::int AS "previousNumber", results->'fetch' AS "fetchNote"
                FROM content_check_rounds WHERE "jobId" = $1 AND "userId" = $2 ORDER BY number`, [job.id, userId]),
    job.clientId ? db.query('SELECT name FROM clients WHERE id = $1 AND "userId" = $2', [job.clientId, userId]) : { rows: [] },
    job.ticketId ? db.query('SELECT title FROM tickets WHERE id = $1', [job.ticketId]) : { rows: [] },
    db.query(`SELECT COUNT(*) AS n FROM content_check_client_notes WHERE "jobId" = $1 AND "userId" = $2 AND status = 'open'`, [job.id, userId]),
  ]);
  return {
    ...job, clientName: client.rows[0]?.name || null, ticketTitle: ticket.rows[0]?.title || null,
    items: items.rows, rounds: rounds.rows, openNotes: Number(notes.rows[0].n),
  };
}

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
    if (l.id) {
      const ref = job.refsLockedAt ? byId.get(l.id).ref : `R${++counter}`;
      await db.query('UPDATE content_check_items SET ref = $2, "lineText" = $3, position = $4 WHERE id = $1', [l.id, ref, l.lineText, position]);
    } else {
      await db.query('INSERT INTO content_check_items ("jobId", "userId", ref, "lineText", source, position) VALUES ($1, $2, $3, $4, $5, $6)',
        [job.id, userId, `R${++counter}`, l.lineText, l.source || 'manual', position]);
    }
  }
  await db.query('UPDATE content_check_jobs SET "refCounter" = GREATEST("refCounter", $2), "updatedAt" = NOW() WHERE id = $1', [job.id, counter]);
}

// The request split into lines, refused (never cut) when a line or the count is over the limit.
function splitLines(text) {
  const lines = splitRequest(text);
  if (lines.length > LIMITS.items) throw bad(400, `That request splits into ${lines.length} lines; ${LIMITS.items} is the most a job can have.`);
  const long = lines.findIndex((l) => l.length > LIMITS.lineText);
  if (long >= 0) throw bad(400, `Line ${long + 1} of the request is longer than ${LIMITS.lineText.toLocaleString('en-AU')} characters. Break it into smaller requests.`);
  return lines.map((lineText) => ({ lineText, source: 'request' }));
}

function cleanLines(rawItems, existingIds) {
  if (!Array.isArray(rawItems)) throw bad(400, 'Send the list of request lines.');
  if (rawItems.length > LIMITS.items) throw bad(400, `A job can have ${LIMITS.items} request lines at most.`);
  const seen = new Set();
  return rawItems.map((it, i) => {
    const lineText = cleanText(it?.lineText, 'lineText', `Request line ${i + 1}`, { required: true });
    if (it?.id == null) return { lineText };
    const id = idOf(it.id);
    if (!id || !existingIds.has(id) || seen.has(id)) throw bad(400, 'One of the request lines does not belong to this job.');
    seen.add(id);
    return { id, lineText };
  });
}

// One round: fetch (or read the upload) first, outside any transaction, then store it. Numbers run 0, 1, 2 ...; round 0 is the baseline.
// A failed round is stored with its error, and the next attempt replaces it (same number), so the numbers stay without gaps.
async function runRound(userId, job, { buffer } = {}) {
  let page = null;
  let failure = null;
  // Read every round the same way as the starting point where we can: a plain copy and a browser copy of the same page differ by
  // themselves (share buttons, "Log in", lazy-loaded pictures), which would look like edits. So in auto mode, a starting point that
  // needed the real browser makes later rounds use it too.
  let mode = job.fetchMode;
  const { rows: base } = await pool.query(`SELECT "fetchedVia", (snapshot->'meta'->>'words')::int AS words FROM content_check_rounds
                                             WHERE "jobId" = $1 AND status = 'ready' ORDER BY number LIMIT 1`, [job.id]);
  if (!buffer && mode === 'auto' && base[0]?.fetchedVia === 'browser') mode = 'browser';
  const expectWords = base[0]?.words || 0;
  let fetchNote = null; // results.fetch: far less text than the starting point (a rebuilt site?), and whether the browser was tried
  try {
    page = buffer ? readUpload(buffer) : await loadPage(job.url, mode, pageDeps, { expectWords });
    const lessText = lessTextOf(page.snapshot, expectWords);
    if (lessText || page.retried) fetchNote = { ...(lessText ? { lessText } : {}), ...(page.retried ? { retriedInBrowser: true } : {}) };
  } catch (err) {
    if (!err.isPublic) getLogger().error({ err, jobId: job.id }, '[html-content-check] round');
    failure = { message: err.isPublic ? err.message : 'The page could not be read. Try again, or upload a saved copy.', via: err.fetchedVia || (buffer ? 'upload' : mode === 'browser' ? 'browser' : 'plain') };
  }
  return inTx(async (db) => {
    await ownJob(db, userId, job.id, { lock: true });
    const { rows } = await db.query('SELECT number, status FROM content_check_rounds WHERE "jobId" = $1 ORDER BY number DESC LIMIT 1', [job.id]);
    const last = rows[0];
    const number = !last ? 0 : last.status === 'failed' ? last.number : last.number + 1;
    if (last?.status === 'failed') await db.query('DELETE FROM content_check_rounds WHERE "jobId" = $1 AND number = $2', [job.id, last.number]);
    const { rows: made } = await db.query(`
      INSERT INTO content_check_rounds ("jobId", "userId", number, "finalUrl", "fetchedVia", snapshot, "rawHtml", status, error, results)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, number, status, error, "fetchedVia", "finalUrl", "fetchedAt", results->'fetch' AS "fetchNote"`,
    [job.id, userId, number, page?.finalUrl || null, page ? page.fetchedVia : failure.via, page ? JSON.stringify(page.snapshot) : null,
      page ? zlib.gzipSync(page.html) : null, page ? 'ready' : 'failed', failure?.message || null, JSON.stringify(fetchNote ? { fetch: fetchNote } : {})]);
    if (made[0].status === 'ready') await ensureDiffs(db, userId, job.id, number); // what changed, kept with the round
    await db.query('UPDATE content_check_jobs SET "updatedAt" = NOW() WHERE id = $1', [job.id]);
    return made[0];
  });
}

// ── Jobs ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

router.get('/jobs', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 200);
    const { rows } = await pool.query(`
      SELECT j.id, j.kind, j.name, j.url, j.status, j."createdAt", j."updatedAt",
             (SELECT COUNT(*) FROM content_check_items i WHERE i."jobId" = j.id) AS "itemCount",
             (SELECT COUNT(*) FROM content_check_rounds r WHERE r."jobId" = j.id) AS "roundCount",
             (SELECT MAX(r."fetchedAt") FROM content_check_rounds r WHERE r."jobId" = j.id) AS "lastFetchedAt",
             (SELECT COUNT(*) FROM content_check_client_notes n WHERE n."jobId" = j.id AND n.status = 'open') AS "openNotes"
        FROM content_check_jobs j
       WHERE j."userId" = $1 AND ($2 = '' OR j.name ILIKE '%' || $2 || '%' OR j.url ILIKE '%' || $2 || '%')
       ORDER BY j."updatedAt" DESC LIMIT 200`, [req.user.id, q.replace(/[\\%_]/g, (c) => `\\${c}`)]);
    res.json({ jobs: rows.map((r) => ({ ...r, itemCount: Number(r.itemCount), roundCount: Number(r.roundCount), openNotes: Number(r.openNotes) })) });
  } catch (err) { fail(res, err, 'list'); }
});

// Creates the job, then fetches round 0 (the baseline) unless `fetch: false` (the page then uploads a saved copy as round 0). A failed
// fetch still leaves the job, with round 0 stored as failed and its reason, so the person can try again or upload a copy.
router.post('/jobs', fetchLimit, async (req, res) => {
  const b = req.body || {};
  try {
    const kind = b.kind == null ? 'request' : b.kind;
    if (!KINDS.includes(kind)) throw bad(400, 'Unknown kind of job.');
    const url = cleanUrl(b.url);
    const name = cleanText(b.name, 'name', 'The name') || defaultName(url);
    const requestText = kind === 'request' ? cleanText(b.requestText, 'requestText', 'The change request', { required: true }) : null;
    const previousText = cleanText(b.previousText, 'previousText', 'The previous text');
    const fetchMode = b.fetchMode == null ? 'auto' : b.fetchMode;
    if (!FETCH_MODES.includes(fetchMode)) throw bad(400, 'Unknown way of loading the page.');
    const lines = requestText ? splitLines(requestText) : [];
    const id = await inTx(async (db) => {
      const clientId = await checkClient(db, req.user.id, b.clientId);
      const ticketId = await checkTicket(db, req.user, b.ticketId);
      const { rows } = await db.query(`
        INSERT INTO content_check_jobs ("userId", kind, name, url, "requestText", "previousText", "clientId", "ticketId", "fetchMode")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [req.user.id, kind, name, url, requestText, previousText, clientId, ticketId, fetchMode]);
      await writeItems(db, rows[0], req.user.id, lines);
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
      if ('url' in b) {
        set.url = cleanUrl(b.url);
        const { rows } = await db.query('SELECT 1 FROM content_check_rounds WHERE "jobId" = $1 LIMIT 1', [job.id]);
        if (rows[0] && set.url !== job.url) throw bad(409, 'The page address cannot change once the page has been fetched. Start a new job for another address.');
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

router.put('/jobs/:id/items', async (req, res) => {
  const b = req.body || {};
  try {
    await inTx(async (db) => {
      const job = await ownJob(db, req.user.id, req.params.id, { lock: true });
      if (job.kind !== 'request') throw bad(400, 'Only a change-request job has request lines.');
      let lines;
      if (b.resplit === true) {
        if (job.refsLockedAt) throw bad(409, 'These request lines are on a client report, so their R numbers are fixed. Edit the lines instead of splitting the request again.');
        lines = splitLines(job.requestText);
        await db.query('DELETE FROM content_check_items WHERE "jobId" = $1 AND "userId" = $2', [job.id, req.user.id]);
      } else {
        const { rows } = await db.query('SELECT id FROM content_check_items WHERE "jobId" = $1 AND "userId" = $2', [job.id, req.user.id]);
        lines = cleanLines(b.items, new Set(rows.map((r) => r.id)));
      }
      await writeItems(db, job, req.user.id, lines);
    });
    res.json(await jobDetail(pool, req.user.id, req.params.id));
  } catch (err) { fail(res, err, 'items'); }
});

// ── Rounds ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

// Check again: fetch the page as the job says (plain, real browser, or plain then browser), or read an uploaded saved copy (field `file`).
router.post('/jobs/:id/rounds', fetchLimit, uploadOne, async (req, res) => {
  try {
    const job = await ownJob(pool, req.user.id, req.params.id);
    const round = await runRound(req.user.id, job, req.file ? { buffer: req.file.buffer } : {});
    res.status(201).json({ round, job: await jobDetail(pool, req.user.id, job.id) });
  } catch (err) { fail(res, err, 'round'); }
});

// One round (owner-checked), with its changes worked out if they were not yet, and the job's current request lines.
async function loadRound(userId, rawJobId, rawNumber) {
  const job = await ownJob(pool, userId, rawJobId);
  const n = idOf(rawNumber);
  if (n === null) throw bad(404, 'Not found');
  await ensureDiffs(pool, userId, job.id, n); // rounds kept before changes were worked out get theirs now
  const { rows } = await pool.query(`SELECT id, number, "fetchedAt", "fetchedVia", "finalUrl", status, error, snapshot, results
                                       FROM content_check_rounds WHERE "jobId" = $1 AND "userId" = $2 AND number = $3`, [job.id, userId, n]);
  if (!rows[0]) throw bad(404, 'Not found');
  const diff = rows[0].results?.diff;
  if (diff && !diff.vsBaseline) diff.vsBaseline = diff.vsPrevious; // stored once when the round before is the starting point
  const items = (await pool.query('SELECT id, ref, "lineText" FROM content_check_items WHERE "jobId" = $1 AND "userId" = $2 ORDER BY position, id', [job.id, userId])).rows;
  return { job, round: rows[0], items };
}
const matchable = ({ job, round }) => {
  if (job.kind !== 'request') throw bad(400, 'A page comparison has no request to match.');
  if (round.status !== 'ready' || !round.results?.diff) throw bad(400, 'Round 0 is the starting point: check the page again after the edits, then match that round.');
  return round.results.diff.vsBaseline.changes;
};
const saveMatches = (userId, jobId, number, matches) => pool.query(
  `UPDATE content_check_rounds SET results = COALESCE(results, '{}'::jsonb) || jsonb_build_object('matches', $4::jsonb)
    WHERE "jobId" = $1 AND "userId" = $2 AND number = $3`, [jobId, userId, number, JSON.stringify(matches)]);

router.get('/jobs/:id/rounds/:number', async (req, res) => {
  try {
    const { round, items } = await loadRound(req.user.id, req.params.id, req.params.number);
    // request lines may have been edited since matching: the lines with no change and the unasked changes follow the current lines
    if (round.results?.matches && round.results?.diff) round.results.matches = summarize(round.results.matches, items, round.results.diff.vsBaseline.changes);
    res.json(round);
  } catch (err) { fail(res, err, 'get round'); }
});

// Match to request: the AI labels which changes (since the starting point) look like they answer which request line. The only route
// that calls a model, so the only one behind aiLimiter. Lines the person linked by hand are kept.
router.post('/jobs/:id/rounds/:number/match', aiLimiter, async (req, res) => {
  try {
    const loaded = await loadRound(req.user.id, req.params.id, req.params.number);
    const changes = matchable(loaded);
    let matches;
    try {
      matches = await matchRound(req.user.id, { items: loaded.items, changes, previous: loaded.round.results.matches }, matchDeps);
    } catch (err) {
      if (err.cause) getLogger().error({ err: err.cause, jobId: loaded.job.id }, '[html-content-check] match model call');
      throw err;
    }
    await saveMatches(req.user.id, loaded.job.id, loaded.round.number, matches);
    getLogger().info({ jobId: loaded.job.id, round: loaded.round.number, ...matches.usage }, '[html-content-check] matched');
    res.json({ matches });
  } catch (err) { fail(res, err, 'match'); }
});

// Link or unlink by hand: `changeIds` replaces that request line's links (by: 'person').
router.put('/jobs/:id/rounds/:number/matches/:ref', async (req, res) => {
  try {
    const loaded = await loadRound(req.user.id, req.params.id, req.params.number);
    const changes = matchable(loaded);
    const matches = setByPerson(loaded.round.results.matches, loaded.items, changes, String(req.params.ref), req.body?.changeIds);
    await saveMatches(req.user.id, loaded.job.id, loaded.round.number, matches);
    res.json({ matches });
  } catch (err) { fail(res, err, 'link'); }
});

router.delete('/jobs/:id', async (req, res) => {
  try {
    const binId = await inTx(async (db) => {
      const job = await ownJob(db, req.user.id, req.params.id, { lock: true });
      const q = (table, cols = '*') => db.query(`SELECT ${cols} FROM ${table} WHERE "jobId" = $1 AND "userId" = $2 ORDER BY id`, [job.id, req.user.id]).then((r) => r.rows);
      // the gzipped page ("rawHtml") and the worked-out changes stay out of the bin copy: the page is only for re-reading old rounds,
      // and the changes are worked out again on read with the same ids (so AI and hand links still fit); both would crowd the 25 MB limit
      const [items, rounds, notes] = [await q('content_check_items'),
        await q('content_check_rounds', `id, "jobId", "userId", number, "fetchedAt", "finalUrl", "fetchedVia", snapshot, results - 'diff' AS results, status, error`),
        await q('content_check_client_notes')];
      let id;
      try {
        id = await bin.moveToBin(db, {
          userId: req.user.id, type: 'html-content-check-job', id: job.id, title: job.name,
          detail: `HTML Content Check: ${job.kind === 'compare' ? 'page comparison' : `${items.length} request line${items.length === 1 ? '' : 's'}`}, ${rounds.length} round${rounds.length === 1 ? '' : 's'}`,
          payload: { job, items, rounds, notes }, maxBytes: BIN_MAX_BYTES,
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
