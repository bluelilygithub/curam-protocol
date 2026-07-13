import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';

const VIDEO_GOOGLE_FONTS = [
  'Roboto',
  'Inter',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Nunito',
  'Raleway',
  'Oswald',
  'Bebas Neue',
  'Anton',
  'Playfair Display',
  'Merriweather',
  'Lora',
  'PT Serif',
  'Pacifico',
  'Dancing Script',
  'Caveat',
  'Roboto Mono',
  'Space Mono',
];

const FONT_WEIGHTS = [
  { id: 'normal', label: 'Regular' },
  { id: 'bold', label: 'Bold' },
];

const TOOL_GROUPS = [
  {
    id: 'create',
    label: 'Create',
    tools: [
      { id: 'generate', label: 'Generate clip', desc: 'Brief + optional image seed or YouTube example' },
    ],
  },
  {
    id: 'optimise',
    label: 'Optimise',
    tools: [
      { id: 'convert', label: 'Convert / compress', desc: 'Re-encode MP4, optional resize' },
      { id: 'extract-audio', label: 'Extract audio', desc: 'Export MP3 or WAV' },
    ],
  },
  {
    id: 'transform',
    label: 'Transform',
    tools: [
      { id: 'clip', label: 'Clip / trim', desc: 'Set in and out points' },
    ],
  },
  {
    id: 'compose',
    label: 'Compose',
    tools: [
      { id: 'annotate', label: 'Annotate', desc: 'Burn in a text label' },
      { id: 'caption-studio', label: 'Caption studio', desc: 'Upload or library video + styled SRT captions' },
    ],
  },
  {
    id: 'library',
    label: 'Library',
    tools: [
      { id: 'saved-library', label: 'Saved media', desc: 'Your saved videos, images, and tool runs' },
    ],
  },
  {
    id: 'analyse',
    label: 'Analyse',
    tools: [
      { id: 'info', label: 'File info', desc: 'Duration, resolution, codec' },
      { id: 'thumbnail', label: 'Thumbnail', desc: 'Export a JPG frame' },
    ],
  },
];

