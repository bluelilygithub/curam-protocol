import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createUiStore } from '../src/app/uiStore';
import { GUIDE_TOOLS, currentGuideTool, openGuideTool, type GuideHooks } from '../src/app/guideTools';

const hooks = (): GuideHooks & { calls: string[] } => {
  const calls: string[] = [];
  return { calls, showLeft: () => calls.push('left'), showRight: () => calls.push('right'), startTour: () => calls.push('tour') };
};

describe('the tools the guide chat can open', () => {
  it('has unique ids and plain labels', () => {
    const ids = GUIDE_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    GUIDE_TOOLS.forEach((t) => expect(t.label.length).toBeGreaterThan(1));
  });

  it('every controls section it names exists on screen, and every drawing tab is a real tab', () => {
    const panels = readFileSync(new URL('../src/ui/panels.tsx', import.meta.url), 'utf8');
    GUIDE_TOOLS.filter((t) => t.kind === 'section' && t.target).forEach((t) => expect(panels, `${t.id}: Section title "${t.target}"`).toContain(`title="${t.target}"`));
    const tabs = ['plan', 'elevation', 'racks', 'inside'];
    GUIDE_TOOLS.filter((t) => t.kind === 'tab').forEach((t) => expect(tabs).toContain(t.target));
    const flags = ['designsOpen', 'leadsOpen', 'packageOpen', 'quoteOpen', 'codeOpen', 'calcOpen', 'infoOpen'];
    GUIDE_TOOLS.filter((t) => t.kind === 'dialog').forEach((t) => expect(flags).toContain(t.target));
  });

  it('opens a controls section, showing the left panel, and the same section can be asked for twice', () => {
    const ui = createUiStore(); const h = hooks();
    expect(openGuideTool(ui, 'price', h)).toBe(true);
    expect(h.calls).toEqual(['left']);
    expect(ui.getState().openSection).toEqual({ title: 'Price', nonce: 1 });
    expect(ui.getState().pane).toBe('controls');
    openGuideTool(ui, 'price', h);
    expect(ui.getState().openSection).toEqual({ title: 'Price', nonce: 2 });
  });

  it('switches the drawing tab, and shows the checks', () => {
    const ui = createUiStore(); const h = hooks();
    openGuideTool(ui, 'inside', h);
    expect(ui.getState().tab).toBe('inside');
    expect(ui.getState().pane).toBe('drawing');
    openGuideTool(ui, 'checks', h);
    expect(h.calls).toEqual(['right']);
    expect(ui.getState().pane).toBe('checks');
  });

  it('opens one dialog at a time', () => {
    const ui = createUiStore(); const h = hooks();
    openGuideTool(ui, 'quote', h);
    expect(ui.getState().quoteOpen).toBe(true);
    openGuideTool(ui, 'package', h);
    const s = ui.getState();
    expect([s.packageOpen, s.quoteOpen, s.designsOpen, s.infoOpen]).toEqual([true, false, false, false]);
  });

  it('starts the tour, and ignores an id it does not know', () => {
    const ui = createUiStore(); const h = hooks();
    expect(openGuideTool(ui, 'tour', h)).toBe(true);
    expect(h.calls).toEqual(['tour']);
    expect(openGuideTool(ui, 'format-the-hard-drive', h)).toBe(false);
    expect(openGuideTool(ui, '__proto__', h)).toBe(false);
    expect(h.calls).toEqual(['tour']);
  });

  it('says where the person is: a dialog, else the checks, else a controls section on the controls pane, else the drawing tab', () => {
    const ui = createUiStore();
    expect(currentGuideTool(ui.getState())).toBe('plan');
    ui.getState().set({ tab: 'racks' });
    expect(currentGuideTool(ui.getState())).toBe('racks');
    ui.getState().set({ pane: 'controls', activeSection: 'Cooling' });
    expect(currentGuideTool(ui.getState())).toBe('cooling');
    ui.getState().set({ pane: 'checks' });
    expect(currentGuideTool(ui.getState())).toBe('checks');
    ui.getState().set({ leadsOpen: true });
    expect(currentGuideTool(ui.getState())).toBe('leads');
  });
});
