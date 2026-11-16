import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useEffect } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { VoiceInput, VoiceInputProvider } from '../../../components/voiceInput/VoiceInput';
import { useGraphics } from '../GraphicsContext';
import { useProcessingWhile, loadImageInto, renderExport, downloadDataUrl, formatBytes, formatCost, ResultPlaceholder, CostNote, useImageSize } from '../shared';

// Shapes for "Pad to a shape": the picture stays whole and centred, space is added on two sides to reach the shape.
const PAD_SHAPES = [
  { id: '1:1', label: 'Square 1:1', r: 1 },
  { id: '4:5', label: 'Portrait 4:5', r: 4 / 5 },
  { id: '9:16', label: 'Story 9:16', r: 9 / 16 },
  { id: '16:9', label: 'Wide 16:9', r: 16 / 9 },
  { id: '1.91:1', label: 'Link 1.91:1', r: 1.91 },
  { id: '3:2', label: 'Photo 3:2', r: 3 / 2 },
];

function padsForShape(w, h, r) {
  if (!w || !h) return null;
  if (w / h < r) {
    const extra = Math.max(0, Math.round(h * r) - w);
    return { top: 0, bottom: 0, left: Math.floor(extra / 2), right: Math.ceil(extra / 2) };
  }
  const extra = Math.max(0, Math.round(w / r) - h);
  return { left: 0, right: 0, top: Math.floor(extra / 2), bottom: Math.ceil(extra / 2) };
}

const FILLS = [
  { id: 'colour', label: 'Colour', tip: 'Fill the new space with one colour. Runs locally, free.' },
  { id: 'transparent', label: 'See-through', tip: 'Leave the new space transparent (saves as PNG). Runs locally, free.' },
  { id: 'ai', label: 'AI fill', tip: 'The AI paints the new space so the scene carries on past the edges. Your picture itself is kept exactly as it is. Hosted (FAL), costs a little per run.' },
];

