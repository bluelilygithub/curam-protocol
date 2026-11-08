// A note can show one of its attached pictures inside its text (for example a drawing sent from Drawings). It is written the same way as a
// linked to-do ({task:512}): a plain-text marker on a line of its own, `{picture:41}`, where 41 is the attachment's number. The note stays
// plain text, so search, Ask, the AI actions, the recycle bin, Write and the Rich editor all keep it as it is (Rich shows the marker as
// text and writes it back unchanged). Only Preview turns the marker into the picture. Pure, so it is unit-tested:
//   node client/src/pages/notes/notePictures.test.mjs

const LINE = /^\s*\{picture:(\d+)\}\s*$/;
const FENCE = /^\s*(```|~~~)/;
export const PICTURE_SRC = /^vault-picture:(\d+)$/;

/** The marker for attachment `id`, as written into a note. */
export const pictureToken = (id) => `{picture:${Number(id)}}`;

/** For Preview: each marker line becomes an image "vault-picture:N" that the view draws from the attachment. Line numbers do not change, and a marker inside a code block stays as typed. */
export function pictureify(body) {
  let inFence = false;
  return String(body ?? '').split('\n').map((raw) => {
    const line = raw.replace(/\r$/, '');
    if (FENCE.test(line)) { inFence = !inFence; return raw; }
    if (inFence) return raw;
    const m = LINE.exec(line);
    return m ? `![Picture](vault-picture:${m[1]})${raw.endsWith('\r') ? '\r' : ''}` : raw;
  }).join('\n');
}

/** The attachment numbers a note's text shows as pictures (outside code blocks), in order. */
export function pictureIds(body) {
  const ids = [];
  let inFence = false;
  for (const raw of String(body ?? '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (FENCE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = LINE.exec(line);
    if (m) ids.push(Number(m[1]));
  }
  return ids;
}

/** The text of a note made from a drawing: the picture, then where it came from. `drawingPath` is a path inside Vault such as /drawings/12. */
export function drawingNoteBody({ attachmentId, title, drawingPath }) {
  const name = String(title || 'Diagram').replace(/[\[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Diagram';
  return `${pictureToken(attachmentId)}\n\nFrom the diagram [${name}](${drawingPath}).\n`;
}
