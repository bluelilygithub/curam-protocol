import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { CUP_STANDARDS, GROUPS, getUnit, getGroup, unitsOfGroup } from '../../utils/units/registry.mjs';
import { scanDocument, scanText, proposeFor, buildConvertedText } from '../../utils/units/scanner.mjs';
import { numberWordsToDigits } from '../../utils/units/voiceParser.mjs';
import { Card, Label, Segmented, PrimaryButton, SecondaryButton, Badge, CONF_STYLE, FOCUS_RING } from './shared';
import { loadDocumentPages, pastedTextPages, hitBox, buildCsv, buildAnnotatedPdf, downloadBlob } from './scanPipeline';

const selectStyle = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const CONTEXTS = [
  { id: 'general', label: 'General' },
  { id: 'recipe', label: 'Recipe' },
  { id: 'building', label: 'Building / plan' },
  { id: 'product', label: 'Product spec' },
];
const DEGREE_CHOICES = [
  { id: 'temperature.celsius', label: '° is °C (temperature)' },
  { id: 'temperature.fahrenheit', label: '° is °F (temperature)' },
  { id: 'angle.degree', label: '° is an angle' },
];

function CropPreview({ page, box }) {
  if (!page?.imageUrl || !box) return null;
  const zoom = Math.min(2, 34 / Math.max(8, box.h), 240 / Math.max(8, box.w));
  const pad = 6;
  return (
    <div
      aria-label="Cropped view of the original"
      className="rounded-lg border flex-shrink-0"
      style={{
        width: Math.min(260, (box.w + pad * 2) * zoom), height: (box.h + pad * 2) * zoom, borderColor: 'var(--color-border)',
        backgroundImage: `url(${page.imageUrl})`, backgroundRepeat: 'no-repeat',
        backgroundSize: `${page.width * zoom}px ${page.height * zoom}px`,
        backgroundPosition: `${-(box.x - pad) * zoom}px ${-(box.y - pad) * zoom}px`,
      }}
    />
  );
}

