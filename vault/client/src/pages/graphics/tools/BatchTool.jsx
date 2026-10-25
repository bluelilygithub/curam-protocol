import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useEffect, useRef } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { readFileAsDataUrl, useProcessingWhile, formatBytes, useGraphicsRecipes, CostNote } from '../shared';
import { BATCH_KEEP } from '../historyStore.mjs';

export default function BatchTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool, recordHistory } = useGraphics();

  const [batchFiles, setBatchFiles] = useState([]);
  // "Run a recipe": a saved Pipeline recipe applied to every picture (server reads the steps from the recipe, see Pipeline -> Save recipe)
  const { recipes } = useGraphicsRecipes();
  const [batchRecipeId, setBatchRecipeId] = useState('');
  // A recipe with an AI step (remove background / upscale) costs money per picture: it is priced before it starts, and sent a few pictures at a time.
  const chosenRecipe = batchOp === 'recipe' ? recipes.find((r) => String(r.id) === String(batchRecipeId)) : null;
  const aiOps = (chosenRecipe?.steps || []).filter((s) => s.op === 'removebg' || s.op === 'upscale').map((s) => s.op);
  const perCall = aiOps.includes('upscale') ? 4 : aiOps.includes('removebg') ? 8 : Infinity;
  // An AI batch runs as a background job on the server: this page starts it, checks on it every couple of seconds, and collects the results.
  const cancelBatch = useRef(false);
  const currentJob = useRef(null);
  const [jobProgress, setJobProgress] = useState(null); // { done, total } across the whole batch
  const [pendingSize, setPendingSize] = useState({ width: 0, height: 0 }); // the largest waiting picture, to quote an upscale
  const pendingKey = batchFiles.filter(f => f.imageDataUrl && f.status !== 'done').map(f => f.id).join('|');
  useEffect(() => {
    if (!aiOps.length) return undefined;
    let off = false;
    (async () => {
      let width = 0; let height = 0;
      for (const f of batchFiles.filter(x => x.imageDataUrl && x.status !== 'done')) {
        // eslint-disable-next-line no-await-in-loop
        const dims = await new Promise((resolve) => { const i = new Image(); i.onload = () => resolve({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => resolve({ w: 0, h: 0 }); i.src = f.imageDataUrl; });
        if (dims.w * dims.h > width * height) { width = dims.w; height = dims.h; }
      }
      if (!off) setPendingSize({ width, height });
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey, aiOps.length]);
  const [batchOp, setBatchOp] = useState('convert');
  const [batchFormat, setBatchFormat] = useState('webp');
  const [batchQuality, setBatchQuality] = useState('82');
  const [batchWidth, setBatchWidth] = useState('1600');
  const [batchHeight, setBatchHeight] = useState('');
  const [batchFit, setBatchFit] = useState('inside');
  const [batchRunning, setBatchRunning] = useState(false);

  // Batch (extended): watermark / compress param panels + social presets list.
  const [batchWmText, setBatchWmText] = useState('© My Brand');

  const [batchWmColor, setBatchWmColor] = useState('#ffffff');
  const [batchWmPosition, setBatchWmPosition] = useState('bottom-right');
  const [batchWmOpacity, setBatchWmOpacity] = useState('0.5');
  const [batchCompressQuality, setBatchCompressQuality] = useState('75');

  const handleBatchFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const items = await Promise.all(files.map(async (file) => {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        return { id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`, name: file.name, imageDataUrl: dataUrl, originalBytes: file.size, status: 'ready', result: null, error: '' };
      } catch {
        return { id: `${file.name}-${Math.random().toString(36).slice(2, 7)}`, name: file.name, imageDataUrl: null, originalBytes: file.size, status: 'error', result: null, error: 'Could not read file' };
      }
    }));
    setBatchFiles(prev => [...prev, ...items]);
  };

  const removeBatchFile = (id) => setBatchFiles(prev => prev.filter(f => f.id !== id));

  const clearBatchFiles = () => setBatchFiles([]);

  // Params for the ops that go through the single-call POST /api/graphics/batch
  // endpoint (convert/resize/watermark/compress). 'strip' has no server batch
  // support yet, so it still loops per-file below.
  const buildBatchParams = () => {
    if (batchOp === 'convert') return { format: batchFormat, quality: Number(batchQuality) };
    if (batchOp === 'resize') {
      const params = { op: 'resize', fit: batchFit };
      if (batchWidth) params.width = Number(batchWidth);
      if (batchHeight) params.height = Number(batchHeight);
      return params;
    }
    if (batchOp === 'watermark') {
      return { type: 'text', text: batchWmText, color: batchWmColor, position: batchWmPosition, opacity: Number(batchWmOpacity) };
    }
    if (batchOp === 'compress') return { quality: Number(batchCompressQuality) };
    if (batchOp === 'recipe') return { recipeId: Number(batchRecipeId) };
    return {};
  };

  const runBatchAll = async () => {
    const pending = batchFiles.filter(f => f.imageDataUrl && f.status !== 'done');
    if (!pending.length) return;
    if (batchOp === 'resize' && !batchWidth && !batchHeight) return;
    if (batchOp === 'watermark' && !batchWmText.trim()) return;
    if (batchOp === 'recipe' && !batchRecipeId) return;
    cancelBatch.current = false;
    setBatchRunning(true);
    setBatchFiles(prev => prev.map(f => (pending.some(p => p.id === f.id) ? { ...f, status: 'working', error: '' } : f)));

    if (batchOp === 'strip') {
      for (const item of pending) {
        try {
          const res = await api.post('/api/graphics/strip-metadata', { imageDataUrl: item.imageDataUrl }); // eslint-disable-line no-await-in-loop
          const data = await res.json(); // eslint-disable-line no-await-in-loop
          if (!res.ok) throw new Error(data.error || 'Operation failed');
          setBatchFiles(prev => prev.map(f => (f.id === item.id ? { ...f, status: 'done', result: data } : f)));
        } catch (err) {
          setBatchFiles(prev => prev.map(f => (f.id === item.id ? { ...f, status: 'error', error: err.message || 'Operation failed' } : f)));
        }
      }
      setBatchRunning(false);
      return;
    }

    // (a picture that already finished stays finished)
    const failAll = (items, message) => setBatchFiles(prev => prev.map(f => (f.status !== 'done' && items.some(p => p.id === f.id) ? { ...f, status: 'error', error: message } : f)));
    const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

    const applyResults = (chunk, results, notDone) => setBatchFiles(prev => prev.map(f => {
      const idx = chunk.findIndex(p => p.id === f.id);
      if (idx === -1) return f;
      const itemResult = results?.[idx];
      if (!itemResult) return notDone(f);
      if (itemResult.error) return { ...f, status: 'error', error: itemResult.error };
      return { ...f, status: 'done', result: itemResult };
    }));

    // One chunk of an AI batch as a background job: start it, check on it every 2 seconds, then collect the results.
    const sendChunkAsJob = async (chunk, doneBefore, allCount) => {
      const startRes = await api.post('/api/graphics/batch-job', {
        op: 'pipeline',
        items: chunk.map(item => ({ imageDataUrl: item.imageDataUrl })),
        params: buildBatchParams(),
      });
      const started = await startRes.json();
      if (!startRes.ok) throw new Error(started.error || 'Could not start the batch');
      const jobId = started.jobId;
      currentJob.current = jobId;
      setJobProgress({ done: doneBefore, total: allCount });
      let status = { status: 'running', done: 0 };
      let misses = 0;
      while (status.status === 'running') {
        await sleep(2000); // eslint-disable-line no-await-in-loop
        try {
          const r = await api.get(`/api/graphics/batch-jobs/${jobId}`); // eslint-disable-line no-await-in-loop
          if (r.status === 404) throw Object.assign(new Error('Lost track of this batch (the server may have restarted). Run it again; pictures already finished are kept.'), { fatal: true });
          status = await r.json(); // eslint-disable-line no-await-in-loop
          misses = 0;
          setJobProgress({ done: doneBefore + (status.done || 0), total: allCount });
        } catch (err) {
          misses += 1;
          if (err.fatal || misses >= 4) throw err; // a missed check or two (a network blip) is fine
        }
      }
      currentJob.current = null;
      const rr = await api.get(`/api/graphics/batch-jobs/${jobId}/results`);
      const data = await rr.json();
      if (!rr.ok) throw new Error(data.error || 'Could not collect the results');
      const stopped = status.status === 'cancelled';
      applyResults(chunk, data.results, (f) => (stopped ? { ...f, status: 'ready', error: '' } : { ...f, status: 'error', error: status.error || 'Not processed' }));
      if (status.status === 'error') throw new Error(status.error || 'The batch failed');
    };

    const sendChunk = async (chunk, doneBefore = 0, allCount = chunk.length) => {
      if (aiOps.length) return sendChunkAsJob(chunk, doneBefore, allCount);
      const res = await api.post('/api/graphics/batch', {
        op: batchOp === 'recipe' ? 'pipeline' : batchOp,
        items: chunk.map(item => ({ imageDataUrl: item.imageDataUrl })),
        params: buildBatchParams(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Batch operation failed');
      applyResults(chunk, data.results, (f) => ({ ...f, status: 'error', error: 'Operation failed' }));
    };

    // With an AI step: ask first what the whole batch will cost, and do not start if it would pass today's limit.
    if (aiOps.length) {
      try {
        const q = new URLSearchParams({ tool: 'recipe', recipeId: String(batchRecipeId), runs: String(pending.length), width: String(pendingSize.width || ''), height: String(pendingSize.height || '') });
        const res = await api.get(`/api/graphics/cost-preview?${q}`);
        const quote = res.ok ? await res.json() : null;
        if (quote?.blocked || quote?.overLimit) {
          failAll(pending, quote.blocked
            ? "Today's limit for AI image tools is used up. It frees up as older jobs pass 24 hours."
            : `This batch would cost about $${Number(quote.totalUsd).toFixed(2)}, but only $${Number(quote.remainingUsd).toFixed(2)} of today's limit is left. Run fewer pictures, or try again later.`);
          setBatchRunning(false);
          return;
        }
      } catch { /* if the quote cannot be read, the server still checks before it starts */ }
    }

    const size = Number.isFinite(perCall) ? perCall : pending.length;
    for (let i = 0; i < pending.length; i += size) {
      if (cancelBatch.current) break;
      const chunk = pending.slice(i, i + size);
      try {
        await sendChunk(chunk, i, pending.length); // eslint-disable-line no-await-in-loop
      } catch (err) {
        failAll(pending.slice(i), err.message || 'Batch operation failed'); // this call and the ones after it; earlier ones are done
        break;
      }
    }
    if (cancelBatch.current) setBatchFiles(prev => prev.map(f => (f.status === 'working' ? { ...f, status: 'ready', error: '' } : f))); // cancelled: left for another go
    currentJob.current = null;
    setJobProgress(null);
    setBatchRunning(false);
  };

  const cancelRun = async () => {
    cancelBatch.current = true;
    const id = currentJob.current;
    if (id) { try { await api.delete(`/api/graphics/batch-jobs/${id}`); } catch { /* the check on the job will see it has stopped */ } }
  };

  const batchResultName = (item) => {
    const base = item.name.replace(/\.[^.]+$/, '');
    const ext = item.result.ext || item.result.format || 'img';
    const suffixes = { convert: '', resize: '-resized', watermark: '-watermarked', compress: '-compressed', recipe: '-edited', strip: '-clean' };
    return `${base}${suffixes[batchOp] ?? '-clean'}.${ext}`;
  };

  const downloadBatchItem = (item) => {
    if (!item?.result?.imageDataUrl) return;
    const a = document.createElement('a');
    a.href = item.result.imageDataUrl;
    a.download = batchResultName(item);
    a.click();
  };

  // Recent results: keep the first few results of each run (a batch can make 25, which would push everything else out of the history).
  const keptThisRun = useRef(0);
  const keptIds = useRef(new Set());
  useEffect(() => { if (batchRunning) keptThisRun.current = 0; }, [batchRunning]); // the ids already kept stay, so an earlier run's results are not saved again
  useEffect(() => {
    for (const f of batchFiles) {
      if (keptThisRun.current >= BATCH_KEEP) return;
      if (f.status !== 'done' || !f.result?.imageDataUrl || keptIds.current.has(f.id)) continue;
      keptIds.current.add(f.id);
      keptThisRun.current += 1;
      recordHistory?.({ tool: 'batch', name: batchResultName(f), dataUrl: f.result.imageDataUrl });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchFiles]);

  const downloadBatchAll = () => {
    batchFiles.filter(f => f.result?.imageDataUrl).forEach((item, i) => {
      setTimeout(() => downloadBatchItem(item), i * 150);
    });
  };

  // An AI batch shows its own progress and a Cancel button instead of blocking the page.
  useProcessingWhile(batchRunning && !aiOps.length ? 'Processing batch…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Batch process</h2>
            <button type="button" onClick={() => setHelpTool('batch')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Apply the same operation to many images at once — convert formats, resize, or strip metadata. Each file is processed and downloadable individually.
          </p>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Add images</label>
              <Tooltip text="Choose up to 25 image files to process together."><input
                type="file"
                accept="image/*"
                multiple
                onChange={e => { handleBatchFiles(e.target.files); e.target.value = ''; }}
                className="block w-full text-xs"
                style={{ color: 'var(--color-text)' }}
              /></Tooltip>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Operation</label>
              <Tooltip text="Which edit to apply to every image in this batch."><select
                value={batchOp}
                onChange={e => setBatchOp(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                <option value="convert">Convert format</option>
                <option value="resize">Resize</option>
                <option value="watermark">Add text watermark</option>
                <option value="compress">Compress</option>
                <option value="recipe">Run a recipe</option>
                <option value="strip">Strip metadata</option>
              </select></Tooltip>
            </div>
          </div>

          {batchOp === 'convert' && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Target format</label>
                <Tooltip text="File format every image in the batch will be converted to."><select value={batchFormat} onChange={e => setBatchFormat(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="png">PNG</option>
                  <option value="jpeg">JPG / JPEG</option>
                  <option value="webp">WebP</option>
                  <option value="gif">GIF</option>
                  <option value="avif">AVIF</option>
                  <option value="tiff">TIFF</option>
                  <option value="ico">ICO (favicon)</option>
                </select></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Quality (lossy formats): {batchQuality}</label>
                <Tooltip text="Compression quality for formats that support it — lower gives smaller files but reduces image quality."><input type="range" min="1" max="100" value={batchQuality} onChange={e => setBatchQuality(e.target.value)} className="w-full" /></Tooltip>
              </div>
            </div>
          )}

          {batchOp === 'resize' && (
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Width (px)</label>
                <Tooltip text="Target width in pixels for every image. Leave blank to size automatically from the height."><input type="number" min="1" value={batchWidth} onChange={e => setBatchWidth(e.target.value)} placeholder="auto" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Height (px)</label>
                <Tooltip text="Target height in pixels for every image. Leave blank to size automatically from the width."><input type="number" min="1" value={batchHeight} onChange={e => setBatchHeight(e.target.value)} placeholder="auto" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Fit</label>
                <Tooltip text="How each image should be fitted into the target size when its proportions don't match."><select value={batchFit} onChange={e => setBatchFit(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="inside">Inside (fit within)</option>
                  <option value="cover">Cover (fill + crop)</option>
                  <option value="contain">Contain (letterbox)</option>
                  <option value="fill">Fill (stretch)</option>
                  <option value="outside">Outside (cover area)</option>
                </select></Tooltip>
              </div>
            </div>
          )}

          {batchOp === 'watermark' && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Watermark text</label>
                <Tooltip text="Text to stamp onto every image in the batch."><input type="text" value={batchWmText} onChange={e => setBatchWmText(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Colour</label>
                  <Tooltip text="Colour of the watermark text."><input type="color" value={batchWmColor} onChange={e => setBatchWmColor(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Position</label>
                  <Tooltip text="Where the watermark text sits on each image."><select value={batchWmPosition} onChange={e => setBatchWmPosition(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    <option value="bottom-right">Bottom right</option>
                    <option value="bottom-left">Bottom left</option>
                    <option value="top-right">Top right</option>
                    <option value="top-left">Top left</option>
                    <option value="center">Centre</option>
                  </select></Tooltip>
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Opacity: {Math.round(Number(batchWmOpacity) * 100)}%</label>
                <Tooltip text="How see-through the watermark text is."><input type="range" min="0" max="1" step="0.05" value={batchWmOpacity} onChange={e => setBatchWmOpacity(e.target.value)} className="w-full" /></Tooltip>
              </div>
            </div>
          )}

          {batchOp === 'compress' && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Quality: {batchCompressQuality}</label>
              <Tooltip text="How much to compress every image — lower gives smaller files but more visible loss of detail."><input type="range" min="1" max="100" value={batchCompressQuality} onChange={e => setBatchCompressQuality(e.target.value)} className="w-full" /></Tooltip>
            </div>
          )}

          {batchOp === 'recipe' && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Recipe</label>
              <Tooltip text="Your saved recipe. Every step in it, and its file type, is applied to every picture in this batch."><select
                value={batchRecipeId}
                onChange={e => setBatchRecipeId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-sm"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                <option value="">{recipes.length ? 'Choose a recipe…' : 'No saved recipes yet'}</option>
                {recipes.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.steps.length} step{r.steps.length === 1 ? '' : 's'})</option>)}
              </select></Tooltip>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                {recipes.length ? (batchRecipeId ? (() => { const r = recipes.find((x) => String(x.id) === String(batchRecipeId)); return r ? `${r.steps.length} step${r.steps.length === 1 ? '' : 's'}${r.outFormat ? `, saved as ${r.outFormat.toUpperCase()}` : ''}.` : ''; })() : 'Pick one of your recipes.') : 'Build the steps in Pipeline, name them and press Save recipe. They will be here.'}
              </p>
            </div>
          )}

          {batchOp === 'recipe' && aiOps.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>This recipe uses an AI service ({aiOps.map(o => (o === 'removebg' ? 'remove background' : 'upscale')).join(' and ')}), so each picture costs a little. It runs {perCall} pictures at a time and may take a while.</p>
              <CostNote tool="recipe" extra={{ recipeId: batchRecipeId }} runs={Math.max(1, batchFiles.filter(f => f.imageDataUrl && f.status !== 'done').length)} width={pendingSize.width} height={pendingSize.height} refreshKey={batchRunning} />
            </div>
          )}

          {batchOp === 'strip' && (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Removes EXIF, GPS, XMP, IPTC and ICC data from every image. Format and dimensions are preserved.</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Tooltip text="Apply the chosen operation to every added image that hasn't been processed yet."><button
              type="button"
              onClick={runBatchAll}
              disabled={batchRunning || !batchFiles.some(f => f.imageDataUrl && f.status !== 'done') || (batchOp === 'resize' && !batchWidth && !batchHeight) || (batchOp === 'watermark' && !batchWmText.trim()) || (batchOp === 'recipe' && !batchRecipeId)}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2"
              style={{ background: 'var(--color-primary)' }}
            >
              {batchRunning ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('file-stack', { size: 15 })}
              {batchRunning ? 'Processing...' : 'Process all'}
            </button></Tooltip>
            {batchRunning && jobProgress && (
              <>
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{jobProgress.done} of {jobProgress.total} done. You can leave this open; it keeps going on the server.</span>
                <Tooltip text="Stop after the picture being worked on. Pictures already finished are kept, and you only pay for those."><button type="button" onClick={cancelRun} className="px-3 py-2 rounded-xl text-sm border hover:opacity-80" style={{ borderColor: 'var(--color-border)', color: '#ef4444' }}>Cancel</button></Tooltip>
              </>
            )}
            {batchFiles.some(f => f.result?.imageDataUrl) && (
              <Tooltip text="Download every processed result at once."><button
                type="button"
                onClick={downloadBatchAll}
                disabled={batchRunning}
                className="px-3 py-2 rounded-xl text-sm font-medium border disabled:opacity-50 hover:opacity-80"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'transparent' }}
              >
                Download all
              </button></Tooltip>
            )}
            {batchFiles.length > 0 && (
              <Tooltip text="Remove all added images from this list."><button
                type="button"
                onClick={clearBatchFiles}
                disabled={batchRunning}
                className="px-3 py-2 rounded-xl text-sm font-medium border disabled:opacity-50 hover:opacity-80"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent' }}
              >
                Clear
              </button></Tooltip>
            )}
          </div>

          {batchFiles.length === 0 ? (
            <div className="rounded-xl border px-4 py-6 text-sm text-center" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
              Add one or more images to process.
            </div>
          ) : (
            <div className="space-y-2">
              {batchFiles.map(item => (
                <div key={item.id} className="flex items-center gap-3 rounded-xl border px-3 py-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                  {item.imageDataUrl && (
                    <img src={item.result?.imageDataUrl || item.imageDataUrl} alt="" className="h-10 w-10 rounded object-cover flex-shrink-0" style={{ border: '1px solid var(--color-border)' }} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{item.name}</p>
                    <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                      {item.status === 'done' && item.result ? (
                        <span style={{ color: '#047857' }}>
                          Done · {item.result.width && item.result.height ? `${item.result.width}×${item.result.height} · ` : ''}{(item.result.format || item.result.ext || '').toUpperCase()} · {formatBytes(item.result.bytes || item.result.cleanedBytes || 0)}
                        </span>
                      ) : item.status === 'working' ? 'Processing...'
                        : item.status === 'error' ? <span style={{ color: '#ef4444' }}>{item.error}</span>
                        : formatBytes(item.originalBytes)}
                    </p>
                  </div>
                  {item.status === 'done' && item.result?.imageDataUrl && (
                    <Tooltip text="Save this processed image to your device."><button
                      type="button"
                      onClick={() => downloadBatchItem(item)}
                      className="text-xs px-2 py-1 rounded-lg border hover:opacity-70 flex-shrink-0"
                      style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
                    >
                      Download
                    </button></Tooltip>
                  )}
                  <Tooltip text="Remove this image from the list."><button
                    type="button"
                    onClick={() => removeBatchFile(item.id)}
                    disabled={batchRunning}
                    className="text-xs hover:opacity-70 flex-shrink-0 disabled:opacity-40"
                    style={{ color: '#ef4444' }}
                  >
                    Remove
                  </button></Tooltip>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
