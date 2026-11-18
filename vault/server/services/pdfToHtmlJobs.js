'use strict';

// PDF → HTML as a background job. A good model (Sonnet) takes minutes to write a long page, longer than the hosting gateway keeps a web
// request open (about five minutes), and the owner wants to leave the page while it works. So the page starts a job (answered at once with
// an id) and checks on it; the job itself runs here and saves its progress, the page as it grows, and the result in pdf_html_jobs.
//
//   one row per web page: the first conversion fills it; each change request runs on the same row and keeps the old version for Undo
//   one running job per person; a job can be stopped; a restart marks a running job as stopped (server/db.js); rows go after 7 days
//   progress: fixed steps while preparing, then the share of the expected length written so far (capped at 95% until it finishes)
//
// Injectable (pool, createHtml, reviseHtml) so tests need no database or model.

const MAX_HISTORY = 20;
const SAVE_EVERY_MS = 1500;
const STAGE_PROGRESS = {
  'Preparing the page pictures': 3,
  'Pulling out the pictures': 8,
  'The AI is reading the page': 12,
  'The AI is reading the page and your request': 12,
};
const WRITING_FROM = 12;
const WRITING_TO = 95;

const controllers = new Map(); // job id -> AbortController, for Stop

const parse = (v, fallback) => { if (v == null) return fallback; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return fallback; } };

/** How long the finished HTML is likely to be (characters), for the progress bar. Only an estimate: the bar never claims 100% early. */
function expectedChars({ slices = 1, images = 0, currentHtml = '' } = {}) {
  if (currentHtml) return Math.max(8000, currentHtml.length);
  return Math.min(110000, Math.max(12000, slices * 7000 + images * 200));
}

const writingProgress = (chars, expected) => Math.min(WRITING_TO, Math.round(WRITING_FROM + (WRITING_TO - WRITING_FROM) * Math.min(1, chars / Math.max(1, expected))));

