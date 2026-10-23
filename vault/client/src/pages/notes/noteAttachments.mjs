// Files on a note: what may be attached, how to word a size, and what to do with a file when it is opened.
// Pure (no React, no fetch) so it is unit-tested: node client/src/pages/notes/noteAttachments.test.mjs
// The limits mirror the server's (server/utils/attachments.js, server/routes/notes.js); the server is the one that enforces them.

export const MAX_FILES = 20;
export const MAX_BYTES = 50 * 1024 * 1024;
export const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.txt', '.json', '.csv', '.md', '.xlsx', '.xls', '.docx', '.doc', '.pptx', '.ppt'];
export const ACCEPT = ALLOWED_EXTENSIONS.join(',');
// The kinds whose text Ask your notes can read (server/services/noteFileText.js); photos, scans and old .doc / .ppt files cannot be read.
export const READABLE_EXTENSIONS = ['.txt', '.md', '.json', '.csv', '.pdf', '.docx', '.xlsx', '.xls', '.pptx'];

const extensionOf = (name) => { const m = /\.[^.\\/]+$/.exec(String(name || '').toLowerCase()); return m ? m[0] : ''; };

/** "12 bytes", "4.0 KB", "1.2 MB" */
export function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} byte${n === 1 ? '' : 's'}`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** '' when this file can be attached, or the reason it cannot (so a bad file is refused on the screen before it is sent). `have` = files already on the note. */
export function fileProblem(file, have = 0) {
  if (!file || !file.name) return 'that is not a file.';
  if (have >= MAX_FILES) return `a note can have up to ${MAX_FILES} files. Remove one first.`;
  if (file.size === 0) return 'the file is empty.';
  if (file.size > MAX_BYTES) return `it is over ${MAX_BYTES / (1024 * 1024)} MB.`;
  if (!ALLOWED_EXTENSIONS.includes(extensionOf(file.name))) return 'that kind of file cannot be attached. PDF, images, text, CSV and Office documents can.';
  return '';
}

/** Whether Ask your notes can (or could) read inside this file: what the server found if it has looked (`readable`), else by the kind of file. */
export const askCanRead = (att) => (typeof att?.readable === 'boolean' ? att.readable : READABLE_EXTENSIONS.includes(extensionOf(att?.filename)));

/** 'image' | 'pdf' | 'sheet' | 'doc' | 'slides' | 'text' | 'file', from the file's type or name. */
export function kindOf(att) {
  const type = String(att?.mimeType || '').toLowerCase();
  const ext = extensionOf(att?.filename);
  if (type.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) return 'image';
  if (type === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (['.xlsx', '.xls', '.csv'].includes(ext) || type.includes('spreadsheet') || type === 'application/vnd.ms-excel' || type === 'text/csv') return 'sheet';
  if (['.docx', '.doc'].includes(ext) || type.includes('wordprocessing') || type === 'application/msword') return 'doc';
  if (['.pptx', '.ppt'].includes(ext) || type.includes('presentation') || type === 'application/vnd.ms-powerpoint') return 'slides';
  if (type.startsWith('text/') || ['.txt', '.md', '.json'].includes(ext)) return 'text';
  return 'file';
}

/** Whether a browser can show it in a tab (images, PDF, text); anything else is saved as a download. */
export const isViewable = (att) => ['image', 'pdf', 'text'].includes(kindOf(att)) && !/\.csv$/i.test(att?.filename || '');

/** The icon name (from the shared icon map) for a kind of file. */
export const ICONS = { image: 'image', pdf: 'file-text', sheet: 'file', doc: 'file-text', slides: 'file', text: 'file-text', file: 'file' };
