// node client/src/pages/drawings/saveDrawingToNotes.test.mjs
import assert from 'node:assert';
import { saveDrawingToNotes } from './saveDrawingToNotes.mjs';
import { pictureIds } from '../notes/notePictures.mjs';

const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
function fakeApi({ noteStatus = 201, attachStatus = 201, putStatus = 200 } = {}) {
  const calls = [];
  return {
    calls,
    post: async (url, body) => { calls.push(['post', url, body]); return noteStatus < 400 ? res(noteStatus, { id: 77 }) : res(noteStatus, { error: 'Could not create the note. Try again.' }); },
    postForm: async (url, form) => { calls.push(['postForm', url, form.get('file') && form.get('file').name]); return attachStatus < 400 ? res(attachStatus, { id: 501, filename: 'x.png' }) : res(attachStatus, { error: 'A note can have up to 20 files. Remove one first.' }); },
    put: async (url, body) => { calls.push(['put', url, body]); return putStatus < 400 ? res(putStatus, { id: 77 }) : res(putStatus, { error: 'Not found' }); },
  };
}
const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

// the happy path: note, then picture, then the text with the marker
{
  const api = fakeApi();
  const out = await saveDrawingToNotes({ api, title: 'Kitchen [v2] plan', drawingId: 12, png, projectId: 4, clientId: null });
  assert.deepStrictEqual(out, { noteId: 77, attachmentId: 501 });
  assert.deepStrictEqual(api.calls.map((c) => `${c[0]} ${c[1]}`), ['post /api/notes', 'postForm /api/notes/77/attachments', 'put /api/notes/77']);
  assert.strictEqual(api.calls[0][2].title, 'Kitchen [v2] plan');
  assert.strictEqual(api.calls[0][2].project_id, 4);
  assert.strictEqual(api.calls[0][2].client_id, null);
  assert.ok(api.calls[0][2].body.includes('(/drawings/12)') && api.calls[0][2].body.includes('[Kitchen v2 plan]'), 'a first text with the link back, brackets made safe');
  assert.strictEqual(api.calls[1][2], 'Kitchen v2 plan.png', 'the file is named after the drawing, with safe characters');
  const finalBody = api.calls[2][2].body;
  assert.deepStrictEqual(pictureIds(finalBody), [501], 'the note text shows the attached picture');
  assert.ok(finalBody.includes('[Kitchen v2 plan](/drawings/12)'));
}

// an empty title still makes a sensible note
{
  const api = fakeApi();
  await saveDrawingToNotes({ api, title: '   ', drawingId: 3, png });
  assert.strictEqual(api.calls[0][2].title, 'Diagram');
  assert.strictEqual(api.calls[1][2], 'Diagram.png');
}

// the note cannot be made: nothing else is tried
{
  const api = fakeApi({ noteStatus: 500 });
  await assert.rejects(() => saveDrawingToNotes({ api, title: 'A', drawingId: 1, png }), (e) => /Could not create the note/.test(e.message) && e.noteId === undefined);
  assert.strictEqual(api.calls.length, 1);
}

// the picture cannot be attached: the note is kept and the error says so (and carries the note's number so the page can offer to open it)
{
  const api = fakeApi({ attachStatus: 400 });
  await assert.rejects(() => saveDrawingToNotes({ api, title: 'A', drawingId: 1, png }), (e) => e.noteId === 77 && /note was saved, but the picture could not be added/.test(e.message) && /up to 20 files/.test(e.message));
  assert.strictEqual(api.calls.length, 2, 'the text was not rewritten without a picture');
}

// the text cannot be updated after the picture is attached
{
  const api = fakeApi({ putStatus: 404 });
  await assert.rejects(() => saveDrawingToNotes({ api, title: 'A', drawingId: 1, png }), (e) => e.noteId === 77 && /placed in the text/.test(e.message));
}

console.log('saveDrawingToNotes tests: all ok');
