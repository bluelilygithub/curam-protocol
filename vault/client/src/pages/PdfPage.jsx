import { useState, useRef, useCallback, useEffect } from 'react';
import { useIcon } from '../providers/IconProvider';
import api from '../utils/apiClient';

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
      'Text fields can be flagged as multiline or required',
      'Dropdown fields accept a custom options list',
      'Fields are saved as real AcroForm fields (fillable with Inspect + Fill tools or any PDF reader)',
    ],
  },
};

const MODES = [
  { id: 'merge',       label: 'Merge',          icon: 'combine'    },
  { id: 'split',       label: 'Split',           icon: 'scissors'   },
  { id: 'rotate',      label: 'Rotate Pages',    icon: 'rotate-cw'  },
  { id: 'img2pdf',     label: 'Images → PDF',    icon: 'file-image' },
  { id: 'extracttext', label: 'Extract Text',    icon: 'type'       },
  { id: 'watermark',   label: 'Watermark',       icon: 'droplets'   },
  { id: 'pagenumbers', label: 'Page Numbers',    icon: 'hash'       },
  { id: 'inspect',     label: 'Inspect Fields',  icon: 'list'       },
  { id: 'fill',        label: 'Fill Form',       icon: 'file-pen'   },
  { id: 'flatten',      label: 'Flatten',         icon: 'layers'   },
  { id: 'fielddesigner', label: 'Add Fields',    icon: 'pen-line' },
  { id: 'metadata',    label: 'Metadata',        icon: 'info'     },
  { id: 'fileinfo',    label: 'File Info',       icon: 'file-text'},
];

