import { useState, useRef, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useIcon } from '../providers/IconProvider';
import api from '../utils/apiClient';
import useProcessingStore from '../store/processingStore';
import Tooltip from '../components/Tooltip';
// Vite copies this to the build output and returns a same-origin URL,
// which satisfies script-src 'self' and avoids blob: worker CSP issues.
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// ─── Fonts available in the field designer, grouped for the picker ─────────────
// pdf-lib's 14 built-in "standard" PDF fonts only — no fetching, no embedding,
// no fontkit. These are guaranteed present in every PDF viewer (they're part
// of the PDF spec) and render identically everywhere. Google Fonts were tried
// here previously and abandoned: correctly embedding a custom TTF still hit
// three separate dead ends — Chrome/Edge/Adobe Reader all substitute a
// default font for a *form field's* embedded custom font at render/edit time
// regardless of correct embedding, and fontkit itself threw a hard
// "Offset is outside the bounds of the DataView" parse crash on certain
// Google Font files. Standard fonts have none of these failure modes.
const STANDARD_FONT_GROUPS = {
  'Sans Serif': ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
  'Serif': ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
  'Monospace': ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
};
const STANDARD_FONT_LABELS = {
  Helvetica: 'Helvetica', HelveticaBold: 'Helvetica Bold', HelveticaOblique: 'Helvetica Italic', HelveticaBoldOblique: 'Helvetica Bold Italic',
  TimesRoman: 'Times Roman', TimesRomanBold: 'Times Roman Bold', TimesRomanItalic: 'Times Roman Italic', TimesRomanBoldItalic: 'Times Roman Bold Italic',
  Courier: 'Courier', CourierBold: 'Courier Bold', CourierOblique: 'Courier Italic', CourierBoldOblique: 'Courier Bold Italic',
};
// Best-effort CSS approximation so the canvas preview and <option> text look
// close to the real font — these are system/web-safe fonts, no loading needed.
const STANDARD_FONT_CSS = {
  Helvetica: 'Helvetica, Arial, sans-serif',
  TimesRoman: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
};
function standardFontCss(family) {
  const base = family.replace(/(Bold|Oblique|Italic)/g, '');
  const style = /Oblique|Italic/.test(family) ? 'italic ' : '';
  const weight = /Bold/.test(family) ? 'bold ' : '';
  return { fontFamily: STANDARD_FONT_CSS[base] || 'sans-serif', fontStyle: /Oblique|Italic/.test(family) ? 'italic' : 'normal', fontWeight: /Bold/.test(family) ? 'bold' : 'normal' };
}

