import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useEffect } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useUrlImport, readFileAsDataUrl, useProcessingWhile, UrlImportRow, loadImageInto, renderExport, formatCost, ResultPlaceholder, CostNote } from '../shared';

export default function BackgroundTool({ active }) {
  const getIcon = useIcon();
  const { handoff, renderCompareToggle, renderResultMedia, renderSendTo, setHelpTool, status } = useGraphics();
  const { urlImporting, importFromUrl } = useUrlImport();
  const isHostedProvider = status?.hosted || (status?.provider && status.provider !== 'local-comfyui');

  const [bgSource, setBgSource] = useState(null);
  const [bgMode, setBgMode] = useState('transparent');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [bgColor2, setBgColor2] = useState('#2563eb');
  const [bgGradientDir, setBgGradientDir] = useState('to-bottom');
  const [bgImage, setBgImage] = useState(null);
  const [bgProcessing, setBgProcessing] = useState(false);
  const [bgResult, setBgResult] = useState(null);
  const [bgError, setBgError] = useState('');

  const handleBgFile = async (file) => {
    if (!file) return;
    setBgError('');
    setBgResult(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setBgSource({ imageDataUrl: dataUrl, name: file.name });
    } catch {
      setBgError('Could not read that image file.');
    }
  };

  const runRemoveBg = async () => {
    if (!bgSource?.imageDataUrl) return;
    if (bgMode === 'image' && !bgImage?.imageDataUrl) { setBgError('Choose a background image'); return; }
    setBgProcessing(true);
    setBgError('');
    try {
      const body = {
        imageDataUrl: bgSource.imageDataUrl,
        background: bgMode === 'color' ? bgColor : 'transparent',
      };
      if (bgMode === 'image') body.backgroundImageDataUrl = bgImage.imageDataUrl;
      if (bgMode === 'gradient') body.gradient = { from: bgColor, to: bgColor2, direction: bgGradientDir };
      const res = await api.post('/api/graphics/background', body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Background change failed');
      setBgResult(data);
    } catch (err) {
      setBgError(err.message || 'Background change failed');
    } finally {
      setBgProcessing(false);
    }
  };

  const downloadBg = () => {
    if (!bgResult?.imageDataUrl) return;
    const a = document.createElement('a');
    a.href = bgResult.imageDataUrl;
    a.download = `background-${Date.now()}.png`;
    a.click();
  };

  // An image sent here from another tool (or from Ask Graphics) arrives as ctx.handoff; take it once.
  const handoffSeen = useRef(0);
  useEffect(() => {
    if (!handoff || handoff.mode !== 'background' || handoff.nonce === handoffSeen.current) return;
    handoffSeen.current = handoff.nonce;
    const src = handoff.src;
    setBgResult(null); setBgError(''); setBgSource(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  useProcessingWhile(bgProcessing ? 'Updating background…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Remove / replace background</h2>
            <button type="button" onClick={() => setHelpTool('background')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{status?.provider === 'local-comfyui' || !isHostedProvider ? 'Local AI' : 'Replicate'}</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              AI cut-out of the foreground subject. Leave the background transparent (PNG) or flatten it onto a solid colour.
            </p>
            <div className="space-y-2">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image whose background you want to remove or replace."><input
                type="file"
                accept="image/*"
                onChange={e => handleBgFile(e.target.files?.[0])}
                className="block w-full text-xs"
                style={{ color: 'var(--color-text)' }}
              /></Tooltip>
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setBgError(err); } else { setBgResult(null); setBgError(''); setBgSource(src); } })} />
            </div>

            {bgSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={bgSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
                <p className="text-[11px] mt-1 text-center" style={{ color: 'var(--color-muted)' }}>{bgSource.name}</p>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Background</label>
              <div className="flex items-center gap-3">
                <Tooltip text="What to put behind the cut-out subject once the background is removed."><select
                  value={bgMode}
                  onChange={e => setBgMode(e.target.value)}
                  className="px-3 py-2 rounded-xl border text-sm"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  <option value="transparent">Transparent</option>
                  <option value="color">Solid colour</option>
                  <option value="gradient">Blended colours</option>
                  <option value="image">Image</option>
                </select></Tooltip>
                {bgMode === 'color' && (
                  <>
                    <Tooltip text="Pick the solid background colour."><input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                    <Tooltip text="Type the background colour as a hex code."><input
                      type="text"
                      value={bgColor}
                      onChange={e => setBgColor(e.target.value)}
                      className="w-24 px-2 py-2 rounded-xl border text-sm"
                      style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    /></Tooltip>
                  </>
                )}
              </div>
              {bgMode === 'gradient' && (
                <div className="mt-3 space-y-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>From</span>
                      <Tooltip text="Starting colour of the background gradient."><input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>To</span>
                      <Tooltip text="Ending colour of the background gradient."><input type="color" value={bgColor2} onChange={e => setBgColor2(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                    </div>
                    <Tooltip text="Direction the gradient blends between the two colours."><select
                      value={bgGradientDir}
                      onChange={e => setBgGradientDir(e.target.value)}
                      className="px-3 py-2 rounded-xl border text-sm"
                      style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    >
                      <option value="to-bottom">Top → bottom</option>
                      <option value="to-top">Bottom → top</option>
                      <option value="to-right">Left → right</option>
                      <option value="to-left">Right → left</option>
                      <option value="to-bottom-right">Diagonal ↘</option>
                      <option value="to-bottom-left">Diagonal ↙</option>
                      <option value="radial">Radial</option>
                    </select></Tooltip>
                  </div>
                  <div
                    className="h-12 rounded-xl border"
                    style={{
                      borderColor: 'var(--color-border)',
                      background: bgGradientDir === 'radial'
                        ? `radial-gradient(circle, ${bgColor}, ${bgColor2})`
                        : `linear-gradient(${{ 'to-bottom': 'to bottom', 'to-top': 'to top', 'to-right': 'to right', 'to-left': 'to left', 'to-bottom-right': 'to bottom right', 'to-bottom-left': 'to bottom left' }[bgGradientDir]}, ${bgColor}, ${bgColor2})`,
                    }}
                  />
                </div>
              )}
              {bgMode === 'image' && (
                <div className="mt-2 space-y-2">
                  <Tooltip text="Choose the image to use as the new background, scaled to cover the subject."><input type="file" accept="image/*" onChange={e => { setBgError(''); loadImageInto(setBgImage)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
                  {bgImage?.imageDataUrl && (
                    <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                      <img src={bgImage.imageDataUrl} alt="background" className="max-h-28 mx-auto rounded-lg" />
                      <p className="text-[11px] mt-1 text-center" style={{ color: 'var(--color-muted)' }}>Background — scaled to cover the subject</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {bgError && (
              <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{bgError}</div>
            )}

            <CostNote tool="background" refreshKey={bgResult} />
            <Tooltip text="Cut out the subject and apply the chosen background."><button
              type="button"
              onClick={runRemoveBg}
              disabled={bgProcessing || !bgSource?.imageDataUrl}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2"
              style={{ background: 'var(--color-primary)' }}
            >
              {bgProcessing ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon(bgMode === 'transparent' ? 'scissors' : 'refresh-cw', { size: 15 })}
              {bgProcessing
                ? (bgMode === 'transparent' ? 'Removing...' : 'Updating...')
                : (bgMode === 'transparent' ? 'Remove background' : 'Update background')}
            </button></Tooltip>
          </div>

          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {bgResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(bgSource?.imageDataUrl, bgResult?.imageDataUrl)}
                  {renderSendTo(bgResult.imageDataUrl, 'cutout.png', 'background')}
                  {renderExport(bgResult.imageDataUrl, 'cutout')}
                  <Tooltip text="Save this cut-out image to your device."><button onClick={downloadBg} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button></Tooltip>
                </div>
              )}
            </div>
            <div className="p-4">
              {bgResult?.imageDataUrl ? (
                <>
                  {renderResultMedia(bgSource?.imageDataUrl, bgResult, { transparent: true, alt: 'result' })}
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
                    {bgResult.background === 'transparent' ? 'Transparent PNG' : `Background ${bgResult.background}`}
                    {bgResult.width && bgResult.height ? ` · ${bgResult.width}×${bgResult.height}` : ''}
                  </p>
                  {bgResult.cost && (
                    <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{formatCost(bgResult.cost)}</p>
                  )}
                </>
              ) : (
                <ResultPlaceholder src={bgSource?.imageDataUrl} message="Your cut-out image will appear here." />
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
