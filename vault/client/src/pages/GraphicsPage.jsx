import React, { useEffect, useState } from 'react';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';

const STYLE_PRESETS = [
  { id: 'editorial', label: 'Editorial illustration', suffix: 'editorial illustration, clean composition, article header image' },
  { id: 'photo', label: 'Photographic', suffix: 'photorealistic image, natural lighting, realistic camera depth of field, documentary photography style' },
  { id: 'storybook', label: 'Storybook', suffix: 'storybook illustration, warm, detailed, narrative scene' },
  { id: 'cinematic', label: 'Cinematic', suffix: 'cinematic concept art, dramatic lighting, high detail' },
  { id: 'minimal', label: 'Minimal graphic', suffix: 'minimal vector-style graphic, simple shapes, clean background' },
];

export default function GraphicsPage() {
  const getIcon = useIcon();
  const [status, setStatus] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('editorial');
  const [size, setSize] = useState('512');
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [augmenting, setAugmenting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [refinedPrompt, setRefinedPrompt] = useState('');
  const [augmentPrompt, setAugmentPrompt] = useState('');
  const [denoise, setDenoise] = useState('0.45');
  const [gallery, setGallery] = useState([]);
  const [saving, setSaving] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [restrictionWarning, setRestrictionWarning] = useState(null);
  const [upscaleInfo, setUpscaleInfo] = useState(null);
  const [upscaleSource, setUpscaleSource] = useState(null);
  const [upscaleScale, setUpscaleScale] = useState('4');
  const [upscaleFidelity, setUpscaleFidelity] = useState('-8');
  const [upscaling, setUpscaling] = useState(false);
  const [upscaleResult, setUpscaleResult] = useState(null);
  const [upscaleError, setUpscaleError] = useState('');
  const isHostedProvider = status?.hosted || (status?.provider && status.provider !== 'local-comfyui');
  const serviceLabel = isHostedProvider
    ? `${status?.provider || 'Hosted'} ready: ${status?.model || 'model not selected'}`
    : `ComfyUI ready: ${status?.model}`;
  const statusLabel = !status
    ? 'Checking graphics provider...'
    : status.ok
      ? serviceLabel
      : `${isHostedProvider ? status?.provider || 'Graphics provider' : 'ComfyUI'} not ready`;

  useEffect(() => {
    api.get('/api/graphics/status')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus({ ok: false, hosted: true, provider: 'Graphics provider', error: 'Unable to check graphics service' }));
    api.get('/api/graphics/upscale/info')
      .then(r => r.json())
      .then(info => {
        setUpscaleInfo(info);
        if (Array.isArray(info?.scales) && !info.scales.includes(Number(upscaleScale))) {
          setUpscaleScale(String(info.scales[0]));
        }
      })
      .catch(() => {});
    loadGallery();
  }, []);

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

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
      const res = await api.post('/api/graphics/generate', {
        prompt: buildPrompt(),
        width: Number(size),
        height: Number(size),
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

  const deleteGalleryImage = async (id) => {
    await api.delete(`/api/graphics/gallery/${id}`).catch(() => {});
    setGallery(prev => prev.filter(item => item.id !== id));
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            {getIcon('image', { size: 20 })}
            Graphics
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            Generate local article and story support images from a prompt.
          </p>
        </div>
        <div
          className="text-xs px-3 py-1.5 rounded-full border"
          style={{
            color: status?.ok ? '#047857' : '#b45309',
            borderColor: status?.ok ? '#bbf7d0' : '#fde68a',
            background: status?.ok ? '#ecfdf5' : '#fffbeb',
          }}
        >
          {statusLabel}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_420px] gap-6">
        <form onSubmit={generate} className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>
              Image prompt
            </label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={7}
              placeholder="Describe the image you want for the story or article..."
              className="w-full px-3 py-2 rounded-xl border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Style</label>
              <select
                value={style}
                onChange={e => setStyle(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                {STYLE_PRESETS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Size</label>
              <select
                value={size}
                onChange={e => setSize(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                <option value="512">512 x 512 (fastest)</option>
                <option value="768">768 x 768</option>
              </select>
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

          <button
            type="submit"
            disabled={generating || !prompt.trim() || status?.ok === false}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-opacity inline-flex items-center gap-2"
            style={{ background: 'var(--color-primary)' }}
          >
            {generating ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('sparkles', { size: 15 })}
            {generating ? 'Refining + generating...' : 'Generate Image'}
          </button>
          <button
            type="button"
            onClick={refinePrompt}
            disabled={refining || generating || !prompt.trim()}
            className="ml-2 px-3 py-2 rounded-xl text-sm font-medium border disabled:opacity-50 hover:opacity-80 transition-opacity"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent' }}
          >
            {refining ? 'Refining...' : 'Refine Prompt'}
          </button>

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
                <button
                  onClick={saveToGallery}
                  disabled={saving}
                  className="text-xs px-2 py-1 rounded-lg border hover:opacity-70 disabled:opacity-50"
                  style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={downloadImage}
                  className="text-xs px-2 py-1 rounded-lg border hover:opacity-70"
                  style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                >
                  Download
                </button>
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
                <div className="mt-4 border-t pt-4 space-y-3" style={{ borderColor: 'var(--color-border)' }}>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>
                      Augment this image
                    </label>
                    <textarea
                      value={augmentPrompt}
                      onChange={e => setAugmentPrompt(e.target.value)}
                      rows={3}
                      placeholder="e.g. make it more photographic, add sunset lighting, change background..."
                      className="w-full px-3 py-2 rounded-xl border text-sm outline-none"
                      style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-xs" style={{ color: 'var(--color-muted)' }}>Change strength</label>
                    <select
                      value={denoise}
                      onChange={e => setDenoise(e.target.value)}
                      className="px-2 py-1 rounded-lg border text-xs"
                      style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    >
                      <option value="0.3">Subtle</option>
                      <option value="0.45">Medium</option>
                      <option value="0.65">Strong</option>
                    </select>
                    <button
                      type="button"
                      onClick={augmentImage}
                      disabled={augmenting || !augmentPrompt.trim()}
                      className="ml-auto text-xs px-3 py-1.5 rounded-lg font-semibold text-white disabled:opacity-50"
                      style={{ background: 'var(--color-primary)' }}
                    >
                      {augmenting ? 'Augmenting...' : 'Augment'}
                    </button>
                  </div>
                </div>
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
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Upscale</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {upscaleInfo
              ? `${upscaleInfo.provider === 'local-comfyui' ? 'Local' : 'Hosted'}: ${upscaleInfo.model || 'not configured'}`
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
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={e => handleUpscaleFile(e.target.files?.[0])}
                className="block w-full text-xs"
                style={{ color: 'var(--color-text)' }}
              />
              {result?.imageDataUrl && (
                <button
                  type="button"
                  onClick={useResultForUpscale}
                  className="mt-2 text-xs px-2 py-1 rounded-lg border hover:opacity-70"
                  style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                >
                  Use current result
                </button>
              )}
            </div>

            {upscaleSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={upscaleSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
                <p className="text-[11px] mt-1 text-center" style={{ color: 'var(--color-muted)' }}>{upscaleSource.name}</p>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Scale</label>
                <select
                  value={upscaleScale}
                  onChange={e => setUpscaleScale(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border text-sm"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {(upscaleInfo?.scales || [2, 4]).map(s => <option key={s} value={s}>{s}x</option>)}
                </select>
              </div>
              {upscaleInfo?.creativitySupported && (
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Fidelity</label>
                  <select
                    value={upscaleFidelity}
                    onChange={e => setUpscaleFidelity(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border text-sm"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    <option value="-8">Maximum fidelity</option>
                    <option value="0">Balanced</option>
                    <option value="5">Add detail</option>
                  </select>
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

            <button
              type="button"
              onClick={runUpscale}
              disabled={upscaling || !upscaleSource?.imageDataUrl || upscaleInfo?.configured === false}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2"
              style={{ background: 'var(--color-primary)' }}
            >
              {upscaling ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('sparkles', { size: 15 })}
              {upscaling ? 'Upscaling...' : 'Upscale image'}
            </button>
          </div>

          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Upscaled result</span>
              {upscaleResult?.imageDataUrl && (
                <button
                  onClick={downloadUpscaled}
                  className="text-xs px-2 py-1 rounded-lg border hover:opacity-70"
                  style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                >
                  Download
                </button>
              )}
            </div>
            <div className="p-4">
              {upscaleResult?.imageDataUrl ? (
                <>
                  <button type="button" onClick={() => setPreviewImage(upscaleResult)} className="block w-full">
                    <img src={upscaleResult.imageDataUrl} alt="upscaled" className="w-full rounded-xl border" style={{ borderColor: 'var(--color-border)' }} />
                  </button>
                  <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
                    {upscaleResult.scale}x · {upscaleResult.model}
                  </p>
                </>
              ) : (
                <div className="aspect-square rounded-xl border flex items-center justify-center text-sm text-center px-6" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>
                  Your upscaled image will appear here.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

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
                  onClick={() => {
                    selectResult(item, { openPreview: true });
                  }}
                  className="block w-full"
                >
                  <img src={item.imageDataUrl} alt={item.prompt} className="w-full aspect-square object-cover" />
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
              Content restriction detected
            </h2>
            <p className="text-sm mt-2" style={{ color: 'var(--color-muted)' }}>
              This prompt appears to match admin restrictions. If you continue, the refined prompt may remove or redirect that content before image generation.
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
                className="px-4 py-2 rounded-xl text-sm font-medium border hover:opacity-80"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={performGenerate}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90"
                style={{ background: 'var(--color-primary)' }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {(generating || augmenting) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
          <div className="w-full max-w-sm rounded-2xl border p-5 text-center shadow-xl" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="mx-auto mb-3 h-10 w-10 rounded-full flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>
              {getIcon('loader', { size: 22, className: 'animate-spin' })}
            </div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
              {augmenting ? 'Augmenting image' : 'Creating image'}
            </h2>
            <p className="text-sm mt-2" style={{ color: 'var(--color-muted)' }}>
              Refining the prompt and generating locally with ComfyUI. This can take a little while.
            </p>
          </div>
        </div>
      )}

      {previewImage?.imageDataUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
          style={{ background: 'rgba(0,0,0,0.72)' }}
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="w-full max-w-4xl max-h-full rounded-2xl border overflow-hidden shadow-xl"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b flex items-center justify-between gap-3" style={{ borderColor: 'var(--color-border)' }}>
              <div>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  Generated image
                </h2>
                <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                  Seed: {previewImage.seed || 'n/a'} · Model: {previewImage.model || 'local image'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70"
                style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}
              >
                Close
              </button>
            </div>
            <div className="p-4 overflow-auto max-h-[80vh]">
              <img
                src={previewImage.imageDataUrl}
                alt={previewImage.refinedPrompt || previewImage.prompt}
                className="w-full rounded-xl border"
                style={{ borderColor: 'var(--color-border)' }}
              />
              <p className="text-xs mt-3 whitespace-pre-wrap" style={{ color: 'var(--color-muted)' }}>
                {previewImage.refinedPrompt || previewImage.prompt}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