// Script/decorative Google Fonts — allowed ONLY where the server stamps the
// value as static page text (page.drawText), never on a live AcroForm field
// (Fill Form's flatten mode, and a field-designer "text" field with a value
// typed in). Chrome/Edge/Adobe Reader substitute a default font for a form
// field's embedded custom font regardless of correct embedding, so these
// aren't offered for dropdown fields or an empty fillable text field —
// picking one there falls back to Helvetica server-side. List matches
// server/routes/pdf.js SCRIPT_FONTS exactly — each entry manually verified
// against a real page.drawText() call; Dancing Script was tested and
// excluded (fontkit hard-crashes parsing its TTF regardless of what's drawn).
const SCRIPT_FONTS = ['Pacifico', 'Lobster', 'Great Vibes', 'Sacramento', 'Alex Brush', 'Allura', 'Satisfy', 'Kalam', 'Caveat', 'Homemade Apple'];
const STAMP_FONT_GROUPS = { Script: SCRIPT_FONTS, ...STANDARD_FONT_GROUPS };
// Client-side CSS approximation for the picker/canvas preview only — the
// actual embedded font is fetched server-side at generation time. Loads a
// Google Fonts <link> lazily, once per family, purely for this preview.
const _loadedFontLinks = new Set();
function ensureGoogleFontLoaded(family) {
  if (!family || _loadedFontLinks.has(family)) return;
  _loadedFontLinks.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400&display=swap`;
  document.head.appendChild(link);
}
function fontCss(family) {
  if (SCRIPT_FONTS.includes(family)) {
    ensureGoogleFontLoaded(family);
    return { fontFamily: `"${family}", cursive`, fontStyle: 'normal', fontWeight: 'normal' };
  }
  return standardFontCss(family);
}

// ─── Tool catalogue ────────────────────────────────────────────────────────────

const TOOL_HELP = {
  merge: {
    title: 'Merge PDFs',
    what: 'Combine multiple PDF files into a single document in the order you choose.',
    features: [
      'Upload any number of PDFs',
      'Drag to reorder files before merging',
      'All pages from each file are included',
      'Download the merged result as a single PDF',
    ],
  },
  split: {
    title: 'Split PDF',
    what: 'Extract a subset of pages from a PDF into a new, smaller document.',
    features: [
      'Specify individual pages (e.g. 3, 5)',
      'Specify page ranges (e.g. 1-4)',
      'Mix pages and ranges (e.g. 1-3, 5, 8-10)',
      'Source document is never modified',
    ],
  },
  rotate: {
    title: 'Rotate Pages',
    what: 'Rotate all pages or specific pages in a PDF by 90°, 180°, or 270°.',
    features: [
      'Rotate all pages at once',
      'Target specific pages or ranges',
      'Choose clockwise rotation angle',
      'Rotation is cumulative with any existing page rotation',
    ],
  },
  img2pdf: {
    title: 'Images → PDF',
    what: 'Pack one or more images (JPG, PNG, WebP, etc.) into a PDF document.',
    features: [
      'Supports JPG, PNG, WebP, GIF, AVIF, and TIFF',
      'Choose page size: A4, A3, Letter, Legal, or Fit to image',
      'Set a margin around each image',
      'Images are scaled to fit the page while preserving aspect ratio',
      'Each image becomes its own page',
    ],
  },
  extracttext: {
    title: 'Extract Text',
    what: 'Pull all the text content out of a PDF so you can copy, search, or reuse it.',
    features: [
      'Works entirely in your browser — nothing is uploaded',
      'Extracts text from all pages',
      'Copy extracted text to clipboard with one click',
      'Save the text as a .txt file',
    ],
  },
  watermark: {
    title: 'Watermark',
    what: 'Stamp a diagonal text watermark across every page of a PDF.',
    features: [
      'Customise watermark text',
      'Adjust font size, opacity, colour and rotation angle',
      'Applied to every page automatically',
      'Subtle and professional defaults (CONFIDENTIAL, 20% opacity)',
    ],
  },
  pagenumbers: {
    title: 'Page Numbers',
    what: 'Add page number labels to the header or footer of every page.',
    features: [
      'Flexible format: {n}, Page {n}, {n} of {total}, and more',
      'Choose position: bottom-center, bottom-right, bottom-left, top-center, top-right, top-left',
      'Set starting number (e.g. start at 3)',
      'Adjustable font size and margin',
    ],
  },
  inspect: {
    title: 'Inspect Form Fields',
    what: 'List every interactive form field in a PDF — name, type, current value, and flags.',
    features: [
      'Detects text fields, checkboxes, dropdowns, radio groups, and option lists',
      'Shows current value if pre-filled',
      'Flags required and read-only fields',
      'Useful before filling or flattening a form',
    ],
  },
  fill: {
    title: 'Fill Form',
    what: 'Automatically fill in form fields in a PDF and download the completed document.',
    features: [
      'Loads form fields automatically on upload',
      'Fill text fields, check/uncheck checkboxes, select dropdown options',
      'Fields left blank in the editor are left unchanged',
      'Download the completed PDF',
    ],
  },
  flatten: {
    title: 'Flatten Form',
    what: 'Convert all interactive form fields into static content, locking in their current values.',
    features: [
      'Makes forms non-editable — values become part of the page',
      'Useful before sending a signed or completed form',
      'Reduces file complexity and removes interactive elements',
    ],
  },
  metadata: {
    title: 'Metadata',
    what: 'View and edit the document metadata embedded in a PDF (title, author, subject, etc.).',
    features: [
      'Reads: title, author, subject, keywords, creator, producer, creation date',
      'Edit title, author, subject, keywords, and creator',
      'Download the updated PDF with new metadata',
      'Producer and dates are read-only (set by the PDF engine)',
    ],
  },
  fileinfo: {
    title: 'File Info',
    what: 'Display basic information about a PDF file without uploading it to the server.',
    features: [
      'File name, size and last-modified date',
      'Page count (read via browser PDF engine)',
      'MIME type confirmation',
      'Fully client-side — nothing leaves your device',
    ],
  },
  fielddesigner: {
    title: 'Add Form Fields',
    what: 'Draw interactive form fields directly onto any PDF page. Drag a rectangle to place a field, then name it and configure its type.',
    features: [
      'Renders each PDF page as a canvas in your browser',
      'Drag to draw field bounding boxes — precise pixel-level placement',
      'Three field types: Text, Checkbox, Dropdown',
      'Choose font (25 Google Fonts), size, and text colour per field',
      'Control border on/off, colour, and width per field',
      'Text fields can be flagged as multiline or required',
      'Dropdown fields accept a custom options list',
      'Fields are saved as real AcroForm fields (fillable in any PDF reader)',
    ],
    workflow: [
      'After downloading: open in any PDF viewer (Preview, Acrobat, Chrome, Edge) to fill in fields and save.',
      'To fill fields inside Vault: upload the form to the "Fill Form" tool, enter values, download the result.',
      'To lock filled values permanently: run the filled PDF through the "Flatten" tool.',
    ],
  },
  text2pdf: {
    title: 'Text → PDF',
    what: 'Paste formatted text — copied from anywhere — into a text box and generate a PDF.',
    features: [
      'Supports lightweight markdown: # / ## / ### headings, **bold**, and - bullet lines',
      'Optional document title, rendered as a heading with a divider',
      'Blank lines separate paragraphs',
      'No file upload needed — just paste and generate',
    ],
  },
  officetopdf: {
    title: 'Office → PDF',
    what: 'Convert Microsoft Office and OpenDocument files to PDF using LibreOffice on the server.',
    features: [
      'Supports Word (.docx, .doc, .odt, .rtf)',
      'Supports Excel (.xlsx, .xls, .ods, .csv)',
      'Supports PowerPoint (.pptx, .ppt, .odp)',
      'High-fidelity conversion via LibreOffice — preserves formatting, tables, and images',
      'Result opens as a full PDF preview',
    ],
  },
  pdftooffice: {
    title: 'PDF → Word',
    what: 'Convert a PDF to an editable Word document (.docx) or plain-text file using LibreOffice.',
    features: [
      'Best for text-heavy PDFs — layout fidelity varies for complex designs',
      'Outputs .docx (Word), .odt (OpenDocument), or .txt (plain text)',
      'Uses LibreOffice — no cloud service, no file size restrictions beyond server memory',
      'Result downloads immediately',
    ],
  },
  googletopdf: {
    title: 'Google Drive → PDF',
    what: 'Export any Google Doc, Sheet, or Slide from your Drive as a PDF — no manual download needed.',
    features: [
      'Paste a Google Docs / Sheets / Slides URL and click Export',
      'Uses your connected Google account — requires Google sign-in via Settings',
      'Also converts Office files stored in Google Drive via LibreOffice',
      'Result opens as a full PDF preview',
      'Note: if you recently connected Google, you may need to reconnect to grant Drive read access',
    ],
  },
  organize: {
    title: 'Organize Pages',
    what: 'Reorder, delete, insert, or extract pages from a PDF using page thumbnails.',
    features: [
      'Renders every page as a thumbnail in your browser',
      'Drag thumbnails to reorder pages',
      'Delete a page with an inline Yes/No confirm',
      'Insert all pages from a second PDF by dragging its thumbnails into the list',
      'Extract any single page as its own PDF with one click',
      'Apply once to download the reorganized document',
    ],
  },
  sign: {
    title: 'Fill & Sign',
    what: 'Place a signature, date, or initials directly onto any PDF page — no form fields required.',
    features: [
      'Draw a signature with your mouse or finger on a small pad',
      'Type your name and render it in a cursive font',
      'Upload a photo of a wet signature',
      "Add a one-click today's-date stamp or initials",
      'Drag to position and resize each signature on the page',
      'Signatures are burned into the page content — immune to viewer font substitution',
    ],
  },
  annotate: {
    title: 'Annotate / Markup',
    what: 'Mark up a PDF with highlights, strikeouts, freehand drawing, sticky notes, and text boxes — then burn everything into the page.',
    features: [
      'Highlight — semi-transparent coloured box over text or any area',
      'Strikeout — a line through selected text',
      'Freehand draw — pen tool with adjustable colour and width',
      'Sticky note — a small icon that opens to show a text comment (a real PDF comment where supported)',
      'Text box — a typed comment placed directly on the page',
      'Undo/redo up to 20 steps, per page',
      'Navigate multi-page PDFs — annotations persist per page as you go',
      'Apply once to burn every mark into the PDF and download it',
    ],
  },
  compare: {
    title: 'Compare PDFs',
    what: 'Highlight the differences between two PDFs, page by page.',
    features: [
      'Visual diff — renders both PDFs to canvas and highlights changed regions in red',
      'Text diff — extracts text from both PDFs and shows added/removed lines',
      'Page-by-page navigation for both tabs',
      'Adjustable sensitivity for the visual diff',
      'Nothing about either file is stored — the comparison happens per request',
    ],
  },
  protect: {
    title: 'Password Protect',
    what: 'Encrypt a PDF with a password so it can only be opened with that password.',
    features: [
      'Set the password required to open the file',
      'Optional separate owner password (defaults to the same password)',
      'Optional restrictions: allow/disallow printing, copying, and editing',
      '256-bit AES encryption via qpdf',
    ],
  },
  unprotect: {
    title: 'Remove Password',
    what: 'Decrypt a password-protected PDF once you know its password.',
    features: [
      'Enter the current password to unlock the file',
      'Clear error if the password is wrong',
      'Download the same PDF with encryption removed',
    ],
  },
  compress: {
    title: 'Compress PDF',
    what: "Shrink a PDF's file size with a safe structural pass, plus an optional deeper image recompression.",
    features: [
      'Baseline pass reorganizes internal PDF structure with zero quality loss',
      'Optional "Recompress images" re-encodes JPEG images at Low/Medium/High quality',
      'Only re-encodes images it can safely handle — anything risky is left untouched',
      'Shows original size, new size, and % saved before you download',
    ],
  },
};

const MODES = [
  { id: 'merge',        label: 'Merge',           icon: 'combine'     },
  { id: 'split',        label: 'Split',            icon: 'scissors'    },
  { id: 'rotate',       label: 'Rotate Pages',     icon: 'rotate-cw'   },
  { id: 'organize',     label: 'Organize Pages',   icon: 'layout-grid' },
  { id: 'img2pdf',      label: 'Images → PDF',     icon: 'file-image'  },
  { id: 'text2pdf',     label: 'Text → PDF',       icon: 'file-text'   },
  { id: 'extracttext',  label: 'Extract Text',     icon: 'type'        },
  { id: 'officetopdf',  label: 'Office → PDF',     icon: 'file-up'     },
  { id: 'pdftooffice',  label: 'PDF → Word',       icon: 'file-down'   },
  { id: 'googletopdf',  label: 'Google Drive → PDF', icon: 'cloud'     },
  { id: 'watermark',    label: 'Watermark',        icon: 'droplets'    },
  { id: 'pagenumbers',  label: 'Page Numbers',     icon: 'hash'        },
  { id: 'compress',     label: 'Compress',         icon: 'compress'    },
  { id: 'inspect',      label: 'Inspect Fields',   icon: 'list'        },
  { id: 'fill',         label: 'Fill Form',        icon: 'file-pen'    },
  { id: 'sign',         label: 'Fill & Sign',      icon: 'pen-tool'    },
  { id: 'annotate',     label: 'Annotate',         icon: 'highlighter' },
  { id: 'flatten',      label: 'Flatten',          icon: 'layers'      },
  { id: 'fielddesigner', label: 'Add Fields',      icon: 'pen-line'    },
  { id: 'compare',      label: 'Compare',          icon: 'columns'     },
  { id: 'protect',      label: 'Password Protect', icon: 'lock'        },
  { id: 'unprotect',    label: 'Remove Password',  icon: 'unlock'      },
  { id: 'metadata',     label: 'Metadata',         icon: 'info'        },
  { id: 'fileinfo',     label: 'File Info',        icon: 'file-text'   },
];

const MODE_GROUPS = [
  { label: 'Organise', ids: ['merge', 'split', 'rotate', 'organize'] },
  { label: 'Convert',  ids: ['img2pdf', 'text2pdf', 'extracttext', 'officetopdf', 'pdftooffice', 'googletopdf'] },
  { label: 'Edit',     ids: ['watermark', 'pagenumbers', 'compress', 'protect', 'unprotect'] },
  { label: 'Forms',    ids: ['inspect', 'fill', 'sign', 'annotate', 'flatten', 'fielddesigner'] },
  { label: 'Analyse',  ids: ['metadata', 'fileinfo', 'compare']     },
];

// ─── Utilities ─────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function downloadFile(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename || 'document.pdf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Decode a data URL to Uint8Array without fetch() (avoids CSP connect-src restrictions).
function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function initPdfjsWorker(pdfjsLib) {
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
  }
}

async function getPdfPageCount(dataUrl) {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    await initPdfjsWorker(pdfjsLib);
    const doc = await pdfjsLib.getDocument({ data: dataUrlToUint8Array(dataUrl) }).promise;
    return doc.numPages;
  } catch {
    return null;
  }
}

// Renders every page of a PDF to a small PNG thumbnail — used by Organize Pages.
// Same pdfjs-dist render-to-canvas technique as the field designer / preview,
// just at thumbnail scale and run once per page up front.
async function renderPdfThumbnails(dataUrl, maxWidth = 110) {
  const pdfjsLib = await import('pdfjs-dist');
  await initPdfjsWorker(pdfjsLib);
  const doc = await pdfjsLib.getDocument({ data: dataUrlToUint8Array(dataUrl) }).promise;
  const thumbs = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const baseVp = page.getViewport({ scale: 1 });
    const scale = maxWidth / baseVp.width;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    thumbs.push(canvas.toDataURL('image/png'));
  }
  return thumbs;
}

// True if a canvas has no non-transparent pixels — used to stop an empty
// signature pad being submitted as a stamp.
function isCanvasBlank(canvas) {
  if (!canvas) return true;
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
  return true;
}

// ─── Shared sub-components ─────────────────────────────────────────────────────

function ToolHeader({ id, label, badge, onHelp, getIcon }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-1.5">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{label}</h2>
        <button
          type="button"
          onClick={() => onHelp(id)}
          className="hover:opacity-60 transition-opacity flex-shrink-0"
          style={{ color: 'var(--color-muted)' }}
        >
          {getIcon('help-circle', { size: 13 })}
        </button>
      </div>
      {badge && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}>{badge}</span>}
    </div>
  );
}

function PdfUpload({ label, accept = '.pdf', multiple = false, onChange, files, onRemove }) {
  const inputRef = useRef();
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (!e.dataTransfer.files?.length) return;
    onChange({ target: { files: e.dataTransfer.files, value: '' } });
  };

  return (
    <div>
      {label && <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--color-muted)' }}>{label}</p>}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className="w-full flex items-center justify-center gap-2 py-6 rounded-xl border-2 border-dashed text-sm transition-opacity"
        style={{
          borderColor: dragOver ? 'var(--color-primary)' : 'var(--color-border)',
          color: dragOver ? 'var(--color-primary)' : 'var(--color-muted)',
          background: 'var(--color-bg)',
          opacity: dragOver ? 0.8 : 1,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        {dragOver ? 'Drop to upload' : (multiple ? 'Click or drag PDFs here' : 'Click or drag file here')}
      </button>
      <input ref={inputRef} type="file" accept={accept} multiple={multiple} className="hidden" onChange={onChange} />
      {files && files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li key={i} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
              <span className="truncate max-w-[200px]">{f.name}</span>
              <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                {f.size && <span style={{ color: 'var(--color-muted)' }}>{formatBytes(f.size)}</span>}
                {f.pageCount && <span style={{ color: 'var(--color-muted)' }}>{f.pageCount}pp</span>}
                {onRemove && (
                  <button type="button" onClick={() => onRemove(i)} className="hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>×</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── PdfPagePreview — renders a PDF data URL to a navigable canvas ──────────────
function PdfPagePreview({ dataUrl, maxWidth = 540 }) {
  const canvasRef = useRef(null);
  const pdfDocRef = useRef(null);
  const [pg, setPg] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('idle'); // 'idle'|'loading'|'ready'|'error'|'locked'
  const [errMsg, setErrMsg] = useState('');

  // Render a single page to the canvas.
  // Defined as a plain async function (not useCallback) so it always closes over
  // the current canvasRef without needing to be in the useEffect dep array.
  async function drawPage(doc, pageNum) {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return;
    const page = await doc.getPage(pageNum);
    const baseVp = page.getViewport({ scale: 1 });
    const scale = Math.min(maxWidth / baseVp.width, 2);
    const vp = page.getViewport({ scale });
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  }

  useEffect(() => {
    if (!dataUrl) {
      pdfDocRef.current = null;
      setTotal(0); setPg(1);
      setStatus('idle'); setErrMsg('');
      return;
    }
    let cancelled = false;
    setStatus('loading'); setErrMsg('');
    (async () => {
      try {
        const lib = await import('pdfjs-dist');
        if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
        const doc = await lib.getDocument({ data: dataUrlToUint8Array(dataUrl) }).promise;
        if (cancelled) return;
        pdfDocRef.current = doc;
        setTotal(doc.numPages);
        setPg(1);
        await drawPage(doc, 1);
        if (!cancelled) setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          // pdfjs can't open an encrypted PDF without its password — that's an
          // expected state here (previewing a just-protected or still-locked
          // file), not a real failure, so it gets its own neutral message
          // instead of the red "Preview failed" error state.
          if (e?.name === 'PasswordException') {
            setStatus('locked');
          } else {
            console.error('PdfPagePreview:', e);
            setErrMsg(e?.message || String(e));
            setStatus('error');
          }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [dataUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = async (n) => {
    if (!pdfDocRef.current || n < 1 || n > total) return;
    setPg(n);
    setStatus('loading');
    try { await drawPage(pdfDocRef.current, n); setStatus('ready'); }
    catch (e) { setErrMsg(e?.message || String(e)); setStatus('error'); }
  };

  if (!dataUrl) return (
    <div className="flex items-center justify-center rounded-xl border-2 border-dashed" style={{ minHeight: 200, borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
      <span className="text-sm">Upload a PDF to see a preview</span>
    </div>
  );

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      {status === 'loading' && (
        <div className="flex items-center justify-center" style={{ minHeight: 160 }}>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Rendering preview…</span>
        </div>
      )}
      {status === 'error' && (
        <div className="flex flex-col items-center justify-center gap-1 p-4" style={{ minHeight: 120 }}>
          <span className="text-xs font-medium" style={{ color: '#ef4444' }}>Preview failed</span>
          {errMsg && <span className="text-xs text-center" style={{ color: 'var(--color-muted)' }}>{errMsg}</span>}
        </div>
      )}
      {status === 'locked' && (
        <div className="flex flex-col items-center justify-center gap-1 p-4" style={{ minHeight: 120, color: 'var(--color-muted)' }}>
          <span style={{ opacity: 0.7 }}>🔒</span>
          <span className="text-xs font-medium text-center">This PDF is password-protected</span>
          <span className="text-xs text-center">No preview available until it's unlocked — you can still download it.</span>
        </div>
      )}
      {/* Canvas is always in the DOM once dataUrl is set so canvasRef stays valid.
          Hidden while loading/errored so a zero-size blank canvas isn't visible. */}
      <canvas
        ref={canvasRef}
        style={{ display: status === 'ready' ? 'block' : 'none', maxWidth: '100%' }}
      />
      {total > 1 && status === 'ready' && (
        <div className="flex items-center justify-center gap-2 py-2 border-t text-xs" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={() => goTo(pg - 1)} disabled={pg <= 1} className="px-2 py-0.5 rounded disabled:opacity-30 hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>◀</button>
          <span style={{ color: 'var(--color-muted)' }}>Page {pg} of {total}</span>
          <button onClick={() => goTo(pg + 1)} disabled={pg >= total} className="px-2 py-0.5 rounded disabled:opacity-30 hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>▶</button>
        </div>
      )}
    </div>
  );
}

// ── PasswordField — password input with a show/hide (eye) toggle ───────────────
function PasswordField({ value, onChange, placeholder, className, style, getIcon, tooltipText }) {
  const [show, setShow] = useState(false);
  const field = (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        className={`${className} pr-9`}
        style={style}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        autoComplete="new-password"
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        tabIndex={-1}
        className="absolute right-2 top-1/2 -translate-y-1/2 hover:opacity-60"
        style={{ color: 'var(--color-muted)' }}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {getIcon(show ? 'eye-off' : 'eye', { size: 15 })}
      </button>
    </div>
  );
  return tooltipText ? <Tooltip text={tooltipText}>{field}</Tooltip> : field;
}

// ── PdfResultModal — full-screen modal showing a rendered result PDF ────────────
function PdfResultModal({ dataUrl, filename, meta, onClose, getIcon }) {
  if (!dataUrl) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl shadow-2xl flex flex-col"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', width: '100%', maxWidth: 820, maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <div className="min-w-0 mr-4">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{filename || 'result.pdf'}</p>
            {meta && <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{meta}</p>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => downloadFile(dataUrl, filename || 'result.pdf')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-80 transition-opacity"
              style={{ background: 'var(--color-primary)', color: '#fff' }}
            >
              {getIcon('download', { size: 14 })}
              Download
            </button>
            <button onClick={onClose} className="hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>
              {getIcon('x', { size: 20 })}
            </button>
          </div>
        </div>
        <div className="overflow-auto flex-1 p-4" style={{ background: 'var(--color-bg)' }}>
          <PdfPagePreview dataUrl={dataUrl} maxWidth={760} />
        </div>
      </div>
    </div>
  );
}

function ErrMsg({ msg }) {
  if (!msg) return null;
  return <p className="text-xs mt-2 px-3 py-2 rounded-lg" style={{ background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca' }}>{msg}</p>;
}

function RunBtn({ onClick, busy, disabled, label, getIcon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="mt-4 w-full py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
      style={{ background: 'var(--color-primary)', color: '#fff' }}
    >
      {busy ? 'Processing…' : (label || 'Process')}
    </button>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function PdfPage() {
  const getIcon = useIcon();
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [searchParams, setSearchParams] = useSearchParams();

  // Sidebar state
  const [mode, setMode] = useState('merge');
  const [openGroup, setOpenGroup] = useState('Organise');
  const [toolSearch, setToolSearch] = useState('');
  const [hoveredTool, setHoveredTool] = useState(null);
  const [helpTool, setHelpTool] = useState(null);
  const [resultModal, setResultModal] = useState(null); // { dataUrl, filename, meta }
  const [seedBanner, setSeedBanner] = useState('');
  const toolSearchRef = useRef(null);
  const seedHandled = useRef(false);

  // Merge
  const [mergeFiles, setMergeFiles] = useState([]);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeResult, setMergeResult] = useState(null);
  const [mergeError, setMergeError] = useState('');

  // Split
  const [splitFile, setSplitFile] = useState(null);
  const [splitPages, setSplitPages] = useState('');
  const [splitBusy, setSplitBusy] = useState(false);
  const [splitResult, setSplitResult] = useState(null);
  const [splitError, setSplitError] = useState('');

  // Rotate
  const [rotateFile, setRotateFile] = useState(null);
  const [rotateAngle, setRotateAngle] = useState(90);
  const [rotatePages, setRotatePages] = useState('all');
  const [rotateBusy, setRotateBusy] = useState(false);
  const [rotateResult, setRotateResult] = useState(null);
  const [rotateError, setRotateError] = useState('');

  // img2pdf
  const [imgFiles, setImgFiles] = useState([]);
  const [imgPageSize, setImgPageSize] = useState('A4');
  const [imgMargin, setImgMargin] = useState(20);
  const [imgBusy, setImgBusy] = useState(false);
  const [imgResult, setImgResult] = useState(null);
  const [imgError, setImgError] = useState('');

  // Extract text
  const [etFile, setEtFile] = useState(null);
  const [etText, setEtText] = useState('');
  const [etBusy, setEtBusy] = useState(false);
  const [etError, setEtError] = useState('');

  // Watermark
  const [wmFile, setWmFile] = useState(null);
  const [wmText, setWmText] = useState('CONFIDENTIAL');
  const [wmFontSize, setWmFontSize] = useState(60);
  const [wmOpacity, setWmOpacity] = useState(0.2);
  const [wmColor, setWmColor] = useState('#000000');
  const [wmAngle, setWmAngle] = useState(45);
  const [wmBusy, setWmBusy] = useState(false);
  const [wmResult, setWmResult] = useState(null);
  const [wmError, setWmError] = useState('');

  // Page numbers
  const [pnFile, setPnFile] = useState(null);
  const [pnFormat, setPnFormat] = useState('{n}');
  const [pnPosition, setPnPosition] = useState('bottom-center');
  const [pnFontSize, setPnFontSize] = useState(10);
  const [pnStartAt, setPnStartAt] = useState(1);
  const [pnBusy, setPnBusy] = useState(false);
  const [pnResult, setPnResult] = useState(null);
  const [pnError, setPnError] = useState('');

  // Inspect
  const [inspectFile, setInspectFile] = useState(null);
  const [inspectFields, setInspectFields] = useState(null);
  const [inspectBusy, setInspectBusy] = useState(false);
  const [inspectError, setInspectError] = useState('');

  // Fill
  const [fillFile, setFillFile] = useState(null);
  const [fillAvailable, setFillAvailable] = useState([]);
  const [fillValues, setFillValues] = useState({});
  const [fillBusy, setFillBusy] = useState(false);
  const [fillResult, setFillResult] = useState(null);
  const [fillError, setFillError] = useState('');
  // Flattened-text fill: stamp typed values directly into the page instead of
  // an AcroForm field, so the chosen font actually renders in every viewer
  // (see field designer notes — live form fields substitute a default font
  // in Chrome/Edge/Adobe Reader regardless of what's embedded).
  const [fillFlatten, setFillFlatten] = useState(true);
  const [fillFont, setFillFont] = useState('Helvetica');
  const [fillFontSize, setFillFontSize] = useState(11);
  const [fillColor, setFillColor] = useState('#000000');

  // Flatten
  const [flatFile, setFlatFile] = useState(null);
  const [flatBusy, setFlatBusy] = useState(false);
  const [flatResult, setFlatResult] = useState(null);
  const [flatError, setFlatError] = useState('');

  // Metadata
  const [metaFile, setMetaFile] = useState(null);
  const [metaCurrent, setMetaCurrent] = useState(null);
  const [metaEdit, setMetaEdit] = useState({});
  const [metaBusy, setMetaBusy] = useState(false);
  const [metaResult, setMetaResult] = useState(null);
  const [metaError, setMetaError] = useState('');

  // File info
  const [infoFile, setInfoFile] = useState(null);
  const [infoData, setInfoData] = useState(null);
  const [infoDataUrl, setInfoDataUrl] = useState(null);
  const [infoBusy, setInfoBusy] = useState(false);

  // Office → PDF
  const [officeFile, setOfficeFile] = useState(null);
  const [officeBusy, setOfficeBusy] = useState(false);
  const [officeError, setOfficeError] = useState('');

  // Text → PDF
  const [t2pTitle, setT2pTitle] = useState('');
  const [t2pText, setT2pText] = useState('');
  const [t2pBusy, setT2pBusy] = useState(false);
  const [t2pError, setT2pError] = useState('');

  // PDF → Office
  const [pto_file, setPtoFile] = useState(null);
  const [pto_format, setPtoFormat] = useState('docx');
  const [pto_busy, setPtoBusy] = useState(false);
  const [pto_error, setPtoError] = useState('');

  // Google Drive → PDF
  const [googleUrl, setGoogleUrl] = useState('');
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState('');

  // Organize Pages
  const [orgPrimary, setOrgPrimary] = useState(null); // { name, dataUrl, size }
  const [orgPages, setOrgPages] = useState([]); // [{ id, source: 'primary'|'inserted', index, thumb }]
  const [orgInsertFile, setOrgInsertFile] = useState(null); // { name, dataUrl }
  const [orgInsertThumbs, setOrgInsertThumbs] = useState([]); // [{ id, index, thumb }]
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgBusy, setOrgBusy] = useState(false);
  const [orgResult, setOrgResult] = useState(null);
  const [orgError, setOrgError] = useState('');
  const [orgConfirmDelete, setOrgConfirmDelete] = useState(null);
  const [orgExtracting, setOrgExtracting] = useState(null);
  const orgDragId = useRef(null);

  // Fill & Sign
  const [signFile, setSignFile] = useState(null);
  const [signPageCount, setSignPageCount] = useState(0);
  const [signCurrentPage, setSignCurrentPage] = useState(1);
  const [signPageDims, setSignPageDims] = useState(null);
  const [signPlaced, setSignPlaced] = useState([]);
  const [signSelectedId, setSignSelectedId] = useState(null);
  const [signMode, setSignMode] = useState('draw'); // 'draw'|'type'|'image'
  const [signTypeText, setSignTypeText] = useState('');
  const [signFont, setSignFont] = useState('Great Vibes');
  const [signImageDataUrl, setSignImageDataUrl] = useState(null);
  const [signLoading, setSignLoading] = useState(false);
  const [signBusy, setSignBusy] = useState(false);
  const [signResult, setSignResult] = useState(null);
  const [signError, setSignError] = useState('');
  const signPdfCanvasRef = useRef(null);
  const signUiCanvasRef = useRef(null);
  const signPadCanvasRef = useRef(null);
  const signPdfDocRef = useRef(null);
  const signIsDrawingRef = useRef(false);
  const signStartRef = useRef(null);
  const signMoveRef = useRef(null);
  const signCurrentPageRef = useRef(1);
  const signPageDimsRef = useRef(null);
  const signPlacedRef = useRef([]);
  const signSelectedIdRef = useRef(null);
  const signPadDrawingRef = useRef(false);
  const signModeRef = useRef('draw');
  const signTypeTextRef = useRef('');
  const signFontRef = useRef('Great Vibes');
  const signImageDataUrlRef = useRef(null);

  useEffect(() => { signCurrentPageRef.current = signCurrentPage; }, [signCurrentPage]);
  useEffect(() => { signPageDimsRef.current = signPageDims; }, [signPageDims]);
  useEffect(() => { signPlacedRef.current = signPlaced; }, [signPlaced]);
  useEffect(() => { signSelectedIdRef.current = signSelectedId; }, [signSelectedId]);
  useEffect(() => { signModeRef.current = signMode; }, [signMode]);
  useEffect(() => { signTypeTextRef.current = signTypeText; }, [signTypeText]);
  useEffect(() => { signFontRef.current = signFont; }, [signFont]);
  useEffect(() => { signImageDataUrlRef.current = signImageDataUrl; }, [signImageDataUrl]);

  // Compress
  const [cmpFile, setCmpFile] = useState(null);
  const [cmpRecompress, setCmpRecompress] = useState(false);
  const [cmpQuality, setCmpQuality] = useState('medium');
  const [cmpBusy, setCmpBusy] = useState(false);
  const [cmpResult, setCmpResult] = useState(null);
  const [cmpError, setCmpError] = useState('');

  // Password Protect / Remove Password
  const [pwFile, setPwFile] = useState(null);
  const [pwPassword, setPwPassword] = useState('');
  const [pwOwnerPassword, setPwOwnerPassword] = useState('');
  const [pwPermPrint, setPwPermPrint] = useState(true);
  const [pwPermCopy, setPwPermCopy] = useState(true);
  const [pwPermModify, setPwPermModify] = useState(true);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwResult, setPwResult] = useState(null);
  const [pwError, setPwError] = useState('');
  const [unpwFile, setUnpwFile] = useState(null);
  const [unpwPassword, setUnpwPassword] = useState('');
  const [unpwBusy, setUnpwBusy] = useState(false);
  const [unpwResult, setUnpwResult] = useState(null);
  const [unpwError, setUnpwError] = useState('');

  // Compare
  const [cmprAFile, setCmprAFile] = useState(null);
  const [cmprBFile, setCmprBFile] = useState(null);
  const [cmprTab, setCmprTab] = useState('visual'); // 'visual'|'text'
  const [cmprPage, setCmprPage] = useState(1);
  const [cmprPageCount, setCmprPageCount] = useState(0);
  const [cmprSensitivity, setCmprSensitivity] = useState(30);
  const [cmprLoading, setCmprLoading] = useState(false);
  const [cmprDiffPct, setCmprDiffPct] = useState(null);
  const [cmprError, setCmprError] = useState('');
  const [cmprTextA, setCmprTextA] = useState([]);
  const [cmprTextB, setCmprTextB] = useState([]);
  const [cmprTextBusy, setCmprTextBusy] = useState(false);
  const [cmprTextError, setCmprTextError] = useState('');
  const cmprCanvasARef = useRef(null);
  const cmprCanvasBRef = useRef(null);
  const cmprCanvasDiffRef = useRef(null);
  const cmprDocARef = useRef(null);
  const cmprDocBRef = useRef(null);

  // Annotate / Markup
  const [annFile, setAnnFile] = useState(null);
  const [annPageCount, setAnnPageCount] = useState(0);
  const [annCurrentPage, setAnnCurrentPage] = useState(1);
  const [annPageDims, setAnnPageDims] = useState(null);
  const [annShapes, setAnnShapes] = useState([]); // all pages' annotations, flat
  const [annTool, setAnnTool] = useState('highlight'); // 'select'|'highlight'|'strikeout'|'draw'|'note'|'textbox'
  const [annColor, setAnnColor] = useState('#ffeb3b');
  const [annStrokeWidth, setAnnStrokeWidth] = useState(3);
  const [annOpacity, setAnnOpacity] = useState(0.4);
  const [annFontSize, setAnnFontSize] = useState(11);
  const [annSelectedId, setAnnSelectedId] = useState(null);
  const [annNoteEditor, setAnnNoteEditor] = useState(null); // { id, x, y, text } — open editor popover
  const [annPast, setAnnPast] = useState([]);
  const [annFuture, setAnnFuture] = useState([]);
  const [annLoading, setAnnLoading] = useState(false);
  const [annBusy, setAnnBusy] = useState(false);
  const [annResult, setAnnResult] = useState(null);
  const [annError, setAnnError] = useState('');
  const annPdfCanvasRef = useRef(null);
  const annUiCanvasRef = useRef(null);
  const annPdfDocRef = useRef(null);
  const annDrawingRef = useRef(false);
  const annStartRef = useRef(null);
  const annMoveRef = useRef(null);
  const annStrokeRef = useRef(null); // in-progress freehand points (canvas coords)
  const annCurrentPageRef = useRef(1);
  const annPageDimsRef = useRef(null);
  const annShapesRef = useRef([]);
  const annToolRef = useRef('highlight');
  const annColorRef = useRef('#ffeb3b');
  const annStrokeWidthRef = useRef(3);
  const annOpacityRef = useRef(0.4);
  const annFontSizeRef = useRef(11);
  const annSelectedIdRef = useRef(null);

  useEffect(() => { annCurrentPageRef.current = annCurrentPage; }, [annCurrentPage]);
  useEffect(() => { annPageDimsRef.current = annPageDims; }, [annPageDims]);
  useEffect(() => { annShapesRef.current = annShapes; }, [annShapes]);
  useEffect(() => { annToolRef.current = annTool; }, [annTool]);
  useEffect(() => { annColorRef.current = annColor; }, [annColor]);
  useEffect(() => { annStrokeWidthRef.current = annStrokeWidth; }, [annStrokeWidth]);
  useEffect(() => { annOpacityRef.current = annOpacity; }, [annOpacity]);
  useEffect(() => { annFontSizeRef.current = annFontSize; }, [annFontSize]);
  useEffect(() => { annSelectedIdRef.current = annSelectedId; }, [annSelectedId]);

  // Deep-link from Document Redaction (and others): /pdf?tool=officetopdf&seed=1
  useEffect(() => {
    if (seedHandled.current) return undefined;
    const tool = searchParams.get('tool');
    const wantSeed = searchParams.get('seed') === '1';
    const known = new Set(MODES.map((t) => t.id));
    if (tool && known.has(tool)) {
      setMode(tool);
      const group = MODE_GROUPS.find((g) => g.ids.includes(tool));
      if (group) setOpenGroup(group.label);
    }
    if (wantSeed) {
      seedHandled.current = true;
      try {
        const raw = sessionStorage.getItem('vault:pdfTools:seed');
        sessionStorage.removeItem('vault:pdfTools:seed');
        if (raw) {
          const seed = JSON.parse(raw);
          const file = {
            name: seed.name || 'document.docx',
            dataUrl: seed.dataUrl,
            size: seed.size || 0,
          };
          if (seed.tool === 'pdftooffice' || tool === 'pdftooffice') {
            setPtoFile(file);
            setMode('pdftooffice');
            setOpenGroup('Convert');
            setSeedBanner(`Loaded “${file.name}” from Document redaction — convert with PDF → Word.`);
          } else {
            setOfficeFile(file);
            setMode('officetopdf');
            setOpenGroup('Convert');
            setSeedBanner(`Loaded “${file.name}” from Document redaction — convert with Office → PDF.`);
          }
        }
      } catch {
        /* ignore bad seed */
      }
      const next = new URLSearchParams(searchParams);
      next.delete('seed');
      setSearchParams(next, { replace: true });
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Field Designer
  const [fdFile, setFdFile] = useState(null);
  const [fdPageCount, setFdPageCount] = useState(0);
  const [fdCurrentPage, setFdCurrentPage] = useState(1);
  const [fdPageDims, setFdPageDims] = useState(null);
  const [fdFields, setFdFields] = useState([]);
  const [fdFieldType, setFdFieldType] = useState('text');
  const [fdSelectedId, setFdSelectedId] = useState(null);
  const [fdLoading, setFdLoading] = useState(false);
  const [fdBusy, setFdBusy] = useState(false);
  const [fdResult, setFdResult] = useState(null);
  const [fdError, setFdError] = useState('');
  const fdPdfCanvasRef = useRef(null);
  const fdUiCanvasRef = useRef(null);
  const fdPdfDocRef = useRef(null);
  const fdIsDrawingRef = useRef(false);
  const fdStartRef = useRef(null);
  const fdMoveRef = useRef(null); // { fieldId, startX, startY, origX, origY, fieldW, fieldH }
  // Refs keep canvas callbacks free of stale closures
  const fdCurrentPageRef = useRef(1);
  const fdPageDimsRef = useRef(null);
  const fdFieldsRef = useRef([]);
  const fdFieldTypeRef = useRef('text');
  const fdSelectedIdRef = useRef(null);

  // Keep refs in sync
  useEffect(() => { fdCurrentPageRef.current = fdCurrentPage; }, [fdCurrentPage]);
  useEffect(() => { fdPageDimsRef.current = fdPageDims; }, [fdPageDims]);
  useEffect(() => { fdFieldsRef.current = fdFields; }, [fdFields]);
  useEffect(() => { fdFieldTypeRef.current = fdFieldType; }, [fdFieldType]);
  useEffect(() => { fdSelectedIdRef.current = fdSelectedId; }, [fdSelectedId]);

  // Redraw the UI overlay canvas (existing fields for current page)
  const redrawFdOverlay = useCallback(() => {
    const canvas = fdUiCanvasRef.current;
    if (!canvas) return;
    const dims = fdPageDimsRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!dims) return;
    for (const f of fdFieldsRef.current.filter(f => f.page === fdCurrentPageRef.current)) {
      const cx = f.x * dims.renderScale;
      const cy = dims.canvasH - (f.y + f.height) * dims.renderScale;
      const cw = f.width * dims.renderScale;
      const ch = f.height * dims.renderScale;
      const isSel = f.id === fdSelectedIdRef.current;
      // Fill
      ctx.fillStyle = isSel ? 'rgba(234,88,12,0.14)' : 'rgba(99,102,241,0.12)';
      ctx.fillRect(cx, cy, cw, ch);
      // Stroke
      ctx.strokeStyle = isSel ? 'rgb(234,88,12)' : 'rgb(99,102,241)';
      ctx.lineWidth = isSel ? 2 : 1.5;
      ctx.strokeRect(cx, cy, cw, ch);
      // Label
      ctx.fillStyle = isSel ? 'rgb(234,88,12)' : 'rgb(99,102,241)';
      ctx.font = `bold 10px system-ui,sans-serif`;
      ctx.fillText(`${f.name} (${f.type})`, cx + 3, cy + 12);
      // Sample/stamp text in the field's actual font/size/colour. A typed
      // f.value (text type) previews at full opacity — that's the real
      // content that gets baked into the page. Otherwise a ghosted
      // placeholder previews what a fillable field's value would look like.
      if (f.type !== 'checkbox') {
        const family = f.fontFamily || 'Helvetica';
        const css = fontCss(family);
        const sampleSize = Math.max(6, (f.fontSize || 11)) * dims.renderScale;
        ctx.font = `${css.fontStyle === 'italic' ? 'italic ' : ''}${css.fontWeight === 'bold' ? 'bold ' : ''}${sampleSize}px ${css.fontFamily}`;
        ctx.fillStyle = f.color || '#000000';
        const isStamp = f.type === 'text' && f.value;
        ctx.globalAlpha = isStamp ? 1 : 0.55;
        const sampleText = isStamp ? f.value : (f.type === 'dropdown' && f.options?.[0] ? f.options[0] : 'Sample text');
        ctx.fillText(sampleText, cx + 4, cy + ch / 2 + sampleSize * 0.35, cw - 8);
        ctx.globalAlpha = 1;
      }
      // Corner handles when selected
      if (isSel) {
        const hs = 7;
        ctx.fillStyle = 'rgb(234,88,12)';
        [[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]].forEach(([hx, hy]) => {
          ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
        });
      }
    }
  }, []);

  // Render a PDF page to the PDF canvas
  const renderFdPage = useCallback(async (pageNum) => {
    const pdfCanvas = fdPdfCanvasRef.current;
    const uiCanvas = fdUiCanvasRef.current;
    if (!pdfCanvas || !uiCanvas || !fdPdfDocRef.current) return;
    const page = await fdPdfDocRef.current.getPage(pageNum);
    const origVp = page.getViewport({ scale: 1 });
    const maxW = Math.min(580, (window.innerWidth || 1200) * 0.52);
    const rs = Math.min(maxW / origVp.width, 1.8);
    const vp = page.getViewport({ scale: rs });
    pdfCanvas.width = Math.floor(vp.width);
    pdfCanvas.height = Math.floor(vp.height);
    uiCanvas.width = Math.floor(vp.width);
    uiCanvas.height = Math.floor(vp.height);
    const dims = { pdfW: origVp.width, pdfH: origVp.height, renderScale: rs, canvasW: Math.floor(vp.width), canvasH: Math.floor(vp.height) };
    fdPageDimsRef.current = dims;
    setFdPageDims(dims);
    await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: vp }).promise;
    redrawFdOverlay();
  }, [redrawFdOverlay]);

  // Render page 1 as soon as a new file is loaded and the canvas is mounted
  useEffect(() => {
    if (fdFile && fdPdfDocRef.current) renderFdPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fdFile]);

  // Re-render when page changes (navigation)
  useEffect(() => {
    if (fdPdfDocRef.current && fdCurrentPage) renderFdPage(fdCurrentPage);
  }, [fdCurrentPage, renderFdPage]);

  // Re-draw overlay when field list changes (e.g., name edits, removals)
  useEffect(() => { redrawFdOverlay(); }, [fdFields, redrawFdOverlay]);

  // Re-draw once a lazily-loaded script font finishes downloading, so the
  // sample text preview updates from its fallback (cursive) to the real face.
  useEffect(() => {
    if (!document.fonts?.addEventListener) return;
    const onLoaded = () => redrawFdOverlay();
    document.fonts.addEventListener('loadingdone', onLoaded);
    return () => document.fonts.removeEventListener('loadingdone', onLoaded);
  }, [redrawFdOverlay]);

  const fdCanvasCoords = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  };

  // Returns the id of the top-most field under (cx, cy) in canvas coords, or null
  const hitTestFields = useCallback((cx, cy, dims) => {
    const onPage = [...fdFieldsRef.current].filter(f => f.page === fdCurrentPageRef.current).reverse();
    for (const f of onPage) {
      const fx = f.x * dims.renderScale;
      const fy = dims.canvasH - (f.y + f.height) * dims.renderScale;
      const fw = f.width * dims.renderScale;
      const fh = f.height * dims.renderScale;
      if (cx >= fx && cx <= fx + fw && cy >= fy && cy <= fy + fh) return f.id;
    }
    return null;
  }, []);

  const onFdDown = useCallback((e) => {
    const dims = fdPageDimsRef.current;
    if (!dims) return;
    const pos = fdCanvasCoords(e, fdUiCanvasRef.current);
    const hitId = hitTestFields(pos.x, pos.y, dims);
    if (hitId) {
      // Select + start move
      setFdSelectedId(hitId);
      fdSelectedIdRef.current = hitId;
      const field = fdFieldsRef.current.find(f => f.id === hitId);
      fdMoveRef.current = { fieldId: hitId, startX: pos.x, startY: pos.y, origX: field.x, origY: field.y, fieldW: field.width, fieldH: field.height };
      fdIsDrawingRef.current = false;
    } else {
      // Deselect + start draw
      setFdSelectedId(null);
      fdSelectedIdRef.current = null;
      fdMoveRef.current = null;
      fdIsDrawingRef.current = true;
      fdStartRef.current = pos;
    }
  }, [hitTestFields]);

  const onFdMove = useCallback((e) => {
    const dims = fdPageDimsRef.current;
    const canvas = fdUiCanvasRef.current;
    if (!canvas) return;
    const cur = fdCanvasCoords(e, canvas);

    // Update cursor based on hover (only when idle)
    if (!fdIsDrawingRef.current && !fdMoveRef.current && dims) {
      canvas.style.cursor = hitTestFields(cur.x, cur.y, dims) ? 'move' : 'crosshair';
    }

    if (fdMoveRef.current) {
      // Moving an existing field
      const { fieldId, startX, startY, origX, origY, fieldW, fieldH } = fdMoveRef.current;
      const rs = dims.renderScale;
      const newX = Math.max(0, Math.min(dims.pdfW - fieldW, origX + (cur.x - startX) / rs));
      const newY = Math.max(0, Math.min(dims.pdfH - fieldH, origY - (cur.y - startY) / rs));
      const next = fdFieldsRef.current.map(f => f.id === fieldId ? { ...f, x: newX, y: newY } : f);
      fdFieldsRef.current = next;
      setFdFields(next);
      redrawFdOverlay();
      return;
    }

    if (!fdIsDrawingRef.current || !fdStartRef.current) return;
    const cur2 = cur;
    const { x: sx, y: sy } = fdStartRef.current;
    const bx = Math.min(sx, cur2.x), by = Math.min(sy, cur2.y);
    const bw = Math.abs(cur2.x - sx), bh = Math.abs(cur2.y - sy);
    redrawFdOverlay();
    const ctx = fdUiCanvasRef.current.getContext('2d');
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(239,68,68,0.9)';
    ctx.fillStyle = 'rgba(239,68,68,0.08)';
    ctx.lineWidth = 1.5;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeRect(bx, by, bw, bh);
    ctx.setLineDash([]);
  }, [redrawFdOverlay]);

  const onFdUp = useCallback((e) => {
    // Finalise a move
    if (fdMoveRef.current) {
      fdMoveRef.current = null;
      redrawFdOverlay();
      return;
    }
    // Finalise a draw
    if (!fdIsDrawingRef.current || !fdStartRef.current || !fdPageDimsRef.current) return;
    fdIsDrawingRef.current = false;
    const cur = fdCanvasCoords(e, fdUiCanvasRef.current);
    const { x: sx, y: sy } = fdStartRef.current;
    fdStartRef.current = null;
    const bx = Math.min(sx, cur.x), by = Math.min(sy, cur.y);
    const bw = Math.abs(cur.x - sx), bh = Math.abs(cur.y - sy);
    if (bw < 10 || bh < 6) { redrawFdOverlay(); return; }
    const dims = fdPageDimsRef.current;
    const newField = {
      id: `fd_${Date.now()}`,
      page: fdCurrentPageRef.current,
      name: `field_${fdFieldsRef.current.length + 1}`,
      type: fdFieldTypeRef.current,
      x: bx / dims.renderScale,
      y: dims.pdfH - (by + bh) / dims.renderScale,
      width: bw / dims.renderScale,
      height: bh / dims.renderScale,
      required: false,
      multiline: false,
      options: [],
      fontFamily: 'Helvetica',
      fontSize: 11,
      color: '#000000',
      borderEnabled: true,
      borderColor: '#4d4dcf',
      borderWidth: 1,
    };
    const next = [...fdFieldsRef.current, newField];
    fdFieldsRef.current = next;
    setFdFields(next);
    // Auto-select newly drawn field
    setFdSelectedId(newField.id);
    fdSelectedIdRef.current = newField.id;
  }, [redrawFdOverlay]);

  const onFdLeave = useCallback(() => {
    if (fdMoveRef.current) { fdMoveRef.current = null; redrawFdOverlay(); }
    if (fdIsDrawingRef.current) { fdIsDrawingRef.current = false; fdStartRef.current = null; redrawFdOverlay(); }
  }, [redrawFdOverlay]);

  const updateFdField = useCallback((id, patch) => {
    setFdFields(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  }, []);

  const removeFdField = useCallback((id) => {
    setFdFields(prev => prev.filter(f => f.id !== id));
  }, []);

  // Delete/Backspace removes the selected field (must be declared after removeFdField)
  useEffect(() => {
    const handleKey = (e) => {
      if (!fdSelectedIdRef.current) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      removeFdField(fdSelectedIdRef.current);
      setFdSelectedId(null);
      fdSelectedIdRef.current = null;
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [removeFdField]);

  const onFdFileChange = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setFdFields([]); fdFieldsRef.current = [];
    setFdResult(null); setFdError('');
    setFdCurrentPage(1); fdCurrentPageRef.current = 1;
    setFdLoading(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      // Load PDF before setting fdFile so the doc is ready the moment the canvas mounts
      const pdfjsLib = await import('pdfjs-dist');
      await initPdfjsWorker(pdfjsLib);
      const doc = await pdfjsLib.getDocument({ data: dataUrlToUint8Array(dataUrl) }).promise;
      fdPdfDocRef.current = doc;
      setFdPageCount(doc.numPages);
      // setFdFile causes the canvas to mount; the useEffect below renders page 1
      setFdFile({ name: file.name, dataUrl, size: file.size });
    } finally {
      setFdLoading(false);
    }
  };

  const changeFdPage = (n) => {
    if (n < 1 || n > fdPageCount) return;
    setFdCurrentPage(n);
  };

  const runAddFields = async () => {
    if (!fdFile || !fdFields.length) return;
    startProcessing('Embedding Form Fields…', `${fdFields.length} field${fdFields.length !== 1 ? 's' : ''} · ${fdFile.name}`);
    setFdBusy(true); setFdError(''); setFdResult(null);
    try {
      const res = await api.post('/api/pdf/addfields', { dataUrl: fdFile.dataUrl, fields: fdFields });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFdResult({ dataUrl: data.dataUrl, pageCount: data.pageCount, added: data.added });
      setResultModal({ dataUrl: data.dataUrl, filename: fdFile ? `${fdFile.name.replace('.pdf','')}-fields.pdf` : 'with-fields.pdf', meta: `${data.added} AcroForm field${data.added !== 1 ? 's' : ''} embedded` });
    } catch (err) {
      setFdError(err.message || 'Add fields failed');
    } finally {
      stopProcessing(); setFdBusy(false);
    }
  };

  // ── Annotate / Markup ────────────────────────────────────────────────────
  // Same two-canvas technique as the field designer / Fill & Sign: a bottom
  // canvas renders the PDF page (pdfjs-dist), a transparent canvas on top
  // draws the in-progress/placed shapes and reacts to mouse events. Shapes
  // are stored in PDF-point coordinates (bottom-left origin), same convention
  // as every other coordinate-based tool in this file.
  const annCanvasCoords = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  };
  const annToPdf = (cx, cy, dims) => ({ x: cx / dims.renderScale, y: dims.pdfH - cy / dims.renderScale });
  const annToCanvas = (x, y, dims) => ({ x: x * dims.renderScale, y: dims.canvasH - y * dims.renderScale });

  const redrawAnnOverlay = useCallback(() => {
    const canvas = annUiCanvasRef.current;
    if (!canvas) return;
    const dims = annPageDimsRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!dims) return;
    const onPage = annShapesRef.current.filter(s => s.page === annCurrentPageRef.current);
    for (const s of onPage) {
      const isSel = s.id === annSelectedIdRef.current;
      if (s.type === 'draw') {
        if (!s.points?.length) continue;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = Math.max(1, s.strokeWidth * dims.renderScale);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        s.points.forEach((p, i) => {
          const c = annToCanvas(p.x, p.y, dims);
          if (i === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y);
        });
        ctx.stroke();
        continue;
      }
      const c1 = annToCanvas(s.x, s.y + s.height, dims);
      const cw = s.width * dims.renderScale;
      const ch = s.height * dims.renderScale;
      if (s.type === 'highlight') {
        ctx.globalAlpha = s.opacity ?? 0.4;
        ctx.fillStyle = s.color;
        ctx.fillRect(c1.x, c1.y, cw, ch);
        ctx.globalAlpha = 1;
      } else if (s.type === 'strikeout') {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = Math.max(1, (s.strokeWidth || 1.5) * dims.renderScale);
        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y + ch / 2);
        ctx.lineTo(c1.x + cw, c1.y + ch / 2);
        ctx.stroke();
      } else if (s.type === 'textbox') {
        if (s.background) { ctx.fillStyle = s.background; ctx.globalAlpha = 0.9; ctx.fillRect(c1.x, c1.y, cw, ch); ctx.globalAlpha = 1; }
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(c1.x, c1.y, cw, ch);
        ctx.fillStyle = s.color;
        ctx.font = `${Math.max(8, (s.fontSize || 11) * dims.renderScale)}px system-ui,sans-serif`;
        ctx.fillText(s.text || '', c1.x + 4, c1.y + 14, cw - 8);
      } else if (s.type === 'note') {
        const nc = annToCanvas(s.x, s.y, dims);
        ctx.fillStyle = s.color;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.fillRect(nc.x, nc.y - 18, 18, 18);
        ctx.strokeRect(nc.x, nc.y - 18, 18, 18);
      }
      if (isSel) {
        ctx.strokeStyle = 'rgb(234,88,12)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        if (s.type === 'note') { const nc = annToCanvas(s.x, s.y, dims); ctx.strokeRect(nc.x - 2, nc.y - 20, 22, 22); }
        else ctx.strokeRect(c1.x - 2, c1.y - 2, cw + 4, ch + 4);
        ctx.setLineDash([]);
      }
    }
  }, []);

  const renderAnnPage = useCallback(async (pageNum) => {
    const pdfCanvas = annPdfCanvasRef.current;
    const uiCanvas = annUiCanvasRef.current;
    if (!pdfCanvas || !uiCanvas || !annPdfDocRef.current) return;
    const page = await annPdfDocRef.current.getPage(pageNum);
    const origVp = page.getViewport({ scale: 1 });
    const maxW = Math.min(580, (window.innerWidth || 1200) * 0.52);
    const rs = Math.min(maxW / origVp.width, 1.8);
    const vp = page.getViewport({ scale: rs });
    pdfCanvas.width = Math.floor(vp.width);
    pdfCanvas.height = Math.floor(vp.height);
    uiCanvas.width = Math.floor(vp.width);
    uiCanvas.height = Math.floor(vp.height);
    const dims = { pdfW: origVp.width, pdfH: origVp.height, renderScale: rs, canvasW: Math.floor(vp.width), canvasH: Math.floor(vp.height) };
    annPageDimsRef.current = dims;
    setAnnPageDims(dims);
    await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: vp }).promise;
    redrawAnnOverlay();
  }, [redrawAnnOverlay]);

  useEffect(() => { if (annFile && annPdfDocRef.current) renderAnnPage(1); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [annFile]);
  useEffect(() => { if (annPdfDocRef.current && annCurrentPage) renderAnnPage(annCurrentPage); }, [annCurrentPage, renderAnnPage]);
  useEffect(() => { redrawAnnOverlay(); }, [annShapes, annSelectedId, redrawAnnOverlay]);

  const onAnnFileChange = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setAnnShapes([]); annShapesRef.current = [];
    setAnnPast([]); setAnnFuture([]);
    setAnnSelectedId(null); setAnnResult(null); setAnnError('');
    setAnnCurrentPage(1); annCurrentPageRef.current = 1;
    setAnnLoading(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const pdfjsLib = await import('pdfjs-dist');
      await initPdfjsWorker(pdfjsLib);
      const doc = await pdfjsLib.getDocument({ data: dataUrlToUint8Array(dataUrl) }).promise;
      annPdfDocRef.current = doc;
      setAnnPageCount(doc.numPages);
      setAnnFile({ name: file.name, dataUrl, size: file.size });
    } finally {
      setAnnLoading(false);
    }
  };
  const changeAnnPage = (n) => { if (n >= 1 && n <= annPageCount) setAnnCurrentPage(n); };

  // Undo/redo — snapshot the whole shapes array on every committed change,
  // same convention as Graphics' Annotate tool (annPast/annFuture, 20-step cap).
  const pushAnnHistory = useCallback((prevShapes) => {
    setAnnPast(p => [...p, prevShapes].slice(-20));
    setAnnFuture([]);
  }, []);
  const commitAnnShapes = useCallback((next) => {
    pushAnnHistory(annShapesRef.current);
    annShapesRef.current = next;
    setAnnShapes(next);
  }, [pushAnnHistory]);
  const undoAnn = () => {
    setAnnPast(past => {
      if (!past.length) return past;
      const prev = past[past.length - 1];
      setAnnFuture(f => [annShapesRef.current, ...f].slice(0, 20));
      annShapesRef.current = prev;
      setAnnShapes(prev);
      return past.slice(0, -1);
    });
  };
  const redoAnn = () => {
    setAnnFuture(future => {
      if (!future.length) return future;
      const next = future[0];
      setAnnPast(p => [...p, annShapesRef.current].slice(-20));
      annShapesRef.current = next;
      setAnnShapes(next);
      return future.slice(1);
    });
  };

  const hitTestAnnShapes = useCallback((cx, cy, dims) => {
    const onPage = [...annShapesRef.current].filter(s => s.page === annCurrentPageRef.current).reverse();
    for (const s of onPage) {
      if (s.type === 'draw') continue; // freehand strokes aren't select/move targets
      const c1 = s.type === 'note' ? annToCanvas(s.x, s.y, dims) : annToCanvas(s.x, s.y + s.height, dims);
      const w = s.type === 'note' ? 18 : s.width * dims.renderScale;
      const h = s.type === 'note' ? 18 : s.height * dims.renderScale;
      const top = s.type === 'note' ? c1.y - 18 : c1.y;
      if (cx >= c1.x && cx <= c1.x + w && cy >= top && cy <= top + h) return s.id;
    }
    return null;
  }, []);

  const onAnnDown = useCallback((e) => {
    const dims = annPageDimsRef.current;
    if (!dims) return;
    const pos = annCanvasCoords(e, annUiCanvasRef.current);
    const tool = annToolRef.current;

    if (tool === 'select') {
      const hitId = hitTestAnnShapes(pos.x, pos.y, dims);
      setAnnSelectedId(hitId); annSelectedIdRef.current = hitId;
      if (hitId) {
        const shape = annShapesRef.current.find(s => s.id === hitId);
        annMoveRef.current = { id: hitId, startX: pos.x, startY: pos.y, origX: shape.x, origY: shape.y };
      }
      redrawAnnOverlay();
      return;
    }
    if (tool === 'note') {
      const p = annToPdf(pos.x, pos.y, dims);
      const id = `ann_${Date.now()}`;
      setAnnNoteEditor({ id, page: annCurrentPageRef.current, x: p.x, y: p.y, text: '', screenX: e.clientX, screenY: e.clientY });
      return;
    }
    if (tool === 'draw') {
      annDrawingRef.current = true;
      const p = annToPdf(pos.x, pos.y, dims);
      annStrokeRef.current = [p];
      return;
    }
    // highlight / strikeout / textbox — drag a box
    annDrawingRef.current = true;
    annStartRef.current = pos;
  }, [hitTestAnnShapes, redrawAnnOverlay]);

  const onAnnMove = useCallback((e) => {
    const dims = annPageDimsRef.current;
    const canvas = annUiCanvasRef.current;
    if (!canvas || !dims) return;
    const cur = annCanvasCoords(e, canvas);
    const tool = annToolRef.current;

    if (annMoveRef.current) {
      const { id, startX, startY, origX, origY } = annMoveRef.current;
      const rs = dims.renderScale;
      const next = annShapesRef.current.map(s => s.id === id
        ? { ...s, x: origX + (cur.x - startX) / rs, y: origY - (cur.y - startY) / rs }
        : s);
      annShapesRef.current = next;
      setAnnShapes(next);
      redrawAnnOverlay();
      return;
    }
    if (tool === 'draw' && annDrawingRef.current) {
      const p = annToPdf(cur.x, cur.y, dims);
      annStrokeRef.current = [...(annStrokeRef.current || []), p];
      redrawAnnOverlay();
      const ctx = canvas.getContext('2d');
      ctx.strokeStyle = annColorRef.current;
      ctx.lineWidth = Math.max(1, annStrokeWidthRef.current * dims.renderScale);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      annStrokeRef.current.forEach((p2, i) => {
        const c = annToCanvas(p2.x, p2.y, dims);
        if (i === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y);
      });
      ctx.stroke();
      return;
    }
    if (annDrawingRef.current && annStartRef.current && ['highlight', 'strikeout', 'textbox'].includes(tool)) {
      const { x: sx, y: sy } = annStartRef.current;
      const bx = Math.min(sx, cur.x), by = Math.min(sy, cur.y);
      const bw = Math.abs(cur.x - sx), bh = Math.abs(cur.y - sy);
      redrawAnnOverlay();
      const ctx = canvas.getContext('2d');
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(99,102,241,0.9)';
      ctx.fillStyle = 'rgba(99,102,241,0.1)';
      ctx.lineWidth = 1.5;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeRect(bx, by, bw, bh);
      ctx.setLineDash([]);
    }
  }, [redrawAnnOverlay]);

  const onAnnUp = useCallback((e) => {
    const dims = annPageDimsRef.current;
    if (annMoveRef.current) {
      annMoveRef.current = null;
      commitAnnShapes(annShapesRef.current);
      return;
    }
    const tool = annToolRef.current;
    if (tool === 'draw') {
      if (!annDrawingRef.current) return;
      annDrawingRef.current = false;
      const points = annStrokeRef.current || [];
      annStrokeRef.current = null;
      if (points.length < 2) { redrawAnnOverlay(); return; }
      const shape = { id: `ann_${Date.now()}`, page: annCurrentPageRef.current, type: 'draw', points, color: annColorRef.current, strokeWidth: annStrokeWidthRef.current };
      commitAnnShapes([...annShapesRef.current, shape]);
      return;
    }
    if (!annDrawingRef.current || !annStartRef.current || !dims) return;
    annDrawingRef.current = false;
    const cur = annCanvasCoords(e, annUiCanvasRef.current);
    const { x: sx, y: sy } = annStartRef.current;
    annStartRef.current = null;
    const bx = Math.min(sx, cur.x), by = Math.min(sy, cur.y);
    const bw = Math.abs(cur.x - sx), bh = Math.abs(cur.y - sy);
    if (bw < 8 || bh < 6) { redrawAnnOverlay(); return; }
    const p = annToPdf(bx, by + bh, dims);
    const shape = {
      id: `ann_${Date.now()}`,
      page: annCurrentPageRef.current,
      type: tool,
      x: p.x, y: p.y,
      width: bw / dims.renderScale,
      height: bh / dims.renderScale,
      color: annColorRef.current,
      opacity: annOpacityRef.current,
      strokeWidth: annStrokeWidthRef.current,
      fontSize: annFontSizeRef.current,
      text: tool === 'textbox' ? 'Comment' : undefined,
    };
    commitAnnShapes([...annShapesRef.current, shape]);
    if (tool === 'textbox') { setAnnSelectedId(shape.id); annSelectedIdRef.current = shape.id; }
  }, [commitAnnShapes, redrawAnnOverlay]);

  const onAnnLeave = useCallback(() => {
    if (annMoveRef.current) { annMoveRef.current = null; redrawAnnOverlay(); }
    if (annDrawingRef.current) { annDrawingRef.current = false; annStartRef.current = null; annStrokeRef.current = null; redrawAnnOverlay(); }
  }, [redrawAnnOverlay]);

  const saveAnnNote = () => {
    if (!annNoteEditor) return;
    const { id, page, x, y, text } = annNoteEditor;
    if (text.trim()) {
      const shape = { id, page, type: 'note', x, y, text: text.trim(), color: annColorRef.current };
      commitAnnShapes([...annShapesRef.current, shape]);
    }
    setAnnNoteEditor(null);
  };

  const updateAnnShapeText = (id, text) => {
    const next = annShapesRef.current.map(s => s.id === id ? { ...s, text } : s);
    annShapesRef.current = next;
    setAnnShapes(next);
  };
  const removeAnnShape = (id) => {
    commitAnnShapes(annShapesRef.current.filter(s => s.id !== id));
    if (annSelectedIdRef.current === id) { setAnnSelectedId(null); annSelectedIdRef.current = null; }
  };

  useEffect(() => {
    const handleKey = (e) => {
      if (!annSelectedIdRef.current) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      removeAnnShape(annSelectedIdRef.current);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runAnnotateApply = async () => {
    if (!annFile || !annShapes.length) return;
    startProcessing('Applying annotations…', `${annShapes.length} mark${annShapes.length !== 1 ? 's' : ''} · ${annFile.name}`);
    setAnnBusy(true); setAnnError(''); setAnnResult(null);
    try {
      const payload = annShapes.map(s => ({ ...s, id: undefined }));
      const res = await api.post('/api/pdf/annotate', { dataUrl: annFile.dataUrl, annotations: payload });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAnnResult({ dataUrl: data.dataUrl, pageCount: data.pageCount, applied: data.applied });
      setResultModal({ dataUrl: data.dataUrl, filename: `${annFile.name.replace('.pdf', '')}-annotated.pdf`, meta: `${data.applied} mark${data.applied !== 1 ? 's' : ''} applied${data.notesFallenBack ? ` · ${data.notesFallenBack} note stamped as a visible box (native annotation unavailable)` : ''}` });
    } catch (err) {
      setAnnError(err.message || 'Annotate failed');
    } finally {
      stopProcessing(); setAnnBusy(false);
    }
  };

  // ── Compare ───────────────────────────────────────────────────────────────
  const onCmprFileChange = (which) => async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    const pdfjsLib = await import('pdfjs-dist');
    await initPdfjsWorker(pdfjsLib);
    const doc = await pdfjsLib.getDocument({ data: dataUrlToUint8Array(dataUrl) }).promise;
    const obj = { name: file.name, dataUrl, size: file.size, numPages: doc.numPages };
    setCmprDiffPct(null); setCmprError(''); setCmprTextA([]); setCmprTextB([]); setCmprTextError('');
    if (which === 'a') { cmprDocARef.current = doc; setCmprAFile(obj); } else { cmprDocBRef.current = doc; setCmprBFile(obj); }
    setCmprPage(1);
  };

  const renderCmprVisualDiff = useCallback(async () => {
    const docA = cmprDocARef.current, docB = cmprDocBRef.current;
    const canvasA = cmprCanvasARef.current, canvasB = cmprCanvasBRef.current, canvasDiff = cmprCanvasDiffRef.current;
    if (!docA || !docB || !canvasA || !canvasB || !canvasDiff) return;
    const page = Math.min(cmprPage, docA.numPages, docB.numPages);
    if (page < 1) return;
    setCmprLoading(true); setCmprError('');
    try {
      const pa = await docA.getPage(page);
      const pb = await docB.getPage(page);
      const baseVp = pa.getViewport({ scale: 1 });
      const maxW = Math.min(560, (window.innerWidth || 1200) * 0.4);
      const rs = Math.min(maxW / baseVp.width, 1.6);
      const vpA = pa.getViewport({ scale: rs });
      const vpB = pb.getViewport({ scale: rs });
      const W = Math.floor(vpA.width), H = Math.floor(vpA.height);
      canvasA.width = W; canvasA.height = H;
      canvasB.width = Math.floor(vpB.width); canvasB.height = Math.floor(vpB.height);
      await pa.render({ canvasContext: canvasA.getContext('2d'), viewport: vpA }).promise;
      await pb.render({ canvasContext: canvasB.getContext('2d'), viewport: vpB }).promise;

      // Pixel diff, same concept as Graphics' Image Diff route (server/routes/
      // graphics.js /diff) but done client-side in canvas — no PDF-specific
      // server work is needed here, just two already-rendered ImageDatas.
      canvasDiff.width = W; canvasDiff.height = H;
      const ctxA = canvasA.getContext('2d');
      const ctxBsrc = canvasB.getContext('2d');
      const dataA = ctxA.getImageData(0, 0, W, H).data;
      // Draw B scaled into a same-size offscreen canvas for a fair pixel compare
      const off = document.createElement('canvas'); off.width = W; off.height = H;
      off.getContext('2d').drawImage(canvasB, 0, 0, canvasB.width, canvasB.height, 0, 0, W, H);
      const dataB = off.getContext('2d').getImageData(0, 0, W, H).data;
      const out = new Uint8ClampedArray(W * H * 4);
      const threshold = 255 - Math.round((cmprSensitivity / 100) * 250); // higher sensitivity → lower threshold
      let diffCount = 0;
      for (let i = 0; i < dataA.length; i += 4) {
        const maxd = Math.max(Math.abs(dataA[i] - dataB[i]), Math.abs(dataA[i + 1] - dataB[i + 1]), Math.abs(dataA[i + 2] - dataB[i + 2]));
        if (maxd > threshold) {
          out[i] = 239; out[i + 1] = 16; out[i + 2] = 64; out[i + 3] = 255;
          diffCount++;
        } else {
          const gray = (dataA[i] + dataA[i + 1] + dataA[i + 2]) / 3;
          const dim = Math.round(gray * 0.4 + 140);
          out[i] = dim; out[i + 1] = dim; out[i + 2] = dim; out[i + 3] = 255;
        }
      }
      canvasDiff.getContext('2d').putImageData(new ImageData(out, W, H), 0, 0);
      setCmprDiffPct(Number(((diffCount / (W * H)) * 100).toFixed(2)));
    } catch (err) {
      setCmprError(err.message || 'Visual diff failed');
    } finally {
      setCmprLoading(false);
    }
  }, [cmprPage, cmprSensitivity]);

  useEffect(() => {
    if (cmprTab === 'visual' && cmprAFile && cmprBFile) renderCmprVisualDiff();
  }, [cmprTab, cmprAFile, cmprBFile, cmprPage, cmprSensitivity, renderCmprVisualDiff]);

  useEffect(() => {
    if (cmprAFile && cmprBFile) setCmprPageCount(Math.max(cmprAFile.numPages, cmprBFile.numPages));
  }, [cmprAFile, cmprBFile]);

  // Small LCS-based line diff for the text tab — no dependency needed for a
  // page-at-a-time comparison of already-short text blocks.
  function diffLines(a, b) {
    const la = a.split('\n'), lb = b.split('\n');
    const n = la.length, m = lb.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = la[i] === lb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (la[i] === lb[j]) { out.push({ type: 'same', text: la[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'removed', text: la[i] }); i++; }
      else { out.push({ type: 'added', text: lb[j] }); j++; }
    }
    while (i < n) { out.push({ type: 'removed', text: la[i] }); i++; }
    while (j < m) { out.push({ type: 'added', text: lb[j] }); j++; }
    return out;
  }

  const runCompareText = async () => {
    if (!cmprAFile || !cmprBFile) return;
    setCmprTextBusy(true); setCmprTextError('');
    try {
      const res = await api.post('/api/pdf/compare-text', { dataUrlA: cmprAFile.dataUrl, dataUrlB: cmprBFile.dataUrl });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCmprTextA(data.textA || []);
      setCmprTextB(data.textB || []);
    } catch (err) {
      setCmprTextError(err.message || 'Text extraction failed');
    } finally {
      setCmprTextBusy(false);
    }
  };

  // ── Password Protect / Remove Password ──────────────────────────────────
  const onPwFileChange = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setPwResult(null); setPwError('');
    await loadSinglePdf(file, setPwFile);
  };
  const runProtect = async () => {
    if (!pwFile || !pwPassword) return;
    startProcessing('Encrypting PDF…', pwFile.name);
    setPwBusy(true); setPwError(''); setPwResult(null);
    try {
      const res = await api.post('/api/pdf/protect', {
        dataUrl: pwFile.dataUrl,
        password: pwPassword,
        ownerPassword: pwOwnerPassword || undefined,
        permissions: { printing: pwPermPrint, copying: pwPermCopy, modify: pwPermModify },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPwResult({ dataUrl: data.dataUrl });
      setResultModal({ dataUrl: data.dataUrl, filename: `${pwFile.name.replace('.pdf', '')}-protected.pdf`, meta: 'Password protected (AES-256)' });
    } catch (err) {
      setPwError(err.message || 'Protect failed');
    } finally {
      stopProcessing(); setPwBusy(false);
    }
  };

  const onUnpwFileChange = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setUnpwResult(null); setUnpwError('');
    await loadSinglePdf(file, setUnpwFile);
  };
  const runUnprotect = async () => {
    if (!unpwFile) return;
    startProcessing('Removing password…', unpwFile.name);
    setUnpwBusy(true); setUnpwError(''); setUnpwResult(null);
    try {
      const res = await api.post('/api/pdf/unprotect', { dataUrl: unpwFile.dataUrl, password: unpwPassword });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUnpwResult({ dataUrl: data.dataUrl });
      setResultModal({ dataUrl: data.dataUrl, filename: `${unpwFile.name.replace('.pdf', '')}-unlocked.pdf`, meta: 'Password removed' });
    } catch (err) {
      setUnpwError(err.message || 'Unprotect failed');
    } finally {
      stopProcessing(); setUnpwBusy(false);
    }
  };

  // Keyboard shortcut: / focuses tool search
  useEffect(() => {
    const handler = (e) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        toolSearchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── File loaders ─────────────────────────────────────────────────────────────

  const loadSinglePdf = async (file, setter, withPageCount = false) => {
    const dataUrl = await readFileAsDataUrl(file);
    const obj = { name: file.name, dataUrl, size: file.size, pageCount: null };
    setter(obj);
    if (withPageCount) {
      const n = await getPdfPageCount(dataUrl);
      setter(prev => ({ ...prev, pageCount: n }));
    }
  };

  const onMergeFilesChange = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    setMergeResult(null); setMergeError('');
    const loaded = await Promise.all(files.map(async f => {
      const dataUrl = await readFileAsDataUrl(f);
      const pageCount = await getPdfPageCount(dataUrl);
      return { name: f.name, dataUrl, size: f.size, pageCount };
    }));
    setMergeFiles(prev => [...prev, ...loaded]);
  };

  const onSplitFileChange = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setSplitResult(null); setSplitError(''); setSplitPages('');
    await loadSinglePdf(file, setSplitFile, true);
  };

  const onRotateFileChange = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setRotateResult(null); setRotateError('');
    await loadSinglePdf(file, setRotateFile, true);
  };

  const onImgFilesChange = async (e) => {
    const files = [...(e.target.files || [])]; e.target.value = '';
    setImgResult(null); setImgError('');
    const loaded = await Promise.all(files.map(async f => ({
      name: f.name,
      dataUrl: await readFileAsDataUrl(f),
      size: f.size,
    })));
    setImgFiles(prev => [...prev, ...loaded]);
  };

  const onEtFileChange = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setEtText(''); setEtError('');
    await loadSinglePdf(file, setEtFile);
  };

  const onWmFileChange = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setWmResult(null); setWmError('');
    await loadSinglePdf(file, setWmFile);
  };

  const onPnFileChange = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setPnResult(null); setPnError('');
    await loadSinglePdf(file, setPnFile);
  };

  const onInspectFileChange = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setInspectFields(null); setInspectError('');
    await loadSinglePdf(file, setInspectFile);
  };

  const onFillFileChange = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setFillAvailable([]); setFillValues({}); setFillResult(null); setFillError('');
    const dataUrl = await readFileAsDataUrl(file);
    setFillFile({ name: file.name, dataUrl, size: file.size });
    setFillBusy(true);
    try {
      const res = await api.post('/api/pdf/inspect', { dataUrl });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFillAvailable(data.fields || []);
      const defaults = {};
      (data.fields || []).forEach(f => { defaults[f.name] = f.value || ''; });
      setFillValues(defaults);
    } catch (err) {
      setFillError(err.message || 'Could not read form fields');
    } finally {
      setFillBusy(false);
    }
  };

  const onFlatFileChange = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setFlatResult(null); setFlatError('');
    await loadSinglePdf(file, setFlatFile);
  };

  const onMetaFileChange = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setMetaCurrent(null); setMetaEdit({}); setMetaResult(null); setMetaError('');
    const dataUrl = await readFileAsDataUrl(file);
    setMetaFile({ name: file.name, dataUrl, size: file.size });
    setMetaBusy(true);
    try {
      const res = await api.post('/api/pdf/metadata', { dataUrl });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMetaCurrent(data.current);
      setMetaEdit({ ...data.current });
    } catch (err) {
      setMetaError(err.message || 'Could not read metadata');
    } finally {
      setMetaBusy(false);
    }
  };

  const onInfoFileChange = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setInfoData(null); setInfoFile(file); setInfoDataUrl(null);
    setInfoBusy(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setInfoDataUrl(dataUrl);
      const pageCount = await getPdfPageCount(dataUrl);
      setInfoData({
        name: file.name,
        size: file.size,
        type: file.type || 'application/pdf',
        lastModified: new Date(file.lastModified).toLocaleString(),
        pageCount,
      });
    } finally {
      setInfoBusy(false);
    }
  };

  // ── Action handlers ────────────────────────────────────────────────────────

  const runMerge = async () => {
    if (mergeFiles.length < 2) return setMergeError('Upload at least 2 PDFs to merge.');
    startProcessing('Merging PDFs…', `Combining ${mergeFiles.length} documents`);
    setMergeBusy(true); setMergeError(''); setMergeResult(null);
    try {
      const res = await api.post('/api/pdf/merge', { pdfs: mergeFiles.map(f => ({ dataUrl: f.dataUrl, name: f.name })) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMergeResult({ dataUrl: data.dataUrl, pageCount: data.pageCount });
      setResultModal({ dataUrl: data.dataUrl, filename: 'merged.pdf', meta: `${data.pageCount} pages merged from ${mergeFiles.length} files` });
    } catch (err) {
      setMergeError(err.message || 'Merge failed');
    } finally {
      stopProcessing(); setMergeBusy(false);
    }
  };

  const runSplit = async () => {
    if (!splitFile) return setSplitError('Upload a PDF first.');
    if (!splitPages.trim()) return setSplitError('Enter page numbers to extract.');
    startProcessing('Splitting PDF…', `Extracting pages: ${splitPages}`);
    setSplitBusy(true); setSplitError(''); setSplitResult(null);
    try {
      const res = await api.post('/api/pdf/split', { dataUrl: splitFile.dataUrl, pages: splitPages });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSplitResult({ dataUrl: data.dataUrl, pageCount: data.pageCount, totalSource: data.totalSource });
      setResultModal({ dataUrl: data.dataUrl, filename: splitFile ? `${splitFile.name.replace('.pdf','')}-split.pdf` : 'split.pdf', meta: `Extracted ${data.pageCount} of ${data.totalSource} pages` });
    } catch (err) {
      setSplitError(err.message || 'Split failed');
    } finally {
      stopProcessing(); setSplitBusy(false);
    }
  };

  const runRotate = async () => {
    if (!rotateFile) return setRotateError('Upload a PDF first.');
    startProcessing('Rotating Pages…', `${rotateAngle}° · ${rotatePages === 'all' ? 'all pages' : `pages ${rotatePages}`}`);
    setRotateBusy(true); setRotateError(''); setRotateResult(null);
    try {
      const res = await api.post('/api/pdf/rotate', { dataUrl: rotateFile.dataUrl, angle: rotateAngle, pages: rotatePages });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRotateResult({ dataUrl: data.dataUrl, pageCount: data.pageCount, rotated: data.rotated });
      setResultModal({ dataUrl: data.dataUrl, filename: rotateFile ? `${rotateFile.name.replace('.pdf','')}-rotated.pdf` : 'rotated.pdf', meta: `${data.rotated} page${data.rotated !== 1 ? 's' : ''} rotated ${rotateAngle}°` });
    } catch (err) {
      setRotateError(err.message || 'Rotate failed');
    } finally {
      stopProcessing(); setRotateBusy(false);
    }
  };

  const runImg2Pdf = async () => {
    if (!imgFiles.length) return setImgError('Upload at least 1 image.');
    startProcessing('Building PDF…', `Packing ${imgFiles.length} image${imgFiles.length !== 1 ? 's' : ''} · ${imgPageSize}`);
    setImgBusy(true); setImgError(''); setImgResult(null);
    try {
      const res = await api.post('/api/pdf/img2pdf', {
        images: imgFiles.map(f => ({ dataUrl: f.dataUrl, name: f.name })),
        pageSize: imgPageSize,
        margin: imgMargin,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setImgResult({ dataUrl: data.dataUrl, pageCount: data.pageCount });
      setResultModal({ dataUrl: data.dataUrl, filename: 'images.pdf', meta: `${data.pageCount} pages from ${imgFiles.length} image${imgFiles.length !== 1 ? 's' : ''}` });
    } catch (err) {
      setImgError(err.message || 'Conversion failed');
    } finally {
      stopProcessing(); setImgBusy(false);
    }
  };

  const runExtractText = async () => {
    if (!etFile) return setEtError('Upload a PDF first.');
    startProcessing('Extracting Text…', etFile.name);
    setEtBusy(true); setEtError(''); setEtText('');
    try {
      const pdfjsLib = await import('pdfjs-dist');
      await initPdfjsWorker(pdfjsLib);
      const doc = await pdfjsLib.getDocument({ data: dataUrlToUint8Array(etFile.dataUrl) }).promise;
      const parts = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(' ');
        parts.push(`--- Page ${i} ---\n${pageText}`);
      }
      setEtText(parts.join('\n\n'));
    } catch (err) {
      setEtError(err.message || 'Text extraction failed');
    } finally {
      stopProcessing(); setEtBusy(false);
    }
  };

  const runWatermark = async () => {
    if (!wmFile) return setWmError('Upload a PDF first.');
    if (!wmText.trim()) return setWmError('Enter watermark text.');
    startProcessing('Adding Watermark…', `"${wmText}" · ${wmFile.name}`);
    setWmBusy(true); setWmError(''); setWmResult(null);
    try {
      const res = await api.post('/api/pdf/watermark', {
        dataUrl: wmFile.dataUrl, text: wmText, fontSize: wmFontSize,
        opacity: wmOpacity, color: wmColor, angle: wmAngle,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setWmResult({ dataUrl: data.dataUrl, pageCount: data.pageCount });
      setResultModal({ dataUrl: data.dataUrl, filename: wmFile ? `${wmFile.name.replace('.pdf','')}-watermarked.pdf` : 'watermarked.pdf', meta: `"${wmText}" watermark on ${data.pageCount} pages` });
    } catch (err) {
      setWmError(err.message || 'Watermark failed');
    } finally {
      stopProcessing(); setWmBusy(false);
    }
  };

  const runPageNumbers = async () => {
    if (!pnFile) return setPnError('Upload a PDF first.');
    startProcessing('Adding Page Numbers…', `Format: ${pnFormat} · ${pnPosition}`);
    setPnBusy(true); setPnError(''); setPnResult(null);
    try {
      const res = await api.post('/api/pdf/pagenumbers', {
        dataUrl: pnFile.dataUrl, format: pnFormat, position: pnPosition,
        fontSize: pnFontSize, startAt: pnStartAt,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPnResult({ dataUrl: data.dataUrl, pageCount: data.pageCount });
      setResultModal({ dataUrl: data.dataUrl, filename: pnFile ? `${pnFile.name.replace('.pdf','')}-numbered.pdf` : 'numbered.pdf', meta: `Page numbers added to ${data.pageCount} pages` });
    } catch (err) {
      setPnError(err.message || 'Add page numbers failed');
    } finally {
      stopProcessing(); setPnBusy(false);
    }
  };

  const runInspect = async () => {
    if (!inspectFile) return setInspectError('Upload a PDF first.');
    startProcessing('Inspecting Form Fields…', inspectFile.name);
    setInspectBusy(true); setInspectError(''); setInspectFields(null);
    try {
      const res = await api.post('/api/pdf/inspect', { dataUrl: inspectFile.dataUrl });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setInspectFields(data.fields);
    } catch (err) {
      setInspectError(err.message || 'Inspect failed');
    } finally {
      stopProcessing(); setInspectBusy(false);
    }
  };

  const runFill = async () => {
    if (!fillFile) return setFillError('Upload a PDF first.');
    startProcessing('Filling Form…', fillFile.name);
    setFillBusy(true); setFillError(''); setFillResult(null);
    try {
      const res = await api.post('/api/pdf/fill', {
        dataUrl: fillFile.dataUrl, fields: fillValues,
        flatten: fillFlatten, fontFamily: fillFont, fontSize: fillFontSize, color: fillColor,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFillResult({ dataUrl: data.dataUrl, pageCount: data.pageCount, filled: data.filled });
      setResultModal({ dataUrl: data.dataUrl, filename: fillFile ? `${fillFile.name.replace('.pdf','')}-filled.pdf` : 'filled.pdf', meta: `${data.filled} field${data.filled !== 1 ? 's' : ''} filled` });
    } catch (err) {
      setFillError(err.message || 'Fill failed');
    } finally {
      stopProcessing(); setFillBusy(false);
    }
  };

  const runFlatten = async () => {
    if (!flatFile) return setFlatError('Upload a PDF first.');
    startProcessing('Flattening Form…', flatFile.name);
    setFlatBusy(true); setFlatError(''); setFlatResult(null);
    try {
      const res = await api.post('/api/pdf/flatten', { dataUrl: flatFile.dataUrl });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFlatResult({ dataUrl: data.dataUrl, pageCount: data.pageCount });
      setResultModal({ dataUrl: data.dataUrl, filename: flatFile ? `${flatFile.name.replace('.pdf','')}-flat.pdf` : 'flat.pdf', meta: `Form flattened · ${data.pageCount} pages` });
    } catch (err) {
      setFlatError(err.message || 'Flatten failed');
    } finally {
      stopProcessing(); setFlatBusy(false);
    }
  };

  const runMetaSave = async () => {
    if (!metaFile) return;
    startProcessing('Saving Metadata…', metaFile.name);
    setMetaBusy(true); setMetaError(''); setMetaResult(null);
    try {
      const res = await api.post('/api/pdf/metadata', { dataUrl: metaFile.dataUrl, update: metaEdit });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMetaResult({ dataUrl: data.dataUrl, pageCount: data.pageCount });
      setResultModal({ dataUrl: data.dataUrl, filename: metaFile ? `${metaFile.name.replace('.pdf','')}-meta.pdf` : 'meta.pdf', meta: 'Metadata updated' });
    } catch (err) {
      setMetaError(err.message || 'Save failed');
    } finally {
      stopProcessing(); setMetaBusy(false);
    }
  };

  // ── Office → PDF ────────────────────────────────────────────────────────────
  const runOfficeToPdf = async () => {
    if (!officeFile) return setOfficeError('Upload an Office file first.');
    setOfficeError('');
    startProcessing('Converting to PDF…', officeFile.name);
    setOfficeBusy(true);
    try {
      const res = await api.post('/api/pdf/office-to-pdf', { dataUrl: officeFile.dataUrl, filename: officeFile.name });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Conversion failed.');
      setResultModal({ dataUrl: data.dataUrl, filename: officeFile.name.replace(/\.[^.]+$/, '.pdf') });
    } catch (e) { setOfficeError(e.message || 'Conversion failed.'); }
    finally { stopProcessing(); setOfficeBusy(false); }
  };

  // ── Text → PDF ───────────────────────────────────────────────────────────────
  const runText2Pdf = async () => {
    if (!t2pText.trim()) return setT2pError('Paste some text first.');
    setT2pError('');
    startProcessing('Generating PDF…', t2pTitle || 'Formatted text');
    setT2pBusy(true);
    try {
      const res = await api.post('/api/pdf/text2pdf', { title: t2pTitle, text: t2pText });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'PDF generation failed.');
      setResultModal({ dataUrl: data.dataUrl, filename: `${(t2pTitle || 'document').replace(/[^\w.-]+/g, '_')}.pdf` });
    } catch (e) { setT2pError(e.message || 'PDF generation failed.'); }
    finally { stopProcessing(); setT2pBusy(false); }
  };

  // ── PDF → Office ─────────────────────────────────────────────────────────────
  const runPdfToOffice = async () => {
    if (!pto_file) return setPtoError('Upload a PDF first.');
    setPtoError('');
    startProcessing('Converting PDF to Word…', pto_file.name);
    setPtoBusy(true);
    try {
      const res = await api.post('/api/pdf/pdf-to-office', { dataUrl: pto_file.dataUrl, format: pto_format });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Conversion failed.');
      const outName = pto_file.name.replace(/\.pdf$/i, `.${data.format || pto_format}`);
      downloadFile(data.dataUrl, outName);
    } catch (e) { setPtoError(e.message || 'Conversion failed.'); }
    finally { stopProcessing(); setPtoBusy(false); }
  };

  // ── Google Drive → PDF ───────────────────────────────────────────────────────
  const runGoogleToPdf = async () => {
    if (!googleUrl.trim()) return setGoogleError('Paste a Google Drive URL first.');
    setGoogleError('');
    startProcessing('Exporting from Google Drive…', 'Fetching PDF…');
    setGoogleBusy(true);
    try {
      const res = await api.post('/api/pdf/google-to-pdf', { url: googleUrl.trim() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Export failed.');
      setResultModal({ dataUrl: data.dataUrl, filename: data.fileName || 'export.pdf' });
    } catch (e) { setGoogleError(e.message || 'Export failed.'); }
    finally { stopProcessing(); setGoogleBusy(false); }
  };

  // ── Organize Pages ───────────────────────────────────────────────────────────
  const onOrgFileChange = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setOrgError(''); setOrgResult(null);
    setOrgLoading(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const thumbs = await renderPdfThumbnails(dataUrl);
      setOrgPrimary({ name: file.name, dataUrl, size: file.size });
      setOrgPages(thumbs.map((thumb, i) => ({ id: `p_${i}_${Date.now()}`, source: 'primary', index: i, thumb })));
      setOrgInsertFile(null); setOrgInsertThumbs([]);
    } catch (err) {
      setOrgError(err?.message || 'Failed to load PDF.');
    } finally {
      setOrgLoading(false);
    }
  };

  const onOrgInsertFileChange = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setOrgLoading(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const thumbs = await renderPdfThumbnails(dataUrl);
      setOrgInsertFile({ name: file.name, dataUrl });
      setOrgInsertThumbs(thumbs.map((thumb, i) => ({ id: `i_${i}_${Date.now()}`, index: i, thumb })));
    } catch (err) {
      setOrgError(err?.message || 'Failed to load PDF.');
    } finally {
      setOrgLoading(false);
    }
  };

  const orgResetAll = () => {
    setOrgPrimary(null); setOrgPages([]);
    setOrgInsertFile(null); setOrgInsertThumbs([]);
    setOrgResult(null); setOrgError('');
  };

  const orgRemovePage = (id) => {
    setOrgPages(prev => prev.filter(p => p.id !== id));
    setOrgConfirmDelete(null);
  };

  // Plain HTML5 drag-and-drop — no drag library exists elsewhere in the
  // client, so this keeps the same "no new dependency" approach as the field
  // designer's canvas interactions.
  const onOrgDragStart = (id) => { orgDragId.current = id; };
  const onOrgDragOverPage = (e) => { e.preventDefault(); };

  const onOrgDropOnPage = (targetId) => {
    const dragId = orgDragId.current;
    orgDragId.current = null;
    if (!dragId || dragId === targetId) return;
    const fromInsert = orgInsertThumbs.find(p => p.id === dragId);
    if (fromInsert) {
      setOrgPages(prev => {
        const toIdx = prev.findIndex(p => p.id === targetId);
        const next = [...prev];
        next.splice(toIdx === -1 ? next.length : toIdx, 0, {
          id: `ins_${fromInsert.id}_${Date.now()}`, source: 'inserted', index: fromInsert.index, thumb: fromInsert.thumb,
        });
        return next;
      });
      return;
    }
    setOrgPages(prev => {
      const next = [...prev];
      const fromIdx = next.findIndex(p => p.id === dragId);
      const toIdx = next.findIndex(p => p.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const onOrgDropAtEnd = () => {
    const dragId = orgDragId.current;
    orgDragId.current = null;
    if (!dragId) return;
    const fromInsert = orgInsertThumbs.find(p => p.id === dragId);
    if (fromInsert) {
      setOrgPages(prev => [...prev, { id: `ins_${fromInsert.id}_${Date.now()}`, source: 'inserted', index: fromInsert.index, thumb: fromInsert.thumb }]);
      return;
    }
    setOrgPages(prev => {
      const fromIdx = prev.findIndex(p => p.id === dragId);
      if (fromIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.push(moved);
      return next;
    });
  };

  const runOrgExtract = async (page) => {
    const srcDataUrl = page.source === 'inserted' ? orgInsertFile?.dataUrl : orgPrimary?.dataUrl;
    if (!srcDataUrl) return;
    setOrgExtracting(page.id); setOrgError('');
    try {
      const res = await api.post('/api/pdf/split', { dataUrl: srcDataUrl, pages: String(page.index + 1) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Extract failed.');
      downloadFile(data.dataUrl, `page-${page.index + 1}.pdf`);
    } catch (err) {
      setOrgError(err.message || 'Extract failed.');
    } finally {
      setOrgExtracting(null);
    }
  };

  const runOrganize = async () => {
    if (!orgPrimary || !orgPages.length) return;
    startProcessing('Reorganizing PDF…', `${orgPages.length} page${orgPages.length !== 1 ? 's' : ''}`);
    setOrgBusy(true); setOrgError(''); setOrgResult(null);
    try {
      const body = {
        dataUrl: orgPrimary.dataUrl,
        pages: orgPages.map(p => ({ source: p.source, index: p.index })),
      };
      if (orgInsertFile && orgPages.some(p => p.source === 'inserted')) body.insertedDataUrl = orgInsertFile.dataUrl;
      const res = await api.post('/api/pdf/organize', body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Organize failed.');
      setOrgResult({ dataUrl: data.dataUrl, pageCount: data.pageCount });
      setResultModal({
        dataUrl: data.dataUrl,
        filename: `${orgPrimary.name.replace('.pdf', '')}-organized.pdf`,
        meta: `${data.pageCount} page${data.pageCount !== 1 ? 's' : ''}`,
      });
    } catch (err) {
      setOrgError(err.message || 'Organize failed.');
    } finally {
      stopProcessing(); setOrgBusy(false);
    }
  };

  // ── Fill & Sign ───────────────────────────────────────────────────────────────
  const redrawSignOverlay = useCallback(() => {
    const canvas = signUiCanvasRef.current;
    if (!canvas) return;
    const dims = signPageDimsRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!dims) return;
    for (const s of signPlacedRef.current.filter(s => s.page === signCurrentPageRef.current)) {
      const cx = s.x * dims.renderScale;
      const cy = dims.canvasH - (s.y + s.height) * dims.renderScale;
      const cw = s.width * dims.renderScale;
      const ch = s.height * dims.renderScale;
      const isSel = s.id === signSelectedIdRef.current;
      ctx.save();
      ctx.strokeStyle = isSel ? 'rgb(234,88,12)' : 'rgb(99,102,241)';
      ctx.lineWidth = isSel ? 2 : 1.5;
      ctx.setLineDash(isSel ? [] : [4, 3]);
      ctx.strokeRect(cx, cy, cw, ch);
      ctx.restore();
      if (s.type === 'type') {
        const css = fontCss(s.fontFamily || 'Great Vibes');
        const fontSize = Math.max(8, Math.min(48, ch * 0.6));
        ctx.font = `${fontSize}px ${css.fontFamily}`;
        ctx.fillStyle = '#000';
        ctx.fillText(s.text || '', cx + 3, cy + ch / 2 + fontSize * 0.35, cw - 6);
      } else if (s.previewImg) {
        ctx.drawImage(s.previewImg, cx, cy, cw, ch);
      }
      if (isSel) {
        const hs = 7;
        ctx.fillStyle = 'rgb(234,88,12)';
        [[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]].forEach(([hx, hy]) => {
          ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
        });
      }
    }
  }, []);

  const renderSignPage = useCallback(async (pageNum) => {
    const pdfCanvas = signPdfCanvasRef.current;
    const uiCanvas = signUiCanvasRef.current;
    if (!pdfCanvas || !uiCanvas || !signPdfDocRef.current) return;
    const page = await signPdfDocRef.current.getPage(pageNum);
    const origVp = page.getViewport({ scale: 1 });
    const maxW = Math.min(580, (window.innerWidth || 1200) * 0.52);
    const rs = Math.min(maxW / origVp.width, 1.8);
    const vp = page.getViewport({ scale: rs });
    pdfCanvas.width = Math.floor(vp.width);
    pdfCanvas.height = Math.floor(vp.height);
    uiCanvas.width = Math.floor(vp.width);
    uiCanvas.height = Math.floor(vp.height);
    const dims = { pdfW: origVp.width, pdfH: origVp.height, renderScale: rs, canvasW: Math.floor(vp.width), canvasH: Math.floor(vp.height) };
    signPageDimsRef.current = dims;
    setSignPageDims(dims);
    await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: vp }).promise;
    redrawSignOverlay();
  }, [redrawSignOverlay]);

  useEffect(() => {
    if (signFile && signPdfDocRef.current) renderSignPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signFile]);

  useEffect(() => {
    if (signPdfDocRef.current && signCurrentPage) renderSignPage(signCurrentPage);
  }, [signCurrentPage, renderSignPage]);

  useEffect(() => { redrawSignOverlay(); }, [signPlaced, redrawSignOverlay]);

  const signCanvasCoords = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  };

  const hitTestSignPlacements = useCallback((cx, cy, dims) => {
    const onPage = [...signPlacedRef.current].filter(s => s.page === signCurrentPageRef.current).reverse();
    for (const s of onPage) {
      const fx = s.x * dims.renderScale;
      const fy = dims.canvasH - (s.y + s.height) * dims.renderScale;
      const fw = s.width * dims.renderScale;
      const fh = s.height * dims.renderScale;
      if (cx >= fx && cx <= fx + fw && cy >= fy && cy <= fy + fh) return s.id;
    }
    return null;
  }, []);

  const onSignDown = useCallback((e) => {
    const dims = signPageDimsRef.current;
    if (!dims) return;
    const pos = signCanvasCoords(e, signUiCanvasRef.current);
    const hitId = hitTestSignPlacements(pos.x, pos.y, dims);
    if (hitId) {
      setSignSelectedId(hitId);
      signSelectedIdRef.current = hitId;
      const item = signPlacedRef.current.find(s => s.id === hitId);
      signMoveRef.current = { id: hitId, startX: pos.x, startY: pos.y, origX: item.x, origY: item.y, w: item.width, h: item.height };
      signIsDrawingRef.current = false;
    } else {
      setSignSelectedId(null);
      signSelectedIdRef.current = null;
      signMoveRef.current = null;
      signIsDrawingRef.current = true;
      signStartRef.current = pos;
    }
  }, [hitTestSignPlacements]);

  const onSignMove = useCallback((e) => {
    const dims = signPageDimsRef.current;
    const canvas = signUiCanvasRef.current;
    if (!canvas) return;
    const cur = signCanvasCoords(e, canvas);

    if (!signIsDrawingRef.current && !signMoveRef.current && dims) {
      canvas.style.cursor = hitTestSignPlacements(cur.x, cur.y, dims) ? 'move' : 'crosshair';
    }

    if (signMoveRef.current) {
      const { id, startX, startY, origX, origY, w, h } = signMoveRef.current;
      const rs = dims.renderScale;
      const newX = Math.max(0, Math.min(dims.pdfW - w, origX + (cur.x - startX) / rs));
      const newY = Math.max(0, Math.min(dims.pdfH - h, origY - (cur.y - startY) / rs));
      const next = signPlacedRef.current.map(s => s.id === id ? { ...s, x: newX, y: newY } : s);
      signPlacedRef.current = next;
      setSignPlaced(next);
      redrawSignOverlay();
      return;
    }

    if (!signIsDrawingRef.current || !signStartRef.current) return;
    const { x: sx, y: sy } = signStartRef.current;
    const bx = Math.min(sx, cur.x), by = Math.min(sy, cur.y);
    const bw = Math.abs(cur.x - sx), bh = Math.abs(cur.y - sy);
    redrawSignOverlay();
    const ctx = canvas.getContext('2d');
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(239,68,68,0.9)';
    ctx.fillStyle = 'rgba(239,68,68,0.08)';
    ctx.lineWidth = 1.5;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeRect(bx, by, bw, bh);
    ctx.setLineDash([]);
  }, [redrawSignOverlay, hitTestSignPlacements]);

  const onSignUp = useCallback((e) => {
    if (signMoveRef.current) { signMoveRef.current = null; redrawSignOverlay(); return; }
    if (!signIsDrawingRef.current || !signStartRef.current || !signPageDimsRef.current) return;
    signIsDrawingRef.current = false;
    const cur = signCanvasCoords(e, signUiCanvasRef.current);
    const { x: sx, y: sy } = signStartRef.current;
    signStartRef.current = null;
    const bx = Math.min(sx, cur.x), by = Math.min(sy, cur.y);
    const bw = Math.abs(cur.x - sx), bh = Math.abs(cur.y - sy);
    if (bw < 15 || bh < 10) { redrawSignOverlay(); return; }
    const dims = signPageDimsRef.current;

    const mode = signModeRef.current;
    let content = null;
    if (mode === 'type') {
      if (!signTypeTextRef.current.trim()) { setSignError('Type something first.'); redrawSignOverlay(); return; }
      content = { type: 'type', text: signTypeTextRef.current.trim(), fontFamily: signFontRef.current };
    } else if (mode === 'image') {
      if (!signImageDataUrlRef.current) { setSignError('Upload an image first.'); redrawSignOverlay(); return; }
      content = { type: 'image', dataUrl: signImageDataUrlRef.current };
    } else {
      const padCanvas = signPadCanvasRef.current;
      if (!padCanvas || isCanvasBlank(padCanvas)) { setSignError('Draw your signature first.'); redrawSignOverlay(); return; }
      content = { type: 'draw', dataUrl: padCanvas.toDataURL('image/png') };
    }

    const newPlacement = {
      id: `sig_${Date.now()}`,
      page: signCurrentPageRef.current,
      x: bx / dims.renderScale,
      y: dims.pdfH - (by + bh) / dims.renderScale,
      width: bw / dims.renderScale,
      height: bh / dims.renderScale,
      ...content,
    };
    if (newPlacement.type !== 'type') {
      const img = new Image();
      img.onload = () => { newPlacement.previewImg = img; redrawSignOverlay(); };
      img.src = newPlacement.dataUrl;
    }
    const next = [...signPlacedRef.current, newPlacement];
    signPlacedRef.current = next;
    setSignPlaced(next);
    setSignSelectedId(newPlacement.id);
    signSelectedIdRef.current = newPlacement.id;
    setSignError('');
  }, [redrawSignOverlay]);

  const onSignLeave = useCallback(() => {
    if (signMoveRef.current) { signMoveRef.current = null; redrawSignOverlay(); }
    if (signIsDrawingRef.current) { signIsDrawingRef.current = false; signStartRef.current = null; redrawSignOverlay(); }
  }, [redrawSignOverlay]);

  const removeSignPlacement = useCallback((id) => {
    setSignPlaced(prev => prev.filter(s => s.id !== id));
    setSignSelectedId(null);
  }, []);

  useEffect(() => {
    const handleKey = (e) => {
      if (!signSelectedIdRef.current) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      removeSignPlacement(signSelectedIdRef.current);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [removeSignPlacement]);

  const onSignFileChange = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setSignPlaced([]); signPlacedRef.current = [];
    setSignResult(null); setSignError('');
    setSignCurrentPage(1); signCurrentPageRef.current = 1;
    setSignLoading(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const pdfjsLib = await import('pdfjs-dist');
      await initPdfjsWorker(pdfjsLib);
      const doc = await pdfjsLib.getDocument({ data: dataUrlToUint8Array(dataUrl) }).promise;
      signPdfDocRef.current = doc;
      setSignPageCount(doc.numPages);
      setSignFile({ name: file.name, dataUrl, size: file.size });
    } finally {
      setSignLoading(false);
    }
  };

  const changeSignPage = (n) => {
    if (n < 1 || n > signPageCount) return;
    setSignCurrentPage(n);
  };

  const onSignImageUpload = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setSignImageDataUrl(await readFileAsDataUrl(file));
  };

  // Drawing pad — plain mouse/touch strokes on a small canvas, used as the
  // "draw" signature source. No new dependency; same technique as any basic
  // HTML5 canvas signature pad.
  const padPointerPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return {
      x: (p.clientX - rect.left) * (canvas.width / rect.width),
      y: (p.clientY - rect.top) * (canvas.height / rect.height),
    };
  };
  const onPadStart = (e) => {
    e.preventDefault();
    signPadDrawingRef.current = true;
    const canvas = signPadCanvasRef.current;
    const pos = padPointerPos(e, canvas);
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };
  const onPadMove = (e) => {
    if (!signPadDrawingRef.current) return;
    e.preventDefault();
    const canvas = signPadCanvasRef.current;
    const pos = padPointerPos(e, canvas);
    const ctx = canvas.getContext('2d');
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.stroke();
  };
  const onPadEnd = () => { signPadDrawingRef.current = false; };
  const clearPad = () => {
    const canvas = signPadCanvasRef.current;
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  };

  const runSign = async () => {
    if (!signFile || !signPlaced.length) return;
    startProcessing('Applying signatures…', `${signPlaced.length} placement${signPlaced.length !== 1 ? 's' : ''} · ${signFile.name}`);
    setSignBusy(true); setSignError(''); setSignResult(null);
    try {
      const signatures = signPlaced.map(s => ({
        page: s.page, x: s.x, y: s.y, width: s.width, height: s.height,
        type: s.type, dataUrl: s.dataUrl, text: s.text, fontFamily: s.fontFamily,
      }));
      const res = await api.post('/api/pdf/sign', { dataUrl: signFile.dataUrl, signatures });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sign failed.');
      setSignResult({ dataUrl: data.dataUrl, placed: data.placed });
      setResultModal({
        dataUrl: data.dataUrl,
        filename: `${signFile.name.replace('.pdf', '')}-signed.pdf`,
        meta: `${data.placed} signature${data.placed !== 1 ? 's' : ''} applied`,
      });
    } catch (err) {
      setSignError(err.message || 'Sign failed.');
    } finally {
      stopProcessing(); setSignBusy(false);
    }
  };

  // ── Compress ───────────────────────────────────────────────────────────────
  const onCmpFileChange = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    setCmpFile({ name: file.name, dataUrl, size: file.size });
    setCmpResult(null); setCmpError('');
  };

  const runCompress = async () => {
    if (!cmpFile) return;
    startProcessing('Compressing PDF…', cmpFile.name);
    setCmpBusy(true); setCmpError(''); setCmpResult(null);
    try {
      const res = await api.post('/api/pdf/compress', { dataUrl: cmpFile.dataUrl, recompressImages: cmpRecompress, quality: cmpQuality });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Compress failed.');
      setCmpResult(data);
    } catch (err) {
      setCmpError(err.message || 'Compress failed.');
    } finally {
      stopProcessing(); setCmpBusy(false);
    }
  };

  // ── Shared label styles ────────────────────────────────────────────────────

  const lbl = 'block text-xs font-medium mb-1';
  const inp = 'w-full text-sm px-3 py-2 rounded-lg border outline-none';
  const inpStyle = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
  const cardStyle = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };

  const descMap = {
    merge: 'Combine multiple PDFs into one document.',
    split: 'Extract a page range into a new PDF.',
    rotate: 'Rotate all or specific pages.',
    img2pdf: 'Pack images into a PDF document.',
    text2pdf: 'Paste formatted text and generate a PDF.',
    extracttext: 'Pull all text from a PDF (client-side).',
    watermark: 'Stamp a diagonal text watermark.',
    pagenumbers: 'Add page numbers to every page.',
    inspect: 'List all interactive form fields.',
    fill: 'Fill in form fields and download.',
    flatten: 'Lock form fields as static content.',
    fielddesigner: 'Draw and place interactive form fields on a PDF page.',
    metadata: 'View and edit document metadata.',
    fileinfo: 'Show basic file information (client-side).',
    officetopdf: 'Convert Word, Excel or PowerPoint to PDF.',
    pdftooffice: 'Convert a PDF to an editable Word document.',
    googletopdf: 'Export a Google Doc, Sheet or Slide as PDF.',
    organize: 'Reorder, delete, insert, and extract pages.',
    sign: 'Draw, type, or upload a signature onto any PDF.',
    compress: "Shrink a PDF's file size.",
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          {getIcon('file-text', { size: 20 })}
          PDF Tools
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
          {descMap[mode] || ''}
        </p>
        {seedBanner && (
          <div className="mt-3 px-3 py-2 rounded-xl text-xs flex flex-wrap items-center justify-between gap-2" style={{ background: '#ecfdf5', color: '#065f46' }}>
            <span>{seedBanner}</span>
            <button type="button" onClick={() => setSeedBanner('')} className="underline transition-opacity duration-200 hover:opacity-70">Dismiss</button>
          </div>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-start">

        {/* ── Sidebar ───────────────────────────────────────────────────── */}
        <aside className="w-full md:w-52 md:shrink-0 md:sticky md:top-6">
          <div className="relative mb-3">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-muted)' }}>
              {getIcon('search', { size: 14 })}
            </span>
            <input
              ref={toolSearchRef}
              type="text"
              value={toolSearch}
              onChange={e => setToolSearch(e.target.value)}
              placeholder="Search tools…  ( / )"
              className="w-full pl-8 pr-7 py-2 rounded-lg border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
            {toolSearch && (
              <button type="button" onClick={() => setToolSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 hover:opacity-70" style={{ color: 'var(--color-muted)' }}>
                {getIcon('x', { size: 14 })}
              </button>
            )}
          </div>

          <nav className="flex md:block gap-4 md:gap-0 overflow-x-auto md:overflow-visible pb-2 md:pb-0">
            {MODE_GROUPS.map(group => {
              const q = toolSearch.trim().toLowerCase();
              const ids = group.ids.filter(id => {
                const m = MODES.find(x => x.id === id);
                return m && (!q || m.label.toLowerCase().includes(q));
              });
              if (!ids.length) return null;
              const collapsed = q ? false : openGroup !== group.label;
              return (
                <div key={group.label} className="mb-0 md:mb-4 shrink-0">
                  <button
                    type="button"
                    onClick={() => setOpenGroup(prev => (prev === group.label ? null : group.label))}
                    className="flex items-center gap-1 w-full px-2 mb-1.5 text-sm font-bold uppercase tracking-wide hover:opacity-80 transition-opacity"
                    style={{ color: 'var(--color-primary)' }}
                  >
                    <span style={{ display: 'inline-flex', transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }}>
                      {getIcon('chevron-down', { size: 15 })}
                    </span>
                    {group.label}
                  </button>
                  {!collapsed && (
                    <div className="flex md:flex-col gap-1 md:pl-3 md:ml-1 md:border-l" style={{ borderColor: 'var(--color-border)' }}>
                      {ids.map(id => {
                        const m = MODES.find(x => x.id === id);
                        if (!m) return null;
                        const active = mode === m.id;
                        const hovered = hoveredTool === m.id && !active;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setMode(m.id)}
                            onMouseEnter={() => setHoveredTool(m.id)}
                            onMouseLeave={() => setHoveredTool(prev => (prev === m.id ? null : prev))}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors text-left"
                            style={{
                              color: active ? '#fff' : hovered ? 'var(--color-primary)' : 'var(--color-text)',
                              background: active ? 'var(--color-primary)' : hovered ? 'var(--color-bg)' : 'transparent',
                            }}
                          >
                            {getIcon(m.icon, { size: 15 })}
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>

        {/* ── Main panel ────────────────────────────────────────────────── */}
        <main className="min-w-0 flex-1 w-full">

          {/* ═══ Merge ══════════════════════════════════════════════════ */}
          {mode === 'merge' && (
            <section>
              <ToolHeader id="merge" label="Merge PDFs" onHelp={setHelpTool} getIcon={getIcon}
                badge={mergeFiles.length ? `${mergeFiles.length} file${mergeFiles.length !== 1 ? 's' : ''}` : undefined} />
              <div className="grid lg:grid-cols-2 gap-6">
                <div>
                  <PdfUpload
                    label="PDFs to merge (in order)"
                    multiple
                    onChange={onMergeFilesChange}
                    files={mergeFiles}
                    onRemove={i => setMergeFiles(prev => prev.filter((_, idx) => idx !== i))}
                  />
                  {mergeFiles.length > 1 && (
                    <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                      Files will be merged in the order shown above. Remove to reorder.
                    </p>
                  )}
                  <ErrMsg msg={mergeError} />
                  <RunBtn onClick={runMerge} busy={mergeBusy} disabled={mergeFiles.length < 2} label="Merge PDFs" getIcon={getIcon} />
                </div>
                <div>
                  <PdfPagePreview dataUrl={mergeFiles[0]?.dataUrl} />
                </div>
              </div>
            </section>
          )}

          {/* ═══ Split ══════════════════════════════════════════════════ */}
          {mode === 'split' && (
            <section>
              <ToolHeader id="split" label="Split PDF" onHelp={setHelpTool} getIcon={getIcon}
                badge={splitFile?.pageCount ? `${splitFile.pageCount}pp source` : undefined} />
              <div className="grid lg:grid-cols-2 gap-6">
                <div>
                  <PdfUpload onChange={onSplitFileChange} files={splitFile ? [splitFile] : []} onRemove={() => { setSplitFile(null); setSplitResult(null); }} />
                  <div className="mt-3">
                    <label className={lbl} style={{ color: 'var(--color-muted)' }}>
                      Pages to extract {splitFile?.pageCount ? `(PDF has ${splitFile.pageCount} pages)` : ''}
                    </label>
                    <input
                      type="text"
                      className={inp}
                      style={inpStyle}
                      placeholder="e.g. 1-3, 5, 7-9"
                      value={splitPages}
                      onChange={e => setSplitPages(e.target.value)}
                    />
                    <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Ranges (1-3) and individual pages (5) can be mixed.</p>
                  </div>
                  <ErrMsg msg={splitError} />
                  <RunBtn onClick={runSplit} busy={splitBusy} disabled={!splitFile || !splitPages.trim()} label="Extract Pages" getIcon={getIcon} />
                </div>
                <div>
                  <PdfPagePreview dataUrl={splitFile?.dataUrl} />
                </div>
              </div>
            </section>
          )}

          {/* ═══ Rotate ═════════════════════════════════════════════════ */}
          {mode === 'rotate' && (
            <section>
              <ToolHeader id="rotate" label="Rotate Pages" onHelp={setHelpTool} getIcon={getIcon}
                badge={rotateFile?.pageCount ? `${rotateFile.pageCount}pp` : undefined} />
              <div className="grid lg:grid-cols-2 gap-6">
                <div>
                  <PdfUpload onChange={onRotateFileChange} files={rotateFile ? [rotateFile] : []} onRemove={() => { setRotateFile(null); setRotateResult(null); }} />
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <label className={lbl} style={{ color: 'var(--color-muted)' }}>Rotation</label>
                      <select className={inp} style={inpStyle} value={rotateAngle} onChange={e => setRotateAngle(Number(e.target.value))}>
                        <option value={90}>90° clockwise</option>
                        <option value={180}>180°</option>
                        <option value={270}>270° (90° CCW)</option>
                      </select>
                    </div>
                    <div>
                      <label className={lbl} style={{ color: 'var(--color-muted)' }}>Pages</label>
                      <input type="text" className={inp} style={inpStyle} placeholder="all or 1,3,5-7" value={rotatePages} onChange={e => setRotatePages(e.target.value)} />
                    </div>
                  </div>
                  <ErrMsg msg={rotateError} />
                  <RunBtn onClick={runRotate} busy={rotateBusy} disabled={!rotateFile} label="Rotate & Download" getIcon={getIcon} />
                </div>
                <div>
                  <PdfPagePreview dataUrl={rotateFile?.dataUrl} />
                </div>
              </div>
            </section>
          )}

          {/* ═══ Images → PDF ═══════════════════════════════════════════ */}
          {mode === 'img2pdf' && (
            <section>
              <ToolHeader id="img2pdf" label="Images → PDF" onHelp={setHelpTool} getIcon={getIcon}
                badge={imgFiles.length ? `${imgFiles.length} image${imgFiles.length !== 1 ? 's' : ''}` : undefined} />
              <div className="grid lg:grid-cols-2 gap-6">
                <div>
                  <PdfUpload
                    label="Images (each becomes a page)"
                    accept="image/*"
                    multiple
                    onChange={onImgFilesChange}
                    files={imgFiles}
                    onRemove={i => setImgFiles(prev => prev.filter((_, idx) => idx !== i))}
                  />
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <label className={lbl} style={{ color: 'var(--color-muted)' }}>Page size</label>
                      <select className={inp} style={inpStyle} value={imgPageSize} onChange={e => setImgPageSize(e.target.value)}>
                        <option value="A4">A4</option>
                        <option value="A3">A3</option>
                        <option value="Letter">Letter</option>
                        <option value="Legal">Legal</option>
                        <option value="fit">Fit to image</option>
                      </select>
                    </div>
                    <div>
                      <label className={lbl} style={{ color: 'var(--color-muted)' }}>Margin (pt) — {imgMargin}pt</label>
                      <input type="range" min={0} max={72} value={imgMargin} onChange={e => setImgMargin(Number(e.target.value))} className="w-full mt-2" />
                    </div>
                  </div>
                  <ErrMsg msg={imgError} />
                  <RunBtn onClick={runImg2Pdf} busy={imgBusy} disabled={!imgFiles.length} label="Create PDF" getIcon={getIcon} />
                </div>
                <div>
                  {imgFiles[0] && (
                    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                      <img src={imgFiles[0].dataUrl} alt="first image" style={{ display: 'block', maxWidth: '100%', maxHeight: 460, objectFit: 'contain' }} />
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ═══ Extract Text ════════════════════════════════════════════ */}
          {mode === 'extracttext' && (
            <section>
              <ToolHeader id="extracttext" label="Extract Text" onHelp={setHelpTool} getIcon={getIcon} badge="Client-side" />
              <div className="grid lg:grid-cols-2 gap-6">
                <div>
                  <PdfUpload onChange={onEtFileChange} files={etFile ? [etFile] : []} onRemove={() => { setEtFile(null); setEtText(''); }} />
                  <ErrMsg msg={etError} />
                  <RunBtn onClick={runExtractText} busy={etBusy} disabled={!etFile} label="Extract Text" getIcon={getIcon} />
                  <div className="mt-4">
                    <PdfPagePreview dataUrl={etFile?.dataUrl} />
                  </div>
                </div>
                <div>
                  {etText && (
                    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                        <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Extracted text</span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => navigator.clipboard.writeText(etText)}
                            className="text-xs hover:opacity-60 transition-opacity"
                            style={{ color: 'var(--color-primary)' }}
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const blob = new Blob([etText], { type: 'text/plain' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url; a.download = (etFile?.name.replace('.pdf', '') || 'extracted') + '.txt'; a.click();
                              URL.revokeObjectURL(url);
                            }}
                            className="text-xs hover:opacity-60 transition-opacity"
                            style={{ color: 'var(--color-primary)' }}
                          >
                            Save .txt
                          </button>
                        </div>
                      </div>
                      <textarea
                        readOnly
                        value={etText}
                        className="w-full text-xs p-3 resize-none outline-none"
                        style={{ height: 320, background: 'var(--color-bg)', color: 'var(--color-text)' }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ═══ Watermark ══════════════════════════════════════════════ */}
          {mode === 'watermark' && (
            <section>
              <ToolHeader id="watermark" label="Watermark" onHelp={setHelpTool} getIcon={getIcon} />
              <div className="grid lg:grid-cols-2 gap-6">
                <div>
                  <PdfUpload onChange={onWmFileChange} files={wmFile ? [wmFile] : []} onRemove={() => { setWmFile(null); setWmResult(null); }} />
                  <div className="mt-3 space-y-3">
                    <div>
                      <label className={lbl} style={{ color: 'var(--color-muted)' }}>Watermark text</label>
                      <input type="text" className={inp} style={inpStyle} value={wmText} onChange={e => setWmText(e.target.value)} placeholder="CONFIDENTIAL" />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className={lbl} style={{ color: 'var(--color-muted)' }}>Font size — {wmFontSize}pt</label>
                        <input type="range" min={12} max={150} value={wmFontSize} onChange={e => setWmFontSize(Number(e.target.value))} className="w-full mt-2" />
                      </div>
                      <div>
                        <label className={lbl} style={{ color: 'var(--color-muted)' }}>Opacity — {Math.round(wmOpacity * 100)}%</label>
                        <input type="range" min={1} max={100} value={Math.round(wmOpacity * 100)} onChange={e => setWmOpacity(e.target.value / 100)} className="w-full mt-2" />
                      </div>
                      <div>
                        <label className={lbl} style={{ color: 'var(--color-muted)' }}>Angle — {wmAngle}°</label>
                        <input type="range" min={-90} max={90} value={wmAngle} onChange={e => setWmAngle(Number(e.target.value))} className="w-full mt-2" />
                      </div>
                    </div>
                    <div>
                      <label className={lbl} style={{ color: 'var(--color-muted)' }}>Colour</label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={wmColor} onChange={e => setWmColor(e.target.value)} className="w-10 h-8 rounded border cursor-pointer" style={{ borderColor: 'var(--color-border)' }} />
                        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{wmColor}</span>
                      </div>
                    </div>
                  </div>
                  <ErrMsg msg={wmError} />
                  <RunBtn onClick={runWatermark} busy={wmBusy} disabled={!wmFile} label="Apply Watermark" getIcon={getIcon} />
                </div>
                <div>
                  <PdfPagePreview dataUrl={wmFile?.dataUrl} />
                </div>
              </div>
            </section>
          )}

          {/* ═══ Page Numbers ════════════════════════════════════════════ */}
          {mode === 'pagenumbers' && (
            <section>
              <ToolHeader id="pagenumbers" label="Page Numbers" onHelp={setHelpTool} getIcon={getIcon} />
              <div className="grid lg:grid-cols-2 gap-6">
                <div>
                  <PdfUpload onChange={onPnFileChange} files={pnFile ? [pnFile] : []} onRemove={() => { setPnFile(null); setPnResult(null); }} />
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={lbl} style={{ color: 'var(--color-muted)' }}>Format</label>
                        <select className={inp} style={inpStyle} value={pnFormat} onChange={e => setPnFormat(e.target.value)}>
                          <option value="{n}">{'{n}'}</option>
                          <option value="Page {n}">Page {'{n}'}</option>
                          <option value="{n} of {total}">{'{n}'} of {'{total}'}</option>
                          <option value="Page {n} of {total}">Page {'{n}'} of {'{total}'}</option>
                        </select>
                      </div>
                      <div>
                        <label className={lbl} style={{ color: 'var(--color-muted)' }}>Position</label>
                        <select className={inp} style={inpStyle} value={pnPosition} onChange={e => setPnPosition(e.target.value)}>
                          <option value="bottom-center">Bottom Centre</option>
                          <option value="bottom-right">Bottom Right</option>
                          <option value="bottom-left">Bottom Left</option>
                          <option value="top-center">Top Centre</option>
                          <option value="top-right">Top Right</option>
                          <option value="top-left">Top Left</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={lbl} style={{ color: 'var(--color-muted)' }}>Font size — {pnFontSize}pt</label>
                        <input type="range" min={6} max={24} value={pnFontSize} onChange={e => setPnFontSize(Number(e.target.value))} className="w-full mt-2" />
                      </div>
                      <div>
                        <label className={lbl} style={{ color: 'var(--color-muted)' }}>Start at</label>
                        <input type="number" min={1} className={inp} style={inpStyle} value={pnStartAt} onChange={e => setPnStartAt(Math.max(1, Number(e.target.value)))} />
                      </div>
                    </div>
                  </div>
                  <ErrMsg msg={pnError} />
                  <RunBtn onClick={runPageNumbers} busy={pnBusy} disabled={!pnFile} label="Add Page Numbers" getIcon={getIcon} />
                </div>
                <div>
                  <PdfPagePreview dataUrl={pnFile?.dataUrl} />
                </div>
              </div>
            </section>
          )}

          {/* ═══ Inspect Fields ══════════════════════════════════════════ */}
          {mode === 'inspect' && (
            <section>
              <ToolHeader id="inspect" label="Inspect Form Fields" onHelp={setHelpTool} getIcon={getIcon} />
              <div className="grid lg:grid-cols-2 gap-6">
                <div>
                  <PdfUpload onChange={onInspectFileChange} files={inspectFile ? [inspectFile] : []} onRemove={() => { setInspectFile(null); setInspectFields(null); }} />
                  <ErrMsg msg={inspectError} />
                  <RunBtn onClick={runInspect} busy={inspectBusy} disabled={!inspectFile} label="Inspect Fields" getIcon={getIcon} />
                  <div className="mt-4">
                    <PdfPagePreview dataUrl={inspectFile?.dataUrl} />
                  </div>
                </div>
                <div>
                  {inspectFields !== null && (
                    inspectFields.length === 0 ? (
                      <div className="rounded-xl border p-6 text-center" style={{ borderColor: 'var(--color-border)' }}>
                        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No interactive form fields found in this PDF.</p>
                      </div>
                    ) : (
                      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                        <div className="px-3 py-2 border-b text-xs font-medium" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}>
                          {inspectFields.length} field{inspectFields.length !== 1 ? 's' : ''} found
                        </div>
                        <div className="overflow-y-auto" style={{ maxHeight: 380 }}>
                          <table className="w-full text-xs">
                            <thead>
                              <tr style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>
                                <th className="px-3 py-2 text-left font-medium">Name</th>
                                <th className="px-3 py-2 text-left font-medium">Type</th>
                                <th className="px-3 py-2 text-left font-medium">Value</th>
                                <th className="px-3 py-2 text-left font-medium">Flags</th>
                              </tr>
                            </thead>
                            <tbody>
                              {inspectFields.map((f, i) => (
                                <tr key={i} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                                  <td className="px-3 py-2 font-mono max-w-[120px] truncate" style={{ color: 'var(--color-text)' }} title={f.name}>{f.name}</td>
                                  <td className="px-3 py-2" style={{ color: 'var(--color-muted)' }}>{f.type}</td>
                                  <td className="px-3 py-2 max-w-[100px] truncate" style={{ color: 'var(--color-text)' }} title={f.value}>{f.value || '—'}</td>
                                  <td className="px-3 py-2">
                                    {f.required && <span className="px-1.5 py-0.5 rounded text-[10px] mr-1" style={{ background: '#fef3c7', color: '#92400e' }}>req</span>}
                                    {f.readOnly && <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: '#f3f4f6', color: '#6b7280' }}>ro</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ═══ Fill Form ═══════════════════════════════════════════════ */}
          {mode === 'fill' && (
            <section>
              <ToolHeader id="fill" label="Fill Form" onHelp={setHelpTool} getIcon={getIcon}
                badge={fillAvailable.length ? `${fillAvailable.length} field${fillAvailable.length !== 1 ? 's' : ''}` : undefined} />
              <div className="grid lg:grid-cols-2 gap-6">
                <div>
                  <PdfUpload onChange={onFillFileChange} files={fillFile ? [fillFile] : []} onRemove={() => { setFillFile(null); setFillAvailable([]); setFillValues({}); setFillResult(null); }} />
                  {fillBusy && <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>Reading form fields…</p>}
                  {fillAvailable.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
                        <input type="checkbox" checked={fillFlatten} onChange={e => setFillFlatten(e.target.checked)} className="w-3.5 h-3.5" />
                        Save as flattened text (recommended — guarantees the chosen font renders correctly in every PDF viewer; fields become static, not re-editable)
                      </label>
                      {fillFlatten && (
                        <div className="flex items-center gap-1.5">
                          <select
                            value={fillFont}
                            onChange={e => setFillFont(e.target.value)}
                            className="flex-1 text-xs px-1.5 py-1 rounded border outline-none"
                            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                            title="Font"
                          >
                            {Object.entries(STAMP_FONT_GROUPS).map(([group, fonts]) => (
                              <optgroup key={group} label={group}>
                                {fonts.map(font => {
                                  const css = fontCss(font);
                                  return (
                                    <option key={font} value={font} style={{ fontFamily: css.fontFamily, fontStyle: css.fontStyle, fontWeight: css.fontWeight }}>
                                      {STANDARD_FONT_LABELS[font] || font}
                                    </option>
                                  );
                                })}
                              </optgroup>
                            ))}
                          </select>
                          <input
                            type="number"
                            value={fillFontSize}
                            min={6} max={72}
                            onChange={e => setFillFontSize(Number(e.target.value))}
                            className="w-14 text-xs px-1.5 py-1 rounded border outline-none text-center"
                            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                            title="Font size (pt)"
                          />
                          <input
                            type="color"
                            value={fillColor}
                            onChange={e => setFillColor(e.target.value)}
                            className="w-8 h-7 rounded cursor-pointer p-0.5 border"
                            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                            title="Text color"
                          />
                        </div>
                      )}
                      <p className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Form fields</p>
                      {fillAvailable.map(f => (
                        <div key={f.name}>
                          <label className="block text-xs mb-0.5 truncate" title={f.name} style={{ color: 'var(--color-text)' }}>
                            {f.name}
                            <span className="ml-1" style={{ color: 'var(--color-muted)' }}>({f.type})</span>
                            {f.required && <span className="ml-1 text-amber-600">*</span>}
                          </label>
                          {f.type === 'CheckBox' ? (
                            <select className={inp} style={inpStyle} value={fillValues[f.name] || ''} onChange={e => setFillValues(prev => ({ ...prev, [f.name]: e.target.value }))}>
                              <option value="">— unchanged —</option>
                              <option value="true">Checked</option>
                              <option value="false">Unchecked</option>
                            </select>
                          ) : (
                            <input type="text" className={inp} style={inpStyle} placeholder={f.value || `Enter ${f.name}…`} value={fillValues[f.name] || ''} onChange={e => setFillValues(prev => ({ ...prev, [f.name]: e.target.value }))} />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {fillAvailable.length === 0 && fillFile && !fillBusy && (
                    <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>No interactive fields found in this PDF.</p>
                  )}
                  <ErrMsg msg={fillError} />
                  <RunBtn onClick={runFill} busy={fillBusy} disabled={!fillFile || !fillAvailable.length} label="Fill & Download" getIcon={getIcon} />
                </div>
                <div>
                  <PdfPagePreview dataUrl={fillFile?.dataUrl} />
                </div>
              </div>
            </section>
          )}

          {/* ═══ Flatten ═════════════════════════════════════════════════ */}
          {mode === 'flatten' && (
            <section>
              <ToolHeader id="flatten" label="Flatten Form" onHelp={setHelpTool} getIcon={getIcon} />
              <div className="grid lg:grid-cols-2 gap-6">
                <div>
                  <PdfUpload onChange={onFlatFileChange} files={flatFile ? [flatFile] : []} onRemove={() => { setFlatFile(null); setFlatResult(null); }} />
                  <div className="mt-3 rounded-xl border px-4 py-3 text-xs" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-muted)' }}>
                    Flattening converts all interactive form fields into static text — the values are preserved but the fields can no longer be edited. This is useful before distributing a completed form.
                  </div>
                  <ErrMsg msg={flatError} />
                  <RunBtn onClick={runFlatten} busy={flatBusy} disabled={!flatFile} label="Flatten & Download" getIcon={getIcon} />
                </div>
                <div>
                  <PdfPagePreview dataUrl={flatFile?.dataUrl} />
                </div>
              </div>
            </section>
          )}

          {/* ═══ Metadata ════════════════════════════════════════════════ */}
          {mode === 'metadata' && (
            <section>
              <ToolHeader id="metadata" label="Metadata" onHelp={setHelpTool} getIcon={getIcon} />
              <div className="grid lg:grid-cols-2 gap-6">
                <div>
                  <PdfUpload onChange={onMetaFileChange} files={metaFile ? [metaFile] : []} onRemove={() => { setMetaFile(null); setMetaCurrent(null); setMetaResult(null); }} />
                  {metaBusy && <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>Reading metadata…</p>}
                  {metaCurrent && (
                    <div className="mt-3 space-y-2">
                      {[
                        { key: 'title',    label: 'Title',    editable: true },
                        { key: 'author',   label: 'Author',   editable: true },
                        { key: 'subject',  label: 'Subject',  editable: true },
                        { key: 'keywords', label: 'Keywords', editable: true },
                        { key: 'creator',  label: 'Creator',  editable: true },
                        { key: 'producer', label: 'Producer', editable: false },
                        { key: 'creationDate',     label: 'Created',  editable: false },
                        { key: 'modificationDate', label: 'Modified', editable: false },
                      ].map(({ key, label, editable }) => (
                        <div key={key}>
                          <label className={lbl} style={{ color: 'var(--color-muted)' }}>{label}</label>
                          <input
                            type="text"
                            className={inp}
                            style={{ ...inpStyle, opacity: editable ? 1 : 0.5 }}
                            readOnly={!editable}
                            value={editable ? (metaEdit[key] ?? '') : (metaCurrent[key] || '—')}
                            onChange={editable ? e => setMetaEdit(prev => ({ ...prev, [key]: e.target.value })) : undefined}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <ErrMsg msg={metaError} />
                  {metaCurrent && (
                    <RunBtn onClick={runMetaSave} busy={metaBusy} disabled={!metaFile} label="Save & Download" getIcon={getIcon} />
                  )}
                </div>
                <div>
                  <PdfPagePreview dataUrl={metaFile?.dataUrl} />
                </div>
              </div>
            </section>
          )}

          {/* ═══ File Info ═══════════════════════════════════════════════ */}
          {mode === 'fileinfo' && (
            <section>
              <ToolHeader id="fileinfo" label="File Info" onHelp={setHelpTool} getIcon={getIcon} badge="Client-side" />
              <div className="grid lg:grid-cols-2 gap-6">
                <div>
                  <PdfUpload onChange={onInfoFileChange} files={infoFile ? [{ name: infoFile.name, size: infoFile.size }] : []} onRemove={() => { setInfoFile(null); setInfoData(null); setInfoDataUrl(null); }} />
                  {infoBusy && <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>Analysing…</p>}
                  <div className="mt-4">
                    <PdfPagePreview dataUrl={infoDataUrl} />
                  </div>
                </div>
                <div>
                  {infoData && (
                    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                      <div className="px-3 py-2 border-b text-xs font-medium" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}>
                        File details
                      </div>
                      {[
                        { label: 'File name',     value: infoData.name },
                        { label: 'File size',     value: formatBytes(infoData.size) },
                        { label: 'MIME type',     value: infoData.type },
                        { label: 'Last modified', value: infoData.lastModified },
                        { label: 'Page count',    value: infoData.pageCount != null ? `${infoData.pageCount} page${infoData.pageCount !== 1 ? 's' : ''}` : 'Unknown' },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex items-start justify-between px-3 py-2.5 border-t text-sm" style={{ borderColor: 'var(--color-border)' }}>
                          <span style={{ color: 'var(--color-muted)' }}>{label}</span>
                          <span className="text-right ml-3 max-w-[200px] break-all" style={{ color: 'var(--color-text)' }}>{value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ═══ Text → PDF ═════════════════════════════════════════════ */}
          {mode === 'text2pdf' && (
            <section>
              <ToolHeader id="text2pdf" label="Text → PDF" onHelp={setHelpTool} getIcon={getIcon} />
              <div className="max-w-2xl">
                <label className={lbl} style={{ color: 'var(--color-muted)' }}>Title (optional)</label>
                <input
                  className={inp} style={inpStyle}
                  value={t2pTitle}
                  onChange={(e) => setT2pTitle(e.target.value)}
                  placeholder="Document title"
                />
                <label className={`${lbl} mt-4`} style={{ color: 'var(--color-muted)' }}>
                  Paste formatted content — # heading, **bold**, - bullet, blank line = new paragraph
                </label>
                <textarea
                  className={inp} style={{ ...inpStyle, minHeight: 320, resize: 'vertical', fontFamily: 'inherit' }}
                  value={t2pText}
                  onChange={(e) => setT2pText(e.target.value)}
                  placeholder={'# Heading\n\nPaste or type your content here. Use **bold** and\n- bullet points\nas needed.'}
                />
                <ErrMsg msg={t2pError} />
                <div className="mt-3">
                  <RunBtn onClick={runText2Pdf} busy={t2pBusy} disabled={!t2pText.trim()} label="Generate PDF" getIcon={getIcon} />
                </div>
              </div>
            </section>
          )}

          {/* ═══ Office → PDF ════════════════════════════════════════════ */}
          {mode === 'officetopdf' && (
            <section>
              <ToolHeader id="officetopdf" label="Office → PDF" onHelp={setHelpTool} getIcon={getIcon} />
              <div className="grid lg:grid-cols-2 gap-6">
                <div>
                  <PdfUpload
                    onChange={async (e) => {
                      const f = e.target.files?.[0]; e.target.value = '';
                      if (!f) return;
                      setOfficeError('');
                      const dataUrl = await readFileAsDataUrl(f);
                      setOfficeFile({ name: f.name, size: f.size, dataUrl });
                    }}
                    files={officeFile ? [{ name: officeFile.name, size: officeFile.size }] : []}
                    onRemove={() => setOfficeFile(null)}
                    accept=".docx,.doc,.odt,.rtf,.xlsx,.xls,.ods,.csv,.pptx,.ppt,.odp,.txt"
                    label="Upload an Office file"
                  />
                  <ErrMsg msg={officeError} />
                  <RunBtn onClick={runOfficeToPdf} busy={officeBusy} disabled={!officeFile} label="Convert to PDF" getIcon={getIcon} />
                </div>
                <div>
                  <div className="rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-muted)' }}>
                    <p className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>Supported formats</p>
                    <ul className="space-y-1 text-xs">
                      <li><strong>Word:</strong> .docx, .doc, .odt, .rtf</li>
                      <li><strong>Excel:</strong> .xlsx, .xls, .ods, .csv</li>
                      <li><strong>PowerPoint:</strong> .pptx, .ppt, .odp</li>
                      <li><strong>Text:</strong> .txt</li>
                    </ul>
                    <p className="mt-3 text-xs">Runs via LibreOffice on the server — formatting, tables, and images are preserved.</p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ═══ PDF → Office ════════════════════════════════════════════ */}
          {mode === 'pdftooffice' && (
            <section>
              <ToolHeader id="pdftooffice" label="PDF → Word" onHelp={setHelpTool} getIcon={getIcon} />
              <div className="grid lg:grid-cols-2 gap-6">
                <div>
                  <PdfUpload
                    onChange={async (e) => {
                      const f = e.target.files?.[0]; e.target.value = '';
                      if (!f) return;
                      setPtoError('');
                      const dataUrl = await readFileAsDataUrl(f);
                      setPtoFile({ name: f.name, size: f.size, dataUrl });
                    }}
                    files={pto_file ? [{ name: pto_file.name, size: pto_file.size }] : []}
                    onRemove={() => { setPtoFile(null); setPtoError(''); }}
                  />
                  <div className="mt-3">
                    <label className={lbl} style={{ color: 'var(--color-muted)' }}>Output format</label>
                    <select className={inp} style={inpStyle} value={pto_format} onChange={e => setPtoFormat(e.target.value)}>
                      <option value="docx">Word (.docx)</option>
                      <option value="odt">OpenDocument (.odt)</option>
                      <option value="txt">Plain text (.txt)</option>
                    </select>
                  </div>
                  <ErrMsg msg={pto_error} />
                  <RunBtn onClick={runPdfToOffice} busy={pto_busy} disabled={!pto_file} label="Convert" getIcon={getIcon} />
                </div>
                <div>
                  {pto_file && <PdfPagePreview dataUrl={pto_file.dataUrl} />}
                  {!pto_file && (
                    <div className="rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-muted)' }}>
                      <p className="font-medium mb-1" style={{ color: 'var(--color-text)' }}>Conversion quality</p>
                      <p className="text-xs">Best for text-heavy PDFs. Complex layouts (columns, images, advanced formatting) may not convert perfectly — this is a LibreOffice limitation, not a bug.</p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ═══ Google Drive → PDF ══════════════════════════════════════ */}
          {mode === 'googletopdf' && (
            <section>
              <ToolHeader id="googletopdf" label="Google Drive → PDF" onHelp={setHelpTool} getIcon={getIcon} />
              <div className="grid lg:grid-cols-2 gap-6">
                <div>
                  <label className={lbl} style={{ color: 'var(--color-muted)' }}>Google Drive / Docs / Sheets / Slides URL</label>
                  <input
                    className={inp}
                    style={inpStyle}
                    type="url"
                    placeholder="https://docs.google.com/document/d/…"
                    value={googleUrl}
                    onChange={e => { setGoogleUrl(e.target.value); setGoogleError(''); }}
                    onDrop={e => {
                      e.preventDefault();
                      const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
                      if (url) { setGoogleUrl(url.trim()); setGoogleError(''); }
                    }}
                    onDragOver={e => e.preventDefault()}
                  />
                  <p className="text-xs mt-1.5" style={{ color: 'var(--color-muted)' }}>
                    Paste or drag a Google Docs, Sheets, or Slides URL here. Requires Google account connected via Settings → Gmail / Drive.
                  </p>
                  {googleError && (
                    <div className="mt-2 rounded-lg p-3 text-xs" style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
                      <p>{googleError}</p>
                      {(googleError.includes('not found') || googleError.includes('Access denied') || googleError.includes('permission') || googleError.includes('not connected')) && (
                        <p className="mt-1 font-medium">Go to Settings → Gmail / Drive, disconnect, then reconnect your Google account to grant Drive read access.</p>
                      )}
                    </div>
                  )}
                  <RunBtn onClick={runGoogleToPdf} busy={googleBusy} disabled={!googleUrl.trim()} label="Export as PDF" getIcon={getIcon} />
                </div>
                <div className="rounded-xl border p-4 text-sm self-start" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-muted)' }}>
                  <p className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>How it works</p>
                  <ol className="space-y-1.5 text-xs list-decimal list-inside">
                    <li>Open the Google Doc/Sheet/Slide in your browser</li>
                    <li>Copy the URL from the address bar (or drag it here)</li>
                    <li>Click Export as PDF</li>
                    <li>The PDF opens in a preview — download from there</li>
                  </ol>
                  <p className="mt-3 text-xs font-medium" style={{ color: 'var(--color-text)' }}>Getting "File Not Found"?</p>
                  <p className="mt-1 text-xs">Your Google token was issued before Drive read permission existed. Disconnect and reconnect your Google account in Settings to fix this.</p>
                </div>
              </div>
            </section>
          )}

          {/* ═══ Field Designer ══════════════════════════════════════════ */}
          {mode === 'fielddesigner' && (
            <section>
              <ToolHeader id="fielddesigner" label="Add Form Fields" onHelp={setHelpTool} getIcon={getIcon}
                badge={fdFields.length ? `${fdFields.length} field${fdFields.length !== 1 ? 's' : ''}` : undefined} />

              {!fdFile && !fdLoading && (
                <PdfUpload onChange={onFdFileChange} files={[]} />
              )}
              {fdLoading && (
                <div className="flex items-center justify-center rounded-xl border-2 border-dashed" style={{ minHeight: 200, borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                  <span className="text-sm">Loading PDF…</span>
                </div>
              )}

              {fdFile && (
                <div className="flex flex-col lg:flex-row gap-6 items-start">

                  {/* ── Canvas side ─────────────────────────────────────── */}
                  <div className="flex-1 min-w-0">
                    {/* Page navigation */}
                    <div className="flex items-center gap-3 mb-3 flex-wrap">
                      <button
                        type="button"
                        onClick={() => changeFdPage(fdCurrentPage - 1)}
                        disabled={fdCurrentPage <= 1}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-30 hover:opacity-70 transition-opacity border"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                      >◀ Prev</button>
                      <span className="text-sm" style={{ color: 'var(--color-muted)' }}>
                        Page <strong style={{ color: 'var(--color-text)' }}>{fdCurrentPage}</strong> of {fdPageCount}
                      </span>
                      <button
                        type="button"
                        onClick={() => changeFdPage(fdCurrentPage + 1)}
                        disabled={fdCurrentPage >= fdPageCount}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-30 hover:opacity-70 transition-opacity border"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                      >Next ▶</button>
                      <button
                        type="button"
                        onClick={() => { setFdFile(null); fdPdfDocRef.current = null; setFdFields([]); fdFieldsRef.current = []; setFdResult(null); }}
                        className="ml-auto text-xs hover:opacity-60 transition-opacity"
                        style={{ color: 'var(--color-muted)' }}
                      >Change file</button>
                    </div>

                    {/* Interaction hint */}
                    <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
                      <strong style={{ color: 'var(--color-text)' }}>Draw</strong> a new field · <strong style={{ color: 'var(--color-text)' }}>Click</strong> to select · <strong style={{ color: 'var(--color-text)' }}>Drag</strong> to move · <kbd className="px-1 py-0.5 rounded text-[10px]" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>Del</kbd> to delete
                    </p>

                    {/* Field type picker */}
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Draw as:</span>
                      {['text', 'checkbox', 'dropdown'].map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setFdFieldType(t)}
                          className="px-3 py-1 rounded-lg text-xs font-medium transition-colors capitalize"
                          style={{
                            background: fdFieldType === t ? 'var(--color-primary)' : 'var(--color-surface)',
                            color: fdFieldType === t ? '#fff' : 'var(--color-text)',
                            border: '1px solid',
                            borderColor: fdFieldType === t ? 'var(--color-primary)' : 'var(--color-border)',
                          }}
                        >
                          {t}
                        </button>
                      ))}
                    </div>

                    {/* Stacked canvases */}
                    <div
                      className="rounded-xl border overflow-auto"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', maxHeight: '70vh' }}
                    >
                      <div style={{ position: 'relative', display: 'inline-block' }}>
                        <canvas ref={fdPdfCanvasRef} style={{ display: 'block' }} />
                        <canvas
                          ref={fdUiCanvasRef}
                          style={{ position: 'absolute', top: 0, left: 0, cursor: 'crosshair' }}
                          onMouseDown={onFdDown}
                          onMouseMove={onFdMove}
                          onMouseUp={onFdUp}
                          onMouseLeave={onFdLeave}
                        />
                      </div>
                    </div>
                    <div className="mt-2 px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
                      <strong style={{ color: 'var(--color-text)' }}>How to add a field:</strong> Select a field type above (text / checkbox / dropdown), then <strong>click and drag</strong> on the PDF page to draw the field area. Name and configure it in the panel on the right, then click <strong>Embed Fields</strong> when done.
                    </div>
                  </div>

                  {/* ── Field list side ──────────────────────────────────── */}
                  <div className="w-full lg:w-72 flex-shrink-0">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                        Fields — page {fdCurrentPage}
                        <span className="ml-1.5 text-xs" style={{ color: 'var(--color-muted)' }}>
                          ({fdFields.filter(f => f.page === fdCurrentPage).length})
                        </span>
                      </p>
                      {fdFields.length > 0 && (
                        <button
                          type="button"
                          onClick={() => { setFdFields([]); fdFieldsRef.current = []; }}
                          className="text-xs hover:opacity-60 transition-opacity"
                          style={{ color: '#ef4444' }}
                        >
                          Clear all
                        </button>
                      )}
                    </div>

                    {/* Fields on current page */}
                    <div className="space-y-2 mb-3" style={{ maxHeight: 420, overflowY: 'auto' }}>
                      {fdFields.filter(f => f.page === fdCurrentPage).map(f => (
                        <div
                          key={f.id}
                          className="rounded-xl border p-3 cursor-pointer"
                          style={{
                            borderColor: fdSelectedId === f.id ? 'rgb(234,88,12)' : 'var(--color-border)',
                            background: fdSelectedId === f.id ? 'rgba(234,88,12,0.06)' : 'var(--color-surface)',
                            outline: fdSelectedId === f.id ? '2px solid rgba(234,88,12,0.3)' : 'none',
                          }}
                          onClick={() => { setFdSelectedId(f.id); fdSelectedIdRef.current = f.id; redrawFdOverlay(); }}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize"
                              style={{ background: 'var(--color-primary)', color: '#fff' }}>
                              {f.type}
                            </span>
                            <span className="text-[10px] flex-1 truncate" style={{ color: 'var(--color-muted)' }}>
                              {Math.round(f.width)}×{Math.round(f.height)} pt
                            </span>
                            <button
                              type="button"
                              onClick={() => removeFdField(f.id)}
                              className="hover:opacity-60 transition-opacity text-sm leading-none"
                              style={{ color: 'var(--color-muted)' }}
                            >×</button>
                          </div>
                          <input
                            type="text"
                            value={f.name}
                            onChange={e => updateFdField(f.id, { name: e.target.value })}
                            className="w-full text-xs px-2 py-1.5 rounded-lg border outline-none mb-1.5"
                            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                            placeholder="Field name"
                          />

                          {/* Static text stamp: type it here, baked into the page in the
                              chosen font — sidesteps PDF viewers substituting a default font
                              for custom fonts on interactive form fields. Leave blank to
                              create an ordinary fillable AcroForm text field instead. */}
                          {f.type === 'text' && (
                            <input
                              type="text"
                              value={f.value || ''}
                              onChange={e => updateFdField(f.id, { value: e.target.value })}
                              className="w-full text-xs px-2 py-1.5 rounded-lg border outline-none mb-1.5"
                              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                              placeholder="Text to stamp here (leave blank for a fillable field)"
                            />
                          )}

                          {/* Typography: font / size / color */}
                          {f.type !== 'checkbox' && (
                            <div className="flex items-center gap-1 mb-1.5">
                              <select
                                value={f.fontFamily || 'Helvetica'}
                                onChange={e => updateFdField(f.id, { fontFamily: e.target.value })}
                                className="flex-1 text-xs px-1.5 py-1 rounded border outline-none"
                                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                                title={f.type === 'text'
                                  ? 'Font — Script only applies if you type text below to stamp; an empty field falls back to Helvetica'
                                  : 'Font (PDF standard font — dropdown fields stay editable, so only standard fonts render reliably)'}
                              >
                                {/* Script fonts only ever render correctly via the static-text stamp
                                    (a "text" field with a value typed above) — a dropdown is always a
                                    live AcroForm field, where a script font would silently fall back
                                    to Helvetica server-side, so it's not offered here. */}
                                {Object.entries(f.type === 'text' ? STAMP_FONT_GROUPS : STANDARD_FONT_GROUPS).map(([group, fonts]) => (
                                  <optgroup key={group} label={group}>
                                    {fonts.map(font => {
                                      const css = fontCss(font);
                                      return (
                                        <option key={font} value={font} style={{ fontFamily: css.fontFamily, fontStyle: css.fontStyle, fontWeight: css.fontWeight }}>
                                          {STANDARD_FONT_LABELS[font] || font}
                                        </option>
                                      );
                                    })}
                                  </optgroup>
                                ))}
                              </select>
                              <input
                                type="number"
                                value={f.fontSize ?? 11}
                                min={6} max={72}
                                onChange={e => updateFdField(f.id, { fontSize: Number(e.target.value) })}
                                className="w-14 text-xs px-1.5 py-1 rounded border outline-none text-center"
                                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                                title="Font size (pt)"
                              />
                              <input
                                type="color"
                                value={f.color || '#000000'}
                                onChange={e => updateFdField(f.id, { color: e.target.value })}
                                className="w-8 h-7 rounded cursor-pointer p-0.5 border"
                                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                                title="Text color"
                              />
                            </div>
                          )}

                          {/* Border controls */}
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <label className="flex items-center gap-1 text-xs cursor-pointer flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                              <input
                                type="checkbox"
                                checked={f.borderEnabled !== false}
                                onChange={e => updateFdField(f.id, { borderEnabled: e.target.checked })}
                                className="w-3 h-3"
                              />
                              Border
                            </label>
                            {f.borderEnabled !== false && (
                              <>
                                <input
                                  type="color"
                                  value={f.borderColor || '#4d4dcf'}
                                  onChange={e => updateFdField(f.id, { borderColor: e.target.value })}
                                  className="w-8 h-6 rounded cursor-pointer p-0.5 border"
                                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                                  title="Border color"
                                />
                                <input
                                  type="number"
                                  value={f.borderWidth ?? 1}
                                  min={0.5} max={10} step={0.5}
                                  onChange={e => updateFdField(f.id, { borderWidth: Number(e.target.value) })}
                                  className="w-14 text-xs px-1.5 py-0.5 rounded border outline-none text-center"
                                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                                  title="Border width (pt)"
                                />
                                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>pt</span>
                              </>
                            )}
                          </div>

                          {f.type === 'dropdown' && (
                            <textarea
                              value={f.options.join('\n')}
                              onChange={e => updateFdField(f.id, { options: e.target.value.split('\n').filter(Boolean) })}
                              placeholder="One option per line"
                              rows={3}
                              className="w-full text-xs px-2 py-1.5 rounded-lg border outline-none resize-none mb-1.5"
                              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                            />
                          )}
                          <div className="flex gap-3 mt-1">
                            <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
                              <input type="checkbox" checked={f.required} onChange={e => updateFdField(f.id, { required: e.target.checked })} className="w-3 h-3" />
                              Required
                            </label>
                            {f.type === 'text' && (
                              <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
                                <input type="checkbox" checked={f.multiline} onChange={e => updateFdField(f.id, { multiline: e.target.checked })} className="w-3 h-3" />
                                Multiline
                              </label>
                            )}
                          </div>
                        </div>
                      ))}
                      {fdFields.filter(f => f.page === fdCurrentPage).length === 0 && (
                        <div className="rounded-xl border px-4 py-6 text-center text-xs" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', borderStyle: 'dashed' }}>
                          Drag on the PDF to add fields to this page.
                        </div>
                      )}
                    </div>

                    {/* Cross-page summary */}
                    {fdFields.filter(f => f.page !== fdCurrentPage).length > 0 && (
                      <p className="text-xs mb-3 px-1" style={{ color: 'var(--color-muted)' }}>
                        + {fdFields.filter(f => f.page !== fdCurrentPage).length} field{fdFields.filter(f => f.page !== fdCurrentPage).length !== 1 ? 's' : ''} on other pages
                      </p>
                    )}

                    <ErrMsg msg={fdError} />
                    <RunBtn onClick={runAddFields} busy={fdBusy} disabled={!fdFields.length} label={`Embed ${fdFields.length} Field${fdFields.length !== 1 ? 's' : ''} & Download`} getIcon={getIcon} />
                    {fdResult && (
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setResultModal({ dataUrl: fdResult.dataUrl, filename: fdFile ? `${fdFile.name.replace('.pdf','')}-fields.pdf` : 'with-fields.pdf', meta: `${fdResult.added} AcroForm field${fdResult.added !== 1 ? 's' : ''} embedded` })}
                            className="flex-1 py-2 rounded-lg text-sm font-medium hover:opacity-80 transition-opacity"
                            style={{ background: 'var(--color-primary)', color: '#fff' }}
                          >
                            View Result
                          </button>
                          <button
                            onClick={() => downloadFile(fdResult.dataUrl, fdFile ? `${fdFile.name.replace('.pdf','')}-fields.pdf` : 'with-fields.pdf')}
                            className="py-2 px-3 rounded-lg text-sm hover:opacity-70 transition-opacity border"
                            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                          >
                            {getIcon('download', { size: 14 })}
                          </button>
                        </div>
                        <div className="rounded-lg px-3 py-2.5 text-xs space-y-1" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                          <p className="font-semibold" style={{ color: 'var(--color-text)' }}>What to do next</p>
                          <p>• Open the downloaded PDF in any viewer (Preview, Acrobat, Chrome) to fill in fields manually and save.</p>
                          <p>• Or bring it back to the <strong style={{ color: 'var(--color-text)' }}>Fill Form</strong> tool here to fill fields and download the result in one step.</p>
                          <p>• Use <strong style={{ color: 'var(--color-text)' }}>Flatten</strong> afterwards to lock the values permanently.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ═══ Organize Pages ═════════════════════════════════════════ */}
          {mode === 'organize' && (
            <section>
              <ToolHeader id="organize" label="Organize Pages" onHelp={setHelpTool} getIcon={getIcon}
                badge={orgPages.length ? `${orgPages.length} page${orgPages.length !== 1 ? 's' : ''}` : undefined} />

              {!orgPrimary ? (
                <Tooltip text="Upload the PDF you want to reorder, delete pages from, or insert pages into.">
                  <div><PdfUpload label="PDF to organize" onChange={onOrgFileChange} /></div>
                </Tooltip>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs truncate mr-2" style={{ color: 'var(--color-muted)' }}>{orgPrimary.name} · {orgPages.length} pages</p>
                    <Tooltip text="Start over with a different PDF.">
                      <button type="button" onClick={orgResetAll} className="text-xs underline hover:opacity-70 transition-opacity flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                        Change file
                      </button>
                    </Tooltip>
                  </div>

                  {orgLoading && <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>Rendering page thumbnails…</p>}

                  <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
                    {orgPages.map((p, i) => (
                      <div
                        key={p.id}
                        draggable
                        onDragStart={() => onOrgDragStart(p.id)}
                        onDragOver={onOrgDragOverPage}
                        onDrop={() => onOrgDropOnPage(p.id)}
                        className="rounded-lg border overflow-hidden relative"
                        style={{ borderColor: 'var(--color-border)', background: '#fff', cursor: 'grab' }}
                      >
                        <img src={p.thumb} alt={`Page ${i + 1}`} className="w-full block" draggable={false} />
                        <div className="absolute top-1 left-1 text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
                          {i + 1}{p.source === 'inserted' ? ' · inserted' : ''}
                        </div>
                        <div className="absolute bottom-1 right-1 flex gap-1">
                          <Tooltip text="Download just this page as its own PDF.">
                            <button
                              type="button"
                              onClick={() => runOrgExtract(p)}
                              disabled={orgExtracting === p.id}
                              className="p-1 rounded hover:opacity-70 transition-opacity disabled:opacity-40"
                              style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}
                            >
                              {getIcon('download', { size: 12 })}
                            </button>
                          </Tooltip>
                          {orgConfirmDelete === p.id ? (
                            <span className="flex items-center gap-1 text-[10px] px-1.5 py-1 rounded" style={{ background: 'var(--color-surface)' }}>
                              <button type="button" onClick={() => orgRemovePage(p.id)} className="font-semibold hover:opacity-70 transition-opacity" style={{ color: '#ef4444' }}>Yes</button>
                              <button type="button" onClick={() => setOrgConfirmDelete(null)} className="hover:opacity-70 transition-opacity" style={{ color: 'var(--color-muted)' }}>No</button>
                            </span>
                          ) : (
                            <Tooltip text="Remove this page from the final document.">
                              <button
                                type="button"
                                onClick={() => setOrgConfirmDelete(p.id)}
                                className="p-1 rounded hover:opacity-70 transition-opacity"
                                style={{ background: 'var(--color-surface)', color: '#ef4444' }}
                              >
                                {getIcon('x', { size: 12 })}
                              </button>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    ))}
                    <div
                      onDragOver={onOrgDragOverPage}
                      onDrop={onOrgDropAtEnd}
                      className="rounded-lg border-2 border-dashed flex items-center justify-center text-center text-xs px-2"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', minHeight: 90 }}
                    >
                      Drop here to move to end
                    </div>
                  </div>

                  <div className="mb-4">
                    <Tooltip text="Upload a second PDF, then drag its pages into the list above to splice them in at any position.">
                      <div><PdfUpload label="Insert pages from another PDF" onChange={onOrgInsertFileChange} /></div>
                    </Tooltip>
                    {orgInsertFile && orgInsertThumbs.length > 0 && (
                      <div className="mt-2 p-2 rounded-lg border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                        <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>Drag a page from "{orgInsertFile.name}" into the list above to insert it there.</p>
                        <div className="flex flex-wrap gap-2">
                          {orgInsertThumbs.map((t, i) => (
                            <Tooltip key={t.id} text="Drag this page into the list above.">
                              <img
                                src={t.thumb}
                                alt={`Insert page ${i + 1}`}
                                draggable
                                onDragStart={() => onOrgDragStart(t.id)}
                                className="rounded border"
                                style={{ width: 70, borderColor: 'var(--color-border)', cursor: 'grab' }}
                              />
                            </Tooltip>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <ErrMsg msg={orgError} />
                  <RunBtn onClick={runOrganize} busy={orgBusy} disabled={!orgPages.length} label="Apply & Download" getIcon={getIcon} />
                </div>
              )}
            </section>
          )}

          {/* ═══ Fill & Sign ═════════════════════════════════════════════ */}
          {mode === 'sign' && (
            <section>
              <ToolHeader id="sign" label="Fill & Sign" onHelp={setHelpTool} getIcon={getIcon}
                badge={signPlaced.length ? `${signPlaced.length} placed` : undefined} />

              {!signFile ? (
                <Tooltip text="Upload any PDF — with or without form fields — to stamp a signature onto it.">
                  <div><PdfUpload label="PDF to sign" onChange={onSignFileChange} /></div>
                </Tooltip>
              ) : signLoading ? (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading PDF…</p>
              ) : (
                <div className="grid lg:grid-cols-[1fr_320px] gap-6">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs truncate mr-2" style={{ color: 'var(--color-muted)' }}>{signFile.name}</p>
                      {signPageCount > 1 && (
                        <div className="flex items-center gap-2 text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                          <button type="button" onClick={() => changeSignPage(signCurrentPage - 1)} disabled={signCurrentPage <= 1} className="px-1.5 disabled:opacity-30 hover:opacity-60 transition-opacity">◀</button>
                          Page {signCurrentPage} of {signPageCount}
                          <button type="button" onClick={() => changeSignPage(signCurrentPage + 1)} disabled={signCurrentPage >= signPageCount} className="px-1.5 disabled:opacity-30 hover:opacity-60 transition-opacity">▶</button>
                        </div>
                      )}
                    </div>
                    <Tooltip text="Drag a rectangle to place your current signature/date/initials here. Click a placed one to select it, drag to move, Delete key to remove.">
                      <div className="relative inline-block rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                        <canvas ref={signPdfCanvasRef} className="block" />
                        <canvas
                          ref={signUiCanvasRef}
                          className="absolute top-0 left-0"
                          style={{ cursor: 'crosshair' }}
                          onMouseDown={onSignDown}
                          onMouseMove={onSignMove}
                          onMouseUp={onSignUp}
                          onMouseLeave={onSignLeave}
                        />
                      </div>
                    </Tooltip>
                    {signSelectedId && (
                      <div className="mt-2">
                        <Tooltip text="Remove the selected signature placement.">
                          <button type="button" onClick={() => removeSignPlacement(signSelectedId)} className="text-xs underline hover:opacity-70 transition-opacity" style={{ color: '#ef4444' }}>
                            Remove selected placement
                          </button>
                        </Tooltip>
                      </div>
                    )}
                    <ErrMsg msg={signError} />
                    <RunBtn onClick={runSign} busy={signBusy} disabled={!signPlaced.length} label={`Apply ${signPlaced.length || ''} Signature${signPlaced.length !== 1 ? 's' : ''} & Download`} getIcon={getIcon} />
                  </div>

                  <div className="rounded-xl border p-4" style={cardStyle}>
                    <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Create a signature</p>
                    <div className="flex gap-1 mb-3 p-1 rounded-lg" style={{ background: 'var(--color-bg)' }}>
                      {['draw', 'type', 'image'].map(m => (
                        <Tooltip key={m} text={m === 'draw' ? 'Draw with your mouse or finger.' : m === 'type' ? 'Type your name in a cursive font.' : 'Upload a photo of a signature.'}>
                          <button
                            type="button"
                            onClick={() => setSignMode(m)}
                            className="flex-1 py-1.5 rounded-md text-xs font-medium capitalize transition-opacity hover:opacity-80"
                            style={{ background: signMode === m ? 'var(--color-primary)' : 'transparent', color: signMode === m ? '#fff' : 'var(--color-text)' }}
                          >
                            {m}
                          </button>
                        </Tooltip>
                      ))}
                    </div>

                    {signMode === 'draw' && (
                      <div>
                        <Tooltip text="Draw your signature here, then drag a box on the PDF to place it.">
                          <canvas
                            ref={signPadCanvasRef}
                            width={280}
                            height={110}
                            className="w-full rounded-lg border touch-none"
                            style={{ borderColor: 'var(--color-border)', background: '#fff' }}
                            onMouseDown={onPadStart}
                            onMouseMove={onPadMove}
                            onMouseUp={onPadEnd}
                            onMouseLeave={onPadEnd}
                            onTouchStart={onPadStart}
                            onTouchMove={onPadMove}
                            onTouchEnd={onPadEnd}
                          />
                        </Tooltip>
                        <Tooltip text="Erase the drawing pad.">
                          <button type="button" onClick={clearPad} className="mt-2 text-xs underline hover:opacity-70 transition-opacity" style={{ color: 'var(--color-muted)' }}>Clear</button>
                        </Tooltip>
                      </div>
                    )}

                    {signMode === 'type' && (
                      <div className="space-y-2">
                        <Tooltip text="Type the name or text to render as your signature.">
                          <input
                            type="text"
                            className={inp}
                            style={inpStyle}
                            placeholder="Your name"
                            value={signTypeText}
                            onChange={e => setSignTypeText(e.target.value)}
                          />
                        </Tooltip>
                        <Tooltip text="Font used to render your typed signature.">
                          <select className={inp} style={inpStyle} value={signFont} onChange={e => setSignFont(e.target.value)}>
                            {Object.entries(STAMP_FONT_GROUPS).map(([group, fonts]) => (
                              <optgroup key={group} label={group}>
                                {fonts.map(f => <option key={f} value={f}>{STANDARD_FONT_LABELS[f] || f}</option>)}
                              </optgroup>
                            ))}
                          </select>
                        </Tooltip>
                        <div className="flex gap-2">
                          <Tooltip text="Insert today's date as a lighter-weight stamp.">
                            <button type="button" onClick={() => { setSignTypeText(new Date().toLocaleDateString()); setSignFont('Helvetica'); }} className="flex-1 py-1.5 rounded-lg text-xs border hover:opacity-70 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                              Today's date
                            </button>
                          </Tooltip>
                          <Tooltip text="Switch to initials — type them above, then place like a signature.">
                            <button type="button" onClick={() => { setSignTypeText(''); setSignFont('Helvetica'); }} className="flex-1 py-1.5 rounded-lg text-xs border hover:opacity-70 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                              Initials
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                    )}

                    {signMode === 'image' && (
                      <div>
                        <Tooltip text="Upload a photo or scan of a signature.">
                          <div><PdfUpload label="" accept="image/*" onChange={onSignImageUpload} /></div>
                        </Tooltip>
                        {signImageDataUrl && (
                          <img src={signImageDataUrl} alt="Signature upload" className="mt-2 rounded border" style={{ maxHeight: 80, borderColor: 'var(--color-border)' }} />
                        )}
                      </div>
                    )}

                    <div className="mt-4 pt-3 border-t text-xs" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                      Drag a rectangle on the PDF to place the current signature. Repeat for additional signatures, dates, or initials.
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ═══ Annotate / Markup ═══════════════════════════════════════ */}
          {mode === 'annotate' && (
            <section>
              <ToolHeader id="annotate" label="Annotate / Markup" onHelp={setHelpTool} getIcon={getIcon}
                badge={annShapes.length ? `${annShapes.length} mark${annShapes.length !== 1 ? 's' : ''}` : undefined} />

              {!annFile ? (
                <Tooltip text="Upload the PDF you want to mark up.">
                  <div><PdfUpload label="PDF to annotate" onChange={onAnnFileChange} /></div>
                </Tooltip>
              ) : annLoading ? (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading PDF…</p>
              ) : (
                <div className="grid lg:grid-cols-[1fr_260px] gap-6">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs truncate mr-2" style={{ color: 'var(--color-muted)' }}>{annFile.name}</p>
                      {annPageCount > 1 && (
                        <Tooltip text="Move between pages — your marks on each page are kept as you navigate.">
                          <div className="flex items-center gap-2 text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                            <button type="button" onClick={() => changeAnnPage(annCurrentPage - 1)} disabled={annCurrentPage <= 1} className="px-1.5 disabled:opacity-30 hover:opacity-60 transition-opacity">◀</button>
                            Page {annCurrentPage} of {annPageCount}
                            <button type="button" onClick={() => changeAnnPage(annCurrentPage + 1)} disabled={annCurrentPage >= annPageCount} className="px-1.5 disabled:opacity-30 hover:opacity-60 transition-opacity">▶</button>
                          </div>
                        </Tooltip>
                      )}
                    </div>
                    <Tooltip text="Drag to draw a highlight/strikeout/text box, drag freely to draw with the pen, click once to drop a sticky note, or switch to Select to move/delete a mark.">
                      <div className="relative inline-block rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                        <canvas ref={annPdfCanvasRef} className="block" />
                        <canvas
                          ref={annUiCanvasRef}
                          className="absolute top-0 left-0"
                          style={{ cursor: annTool === 'select' ? 'default' : 'crosshair' }}
                          onMouseDown={onAnnDown}
                          onMouseMove={onAnnMove}
                          onMouseUp={onAnnUp}
                          onMouseLeave={onAnnLeave}
                        />
                        {annNoteEditor && (
                          <div
                            className="absolute z-10 rounded-lg border shadow-lg p-2"
                            style={{ left: Math.max(0, (annNoteEditor.x) * (annPageDims?.renderScale || 1)), top: Math.max(0, annPageDims ? annPageDims.canvasH - annNoteEditor.y * annPageDims.renderScale : 0), background: 'var(--color-surface)', borderColor: 'var(--color-border)', width: 200 }}
                          >
                            <textarea
                              autoFocus
                              rows={3}
                              className="w-full text-xs rounded border p-1.5 outline-none"
                              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                              placeholder="Comment text…"
                              value={annNoteEditor.text}
                              onChange={e => setAnnNoteEditor(prev => ({ ...prev, text: e.target.value }))}
                            />
                            <div className="flex gap-1.5 mt-1.5">
                              <button type="button" onClick={saveAnnNote} className="flex-1 text-xs py-1 rounded" style={{ background: 'var(--color-primary)', color: '#fff' }}>Save</button>
                              <button type="button" onClick={() => setAnnNoteEditor(null)} className="flex-1 text-xs py-1 rounded border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </Tooltip>

                    {annSelectedId && (() => {
                      const sel = annShapes.find(s => s.id === annSelectedId);
                      if (!sel) return null;
                      return (
                        <div className="mt-2 flex items-center gap-3 flex-wrap">
                          {(sel.type === 'note' || sel.type === 'textbox') && (
                            <Tooltip text="Edit this mark's text.">
                              <input
                                type="text"
                                className={inp}
                                style={{ ...inpStyle, width: 220 }}
                                value={sel.text || ''}
                                onChange={e => updateAnnShapeText(sel.id, e.target.value)}
                              />
                            </Tooltip>
                          )}
                          <Tooltip text="Delete this mark (or press Delete/Backspace).">
                            <button type="button" onClick={() => removeAnnShape(sel.id)} className="text-xs underline hover:opacity-70 transition-opacity" style={{ color: '#ef4444' }}>
                              Remove selected mark
                            </button>
                          </Tooltip>
                        </div>
                      );
                    })()}

                    <ErrMsg msg={annError} />
                    <RunBtn onClick={runAnnotateApply} busy={annBusy} disabled={!annShapes.length} label={`Apply ${annShapes.length || ''} Mark${annShapes.length !== 1 ? 's' : ''} & Download`} getIcon={getIcon} />
                  </div>

                  <div className="rounded-xl border p-4 space-y-3" style={cardStyle}>
                    <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Tool</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { id: 'select', label: 'Select', icon: 'mouse-pointer' },
                        { id: 'highlight', label: 'Highlight', icon: 'highlighter' },
                        { id: 'strikeout', label: 'Strikeout', icon: 'strikethrough' },
                        { id: 'draw', label: 'Draw', icon: 'pencil-line' },
                        { id: 'note', label: 'Note', icon: 'sticky-note' },
                        { id: 'textbox', label: 'Text box', icon: 'type' },
                      ].map(t => (
                        <Tooltip key={t.id} text={
                          t.id === 'select' ? 'Select, move, or delete an existing mark.'
                          : t.id === 'highlight' ? 'Drag a semi-transparent highlight box.'
                          : t.id === 'strikeout' ? 'Drag a line through text or an area.'
                          : t.id === 'draw' ? 'Freehand pen — drag to draw.'
                          : t.id === 'note' ? 'Click once to drop a sticky note and type a comment.'
                          : 'Drag a box and type a comment directly on the page.'
                        }>
                          <button
                            type="button"
                            onClick={() => { setAnnTool(t.id); setAnnSelectedId(null); }}
                            className="flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] font-medium transition-opacity hover:opacity-80"
                            style={{ background: annTool === t.id ? 'var(--color-primary)' : 'var(--color-bg)', color: annTool === t.id ? '#fff' : 'var(--color-text)', border: '1px solid var(--color-border)' }}
                          >
                            {getIcon(t.icon, { size: 15 })}
                            {t.label}
                          </button>
                        </Tooltip>
                      ))}
                    </div>

                    <Tooltip text="Colour used for the next mark you draw.">
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Colour</span>
                        <input type="color" value={annColor} onChange={e => setAnnColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
                      </div>
                    </Tooltip>

                    {(annTool === 'draw' || annTool === 'strikeout') && (
                      <Tooltip text="Line thickness.">
                        <div>
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Stroke width: {annStrokeWidth}px</span>
                          <input type="range" min={1} max={12} value={annStrokeWidth} onChange={e => setAnnStrokeWidth(Number(e.target.value))} className="w-full" />
                        </div>
                      </Tooltip>
                    )}
                    {annTool === 'highlight' && (
                      <Tooltip text="How see-through the highlight is.">
                        <div>
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Opacity: {Math.round(annOpacity * 100)}%</span>
                          <input type="range" min={10} max={90} value={Math.round(annOpacity * 100)} onChange={e => setAnnOpacity(Number(e.target.value) / 100)} className="w-full" />
                        </div>
                      </Tooltip>
                    )}
                    {annTool === 'textbox' && (
                      <Tooltip text="Font size for new text boxes.">
                        <div>
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Font size: {annFontSize}pt</span>
                          <input type="range" min={8} max={28} value={annFontSize} onChange={e => setAnnFontSize(Number(e.target.value))} className="w-full" />
                        </div>
                      </Tooltip>
                    )}

                    <div className="flex gap-2 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
                      <Tooltip text="Undo the last change."><button type="button" onClick={undoAnn} disabled={!annPast.length} className="flex-1 text-xs px-3 py-2 rounded-xl border hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Undo</button></Tooltip>
                      <Tooltip text="Redo the last undone change."><button type="button" onClick={redoAnn} disabled={!annFuture.length} className="flex-1 text-xs px-3 py-2 rounded-xl border hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Redo</button></Tooltip>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ═══ Compare ═════════════════════════════════════════════════ */}
          {mode === 'compare' && (
            <section>
              <ToolHeader id="compare" label="Compare PDFs" onHelp={setHelpTool} getIcon={getIcon} />

              <div className="grid sm:grid-cols-2 gap-4 mb-4">
                <Tooltip text="The original / older version.">
                  <div><PdfUpload label="PDF A" onChange={onCmprFileChange('a')} files={cmprAFile ? [cmprAFile] : []} onRemove={() => setCmprAFile(null)} /></div>
                </Tooltip>
                <Tooltip text="The revised / newer version to compare against A.">
                  <div><PdfUpload label="PDF B" onChange={onCmprFileChange('b')} files={cmprBFile ? [cmprBFile] : []} onRemove={() => setCmprBFile(null)} /></div>
                </Tooltip>
              </div>

              {cmprAFile && cmprBFile && (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--color-surface)' }}>
                      {['visual', 'text'].map(t => (
                        <Tooltip key={t} text={t === 'visual' ? 'Render both PDFs and highlight changed pixels in red.' : 'Extract text from both PDFs and show added/removed lines.'}>
                          <button
                            type="button"
                            onClick={() => setCmprTab(t)}
                            className="px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-opacity hover:opacity-80"
                            style={{ background: cmprTab === t ? 'var(--color-primary)' : 'transparent', color: cmprTab === t ? '#fff' : 'var(--color-text)' }}
                          >
                            {t} diff
                          </button>
                        </Tooltip>
                      ))}
                    </div>
                    {cmprTab === 'visual' && cmprPageCount > 1 && (
                      <Tooltip text="Move between pages — the higher of the two page counts is shown.">
                        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                          <button type="button" onClick={() => setCmprPage(p => Math.max(1, p - 1))} disabled={cmprPage <= 1} className="px-1.5 disabled:opacity-30 hover:opacity-60 transition-opacity">◀</button>
                          Page {cmprPage} of {cmprPageCount}
                          <button type="button" onClick={() => setCmprPage(p => Math.min(cmprPageCount, p + 1))} disabled={cmprPage >= cmprPageCount} className="px-1.5 disabled:opacity-30 hover:opacity-60 transition-opacity">▶</button>
                        </div>
                      </Tooltip>
                    )}
                  </div>

                  {cmprTab === 'visual' ? (
                    <div>
                      <Tooltip text="How different two pixels must be before they're flagged as changed. Higher = more sensitive (flags smaller differences).">
                        <div className="mb-3 max-w-xs">
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Sensitivity: {cmprSensitivity}%</span>
                          <input type="range" min={5} max={95} value={cmprSensitivity} onChange={e => setCmprSensitivity(Number(e.target.value))} className="w-full" />
                        </div>
                      </Tooltip>
                      <ErrMsg msg={cmprError} />
                      {cmprLoading && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Rendering diff…</p>}
                      {cmprDiffPct !== null && <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>Changed pixels on this page: <strong style={{ color: 'var(--color-primary)' }}>{cmprDiffPct}%</strong></p>}
                      <div className="grid sm:grid-cols-3 gap-3">
                        <div>
                          <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>A</p>
                          <canvas ref={cmprCanvasARef} className="rounded-lg border w-full" style={{ borderColor: 'var(--color-border)' }} />
                        </div>
                        <div>
                          <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>B</p>
                          <canvas ref={cmprCanvasBRef} className="rounded-lg border w-full" style={{ borderColor: 'var(--color-border)' }} />
                        </div>
                        <div>
                          <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Differences</p>
                          <canvas ref={cmprCanvasDiffRef} className="rounded-lg border w-full" style={{ borderColor: 'var(--color-border)' }} />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      {!cmprTextA.length && !cmprTextB.length ? (
                        <RunBtn onClick={runCompareText} busy={cmprTextBusy} disabled={false} label="Extract & Compare Text" getIcon={getIcon} />
                      ) : (
                        <Tooltip text="Re-run text extraction if you swapped files.">
                          <button type="button" onClick={runCompareText} disabled={cmprTextBusy} className="text-xs underline hover:opacity-70 transition-opacity mb-3" style={{ color: 'var(--color-muted)' }}>
                            {cmprTextBusy ? 'Extracting…' : 'Re-extract text'}
                          </button>
                        </Tooltip>
                      )}
                      <ErrMsg msg={cmprTextError} />
                      {cmprTextA.length > 0 && (
                        <div className="mt-3 max-h-[520px] overflow-y-auto rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
                          {Array.from({ length: Math.max(cmprTextA.length, cmprTextB.length) }).map((_, i) => {
                            const diff = diffLines(cmprTextA[i] || '', cmprTextB[i] || '');
                            return (
                              <div key={i} className="border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
                                <p className="text-xs font-semibold px-3 py-1.5" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}>Page {i + 1}</p>
                                <div className="px-3 py-2 text-xs font-mono space-y-0.5">
                                  {diff.filter(d => d.type !== 'same').length === 0 ? (
                                    <p style={{ color: 'var(--color-muted)' }}>No differences</p>
                                  ) : diff.map((d, j) => d.type === 'same' ? null : (
                                    <p key={j} style={{ background: d.type === 'added' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: 'var(--color-text)' }}>
                                      {d.type === 'added' ? '+ ' : '− '}{d.text}
                                    </p>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {/* ═══ Password Protect ═══════════════════════════════════════ */}
          {mode === 'protect' && (
            <section>
              <ToolHeader id="protect" label="Password Protect" onHelp={setHelpTool} getIcon={getIcon} />
              <div className="grid lg:grid-cols-2 gap-6">
                <div>
                  <Tooltip text="Upload the PDF you want to lock with a password.">
                    <div><PdfUpload onChange={onPwFileChange} files={pwFile ? [pwFile] : []} onRemove={() => { setPwFile(null); setPwResult(null); }} /></div>
                  </Tooltip>

                  <div className="mt-3 space-y-2">
                    <PasswordField
                      getIcon={getIcon}
                      className={inp} style={inpStyle}
                      placeholder="Password to open the file"
                      value={pwPassword} onChange={e => setPwPassword(e.target.value)}
                      tooltipText="Required to open the file in any PDF viewer."
                    />
                    <PasswordField
                      getIcon={getIcon}
                      className={inp} style={inpStyle}
                      placeholder="Owner password (optional)"
                      value={pwOwnerPassword} onChange={e => setPwOwnerPassword(e.target.value)}
                      tooltipText="Optional — a separate password that can change permissions/remove protection. Defaults to the same password if left blank."
                    />
                  </div>

                  <div className="mt-3 space-y-1.5">
                    <Tooltip text="Uncheck to block printing the file.">
                      <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
                        <input type="checkbox" checked={pwPermPrint} onChange={e => setPwPermPrint(e.target.checked)} className="w-3.5 h-3.5" />
                        Allow printing
                      </label>
                    </Tooltip>
                    <Tooltip text="Uncheck to block copying text/images out of the file.">
                      <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
                        <input type="checkbox" checked={pwPermCopy} onChange={e => setPwPermCopy(e.target.checked)} className="w-3.5 h-3.5" />
                        Allow copying text/images
                      </label>
                    </Tooltip>
                    <Tooltip text="Uncheck to block editing/annotating the file.">
                      <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
                        <input type="checkbox" checked={pwPermModify} onChange={e => setPwPermModify(e.target.checked)} className="w-3.5 h-3.5" />
                        Allow editing
                      </label>
                    </Tooltip>
                  </div>

                  <ErrMsg msg={pwError} />
                  <RunBtn onClick={runProtect} busy={pwBusy} disabled={!pwFile || !pwPassword} label="Protect & Download" getIcon={getIcon} />
                </div>
                <div>
                  <PdfPagePreview dataUrl={pwFile?.dataUrl} />
                </div>
              </div>
            </section>
          )}

          {/* ═══ Remove Password ════════════════════════════════════════ */}
          {mode === 'unprotect' && (
            <section>
              <ToolHeader id="unprotect" label="Remove Password" onHelp={setHelpTool} getIcon={getIcon} />
              <div className="max-w-md">
                <Tooltip text="Upload the password-protected PDF.">
                  <div><PdfUpload onChange={onUnpwFileChange} files={unpwFile ? [unpwFile] : []} onRemove={() => { setUnpwFile(null); setUnpwResult(null); }} /></div>
                </Tooltip>
                <div className="mt-3">
                  <PasswordField
                    getIcon={getIcon}
                    className={inp} style={inpStyle}
                    placeholder="Current password"
                    value={unpwPassword} onChange={e => setUnpwPassword(e.target.value)}
                    tooltipText="The password currently required to open this file."
                  />
                </div>
                <ErrMsg msg={unpwError} />
                <RunBtn onClick={runUnprotect} busy={unpwBusy} disabled={!unpwFile || !unpwPassword} label="Remove Password & Download" getIcon={getIcon} />
              </div>
            </section>
          )}

          {/* ═══ Compress ═══════════════════════════════════════════════ */}
          {mode === 'compress' && (
            <section>
              <ToolHeader id="compress" label="Compress PDF" onHelp={setHelpTool} getIcon={getIcon} />
              <div className="grid lg:grid-cols-2 gap-6">
                <div>
                  <Tooltip text="Upload the PDF you want to shrink.">
                    <div><PdfUpload onChange={onCmpFileChange} files={cmpFile ? [cmpFile] : []} onRemove={() => { setCmpFile(null); setCmpResult(null); }} /></div>
                  </Tooltip>

                  <div className="mt-3 space-y-2">
                    <Tooltip text="Also re-encode embedded photos/scans at a lower quality for a bigger size reduction. Safe images only — anything risky is left untouched.">
                      <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
                        <input type="checkbox" checked={cmpRecompress} onChange={e => setCmpRecompress(e.target.checked)} className="w-3.5 h-3.5" />
                        Recompress images (deeper, may affect image quality)
                      </label>
                    </Tooltip>
                    {cmpRecompress && (
                      <Tooltip text="Lower quality shrinks the file more but images look softer.">
                        <select className={inp} style={inpStyle} value={cmpQuality} onChange={e => setCmpQuality(e.target.value)}>
                          <option value="low">Low quality (smallest file)</option>
                          <option value="medium">Medium quality</option>
                          <option value="high">High quality (largest of the three)</option>
                        </select>
                      </Tooltip>
                    )}
                  </div>

                  <ErrMsg msg={cmpError} />
                  <RunBtn onClick={runCompress} busy={cmpBusy} disabled={!cmpFile} label="Compress" getIcon={getIcon} />

                  {cmpResult && (
                    <div className="mt-3 space-y-2">
                      <div className="rounded-lg px-3 py-2.5 text-xs space-y-1" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                        <p style={{ color: 'var(--color-muted)' }}>Original: <strong style={{ color: 'var(--color-text)' }}>{formatBytes(cmpResult.originalSize)}</strong></p>
                        <p style={{ color: 'var(--color-muted)' }}>Compressed: <strong style={{ color: 'var(--color-text)' }}>{formatBytes(cmpResult.compressedSize)}</strong></p>
                        <p style={{ color: 'var(--color-muted)' }}>Saved: <strong style={{ color: 'var(--color-primary)' }}>{cmpResult.savedPercent}%</strong></p>
                        {cmpRecompress && <p style={{ color: 'var(--color-muted)' }}>{cmpResult.imagesRecompressed} image{cmpResult.imagesRecompressed !== 1 ? 's' : ''} recompressed</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setResultModal({ dataUrl: cmpResult.dataUrl, filename: cmpFile ? `${cmpFile.name.replace('.pdf', '')}-compressed.pdf` : 'compressed.pdf', meta: `${cmpResult.savedPercent}% smaller` })}
                          className="flex-1 py-2 rounded-lg text-sm font-medium hover:opacity-80 transition-opacity"
                          style={{ background: 'var(--color-primary)', color: '#fff' }}
                        >
                          View Result
                        </button>
                        <button
                          onClick={() => downloadFile(cmpResult.dataUrl, cmpFile ? `${cmpFile.name.replace('.pdf', '')}-compressed.pdf` : 'compressed.pdf')}
                          className="py-2 px-3 rounded-lg text-sm hover:opacity-70 transition-opacity border"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                        >
                          {getIcon('download', { size: 14 })}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <PdfPagePreview dataUrl={cmpFile?.dataUrl} />
                </div>
              </div>
            </section>
          )}

        </main>
      </div>

      {/* ── Result modal ──────────────────────────────────────────────────── */}
      {resultModal && (
        <PdfResultModal
          dataUrl={resultModal.dataUrl}
          filename={resultModal.filename}
          meta={resultModal.meta}
          onClose={() => setResultModal(null)}
          getIcon={getIcon}
        />
      )}

      {/* ── Help modal ────────────────────────────────────────────────────── */}
      {helpTool && (() => {
        const h = TOOL_HELP[helpTool];
        if (!h) return null;
        return (
          <div
            className="fixed inset-0 flex items-center justify-center z-50 p-4"
            style={{ background: 'rgba(0,0,0,0.4)' }}
            onClick={() => setHelpTool(null)}
          >
            <div
              className="rounded-2xl p-6 max-w-md w-full shadow-xl"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', border: '1px solid' }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{h.title}</h3>
                <button
                  type="button"
                  onClick={() => setHelpTool(null)}
                  className="hover:opacity-60 transition-opacity"
                  style={{ color: 'var(--color-muted)' }}
                >
                  {getIcon('x', { size: 18 })}
                </button>
              </div>
              <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>{h.what}</p>
              <ul className="space-y-2">
                {h.features.map((feat, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                    <span className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-primary)' }}>{getIcon('check', { size: 14 })}</span>
                    {feat}
                  </li>
                ))}
              </ul>
              {h.workflow && (
                <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Workflow — what to do next</p>
                  <ol className="space-y-1.5 list-decimal list-inside">
                    {h.workflow.map((step, i) => (
                      <li key={i} className="text-xs" style={{ color: 'var(--color-muted)' }}>{step}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
