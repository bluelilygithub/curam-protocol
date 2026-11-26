/** The extension point: one Reader per file type, each producing a NormalizedDoc. */
export interface Reader {
  id: string; // "pdf" | "docx" | "md" | "txt" | later "xlsx", "image"
  label: string; // shown to people: "PDF", "Word (DOCX)"
  extensions: string[];
  sniff(bytes: Uint8Array, fileName: string): boolean; // magic bytes first; extensions only for plain-text formats
  read(file: File): Promise<NormalizedDoc>;
}

export interface NormalizedDoc {
  kind: 'document'; // later: "sheet" | "image"
  sourceType: string;
  blocks: Block[];
  metadata: DocMetadata;
  pages?: PageRef[]; // PDF only
  notes?: Note[]; // footnotes, endnotes and Markdown link definitions (addendum §5.1)
  notesBestEffort?: boolean; // PDF: notes were guessed from small text at the foot of the page
}

/** A footnote, endnote or Markdown reference-link definition. Blocks point to notes by id (Block.notes). */
export interface Note {
  id: string; // "fn:2", "en:1", "link:ahuri"
  kind: 'footnote' | 'endnote' | 'link';
  label: string; // as shown to people: "1", "ahuri"
  text: string;
}

export type BlockType = 'heading' | 'paragraph' | 'listItem' | 'tableCell' | 'pageBreak' | 'image' | 'other';

export interface Block {
  id: string;
  type: BlockType; // an 'image' block's text is its alt text (web pages, DOCX), not counted as words
  level?: number; // heading level / list depth
  src?: string; // web pages read in full mode (HTML Content Check): an image's address, made absolute
  style?: string; // block-level style: DOCX paragraph style name, Markdown list kind / code language
  text: string;
  runs: Run[];
  number?: string; // automatic list number as displayed ("3.", "2.1", "(b)"): DOCX numbering, Markdown ordered lists
  notes?: string[]; // ids of the notes this block refers to (footnote marks, reference links)
  location: {
    section?: string; // nearest preceding heading text
    para?: number; // 1-based position within the section
    page?: number;
    index: number;
    table?: { t: number; r: number; c: number };
  };
}

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  font?: string;
  sizePt?: number;
  color?: string;
  style?: string;
  link?: string;
}

export interface DocMetadata {
  fileName: string;
  fileSizeBytes: number;
  lastModified: Date;
  created?: Date;
  modified?: Date;
  author?: string;
  lastModifiedBy?: string;
  revision?: string;
  title?: string;
  producer?: string;
  application?: string;
  pageCount?: number;
  wordCount: number;
  charCount: number;
  headingCount: number;
  tableCount: number;
  imageCount: number;
  referenceCount?: number; // reference-list entries (set by the comparison, not the reader)
  noteCount?: number; // footnotes and endnotes
  url?: string; // web pages: the page's address, when the file records it
  extraction?: string; // web pages: where the main content was taken from
}

export interface PageRef {
  number: number; // 1-based
  text: string; // used to align pages when page counts differ
}

/** A stop at Gate 1 (or an unreadable file). `message` is shown to people as is. */
export class GateError extends Error {
  constructor(public code: 'type-mismatch' | 'unsupported' | 'password' | 'corrupt' | 'no-text' | 'legacy-doc', message: string) {
    super(message);
    this.name = 'GateError';
  }
}
