// PDF → HTML: chosen pages become one responsive web page plus the pictures inside the PDF, previewed here, changed by asking,
// and downloaded as a zip (index.html + images/). The browser renders each page (in slices if tall) and reads its text (pdfjs); the
// server pulls the pictures out and a model that can see pictures writes the HTML, as a BACKGROUND JOB (services/pdfToHtmlJobs.js):
// this page starts it, shows progress and the page as it grows, and can be left; the job, its pictures and its undo list are kept 7 days.
import { useState, useMemo, useEffect, useRef } from 'react';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import {
  ToolHeader, PdfUpload, RunBtn, ErrMsg, PdfPagePreview,
  readFileAsDataUrl, dataUrlToUint8Array, initPdfjsWorker, getPdfPageCount, downloadFile,
} from '../PdfPage';
import { parsePageRange } from './PdfExtraTools';
import { renderScale, planSlices, sliceBudget, textLines, linesPerSlice, SLICE_OVERLAP } from './pdfToHtmlLayout.mjs';

const MAX_PAGES = 5; // matches server/services/pdfToHtml.js
const lbl = 'block text-xs font-medium mb-1';
const inp = 'w-full text-sm px-3 py-2 rounded-lg border outline-none';
const inpStyle = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const muted = { color: 'var(--color-muted)' };
const smallBtn = 'px-3 py-1.5 rounded-lg text-xs font-medium border hover:opacity-70 transition-opacity duration-200 disabled:opacity-40';
const smallBtnStyle = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' };
const VIEWS = [
  { id: 'phone', label: 'Phone', width: 390, icon: 'smartphone', tip: 'Show the page 390 pixels wide, like a phone.' },
  { id: 'tablet', label: 'Tablet', width: 768, icon: 'tablet', tip: 'Show the page 768 pixels wide, like a tablet held upright.' },
  { id: 'desktop', label: 'Desktop', width: null, icon: 'monitor', tip: 'Show the page as wide as this panel.' },
];

const SHOW_ORIGINAL_KEY = 'vault_pdf_html_show_original';
const LINK_SCROLL_KEY = 'vault_pdf_html_link_scroll';

// Scroll position as a share of how far it can scroll (0 = top, 1 = bottom), and the reverse. The PDF and the web page are different
// heights, so "the same share of the way down" is how the two sides are kept roughly level.
const scrollShare = (top, height, view) => (height - view > 0 ? top / (height - view) : 0);
const scrollTo = (share, height, view) => Math.max(0, share * (height - view));

const baseName = (f) => (f?.name || 'document').replace(/\.pdf$/i, '');

// Each chosen page rendered about 1400 px wide. A tall page (a website mock-up) is cut into slices top to bottom so the model can read
// it; each slice comes with its own text in reading order (pdfToHtmlLayout.mjs). Returns one entry per slice.
async function renderPagesForModel(dataUrl, pageNumbers) {
  const pdfjsLib = await import('pdfjs-dist');
  await initPdfjsWorker(pdfjsLib);
  const doc = await pdfjsLib.getDocument({ data: dataUrlToUint8Array(dataUrl) }).promise;
  const pageImages = [];
  const pageTexts = [];
  const slices = [];
  const originals = []; // each whole page as one picture, for the "Show original" pane (not sent to the server)
  for (const [idx, n] of pageNumbers.entries()) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: renderScale(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    const tc = await page.getTextContent();
    const items = tc.items.map((it) => {
      const t = pdfjsLib.Util.transform(vp.transform, it.transform);
      return { str: it.str, x: t[4], y: t[5], w: (it.width || 0) * vp.scale, h: Math.hypot(t[2], t[3]) };
    });
    const bands = planSlices(canvas.width, canvas.height, sliceBudget(pageImages.length, pageNumbers.length - idx));
    const texts = linesPerSlice(textLines(items), bands);
    for (const [i, b] of bands.entries()) {
      const bottom = i < bands.length - 1 ? Math.min(canvas.height, b.bottom + SLICE_OVERLAP) : b.bottom;
      const part = document.createElement('canvas');
      part.width = canvas.width;
      part.height = Math.max(1, bottom - b.top);
      part.getContext('2d').drawImage(canvas, 0, b.top, canvas.width, part.height, 0, 0, canvas.width, part.height);
      pageImages.push(part.toDataURL('image/jpeg', 0.85));
      pageTexts.push(texts[i]);
      slices.push({ page: n, part: i + 1, parts: bands.length });
      part.width = part.height = 0;
    }
    originals.push({ page: n, dataUrl: canvas.toDataURL('image/jpeg', 0.8) });
    canvas.width = canvas.height = 0;
  }
  return { pageImages, pageTexts, slices, originals };
}