function ReviewRow({ row, page, focused, onStatus, onEdit, onPickUnit, rowRef, compact }) {
  const getIcon = useIcon();
  const { hit, proposal, status } = row;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(hit.raw);
  const [err, setErr] = useState('');
  const box = page ? hitBox(page, hit) : null;
  const conf = CONF_STYLE[hit.confidence];
  const units = [...new Set(hit.unitIds.filter(Boolean))].map((id) => getUnit(id));
  const needsUnit = proposal.status === 'needs-unit';
  const lowOcr = hit.ocrConf !== null && hit.ocrConf !== undefined && hit.ocrConf < 80;

  const commit = () => {
    const r = onEdit(row, text);
    if (r) { setErr(r); return; }
    setErr(''); setEditing(false);
  };

  return (
    <li
      ref={rowRef}
      className="rounded-xl border p-3 space-y-2 transition-all duration-200"
      style={{ background: 'var(--color-bg)', borderColor: focused ? 'var(--color-primary)' : 'var(--color-border)', opacity: status === 'ignored' ? 0.55 : 1 }}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[12rem]">
          <div className="text-xs break-words" style={{ color: 'var(--color-muted)' }}>
            …{hit.before}<mark className="px-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--color-primary) 22%, transparent)', color: 'var(--color-text)' }}>{hit.raw}</mark>{hit.after}…
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
            <span className="font-semibold">{hit.raw}</span>
            {proposal.status === 'convert' && <span>→ <strong>{proposal.text}</strong></span>}
            {proposal.status === 'same' && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{proposal.note}</span>}
            {proposal.status === 'none' && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{proposal.note}</span>}
            {needsUnit && <span className="text-xs" style={{ color: '#b45309' }}>{proposal.note}</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge bg={conf.bg} fg={conf.fg} title="How sure the scanner is about this reading">{conf.label} confidence</Badge>
            {lowOcr && <Badge bg="#fef3c7" fg="#b45309" title="Text-recognition confidence for this number">OCR {Math.round(hit.ocrConf)}%</Badge>}
            <Badge title="Where it was found">p.{hit.page + 1}, line {hit.line + 1}</Badge>
            {units.length > 0 && <Badge title="Detected unit">{units.map((u) => u.name).join(' / ')}</Badge>}
            {hit.kind !== 'single' && <Badge>{hit.kind}</Badge>}
            {row.edited && <Badge bg="#dcfce7" fg="#166534">edited</Badge>}
          </div>
        </div>
        {!compact && (lowOcr || hit.flags.some((f) => f.code === 'ocr-digit-fix')) && <CropPreview page={page} box={box} />}
      </div>

      {hit.flags.length > 0 && (
        <ul className="space-y-0.5">
          {hit.flags.filter((f) => f.code !== 'edited').map((f) => (
            <li key={f.message} className="text-xs flex gap-1.5" style={{ color: '#b45309' }}>{getIcon('alert-triangle', { size: 12 })}<span>{f.message}</span></li>
          ))}
        </ul>
      )}

      {needsUnit && (
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip text="Pick what the ° sign means — the scanner will not guess">
            <select aria-label="What does the degree sign mean" defaultValue="" onChange={(e) => e.target.value && onPickUnit(row, e.target.value)} className={`px-2.5 py-1.5 rounded-xl border text-xs ${FOCUS_RING}`} style={selectStyle}>
              <option value="" disabled>Choose what ° means…</option>
              {DEGREE_CHOICES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Tooltip>
        </div>
      )}

      {editing && (
        <div className="space-y-1.5">
          <Label hint="type or say the measurement, e.g. “12 millimetres”">Correct this reading</Label>
          <VoiceInput value={text} onChange={setText} parse={numberWordsToDigits} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} placeholder="e.g. 100 mm" label="Corrected measurement" />
          {err && <p className="text-xs" style={{ color: '#991b1b' }}>{err}</p>}
          <div className="flex gap-2">
            <PrimaryButton onClick={commit}>Apply</PrimaryButton>
            <SecondaryButton onClick={() => { setEditing(false); setErr(''); }}>Cancel</SecondaryButton>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Tooltip text={status === 'accepted' ? 'Undo accept' : 'Accept this conversion'}>
          <button type="button" onClick={() => onStatus(row, status === 'accepted' ? 'pending' : 'accepted')} disabled={proposal.status !== 'convert'} aria-pressed={status === 'accepted'} className={`px-3 py-1.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1 transition-all duration-200 hover:opacity-70 disabled:opacity-40 ${FOCUS_RING}`} style={{ background: status === 'accepted' ? '#dcfce7' : 'transparent', color: status === 'accepted' ? '#166534' : 'var(--color-text)', borderColor: status === 'accepted' ? '#16a34a' : 'var(--color-border)' }}>
            {getIcon('check', { size: 13 })} {status === 'accepted' ? 'Accepted' : 'Accept'}
          </button>
        </Tooltip>
        <Tooltip text="Fix the number or unit">
          <SecondaryButton onClick={() => setEditing((e) => !e)}>{getIcon('edit', { size: 13 })}<span className="ml-1">Edit</span></SecondaryButton>
        </Tooltip>
        <Tooltip text={status === 'ignored' ? 'Stop ignoring' : 'Leave this one alone'}>
          <SecondaryButton onClick={() => onStatus(row, status === 'ignored' ? 'pending' : 'ignored')} aria-pressed={status === 'ignored'}>{status === 'ignored' ? 'Ignored — undo' : 'Ignore'}</SecondaryButton>
        </Tooltip>
      </div>
    </li>
  );
}

export default function ScannerTab({ prefs, update }) {
  const getIcon = useIcon();
  const [pages, setPages] = useState([]);
  const [fileName, setFileName] = useState('');
  const [status, setStatus] = useState(null); // { message, progress, page, total }
  const [error, setError] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [rowState, setRowState] = useState({});
  const [perGroupSystem, setPerGroupSystem] = useState({});
  const [perGroupUnit, setPerGroupUnit] = useState({});
  const [view, setView] = useState('review');
  const [filter, setFilter] = useState('actionable');
  const [focusKey, setFocusKey] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [copied, setCopied] = useState(false);
  const cancelRef = useRef(false);
  const fileRef = useRef(null);
  const rowRefs = useRef({});

  const context = prefs.scanContext;
  const scanOpts = useMemo(() => ({ context, region: prefs.region, cupStandard: prefs.cupStandard }), [context, prefs.region, prefs.cupStandard]);
  const proposePrefs = useMemo(() => ({ system: prefs.targetSystem, perGroupSystem, perGroupUnit, cupStandard: prefs.cupStandard, precision: { mode: 'sig', n: 4 } }), [prefs.targetSystem, perGroupSystem, perGroupUnit, prefs.cupStandard]);

  const hits = useMemo(() => (pages.length ? scanDocument(pages, scanOpts) : []), [pages, scanOpts]);
  const rows = useMemo(() => hits.map((h) => {
    const key = `${h.page}-${h.line}-${h.start}`;
    const st = rowState[key] || {};
    const hit = st.override ? { ...h, ...st.override } : h;
    return { key, hit, proposal: proposeFor(hit, proposePrefs), status: st.status || 'pending', edited: !!st.override };
  }), [hits, rowState, proposePrefs]);

  const needsReview = (r) => r.hit.confidence !== 'high' || r.proposal.status === 'needs-unit';
  const filtered = rows.filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'ignored') return r.status === 'ignored';
    if (filter === 'unchanged') return r.status !== 'ignored' && (r.proposal.status === 'same' || r.proposal.status === 'none');
    if (filter === 'review') return r.status !== 'ignored' && needsReview(r);
    return r.status !== 'ignored' && (r.proposal.status === 'convert' || r.proposal.status === 'needs-unit');
  });
  const counts = {
    actionable: rows.filter((r) => r.status !== 'ignored' && (r.proposal.status === 'convert' || r.proposal.status === 'needs-unit')).length,
    review: rows.filter((r) => r.status !== 'ignored' && needsReview(r)).length,
    unchanged: rows.filter((r) => r.status !== 'ignored' && (r.proposal.status === 'same' || r.proposal.status === 'none')).length,
    ignored: rows.filter((r) => r.status === 'ignored').length,
    accepted: rows.filter((r) => r.status === 'accepted').length,
  };

  const groupsPresent = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => { const g = r.hit.groupId || 'unknown'; m.set(g, (m.get(g) || 0) + 1); });
    return [...m.entries()].filter(([g]) => g !== 'unknown');
  }, [rows]);

  // ── loading ──
  const reset = () => { setRowState({}); setPerGroupSystem({}); setPerGroupUnit({}); setFocusKey(null); setError(''); };

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (!/\.(pdf|jpe?g|png)$/i.test(file.name) && !/^(application\/pdf|image\/(jpeg|png))$/.test(file.type)) { setError('Use a PDF, JPG or PNG file (or paste text below).'); return; }
    reset(); setPages([]); setFileName(file.name); cancelRef.current = false;
    setStatus({ message: 'Starting…', progress: 0 });
    try {
      const out = await loadDocumentPages(file, { onStatus: (s) => setStatus((prev) => ({ ...prev, ...s })), cancelRef });
      setPages(out);
      if (!out.some((p) => p.lines.length)) setError('No readable text was found in that file.');
    } catch (e) {
      if (e.message !== 'cancelled') setError(e.message || 'That file could not be scanned.');
    } finally {
      setStatus(null);
    }
  }, []);

  const scanPasted = () => {
    if (!pasteText.trim()) return;
    reset(); setFileName('Pasted text'); setPages(pastedTextPages(pasteText));
  };

  // ── row actions ──
  const setRow = (key, patch) => setRowState((s) => ({ ...s, [key]: { ...(s[key] || {}), ...patch } }));
  const onStatus = (row, st) => setRow(row.key, { status: st });
  const onEdit = (row, text) => {
    const h = scanText(text, scanOpts)[0];
    if (!h) return 'Could not read a measurement there. Include the number and unit, e.g. “12 mm”.';
    setRow(row.key, {
      override: {
        values: h.values, unitIds: h.unitIds, kind: h.kind, groupId: h.groupId, confidence: h.unitIds.some((u) => !u) ? 'low' : 'high',
        flags: [{ code: 'edited', message: 'Corrected by you.' }, ...h.flags.filter((f) => f.code === 'regional-variant')], ocrConf: null,
      },
    });
    return null;
  };
  const onPickUnit = (row, unitId) => {
    const u = getUnit(unitId);
    setRow(row.key, { override: { unitIds: row.hit.values.map(() => unitId), groupId: u.group, confidence: 'medium', flags: row.hit.flags.filter((f) => f.code !== 'degree-ambiguous').concat([{ code: 'edited', message: `You chose: ${u.name}.` }]) } });
  };
  const bulk = (predicate, st) => setRowState((s) => {
    const next = { ...s };
    rows.forEach((r) => { if (predicate(r)) next[r.key] = { ...(next[r.key] || {}), status: st }; });
    return next;
  });

  // ── exports ──
  const copyConverted = () => {
    const t = buildConvertedText(pages, rows, { keepOriginal });
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(t).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1600);
  };
  const downloadText = () => downloadBlob(new Blob([buildConvertedText(pages, rows, { keepOriginal })], { type: 'text/plain' }), `converted-${Date.now()}.txt`);
  const downloadCsv = () => downloadBlob(new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8' }), `measurements-${Date.now()}.csv`);
  const downloadPdf = async () => {
    try {
      const bytes = await buildAnnotatedPdf(pages, rows);
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `annotated-${Date.now()}.pdf`);
    } catch (e) { setError(`Could not build the PDF: ${e.message}`); }
  };
  const canPdf = pages.some((p) => p.imageUrl);

  const focusRow = (key) => {
    setFocusKey(key);
    if (view === 'review') setTimeout(() => rowRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  const hasResults = pages.length > 0;
  const focusedRow = rows.find((r) => r.key === focusKey);

  return (
    <div className="space-y-4">
      {/* input */}
      <Card data-tour="measure-scan-drop">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
          className="rounded-2xl border-2 border-dashed p-6 text-center transition-all duration-200"
          style={{ borderColor: dragOver ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-bg)' }}
        >
          <div style={{ color: 'var(--color-muted)' }} className="flex justify-center mb-2">{getIcon('upload', { size: 22 })}</div>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>Drop a PDF, JPG or PNG here, or</p>
          <Tooltip text="Choose a PDF, JPG or PNG from this device">
            <PrimaryButton className="mt-2" onClick={() => fileRef.current?.click()} disabled={!!status}>Choose a file</PrimaryButton>
          </Tooltip>
          <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }} />
          <p className="text-xs mt-3 flex items-center justify-center gap-1.5" style={{ color: 'var(--color-muted)' }}>
            {getIcon('shield-check', { size: 13 })} Processed on this device. Your document is not uploaded anywhere.
          </p>
        </div>
        <div>
          <Label hint="or paste text instead">Paste text</Label>
          <VoiceInput type="textarea" rows={4} append value={pasteText} onChange={setPasteText} placeholder="Paste a recipe, spec or notes…" label="Text to scan" />
          <div className="mt-2"><Tooltip text="Find measurements in the pasted text"><SecondaryButton onClick={scanPasted} disabled={!pasteText.trim() || !!status}>Scan text</SecondaryButton></Tooltip></div>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <Label>Convert to</Label>
            <Segmented label="Target system" value={prefs.targetSystem} onChange={(v) => update({ targetSystem: v })} options={[{ id: 'metric', label: 'Metric' }, { id: 'us', label: 'US', tip: 'US customary units' }, { id: 'imperial', label: 'Imperial', tip: 'UK / imperial units' }]} />
          </div>
          <div>
            <Label hint="US vs imperial pints, gallons, mpg">Volumes in the document are</Label>
            <Segmented label="Region" value={prefs.region} onChange={(v) => update({ region: v })} options={[{ id: 'imperial', label: 'Imperial / AU / UK' }, { id: 'us', label: 'US' }]} />
          </div>
          <div>
            <Label>Cup standard</Label>
            <Segmented label="Cup standard" value={prefs.cupStandard} onChange={(v) => update({ cupStandard: v })} options={Object.values(CUP_STANDARDS).map((c) => ({ id: c.id, label: c.label, tip: `Cup ${c.cupMl} ml, tablespoon ${c.tbspMl} ml, teaspoon ${c.tspMl} ml` }))} />
          </div>
          <div>
            <Label hint="helps with unclear units">This is a</Label>
            <Tooltip text="Tells the scanner how to read unclear units like m, T, oz and quote marks">
              <select aria-label="Document type" value={context} onChange={(e) => update({ scanContext: e.target.value })} className={`px-2.5 py-2 rounded-xl border text-sm ${FOCUS_RING}`} style={selectStyle}>
                {CONTEXTS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Tooltip>
          </div>
        </div>
      </Card>

      {status && (
        <Card aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm" style={{ color: 'var(--color-text)' }}>{status.message}</div>
            <SecondaryButton onClick={() => { cancelRef.current = true; }}>Cancel</SecondaryButton>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-bg)' }} role="progressbar" aria-valuenow={Math.round(((status.page ? (status.page - 1 + (status.progress || 0)) / (status.total || 1) : status.progress || 0)) * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full transition-all duration-200" style={{ width: `${Math.round((status.page ? (status.page - 1 + (status.progress || 0)) / (status.total || 1) : status.progress || 0) * 100)}%`, background: 'var(--color-primary)' }} />
          </div>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>You can keep using Vault — recognition runs in the background on this device.</p>
        </Card>
      )}
      {error && <p className="text-sm px-1" style={{ color: '#991b1b' }} role="alert">{error}</p>}

      {hasResults && !status && (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{fileName}</h3>
                <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                  {rows.length} measurement{rows.length === 1 ? '' : 's'} found on {pages.length} page{pages.length === 1 ? '' : 's'}
                  {counts.review ? ` · ${counts.review} need a look` : ''} · {counts.accepted} accepted. Nothing is converted until you accept it.
                </p>
                {pages.some((p) => p.ocr) && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{pages.filter((p) => p.ocr).length} page(s) were read with text recognition — check numbers against the image.</p>}
              </div>
              <Segmented label="View" value={view} onChange={setView} options={[{ id: 'review', label: 'Review list' }, { id: 'annotated', label: 'Annotated view', tip: 'The original page with every measurement highlighted' }]} />
            </div>

            {groupsPresent.length > 0 && (
              <div className="space-y-2">
                <Label hint="set a target for a whole kind of measurement">By kind</Label>
                <div className="space-y-2">
                  {groupsPresent.map(([gid, n]) => (
                    <div key={gid} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
                      <span className="text-sm font-medium min-w-[7rem]" style={{ color: 'var(--color-text)' }}>{getGroup(gid).name.replace(/ \(.*\)/, '')} <span className="font-normal" style={{ color: 'var(--color-muted)' }}>({n})</span></span>
                      <Tooltip text="Convert this kind of measurement to a unit system">
                        <select aria-label={`${getGroup(gid).name} target system`} value={perGroupSystem[gid] || ''} onChange={(e) => { setPerGroupSystem((s) => ({ ...s, [gid]: e.target.value || undefined })); setPerGroupUnit((s) => ({ ...s, [gid]: undefined })); }} className={`px-2 py-1 rounded-lg border text-xs ${FOCUS_RING}`} style={selectStyle}>
                          <option value="">Use “{prefs.targetSystem}”</option>
                          <option value="metric">→ Metric</option><option value="us">→ US</option><option value="imperial">→ Imperial</option>
                        </select>
                      </Tooltip>
                      <Tooltip text="Or always convert this kind into one specific unit">
                        <select aria-label={`${getGroup(gid).name} target unit`} value={perGroupUnit[gid] || ''} onChange={(e) => setPerGroupUnit((s) => ({ ...s, [gid]: e.target.value || undefined }))} className={`px-2 py-1 rounded-lg border text-xs ${FOCUS_RING}`} style={selectStyle}>
                          <option value="">Auto unit</option>
                          {unitsOfGroup(gid).filter((u) => u.type !== 'compound').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                      </Tooltip>
                      <span className="flex-1" />
                      <Tooltip text="Accept every convertible measurement of this kind"><SecondaryButton onClick={() => bulk((r) => (r.hit.groupId || '') === gid && r.proposal.status === 'convert' && r.status !== 'ignored', 'accepted')}>Accept all</SecondaryButton></Tooltip>
                      <Tooltip text="Ignore every measurement of this kind"><SecondaryButton onClick={() => bulk((r) => (r.hit.groupId || '') === gid, 'ignored')}>Ignore all</SecondaryButton></Tooltip>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 items-center">
              <Tooltip text="Accept only the clear ones: high confidence, nothing flagged"><SecondaryButton onClick={() => bulk((r) => r.proposal.status === 'convert' && r.hit.confidence === 'high' && r.hit.flags.length === 0 && r.status === 'pending', 'accepted')}>Accept all clear ones</SecondaryButton></Tooltip>
              <Tooltip text="Undo every accept / ignore"><SecondaryButton onClick={() => bulk(() => true, 'pending')}>Reset choices</SecondaryButton></Tooltip>
            </div>
          </Card>

          {/* exports */}
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium mr-2" style={{ color: 'var(--color-text)' }}>Export accepted conversions</span>
              <label className="text-xs flex items-center gap-1.5" style={{ color: 'var(--color-muted)' }}>
                <input type="checkbox" checked={keepOriginal} onChange={(e) => setKeepOriginal(e.target.checked)} /> keep the original in brackets
              </label>
              <span className="flex-1" />
              <Tooltip text="Copy the text with accepted measurements converted"><SecondaryButton onClick={copyConverted} disabled={!counts.accepted}>{copied ? 'Copied ✓' : 'Copy converted text'}</SecondaryButton></Tooltip>
              <Tooltip text="Save the converted text as a .txt file"><SecondaryButton onClick={downloadText} disabled={!counts.accepted}>Text file</SecondaryButton></Tooltip>
              <Tooltip text="Every measurement found: original, unit, converted value, confidence, page"><SecondaryButton onClick={downloadCsv}>CSV</SecondaryButton></Tooltip>
              <Tooltip text={canPdf ? 'The original pages with measurements boxed and converted values beside them' : 'Needs a PDF or image (pasted text has no pages)'}><SecondaryButton onClick={downloadPdf} disabled={!canPdf}>Annotated PDF</SecondaryButton></Tooltip>
            </div>
          </Card>

          {view === 'review' && (
            <Card>
              <div className="flex flex-wrap gap-1.5">
                {[['actionable', 'To convert'], ['review', 'Needs a look'], ['unchanged', 'No change needed'], ['ignored', 'Ignored'], ['all', 'All']].map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setFilter(id)} aria-pressed={filter === id} className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all duration-200 hover:opacity-70 ${FOCUS_RING}`} style={{ background: filter === id ? 'var(--color-primary)' : 'transparent', color: filter === id ? '#fff' : 'var(--color-text)', borderColor: filter === id ? 'var(--color-primary)' : 'var(--color-border)' }}>
                    {label}{id !== 'all' ? ` (${counts[id]})` : ` (${rows.length})`}
                  </button>
                ))}
              </div>
              {filtered.length === 0
                ? <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{rows.length === 0 ? 'No measurements were found. Try the right document type above, or check the text was read correctly.' : 'Nothing in this view.'}</p>
                : (
                  <ul className="space-y-2">
                    {filtered.map((r) => (
                      <ReviewRow key={r.key} row={r} page={pages[r.hit.page]} focused={r.key === focusKey} onStatus={onStatus} onEdit={onEdit} onPickUnit={onPickUnit} rowRef={(el) => { rowRefs.current[r.key] = el; }} />
                    ))}
                  </ul>
                )}
            </Card>
          )}

          {view === 'annotated' && (
            <div className="space-y-4">
              {pages.map((pg) => {
                const pageRows = rows.filter((r) => r.hit.page === pg.index);
                return (
                  <Card key={pg.index}>
                    <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Page {pg.index + 1} <span className="font-normal" style={{ color: 'var(--color-muted)' }}>· {pageRows.length} measurement{pageRows.length === 1 ? '' : 's'}{pg.ocr ? ' · text recognition' : ''}</span></h4>
                    {pg.imageUrl ? (
                      <div className="relative w-full overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-border)', maxWidth: 900 }}>
                        <img src={pg.imageUrl} alt={`Page ${pg.index + 1}`} className="w-full block" />
                        {pageRows.map((r) => {
                          const b = hitBox(pg, r.hit);
                          if (!b) return null;
                          const c = r.status === 'accepted' ? '#16a34a' : r.status === 'ignored' ? '#888888' : r.hit.confidence === 'high' ? '#16a34a' : r.hit.confidence === 'medium' ? '#f59e0b' : '#ef4444';
                          const pos = { left: `${(b.x / pg.width) * 100}%`, top: `${(b.y / pg.height) * 100}%`, width: `${(b.w / pg.width) * 100}%`, height: `${(b.h / pg.height) * 100}%` };
                          return (
                            <React.Fragment key={r.key}>
                              <button type="button" onClick={() => setFocusKey(r.key)} aria-label={`${r.hit.raw}${r.proposal.status === 'convert' ? ` converts to ${r.proposal.text}` : ''}`} className="absolute transition-opacity duration-200 hover:opacity-70" style={{ ...pos, border: `2px solid ${c}`, background: `${c}22`, borderRadius: 3, outline: r.key === focusKey ? '2px solid var(--color-primary)' : 'none' }} />
                              {r.proposal.status === 'convert' && r.status !== 'ignored' && (
                                <span className="absolute pointer-events-none text-[10px] sm:text-xs font-semibold px-1 rounded whitespace-nowrap" style={{ left: pos.left, top: `calc(${pos.top} - 1.35em)`, background: '#fffbe0', color: '#1a1a1a', border: `1px solid ${c}` }}>= {r.proposal.text}</span>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-xl border p-3 text-sm space-y-1 font-mono break-words" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                        {pg.lines.map((ln, li) => {
                          const lr = pageRows.filter((r) => r.hit.line === li).sort((a, b) => a.hit.start - b.hit.start);
                          const parts = []; let at = 0;
                          lr.forEach((r) => {
                            parts.push(ln.text.slice(at, r.hit.start));
                            parts.push(<mark key={r.key} onClick={() => setFocusKey(r.key)} className="px-0.5 rounded cursor-pointer" style={{ background: r.hit.confidence === 'high' ? '#dcfce7' : r.hit.confidence === 'medium' ? '#fef3c7' : '#fff1f2', color: '#1a1a1a' }}>{r.hit.raw}{r.proposal.status === 'convert' ? ` → ${r.proposal.text}` : ''}</mark>);
                            at = r.hit.end;
                          });
                          parts.push(ln.text.slice(at));
                          return <div key={li}>{parts.length ? parts : ' '}</div>;
                        })}
                      </div>
                    )}
                  </Card>
                );
              })}
              {focusedRow && (
                <Card>
                  <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Selected measurement</h4>
                  <ul><ReviewRow row={focusedRow} page={pages[focusedRow.hit.page]} focused onStatus={onStatus} onEdit={onEdit} onPickUnit={onPickUnit} compact={false} /></ul>
                </Card>
              )}
            </div>
          )}
        </>
      )}

      <p className="text-xs px-1" style={{ color: 'var(--color-muted)' }}>
        Not included yet: measuring drawn lines on plans (that needs a scale such as 1:100 set by you).
      </p>
    </div>
  );
}
