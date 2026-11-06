import React, { useCallback, useEffect, useState } from 'react';
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
import SerpTrackerTutorChat from './serpTracker/SerpTrackerTutorChat';
import { SERP_TOOLS, TOOL_TIPS, HOW_IT_WORKS, GUIDE_TOOLS } from './serpTracker/serpTrackerTools.mjs';
import { costText } from './serpTracker/lookupHelpers.mjs';

// SERP Tracker (docs/serp-tracker.md): three tabs. Site setup (the site, searches and competitors, and whether DataForSEO is connected and what it
// has cost), Lookup (a search on Google right now, saved and reopenable), Runs (the daily checks). Rankings history, Search Console and the
// weekly report arrive in later stages.

const FIELD = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const CARD = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
const usd = (n) => (n == null ? '—' : costText(n));
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function StatusDot({ status }) {
  const colour = status === 'ok' ? '#16a34a' : status === 'running' ? '#f59e0b' : '#ef4444';
  return <span aria-hidden="true" className="inline-block rounded-full" style={{ width: 8, height: 8, background: colour }} />;
}

export default function SerpTrackerPage() {
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = user?.isAdmin || featureAccess.serpTracker !== false;

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [site, setSite] = useState(null);
  const [runs, setRuns] = useState([]);
  const [form, setForm] = useState(() => profileToForm(null));
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('setup');
  const info = useToolInfoModal('vault_serp_tracker_info_seen');

  // spend changes whenever a lookup is made: re-read just the status
  const refreshStatus = useCallback(async () => {
    try {
      const res = await api.get('/api/serp-tracker/status');
      const data = await res.json();
      if (res.ok) setStatus(data);
    } catch { /* the figures just stay as they were */ }
  }, []);

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

  const load = useCallback(async () => {
    try {
      const [s, st, r] = await Promise.all([api.get('/api/serp-tracker/site'), api.get('/api/serp-tracker/status'), api.get('/api/serp-tracker/runs')]);
      const [sd, std, rd] = await Promise.all([s.json(), st.json(), r.json()]);
      if (!s.ok || !st.ok || !r.ok) throw new Error(sd.error || std.error || rd.error || 'Could not load SERP Tracker.');
      setSite(sd.site);
      setStatus(std);
      setRuns(rd.runs || []);
      setForm(profileToForm(sd.site ? sd.site.profile : null, std.defaults));
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    api.get('/api/settings/feature-access').then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); }).catch(() => {});
    load();
  }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleDevice = (d) => setForm((f) => ({ ...f, devices: f.devices.includes(d) ? f.devices.filter((x) => x !== d) : [...f.devices, d] }));

  async function save() {
    setSaving(true);
    setErrors([]);
    try {
      const res = await api.put('/api/serp-tracker/site', { profile: formToProfile(form) });
      const data = await res.json();
      if (!res.ok) { setErrors(data.errors || [data.error || 'Could not save.']); return; }
      setSite(data.site);
      setForm(profileToForm(data.site.profile, status?.defaults));
      addToast('Site details saved.', 'success');
    } catch {
      addToast('Could not save. Check your connection and try again.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    startProcessing('Running the SERP Tracker check…', 'Checking the DataForSEO balance and logging the cost.');
    try {
      const res = await api.post('/api/serp-tracker/run', {});
      const data = await res.json();
      if (!res.ok) { addToast(data.error || 'The run failed.', 'error'); return; }
      addToast(data.run.status === 'ok' ? 'Run finished.' : 'Run finished with a failure. See the details below.', data.run.status === 'ok' ? 'success' : 'error');
      await load();
    } catch {
      addToast('The run could not be started.', 'error');
    } finally {
      stopProcessing();
    }
  }

  if (!canUse) return <Navigate to="/" replace />;

  const cap = status?.capUsd;
  const spent = status?.spentThisMonthUsd;
  const labelCls = 'block text-xs font-medium mb-1';

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
            See where your site shows on Google. Look up any search now and keep the result. Collecting your rankings every day is the next stage.
          </p>
        </div>

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
          <LookupPanel status={status} siteSaved={Boolean(site)} onSpendChanged={refreshStatus} />
        ) : (
          <div className="flex flex-col xl:grid xl:grid-cols-2 xl:items-start gap-6">
            {tab === 'setup' && (
            <section className="rounded-2xl border p-6 space-y-4" style={CARD} aria-labelledby="serp-site-title">
              <h2 id="serp-site-title" className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Your site</h2>

              <div data-guide="site-address">
                <label htmlFor="serp-domain" className={labelCls} style={{ color: 'var(--color-muted)' }}>Site address</label>
                <Tooltip text="The site you want to track, for example www.wiwc.com.au. Any www or https:// is tidied up for you.">
                  <input id="serp-domain" value={form.domain} onChange={set('domain')} placeholder="www.example.com.au"
                    className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none" style={FIELD} />
                </Tooltip>
              </div>

              <div data-guide="brand-names">
                <label htmlFor="serp-brand" className={labelCls} style={{ color: 'var(--color-muted)' }}>Brand names (one per line)</label>
                <Tooltip text="Words people type when they are looking for you by name. Used later to split searches into branded and non-branded.">
                  <textarea id="serp-brand" rows={3} value={form.brandTermsText} onChange={set('brandTermsText')}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none" style={FIELD} />
                </Tooltip>
              </div>

              <div data-guide="keywords">
                <label htmlFor="serp-keywords" className={labelCls} style={{ color: 'var(--color-muted)' }}>Keywords to track (one per line; add the page you want to rank after a | )</label>
                <Tooltip text="One search per line, for example: walk in wine cabinets | https://www.example.com.au/cabinets/ . The page after the bar is optional.">
                  <textarea id="serp-keywords" rows={8} value={form.keywordsText} onChange={set('keywordsText')}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none font-mono" style={FIELD} />
                </Tooltip>
              </div>

              <div data-guide="competitors">
                <label htmlFor="serp-competitors" className={labelCls} style={{ color: 'var(--color-muted)' }}>Competitors (one per line; pages to watch after a | , separated by commas)</label>
                <Tooltip text="A competitor's site, then optionally the pages whose wording you want saved each week, for example: rival.com.au | https://rival.com.au/page-a/, https://rival.com.au/page-b/">
                  <textarea id="serp-competitors" rows={5} value={form.competitorsText} onChange={set('competitorsText')}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none font-mono" style={FIELD} />
                </Tooltip>
              </div>

              <div data-guide="health-urls">
                <label htmlFor="serp-health" className={labelCls} style={{ color: 'var(--color-muted)' }}>Pages of yours to health-check each day (one per line)</label>
                <Tooltip text="Pages checked every day for redirects, errors and changed canonical addresses, so a ranking drop can be read alongside them.">
                  <textarea id="serp-health" rows={3} value={form.healthText} onChange={set('healthText')}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none font-mono" style={FIELD} />
                </Tooltip>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-guide="location-depth">
                <div>
                  <label htmlFor="serp-location" className={labelCls} style={{ color: 'var(--color-muted)' }}>Where Google is asked from</label>
                  <Tooltip text='The place the search is made from. "Australia" gives national results; a city such as "Brisbane,Queensland,Australia" gives local ones.'>
                    <input id="serp-location" value={form.locationName} onChange={set('locationName')}
                      className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none" style={FIELD} />
                  </Tooltip>
                </div>
                <div>
                  <label htmlFor="serp-depth" className={labelCls} style={{ color: 'var(--color-muted)' }}>Results to request (10 to 100)</label>
                  <Tooltip text="How deep into Google's results to look. Deeper costs more. The first real test will show what 100 costs before anything runs daily.">
                    <input id="serp-depth" type="number" min={10} max={100} step={10} value={form.serpDepth} onChange={set('serpDepth')}
                      className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none" style={FIELD} />
                  </Tooltip>
                </div>
                <div>
                  <label htmlFor="serp-lang" className={labelCls} style={{ color: 'var(--color-muted)' }}>Language</label>
                  <input id="serp-lang" value={form.languageCode} onChange={set('languageCode')}
                    className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none" style={FIELD} />
                </div>
                <div>
                  <label htmlFor="serp-tz" className={labelCls} style={{ color: 'var(--color-muted)' }}>Your time zone</label>
                  <Tooltip text="Reports group days, and weekly tasks run on Mondays, in this time zone.">
                    <input id="serp-tz" value={form.timezone} onChange={set('timezone')}
                      className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none" style={FIELD} />
                  </Tooltip>
                </div>
              </div>

              <fieldset data-guide="devices">
                <legend className={labelCls} style={{ color: 'var(--color-muted)' }}>Devices</legend>
                <div className="flex gap-4">
                  {['desktop', 'mobile'].map((d) => (
                    <label key={d} className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                      <input type="checkbox" checked={form.devices.includes(d)} onChange={() => toggleDevice(d)} />
                      {d === 'desktop' ? 'Desktop' : 'Mobile'}
                    </label>
                  ))}
                </div>
              </fieldset>

              {errors.length > 0 && (
                <div role="alert" className="rounded-xl border p-3 text-sm space-y-1" style={{ background: '#fff1f2', borderColor: '#fca5a5', color: '#991b1b' }}>
                  {errors.map((e) => <p key={e}>{e}</p>)}
                </div>
              )}

              <div className="flex items-center gap-3">
                <Tooltip text="Saves these details. Nothing is collected or charged by saving.">
                  <button type="button" onClick={save} disabled={saving} data-guide="save-site"
                    className="px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-50"
                    style={{ background: 'var(--color-primary)', color: '#fff' }}>
                    {saving ? 'Saving…' : 'Save site details'}
                  </button>
                </Tooltip>
                {site && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Saved {when(site.updatedAt)}</span>}
              </div>
            </section>
            )}

            {tab === 'setup' && (
              <section className="rounded-2xl border p-6 space-y-3" style={CARD} aria-labelledby="serp-conn-title" data-guide="spending">
                <h2 id="serp-conn-title" className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>DataForSEO and spending</h2>
                {status?.dataForSeoConfigured ? (
                  <p className="text-sm" style={{ color: 'var(--color-text)' }}>Connected: the login and password are set on the server.</p>
                ) : (
                  <p className="text-sm" style={{ color: '#b45309' }}>Not connected. Ask an admin to set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD on the server.</p>
                )}
                <dl className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-xl border p-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
                    <dt className="text-xs" style={{ color: 'var(--color-muted)' }}>This month</dt>
                    <dd className="font-semibold" style={{ color: 'var(--color-text)' }}>{usd(spent)}</dd>
                  </div>
                  <div className="rounded-xl border p-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
                    <dt className="text-xs" style={{ color: 'var(--color-muted)' }}>Monthly limit</dt>
                    <dd className="font-semibold" style={{ color: 'var(--color-text)' }}>{usd(cap)}</dd>
                  </div>
                  <div className="rounded-xl border p-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
                    <dt className="text-xs" style={{ color: 'var(--color-muted)' }}>Last month</dt>
                    <dd className="font-semibold" style={{ color: 'var(--color-text)' }}>{usd(status?.spentLastMonthUsd)}</dd>
                  </div>
                </dl>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Spending counts every person using the workspace's DataForSEO account. The limit stops ranking collection when it would be passed; it is set by MAX_MONTHLY_SPEND_USD on the server (default US$5).</p>
              </section>
            )}

            {tab === 'runs' && (
              <section className="rounded-2xl border p-6 space-y-4 xl:col-span-2" style={CARD} aria-labelledby="serp-runs-title">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="serp-runs-title" className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Runs</h2>
                  <Tooltip text="Runs today's check now instead of waiting for 6:00 am Brisbane time. At this stage it only checks the balance, which is free.">
                    <button type="button" onClick={runNow} disabled={!site || !status?.dataForSeoConfigured} data-guide="run-now"
                      className="px-3.5 py-1.5 rounded-lg border text-sm font-medium flex items-center gap-2 transition-opacity duration-200 hover:opacity-70 disabled:opacity-50"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                      {getIcon('play', { size: 14 })} Run now
                    </button>
                  </Tooltip>
                </div>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>The daily run starts at 6:00 am Brisbane time. A failed step is shown as a failure, never as a missing ranking.</p>
                {runs.length === 0 ? (
                  <EmptyState icon="line-chart" title="No runs yet" body={site ? 'Press Run now to check the connection, or wait for the first daily run.' : 'Save your site details first, then the daily run can start.'} />
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
