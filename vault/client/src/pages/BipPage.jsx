import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import { useIcon } from '../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import Tooltip from '../components/Tooltip';
import ToolSidebar from '../components/ToolSidebar';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { JobStart, JobBar, BackToJobs, stepIndex } from '../components/JobStart';
import { VoiceInput, VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import { startBipTour, TOUR_KEY as BIP_TOUR_KEY } from '../utils/tours/bipTour';
import BipTutorChat from './bip/BipTutorChat';
import BipLinks from './bip/BipLinks';
import { BIP_GOALS } from './bip/bipGoals.mjs';
import { HOW_IT_WORKS, TOOL_TIPS, TOOL_BLURBS, GROUPS, GROUP_TIPS, BIP_TOOLS, GUIDE_TOOLS } from './bip/bipTools.mjs';

/**
 * Business Profiler, laid out like Video Tools: the tool list on the left (ToolSidebar), the "What do you want to do?" job tiles plus
 * recent profiles on the start screen (JobStart, jobs in bip/bipGoals.mjs), and one tool at a time in the main area. /bip/:id opens a
 * saved profile; the Report and Keep & share tools work on that open profile. See docs/bip.md.
 */

const dateOf = (v) => (v ? new Date(v).toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const text = (v) => (v === null || v === undefined || v === '' ? 'Not found' : String(v));
const OPEN_ON_LAST_KEY = 'vault:bip:openOnLast';
const LAST_TOOL_KEY = 'vault:bip:lastTool';
const readLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };
const TOOL_IDS = BIP_TOOLS.map((t) => t.id);
const needsProfile = (id) => !!BIP_TOOLS.find((t) => t.id === id)?.needsProfile;
const labelFor = (id) => BIP_TOOLS.find((t) => t.id === id)?.label || id;
const MODULE_LABELS = {
  registration: 'Domain registration (RDAP / WHOIS)', dns: 'DNS records', website: 'Website pages', domainsTool: 'Domain tool overview',
  abr: 'ABN Lookup (ABR)', asic: 'ASIC Connect', places: 'Google Places', googleSearch: 'Google search', socialLinks: 'Social links',
  productReview: 'ProductReview.com.au', trustpilot: 'Trustpilot', techStack: 'Tech stack',
};

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
              className="p-1 rounded-lg border hover:opacity-70 disabled:opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>
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
        {job.status === 'error' ? job.error : p.module ? `Finishing ${MODULE_LABELS[p.module] || p.module}…` : p.phase === 'seed' ? 'Reading registration, DNS and the website…' : p.phase || 'Starting…'}
      </p>
      {job.status === 'error' && onCancel && (
        <button type="button" onClick={onCancel} className="text-xs underline" style={{ color: 'var(--color-primary)' }}>Dismiss</button>
      )}
    </div>
  );
}

