// Extra PDF Tools: Pages to images, Extract images, OCR, Remove blank pages, Crop, Header & footer, N-up.
// Same conventions as PdfPage.jsx (shared sub-components imported from it; each tool owns its own state).
// Imports from PdfPage are only used while rendering, so the circular import is safe.
import { useState, useRef, useEffect } from 'react';
import api from '../../utils/apiClient';
import useProcessingStore from '../../store/processingStore';
import Tooltip from '../../components/Tooltip';
import { createOcrEngine } from '../../utils/ocrEngine';
import {
  ToolHeader, PdfUpload, RunBtn, ErrMsg, PdfPagePreview,
  readFileAsDataUrl, dataUrlToUint8Array, initPdfjsWorker, getPdfPageCount, downloadFile,
} from '../PdfPage';

const lbl = 'block text-xs font-medium mb-1';
const inp = 'w-full text-sm px-3 py-2 rounded-lg border outline-none';
const inpStyle = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const muted = { color: 'var(--color-muted)' };

// "1-3,5,7-9" or "all"/blank -> 1-based page numbers (null = every page).
export function parsePageRange(str, max) {
  const s = String(str || '').trim();
  if (!s || s.toLowerCase() === 'all') return null;
  const out = new Set();
  for (const part of s.split(',')) {
    const t = part.trim();
    if (!t) continue;
    if (t.includes('-')) {
      const [a, b] = t.split('-').map(x => parseInt(x.trim(), 10));
      for (let i = Math.max(1, a || 1); i <= Math.min(max, b || a || 1); i++) out.add(i);
    } else {
      const n = parseInt(t, 10);
      if (n >= 1 && n <= max) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

async function openPdf(dataUrl) {
  const pdfjsLib = await import('pdfjs-dist');
  await initPdfjsWorker(pdfjsLib);
  return pdfjsLib.getDocument({ data: dataUrlToUint8Array(dataUrl) }).promise;
}

async function renderPage(doc, pageNum, scale) {
  const page = await doc.getPage(pageNum);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return canvas;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not make the image.'))), type, quality));
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  downloadFile(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const baseName = (f) => (f?.name || 'document').replace(/\.pdf$/i, '');

// One uploaded PDF + its page count; shared by every tool below.
function usePdfFile(onLoaded) {
  const [file, setFile] = useState(null);
  const onChange = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    const dataUrl = await readFileAsDataUrl(f);
    const pageCount = await getPdfPageCount(dataUrl);
    setFile({ name: f.name, dataUrl, size: f.size, pageCount });
    onLoaded?.();
  };
  return [file, setFile, onChange];
}

function PageRangeField({ value, onChange, max, tip }) {
  return (
    <div>
      <label className={lbl} style={muted}>Pages{max ? ` (1-${max})` : ''}</label>
      <Tooltip text={tip || 'Which pages to use. Leave as "all", or type a range such as 1-3,5,7-9.'}>
        <input type="text" className={inp} style={inpStyle} value={value} onChange={e => onChange(e.target.value)} placeholder="all" />
      </Tooltip>
    </div>
  );
}

// ═══ Pages to images ══════════════════════════════════════════════════════════
export function PageToImageTool({ getIcon, onHelp }) {
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [file, setFile, onChange] = usePdfFile(() => setError(''));
  const [format, setFormat] = useState('png');
  const [dpi, setDpi] = useState(150);
  const [range, setRange] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const run = async () => {
    if (!file) return;
    setBusy(true); setError(''); setDone('');
    startProcessing('Turning pages into images…', file.name);
    try {
      const doc = await openPdf(file.dataUrl);
      const pages = parsePageRange(range, doc.numPages) || Array.from({ length: doc.numPages }, (_, i) => i + 1);
      if (!pages.length) throw new Error('No valid pages in that range.');
      const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
      const ext = format === 'jpg' ? 'jpg' : 'png';
      const blobs = [];
      for (const n of pages) {
        const probe = await doc.getPage(n);
        const base = probe.getViewport({ scale: 1 });
        let scale = dpi / 72;
        // Stay under the browser's canvas limits (about 16k px a side, ~100M pixels).
        const px = base.width * scale * base.height * scale;
        if (px > 80e6) scale *= Math.sqrt(80e6 / px);
        const canvas = await renderPage(doc, n, scale);
        blobs.push({ n, blob: await canvasToBlob(canvas, mime, 0.92) });
        canvas.width = canvas.height = 0;
      }
      const stem = baseName(file);
      if (blobs.length === 1) {
        saveBlob(blobs[0].blob, `${stem}-page-${blobs[0].n}.${ext}`);
      } else {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        const pad = String(doc.numPages).length;
        blobs.forEach(({ n, blob }) => zip.file(`${stem}-page-${String(n).padStart(pad, '0')}.${ext}`, blob));
        saveBlob(await zip.generateAsync({ type: 'blob', compression: 'STORE' }), `${stem}-images.zip`);
      }
      setDone(`${blobs.length} image${blobs.length !== 1 ? 's' : ''} saved.`);
    } catch (err) {
      setError(err.message || 'Could not make the images.');
    } finally {
      stopProcessing(); setBusy(false);
    }
  };

  return (
    <section>
      <ToolHeader id="pdf2img" label="Pages to Images" onHelp={onHelp} getIcon={getIcon} badge="Client-side" />
      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <Tooltip text="Upload the PDF whose pages you want as pictures.">
            <div><PdfUpload onChange={onChange} files={file ? [file] : []} onRemove={() => { setFile(null); setDone(''); }} /></div>
          </Tooltip>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl} style={muted}>Format</label>
                <Tooltip text="PNG is sharp and lossless; JPG is smaller for photos.">
                  <select className={inp} style={inpStyle} value={format} onChange={e => setFormat(e.target.value)}>
                    <option value="png">PNG</option>
                    <option value="jpg">JPG</option>
                  </select>
                </Tooltip>
              </div>
              <div>
                <label className={lbl} style={muted}>Quality</label>
                <Tooltip text="Higher DPI gives a sharper, larger picture. 150 suits the screen, 300 suits printing.">
                  <select className={inp} style={inpStyle} value={dpi} onChange={e => setDpi(Number(e.target.value))}>
                    <option value={72}>72 DPI (small)</option>
                    <option value={150}>150 DPI (standard)</option>
                    <option value={300}>300 DPI (print)</option>
                  </select>
                </Tooltip>
              </div>
            </div>
            <PageRangeField value={range} onChange={setRange} max={file?.pageCount} />
          </div>
          <ErrMsg msg={error} />
          {done && <p className="text-xs mt-2" style={{ color: '#16a34a' }}>{done}</p>}
          <RunBtn onClick={run} busy={busy} disabled={!file} label="Make images" getIcon={getIcon} />
        </div>
        <div><PdfPagePreview dataUrl={file?.dataUrl} /></div>
      </div>
    </section>
  );
}

// ═══ Extract images ═══════════════════════════════════════════════════════════
export function ExtractImagesTool({ getIcon, onHelp }) {
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [file, setFile, onChange] = usePdfFile(() => { setResult(null); setError(''); });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const run = async () => {
    if (!file) return;
    setBusy(true); setError(''); setResult(null);
    startProcessing('Finding the pictures inside…', file.name);
    try {
      const res = await api.post('/api/pdf/extract-images', { dataUrl: file.dataUrl });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not extract images.');
      setResult(data);
    } catch (err) {
      setError(err.message || 'Could not extract images.');
    } finally {
      stopProcessing(); setBusy(false);
    }
  };

  return (
    <section>
      <ToolHeader id="extractimages" label="Extract Images" onHelp={onHelp} getIcon={getIcon} />
      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <Tooltip text="Upload a PDF to pull its embedded photos out as original JPEG files.">
            <div><PdfUpload onChange={onChange} files={file ? [file] : []} onRemove={() => { setFile(null); setResult(null); }} /></div>
          </Tooltip>
          <ErrMsg msg={error} />
          <RunBtn onClick={run} busy={busy} disabled={!file} label="Extract images" getIcon={getIcon} />
          {result && (
            <div className="mt-4 rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              {result.count === 0 ? (
                <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                  No JPEG photos found{result.skipped ? `, and ${result.skipped} other image${result.skipped !== 1 ? 's' : ''} use a format this tool can't copy out unchanged.` : '.'}
                  {' '}For scans or drawings, use Pages to Images instead.
                </p>
              ) : (
                <>
                  <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                    {result.count} image{result.count !== 1 ? 's' : ''} found
                    {result.skipped ? ` · ${result.skipped} skipped (format can't be copied out unchanged)` : ''}.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {(result.previews || []).map((p, i) => (
                      <img key={i} src={p.dataUrl} alt={`Image ${i + 1}`} className="rounded border" style={{ height: 64, borderColor: 'var(--color-border)' }} />
                    ))}
                  </div>
                  {result.count > (result.previews || []).length && (
                    <p className="text-xs mt-1" style={muted}>Showing the first {(result.previews || []).length}; the zip has all of them.</p>
                  )}
                  <Tooltip text="Download every image in one zip file.">
                    <button
                      type="button"
                      onClick={() => downloadFile(result.dataUrl, `${baseName(file)}-images.zip`)}
                      className="mt-3 px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-80 transition-opacity"
                      style={{ background: 'var(--color-primary)', color: '#fff' }}
                    >
                      Download zip
                    </button>
                  </Tooltip>
                </>
              )}
            </div>
          )}
        </div>
        <div><PdfPagePreview dataUrl={file?.dataUrl} /></div>
      </div>
    </section>
  );
}

// ═══ OCR ══════════════════════════════════════════════════════════════════════
const OCR_PAGE_CAP = 30;

export function OcrTool({ getIcon, onHelp, setResultModal }) {
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [file, setFile, onChange] = usePdfFile(() => { setError(''); setNote(''); setText(''); });
  const [range, setRange] = useState('all');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [text, setText] = useState('');
  const cancelRef = useRef(false);

  const run = async () => {
    if (!file) return;
    setBusy(true); setError(''); setNote(''); setText(''); cancelRef.current = false;
    startProcessing('Reading the scanned pages…', 'This runs on your device and can take a few seconds per page.');
    let engine;
    try {
      const doc = await openPdf(file.dataUrl);
      const wanted = parsePageRange(range, doc.numPages) || Array.from({ length: doc.numPages }, (_, i) => i + 1);
      if (!wanted.length) throw new Error('No valid pages in that range.');
      if (wanted.length > OCR_PAGE_CAP) throw new Error(`Pick at most ${OCR_PAGE_CAP} pages at a time (you chose ${wanted.length}). Use a page range such as 1-${OCR_PAGE_CAP}.`);

      // Skip pages that already carry real text, so a second layer is never stacked on the first.
      const todo = [];
      let alreadyText = 0;
      for (const n of wanted) {
        const tc = await (await doc.getPage(n)).getTextContent();
        if (tc.items.map(i => i.str).join('').trim().length > 20) alreadyText++; else todo.push(n);
      }
      if (!todo.length) {
        setNote('Every page you chose already has searchable text, so there was nothing to read.');
        return;
      }

      engine = await createOcrEngine({ lang: 'eng' });
      const pagesOut = [];
      const allText = [];
      for (let i = 0; i < todo.length; i++) {
        if (cancelRef.current) throw new Error('Cancelled.');
        const n = todo[i];
        setProgress(`Page ${n} (${i + 1} of ${todo.length})`);
        startProcessing('Reading the scanned pages…', `Page ${n} (${i + 1} of ${todo.length}) · on your device`);
        const probe = await doc.getPage(n);
        const base = probe.getViewport({ scale: 1 });
        const scale = Math.min(200 / 72, 3200 / Math.max(base.width, base.height));
        const canvas = await renderPage(doc, n, scale);
        const page = await engine.recognize(canvas);
        const words = [];
        for (const line of page.lines) {
          for (const s of line.segs) {
            const t = line.text.slice(s.start, s.end);
            if (t.trim()) words.push({ text: t, x: s.bbox.x, y: s.bbox.y, w: s.bbox.w, h: s.bbox.h });
          }
          allText.push(line.text);
        }
        allText.push('');
        pagesOut.push({ page: n, canvasWidth: canvas.width, canvasHeight: canvas.height, words });
        canvas.width = canvas.height = 0;
      }
      if (!pagesOut.some(p => p.words.length)) throw new Error('No text could be read. The scan may be too faint or blurry.');

      const res = await api.post('/api/pdf/ocr-layer', { dataUrl: file.dataUrl, pages: pagesOut });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not add the text layer.');
      setText(allText.join('\n').trim());
      setNote(`${data.words} words read on ${data.pagesDone} page${data.pagesDone !== 1 ? 's' : ''}${alreadyText ? ` · ${alreadyText} page${alreadyText !== 1 ? 's' : ''} already had text and were skipped` : ''}.`);
      setResultModal({
        dataUrl: data.dataUrl,
        filename: `${baseName(file)}-searchable.pdf`,
        meta: `${data.words} words made searchable · looks identical, text is now selectable`,
      });
    } catch (err) {
      setError(err.message || 'OCR failed.');
    } finally {
      try { await engine?.terminate(); } catch { /* worker already gone */ }
      stopProcessing(); setBusy(false); setProgress('');
    }
  };

  return (
    <section>
      <ToolHeader id="ocr" label="OCR (Searchable PDF)" onHelp={onHelp} getIcon={getIcon} badge="On your device" />
      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <Tooltip text="Upload a scanned PDF (pictures of pages) to make its text searchable and selectable.">
            <div><PdfUpload onChange={onChange} files={file ? [file] : []} onRemove={() => { setFile(null); setText(''); setNote(''); }} /></div>
          </Tooltip>
          <div className="mt-3">
            <PageRangeField value={range} onChange={setRange} max={file?.pageCount}
              tip={`Which pages to read. Up to ${OCR_PAGE_CAP} at a time; reading takes a few seconds per page.`} />
          </div>
          <p className="text-xs mt-2" style={muted}>English text only. Reading happens in your browser, so the pages are not uploaded for recognition. Good for search and copy, not a guaranteed-exact transcript.</p>
          <ErrMsg msg={error} />
          {note && <p className="text-xs mt-2" style={{ color: 'var(--color-text)' }}>{note}</p>}
          <RunBtn onClick={run} busy={busy} disabled={!file} label={busy && progress ? progress : 'Make searchable'} getIcon={getIcon} />
          {busy && (
            <Tooltip text="Stop after the page being read now. Nothing is saved.">
              <button type="button" onClick={() => { cancelRef.current = true; }} className="mt-2 text-xs underline hover:opacity-70 transition-opacity" style={muted}>Cancel</button>
            </Tooltip>
          )}
          {text && (
            <div className="mt-4 rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Text that was read</span>
                <Tooltip text="Copy the recognised text to your clipboard.">
                  <button type="button" onClick={() => navigator.clipboard.writeText(text)} className="text-xs hover:opacity-60 transition-opacity" style={{ color: 'var(--color-primary)' }}>Copy</button>
                </Tooltip>
              </div>
              <textarea readOnly value={text} className="w-full text-xs p-3 resize-none outline-none" style={{ height: 200, background: 'var(--color-bg)', color: 'var(--color-text)' }} />
            </div>
          )}
        </div>
        <div><PdfPagePreview dataUrl={file?.dataUrl} /></div>
      </div>
    </section>
  );
}

// ═══ Remove blank pages ═══════════════════════════════════════════════════════
// A page is "blank" when under `threshold` % of its pixels are darker than near-white.
async function inkPercentages(dataUrl, onProgress) {
  const doc = await openPdf(dataUrl);
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const canvas = await renderPage(doc, n, 0.5);
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) ink++;
    out.push({ n, ink: (ink / (data.length / 4)) * 100, thumb: canvas.toDataURL('image/png') });
    onProgress?.(n, doc.numPages);
  }
  return out;
}

