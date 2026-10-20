import React, { useEffect, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import useProcessingStore, { runWithStepLog } from '../store/processingStore';
import { scrapeProgress, wasCancelled } from '../utils/scrapeProgress.mjs';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import Tooltip from '../components/Tooltip';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { VoiceInput, VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import SourceViewer from './restyle/SourceViewer';
import { formatHtml, shortenDataUris } from './restyle/sourceView.mjs';
import WebExtractorTutorChat from './webExtractor/WebExtractorTutorChat';
import {
  WEB_EXTRACTOR_TOOLS, GROUPS, GROUP_TIPS, TOOL_TIPS, TOOL_BLURBS, HOW_IT_WORKS, GUIDE_TOOLS, parseSpokenUrl, parseSpokenList, parseSpokenSelector,
  toCsv, tableToObjects, linksToRows, tableToRows,
} from './webExtractor/webExtractorTools.mjs';

const BUTTON = 'px-3.5 py-1.5 rounded-lg text-sm border transition-all duration-200 hover:opacity-70 disabled:opacity-50';
const BUTTON_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const NOTICE_STYLE = { background: '#fffbeb', borderColor: '#fde68a', color: '#b45309' };

/** Name the server gave a download (Content-Disposition), else the fallback. */
function fileNameFrom(res, fallback) {
  const m = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
  return m ? m[1] : fallback;
}

export default function WebExtractorPage() {
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const addToast = useToastStore((s) => s.addToast);
  const info = useToolInfoModal('vault_web_extractor_info_seen');
  const [searchParams] = useSearchParams();

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.webExtractor !== false;

  const [url, setUrl] = useState('');
  const [mode, setMode] = useState(() => {
    const wanted = searchParams.get('tool');
    return WEB_EXTRACTOR_TOOLS.some((t) => t.id === wanted) ? wanted : 'article';
  });
  const [excludeTerms, setExcludeTerms] = useState('');
  const [selector, setSelector] = useState('');
  const [linkType, setLinkType] = useState('all');
  const [linkQuery, setLinkQuery] = useState('');
  const [loadingMode, setLoadingMode] = useState(null);
  // Each tool keeps its own result while you move between tools.
  const [results, setResults] = useState({});
  const result = results[mode] || null;
  const loading = loadingMode === mode;

  const [toolSearch, setToolSearch] = useState('');
  const [closedGroups, setClosedGroups] = useState(() => new Set());
  const toolSearchRef = useRef(null);
  const urlRef = useRef(null);
  const requestId = useRef(0);

  // Exact scrape: the preview, or the page's HTML source (as fetched, or the self-contained copy)
  const [styledView, setStyledView] = useState('preview');
  const [styledSource, setStyledSource] = useState({ view: 'raw', query: '', wrap: false });
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingSrc, setDownloadingSrc] = useState(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); })
      .catch(() => {});
  }, []);

  // "/" jumps to the tool search, Esc clears it (same keys as Graphics).
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        toolSearchRef.current?.focus();
      } else if (e.key === 'Escape' && typing && el === toolSearchRef.current) {
        setToolSearch('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleExtract = async () => {
    if (!url.trim()) {
      addToast('Paste a webpage address', 'error');
      urlRef.current?.focus();
      return;
    }
    const runMode = mode;
    const myRequest = ++requestId.current;
    setLoadingMode(runMode);
    setResults((r) => ({ ...r, [runMode]: null }));
    if (runMode === 'styled') setStyledView('preview');
    try {
      const excludeSections = excludeTerms.split(',').map((s) => s.trim()).filter(Boolean);
      const stop = new AbortController();
      const ask = async () => {
        const res = await api.post('/api/web-extractor/extract', { url: url.trim(), mode: runMode, excludeSections, selector: selector.trim() }, { signal: stop.signal });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Extraction failed');
        return body;
      };
      // Exact scrape fetches the style files and copies the pictures in, which can take a while: it gets the progress window.
      // The other tools answer in a moment and keep their own spinner.
      const progress = scrapeProgress('exact', { url });
      const data = runMode === 'styled'
        ? await runWithStepLog(useProcessingStore.getState(), progress.title, progress.detail, progress.steps, ask, { onCancel: () => stop.abort() })
        : await ask();
      if (myRequest === requestId.current) setResults((r) => ({ ...r, [runMode]: data }));
    } catch (err) {
      if (!wasCancelled(err)) addToast(err.message, 'error');
    } finally {
      if (myRequest === requestId.current) setLoadingMode(null);
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

  const downloadText = (text, filename, type) => saveBlob(new Blob([text], { type }), filename);
  const downloadCsv = (rows, filename) => downloadText(toCsv(rows), filename, 'text/csv;charset=utf-8');
  // File names from the page address, e.g. example-com-links.csv
  const hostSlug = (address) => {
    try { return new URL(address).hostname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'page'; } catch { return 'page'; }
  };

  const failMessage = async (res, fallback) => {
    const data = await res.json().catch(() => ({}));
    return data.error || fallback;
  };

  const handleDownloadImage = async (src) => {
    setDownloadingSrc(src);
    try {
      const res = await api.post('/api/web-extractor/download-image', { src });
      if (!res.ok) throw new Error(await failMessage(res, 'Download failed'));
      saveBlob(await res.blob(), fileNameFrom(res, 'image.jpg'));
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setDownloadingSrc(null);
    }
  };

  const handleDownloadAllImages = async () => {
    const images = results.images?.images;
    if (!images?.length) return;
    setDownloadingAll(true);
    try {
      const res = await api.post('/api/web-extractor/download-images-zip', { images });
      if (!res.ok) throw new Error(await failMessage(res, 'Zip failed'));
      const failed = Number(res.headers.get('X-Images-Failed') || 0);
      const total = Number(res.headers.get('X-Images-Total') || 0);
      saveBlob(await res.blob(), 'images.zip');
      if (failed > 0) addToast(`${failed} of ${total} pictures could not be downloaded and are not in the zip.`, 'error');
      else if (images.length > total && total > 0) addToast(`The zip holds the first ${total} of ${images.length} pictures.`, 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setDownloadingAll(false);
    }
  };

  const handleDownloadPdf = async () => {
    const article = results.article;
    if (!article) return;
    setDownloadingPdf(true);
    try {
      const res = await api.post('/api/web-extractor/pdf', {
        title: article.title, byline: article.byline, url: article.url, text: article.text,
      });
      if (!res.ok) throw new Error(await failMessage(res, 'PDF generation failed'));
      const replaced = Number(res.headers.get('X-Pdf-Replaced') || 0);
      saveBlob(await res.blob(), fileNameFrom(res, 'article.pdf'));
      if (replaced > 0) addToast(`${replaced} letter${replaced === 1 ? '' : 's'} the PDF font cannot show ${replaced === 1 ? 'was' : 'were'} replaced with ?.`, 'error');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setDownloadingPdf(false);
    }
  };

  // The guide's "Open" buttons: switch to the tool, exactly as clicking it in the list would.
  const openToolById = (id) => {
    const target = GUIDE_TOOLS.find((t) => t.id === id);
    if (target) setMode(target.mode);
  };

  const toggleGroup = (label) => setClosedGroups((prev) => {
    const next = new Set(prev);
    if (next.has(label)) next.delete(label); else next.add(label);
    return next;
  });

  if (!canUse) return <Navigate to="/" replace />;

  const q = toolSearch.trim().toLowerCase();
  const matches = (t) => !q || t.label.toLowerCase().includes(q) || (TOOL_TIPS[t.id] || '').toLowerCase().includes(q);
  const anyMatch = WEB_EXTRACTOR_TOOLS.some(matches);
  const current = WEB_EXTRACTOR_TOOLS.find((t) => t.id === mode);

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <aside
          className="w-full sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r overflow-y-auto p-4 space-y-3"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>
              {getIcon('scissors', { size: 16 })}
            </div>
            <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Web Extractor</h1>
            <Tooltip text="How the Web Extractor works, and what it cannot do.">
              <button
                type="button"
                onClick={info.open}
                aria-label="How the Web Extractor works"
                className="transition-opacity duration-200 hover:opacity-60"
                style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                {getIcon('info', { size: 13 })}
              </button>
            </Tooltip>
          </div>

          {info.show && (
            <ToolInfoModal title="How the Web Extractor Works" onClose={info.close}>
              <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                Pull the text, the pictures or a snapshot out of any public web page. Pick a tool in the list on the left, paste an address, press Extract. Hover any tool for a plain explanation. Not sure which to use? Press the round button at the bottom right and tell the guide what you want.
              </p>
              <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                {HOW_IT_WORKS.map(([heading, text]) => (
                  <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
                ))}
              </div>
            </ToolInfoModal>
          )}

          <Tooltip text="Filter the tool list below by name or description. Press / to jump here. The microphone lets you say it instead.">
            <div className="w-full">
              <VoiceInput
                inputRef={toolSearchRef}
                value={toolSearch}
                onChange={setToolSearch}
                placeholder="Search tools…"
                label="Search tools"
                className="!py-1.5 !text-xs !rounded-lg"
              />
            </div>
          </Tooltip>

          {GROUPS.map((group) => {
            const tools = WEB_EXTRACTOR_TOOLS.filter((t) => t.group === group && matches(t));
            if (!tools.length) return null;
            const open = !closedGroups.has(group);
            return (
              <div key={group}>
                <Tooltip text={GROUP_TIPS[group]} side="right">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group)}
                    className="text-xs font-semibold w-full text-left py-1 transition-opacity duration-200 hover:opacity-70"
                    style={{ color: 'var(--color-primary)' }}
                  >
                    {open ? '▼' : '▶'} {group}
                  </button>
                </Tooltip>
                {(open || q) && (
                  <ul className="pl-2 border-l ml-1 space-y-0.5 mt-1" style={{ borderColor: 'var(--color-border)' }}>
                    {tools.map((t) => (
                      <li key={t.id}>
                        <Tooltip text={TOOL_TIPS[t.id] || t.label} side="right">
                          <button
                            type="button"
                            onClick={() => setMode(t.id)}
                            className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-lg text-xs transition-opacity duration-200 hover:opacity-70"
                            style={{
                              background: mode === t.id ? 'var(--color-bg)' : 'transparent',
                              color: mode === t.id ? 'var(--color-text)' : 'var(--color-muted)',
                            }}
                          >
                            {getIcon(t.icon, { size: 13 })}
                            {t.label}
                          </button>
                        </Tooltip>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {q && !anyMatch && <p className="px-2 text-xs" style={{ color: 'var(--color-muted)' }}>No tools match “{toolSearch}”.</p>}
        </aside>

        {/* ── Main panel ──────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 overflow-y-auto p-6 space-y-4 max-w-5xl">
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{current?.label}</h2>
            <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>{TOOL_BLURBS[mode]}</p>
          </div>

          <div className="space-y-1">
            <label htmlFor="web-extractor-url" className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Webpage address</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Tooltip text="The address of a public web page, such as https://www.example.com/article. Paste it, type it, or tap the microphone and say it (“example dot com slash news”).">
                <div className="flex-1 min-w-0">
                  <VoiceInput
                    id="web-extractor-url"
                    inputRef={urlRef}
                    value={url}
                    onChange={setUrl}
                    parse={parseSpokenUrl}
                    placeholder="https://www.example.com/article"
                    label="Webpage address"
                    onKeyDown={(e) => { if (e.key === 'Enter' && !loading) handleExtract(); }}
                  />
                </div>
              </Tooltip>
              <Tooltip text={`Fetch the page and run ${current?.label || 'the tool'} on it.`}>
                <button
                  type="button"
                  onClick={handleExtract}
                  disabled={loading}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity duration-200 hover:opacity-80 disabled:opacity-50 shrink-0"
                  style={{ background: 'var(--color-primary)' }}
                >
                  {loading ? 'Extracting…' : 'Extract'}
                </button>
              </Tooltip>
            </div>
          </div>

          {mode === 'article' && (
            <div className="space-y-1">
              <label htmlFor="web-extractor-exclude" className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>
                Also exclude sections titled… <span>(optional, separate with commas, e.g. “Author, Date, Newsletter signup”)</span>
              </label>
              <Tooltip text="Boxes on the page whose heading is one of these words are left out of the text. It matches the whole heading word, so “Date” does not remove “Updates”.">
                <div>
                  <VoiceInput
                    id="web-extractor-exclude"
                    value={excludeTerms}
                    onChange={setExcludeTerms}
                    parse={parseSpokenList}
                    placeholder="Author, Date, In this section"
                    label="Sections to exclude"
                    onKeyDown={(e) => { if (e.key === 'Enter' && !loading) handleExtract(); }}
                  />
                </div>
              </Tooltip>
            </div>
          )}

          {mode === 'article' && (
            <div className="space-y-1">
              <label htmlFor="web-extractor-selector" className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>
                Only extract inside… <span>(optional CSS selector, e.g. “.product-card” or “#story”)</span>
              </label>
              <Tooltip text="Read only the boxes on the page that match this CSS selector, such as .product-card or #story. Needs the class or id names used in the page (right-click the page and choose Inspect). Leave empty to read the whole article. You can say it: “dot product dash card”.">
                <div>
                  <VoiceInput
                    id="web-extractor-selector"
                    value={selector}
                    onChange={setSelector}
                    parse={parseSpokenSelector}
                    placeholder=".product-card"
                    label="CSS selector"
                    spellCheck={false}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !loading) handleExtract(); }}
                  />
                </div>
              </Tooltip>
            </div>
          )}

          {loading && (
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Fetching the page…</p>
          )}

          {result?.notice ? (
            <p className="text-sm rounded-xl border px-4 py-3" style={NOTICE_STYLE} role="status">{result.notice}</p>
          ) : null}

          {result?.mode === 'article' && (
            <section className="rounded-2xl border p-6 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold break-words" style={{ color: 'var(--color-text)' }}>{result.title || result.url}</p>
                  {result.byline ? <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{result.byline}</p> : null}
                  {result.wordCount ? (
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      {result.wordCount.toLocaleString()} words · about {result.readingMinutes} min read
                      {typeof result.matchCount === 'number' ? ` · ${result.matchCount} box${result.matchCount === 1 ? '' : 'es'} matched` : ''}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <Tooltip text="Copy the extracted text to the clipboard.">
                    <button type="button" onClick={() => copyText(result.text)} disabled={!result.text} className={BUTTON} style={BUTTON_STYLE}>Copy text</button>
                  </Tooltip>
                  <Tooltip text="Save the extracted text as a plain A4 PDF with the title, author and address at the top.">
                    <button type="button" onClick={handleDownloadPdf} disabled={downloadingPdf || !result.text} className={BUTTON} style={BUTTON_STYLE}>
                      {downloadingPdf ? 'Preparing…' : 'Download PDF'}
                    </button>
                  </Tooltip>
                </div>
              </div>
              <div className="space-y-3">
                {String(result.text || '').split(/\n{2,}/).filter(Boolean).map((block, i) => {
                  const m = block.match(/^(#{1,6})\s+(.*)$/s);
                  if (m) {
                    const level = m[1].length;
                    return (
                      <p key={i} className="font-semibold" style={{ color: 'var(--color-text)', fontSize: `${Math.max(12, 18 - level * 1.5)}px` }}>
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
                  <Tooltip text="Save every picture below in one zip (the first 60 if there are more). Any that cannot be fetched are reported.">
                    <button type="button" onClick={handleDownloadAllImages} disabled={downloadingAll} className={BUTTON} style={BUTTON_STYLE}>
                      {downloadingAll ? 'Zipping…' : 'Download all'}
                    </button>
                  </Tooltip>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {result.images.map((img) => (
                  <div key={img.src} className="space-y-1">
                    <Tooltip text="Open this picture at full size in a new tab.">
                      <a href={img.src} target="_blank" rel="noreferrer noopener" className="block transition-opacity duration-200 hover:opacity-70">
                        <img
                          src={img.src}
                          alt={img.alt}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="w-full h-24 object-cover rounded-lg border"
                          style={{ borderColor: 'var(--color-border)' }}
                        />
                      </a>
                    </Tooltip>
                    <span className="block text-xs truncate" style={{ color: 'var(--color-muted)' }}>{img.alt || img.src}</span>
                    <Tooltip text="Save this one picture.">
                      <button
                        type="button"
                        onClick={() => handleDownloadImage(img.src)}
                        disabled={downloadingSrc === img.src}
                        className="w-full px-2 py-1 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70 disabled:opacity-50"
                        style={BUTTON_STYLE}
                      >
                        {downloadingSrc === img.src ? 'Downloading…' : 'Download'}
                      </button>
                    </Tooltip>
                  </div>
                ))}
              </div>
            </section>
          )}

          {result?.mode === 'links' && (() => {
            const typeLabel = { internal: 'This site', external: 'Other site', email: 'Email', phone: 'Phone' };
            const words = linkQuery.trim().toLowerCase();
            const shown = result.links.filter((l) => (linkType === 'all' || l.type === linkType || (linkType === 'other' && (l.type === 'email' || l.type === 'phone')))
              && (!words || l.text.toLowerCase().includes(words) || l.href.toLowerCase().includes(words)));
            const filters = [
              ['all', `All (${result.count})`], ['internal', `This site (${result.internalCount})`],
              ['external', `Other sites (${result.externalCount})`], ['other', `Email and phone (${result.otherCount})`],
            ];
            return (
              <section className="rounded-2xl border p-6 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                    {shown.length === result.count ? `${result.count} link${result.count === 1 ? '' : 's'}` : `${shown.length} of ${result.count} links`}
                    {result.truncated ? ' (first 2000)' : ''}
                  </p>
                  <div className="flex items-center gap-2">
                    <Tooltip text="Copy the addresses shown below, one per line.">
                      <button type="button" onClick={() => copyText(shown.map((l) => l.href).join('\n'))} disabled={!shown.length} className={BUTTON} style={BUTTON_STYLE}>Copy links</button>
                    </Tooltip>
                    <Tooltip text="Save the links shown below as a CSV file that opens in Excel or Google Sheets.">
                      <button type="button" onClick={() => downloadCsv(linksToRows(shown), `${hostSlug(result.url)}-links.csv`)} disabled={!shown.length} className={BUTTON} style={BUTTON_STYLE}>Download CSV</button>
                    </Tooltip>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {filters.map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setLinkType(id)}
                      className="px-3 py-1 rounded-lg text-xs border transition-all duration-200 hover:opacity-70"
                      style={linkType === id
                        ? { background: 'var(--color-primary)', color: '#fff', borderColor: 'var(--color-primary)' }
                        : { borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <Tooltip text="Show only links whose words or address contain this. You can say it with the microphone.">
                  <div className="max-w-sm">
                    <VoiceInput value={linkQuery} onChange={setLinkQuery} placeholder="Filter links…" label="Filter links" className="!py-1.5 !text-xs !rounded-lg" />
                  </div>
                </Tooltip>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>This lists the links in the page. It does not check that they still work.</p>
                <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                  {shown.map((l) => (
                    <li key={l.href} className="py-2 flex items-start gap-3 min-w-0" style={{ borderColor: 'var(--color-border)' }}>
                      <span className="shrink-0 w-24 text-xs pt-0.5" style={{ color: 'var(--color-muted)' }}>{typeLabel[l.type] || l.type}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium break-words" style={{ color: 'var(--color-text)' }}>{l.text || '(no words)'}{l.occurrences > 1 ? ` · ${l.occurrences}×` : ''}{l.nofollow ? ' · nofollow' : ''}</p>
                        <a href={l.href} target="_blank" rel="noreferrer noopener" className="text-xs break-all transition-opacity duration-200 hover:opacity-70" style={{ color: 'var(--color-primary)' }}>{l.href}</a>
                      </div>
                    </li>
                  ))}
                </ul>
                {!shown.length && result.count > 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No links match that filter.</p>}
              </section>
            );
          })()}

          {result?.mode === 'tables' && (
            <section className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{result.count} table{result.count === 1 ? '' : 's'}</p>
                {result.count > 0 && (
                  <Tooltip text="Save every table in one JSON file. Each row is keyed by its column headings.">
                    <button
                      type="button"
                      onClick={() => downloadText(JSON.stringify(result.tables.map((t) => ({ caption: t.caption, rows: tableToObjects(t) })), null, 2), `${hostSlug(result.url)}-tables.json`, 'application/json')}
                      className={BUTTON}
                      style={BUTTON_STYLE}
                    >
                      Download all as JSON
                    </button>
                  </Tooltip>
                )}
              </div>
              {result.tables.map((t, i) => (
                <div key={i} className="rounded-2xl border p-4 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                      Table {i + 1}{t.caption ? `: ${t.caption}` : ''} <span className="font-normal" style={{ color: 'var(--color-muted)' }}>· {t.rowCount} row{t.rowCount === 1 ? '' : 's'}, {t.colCount} column{t.colCount === 1 ? '' : 's'}</span>
                    </p>
                    <div className="flex items-center gap-2">
                      <Tooltip text="Copy this table as CSV text.">
                        <button type="button" onClick={() => copyText(toCsv(tableToRows(t)).replace(/^\uFEFF/, ''))} className={BUTTON} style={BUTTON_STYLE}>Copy CSV</button>
                      </Tooltip>
                      <Tooltip text="Save this table as a CSV file that opens in Excel or Google Sheets.">
                        <button type="button" onClick={() => downloadCsv(tableToRows(t), `${hostSlug(result.url)}-table-${i + 1}.csv`)} className={BUTTON} style={BUTTON_STYLE}>Download CSV</button>
                      </Tooltip>
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                    <table className="w-full text-xs">
                      {t.headers && (
                        <thead>
                          <tr>{t.headers.map((h, c) => <th key={c} className="text-left px-3 py-1.5 font-semibold border-b whitespace-nowrap" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>{h}</th>)}</tr>
                        </thead>
                      )}
                      <tbody>
                        {t.rows.slice(0, 200).map((row, r) => (
                          <tr key={r}>{Array.from({ length: t.colCount }, (_, c) => <td key={c} className="px-3 py-1.5 border-b align-top" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>{row[c] || ''}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {t.rows.length > 200 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Showing the first 200 rows here. The CSV and JSON have all {t.rowCount}.</p>}
                </div>
              ))}
            </section>
          )}

          {result?.mode === 'metadata' && (() => {
            const facts = [
              ['Title', result.title], ['Title tag', result.titleTag !== result.title ? result.titleTag : ''], ['Description', result.description],
              ['Canonical address', result.canonical], ['Author', result.author], ['Published', result.published], ['Updated', result.modified],
              ['Language', result.language], ['Site name', result.siteName], ['Robots', result.robots], ['Keywords', result.keywords],
            ].filter(([, v]) => v);
            const tagRows = (label, obj) => Object.entries(obj || {}).map(([k, v]) => [`${label}:${k}`, v]);
            const tags = [...tagRows('og', result.og), ...tagRows('twitter', result.twitter), ...tagRows('article', result.article)];
            const card = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
            return (
              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Page metadata</p>
                  <Tooltip text="Copy everything shown here as JSON.">
                    <button type="button" onClick={() => copyText(JSON.stringify(result, (k, v) => (k === 'notice' || k === 'mode' ? undefined : v), 2))} className={BUTTON} style={BUTTON_STYLE}>Copy JSON</button>
                  </Tooltip>
                </div>
                {result.h1Count !== 1 && (
                  <p className="text-sm rounded-xl border px-4 py-3" style={NOTICE_STYLE} role="status">
                    {result.h1Count === 0 ? 'This page has no main heading (H1).' : `This page has ${result.h1Count} main headings (H1); one is usual.`}
                  </p>
                )}
                <div className="rounded-2xl border p-4" style={card}>
                  <dl className="space-y-2">
                    {facts.map(([k, v]) => (
                      <div key={k} className="flex gap-3 text-xs">
                        <dt className="shrink-0 w-32" style={{ color: 'var(--color-muted)' }}>{k}</dt>
                        <dd className="min-w-0 break-words" style={{ color: 'var(--color-text)' }}>{v}</dd>
                      </div>
                    ))}
                    {!facts.length && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>The page declares no title, description or dates.</p>}
                  </dl>
                </div>
                {tags.length > 0 && (
                  <div className="rounded-2xl border p-4 space-y-2" style={card}>
                    <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Share tags (Open Graph, Twitter, article)</p>
                    {tags.map(([k, v]) => (
                      <div key={k} className="flex gap-3 text-xs">
                        <span className="shrink-0 w-40 break-words" style={{ color: 'var(--color-muted)' }}>{k}</span>
                        <span className="min-w-0 break-all" style={{ color: 'var(--color-text)' }}>{v}</span>
                      </div>
                    ))}
                  </div>
                )}
                {result.headings.length > 0 && (
                  <div className="rounded-2xl border p-4 space-y-1" style={card}>
                    <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Headings outline</p>
                    {result.headings.map((h, i) => (
                      <p key={i} className="text-xs break-words" style={{ paddingLeft: (h.level - 1) * 14, color: 'var(--color-text)' }}>
                        <span style={{ color: 'var(--color-muted)' }}>H{h.level}</span> {h.text}
                      </p>
                    ))}
                  </div>
                )}
                {(result.jsonLd.length > 0 || result.jsonLdSkipped > 0) && (
                  <div className="rounded-2xl border p-4 space-y-2" style={card}>
                    <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Structured data (JSON-LD)</p>
                    {result.jsonLd.map((block, i) => (
                      <pre key={i} className="text-xs overflow-x-auto rounded-lg p-3" style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>{JSON.stringify(block, null, 2)}</pre>
                    ))}
                    {result.jsonLdSkipped > 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{result.jsonLdSkipped} block{result.jsonLdSkipped === 1 ? ' was' : 's were'} left out (too large, too many, or not valid JSON).</p>}
                  </div>
                )}
              </section>
            );
          })()}

          {result?.mode === 'styled' && (() => {
            const views = [
              { id: 'raw', label: 'As fetched', tip: 'The page exactly as the website sent it, before anything was done to it.', available: !!result.sourceHtml },
              { id: 'page', label: 'The copy', tip: 'The copy shown in the preview: scripts removed, addresses made complete, style files and pictures copied in (pictures are shortened here).', available: true },
            ];
            const view = (views.find((v) => v.id === styledSource.view && v.available) || views[1]).id;
            const text = view === 'raw' ? formatHtml(result.sourceHtml || '') : formatHtml(shortenDataUris(result.html));
            const seg = (on, first, last) => ({ padding: '5px 12px', fontSize: '0.8rem', cursor: 'pointer', border: '1px solid var(--color-border)', background: on ? 'var(--color-primary)' : 'var(--color-bg)', color: on ? '#fff' : 'var(--color-text)', borderRadius: first ? '8px 0 0 8px' : last ? '0 8px 8px 0' : 0 });
            return (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex" role="group" aria-label="Preview or source">
                    <Tooltip text="The page as it looks, in a safe preview where nothing can run."><button type="button" aria-pressed={styledView === 'preview'} onClick={() => setStyledView('preview')} className="transition-opacity duration-200 hover:opacity-70" style={seg(styledView === 'preview', true, false)}>Preview</button></Tooltip>
                    <Tooltip text="Read the page's HTML, laid out so it is readable. Choose the page as fetched, or the copy shown in the preview."><button type="button" aria-pressed={styledView === 'source'} onClick={() => setStyledView('source')} className="transition-opacity duration-200 hover:opacity-70" style={seg(styledView === 'source', false, true)}>HTML source</button></Tooltip>
                  </div>
                  {result.stats && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{result.stats.cssInlined} style file{result.stats.cssInlined === 1 ? '' : 's'} and {result.stats.imagesInlined} picture{result.stats.imagesInlined === 1 ? '' : 's'} copied in.</p>}
                </div>
                {styledView === 'source' ? (
                  <SourceViewer
                    views={views} active={view} onActive={(v) => setStyledSource((st) => ({ ...st, view: v }))} text={text}
                    note={view === 'raw' && result.sourceTruncated ? 'This page is very large: only the first 2 MB is shown here.' : ''}
                    query={styledSource.query} onQuery={(query) => setStyledSource((st) => ({ ...st, query }))} wrap={styledSource.wrap} onWrap={(wrap) => setStyledSource((st) => ({ ...st, wrap }))}
                    onCopy={() => copyText(view === 'raw' ? result.sourceHtml : result.html)}
                    onDownload={() => saveBlob(new Blob([view === 'raw' ? result.sourceHtml : result.html], { type: 'text/html' }), `${(() => { try { return new URL(result.url).hostname.replace(/[^a-z0-9]+/gi, '-'); } catch { return 'page'; } })()}-${view === 'raw' ? 'source' : 'copy'}.html`)}
                    downloadLabel="Download .html" empty="Nothing to show."
                  />
                ) : (
                  <section className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="flex items-center justify-between gap-3 px-4 py-2 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Safe preview: the page as a still copy, with its styles and pictures built in. Nothing on it can run</p>
                      <Tooltip text="Copy the copy's code: one self-contained page with its styles and pictures built in.">
                        <button type="button" onClick={() => copyText(result.html)} className={BUTTON} style={BUTTON_STYLE}>Copy HTML</button>
                      </Tooltip>
                    </div>
                    <iframe
                      title="Exact scrape preview"
                      srcDoc={result.html}
                      sandbox=""
                      referrerPolicy="no-referrer"
                      className="w-full"
                      style={{ height: '70vh', background: '#fff' }}
                    />
                  </section>
                )}
              </>
            );
          })()}
        </div>
      </div>

      <WebExtractorTutorChat currentTool={mode} onOpenTool={openToolById} />
    </VoiceInputProvider>
  );
}
