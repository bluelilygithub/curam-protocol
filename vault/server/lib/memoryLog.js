'use strict';

// Memory log (added 8 Nov 2026 after Railway showed RAM spikes of many GB with nothing in the app's own logs to say why).
// Railway bills the whole CONTAINER's memory, not just Node's, so each line carries both:
//   - the Node process: rss, heap, external, arrayBuffers (uploads and other Buffers show up in the last two)
//   - the container total from the cgroup (what Railway bills: it includes Chromium, ffmpeg, LibreOffice and any other child process)
// It writes a line every 5 minutes, and an extra line (with the five biggest processes and the last large requests) whenever the container's
// memory moves by 300 MB or more since the last line, or is above 1.5 GB (at most one such line a minute). Requests with a body of 5 MB or
// more are logged on arrival, with the path only (never the query string or the body), so an upload and a spike can be matched afterwards.
// Search the Railway logs for "memory" or "large request". Nothing here reads or stores anything else.

const fs = require('fs');

const MB = 1048576;
const toMb = (b) => Math.round(b / MB);
const TICK_MS = 30 * 1000; // how often it looks
const EVERY_MS = 5 * 60 * 1000; // a line at least this often
const JUMP_MB = 300;
const HIGH_MB = 1500;
const HIGH_EVERY_MS = 60 * 1000;
const LARGE_REQUEST_BYTES = 5 * MB;
const RECENT_LARGE = 5;

/** The container's memory in bytes (cgroup v2, then v1), or null where there is no cgroup (a Windows dev machine). */
function readCgroupBytes(readFile = fs.readFileSync) {
  for (const p of ['/sys/fs/cgroup/memory.current', '/sys/fs/cgroup/memory/memory.usage_in_bytes']) {
    try {
      const n = Number(String(readFile(p, 'utf8')).trim());
      if (Number.isFinite(n) && n > 0) return n;
    } catch { /* not there */ }
  }
  return null;
}

/** The biggest processes in the container by resident memory, read straight from /proc (no `ps` needed). [] where there is no /proc. */
function topProcesses(n = 5, { readdir = fs.readdirSync, readFile = fs.readFileSync } = {}) {
  let pids;
  try { pids = readdir('/proc').filter((d) => /^\d+$/.test(d)); } catch { return []; }
  const out = [];
  for (const pid of pids) {
    try {
      const status = String(readFile(`/proc/${pid}/status`, 'utf8'));
      const name = (status.match(/^Name:\s*(.+)$/m) || [])[1];
      const kb = Number((status.match(/^VmRSS:\s*(\d+)\s*kB/m) || [])[1]);
      if (name && Number.isFinite(kb) && kb > 0) out.push({ pid: Number(pid), name: name.trim(), rssMb: Math.round(kb / 1024) });
    } catch { /* the process ended while we looked */ }
  }
  return out.sort((a, b) => b.rssMb - a.rssMb).slice(0, n);
}

/** Why a line should be written now, or null. `state` is { lastAt, lastMb }; `mb` is the container's memory (or the process's, with no cgroup). */
function shouldLog(state, mb, now, { everyMs = EVERY_MS, jumpMb = JUMP_MB, highMb = HIGH_MB, highEveryMs = HIGH_EVERY_MS } = {}) {
  if (state.lastAt == null) return 'start';
  if (Math.abs(mb - state.lastMb) >= jumpMb) return mb > state.lastMb ? 'rise' : 'fall';
  if (mb >= highMb && now - state.lastAt >= highEveryMs) return 'high';
  if (now - state.lastAt >= everyMs) return 'interval';
  return null;
}

const recentLarge = [];

/** Express middleware: note any request announcing a body of 5 MB or more. Path only. Mount it before the body parsers. */
function largeRequestLogger({ log, now = () => Date.now(), threshold = LARGE_REQUEST_BYTES } = {}) {
  return function largeRequest(req, _res, next) {
    const bytes = Number(req.headers && req.headers['content-length']);
    if (Number.isFinite(bytes) && bytes >= threshold) {
      const entry = { at: new Date(now()).toISOString(), method: req.method, path: String(req.originalUrl || req.url || '').split('?')[0].slice(0, 200), mb: toMb(bytes) };
      recentLarge.push(entry);
      if (recentLarge.length > RECENT_LARGE) recentLarge.shift();
      try { (log || require('./logger')).info(entry, 'large request'); } catch { /* logging must never break a request */ }
    }
    next();
  };
}

function sample({ memoryUsage = () => process.memoryUsage(), cgroup = readCgroupBytes, uptime = () => process.uptime(), extra = () => ({}) } = {}) {
  const m = memoryUsage();
  const container = cgroup();
  return {
    rssMb: toMb(m.rss), heapUsedMb: toMb(m.heapUsed), heapTotalMb: toMb(m.heapTotal), externalMb: toMb(m.external), arrayBuffersMb: toMb(m.arrayBuffers || 0),
    containerMb: container == null ? null : toMb(container), uptimeMin: Math.round(uptime() / 60), ...extra(),
  };
}

/**
 * Starts the memory log. Returns { tick, stop } (tick is for tests). `extra` adds fields to every line (for example the OCR pool's state).
 */
function startMemoryLog({ log, tickMs = TICK_MS, now = () => Date.now(), sampler = sample, top = topProcesses, extra } = {}) {
  const out = log || require('./logger');
  const state = { lastAt: null, lastMb: 0 };
  function tick() {
    try {
      const s = sampler(extra ? { extra } : undefined);
      const mb = s.containerMb != null ? s.containerMb : s.rssMb;
      const reason = shouldLog(state, mb, now());
      if (!reason) return null;
      state.lastAt = now();
      state.lastMb = mb;
      const detail = reason === 'rise' || reason === 'fall' || reason === 'high' ? { top: top(5), recentLarge: recentLarge.slice() } : {};
      out.info({ mem: s, reason, ...detail }, `memory ${s.containerMb != null ? 'container' : 'process'} ${mb} MB (${reason})`);
      return reason;
    } catch (err) {
      try { out.warn({ err: err.message }, 'memory log failed'); } catch { /* ignore */ }
      return null;
    }
  }
  const timer = setInterval(tick, tickMs);
  if (timer.unref) timer.unref();
  tick(); // one line at start
  return { tick, stop: () => clearInterval(timer) };
}

module.exports = { startMemoryLog, largeRequestLogger, readCgroupBytes, topProcesses, shouldLog, sample, recentLarge, LARGE_REQUEST_BYTES, EVERY_MS, JUMP_MB, HIGH_MB };