export function RemoveBlankTool({ getIcon, onHelp, setResultModal }) {
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [file, setFile, onChange] = usePdfFile(() => { setPages([]); setError(''); setPicked(null); });
  const [pages, setPages] = useState([]);
  const [threshold, setThreshold] = useState(0.2);
  const [picked, setPicked] = useState(null); // Set of page numbers to remove (null = follow the slider)
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) return;
    let live = true;
    setLoading(true); setPages([]);
    inkPercentages(file.dataUrl)
      .then(p => { if (live) setPages(p); })
      .catch(err => { if (live) setError(err.message || 'Could not read the pages.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [file]);

  const auto = new Set(pages.filter(p => p.ink < threshold).map(p => p.n));
  const removing = picked || auto;
  const toggle = (n) => {
    const next = new Set(removing);
    if (next.has(n)) next.delete(n); else next.add(n);
    setPicked(next);
  };

  const run = async () => {
    const keep = pages.filter(p => !removing.has(p.n)).map(p => ({ source: 'primary', index: p.n - 1 }));
    if (!keep.length) { setError('That would remove every page.'); return; }
    setBusy(true); setError('');
    startProcessing('Removing pages…', file.name);
    try {
      const res = await api.post('/api/pdf/organize', { dataUrl: file.dataUrl, pages: keep });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not remove the pages.');
      setResultModal({ dataUrl: data.dataUrl, filename: `${baseName(file)}-no-blanks.pdf`, meta: `${removing.size} page${removing.size !== 1 ? 's' : ''} removed · ${data.pageCount} left` });
    } catch (err) {
      setError(err.message || 'Could not remove the pages.');
    } finally {
      stopProcessing(); setBusy(false);
    }
  };

  return (
    <section>
      <ToolHeader id="removeblank" label="Remove Blank Pages" onHelp={onHelp} getIcon={getIcon}
        badge={pages.length ? `${removing.size} of ${pages.length} marked` : undefined} />
      {!file ? (
        <Tooltip text="Upload a PDF to find and remove blank pages, such as the empty backs of scanned sheets.">
          <div><PdfUpload onChange={onChange} /></div>
        </Tooltip>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs truncate mr-2" style={muted}>{file.name} · {file.pageCount} pages</p>
            <button type="button" onClick={() => { setFile(null); setPages([]); setPicked(null); }} className="text-xs underline hover:opacity-70 transition-opacity" style={muted}>Change file</button>
          </div>
          <div className="mb-3 max-w-sm">
            <label className={lbl} style={muted}>Strictness — pages with under {threshold.toFixed(1)}% ink count as blank</label>
            <Tooltip text="Raise this to also catch pages with a little noise, such as scanner specks. Lower it to be sure only truly empty pages go. You can still click any page to override.">
              <input type="range" min={0.05} max={3} step={0.05} value={threshold} onChange={e => { setThreshold(Number(e.target.value)); setPicked(null); }} className="w-full" />
            </Tooltip>
          </div>
          {loading && <p className="text-xs mb-3" style={muted}>Checking pages…</p>}
          <div className="grid gap-3 mb-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
            {pages.map(p => {
              const marked = removing.has(p.n);
              return (
                <Tooltip key={p.n} text={marked ? 'Marked for removal. Click to keep it.' : 'Kept. Click to remove it.'}>
                  <button
                    type="button"
                    onClick={() => toggle(p.n)}
                    className="rounded-lg border overflow-hidden relative text-left transition-opacity"
                    style={{ borderColor: marked ? '#ef4444' : 'var(--color-border)', borderWidth: marked ? 2 : 1, background: '#fff', opacity: marked ? 0.55 : 1 }}
                  >
                    <img src={p.thumb} alt={`Page ${p.n}`} className="w-full block" />
                    <span className="absolute top-1 left-1 text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>{p.n}</span>
                    <span className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: marked ? '#ef4444' : 'var(--color-muted)' }}>
                      {marked ? 'Remove' : `${p.ink.toFixed(1)}% ink`}
                    </span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
          <ErrMsg msg={error} />
          <RunBtn onClick={run} busy={busy} disabled={!pages.length || !removing.size} label={`Remove ${removing.size} page${removing.size !== 1 ? 's' : ''}`} getIcon={getIcon} />
        </div>
      )}
    </section>
  );
}

// ═══ Crop ═════════════════════════════════════════════════════════════════════
export function CropTool({ getIcon, onHelp, setResultModal }) {
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [file, setFile, onChange] = usePdfFile(() => { setError(''); });
  const [m, setM] = useState({ top: 0, right: 0, bottom: 0, left: 0 });
  const [range, setRange] = useState('all');
  const [thumb, setThumb] = useState(null); // { src, wMm, hMm }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) { setThumb(null); return; }
    let live = true;
    (async () => {
      try {
        const doc = await openPdf(file.dataUrl);
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 }); // visual size, rotation applied
        const canvas = await renderPage(doc, 1, 360 / base.width);
        if (live) setThumb({ src: canvas.toDataURL('image/png'), wMm: base.width * 25.4 / 72, hMm: base.height * 25.4 / 72 });
      } catch { if (live) setThumb(null); }
    })();
    return () => { live = false; };
  }, [file]);

  const set = (k) => (e) => setM(prev => ({ ...prev, [k]: Math.max(0, Number(e.target.value) || 0) }));
  const pct = (mm, total) => (thumb ? Math.min(49, (mm / total) * 100) : 0);

  const run = async () => {
    setBusy(true); setError('');
    startProcessing('Cropping…', file.name);
    try {
      const res = await api.post('/api/pdf/crop', { dataUrl: file.dataUrl, marginsMm: m, pages: range });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Crop failed.');
      setResultModal({ dataUrl: data.dataUrl, filename: `${baseName(file)}-cropped.pdf`, meta: `${data.cropped} page${data.cropped !== 1 ? 's' : ''} cropped` });
    } catch (err) {
      setError(err.message || 'Crop failed.');
    } finally {
      stopProcessing(); setBusy(false);
    }
  };

  const field = (k, label, tip) => (
    <div>
      <label className={lbl} style={muted}>{label} (mm)</label>
      <Tooltip text={tip}>
        <input type="number" min={0} step={1} className={inp} style={inpStyle} value={m[k] || ''} onChange={set(k)} placeholder="0" />
      </Tooltip>
    </div>
  );

  return (
    <section>
      <ToolHeader id="crop" label="Crop Pages" onHelp={onHelp} getIcon={getIcon} />
      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <Tooltip text="Upload the PDF whose margins you want to trim.">
            <div><PdfUpload onChange={onChange} files={file ? [file] : []} onRemove={() => setFile(null)} /></div>
          </Tooltip>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {field('top', 'Top', 'How much to trim off the top edge of each page.')}
              {field('bottom', 'Bottom', 'How much to trim off the bottom edge.')}
              {field('left', 'Left', 'How much to trim off the left edge.')}
              {field('right', 'Right', 'How much to trim off the right edge.')}
            </div>
            <PageRangeField value={range} onChange={setRange} max={file?.pageCount} tip="Which pages to crop. Leave as all, or type a range such as 1-3,5." />
          </div>
          <ErrMsg msg={error} />
          <RunBtn onClick={run} busy={busy} disabled={!file || !Object.values(m).some(v => v > 0)} label="Crop" getIcon={getIcon} />
        </div>
        <div>
          {thumb ? (
            <div>
              <p className="text-xs mb-1.5" style={muted}>Page 1 preview. The shaded edges are removed.</p>
              <div className="relative inline-block border" style={{ borderColor: 'var(--color-border)', lineHeight: 0 }}>
                <img src={thumb.src} alt="Page 1" style={{ maxWidth: '100%', width: 360 }} />
                {[
                  { top: 0, left: 0, right: 0, height: `${pct(m.top, thumb.hMm)}%` },
                  { bottom: 0, left: 0, right: 0, height: `${pct(m.bottom, thumb.hMm)}%` },
                  { top: 0, bottom: 0, left: 0, width: `${pct(m.left, thumb.wMm)}%` },
                  { top: 0, bottom: 0, right: 0, width: `${pct(m.right, thumb.wMm)}%` },
                ].map((s, i) => <div key={i} className="absolute pointer-events-none" style={{ ...s, background: 'rgba(239,68,68,0.35)' }} />)}
              </div>
              <p className="text-xs mt-1.5" style={muted}>{Math.round(thumb.wMm)} × {Math.round(thumb.hMm)} mm</p>
            </div>
          ) : <PdfPagePreview dataUrl={file?.dataUrl} />}
        </div>
      </div>
    </section>
  );
}