// The preview iframe cannot reach images/… (it has no files), so each path is swapped for the picture's data URL.
function withInlineImages(html, images) {
  let out = html;
  for (const im of images) out = out.split(`images/${im.name}`).join(im.dataUrl);
  return out;
}

const LAST_JOB_KEY = 'vault_pdf_html_last_job';
const POLL_MS = 2000;
const PARTIAL_STEP = 3000; // the growing preview is redrawn when this many more characters have arrived (each redraw reloads the frame)
const STATUS_WORDS = { running: 'Working', done: 'Ready', failed: 'Failed', cancelled: 'Stopped' };
const readLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLocal = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch { /* not remembered */ } };
const ago = (ts) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

// Progress of a background job: stage, bar, characters written, and Stop. Leaving the page does not stop it.
function JobProgress({ live, onStop, getIcon, revising }) {
  const pct = Math.max(1, Math.min(100, Number(live?.progress) || 0));
  return (
    <div className="mt-4 rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{revising ? 'Making your change' : 'Making the web page'}: {live?.stage || 'Starting'}…</p>
        <Tooltip text={revising ? 'Stop the change. The page stays as it was before.' : 'Stop making this web page.'}>
          <button type="button" onClick={onStop} className={smallBtn} style={smallBtnStyle}>
            <span className="inline-flex items-center gap-1">{getIcon('x', { size: 12 })} Stop</span>
          </button>
        </Tooltip>
      </div>
      <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress" className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--color-primary)', transition: 'width 200ms' }} />
      </div>
      <p className="text-xs mt-1.5" style={muted}>
        About {pct}%{live?.charsWritten ? ` · ${Number(live.charsWritten).toLocaleString('en-AU')} characters written` : ''}.
        {' '}You can leave this page: it carries on, and the result is here when you come back to PDF → HTML (kept for 7 days).
      </p>
    </div>
  );
}

