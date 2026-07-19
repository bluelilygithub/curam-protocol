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

const TEXT_POSITIONS = [
  { id: 'top-left', label: 'Top left', row: 0, col: 0 },
  { id: 'top-center', label: 'Top centre', row: 0, col: 1 },
  { id: 'top-right', label: 'Top right', row: 0, col: 2 },
  { id: 'center-left', label: 'Centre left', row: 1, col: 0 },
  { id: 'center', label: 'Centre', row: 1, col: 1 },
  { id: 'center-right', label: 'Centre right', row: 1, col: 2 },
  { id: 'bottom-left', label: 'Bottom left', row: 2, col: 0 },
  { id: 'bottom-center', label: 'Bottom centre', row: 2, col: 1 },
  { id: 'bottom-right', label: 'Bottom right', row: 2, col: 2 },
];

function formatClipTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00.0';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const whole = Math.floor(s);
  const tenth = Math.floor((s - whole) * 10);
  return m > 0
    ? `${m}:${String(whole).padStart(2, '0')}.${tenth}`
    : `${whole}.${tenth}s`;
}

function PositionGrid({ value, onChange, label = 'Position' }) {
  const grid = useMemo(() => {
    const cells = Array.from({ length: 9 }, () => null);
    TEXT_POSITIONS.forEach((p) => {
      cells[p.row * 3 + p.col] = p;
    });
    return cells;
  }, []);

  return (
    <div className="space-y-1">
      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <div
        className="inline-grid gap-1 p-1 rounded-xl border"
        style={{ gridTemplateColumns: 'repeat(3, 2rem)', borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
      >
        {grid.map((pos) => (
          <button
            key={pos.id}
            type="button"
            title={pos.label}
            aria-label={pos.label}
            onClick={() => onChange(pos.id)}
            className="w-8 h-8 rounded-lg border transition-opacity hover:opacity-70 flex items-center justify-center"
            style={{
              borderColor: value === pos.id ? 'var(--color-primary)' : 'var(--color-border)',
              background: value === pos.id ? 'var(--color-surface)' : 'transparent',
            }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: value === pos.id ? 'var(--color-primary)' : 'var(--color-muted)' }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

function ClipTimeline({
  duration, startSec, endSec, onStartChange, onEndChange,
}) {
  const trackRef = useRef(null);
  const dragRef = useRef(null);

  const end = endSec === '' || endSec == null ? duration : Number(endSec);
  const dur = Math.max(0, Number(duration) || 0);
  const start = Math.max(0, Math.min(Number(startSec) || 0, dur));
  const endVal = dur > 0 ? Math.max(start + 0.1, Math.min(end || dur, dur)) : start + 0.1;

  const secFromClientX = useCallback((clientX) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect?.width || !dur) return 0;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * dur * 10) / 10;
  }, [dur]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current || !dur) return;
      const t = secFromClientX(e.clientX);
      if (dragRef.current === 'start') {
        onStartChange(Math.max(0, Math.min(t, endVal - 0.1)));
      } else {
        onEndChange(Math.min(dur, Math.max(t, start + 0.1)));
      }
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dur, endVal, start, onStartChange, onEndChange, secFromClientX]);

  if (!dur) {
    return (
      <p className="text-xs rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
        Load a video to drag in/out markers on the timeline.
      </p>
    );
  }

  const startPct = (start / dur) * 100;
  const endPct = (endVal / dur) * 100;

  return (
    <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <div className="flex justify-between text-[10px] font-mono" style={{ color: 'var(--color-muted)' }}>
        <span>In {formatClipTime(start)}</span>
        <span>Duration {formatClipTime(endVal - start)}</span>
        <span>Out {formatClipTime(endVal)}</span>
      </div>
      <div
        ref={trackRef}
        className="relative h-10 rounded-lg cursor-pointer select-none"
        style={{ background: 'var(--color-surface)' }}
        onPointerDown={(e) => {
          if (e.target !== trackRef.current || !dur) return;
          const t = secFromClientX(e.clientX);
          const distStart = Math.abs(t - start);
          const distEnd = Math.abs(t - endVal);
          if (distStart <= distEnd) onStartChange(Math.max(0, Math.min(t, endVal - 0.1)));
          else onEndChange(Math.min(dur, Math.max(t, start + 0.1)));
        }}
      >
        <div
          className="absolute top-1 bottom-1 rounded-md opacity-40"
          style={{
            left: `${startPct}%`,
            width: `${Math.max(0, endPct - startPct)}%`,
            background: 'var(--color-primary)',
          }}
        />
        <div
          role="slider"
          aria-label="Start marker"
          className="absolute top-0 bottom-0 w-3 -ml-1.5 rounded cursor-ew-resize touch-none"
          style={{ left: `${startPct}%`, background: 'var(--color-primary)' }}
          onPointerDown={(e) => { e.stopPropagation(); dragRef.current = 'start'; e.currentTarget.setPointerCapture(e.pointerId); }}
        />
        <div
          role="slider"
          aria-label="End marker"
          className="absolute top-0 bottom-0 w-3 -ml-1.5 rounded cursor-ew-resize touch-none"
          style={{ left: `${endPct}%`, background: 'var(--color-primary)' }}
          onPointerDown={(e) => { e.stopPropagation(); dragRef.current = 'end'; e.currentTarget.setPointerCapture(e.pointerId); }}
        />
      </div>
      <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>Drag the markers or click the bar to set in/out points.</p>
    </div>
  );
}

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
      { id: 'audio', label: 'Mute / replace audio', desc: 'Strip soundtrack or swap in a new track' },
    ],
  },
  {
    id: 'transform',
    label: 'Transform',
    tools: [
      { id: 'clip', label: 'Clip / trim', desc: 'Set in and out points' },
      { id: 'reframe', label: 'Crop / reframe', desc: '9:16, 16:9, 1:1, 4:5 — crop or letterbox' },
      { id: 'speed', label: 'Speed', desc: 'Slow-mo or speed up (0.25×–4×)' },
    ],
  },
  {
    id: 'compose',
    label: 'Compose',
    tools: [
      { id: 'annotate', label: 'Annotate', desc: 'Burn in a text label' },
      { id: 'overlay', label: 'Overlay / watermark', desc: 'Logo or image on top of video' },
      { id: 'join', label: 'Join videos', desc: 'Concatenate clips — hard cut or crossfade' },
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
  backgroundTransparent, setBackgroundTransparent,
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
      <label className="flex items-center gap-2 text-xs cursor-pointer sm:col-span-2" style={{ color: 'var(--color-muted)' }}>
        <input
          type="checkbox"
          checked={backgroundTransparent}
          onChange={(e) => setBackgroundTransparent(e.target.checked)}
        />
        Transparent background (text outline only)
      </label>
      {!backgroundTransparent && (
        <label className="block space-y-1 sm:col-span-2">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Background colour</span>
          <input type="color" value={backgroundColor} onChange={(e) => setBackgroundColor(e.target.value)} className="w-full h-9 rounded-xl border cursor-pointer" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }} />
        </label>
      )}
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

