import { describe, expect, it } from 'vitest';
import { DOC_COMPARE_TOOLS, GUIDE_TOOLS, HOW_IT_WORKS } from '@vault-client/pages/docCompare/docCompareTools.mjs';
import { currentGuideTool, isView, openGuideTool, type GuideHooks } from '../src/ui/guide';

function hooks(o: Partial<{ results: boolean; pdf: boolean; on: string[]; viewer: boolean }> = {}) {
  const log: string[] = [];
  const h: GuideHooks = {
    openInfo: () => log.push('info'),
    setView: (v) => log.push(`view:${v}`),
    later: (fn) => fn(),
    openViewer: () => { log.push('viewer'); return !!o.viewer; },
    show: (id) => { log.push(`show:${id}`); return (o.on ?? []).includes(id); },
    toast: (t) => log.push(`toast:${t}`),
    hasResults: () => !!o.results,
    isPdf: () => !!o.pdf,
  };
  return { h, log };
}

describe('guide Open buttons', () => {
  it('every guide id opens a real view (or the (i) box) and unknown ids do nothing', () => {
    for (const t of GUIDE_TOOLS) {
      const x = hooks();
      expect(openGuideTool(t.id, x.h), t.id).toBe(true);
      expect(isView(t.tool), `${t.id} -> ${t.tool}`).toBe(true);
      if (t.id !== 'info') expect(x.log[0]).toBe(`view:${t.tool}`);
    }
    const { h, log } = hooks();
    expect(openGuideTool('teleporter', h)).toBe(false);
    expect(log).toEqual([]);
  });
  it('a tool id just switches view', () => {
    for (const t of DOC_COMPARE_TOOLS) { const x = hooks(); openGuideTool(t.id, x.h); expect(x.log).toEqual([`view:${t.id}`]); }
  });
  it('opens the (i) box without changing view', () => {
    const x = hooks(); openGuideTool('info', x.h); expect(x.log).toEqual(['info']);
  });
  it('says to compare first when a results part is asked for too early', () => {
    const { h, log } = hooks();
    openGuideTool('filters', h);
    expect(log[0]).toBe('view:changes');
    expect(log.some((l) => l.startsWith('toast:Choose both files'))).toBe(true);
  });
  it('scrolls to a part once there are results', () => {
    const { h, log } = hooks({ results: true, on: ['filters'] });
    openGuideTool('filters', h);
    expect(log).toEqual(['view:changes', 'show:filters']);
  });
  it('page viewer is for PDFs only, and waits for the page check', () => {
    let x = hooks({ results: true, pdf: false }); openGuideTool('page-viewer', x.h); expect(x.log.join()).toMatch(/PDF files only/);
    x = hooks({ results: true, pdf: true, viewer: true }); openGuideTool('page-viewer', x.h); expect(x.log).toEqual(['view:pages', 'viewer']);
    x = hooks({ results: true, pdf: true, viewer: false }); openGuideTool('page-viewer', x.h); expect(x.log.join()).toMatch(/once the page check has finished/);
  });
  it('reports where the person is', () => {
    const base = { info: false, viewer: false, gate2: false, error: false, view: 'compare' as const };
    expect(currentGuideTool(base)).toBe('compare');
    expect(currentGuideTool({ ...base, view: 'changes' })).toBe('changes');
    expect(currentGuideTool({ ...base, gate2: true })).toBe('same-document');
    expect(currentGuideTool({ ...base, error: true })).toBe('file-check');
    expect(currentGuideTool({ ...base, info: true })).toBe('info');
    expect(currentGuideTool({ ...base, viewer: true, view: 'pages' })).toBe('page-viewer');
  });
  it('the (i) box has text', () => expect(HOW_IT_WORKS.length).toBeGreaterThanOrEqual(5));
});
