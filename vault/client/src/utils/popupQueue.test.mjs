import assert from 'node:assert/strict';
import { pickPopup, POPUP_PRIORITY } from './popupQueue.mjs';
const { default: usePopupStore } = await import('../store/popupStore.js');

assert.equal(pickPopup([]), null);
assert.equal(pickPopup(['wfh-hours']), 'wfh-hours');
assert.equal(pickPopup(['wfh-hours', 'morning-digest', 'task-reminder']), 'morning-digest', 'the most important goes first');
assert.equal(pickPopup(['inquiry-reminder', 'task-reminder']), 'task-reminder');
assert.equal(pickPopup(['zeta', 'alpha']), 'alpha', 'an unknown id waits behind the known ones, in a fixed order');
assert.equal(pickPopup(['zeta', 'wfh-hours']), 'wfh-hours');
assert.equal(new Set(POPUP_PRIORITY).size, POPUP_PRIORITY.length);

// the store: each popup gets its turn after the one before it is dismissed
const st = usePopupStore;
st.getState().want('wfh-hours');
st.getState().want('morning-digest');
st.getState().want('morning-digest'); // asking twice changes nothing
assert.deepEqual(st.getState().wanting, ['wfh-hours', 'morning-digest']);
assert.equal(pickPopup(st.getState().wanting), 'morning-digest');
st.getState().unwant('morning-digest');
assert.equal(pickPopup(st.getState().wanting), 'wfh-hours', 'the next one appears when the first is dismissed');
st.getState().unwant('wfh-hours');
st.getState().unwant('not-there');
assert.equal(pickPopup(st.getState().wanting), null);

console.log('popupQueue: ok');
