'use strict';

// Geo-check runs as background jobs, on the PDF → HTML pattern (pdfToHtmlJobs.js): start answers at once with an id, the page polls,
// the run saves its progress and each capture as it goes.
//
//   one run at a time server-wide (each is a Chromium with proxy contexts; memory on Railway is not measured yet), so also one per person
//   inside a run, GEO_CHECK_CONTEXTS countries at once (default 2, at most 3); one shared browser for the run, closed at the end
//   a country that fails does not fail the run; only "every country failed" does
//   cap: 24 captures (countries x screens); at most 6 runs an hour per person; a cost guard before the start and a hard byte ceiling
//   during the run (GEO_PROXY_MAX_MB_PER_RUN, default 150), because proxy traffic is paid by the byte
//   pictures are attachments (entityType 'geo-capture'), so they count toward the person's 500 MB; at the limit the run stops
//   a restart marks a running run as stopped (server/db.js); delete goes to the recycle bin (adapter 'geo-check-run')
//
// Injectable (pool, captureCountry, launchBrowser, saveImage, ...) so tests need no browser or proxy. See docs/geo-check.md.

const { countryOf } = require('./countries');
const { diffRun, diffRuns, samePlace } = require('./diff');

const MAX_CAPTURES = 24;
const MAX_COUNTRIES = 12;
const MAX_SCREENS = 4;
const RUNS_PER_HOUR = 6;
const DEFAULT_BYTES_PER_COUNTRY = 4 * 1024 * 1024;

const err = (message, status) => Object.assign(new Error(message), { status });
const mb = (bytes) => Math.round(bytes / (1024 * 1024));

/** Checks and tidies the screens the page sends: [{ id, label, width, height, mobile }]. */
function cleanScreens(list) {
  const out = (Array.isArray(list) ? list : []).slice(0, MAX_SCREENS).map((s) => {
    const width = Math.round(Number(s && s.width));
    const height = Math.round(Number(s && s.height));
    if (!(width >= 320 && width <= 2560 && height >= 480 && height <= 1600)) throw err('A screen size is out of range (320-2560 wide, 480-1600 tall).', 400);
    const id = String((s && s.id) || `custom-${width}x${height}`).replace(/[^\w.-]/g, '').slice(0, 60) || `custom-${width}x${height}`;
    return { id, label: String((s && s.label) || id).slice(0, 80), width, height, mobile: !!(s && s.mobile) };
  });
  if (!out.length) throw err('Choose at least one screen.', 400);
  return out;
}

/** Checks the country codes: known, no repeats, 1-12. */
function cleanCountries(list) {
  const codes = [...new Set((Array.isArray(list) ? list : []).map((c) => String(c || '').toUpperCase()))];
  if (!codes.length) throw err('Choose at least one country.', 400);
  if (codes.length > MAX_COUNTRIES) throw err(`Choose at most ${MAX_COUNTRIES} countries.`, 400);
  const unknown = codes.filter((c) => !countryOf(c));
  if (unknown.length) throw err(`Not in the country list: ${unknown.join(', ')}.`, 400);
  return codes;
}