function TextStyleFields({
  fontFamily, setFontFamily, fontSize, setFontSize, fontColor, setFontColor,
  fontWeight, setFontWeight, backgroundColor, setBackgroundColor,
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block space-y-1 sm:col-span-2">
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Font (Google Fonts)</span>
        <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
          {VIDEO_GOOGLE_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Weight</span>
        <select value={fontWeight} onChange={(e) => setFontWeight(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
          {FONT_WEIGHTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Size (px)</span>
        <input type="number" min={12} max={72} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Text colour</span>
        <input type="color" value={fontColor} onChange={(e) => setFontColor(e.target.value)} className="w-full h-9 rounded-xl border cursor-pointer" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Background colour</span>
        <input type="color" value={backgroundColor} onChange={(e) => setBackgroundColor(e.target.value)} className="w-full h-9 rounded-xl border cursor-pointer" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }} />
      </label>
    </div>
  );
}

function CaptionStyleFields(props) {
  return <TextStyleFields {...props} />;
}

function formatDuration(sec) {
  if (!Number.isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function ImageReferenceUpload({ file, previewUrl, onFile, onClear }) {
  const inputRef = useRef(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          {file ? 'Change image' : 'Upload image'}
        </button>
        {file && (
          <>
            <span className="text-xs truncate max-w-xs" style={{ color: 'var(--color-muted)' }}>
              {file.name} · {formatBytes(file.size)}
            </span>
            <button
              type="button"
              onClick={onClear}
              className="text-xs transition-opacity hover:opacity-70"
              style={{ color: 'var(--color-muted)' }}
            >
              Remove
            </button>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] || null)}
      />
      {previewUrl && (
        <img src={previewUrl} alt="Reference" className="max-h-32 rounded-lg border object-contain" style={{ borderColor: 'var(--color-border)' }} />
      )}
    </div>
  );
}

function VideoUpload({ file, onFile, label = 'Video file' }) {
  const inputRef = useRef(null);
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          {file ? 'Change file' : 'Choose video'}
        </button>
        {file && (
          <span className="text-xs truncate max-w-xs" style={{ color: 'var(--color-muted)' }}>
            {file.name} · {formatBytes(file.size)}
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] || null)}
      />
    </label>
  );
}

function ResultVideo({
  blobUrl, downloadName, onUse, onSave, saveLabel = 'Save to library',
  saveTitle, onSaveTitleChange,
}) {
  if (!blobUrl) return null;
  return (
    <div className="space-y-2 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Result</p>
      <video
        src={blobUrl}
        controls
        playsInline
        preload="metadata"
        className="w-full max-h-64 rounded-lg bg-black"
      />
      {onSave && onSaveTitleChange && (
        <label className="block space-y-1">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Library title (optional)</span>
          <input
            value={saveTitle || ''}
            onChange={(e) => onSaveTitleChange(e.target.value)}
            placeholder="Defaults to tool name and date"
            className="w-full px-3 py-2 rounded-xl border text-xs"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <a
          href={blobUrl}
          download={downloadName}
          className="text-xs px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-80"
          style={{ background: 'var(--color-primary)' }}
        >
          Download
        </a>
        {onSave && (
          <button
            type="button"
            onClick={onSave}
            className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
          >
            {saveLabel}
          </button>
        )}
        {onUse && (
          <button
            type="button"
            onClick={onUse}
            className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Use in another tool
          </button>
        )}
      </div>
    </div>
  );
}

export default function VideosPage() {
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.videos !== false;

  const [status, setStatus] = useState(null);
  const [openGroup, setOpenGroup] = useState('create');
  const [tool, setTool] = useState('generate');
  const [search, setSearch] = useState('');

  const [sourceFile, setSourceFile] = useState(null);
  const [resultBlob, setResultBlob] = useState(null);
  const resultBlobRef = useRef(null);
  const thumbBlobRef = useRef(null);
  const [resultForTool, setResultForTool] = useState(null);
  const [resultName, setResultName] = useState('output.mp4');
  const [probe, setProbe] = useState(null);

  // Generate
  const [brief, setBrief] = useState('');
  const [style, setStyle] = useState('product b-roll');
  const [aspect, setAspect] = useState('16:9');
  const [durationSec, setDurationSec] = useState(5);
  const [generateResult, setGenerateResult] = useState(null);

  // Reference image
  const [seedImageFile, setSeedImageFile] = useState(null);
  const [seedImageUrl, setSeedImageUrl] = useState('');
  const [seedImageMode, setSeedImageMode] = useState('animate');

  // YouTube example
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubePreview, setYoutubePreview] = useState(null);
  const [useYoutubeThumbnailAsSeed, setUseYoutubeThumbnailAsSeed] = useState(false);
  const [youtubeLoading, setYoutubeLoading] = useState(false);

  // Clip
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState('');

  // Convert
  const [crf, setCrf] = useState(23);
  const [maxWidth, setMaxWidth] = useState('');

  // Annotate
  const [overlayText, setOverlayText] = useState('');
  const [overlayPos, setOverlayPos] = useState('bottom');

  // Captions
  const [srtText, setSrtText] = useState('');
  const [transcript, setTranscript] = useState('');

  // Thumbnail
  const [thumbTime, setThumbTime] = useState(1);
  const [thumbUrl, setThumbUrl] = useState(null);

  // Library
  const [libraryItems, setLibraryItems] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [lastTransaction, setLastTransaction] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  // Caption studio
  const [captionLibraryId, setCaptionLibraryId] = useState('');
  const [textFontFamily, setTextFontFamily] = useState('Roboto');
  const [textFontSize, setTextFontSize] = useState(28);
  const [textFontColor, setTextFontColor] = useState('#FFFFFF');
  const [textFontWeight, setTextFontWeight] = useState('normal');
  const [textBackgroundColor, setTextBackgroundColor] = useState('#000000');
  const [captionSaveToLibrary, setCaptionSaveToLibrary] = useState(true);

  const previewUrl = useMemo(() => {
    if (sourceFile) return URL.createObjectURL(sourceFile);
    return null;
  }, [sourceFile]);

  const seedImagePreview = useMemo(() => {
    if (seedImageFile) return URL.createObjectURL(seedImageFile);
    if (seedImageUrl.trim()) return seedImageUrl.trim();
    return youtubePreview?.thumbnailUrl || null;
  }, [seedImageFile, seedImageUrl, youtubePreview?.thumbnailUrl]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (resultBlob) URL.revokeObjectURL(resultBlob);
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    if (seedImageFile && seedImagePreview?.startsWith('blob:')) URL.revokeObjectURL(seedImagePreview);
  }, [previewUrl, resultBlob, thumbUrl, seedImageFile, seedImagePreview]);

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!canUse) return;
    api.get('/api/videos/status')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, [canUse]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return TOOL_GROUPS;
    return TOOL_GROUPS.map((g) => ({
      ...g,
      tools: g.tools.filter((t) => t.label.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q)),
    })).filter((g) => g.tools.length > 0);
  }, [search]);

  const clearComposeResult = useCallback(() => {
    setResultBlob((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    resultBlobRef.current = null;
    setResultForTool(null);
  }, []);

  useEffect(() => {
    if (tool === 'annotate' || tool === 'caption-studio') clearComposeResult();
  }, [tool, clearComposeResult]);

  const setResultFromBlob = useCallback((blob, name, forTool = null) => {
    resultBlobRef.current = blob;
    setResultBlob((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return blob ? URL.createObjectURL(blob) : null;
    });
    if (name) setResultName(name);
    setResultForTool(forTool);
  }, []);

  const textStyleFields = useCallback(() => ({
    fontFamily: textFontFamily,
    fontSize: textFontSize,
    fontColor: textFontColor,
    fontWeight: textFontWeight,
    backgroundColor: textBackgroundColor,
  }), [textFontFamily, textFontSize, textFontColor, textFontWeight, textBackgroundColor]);

  const appendTextStyleFields = useCallback((fd) => {
    Object.entries(textStyleFields()).forEach(([k, v]) => fd.append(k, String(v)));
  }, [textStyleFields]);

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const res = await api.get('/api/videos/library');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load library');
      setLibraryItems(Array.isArray(data) ? data : []);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLibraryLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (!canUse) return;
    if (tool === 'saved-library' || tool === 'caption-studio') loadLibrary();
  }, [canUse, tool, loadLibrary]);

  const saveToLibrary = useCallback(async ({
    title,
    transaction,
    mediaType = 'video',
    blob: blobOverride = null,
    blobUrl = null,
    fileName = resultName,
    toolId = tool,
  } = {}) => {
    let blob = blobOverride;
    if (!blob && mediaType === 'image') blob = thumbBlobRef.current;
    if (!blob) blob = resultBlobRef.current;
    // Fallback for edge cases only — fetch(blob:) needs connect-src blob: in CSP
    if (!blob && (blobUrl || resultBlob)) {
      const res = await fetch(blobUrl || resultBlob);
      blob = await res.blob();
    }
    if (!blob) {
      addToast('Nothing to save yet', 'error');
      return;
    }
    startProcessing('Saving to library…', 'Storing file and tool settings.');
    try {
      const fd = new FormData();
      fd.append('file', blob, fileName);
      fd.append('title', title || saveTitle || `${toolId} · ${new Date().toLocaleDateString()}`);
      fd.append('tool', toolId);
      fd.append('mediaType', mediaType);
      fd.append('transaction', JSON.stringify(transaction || lastTransaction || {}));
      const saveRes = await api.postForm('/api/videos/library', fd);
      const item = await saveRes.json();
      if (!saveRes.ok) throw new Error(item.error || 'Save failed');
      addToast('Saved to library', 'success');
      await loadLibrary();
      return item;
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  }, [resultName, tool, saveTitle, lastTransaction, startProcessing, stopProcessing, loadLibrary, addToast, resultBlob]);

  const deleteLibraryItem = useCallback(async (id) => {
    try {
      const res = await api.delete(`/api/videos/library/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setLibraryItems((prev) => prev.filter((i) => i.id !== id));
      setDeleteConfirmId(null);
      addToast('Deleted from library', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  }, [addToast]);

  const previewLibraryItem = useCallback(async (item) => {
    startProcessing('Loading preview…', '');
    try {
      const res = await api.get(item.streamUrl);
      if (!res.ok) throw new Error('Could not load saved file');
      const blob = await res.blob();
      if (item.mediaType === 'image') {
        if (thumbUrl) URL.revokeObjectURL(thumbUrl);
        thumbBlobRef.current = blob;
        setThumbUrl(URL.createObjectURL(blob));
      } else {
        setResultFromBlob(blob, `${item.title || 'video'}.mp4`, 'saved-library');
      }
      setLastTransaction(item.transaction || { savedId: item.id, tool: item.tool });
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  }, [startProcessing, stopProcessing, setResultFromBlob, thumbUrl, addToast]);

  const handleCaptionStudio = async () => {
    if (!srtText.trim()) {
      addToast('Paste SRT content', 'error');
      return;
    }
    if (!captionLibraryId && !sourceFile) {
      addToast('Choose a library video or upload a file', 'error');
      return;
    }
    const styleFields = textStyleFields();
    startProcessing('Burning captions…', 'Applying styled subtitles with ffmpeg.');
    try {
      if (captionLibraryId) {
        const fd = new FormData();
        fd.append('srtText', srtText);
        fd.append('saveToLibrary', String(captionSaveToLibrary));
        Object.entries(styleFields).forEach(([k, v]) => fd.append(k, String(v)));
        const res = await api.postForm(`/api/videos/library/${captionLibraryId}/captions`, fd);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Caption burn failed');
        }
        const blob = await res.blob();
        setResultFromBlob(blob, 'captioned.mp4', 'caption-studio');
        if (captionSaveToLibrary) await loadLibrary();
      } else {
        const fd = new FormData();
        fd.append('video', sourceFile);
        fd.append('srtText', srtText);
        appendTextStyleFields(fd);
        const res = await api.postForm('/api/videos/burn-captions', fd);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Caption burn failed');
        }
        const blob = await res.blob();
        setResultFromBlob(blob, 'captioned.mp4', 'caption-studio');
        if (captionSaveToLibrary) {
          await saveToLibrary({
            title: saveTitle || 'Captioned video',
            blob,
            fileName: 'captioned.mp4',
            toolId: 'caption-studio',
            transaction: { tool: 'caption-studio', captionStyle: styleFields },
          });
        }
      }
      setLastTransaction({ tool: 'caption-studio', captionStyle: styleFields });
      addToast('Captions applied', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const useResultAsSource = useCallback(async () => {
    const blob = resultBlobRef.current;
    if (!blob) {
      addToast('Nothing to load as source', 'error');
      return;
    }
    try {
      const file = new File([blob], resultName, { type: blob.type || 'video/mp4' });
      setSourceFile(file);
      addToast('Result loaded as source', 'success');
    } catch {
      addToast('Could not load result as source', 'error');
    }
  }, [resultName, addToast]);

  const runFormVideo = useCallback(async (endpoint, formData, { label, resultFilename, isJson, forTool }) => {
    startProcessing(label, 'Processing on the server with ffmpeg.');
    try {
      const res = await api.postForm(`/api/videos/${endpoint}`, formData);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Request failed');
      }
      if (isJson) {
        const data = await res.json();
        return data;
      }
      const blob = await res.blob();
      setResultFromBlob(blob, resultFilename, forTool ?? tool);
      setLastTransaction({ tool: forTool ?? endpoint });
      addToast('Done', 'success');
      return blob;
    } catch (err) {
      addToast(err.message, 'error');
      throw err;
    } finally {
      stopProcessing();
    }
  }, [startProcessing, stopProcessing, setResultFromBlob, addToast, tool]);

  const requireFile = () => {
    if (!sourceFile) {
      addToast('Choose a video file first', 'error');
      return false;
    }
    return true;
  };

  const handleProbe = async () => {
    if (!requireFile()) return;
    const fd = new FormData();
    fd.append('video', sourceFile);
    startProcessing('Reading file info…', '');
    try {
      const res = await api.postForm('/api/videos/probe', fd);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Probe failed');
      setProbe(data);
      if (data.duration) setEndSec(String(Math.floor(data.duration)));
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const hydrateRemoteVideo = useCallback(async (videoUrl) => {
    const res = await api.post('/api/videos/playback', { url: videoUrl });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Could not load video for playback');
    }
    const blob = await res.blob();
    setResultFromBlob(blob, 'generated.mp4', 'generate');
  }, [setResultFromBlob]);

  const handleLoadYoutube = async () => {
    if (!youtubeUrl.trim()) {
      addToast('Paste a YouTube URL', 'error');
      return;
    }
    setYoutubeLoading(true);
    try {
      const res = await api.post('/api/videos/youtube-preview', { url: youtubeUrl.trim() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load video');
      setYoutubePreview(data);
      addToast('YouTube example loaded', 'success');
    } catch (err) {
      addToast(err.message, 'error');
      setYoutubePreview(null);
    } finally {
      setYoutubeLoading(false);
    }
  };

  const handleGenerate = async () => {
    const hasBrief = Boolean(brief.trim());
    const hasImage = Boolean(seedImageFile || seedImageUrl.trim());
    const hasYoutube = Boolean(youtubeUrl.trim());
    if (!hasBrief && !hasImage && !hasYoutube) {
      addToast('Add a brief, reference image, or YouTube example', 'error');
      return;
    }

    startProcessing('Preparing clip…', 'Analysing references and submitting to the video model.');
    try {
      let seedImageDataUrl = '';
      if (seedImageFile) {
        seedImageDataUrl = await readFileAsDataUrl(seedImageFile);
      } else if (seedImageUrl.trim()) {
        seedImageDataUrl = seedImageUrl.trim();
      }

      const res = await api.post('/api/videos/generate', {
        brief,
        style,
        aspect,
        durationSec,
        seedImageDataUrl: seedImageDataUrl || undefined,
        seedImageMode,
        youtubeUrl: youtubeUrl.trim() || undefined,
        useYoutubeThumbnailAsSeed,
      });
      const started = await res.json();
      if (!res.ok) throw new Error(started.error || 'Generate failed');

      setGenerateResult(started);

      const params = new URLSearchParams({ requestId: started.requestId });

      let completed = null;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const statusRes = await api.get(`/api/videos/generate/status?${params.toString()}`);
        const statusData = await statusRes.json();
        if (!statusRes.ok) throw new Error(statusData.error || 'Status check failed');

        const providerLabel = started.provider === 'replicate' ? 'Replicate' : 'FAL';
        const detail = statusData.status === 'IN_QUEUE'
          ? (statusData.queuePosition != null ? `Queued — position ${statusData.queuePosition + 1}` : `Queued on ${providerLabel}…`)
          : statusData.status === 'IN_PROGRESS'
            ? `Rendering video on ${providerLabel} (this can take 1–3 minutes)…`
            : `Waiting for ${providerLabel}…`;
        startProcessing('Generating clip…', detail);

        if (statusData.status === 'COMPLETED') {
          completed = statusData;
          break;
        }
      }

      if (!completed) throw new Error('Video generation timed out — try again in a moment');

      setGenerateResult(completed);
      if (completed.inline?.base64) {
        const bin = Uint8Array.from(atob(completed.inline.base64), (c) => c.charCodeAt(0));
        setResultFromBlob(new Blob([bin], { type: completed.inline.contentType || 'video/mp4' }), 'generated.mp4', 'generate');
      } else if (completed.videoUrl) {
        startProcessing('Preparing playback…', 'Downloading your clip for in-browser preview.');
        await hydrateRemoteVideo(completed.videoUrl);
      }
      setLastTransaction({
        tool: 'generate',
        brief,
        style,
        aspect,
        durationSec,
        seedImageMode,
        youtubeUrl: youtubeUrl.trim() || undefined,
        video_prompt: completed.video_prompt,
        mode: completed.mode,
        provider: completed.provider || started.provider,
      });
      addToast(completed.mode === 'image-to-video' ? 'Clip generated from image' : 'Clip generated', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const libraryVideoItems = useMemo(
    () => libraryItems.filter((i) => i.mediaType === 'video'),
    [libraryItems],
  );

  const handleSaveResult = useCallback(() => {
    saveToLibrary({ title: saveTitle });
  }, [saveToLibrary, saveTitle]);

  const handleSaveThumbnail = useCallback(async () => {
    if (!thumbBlobRef.current) return;
    await saveToLibrary({
      title: saveTitle || 'Thumbnail',
      mediaType: 'image',
      blob: thumbBlobRef.current,
      fileName: 'thumbnail.jpg',
      toolId: 'thumbnail',
      transaction: { tool: 'thumbnail', thumbTime },
    });
  }, [saveTitle, saveToLibrary, thumbTime]);

  const openCaptionStudioFor = useCallback((item) => {
    setCaptionLibraryId(String(item.id));
    setSourceFile(null);
    setSrtText('');
    setTool('caption-studio');
    setOpenGroup('compose');
  }, []);

  if (!canUse) return <Navigate to="/" replace />;

  const ffmpegOk = status?.ffmpeg;
  const generateOk = status?.generate?.available;
  const resultSaveProps = {
    onSave: handleSaveResult,
    saveTitle,
    onSaveTitleChange: setSaveTitle,
  };

  return (
    <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
      <aside
        className="w-full sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r overflow-y-auto p-4 space-y-3"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>
            {getIcon('film', { size: 16 })}
          </div>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Video Tools</h1>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tools…"
          className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none"
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        />

        {filteredGroups.map((group) => (
          <div key={group.id}>
            <button
              type="button"
              onClick={() => setOpenGroup(openGroup === group.id ? null : group.id)}
              className="text-xs font-semibold w-full text-left py-1 transition-opacity hover:opacity-70"
              style={{ color: 'var(--color-primary)' }}
            >
              {openGroup === group.id ? '▼' : '▶'} {group.label}
            </button>
            {(openGroup === group.id || search.trim()) && (
              <ul className="pl-2 border-l ml-1 space-y-0.5 mt-1" style={{ borderColor: 'var(--color-border)' }}>
                {group.tools.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setTool(t.id)}
                      className="w-full text-left px-2 py-1.5 rounded-lg text-xs transition-opacity hover:opacity-70"
                      style={{
                        background: tool === t.id ? 'var(--color-bg)' : 'transparent',
                        color: tool === t.id ? 'var(--color-text)' : 'var(--color-muted)',
                      }}
                    >
                      {t.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </aside>

      <main className="flex-1 overflow-y-auto p-6 space-y-4 max-w-2xl">
        {status && !ffmpegOk && (
          <div className="rounded-xl border p-3 text-xs" style={{ borderColor: '#f59e0b', color: 'var(--color-muted)' }}>
            ffmpeg is not available on this server — clip, convert and annotate tools will not work until ffmpeg is installed.
          </div>
        )}

        {tool === 'generate' && (
          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Generate clip</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                Describe a short clip. Optionally upload a reference image (animate it or use as style inspiration) or paste a YouTube example.
              </p>
            </div>
            {!generateOk && (
              <p className="text-xs rounded-xl border p-3" style={{ borderColor: '#f59e0b', color: 'var(--color-muted)' }}>
                Add <strong>REPLICATE_API_TOKEN</strong> or <strong>FAL_API_KEY</strong> in Railway. Replicate is preferred when both are set ({status?.generate?.provider || 'replicate'} · {status?.generate?.model || 'minimax/hailuo-2.3'}).
              </p>
            )}
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>What should happen on screen?</span>
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={4}
                placeholder="A calm product shot of wireless earbuds rotating on a marble surface… (optional if you provide an image or YouTube example)"
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none resize-y"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </label>

            <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Reference image (optional)</p>
              <ImageReferenceUpload
                file={seedImageFile}
                previewUrl={seedImageFile ? seedImagePreview : (seedImageUrl.trim() ? seedImagePreview : null)}
                onFile={(f) => { setSeedImageFile(f); if (f) setSeedImageUrl(''); }}
                onClear={() => { setSeedImageFile(null); setSeedImageUrl(''); }}
              />
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Or paste image URL</span>
                <input
                  type="url"
                  value={seedImageUrl}
                  onChange={(e) => { setSeedImageUrl(e.target.value); if (e.target.value) setSeedImageFile(null); }}
                  placeholder="https://…"
                  className="w-full px-3 py-2 rounded-xl border text-xs"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
              </label>
              {(seedImageFile || seedImageUrl.trim()) && (
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'animate', label: 'Animate this image' },
                    { id: 'suggest', label: 'Style suggestion only' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSeedImageMode(opt.id)}
                      className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
                      style={{
                        borderColor: seedImageMode === opt.id ? 'var(--color-primary)' : 'var(--color-border)',
                        color: seedImageMode === opt.id ? 'var(--color-primary)' : 'var(--color-muted)',
                        background: seedImageMode === opt.id ? 'var(--color-surface)' : 'transparent',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>YouTube example (optional)</p>
              <div className="flex flex-wrap gap-2">
                <input
                  type="url"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                  className="flex-1 min-w-[200px] px-3 py-2 rounded-xl border text-xs"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
                <button
                  type="button"
                  onClick={handleLoadYoutube}
                  disabled={youtubeLoading}
                  className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70 disabled:opacity-40"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {youtubeLoading ? 'Loading…' : 'Load'}
                </button>
              </div>
              {youtubePreview && (
                <div className="space-y-2">
                  <div className="flex gap-3 items-start">
                    <img src={youtubePreview.thumbnailUrl} alt="" className="w-24 rounded-lg border shrink-0" style={{ borderColor: 'var(--color-border)' }} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{youtubePreview.title}</p>
                      <p className="text-[10px] mt-1" style={{ color: 'var(--color-muted)' }}>
                        {youtubePreview.hasTranscript ? 'Transcript available for style matching' : 'No captions — thumbnail + title used'}
                      </p>
                    </div>
                  </div>
                  {youtubePreview.transcriptExcerpt && (
                    <p className="text-[10px] line-clamp-3" style={{ color: 'var(--color-muted)' }}>{youtubePreview.transcriptExcerpt}</p>
                  )}
                  <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
                    <input
                      type="checkbox"
                      checked={useYoutubeThumbnailAsSeed}
                      onChange={(e) => setUseYoutubeThumbnailAsSeed(e.target.checked)}
                    />
                    Use YouTube thumbnail as starting frame
                  </label>
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Style</span>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="w-full px-2 py-2 rounded-xl border text-xs"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  <option value="product b-roll">Product b-roll</option>
                  <option value="abstract motion">Abstract motion</option>
                  <option value="UGC social">UGC / social</option>
                  <option value="cinematic">Cinematic</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Aspect</span>
                <select
                  value={aspect}
                  onChange={(e) => setAspect(e.target.value)}
                  className="w-full px-2 py-2 rounded-xl border text-xs"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  <option value="16:9">16:9 landscape</option>
                  <option value="9:16">9:16 story</option>
                  <option value="1:1">1:1 square</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Duration (s)</span>
                <input
                  type="number"
                  min={3}
                  max={10}
                  value={durationSec}
                  onChange={(e) => setDurationSec(Number(e.target.value))}
                  className="w-full px-2 py-2 rounded-xl border text-xs"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
              </label>
            </div>
            <button
              type="button"
              disabled={!generateOk}
              onClick={handleGenerate}
              className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              Generate clip
            </button>
            {generateResult?.video_prompt && (
              <div className="rounded-xl border p-3 text-xs space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <p className="font-medium" style={{ color: 'var(--color-text)' }}>
                  Model prompt {generateResult.mode === 'image-to-video' ? '(image-to-video)' : '(text-to-video)'}
                </p>
                <p style={{ color: 'var(--color-muted)' }}>{generateResult.video_prompt}</p>
                {generateResult.references?.imageDescription && (
                  <p style={{ color: 'var(--color-muted)' }}><span className="font-medium" style={{ color: 'var(--color-text)' }}>Image style:</span> {generateResult.references.imageDescription}</p>
                )}
                {generateResult.references?.youtube && (
                  <p style={{ color: 'var(--color-muted)' }}><span className="font-medium" style={{ color: 'var(--color-text)' }}>YouTube ref:</span> {generateResult.references.youtube.title}</p>
                )}
              </div>
            )}
            {resultForTool === 'generate' && (
              <ResultVideo
                blobUrl={resultBlob}
                downloadName={resultName}
                onUse={useResultAsSource}
                {...resultSaveProps}
              />
            )}
          </section>
        )}

        {tool !== 'generate' && tool !== 'saved-library' && !(tool === 'caption-studio' && captionLibraryId) && (
          <VideoUpload file={sourceFile} onFile={(f) => { setSourceFile(f); if (f && tool === 'caption-studio') setCaptionLibraryId(''); }} />
        )}

        {previewUrl && tool !== 'generate' && tool !== 'saved-library' && (
          <video src={previewUrl} controls className="w-full max-h-48 rounded-xl bg-black" />
        )}

        {tool === 'clip' && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Clip / trim</h2>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Start (seconds)</span>
                <input type="number" min={0} step={0.1} value={startSec} onChange={(e) => setStartSec(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>End (seconds, optional)</span>
                <input type="number" min={0} step={0.1} value={endSec} onChange={(e) => setEndSec(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </label>
            </div>
            <button type="button" onClick={() => { if (!requireFile()) return; const fd = new FormData(); fd.append('video', sourceFile); fd.append('startSec', String(startSec)); if (endSec !== '') fd.append('endSec', String(endSec)); runFormVideo('clip', fd, { label: 'Clipping…', resultFilename: 'clip.mp4' }); }} disabled={!ffmpegOk} className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
              Export clip
            </button>
            {resultForTool === 'clip' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'convert' && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Convert / compress</h2>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Quality (CRF 18–35, lower = better)</span>
                <input type="number" min={18} max={35} value={crf} onChange={(e) => setCrf(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Max width (optional)</span>
                <input type="number" placeholder="1280" value={maxWidth} onChange={(e) => setMaxWidth(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </label>
            </div>
            <button type="button" onClick={() => { if (!requireFile()) return; const fd = new FormData(); fd.append('video', sourceFile); fd.append('crf', String(crf)); if (maxWidth) fd.append('maxWidth', maxWidth); runFormVideo('convert', fd, { label: 'Converting…', resultFilename: 'converted.mp4' }); }} disabled={!ffmpegOk} className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
              Convert
            </button>
            {resultForTool === 'convert' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'extract-audio' && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Extract audio</h2>
            <button type="button" onClick={async () => { if (!requireFile()) return; const fd = new FormData(); fd.append('video', sourceFile); fd.append('format', 'mp3'); await runFormVideo('extract-audio', fd, { label: 'Extracting audio…', resultFilename: 'audio.mp3' }); }} disabled={!ffmpegOk} className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
              Export MP3
            </button>
            {resultForTool === 'extract-audio' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} />
            )}
          </section>
        )}

        {tool === 'annotate' && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Annotate</h2>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Burn a styled text label into the full clip. The preview below appears only after you apply.</p>
            <input value={overlayText} onChange={(e) => setOverlayText(e.target.value)} placeholder="Label text" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
            <select value={overlayPos} onChange={(e) => setOverlayPos(e.target.value)} className="px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              <option value="bottom">Bottom</option>
              <option value="center">Center</option>
              <option value="top">Top</option>
            </select>
            <TextStyleFields
              fontFamily={textFontFamily}
              setFontFamily={setTextFontFamily}
              fontSize={textFontSize}
              setFontSize={setTextFontSize}
              fontColor={textFontColor}
              setFontColor={setTextFontColor}
              fontWeight={textFontWeight}
              setFontWeight={setTextFontWeight}
              backgroundColor={textBackgroundColor}
              setBackgroundColor={setTextBackgroundColor}
            />
            <button type="button" onClick={() => { if (!requireFile() || !overlayText.trim()) return; const fd = new FormData(); fd.append('video', sourceFile); fd.append('text', overlayText); fd.append('position', overlayPos); appendTextStyleFields(fd); runFormVideo('annotate', fd, { label: 'Annotating…', resultFilename: 'annotated.mp4', forTool: 'annotate' }); }} disabled={!ffmpegOk} className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
              Apply label
            </button>
            {resultForTool === 'annotate' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'caption-studio' && (
          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Caption studio</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                Pick a saved video or upload one, then burn styled SRT subtitles. Return later to add or update captions on library items.
              </p>
            </div>

            <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Video source</p>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>From library (optional)</span>
                <select
                  value={captionLibraryId}
                  onChange={(e) => {
                    setCaptionLibraryId(e.target.value);
                    if (e.target.value) setSourceFile(null);
                  }}
                  className="w-full px-2 py-2 rounded-xl border text-xs"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  <option value="">Upload a file instead</option>
                  {libraryVideoItems.map((item) => (
                    <option key={item.id} value={String(item.id)}>{item.title} · {item.tool || 'video'}</option>
                  ))}
                </select>
              </label>
              {captionLibraryId && (
                <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                  Using saved video #{captionLibraryId}. Upload below to switch to a new file.
                </p>
              )}
            </div>

            <CaptionStyleFields
              fontFamily={textFontFamily}
              setFontFamily={setTextFontFamily}
              fontSize={textFontSize}
              setFontSize={setTextFontSize}
              fontColor={textFontColor}
              setFontColor={setTextFontColor}
              fontWeight={textFontWeight}
              setFontWeight={setTextFontWeight}
              backgroundColor={textBackgroundColor}
              setBackgroundColor={setTextBackgroundColor}
            />

            <div className="space-y-2">
              <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Subtitles (SRT)</p>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {status?.transcribe?.note || 'Paste SRT content or auto-transcribe when uploading a file.'}
              </p>
              {status?.transcribe?.available && !captionLibraryId && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!requireFile()) return;
                    const fd = new FormData();
                    fd.append('video', sourceFile);
                    startProcessing('Transcribing…', '');
                    try {
                      const res = await api.postForm('/api/videos/transcribe', fd);
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error);
                      setTranscript(data.text || '');
                      addToast('Transcript ready — convert to SRT or paste below', 'success');
                    } catch (e) {
                      addToast(e.message, 'error');
                    } finally {
                      stopProcessing();
                    }
                  }}
                  className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
                  style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
                >
                  Auto-transcribe (local)
                </button>
              )}
              {transcript && (
                <textarea value={transcript} readOnly rows={3} className="w-full text-xs rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }} />
              )}
              <textarea
                value={srtText}
                onChange={(e) => setSrtText(e.target.value)}
                rows={8}
                placeholder="Paste SRT content here…"
                className="w-full px-3 py-2 rounded-xl border text-xs font-mono"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>

            <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
              <input
                type="checkbox"
                checked={captionSaveToLibrary}
                onChange={(e) => setCaptionSaveToLibrary(e.target.checked)}
              />
              Save captioned result to library
            </label>

            <button
              type="button"
              onClick={handleCaptionStudio}
              disabled={!ffmpegOk || (!captionLibraryId && !sourceFile)}
              className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              Apply captions
            </button>
            {resultForTool === 'caption-studio' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'saved-library' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Saved media</h2>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                  Videos and images from tool runs — preview, delete, or open in Caption studio.
                </p>
              </div>
              <button
                type="button"
                onClick={loadLibrary}
                disabled={libraryLoading}
                className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70 disabled:opacity-40"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                {libraryLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            {libraryLoading && libraryItems.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading…</p>
            )}

            {!libraryLoading && libraryItems.length === 0 && (
              <p className="text-xs rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                Nothing saved yet. Run a tool and use <strong>Save to library</strong> on the result.
              </p>
            )}

            <ul className="space-y-2">
              {libraryItems.map((item) => (
                <li
                  key={item.id}
                  className="rounded-xl border p-3 space-y-2"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{item.title}</p>
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
                        {item.tool || '—'} · {item.mediaType} · {formatBytes(item.fileSize)} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => previewLibraryItem(item)}
                        className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                      >
                        Preview
                      </button>
                      {item.mediaType === 'video' && (
                        <button
                          type="button"
                          onClick={() => openCaptionStudioFor(item)}
                          className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70"
                          style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
                        >
                          Add captions
                        </button>
                      )}
                      {deleteConfirmId === item.id ? (
                        <span className="flex items-center gap-1.5 text-xs">
                          <span style={{ color: 'var(--color-muted)' }}>Delete?</span>
                          <button type="button" onClick={() => deleteLibraryItem(item.id)} className="font-medium" style={{ color: '#ef4444' }}>Yes</button>
                          <button type="button" onClick={() => setDeleteConfirmId(null)} style={{ color: 'var(--color-muted)' }}>No</button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(item.id)}
                          className="text-xs px-2.5 py-1 rounded-lg transition-opacity hover:opacity-70"
                          style={{ color: '#ef4444' }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                  {item.transaction && Object.keys(item.transaction).length > 0 && (
                    <details className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                      <summary className="cursor-pointer transition-opacity hover:opacity-70">Tool settings</summary>
                      <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[10px] p-2 rounded-lg" style={{ background: 'var(--color-surface)' }}>
                        {JSON.stringify(item.transaction, null, 2)}
                      </pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>

            {resultForTool === 'saved-library' && resultBlob && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} />
            )}
            {thumbUrl && tool === 'saved-library' && (
              <div className="space-y-2 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Image preview</p>
                <img src={thumbUrl} alt="" className="max-w-full rounded-lg border" style={{ borderColor: 'var(--color-border)' }} />
              </div>
            )}
          </section>
        )}

        {tool === 'info' && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>File info</h2>
            <button type="button" onClick={handleProbe} disabled={!ffmpegOk} className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
              Analyse file
            </button>
            {probe && (
              <dl className="text-xs grid grid-cols-2 gap-2 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <dt style={{ color: 'var(--color-muted)' }}>Duration</dt><dd>{formatDuration(probe.duration)}</dd>
                <dt style={{ color: 'var(--color-muted)' }}>Resolution</dt><dd>{probe.width && probe.height ? `${probe.width}×${probe.height}` : '—'}</dd>
                <dt style={{ color: 'var(--color-muted)' }}>Codec</dt><dd>{probe.codec || '—'}</dd>
                <dt style={{ color: 'var(--color-muted)' }}>Audio</dt><dd>{probe.hasAudio ? 'Yes' : 'No'}</dd>
                <dt style={{ color: 'var(--color-muted)' }}>Size</dt><dd>{formatBytes(probe.uploadSize || probe.size)}</dd>
                <dt style={{ color: 'var(--color-muted)' }}>Container</dt><dd>{probe.format || '—'}</dd>
              </dl>
            )}
          </section>
        )}

        {tool === 'thumbnail' && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Thumbnail</h2>
            <label className="block space-y-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Frame at (seconds)</span>
              <input type="number" min={0} step={0.1} value={thumbTime} onChange={(e) => setThumbTime(Number(e.target.value))} className="w-32 px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
            </label>
            <button type="button" onClick={async () => { if (!requireFile()) return; const fd = new FormData(); fd.append('video', sourceFile); fd.append('timeSec', String(thumbTime)); startProcessing('Capturing frame…', ''); try { const res = await api.postForm('/api/videos/thumbnail', fd); if (!res.ok) { const e = await res.json(); throw new Error(e.error); } const blob = await res.blob(); thumbBlobRef.current = blob; if (thumbUrl) URL.revokeObjectURL(thumbUrl); setThumbUrl(URL.createObjectURL(blob)); addToast('Thumbnail ready', 'success'); } catch (e) { addToast(e.message, 'error'); } finally { stopProcessing(); } }} disabled={!ffmpegOk} className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
              Export JPG
            </button>
            {thumbUrl && (
              <div className="space-y-2 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Result</p>
                <img src={thumbUrl} alt="Thumbnail" className="max-w-full rounded-xl border" style={{ borderColor: 'var(--color-border)' }} />
                <div className="flex flex-wrap gap-2">
                  <a href={thumbUrl} download="thumbnail.jpg" className="text-xs px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-80" style={{ background: 'var(--color-primary)' }}>
                    Download JPG
                  </a>
                  <button
                    type="button"
                    onClick={handleSaveThumbnail}
                    className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
                    style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
                  >
                    Save to library
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
