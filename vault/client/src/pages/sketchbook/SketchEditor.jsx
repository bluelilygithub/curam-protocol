import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import LookPicker from './LookPicker';
import { useSketchOptions, useSketchCost } from './useSketchOptions';
import { EXPORT_FORMATS, convertPicture, saveBlob, fileBase, versionLabel, lookLabel, costText, when } from './sketchbookLogic.mjs';

const BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border transition-opacity duration-200 hover:opacity-60 disabled:opacity-40';
const BTN_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' };
const CARD = 'rounded-2xl border p-4 space-y-3';
const CARD_STYLE = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };

/** One sketch: the picture, a box to change it with more words, its look, earlier pictures, and saving it as a file. */
export default function SketchEditor({ id }) {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const options = useSketchOptions();
  const [cost, refreshCost] = useSketchCost('change');

  const [sketch, setSketch] = useState(null);
  const [error, setError] = useState('');
  const [instruction, setInstruction] = useState('');
  const [style, setStyle] = useState('pencil');
  const [penColor, setPenColor] = useState('black');
  const [working, setWorking] = useState(false);
  const [renaming, setRenaming] = useState(null); // the draft name while renaming
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [preview, setPreview] = useState(null); // { vid, note, image } an earlier picture being looked at
  const busyRef = useRef(false);

  const adopt = useCallback((s) => {
    setSketch(s);
    setStyle(s.style);
    setPenColor(s.penColor);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await api.get(`/api/sketchbook/${id}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not open this sketch.');
        if (live) adopt(data.sketch);
      } catch (err) { if (live) setError(err.message || 'Could not open this sketch.'); }
    })();
    return () => { live = false; };
  }, [id, adopt]);

  // One request at a time: a second press while a picture is being drawn does nothing.
  const run = async (label, fn) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setWorking(true);
    startProcessing(label, 'This usually takes 10 to 30 seconds. Please stay on this page.');
    try { await fn(); } finally { stopProcessing(); setWorking(false); busyRef.current = false; }
  };

  const change = (body, label) => run(label, async () => {
    try {
      const res = await api.post(`/api/sketchbook/${id}/change`, { ...body, baseUpdatedAt: sketch.updatedAt });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The change could not be made. Try again.');
      adopt(data.sketch);
      setInstruction('');
      setPreview(null);
      addToast('Changed ✓ The earlier picture is kept under Earlier pictures.', 'success');
    } catch (err) { addToast(err.message, 'error'); }
    refreshCost();
  });

  const applyWords = () => { if (instruction.trim()) change({ instruction, style: sketch.style, penColor: sketch.penColor }, 'Changing your sketch…'); };
  const applyLook = (nextStyle, nextPen) => change({ style: nextStyle, penColor: nextPen }, nextStyle === 'coloured' ? 'Colouring it in…' : 'Redrawing the look…');

  const lookChanged = sketch && (style !== sketch.style || (style === 'pen' && penColor !== sketch.penColor));

  const putBack = (v) => run('Putting the earlier picture back…', async () => {
    try {
      const res = await api.post(`/api/sketchbook/${id}/versions/${v.vid}/restore`, { baseUpdatedAt: sketch.updatedAt });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not put that picture back.');
      adopt(data.sketch);
      setPreview(null);
      addToast('Earlier picture put back ✓ The one you replaced is kept too.', 'success');
    } catch (err) { addToast(err.message, 'error'); }
  });

  const look = async (v) => {
    try {
      const res = await api.get(`/api/sketchbook/${id}/versions/${v.vid}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not open that picture.');
      setPreview(data.version);
    } catch (err) { addToast(err.message, 'error'); }
  };

  const saveName = async () => {
    const title = (renaming || '').trim();
    setRenaming(null);
    if (!title || title === sketch.title) return;
    try {
      const res = await api.put(`/api/sketchbook/${id}`, { title });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not rename it.');
      setSketch((s) => ({ ...s, title: data.sketch.title, updatedAt: data.sketch.updatedAt }));
    } catch (err) { addToast(err.message, 'error'); }
  };

  const download = async (f) => {
    try {
      const blob = await convertPicture(sketch.image, f.id, f.id === 'png' ? undefined : 0.92);
      saveBlob(blob, `${fileBase(sketch.title)}.${f.ext}`);
    } catch (err) { addToast(err.message, 'error'); }
  };

  const copyPicture = async () => {
    try {
      if (!navigator.clipboard || typeof window.ClipboardItem === 'undefined') throw new Error('This browser cannot copy a picture. Save it as a file instead.');
      const blob = await convertPicture(sketch.image, 'png');
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
      addToast('Picture copied. Paste it into an email or document.', 'success');
    } catch (err) { addToast(err.message || 'The picture could not be copied.', 'error'); }
  };

  const remove = async () => {
    setConfirmDelete(false);
    try {
      const res = await api.delete(`/api/sketchbook/${id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The sketch could not be deleted. Try again.');
      addToast(`"${sketch.title}" deleted. Kept 30 days in the recycle bin.`, 'success');
      navigate('/sketchbook');
    } catch (err) { addToast(err.message, 'error'); }
  };

  if (error) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm" role="alert" style={{ color: '#ef4444' }}>{error}</p>
        <button type="button" className={BTN} style={BTN_STYLE} onClick={() => navigate('/sketchbook')}>{getIcon('arrow-left', { size: 13 })} Back to your sketches</button>
      </div>
    );
  }
  if (!sketch) return <div className="p-6"><Skeleton className="h-96" label="Opening your sketch" /></div>;

  const shownImage = preview ? preview.image : sketch.image;

  return (
    <div className="p-6 max-w-[1700px] space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip text="Go back to the list of all your sketches. Changes are saved already.">
          <button type="button" className={BTN} style={BTN_STYLE} onClick={() => navigate('/sketchbook')}>{getIcon('arrow-left', { size: 13 })} All sketches</button>
        </Tooltip>
        {renaming !== null ? (
          <div className="w-72" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveName(); } else if (e.key === 'Escape') setRenaming(null); }}>
            <VoiceInput value={renaming} onChange={setRenaming} onBlur={saveName} placeholder="Name" label="Name of this sketch" />
          </div>
        ) : (
          <Tooltip text="Change the name of this sketch.">
            <button type="button" onClick={() => setRenaming(sketch.title)} className="inline-flex items-center gap-1.5 text-base font-semibold transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-text)', background: 'none', border: 'none', padding: 0 }}>
              {sketch.title} <span style={{ color: 'var(--color-muted)' }}>{getIcon('edit', { size: 13 })}</span>
            </button>
          </Tooltip>
        )}
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{lookLabel(sketch.style, sketch.penColor, options)} · changed {when(sketch.updatedAt)}</span>
      </div>

      <div className="flex flex-col xl:grid xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start gap-4">
        {/* The picture */}
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: '#ffffff' }}>
          <img src={shownImage} alt={sketch.description || sketch.title} className="block w-full max-h-[78dvh] object-contain mx-auto" />
          {preview && (
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <span className="text-xs" style={{ color: 'var(--color-text)' }}>Looking at an earlier picture. {versionLabel(preview)}</span>
              <Tooltip text="Make this earlier picture the current one. The picture you have now is kept too.">
                <button type="button" className={BTN} style={BTN_STYLE} disabled={working} onClick={() => putBack(preview)}>{getIcon('rotate-ccw', { size: 13 })} Put this back</button>
              </Tooltip>
              <Tooltip text="Stop looking at the earlier picture and show the current one again.">
                <button type="button" className={BTN} style={BTN_STYLE} onClick={() => setPreview(null)}>Back to current</button>
              </Tooltip>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {/* Change it with more words */}
          <section className={CARD} style={CARD_STYLE} data-tour="sketchbook-change">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Change this picture</h2>
            <Tooltip text="Say what to change. The same picture is changed, not a new one drawn. You can ask for several things at once.">
              <div className="w-full">
                <VoiceInput
                  type="textarea" rows={3} append value={instruction} onChange={setInstruction} disabled={working}
                  placeholder="e.g. Make the dog bigger, add rain, and give the man a hat."
                  label="What to change in this picture"
                />
              </div>
            </Tooltip>
            <div className="flex flex-wrap items-center gap-3">
              <Tooltip text="Apply your words to this picture. The picture it replaces is kept under Earlier pictures so you can go back.">
                <button
                  type="button" onClick={applyWords} disabled={!instruction.trim() || working}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity duration-200 hover:opacity-80 disabled:opacity-40"
                  style={{ background: 'var(--color-primary)' }}
                >
                  {getIcon('wand', { size: 15 })} Change it
                </button>
              </Tooltip>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }} aria-live="polite">{costText(cost)}</p>
            </div>
          </section>

          {/* Pencil / pen / colour it in */}
          <section className={CARD} style={CARD_STYLE}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Pencil, pen or colour</h2>
            <LookPicker options={options} style={style} penColor={penColor} onStyle={setStyle} onPenColor={setPenColor} disabled={working} active={sketch.style} />
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip text={lookChanged ? 'Redraw this picture in the look chosen above. Everything stays where it is.' : 'Choose a different look above first.'}>
                <button type="button" className={BTN} style={BTN_STYLE} disabled={!lookChanged || working} onClick={() => applyLook(style, penColor)}>{getIcon('brush', { size: 13 })} Redraw in this look</button>
              </Tooltip>
              {sketch.style !== 'coloured' && (
                <Tooltip text="Colour in this drawing with a bright friendly palette. The lines stay as they are.">
                  <button type="button" className={BTN} style={BTN_STYLE} disabled={working} onClick={() => applyLook('coloured', penColor)}>{getIcon('palette', { size: 13 })} Colour it in</button>
                </Tooltip>
              )}
            </div>
          </section>

          {/* Earlier pictures */}
          <section className={CARD} style={CARD_STYLE} data-tour="sketchbook-versions">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Earlier pictures</h2>
            {sketch.versions.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>None yet. Each time you change the picture, the one it replaces is kept here (the last {options ? options.versionsKept : 6}).</p>
            ) : (
              <ul className="space-y-2">
                {sketch.versions.map((v) => (
                  <li key={v.vid} className="flex items-center gap-3">
                    <Tooltip text="Look at this earlier picture in the large view.">
                      <button type="button" onClick={() => look(v)} aria-label={versionLabel(v)} className="shrink-0 w-14 h-14 rounded-lg border overflow-hidden transition-opacity duration-200 hover:opacity-60" style={{ borderColor: preview && preview.vid === v.vid ? 'var(--color-primary)' : 'var(--color-border)', background: '#fff' }}>
                        {v.thumb ? <img src={v.thumb} alt="" className="w-full h-full object-contain" /> : null}
                      </button>
                    </Tooltip>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs truncate" style={{ color: 'var(--color-text)' }} title={v.note}>{versionLabel(v)}</p>
                      <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{when(v.at)}</p>
                    </div>
                    <Tooltip text="Make this earlier picture the current one. The picture you have now is kept too.">
                      <button type="button" className={BTN} style={BTN_STYLE} disabled={working} onClick={() => putBack(v)}>Put back</button>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Save as a file */}
          <section className={CARD} style={CARD_STYLE} data-tour="sketchbook-export">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Save or share</h2>
            <div className="flex flex-wrap items-center gap-2">
              {EXPORT_FORMATS.map((f) => (
                <Tooltip key={f.id} text={`Save this picture to your computer as a ${f.label} file. ${f.tip}`}>
                  <button type="button" className={BTN} style={BTN_STYLE} onClick={() => download(f)}>{getIcon('download', { size: 13 })} {f.label}</button>
                </Tooltip>
              ))}
              <Tooltip text="Copy the picture so you can paste it into an email, a document or a chat.">
                <button type="button" className={BTN} style={BTN_STYLE} onClick={copyPicture}>{getIcon('copy', { size: 13 })} Copy picture</button>
              </Tooltip>
            </div>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Need an SVG, a PDF or a print file? Save a PNG, then open it in Graphics (Vectorize, Print Ready).</p>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {confirmDelete ? (
                <>
                  <span className="text-xs" style={{ color: 'var(--color-text)' }}>Delete?</span>
                  <Tooltip text="Yes, delete it. It waits 30 days in the recycle bin.">
                    <button type="button" className={BTN} style={{ ...BTN_STYLE, color: '#ef4444', borderColor: '#ef4444' }} onClick={remove}>Yes</button>
                  </Tooltip>
                  <Tooltip text="No, keep it.">
                    <button type="button" className={BTN} style={BTN_STYLE} onClick={() => setConfirmDelete(false)}>No</button>
                  </Tooltip>
                </>
              ) : (
                <Tooltip text="Delete this sketch. You are asked first, and it can be brought back from the recycle bin for 30 days.">
                  <button type="button" className={BTN} style={BTN_STYLE} onClick={() => setConfirmDelete(true)}>{getIcon('trash', { size: 13 })} Delete</button>
                </Tooltip>
              )}
            </div>
          </section>

          {sketch.description && (
            <section className={CARD} style={CARD_STYLE}>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>What you described</h2>
              <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--color-muted)' }}>{sketch.description}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