/** One tile per profile, used on the start screen (recent) and in Saved profiles (all). */
function ProfileTiles({ profiles, onOpen, current }) {
  const getIcon = useIcon();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {profiles.map((p) => (
        <Tooltip key={p.id} text={`Open the profile for ${p.domain}.`}>
          <button type="button" onClick={() => onOpen(p.id)} className="text-left rounded-2xl border p-4 transition-opacity hover:opacity-70"
            style={{ borderColor: String(current) === String(p.id) ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-surface)' }}>
            <span className="flex items-center gap-2 mb-1" style={{ color: 'var(--color-primary)' }}>
              {getIcon('building', { size: 15 })}
              <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{p.businessName || p.domain}</span>
            </span>
            <span className="block text-xs truncate" style={{ color: 'var(--color-muted)' }}>{p.domain}</span>
            <span className="block text-[11px] mt-2" style={{ color: p.status === 'failed' ? '#ef4444' : 'var(--color-muted)' }}>
              {p.status === 'done' ? `Profiled ${dateOf(p.scannedAt || p.createdAt)} · ${p.moduleCount || 0} sources` : p.status === 'running' ? 'Not finished — open it and Re-scan' : 'Failed — open it and Re-scan'}
            </span>
          </button>
        </Tooltip>
      ))}
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
  const [openOnLast, setOpenOnLast] = useState(() => readLocal(OPEN_ON_LAST_KEY) === '1');
  // 'start' is the job-tile screen (not a tool); every other value is a tool id from BIP_TOOLS
  const [tool, setTool] = useState(() => {
    if (id) return 'profile';
    const last = readLocal(LAST_TOOL_KEY);
    return readLocal(OPEN_ON_LAST_KEY) === '1' && TOOL_IDS.includes(last) && !needsProfile(last) ? last : 'start';
  });
  const [goal, setGoal] = useState(null);

  useEffect(() => { if (tool !== 'start') writeLocal(LAST_TOOL_KEY, tool); }, [tool]);
  const toggleOpenOnLast = (on) => { setOpenOnLast(on); writeLocal(OPEN_ON_LAST_KEY, on ? '1' : '0'); };

  // the next step of the job under way after `from`, or null (used when a step finishes by itself: a profile made or opened)
  const nextStep = useCallback((from) => {
    if (!goal) return null;
    const i = stepIndex(goal, from);
    return i >= 0 && goal.steps[i + 1] ? goal.steps[i + 1].tool : null;
  }, [goal]);

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
    if (!canUse) return;
    if (!id) { setProfile(null); return; }
    setError('');
    loadProfile(id).catch((err) => setError(err.message));
  }, [canUse, id, loadProfile]);

  // Opening a profile (a tile, the list, a finished run) goes to /bip/:id, then on to the job's next step or the cards.
  const openProfile = useCallback((profileId, from = 'profiles') => {
    navigate(`/bip/${profileId}`);
    setTool(nextStep(from) || 'profile');
  }, [navigate, nextStep]);

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
          setRefreshing(null);
          const pid = data.job.result?.profileId;
          await loadList();
          if (pid) {
            await loadProfile(pid);
            if (String(pid) !== String(id)) openProfile(pid, 'search');
          }
        } else if (data.job?.status === 'error') {
          setJobId(null);
          setBusy(false);
          setRefreshing(null);
          setError(data.job.error || 'The profile could not be finished.');
          loadList().catch(() => {});
        }
      } catch (err) { if (active) { setJobId(null); setBusy(false); setRefreshing(null); setError(err.message); } }
    };
    poll();
    const timer = setInterval(poll, 2500);
    return () => { active = false; clearInterval(timer); };
  }, [jobId, id, loadProfile, loadList, openProfile]);

  const profileNow = async (force = false, target = domain) => {
    const clean = String(target || '').trim();
    if (!clean) { setError('Enter a domain name, for example saleslogs.com.'); return; }
    setBusy(true); setError('');
    try {
      const data = await json(await api.post('/api/bip/profiles', { domain: clean, force }));
      if (data.cached) {
        setBusy(false);
        setProfile(data.profile);
        addToast(`Opened the saved profile for ${data.profile.domain} (checked in the last 30 days). Use Re-scan for fresh data.`, 'success');
        openProfile(data.profile.id, 'search');
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
      setJob({ status: 'running', label: modules ? `Refreshing ${modules.map((m) => MODULE_LABELS[m] || m).join(', ')}` : `Re-scanning ${profile.domain}`, progress: { phase: 'queued' }, elapsedSec: 0 });
    } catch (err) { setError(err.message); setRefreshing(null); }
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
    if (!profile || !window.confirm(`Delete the profile for ${profile.domain}? It will go to the recycle bin for 30 days.`)) return;
    try {
      await json(await api.delete(`/api/bip/profiles/${profile.id}`));
      addToast('Profile moved to the recycle bin.', 'success');
      navigate('/bip');
      setTool('profiles');
      loadList().catch(() => {});
    } catch (err) { addToast(err.message, 'error'); }
  };

  const downloadPdf = async () => {
    if (!profile) return;
    try { await api.download(`/api/bip/profiles/${profile.id}/pdf`, `${profile.domain}-business-profile.pdf`); }
    catch (err) { addToast(err.message, 'error'); }
  };

  const startGoal = (g) => { setGoal(g); setTool(g.steps[0].tool); };
  const backToStart = () => { setGoal(null); setTool('start'); };
  const goTool = useCallback((toolId) => { if (toolId === 'start') { setGoal(null); setTool('start'); } else setTool(toolId); }, []);

  const startTour = useCallback(() => {
    info.close();
    try { localStorage.removeItem(BIP_TOUR_KEY); } catch (_) { /* ignore */ }
    startBipTour(goTool);
  }, [goTool, info]);

  // Settings -> Business Profiler tour opens /bip?tour=1
  useEffect(() => {
    if (!params.get('tour')) return;
    const next = new URLSearchParams(params); next.delete('tour');
    setParams(next, { replace: true });
    setTimeout(startTour, 300);
  }, [params, setParams, startTour]);

  // the guide's Open buttons switch to that tool
  const openGuideTool = (toolId) => { const t = GUIDE_TOOLS.find((g) => g.id === toolId); if (t) setTool(t.tool); };

  const menu = useMemo(() => GROUPS.map((label) => ({
    label,
    tip: GROUP_TIPS[label],
    tools: BIP_TOOLS.filter((t) => t.group === label).map((t) => ({
      ...t, tip: TOOL_TIPS[t.id], hint: t.needsProfile && !profile ? 'Open a profile first' : undefined,
    })),
  })), [profile]);

  if (!canUse) return <Navigate to="/" replace />;

  const button = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity disabled:opacity-40';
  const outline = { border: '1px solid var(--color-border)', color: 'var(--color-text)' };
  const primary = { background: 'var(--color-primary)', color: '#fff' };
  const panel = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
  const muted = { color: 'var(--color-muted)' };

  const f = profile?.reconciliation?.fields || {};
  const c = profile?.cards || {};
  const sources = profile?.sources || [];
  const missingKeys = config ? [
    !config.configured?.abr && 'ABN Lookup (ABR_GUID)',
    !config.configured?.places && 'Google Places (GOOGLE_PLACES_API_KEY)',
    !config.configured?.googleSearch && 'Google search (GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX)',
  ].filter(Boolean) : [];

  // ── tools ────────────────────────────────────────────────────────────────
  const searchTool = (
    <section className="rounded-2xl border p-6 space-y-4" style={panel} data-tour="bip-search">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <Tooltip text="Type a domain such as saleslogs.com. A web address or email address is reduced to its domain.">
            <div><VoiceInput value={domain} onChange={setDomain} label="Domain to profile" placeholder="Domain, e.g. saleslogs.com" mic /></div>
          </Tooltip>
        </div>
        <Tooltip text={TOOL_TIPS.search}>
          <button type="button" className={button} disabled={busy || !!jobId} onClick={() => profileNow(false)} style={primary}>
            {getIcon('search', { size: 14 })} {busy ? 'Profiling…' : 'Profile'}
          </button>
        </Tooltip>
      </div>
      {missingKeys.length > 0 && (
        <p className="text-xs" style={muted}>Not set up on this server, so skipped: {missingKeys.join('; ')}. Registration, DNS, the website, social links, review sites and tech stack still run.</p>
      )}
      {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}
      {(job || jobId) && <ProgressPanel job={job} onCancel={() => { setJob(null); setJobId(null); setBusy(false); }} />}
    </section>
  );

  const profilesTool = (
    <section className="space-y-3" data-tour="bip-profiles">
      {profiles.length === 0
        ? <p className="text-sm" style={muted}>No profiles yet. Use Profile a domain to make the first one.</p>
        : <ProfileTiles profiles={profiles} onOpen={(pid) => openProfile(pid, 'profiles')} current={id} />}
    </section>
  );

  const profileTool = profile && (
    <div className="grid lg:grid-cols-2 gap-5" data-tour="bip-cards">
      <Card title="Entity Overview" icon="building" refreshModule={['abr', 'registration']} onRefresh={rescan} refreshing={!!refreshing}>
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

      <Card title="People" icon="user" refreshModule={['asic']} onRefresh={rescan} refreshing={!!refreshing}>
        {c.people?.length ? c.people.map((p, i) => <div key={i} className="py-2 border-b last:border-0" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>{text(p.name)} <span className="text-xs" style={muted}>— {text(p.role)}</span></p>
          <p className="text-xs" style={muted}>{p.source}</p>
        </div>) : <p className="text-sm" style={muted}>No people were named in the public sources checked.</p>}
      </Card>

      <Card title="Locations" icon="globe" refreshModule={['places']} onRefresh={rescan} refreshing={!!refreshing}>
        {c.locations?.length ? c.locations.map((v, i) => (
          <div key={i} className="flex flex-wrap items-start gap-2 py-2 border-b last:border-0" style={{ borderColor: 'var(--color-border)' }}>
            <span className="text-sm flex-1" style={{ color: 'var(--color-text)' }}>{v.value}</span>
            <ConfidenceBadge confidence={v.confidence} />
            <span className="text-xs w-full" style={muted}>{v.source}</span>
          </div>
        )) : <p className="text-sm" style={muted}>No addresses found.</p>}
      </Card>

      <Card title="Products & Services" icon="briefcase" refreshModule={['website']} onRefresh={rescan} refreshing={!!refreshing}>
        <Field label="Description" value={c.products?.description} />
        <Field label="Industry hints" value={c.products?.industryHints?.join(', ')} />
        <Field label="Keywords" value={c.products?.keywords?.slice(0, 12)?.join(', ')} />
        {c.products?.sitemapUrls?.length > 0 && <div className="mt-2 space-y-1">
          <p className="text-xs" style={muted}>Pages listed in the sitemap</p>
          {c.products.sitemapUrls.slice(0, 5).map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="block text-xs underline truncate" style={{ color: 'var(--color-primary)' }}>{u}</a>)}
        </div>}
      </Card>

      <Card title="Digital Footprint" icon="radar" refreshModule={['techStack']} onRefresh={rescan} refreshing={!!refreshing}>
        <Field label="Email provider" value={c.digital?.emailProvider?.join(', ')} />
        <Field label="Hosting" value={c.digital?.hosting?.join(', ')} />
        <Field label="CDN" value={c.digital?.cdn?.join(', ')} />
        <Field label="Analytics" value={c.digital?.analytics?.join(', ')} />
        <Field label="CRM / marketing" value={c.digital?.crmMarketing?.join(', ')} />
        <div className="mt-2">
          <p className="text-xs mb-1" style={muted}>Social links</p>
          {c.digital?.socialLinks?.length ? c.digital.socialLinks.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noreferrer" className="block text-xs underline truncate" style={{ color: 'var(--color-primary)' }}>{s.network}: {s.url}</a>
          )) : <p className="text-xs" style={muted}>None found.</p>}
        </div>
        <div className="mt-2">
          <p className="text-xs mb-1" style={muted}>Third-party services from DNS</p>
          <p className="text-xs" style={{ color: 'var(--color-text)' }}>{c.digital?.thirdPartyServices?.map((s) => s.name).join(', ') || 'None found.'}</p>
        </div>
      </Card>

      <Card title="Online Presence & Reputation" icon="star" refreshModule={['googleSearch']} onRefresh={rescan} refreshing={!!refreshing}>
        <RatingLine label="Google Places" item={c.reputation?.googlePlaces} />
        <RatingLine label="ProductReview" item={c.reputation?.productReview} />
        <RatingLine label="Trustpilot" item={c.reputation?.trustpilot} />
        <p className="text-xs mt-3 mb-1" style={muted}>Top Google mentions</p>
        {c.reputation?.mentions?.length ? c.reputation.mentions.map((m, i) => (
          <a key={i} href={m.url} target="_blank" rel="noreferrer" className="block text-xs py-1 underline" style={{ color: 'var(--color-primary)' }}>{text(m.title)}</a>
        )) : <p className="text-xs" style={muted}>No search mentions found.</p>}
      </Card>

      <Card title="Financial Indicators" icon="line-chart">
        <p className="text-xs mb-2" style={{ color: 'var(--color-primary)' }}>estimates from public sources</p>
        <Field label="Employee count" value={c.financial?.employeeCount} />
        <Field label="Years in business" value={c.financial?.yearsInBusiness == null ? null : `${c.financial.yearsInBusiness}${c.financial.yearsInBusinessBasis ? ` (${c.financial.yearsInBusinessBasis})` : ''}`} />
        <Field label="Revenue estimate" value={c.financial?.revenueEstimate} />
        <Field label="Funding status" value={c.financial?.fundingStatus} />
        <p className="text-xs mt-2" style={muted}>{c.financial?.note}</p>
      </Card>
    </div>
  );

  const fieldLabels = { businessName: 'Business name', abn: 'ABN', address: 'Address', phone: 'Phone' };
  const conflictsTool = profile && (
    <section className="rounded-2xl border p-5 space-y-1" style={panel} data-tour="bip-review">
      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceBadge confidence={{ level: 'confirmed', icon: '✅', label: '2+ sources agree' }} />
        <ConfidenceBadge confidence={{ level: 'single', icon: '⚠️', label: 'One source only' }} />
        <ConfidenceBadge confidence={{ level: 'conflicting', icon: '❌', label: 'Sources disagree' }} />
      </div>
      <p className="text-xs" style={muted}>Conflicts: {(profile.reconciliation?.conflicts || []).map((k) => fieldLabels[k] || k).join(', ') || 'none'}.</p>
      <div className="grid sm:grid-cols-2 gap-x-6">
        {Object.keys(fieldLabels).map((key) => (
          <MultiField key={key} field={f[key] ? { ...f[key], label: fieldLabels[key] } : { label: fieldLabels[key] }} onDecide={(value) => decide(key, value)} />
        ))}
      </div>
    </section>
  );

  const refreshTool = profile && (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip text="Run every source again, ignoring the 30-day cache.">
          <button type="button" className={button} disabled={busy || !!jobId} onClick={() => rescan(null)} style={primary}>{getIcon('refresh-cw', { size: 14 })} Re-scan everything</button>
        </Tooltip>
        <span className="text-xs" style={muted}>Last checked {dateOf(profile.scannedAt || profile.updatedAt)}.</span>
      </div>
      {(job || jobId) && <ProgressPanel job={job} onCancel={() => { setJob(null); setJobId(null); }} />}
      {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        {sources.map((s) => (
          <div key={s.name} className="rounded-xl border p-3 text-xs space-y-1" style={panel}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>{MODULE_LABELS[s.name] || s.name}</span>
              <Tooltip text={`Run ${MODULE_LABELS[s.name] || s.name} again; the rest of the profile is kept.`}>
                <button type="button" className="underline disabled:opacity-40" disabled={busy || !!jobId} onClick={() => rescan([s.name])} style={{ color: 'var(--color-primary)' }}>Refresh</button>
              </Tooltip>
            </div>
            <p style={{ color: s.status === 'success' ? '#16a34a' : s.status === 'failed' ? '#ef4444' : 'var(--color-muted)' }}>
              {s.status}{s.reason ? ` — ${s.reason}` : ''}{s.error ? ` — ${s.error}` : ''}
            </p>
            <p style={muted}>Checked {dateOf(s.checkedAt)}</p>
          </div>
        ))}
        {!sources.length && <p className="text-xs" style={muted}>No source rows saved.</p>}
      </div>
    </div>
  );

  const exportTool = profile && (
    <section className="rounded-2xl border p-6 space-y-3" style={panel}>
      <p className="text-sm" style={{ color: 'var(--color-text)' }}>A PDF of the saved profile: every card, the sources and the confidence labels. No new lookups are made.</p>
      <Tooltip text={TOOL_TIPS.export}>
        <button type="button" className={button} onClick={downloadPdf} disabled={profile.status !== 'done'} style={primary}>{getIcon('download', { size: 14 })} Download PDF</button>
      </Tooltip>
      {profile.status !== 'done' && <p className="text-xs" style={muted}>Available once the profile has finished. Re-scan it from Re-scan & sources.</p>}
    </section>
  );

  const saveTool = profile && <BipLinks profile={profile} onClientChanged={(clientId, clientName) => setProfile((p) => ({ ...p, clientId, clientName }))} />;

  const TOOLS = { search: searchTool, profiles: profilesTool, profile: profileTool, conflicts: conflictsTool, refresh: refreshTool, export: exportTool, save: saveTool };

  // the open profile, above every tool that works on it
  const profileBar = profile && needsProfile(tool) && (
    <div className="rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-3" style={panel}>
      <div className="min-w-0">
        <p className="text-base font-semibold truncate" style={{ color: 'var(--color-text)' }}>{profile.businessName || profile.domain}</p>
        <p className="text-xs" style={muted}>
          {profile.domain} · {profile.status === 'done' ? `profiled ${dateOf(profile.scannedAt)}` : profile.status}
          {profile.clientName ? ` · client: ${profile.clientName}` : ''}
        </p>
      </div>
      <Tooltip text="Move this profile to the recycle bin.">
        <button type="button" className={button} onClick={remove} style={{ ...outline, color: '#ef4444' }}>{getIcon('trash', { size: 14 })} Delete</button>
      </Tooltip>
    </div>
  );

  const noProfile = needsProfile(tool) && !profile && (
    <section className="rounded-2xl border p-6 space-y-3" style={panel}>
      <p className="text-sm" style={{ color: 'var(--color-text)' }}>{id ? (error || 'Loading profile…') : 'Open a profile first: make a new one, or pick a saved one.'}</p>
      {!id && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={() => setTool('search')} style={primary}>{getIcon('search', { size: 14 })} Profile a domain</button>
          <button type="button" className={button} onClick={() => setTool('profiles')} style={outline}>{getIcon('list', { size: 14 })} Saved profiles</button>
        </div>
      )}
    </section>
  );

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
        <ToolSidebar
          title="Business Profiler"
          icon="building"
          groups={menu}
          current={tool}
          onSelect={(toolId) => setTool(toolId)}
          onInfo={info.open}
          infoTip="How Business Profiler works: the sources it reads, the confidence marks and what it cannot do."
          onTour={startTour}
          tourTip="Take the guided tour of Business Profiler."
        >
          <Tooltip text="Go back to the job tiles (check out a business, prepare for a meeting, add to the CRM and so on).">
            <button type="button" onClick={backToStart}
              className="w-full flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
              style={{ borderColor: tool === 'start' ? 'var(--color-primary)' : 'var(--color-border)', color: tool === 'start' ? 'var(--color-primary)' : 'var(--color-text)', background: 'var(--color-bg)' }}>
              {getIcon('layout-grid', { size: 13 })}
              What do you want to do?
            </button>
          </Tooltip>
        </ToolSidebar>

        <main className={`flex-1 min-w-0 overflow-y-auto p-6 space-y-4 ${tool === 'start' ? 'max-w-6xl' : 'max-w-5xl'}`} style={{ background: 'var(--color-bg)' }}>
          {tool === 'start' && (
            <>
              <JobStart
                goals={BIP_GOALS}
                appName="Business Profiler"
                tourId="bip-jobs"
                intro="Pick a job and Business Profiler opens the tools for it, one step at a time. Or choose a tool in the list on the left, or ask the guide (round button, bottom right)."
                onPick={startGoal}
                labelFor={labelFor}
                openOnLast={openOnLast}
                onToggleOpenOnLast={toggleOpenOnLast}
              />
              {profiles.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Recent profiles</h2>
                    {profiles.length > 6 && <button type="button" onClick={() => setTool('profiles')} className="text-sm underline" style={{ color: 'var(--color-primary)' }}>All {profiles.length} profiles</button>}
                  </div>
                  <ProfileTiles profiles={profiles.slice(0, 6)} onOpen={(pid) => openProfile(pid, 'profiles')} current={id} />
                </section>
              )}
              {(job || jobId) && <ProgressPanel job={job} onCancel={() => { setJob(null); setJobId(null); setBusy(false); }} />}
            </>
          )}
          {tool !== 'start' && (
            <div className="space-y-3">
              <BackToJobs onBack={backToStart} toolLabel={labelFor(tool)} goal={stepIndex(goal, tool) >= 0 ? goal : null} />
              <JobBar goal={goal} mode={tool} onStep={(toolId) => setTool(toolId)} labelFor={labelFor} carry="go to" />
              <p className="text-sm" style={muted}>{TOOL_BLURBS[tool]}</p>
            </div>
          )}
          {profileBar}
          {noProfile}
          {tool !== 'start' && !(needsProfile(tool) && !profile) && TOOLS[tool]}
        </main>
      </div>

      {info.show && (
        <ToolInfoModal title="How Business Profiler works" onClose={info.close}>
          {HOW_IT_WORKS.map(([title, body]) => (
            <div key={title}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h3>
              <p className="text-sm leading-relaxed" style={muted}>{body}</p>
            </div>
          ))}
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            The page opens on “What do you want to do?”. Pick a job tile and the tools open one step at a time, or open a recent profile. The list on the left has every tool; hover any of them for a plain explanation.
          </p>
        </ToolInfoModal>
      )}

      <BipTutorChat currentTool={tool === 'start' ? 'search' : tool} onOpenTool={openGuideTool} />
    </VoiceInputProvider>
  );
}
