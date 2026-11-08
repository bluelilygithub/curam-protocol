// node client/src/pages/sketchbook/saveSketchToNotes.test.mjs
import assert from 'node:assert';
import { saveSketchToNotes } from './saveSketchToNotes.mjs';
import { pictureIds } from '../notes/notePictures.mjs';

const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
function fakeApi({ noteStatus = 201, attachStatus = 201, putStatus = 200 } = {}) {
  const calls = [];
  return {
    calls,
    post: async (url, body) => { calls.push(['post', url, body]); return noteStatus < 400 ? res(noteStatus, { id: 77 }) : res(noteStatus, { error: 'Could not create the note. Try again.' }); },
    postForm: async (url, form) => { calls.push(['postForm', url, form.get('file') && form.get('file').name]); return attachStatus < 400 ? res(attachStatus, { id: 501 }) : res(attachStatus, { error: 'A note can have up to 20 files. Remove one first.' }); },
    put: async (url, body) => { calls.push(['put', url, body]); return putStatus < 400 ? res(putStatus, { id: 77 }) : res(putStatus, { error: 'Not found' }); },
  };
}
const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

// the happy path: note, then picture, then the text with the marker and the link back
{
  const api = fakeApi();
  const out = await saveSketchToNotes({ api, title: 'Rig [day 1] deal', sketchId: 12, png, projectId: 4, clientId: null });
  assert.deepStrictEqual(out, { noteId: 77, attachmentId: 501 });
  assert.deepStrictEqual(api.calls.map((c) => `${c[0]} ${c[1]}`), ['post /api/notes', 'postForm /api/notes/77/attachments', 'put /api/notes/77']);
  assert.strictEqual(api.calls[0][2].project_id, 4);
  assert.strictEqual(api.calls[0][2].client_id, null);
  assert.ok(api.calls[0][2].body.includes('(/sketchbook/12)'), 'the first text already links back to the sketch');
  assert.strictEqual(api.calls[1][2], 'Rig day 1 deal.png', 'the file is named after the sketch, with safe characters');
  const finalBody = api.calls[2][2].body;
  assert.deepStrictEqual(pictureIds(finalBody), [501]);
  assert.ok(finalBody.includes('[Rig day 1 deal](/sketchbook/12)'));
}
// an empty title still makes a sensible note
{
  const api = fakeApi();
  await saveSketchToNotes({ api, title: '  ', sketchId: 3, png });
  assert.strictEqual(api.calls[0][2].title, 'Sketch');
  assert.strictEqual(api.calls[1][2], 'Sketch.png');
}
// the note cannot be made: nothing else is tried
{
  const api = fakeApi({ noteStatus: 500 });
  await assert.rejects(() => saveSketchToNotes({ api, title: 'A', sketchId: 1, png }), (e) => /Could not create the note/.test(e.message) && e.noteId === undefined);
  assert.strictEqual(api.calls.length, 1);
}
// the picture cannot be attached: the note is kept and the error carries its number so the page can offer to open it
{
  const api = fakeApi({ attachStatus: 400 });
  await assert.rejects(() => saveSketchToNotes({ api, title: 'A', sketchId: 1, png }), (e) => e.noteId === 77 && /note was saved, but the picture could not be added/.test(e.message) && /up to 20 files/.test(e.message));
  assert.strictEqual(api.calls.length, 2);
}
// the text cannot be updated after the picture is attached
{
  const api = fakeApi({ putStatus: 404 });
  await assert.rejects(() => saveSketchToNotes({ api, title: 'A', sketchId: 1, png }), (e) => e.noteId === 77 && /placed in the text/.test(e.message));
}
console.log('saveSketchToNotes tests: all ok');
