import { docxReader } from './docx';
import { markdownReader } from './markdown';
import { pdfReader } from './pdf';
import { textReader } from './text';
import type { Reader } from './types';

/** Binary formats first: their magic bytes decide; text formats fall back to the extension. Add a new type here. */
export const READERS: Reader[] = [pdfReader, docxReader, markdownReader, textReader];

export function findReader(id: string): Reader | undefined {
  return READERS.find((r) => r.id === id);
}
