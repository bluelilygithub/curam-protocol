import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import LookPicker from './LookPicker';
import { useSketchOptions, useSketchCost } from './useSketchOptions';
import { filterSketches, when, lookLabel, costText } from './sketchbookLogic.mjs';

const BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border transition-opacity duration-200 hover:opacity-60 disabled:opacity-40';
const BTN_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' };

/** The list of the person's sketches, with the box at the top where a new one is described. */
export default function SketchList() {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const options = useSketchOptions();
  const [cost, refreshCost] = useSketchCost('draw');

  const [items, setItems] = useState(null); // null while loading
  const [max, setMax] = useState(200);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState(null); // { id, title }
  const [confirmId, setConfirmId] = useState(null);

  const [text, setText] = useState('');
  const [style, setStyle] = useState('pencil');
  const [penColor, setPenColor] = useState('black');
  const [aspect, setAspect] = useState('landscape');
  const [drawing, setDrawing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/sketchbook');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load your sketches.');
      setItems(data.sketches || []);
      if (data.max) setMax(data.max);
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load your sketches.');
      setItems((prev) => prev || []);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const draw = async () => {
    const description = text.trim();
    if (!description || drawing) return;
    setDrawing(true);
    startProcessing('Drawing your sketch…', 'This usually takes 10 to 30 seconds. Please stay on this page.');
    try {
      const res = await api.post('/api/sketchbook/draw', { description, style, penColor, aspect });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The sketch could not be drawn. Try again.');
      navigate(`/sketchbook/${data.sketch.id}`);
    } catch (err) {
      addToast(err.message, 'error');
      refreshCost();
      setDrawing(false);
    } finally {
      stopProcessing();
    }
  };

  const rename = async () => {
    if (!renaming) return;
    const { id, title } = renaming;
    setRenaming(null);
    const current = (items || []).find((s) => s.id === id);
    if (!current || !title.trim() || title.trim() === current.title) return;
    try {
      const res = await api.put(`/api/sketchbook/${id}`, { title });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not rename it.');
      setItems((prev) => prev.map((s) => (s.id === id ? { ...s, ...data.sketch } : s)));
    } catch (err) { addToast(err.message, 'error'); }
  };

  const copy = async (s) => {
    try {
      const res = await api.post(`/api/sketchbook/${s.id}/duplicate`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not make a copy.');
      await load();
      addToast(`Made "${data.sketch.title}".`, 'success');
    } catch (err) { addToast(err.message, 'error'); }
  };

  const undo = async (binId) => {
    try {
      const res = await api.post(`/api/recycle-bin/${binId}/restore`);
      if (!res.ok) throw new Error('restore failed');
      await load();
      addToast('Sketch restored ✓', 'success');
    } catch { addToast('That could not be restored. Look in the recycle bin in Settings.', 'error'); }
  };

  const remove = async (s) => {
    setConfirmId(null);
    try {
      const res = await api.delete(`/api/sketchbook/${s.id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The sketch could not be deleted. Try again.');
      setItems((prev) => prev.filter((x) => x.id !== s.id));
      addToast(`"${s.title}" deleted. Kept 30 days in the recycle bin.`, 'success', undefined, data.binId ? { label: 'Undo', onClick: () => undo(data.binId) } : undefined);
    } catch (err) { addToast(err.message, 'error'); }
  };

  const shown = useMemo(() => filterSketches(items || [], query), [items, query]);
  const full = (items || []).length >= max;

  return (
    <div className="p-6 space-y-6 max-w-[1700px]">
      {/* Describe a new picture */}
      <section className="rounded-2xl border p-5 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }} data-tour="sketchbook-describe">
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Describe a scene</h2>
        <Tooltip text="Say or type a scene, a theory or a possibility. The more clearly you say who and what is in it, the better the picture. The microphone lets you speak it.">
          <div className="w-full">
            <VoiceInput
              type="textarea" rows={4} append value={text} onChange={setText} disabled={drawing}
              placeholder="e.g. A surveyor on a ladder checks a cracked wall while the homeowner watches nervously from the garden."
              label="Describe the scene to draw"
            />
          </div>
        </Tooltip>
        <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
          <div className="space-y-1">
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>How it is drawn</p>
            <LookPicker options={options} style={style} penColor={penColor} onStyle={setStyle} onPenColor={setPenColor} disabled={drawing} />
          </div>
          <div className="space-y-1">
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Shape</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Picture shape">
              {(options?.aspects || []).map((a) => {
                const on = aspect === a.id;
                return (
                  <Tooltip key={a.id} text={`${a.label} picture (${a.width} × ${a.height}).`}>
                    <button
                      type="button" aria-pressed={on} disabled={drawing} onClick={() => setAspect(a.id)} className={BTN}
                      style={on ? { background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' } : BTN_STYLE}
                    >{a.label}</button>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Tooltip text="Draw the scene as a cartoon. It is saved to your sketches, where you can change it with more instructions.">
            <button
              type="button" data-tour="sketchbook-draw" onClick={draw} disabled={!text.trim() || drawing || full}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity duration-200 hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              {getIcon('pencil-line', { size: 15 })} Draw it
            </button>
          </Tooltip>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }} aria-live="polite">
            {full ? `You already have ${max} sketches. Delete some to make a new one.` : costText(cost)}
          </p>
        </div>
      </section>

      {/* The collection */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Your sketches</h2>
        <div className="flex-1 min-w-[12rem] max-w-md ml-auto">
          <Tooltip text="Narrow the list to sketches whose name or description has all the words you type. The microphone lets you say them.">
            <div className="w-full">
              <VoiceInput value={query} onChange={setQuery} placeholder="Search your sketches…" label="Search your sketches" />
            </div>
          </Tooltip>
        </div>
      </div>

      {error && <p className="text-sm" role="alert" style={{ color: '#ef4444' }}>{error}</p>}

      <div data-tour="sketchbook-list">
        {items === null && (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-48" label="Loading your sketches" />)}
          </div>
        )}
        {items !== null && items.length === 0 && !error && (
          <EmptyState icon="pencil-line" title="No sketches yet" body="Describe a scene above and it is drawn as a cartoon. Every sketch is saved here, private to you, and can be changed later with more instructions." />
        )}
        {items !== null && items.length > 0 && shown.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No sketch has all of those words.</p>
        )}
        {shown.length > 0 && (
          <ul className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map((s) => (
              <li key={s.id} className="rounded-xl border overflow-hidden flex flex-col" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <Tooltip text="Open this sketch to change it, save it as a picture, or go back to an earlier version.">
                  <button
                    type="button" onClick={() => navigate(`/sketchbook/${s.id}`)} aria-label={`Open ${s.title}`}
                    className="block w-full h-44 transition-opacity duration-200 hover:opacity-80"
                    style={{ background: '#ffffff', borderBottom: '1px solid var(--color-border)' }}
                  >
                    {s.thumbnail
                      ? <img src={s.thumbnail} alt="" className="w-full h-full object-contain" />
                      : <span className="flex items-center justify-center h-full" style={{ color: 'var(--color-muted)' }}>{getIcon('pencil-line', { size: 28 })}</span>}
                  </button>
                </Tooltip>
                <div className="p-3 space-y-2 flex-1 flex flex-col">
                  {renaming && renaming.id === s.id ? (
                    <div onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); rename(); } else if (e.key === 'Escape') setRenaming(null); }}>
                      <VoiceInput value={renaming.title} onChange={(v) => setRenaming({ id: s.id, title: v })} onBlur={rename} placeholder="Name" label={`New name for ${s.title}`} />
                    </div>
                  ) : (
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }} title={s.title}>{s.title}</p>
                  )}
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {lookLabel(s.style, s.penColor, options)}{s.changeCount > 0 ? ` · ${s.changeCount} change${s.changeCount === 1 ? '' : 's'}` : ''} · {when(s.updatedAt)}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-auto pt-1">
                    {confirmId === s.id ? (
                      <>
                        <span className="text-xs" style={{ color: 'var(--color-text)' }}>Delete?</span>
                        <Tooltip text="Yes, delete it. It waits 30 days in the recycle bin and an Undo button appears.">
                          <button type="button" className={BTN} style={{ ...BTN_STYLE, color: '#ef4444', borderColor: '#ef4444' }} onClick={() => remove(s)}>Yes</button>
                        </Tooltip>
                        <Tooltip text="No, keep it.">
                          <button type="button" className={BTN} style={BTN_STYLE} onClick={() => setConfirmId(null)}>No</button>
                        </Tooltip>
                      </>
                    ) : (
                      <>
                        <Tooltip text="Change the name of this sketch.">
                          <button type="button" className={BTN} style={BTN_STYLE} onClick={() => setRenaming({ id: s.id, title: s.title })}>{getIcon('edit', { size: 13 })} Rename</button>
                        </Tooltip>
                        <Tooltip text="Make another sketch from this one. The two are separate afterwards, so you can try a different change on the copy.">
                          <button type="button" className={BTN} style={BTN_STYLE} onClick={() => copy(s)}>{getIcon('copy', { size: 13 })} Copy</button>
                        </Tooltip>
                        <Tooltip text="Delete this sketch. You are asked first, and you can undo it.">
                          <button type="button" className={BTN} style={BTN_STYLE} onClick={() => setConfirmId(s.id)} aria-label={`Delete ${s.title}`}>{getIcon('trash', { size: 13 })} Delete</button>
                        </Tooltip>
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
