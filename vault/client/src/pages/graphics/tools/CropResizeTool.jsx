import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useUrlImport, useSocialPresets, CR_ASPECTS, makeCenteredCrop, computeCropRect, useProcessingWhile, loadImageInto, UrlImportRow, SIZE_PRESETS, renderExport, downloadDataUrl, formatBytes, ResultPlaceholder, CR_HANDLES, CR_CURSOR } from '../shared';

export default function CropResizeTool({ active }) {
  const getIcon = useIcon();
  const { handoff, renderSendTo, setHelpTool, setPreviewImage } = useGraphics();
  const { urlImporting, importFromUrl } = useUrlImport();
  const socialPresets = useSocialPresets();

  const [crSource, setCrSource] = useState(null);
  const [crOp, setCrOp] = useState('resize');
  const [crWidth, setCrWidth] = useState('');
  const [crHeight, setCrHeight] = useState('');
  const [crFit, setCrFit] = useState('inside');
  const [crPresetId, setCrPresetId] = useState('');
  const [crAspect, setCrAspect] = useState('free');
  const [crBusy, setCrBusy] = useState(false);
  const [crResult, setCrResult] = useState(null);
  const [crError, setCrError] = useState('');
  const [crCrop, setCrCrop] = useState({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const [crNat, setCrNat] = useState(null);
  const crImgRef = useRef(null);
  const crDragRef = useRef(null);

  const runCropResize = async () => {
    if (!crSource?.imageDataUrl) return;
    setCrBusy(true);
    setCrError('');
    try {
      const body = { imageDataUrl: crSource.imageDataUrl, op: crOp };
      if (crOp === 'resize') {
        if (crPresetId) {
          body.preset = crPresetId;
        } else {
          body.width = crWidth ? Number(crWidth) : undefined;
          body.height = crHeight ? Number(crHeight) : undefined;
          body.fit = crFit;
        }
      } else {
        if (!crNat) throw new Error('Image is still loading');
        body.rect = {
          x: Math.round(crCrop.x * crNat.w),
          y: Math.round(crCrop.y * crNat.h),
          w: Math.round(crCrop.w * crNat.w),
          h: Math.round(crCrop.h * crNat.h),
        };
      }
      const res = await api.post('/api/graphics/resize', body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Operation failed');
      setCrResult(data);
    } catch (err) {
      setCrError(err.message || 'Operation failed');
    } finally {
      setCrBusy(false);
    }
  };

  const onCrImgLoad = (e) => {
    const img = e.currentTarget;
    const nat = { w: img.naturalWidth, h: img.naturalHeight };
    setCrNat(nat);
    const ratio = CR_ASPECTS.find(a => a.id === crAspect)?.v ?? null;
    setCrCrop(makeCenteredCrop(ratio, nat));
  };

  const onCrAspectChange = (id) => {
    setCrAspect(id);
    const ratio = CR_ASPECTS.find(a => a.id === id)?.v ?? null;
    if (crNat) setCrCrop(makeCenteredCrop(ratio, crNat));
  };

  const onCrDragMove = useCallback((e) => {
    const d = crDragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.imgW;
    const dy = (e.clientY - d.startY) / d.imgH;
    setCrCrop(computeCropRect(d, dx, dy));
  }, []);

  const endCrDrag = useCallback(() => {
    crDragRef.current = null;
    window.removeEventListener('mousemove', onCrDragMove);
    window.removeEventListener('mouseup', endCrDrag);
  }, [onCrDragMove]);

  const beginCrDrag = (type) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const img = crImgRef.current;
    if (!img) return;
    const r = img.getBoundingClientRect();
    crDragRef.current = {
      type,
      startX: e.clientX,
      startY: e.clientY,
      startRect: { ...crCrop },
      imgW: r.width,
      imgH: r.height,
      ratio: CR_ASPECTS.find(a => a.id === crAspect)?.v ?? null,
      natW: crNat?.w || 0,
      natH: crNat?.h || 0,
    };
    window.addEventListener('mousemove', onCrDragMove);
    window.addEventListener('mouseup', endCrDrag);
  };

  // An image sent here from another tool (or from Ask Graphics) arrives as ctx.handoff; take it once.
  const handoffSeen = useRef(0);
  useEffect(() => {
    if (!handoff || handoff.mode !== 'cropresize' || handoff.nonce === handoffSeen.current) return;
    handoffSeen.current = handoff.nonce;
    const src = handoff.src;
    setCrResult(null); setCrNat(null); setCrSource(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  useProcessingWhile(crBusy ? 'Processing image…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Crop / Resize</h2>
            <button type="button" onClick={() => setHelpTool('cropresize')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="rounded-2xl border p-4 mb-4 flex flex-wrap items-center gap-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="grow min-w-[220px]">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
            <Tooltip text="Choose the image to resize or crop."><input type="file" accept="image/*" onChange={e => { setCrResult(null); setCrError(''); setCrNat(null); loadImageInto(setCrSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
            <div className="mt-2"><UrlImportRow importing={urlImporting} onImport={(u) => importFromUrl(u, (src, err) => { if (err) { setCrError(err); } else { setCrResult(null); setCrError(''); setCrNat(null); setCrSource(src); } })} /></div>
          </div>
          <div className="flex gap-2 self-end">
            {['resize', 'crop'].map(o => (
              <button key={o} type="button" onClick={() => setCrOp(o)} className="px-3 py-1.5 rounded-lg text-xs font-medium border" style={{ background: crOp === o ? 'var(--color-primary)' : 'transparent', color: crOp === o ? '#fff' : 'var(--color-text)', borderColor: 'var(--color-border)' }} title={o === 'resize' ? 'Switch to resizing by exact width/height or a preset.' : 'Switch to dragging a crop box over the image.'}>
                {o === 'resize' ? 'Resize' : 'Crop'}
              </button>
            ))}
          </div>
        </div>

        {crOp === 'resize' ? (
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            {crSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={crSource.imageDataUrl} alt="source" className="max-h-56 mx-auto rounded-lg" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Preset size</label>
              <Tooltip text="Pick a ready-made size for a social network or ad platform — fills in width, height and fit automatically."><select
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  if (e.target.value.startsWith('server:')) {
                    setCrPresetId(e.target.value.slice('server:'.length));
                    setCrWidth('');
                    setCrHeight('');
                    e.target.value = '';
                    return;
                  }
                  const [w, h] = e.target.value.split('x');
                  setCrPresetId('');
                  setCrWidth(w);
                  setCrHeight(h);
                  setCrFit('cover');
                  e.target.value = '';
                }}
                className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                <option value="">Choose a social / web size…</option>
                {SIZE_PRESETS.map(g => (
                  <optgroup key={g.group} label={g.group}>
                    {g.items.map(it => <option key={it.label} value={`${it.w}x${it.h}`}>{it.label}</option>)}
                  </optgroup>
                ))}
                {socialPresets.length > 0 && (
                  <optgroup label="Social & ad platforms (smart crop)">
                    {socialPresets.map(p => <option key={p.id} value={`server:${p.id}`}>{p.label}</option>)}
                  </optgroup>
                )}
              </select></Tooltip>
              {crPresetId && (
                <p className="text-[11px] mt-1" style={{ color: 'var(--color-primary)' }}>
                  Using preset “{socialPresets.find(p => p.id === crPresetId)?.label || crPresetId}” — content-aware cover crop to its exact size.{' '}
                  <Tooltip text="Stop using this preset and enter width/height manually."><button type="button" onClick={() => setCrPresetId('')} className="underline hover:opacity-70">Clear</button></Tooltip>
                </p>
              )}
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Width (px)</label>
                <Tooltip text="Target width in pixels. Leave blank to size automatically from the height."><input type="number" value={crWidth} onChange={e => { setCrPresetId(''); setCrWidth(e.target.value); }} placeholder="auto" disabled={!!crPresetId} className="w-full px-3 py-2 rounded-xl border text-sm disabled:opacity-50" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Height (px)</label>
                <Tooltip text="Target height in pixels. Leave blank to size automatically from the width."><input type="number" value={crHeight} onChange={e => { setCrPresetId(''); setCrHeight(e.target.value); }} placeholder="auto" disabled={!!crPresetId} className="w-full px-3 py-2 rounded-xl border text-sm disabled:opacity-50" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Fit</label>
                <Tooltip text="How the image should be fitted into the target size when its proportions don't match."><select value={crFit} onChange={e => setCrFit(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="inside">Inside (keep aspect)</option>
                  <option value="cover">Cover (fill, crop)</option>
                  <option value="contain">Contain (letterbox)</option>
                  <option value="fill">Fill (stretch)</option>
                </select></Tooltip>
              </div>
            </div>
            {crError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{crError}</div>}
            <Tooltip text="Resize the image with the settings above."><button type="button" onClick={runCropResize} disabled={crBusy || !crSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {crBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('crop', { size: 15 })}
              {crBusy ? 'Working...' : 'Resize image'}
            </button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {crResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderSendTo(crResult.imageDataUrl, `image-${crResult.width}x${crResult.height}.${crResult.format}`, 'cropresize')}
                  {renderExport(crResult.imageDataUrl, `image-${crResult.width}x${crResult.height}`)}
                  <Tooltip text="Save the resized image to your device."><button onClick={() => downloadDataUrl(crResult.imageDataUrl, `image-${crResult.width}x${crResult.height}.${crResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button></Tooltip>
                </div>
              )}
            </div>
            <div className="p-4">
              {crResult?.imageDataUrl ? (
                <>
                  <button type="button" onClick={() => setPreviewImage(crResult)} className="block w-full"><img src={crResult.imageDataUrl} alt="result" className="w-full rounded-xl border" style={{ borderColor: 'var(--color-border)' }} /></button>
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{crResult.width}×{crResult.height} · {String(crResult.format).toUpperCase()} · {formatBytes(crResult.bytes)}</p>
                </>
              ) : <ResultPlaceholder src={crSource?.imageDataUrl} message="Your result will appear here." />}
            </div>
          </div>
        </div>
        ) : (
        <div className="space-y-4">
          {!crSource?.imageDataUrl ? (
            <div className="rounded-2xl border flex items-center justify-center text-sm text-center px-6 py-20" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Choose a source image above to start cropping.</div>
          ) : (
            <>
              <div className="rounded-2xl border p-3 flex flex-wrap items-center gap-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Lock ratio</label>
                  <Tooltip text="Constrain the crop box to a fixed width:height ratio, or leave it free to drag any shape."><select value={crAspect} onChange={e => onCrAspectChange(e.target.value)} className="px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    {CR_ASPECTS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select></Tooltip>
                </div>
                <Tooltip text="Reset the crop box back to a centred default selection."><button type="button" onClick={() => onCrAspectChange(crAspect)} className="text-xs px-3 py-2 rounded-xl border hover:opacity-70" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Reset selection</button></Tooltip>
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  Selection: {crNat ? `${Math.round(crCrop.w * crNat.w)} × ${Math.round(crCrop.h * crNat.h)} px` : '…'}
                </span>
                <div className="grow" />
                {crError && <span className="text-xs" style={{ color: '#dc2626' }}>{crError}</span>}
                <Tooltip text="Crop the image to the current selection box."><button type="button" onClick={runCropResize} disabled={crBusy || !crNat} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
                  {crBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('crop', { size: 15 })}
                  {crBusy ? 'Cropping...' : 'Crop image'}
                </button></Tooltip>
              </div>

              <div className="rounded-2xl border p-4 flex justify-center" style={{ borderColor: 'var(--color-border)', background: '#1e1e1e' }}>
                <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0, maxWidth: '100%' }}>
                  <img
                    ref={crImgRef}
                    src={crSource.imageDataUrl}
                    alt="crop source"
                    onLoad={onCrImgLoad}
                    draggable={false}
                    style={{ display: 'block', maxHeight: '70vh', maxWidth: '100%', userSelect: 'none', borderRadius: 6 }}
                  />
                  {/* Dim overlay outside the selection */}
                  <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: `${crCrop.y * 100}%`, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
                  <div style={{ position: 'absolute', left: 0, top: `${(crCrop.y + crCrop.h) * 100}%`, width: '100%', bottom: 0, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
                  <div style={{ position: 'absolute', left: 0, top: `${crCrop.y * 100}%`, width: `${crCrop.x * 100}%`, height: `${crCrop.h * 100}%`, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
                  <div style={{ position: 'absolute', left: `${(crCrop.x + crCrop.w) * 100}%`, top: `${crCrop.y * 100}%`, right: 0, height: `${crCrop.h * 100}%`, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
                  {/* Selection box */}
                  <Tooltip text="Drag to move the crop selection."><div
                    onMouseDown={beginCrDrag('move')}
                    style={{
                      position: 'absolute',
                      left: `${crCrop.x * 100}%`,
                      top: `${crCrop.y * 100}%`,
                      width: `${crCrop.w * 100}%`,
                      height: `${crCrop.h * 100}%`,
                      border: '2px solid #fff',
                      boxShadow: '0 0 0 1px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(0,0,0,0.4)',
                      cursor: 'move',
                      boxSizing: 'border-box',
                    }}
                  >
                    {/* rule-of-thirds guides */}
                    <div style={{ position: 'absolute', left: '33.33%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.35)', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', left: '66.66%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.35)', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', top: '33.33%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.35)', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', top: '66.66%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.35)', pointerEvents: 'none' }} />
                    {CR_HANDLES.filter(hn => crAspect === 'free' || hn.length === 2).map(hn => {
                      const left = hn.includes('w') ? '0%' : hn.includes('e') ? '100%' : '50%';
                      const top = hn.includes('n') ? '0%' : hn.includes('s') ? '100%' : '50%';
                      return (
                        <Tooltip key={hn} text="Drag to resize the crop selection from this edge or corner."><div
                          onMouseDown={beginCrDrag(hn)}
                          style={{
                            position: 'absolute',
                            left,
                            top,
                            width: 16,
                            height: 16,
                            transform: 'translate(-50%, -50%)',
                            background: '#fff',
                            border: '2px solid var(--color-primary)',
                            borderRadius: 3,
                            boxShadow: '0 1px 3px rgba(0,0,0,0.6)',
                            cursor: CR_CURSOR[hn],
                          }}
                        /></Tooltip>
                      );
                    })}
                  </div></Tooltip>
                </div>
              </div>

              {crResult?.imageDataUrl && (
                <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                  <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
                    <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result · {crResult.width}×{crResult.height} · {formatBytes(crResult.bytes)}</span>
                    <div className="flex items-center gap-2">
                      {renderSendTo(crResult.imageDataUrl, `crop-${crResult.width}x${crResult.height}.${crResult.format}`, 'cropresize')}
                      {renderExport(crResult.imageDataUrl, `crop-${crResult.width}x${crResult.height}`)}
                      <Tooltip text="Save the cropped image to your device."><button onClick={() => downloadDataUrl(crResult.imageDataUrl, `crop-${crResult.width}x${crResult.height}.${crResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button></Tooltip>
                    </div>
                  </div>
                  <div className="p-4">
                    <button type="button" onClick={() => setPreviewImage(crResult)} className="block max-w-full"><img src={crResult.imageDataUrl} alt="result" className="max-h-80 rounded-xl border" style={{ borderColor: 'var(--color-border)' }} /></button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        )}
      </section>
    </>
  );
}
