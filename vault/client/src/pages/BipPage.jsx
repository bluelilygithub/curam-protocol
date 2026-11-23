import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import { useIcon } from '../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import Tooltip from '../components/Tooltip';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { VoiceInput } from '../components/voiceInput/VoiceInput';
import { startBipTour, TOUR_KEY as BIP_TOUR_KEY } from '../utils/tours/bipTour';
import BipTutorChat from './bip/BipTutorChat';
import { HOW_IT_WORKS, TOOL_TIPS, TOOL_BLURBS, GROUP_TIPS, BIP_TOOLS } from './bip/bipTools.mjs';

const dateOf = (v) => (v ? new Date(v).toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const text = (v) => (v === null || v === undefined || v === '' ? 'Not found' : String(v));

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'That request did not work.');
  return data;
}

function ConfidenceBadge({ confidence }) {
  if (!confidence || confidence.level === 'none') return null;
  const color = confidence.level === 'confirmed' ? '#16a34a' : confidence.level === 'conflicting' ? '#ef4444' : '#f59e0b';
  return (
    <Tooltip text={confidence.label || ''}>
      <span className="shrink-0 text-xs px-1.5 py-0.5 rounded border" style={{ color, borderColor: color }}>
        {confidence.icon} {confidence.label}
      </span>
    </Tooltip>
  );
}

function Field({ label, value }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-3 py-1.5 border-b last:border-0" style={{ borderColor: 'var(--color-border)' }}>
      <span className="text-xs sm:w-44 shrink-0" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <span className="text-sm break-words" style={{ color: 'var(--color-text)' }}>{text(value)}</span>
    </div>
  );
}

