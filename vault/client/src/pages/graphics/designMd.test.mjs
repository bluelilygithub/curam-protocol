// node client/src/pages/graphics/designMd.test.mjs
import assert from 'node:assert/strict';
import { buildDesignMd, canBuildDesignMd, contrastRatio, kitRoles } from './designMd.mjs';

const NOW = new Date('2026-11-07T10:00:00Z');
const kit = {
  roles: { background: '#0a1628', surface: '#192d49', text: '#ffffff', mutedText: '#d4af37', primary: '#d4af37', onPrimary: '#111111', border: '#d4af37', accent: 'junk' },
  colors: ['#d4af37', '#ffffff'], palette: ['#ffffff', '#d4af37', 'bad'], radius: { px: 8, label: 'rounded' },
  dark: { background: '#000000', text: '#eeeeee', primary: '#d4af37' },
  headingFont: { family: 'Montserrat', weight: 600, stored: true, renderFamily: 'BrandFont17ff0821' },
  bodyFont: { family: 'Inter "Display"', weight: 400, stored: false },
  fontFamily: 'Montserrat', logoDataUrl: 'data:image/png;base64,AAAA',
  source: { url: 'https://www.curam-ai.com.au/', readAt: '2026-11-06T01:00:00Z' },
};

// contrast
assert.equal(contrastRatio('#000000', '#ffffff'), 21);
assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
assert.ok(contrastRatio('#d4af37', '#0a1628') > 7);

// roles: junk is dropped; a hand-made kit falls back to its swatches
assert.equal(kitRoles(kit).accent, undefined);
assert.deepEqual(kitRoles({ colors: ['#111111', 'x', '#222222'] }), { primary: '#111111', accent: '#222222' }, 'a bad swatch is skipped, the rest are primary, accent, text in order');
assert.deepEqual(kitRoles({}), {});

// can it be built
assert.equal(canBuildDesignMd(null), false);
assert.equal(canBuildDesignMd({}), false);
assert.equal(canBuildDesignMd({ logoDataUrl: 'x' }), false, 'a logo alone is not a design');
assert.equal(canBuildDesignMd({ fontFamily: 'Inter' }), true);
assert.equal(canBuildDesignMd({ radius: { px: 0 } }), true);
assert.equal(canBuildDesignMd(kit), true);

// the full file
const md = buildDesignMd(kit, NOW);
assert.match(md, /^# Design\n/);
assert.match(md, /Read it before building any screen/);
assert.match(md, /Read from curam-ai\.com\.au on 2026-11-06 with Curam Vault/, 'the date of the reading, not of the download');
assert.match(md, /not an official brand guide/);
assert.match(md, /\| Primary \| `#d4af37` \| The brand colour/);
assert.match(md, /\| Background \| `#0a1628` \|/);
assert.ok(!md.includes('junk'));
assert.ok(!/\| Accent \|/.test(md), 'a role with no colour has no row');
assert.match(md, /Text on the background has a contrast ratio of [\d.]+:1 \(AAA\)/);
assert.match(md, /#111111 on the primary colour has a contrast ratio of [\d.]+:1\./);
assert.match(md, /\*\*Dark mode\.\*\* .*`#000000`.*`#eeeeee`.*primary `#d4af37`/);
assert.match(md, /Other colours seen on the site, most used first: `#ffffff`, `#d4af37`\./);
assert.match(md, /\*\*Headings:\*\* Montserrat, weight 600\. A copy of the font file is kept in the Vault Brand Kit/);
assert.match(md, /font-family: "Montserrat", sans-serif;/);
assert.match(md, /\*\*Body text:\*\* Inter "Display", weight 400\./);
assert.ok(!md.includes('"Inter "Display""'), 'quotes in a family name cannot break the CSS');
assert.match(md, /Corners are \*\*rounded\*\*: `border-radius: 8px`/);
assert.match(md, /```css\n:root \{\n[\s\S]*--brand-on-primary: #111111;[\s\S]*--brand-radius: 8px;[\s\S]*--brand-font-heading: "Montserrat", sans-serif;[\s\S]*\}\n```/);
assert.match(md, /logo is saved in the Vault Brand Kit/);
assert.ok(!md.includes('data:image'), 'the logo picture is never put in the file');
assert.ok(!md.includes('BrandFont17ff0821'), 'internal names stay out');
assert.ok(md.endsWith('\n'));

// weaker kits: sections are left out, not left empty
const hand = buildDesignMd({ colors: ['#9b5b46'], fontFamily: 'Montserrat' }, NOW);
assert.match(hand, /Written from the Brand Kit in Curam Vault on 2026-11-07/);
assert.match(hand, /\| Primary \| `#9b5b46` \|/);
assert.ok(!/## Shape/.test(hand) && !/Dark mode/.test(hand) && !/contrast ratio/.test(hand) && !/logo is saved/.test(hand));
assert.match(hand, /Use the heading font for body text too/);
assert.match(hand, /\*\*Headings:\*\* Montserrat\./);
assert.match(buildDesignMd({ radius: { px: 0 } }, NOW), /Corners are \*\*square\*\*/);
assert.match(buildDesignMd({ radius: { px: 999 } }, NOW), /pill-shaped.*9999px/);
assert.match(buildDesignMd({ roles: { text: '#777777', background: '#888888' } }, NOW), /below the AA minimum/);

console.log('designMd tests: ok');
