import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createUiStore, INFO_KEY } from '../src/app/uiStore';
import { TOUR_KEY, TOUR_STEPS } from '../src/help/cellarTour';

const here = join(__dirname, '../src');
const uiDir = join(here, 'ui');
const read = (p: string): string => readFileSync(p, 'utf8');
const screenSource = (): string => [...readdirSync(uiDir).filter((f) => f.endsWith('.tsx')).map((f) => read(join(uiDir, f))), read(join(here, 'App.tsx'))].join('\n');

describe('guided tour', () => {
  it('has unique step ids, a welcome and a finish, and every target is a cp- hook', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(TOUR_STEPS[0].target).toBeUndefined();
    expect(TOUR_STEPS[TOUR_STEPS.length - 1].target).toBeUndefined();
    for (const s of TOUR_STEPS) if (s.target) expect(s.target).toMatch(/^cp-/);
  });

  it('every step that points at something points at a hook that exists on the screen (the tour cannot drift away from it)', () => {
    const source = screenSource();
    // a hook is written either as data-tour="x" or, on a panel section, as tour="x" (which sets it)
    for (const s of TOUR_STEPS) if (s.target) expect(source.includes(`data-tour="${s.target}"`) || source.includes(` tour="${s.target}"`), s.id).toBe(true);
  });

  it('covers the main parts, in a sensible order (enclosure, door, header, racks, runs, drawings, total, checks, advice)', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    for (const id of ['cp-enclosure', 'cp-door', 'cp-header', 'cp-rack', 'cp-runs', 'cp-tabs', 'cp-drawing', 'cp-total', 'cp-checks', 'cp-advisory']) expect(ids).toContain(id);
    const at = (id: string) => ids.indexOf(id);
    expect(at('cp-enclosure')).toBeLessThan(at('cp-door'));
    expect(at('cp-rack')).toBeLessThan(at('cp-runs'));
    expect(at('cp-runs')).toBeLessThan(at('cp-total'));
    expect(at('cp-checks')).toBeLessThan(at('cp-advisory'));
    expect(TOUR_STEPS.length).toBe(17);
    for (const id of ['cp-price', 'cp-cooling', 'cp-enquiries', 'cp-quote']) expect(ids).toContain(id);
    expect(at('cp-runs')).toBeLessThan(at('cp-price')); expect(at('cp-price')).toBeLessThan(at('cp-cooling')); expect(at('cp-cooling')).toBeLessThan(at('cp-tabs'));
    expect(at('cp-advisory')).toBeLessThan(at('cp-enquiries')); expect(at('cp-quote')).toBeLessThan(at('cp-done'));
  });

  it('the steps that need a particular drawing say which', () => {
    expect(TOUR_STEPS.find((s) => s.id === 'cp-tabs')?.tab).toBe('racks');
    expect(TOUR_STEPS.find((s) => s.id === 'cp-drawing')?.tab).toBe('plan');
  });

  it('says the things that must never be lost: blanks are "not set", advice is information only with sign-off, drawings are preliminary', () => {
    const text = (id: string) => TOUR_STEPS.find((s) => s.id === id)?.text ?? '';
    expect(text('cp-rack')).toMatch(/not set/);
    expect(text('cp-total')).toMatch(/not set/);
    expect(text('cp-advisory')).toMatch(/information only/);
    expect(text('cp-advisory')).toMatch(/sign-off/);
    expect(text('cp-cooling')).toMatch(/sign-off/); expect(text('cp-cooling')).toMatch(/guide/);
    expect(text('cp-price')).toMatch(/guide only/); expect(text('cp-price')).toMatch(/never counted as zero/);
    expect(text('cp-quote')).toMatch(/refused/);
    expect(text('cp-advisory')).not.toMatch(/Nothing here sizes cooling/);
    expect(text('cp-welcome')).toMatch(/final site measure/);
    expect(text('cp-done')).toMatch(/preliminary/);
  });

  it('every step has a title and some text, and the tour key matches the one Vault\'s Settings page looks for', () => {
    for (const s of TOUR_STEPS) { expect(s.title.length).toBeGreaterThan(3); expect(s.text.length).toBeGreaterThan(30); }
    expect(TOUR_KEY).toBe('vault_tour_cellar_planner_completed');
  });
});

