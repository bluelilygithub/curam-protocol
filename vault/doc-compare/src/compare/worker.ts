/// <reference lib="webworker" />
import type { NormalizedDoc } from '../readers/types';
import type { Settings } from '../settings';
import { compareDocs, similarity } from './pipeline';

export type WorkerRequest =
  | { id: number; type: 'similarity'; a: NormalizedDoc; b: NormalizedDoc }
  | { id: number; type: 'compare'; a: NormalizedDoc; b: NormalizedDoc; settings: Settings };

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    const result = req.type === 'similarity' ? similarity(req.a, req.b) : compareDocs(req.a, req.b, req.settings);
    self.postMessage({ id: req.id, result });
  } catch (e) {
    self.postMessage({ id: req.id, error: (e as Error)?.message ?? String(e) });
  }
};
