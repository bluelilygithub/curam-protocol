// "To Notes" for a sketch: the same three steps Diagrams uses, with the existing Notes routes (nothing new on the server): make the note,
// attach the picture to it, then write the picture's marker into the note's text ({picture:N}, see pages/notes/notePictures.mjs) so Preview
// shows it inside the note, with a link back to the sketch. That link is the other half of the two-way link: the note's text is what the
// sketch's "In a note" button looks for.
//
// `api` is the app's apiClient (post, postForm, put), passed in so a test can use a stand-in:
//   node client/src/pages/sketchbook/saveSketchToNotes.test.mjs
import { sketchNoteBody } from '../notes/notePictures.mjs';

const fail = (message, extra = {}) => Object.assign(new Error(message), extra);
const say = async (res, fallback) => {
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data, message: (data && data.error) || fallback };
};

/**
 * @param {{ api: object, title: string, sketchId: number, png: Blob, projectId?: number|null, clientId?: number|null }} o
 * @returns {Promise<{ noteId: number, attachmentId: number }>}
 * Throws an Error in plain words. If the note was made but the picture could not be added, the error carries `noteId` (the note is kept,
 * with its link back to the sketch, so nothing is lost; the page offers to open it).
 */
export async function saveSketchToNotes({ api, title, sketchId, png, projectId = null, clientId = null }) {
  const name = String(title || '').trim() || 'Sketch';
  const path = `/sketchbook/${sketchId}`;

  // 1. the note, its text for now being just the link back (the picture is added once it exists)
  const made = await say(await api.post('/api/notes', {
    title: name,
    body: `From the sketch [${name.replace(/[\[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()}](${path}).\n`,
    project_id: projectId || null,
    client_id: clientId || null,
  }), 'The note could not be saved. Try again.');
  if (!made.ok || !made.data || !made.data.id) throw fail(made.message);
  const noteId = made.data.id;

  // 2. the picture, attached to the note
  const form = new FormData();
  form.append('file', png, `${name.replace(/[^\w .-]+/g, '').trim().slice(0, 80) || 'sketch'}.png`);
  const attached = await say(await api.postForm(`/api/notes/${noteId}/attachments`, form), 'The picture could not be attached.');
  if (!attached.ok || !attached.data || !attached.data.id) {
    throw fail(`The note was saved, but the picture could not be added to it: ${attached.message}`, { noteId });
  }

  // 3. the note's text: the picture, then where it came from
  const wrote = await say(await api.put(`/api/notes/${noteId}`, { body: sketchNoteBody({ attachmentId: attached.data.id, title: name, sketchPath: path }) }), 'The note could not be updated.');
  if (!wrote.ok) throw fail(`The note was saved with the picture attached, but it could not be placed in the text: ${wrote.message}`, { noteId });

  return { noteId, attachmentId: attached.data.id };
}
