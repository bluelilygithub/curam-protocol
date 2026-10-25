import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useEffect } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { STYLE_PRESETS, useProcessingWhile, formatCost, CostNote } from '../shared';

export default function GenerateTool({ active }) {
  const getIcon = useIcon();
  const { result, setPreviewImage, setResult, status } = useGraphics();
  const isHostedProvider = status?.hosted || (status?.provider && status.provider !== 'local-comfyui');

  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('editorial');
  const [size, setSize] = useState('512x512');
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [augmenting, setAugmenting] = useState(false);
  const [error, setError] = useState('');
  const [refinedPrompt, setRefinedPrompt] = useState('');
  const [augmentPrompt, setAugmentPrompt] = useState('');
  const [denoise, setDenoise] = useState('0.45');
  const [gallery, setGallery] = useState([]);
  const [saving, setSaving] = useState(false);
  const [restrictionWarning, setRestrictionWarning] = useState(null);

  // Image-to-image augmentation is supported on local ComfyUI and on FAL (via its
  // /image-to-image endpoint). Other hosted providers don't support it yet.
  const augmentSupported = !isHostedProvider || status?.provider === 'fal';

  const loadGallery = () => {
    api.get('/api/graphics/gallery')
      .then(r => r.json())
      .then(d => setGallery(Array.isArray(d) ? d : []))
      .catch(() => {});
  };

  const buildPrompt = () => {
    const preset = STYLE_PRESETS.find(s => s.id === style);
    return [prompt.trim(), preset?.suffix].filter(Boolean).join(', ');
  };

  const refinePrompt = async () => {
    if (!prompt.trim()) return '';
    setRefining(true);
    setError('');
    try {
      const res = await api.post('/api/graphics/refine', { prompt: buildPrompt() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Prompt refinement failed');
      setRefinedPrompt(data.refinedPrompt || buildPrompt());
      return data.refinedPrompt || buildPrompt();
    } catch (err) {
      setError(err.message || 'Prompt refinement failed');
      return '';
    } finally {
      setRefining(false);
    }
  };

  const checkRestrictions = async (promptText) => {
    const res = await api.post('/api/graphics/preflight', { prompt: promptText });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Content restriction check failed');
    return data;
  };

  const performGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError('');
    setRestrictionWarning(null);
    try {
      setRefinedPrompt('');
      setPreviewImage(null);
      const [genW, genH] = String(size).split('x').map(Number);
      const res = await api.post('/api/graphics/generate', {
        prompt: buildPrompt(),
        width: genW || 512,
        height: genH || 512,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Image generation failed');
      setResult(data);
      setRefinedPrompt(data.refinedPrompt || data.prompt || buildPrompt());
    } catch (err) {
      setError(err.message || 'Image generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const generate = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    setError('');
    try {
      const preflight = await checkRestrictions(buildPrompt());
      if (preflight.restricted) {
        setRestrictionWarning(preflight);
        return;
      }
      await performGenerate();
    } catch (err) {
      setError(err.message || 'Content restriction check failed');
    }
  };

  const downloadImage = () => {
    if (!result?.imageDataUrl) return;
    const a = document.createElement('a');
    a.href = result.imageDataUrl;
    a.download = `graphic-${Date.now()}.png`;
    a.click();
  };

  const selectResult = (item, { openPreview = false } = {}) => {
    if (!item) return;
    setResult(item);
    setRefinedPrompt(item.refinedPrompt || item.prompt || '');
    if (openPreview) setPreviewImage(item);
  };

  const augmentImage = async () => {
    if (!result?.imageDataUrl || !augmentPrompt.trim()) return;
    setAugmenting(true);
    setError('');
    setPreviewImage(null);
    try {
      const res = await api.post('/api/graphics/augment', {
        imageDataUrl: result.imageDataUrl,
        prompt: augmentPrompt.trim(),
        denoise: Number(denoise),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Image augmentation failed');
      setResult(data);
      setRefinedPrompt(data.refinedPrompt || data.prompt || '');
      setAugmentPrompt('');
    } catch (err) {
      setError(err.message || 'Image augmentation failed');
    } finally {
      setAugmenting(false);
    }
  };

  const saveToGallery = async () => {
    if (!result?.imageDataUrl) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.post('/api/graphics/gallery', {
        prompt: result.refinedPrompt || result.prompt,
        imageDataUrl: result.imageDataUrl,
        model: result.model,
        seed: result.seed,
        width: result.width,
        height: result.height,
        metadata: {
          image: result.image,
          denoise: result.denoise || null,
          originalPrompt: result.prompt || null,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save image');
      setGallery(prev => [data, ...prev]);
    } catch (err) {
      setError(err.message || 'Failed to save image');
    } finally {
      setSaving(false);
    }
  };

  // The gallery grid only has small previews; fetch the full-size image when one is opened.
  const openGalleryItem = (item) => async () => {
    try {
      const res = await api.get(`/api/graphics/gallery/${item.id}`);
      const full = await res.json();
      if (!res.ok) throw new Error(full.error || 'Could not open that image');
      selectResult(full, { openPreview: true });
    } catch (err) {
      setError(err.message || 'Could not open that image');
    }
  };

  const deleteGalleryImage = async (id) => {
    await api.delete(`/api/graphics/gallery/${id}`).catch(() => {});
    setGallery(prev => prev.filter(item => item.id !== id));
  };

  useEffect(() => { loadGallery(); }, []);

  useProcessingWhile(generating ? 'Generating image…' : refining ? 'Refining image…' : augmenting ? 'Creating variations…' : saving ? 'Saving…' : null);

  return (
    <>
      <div className="grid lg:grid-cols-[1fr_420px] gap-6">
        <form onSubmit={generate} className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>
              Image prompt
            </label>
            <Tooltip text="Describe what you want the image to show — the AI turns this description into a picture."><textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={7}
              placeholder="Describe the image you want for the story or article..."
              className="w-full px-3 py-2 rounded-xl border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            /></Tooltip>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Style</label>
              <Tooltip text="Sets the overall artistic look applied to the generated image."><select
                value={style}
                onChange={e => setStyle(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                {STYLE_PRESETS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select></Tooltip>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Size</label>
              <Tooltip text="Sets the pixel dimensions and shape (square, landscape or portrait) of the generated image."><select
                value={size}
                onChange={e => setSize(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                <option value="512x512">Square · 512 × 512 (fastest)</option>
                <option value="768x768">Square · 768 × 768</option>
                <option value="1024x768">Landscape 4:3 · 1024 × 768</option>
                <option value="768x1024">Portrait 4:3 · 768 × 1024</option>
                <option value="1024x576">Landscape 16:9 · 1024 × 576</option>
                <option value="576x1024">Portrait 9:16 · 576 × 1024</option>
              </select></Tooltip>
            </div>
          </div>

          {error && (
            <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>
              {error}
            </div>
          )}

          {status && !status.ok && (
            <div className="text-xs px-3 py-2 rounded-xl" style={{ color: '#92400e', background: '#fef3c7' }}>
              {status.error || (isHostedProvider ? 'Check the hosted graphics provider configuration before generating images.' : 'Start ComfyUI locally on http://127.0.0.1:8188 before generating images.')}
            </div>
          )}

          <CostNote tool="generate" refreshKey={result} />
          <Tooltip text="Send the prompt to the image model and create a new image."><button
            type="submit"
            disabled={generating || !prompt.trim() || status?.ok === false}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-opacity inline-flex items-center gap-2"
            style={{ background: 'var(--color-primary)' }}
          >
            {generating ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('sparkles', { size: 15 })}
            {generating ? 'Refining + generating...' : 'Generate Image'}
          </button></Tooltip>
          <Tooltip text="Preview the improved version of your prompt the AI will actually use, without generating an image yet."><button
            type="button"
            onClick={refinePrompt}
            disabled={refining || generating || !prompt.trim()}
            className="ml-2 px-3 py-2 rounded-xl text-sm font-medium border disabled:opacity-50 hover:opacity-80 transition-opacity"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent' }}
          >
            {refining ? 'Refining...' : 'Refine Prompt'}
          </button></Tooltip>

          <div className="rounded-xl border px-3 py-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Refined prompt sent to image model</p>
            <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>
              {refinedPrompt || (prompt.trim() ? 'Click Refine Prompt or Generate Image to create the refined prompt.' : 'Enter a prompt and choose a style.')}
            </p>
          </div>
        </form>

        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
            {result?.imageDataUrl && (
              <div className="flex gap-2">
                <Tooltip text="Keep this generated image in your Graphics gallery for later."><button
                  onClick={saveToGallery}
                  disabled={saving}
                  className="text-xs px-2 py-1 rounded-lg border hover:opacity-70 disabled:opacity-50"
                  style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button></Tooltip>
                <Tooltip text="Save this image to your device."><button
                  onClick={downloadImage}
                  className="text-xs px-2 py-1 rounded-lg border hover:opacity-70"
                  style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                >
                  Download
                </button></Tooltip>
              </div>
            )}
          </div>
          <div className="p-4">
            {result?.imageDataUrl ? (
              <>
                <button
                  type="button"
                  onClick={() => setPreviewImage(result)}
                  className="block w-full"
                >
                  <img
                    src={result.imageDataUrl}
                    alt={result.refinedPrompt || result.prompt}
                    className="w-full rounded-xl border"
                    style={{ borderColor: 'var(--color-border)' }}
                  />
                </button>
                <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
                  Seed: {result.seed} · Model: {result.model}
                </p>
                {result.cost && (
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                    {formatCost(result.cost)}
                  </p>
                )}
                {!augmentSupported ? (
                  <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      Variations (image-to-image) require the local ComfyUI provider or a FAL model, so this step is unavailable on the current provider.
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 border-t pt-4 space-y-3" style={{ borderColor: 'var(--color-border)' }}>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>
                        Augment this image
                      </label>
                      <Tooltip text="Describe how you want this image changed — the AI creates a new variation based on your current image plus this description."><textarea
                        value={augmentPrompt}
                        onChange={e => setAugmentPrompt(e.target.value)}
                        rows={3}
                        placeholder="e.g. make it more photographic, add sunset lighting, change background..."
                        className="w-full px-3 py-2 rounded-xl border text-sm outline-none"
                        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                      /></Tooltip>
                    </div>
                    <CostNote tool="augment" refreshKey={result} />
                    <div className="flex items-center gap-3">
                      <label className="text-xs" style={{ color: 'var(--color-muted)' }}>Change strength</label>
                      <Tooltip text="How far the new version can drift from the original image — higher makes bigger changes."><select
                        value={denoise}
                        onChange={e => setDenoise(e.target.value)}
                        className="px-2 py-1 rounded-lg border text-xs"
                        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                      >
                        <option value="0.3">Subtle</option>
                        <option value="0.45">Medium</option>
                        <option value="0.65">Strong</option>
                      </select></Tooltip>
                      <Tooltip text="Generate a new variation of this image using the description above."><button
                        type="button"
                        onClick={augmentImage}
                        disabled={augmenting || !augmentPrompt.trim()}
                        className="ml-auto text-xs px-3 py-1.5 rounded-lg font-semibold text-white disabled:opacity-50"
                        style={{ background: 'var(--color-primary)' }}
                      >
                        {augmenting ? 'Augmenting...' : 'Augment'}
                      </button></Tooltip>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="aspect-square rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>
                Your generated image will appear here.
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Gallery</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{gallery.length} saved</span>
        </div>
        {gallery.length === 0 ? (
          <div className="rounded-xl border px-4 py-6 text-sm text-center" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
            Save generated images to collect useful article and story graphics here.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {gallery.map(item => (
              <div key={item.id} className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <button
                  type="button"
                  onClick={openGalleryItem(item)}
                  className="block w-full"
                >
                  {item.thumbDataUrl
                    ? <img src={item.thumbDataUrl} alt={item.prompt} className="w-full aspect-square object-cover" />
                    : <div className="w-full aspect-square flex items-center justify-center text-xs" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>Preparing preview…</div>}
                </button>
                <div className="p-3">
                  <p className="text-xs line-clamp-2" style={{ color: 'var(--color-text)' }}>{item.prompt}</p>
                  <div className="flex justify-between items-center mt-3">
                    <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{item.model || 'local image'}</span>
                    <button
                      onClick={() => deleteGalleryImage(item.id)}
                      className="text-xs hover:opacity-70"
                      style={{ color: '#ef4444' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {restrictionWarning && !generating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
          <div className="w-full max-w-md rounded-2xl border p-5 shadow-xl" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
              This description is not allowed
            </h2>
            <p className="text-sm mt-2" style={{ color: 'var(--color-muted)' }}>
              It matches content restrictions set by your admin, so no image will be made from it. Change the description and try again.
            </p>
            <div className="mt-3 rounded-xl border px-3 py-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Matched restrictions</p>
              <ul className="text-sm space-y-1" style={{ color: 'var(--color-text)' }}>
                {restrictionWarning.matches?.map((match, index) => (
                  <li key={`${match.restriction}-${index}`}>- {match.restriction}</li>
                ))}
              </ul>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRestrictionWarning(null)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90"
                style={{ background: 'var(--color-primary)' }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
