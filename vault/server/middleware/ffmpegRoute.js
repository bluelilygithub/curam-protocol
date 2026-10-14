'use strict';

const { getLogger } = require('./requestContext');
const { captureIf, makeFingerprint } = require('../services/SuggestionService');
const { checkFfmpeg } = require('../services/videoFfmpeg');
const { videoJobGate } = require('../services/videoJobGate');

/**
 * Wraps an ffmpeg-backed route handler (shared by Video Tools and Music): 503 when ffmpeg is
 * missing, a global concurrency gate (see videoJobGate.js — heavy encodes otherwise stack up
 * unbounded), uniform error logging, and a Suggestions-inbox alert when ffmpeg is killed by its
 * timeout.
 *
 * @param {string} name   route name for logs/alerts, e.g. 'clip'
 * @param {(req, res) => Promise<any>} handler
 * @param {{ errorStatus?: number, source?: string, routePrefix?: string }} [opts]
 */
/**
 * The useful part of an ffmpeg failure for a one-line log message: the last few non-empty stderr lines, trimmed.
 * (ffmpeg prints its banner and filter graph first and the actual complaint last.) Never sent to the browser.
 */
function stderrTail(err, maxChars = 300) {
  const raw = String(err?.stderr || '');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(-3).join(' | ');
  return tail.length > maxChars ? `…${tail.slice(-maxChars)}` : tail;
}

/**
 * What to tell the person about a failed video job, and with which HTTP status. Raw ffmpeg output (banner, filter graph dumps) is
 * never shown; a timeout and a busy server are explained; our own plain-worded errors (err.status 400 etc.) pass through.
 */
function describeVideoError(err, errorStatus = 500) {
  if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR') return { status: 499, message: 'Cancelled.', timedOut: false, cancelled: true };
  if (err?.code === 'VIDEO_BUSY') return { status: 503, message: err.message, timedOut: false };
  if (err?.killed || err?.signal === 'SIGTERM') {
    return { status: 504, message: 'That took too long to process — try a shorter or smaller file.', timedOut: true };
  }
  if (err?.stderr !== undefined) {
    return { status: errorStatus, message: 'ffmpeg could not process this file — check it is a valid, uncorrupted video/image/audio file.', timedOut: false };
  }
  return { status: err?.status || errorStatus, message: err?.message || 'Something went wrong.', timedOut: false };
}

function ffmpegRoute(name, handler, { errorStatus = 500, source = 'videoTools', routePrefix = 'videos' } = {}) {
  return async (req, res) => {
    try {
      const ffmpeg = await checkFfmpeg();
      if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available on this server' });
      return await videoJobGate.run(() => handler(req, res));
    } catch (err) {
      const why = stderrTail(err) || String(err?.message || '').slice(0, 200);
      getLogger().error({ err }, `[${routePrefix}/${name}] ${why}`);
      if (res.headersSent) return res.end();
      const described = describeVideoError(err, errorStatus);
      if (described.timedOut) {
        await captureIf(true, {
          userId: req.user?.id,
          source,
          category: 'alert',
          fingerprint: makeFingerprint(source, `ffmpeg-timeout:${name}`),
          title: `${source}: ${name} timed out`,
          body: 'An ffmpeg job was killed by its timeout. Raise VIDEO_FFMPEG_TIMEOUT_MS, lower the upload cap, or check the host CPU.',
          context: `server/routes/${routePrefix}.js /${name}`,
        }).catch(() => {});
      }
      return res.status(described.status).json({ error: described.message });
    }
  };
}

module.exports = { ffmpegRoute, stderrTail, describeVideoError };
