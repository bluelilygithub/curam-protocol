import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { LANGUAGES } from '../../utils/translateLanguages';
import { StatusBadge, Tip, useAppVersion } from './shared';
import { CheckFindings, TechnicalDetails, Downloads, flagsByPart, OUTLINE_BTN, OUTLINE_STYLE, PRIMARY_STYLE } from './QaPanel';
import { LessonsLearntModal } from './lessons';

// One translation, opened from My translations. The original and the translation side by side, part by part, with the parts the
// checks are about marked. A draft ("Ready to read") can be re-run in passes with requirements the person adds (a rule, or a word to
// translate one way or keep as written), over the whole document or only the parts picked; earlier versions stay readable. Nothing is
// committed until "Keep this version": that makes the files and saves the requirements ticked "remember". A kept translation shows its
// downloads and can be reopened as a draft. The server does all the work (services/translateDraft.js), so the page can be closed.

const langLabel = (code) => LANGUAGES.find((l) => l.code === code)?.label || code || 'Worked out automatically';
const CARD = 'rounded-2xl border p-4 space-y-3';
const CARD_STYLE = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
const newId = () => Math.random().toString(36).slice(2, 10);

export default function ResultScreen({ jobId, onBack, onChanged, onDownload, onDownloadNative, onDownloadOriginal, onDownloadText, jobRow }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const appVersion = useAppVersion();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [viewPass, setViewPass] = useState(null); // null = the current version
  const [show, setShow] = useState('all'); // all | flagged | changed
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [scope, setScope] = useState('all');
  const [requirements, setRequirements] = useState([]);
  const [newRule, setNewRule] = useState('');
  const [newWord, setNewWord] = useState({ source: '', target: '', keep: false });
  const [busy, setBusy] = useState('');
  const [lessonsOpen, setLessonsOpen] = useState(false);
  const loadedReqs = useRef(false);
  const lastStatus = useRef(null);
  const lastPassRunning = useRef(false);
  const partRefs = useRef({});

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/api/translate/jobs/${jobId}/read${viewPass ? `?pass=${viewPass}` : ''}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not open this translation');
      setData(body);
      setError('');
      // The list is taken from the server when the translation opens, and again after a pass, a keep or a reopen (a keep marks the
      // remembered ones as saved; the page must not keep an older copy of the list).
      const finishedSomething = (lastPassRunning.current && !(body.passes || []).some((p) => p.status === 'running'))
        || (lastStatus.current && lastStatus.current !== body.status);
      if (!loadedReqs.current || finishedSomething) { setRequirements(body.requirements || []); loadedReqs.current = true; }
      // Tell the person when something they started has finished.
      const passRunning = (body.passes || []).some((p) => p.status === 'running');
      if (lastPassRunning.current && !passRunning) {
        const last = [...(body.passes || [])].pop();
        if (last?.status === 'done') addToast(`Pass ${last.passNo} is ready. It is the version shown now.`, 'success');
        else if (last?.status === 'failed') addToast(last.errorMessage || `Pass ${last.passNo} did not finish. The version before is kept.`, 'error');
        setViewPass(null);
        setPicked(new Set());
        onChanged?.();
      }
      if (lastStatus.current === 'generating' && body.status === 'done') { addToast('Kept. The files are ready to download.', 'success'); onChanged?.(); }
      if (lastStatus.current === 'generating' && body.status === 'ready' && body.errorMessage) addToast(body.errorMessage, 'error');
      lastPassRunning.current = passRunning;
      lastStatus.current = body.status;
    } catch (e) { setError(e.message); }
  }, [jobId, viewPass, addToast, onChanged]);

  useEffect(() => { load(); }, [load]);
  const working = data && (data.status === 'generating' || (data.passes || []).some((p) => p.status === 'running'));
  useEffect(() => {
    if (!working) return undefined;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [working, load]);

  // Requirements are saved as they change, so they are there next time the translation is opened.
  const saveTimer = useRef(null);
  const saveRequirements = (next) => {
    setRequirements(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.put(`/api/translate/jobs/${jobId}/requirements`, { requirements: next }).catch(() => {});
    }, 500);
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const parts = data?.parts || [];
  const flags = useMemo(() => flagsByPart(data?.qaSummary, parts), [data?.qaSummary, parts]);
  const changed = useMemo(() => new Set(data?.changedIndexes || []), [data?.changedIndexes]);
  const pages = useMemo(() => {
    const byPage = new Map();
    for (const p of parts) {
      if (show === 'flagged' && !flags[p.i]) continue;
      if (show === 'changed' && !changed.has(p.i)) continue;
      if (!byPage.has(p.page)) byPage.set(p.page, []);
      byPage.get(p.page).push(p);
    }
    return [...byPage.entries()];
  }, [parts, show, flags, changed]);

  if (error && !data) {
    return (
      <div className="space-y-3">
        <BackButton onBack={onBack} />
        <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>
      </div>
    );
  }
  if (!data) return <Skeleton lines={8} className="h-6" label="Opening the translation" />;

  const isDraft = data.status === 'ready';
  const isKept = data.status === 'done';
  const viewing = data.viewingPass;
  const current = data.currentPass;
  const runningPass = (data.passes || []).find((p) => p.status === 'running');
  const doneVersions = (data.passes || []).filter((p) => p.status === 'done');
  const sectionWord = data.sourceFormat === 'xlsx' || data.sourceFormat === 'xls' ? 'Sheet' : 'Page';
  const pageLabel = (pg) => data.pageLabels?.[pg] || `${sectionWord} ${pg}`;
  const flaggedCount = Object.keys(flags).length;
  const job = { ...(jobRow || {}), id: data.id, filename: data.filename, status: data.status, targetLanguage: data.targetLanguage };

  const togglePick = (i) => setPicked((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const pickFlagged = () => { setPicking(true); setScope('parts'); setPicked(new Set(Object.keys(flags).map(Number))); };
  const showPart = (i) => {
    setShow('all');
    setTimeout(() => partRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };
  const partOf = (item) => {
    if (typeof item?.index === 'number' && parts[item.index]) return item.index;
    const hit = Object.entries(flags).find(([, list]) => list.some((f) => f.text && f.text.length && f.text.includes(String(item?.source || item?.excerpt || item?.target || '').slice(0, 30))));
    return hit ? Number(hit[0]) : null;
  };

  const addRule = () => {
    const text = newRule.trim();
    if (!text) return;
    saveRequirements([...requirements, { id: newId(), kind: 'rule', text, remember: false }]);
    setNewRule('');
  };
  const addWord = () => {
    const source = newWord.source.trim();
    if (!source || (!newWord.keep && !newWord.target.trim())) { addToast(newWord.keep ? 'Type the word first' : 'Type the word and the translation it must get', 'error'); return; }
    saveRequirements([...requirements, { id: newId(), kind: 'word', source, target: newWord.keep ? '' : newWord.target.trim(), keep: newWord.keep, remember: false }]);
    setNewWord({ source: '', target: '', keep: false });
  };
  const fixWord = (item) => {
    setNewWord({ source: String(item.source || ''), target: String(item.renderedAs || item.proposedTarget || '').replace(/^\(varies\)$/, ''), keep: false });
    setTimeout(() => document.getElementById('translate-word-source')?.focus(), 50);
  };

  const runPass = async () => {
    if (scope === 'parts' && !picked.size) { addToast('Pick the parts to translate again first (tick them on the left).', 'error'); return; }
    if (!requirements.length && scope === 'all') { addToast('Add a requirement first, or pick only some parts to translate again.', 'error'); return; }
    setBusy('pass');
    try {
      const res = await api.post(`/api/translate/jobs/${jobId}/passes`, { requirements, scope, parts: scope === 'parts' ? [...picked] : undefined });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not start the pass');
      addToast(`Pass ${body.passNo} started. It carries on if you leave this page.`, 'success');
      setPicking(false);
      lastPassRunning.current = true;
      load();
    } catch (e) { addToast(e.message, 'error'); }
    finally { setBusy(''); }
  };
  const cancelPass = async () => {
    if (!runningPass) return;
    const res = await api.post(`/api/translate/jobs/${jobId}/passes/${runningPass.passNo}/cancel`, {});
    if (res.ok) { addToast('Pass cancelled. The version before is kept.'); lastPassRunning.current = false; load(); }
  };
  const keep = async () => {
    setBusy('keep');
    try {
      const res = await api.post(`/api/translate/jobs/${jobId}/keep`, viewing !== current ? { passNo: viewing } : {});
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not keep this version');
      lastStatus.current = 'generating';
      setViewPass(null);
      load();
      onChanged?.();
    } catch (e) { addToast(e.message, 'error'); }
    finally { setBusy(''); }
  };
  const reopen = async () => {
    setBusy('reopen');
    try {
      const res = await api.post(`/api/translate/jobs/${jobId}/reopen`, {});
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not reopen it');
      addToast('Reopened as a draft. The downloads come back when you keep it again.', 'success');
      load();
      onChanged?.();
    } catch (e) { addToast(e.message, 'error'); }
    finally { setBusy(''); }
  };
  const copyTranslation = async () => {
    const text = pages.length && show === 'all'
      ? data.parts.map((p) => p.target).filter(Boolean).join('\n\n')
      : data.parts.map((p) => p.target).filter(Boolean).join('\n\n');
    try { await navigator.clipboard.writeText(text); addToast('Translation copied', 'success'); }
    catch { addToast('Could not copy. Select the text and copy it instead.', 'error'); }
  };

  const unsaved = requirements.filter((r) => r.remember && !r.applied).length;

  return (
    <div className="space-y-4" data-tour="translate-result">
      {/* ── Heading ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <BackButton onBack={onBack} />
          <h2 className="text-lg font-semibold break-all" style={{ color: 'var(--color-text)' }}>{data.filename}</h2>
          <p className="text-sm flex flex-wrap items-center gap-2" style={{ color: 'var(--color-muted)' }}>
            {langLabel(data.sourceLanguage)} → {langLabel(data.targetLanguage)}
            <StatusBadge status={data.status} />
          </p>
          {data.qaSummary?.houseStyle && (
            <Tooltip text={`${data.qaSummary.houseStyle.how === 'picked' ? 'Picked on New translation.' : data.qaSummary.houseStyle.how === 'only' ? 'The only house style for this language.' : 'Chosen by Translate as the closest for this document.'} ${data.qaSummary.houseStyle.examplesUsed} of ${data.qaSummary.houseStyle.examplesTotal} approved examples were sent to the translator. The checker lists departures from it starting "House style:".`}>
              <p className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--color-muted)' }}>
                {getIcon('palette', { size: 12 })} House style: {data.qaSummary.houseStyle.name}
              </p>
            </Tooltip>
          )}
        </div>
        {doneVersions.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Versions">
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Version:</span>
            {doneVersions.map((p) => (
              <Tooltip key={p.passNo} text={p.passNo === 1 ? 'The first translation.' : `Pass ${p.passNo}${p.scope === 'parts' ? ' (only the parts picked)' : ' (whole document)'}${(p.requirements || []).length ? `, with ${(p.requirements || []).length} requirement${(p.requirements || []).length === 1 ? '' : 's'}` : ''}.${p.passNo === current ? ' This is the version being worked on.' : ' Press to read it; Keep this version keeps the one shown.'}`}>
                <button type="button" onClick={() => setViewPass(p.passNo === current ? null : p.passNo)} aria-pressed={viewing === p.passNo}
                  className="text-xs px-2.5 py-1 rounded-full border transition-opacity duration-200 hover:opacity-70"
                  style={{ borderColor: viewing === p.passNo ? 'var(--color-primary)' : 'var(--color-border)', color: viewing === p.passNo ? 'var(--color-primary)' : 'var(--color-text)', fontWeight: viewing === p.passNo ? 600 : 400, background: 'var(--color-surface)' }}>
                  {p.passNo}{p.passNo === current ? ' (latest)' : ''}
                </button>
              </Tooltip>
            ))}
          </div>
        )}
      </div>

      {isDraft && (
        <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--color-primary)', background: 'var(--color-surface)', color: 'var(--color-text)' }}>
          <strong>This is a draft.</strong> Read it beside the original. If something needs changing, add a requirement under
          <strong> Another pass</strong> and run it. When you are happy, press <strong>Keep this version</strong>: that makes the PDF and other files, and saves anything you ticked to remember.
          {viewing !== current && <span className="block mt-1" style={{ color: '#b45309' }}>You are reading version {viewing}, not the latest. Keep this version keeps the one shown.</span>}
        </div>
      )}
      {data.errorMessage && isDraft && <p className="text-sm" style={{ color: '#ef4444' }}>{data.errorMessage}</p>}

      <div className="flex flex-col xl:grid xl:grid-cols-3 xl:items-start gap-4">
        {/* ── Reading view ── */}
        <section className={`${CARD} xl:col-span-2`} style={CARD_STYLE} data-tour="translate-reading">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
              {[
                ['all', `All parts (${parts.length})`, 'Show every part of the document.'],
                ['flagged', `Marked by the checks (${flaggedCount})`, 'Show only the parts the checks found something in.'],
                ...(changed.size ? [['changed', `Changed in this version (${changed.size})`, 'Show only the parts this pass translated differently.']] : []),
              ].map(([v, label, tip]) => (
                <Tooltip key={v} text={tip}>
                  <button type="button" onClick={() => setShow(v)} aria-pressed={show === v}
                    className="text-xs px-2.5 py-1 rounded-full border transition-opacity duration-200 hover:opacity-70"
                    style={{ borderColor: show === v ? 'var(--color-primary)' : 'var(--color-border)', color: show === v ? 'var(--color-primary)' : 'var(--color-text)', background: 'var(--color-bg)' }}>
                    {label}
                  </button>
                </Tooltip>
              ))}
            </div>
            <span className="flex-1" />
            {isDraft && (
              <Tooltip text="Tick the parts to translate again in the next pass, instead of the whole document.">
                <button type="button" onClick={() => { setPicking((v) => !v); setScope(picking ? 'all' : 'parts'); }} aria-pressed={picking} className={OUTLINE_BTN} style={OUTLINE_STYLE}>
                  {getIcon('check-square', { size: 14 }) || null} {picking ? `Picking (${picked.size})` : 'Pick parts'}
                </button>
              </Tooltip>
            )}
            <Tooltip text="Copy the whole translation (this version) so you can paste it somewhere else.">
              <button type="button" onClick={copyTranslation} className={OUTLINE_BTN} style={OUTLINE_STYLE}>
                {getIcon('copy', { size: 14 }) || null} Copy translation
              </button>
            </Tooltip>
          </div>

          <div className="hidden md:grid grid-cols-2 gap-4 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
            <span>Original · {langLabel(data.sourceLanguage)}</span>
            <span>Translation · {langLabel(data.targetLanguage)}{viewing !== current ? ` (version ${viewing})` : ''}</span>
          </div>

          {!pages.length && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Nothing to show for this choice.</p>}
          <div className="space-y-4" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            {pages.map(([pg, list]) => (
              <div key={pg} className="space-y-2">
                {(data.parts.length > 0 && Object.keys(data.pageLabels || {}).length + new Set(parts.map((p) => p.page)).size > 1) && (
                  <p className="text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>{pageLabel(pg)}</p>
                )}
                {list.map((p) => {
                  const f = flags[p.i];
                  const isChanged = changed.has(p.i);
                  return (
                    <div key={p.i} ref={(el) => { partRefs.current[p.i] = el; }}
                      className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-4 rounded-lg p-2"
                      style={{ background: f ? 'rgba(245,158,11,0.08)' : 'transparent', borderLeft: `3px solid ${isChanged ? 'var(--color-primary)' : f ? '#f59e0b' : 'transparent'}` }}>
                      <div className="text-sm whitespace-pre-wrap break-words flex gap-2" style={{ color: 'var(--color-muted)' }}>
                        {picking && isDraft && (
                          <input type="checkbox" className="mt-1 shrink-0" checked={picked.has(p.i)} onChange={() => togglePick(p.i)} aria-label={`Translate part ${p.i + 1} again`} />
                        )}
                        <span>{p.source}</span>
                      </div>
                      <div className="text-sm whitespace-pre-wrap break-words" style={{ color: 'var(--color-text)' }}>
                        {p.target || <em style={{ color: 'var(--color-muted)' }}>(empty)</em>}
                        {(f || isChanged) && (
                          <span className="flex flex-wrap gap-1 mt-1">
                            {isChanged && <span className="text-[11px] px-1.5 rounded" style={{ border: '1px solid var(--color-primary)', color: 'var(--color-primary)' }}>Changed in this version</span>}
                            {(f || []).map((x, k) => (
                              <Tooltip key={k} text={x.text}>
                                <span className="text-[11px] px-1.5 rounded" style={{ border: '1px solid #f59e0b', color: '#b45309' }}>{x.title}</span>
                              </Tooltip>
                            ))}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        {/* ── Side panel ── */}
        <div className="space-y-4">
          {isDraft && (
            <section className={CARD} style={CARD_STYLE} data-tour="translate-keep">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Happy with it?</h3>
              <Tooltip text="Commit this version: the PDF (and Word or Excel copy) are made, its wording is added to the translation memory and the learned glossary, and the requirements ticked to remember are saved for future translations.">
                <button type="button" onClick={keep} disabled={!!busy || !!runningPass} className={OUTLINE_BTN} style={PRIMARY_STYLE}>
                  {getIcon('check', { size: 14 }) || null} {busy === 'keep' ? 'Keeping…' : viewing !== current ? `Keep version ${viewing}` : 'Keep this version'}
                </button>
              </Tooltip>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {runningPass ? 'Wait for the pass to finish, or cancel it, first.' : `Makes the files, then they are ready to download.${unsaved ? ` Also saves ${unsaved} requirement${unsaved === 1 ? '' : 's'} for future translations.` : ''}`}
              </p>
            </section>
          )}
          {data.status === 'generating' && (
            <section className={CARD} style={CARD_STYLE}>
              <p className="text-sm" style={{ color: 'var(--color-text)' }}>Making the files… You can leave this page; it carries on.</p>
              <Skeleton lines={1} className="h-2" label="Making the files" />
            </section>
          )}
          {isKept && (
            <section className={CARD} style={CARD_STYLE}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Downloads</h3>
              <Downloads job={job} qa={data.qaSummary} appVersion={appVersion} onDownload={onDownload} onDownloadNative={onDownloadNative} onDownloadOriginal={onDownloadOriginal} onDownloadText={onDownloadText} />
              <div className="flex flex-wrap gap-2 pt-1">
                <Tooltip text="Make this a draft again to run more passes with new requirements (Run again). The downloads come back when you keep it again.">
                  <button type="button" onClick={reopen} disabled={!!busy} className={OUTLINE_BTN} style={OUTLINE_STYLE}>
                    {getIcon('repeat', { size: 14 })} {busy === 'reopen' ? 'Reopening…' : 'Reopen as a draft'}
                  </button>
                </Tooltip>
                {data.qaSummary && (
                  <Tooltip text="Turn what the checks found into rules and fixed wording for your future translations. This translation stays as it is.">
                    <button type="button" onClick={() => setLessonsOpen(true)} className={OUTLINE_BTN} style={OUTLINE_STYLE}>
                      {getIcon('lightbulb', { size: 14 })} Lessons learnt
                    </button>
                  </Tooltip>
                )}
              </div>
            </section>
          )}

          {isDraft && (
            <section className={CARD} style={CARD_STYLE} data-tour="translate-pass">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Another pass</h3>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Add what should be different, then run the translation again. Requirements stay with this translation for every later pass.
                Tick <em>Remember</em> to keep one for future translations too; it is only saved when you keep a version.
              </p>

              {requirements.length > 0 && (
                <ul className="space-y-1.5">
                  {requirements.map((r) => (
                    <li key={r.id} className="flex items-start gap-2 text-sm rounded-lg border px-2 py-1.5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
                      <span className="flex-1 min-w-0 break-words">
                        {r.kind === 'rule' ? r.text : r.keep ? <>Leave “{r.source}” as written</> : <>“{r.source}” → “{r.target}”</>}
                        {r.applied && <span className="block text-[11px]" style={{ color: 'var(--color-muted)' }}>Saved for future translations</span>}
                      </span>
                      {!r.applied && (
                        <Tooltip text={r.kind === 'rule' ? 'Also follow this rule in every future translation, in every language (saved when you keep a version).' : `Also use this in every future translation into ${langLabel(data.targetLanguage)} (saved to its learned glossary when you keep a version).`}>
                          <label className="text-xs flex items-center gap-1 cursor-pointer shrink-0" style={{ color: 'var(--color-muted)' }}>
                            <input type="checkbox" checked={!!r.remember} onChange={(e) => saveRequirements(requirements.map((x) => (x.id === r.id ? { ...x, remember: e.target.checked } : x)))} />
                            Remember
                          </label>
                        </Tooltip>
                      )}
                      <Tooltip text="Remove this requirement from the next pass.">
                        <button type="button" onClick={() => saveRequirements(requirements.filter((x) => x.id !== r.id))} aria-label="Remove requirement" className="shrink-0 transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-muted)' }}>
                          {getIcon('x', { size: 14 })}
                        </button>
                      </Tooltip>
                    </li>
                  ))}
                </ul>
              )}

              <div className="space-y-1.5">
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>A rule, in your own words</span>
                <Tip text="For example: use the formal “vous”; keep section numbers as written; shorter sentences. Type it or press the microphone and say it.">
                  <VoiceInput value={newRule} onChange={setNewRule} placeholder="e.g. Use the formal “vous” throughout" label="A rule for the next pass" />
                </Tip>
                <button type="button" onClick={addRule} disabled={!newRule.trim()} className={OUTLINE_BTN} style={OUTLINE_STYLE}>{getIcon('plus', { size: 13 })} Add rule</button>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>A word</span>
                <div className="grid grid-cols-2 gap-2">
                  <input id="translate-word-source" value={newWord.source} onChange={(e) => setNewWord((w) => ({ ...w, source: e.target.value }))} placeholder="In the original" aria-label="Word in the original"
                    className="text-sm px-2.5 py-1.5 rounded-lg border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                  <input value={newWord.target} onChange={(e) => setNewWord((w) => ({ ...w, target: e.target.value }))} disabled={newWord.keep} placeholder={newWord.keep ? 'Left as it is' : 'Must be translated as'} aria-label="Must be translated as"
                    className="text-sm px-2.5 py-1.5 rounded-lg border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', opacity: newWord.keep ? 0.5 : 1 }} />
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <Tooltip text="Leave the word exactly as written (a brand name, a code) instead of translating it.">
                    <label className="text-xs flex items-center gap-1.5 cursor-pointer" style={{ color: 'var(--color-text)' }}>
                      <input type="checkbox" checked={newWord.keep} onChange={(e) => setNewWord((w) => ({ ...w, keep: e.target.checked }))} /> Keep as is
                    </label>
                  </Tooltip>
                  <button type="button" onClick={addWord} disabled={!newWord.source.trim()} className={OUTLINE_BTN} style={OUTLINE_STYLE}>{getIcon('plus', { size: 13 })} Add word</button>
                </div>
              </div>

              <div className="space-y-1.5 pt-1">
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Translate again</span>
                <Tooltip text="Every part is translated again with the requirements. Takes as long as the first translation and costs about the same.">
                  <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
                    <input type="radio" name="pass-scope" checked={scope === 'all'} onChange={() => { setScope('all'); setPicking(false); }} /> The whole document
                  </label>
                </Tooltip>
                <Tooltip text="Only the parts you tick on the left are translated again (seconds, small cost). The rest stay as they are.">
                  <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
                    <input type="radio" name="pass-scope" checked={scope === 'parts'} onChange={() => { setScope('parts'); setPicking(true); }} /> Only the parts I pick ({picked.size} picked)
                  </label>
                </Tooltip>
                {scope === 'parts' && flaggedCount > 0 && (
                  <button type="button" onClick={pickFlagged} className="text-xs underline transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }}>
                    Pick the {flaggedCount} part{flaggedCount === 1 ? '' : 's'} the checks marked
                  </button>
                )}
              </div>

              {runningPass ? (
                <div className="space-y-1.5">
                  <p className="text-sm" style={{ color: 'var(--color-text)' }}>Pass {runningPass.passNo}: {runningPass.stage || 'Working…'}{runningPass.progress != null ? ` · ${runningPass.progress}%` : ''}</p>
                  <span className="block h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                    <span className="block h-1.5" style={{ width: `${Math.max(3, Number(runningPass.progress) || 0)}%`, background: 'var(--color-primary)', transition: 'width 200ms' }} />
                  </span>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>You can leave this page; it carries on.</p>
                  <button type="button" onClick={cancelPass} className={OUTLINE_BTN} style={{ ...OUTLINE_STYLE, color: '#ef4444' }}>Cancel this pass</button>
                </div>
              ) : (
                <Tooltip text="Run the translation again with the requirements above. The version shown now stays until the new one is ready, and you can go back to it.">
                  <button type="button" onClick={runPass} disabled={!!busy || viewing !== current} className={OUTLINE_BTN} style={PRIMARY_STYLE}>
                    {getIcon('repeat', { size: 14 })} {busy === 'pass' ? 'Starting…' : 'Run another pass'}
                  </button>
                </Tooltip>
              )}
              {viewing !== current && !runningPass && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>A pass always starts from the latest version. Go back to it to run one.</p>}
            </section>
          )}

          <section className={CARD} style={CARD_STYLE}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>What the checks found{viewing !== current ? ` (version ${viewing})` : ''}</h3>
            <CheckFindings qa={data.qaSummary} isMaori={data.targetLanguage === 'mi' || data.sourceLanguage === 'mi'}
              onFixWord={isDraft ? fixWord : null} onShowPart={showPart} partOf={partOf} />
            <TechnicalDetails qa={data.qaSummary} appVersion={appVersion} />
          </section>
        </div>
      </div>
      {lessonsOpen && data.qaSummary && <LessonsLearntModal qa={data.qaSummary} job={job} appVersion={appVersion} onClose={() => setLessonsOpen(false)} />}
    </div>
  );
}

function BackButton({ onBack }) {
  const getIcon = useIcon();
  return (
    <Tooltip text="Go back to the list of your translations.">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium transition-opacity duration-200 hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
        {getIcon('arrow-left', { size: 14 })} My translations
      </button>
    </Tooltip>
  );
}