export default function PdfToHtmlTool({ getIcon, onHelp }) {
  const [file, setFile] = useState(null);
  const [range, setRange] = useState('1');
  const [error, setError] = useState('');
  const [localStage, setLocalStage] = useState(''); // before the job exists: reading the PDF in the browser, sending it
  const [jobs, setJobs] = useState([]); // the person's recent web pages (light rows)
  const [job, setJob] = useState(null); // the open web page: { id, filename, images, pageImages, originals, model, skipped, errorMessage, ... }
  const [live, setLive] = useState(null); // its latest progress check: { status, kind, stage, progress, charsWritten, partialHtml, imagesReady }
  const [shownPartial, setShownPartial] = useState('');
  const [html, setHtml] = useState('');
  const [history, setHistory] = useState([]); // earlier versions, newest last (kept on the server with the job)
  const [ask, setAsk] = useState('');
  const [view, setView] = useState('desktop');
  const [tab, setTab] = useState('preview');
  const [note, setNote] = useState('');
  const [showOriginal, setShowOriginal] = useState(() => readLocal(SHOW_ORIGINAL_KEY) !== '0');
  const toggleOriginal = () => setShowOriginal((v) => { writeLocal(SHOW_ORIGINAL_KEY, v ? '0' : '1'); return !v; });
  const [modelCfg, setModelCfg] = useState(null); // which model will write the page (services/pdfToHtmlModel.js)
  const [linkScroll, setLinkScroll] = useState(() => readLocal(LINK_SCROLL_KEY) !== '0');
  const toggleLinkScroll = () => setLinkScroll((v) => { writeLocal(LINK_SCROLL_KEY, v ? '0' : '1'); return !v; });
  const originalRef = useRef(null);
  const frameRef = useRef(null);
  const syncing = useRef(null); // which side is being moved by the other, so the echo of that move is ignored
  const syncTimer = useRef(null);
  const saveTimer = useRef(null);
  const historyRef = useRef(history);
  historyRef.current = history;
  const shownPartialRef = useRef(shownPartial);
  shownPartialRef.current = shownPartial;

  const running = live?.status === 'running';
  const revising = running && live?.kind === 'revise';
  const busy = running || !!localStage;
  const linked = showOriginal && linkScroll && tab === 'preview';

  // Linked scrolling. The preview frame is sandboxed WITHOUT allow-scripts (nothing in the built page can run) but WITH allow-same-origin,
  // which is what lets Vault read and set its scroll position.
  const follow = (from) => {
    if (!linked || syncing.current === from) { syncing.current = null; return; }
    const box = originalRef.current;
    const win = frameRef.current?.contentWindow;
    const doc = win?.document?.scrollingElement;
    if (!box || !win || !doc) return;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => { syncing.current = null; }, 120); // a move that changed nothing sends no echo; do not wait for one
    if (from === 'original') {
      syncing.current = 'page';
      win.scrollTo(0, scrollTo(scrollShare(box.scrollTop, box.scrollHeight, box.clientHeight), doc.scrollHeight, win.innerHeight));
    } else {
      syncing.current = 'original';
      box.scrollTop = scrollTo(scrollShare(doc.scrollTop, doc.scrollHeight, win.innerHeight), box.scrollHeight, box.clientHeight);
    }
  };
  const followRef = useRef(follow);
  followRef.current = follow;
  const onFrameLoad = () => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    win.addEventListener('scroll', () => followRef.current('page'), { passive: true });
    followRef.current('original'); // a new version keeps the place the original is showing
  };

  const loadJobs = async () => {
    try {
      const r = await api.get('/api/pdf/to-html/jobs');
      const d = await r.json();
      if (r.ok) { setJobs(d.jobs || []); return d.jobs || []; }
    } catch { /* the list is a convenience */ }
    return [];
  };

  // The whole web page (pictures, original, undo list). Used when opening one and when a job finishes.
  const openJob = async (id, { quiet = false } = {}) => {
    try {
      const r = await api.get(`/api/pdf/to-html/jobs/${id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not open that web page.');
      setJob(d);
      setHtml(d.html || '');
      setHistory(d.history || []);
      setLive({ status: d.status, kind: d.kind, stage: d.stage, progress: d.progress, charsWritten: d.charsWritten, partialHtml: d.partialHtml, imagesReady: (d.images || []).length > 0 });
      setShownPartial(d.partialHtml || '');
      writeLocal(LAST_JOB_KEY, d.id);
      if (!quiet) { setError(d.status === 'failed' ? (d.errorMessage || 'It did not finish.') : ''); setNote(''); setTab('preview'); }
      return d;
    } catch (err) {
      if (!quiet) setError(err.message);
      writeLocal(LAST_JOB_KEY, null);
      return null;
    }
  };

  // On arrival: the model in use, the recent web pages, and the one being made (or the last one opened) is opened again.
  useEffect(() => {
    let live2 = true;
    api.get('/api/pdf/to-html/model-config').then((r) => r.json()).then((d) => { if (live2 && d && !d.error) setModelCfg(d); }).catch(() => {});
    loadJobs().then((list) => {
      if (!live2) return;
      const pick = list.find((j) => j.status === 'running') || list.find((j) => String(j.id) === readLocal(LAST_JOB_KEY));
      if (pick) openJob(pick.id, { quiet: true });
    });
    return () => { live2 = false; clearTimeout(saveTimer.current); };
  }, []);

  // While a job runs: check on it every POLL_MS (small answer). When it ends, load the whole page once.
  useEffect(() => {
    if (!job?.id || !running) return undefined;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api.get(`/api/pdf/to-html/jobs/${job.id}?light=1`);
        const d = await r.json();
        if (stop || !r.ok) return;
        if (d.status !== 'running') {
          const full = await openJob(job.id, { quiet: true });
          loadJobs();
          if (full?.status === 'done' && !full.errorMessage) setNote(full.kind === 'revise' ? `Changed: "${String(full.instruction || '').slice(0, 80)}"` : 'The web page is ready.');
          else if (full?.errorMessage === 'Stopped.') { setError(''); setNote(full.html ? 'Stopped. The web page is as it was before.' : 'Stopped.'); }
          else setError(full?.errorMessage || 'It did not finish.');
          return;
        }
        setLive(d);
        if (d.imagesReady && !(job.images || []).length) openJob(job.id, { quiet: true });
        if (d.partialHtml && d.partialHtml.length - shownPartialRef.current.length >= PARTIAL_STEP) setShownPartial(d.partialHtml);
      } catch { /* try again on the next tick */ }
    };
    const timer = setInterval(tick, POLL_MS);
    tick();
    return () => { stop = true; clearInterval(timer); };
  }, [job?.id, running, (job?.images || []).length]);

  const onChange = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    const dataUrl = await readFileAsDataUrl(f);
    const pageCount = await getPdfPageCount(dataUrl);
    setFile({ name: f.name, dataUrl, size: f.size, pageCount });
    setRange('1');
    setError('');
  };

  const images = job?.images || [];
  const used = useMemo(() => new Set(images.filter((im) => html.includes(`images/${im.name}`)).map((im) => im.name)), [html, images]);
  // While the first version is being written, the preview shows it growing; otherwise the current version.
  const shownHtml = running && !revising ? shownPartial : html;
  const previewDoc = useMemo(() => (shownHtml ? withInlineImages(shownHtml, images) : ''), [shownHtml, images]);

  const convert = async () => {
    if (!file || busy) return;
    const pages = parsePageRange(range, file.pageCount || 1) || Array.from({ length: file.pageCount || 1 }, (_, i) => i + 1);
    if (!pages.length) { setError('No valid pages in that range.'); return; }
    if (pages.length > MAX_PAGES) { setError(`Up to ${MAX_PAGES} pages at a time. Type a shorter range, such as 1-${MAX_PAGES}.`); return; }
    setError(''); setNote('');
    try {
      setLocalStage('Reading the PDF pages in your browser');
      const { pageImages, pageTexts, slices, originals } = await renderPagesForModel(file.dataUrl, pages);
      setLocalStage('Sending the pages to the server');
      const res = await api.post('/api/pdf/to-html/jobs', { dataUrl: file.dataUrl, pages, pageImages, pageTexts, slices, originals, filename: file.name });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start the web page.');
      setJob({ id: data.id, filename: file.name.replace(/\.pdf$/i, ''), images: [], originals, status: 'running' });
      setHtml(''); setHistory([]); setShownPartial(''); setTab('preview');
      setLive({ status: 'running', kind: 'create', stage: 'Starting', progress: 1 });
      writeLocal(LAST_JOB_KEY, data.id);
      loadJobs();
    } catch (err) {
      setError(err.message || 'Could not start the web page.');
    } finally {
      setLocalStage('');
    }
  };

  const revise = async () => {
    const instruction = ask.trim();
    if (!instruction || !html || !job?.id || busy) return;
    setError(''); setNote('');
    try {
      clearTimeout(saveTimer.current);
      const res = await api.post(`/api/pdf/to-html/jobs/${job.id}/revise`, { instruction });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start that change.');
      setAsk('');
      setLive({ status: 'running', kind: 'revise', stage: 'Starting', progress: 1 });
      setTab('preview');
    } catch (err) {
      setError(err.message || 'Could not start that change.');
    }
  };

  const stop = async () => {
    if (!job?.id) return;
    try { await api.post(`/api/pdf/to-html/jobs/${job.id}/cancel`, {}); } catch { /* the next check shows what happened */ }
  };

  // Hand edits and Undo are saved with the job, so they are still there after leaving the page.
  const persist = async (nextHtml, nextHistory) => {
    if (!job?.id) return;
    try {
      const r = await api.put(`/api/pdf/to-html/jobs/${job.id}/html`, { html: nextHtml, history: nextHistory });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error || 'Your edit could not be saved.'); }
    } catch { setError('Your edit could not be saved. Check the connection.'); }
  };

  const editCode = (value) => {
    setHtml(value);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(value, historyRef.current), 1200);
  };

  const undo = () => {
    if (!history.length || busy) return;
    const prev = history[history.length - 1];
    const rest = history.slice(0, -1);
    setHtml(prev); setHistory(rest);
    persist(prev, rest);
    setNote('Went back one version.');
  };

  const openCode = () => {
    // Hand edits in the code view count as one step for Undo.
    if (tab !== 'code' && html && history[history.length - 1] !== html) {
      const next = [...history, html].slice(-20);
      setHistory(next);
      persist(html, next);
    }
    setTab('code');
  };

  const downloadZip = async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('index.html', html);
    const folder = zip.folder('images');
    for (const im of images) folder.file(im.name, dataUrlToUint8Array(im.dataUrl));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const url = URL.createObjectURL(blob);
    downloadFile(url, `${job?.filename || baseName(file)}-html.zip`);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const width = VIEWS.find((v) => v.id === view)?.width;
  const originals = job?.originals || [];
  const showPanel = !!(html || (running && job));

  return (
    <section>
      <ToolHeader id="pdftohtml" label="PDF → HTML" onHelp={onHelp} getIcon={getIcon} badge="AI" />
      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <Tooltip text="Upload the PDF with the page you want as a web page.">
            <div><PdfUpload onChange={onChange} files={file ? [file] : []} onRemove={() => setFile(null)} /></div>
          </Tooltip>
          <div className="mt-3">
            <label className={lbl} style={muted}>Pages{file?.pageCount ? ` (1-${file.pageCount}, up to ${MAX_PAGES})` : ` (up to ${MAX_PAGES})`}</label>
            <Tooltip text={`Which pages become the web page, such as 1 or 2-3. Several pages make one long page, in order. Up to ${MAX_PAGES}.`}>
              <input type="text" className={inp} style={inpStyle} value={range} onChange={(e) => setRange(e.target.value)} placeholder="1" />
            </Tooltip>
          </div>
          <p className="text-xs mt-2" style={muted}>
            An AI model looks at each page and writes the web page. Pictures stored inside the PDF are saved as
            files; charts drawn with lines are not pictures, so they become a labelled placeholder. It runs in the background:
            you can leave this page while it works.
          </p>
          {modelCfg && (
            <Tooltip text="It needs a model that can look at pictures (Claude or Gemini). An admin can choose it in Settings → PDF Tools.">
              <p className="text-xs mt-1" style={modelCfg.effectiveModel ? muted : { color: '#b45309' }}>
                {modelCfg.effectiveModel
                  ? <>Model: <strong>{modelCfg.effectiveModel}</strong>{modelCfg.modelId && modelCfg.assignmentValid !== false ? ' (chosen in Settings)' : (!modelCfg.standardCanSee && modelCfg.standard ? ` (automatic: the default, ${modelCfg.standard}, cannot see pictures)` : ' (automatic)')}</>
                  : 'None of the connected AI models can look at pictures. Add a Claude or Gemini model in Settings → AI & Chat.'}
              </p>
            </Tooltip>
          )}
          <ErrMsg msg={error} />
          <RunBtn onClick={convert} busy={!!localStage} disabled={!file || running} label={running ? 'A web page is being made…' : (html ? 'Make a new web page from the PDF' : 'Make web page')} getIcon={getIcon} />
          {localStage && <p className="text-xs mt-2" style={muted}>{localStage}…</p>}
          {!file && html && <p className="text-xs mt-2" style={muted}>To make a new one, upload the PDF again. The page below stays as it is.</p>}

          {running && <JobProgress live={live} onStop={stop} getIcon={getIcon} revising={revising} />}

          {html && job && (
            <div className="mt-4 rounded-xl border p-3 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', opacity: revising ? 0.7 : 1 }}>
              <div>
                <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                  {job.filename ? <strong>{job.filename}. </strong> : null}
                  {images.length
                    ? `${images.length} picture${images.length !== 1 ? 's' : ''} saved, ${used.size} used on the page`
                    : 'No pictures inside these pages'}
                  {job.skipped ? ` · ${job.skipped} could not be saved` : ''}.
                  {job.model ? <span style={muted}> Written by {job.model}.</span> : null}
                </p>
                {images.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {images.map((im) => (
                      <Tooltip key={im.name} text={`images/${im.name}, ${im.width}×${im.height} px. ${used.has(im.name) ? 'Used on the page.' : im.aiSkip ? `Not offered to the AI: ${im.aiSkip === 'strip' ? 'a thin strip' : 'a plain one-colour layer'}, not content. Still in the zip.` : 'Not used on the page, but still in the zip.'}`}>
                        <img src={im.dataUrl} alt={im.name} className="rounded border" style={{ height: 48, borderColor: used.has(im.name) ? 'var(--color-primary)' : 'var(--color-border)', opacity: used.has(im.name) ? 1 : 0.5 }} />
                      </Tooltip>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className={lbl} style={muted}>Ask for a change</label>
                <Tooltip text="Say or type what to change, such as: make the heading blue, put the photo above the text on phones, use a serif font.">
                  <div>
                    <VoiceInput
                      type="textarea" rows={3} append value={ask} onChange={setAsk}
                      placeholder="For example: make the title larger and centre it"
                      label="Change to make to the web page"
                      onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) revise(); }}
                    />
                  </div>
                </Tooltip>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Tooltip text="Rewrite the web page with this change, in the background (Ctrl+Enter).">
                    <button type="button" onClick={revise} disabled={busy || !ask.trim()} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:opacity-80 transition-opacity duration-200 disabled:opacity-40" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>
                      Make change
                    </button>
                  </Tooltip>
                  <Tooltip text={history.length ? `Go back to the previous version (${history.length} kept).` : 'Nothing to undo yet.'}>
                    <button type="button" onClick={undo} disabled={busy || !history.length} className={smallBtn} style={smallBtnStyle}>
                      <span className="inline-flex items-center gap-1">{getIcon('undo', { size: 12 })} Undo</span>
                    </button>
                  </Tooltip>
                  <Tooltip text="Download index.html and an images folder in one zip. Open index.html in a browser, or upload both to a website.">
                    <button type="button" onClick={downloadZip} disabled={busy} className={smallBtn} style={smallBtnStyle}>
                      <span className="inline-flex items-center gap-1">{getIcon('download', { size: 12 })} Download zip</span>
                    </button>
                  </Tooltip>
                </div>
                {note && <p className="text-xs mt-2" style={{ color: '#16a34a' }}>{note}</p>}
              </div>
            </div>
          )}

          {jobs.length > 0 && (
            <div className="mt-4">
              <p className={lbl} style={muted}>Your recent web pages (kept for 7 days)</p>
              <ul className="space-y-1">
                {jobs.map((j) => {
                  const current = job?.id === j.id;
                  return (
                    <li key={j.id} className="flex items-center justify-between gap-2 text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--color-surface)', color: 'var(--color-text)', outline: current ? '1px solid var(--color-primary)' : 'none' }}>
                      <span className="truncate">{j.filename || 'Web page'} <span style={muted}>· {ago(j.createdAt)} · {current && running ? `${STATUS_WORDS.running} ${live?.progress || 0}%` : j.status === 'running' ? `${STATUS_WORDS.running} ${j.progress || 0}%` : (STATUS_WORDS[j.status] || j.status)}</span></span>
                      <Tooltip text={current ? 'This is the web page shown below.' : 'Show this web page below.'}>
                        <button type="button" onClick={() => openJob(j.id)} disabled={current || !!localStage} className={smallBtn} style={smallBtnStyle}>{current ? 'Shown' : 'Open'}</button>
                      </Tooltip>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
        <div>{!showPanel && <PdfPagePreview dataUrl={file?.dataUrl} />}</div>
      </div>

      {showPanel && (
        <div className="mt-6 rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="flex gap-1">
              <Tooltip text="See the web page as a visitor would. Links and scripts are switched off in the preview.">
                <button type="button" onClick={() => setTab('preview')} className={smallBtn} style={{ ...smallBtnStyle, ...(tab === 'preview' ? { borderColor: 'var(--color-primary)', color: 'var(--color-primary)' } : {}) }}>Preview</button>
              </Tooltip>
              <Tooltip text="See and edit the HTML by hand. Edits are saved with the web page; Undo takes you back to before them.">
                <button type="button" onClick={openCode} disabled={running} className={smallBtn} style={{ ...smallBtnStyle, ...(tab === 'code' ? { borderColor: 'var(--color-primary)', color: 'var(--color-primary)' } : {}) }}>
                  <span className="inline-flex items-center gap-1">{getIcon('file-code', { size: 12 })} Code</span>
                </button>
              </Tooltip>
              <Tooltip text={showOriginal ? 'Hide the original PDF page.' : 'Show the original PDF page beside the web page or the code, to compare them.'}>
                <button type="button" onClick={toggleOriginal} aria-pressed={showOriginal} className={smallBtn} style={{ ...smallBtnStyle, ...(showOriginal ? { borderColor: 'var(--color-primary)', color: 'var(--color-primary)' } : {}) }}>
                  <span className="inline-flex items-center gap-1">{getIcon('columns', { size: 12 })} {showOriginal ? 'Hide original' : 'Show original'}</span>
                </button>
              </Tooltip>
              {showOriginal && tab === 'preview' && (
                <Tooltip text={linkScroll ? 'Scroll each side on its own.' : 'Scroll both sides together: the same share of the way down on each side.'}>
                  <button type="button" onClick={toggleLinkScroll} aria-pressed={linkScroll} className={smallBtn} style={{ ...smallBtnStyle, ...(linkScroll ? { borderColor: 'var(--color-primary)', color: 'var(--color-primary)' } : {}) }}>
                    <span className="inline-flex items-center gap-1">{getIcon('arrow-up-down', { size: 12 })} {linkScroll ? 'Scroll linked' : 'Scroll separately'}</span>
                  </button>
                </Tooltip>
              )}
            </div>
            {tab === 'preview' && (
              <div className="flex gap-1">
                {VIEWS.map((v) => (
                  <Tooltip key={v.id} text={v.tip}>
                    <button type="button" onClick={() => setView(v.id)} aria-pressed={view === v.id} className={smallBtn} style={{ ...smallBtnStyle, ...(view === v.id ? { borderColor: 'var(--color-primary)', color: 'var(--color-primary)' } : {}) }}>
                      <span className="inline-flex items-center gap-1">{getIcon(v.icon, { size: 12 })} {v.label}</span>
                    </button>
                  </Tooltip>
                ))}
              </div>
            )}
          </div>
          <div className={showOriginal ? 'grid grid-cols-1 xl:grid-cols-2' : ''}>
          {showOriginal && (
            <div className="border-b xl:border-b-0 xl:border-r" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <p className="text-xs px-3 pt-2" style={muted}>Original PDF{originals.length > 1 ? ` (${originals.length} pages)` : ''}</p>
              <div ref={originalRef} onScroll={() => follow('original')} className="overflow-y-auto p-3 space-y-3" style={{ height: '75vh' }}>
                {originals.length ? originals.map((o) => (
                  <figure key={o.page} className="m-0">
                    {originals.length > 1 && <figcaption className="text-xs mb-1" style={muted}>Page {o.page}</figcaption>}
                    <img src={o.dataUrl} alt={`Page ${o.page} of the original PDF`} className="block w-full h-auto rounded border" style={{ borderColor: 'var(--color-border)', background: '#fff' }} />
                  </figure>
                )) : (
                  <PdfPagePreview dataUrl={file?.dataUrl} />
                )}
              </div>
            </div>
          )}
          {tab === 'preview' ? (
            <div className="overflow-x-auto p-3" style={{ background: 'var(--color-bg)' }}>
              {running && !revising && !shownPartial ? (
                <div className="flex items-center justify-center rounded border text-sm" style={{ height: '75vh', borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)' }}>
                  The web page appears here as the AI writes it.
                </div>
              ) : (
                <iframe
                  ref={frameRef}
                  onLoad={onFrameLoad}
                  title="Web page preview"
                  srcDoc={previewDoc}
                  sandbox="allow-same-origin"
                  referrerPolicy="no-referrer"
                  className="block mx-auto rounded border"
                  style={{ width: width ? `${width}px` : '100%', maxWidth: width ? 'none' : '100%', height: '75vh', background: '#fff', borderColor: 'var(--color-border)' }}
                />
              )}
            </div>
          ) : (
            <textarea
              value={html}
              onChange={(e) => editCode(e.target.value)}
              readOnly={running}
              spellCheck={false}
              aria-label="HTML of the web page"
              className="block w-full p-3 text-xs font-mono"
              style={{ height: '75vh', background: 'var(--color-bg)', color: 'var(--color-text)', resize: 'vertical' }}
            />
          )}
          </div>
        </div>
      )}
    </section>
  );
}