export default function ExtendTool({ active }) {
  const getIcon = useIcon();
  const { handoff, renderSendTo, setHelpTool, setPreviewImage, brandKit } = useGraphics();

  const [extSource, setExtSource] = useState(null);
  const [extTop, setExtTop] = useState('40');
  const [extRight, setExtRight] = useState('40');
  const [extBottom, setExtBottom] = useState('40');
  const [extLeft, setExtLeft] = useState('40');
  const [extLink, setExtLink] = useState(true);
  const [fill, setFill] = useState('colour');
  const [extColor, setExtColor] = useState('#ffffff');
  const [aiPrompt, setAiPrompt] = useState('');
  const [extBusy, setExtBusy] = useState(false);
  const [extResult, setExtResult] = useState(null);
  const [extError, setExtError] = useState('');
  const srcSize = useImageSize(extSource?.imageDataUrl);

  const setExtAll = (val) => { setExtTop(val); setExtRight(val); setExtBottom(val); setExtLeft(val); };
  const pads = { top: Number(extTop) || 0, right: Number(extRight) || 0, bottom: Number(extBottom) || 0, left: Number(extLeft) || 0 };

  const padToShape = (shape) => {
    const p = padsForShape(srcSize?.width, srcSize?.height, shape.r);
    if (!p) return;
    setExtLink(false);
    setExtTop(String(p.top)); setExtRight(String(p.right)); setExtBottom(String(p.bottom)); setExtLeft(String(p.left));
  };

  // AI fill can add at most twice the picture's size on each axis (the server says the same).
  const aiTooMuch = fill === 'ai' && srcSize && (pads.left + pads.right > srcSize.width * 2 || pads.top + pads.bottom > srcSize.height * 2);

  const runExtend = async () => {
    if (!extSource?.imageDataUrl) return;
    setExtBusy(true);
    setExtError('');
    try {
      const res = fill === 'ai'
        ? await api.post('/api/graphics/expand', { imageDataUrl: extSource.imageDataUrl, ...pads, prompt: aiPrompt.trim() })
        : await api.post('/api/graphics/extend', { imageDataUrl: extSource.imageDataUrl, ...pads, transparent: fill === 'transparent', background: extColor });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Canvas extend failed');
      setExtResult({ ...data, ai: fill === 'ai' });
    } catch (err) {
      setExtError(err.message || 'Canvas extend failed');
    } finally {
      setExtBusy(false);
    }
  };

  // An image sent here from another tool (or from Ask Graphics) arrives as ctx.handoff; take it once.
  const handoffSeen = useRef(0);
  useEffect(() => {
    if (!handoff || handoff.mode !== 'extend' || handoff.nonce === handoffSeen.current) return;
    handoffSeen.current = handoff.nonce;
    const src = handoff.src;
    setExtResult(null); setExtError(''); setExtSource(src);
    if (handoff.prompt) { setFill('ai'); setAiPrompt(handoff.prompt); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  useProcessingWhile(extBusy ? (fill === 'ai' ? 'AI is filling the new space…' : 'Extending canvas…') : null);

  const numInput = (label, tip, value, setter) => (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>{label}</label>
      <Tooltip text={tip}><input type="number" min="0" value={value} onChange={e => setter(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
    </div>
  );

  return (
    <VoiceInputProvider lang="en-AU">
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Canvas extend</h2>
            <button type="button" onClick={() => setHelpTool('extend')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{fill === 'ai' ? 'Hosted (FAL) · paid' : 'Runs locally · free'}</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image to add space around."><input type="file" accept="image/*" onChange={e => { setExtResult(null); setExtError(''); loadImageInto(setExtSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
            </div>
            {extSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={extSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
                {srcSize && <p className="text-[11px] text-center mt-1" style={{ color: 'var(--color-muted)' }}>{srcSize.width}×{srcSize.height} → {srcSize.width + pads.left + pads.right}×{srcSize.height + pads.top + pads.bottom}</p>}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Fill the new space with</label>
              <div className="flex flex-wrap gap-1.5">
                {FILLS.map((f) => (
                  <Tooltip key={f.id} text={f.tip}>
                    <button type="button" onClick={() => setFill(f.id)} className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-opacity duration-200 hover:opacity-70" style={{ background: fill === f.id ? 'var(--color-primary)' : 'transparent', color: fill === f.id ? 'var(--color-on-primary, #fff)' : 'var(--color-text)', borderColor: 'var(--color-border)' }}>{f.label}</button>
                  </Tooltip>
                ))}
              </div>
            </div>

            {fill === 'colour' && (
              <div className="flex items-center gap-2">
                <label className="text-xs" style={{ color: 'var(--color-muted)' }}>Fill colour</label>
                <Tooltip text="Colour used to fill the new space."><input type="color" value={extColor} onChange={e => setExtColor(e.target.value)} className="h-8 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                {brandKit?.colors?.filter(Boolean).map((c, i) => (
                  <Tooltip key={i} text={`Use brand colour ${i + 1}.`}>
                    <button type="button" onClick={() => setExtColor(c)} className="h-6 w-6 rounded-full border flex-shrink-0" style={{ background: c, borderColor: 'var(--color-border)' }} />
                  </Tooltip>
                ))}
              </div>
            )}

            {fill === 'ai' && (
              <div className="space-y-2">
                <label className="block text-xs font-medium" style={{ color: 'var(--color-muted)' }}>What should the new space show? (optional)</label>
                <VoiceInput type="textarea" rows={2} append value={aiPrompt} onChange={setAiPrompt} label="What should the new space show" placeholder="Leave empty to carry on the scene, or e.g. more sandy beach and calm sea" />
                <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Your picture is kept exactly as it is; only the new space is painted. Works best with scenery and plain backgrounds, and for adding up to about half the picture's size again. People and text at the edges may not continue perfectly; try again for a different result. A see-through picture is put on white first.</p>
                <CostNote tool="expand" refreshKey={extResult} />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Pad to a shape</label>
              <div className="flex flex-wrap gap-1.5">
                {PAD_SHAPES.map((s) => (
                  <Tooltip key={s.id} text={`Add space to two sides so the picture becomes ${s.label}, kept whole and centred. Fills in the four side amounts below.`}>
                    <button type="button" disabled={!srcSize} onClick={() => padToShape(s)} className="px-2.5 py-1 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>{s.label}</button>
                  </Tooltip>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
              <Tooltip text="Use one amount for all four sides instead of setting each separately."><input type="checkbox" checked={extLink} onChange={e => setExtLink(e.target.checked)} /></Tooltip>
              Same space on all sides
            </label>
            {extLink ? (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Space (all sides): {extTop}px</label>
                <Tooltip text="How many pixels of space to add around every edge of the image."><input type="range" min="0" max="400" value={extTop} onChange={e => setExtAll(e.target.value)} className="w-full" /></Tooltip>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {numInput('Top (px)', 'Space to add above the image, in pixels.', extTop, setExtTop)}
                {numInput('Right (px)', 'Space to add to the right of the image, in pixels.', extRight, setExtRight)}
                {numInput('Bottom (px)', 'Space to add below the image, in pixels.', extBottom, setExtBottom)}
                {numInput('Left (px)', 'Space to add to the left of the image, in pixels.', extLeft, setExtLeft)}
              </div>
            )}
            {aiTooMuch && <p className="text-xs" style={{ color: '#f59e0b' }}>AI fill can add at most twice the picture's width and height. Add less space, or run it twice (send the result back here with Use in…).</p>}
            {extError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{extError}</div>}
            <Tooltip text={fill === 'ai' ? 'Send the picture to the AI to paint the new space. Takes 10 to 30 seconds.' : 'Add the space with the settings above.'}><button type="button" onClick={runExtend} disabled={extBusy || !extSource?.imageDataUrl || aiTooMuch} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {extBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon(fill === 'ai' ? 'sparkles' : 'frame', { size: 15 })}
              {extBusy ? 'Working...' : (fill === 'ai' ? 'Extend with AI fill' : 'Add space')}
            </button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              {extResult?.imageDataUrl && (
                <div className="flex items-center gap-2">
                  {renderSendTo(extResult.imageDataUrl, `extended-${extResult.width}x${extResult.height}.${extResult.format === 'jpeg' ? 'jpg' : extResult.format}`, 'extend')}
                  {renderExport(extResult.imageDataUrl, `extended-${extResult.width}x${extResult.height}`)}
                  <Tooltip text="Save the extended image to your device."><button onClick={() => downloadDataUrl(extResult.imageDataUrl, `extended-${extResult.width}x${extResult.height}.${extResult.format === 'jpeg' ? 'jpg' : extResult.format}`)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download</button></Tooltip>
                </div>
              )}
            </div>
            <div className="p-4">
              {extResult?.imageDataUrl ? (
                <>
                  <button type="button" onClick={() => setPreviewImage(extResult)} className="block w-full rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', backgroundColor: '#fff', backgroundImage: 'linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eee 75%),linear-gradient(-45deg,transparent 75%,#eee 75%)', backgroundSize: '16px 16px', backgroundPosition: '0 0,0 8px,8px -8px,-8px 0' }}>
                    <img src={extResult.imageDataUrl} alt="result" className="w-full" />
                  </button>
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{extResult.width}×{extResult.height} · {String(extResult.format).toUpperCase()} · {formatBytes(extResult.bytes)}</p>
                  {extResult.ai && extResult.cost && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{formatCost(extResult.cost)} · not right? Run it again for a different fill.</p>}
                </>
              ) : <ResultPlaceholder src={extSource?.imageDataUrl} message="Your result will appear here." />}
            </div>
          </div>
        </div>
      </section>
    </VoiceInputProvider>
  );
}
