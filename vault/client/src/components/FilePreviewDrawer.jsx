import React, { useState, useEffect, useRef } from 'react';
import useAuthStore from '../store/authStore';
import { useIcon } from '../providers/IconProvider';

function classifyFile(file) {
  if (!file) return 'text';
  const ext = (file.name || '').split('.').pop().toLowerCase();
  const mime = file.mimetype || '';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime === 'text/csv' || ext === 'csv') return 'csv';
  if (['xlsx', 'xls', 'ods'].includes(ext)) return 'spreadsheet';
  if (['docx', 'doc', 'odt'].includes(ext) || mime.includes('wordprocessingml') || mime === 'application/msword') return 'word';
  return 'text'; // .txt, .md, .json, all code files stored as text/plain
}

// Parse "## Sheet: Name\nCSV...\n\n## Sheet: ..." format produced by server extractXlsxText
function parseSheets(text) {
  if (!text) return [];
  return text
    .split(/(?=## Sheet: )/)
    .map(block => {
      const m = block.match(/^## Sheet: ([^\n]+)\n([\s\S]*)$/);
      return m ? { name: m[1].trim(), csv: m[2].trim() } : null;
    })
    .filter(Boolean);
}

// Minimal CSV → rows parser (handles double-quote escaping)
function parseCsv(text) {
  if (!text) return [];
  return text
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      const cells = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') {
          if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = !inQ;
        } else if (line[i] === ',' && !inQ) {
          cells.push(cur); cur = '';
        } else {
          cur += line[i];
        }
      }
      cells.push(cur);
      return cells;
    });
}

// Defined at module level to satisfy Rules of Hooks — receives pdfDoc as prop
function PdfPageCanvas({ pdfDoc, pageNum }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    pdfDoc.getPage(pageNum).then(page => {
      if (cancelled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = canvasRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise.catch(() => {});
    });
    return () => { cancelled = true; };
  }, [pdfDoc, pageNum]);
  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-lg mb-3 block"
      style={{ border: '1px solid var(--color-border)' }}
    />
  );
}

