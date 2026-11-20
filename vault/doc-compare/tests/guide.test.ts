import { describe, expect, it } from 'vitest';
import { GUIDE_TOOLS, HOW_IT_WORKS } from '@vault-client/pages/docCompare/docCompareTools.mjs';
import { currentGuideTool, openGuideTool, type GuideHooks } from '../src/ui/guide';

function hooks(o: Partial<{ results: boolean; pdf: boolean; on: string[]; viewer: boolean }> = {}) {
  const log: string[] = [];
  const h: GuideHooks = {
    openInfo: () => log.push('info'),
    openSettings: () => log.push('settings'),
    openViewer: () => { log.push('viewer'); return !!o.viewer; },
    show: (id) => { log.push(`show:${id}`); return (o.on ?? []).includes(id); },
    toast: (t) => log.push(`toast:${t}`),
    hasResults: () => !!o.results,
    isPdf: () => !!o.pdf,
  };
  return { h, log };
}

describe('guide Open buttons', () => {
  it('handles every guide id and ignores unknown ones', () => {
    for (const t of GUIDE_TOOLS) expect(openGuideTool(t.id, hooks().h), t.id).toBe(true);
    const { h, log } = hooks();
    expect(openGuideTool('teleporter', h)).toBe(false);
    expect(log).toEqual([]);
  });
  it('opens info and settings directly', () => {
    let x = hooks(); openGuideTool('info', x.h); expect(x.log).toEqual(['info']);
    x = hooks(); openGuideTool('settings', x.h); expect(x.log).toEqual(['settings']);
  });
  it('says to compare first when a results part is asked for too early', () => {
    const { h, log } = hooks();
    openGuideTool('changes', h);
    expect(log.some((l) => l.startsWith('toast:Choose both files'))).toBe(true);
  });
  it('scrolls to a results part once there are results', () => {
    const { h, log } = hooks({ results: true, on: ['filters'] });
    openGuideTool('filters', h);
    expect(log).toEqual(['show:filters']);
  });
  it('page viewer is for PDFs only, and waits for the layout check', () => {
    let x = hooks({ results: true, pdf: false }); openGuideTool('page-viewer', x.h); expect(x.log.join()).toMatch(/PDF files only/);
    x = hooks({ results: true, pdf: true, viewer: true }); openGuideTool('page-viewer', x.h); expect(x.log).toEqual(['viewer']);
    x = hooks({ results: true, pdf: true, viewer: false }); openGuideTool('page-viewer', x.h); expect(x.log.join()).toMatch(/once the page layout check has finished/);
  });
  it('reports where the person is', () => {
    const base = { info: false, settings: false, viewer: false, gate2: false, error: false, results: false };
    expect(currentGuideTool(base)).toBe('files');
    expect(currentGuideTool({ ...base, results: true })).toBe('changes');
    expect(currentGuideTool({ ...base, gate2: true })).toBe('same-document');
    expect(currentGuideTool({ ...base, info: true, results: true })).toBe('info');
    for (const id of ['files', 'changes', 'same-document', 'file-check', 'info', 'settings', 'page-viewer']) expect(GUIDE_TOOLS.some((t) => t.id === id)).toBe(true);
  });
  it('the (i) box has text', () => expect(HOW_IT_WORKS.length).toBeGreaterThanOrEqual(5));
});
