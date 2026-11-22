// node client/src/pages/presentations/slideshowKeys.test.mjs
import assert from 'node:assert/strict';
import { clampSlide, keyStep, fitScale, slidePages } from './slideshowKeys.mjs';

const at = (index, digits = '') => ({ index, count: 12, digits });

// moving
assert.equal(keyStep('ArrowRight', at(0)).index, 1);
assert.equal(keyStep(' ', at(3)).index, 4, 'space goes forward');
assert.equal(keyStep('PageDown', at(11)).index, 11, 'stops at the last slide');
assert.equal(keyStep('ArrowLeft', at(0)).index, 0, 'stops at the first slide');
assert.equal(keyStep('Backspace', at(5)).index, 4);
assert.equal(keyStep('Home', at(7)).index, 0);
assert.equal(keyStep('End', at(2)).index, 11);
assert.equal(keyStep('Enter', at(2)).index, 3, 'Enter with no number goes forward');

// jumping: type a number, then Enter
let s = keyStep('1', at(0));
assert.deepEqual([s.index, s.digits], [0, '1'], 'a digit waits for Enter');
s = keyStep('0', { ...at(0), digits: s.digits });
s = keyStep('Enter', { ...at(0), digits: s.digits });
assert.deepEqual([s.index, s.digits], [9, ''], '10 Enter shows slide 10');
assert.equal(keyStep('Enter', at(0, '99')).index, 11, 'a number past the end shows the last slide');
assert.equal(keyStep('Enter', at(4, '0')).index, 0);
assert.equal(keyStep('ArrowRight', at(4, '7')).digits, '', 'moving clears a half-typed number');

// leaving and other keys
assert.equal(keyStep('Escape', at(4)).exit, true);
assert.deepEqual(keyStep('x', at(4, '2')), { index: 4, digits: '2', exit: false });
assert.equal(clampSlide(5, 0), 0);

// fitting a slide to the screen
assert.equal(fitScale(1280, 720, 2560, 1440), 2);
assert.equal(fitScale(1280, 720, 1280, 1024), 1, 'a taller screen is limited by width');
assert.equal(fitScale(0, 720, 100, 100), 1);

// splitting the renderer's page into one page per slide (a tiny stand-in for DOMParser)
const fakeParse = () => ({
  querySelectorAll: (sel) => (sel === 'style'
    ? [{ textContent: '.slide{color:red}' }]
    : [{ outerHTML: '<section class="slide a">1</section>' }, { outerHTML: '<section class="slide b">2</section>' }]),
});
const pages = slidePages('<html>…</html>', fakeParse);
assert.equal(pages.length, 2);
assert.ok(pages[0].includes('.slide{color:red}') && pages[0].includes('class="slide a"') && !pages[0].includes('class="slide b"'));

console.log('presentations slideshow: ok');