function MultiVideoUpload({ files, onFiles, label = 'Video files (order = join order)' }) {
  const inputRef = useRef(null);
  const move = (index, dir) => {
    const next = [...files];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    onFiles(next);
  };
  const removeAt = (index) => onFiles(files.filter((_, i) => i !== index));

  return (
    <div className="space-y-2">
      <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          {files.length ? 'Add more videos' : 'Choose videos'}
        </button>
        {files.length > 0 && (
          <button
            type="button"
            onClick={() => onFiles([])}
            className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Clear all
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files || []);
          if (!picked.length) return;
          onFiles([...files, ...picked].slice(0, 12));
          e.target.value = '';
        }}
      />
      {files.length > 0 && (
        <ul className="space-y-1.5 rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2 text-xs">
              <span className="shrink-0 w-5 text-center font-medium" style={{ color: 'var(--color-muted)' }}>{i + 1}</span>
              <span className="flex-1 truncate" style={{ color: 'var(--color-text)' }}>{f.name}</span>
              <span className="shrink-0" style={{ color: 'var(--color-muted)' }}>{formatBytes(f.size)}</span>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-1.5 py-0.5 rounded border transition-opacity hover:opacity-70 disabled:opacity-30" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }} aria-label="Move up">↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === files.length - 1} className="px-1.5 py-0.5 rounded border transition-opacity hover:opacity-70 disabled:opacity-30" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }} aria-label="Move down">↓</button>
              <button type="button" onClick={() => removeAt(i)} className="px-1.5 py-0.5 rounded border transition-opacity hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: '#ef4444' }} aria-label="Remove">×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
  const [clipDuration, setClipDuration] = useState(0);
  const clipVideoRef = useRef(null);

  // Convert
  const [crf, setCrf] = useState(23);
  const [maxWidth, setMaxWidth] = useState('');

  // Join
  const [joinFiles, setJoinFiles] = useState([]);
  const [joinMaxWidth, setJoinMaxWidth] = useState('1280');
  const [joinCrf, setJoinCrf] = useState(23);
  const [joinCrossfade, setJoinCrossfade] = useState('0');

  // Reframe
  const [reframeAspect, setReframeAspect] = useState('9:16');
  const [reframeMode, setReframeMode] = useState('crop');
  const [reframeFocus, setReframeFocus] = useState('center');

  // Audio mute/replace
  const [audioMode, setAudioMode] = useState('mute');
  const [audioFile, setAudioFile] = useState(null);

  // Speed
  const [speedFactor, setSpeedFactor] = useState('1.5');

  // Overlay
  const [overlayImageFile, setOverlayImageFile] = useState(null);
  const [overlayPosition, setOverlayPosition] = useState('bottom-right');
  const [overlayScale, setOverlayScale] = useState('20');
  const [overlayOpacity, setOverlayOpacity] = useState('0.85');

  // Annotate
  const [overlayText, setOverlayText] = useState('');
  const [textPosition, setTextPosition] = useState('bottom-center');

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
  const [textBackgroundTransparent, setTextBackgroundTransparent] = useState(false);
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
    if (tool === 'annotate' || tool === 'caption-studio' || tool === 'join' || tool === 'overlay') clearComposeResult();
  }, [tool, clearComposeResult]);

  useEffect(() => {
    if (!sourceFile || tool !== 'clip') return;
    setStartSec(0);
    setEndSec('');
    setClipDuration(0);
  }, [sourceFile, tool]);

  const handleClipVideoMeta = useCallback((e) => {
    const d = e.currentTarget.duration;
    if (Number.isFinite(d) && d > 0) {
      setClipDuration(d);
      setEndSec((prev) => (prev === '' ? String(Math.round(d * 10) / 10) : prev));
    }
  }, []);

  const handleClipEndChange = useCallback((val) => {
    setEndSec(String(Math.round(val * 10) / 10));
  }, []);

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
    backgroundTransparent: textBackgroundTransparent,
    position: textPosition,
  }), [textFontFamily, textFontSize, textFontColor, textFontWeight, textBackgroundColor, textBackgroundTransparent, textPosition]);

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

        {tool !== 'generate' && tool !== 'saved-library' && tool !== 'join' && tool !== 'overlay' && !(tool === 'caption-studio' && captionLibraryId) && (
          <VideoUpload file={sourceFile} onFile={(f) => { setSourceFile(f); if (f && tool === 'caption-studio') setCaptionLibraryId(''); }} />
        )}

        {previewUrl && tool !== 'generate' && tool !== 'saved-library' && tool !== 'join' && tool !== 'overlay' && (
          <>
            <video
              ref={tool === 'clip' ? clipVideoRef : undefined}
              src={previewUrl}
              controls
              className="w-full max-h-48 rounded-xl bg-black"
              onLoadedMetadata={tool === 'clip' ? handleClipVideoMeta : undefined}
            />
            {tool === 'clip' && (
              <ClipTimeline
                duration={clipDuration}
                startSec={startSec}
                endSec={endSec}
                onStartChange={setStartSec}
                onEndChange={handleClipEndChange}
              />
            )}
          </>
        )}

        {tool === 'clip' && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Clip / trim</h2>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Drag the timeline markers above, or fine-tune with seconds below.</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Start (seconds)</span>
                <input type="number" min={0} step={0.1} max={clipDuration || undefined} value={startSec} onChange={(e) => setStartSec(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>End (seconds)</span>
                <input type="number" min={0} step={0.1} max={clipDuration || undefined} value={endSec} onChange={(e) => setEndSec(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </label>
            </div>
            <button type="button" onClick={() => { if (!requireFile()) return; const fd = new FormData(); fd.append('video', sourceFile); fd.append('startSec', String(startSec)); if (endSec !== '') fd.append('endSec', String(endSec)); runFormVideo('clip', fd, { label: 'Clipping…', resultFilename: 'clip.mp4', forTool: 'clip' }); }} disabled={!ffmpegOk} className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
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

        {tool === 'audio' && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Mute / replace audio</h2>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Strip the soundtrack, or replace it with a music / voice file. Replace uses the shorter of video and audio length.
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'mute', label: 'Mute' },
                { id: 'replace', label: 'Replace audio' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setAudioMode(m.id)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-opacity hover:opacity-70"
                  style={{
                    borderColor: audioMode === m.id ? 'var(--color-primary)' : 'var(--color-border)',
                    color: audioMode === m.id ? 'var(--color-primary)' : 'var(--color-text)',
                    background: 'var(--color-bg)',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {audioMode === 'replace' && (
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Audio file (mp3 / wav / m4a)</span>
                <input
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a,.aac"
                  onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                  className="block w-full text-xs"
                  style={{ color: 'var(--color-text)' }}
                />
                {audioFile && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{audioFile.name}</span>}
              </label>
            )}
            <button
              type="button"
              onClick={() => {
                if (!requireFile()) return;
                if (audioMode === 'replace' && !audioFile) {
                  addToast('Choose an audio file to replace with', 'error');
                  return;
                }
                const fd = new FormData();
                fd.append('video', sourceFile);
                fd.append('mode', audioMode);
                if (audioMode === 'replace') fd.append('audio', audioFile);
                runFormVideo('audio', fd, {
                  label: audioMode === 'mute' ? 'Muting…' : 'Replacing audio…',
                  resultFilename: audioMode === 'mute' ? 'muted.mp4' : 'audio-replaced.mp4',
                  forTool: 'audio',
                });
              }}
              disabled={!ffmpegOk}
              className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              {audioMode === 'mute' ? 'Mute video' : 'Replace audio'}
            </button>
            {resultForTool === 'audio' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'reframe' && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Crop / reframe</h2>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Fit video to a social aspect ratio. Crop fills the frame (may trim edges); pad letterboxes without cutting.
            </p>
            <div className="flex flex-wrap gap-2">
              {['9:16', '16:9', '1:1', '4:5'].map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setReframeAspect(a)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-opacity hover:opacity-70"
                  style={{
                    borderColor: reframeAspect === a ? 'var(--color-primary)' : 'var(--color-border)',
                    color: reframeAspect === a ? 'var(--color-primary)' : 'var(--color-text)',
                    background: 'var(--color-bg)',
                  }}
                >
                  {a}{a === '9:16' ? ' · Reels' : a === '1:1' ? ' · Square' : ''}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'crop', label: 'Crop (fill)' },
                { id: 'pad', label: 'Pad (letterbox)' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setReframeMode(m.id)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-opacity hover:opacity-70"
                  style={{
                    borderColor: reframeMode === m.id ? 'var(--color-primary)' : 'var(--color-border)',
                    color: reframeMode === m.id ? 'var(--color-primary)' : 'var(--color-text)',
                    background: 'var(--color-bg)',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {reframeMode === 'crop' && (
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Crop focus</span>
                <select value={reframeFocus} onChange={(e) => setReframeFocus(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="center">Centre</option>
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </label>
            )}
            <button
              type="button"
              onClick={() => {
                if (!requireFile()) return;
                const fd = new FormData();
                fd.append('video', sourceFile);
                fd.append('aspect', reframeAspect);
                fd.append('mode', reframeMode);
                fd.append('focus', reframeFocus);
                runFormVideo('reframe', fd, { label: 'Reframing…', resultFilename: `reframed-${reframeAspect.replace(':', 'x')}.mp4`, forTool: 'reframe' });
              }}
              disabled={!ffmpegOk}
              className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              Reframe to {reframeAspect}
            </button>
            {resultForTool === 'reframe' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'speed' && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Speed</h2>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Change playback speed from 0.25× (slow-mo) to 4×. Audio tempo follows when a soundtrack is present.
            </p>
            <div className="flex flex-wrap gap-2">
              {['0.5', '0.75', '1.25', '1.5', '2', '3'].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSpeedFactor(s)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-opacity hover:opacity-70"
                  style={{
                    borderColor: speedFactor === s ? 'var(--color-primary)' : 'var(--color-border)',
                    color: speedFactor === s ? 'var(--color-primary)' : 'var(--color-text)',
                    background: 'var(--color-bg)',
                  }}
                >
                  {s}×
                </button>
              ))}
            </div>
            <label className="block space-y-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Custom speed (0.25–4)</span>
              <input type="number" min={0.25} max={4} step={0.05} value={speedFactor} onChange={(e) => setSpeedFactor(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
            </label>
            <button
              type="button"
              onClick={() => {
                if (!requireFile()) return;
                const s = Number(speedFactor);
                if (!Number.isFinite(s) || s < 0.25 || s > 4) {
                  addToast('Speed must be between 0.25 and 4', 'error');
                  return;
                }
                const fd = new FormData();
                fd.append('video', sourceFile);
                fd.append('speed', String(s));
                runFormVideo('speed', fd, { label: `Applying ${s}× speed…`, resultFilename: `speed-${s}x.mp4`, forTool: 'speed' });
              }}
              disabled={!ffmpegOk}
              className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              Apply {speedFactor || '?'}×
            </button>
            {resultForTool === 'speed' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'annotate' && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Annotate</h2>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Burn a styled text label into the full clip. The preview below appears only after you apply.</p>
            <input value={overlayText} onChange={(e) => setOverlayText(e.target.value)} placeholder="Label text" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
            <PositionGrid value={textPosition} onChange={setTextPosition} label="Label position" />
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
              backgroundTransparent={textBackgroundTransparent}
              setBackgroundTransparent={setTextBackgroundTransparent}
            />
            <button type="button" onClick={() => { if (!requireFile() || !overlayText.trim()) return; const fd = new FormData(); fd.append('video', sourceFile); fd.append('text', overlayText); fd.append('position', textPosition); appendTextStyleFields(fd); runFormVideo('annotate', fd, { label: 'Annotating…', resultFilename: 'annotated.mp4', forTool: 'annotate' }); }} disabled={!ffmpegOk} className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
              Apply label
            </button>
            {resultForTool === 'annotate' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'overlay' && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Overlay / watermark</h2>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Place a logo or image on top of the video. PNG with transparency works best.
            </p>
            <VideoUpload file={sourceFile} onFile={setSourceFile} label="Video" />
            {previewUrl && (
              <video src={previewUrl} controls className="w-full max-h-48 rounded-xl bg-black" />
            )}
            <label className="block space-y-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Overlay image (PNG / JPG)</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                onChange={(e) => setOverlayImageFile(e.target.files?.[0] || null)}
                className="block w-full text-xs"
                style={{ color: 'var(--color-text)' }}
              />
              {overlayImageFile && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{overlayImageFile.name}</span>}
            </label>
            <PositionGrid value={overlayPosition} onChange={setOverlayPosition} label="Overlay position" />
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Size (% of video width)</span>
                <input type="number" min={5} max={80} value={overlayScale} onChange={(e) => setOverlayScale(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Opacity (0.05–1)</span>
                <input type="number" min={0.05} max={1} step={0.05} value={overlayOpacity} onChange={(e) => setOverlayOpacity(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </label>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!requireFile()) return;
                if (!overlayImageFile) {
                  addToast('Choose an overlay image', 'error');
                  return;
                }
                const fd = new FormData();
                fd.append('video', sourceFile);
                fd.append('image', overlayImageFile);
                fd.append('position', overlayPosition);
                fd.append('scalePct', String(overlayScale));
                fd.append('opacity', String(overlayOpacity));
                runFormVideo('overlay', fd, { label: 'Applying overlay…', resultFilename: 'overlay.mp4', forTool: 'overlay' });
              }}
              disabled={!ffmpegOk}
              className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              Apply overlay
            </button>
            {resultForTool === 'overlay' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'join' && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Join videos</h2>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Concatenate two or more clips into one MP4. Clips are normalized to a common size and frame rate so mixed formats still join cleanly. Order in the list is the play order.
            </p>
            <MultiVideoUpload files={joinFiles} onFiles={setJoinFiles} />
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Max width (output)</span>
                <input type="number" min={320} max={3840} step={2} value={joinMaxWidth} onChange={(e) => setJoinMaxWidth(e.target.value)} placeholder="1280" className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Quality (CRF 18–35)</span>
                <input type="number" min={18} max={35} value={joinCrf} onChange={(e) => setJoinCrf(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </label>
              <label className="block space-y-1 col-span-2">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Crossfade (seconds) — 0 = hard cut</span>
                <input type="number" min={0} max={5} step={0.1} value={joinCrossfade} onChange={(e) => setJoinCrossfade(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </label>
            </div>
            <button
              type="button"
              onClick={() => {
                if (joinFiles.length < 2) {
                  addToast('Add at least two videos to join', 'error');
                  return;
                }
                const fd = new FormData();
                joinFiles.forEach((f) => fd.append('videos', f));
                if (joinMaxWidth) fd.append('maxWidth', String(joinMaxWidth));
                fd.append('crf', String(joinCrf));
                const xf = Number(joinCrossfade) || 0;
                if (xf > 0) fd.append('crossfadeSec', String(xf));
                runFormVideo('join', fd, {
                  label: xf > 0 ? 'Joining with crossfade…' : 'Joining videos…',
                  resultFilename: 'joined.mp4',
                  forTool: 'join',
                });
              }}
              disabled={!ffmpegOk || joinFiles.length < 2}
              className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}
            >
              Join {joinFiles.length || 0} clips{Number(joinCrossfade) > 0 ? ` · ${joinCrossfade}s fade` : ''}
            </button>
            {resultForTool === 'join' && (
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

            <PositionGrid value={textPosition} onChange={setTextPosition} label="Caption position" />

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
              backgroundTransparent={textBackgroundTransparent}
              setBackgroundTransparent={setTextBackgroundTransparent}
            />

            <div className="space-y-2">
              <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Subtitles (SRT)</p>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {status?.transcribe?.note || 'Paste SRT content or auto-transcribe when uploading a file.'}
                {' '}Caption burn re-encodes once to embed text — audio is copied unchanged from your source.
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
