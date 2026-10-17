import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useEffect } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useUrlImport, useProcessingWhile, loadImageInto, UrlImportRow, renderExport, downloadDataUrl, formatBytes, ResultPlaceholder } from '../shared';

export default function AdjustTool({ active }) {
  const getIcon = useIcon();
  const { handoff, renderCompareToggle, renderResultMedia, renderSendTo, setHelpTool } = useGraphics();
  const { urlImporting, importFromUrl } = useUrlImport();

  const [adjPresets, setAdjPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('graphics.adjustPresets') || '[]'); } catch { return []; }
  });
  const [adjPresetName, setAdjPresetName] = useState('');
  const [adjSource, setAdjSource] = useState(null);
  const [adjBrightness, setAdjBrightness] = useState(1);
  const [adjContrast, setAdjContrast] = useState(1);
  const [adjSaturation, setAdjSaturation] = useState(1);
  const [adjHue, setAdjHue] = useState(0);
  const [adjSharpness, setAdjSharpness] = useState(0);
  const [adjBlackPoint, setAdjBlackPoint] = useState(0);
  const [adjWhitePoint, setAdjWhitePoint] = useState(255);
  const [adjGamma, setAdjGamma] = useState(1);
  const [adjBlur, setAdjBlur] = useState(0);
  const [adjDenoise, setAdjDenoise] = useState(0);
  const [adjTemperature, setAdjTemperature] = useState(0);
  const [adjVignette, setAdjVignette] = useState(0);
  const [adjBusy, setAdjBusy] = useState(false);
  const [adjResult, setAdjResult] = useState(null);
  const [adjError, setAdjError] = useState('');

  // Adjust presets (localStorage).
  const persistAdjPresets = (next) => {
    setAdjPresets(next);
    try { localStorage.setItem('graphics.adjustPresets', JSON.stringify(next)); } catch { /* ignore quota */ }
  };

  const saveAdjPreset = () => {
    const name = adjPresetName.trim();
    if (!name) return;
    const preset = {
      name,
      values: {
        brightness: adjBrightness, contrast: adjContrast, saturation: adjSaturation, hue: adjHue,
        sharpness: adjSharpness, temperature: adjTemperature, vignette: adjVignette,
        blackPoint: adjBlackPoint, whitePoint: adjWhitePoint, gamma: adjGamma, blur: adjBlur, denoise: adjDenoise,
      },
    };
    const next = [...adjPresets.filter(p => p.name !== name), preset];
    persistAdjPresets(next);
    setAdjPresetName('');
  };

  const applyAdjPreset = (name) => {
    const p = adjPresets.find(x => x.name === name);
    if (!p) return;
    const v = p.values;
    setAdjBrightness(v.brightness); setAdjContrast(v.contrast); setAdjSaturation(v.saturation); setAdjHue(v.hue);
    setAdjSharpness(v.sharpness); setAdjTemperature(v.temperature); setAdjVignette(v.vignette);
    setAdjBlackPoint(v.blackPoint ?? 0); setAdjWhitePoint(v.whitePoint ?? 255); setAdjGamma(v.gamma ?? 1); setAdjBlur(v.blur ?? 0); setAdjDenoise(v.denoise ?? 0);
  };

  const deleteAdjPreset = (name) => persistAdjPresets(adjPresets.filter(p => p.name !== name));

  const runAdjust = async () => {
    if (!adjSource?.imageDataUrl) return;
    setAdjBusy(true);
    setAdjError('');
    try {
      const res = await api.post('/api/graphics/adjust', {
        imageDataUrl: adjSource.imageDataUrl,
        brightness: Number(adjBrightness),
        contrast: Number(adjContrast),
        saturation: Number(adjSaturation),
        hue: Number(adjHue),
        sharpness: Number(adjSharpness),
        temperature: Number(adjTemperature),
        vignette: Number(adjVignette),
        blackPoint: Number(adjBlackPoint),
        whitePoint: Number(adjWhitePoint),
        gamma: Number(adjGamma),
        blur: Number(adjBlur),
        denoise: Number(adjDenoise),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Adjust failed');
      setAdjResult(data);
    } catch (err) {
      setAdjError(err.message || 'Adjust failed');
    } finally {
      setAdjBusy(false);
    }
  };

  const resetAdjust = () => {
    setAdjBrightness(1); setAdjContrast(1); setAdjSaturation(1); setAdjHue(0);
    setAdjSharpness(0); setAdjTemperature(0); setAdjVignette(0); setAdjResult(null);
    setAdjBlackPoint(0); setAdjWhitePoint(255); setAdjGamma(1); setAdjBlur(0); setAdjDenoise(0);
  };

  // An image sent here from another tool (or from Ask Graphics) arrives as ctx.handoff; take it once.
  const handoffSeen = useRef(0);
  useEffect(() => {
    if (!handoff || handoff.mode !== 'adjust' || handoff.nonce === handoffSeen.current) return;
    handoffSeen.current = handoff.nonce;
    const src = handoff.src;
    setAdjResult(null); setAdjError(''); setAdjSource(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  useProcessingWhile(adjBusy ? 'Applying adjustments…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Adjust</h2>
            <button type="button" onClick={() => setHelpTool('adjust')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image to adjust."><input type="file" accept="image/*" onChange={e => { setAdjResult(null); setAdjError(''); loadImageInto(setAdjSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
              <div className="mt-2"><UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setAdjError(err); } else { setAdjResult(null); setAdjError(''); setAdjSource(src); } })} /></div>
            </div>
            {adjSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={adjSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Brightness: {Number(adjBrightness).toFixed(2)}</label>
                <Tooltip text="Makes the whole image lighter or darker."><input type="range" min="0.3" max="2" step="0.01" value={adjBrightness} onChange={e => setAdjBrightness(e.target.value)} className="w-full" /></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Contrast: {Number(adjContrast).toFixed(2)}</label>
                <Tooltip text="Increases or decreases the difference between light and dark areas."><input type="range" min="0.3" max="2" step="0.01" value={adjContrast} onChange={e => setAdjContrast(e.target.value)} className="w-full" /></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Saturation: {Number(adjSaturation).toFixed(2)}</label>
                <Tooltip text="Makes colours more vivid (higher) or more muted/grey (lower)."><input type="range" min="0" max="2" step="0.01" value={adjSaturation} onChange={e => setAdjSaturation(e.target.value)} className="w-full" /></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Hue shift: {adjHue}°</label>
                <Tooltip text="Rotates every colour around the colour wheel by this many degrees."><input type="range" min="0" max="360" step="1" value={adjHue} onChange={e => setAdjHue(e.target.value)} className="w-full" /></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Sharpness: {Number(adjSharpness).toFixed(1)}</label>
                <Tooltip text="Increases edge definition to make details look crisper."><input type="range" min="0" max="10" step="0.1" value={adjSharpness} onChange={e => setAdjSharpness(e.target.value)} className="w-full" /></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Temperature: {adjTemperature > 0 ? `+${adjTemperature}` : adjTemperature}</label>
                <Tooltip text="Shifts the overall colour warmer (orange) or cooler (blue)."><input type="range" min="-100" max="100" step="1" value={adjTemperature} onChange={e => setAdjTemperature(e.target.value)} className="w-full" /></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Vignette: {adjVignette}%</label>
                <Tooltip text="Darkens the corners of the image to draw attention to the centre."><input type="range" min="0" max="100" step="1" value={adjVignette} onChange={e => setAdjVignette(e.target.value)} className="w-full" /></Tooltip>
              </div>
              <div className="pt-2 mt-1 border-t" style={{ borderColor: 'var(--color-border)' }}>
                <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Levels</p>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Black point: {adjBlackPoint}</label>
                <Tooltip text="Any pixel darker than this becomes pure black — raises shadow contrast."><input type="range" min="0" max="254" step="1" value={adjBlackPoint} onChange={e => setAdjBlackPoint(e.target.value)} className="w-full" /></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>White point: {adjWhitePoint}</label>
                <Tooltip text="Any pixel lighter than this becomes pure white — raises highlight contrast."><input type="range" min="1" max="255" step="1" value={adjWhitePoint} onChange={e => setAdjWhitePoint(e.target.value)} className="w-full" /></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Gamma (midtones): {Number(adjGamma).toFixed(2)}</label>
                <Tooltip text="Brightens or darkens the mid-tones without affecting pure black or white."><input type="range" min="1" max="3" step="0.01" value={adjGamma} onChange={e => setAdjGamma(e.target.value)} className="w-full" /></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Blur: {Number(adjBlur).toFixed(1)}</label>
                <Tooltip text="Softens the whole image."><input type="range" min="0" max="30" step="0.5" value={adjBlur} onChange={e => setAdjBlur(e.target.value)} className="w-full" /></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Noise reduction: {adjDenoise > 0 ? `${adjDenoise % 2 === 0 ? Number(adjDenoise) + 1 : adjDenoise}px` : 'off'}</label>
                <Tooltip text="Smooths out grain and speckling, especially in low-light photos."><input type="range" min="0" max="13" step="1" value={adjDenoise} onChange={e => setAdjDenoise(e.target.value)} className="w-full" /></Tooltip>
              </div>
            </div>
            {adjError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{adjError}</div>}
            <div className="flex items-center gap-2">
              <Tooltip text="Apply all the adjustments above to the image."><button type="button" onClick={runAdjust} disabled={adjBusy || !adjSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
                {adjBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('sliders', { size: 15 })}
                {adjBusy ? 'Applying...' : 'Apply adjustments'}
              </button></Tooltip>
              <Tooltip text="Reset every slider back to its default value."><button type="button" onClick={resetAdjust} className="px-3 py-2 rounded-xl text-sm border hover:opacity-70" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Reset</button></Tooltip>
            </div>
            <div className="pt-3 mt-1 border-t space-y-2" style={{ borderColor: 'var(--color-border)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Presets</p>
              <div className="flex items-center gap-2">
                <Tooltip text="Name to save the current slider settings under."><input type="text" value={adjPresetName} onChange={e => setAdjPresetName(e.target.value)} placeholder="Preset name" className="flex-1 min-w-0 px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
                <Tooltip text="Save the current slider settings under this name for reuse later."><button type="button" onClick={saveAdjPreset} disabled={!adjPresetName.trim()} className="px-3 py-2 rounded-xl text-sm border disabled:opacity-50 hover:opacity-80 whitespace-nowrap" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>Save current</button></Tooltip>
              </div>
              {adjPresets.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {adjPresets.map(p => (
                    <span key={p.name} className="inline-flex items-center gap-1 rounded-lg border text-xs" style={{ borderColor: 'var(--color-border)' }}>
                      <Tooltip text="Load this saved preset into the sliders above."><button type="button" onClick={() => applyAdjPreset(p.name)} className="pl-2 py-1 hover:opacity-70" style={{ color: 'var(--color-text)' }}>{p.name}</button></Tooltip>
                      <Tooltip text="Delete this saved preset."><button type="button" onClick={() => deleteAdjPreset(p.name)} className="px-1.5 py-1 hover:opacity-70" style={{ color: '#ef4444' }}>×</button></Tooltip>
                    </span>
                  ))}
                </div>
              ) : <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Save the current sliders as a named preset to reuse later.</p>}
            </div>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {adjResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(adjSource?.imageDataUrl, adjResult?.imageDataUrl)}
                  {renderSendTo(adjResult.imageDataUrl, `adjusted.${adjResult.format}`, 'adjust')}
                  {renderExport(adjResult.imageDataUrl, 'adjusted')}
                  <Tooltip text="Save the adjusted image to your device."><button onClick={() => downloadDataUrl(adjResult.imageDataUrl, `adjusted-${Date.now()}.${adjResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button></Tooltip>
                </div>
              )}
            </div>
            <div className="p-4">
              {adjResult?.imageDataUrl ? (
                <>
                  {renderResultMedia(adjSource?.imageDataUrl, adjResult, { alt: 'result' })}
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{adjResult.width}×{adjResult.height} · {String(adjResult.format).toUpperCase()} · {formatBytes(adjResult.bytes)}</p>
                </>
              ) : <ResultPlaceholder src={adjSource?.imageDataUrl} message="Your result will appear here." />}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
