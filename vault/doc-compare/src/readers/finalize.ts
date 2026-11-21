import type { Block, DocMetadata, NormalizedDoc, Note, PageRef } from './types';

export type RawBlock = Omit<Block, 'id' | 'location'> & { location?: Partial<Block['location']> };
type ReaderMeta = Partial<Omit<DocMetadata, 'fileName' | 'fileSizeBytes' | 'lastModified' | 'wordCount' | 'charCount' | 'headingCount' | 'tableCount' | 'imageCount'>>;

export const countWords = (s: string) => (s.match(/\S+/g) ?? []).length;

/** Fills ids, index, section, per-section paragraph numbers and the counts every reader shares. */
export function finalize(file: File, sourceType: string, raw: RawBlock[], meta: ReaderMeta, pages?: PageRef[], notes?: Note[]): NormalizedDoc {
  let section: string | undefined;
  let para = 0;
  const tables = new Set<number>();
  let words = 0, chars = 0, headings = 0, images = 0;
  const blocks: Block[] = raw.map((b, index) => {
    if (b.type === 'heading') { section = b.text.trim().slice(0, 80) || section; para = 0; headings++; }
    else if (b.type !== 'pageBreak') para++;
    if (b.type === 'image') images++;
    if (b.location?.table) tables.add(b.location.table.t);
    words += countWords(b.text);
    chars += b.text.length;
    return { ...b, id: `b${index}`, location: { ...b.location, index, section: b.type === 'heading' ? undefined : section, para: b.type === 'heading' ? undefined : para } };
  });
  return {
    kind: 'document',
    sourceType,
    blocks,
    pages,
    ...(notes?.length ? { notes } : {}),
    metadata: {
      fileName: file.name,
      fileSizeBytes: file.size,
      lastModified: new Date(file.lastModified),
      ...meta,
      wordCount: words,
      charCount: chars,
      headingCount: headings,
      tableCount: tables.size,
      imageCount: images,
    },
  };
}

export const isBinary = (bytes: Uint8Array) => bytes.subarray(0, 8192).includes(0);

export async function readText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // UTF-16 with BOM, else UTF-8 (lenient: bad bytes become U+FFFD instead of failing)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
}
