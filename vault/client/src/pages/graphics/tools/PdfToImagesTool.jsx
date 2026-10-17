import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { downloadDataUrl, useProcessingWhile } from '../shared';

export default function PdfToImagesTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool, setPreviewImage } = useGraphics();

  const [pdfPages, setPdfPages] = useState([]);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [pdfScale, setPdfScale] = useState('2');
  const [pdfName, setPdfName] = useState('');

  // PDF → images: render each page to a PNG in the browser via pdfjs-dist.
  const handlePdfFile = async (file) => {
    if (!file) return;
    setPdfError('');
    setPdfPages([]);
    setPdfName(file.name?.replace(/\.pdf$/i, '') || 'page');
    setPdfBusy(true);
    try {
      const pdfjsLib = await import('pdfjs-dist');
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
      }
      const buffer = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
      const scale = Math.max(1, Math.min(4, Number(pdfScale) || 2));
      const pages = [];
      for (let n = 1; n <= doc.numPages; n += 1) {
        // eslint-disable-next-line no-await-in-loop
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // eslint-disable-next-line no-await-in-loop
        await page.render({ canvasContext: ctx, viewport }).promise;
        pages.push({ id: `p${n}`, page: n, dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
        setPdfPages([...pages]);
      }
    } catch (err) {
      setPdfError(err.message || 'Could not read that PDF.');
    } finally {
      setPdfBusy(false);
    }
  };

  const downloadPdfPage = (item) => downloadDataUrl(item.dataUrl, `${pdfName || 'page'}-${item.page}.png`);

  const downloadPdfAll = () => pdfPages.forEach((item, i) => setTimeout(() => downloadPdfPage(item), i * 150));

  useProcessingWhile(pdfBusy ? 'Rendering PDF…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>PDF → Images</h2>
            <button type="button" onClick={() => setHelpTool('pdf2img')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Render each page of a PDF to a PNG in your browser — nothing is uploaded. Higher resolution = larger, sharper images.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>PDF file</label>
              <Tooltip text="Choose the PDF to render into images."><input type="file" accept="application/pdf,.pdf" onChange={e => { const f = e.target.files?.[0]; if (f) handlePdfFile(f); e.target.value = ''; }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Resolution</label>
              <Tooltip text="How large and sharp the rendered page images are — higher takes longer."><select value={pdfScale} onChange={e => setPdfScale(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                <option value="1">Screen (1×)</option>
                <option value="2">High (2×)</option>
                <option value="3">Very high (3×)</option>
                <option value="4">Print (4×)</option>
              </select></Tooltip>
            </div>
          </div>
          {pdfError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{pdfError}</div>}
          {pdfPages.length > 0 && (
            <div className="flex items-center gap-2">
              <Tooltip text="Download every rendered page as separate image files."><button type="button" onClick={downloadPdfAll} className="px-3 py-2 rounded-xl text-sm border hover:opacity-80" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>Download all ({pdfPages.length})</button></Tooltip>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{pdfBusy ? 'Rendering…' : `${pdfPages.length} page${pdfPages.length === 1 ? '' : 's'}`}</span>
            </div>
          )}
          {pdfPages.length === 0 ? (
            <div className="rounded-xl border px-4 py-6 text-sm text-center" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>{pdfBusy ? 'Rendering pages…' : 'Choose a PDF to render its pages.'}</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {pdfPages.map(item => (
                <div key={item.id} className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                  <button type="button" onClick={() => setPreviewImage({ imageDataUrl: item.dataUrl })} className="block w-full"><img src={item.dataUrl} alt={`page ${item.page}`} className="w-full" /></button>
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Page {item.page}</span>
                    <Tooltip text="Download this page as a PNG."><button type="button" onClick={() => downloadPdfPage(item)} className="text-[11px] px-2 py-0.5 rounded border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Save</button></Tooltip>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
