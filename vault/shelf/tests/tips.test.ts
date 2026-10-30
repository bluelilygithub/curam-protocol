import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTION_IDS } from '../src/bridge/types';
import { FILTERS } from '../src/lib/describe';
import { HELP_SECTIONS, TOUR_STEPS } from '../src/lib/help';
import { ACTION_LABELS } from '../src/lib/settings';
import { ACTION_TIPS, FILTER_TIPS, TIPS, cardTip } from '../src/lib/tips';

// Same idea as Video Tools' tip tests: a control without a tip, or a tip that went missing, fails here instead of being noticed by a person.
const dir = join(__dirname, '..', 'src', 'components');
const sources = readdirSync(dir).filter((f) => f.endsWith('.tsx')).map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8') }));

describe('tooltips', () => {
  it('every tab and every send button has a tip', () => {
    for (const f of FILTERS) expect(FILTER_TIPS[f.id], f.id).toMatch(/\S{3}/);
    for (const id of ACTION_IDS) { expect(ACTION_TIPS[id], id).toMatch(/\S{3}/); expect(ACTION_LABELS[id]).toBeTruthy(); }
  });

  it('every fixed tip is a real sentence, and none is empty', () => {
    for (const [key, value] of Object.entries(TIPS)) {
      const text = typeof value === 'function' ? (value as (s: string) => string)('keepass.exe') : value;
      expect(text.length, key).toBeGreaterThan(10);
      expect(text, key).not.toMatch(/\s{2,}|\bTODO\b/);
    }
    expect(cardTip('Text', 'outlook.exe', false)).toContain('outlook.exe');
    expect(cardTip('Text', null, true)).toMatch(/never sent/);
  });

  it('no control uses the browser\'s plain title tip: every one goes through the themed Tooltip', () => {
    for (const { file, text } of sources) {
      if (file === 'Tooltip.tsx') continue;
      // an iframe title is an accessibility label, not a tip
      const bad = text.split('\n').filter((l) => /<(button|input|select|label|span|div|mark|kbd|a)\b[^>]*\stitle=/.test(l));
      expect(bad, file).toEqual([]);
    }
  });

  it('every button and input in the page is wrapped in a Tooltip, or is deliberately without one', () => {
    // buttons that carry their own words in plain sight (Back, Skip, Next...) and the cards/tabs checked above are the only exceptions
    const allowedBare = ['Tour.tsx'];
    for (const { file, text } of sources) {
      if (allowedBare.includes(file) || file === 'Tooltip.tsx') continue;
      const buttons = (text.match(/<button\b/g) ?? []).length + (text.match(/<input\b/g) ?? []).length + (text.match(/<select\b/g) ?? []).length;
      const wrapped = (text.match(/<Tooltip\b/g) ?? []).length;
      // a Toggle's label is wrapped once for all its switches, and a few buttons repeat inside a loop; so wrapped >= buttons minus the bare-by-design ones
      const bareByDesign = file === 'SettingsView.tsx' ? 1 : file === 'Preview.tsx' ? 0 : 0; // the type="checkbox" inside Toggle is covered by Toggle's own Tooltip
      expect(wrapped, `${file}: ${buttons} controls, ${wrapped} tooltips`).toBeGreaterThanOrEqual(buttons - bareByDesign);
    }
  });
});

describe('help and tour', () => {
  it('help covers what a new person needs, in plain words', () => {
    const ids = HELP_SECTIONS.map((s) => s.id);
    for (const need of ['what', 'use', 'send', 'connect', 'privacy', 'trouble']) expect(ids).toContain(need);
    const all = HELP_SECTIONS.flatMap((s) => s.body).join(' ');
    for (const word of ['Save as Note', 'Attach to CRM', 'Ingest to Finance', 'Ask Redaction', 'Credential Manager', 'Esc']) expect(all, word).toContain(word);
    expect(all).not.toMatch(/\b(API|JSON|DPAPI|SQLite|HWND)\b/);
  });

  it('every tour step points at a part of the page that is marked for it', () => {
    const page = [...sources.map((s) => s.text), readFileSync(join(__dirname, '..', 'src', 'App.tsx'), 'utf8')].join('\n');
    for (const step of TOUR_STEPS) {
      expect(page, step.target).toContain(`data-tour="${step.target}"`);
      expect(step.title.length).toBeGreaterThan(3);
      expect(step.text.length).toBeGreaterThan(15);
    }
  });
});
