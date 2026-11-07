'use strict';

// node server/lib/memoryLog.test.js   (no real /proc or cgroup: fakes stand in)
const assert = require('assert');
const m = require('./memoryLog');

const files = (map) => (p) => { if (p in map) return map[p]; const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; };

// the container total: cgroup v2 first, then v1, none on a machine without one
assert.strictEqual(m.readCgroupBytes(files({ '/sys/fs/cgroup/memory.current': '2147483648\n' })), 2147483648);
assert.strictEqual(m.readCgroupBytes(files({ '/sys/fs/cgroup/memory/memory.usage_in_bytes': '1048576' })), 1048576);
assert.strictEqual(m.readCgroupBytes(files({})), null);
assert.strictEqual(m.readCgroupBytes(files({ '/sys/fs/cgroup/memory.current': 'max' })), null, 'a non-number is ignored');

// the biggest processes, read from /proc
const procFiles = {
  '/proc/1/status': 'Name:\tnode\nVmRSS:\t 921600 kB\n',
  '/proc/22/status': 'Name:\tchrome\nVmRSS:\t 2097152 kB\n',
  '/proc/33/status': 'Name:\tffmpeg\nVmRSS:\t 524288 kB\n',
  '/proc/44/status': 'Name:\tsh\nVmRSS:\t 1024 kB\n',
  '/proc/55/status': 'Name:\tkthreadd\n', // no VmRSS: skipped
};
const top = m.topProcesses(3, { readdir: () => ['1', '22', '33', '44', '55', 'cpuinfo', 'self', '66'], readFile: files(procFiles) });
assert.deepStrictEqual(top, [{ pid: 22, name: 'chrome', rssMb: 2048 }, { pid: 1, name: 'node', rssMb: 900 }, { pid: 33, name: 'ffmpeg', rssMb: 512 }], 'biggest first, limited, non-processes and ended ones skipped');
assert.deepStrictEqual(m.topProcesses(3, { readdir: () => { throw new Error('no /proc'); } }), [], 'no /proc is an empty list, not an error');

// when to write a line
const S = (lastAt, lastMb) => ({ lastAt, lastMb });
assert.strictEqual(m.shouldLog(S(null, 0), 500, 0), 'start');
assert.strictEqual(m.shouldLog(S(0, 500), 520, 60_000), null, 'a small change a minute later says nothing');
assert.strictEqual(m.shouldLog(S(0, 500), 520, 5 * 60_000), 'interval', 'a line at least every five minutes');
assert.strictEqual(m.shouldLog(S(0, 500), 800, 30_000), 'rise', 'a 300 MB rise is logged at once');
assert.strictEqual(m.shouldLog(S(0, 2000), 1700, 30_000), 'fall', 'and a 300 MB fall');
assert.strictEqual(m.shouldLog(S(0, 1600), 1650, 30_000), null, 'above 1.5 GB, at most one line a minute');
assert.strictEqual(m.shouldLog(S(0, 1600), 1650, 61_000), 'high');

// large requests: logged with the path only, the last five kept
const logged = [];
const lr = m.largeRequestLogger({ log: { info: (o, msg) => logged.push([o, msg]) }, now: () => Date.UTC(2026, 10, 8, 1, 2, 3) });
let nexts = 0;
const req = (len, url, method = 'POST') => ({ method, originalUrl: url, headers: len == null ? {} : { 'content-length': String(len) } });
lr(req(1000, '/api/x'), {}, () => nexts++);
lr(req(null, '/api/y'), {}, () => nexts++);
lr(req(5 * 1048576 - 1, '/api/just-under'), {}, () => nexts++);
assert.strictEqual(logged.length, 0, 'small and unknown sizes are not logged');
lr(req(80 * 1048576, '/api/videos/transcribe?token=SECRET&x=1'), {}, () => nexts++);
assert.strictEqual(nexts, 4, 'the request always carries on');
assert.strictEqual(logged.length, 1);
assert.deepStrictEqual(logged[0][0], { at: '2026-11-08T01:02:03.000Z', method: 'POST', path: '/api/videos/transcribe', mb: 80 }, 'path only: the query string (and anything in it) is never logged');
assert.strictEqual(logged[0][1], 'large request');
for (let i = 0; i < 7; i++) lr(req(6 * 1048576, `/api/n${i}`), {}, () => {});
assert.strictEqual(m.recentLarge.length, 5, 'only the last five are kept');
assert.strictEqual(m.recentLarge[4].path, '/api/n6');
// a logger that throws must not break the request
let ok = false;
m.largeRequestLogger({ log: { info: () => { throw new Error('boom'); } } })(req(9 * 1048576, '/api/z'), {}, () => { ok = true; });
assert.ok(ok, 'a failing logger never breaks a request');

// the sampler and the log
const s = m.sample({ memoryUsage: () => ({ rss: 900 * 1048576, heapUsed: 100 * 1048576, heapTotal: 150 * 1048576, external: 20 * 1048576, arrayBuffers: 10 * 1048576 }), cgroup: () => 1500 * 1048576, uptime: () => 600, extra: () => ({ ocr: { running: false } }) });
assert.deepStrictEqual(s, { rssMb: 900, heapUsedMb: 100, heapTotalMb: 150, externalMb: 20, arrayBuffersMb: 10, containerMb: 1500, uptimeMin: 10, ocr: { running: false } });

const lines = [];
let t = 0;
let container = 800;
const handle = m.startMemoryLog({
  log: { info: (o, msg) => lines.push([o, msg]), warn: () => {} }, tickMs: 1e9, now: () => t,
  sampler: () => ({ rssMb: 700, heapUsedMb: 1, heapTotalMb: 2, externalMb: 3, arrayBuffersMb: 4, containerMb: container, uptimeMin: 0 }),
  top: () => [{ pid: 9, name: 'chrome', rssMb: 600 }],
});
assert.strictEqual(lines.length, 1, 'one line at start');
assert.strictEqual(lines[0][0].reason, 'start');
assert.strictEqual(lines[0][0].top, undefined, 'a routine line does not list processes');
t = 60_000; handle.tick();
assert.strictEqual(lines.length, 1, 'nothing to say a minute later');
t = 90_000; container = 2600; handle.tick();
assert.strictEqual(lines.length, 2);
assert.strictEqual(lines[1][0].reason, 'rise');
assert.deepStrictEqual(lines[1][0].top, [{ pid: 9, name: 'chrome', rssMb: 600 }], 'a jump lists the biggest processes');
assert.ok(Array.isArray(lines[1][0].recentLarge), 'and the recent large requests');
assert.match(lines[1][1], /container 2600 MB \(rise\)/);
t = 90_000 + 5 * 60_000; handle.tick();
assert.strictEqual(lines[2][0].reason, 'high', 'still above 1.5 GB: a line a minute at most');
handle.stop();

// a sampler that throws does not throw out of the timer
const bad = m.startMemoryLog({ log: { info: () => {}, warn: (o) => lines.push(['warn', o]) }, tickMs: 1e9, sampler: () => { throw new Error('no memory info'); } });
assert.strictEqual(bad.tick(), null);
bad.stop();

console.log('memoryLog.test.js: all passed');
