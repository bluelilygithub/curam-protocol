import { finalize, isBinary, readText, type RawBlock } from './finalize';
import type { Reader } from './types';

export const textReader: Reader = {
  id: 'txt',
  label: 'Plain text',
  extensions: ['.txt', '.text'],
  sniff: (bytes, name) => !isBinary(bytes) && /\.(txt|text)$/i.test(name),
  async read(file) {
    const text = await readText(file);
    // paragraphs are separated by blank lines; single newlines inside a paragraph are line wraps
    const blocks: RawBlock[] = text.split(/\r?\n[ \t]*\r?\n|\r[ \t]*\r/).filter((p) => p.trim()).map((p) => ({ type: 'paragraph', text: p, runs: [{ text: p }] }));
    return finalize(file, 'txt', blocks, {});
  },
};