function createGeoJobs(deps = {}) {
  const env = deps.env || process.env;
  const d = {
    pool: deps.pool || (() => require('../../db').pool),
    captureCountry: deps.captureCountry || ((...a) => require('./capture').captureCountry(...a)),
    launchBrowser: deps.launchBrowser || (() => require('./capture').launchBrowser()),
    saveImage: deps.saveImage || (({ userId, runId, captureId, buffer, filename }) => require('../../utils/attachments').saveBufferAttachment({
      userId, entityType: 'geo-capture', entityId: captureId, folder: `geo-check-${runId}`, buffer, mime: 'image/jpeg', filename,
    })),
    isConfigured: deps.isConfigured || (() => require('./proxy').isConfigured()),
    captureIf: deps.captureIf || ((cond, p) => require('../SuggestionService').captureIf(cond, p)),
    makeFingerprint: deps.makeFingerprint || ((s, k) => require('../SuggestionService').makeFingerprint(s, k)),
    log: deps.log || ((...a) => { try { require('../../lib/logger').getLogger().error(...a); } catch { console.error(...a); } }),
  };
  const contexts = Math.min(3, Math.max(1, parseInt(env.GEO_CHECK_CONTEXTS, 10) || 2));
  const maxBytes = (Number(env.GEO_PROXY_MAX_MB_PER_RUN) > 0 ? Number(env.GEO_PROXY_MAX_MB_PER_RUN) : 150) * 1024 * 1024;
  const db = () => (typeof d.pool === 'function' ? d.pool() : d.pool);
  const q = (sql, params) => db().query(sql, params);
  const controllers = new Map(); // run id -> AbortController, for Stop

  /** Bytes one country usually costs this person (average of their last finished runs), for the estimate. */
  async function bytesPerCountry(userId) {
    const { rows } = await q(`SELECT COALESCE(SUM("bytesTotal"), 0) AS bytes, COALESCE(SUM(jsonb_array_length(settings->'countries')), 0) AS countries
                                FROM (SELECT "bytesTotal", settings FROM geo_check_runs WHERE "userId" = $1 AND status = 'done' AND "bytesTotal" > 0
                                      ORDER BY "createdAt" DESC LIMIT 5) recent`, [userId]);
    const countries = Number(rows[0].countries);
    return countries ? Math.round(Number(rows[0].bytes) / countries) : DEFAULT_BYTES_PER_COUNTRY;
  }

  /** What a run would download, before it starts. */
  async function estimate(userId, countryCount) {
    const perCountry = await bytesPerCountry(userId);
    return { bytes: perCountry * countryCount, perCountry, maxBytes };
  }

  /** Start a run. `url` is already normalised and checked with checkSsrf by the route. Returns the run id. */
  async function start(userId, { url, label, countries, screens, allowMedia }) {
    if (!d.isConfigured()) throw err('Geo-check is not set up: an admin adds the proxy details on Railway.', 503);
    const codes = cleanCountries(countries);
    const scr = cleanScreens(screens);
    const total = codes.length * scr.length;
    if (total > MAX_CAPTURES) throw err(`That is ${total} pictures; the most in one run is ${MAX_CAPTURES}. Choose fewer countries or screens.`, 400);
    const { rows: busy } = await q(`SELECT "userId" FROM geo_check_runs WHERE status = 'running' LIMIT 1`);
    if (busy[0]) throw err(busy[0].userId === userId ? 'A country check is already running. Wait for it to finish, or stop it.' : 'Someone else\'s country check is running. Try again in a few minutes.', 409);
    const { rows: [recent] } = await q(`SELECT COUNT(*) AS n FROM geo_check_runs WHERE "userId" = $1 AND "createdAt" > NOW() - INTERVAL '1 hour'`, [userId]);
    if (Number(recent.n) >= RUNS_PER_HOUR) throw err(`At most ${RUNS_PER_HOUR} country checks an hour. Try again later.`, 429);
    const est = await estimate(userId, codes.length);
    if (est.bytes > maxBytes) throw err(`This check would download about ${mb(est.bytes)} MB, more than the ${mb(maxBytes)} MB allowed in one run. Choose fewer countries.`, 400);

    const settings = { countries: codes, screens: scr, allowMedia: !!allowMedia, loadMode: 'resized' };
    const { rows } = await q(
      `INSERT INTO geo_check_runs ("userId", url, label, settings, status, stage, progress, "capturesTotal", "seenAt")
       VALUES ($1, $2, $3, $4, 'running', 'Starting', 1, $5, NULL) RETURNING id`,
      [userId, url, String(label || '').trim().slice(0, 120) || null, JSON.stringify(settings), total],
    );
    const id = rows[0].id;
    const ac = new AbortController();
    controllers.set(id, ac);
    setImmediate(() => run(userId, id, url, settings, ac).catch((e) => d.log({ err: e }, '[geoCheckJobs] run crashed')).finally(() => controllers.delete(id)));
    return id;
  }

  async function run(userId, id, url, settings, ac) {
    const queue = [...settings.countries];
    const failures = [];
    let mismatches = 0;
    let bytes = 0;
    let stopReason = null; // a plain sentence when the run had to stop early
    let browser = null;
    const stopWith = (reason) => { if (!stopReason) stopReason = reason; ac.abort(); };

    async function saveCountry(out) {
      bytes += out.bytes || 0;
      if (out.exitCountry && !out.verified) mismatches += 1;
      if (out.status === 'failed') failures.push(out.error || 'failed');
      for (const [i, screen] of settings.screens.entries()) {
        const shot = out.shots[i];
        if (!shot && out.status !== 'failed') continue; // stopped between screens: nothing to show for this one
        const facts = shot ? shot.facts : null;
        const { rows: [cap] } = await q(
          `INSERT INTO geo_check_captures ("runId", "userId", country, "deviceId", width, height, status, "exitCountry", verified, "httpStatus",
             "finalUrl", "htmlLang", title, extract, cut, bytes, error)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
          [id, userId, out.country, screen.id, screen.width, screen.height, shot ? out.status : 'failed', out.exitCountry, !!out.verified,
            out.httpStatus, out.finalUrl, facts && facts.htmlLang, facts && facts.title, facts ? JSON.stringify(facts) : null, !!(shot && shot.cut),
            i === 0 ? out.bytes || 0 : 0, shot ? null : (out.error || 'Not captured.')],
        );
        if (shot && shot.image) {
          try {
            const att = await d.saveImage({ userId, runId: id, captureId: cap.id, buffer: shot.image, filename: `${out.country}-${screen.id}.jpg` });
            await q(`UPDATE geo_check_captures SET "attachmentId" = $2 WHERE id = $1`, [cap.id, att.id]);
          } catch (e) {
            if (e.statusCode === 413) stopWith('Your file storage is full (the pictures count toward your attachment space). Delete old country checks or other attachments, then run it again.');
            else { d.log({ err: e }, '[geoCheckJobs] picture save'); await q(`UPDATE geo_check_captures SET error = 'The picture could not be saved.' WHERE id = $1`, [cap.id]); }
          }
        }
      }
      const done = settings.screens.length;
      await q(`UPDATE geo_check_runs SET "capturesDone" = "capturesDone" + $2, "bytesTotal" = "bytesTotal" + $3,
                 progress = LEAST(99, ROUND(100.0 * ("capturesDone" + $2) / GREATEST(1, "capturesTotal"))) WHERE id = $1`, [id, done, out.bytes || 0]);
      if (bytes > maxBytes) stopWith(`Stopped after ${mb(bytes)} MB, the most one run may download (${mb(maxBytes)} MB).`);
    }

    async function worker() {
      while (queue.length && !ac.signal.aborted) {
        const code = queue.shift();
        const n = settings.countries.length - queue.length;
        await q(`UPDATE geo_check_runs SET stage = $2 WHERE id = $1 AND status = 'running'`, [id, `Checking ${countryOf(code).name} (${n} of ${settings.countries.length})`]);
        let out;
        try {
          out = await d.captureCountry({ url, country: code, screens: settings.screens, allowMedia: settings.allowMedia }, { browser, signal: ac.signal });
        } catch (e) {
          out = { country: code, status: 'failed', exitCountry: null, verified: false, httpStatus: null, finalUrl: null, bytes: 0, shots: [], error: String(e.message || 'failed').slice(0, 300) };
        }
        await saveCountry(out);
      }
    }

    try {
      browser = await d.launchBrowser();
      await Promise.all(Array.from({ length: Math.min(contexts, queue.length) }, worker));
      const allFailed = failures.length === settings.countries.length;
      const stoppedByPerson = ac.signal.aborted && !stopReason;
      const status = stoppedByPerson || stopReason ? 'stopped' : (allFailed ? 'failed' : 'done');
      const message = stoppedByPerson ? 'Stopped.' : stopReason || (allFailed ? failures[0] : null);
      await q(`UPDATE geo_check_runs SET status = $2, stage = NULL, progress = 100, "errorMessage" = $3, "finishedAt" = NOW() WHERE id = $1`, [id, status, message]);
      // tell the owner when the proxy itself looks wrong, not just one site refusing
      const proxyTrouble = allFailed && failures.every((f) => /^The proxy/.test(f));
      await d.captureIf(proxyTrouble || mismatches * 2 >= settings.countries.length && mismatches > 0, {
        userId, source: 'geoCheck', category: 'alert',
        fingerprint: d.makeFingerprint('geoCheck', proxyTrouble ? `proxy-failing:${userId}` : `exit-mismatch:${userId}`),
        title: proxyTrouble ? 'Geo-check: the proxy is not answering' : 'Geo-check: the proxy often exits from the wrong country',
        body: proxyTrouble
          ? 'Every country in a check failed at the proxy. Check GEO_PROXY_SERVER, GEO_PROXY_USERNAME_TEMPLATE and GEO_PROXY_PASSWORD on Railway, and that the proxy account has traffic left.'
          : `${mismatches} of ${settings.countries.length} countries came out of a different country than asked. Check where the country goes in GEO_PROXY_USERNAME_TEMPLATE (the provider's country-targeting instructions).`,
      }).catch((e) => d.log({ err: e }, '[geoCheckJobs] suggestion'));
    } catch (e) {
      d.log({ err: e }, '[geoCheckJobs] run failed');
      await q(`UPDATE geo_check_runs SET status = 'failed', stage = NULL, "errorMessage" = $2, "finishedAt" = NOW() WHERE id = $1`,
        [id, 'The check could not run: the browser did not start on the server.']);
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  /** Stop a running run; captures already saved stay. */
  async function stop(userId, id) {
    const { rows } = await q(`SELECT status FROM geo_check_runs WHERE id = $1 AND "userId" = $2`, [id, userId]);
    if (!rows[0]) throw err('Not found.', 404);
    if (rows[0].status !== 'running') return false;
    const ac = controllers.get(Number(id));
    if (ac) ac.abort();
    else await q(`UPDATE geo_check_runs SET status = 'stopped', stage = NULL, "errorMessage" = 'Stopped.', "finishedAt" = NOW() WHERE id = $1`, [id]);
    return true;
  }

  /** The person's runs, newest first, without captures. */
  async function list(userId) {
    const { rows } = await q(`SELECT id, url, label, status, stage, progress, "capturesDone", "capturesTotal", "bytesTotal", "errorMessage",
                                     settings, "createdAt", "finishedAt", "seenAt"
                                FROM geo_check_runs WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 50`, [userId]);
    return rows.map((r) => ({ ...r, bytesTotal: Number(r.bytesTotal) }));
  }

  async function load(userId, id) {
    const { rows } = await q(`SELECT * FROM geo_check_runs WHERE id = $1 AND "userId" = $2`, [id, userId]);
    const r = rows[0];
    if (!r) throw err('That country check is no longer here.', 404);
    const { rows: caps } = await q(`SELECT id, country, "deviceId", width, height, status, "exitCountry", verified, "httpStatus", "finalUrl", "htmlLang",
                                           title, extract, cut, bytes, ("attachmentId" IS NOT NULL) AS "hasImage", error, "capturedAt"
                                      FROM geo_check_captures WHERE "runId" = $1 AND "userId" = $2 ORDER BY id`, [id, userId]);
    return { ...r, bytesTotal: Number(r.bytesTotal), captures: caps.map((c) => ({ ...c, bytes: Number(c.bytes) })) };
  }

  /** One run with its captures. Opening a finished run counts as seeing it (clears the needs-attention item). The across-countries
   *  diff is worked out the first time a finished run is opened and kept (runs ended by a restart get one too). */
  async function get(userId, id) {
    const r = await load(userId, id);
    if (r.status !== 'running' && !r.seenAt) await q(`UPDATE geo_check_runs SET "seenAt" = NOW() WHERE id = $1`, [id]).catch(() => {});
    if (r.status !== 'running' && !r.diff) {
      r.diff = diffRun(r, r.captures);
      await q(`UPDATE geo_check_runs SET diff = $2 WHERE id = $1`, [id, JSON.stringify(r.diff)]).catch((e) => d.log({ err: e }, '[geoCheckJobs] diff save'));
    }
    return r;
  }

  /** What changed between two finished checks of the same address, older first whichever way round they are given. */
  async function compare(userId, id, otherId) {
    const [x, y] = [await load(userId, id), await load(userId, otherId)];
    if (x.status === 'running' || y.status === 'running') throw err('Wait for the check to finish before comparing.', 409);
    if (samePlace(x.url) !== samePlace(y.url)) throw err('Only two checks of the same address can be compared.', 400);
    const [older, newer] = new Date(x.createdAt) <= new Date(y.createdAt) ? [x, y] : [y, x];
    const brief = (r) => ({ id: r.id, label: r.label, createdAt: r.createdAt });
    return { older: brief(older), newer: brief(newer), ...diffRuns(older, newer) };
  }

  /** The stored picture of one capture (owner-checked): { path } or 404. */
  async function imagePath(userId, runId, captureId) {
    const { rows } = await q(`SELECT a."storedPath" FROM geo_check_captures c JOIN attachments a ON a.id = c."attachmentId"
                                WHERE c.id = $1 AND c."runId" = $2 AND c."userId" = $3 AND a."userId" = $3`, [captureId, runId, userId]);
    if (!rows[0]) throw err('Picture not found.', 404);
    return rows[0].storedPath;
  }

  /** Delete a run: to the recycle bin with its captures, in one transaction. The pictures stay until the bin lets it go. */
  async function remove(userId, id, { moveToBin }) {
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`SELECT * FROM geo_check_runs WHERE id = $1 AND "userId" = $2 FOR UPDATE`, [id, userId]);
      const r = rows[0];
      if (!r) throw err('Not found.', 404);
      if (r.status === 'running') throw err('Stop the check before deleting it.', 409);
      const { rows: captures } = await client.query(`SELECT * FROM geo_check_captures WHERE "runId" = $1 AND "userId" = $2 ORDER BY id`, [id, userId]);
      const binId = await moveToBin(client, {
        userId, type: 'geo-check-run', id, title: r.label || r.url,
        detail: `${(r.settings.countries || []).length} countries, ${captures.length} pictures`, payload: { run: r, captures },
      });
      await client.query(`DELETE FROM geo_check_runs WHERE id = $1 AND "userId" = $2`, [id, userId]);
      await client.query('COMMIT');
      return binId;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  return { start, stop, list, get, compare, imagePath, remove, estimate, contexts, maxBytes };
}

module.exports = { createGeoJobs, cleanScreens, cleanCountries, MAX_CAPTURES, MAX_COUNTRIES, MAX_SCREENS, RUNS_PER_HOUR };
