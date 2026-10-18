import { describe, expect, it } from 'vitest';
import { GUIDE_TOOLS, currentGuideTool, openGuideTool, type Busy, type GuideHooks } from '../src/guideTools';

const hooks = (busy: Busy = null, planOk = true): GuideHooks & { calls: string[]; toasts: string[] } => {
  const calls: string[] = []; const toasts: string[] = [];
  return {
    calls, toasts,
    busy: () => busy,
    showTracks: () => calls.push('tracks'), startDrawing: () => calls.push('draw'), startPlan: () => { calls.push('plan'); return planOk; },
    openPlaces: () => calls.push('places'), openInfo: () => calls.push('info'), startTour: () => calls.push('tour'),
    menu: (n) => calls.push(`menu:${n}`), focusSearch: () => calls.push('search'), toast: (_k, t) => toasts.push(t),
  };
};

describe('the screens the guide chat can open', () => {
  it('has unique ids and plain labels', () => {
    const ids = GUIDE_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    GUIDE_TOOLS.forEach((t) => expect(t.label.length).toBeGreaterThan(2));
  });

  it('opens each screen when nothing is in progress', () => {
    const want: Record<string, string> = { search: 'search', tracks: 'tracks', draw: 'draw', plan: 'plan', places: 'places', info: 'info', tour: 'tour', layers: 'menu:layers', settings: 'menu:settings', import: 'menu:settings', mappdf: 'tracks' };
    for (const t of GUIDE_TOOLS) {
      const h = hooks();
      expect(openGuideTool(t.id, h), t.id).toBe(true);
      expect(h.calls, t.id).toContain(want[t.id]);
    }
  });

  it('never throws away a drawing or a plan: it says to finish or cancel first', () => {
    for (const busy of ['drawing', 'planning'] as const) {
      for (const id of ['tracks', 'mappdf']) { const h = hooks(busy); openGuideTool(id, h); expect(h.calls).toEqual([]); expect(h.toasts[0]).toMatch(/Finish or cancel/); }
    }
    const d = hooks('drawing'); openGuideTool('plan', d); expect(d.calls).toEqual([]); expect(d.toasts[0]).toMatch(/Finish or cancel/);
    const p = hooks('planning'); openGuideTool('draw', p); expect(p.calls).toEqual([]); expect(p.toasts[0]).toMatch(/Finish or cancel/);
    const same = hooks('drawing'); openGuideTool('draw', same); expect(same.calls).toEqual([]); expect(same.toasts[0]).toMatch(/already drawing/);
  });

  it('says so when route planning is not set up, and ignores unknown ids', () => {
    const h = hooks(null, false);
    openGuideTool('plan', h);
    expect(h.toasts[0]).toMatch(/not set up/);
    expect(openGuideTool('format-the-disk', h)).toBe(false);
    expect(openGuideTool('__proto__', h)).toBe(false);
  });

  it('says where the person is', () => {
    const base = { info: false, planning: false, drawing: false, places: false, panel: 'tracks' };
    expect(currentGuideTool(base)).toBe('tracks');
    expect(currentGuideTool({ ...base, panel: 'detail' })).toBe('mappdf');
    expect(currentGuideTool({ ...base, drawing: true })).toBe('draw');
    expect(currentGuideTool({ ...base, planning: true })).toBe('plan');
    expect(currentGuideTool({ ...base, places: true })).toBe('places');
    expect(currentGuideTool({ ...base, info: true, drawing: true })).toBe('info');
  });
});