/** The model's text so far, from where the HTML starts (drops any "Here is the page:" before it), for the growing preview. */
function partialFrom(text) {
  const s = String(text || '');
  const at = s.search(/<!doctype html|<html[\s>]/i);
  return at === -1 ? '' : s.slice(at).replace(/```\s*$/, '');
}

function createJobs(deps = {}) {
  const d = {
    pool: deps.pool || (() => require('../db').pool),
    createHtml: deps.createHtml || ((...a) => require('./pdfToHtml').createHtml(...a)),
    reviseHtml: deps.reviseHtml || ((...a) => require('./pdfToHtml').reviseHtml(...a)),
    log: deps.log || ((...a) => { try { require('../lib/logger').getLogger().error(...a); } catch { console.error(...a); } }),
    now: deps.now || (() => Date.now()),
  };
  const db = () => (typeof d.pool === 'function' ? d.pool() : d.pool);
  const q = (sql, params) => db().query(sql, params);

  async function hasRunning(userId) {
    const { rows } = await q(`SELECT id FROM pdf_html_jobs WHERE "userId" = $1 AND status = 'running' LIMIT 1`, [userId]);
    return rows[0]?.id || null;
  }

  // Saves progress at most every SAVE_EVERY_MS while the model writes; the last save always goes through.
  function progressSaver(id, expected) {
    let text = '';
    let last = 0;
    let pending = null;
    const save = () => q(`UPDATE pdf_html_jobs SET stage = 'The AI is writing the page', progress = $2, "charsWritten" = $3, "partialHtml" = $4, "updatedAt" = NOW() WHERE id = $1 AND status = 'running'`,
      [id, writingProgress(text.length, expected), text.length, partialFrom(text)]).catch((err) => d.log({ err }, '[pdfToHtmlJobs] progress save'));
    return {
      onText(delta) {
        text += delta;
        const t = d.now();
        if (t - last >= SAVE_EVERY_MS) { last = t; pending = save(); }
      },
      async flush() { if (pending) await pending; },
    };
  }

  const stageSaver = (id) => (name) => q(`UPDATE pdf_html_jobs SET stage = $2, progress = GREATEST(progress, $3), "updatedAt" = NOW() WHERE id = $1 AND status = 'running'`,
    [id, name, STAGE_PROGRESS[name] || 0]).catch((err) => d.log({ err }, '[pdfToHtmlJobs] stage save'));

  async function fail(id, err, keepHtml) {
    const cancelled = err && err.cancelled;
    await q(`UPDATE pdf_html_jobs SET status = $2, "errorMessage" = $3, stage = NULL, "partialHtml" = NULL, "finishedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`,
      [id, cancelled ? (keepHtml ? 'done' : 'cancelled') : (keepHtml ? 'done' : 'failed'), cancelled ? 'Stopped.' : String((err && err.message) || 'Something went wrong.').slice(0, 1000)]);
  }

  /** Start a first conversion. `input` is what createHtml takes plus `originals` (whole-page pictures for "Show original"). Returns the job id. */
  async function startCreate(userId, input) {
    if (await hasRunning(userId)) throw Object.assign(new Error('A web page is already being made. Wait for it to finish, or stop it.'), { status: 409 });
    const { rows } = await q(
      `INSERT INTO pdf_html_jobs ("userId", filename, kind, status, stage, progress, "pageImagesJson", "originalsJson", "seenAt")
       VALUES ($1, $2, 'create', 'running', 'Starting', 1, $3, $4, NULL) RETURNING id`,
      [userId, String(input.title || '').slice(0, 200), JSON.stringify(input.pageImages || []), JSON.stringify((input.originals || []).slice(0, 5))],
    );
    const id = rows[0].id;
    const ac = new AbortController();
    controllers.set(id, ac);
    setImmediate(() => runCreate(userId, id, input, ac).catch((err) => d.log({ err }, '[pdfToHtmlJobs] create crashed')).finally(() => controllers.delete(id)));
    return id;
  }

  async function runCreate(userId, id, input, ac) {
    let saver = null;
    try {
      const out = await d.createHtml(userId, input, {
        signal: ac.signal,
        onStage: stageSaver(id),
        onModel: (model) => q('UPDATE pdf_html_jobs SET model = $2 WHERE id = $1', [id, model]).catch(() => {}),
        onImages: async (images, slices) => {
          saver = progressSaver(id, expectedChars({ slices: slices.length, images: images.filter((im) => !im.aiSkip).length }));
          await q(`UPDATE pdf_html_jobs SET "imagesJson" = $2, "slicesJson" = $3 WHERE id = $1`, [id, JSON.stringify(images), JSON.stringify(slices)]);
        },
        onText: (delta) => saver && saver.onText(delta),
      });
      if (saver) await saver.flush();
      await q(`UPDATE pdf_html_jobs SET status = 'done', stage = NULL, progress = 100, html = $2, "partialHtml" = NULL, model = $3, skipped = $4,
                 "imagesJson" = $5, "slicesJson" = $6, "errorMessage" = NULL, "finishedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`,
      [id, out.html, out.model, out.skipped || 0, JSON.stringify(out.images), JSON.stringify(out.slices || [])]);
    } catch (err) {
      if (saver) await saver.flush();
      if (!err.status || err.status >= 500) d.log({ err }, '[pdfToHtmlJobs] create failed');
      await fail(id, err, false);
    }
  }

  /** Run a change request on an existing web page (same row). */
  async function startRevise(userId, id, instruction) {
    const { rows } = await q(`SELECT id, status, html, "imagesJson", "pageImagesJson" FROM pdf_html_jobs WHERE id = $1 AND "userId" = $2`, [id, userId]);
    const job = rows[0];
    if (!job) throw Object.assign(new Error('That web page is no longer here (pages are kept for 7 days).'), { status: 404 });
    if (await hasRunning(userId)) throw Object.assign(new Error('A web page is already being made or changed. Wait for it to finish, or stop it.'), { status: 409 });
    if (!job.html) throw Object.assign(new Error('There is no web page to change yet.'), { status: 400 });
    const ask = String(instruction || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
    if (!ask) throw Object.assign(new Error('Say what to change.'), { status: 400 });
    await q(`UPDATE pdf_html_jobs SET status = 'running', kind = 'revise', instruction = $2, stage = 'Starting', progress = 1, "charsWritten" = 0, "seenAt" = NULL,
               "partialHtml" = NULL, "errorMessage" = NULL, "finishedAt" = NULL, "updatedAt" = NOW() WHERE id = $1`, [id, ask]);
    const ac = new AbortController();
    controllers.set(id, ac);
    const images = parse(job.imagesJson, []).map(({ name, width, height, aiSkip }) => ({ name, width, height, aiSkip }));
    setImmediate(() => runRevise(userId, id, { html: job.html, instruction: ask, images, pageImages: parse(job.pageImagesJson, []) }, ac)
      .catch((err) => d.log({ err }, '[pdfToHtmlJobs] revise crashed')).finally(() => controllers.delete(id)));
  }

  async function runRevise(userId, id, input, ac) {
    const saver = progressSaver(id, expectedChars({ currentHtml: input.html }));
    try {
      const out = await d.reviseHtml(userId, input, {
        signal: ac.signal, onStage: stageSaver(id), onText: (delta) => saver.onText(delta),
        onModel: (model) => q('UPDATE pdf_html_jobs SET model = $2 WHERE id = $1', [id, model]).catch(() => {}),
      });
      await saver.flush();
      // the version before the change goes onto the undo list (newest last, at most MAX_HISTORY)
      await q(`UPDATE pdf_html_jobs SET status = 'done', stage = NULL, progress = 100, "partialHtml" = NULL, model = $3, "errorMessage" = NULL,
                 "historyJson" = (SELECT COALESCE(jsonb_agg(v ORDER BY n), '[]'::jsonb) FROM (
                     SELECT v, n FROM jsonb_array_elements("historyJson" || to_jsonb(html::text)) WITH ORDINALITY AS h(v, n)
                     ORDER BY n DESC LIMIT ${MAX_HISTORY}) last),
                 html = $2, "finishedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`, [id, out.html, out.model]);
    } catch (err) {
      await saver.flush();
      if (!err.status || err.status >= 500) d.log({ err }, '[pdfToHtmlJobs] revise failed');
      await fail(id, err, true);
    }
  }

  /** Stop a running job. The page keeps its previous version (a change request) or ends as stopped (a first conversion). */
  async function cancel(userId, id) {
    const { rows } = await q(`SELECT id, status FROM pdf_html_jobs WHERE id = $1 AND "userId" = $2`, [id, userId]);
    if (!rows[0]) throw Object.assign(new Error('Not found.'), { status: 404 });
    if (rows[0].status !== 'running') return false;
    const ac = controllers.get(Number(id));
    if (ac) ac.abort();
    else await fail(Number(id), { cancelled: true }, false); // its process is gone (restart): just mark it
    return true;
  }

  /** The person's recent web pages, newest first, without the big parts. */
  async function list(userId) {
    const { rows } = await q(`SELECT id, filename, kind, status, stage, progress, model, "errorMessage", "createdAt", "updatedAt", "finishedAt", "seenAt"
                                FROM pdf_html_jobs WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 10`, [userId]);
    return rows;
  }

  /** One web page. `light`: only what a progress check needs (status, progress, the page as it grows). */
  async function get(userId, id, { light = false } = {}) {
    const cols = light
      ? `id, status, kind, stage, progress, "charsWritten", "partialHtml", model, "errorMessage", ("imagesJson" IS NOT NULL) AS "imagesReady", "updatedAt"`
      : `id, filename, kind, status, stage, progress, "charsWritten", "partialHtml", html, "historyJson", "imagesJson", "pageImagesJson", "originalsJson",
         "slicesJson", instruction, model, skipped, "errorMessage", "createdAt", "updatedAt", "finishedAt"`;
    const { rows } = await q(`SELECT ${cols} FROM pdf_html_jobs WHERE id = $1 AND "userId" = $2`, [id, userId]);
    const r = rows[0];
    if (!r) throw Object.assign(new Error('That web page is no longer here (pages are kept for 7 days).'), { status: 404 });
    if (light) return r;
    // opening a finished page counts as seeing it (clears the needs-attention item; the toast is not shown again)
    if (r.status !== 'running') await q(`UPDATE pdf_html_jobs SET "seenAt" = NOW() WHERE id = $1 AND "seenAt" IS NULL AND status <> 'running'`, [id]).catch(() => {});
    return {
      ...r,
      historyJson: undefined, imagesJson: undefined, pageImagesJson: undefined, originalsJson: undefined, slicesJson: undefined,
      history: parse(r.historyJson, []), images: parse(r.imagesJson, []), pageImages: parse(r.pageImagesJson, []),
      originals: parse(r.originalsJson, []), slices: parse(r.slicesJson, []),
    };
  }

  /** Save hand edits from the Code view, or an Undo (the page sends the html and the undo list as they now are). */
  async function saveHtml(userId, id, html, history, maxLen) {
    const page = String(html || '');
    if (!page.trim()) throw Object.assign(new Error('The web page cannot be empty.'), { status: 400 });
    if (page.length > maxLen) throw Object.assign(new Error('This web page is too large to save.'), { status: 400 });
    const hist = (Array.isArray(history) ? history : []).map((h) => String(h || '')).filter((h) => h && h.length <= maxLen).slice(-MAX_HISTORY);
    const { rowCount } = await q(`UPDATE pdf_html_jobs SET html = $3, "historyJson" = $4, "updatedAt" = NOW() WHERE id = $1 AND "userId" = $2 AND status <> 'running' AND html IS NOT NULL`,
      [id, userId, page, JSON.stringify(hist)]);
    if (!rowCount) throw Object.assign(new Error('That web page cannot be saved right now (it is being changed, or it is gone).'), { status: 409 });
  }

  /** For the app-wide watcher: is anything running, and which finished pages have not been opened yet (newest first). */
  async function alerts(userId) {
    const { rows } = await q(`SELECT id, filename, kind, status, "errorMessage", "finishedAt" FROM pdf_html_jobs
                                WHERE "userId" = $1 AND (status = 'running' OR ("seenAt" IS NULL AND status IN ('done', 'failed')))
                                ORDER BY "updatedAt" DESC LIMIT 10`, [userId]);
    return { running: rows.filter((r) => r.status === 'running').length, finished: rows.filter((r) => r.status !== 'running') };
  }

  return { startCreate, startRevise, cancel, list, get, saveHtml, alerts };
}

module.exports = { createJobs, expectedChars, writingProgress, partialFrom, MAX_HISTORY, ...createJobs() };
