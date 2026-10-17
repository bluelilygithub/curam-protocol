import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import { createOcrEngine } from '../../../utils/ocrEngine';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useProcessingWhile, loadImageInto } from '../shared';

export default function ExtractTextTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool } = useGraphics();

  const [ocrSource, setOcrSource] = useState(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrText, setOcrText] = useState('');
  const [ocrError, setOcrError] = useState('');
  const [ocrCopied, setOcrCopied] = useState(false);

  const runOcr = async () => {
    if (!ocrSource?.imageDataUrl) return;
    setOcrBusy(true);
    setOcrError('');
    setOcrText('');
    setOcrProgress(0);
    let engine = null;
    try {
      // The shared on-device reader: its worker and English data are served from our own origin, because the
      // site's Content Security Policy blocks the CDN that tesseract.js uses by default.
      engine = await createOcrEngine({ lang: 'eng' });
      const page = await engine.recognize(ocrSource.imageDataUrl, { onProgress: (p) => setOcrProgress(Math.round(p * 100)) });
      const text = page.lines.map((l) => l.text).join('\n').trim();
      setOcrText(text);
      if (!text) setOcrError('No readable text was found in this image.');
    } catch (err) {
      setOcrError(err.message || 'Text extraction failed');
    } finally {
      if (engine) engine.terminate().catch(() => {});
      setOcrBusy(false);
    }
  };

  const copyOcr = () => {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(ocrText).catch(() => {});
    setOcrCopied(true);
    setTimeout(() => setOcrCopied(false), 1500);
  };

  const downloadOcr = () => {
    const blob = new Blob([ocrText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `extracted-text-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useProcessingWhile(ocrBusy ? 'Extracting text…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Extract text (OCR)</h2>
            <button type="button" onClick={() => setHelpTool('ocr')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the screenshot, scan or photo to read text from."><input type="file" accept="image/*" onChange={e => { setOcrText(''); setOcrError(''); loadImageInto(setOcrSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
            </div>
            {ocrSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={ocrSource.imageDataUrl} alt="source" className="max-h-56 mx-auto rounded-lg" />
              </div>
            )}
            <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Reads English text, on this device. The picture is not uploaded. The first run loads the reader (a few MB).</p>
            {ocrError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{ocrError}</div>}
            <Tooltip text="Read the text out of the image."><button type="button" onClick={runOcr} disabled={ocrBusy || !ocrSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {ocrBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('type', { size: 15 })}
              {ocrBusy ? (ocrProgress ? `Reading... ${ocrProgress}%` : 'Loading...') : 'Extract text'}
            </button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden flex flex-col" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Extracted text</span>
              {ocrText && (
                <div className="flex gap-2">
                  <Tooltip text="Copy the extracted text to your clipboard."><button onClick={copyOcr} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>{ocrCopied ? 'Copied' : 'Copy'}</button></Tooltip>
                  <Tooltip text="Save the extracted text as a .txt file."><button onClick={downloadOcr} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>.txt</button></Tooltip>
                </div>
              )}
            </div>
            <div className="p-4 grow">
              <Tooltip text="Extracted text — you can edit it here before copying or downloading."><textarea value={ocrText} onChange={e => setOcrText(e.target.value)} placeholder="Extracted text will appear here. You can edit it before copying." className="w-full h-72 px-3 py-2 rounded-xl border text-sm resize-none" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