describe('the guide (the (i) modal)', () => {
  const modal = read(join(uiDir, 'InfoModal.tsx'));
  it('explains the core ideas in plain words', () => {
    for (const phrase of ['not set', 'outer faces', 'build-up', 'outside', 'Advisory guidance', 'sign-off', 'preliminary design only', 'Download file', 'minimum walkway']) expect(modal.toLowerCase(), phrase).toContain(phrase.toLowerCase());
  });
  it('explains the Racks view: bottles at true size, inside face of a wall', () => {
    for (const phrase of ['Racks', 'inside face', 'true size', 'not counted']) expect(modal, phrase).toContain(phrase);
  });
  it('explains that bottles per row is calculated, label-forward is separate, and errored runs are not counted', () => {
    for (const phrase of ['calculated', 'label-forward', 'only counts runs that can be built']) expect(modal.toLowerCase(), phrase).toContain(phrase.toLowerCase());
  });
  it('explains the Test case and that its values are guesses to overwrite', () => {
    for (const phrase of ['Test case', 'best-guess', 'estimated', 'do not quote']) expect(modal.toLowerCase(), phrase).toContain(phrase.toLowerCase());
  });
  it('is honest about what is not built', () => {
    expect(modal).toMatch(/What is not here yet/);
    // what is still missing is named; things that are built are NOT listed as missing
    const notHere = modal.slice(modal.indexOf('What is not here yet')).toLowerCase();
    for (const phrase of ['mixed rack types', 'free-standing', 'rectangular', 'parts list', 'joinery', 'supplier']) expect(notHere, phrase).toContain(phrase);
    for (const built of ['dragging racks', 'a 3d view', 'the quote request']) expect(notHere, built).not.toContain(built);
  });
  it('describes the newer features: rack types and price, cooling (a guide needing sign-off), the 3D view, enquiries and quotes', () => {
    const m = modal.toLowerCase();
    for (const phrase of ['rack types and price', 'catalogue', 'confirmed', 'a guide only', 'cooling', 'hvac sign-off', '3d', 'oak, walnut or black', 'enquiries and quotes', 'refused until the numbers can be trusted', 'calculator button']) expect(m, phrase).toContain(phrase);
    expect(m).not.toContain('nothing here sizes cooling');
  });
  it('opens once, then stays closed (the store starts closed; the key is the one the app writes)', () => {
    expect(createUiStore().getState().infoOpen).toBe(false);
    expect(INFO_KEY).toBe('cellar-planner:info-seen:v1');
  });
});

describe('tooltips: every control explains itself', () => {
  const source = screenSource();
  /** Every opening tag of a JSX element, read to its closing > (an arrow function's => inside braces does not end it). */
  const tags = (name: string): string[] => {
    const out: string[] = [];
    const re = new RegExp(`<${name}\\b`, 'g');
    for (let m = re.exec(source); m; m = re.exec(source)) {
      let depth = 0, i = m.index + m[0].length;
      for (; i < source.length; i++) {
        const c = source[i];
        if (c === '{') depth++; else if (c === '}') depth--; else if (c === '>' && depth === 0) break;
      }
      out.push(source.slice(m.index, i + 1));
    }
    return out;
  };

  it('every form field passes a hint (it becomes its tooltip)', () => {
    for (const f of ['NumField', 'SelectField', 'CheckField', 'TextField']) {
      for (const t of tags(f)) expect(t, `${f} without a hint: ${t.slice(0, 90)}`).toMatch(/hint=/);
    }
  });
  it('every button has a title (its tooltip)', () => {
    for (const t of tags('button')) expect(t, `button without a title: ${t.slice(0, 90)}`).toMatch(/title=/);
  });
  it('the fields are written with real sentences, not placeholders', () => {
    const hints = [...source.matchAll(/hint="([^"]+)"/g)].map((m) => m[1]);
    expect(hints.length).toBeGreaterThan(30);
    for (const h of hints) { expect(h.length, h).toBeGreaterThan(15); expect(h, h).toMatch(/[a-z]/); }
  });
  it('the shared tooltip host is mounted', () => {
    expect(read(join(here, 'App.tsx'))).toContain('<TooltipHost />');
  });
});