function SheetTable({ rows }) {
  if (!rows || rows.length === 0) return (
    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Empty sheet.</p>
  );
  const header = rows[0];
  const body = rows.slice(1);
  return (
    <table className="text-xs border-collapse min-w-full">
      <thead>
        <tr>
          {header.map((cell, ci) => (
            <th
              key={ci}
              className="px-2 py-1.5 text-left border font-semibold whitespace-nowrap"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            >
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {body.map((row, ri) => (
          <tr key={ri}>
            {row.map((cell, ci) => (
              <td
                key={ci}
                className="px-2 py-1 border"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function FilePreviewDrawer({ file, onClose, onAttach }) {
  const { token } = useAuthStore();
  const getIcon = useIcon();
  const drawerRef = useRef(null);
  const scrollRef = useRef(null);
  const prevFocusRef = useRef(null);

  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [pdfRendered, setPdfRendered] = useState(3);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [activeSheet, setActiveSheet] = useState(0);

  const type = file ? classifyFile(file) : null;

  // Reset all view state whenever the file changes — prevents stale content
  useEffect(() => {
    setPdfDoc(null);
    setPdfTotalPages(0);
    setPdfRendered(3);
    setPdfError('');
    setActiveSheet(0);
  }, [file?.id]);

  // Save previous focus, move focus into drawer, restore on unmount
  useEffect(() => {
    if (!file) return;
    prevFocusRef.current = document.activeElement;
    drawerRef.current?.focus();
    return () => { prevFocusRef.current?.focus?.(); };
  }, [!!file]); // eslint-disable-line react-hooks/exhaustive-deps

  // ESC to close
  useEffect(() => {
    if (!file) return;
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [file, onClose]);

  // Load PDF binary and initialise pdfjs-dist
  useEffect(() => {
    if (!file || type !== 'pdf') return;
    let cancelled = false;
    setPdfLoading(true);
    (async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          // CDN worker avoids Vite worker-bundling complexity with pdfjs v3
          pdfjsLib.GlobalWorkerOptions.workerSrc =
            `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;
        }
        const res = await fetch(`/api/files/${file.id}/raw`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        if (cancelled) return;
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setPdfTotalPages(doc.numPages);
      } catch (err) {
        if (!cancelled) setPdfError(err.message);
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file?.id, type, token]);

  // Lazy-load 3 more pages when user scrolls near the bottom
  const handleScroll = () => {
    if (!scrollRef.current || type !== 'pdf') return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    if (scrollHeight - scrollTop < clientHeight * 1.5) {
      setPdfRendered(p => Math.min(p + 3, pdfTotalPages));
    }
  };

  if (!file) return null;

  const sheets = type === 'spreadsheet' ? parseSheets(file.extractedText) : [];
  const csvRows = type === 'csv' ? parseCsv(file.extractedText) : [];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.45)' }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer — full-screen on mobile, 640px panel on sm+ */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        role="dialog"
        aria-label={`Preview: ${file.name}`}
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col w-full sm:w-[640px] max-w-full outline-none"
        style={{ background: 'var(--color-bg)', borderLeft: '1px solid var(--color-border)' }}
      >
        {/* Header */}
        <div
          className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b gap-3"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {getIcon('file-text', { size: 15, style: { color: 'var(--color-muted)', flexShrink: 0 } })}
            <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>
              {file.name}
            </span>
            <span
              className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded uppercase tracking-wide"
              style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
            >
              {type}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {onAttach && (
              <button
                onClick={() => { onAttach(file); onClose(); }}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium hover:opacity-80 transition-opacity"
                style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
              >
                {getIcon('paperclip', { size: 12 })}
                Attach
              </button>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:opacity-70 transition-opacity"
              style={{ color: 'var(--color-muted)' }}
              title="Close preview"
            >
              {getIcon('x', { size: 16 })}
            </button>
          </div>
        </div>

        {/* Sheet tabs — multi-sheet spreadsheets only */}
        {type === 'spreadsheet' && sheets.length > 1 && (
          <div
            className="flex-shrink-0 flex gap-1 px-4 py-2 border-b overflow-x-auto"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
          >
            {sheets.map((sheet, i) => (
              <button
                key={sheet.name}
                onClick={() => setActiveSheet(i)}
                className="flex-shrink-0 text-xs px-3 py-1 rounded-md border transition-colors"
                style={{
                  borderColor: activeSheet === i ? 'var(--color-primary)' : 'var(--color-border)',
                  background: activeSheet === i ? 'var(--color-primary)' : 'transparent',
                  color: activeSheet === i ? '#fff' : 'var(--color-text)',
                }}
              >
                {sheet.name}
              </button>
            ))}
          </div>
        )}

        {/* Scrollable content */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4"
        >
          {/* PDF */}
          {type === 'pdf' && (
            pdfLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm" style={{ color: 'var(--color-muted)' }}>
                {getIcon('loader', { size: 16 })} Loading PDF…
              </div>
            ) : pdfError ? (
              <p className="text-sm py-4" style={{ color: '#ef4444' }}>
                Could not load PDF: {pdfError}
              </p>
            ) : pdfDoc ? (
              <div>
                {Array.from({ length: Math.min(pdfRendered, pdfTotalPages) }, (_, i) => i + 1).map(pageNum => (
                  <PdfPageCanvas key={pageNum} pdfDoc={pdfDoc} pageNum={pageNum} />
                ))}
                {pdfRendered < pdfTotalPages && (
                  <p className="text-center text-xs py-3" style={{ color: 'var(--color-muted)' }}>
                    Showing {pdfRendered} of {pdfTotalPages} pages — scroll to load more
                  </p>
                )}
              </div>
            ) : null
          )}

          {/* Spreadsheet — multi-sheet */}
          {type === 'spreadsheet' && (
            sheets.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No spreadsheet content extracted.</p>
            ) : (
              <div className="overflow-x-auto">
                <SheetTable rows={parseCsv(sheets[activeSheet]?.csv || '')} />
              </div>
            )
          )}

          {/* CSV — single flat table */}
          {type === 'csv' && (
            csvRows.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No CSV content extracted.</p>
            ) : (
              <div className="overflow-x-auto">
                <SheetTable rows={csvRows} />
              </div>
            )
          )}

          {/* Word — plain text from mammoth extractRawText */}
          {type === 'word' && (
            file.extractedText ? (
              <div
                className="text-sm leading-relaxed whitespace-pre-wrap break-words"
                style={{ color: 'var(--color-text)' }}
              >
                {file.extractedText}
              </div>
            ) : (
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No text content extracted.</p>
            )
          )}

          {/* Text / code */}
          {type === 'text' && (
            file.extractedText ? (
              <pre
                className="text-xs leading-relaxed whitespace-pre-wrap break-words"
                style={{ color: 'var(--color-text)', fontFamily: 'monospace' }}
              >
                {file.extractedText}
              </pre>
            ) : (
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No text content extracted.</p>
            )
          )}
        </div>
      </div>
    </>
  );
}
