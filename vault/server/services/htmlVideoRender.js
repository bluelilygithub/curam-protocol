'use strict';

// Renders a small HTML page that holds paused animations (the browser's own Web Animations) into an MP4: headless Chromium moves the
// animations to each frame's moment, takes a picture, and the pictures are piped into ffmpeg. The same page gives the same video.
// Idea taken from HyperFrames (heygen-com/hyperframes, Apache 2.0); this is a small renderer of our own, with no extra package.
//
// The page must define `window.seek(ms)`, which moves every animation to that time. A browser is started for each render and closed
// at the end, so nothing stays in memory between jobs (about 650 MB at 1080p, 215 MB at 720p while it runs, measured 8 Nov 2026).
//
// Safety: the page is built by the server from escaped text, and every request the page makes is refused except its own inline
// content (data: pictures and fonts), so it cannot reach the network.

const { spawn } = require('child_process');
const { FFMPEG } = require('./videoFfmpeg');

const FPS = 30;
const ENCODE_ARGS = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart'];

class RenderCancelled extends Error {
  constructor() { super('Cancelled.'); this.cancelled = true; }
}

function frameTimes(seconds, fps = FPS) {
  const n = Math.max(1, Math.round(seconds * fps));
  return Array.from({ length: n }, (_, i) => (i / fps) * 1000);
}

/**
 * @param {{ html: string, width: number, height: number, seconds: number, outPath: string, signal?: AbortSignal, log?: (m: string) => void,
 *           loadChromium?: () => object, ffmpegPath?: string }} o
 * @returns {Promise<{ frames: number }>}
 */
async function renderHtmlToMp4({ html, width, height, seconds, outPath, signal, log = () => {}, loadChromium = () => require('playwright').chromium, ffmpegPath = FFMPEG }) {
  if (signal?.aborted) throw new RenderCancelled();
  const times = frameTimes(seconds);
  let browser = null;
  let ff = null;
  let stderr = '';
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    try { if (ff) ff.kill('SIGKILL'); } catch { /* already gone */ }
    if (browser) browser.close().catch(() => {});
  };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    browser = await loadChromium().launch({ headless: true, args: ['--disable-dev-shm-usage', '--block-new-web-contents'] });
    if (aborted) throw new RenderCancelled();
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.route('**/*', (route) => {
      const url = route.request().url();
      return url.startsWith('data:') || url === 'about:blank' ? route.continue() : route.abort();
    });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => (document.fonts && document.fonts.ready) || null); // the brand font is in place before the first picture
    if (aborted) throw new RenderCancelled();

    const isLinux = process.platform === 'linux';
    const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', ...ENCODE_ARGS, outPath];
    ff = isLinux ? spawn('nice', ['-n', '10', ffmpegPath, ...args], { stdio: ['pipe', 'ignore', 'pipe'] }) : spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    ff.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    const closed = new Promise((resolve, reject) => {
      ff.on('error', reject);
      ff.on('close', resolve);
    });
    ff.stdin.on('error', () => {}); // a broken pipe is reported through the exit code below

    const started = Date.now();
    for (let i = 0; i < times.length; i += 1) {
      if (aborted) throw new RenderCancelled();
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate((ms) => window.seek(ms), times[i]);
      // eslint-disable-next-line no-await-in-loop
      const shot = await page.screenshot({ type: 'jpeg', quality: 92 });
      if (!ff.stdin.write(shot)) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => ff.stdin.once('drain', resolve));
      }
    }
    ff.stdin.end();
    const code = await closed;
    if (aborted) throw new RenderCancelled();
    if (code !== 0) {
      const err = new Error('ffmpeg could not build the video');
      err.stderr = stderr;
      throw err;
    }
    log(`rendered ${times.length} frames at ${width}x${height} in ${Math.round((Date.now() - started) / 1000)}s`);
    return { frames: times.length };
  } catch (err) {
    if (aborted) throw new RenderCancelled();
    throw err;
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
    try { if (ff && ff.exitCode === null) ff.kill('SIGKILL'); } catch { /* already gone */ }
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Draws a page once for each state and saves a see-through PNG of it: `window.show(...state)` is called in the page for each entry of
 * `states` (an array of argument arrays), then the page is photographed with a transparent background. Used for captions, where the
 * picture only changes when a word changes (a few hundred pictures, not thirty a second). Returns the file names in order.
 * @param {{ html: string, width: number, height: number, states: any[][], outDir: string, signal?: AbortSignal, loadChromium?: () => object }} o
 */
async function renderStatePngs({ html, width, height, states, outDir, signal, loadChromium = () => require('playwright').chromium }) {
  if (signal?.aborted) throw new RenderCancelled();
  const path = require('path');
  let browser = null;
  let aborted = false;
  const onAbort = () => { aborted = true; if (browser) browser.close().catch(() => {}); };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    browser = await loadChromium().launch({ headless: true, args: ['--disable-dev-shm-usage', '--block-new-web-contents'] });
    if (aborted) throw new RenderCancelled();
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.route('**/*', (route) => {
      const url = route.request().url();
      return url.startsWith('data:') || url === 'about:blank' ? route.continue() : route.abort();
    });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => (document.fonts && document.fonts.ready) || null);
    const names = [];
    for (let i = 0; i < states.length; i += 1) {
      if (aborted) throw new RenderCancelled();
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate((args) => window.show(...args), states[i]);
      const name = `cap-${String(i).padStart(5, '0')}.png`;
      // eslint-disable-next-line no-await-in-loop
      await page.screenshot({ type: 'png', omitBackground: true, path: path.join(outDir, name) });
      names.push(name);
    }
    return names;
  } catch (err) {
    if (aborted) throw new RenderCancelled();
    throw err;
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = { renderHtmlToMp4, renderStatePngs, frameTimes, RenderCancelled, FPS };
