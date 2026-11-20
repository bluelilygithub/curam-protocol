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
}

export type BlockType = 'heading' | 'paragraph' | 'listItem' | 'tableCell' | 'pageBreak' | 'image' | 'other';

export interface Block {
  id: string;
  type: BlockType;
  level?: number; // heading level / list depth
  style?: string; // block-level style: DOCX paragraph style name, Markdown list kind / code language
  text: string;
  runs: Run[];
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
