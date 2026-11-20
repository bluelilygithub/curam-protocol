import { READERS } from '../readers/registry';
import { GateError, type Reader } from '../readers/types';

const ext = (name: string) => (/\.[^.]+$/.exec(name)?.[0] ?? '').toLowerCase();

/** Identifies one file's type from its first bytes (and the extension for text formats). Throws GateError if unsupported. */
export async function detectType(file: File): Promise<Reader> {
  // DOCX needs the ZIP's entry names; the central directory sits at the end, so read both ends of big files
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  const tail = file.size > 65536 ? new Uint8Array(await file.slice(Math.max(65536, file.size - 65536)).arrayBuffer()) : new Uint8Array();
  const bytes = new Uint8Array(head.length + tail.length);
  bytes.set(head); bytes.set(tail, head.length);
  const found = READERS.find((r) => r.sniff(bytes, file.name));
  if (found) return found;
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
    throw new GateError('legacy-doc', `${file.name} is a legacy Word (.doc) file. Re-save it as .docx and try again.`);
  }
  if (head[0] === 0x50 && head[1] === 0x4b) throw new GateError('unsupported', `${file.name} is a ZIP-based file that isn't a Word document (supported: PDF, DOCX, Markdown, plain text).`);
  if (!head.subarray(0, 8192).includes(0) && !ext(file.name)) {
    throw new GateError('unsupported', `${file.name} has no extension. Name it .txt or .md so it can be compared.`);
  }
  throw new GateError('unsupported', `${file.name} isn't a supported type (${ext(file.name) || 'unknown'}). Supported: PDF, DOCX, Markdown (.md), plain text (.txt).`);
}

/** Gate 1: both files must be the same supported type. */
export async function checkFileTypes(original: File, edited: File): Promise<Reader> {
  const [a, b] = await Promise.all([detectType(original), detectType(edited)]);
  if (a.id !== b.id) throw new GateError('type-mismatch', `Original is ${a.label}, edited is ${b.label} — both files must be the same type.`);
  return a;
}
