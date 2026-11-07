'use strict';

// Two small in-memory helpers for the "Brand from a website" route.
//
// createProposalStore: holds a finished proposal (with its font files) for a short time under a random id, owned by one person, so the
// screen can show a preview and a later "Use this" can refer to the id instead of sending megabytes of font data to the browser and
// back. Memory only: a server restart or the time running out simply means "read the website again". Another person's id answers
// "not found", never "not yours".
//
// createRunLimiter: one read at a time per person (each is a whole browser page) and a per-hour ceiling, because the route-wide
// request limiter counts requests, not how heavy they are.

const crypto = require('crypto');

function createProposalStore({ ttlMs = 30 * 60 * 1000, maxPerUser = 6, maxTotal = 120, now = () => Date.now() } = {}) {
  const items = new Map(); // id -> { userId, at, value }

  function sweep() {
    const t = now();
    for (const [id, it] of items) if (t - it.at > ttlMs) items.delete(id);
  }
  const timer = setInterval(sweep, 5 * 60 * 1000);
  if (timer.unref) timer.unref();

  return {
    put(userId, value) {
      sweep();
      const mine = [...items.entries()].filter(([, it]) => it.userId === userId).sort((a, b) => a[1].at - b[1].at);
      while (mine.length >= maxPerUser) items.delete(mine.shift()[0]); // the oldest of theirs goes first
      while (items.size >= maxTotal) items.delete(items.keys().next().value);
      const id = crypto.randomBytes(16).toString('hex');
      items.set(id, { userId, at: now(), value });
      return id;
    },
    get(userId, id) {
      const it = items.get(String(id || ''));
      if (!it || it.userId !== userId || now() - it.at > ttlMs) return null;
      return it.value;
    },
    remove(userId, id) {
      const it = items.get(String(id || ''));
      if (it && it.userId === userId) items.delete(String(id));
    },
    size: () => items.size,
    ttlSeconds: () => Math.round(ttlMs / 1000),
  };
}

function createRunLimiter({ perHour = 12, now = () => Date.now() } = {}) {
  const running = new Set();
  const starts = new Map(); // userId -> [timestamps in the last hour]
  return {
    /** Returns a function to call when the run ends, or throws an Error with status 429 and a plain message. */
    begin(userId) {
      if (running.has(userId)) throw Object.assign(new Error('You already have a website being read. Wait for it to finish.'), { status: 429 });
      const t = now();
      const recent = (starts.get(userId) || []).filter((x) => t - x < 3600 * 1000);
      if (recent.length >= perHour) {
        throw Object.assign(new Error(`That is ${perHour} websites in the last hour. Try again a little later.`), { status: 429 });
      }
      recent.push(t);
      starts.set(userId, recent);
      running.add(userId);
      let ended = false;
      return () => { if (!ended) { ended = true; running.delete(userId); } };
    },
  };
}

module.exports = { createProposalStore, createRunLimiter };
