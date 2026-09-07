import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';

const FIELD = {
  background: 'var(--color-bg)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
};

const MODES = [
  { id: 'article', label: 'Article content', hint: 'Readable text only — no ads, header/footer, sidebars, or images.' },
  { id: 'images', label: 'Extract images', hint: 'Every image on the page with alt text and absolute URLs.' },
  { id: 'styled', label: 'Exact scrape', hint: 'Page as it appears, original inline styles kept, sandboxed preview.' },
];

export default function WebExtractorPage() {
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const addToast = useToastStore((s) => s.addToast);

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.webExtractor !== false;

  const [url, setUrl] = useState('');
  const [mode, setMode] = useState('article');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); })
      .catch(() => {});
  }, []);

  const handleExtract = async () => {
    if (!url.trim()) {
      addToast('Paste a webpage URL', 'error');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await api.post('/api/web-extractor/extract', { url: url.trim(), mode });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Extraction failed');
      setResult(data);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      addToast('Copied', 'success');
    } catch {
      addToast('Could not copy', 'error');
    }
  };

  const [downloading, setDownloading] = useState(false);
  const [downloadingSrc, setDownloadingSrc] = useState(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  const saveBlob = (blob, filename) => {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const handleDownloadImage = async (src) => {
    setDownloadingSrc(src);
    try {
      const res = await api.post('/api/web-extractor/download-image', { src });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Download failed');
      }
      const blob = await res.blob();
      const name = decodeURIComponent(src.split('/').pop() || 'image').split('?')[0] || 'image';
      saveBlob(blob, name);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setDownloadingSrc(null);
    }
  };

  const handleDownloadAllImages = async () => {
    if (!result?.images?.length) return;
    setDownloadingAll(true);
    try {
      const res = await api.post('/api/web-extractor/download-images-zip', { images: result.images });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Zip failed');
      }
      const blob = await res.blob();
      saveBlob(blob, 'images.zip');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setDownloadingAll(false);
    }
  };
  const handleDownloadPdf = async () => {
    if (!result) return;
    setDownloading(true);
    try {
      const res = await api.post('/api/web-extractor/pdf', {
        title: result.title,
        byline: result.byline,
        url: result.url,
        text: result.text,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'PDF generation failed');
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `${(result.title || 'article').replace(/[^\w-]+/g, '-').slice(0, 60)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setDownloading(false);
    }
  };

  if (!canUse) return <Navigate to="/" replace />;

  return (
    <div className="flex flex-col min-h-[calc(100dvh-3rem)] p-6 space-y-4 max-w-4xl">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}>
          {getIcon('scissors', { size: 16 })}
        </div>
        <h1 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Web Extractor</h1>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
        Pull content from any public webpage — article text, images, or an exact visual scrape.
      </p>

      <label className="block space-y-1">
        <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Webpage URL</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.example.com/article"
          className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
          style={FIELD}
        />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className="text-left px-3.5 py-2.5 rounded-xl border transition-opacity hover:opacity-80"
            style={mode === m.id
              ? { background: 'var(--color-primary)', color: '#fff', borderColor: 'var(--color-primary)' }
              : { borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            <span className="block text-sm font-medium">{m.label}</span>
            <span className="block text-xs mt-0.5" style={{ color: mode === m.id ? 'rgba(255,255,255,0.85)' : 'var(--color-muted)' }}>
              {m.hint}
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={handleExtract}
        disabled={loading}
        className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50 w-fit"
        style={{ background: 'var(--color-primary)' }}
      >
        {loading ? 'Extracting…' : 'Extract'}
      </button>

      {result?.mode === 'article' && (
        <section className="rounded-2xl border p-6 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{result.title || result.url}</p>
              {result.byline ? <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{result.byline}</p> : null}
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <button
                type="button"
                onClick={() => copyText(result.text)}
                className="px-3.5 py-1.5 rounded-lg text-sm border transition-opacity hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                Copy text
              </button>
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={downloading}
                className="px-3.5 py-1.5 rounded-lg text-sm border transition-opacity hover:opacity-70 disabled:opacity-50"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                {downloading ? 'Preparing…' : 'Download PDF'}
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {String(result.text || '').split(/\n{2,}/).filter(Boolean).map((block, i) => {
              const m = block.match(/^(#{1,6})\s+(.*)$/s);
              if (m) {
                const level = m[1].length;
                return (
                  <p
                    key={i}
                    className="font-semibold"
                    style={{ color: 'var(--color-text)', fontSize: `${Math.max(12, 18 - level * 1.5)}px` }}
                  >
                    {m[2]}
                  </p>
                );
              }
              return (
                <p key={i} className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{block}</p>
              );
            })}
          </div>
        </section>
      )}

      {result?.mode === 'images' && (
        <section className="rounded-2xl border p-6 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{result.count} image{result.count === 1 ? '' : 's'}</p>
            {result.count > 0 && (
              <button
                type="button"
                onClick={handleDownloadAllImages}
                disabled={downloadingAll}
                className="px-3.5 py-1.5 rounded-lg text-sm border transition-opacity hover:opacity-70 disabled:opacity-50"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                {downloadingAll ? 'Zipping…' : 'Download all'}
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {result.images.map((img) => (
              <div key={img.src} className="space-y-1">
                <a href={img.src} target="_blank" rel="noreferrer" className="block transition-opacity hover:opacity-70">
                  <img src={img.src} alt={img.alt} className="w-full h-24 object-cover rounded-lg border" style={{ borderColor: 'var(--color-border)' }} />
                </a>
                <span className="block text-xs truncate" style={{ color: 'var(--color-muted)' }}>{img.alt || img.src}</span>
                <button
                  type="button"
                  onClick={() => handleDownloadImage(img.src)}
                  disabled={downloadingSrc === img.src}
                  className="w-full px-2 py-1 rounded-lg text-xs border transition-opacity hover:opacity-70 disabled:opacity-50"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {downloadingSrc === img.src ? 'Downloading…' : 'Download'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {result?.mode === 'styled' && (
        <section className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Sandboxed preview — original markup and inline styles</p>
            <button
              type="button"
              onClick={() => copyText(result.html)}
              className="px-3.5 py-1.5 rounded-lg text-sm border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              Copy HTML
            </button>
          </div>
          <iframe
            title="Exact scrape preview"
            srcDoc={result.html}
            sandbox=""
            className="w-full"
            style={{ height: '70vh', background: '#fff' }}
          />
        </section>
      )}
    </div>
  );
}
