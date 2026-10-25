import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useEffect } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { readFileAsDataUrl, useProcessingWhile, renderExport, formatCost, ResultPlaceholder, CostNote, useImageSize } from '../shared';

export default function UpscaleTool({ active }) {
  const getIcon = useIcon();
  const { handoff, renderCompareToggle, renderResultMedia, renderSendTo, result, setHelpTool } = useGraphics();

  const [upscaleInfo, setUpscaleInfo] = useState(null);
  const [upscaleSource, setUpscaleSource] = useState(null);
  const [upscaleScale, setUpscaleScale] = useState('4');
  const [upscaleModel, setUpscaleModel] = useState('');
  const [upscaleFidelity, setUpscaleFidelity] = useState('-8');
  const [upscaling, setUpscaling] = useState(false);
  const [upscaleResult, setUpscaleResult] = useState(null);
  const [upscaleError, setUpscaleError] = useState('');
  const upscaleSize = useImageSize(upscaleSource?.imageDataUrl);

  const handleUpscaleFile = async (file) => {
    if (!file) return;
    setUpscaleError('');
    setUpscaleResult(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setUpscaleSource({ imageDataUrl: dataUrl, name: file.name });
    } catch {
      setUpscaleError('Could not read that image file.');
    }
  };

  const useResultForUpscale = () => {
    if (!result?.imageDataUrl) return;
    setUpscaleError('');
    setUpscaleResult(null);
    setUpscaleSource({ imageDataUrl: result.imageDataUrl, name: 'current result' });
  };

  const runUpscale = async () => {
    if (!upscaleSource?.imageDataUrl) return;
    setUpscaling(true);
    setUpscaleError('');
    try {
      const res = await api.post('/api/graphics/upscale', {
        imageDataUrl: upscaleSource.imageDataUrl,
        scale: Number(upscaleScale),
        creativity: Number(upscaleFidelity),
        model: upscaleModel || undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upscale failed');
      setUpscaleResult(data);
    } catch (err) {
      setUpscaleError(err.message || 'Upscale failed');
    } finally {
      setUpscaling(false);
    }
  };

  const downloadUpscaled = () => {
    if (!upscaleResult?.imageDataUrl) return;
    const a = document.createElement('a');
    a.href = upscaleResult.imageDataUrl;
    a.download = `upscaled-${upscaleResult.scale || ''}x-${Date.now()}.png`;
    a.click();
  };

  // An image sent here from another tool (or from Ask Graphics) arrives as ctx.handoff; take it once.
  const handoffSeen = useRef(0);
  useEffect(() => {
    if (!handoff || handoff.mode !== 'upscale' || handoff.nonce === handoffSeen.current) return;
    handoffSeen.current = handoff.nonce;
    const src = handoff.src;
    setUpscaleResult(null); setUpscaleError(''); setUpscaleSource(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  // What this server can do (which models and scales); picks the first allowed scale if the default is not offered.
  useEffect(() => {
    api.get('/api/graphics/upscale/info')
      .then(r => r.json())
      .then(info => {
        setUpscaleInfo(info);
        if (Array.isArray(info?.scales) && !info.scales.includes(Number(upscaleScale))) {
          setUpscaleScale(String(info.scales[0]));
        }
        if (info?.model) setUpscaleModel(info.model);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useProcessingWhile(upscaling ? 'Upscaling…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Upscale</h2>
            <button type="button" onClick={() => setHelpTool('upscale')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {upscaleInfo
              ? `${upscaleInfo.provider === 'local-comfyui' ? 'Local' : 'Hosted'}: ${upscaleModel || upscaleInfo.model || 'not configured'}`
              : 'Checking upscaler...'}
          </span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Fidelity-first upscaling for artwork and small images. Detail is preserved, not invented.
            </p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image file to enlarge."><input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={e => handleUpscaleFile(e.target.files?.[0])}
                className="block w-full text-xs"
                style={{ color: 'var(--color-text)' }}
              /></Tooltip>
              {result?.imageDataUrl && (
                <Tooltip text="Use the image just generated on the Generate tab as the source to upscale."><button
                  type="button"
                  onClick={useResultForUpscale}
                  className="mt-2 text-xs px-2 py-1 rounded-lg border hover:opacity-70"
                  style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                >
                  Use current result
                </button></Tooltip>
              )}
            </div>

            {upscaleSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={upscaleSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
                <p className="text-[11px] mt-1 text-center" style={{ color: 'var(--color-muted)' }}>{upscaleSource.name}</p>
              </div>
            )}

            {(upscaleInfo?.models?.length > 1) && (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Model</label>
                <Tooltip text="Which upscaling engine to use — faithful models just sharpen, enhanced models can invent extra detail."><select
                  value={upscaleModel}
                  onChange={e => setUpscaleModel(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border text-sm"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {upscaleInfo.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select></Tooltip>
                <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>
                  Faithful models only sharpen; enhanced models add invented detail.
                </p>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Scale</label>
                <Tooltip text="How many times larger to make the image, e.g. 2x doubles its width and height."><select
                  value={upscaleScale}
                  onChange={e => setUpscaleScale(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border text-sm"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {(upscaleInfo?.scales || [2, 4]).map(s => <option key={s} value={s}>{s}x</option>)}
                </select></Tooltip>
              </div>
              {/clarity/i.test(upscaleModel) && (
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Fidelity</label>
                  <Tooltip text="How closely the result should stick to the original image versus adding invented detail."><select
                    value={upscaleFidelity}
                    onChange={e => setUpscaleFidelity(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border text-sm"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    <option value="-8">Maximum fidelity</option>
                    <option value="0">Balanced</option>
                    <option value="5">Add detail</option>
                  </select></Tooltip>
                </div>
              )}
            </div>

            {upscaleInfo && !upscaleInfo.configured && (
              <div className="text-xs px-3 py-2 rounded-xl" style={{ color: '#92400e', background: '#fef3c7' }}>
                {upscaleInfo.error || 'Upscaler is not configured.'}
              </div>
            )}
            {upscaleError && (
              <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>
                {upscaleError}
              </div>
            )}

            <CostNote tool="upscale" width={upscaleSize?.width} height={upscaleSize?.height} scale={upscaleScale} refreshKey={upscaleResult} />
            <Tooltip text="Run the upscale with the settings above."><button
              type="button"
              onClick={runUpscale}
              disabled={upscaling || !upscaleSource?.imageDataUrl || upscaleInfo?.configured === false}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2"
              style={{ background: 'var(--color-primary)' }}
            >
              {upscaling ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('sparkles', { size: 15 })}
              {upscaling ? 'Upscaling...' : 'Upscale image'}
            </button></Tooltip>
          </div>

          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Upscaled result</span>
              {upscaleResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(upscaleSource?.imageDataUrl, upscaleResult?.imageDataUrl)}
                  {renderSendTo(upscaleResult.imageDataUrl, 'upscaled.png', 'upscale')}
                  {renderExport(upscaleResult.imageDataUrl, 'upscaled')}
                  <Tooltip text="Save the upscaled image to your device."><button
                    onClick={downloadUpscaled}
                    className="text-xs px-2 py-1 rounded-lg border hover:opacity-70"
                    style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                  >
                    Download
                  </button></Tooltip>
                </div>
              )}
            </div>
            <div className="p-4">
              {upscaleResult?.imageDataUrl ? (
                <>
                  {renderResultMedia(upscaleSource?.imageDataUrl, upscaleResult, { alt: 'upscaled' })}
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
                    {upscaleResult.scale}x · {upscaleResult.model}
                  </p>
                  {upscaleResult.cost && (
                    <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                      {formatCost(upscaleResult.cost)}
                    </p>
                  )}
                </>
              ) : (
                <ResultPlaceholder src={upscaleSource?.imageDataUrl} message="Your upscaled image will appear here." />
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
