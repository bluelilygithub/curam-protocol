import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import { saveBlob, packNote, redrawCostText } from './sketchbookLogic.mjs';

const BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border transition-opacity duration-200 hover:opacity-60 disabled:opacity-40';
const BTN_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' };

const dataUrlToBlob = async (dataUrl) => (await fetch(dataUrl)).blob();

/**
 * Social media pack: the sketch made into every social size Graphics offers (Instagram, Facebook, LinkedIn, X, YouTube, Pinterest).
 * Crop and fit are made on the server for free; Redraw for this shape is one paid AI request and is kept on the sketch.
 * `run(label, fn)` is the editor's one-job-at-a-time runner (it shows the processing overlay).
 */
export default function SocialPack({ sketch, options, cost, refreshCost, run, working, onClose }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const sizes = options?.packSizes || [];
  const modes = options?.packModes || [];
  const [selected, setSelected] = useState(() => new Set(sizes.map((s) => s.id)));
  const [chosen, setChosen] = useState({}); // sizeId -> mode the person picked (default auto)
  const [items, setItems] = useState({}); // sizeId -> item from the server
  const [loading, setLoading] = useState({}); // sizeId -> true while that size is being made
  const [error, setError] = useState('');
  const [zipping, setZipping] = useState(false);
  const chosenRef = useRef(chosen);
  chosenRef.current = chosen;

  const make = useCallback(async (list) => {
    if (!list.length) return;
    setLoading((l) => ({ ...l, ...Object.fromEntries(list.map((x) => [x.id, true])) }));
    try {
      const res = await api.post(`/api/sketchbook/${sketch.id}/pack`, { sizes: list });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The pack could not be made. Try again.');
      setItems((cur) => ({ ...cur, ...Object.fromEntries(data.items.map((it) => [it.id, it])) }));
      setError('');
    } catch (err) { setError(err.message); }
    finally { setLoading((l) => ({ ...l, ...Object.fromEntries(list.map((x) => [x.id, false])) })); }
  }, [sketch.id]);

  // every size again whenever the picture changes (a change, a new look or Put back)
  useEffect(() => {
    if (!sizes.length) return;
    make(sizes.map((s) => ({ id: s.id, mode: chosenRef.current[s.id] || 'auto' })));
  }, [sizes.length, sketch.id, sketch.updatedAt, make]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickMode = (id, mode) => {
    setChosen((c) => ({ ...c, [id]: mode }));
    make([{ id, mode }]);
  };

  const toggle = (id) => setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = sizes.length > 0 && selected.size === sizes.length;

  const downloadOne = async (it) => {
    try { saveBlob(await dataUrlToBlob(it.imageDataUrl), it.fileName); } catch { addToast('That picture could not be saved. Try again.', 'error'); }
  };

  const downloadZip = async () => {
    const list = sizes.filter((s) => selected.has(s.id)).map((s) => ({ id: s.id, mode: chosen[s.id] || 'auto' }));
    if (!list.length) return;
    setZipping(true);
    try {
      const res = await api.post(`/api/sketchbook/${sketch.id}/pack`, { sizes: list, zip: true });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The ZIP could not be made. Try again.');
      saveBlob(await dataUrlToBlob(data.zipDataUrl), data.fileName || 'social-pack.zip');
    } catch (err) { addToast(err.message, 'error'); }
    finally { setZipping(false); }
  };

  const redraw = (size) => run(`Redrawing for ${size.name}…`, async () => {
    try {
      const res = await api.post(`/api/sketchbook/${sketch.id}/pack/${size.id}/redraw`, {});
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The redraw could not be made. Try again.');
      setItems((cur) => ({ ...cur, [size.id]: data.item }));
      setChosen((c) => ({ ...c, [size.id]: 'redrawn' }));
      addToast(`Redrawn for ${size.name} ✓ It is kept with this sketch.`, 'success');
    } catch (err) { addToast(err.message, 'error'); }
    refreshCost();
  });

  return (
    <section className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }} data-tour="sketchbook-pack" aria-label="Social media pack">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[16rem] flex-1">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Social media pack</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            This sketch at every social size. Auto crops when little is lost and otherwise keeps the whole picture with white margins (free).
            Where neither looks right, Redraw for this shape extends the scene to fit ({redrawCostText(cost)}).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip text={allOn ? 'Untick every size, then tick only the ones you want in the ZIP.' : 'Tick every size for the ZIP.'}>
            <button type="button" className={BTN} style={BTN_STYLE} onClick={() => setSelected(allOn ? new Set() : new Set(sizes.map((s) => s.id)))}>{allOn ? 'Untick all' : 'Tick all'}</button>
          </Tooltip>
          <Tooltip text="Download every ticked size as one ZIP file, each picture named after the sketch and the size.">
            <button
              type="button" onClick={downloadZip} disabled={zipping || selected.size === 0}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-medium text-white transition-opacity duration-200 hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              {getIcon(zipping ? 'loader' : 'archive', { size: 13, className: zipping ? 'animate-spin' : undefined })} {zipping ? 'Making ZIP…' : `Download ZIP (${selected.size})`}
            </button>
          </Tooltip>
          <Tooltip text="Close the social media pack. Redraws you paid for are kept with the sketch.">
            <button type="button" className={BTN} style={BTN_STYLE} onClick={onClose} aria-label="Close the social media pack">{getIcon('x', { size: 13 })}</button>
          </Tooltip>
        </div>
      </div>

      {error && <p className="text-xs" role="alert" style={{ color: '#ef4444' }}>{error}</p>}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {sizes.map((size) => {
          const it = items[size.id];
          const busy = !!loading[size.id];
          const mode = chosen[size.id] || 'auto';
          return (
            <li key={size.id} className="rounded-xl border p-2.5 space-y-2 flex flex-col" style={{ borderColor: selected.has(size.id) ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-bg)' }}>
              <div className="flex items-center justify-between gap-2">
                <Tooltip text={`Put the ${size.name} picture in the ZIP.`}>
                  <label className="flex items-center gap-2 text-xs font-medium cursor-pointer min-w-0" style={{ color: 'var(--color-text)' }}>
                    <input type="checkbox" checked={selected.has(size.id)} onChange={() => toggle(size.id)} />
                    <span className="truncate">{size.name}</span>
                  </label>
                </Tooltip>
                <span className="text-[11px] shrink-0" style={{ color: 'var(--color-muted)' }}>{size.width}×{size.height}</span>
              </div>
              <div className="flex items-center justify-center rounded-lg border overflow-hidden h-40" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                {busy || !it
                  ? <Skeleton className="w-full h-full" label={`Making the ${size.name} picture`} />
                  : <img src={it.imageDataUrl} alt={`${sketch.title} at ${size.name} size`} className="max-w-full max-h-full object-contain" style={{ boxShadow: '0 0 0 1px var(--color-border)' }} />}
              </div>
              <p className="text-[11px] min-h-[2.2em]" style={{ color: 'var(--color-muted)' }}>{it ? packNote(it) : ''}</p>
              <Tooltip text="How this size is made. Auto chooses for you. A crop cuts the sketch to the shape (choose which side to keep); Whole picture keeps everything with white margins.">
                <select
                  value={it && mode === 'redrawn' && !it.redraw ? 'auto' : mode} onChange={(e) => pickMode(size.id, e.target.value)} disabled={busy}
                  aria-label={`How the ${size.name} picture is made`}
                  className="w-full px-2 py-1.5 rounded-lg border text-xs"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {modes.filter((m) => m.id !== 'redrawn' || (it && it.redraw)).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </Tooltip>
              <div className="flex flex-wrap items-center gap-1.5 mt-auto">
                <Tooltip text={`Save just the ${size.name} picture (${size.width}×${size.height} JPG).`}>
                  <button type="button" className={BTN} style={BTN_STYLE} disabled={!it || busy} onClick={() => downloadOne(it)} aria-label={`Download the ${size.name} picture`}>{getIcon('download', { size: 13 })}</button>
                </Tooltip>
                {it && !it.sameShape && (
                  <Tooltip text={`The AI redraws this sketch for the ${size.name} shape, extending the scene instead of cropping it or adding margins. One paid AI picture; the redraw is kept with the sketch. Details can shift a little.`}>
                    <button type="button" className={BTN} style={BTN_STYLE} disabled={working || busy} onClick={() => redraw(size)}>
                      {getIcon('wand', { size: 13 })} {it.redraw ? 'Redraw again' : 'Redraw for this shape'}
                    </button>
                  </Tooltip>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
