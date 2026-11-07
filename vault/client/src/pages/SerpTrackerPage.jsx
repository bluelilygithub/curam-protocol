import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import Tooltip from '../components/Tooltip';
import EmptyState from '../components/EmptyState';
import Skeleton from '../components/Skeleton';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { profileToForm, formToProfile } from './serpTracker/profileForm.mjs';
import LookupPanel from './serpTracker/LookupPanel';
import KeywordsPanel from './serpTracker/KeywordsPanel';
import SiteForm from './serpTracker/SiteForm';
import SerpTrackerTutorChat from './serpTracker/SerpTrackerTutorChat';
import { SERP_TOOLS, TOOL_TIPS, HOW_IT_WORKS, GUIDE_TOOLS } from './serpTracker/serpTrackerTools.mjs';
import { costText } from './serpTracker/lookupHelpers.mjs';

// SERP Tracker (docs/serp-tracker.md). A site switcher on top (one site per client or website, or a Quick lookup with no site) and three tabs
// that follow it: Site setup, Lookup (a search on Google right now, saved and reopenable), Keywords (what the site ranks for and each keyword's
// history, from Search Console) and Runs (the daily checks). DataForSEO daily collection and the weekly report arrive in later stages.

const CARD = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
const FIELD = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const usd = (n) => (n == null ? '—' : costText(n));
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const STORE_KEY = 'vault_serp_site';
const siteLabel = (s) => `${s.profile.name || s.profile.domain}${s.clientName ? ` (${s.clientName})` : ''}`;

function StatusDot({ status }) {
  const colour = status === 'ok' ? '#16a34a' : status === 'running' ? '#f59e0b' : '#ef4444';
  return <span aria-hidden="true" className="inline-block rounded-full" style={{ width: 8, height: 8, background: colour }} />;
}