const MODE_GROUPS = [
  { label: 'Organise', ids: ['merge', 'split', 'rotate'] },
  { label: 'Convert',  ids: ['img2pdf', 'extracttext']   },
  { label: 'Edit',     ids: ['watermark', 'pagenumbers'] },
  { label: 'Forms',    ids: ['inspect', 'fill', 'flatten', 'fielddesigner'] },
  { label: 'Analyse',  ids: ['metadata', 'fileinfo']     },
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

async function getPdfPageCount(dataUrl) {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;
    }
    const resp = await fetch(dataUrl);
    const buf = await resp.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    return doc.numPages;
  } catch {
    return null;
  }
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
  return (
    <div>
      {label && <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--color-muted)' }}>{label}</p>}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-full flex items-center justify-center gap-2 py-6 rounded-xl border-2 border-dashed text-sm hover:opacity-70 transition-opacity"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        {multiple ? 'Upload PDFs' : 'Upload PDF'}
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

function ResultCard({ dataUrl, filename, pageCount, getIcon, extra }) {
  if (!dataUrl) return null;
  const sizeBytes = Math.round((dataUrl.length * 3) / 4);
  return (
    <div className="rounded-xl border p-4 flex flex-col gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="flex items-center gap-2">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>
          {getIcon('file-text', { size: 20 })}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{filename || 'result.pdf'}</p>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {pageCount ? `${pageCount} page${pageCount !== 1 ? 's' : ''} · ` : ''}{formatBytes(sizeBytes)}
          </p>
        </div>
      </div>
      {extra}
      <button
        type="button"
        onClick={() => downloadFile(dataUrl, filename || 'result.pdf')}
        className="w-full py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
        style={{ background: 'var(--color-primary)', color: '#fff' }}
      >
        {getIcon('download', { size: 14 })} Download
      </button>
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

  // Sidebar state
  const [mode, setMode] = useState('merge');
  const [openGroup, setOpenGroup] = useState('Organise');
  const [toolSearch, setToolSearch] = useState('');
  const [hoveredTool, setHoveredTool] = useState(null);
  const [helpTool, setHelpTool] = useState(null);
  const toolSearchRef = useRef(null);

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
  const [infoBusy, setInfoBusy] = useState(false);

  // Field Designer
  const [fdFile, setFdFile] = useState(null);
  const [fdPageCount, setFdPageCount] = useState(0);
  const [fdCurrentPage, setFdCurrentPage] = useState(1);
  const [fdPageDims, setFdPageDims] = useState(null);
  const [fdFields, setFdFields] = useState([]);
  const [fdFieldType, setFdFieldType] = useState('text');
  const [fdBusy, setFdBusy] = useState(false);
  const [fdResult, setFdResult] = useState(null);
  const [fdError, setFdError] = useState('');
  const fdPdfCanvasRef = useRef(null);
  const fdUiCanvasRef = useRef(null);
  const fdPdfDocRef = useRef(null);
  const fdIsDrawingRef = useRef(false);
  const fdStartRef = useRef(null);
  // Refs keep canvas callbacks free of stale closures
  const fdCurrentPageRef = useRef(1);
  const fdPageDimsRef = useRef(null);
  const fdFieldsRef = useRef([]);
  const fdFieldTypeRef = useRef('text');

  // Keep refs in sync
  useEffect(() => { fdCurrentPageRef.current = fdCurrentPage; }, [fdCurrentPage]);
  useEffect(() => { fdPageDimsRef.current = fdPageDims; }, [fdPageDims]);
  useEffect(() => { fdFieldsRef.current = fdFields; }, [fdFields]);
  useEffect(() => { fdFieldTypeRef.current = fdFieldType; }, [fdFieldType]);

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
      ctx.fillStyle = 'rgba(99,102,241,0.12)';
      ctx.fillRect(cx, cy, cw, ch);
      ctx.strokeStyle = 'rgb(99,102,241)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx, cy, cw, ch);
      ctx.fillStyle = 'rgb(99,102,241)';
      ctx.font = 'bold 10px system-ui,sans-serif';
      ctx.fillText(`${f.name} (${f.type})`, cx + 3, cy + 12);
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

  // Re-render when page changes
  useEffect(() => {
    if (fdPdfDocRef.current && fdCurrentPage) renderFdPage(fdCurrentPage);
  }, [fdCurrentPage, renderFdPage]);

  // Re-draw overlay when field list changes (e.g., name edits, removals)
  useEffect(() => { redrawFdOverlay(); }, [fdFields, redrawFdOverlay]);

  const fdCanvasCoords = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  };

  const onFdDown = useCallback((e) => {
    if (!fdPageDimsRef.current) return;
    fdIsDrawingRef.current = true;
    fdStartRef.current = fdCanvasCoords(e, fdUiCanvasRef.current);
  }, []);

  const onFdMove = useCallback((e) => {
    if (!fdIsDrawingRef.current || !fdStartRef.current) return;
    const cur = fdCanvasCoords(e, fdUiCanvasRef.current);
    const { x: sx, y: sy } = fdStartRef.current;
    const bx = Math.min(sx, cur.x), by = Math.min(sy, cur.y);
    const bw = Math.abs(cur.x - sx), bh = Math.abs(cur.y - sy);
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
      y: dims.pdfH - (by + bh) / dims.renderScale, // flip y-axis (PDF bottom-left origin)
      width: bw / dims.renderScale,
      height: bh / dims.renderScale,
      required: false,
      multiline: false,
      options: [],
    };
    const next = [...fdFieldsRef.current, newField];
    fdFieldsRef.current = next;
    setFdFields(next);
  }, [redrawFdOverlay]);

  const onFdLeave = useCallback(() => {
    if (fdIsDrawingRef.current) { fdIsDrawingRef.current = false; fdStartRef.current = null; redrawFdOverlay(); }
  }, [redrawFdOverlay]);

  const updateFdField = useCallback((id, patch) => {
    setFdFields(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  }, []);

  const removeFdField = useCallback((id) => {
    setFdFields(prev => prev.filter(f => f.id !== id));
  }, []);

  const onFdFileChange = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    setFdFields([]); fdFieldsRef.current = [];
    setFdResult(null); setFdError('');
    setFdCurrentPage(1); fdCurrentPageRef.current = 1;
    const dataUrl = await readFileAsDataUrl(file);
    setFdFile({ name: file.name, dataUrl, size: file.size });
    const pdfjsLib = await import('pdfjs-dist');
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;
    }
    const resp = await fetch(dataUrl);
    const buf = await resp.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    fdPdfDocRef.current = doc;
    setFdPageCount(doc.numPages);
    // Trigger page render via useEffect
    setFdCurrentPage(1);
  };

  const changeFdPage = (n) => {
    if (n < 1 || n > fdPageCount) return;
    setFdCurrentPage(n);
  };

  const runAddFields = async () => {
    if (!fdFile || !fdFields.length) return;
    setFdBusy(true); setFdError(''); setFdResult(null);
    try {
      const res = await api.post('/api/pdf/addfields', { dataUrl: fdFile.dataUrl, fields: fdFields });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFdResult({ dataUrl: data.dataUrl, pageCount: data.pageCount, added: data.added });
    } catch (err) {
      setFdError(err.message || 'Add fields failed');
    } finally {
      setFdBusy(false);
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
    setInfoData(null); setInfoFile(file);
    setInfoBusy(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
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
    setMergeBusy(true); setMergeError(''); setMergeResult(null);
    try {
      const res = await api.post('/api/pdf/merge', { pdfs: mergeFiles.map(f => ({ dataUrl: f.dataUrl, name: f.name })) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMergeResult({ dataUrl: data.dataUrl, pageCount: data.pageCount });
    } catch (err) {
      setMergeError(err.message || 'Merge failed');
    } finally {
      setMergeBusy(false);
    }
  };

  const runSplit = async () => {
    if (!splitFile) return setSplitError('Upload a PDF first.');
    if (!splitPages.trim()) return setSplitError('Enter page numbers to extract.');
    setSplitBusy(true); setSplitError(''); setSplitResult(null);
    try {
      const res = await api.post('/api/pdf/split', { dataUrl: splitFile.dataUrl, pages: splitPages });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSplitResult({ dataUrl: data.dataUrl, pageCount: data.pageCount, totalSource: data.totalSource });
    } catch (err) {
      setSplitError(err.message || 'Split failed');
    } finally {
      setSplitBusy(false);
    }
  };

  const runRotate = async () => {
    if (!rotateFile) return setRotateError('Upload a PDF first.');
    setRotateBusy(true); setRotateError(''); setRotateResult(null);
    try {
      const res = await api.post('/api/pdf/rotate', { dataUrl: rotateFile.dataUrl, angle: rotateAngle, pages: rotatePages });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRotateResult({ dataUrl: data.dataUrl, pageCount: data.pageCount, rotated: data.rotated });
    } catch (err) {
      setRotateError(err.message || 'Rotate failed');
    } finally {
      setRotateBusy(false);
    }
  };

  const runImg2Pdf = async () => {
    if (!imgFiles.length) return setImgError('Upload at least 1 image.');
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
    } catch (err) {
      setImgError(err.message || 'Conversion failed');
    } finally {
      setImgBusy(false);
    }
  };

  const runExtractText = async () => {
    if (!etFile) return setEtError('Upload a PDF first.');
    setEtBusy(true); setEtError(''); setEtText('');
    try {
      const pdfjsLib = await import('pdfjs-dist');
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;
      }
      const resp = await fetch(etFile.dataUrl);
      const buf = await resp.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
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
      setEtBusy(false);
    }
  };

  const runWatermark = async () => {
    if (!wmFile) return setWmError('Upload a PDF first.');
    if (!wmText.trim()) return setWmError('Enter watermark text.');
    setWmBusy(true); setWmError(''); setWmResult(null);
    try {
      const res = await api.post('/api/pdf/watermark', {
        dataUrl: wmFile.dataUrl, text: wmText, fontSize: wmFontSize,
        opacity: wmOpacity, color: wmColor, angle: wmAngle,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setWmResult({ dataUrl: data.dataUrl, pageCount: data.pageCount });
    } catch (err) {
      setWmError(err.message || 'Watermark failed');
    } finally {
      setWmBusy(false);
    }
  };

  const runPageNumbers = async () => {
    if (!pnFile) return setPnError('Upload a PDF first.');
    setPnBusy(true); setPnError(''); setPnResult(null);
    try {
      const res = await api.post('/api/pdf/pagenumbers', {
        dataUrl: pnFile.dataUrl, format: pnFormat, position: pnPosition,
        fontSize: pnFontSize, startAt: pnStartAt,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPnResult({ dataUrl: data.dataUrl, pageCount: data.pageCount });
    } catch (err) {
      setPnError(err.message || 'Add page numbers failed');
    } finally {
      setPnBusy(false);
    }
  };

  const runInspect = async () => {
    if (!inspectFile) return setInspectError('Upload a PDF first.');
    setInspectBusy(true); setInspectError(''); setInspectFields(null);
    try {
      const res = await api.post('/api/pdf/inspect', { dataUrl: inspectFile.dataUrl });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setInspectFields(data.fields);
    } catch (err) {
      setInspectError(err.message || 'Inspect failed');
    } finally {
      setInspectBusy(false);
    }
  };

  const runFill = async () => {
    if (!fillFile) return setFillError('Upload a PDF first.');
    setFillBusy(true); setFillError(''); setFillResult(null);
    try {
      const res = await api.post('/api/pdf/fill', { dataUrl: fillFile.dataUrl, fields: fillValues });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFillResult({ dataUrl: data.dataUrl, pageCount: data.pageCount, filled: data.filled });
    } catch (err) {
      setFillError(err.message || 'Fill failed');
    } finally {
      setFillBusy(false);
    }
  };

  const runFlatten = async () => {
    if (!flatFile) return setFlatError('Upload a PDF first.');
    setFlatBusy(true); setFlatError(''); setFlatResult(null);
    try {
      const res = await api.post('/api/pdf/flatten', { dataUrl: flatFile.dataUrl });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFlatResult({ dataUrl: data.dataUrl, pageCount: data.pageCount });
    } catch (err) {
      setFlatError(err.message || 'Flatten failed');
    } finally {
      setFlatBusy(false);
    }
  };

  const runMetaSave = async () => {
    if (!metaFile) return;
    setMetaBusy(true); setMetaError(''); setMetaResult(null);
    try {
      const res = await api.post('/api/pdf/metadata', { dataUrl: metaFile.dataUrl, update: metaEdit });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMetaResult({ dataUrl: data.dataUrl, pageCount: data.pageCount });
    } catch (err) {
      setMetaError(err.message || 'Save failed');
    } finally {
      setMetaBusy(false);
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
    extracttext: 'Pull all text from a PDF (client-side).',
    watermark: 'Stamp a diagonal text watermark.',
    pagenumbers: 'Add page numbers to every page.',
    inspect: 'List all interactive form fields.',
    fill: 'Fill in form fields and download.',
    flatten: 'Lock form fields as static content.',
    fielddesigner: 'Draw and place interactive form fields on a PDF page.',
    metadata: 'View and edit document metadata.',
    fileinfo: 'Show basic file information (client-side).',
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
                  <ResultCard dataUrl={mergeResult?.dataUrl} filename="merged.pdf" pageCount={mergeResult?.pageCount} getIcon={getIcon} />
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
                  <ResultCard
                    dataUrl={splitResult?.dataUrl}
                    filename={splitFile ? `${splitFile.name.replace('.pdf', '')}-split.pdf` : 'split.pdf'}
                    pageCount={splitResult?.pageCount}
                    getIcon={getIcon}
                    extra={splitResult && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Extracted {splitResult.pageCount} of {splitResult.totalSource} pages</p>}
                  />
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
                  <ResultCard
                    dataUrl={rotateResult?.dataUrl}
                    filename={rotateFile ? `${rotateFile.name.replace('.pdf', '')}-rotated.pdf` : 'rotated.pdf'}
                    pageCount={rotateResult?.pageCount}
                    getIcon={getIcon}
                    extra={rotateResult && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{rotateResult.rotated} page{rotateResult.rotated !== 1 ? 's' : ''} rotated {rotateAngle}°</p>}
                  />
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
                  <ResultCard dataUrl={imgResult?.dataUrl} filename="images.pdf" pageCount={imgResult?.pageCount} getIcon={getIcon} />
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
                  <ResultCard
                    dataUrl={wmResult?.dataUrl}
                    filename={wmFile ? `${wmFile.name.replace('.pdf', '')}-watermarked.pdf` : 'watermarked.pdf'}
                    pageCount={wmResult?.pageCount}
                    getIcon={getIcon}
                  />
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
                  <ResultCard
                    dataUrl={pnResult?.dataUrl}
                    filename={pnFile ? `${pnFile.name.replace('.pdf', '')}-numbered.pdf` : 'numbered.pdf'}
                    pageCount={pnResult?.pageCount}
                    getIcon={getIcon}
                  />
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
                  <ResultCard
                    dataUrl={fillResult?.dataUrl}
                    filename={fillFile ? `${fillFile.name.replace('.pdf', '')}-filled.pdf` : 'filled.pdf'}
                    pageCount={fillResult?.pageCount}
                    getIcon={getIcon}
                    extra={fillResult && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{fillResult.filled} field{fillResult.filled !== 1 ? 's' : ''} filled</p>}
                  />
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
                  <ResultCard
                    dataUrl={flatResult?.dataUrl}
                    filename={flatFile ? `${flatFile.name.replace('.pdf', '')}-flat.pdf` : 'flat.pdf'}
                    pageCount={flatResult?.pageCount}
                    getIcon={getIcon}
                  />
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
                  <ResultCard
                    dataUrl={metaResult?.dataUrl}
                    filename={metaFile ? `${metaFile.name.replace('.pdf', '')}-meta.pdf` : 'meta.pdf'}
                    pageCount={metaResult?.pageCount}
                    getIcon={getIcon}
                  />
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
                  <PdfUpload onChange={onInfoFileChange} files={infoFile ? [{ name: infoFile.name, size: infoFile.size }] : []} onRemove={() => { setInfoFile(null); setInfoData(null); }} />
                  {infoBusy && <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>Analysing…</p>}
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

          {/* ═══ Field Designer ══════════════════════════════════════════ */}
          {mode === 'fielddesigner' && (
            <section>
              <ToolHeader id="fielddesigner" label="Add Form Fields" onHelp={setHelpTool} getIcon={getIcon}
                badge={fdFields.length ? `${fdFields.length} field${fdFields.length !== 1 ? 's' : ''}` : undefined} />

              {!fdFile && (
                <PdfUpload onChange={onFdFileChange} files={[]} />
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
                    <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
                      Click and drag on the page to place a <strong>{fdFieldType}</strong> field.
                    </p>
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
                        <div key={f.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
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
                      <div className="mt-3">
                        <ResultCard
                          dataUrl={fdResult.dataUrl}
                          filename={fdFile ? `${fdFile.name.replace('.pdf', '')}-fields.pdf` : 'with-fields.pdf'}
                          pageCount={fdResult.pageCount}
                          getIcon={getIcon}
                          extra={<p className="text-xs" style={{ color: 'var(--color-muted)' }}>{fdResult.added} AcroForm field{fdResult.added !== 1 ? 's' : ''} embedded</p>}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

        </main>
      </div>

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
            </div>
          </div>
        );
      })()}
    </div>
  );
}
