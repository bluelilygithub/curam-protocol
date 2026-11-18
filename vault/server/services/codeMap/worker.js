'use strict';

// Runs analyze() in a worker thread. The analysis is synchronous (about 1.5-3 seconds of reading and regex work on Vault's ~2,000 files);
// in the main thread that would freeze every other request while it runs. worker_threads is built into Node: no package needed.
//
//   runInWorker({ root, onStage }) -> Promise<result>; onStage(name) is called as each stage starts.

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

function runInWorker({ root, onStage } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    const w = new Worker(__filename, { workerData: { root } });
    w.on('message', (m) => {
      if (m.type === 'stage') { if (onStage) onStage(m.stage); }
      else if (m.type === 'done') done(resolve, m.result);
      else if (m.type === 'error') done(reject, Object.assign(new Error(m.message), { stack: m.stack }));
    });
    w.on('error', (err) => done(reject, err));
    w.on('exit', (code) => done(reject, new Error(`The analysis stopped unexpectedly (exit code ${code}).`)));
  });
}

if (!isMainThread && workerData && workerData.root) {
  try {
    const { analyze } = require('./index');
    const result = analyze({ root: workerData.root, log: null, onStage: (stage) => parentPort.postMessage({ type: 'stage', stage }) });
    parentPort.postMessage({ type: 'done', result });
  } catch (err) {
    parentPort.postMessage({ type: 'error', message: err.message, stack: err.stack });
  }
}

module.exports = { runInWorker };