function MultiField({ field, onDecide }) {
  if (!field || !field.values?.length) return <Field label={field?.label || 'Field'} value="Not found" />;
  return (
    <div className="py-2 border-b last:border-0" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{field.label}</span>
        <ConfidenceBadge confidence={field.confidence} />
        {field.decision && <span className="text-xs" style={{ color: 'var(--color-primary)' }}>Your decision: {field.decision}</span>}
      </div>
      <div className="space-y-1">
        {field.values.map((v, i) => (
          <div key={`${v.value}-${i}`} className="flex flex-wrap items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
            <span className="break-all">{v.value}</span>
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>— {v.source}</span>
            {v.url && <a href={v.url} target="_blank" rel="noreferrer" className="text-xs underline" style={{ color: 'var(--color-primary)' }}>source</a>}
            {field.confidence?.level === 'conflicting' && onDecide && (
              <Tooltip text="Keep this value as your decision. Other values stay visible.">
                <button type="button" onClick={() => onDecide(v.value)} className="text-xs underline" style={{ color: 'var(--color-primary)' }}>Choose this</button>
              </Tooltip>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Card({ title, icon, refreshModule, onRefresh, refreshing, children }) {
  const getIcon = useIcon();
  return (
    <section className="rounded-2xl border p-5" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          {icon && getIcon(icon, { size: 15 })} {title}
        </h3>
        {refreshModule && (
          <Tooltip text={TOOL_TIPS.refresh}>
            <button type="button" disabled={refreshing} aria-label={`Refresh ${title}`} onClick={() => onRefresh(refreshModule)}
              className="p-1 rounded-lg border hover:opacity-70 disabled:opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }} data-guide="refresh">
              {getIcon('refresh-cw', { size: 13 })}
            </button>
          </Tooltip>
        )}
      </div>
      {children}
    </section>
  );
}

function RatingLine({ label, item }) {
  if (!item) return <Field label={label} value="Not found" />;
  return (
    <div className="py-1.5 border-b last:border-0 flex flex-wrap items-center gap-2" style={{ borderColor: 'var(--color-border)' }}>
      <span className="text-xs sm:w-44 shrink-0" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <span className="text-sm" style={{ color: 'var(--color-text)' }}>
        {text(item.rating)}/5 · {text(item.reviewCount)} reviews · {item.source}
        {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="ml-2 underline" style={{ color: 'var(--color-primary)' }}>open listing</a>}
      </span>
    </div>
  );
}

function ProgressPanel({ job, onCancel }) {
  if (!job) return null;
  const p = job.progress || {};
  const pct = p.total ? Math.round(((p.current || 0) / p.total) * 100) : 0;
  return (
    <div className="rounded-2xl border p-4 space-y-2" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex justify-between text-sm" style={{ color: 'var(--color-text)' }}>
        <span>{job.status === 'done' ? 'Finished' : job.status === 'error' ? 'Failed' : `${job.label || 'Working'}…`}</span>
        <span>{job.elapsedSec}s</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-bg)' }}>
        <div className="h-full transition-all" style={{ width: `${job.status === 'done' ? 100 : pct}%`, background: 'var(--color-primary)' }} />
      </div>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        {job.status === 'error' ? job.error : p.module ? `Finishing ${p.module}…` : p.phase === 'seed' ? 'Reading registration, DNS and the website…' : p.phase || 'Starting…'}
      </p>
      {job.status === 'error' && onCancel && (
        <button type="button" onClick={onCancel} className="text-xs underline" style={{ color: 'var(--color-primary)' }}>Dismiss</button>
      )}
    </div>
  );
}

export default function BipPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const isAdmin = useAuthStore((s) => s.user?.isAdmin);
  const info = useToolInfoModal('vault_bip_info_seen');

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.bip !== false;

  const [domain, setDomain] = useState('');
  const [config, setConfig] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [profile, setProfile] = useState(null);
  const [job, setJob] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(null);
  const [error, setError] = useState('');
  const [currentTool, setCurrentTool] = useState(id ? 'profile' : 'search');

  const loadList = useCallback(async () => {
    const data = await json(await api.get('/api/bip/profiles'));
    setProfiles(data.profiles || []);
  }, []);

  const loadProfile = useCallback(async (profileId) => {
    const data = await json(await api.get(`/api/bip/profiles/${encodeURIComponent(profileId)}`));
    setProfile(data.profile || null);
    return data.profile;
  }, []);

  useEffect(() => {
    api.get('/api/settings/feature-access').then((r) => r.json()).then((d) => {
      if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!canUse) return;
    api.get('/api/bip/config').then(json).then(setConfig).catch(() => {});
    loadList().catch((err) => addToast(err.message, 'error'));
  }, [canUse, loadList, addToast]);

  useEffect(() => {
    if (!canUse || !id) return;
    loadProfile(id).catch((err) => setError(err.message));
  }, [canUse, id, loadProfile]);

  useEffect(() => {
    if (params.get('tour')) {
      const next = new URLSearchParams(params); next.delete('tour');
      setParams(next, { replace: true });
      setTimeout(startBipTour, 300);
    }
  }, [params, setParams]);

  const startTour = () => {
    try { localStorage.removeItem(BIP_TOUR_KEY); } catch (_) { /* ignore */ }
    startBipTour();
  };

  // Poll the background job every 2.5s, the same rhythm Video Tools uses.
  useEffect(() => {
    if (!jobId) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const data = await json(await api.get(`/api/bip/jobs/${encodeURIComponent(jobId)}`));
        if (!active) return;
        setJob(data.job);
        if (data.job?.status === 'done') {
          setJobId(null);
          setBusy(false);
          if (data.job.result?.profileId) {
            await loadProfile(data.job.result.profileId);
            await loadList();
            if (!id) navigate(`/bip/${data.job.result.profileId}`);
          } else {
            await loadList();
          }
        } else if (data.job?.status === 'error') {
          setJobId(null);
          setBusy(false);
          setError(data.job.error || 'The profile could not be finished.');
        }
      } catch (err) { if (active) { setJobId(null); setBusy(false); setError(err.message); } }
    };
    poll();
    const timer = setInterval(poll, 2500);
    return () => { active = false; clearInterval(timer); };
  }, [jobId, id, loadProfile, loadList, navigate]);

  const profileNow = async (force = false) => {
    const clean = domain.trim();
    if (!clean) { setError('Enter a domain name, for example saleslogs.com.'); return; }
    setBusy(true); setError('');
    try {
      const data = await json(await api.post('/api/bip/profiles', { domain: clean, force }));
      if (data.cached) {
        setBusy(false);
        setProfile(data.profile);
        setJob({ status: 'done', label: 'Loaded cached profile', progress: {}, elapsedSec: 0, result: { profileId: data.profile?.id } });
        navigate(`/bip/${data.profile.id}`);
      } else {
        setJobId(data.jobId);
        setJob({ status: 'running', label: `Profiling ${data.domain}`, progress: { phase: 'queued', current: 0, total: 1 }, elapsedSec: 0 });
      }
    } catch (err) { setBusy(false); setError(err.message); }
  };

  const rescan = async (modules = null) => {
    if (!profile) return;
    setRefreshing(modules ? modules[0] : 'all');
    setError('');
    try {
      const data = await json(await api.post(`/api/bip/profiles/${profile.id}/rescan`, { modules }));
      setJobId(data.jobId);
    } catch (err) { setError(err.message); }
    finally { setRefreshing(null); }
  };

  const decide = async (fieldKey, value) => {
    if (!profile) return;
    const decisions = { ...(profile.decisions || {}), [fieldKey]: value };
    try {
      await json(await api.patch(`/api/bip/profiles/${profile.id}`, { decisions }));
      setProfile((p) => ({ ...p, decisions, reconciliation: { ...p.reconciliation, fields: { ...p.reconciliation?.fields, [fieldKey]: { ...p.reconciliation?.fields?.[fieldKey], decision: value } } } }));
      addToast('Your decision was saved. The original values are unchanged.', 'success');
    } catch (err) { addToast(err.message, 'error'); }
  };

  const remove = async () => {
    const target = profile || null;
    if (!target || !window.confirm(`Delete the profile for ${target.domain}? It will go to the recycle bin for 30 days.`)) return;
    try {
      await json(await api.delete(`/api/bip/profiles/${target.id}`));
      addToast('Profile moved to the recycle bin.', 'success');
      navigate('/bip');
      loadList().catch(() => {});
    } catch (err) { addToast(err.message, 'error'); }
  };

  const downloadPdf = async () => {
    if (!profile) return;
    try { await api.download(`/api/bip/profiles/${profile.id}/pdf`, `${profile.domain}-business-profile.pdf`); }
    catch (err) { addToast(err.message, 'error'); }
  };

  const openTool = (toolId) => {
    const el = document.querySelector(`[data-guide="${toolId}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else navigate('/bip');
  };

  const menu = useMemo(() => BIP_TOOLS.map((t) => ({ ...t, tip: TOOL_TIPS[t.id] || TOOL_BLURBS[t.id] })), []);

  if (!canUse) return <Navigate to="/" replace />;

  const button = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity disabled:opacity-40';
  const FIELD = 'px-3 py-2.5 rounded-xl border text-sm outline-none';
  const FIELD_STYLE = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

  const header = (
    <div>
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Business Profiler</h1>
        <Tooltip text={TOOL_TIPS.search}><button type="button" aria-label="How Business Profiler works" onClick={info.open} className="opacity-60 hover:opacity-100" style={{ color: 'var(--color-muted)' }}>{getIcon('info', { size: 16 })}</button></Tooltip>
        <Tooltip text="Take the guided tour of Business Profiler"><button type="button" aria-label="Take the guided tour of Business Profiler" onClick={startTour} className="opacity-60 hover:opacity-100" style={{ color: 'var(--color-muted)' }}>{getIcon('compass', { size: 16 })}</button></Tooltip>
      </div>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
        Build a saved company profile from a domain, using public registration, DNS, the website and the sources this server has set up.
      </p>
    </div>
  );

  const listView = (
    <>
      <section className="rounded-2xl border p-6 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }} data-guide="search" data-tour="bip-search">
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Profile a domain</h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1">
            <Tooltip text="Type a domain such as saleslogs.com. A web address or email address is reduced to its domain.">
              <div>
                <VoiceInput value={domain} onChange={setDomain} label="Domain to profile" placeholder="Domain, e.g. saleslogs.com" mic />
              </div>
            </Tooltip>
          </div>
          <Tooltip text={TOOL_TIPS.search}>
            <button type="button" className={button} disabled={busy || !!jobId} onClick={() => profileNow(false)} style={{ background: 'var(--color-primary)', color: '#fff' }} data-guide="search">
              {getIcon('search', { size: 14 })} {busy ? 'Profiling…' : 'Profile'}
            </button>
          </Tooltip>
        </div>
        {config && !config.configured.abr && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>ABR_GUID is not set here, so ABN details will be skipped. Other sources still run.</p>}
        {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}
        {(job || jobId) && <ProgressPanel job={job} onCancel={() => { setJob(null); setJobId(null); setBusy(false); }} />}
      </section>

      <section className="space-y-3" data-guide="profiles" data-tour="bip-profiles">
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Saved profiles</h2>
        {profiles.length === 0 && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No profiles yet. Profile a domain above to make the first one.</p>}
        {profiles.map((p) => (
          <div key={p.id} className="rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <div>
              <Link to={`/bip/${p.id}`} className="text-sm font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>{p.businessName || p.domain}</Link>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{p.domain} · profiled {dateOf(p.scannedAt || p.createdAt)} · {p.moduleCount || 0} modules · {p.status}</p>
            </div>
            <div className="flex items-center gap-2">
              <Tooltip text="Open the full profile."><Link to={`/bip/${p.id}`} className={button} style={{ border: '1px solid var(--color-border)', color: 'var(--color-primary)' }}>Open</Link></Tooltip>
              <Tooltip text="Re-profile this domain, ignoring the 30-day cache."><button type="button" className={button} style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }} onClick={() => { setDomain(p.domain); profileNow(true); }}>Re-scan</button></Tooltip>
            </div>
          </div>
        ))}
      </section>
    </>
  );

  const f = profile?.reconciliation?.fields || {};
  const c = profile?.cards || {};
  const sources = profile?.sources || [];

  const detailView = profile ? (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip text="Back to the saved profile list."><Link to="/bip" className={button} style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>← All profiles</Link></Tooltip>
        <Tooltip text={TOOL_TIPS.refresh}><button type="button" className={button} disabled={busy || !!jobId} onClick={() => rescan(null)} style={{ border: '1px solid var(--color-border)', color: 'var(--color-primary)' }}>{getIcon('refresh-cw', { size: 14 })} Re-scan</button></Tooltip>
        <Tooltip text={TOOL_TIPS.export}><button type="button" className={button} onClick={downloadPdf} style={{ background: 'var(--color-primary)', color: '#fff' }} data-guide="export">{getIcon('download', { size: 14 })} Download PDF</button></Tooltip>
        <Tooltip text="Move this profile to the recycle bin."><button type="button" className={button} onClick={remove} style={{ border: '1px solid var(--color-border)', color: '#ef4444' }}>{getIcon('trash', { size: 14 })} Delete</button></Tooltip>
      </div>
      {(job || jobId) && <ProgressPanel job={job} onCancel={() => { setJob(null); setJobId(null); }} />}
      {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}

      <section className="rounded-2xl border p-4 space-y-1" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }} data-guide="conflicts" data-tour="bip-review">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Confidence & conflicts</h2>
          <ConfidenceBadge confidence={{ level: 'confirmed', icon: '✅', label: '2+ sources agree' }} />
          <ConfidenceBadge confidence={{ level: 'single', icon: '⚠️', label: 'One source only' }} />
          <ConfidenceBadge confidence={{ level: 'conflicting', icon: '❌', label: 'Sources disagree' }} />
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          BIP keeps every value and never picks a winner. Conflicts: {(profile.reconciliation?.conflicts || []).join(', ') || 'none'}.
        </p>
        <div className="grid sm:grid-cols-2 gap-x-6">
          {['businessName', 'abn', 'address', 'phone'].map((key) => (
            <MultiField key={key} label={{ businessName: 'Business name', abn: 'ABN', address: 'Address', phone: 'Phone' }[key]}
              field={f[key] ? { ...f[key], label: { businessName: 'Business name', abn: 'ABN', address: 'Address', phone: 'Phone' }[key] } : null}
              onDecide={(value) => decide(key, value)} />
          ))}
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-5" data-guide="profile" data-tour="bip-cards">
        <Card title="Entity Overview" icon="building" refreshModule={['abr', 'registration']} onRefresh={rescan} refreshing={refreshing === 'abr'}>
          <Field label="Business name" value={c.entity?.businessName} />
          <Field label="ABN" value={c.entity?.abn} />
          <Field label="Entity type" value={c.entity?.entityType} />
          <Field label="GST status" value={c.entity?.gstStatus} />
          <Field label="Trading names" value={c.entity?.tradingNames?.join(', ')} />
          <Field label="Domain" value={c.entity?.domain} />
          <Field label="Domain age" value={c.entity?.domainAgeYears == null ? 'Not found' : `${c.entity.domainAgeYears} years`} />
          <Field label="Registered" value={c.entity?.registrationDate} />
          <Field label="Expires" value={c.entity?.expiryDate} />
          <Field label="Company status" value={c.entity?.companyStatus} />
        </Card>

        <Card title="People" icon="user" refreshModule={['asic']} onRefresh={rescan} refreshing={refreshing === 'asic'}>
          {c.people?.length ? c.people.map((p, i) => <div key={i} className="py-2 border-b last:border-0" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>{text(p.name)} <span className="text-xs" style={{ color: 'var(--color-muted)' }}>— {text(p.role)}</span></p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{p.source}</p>
          </div>) : <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No people were named in the public sources checked.</p>}
        </Card>

        <Card title="Locations" icon="globe" refreshModule={['places']} onRefresh={rescan} refreshing={refreshing === 'places'}>
          {c.locations?.length ? c.locations.map((v, i) => (
            <div key={i} className="flex flex-wrap items-start gap-2 py-2 border-b last:border-0" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm flex-1" style={{ color: 'var(--color-text)' }}>{v.value}</span>
              <ConfidenceBadge confidence={v.confidence} />
              <span className="text-xs w-full" style={{ color: 'var(--color-muted)' }}>{v.source}</span>
            </div>
          )) : <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No addresses found.</p>}
        </Card>

        <Card title="Products & Services" icon="briefcase" refreshModule={['website']} onRefresh={(name) => rescan([name])} refreshing={refreshing === 'website'}>
          <Field label="Description" value={c.products?.description} />
          <Field label="Industry hints" value={c.products?.industryHints?.join(', ')} />
          <Field label="Keywords" value={c.products?.keywords?.slice(0, 12)?.join(', ')} />
          {c.products?.sitemapUrls?.length > 0 && <div className="mt-2 space-y-1">
            {c.products.sitemapUrls.slice(0, 5).map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="block text-xs underline truncate" style={{ color: 'var(--color-primary)' }}>{u}</a>)}
          </div>}
        </Card>

        <Card title="Digital Footprint" icon="radar" refreshModule={['techStack']} onRefresh={rescan} refreshing={refreshing === 'techStack'}>
          <Field label="Email provider" value={c.digital?.emailProvider?.join(', ')} />
          <Field label="Hosting" value={c.digital?.hosting?.join(', ')} />
          <Field label="CDN" value={c.digital?.cdn?.join(', ')} />
          <Field label="Analytics" value={c.digital?.analytics?.join(', ')} />
          <Field label="CRM / marketing" value={c.digital?.crmMarketing?.join(', ')} />
          <div className="mt-2">
            <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Social links</p>
            {c.digital?.socialLinks?.length ? c.digital.socialLinks.map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noreferrer" className="block text-xs underline truncate" style={{ color: 'var(--color-primary)' }}>{s.network}: {s.url}</a>
            )) : <p className="text-xs" style={{ color: 'var(--color-muted)' }}>None found.</p>}
          </div>
          <div className="mt-2">
            <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Third-party services from DNS</p>
            <p className="text-xs" style={{ color: 'var(--color-text)' }}>{c.digital?.thirdPartyServices?.map((s) => s.name).join(', ') || 'None found.'}</p>
          </div>
        </Card>

        <Card title="Online Presence & Reputation" icon="star" refreshModule={['googleSearch']} onRefresh={rescan} refreshing={refreshing === 'googleSearch'}>
          <RatingLine label="Google Places" item={c.reputation?.googlePlaces} />
          <RatingLine label="ProductReview" item={c.reputation?.productReview} />
          <RatingLine label="Trustpilot" item={c.reputation?.trustpilot} />
          <p className="text-xs mt-3 mb-1" style={{ color: 'var(--color-muted)' }}>Top Google mentions</p>
          {c.reputation?.mentions?.length ? c.reputation.mentions.map((m, i) => (
            <a key={i} href={m.url} target="_blank" rel="noreferrer" className="block text-xs py-1 underline" style={{ color: 'var(--color-primary)' }}>{text(m.title)}</a>
          )) : <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No search mentions found.</p>}
        </Card>

        <Card title="Financial Indicators" icon="line-chart">
          <p className="text-xs mb-2" style={{ color: 'var(--color-primary)' }}>estimates from public sources</p>
          <Field label="Employee count" value={c.financial?.employeeCount} />
          <Field label="Years in business" value={c.financial?.yearsInBusiness} />
          <Field label="Revenue estimate" value={c.financial?.revenueEstimate} />
          <Field label="Funding status" value={c.financial?.fundingStatus} />
          <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>{c.financial?.note}</p>
        </Card>
      </div>

      <section className="rounded-2xl border p-5" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Sources & status</h3>
        <div className="grid sm:grid-cols-2 gap-2">
          {sources.map((s) => (
            <div key={s.name} className="rounded-lg border p-2 text-xs" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              <span className="font-medium">{s.name}</span> · {s.status}
              {s.reason && <span style={{ color: 'var(--color-muted)' }}> — {s.reason}</span>}
              {s.error && <span style={{ color: '#ef4444' }}> — {s.error}</span>}
            </div>
          ))}
          {!sources.length && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No source rows saved.</p>}
        </div>
      </section>
    </div>
  ) : (
    <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{error || 'Loading profile…'}</p>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
      <div className="w-full max-w-5xl mx-auto space-y-5">
        {header}
        {id ? detailView : listView}
      </div>

      {info.show && (
        <ToolInfoModal title="How Business Profiler works" onClose={info.close}>
          {HOW_IT_WORKS.map(([title, body]) => (
            <div key={title}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>{body}</p>
            </div>
          ))}
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Tools on this page</h3>
            <div className="grid sm:grid-cols-2 gap-2">
              {menu.map((t) => (
                <div key={t.id} className="rounded-lg border p-2" style={{ borderColor: 'var(--color-border)' }}>
                  <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{t.label}</p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{t.tip}</p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{GROUP_TIPS[t.group]}</p>
                </div>
              ))}
            </div>
          </div>
        </ToolInfoModal>
      )}

      <BipTutorChat currentTool={currentTool} onOpenTool={openTool} />
    </div>
  );
}
