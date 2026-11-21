import type { NormalizedDoc } from '../readers/types';
import type { ComparisonResult, SimilarityResult } from '../report/model';
import type { Settings } from '../settings';
import CompareWorker from './worker?worker&inline';

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function get(): Worker {
  if (worker) return worker;
  worker = new CompareWorker();
  worker.onmessage = (ev: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    pending.delete(ev.data.id);
    if (ev.data.error) p.reject(new Error(ev.data.error)); else p.resolve(ev.data.result);
  };
  worker.onerror = (ev) => { for (const p of pending.values()) p.reject(new Error(ev.message || 'Comparison worker failed')); pending.clear(); worker = undefined; };
  return worker;
}

function call<T>(msg: Record<string, unknown>): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    get().postMessage({ ...msg, id });
  });
}

export const similarityInWorker = (a: NormalizedDoc, b: NormalizedDoc) => call<SimilarityResult>({ type: 'similarity', a, b });
export const compareInWorker = (a: NormalizedDoc, b: NormalizedDoc, settings: Settings, versions = false) => call<ComparisonResult>({ type: 'compare', a, b, settings, versions });