// ═══ Header & footer ══════════════════════════════════════════════════════════
export function HeaderFooterTool({ getIcon, onHelp, setResultModal }) {
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [file, setFile, onChange] = usePdfFile(() => setError(''));
  const [hf, setHf] = useState({ header: { left: '', center: '', right: '' }, footer: { left: '', center: '', right: '' } });
  const [fontSize, setFontSize] = useState(10);
  const [marginMm, setMarginMm] = useState(10);
  const [startAt, setStartAt] = useState(1);
  const [range, setRange] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setCell = (row, pos) => (e) => setHf(prev => ({ ...prev, [row]: { ...prev[row], [pos]: e.target.value } }));
  const any = ['header', 'footer'].some(r => Object.values(hf[r]).some(v => v.trim()));

  const run = async () => {
    setBusy(true); setError('');
    startProcessing('Adding header and footer…', file.name);
    try {
      const res = await api.post('/api/pdf/headerfooter', { dataUrl: file.dataUrl, ...hf, fontSize, marginMm, startAt, pages: range, filename: file.name });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not add the text.');
      setResultModal({ dataUrl: data.dataUrl, filename: `${baseName(file)}-hf.pdf`, meta: `${data.stamped} page${data.stamped !== 1 ? 's' : ''} stamped` });
    } catch (err) {
      setError(err.message || 'Could not add the text.');
    } finally {
      stopProcessing(); setBusy(false);
    }
  };

  const row = (key, title) => (
    <div>
      <p className="text-xs font-medium mb-1" style={muted}>{title}</p>
      <div className="grid grid-cols-3 gap-2">
        {['left', 'center', 'right'].map(pos => (
          <Tooltip key={pos} text={`Text printed at the ${pos} of the ${title.toLowerCase()} on each page.`}>
            <input type="text" className={inp} style={inpStyle} value={hf[key][pos]} onChange={setCell(key, pos)} placeholder={pos === 'left' ? 'Left' : pos === 'center' ? 'Centre' : 'Right'} />
          </Tooltip>
        ))}
      </div>
    </div>
  );

  return (
    <section>
      <ToolHeader id="headerfooter" label="Header & Footer" onHelp={onHelp} getIcon={getIcon} />
      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <Tooltip text="Upload the PDF to add a running header and footer to.">
            <div><PdfUpload onChange={onChange} files={file ? [file] : []} onRemove={() => setFile(null)} /></div>
          </Tooltip>
          <div className="mt-3 space-y-3">
            {row('header', 'Header')}
            {row('footer', 'Footer')}
            <p className="text-xs" style={muted}>Type <code>{'{n}'}</code> for the page number, <code>{'{total}'}</code> for the page count, <code>{'{date}'}</code> for today's date and <code>{'{filename}'}</code> for the file name.</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={lbl} style={muted}>Font size — {fontSize}pt</label>
                <Tooltip text="How large the text is.">
                  <input type="range" min={6} max={24} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="w-full mt-2" />
                </Tooltip>
              </div>
              <div>
                <label className={lbl} style={muted}>Edge gap (mm)</label>
                <Tooltip text="Distance from the page edge to the text.">
                  <input type="number" min={5} max={50} className={inp} style={inpStyle} value={marginMm} onChange={e => setMarginMm(Math.max(5, Number(e.target.value) || 10))} />
                </Tooltip>
              </div>
              <div>
                <label className={lbl} style={muted}>Start at</label>
                <Tooltip text="The number {n} shows on the first page.">
                  <input type="number" min={1} className={inp} style={inpStyle} value={startAt} onChange={e => setStartAt(Math.max(1, Number(e.target.value) || 1))} />
                </Tooltip>
              </div>
            </div>
            <PageRangeField value={range} onChange={setRange} max={file?.pageCount} />
          </div>
          <ErrMsg msg={error} />
          <RunBtn onClick={run} busy={busy} disabled={!file || !any} label="Add header & footer" getIcon={getIcon} />
        </div>
        <div><PdfPagePreview dataUrl={file?.dataUrl} /></div>
      </div>
    </section>
  );
}

