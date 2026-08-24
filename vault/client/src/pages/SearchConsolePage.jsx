import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';

const FIELD = {
  background: 'var(--color-bg)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
};

function pct(n) {
  if (n == null) return '—';
  return `${(Number(n) * 100).toFixed(1)}%`;
}

function pos(n) {
  if (n == null) return '—';
  return Number(n).toFixed(1);
}

export default function SearchConsolePage() {
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [searchParams, setSearchParams] = useSearchParams();

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.searchConsole !== false;

  const [status, setStatus] = useState({ connected: false, configured: false, email: null });
  const [sites, setSites] = useState([]);
  const [siteUrl, setSiteUrl] = useState('');
  const [report, setReport] = useState(null);

  const loadStatus = useCallback(async () => {
    const res = await api.get('/api/gsc/status');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Status failed');
    setStatus(data);
    return data;
  }, []);

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const err = searchParams.get('gscError');
    if (err) {
      addToast(err, 'error');
      setSearchParams({}, { replace: true });
    }
    if (searchParams.get('gscConnected')) {
      addToast('Search Console connected', 'success');
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, addToast]);

  useEffect(() => {
    if (!canUse) return;
    loadStatus()
      .then(async (s) => {
        if (!s.connected) return;
        const [sitesRes, snapRes] = await Promise.all([
          api.get('/api/gsc/sites'),
          api.get('/api/gsc/snapshot'),
        ]);
        const siteList = await sitesRes.json();
        const snap = await snapRes.json();
        if (sitesRes.ok && Array.isArray(siteList)) {
          setSites(siteList);
          setSiteUrl((prev) => prev || siteList[0]?.siteUrl || '');
        }
        if (snapRes.ok && snap) {
          setReport(snap);
          if (snap.siteUrl) setSiteUrl(snap.siteUrl);
        }
      })
      .catch((err) => addToast(err.message, 'error'));
  }, [canUse, loadStatus, addToast]);

  const connect = async () => {
    try {
      const res = await api.get('/api/gsc/auth');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start Google login');
      window.location.href = data.authUrl;
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const disconnect = async () => {
    try {
      const res = await api.post('/api/gsc/disconnect');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Disconnect failed');
      setStatus({ ...status, connected: false, email: null });
      setSites([]);
      setReport(null);
      addToast('Disconnected', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const loadReport = async () => {
    if (!siteUrl) {
      addToast('Choose a property', 'error');
      return;
    }
    startProcessing('Loading Search Console…', 'Last ~28 days of queries and pages (data is delayed a few days).');
    try {
      const res = await api.post('/api/gsc/snapshot', { siteUrl });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load Search Console');
      setReport(data);
      addToast(data.summary, 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  if (!canUse) return <Navigate to="/" replace />;

  return (
    <div className="flex flex-col min-h-[calc(100dvh-3rem)] p-6 max-w-4xl space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}>
          {getIcon('line-chart', { size: 16 })}
        </div>
        <h1 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Search</h1>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
        Google Search Console for organic campaigns: queries, landing pages, and queries that split across URLs. Use SEO for the HTML crawl and HTML for Lighthouse. Add <span className="font-medium" style={{ color: 'var(--color-text)' }}>{'{APP_URL}/api/gsc/callback'}</span> as an authorised redirect in Google Cloud (or set GSC_REDIRECT_URI).
      </p>

      {!status.connected ? (
        <button
          type="button"
          onClick={connect}
          className="px-4 py-2 rounded-xl text-sm font-medium text-white w-fit transition-opacity hover:opacity-80"
          style={{ background: 'var(--color-primary)' }}
        >
          Connect Search Console
        </button>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block space-y-1 min-w-[16rem] flex-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Property {status.email ? `· ${status.email}` : ''}</span>
            <select
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
              style={FIELD}
            >
              {!sites.length && <option value="">No properties — verify this Google account in Search Console</option>}
              {sites.map((s) => (
                <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={loadReport}
            className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            Load 28 days
          </button>
          <button
            type="button"
            onClick={disconnect}
            className="px-3.5 py-1.5 rounded-lg text-sm border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Disconnect
          </button>
        </div>
      )}

      {report && (
        <section className="space-y-4">
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{report.summary}</p>

          <div className="rounded-2xl border p-6 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Queries</p>
            {(report.queries || []).length === 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No query rows in this window.</p>}
            <ul className="space-y-2">
              {(report.queries || []).map((q) => (
                <li key={q.query} className="text-xs flex justify-between gap-3">
                  <span style={{ color: 'var(--color-text)' }}>{q.query}</span>
                  <span className="shrink-0 tabular-nums" style={{ color: 'var(--color-muted)' }}>
                    {q.clicks} clicks · {q.impressions} imp · pos {pos(q.position)} · CTR {pct(q.ctr)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border p-6 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Pages</p>
            <ul className="space-y-2">
              {(report.pages || []).map((p) => (
                <li key={p.page} className="text-xs space-y-0.5">
                  <span className="block break-all" style={{ color: 'var(--color-text)' }}>{p.page}</span>
                  <span className="tabular-nums" style={{ color: 'var(--color-muted)' }}>
                    {p.clicks} clicks · {p.impressions} imp · pos {pos(p.position)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border p-6 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Queries split across URLs</p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
              Same query earning impressions on more than one page — a cannibalisation shortlist for the campaign.
            </p>
            {(report.cannibalisation || []).length === 0 && (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No split queries in the top rows.</p>
            )}
            <ul className="space-y-3">
              {(report.cannibalisation || []).map((row) => (
                <li key={row.query} className="rounded-xl border p-4 space-y-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{row.query}</p>
                  {(row.pages || []).slice(0, 5).map((p) => (
                    <p key={p.page} className="text-xs break-all" style={{ color: 'var(--color-muted)' }}>
                      {p.page} · {p.impressions} imp · pos {pos(p.position)}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
