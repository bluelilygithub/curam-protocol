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
function ffmpegRoute(name, handler, { errorStatus = 500, source = 'videoTools', routePrefix = 'videos' } = {}) {
  return async (req, res) => {
    try {
      const ffmpeg = await checkFfmpeg();
      if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available on this server' });
      return await videoJobGate.run(() => handler(req, res));
    } catch (err) {
      getLogger().error({ err }, `[${routePrefix}/${name}]`);
      if (res.headersSent) return res.end();
      if (err.code === 'VIDEO_BUSY') return res.status(503).json({ error: err.message });
      if (err.killed || err.signal === 'SIGTERM') {
        await captureIf(true, {
          userId: req.user?.id,
          source,
          category: 'alert',
          fingerprint: makeFingerprint(source, `ffmpeg-timeout:${name}`),
          title: `${source}: ${name} timed out`,
          body: 'An ffmpeg job was killed by its timeout. Raise VIDEO_FFMPEG_TIMEOUT_MS, lower the upload cap, or check the host CPU.',
          context: `server/routes/${routePrefix}.js /${name}`,
        }).catch(() => {});
        return res.status(504).json({ error: 'That took too long to process — try a shorter or smaller file.' });
      }
      // execFile failures carry ffmpeg's raw stderr (banner, filter graph dumps) — never show that.
      if (err.stderr !== undefined) {
        return res.status(errorStatus).json({ error: 'ffmpeg could not process this file — check it is a valid, uncorrupted video/image/audio file.' });
      }
      return res.status(errorStatus).json({ error: err.message });
    }
  };
}

module.exports = { ffmpegRoute };