// ═══ N-up ═════════════════════════════════════════════════════════════════════
export function NupTool({ getIcon, onHelp, setResultModal }) {
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [file, setFile, onChange] = usePdfFile(() => setError(''));
  const [perSheet, setPerSheet] = useState(2);
  const [sheet, setSheet] = useState('A4');
  const [orientation, setOrientation] = useState('auto');
  const [gapMm, setGapMm] = useState(4);
  const [border, setBorder] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setBusy(true); setError('');
    startProcessing('Putting pages on sheets…', file.name);
    try {
      const res = await api.post('/api/pdf/nup', {
        dataUrl: file.dataUrl, perSheet, sheet, gapMm, border,
        landscape: orientation === 'auto' ? undefined : orientation === 'landscape',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not combine the pages.');
      setResultModal({ dataUrl: data.dataUrl, filename: `${baseName(file)}-${perSheet}up.pdf`, meta: `${data.pageCount} pages on ${data.sheets} sheet${data.sheets !== 1 ? 's' : ''}` });
    } catch (err) {
      setError(err.message || 'Could not combine the pages.');
    } finally {
      stopProcessing(); setBusy(false);
    }
  };

  return (
    <section>
      <ToolHeader id="nup" label="Pages per Sheet (N-up)" onHelp={onHelp} getIcon={getIcon} />
      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <Tooltip text="Upload the PDF to shrink several pages onto each sheet, handy for printing handouts.">
            <div><PdfUpload onChange={onChange} files={file ? [file] : []} onRemove={() => setFile(null)} /></div>
          </Tooltip>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={lbl} style={muted}>Pages per sheet</label>
                <Tooltip text="How many original pages share one sheet.">
                  <select className={inp} style={inpStyle} value={perSheet} onChange={e => setPerSheet(Number(e.target.value))}>
                    {[2, 4, 6, 9].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </Tooltip>
              </div>
              <div>
                <label className={lbl} style={muted}>Sheet size</label>
                <Tooltip text="The paper size of the new pages.">
                  <select className={inp} style={inpStyle} value={sheet} onChange={e => setSheet(e.target.value)}>
                    <option value="A4">A4</option>
                    <option value="Letter">Letter</option>
                  </select>
                </Tooltip>
              </div>
              <div>
                <label className={lbl} style={muted}>Orientation</label>
                <Tooltip text="Automatic picks the best fit: landscape for 2 or 6 per sheet, portrait for 4 or 9.">
                  <select className={inp} style={inpStyle} value={orientation} onChange={e => setOrientation(e.target.value)}>
                    <option value="auto">Automatic</option>
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </Tooltip>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <label className={lbl} style={muted}>Gap (mm)</label>
                <Tooltip text="Space between pages and around the edge of the sheet.">
                  <input type="number" min={0} max={30} className={inp} style={inpStyle} value={gapMm} onChange={e => setGapMm(Math.max(0, Number(e.target.value) || 0))} />
                </Tooltip>
              </div>
              <Tooltip text="Draw a thin line around each page so the edges show.">
                <label className="flex items-center gap-2 text-sm pb-2" style={{ color: 'var(--color-text)' }}>
                  <input type="checkbox" checked={border} onChange={e => setBorder(e.target.checked)} /> Border around pages
                </label>
              </Tooltip>
            </div>
          </div>
          <ErrMsg msg={error} />
          <RunBtn onClick={run} busy={busy} disabled={!file} label="Combine pages" getIcon={getIcon} />
        </div>
        <div><PdfPagePreview dataUrl={file?.dataUrl} /></div>
      </div>
    </section>
  );
}
