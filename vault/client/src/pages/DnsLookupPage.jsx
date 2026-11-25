import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import { useIcon } from '../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import { downloadBlob } from '../utils/exportHelpers';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import ToolSidebar from '../components/ToolSidebar';
import Tooltip from '../components/Tooltip';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import DnsLookupTutorChat from './dnsLookup/DnsLookupTutorChat';
import { HOW_IT_WORKS, GUIDE_TOOLS, DNS_TOOLS, GROUPS, GROUP_TIPS, TOOL_TIPS } from './dnsLookup/dnsLookupTools.mjs';
import { compareResults } from './dnsLookup/compare.mjs';
import { aboutLines, reportCsv, reportHtml, reportFilename } from './dnsLookup/report.mjs';
import { startDnsLookupTour, TOUR_KEY as DNS_TOUR_KEY } from '../utils/tours/dnsLookupTour';

const FIELD = 'px-3 py-2.5 rounded-xl border text-sm outline-none';
const FIELD_STYLE = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const ALL_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'CAA'];
const TYPE_TIPS = {
  A: 'The address a name points to (IPv4)', AAAA: 'The address a name points to (IPv6)', CNAME: 'An alias to another name',
  MX: 'Where email for the name goes', NS: 'Who runs the name\'s DNS', TXT: 'Notes such as SPF and site verification',
  SOA: 'The zone\'s admin details', CAA: 'Who may issue security certificates',
};
const RESOLVERS = [{ id: 'cloudflare', label: 'Cloudflare (1.1.1.1)' }, { id: 'google', label: 'Google (8.8.8.8)' }];
// Status colours are deliberately outside the theme (see client/DESIGN.md).
const LEVEL = { good: '#16a34a', warn: '#f59e0b', bad: '#ef4444', info: 'var(--color-muted)' };
const LEVEL_WORD = { good: 'Good', warn: 'Worth a look', bad: 'Problem', info: 'Note' };

const MENU = GROUPS.map((label) => ({
  label, tip: GROUP_TIPS[label],
  tools: DNS_TOOLS.filter((t) => t.group === label).map((t) => ({ ...t, tip: TOOL_TIPS[t.id] })),
}));

const SMALL_BUTTON = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs hover:opacity-70 transition-opacity duration-200';
const SMALL_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' };

function CopyButton({ value }) {
  const getIcon = useIcon();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <Tooltip text="Copy this value.">
      <button
        type="button" onClick={copy} aria-label="Copy value"
        className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-xs hover:opacity-70 transition-opacity duration-200"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
      >
        {getIcon(done ? 'check' : 'copy', { size: 11 })}{done ? 'Copied' : 'Copy'}
      </button>
    </Tooltip>
  );
}

// Export one lookup (shaped like a saved row) as a report page or a CSV.
function ExportButtons({ item }) {
  const getIcon = useIcon();
  const save = (text, type, ext) => downloadBlob(new Blob([text], { type }), reportFilename(item, ext));
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-guide="export">
      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Export:</span>
      <Tooltip text="Download this answer as a report page. It opens in any browser and you can print it to PDF from there.">
        <button type="button" className={SMALL_BUTTON} style={SMALL_STYLE} onClick={() => save(reportHtml(item), 'text/html;charset=utf-8', 'html')}>
          {getIcon('file-down', { size: 12 })}Report
        </button>
      </Tooltip>
      <Tooltip text="Download this answer as a CSV file, which opens in Excel or Google Sheets.">
        <button type="button" className={SMALL_BUTTON} style={SMALL_STYLE} onClick={() => save(reportCsv(item), 'text/csv;charset=utf-8', 'csv')}>
          {getIcon('download', { size: 12 })}CSV
        </button>
      </Tooltip>
    </div>
  );
}

