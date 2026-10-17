import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useUrlImport, loadImageInto, UrlImportRow, renderExport, downloadDataUrl, ResultPlaceholder } from '../shared';

export default function PerspectiveTool({ active }) {
  const getIcon = useIcon();
  const { renderCompareToggle, renderResultMedia, renderSendTo, setHelpTool } = useGraphics();
  const { urlImporting, importFromUrl } = useUrlImport();

  // Perspective correct
  const [persSource, setPersSource] = useState(null);

  const [persHSkew, setPersHSkew] = useState(0);
  const [persVSkew, setPersVSkew] = useState(0);
  const [persBg, setPersBg] = useState('transparent');
  const [persBusy, setPersBusy] = useState(false);
  const [persResult, setPersResult] = useState(null);
  const [persError, setPersError] = useState('');

  // Perspective correct handlers.
  const runPerspective = async () => {
    if (!persSource?.imageDataUrl) return;
    setPersBusy(true);
    setPersError('');
    try {
      const res = await api.post('/api/graphics/perspective', {
        imageDataUrl: persSource.imageDataUrl,
        hSkew: persHSkew,
        vSkew: persVSkew,
        background: persBg,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Perspective correction failed');
      setPersResult(data);
    } catch (err) {
      setPersError(err.message || 'Perspective correction failed');
    } finally {
      setPersBusy(false);
    }
  };

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Perspective correct</h2>
            <button type="button" onClick={() => setHelpTool('perspective')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Fix keystone / trapezoid distortion by adjusting horizontal and vertical shear. Best for whiteboards, documents and architecture shots taken at an angle.</p>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image to correct for keystone / trapezoid distortion."><input type="file" accept="image/*" onChange={async e => { setPersError(''); setPersResult(null); loadImageInto(setPersSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
              <UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setPersError(err); } else { setPersResult(null); setPersError(''); setPersSource(src); } })} />
            </div>
            {persSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={persSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Horizontal skew: {persHSkew > 0 ? `+${persHSkew}` : persHSkew}</label>
                <Tooltip text="Corrects left/right lean, e.g. from a photo taken at an angle to a whiteboard or document."><input type="range" min="-50" max="50" step="1" value={persHSkew} onChange={e => setPersHSkew(Number(e.target.value))} className="w-full" /></Tooltip>
                <div className="flex justify-between text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}><span>Left lean</span><span>0</span><span>Right lean</span></div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Vertical skew: {persVSkew > 0 ? `+${persVSkew}` : persVSkew}</label>
                <Tooltip text="Corrects top/bottom lean, e.g. from a photo taken from above or below."><input type="range" min="-50" max="50" step="1" value={persVSkew} onChange={e => setPersVSkew(Number(e.target.value))} className="w-full" /></Tooltip>
                <div className="flex justify-between text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}><span>Top lean</span><span>0</span><span>Bottom lean</span></div>
              </div>
              <div className="flex items-center gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Corner fill</label>
                  <Tooltip text="What to fill the empty corners created by the correction with."><select value={persBg} onChange={e => setPersBg(e.target.value)} className="px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    <option value="transparent">Transparent (PNG)</option>
                    <option value="#ffffff">White</option>
                    <option value="#000000">Black</option>
                  </select></Tooltip>
                </div>
                {persBg !== 'transparent' && (
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Custom colour</label>
                    <Tooltip text="Colour used to fill the empty corners."><input type="color" value={persBg.startsWith('#') ? persBg : '#ffffff'} onChange={e => setPersBg(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)' }} /></Tooltip>
                  </div>
                )}
              </div>
            </div>
            {persError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{persError}</div>}
            <div className="flex items-center gap-2">
              <Tooltip text="Apply the perspective correction with the settings above."><button type="button" onClick={runPerspective} disabled={persBusy || !persSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
                {persBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('trapezoid', { size: 15 })}
                {persBusy ? 'Correcting…' : 'Apply correction'}
              </button></Tooltip>
              <Tooltip text="Reset both skew sliders to zero."><button type="button" onClick={() => { setPersHSkew(0); setPersVSkew(0); }} className="px-3 py-2 rounded-xl text-sm border hover:opacity-70" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Reset</button></Tooltip>
            </div>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {persResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderCompareToggle(persSource?.imageDataUrl, persResult?.imageDataUrl)}
                  {renderSendTo(persResult.imageDataUrl, 'corrected.png', 'perspective')}
                  {renderExport(persResult.imageDataUrl, 'corrected')}
                  <Tooltip text="Save the corrected image to your device."><button onClick={() => downloadDataUrl(persResult.imageDataUrl, `perspective-${Date.now()}.png`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button></Tooltip>
                </div>
              )}
            </div>
            <div className="p-4">
              {persResult?.imageDataUrl ? (
                <>
                  {renderResultMedia(persSource?.imageDataUrl, persResult, { alt: 'corrected' })}
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{persResult.width}×{persResult.height} px</p>
                </>
              ) : <ResultPlaceholder src={persSource?.imageDataUrl} message="Apply correction to see the result." />}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
