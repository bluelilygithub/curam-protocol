import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useEffect } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useUrlImport, CONVERT_FALLBACK_FORMATS, readFileAsDataUrl, useProcessingWhile, UrlImportRow, renderExport, formatBytes, ResultPlaceholder } from '../shared';

export default function ConvertTool({ active }) {
  const getIcon = useIcon();
  const { handoff, renderCompareToggle, renderResultMedia, renderSendTo, result, setHelpTool } = useGraphics();
  const { urlImporting, importFromUrl } = useUrlImport();

  const [convertFormats, setConvertFormats] = useState(CONVERT_FALLBACK_FORMATS);
  const [convertSource, setConvertSource] = useState(null);
  const [convertFormat, setConvertFormat] = useState('png');
  const [convertQuality, setConvertQuality] = useState('90');
  const [converting, setConverting] = useState(false);
  const [convertResult, setConvertResult] = useState(null);
  const [convertError, setConvertError] = useState('');

  const activeConvertFormat = convertFormats.find(f => f.id === convertFormat);

  const handleConvertFile = async (file) => {
    if (!file) return;
    setConvertError('');
    setConvertResult(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setConvertSource({ imageDataUrl: dataUrl, name: file.name });
    } catch {
      setConvertError('Could not read that image file.');
    }
  };

  const useResultForConvert = () => {
    if (!result?.imageDataUrl) return;
    setConvertError('');
    setConvertResult(null);
    setConvertSource({ imageDataUrl: result.imageDataUrl, name: 'current result' });
  };

  const runConvert = async () => {
    if (!convertSource?.imageDataUrl) return;
    setConverting(true);
    setConvertError('');
    try {
      const res = await api.post('/api/graphics/convert', {
        imageDataUrl: convertSource.imageDataUrl,
        format: convertFormat,
        quality: Number(convertQuality),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Conversion failed');
      setConvertResult(data);
    } catch (err) {
      setConvertError(err.message || 'Conversion failed');
    } finally {
      setConverting(false);
    }
  };

  const downloadConverted = () => {
    if (!convertResult?.imageDataUrl) return;
    const a = document.createElement('a');
    a.href = convertResult.imageDataUrl;
    a.download = `converted-${Date.now()}.${convertResult.ext || 'img'}`;
    a.click();
  };

  // An image sent here from another tool (or from Ask Graphics) arrives as ctx.handoff; take it once.
  const handoffSeen = useRef(0);
  useEffect(() => {
    if (!handoff || handoff.mode !== 'convert' || handoff.nonce === handoffSeen.current) return;
    handoffSeen.current = handoff.nonce;
    const src = handoff.src;
    setConvertResult(null); setConvertError(''); setConvertSource(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  useEffect(() => {
    api.get('/api/graphics/convert/info')
      .then(r => r.json())
      .then(info => {
        if (Array.isArray(info?.formats) && info.formats.length) setConvertFormats(info.formats);
      })
      .catch(() => {});
  }, []);

  useProcessingWhile(converting ? 'Converting…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Convert format</h2>
            <button type="button" onClick={() => setHelpTool('convert')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Convert an image to another format — PNG, JPG, WebP, GIF, AVIF, TIFF or a multi-size ICO. HEIC/HEIF uploads work where the server supports them. Pixels are preserved; only the container changes.
            </p>
            <div className="space-y-2">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image file to convert."><input
                type="file"
                accept="image/*,.heic,.heif"
                onChange={e => handleConvertFile(e.target.files?.[0])}
                className="block w-full text-xs"
                style={{ color: 'var(--color-text)' }}
              /></Tooltip>
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setConvertError(err); } else { setConvertResult(null); setConvertError(''); setConvertSource(src); } })} />
              {result?.imageDataUrl && (
                <Tooltip text="Use the image just generated on the Generate tab as the source to convert."><button
                  type="button"
                  onClick={useResultForConvert}
                  className="mt-1 text-xs px-2 py-1 rounded-lg border hover:opacity-70"
                  style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                >
                  Use current result
                </button></Tooltip>
              )}
            </div>

            {convertSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={convertSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
                <p className="text-[11px] mt-1 text-center" style={{ color: 'var(--color-muted)' }}>{convertSource.name}</p>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Convert to</label>
                <Tooltip text="File format the converted image will be saved as."><select
                  value={convertFormat}
                  onChange={e => setConvertFormat(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border text-sm"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {convertFormats.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select></Tooltip>
              </div>
              {activeConvertFormat?.lossy && (
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Quality</label>
                  <Tooltip text="Compression level for this format — lower gives a smaller file but reduces image quality."><select
                    value={convertQuality}
                    onChange={e => setConvertQuality(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border text-sm"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    <option value="100">Maximum (100)</option>
                    <option value="90">High (90)</option>
                    <option value="80">Balanced (80)</option>
                    <option value="60">Smaller file (60)</option>
                  </select></Tooltip>
                </div>
              )}
            </div>

            {convertError && (
              <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>
                {convertError}
              </div>
            )}

            <Tooltip text="Convert the image with the settings above."><button
              type="button"
              onClick={runConvert}
              disabled={converting || !convertSource?.imageDataUrl}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2"
              style={{ background: 'var(--color-primary)' }}
            >
              {converting ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('refresh-cw', { size: 15 })}
              {converting ? 'Converting...' : 'Convert image'}
            </button></Tooltip>
          </div>

          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Converted result</span>
              {convertResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(convertSource?.imageDataUrl, convertResult?.imageDataUrl)}
                  {renderSendTo(convertResult.imageDataUrl, `converted.${convertResult.format || 'png'}`, 'convert')}
                  {renderExport(convertResult.imageDataUrl, 'converted')}
                  <Tooltip text="Save the converted image to your device."><button
                    onClick={downloadConverted}
                    className="text-xs px-2 py-1 rounded-lg border hover:opacity-70"
                    style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                  >
                    Download
                  </button></Tooltip>
                </div>
              )}
            </div>
            <div className="p-4">
              {convertResult?.imageDataUrl ? (
                <>
                  {renderResultMedia(convertSource?.imageDataUrl, convertResult, { alt: 'converted' })}
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
                    {String(convertResult.format || '').toUpperCase()}
                    {convertResult.width && convertResult.height ? ` · ${convertResult.width}×${convertResult.height}` : ''}
                    {convertResult.quality != null ? ` · quality ${convertResult.quality}` : ''}
                    {convertResult.bytes != null ? ` · ${formatBytes(convertResult.bytes)}` : ''}
                  </p>
                </>
              ) : (
                <ResultPlaceholder src={convertSource?.imageDataUrl} message="Your converted image will appear here." />
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