// Who hosts the address and which registrar the domain is with. `about` is null while the page is still asking.
function AboutPanel({ about }) {
  return (
    <div className="rounded-xl border p-3 space-y-1.5" style={{ borderColor: 'var(--color-primary)', background: 'var(--color-bg)' }} data-guide="about">
      <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Host and registrar</p>
      {!about && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Finding who hosts it and who it is registered with…</p>}
      {about?.error && <p className="text-xs" style={{ color: LEVEL.bad }}>{about.error}</p>}
      {about && aboutLines(about).map(([label, value]) => (
        <div key={label} className="flex gap-3">
          <span className="w-28 shrink-0 text-xs pt-0.5" style={{ color: 'var(--color-muted)' }}>{label}</span>
          <span className="flex-1 min-w-0 break-words text-sm" style={{ color: 'var(--color-text)' }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function RecordBlock({ result, verdict }) {
  const { type, records, error } = result;
  return (
    <div className="rounded-xl border p-3 space-y-1.5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }} title={TYPE_TIPS[type]}>{type}</span>
        {verdict && verdict.same !== null && (
          <span className="text-xs" style={{ color: verdict.same ? LEVEL.good : LEVEL.warn }}>
            {verdict.same ? 'Same on both' : 'Differs between Cloudflare and Google'}
          </span>
        )}
      </div>
      {error && <p className="text-xs" style={{ color: LEVEL.bad }}>{error}</p>}
      {!error && records.length === 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>None found.</p>}
      {records.map((r, i) => (
        <div key={`${r.value}-${i}`} className="flex items-start gap-2 text-sm">
          <span className="flex-1 min-w-0 break-all font-mono text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>
            {r.priority !== undefined && <span style={{ color: 'var(--color-muted)' }}>priority {r.priority} · </span>}
            {r.value}
            {r.ttl !== undefined && <span style={{ color: 'var(--color-muted)' }}> · TTL {r.ttl}s</span>}
          </span>
          <CopyButton value={r.value} />
        </div>
      ))}
    </div>
  );
}

const savedOn = (item) => new Date(item.createdAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });

export default function DnsLookupPage() {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const isAdmin = useAuthStore((s) => s.user?.isAdmin);
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.dnsLookup !== false;
  const info = useToolInfoModal('vault_dns_lookup_info_seen');
  const [params, setParams] = useSearchParams();
  const [tool, setTool] = useState('lookup');

  const [name, setName] = useState('');
  const [types, setTypes] = useState(ALL_TYPES);
  const [resolver, setResolver] = useState('cloudflare');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The answer on screen, shaped like a saved row: { kind: 'records', name, resolver, createdAt, result: { answer, about } }.
  const [shown, setShown] = useState(null);

  const [emailName, setEmailName] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailShown, setEmailShown] = useState(null); // { kind: 'email', name, resolver, createdAt, result: { name, mx, findings } }

  const [saved, setSaved] = useState(null); // null until loaded
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => {
    api.get('/api/settings/feature-access').then((r) => r.json()).then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); }).catch(() => {});
  }, []);

  // Settings -> DNS Lookup Tour opens /dns-lookup?tour=1
  useEffect(() => {
    if (params.get('tour')) {
      const next = new URLSearchParams(params); next.delete('tour');
      setParams(next, { replace: true });
      setTimeout(startDnsLookupTour, 300);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSaved = useCallback(() => {
    api.get('/api/dns-lookup/saved').then((r) => r.json()).then((d) => setSaved(d.lookups || [])).catch(() => setSaved([]));
  }, []);
  useEffect(() => { if (tool === 'saved') loadSaved(); }, [tool, loadSaved]);

  const startTour = () => {
    try { localStorage.removeItem(DNS_TOUR_KEY); } catch (_) { /* ignore */ }
    setTool('lookup');
    setTimeout(startDnsLookupTour, 100);
  };

  // The guide's "Open" buttons: open the menu tool, then scroll to the control once it is on screen.
  const openToolById = (id) => {
    const target = GUIDE_TOOLS.find((t) => t.id === id);
    setTool(target ? target.tool : id);
    setTimeout(() => document.querySelector(`[data-guide="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  };

  // Keep every answer the page shows. A failed save never hides the answer.
  const keep = (item) => {
    api.post('/api/dns-lookup/saved', item).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.lookup) setSaved((cur) => (cur ? [d.lookup, ...cur] : cur)); })
      .catch(() => {});
  };

  const ask = async (resolverId) => {
    const r = await api.post('/api/dns-lookup/records', { name, resolver: resolverId, types });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Could not look that up.');
    return d;
  };

  // Records show first; the host and registrar (slower, they come from the registries) fill in when they arrive. Saved once both are in.
  const run = async (getAnswer) => {
    if (!name.trim() || busy) return;
    setBusy(true); setError(''); setShown(null);
    const aboutPromise = api.post('/api/dns-lookup/about', { name, resolver })
      .then(async (r) => { const d = await r.json(); return r.ok ? d : { error: d.error || 'Could not find the host and registrar.' }; })
      .catch(() => ({ error: 'Could not find the host and registrar.' }));
    try {
      const answer = await getAnswer();
      const base = { kind: 'records', name: answer.name || answer.ip, resolver: answer.compare ? null : answer.resolver, createdAt: new Date().toISOString() };
      setShown({ ...base, result: { answer, about: null } });
      const item = { ...base, result: { answer, about: await aboutPromise } };
      setShown(item);
      keep(item);
    } catch (e) { setError(e.message || 'Could not reach the server.'); } finally { setBusy(false); }
  };

  const lookUp = () => run(() => ask(resolver));
  const compareBoth = () => run(async () => {
    const [a, b] = await Promise.all([ask('cloudflare'), ask('google')]);
    const verdicts = Object.fromEntries(compareResults(a.results, b.results).map((v) => [v.type, v]));
    return { ...a, compare: { verdicts } };
  });

  const checkEmail = async () => {
    if (!emailName.trim() || emailBusy) return;
    setEmailBusy(true); setEmailError('');
    try {
      const r = await api.post('/api/dns-lookup/email', { name: emailName, resolver });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not check that.');
      const item = { kind: 'email', name: d.name, resolver: d.resolver, createdAt: new Date().toISOString(), result: d };
      setEmailShown(item);
      keep(item);
    } catch (e) { setEmailError(e.message || 'Could not reach the server.'); setEmailShown(null); } finally { setEmailBusy(false); }
  };

  const openSaved = (item) => {
    if (item.kind === 'email') { setEmailName(item.name); setEmailShown(item); setEmailError(''); setTool('email-check'); return; }
    setName(item.name);
    if (item.resolver) setResolver(item.resolver);
    setShown(item); setError(''); setTool('lookup');
  };

  const deleteSaved = async (item) => {
    setConfirmDelete(null);
    try {
      const r = await api.delete(`/api/dns-lookup/saved/${item.id}`);
      if (!r.ok) throw new Error('delete failed');
      const { binId } = await r.json();
      setSaved((cur) => cur.filter((x) => x.id !== item.id));
      addToast('Lookup deleted. Kept 30 days in the recycle bin.', 'success', undefined, {
        label: 'Undo',
        onClick: async () => {
          const res = await api.post(`/api/recycle-bin/${binId}/restore`).catch(() => null);
          if (res?.ok) { loadSaved(); addToast('Lookup restored ✓', 'success'); } else addToast('That could not be restored. Look in Settings → Recycle bin.', 'error');
        },
      });
    } catch { addToast('That lookup could not be deleted. Try again.', 'error'); }
  };

  const toggleType = (t) => setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : ALL_TYPES.filter((x) => x === t || cur.includes(x))));

  if (!canUse) return <Navigate to="/" replace />;

  const buttonClass = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity duration-200 disabled:opacity-40';
  const box = 'rounded-2xl border p-6 space-y-4';
  const boxStyle = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
  const primary = { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' };
  const answer = shown?.result.answer;

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
        <ToolSidebar
          title="DNS Lookup" icon="globe" groups={MENU} current={tool} onSelect={setTool}
          onInfo={info.open} infoTip="How DNS Lookup works: records, host and registrar, email checks, saved lookups and export."
          onTour={startTour} tourTip="Take the guided tour of DNS Lookup."
        />

        <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6" style={{ background: 'var(--color-bg)' }}>
          <div className="w-full max-w-5xl space-y-5">
            {tool === 'lookup' && (
              <div className={box} style={boxStyle} data-guide="lookup">
                <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Look up records</h2>
                <div className="space-y-3" data-tour="dns-name">
                  <input
                    className={`${FIELD} w-full`} style={FIELD_STYLE} placeholder="Domain, web address or IP address (e.g. example.com)" data-guide="name"
                    aria-label="Domain name or IP address" value={name} maxLength={300} autoCapitalize="none" spellCheck={false}
                    onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookUp()}
                  />
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Record types" data-guide="types">
                    {ALL_TYPES.map((t) => {
                      const on = types.includes(t);
                      return (
                        <Tooltip key={t} text={TYPE_TIPS[t]}>
                          <button
                            type="button" aria-pressed={on} onClick={() => toggleType(t)}
                            className="px-2.5 py-1 rounded-lg border text-xs font-medium hover:opacity-70 transition-opacity duration-200"
                            style={{ borderColor: on ? 'var(--color-primary)' : 'var(--color-border)', color: on ? 'var(--color-primary)' : 'var(--color-muted)', background: 'transparent' }}
                          >{t}</button>
                        </Tooltip>
                      );
                    })}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Tooltip text="Which public resolver to ask. Both see the name the way the wider internet does.">
                      <select className={FIELD} style={FIELD_STYLE} aria-label="Ask which resolver" value={resolver} onChange={(e) => setResolver(e.target.value)} data-guide="resolver">
                        {RESOLVERS.map((r) => <option key={r.id} value={r.id}>Ask {r.label}</option>)}
                      </select>
                    </Tooltip>
                    <Tooltip text="Look up the records, who hosts the name and who it is registered with. The answer is kept under Saved lookups.">
                      <button type="button" onClick={lookUp} disabled={busy || !name.trim() || types.length === 0} className={buttonClass} style={primary}>
                        {getIcon('search', { size: 14 })}{busy ? 'Looking…' : 'Look up'}
                      </button>
                    </Tooltip>
                    <Tooltip text="Ask Cloudflare and Google the same question and see whether they agree. Use it after changing a record.">
                      <button
                        type="button" onClick={compareBoth} disabled={busy || !name.trim() || types.length === 0} data-tour="dns-compare"
                        className={`${buttonClass} border`} style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
                      >
                        Compare both
                      </button>
                    </Tooltip>
                  </div>
                </div>
                {error && <p className="text-sm" style={{ color: LEVEL.bad }}>{error}</p>}

                {answer && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        {answer.compare ? 'Cloudflare and Google compared for ' : `Answer from ${RESOLVERS.find((r) => r.id === answer.resolver)?.label} for `}
                        <strong style={{ color: 'var(--color-text)' }}>{answer.name || answer.ip}</strong> · {savedOn(shown)}
                      </p>
                      {shown.result.about && <ExportButtons item={shown} />}
                    </div>
                    <AboutPanel about={shown.result.about} />
                    {answer.results.map((r) => (
                      <RecordBlock key={r.type} result={r} verdict={answer.compare?.verdicts[r.type]} />
                    ))}
                    {answer.compare && Object.values(answer.compare.verdicts).some((v) => v.same === false) && (
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                        The two differ on some records. After a change that usually means it is still spreading; try again later. The block shows Cloudflare's answer; ask Google on its own to see theirs.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {tool === 'email-check' && (
              <div className={box} style={boxStyle} data-guide="email-check" data-tour="dns-email">
                <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Check email setup</h2>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    className={`${FIELD} flex-1`} style={FIELD_STYLE} placeholder="Domain (e.g. example.com)"
                    aria-label="Domain to check email setup for" value={emailName} maxLength={300} autoCapitalize="none" spellCheck={false}
                    onChange={(e) => setEmailName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && checkEmail()}
                  />
                  <Tooltip text="Read the domain's MX, SPF and DMARC records and say whether they look right. The answer is kept under Saved lookups.">
                    <button type="button" onClick={checkEmail} disabled={emailBusy || !emailName.trim()} className={buttonClass} style={primary}>
                      {getIcon('mail', { size: 14 })}{emailBusy ? 'Checking…' : 'Check email setup'}
                    </button>
                  </Tooltip>
                </div>
                {emailError && <p className="text-sm" style={{ color: LEVEL.bad }}>{emailError}</p>}
                {emailShown && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        Findings for <strong style={{ color: 'var(--color-text)' }}>{emailShown.name}</strong> · {savedOn(emailShown)}. This reads the records only; it cannot tell whether an email will really arrive.
                      </p>
                      <ExportButtons item={emailShown} />
                    </div>
                    {emailShown.result.findings.map((f) => (
                      <div key={f.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                          <span className="inline-block text-xs font-semibold mr-2 px-1.5 py-0.5 rounded" style={{ color: LEVEL[f.level], border: `1px solid ${LEVEL[f.level]}` }}>{LEVEL_WORD[f.level]}</span>
                          {f.title}
                        </p>
                        <p className="text-xs mt-1 break-words leading-relaxed" style={{ color: 'var(--color-muted)' }}>{f.detail}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tool === 'saved' && (
              <div className={box} style={boxStyle} data-guide="saved">
                <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Saved lookups</h2>
                {saved === null && <Skeleton lines={4} />}
                {saved?.length === 0 && <EmptyState icon="history" title="No saved lookups yet" body="Every lookup and email check you run is kept here." />}
                {saved?.length > 0 && (
                  <ul className="space-y-1.5">
                    {saved.map((item) => (
                      <li key={item.id} className="group flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                        <Tooltip text="Open this answer again, as it was when you looked it up.">
                          <button type="button" onClick={() => openSaved(item)} className="flex-1 min-w-0 flex items-center gap-2 text-left hover:opacity-70 transition-opacity duration-200">
                            <span style={{ color: 'var(--color-muted)' }}>{getIcon(item.kind === 'email' ? 'mail' : 'search', { size: 13 })}</span>
                            <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{item.name}</span>
                            <span className="text-xs shrink-0" style={{ color: 'var(--color-muted)' }}>
                              {item.kind === 'email' ? 'Email check' : (item.resolver ? 'Records' : 'Records, compared')} · {savedOn(item)}
                            </span>
                          </button>
                        </Tooltip>
                        <ExportButtons item={item} />
                        {confirmDelete === item.id ? (
                          <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
                            Delete?
                            <button type="button" onClick={() => deleteSaved(item)} className="font-semibold hover:opacity-70 transition-opacity duration-200" style={{ color: LEVEL.bad }}>Yes</button>
                            <button type="button" onClick={() => setConfirmDelete(null)} className="hover:opacity-70 transition-opacity duration-200">No</button>
                          </span>
                        ) : (
                          <Tooltip text="Delete this saved lookup. It stays in the recycle bin for 30 days.">
                            <button
                              type="button" aria-label={`Delete saved lookup for ${item.name}`} onClick={() => setConfirmDelete(item.id)}
                              className="opacity-0 group-hover:opacity-60 focus-visible:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}
                            >
                              {getIcon('trash', { size: 14 })}
                            </button>
                          </Tooltip>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      {info.show && (
        <ToolInfoModal title="How DNS Lookup Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Find out what a domain name points to, who hosts it and who it is registered with, and check its email records. Not sure where to start? Press the round button at the bottom right and tell the guide what you want to know.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, text]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
            ))}
          </div>
        </ToolInfoModal>
      )}

      <DnsLookupTutorChat currentTool={tool} onOpenTool={openToolById} />
    </VoiceInputProvider>
  );
}