function readStored() {
  try {
    const v = localStorage.getItem(STORE_KEY);
    if (v === 'quick') return 'quick';
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch { return null; }
}
function writeStored(v) { try { localStorage.setItem(STORE_KEY, String(v)); } catch { /* private window: just not remembered */ } }

export default function SerpTrackerPage() {
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = user?.isAdmin || featureAccess.serpTracker !== false;

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [sites, setSites] = useState([]);
  const [clients, setClients] = useState([]);
  const [sel, setSel] = useState('new'); // a site id, 'quick' (no site) or 'new' (a site not saved yet)
  const [runs, setRuns] = useState([]);
  const [form, setForm] = useState(() => profileToForm(null));
  const [clientId, setClientId] = useState(null);
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('setup');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const info = useToolInfoModal('vault_serp_tracker_info_seen');
  const formKey = useRef('');

  const site = typeof sel === 'number' ? sites.find((s) => s.id === sel) || null : null;

  const refreshStatus = useCallback(async () => {
    try {
      const res = await api.get('/api/serp-tracker/status');
      const data = await res.json();
      if (res.ok) setStatus(data);
    } catch { /* the figures just stay as they were */ }
  }, []);

  /** Load the list of sites; `prefer` is a selection to keep (a site id, 'quick' or 'new'). */
  const loadSites = useCallback(async (prefer) => {
    const res = await api.get('/api/serp-tracker/sites');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load your sites.');
    setSites(data.sites);
    const stored = prefer ?? readStored();
    const next = stored === 'quick' || stored === 'new' ? stored : data.sites.some((s) => s.id === stored) ? stored : data.sites[0] ? data.sites[0].id : 'new';
    setSel(next);
    return data.sites;
  }, []);

  const load = useCallback(async () => {
    try {
      const [, st] = await Promise.all([loadSites(), api.get('/api/serp-tracker/status')]);
      const std = await st.json();
      if (!st.ok) throw new Error(std.error || 'Could not load SERP Tracker.');
      setStatus(std);
      api.get('/api/clients').then((r) => (r.ok ? r.json() : [])).then((c) => setClients(Array.isArray(c) ? c : [])).catch(() => {});
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast, loadSites]);

  useEffect(() => {
    api.get('/api/settings/feature-access').then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); }).catch(() => {});
    load();
  }, [load]);

  // the form follows the chosen site (and is refilled after a save), but is not reset by an unrelated reload while you type
  useEffect(() => {
    const key = `${sel}:${site ? site.updatedAt : ''}`;
    if (formKey.current === key) return;
    formKey.current = key;
    setErrors([]);
    setConfirmDelete(false);
    setForm(profileToForm(site ? site.profile : null, status?.defaults));
    setClientId(site ? site.clientId : null);
  }, [sel, site, status]);

  const loadRuns = useCallback(async (id) => {
    try {
      const res = await api.get(`/api/serp-tracker/sites/${id}/runs`);
      const data = await res.json();
      setRuns(res.ok ? data.runs : []);
    } catch { setRuns([]); }
  }, []);
  useEffect(() => { if (typeof sel === 'number') loadRuns(sel); else setRuns([]); }, [sel, loadRuns]);

  const choose = (value) => {
    const next = value === 'quick' || value === 'new' ? value : Number(value);
    setSel(next);
    if (next !== 'new') writeStored(next);
  };

  // The guide's Open buttons: show the tab, then scroll to the part of the page.
  const openToolById = (id) => {
    const target = GUIDE_TOOLS.find((t) => t.id === id);
    if (!target) return;
    setTab(target.tool);
    setTimeout(() => {
      const el = document.querySelector('[data-guide="' + id + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleDevice = (d) => setForm((f) => ({ ...f, devices: f.devices.includes(d) ? f.devices.filter((x) => x !== d) : [...f.devices, d] }));

  async function save() {
    setSaving(true);
    setErrors([]);
    try {
      const isNew = sel === 'new';
      const body = { profile: formToProfile(form), clientId };
      const res = isNew ? await api.post('/api/serp-tracker/sites', body) : await api.put(`/api/serp-tracker/sites/${sel}`, body);
      const data = await res.json();
      if (!res.ok) { setErrors(data.errors || [data.error || 'Could not save.']); return; }
      formKey.current = '';
      await loadSites(data.site.id);
      writeStored(data.site.id);
      addToast(isNew ? 'Site added.' : 'Site details saved.', 'success');
    } catch {
      addToast('Could not save. Check your connection and try again.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function undoSiteDelete(binId) {
    try {
      const res = await api.post(`/api/recycle-bin/${binId}/restore`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'restore failed');
      formKey.current = '';
      const list = await loadSites();
      const back = list.find((s) => String(s.id) === String(data.entityId));
      if (back) { setSel(back.id); writeStored(back.id); }
      addToast('Site restored ✓', 'success');
    } catch (err) {
      addToast(`${err.message && err.message !== 'restore failed' ? err.message : 'That could not be restored.'} Look in Settings, Recycle bin.`, 'error');
    }
  }

  async function deleteSite() {
    setDeleting(true);
    try {
      const res = await api.delete(`/api/serp-tracker/sites/${sel}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'The site could not be deleted.');
      setConfirmDelete(false);
      formKey.current = '';
      const remaining = sites.filter((s) => s.id !== sel);
      setSites(remaining);
      const next = remaining[0] ? remaining[0].id : 'new';
      setSel(next);
      writeStored(next);
      addToast(`Site deleted. Kept ${data.retentionDays || 30} days.`, 'success', undefined, { label: 'Undo', onClick: () => undoSiteDelete(data.binId) });
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setDeleting(false);
    }
  }

  async function runNow() {
    startProcessing('Running the SERP Tracker check…', 'Checking the DataForSEO balance and logging the cost.');
    try {
      const res = await api.post(`/api/serp-tracker/sites/${sel}/run`, {});
      const data = await res.json();
      if (!res.ok) { addToast(data.error || 'The run failed.', 'error'); return; }
      addToast(data.run.status === 'ok' ? 'Run finished.' : 'Run finished with a failure. See the details below.', data.run.status === 'ok' ? 'success' : 'error');
      await loadRuns(sel);
    } catch {
      addToast('The run could not be started.', 'error');
    } finally {
      stopProcessing();
    }
  }

  if (!canUse) return <Navigate to="/" replace />;

  const cap = status?.capUsd;
  const spent = status?.spentThisMonthUsd;
  const maxSites = status?.maxSites || 20;
  const btn = 'px-3 py-1.5 rounded-lg border text-xs font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-50';

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <div className="w-full max-w-[1700px] mx-auto p-4 sm:p-6 space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>SERP Tracker</h1>
            <Tooltip text="How SERP Tracker works, what it costs, and what it cannot do yet.">
              <button type="button" onClick={info.open} aria-label="How SERP Tracker works"
                className="transition-opacity duration-200 hover:opacity-60"
                style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                {getIcon('info', { size: 16 })}
              </button>
            </Tooltip>
          </div>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            See where each of your sites shows on Google. Look up any search now, and see the keywords each site really ranks for and how they have moved (from Search Console).
          </p>
        </div>

        {/* The site switcher: one site per client or website, or a Quick lookup with no site */}
        {!loading && (
          <div className="flex flex-wrap items-end gap-3" data-guide="site-switcher">
            <div className="min-w-[14rem]">
              <label htmlFor="serp-site-select" className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Site</label>
              <Tooltip text="Choose which of your sites to work on. Site setup, Lookup and Runs all follow it. Quick lookup is for checking a search that is not one of your sites.">
                <select id="serp-site-select" value={String(sel)} onChange={(e) => choose(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm outline-none" style={FIELD}>
                  {sel === 'new' && <option value="new">New site (not saved yet)</option>}
                  {sites.map((s) => <option key={s.id} value={s.id}>{siteLabel(s)}</option>)}
                  <option value="quick">Quick lookup (no site)</option>
                </select>
              </Tooltip>
            </div>
            <Tooltip text={sites.length >= maxSites ? `You track ${maxSites} sites, the most. Delete one to add another.` : 'Add another site, for example a different client\'s website.'}>
              <button type="button" data-guide="add-site" disabled={sites.length >= maxSites || sel === 'new'} onClick={() => { choose('new'); setTab('setup'); }}
                className={`${btn} flex items-center gap-1.5`} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                {getIcon('plus', { size: 13 })} Add site
              </button>
            </Tooltip>
            {site && (confirmDelete ? (
              <span className="flex items-center gap-2 text-xs pb-1.5" role="alert" style={{ color: 'var(--color-text)' }}>
                Delete {site.profile.name || site.profile.domain} and its saved lookups?
                <button type="button" disabled={deleting} onClick={deleteSite} className={btn} style={{ borderColor: '#ef4444', color: '#991b1b' }}>Yes</button>
                <button type="button" disabled={deleting} onClick={() => setConfirmDelete(false)} className={btn} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>No</button>
              </span>
            ) : (
              <Tooltip text="Deletes this site and its saved lookups. They are kept for 30 days and the Undo on the message brings them back. Your past spending stays in the cost log.">
                <button type="button" data-guide="delete-site" onClick={() => setConfirmDelete(true)} className={`${btn} flex items-center gap-1.5`} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  {getIcon('trash', { size: 13 })} Delete site
                </button>
              </Tooltip>
            ))}
            {site && site.clientName && <span className="text-xs pb-2" style={{ color: 'var(--color-muted)' }}>CRM client: {site.clientName}</span>}
          </div>
        )}

        <div className="flex gap-1 border-b" style={{ borderColor: 'var(--color-border)' }} role="tablist" aria-label="SERP Tracker sections">
          {SERP_TOOLS.map((t) => (
            <Tooltip key={t.id} text={TOOL_TIPS[t.id]}>
              <button type="button" role="tab" aria-selected={tab === t.id} data-guide={t.id} onClick={() => setTab(t.id)}
                className="px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-all duration-200 hover:opacity-70 flex items-center gap-2"
                style={{ borderColor: tab === t.id ? 'var(--color-primary)' : 'transparent', color: tab === t.id ? 'var(--color-primary)' : 'var(--color-muted)' }}>
                {getIcon(t.icon, { size: 14 })} {t.label}
              </button>
            </Tooltip>
          ))}
        </div>

        {loading ? <Skeleton lines={5} label="Loading SERP Tracker" /> : tab === 'lookup' ? (
          sel === 'new' ? (
            <section className="rounded-2xl border" style={CARD}>
              <EmptyState icon="search" title="Add the site first" body="Save this site's details on the Site setup tab to look up searches for it. Or choose Quick lookup in the site switcher to check a search without a site."
                action={<button type="button" onClick={() => setTab('setup')} className={btn} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Go to Site setup</button>} />
            </section>
          ) : (
            <LookupPanel key={String(sel)} status={status} siteId={typeof sel === 'number' ? sel : null} site={site ? site.profile : null} onSpendChanged={refreshStatus} />
          )
        ) : tab === 'search-keywords' ? (
          typeof sel !== 'number' ? (
            <section className="rounded-2xl border" style={CARD}>
              <EmptyState icon="line-chart" title={sel === 'quick' ? 'Quick lookups have no keywords' : 'Add the site first'}
                body={sel === 'quick' ? 'Keywords belong to a site. Choose one of your sites in the site switcher.' : 'Save this site\'s details on the Site setup tab, then connect it to Search Console here.'}
                action={<button type="button" onClick={() => setTab('setup')} className={btn} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Go to Site setup</button>} />
            </section>
          ) : (
            <KeywordsPanel key={String(sel)} siteId={sel} site={site ? site.profile : null} />
          )
        ) : (
          <div className="flex flex-col xl:grid xl:grid-cols-2 xl:items-start gap-6">
            {tab === 'setup' && (sel === 'quick' ? (
              <section className="rounded-2xl border" style={CARD}>
                <EmptyState icon="settings" title="Quick lookups have no site details" body="A Quick lookup checks any search without a site, so there is nothing to set up. To follow one of your own websites, add it as a site."
                  action={<button type="button" onClick={() => choose('new')} className={btn} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Add a site</button>} />
              </section>
            ) : (
              <SiteForm form={form} set={set} toggleDevice={toggleDevice} errors={errors} saving={saving} onSave={save} isNew={sel === 'new'}
                savedAt={site ? site.updatedAt : null} clients={clients} clientId={clientId} onClientChange={setClientId} clientName={site ? site.clientName : null} />
            ))}

            {tab === 'setup' && (
              <section className="rounded-2xl border p-6 space-y-3" style={CARD} aria-labelledby="serp-conn-title" data-guide="spending">
                <h2 id="serp-conn-title" className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>DataForSEO and spending</h2>
                {status?.dataForSeoConfigured ? (
                  <p className="text-sm" style={{ color: 'var(--color-text)' }}>Connected: the login and password are set on the server.</p>
                ) : (
                  <p className="text-sm" style={{ color: '#b45309' }}>Not connected. Ask an admin to set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD on the server.</p>
                )}
                <dl className="grid grid-cols-3 gap-3 text-sm">
                  {[['This month', usd(spent)], ['Monthly limit', usd(cap)], ['Last month', usd(status?.spentLastMonthUsd)]].map(([label, value]) => (
                    <div key={label} className="rounded-xl border p-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
                      <dt className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</dt>
                      <dd className="font-semibold" style={{ color: 'var(--color-text)' }}>{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Spending counts every site and every person using the workspace's DataForSEO account. The limit stops searches when one would pass it; it is set by MAX_MONTHLY_SPEND_USD on the server (default US$5).</p>
              </section>
            )}

            {tab === 'runs' && (
              <section className="rounded-2xl border p-6 space-y-4 xl:col-span-2" style={CARD} aria-labelledby="serp-runs-title">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="serp-runs-title" className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Runs{site ? ` for ${site.profile.name || site.profile.domain}` : ''}</h2>
                  <Tooltip text="Checks that DataForSEO is connected and shows your account balance. It searches nothing and costs nothing. Rankings are not collected here yet: use the Lookup tab.">
                    <button type="button" onClick={runNow} disabled={!site || !status?.dataForSeoConfigured} data-guide="run-now"
                      className="px-3.5 py-1.5 rounded-lg border text-sm font-medium flex items-center gap-2 transition-opacity duration-200 hover:opacity-70 disabled:opacity-50"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                      {getIcon('play', { size: 14 })} Check connection
                    </button>
                  </Tooltip>
                </div>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>The daily run starts at 6:00 am Brisbane time, for every site you have added. A failed step is shown as a failure, never as a missing ranking.</p>
                {!site ? (
                  <EmptyState icon="line-chart" title={sel === 'quick' ? 'Quick lookups have no runs' : 'Add the site first'} body={sel === 'quick' ? 'Runs belong to a site. Choose one of your sites in the site switcher.' : 'Save this site\'s details first, then the daily run can start.'} />
                ) : runs.length === 0 ? (
                  <EmptyState icon="line-chart" title="No runs yet" body="Press Check connection to confirm DataForSEO is connected, or wait for the first daily run." />
                ) : (
                  <ul className="space-y-3" data-guide="run-list">
                    {runs.map((r) => (
                      <li key={r.id} className="rounded-xl border p-4 space-y-2" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" style={{ color: 'var(--color-text)' }}>
                          <span className="flex items-center gap-2 font-medium"><StatusDot status={r.status} />{r.status === 'ok' ? 'Finished' : r.status === 'running' ? 'Running' : 'Failed'}</span>
                          <span>{when(r.startedAt)}</span>
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{r.trigger === 'manual' ? 'by hand' : 'daily'}</span>
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Balance {usd(r.balanceUsd)} · Cost {usd(r.totalCostUsd)}</span>
                        </div>
                        {r.steps.length > 0 && (
                          <ul className="text-xs space-y-0.5" style={{ color: 'var(--color-muted)' }}>
                            {r.steps.map((s) => (
                              <li key={s.name} style={s.status === 'failed' ? { color: '#991b1b' } : undefined}>
                                {s.status === 'ok' ? 'Done' : 'Failed'}: {s.name}{s.detail ? ` — ${s.detail}` : ''}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}
      </div>

      {info.show && (
        <ToolInfoModal title="How SERP Tracker works" onClose={info.close}>
          {HOW_IT_WORKS.map(([heading, text]) => (
            <div key={heading}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{heading}</h3>
              <p className="text-sm leading-relaxed mt-1" style={{ color: 'var(--color-muted)' }}>{text}</p>
            </div>
          ))}
        </ToolInfoModal>
      )}

      <SerpTrackerTutorChat currentTool={tab} onOpenTool={openToolById} />
    </div>
  );
}
