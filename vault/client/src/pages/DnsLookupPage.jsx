import React, { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import { useIcon } from '../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import DnsLookupTutorChat from './dnsLookup/DnsLookupTutorChat';
import { HOW_IT_WORKS, GUIDE_TOOLS } from './dnsLookup/dnsLookupTools.mjs';
import { compareResults } from './dnsLookup/compare.mjs';
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

function CopyButton({ value }) {
  const getIcon = useIcon();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <button
      type="button" onClick={copy} aria-label="Copy value"
      className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-xs hover:opacity-70 transition-opacity"
      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
    >
      {getIcon(done ? 'check' : 'copy', { size: 11 })}{done ? 'Copied' : 'Copy'}
    </button>
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

export default function DnsLookupPage() {
  const getIcon = useIcon();
  const isAdmin = useAuthStore((s) => s.user?.isAdmin);
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.dnsLookup !== false;
  const info = useToolInfoModal('vault_dns_lookup_info_seen');
  const [params, setParams] = useSearchParams();

  const [name, setName] = useState('');
  const [types, setTypes] = useState(ALL_TYPES);
  const [resolver, setResolver] = useState('cloudflare');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState(null);     // { name|ip, resolver, results, verdicts? }

  const [emailName, setEmailName] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailAnswer, setEmailAnswer] = useState(null);

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

  const startTour = () => {
    try { localStorage.removeItem(DNS_TOUR_KEY); } catch (_) { /* ignore */ }
    startDnsLookupTour();
  };

  // The guide's "Open" buttons: scroll to the box that holds the control.
  const openToolById = (id) => {
    const target = GUIDE_TOOLS.find((t) => t.id === id);
    document.querySelector(`[data-guide="${target ? target.tool : id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const ask = async (resolverId) => {
    const r = await api.post('/api/dns-lookup/records', { name, resolver: resolverId, types });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Could not look that up.');
    return d;
  };

  const lookUp = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setError('');
    try { setAnswer(await ask(resolver)); } catch (e) { setError(e.message || 'Could not reach the server.'); setAnswer(null); } finally { setBusy(false); }
  };

  const compareBoth = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const [a, b] = await Promise.all([ask('cloudflare'), ask('google')]);
      const verdicts = Object.fromEntries(compareResults(a.results, b.results).map((v) => [v.type, v]));
      setAnswer({ ...a, compare: { cloudflare: a, google: b, verdicts } });
    } catch (e) { setError(e.message || 'Could not reach the server.'); setAnswer(null); } finally { setBusy(false); }
  };

  const checkEmail = async () => {
    if (!emailName.trim() || emailBusy) return;
    setEmailBusy(true); setEmailError('');
    try {
      const r = await api.post('/api/dns-lookup/email', { name: emailName, resolver });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not check that.');
      setEmailAnswer(d);
    } catch (e) { setEmailError(e.message || 'Could not reach the server.'); setEmailAnswer(null); } finally { setEmailBusy(false); }
  };

  const toggleType = (t) => setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : ALL_TYPES.filter((x) => x === t || cur.includes(x))));

  if (!canUse) return <Navigate to="/" replace />;

  const buttonClass = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity disabled:opacity-40';

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
      <div className="w-full max-w-4xl mx-auto space-y-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>DNS Lookup</h1>
            <button type="button" title="How DNS Lookup works" aria-label="How DNS Lookup works" onClick={info.open} className="opacity-60 hover:opacity-100 transition-opacity" style={{ color: 'var(--color-muted)' }}>{getIcon('info', { size: 16 })}</button>
            <button type="button" title="Take the guided tour of DNS Lookup" aria-label="Take the guided tour of DNS Lookup" onClick={startTour} className="opacity-60 hover:opacity-100 transition-opacity" style={{ color: 'var(--color-muted)' }}>{getIcon('compass', { size: 16 })}</button>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            See what a domain name points to, where its email goes, and whether a DNS change has spread. Read only: nothing is changed or saved.
          </p>
        </div>

        <div className="rounded-2xl border p-6 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }} data-guide="lookup">
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Look up records</h2>
          <div className="space-y-3" data-tour="dns-name">
            <input
              className={`${FIELD} w-full`} style={FIELD_STYLE} placeholder="Domain, web address or IP address (e.g. example.com)"
              aria-label="Domain name or IP address" value={name} maxLength={300} autoCapitalize="none" spellCheck={false}
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookUp()}
            />
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Record types">
              {ALL_TYPES.map((t) => {
                const on = types.includes(t);
                return (
                  <button
                    key={t} type="button" title={TYPE_TIPS[t]} aria-pressed={on} onClick={() => toggleType(t)}
                    className="px-2.5 py-1 rounded-lg border text-xs font-medium hover:opacity-70 transition-opacity"
                    style={{ borderColor: on ? 'var(--color-primary)' : 'var(--color-border)', color: on ? 'var(--color-primary)' : 'var(--color-muted)', background: 'transparent' }}
                  >{t}</button>
                );
              })}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <select className={FIELD} style={FIELD_STYLE} aria-label="Ask which resolver" value={resolver} onChange={(e) => setResolver(e.target.value)}>
                {RESOLVERS.map((r) => <option key={r.id} value={r.id}>Ask {r.label}</option>)}
              </select>
              <button type="button" onClick={lookUp} disabled={busy || !name.trim() || types.length === 0} className={buttonClass} style={{ background: 'var(--color-primary)', color: '#fff' }}>
                {getIcon('search', { size: 14 })}{busy ? 'Looking…' : 'Look up'}
              </button>
              <button
                type="button" onClick={compareBoth} disabled={busy || !name.trim() || types.length === 0} data-tour="dns-compare"
                title="Ask Cloudflare and Google the same question and see whether they agree. Use it after changing a record."
                className={`${buttonClass} border`} style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
              >
                Compare both
              </button>
            </div>
          </div>
          {error && <p className="text-sm" style={{ color: LEVEL.bad }}>{error}</p>}

          {answer && (
            <div className="space-y-2">
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {answer.compare ? 'Cloudflare and Google compared for ' : `Answer from ${RESOLVERS.find((r) => r.id === answer.resolver)?.label} for `}
                <strong style={{ color: 'var(--color-text)' }}>{answer.name || answer.ip}</strong>
              </p>
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

        <div className="rounded-2xl border p-6 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }} data-guide="email-check" data-tour="dns-email">
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Check email setup</h2>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className={`${FIELD} flex-1`} style={FIELD_STYLE} placeholder="Domain (e.g. example.com)"
              aria-label="Domain to check email setup for" value={emailName} maxLength={300} autoCapitalize="none" spellCheck={false}
              onChange={(e) => setEmailName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && checkEmail()}
            />
            <button type="button" onClick={checkEmail} disabled={emailBusy || !emailName.trim()} className={buttonClass} style={{ background: 'var(--color-primary)', color: '#fff' }}>
              {getIcon('mail', { size: 14 })}{emailBusy ? 'Checking…' : 'Check email setup'}
            </button>
          </div>
          {emailError && <p className="text-sm" style={{ color: LEVEL.bad }}>{emailError}</p>}
          {emailAnswer && (
            <div className="space-y-2">
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Findings for <strong style={{ color: 'var(--color-text)' }}>{emailAnswer.name}</strong>. This reads the records only; it cannot tell whether an email will really arrive.
              </p>
              {emailAnswer.findings.map((f) => (
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
      </div>

      {info.show && (
        <ToolInfoModal title="How DNS Lookup Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Find out what a domain name points to and check its email records. Not sure where to start? Press the round button at the bottom right and tell the guide what you want to know.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, text]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
            ))}
          </div>
        </ToolInfoModal>
      )}

      <DnsLookupTutorChat currentTool="lookup" onOpenTool={openToolById} />
    </div>
  );
}
