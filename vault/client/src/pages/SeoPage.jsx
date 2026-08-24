import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
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

function googleAdsToken(item) {
  const phrase = item.phrase || '';
  if (item.matchType === 'exact') return `[${phrase}]`;
  if (item.matchType === 'broad') return phrase;
  return `"${phrase}"`;
}

function toKeywordExport(items) {
  return (items || []).map(googleAdsToken).join('\n');
}

function downloadCsv(filename, text) {
  const mime = String(filename).endsWith('.txt') ? 'text/plain;charset=utf-8' : 'text/csv;charset=utf-8';
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function displayHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function CharMeta({ text, max }) {
  const n = (text || '').length;
  const over = n > max;
  return (
    <span className="text-[10px] shrink-0 tabular-nums" style={{ color: over ? '#b45309' : 'var(--color-muted)' }}>
      {n}/{max}
    </span>
  );
}

function LineList({ items, max, empty }) {
  if (!items?.length) {
    return <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{empty}</p>;
  }
  return (
    <ol className="space-y-1">
      {items.map((text, i) => (
        <li
          key={`${text}-${i}`}
          className="flex items-start justify-between gap-2 rounded-lg border px-2.5 py-1.5"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
        >
          <span className="text-xs leading-relaxed min-w-0" style={{ color: 'var(--color-text)' }}>{text}</span>
          <CharMeta text={text} max={max} />
        </li>
      ))}
    </ol>
  );
}

function adsToCsv(copy) {
  const rows = ['Ad group,Asset type,Text,Final URL,Path 1,Path 2'];
  const esc = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
  for (const ad of copy?.ads || []) {
    for (const h of ad.headlines || []) {
      rows.push([esc(ad.adGroup), 'Headline', esc(h), esc(ad.finalUrl), esc(ad.path1), esc(ad.path2)].join(','));
    }
    for (const d of ad.descriptions || []) {
      rows.push([esc(ad.adGroup), 'Description', esc(d), esc(ad.finalUrl), esc(ad.path1), esc(ad.path2)].join(','));
    }
  }
  for (const link of copy?.sitelinks || []) {
    rows.push([esc('Sitelinks'), 'Sitelink', esc(link.text), esc(link.url), esc(link.description1), esc(link.description2)].join(','));
  }
  return rows.join('\n');
}

function KeywordList({ title, items, empty }) {
  return (
    <section className="rounded-2xl border p-4 space-y-3 min-w-0" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h3>
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{items?.length || 0}</span>
      </div>
      {!items?.length ? (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{empty}</p>
      ) : (
        <ol className="space-y-1 max-h-[28rem] overflow-y-auto pr-1">
          {items.map((item, i) => (
            <li
              key={`${item.phrase}-${i}`}
              className="flex items-start justify-between gap-2 rounded-lg border px-2.5 py-1.5"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
            >
              <span className="text-xs leading-relaxed min-w-0 font-mono" style={{ color: 'var(--color-text)' }}>
                {googleAdsToken(item)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AdCopySection({ copy, projectName, adsFormat, setAdsFormat, onGenerate, onCopy, onDownload }) {
  const ads = copy?.ads || [];
  const sitelinks = copy?.sitelinks || [];
  const headlines = ads.flatMap((a) => a.headlines || []);
  const descriptions = ads.flatMap((a) => a.descriptions || []);
  const hasLines = headlines.length > 0 || descriptions.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            {copy?.campaignName || 'Ad copy'}
          </h3>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            Headlines (30) and descriptions (90) are listed below. RSA is 15/4 per ad group. 10/10 is one copy pack.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onGenerate}
            className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            {copy ? 'Regenerate ads' : 'Generate ads'}
          </button>
          {hasLines && (
            <>
              <button
                type="button"
                onClick={() => onCopy(headlines, 'Headlines')}
                className="px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                Copy headlines
              </button>
              <button
                type="button"
                onClick={() => onCopy(descriptions, 'Descriptions')}
                className="px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                Copy descriptions
              </button>
              <button
                type="button"
                onClick={() => onDownload(`${projectName || 'google-ads'}-ads.csv`, adsToCsv(copy))}
                className="px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                Download ads CSV
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { id: 'rsa', label: 'RSA · 15 headlines / 4 descriptions' },
          { id: 'ten', label: '10 headlines / 10 descriptions' },
        ].map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setAdsFormat(opt.id)}
            className="px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
            style={{
              borderColor: adsFormat === opt.id ? 'var(--color-primary)' : 'var(--color-border)',
              color: adsFormat === opt.id ? 'var(--color-text)' : 'var(--color-muted)',
              fontWeight: adsFormat === opt.id ? 600 : 400,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {!copy && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          No ads yet. Choose a format, then tap Generate ads. Headlines and descriptions will appear here.
        </p>
      )}

      {copy && !hasLines && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          This campaign has no headlines yet. Tap Generate ads (or switch to 10/10 and generate) to write them.
        </p>
      )}

      {hasLines && (
        <div className="grid gap-4 sm:grid-cols-2">
          <section className="rounded-2xl border p-4 space-y-2 min-w-0" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Headlines</h4>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{headlines.length}</span>
            </div>
            <LineList items={headlines} max={30} empty="No headlines." />
          </section>
          <section className="rounded-2xl border p-4 space-y-2 min-w-0" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Descriptions</h4>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{descriptions.length}</span>
            </div>
            <LineList items={descriptions} max={90} empty="No descriptions." />
          </section>
        </div>
      )}

      {ads.map((ad, i) => {
        const path = [ad.path1, ad.path2].filter(Boolean).join('/');
        const previewUrl = `${displayHost(ad.finalUrl)}${path ? `/${path}` : ''}`;
        return (
          <article
            key={`${ad.adGroup}-${i}`}
            className="rounded-2xl border p-4 space-y-3"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{ad.adGroup}</h4>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {ad.headlines?.length || 0} headlines · {ad.descriptions?.length || 0} descriptions
              </span>
            </div>

            <div className="rounded-xl border px-3 py-2.5 space-y-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                {(ad.headlines || []).slice(0, 3).join(' | ') || 'Headline preview'}
              </p>
              <p className="text-xs" style={{ color: 'var(--color-primary)' }}>{previewUrl}</p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                {(ad.descriptions || [])[0] || ''}
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Destination URL</p>
              <a
                href={ad.finalUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs break-all transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-primary)' }}
              >
                {ad.finalUrl}
              </a>
              {(ad.path1 || ad.path2) && (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  Display path: {previewUrl}
                </p>
              )}
            </div>
          </article>
        );
      })}

      {sitelinks.length > 0 && (
        <section className="rounded-2xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Sitelinks</h4>
          <ul className="space-y-2">
            {sitelinks.map((link, i) => (
              <li key={`${link.text}-${i}`} className="rounded-xl border p-3 space-y-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{link.text}</p>
                  <CharMeta text={link.text} max={25} />
                </div>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs break-all transition-opacity hover:opacity-70"
                  style={{ color: 'var(--color-primary)' }}
                >
                  {link.url}
                </a>
                {(link.description1 || link.description2) && (
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                    {[link.description1, link.description2].filter(Boolean).join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function SeoPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.googleAds !== false;

  const [status, setStatus] = useState(null);
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [openGroup, setOpenGroup] = useState('projects');
  const [search, setSearch] = useState('');

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [offer, setOffer] = useState('');
  const [offerDraft, setOfferDraft] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [pane, setPane] = useState('keywords');
  const [adsFormat, setAdsFormat] = useState('rsa');

  const loadList = useCallback(async () => {
    const res = await api.get('/api/google-ads/projects');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load projects');
    setProjects(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!canUse) return;
    api.get('/api/google-ads/status').then((r) => r.json()).then(setStatus).catch(() => {});
    loadList().catch((err) => addToast(err.message, 'error'));
  }, [canUse, loadList, addToast]);

  useEffect(() => {
    if (!canUse || !id) {
      setProject(null);
      return;
    }
    let cancelled = false;
    api.get(`/api/google-ads/projects/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Not found');
        if (!cancelled) {
          setProject(data);
          setOfferDraft(data.offer || '');
          if (data.googleAdsCopy?.format === 'ten') setAdsFormat('ten');
          else if (data.googleAdsCopy) setAdsFormat('rsa');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          addToast(err.message, 'error');
          navigate('/google-ads');
        }
      });
    return () => { cancelled = true; };
  }, [canUse, id, addToast, navigate]);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      `${p.name} ${p.url} ${p.hostname || ''}`.toLowerCase().includes(q)
    );
  }, [projects, search]);

  const keywords = project?.googleAdsKeywords?.keywords || [];
  const negatives = project?.googleAdsKeywords?.negatives || [];

  const handleCreate = async () => {
    if (!url.trim()) {
      addToast('Paste a website URL', 'error');
      return;
    }
    if (!offer.trim()) {
      addToast('Say what they sell — keywords follow this, not the live page copy', 'error');
      return;
    }
    startProcessing('Scraping the site…', 'Then building keywords, negatives, and RSA ad copy for Google Ads.');
    try {
      const res = await api.post('/api/google-ads/projects', {
        url: url.trim(),
        name: name.trim() || undefined,
        notes: notes.trim() || undefined,
        offer: offer.trim() || undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create project');
      await loadList();
      setName('');
      setUrl('');
      setNotes('');
      setOffer('');
      if (data.keywordError && data.adsError) {
        addToast(`Keywords: ${data.keywordError} · Ads: ${data.adsError}`, 'error');
      } else if (data.adsError) {
        addToast(`Keywords ready. Ads failed: ${data.adsError}. Open the Ads tab to retry.`, 'error');
      } else if (data.keywordError) {
        addToast(`Keywords: ${data.keywordError}`, 'error');
      } else {
        addToast('Keywords and ads ready', 'success');
      }
      navigate(`/google-ads/${data.id}`);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const handleSaveOfferAndRegen = async () => {
    if (!id) return;
    if (!offerDraft.trim()) {
      addToast('Say what they sell before regenerating', 'error');
      return;
    }
    startProcessing('Saving offer and regenerating…', 'Keywords and ads will follow this offer, not a conflicting scrape.');
    try {
      const patch = await api.patch(`/api/google-ads/projects/${id}`, { offer: offerDraft.trim() });
      const patched = await patch.json();
      if (!patch.ok) throw new Error(patched.error || 'Could not save offer');
      const res = await api.post(`/api/google-ads/projects/${id}/keywords`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generate failed');
      setProject(data);
      await loadList();
      try {
        const adsRes = await api.post(`/api/google-ads/projects/${id}/ads`, { format: adsFormat });
        const adsData = await adsRes.json();
        if (!adsRes.ok) throw new Error(adsData.error || 'Ads generate failed');
        setProject(adsData);
        await loadList();
        addToast('Keywords and ads rebuilt from your offer', 'success');
      } catch (adsErr) {
        addToast(`Keywords ready. Ads failed: ${adsErr.message}. Open the Ads tab to retry.`, 'error');
        setPane('ads');
      }
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const handleRegenerate = async () => {
    if (!id) return;
    startProcessing('Generating keyword lists…', 'Keywords follow What they sell when that field is set.');
    try {
      const res = await api.post(`/api/google-ads/projects/${id}/keywords`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generate failed');
      setProject(data);
      await loadList();
      addToast('Keyword lists updated', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const handleGenerateAds = async () => {
    if (!id) return;
    startProcessing(
      'Writing ads…',
      adsFormat === 'ten'
        ? '10 headlines and 10 descriptions from What they sell.'
        : 'RSA headlines and descriptions from What they sell.'
    );
    try {
      const res = await api.post(`/api/google-ads/projects/${id}/ads`, { format: adsFormat });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generate failed');
      setProject(data);
      await loadList();
      setPane('ads');
      addToast('Ad copy ready', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      const res = await api.delete(`/api/google-ads/projects/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setDeleteConfirm(false);
      await loadList();
      addToast('Project deleted', 'success');
      navigate('/google-ads');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const copyList = async (items, label) => {
    const text = Array.isArray(items) && items.length && typeof items[0] === 'string'
      ? items.join('\n')
      : (items || []).map(googleAdsToken).join('\n');
    if (!text) {
      addToast(`No ${label} to copy`, 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      addToast(`${label} copied`, 'success');
    } catch {
      addToast('Could not copy', 'error');
    }
  };

  if (!canUse) return <Navigate to="/" replace />;

  const snapshot = project?.siteSnapshot || {};

  return (
    <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
      <aside
        className="w-full sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r overflow-y-auto p-4 space-y-3"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>
            {getIcon('megaphone', { size: 16 })}
          </div>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Google Ads</h1>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects…"
          className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none"
          style={FIELD}
        />

        <button
          type="button"
          data-tour="google-ads-new"
          onClick={() => navigate('/google-ads')}
          className="w-full text-left px-2 py-1.5 rounded-lg text-xs transition-opacity hover:opacity-70"
          style={{
            background: !id ? 'var(--color-bg)' : 'transparent',
            color: !id ? 'var(--color-text)' : 'var(--color-muted)',
          }}
        >
          New project
        </button>

        <div>
          <button
            type="button"
            onClick={() => setOpenGroup(openGroup === 'projects' ? null : 'projects')}
            className="text-xs font-semibold w-full text-left py-1 transition-opacity hover:opacity-70"
            style={{ color: 'var(--color-primary)' }}
          >
            {openGroup === 'projects' ? '▼' : '▶'} Projects
          </button>
          {(openGroup === 'projects' || search.trim()) && (
            <ul className="pl-2 border-l ml-1 space-y-0.5 mt-1" style={{ borderColor: 'var(--color-border)' }}>
              {filteredProjects.length === 0 && (
                <li className="px-2 py-1.5 text-xs" style={{ color: 'var(--color-muted)' }}>
                  No projects yet
                </li>
              )}
              {filteredProjects.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/google-ads/${p.id}`)}
                    className="w-full text-left px-2 py-1.5 rounded-lg text-xs transition-opacity hover:opacity-70"
                    style={{
                      background: String(id) === String(p.id) ? 'var(--color-bg)' : 'transparent',
                      color: String(id) === String(p.id) ? 'var(--color-text)' : 'var(--color-muted)',
                    }}
                  >
                    <span className="block truncate">{p.name}</span>
                    <span className="block truncate" style={{ color: 'var(--color-muted)' }}>{p.hostname}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-6 space-y-4 max-w-4xl">
        {status && !status.ai && (
          <div className="rounded-xl border p-3 text-xs" style={{ borderColor: '#f59e0b', color: 'var(--color-muted)' }}>
            No text model available — add a chat model in Settings → AI & Chat.
          </div>
        )}

        {!id && (
          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>New Google Ads project</h2>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                Paste a website URL and what the business actually sells. Keyword lists follow the offer. The scrape is used for URLs, brand, and extra detail — not if it describes a different industry.
              </p>
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Website URL</span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.example.com.au"
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={FIELD}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>What they sell</span>
              <textarea
                value={offer}
                onChange={(e) => setOffer(e.target.value)}
                rows={2}
                placeholder="e.g. Waterproofing inspections, leak detection, and remedial waterproofing"
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none resize-y"
                style={FIELD}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Project name (optional)</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Defaults to the offer or page title"
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={FIELD}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Notes (optional)</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Locations, competitors to exclude…"
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none resize-y"
                style={FIELD}
              />
            </label>

            <button
              type="button"
              onClick={handleCreate}
              className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-primary)' }}
            >
              Scrape & generate campaign
            </button>
          </section>
        )}

        {id && project && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{project.name}</h2>
                <a
                  href={project.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs transition-opacity hover:opacity-70 break-all"
                  style={{ color: 'var(--color-primary)' }}
                >
                  {project.url}
                </a>
                {(project.offer || project.googleAdsKeywords?.business) && (
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                    {project.offer || project.googleAdsKeywords.business}
                    {project.googleAdsKeywords?.geo ? ` · ${project.googleAdsKeywords.geo}` : ''}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {deleteConfirm ? (
                  <span className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                    Delete?
                    <button type="button" onClick={handleDelete} className="transition-opacity hover:opacity-70" style={{ color: '#ef4444' }}>Yes</button>
                    <button type="button" onClick={() => setDeleteConfirm(false)} className="transition-opacity hover:opacity-70">No</button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(true)}
                    className="px-3.5 py-1.5 rounded-lg text-sm border transition-opacity hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>

            {project.scrapeMismatch && (
              <div className="rounded-xl border p-3 text-xs leading-relaxed" style={{ borderColor: '#f59e0b', background: '#fef3c7', color: 'var(--color-text)' }}>
                The live page{snapshot.title ? ` (“${snapshot.title}”)` : ''} does not mention this offer. Keyword and ad copy still follow What they sell.
              </div>
            )}

            {project.googleAdsKeywords && !project.googleAdsCopy && (
              <div className="rounded-xl border p-3 text-xs leading-relaxed" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                Keywords are ready. Headlines and descriptions are on the Ads tab — choose RSA or 10/10, then Generate ads.
                <button
                  type="button"
                  onClick={() => setPane('ads')}
                  className="ml-2 transition-opacity hover:opacity-70"
                  style={{ color: 'var(--color-primary)' }}
                >
                  Open Ads
                </button>
              </div>
            )}

            <div className="rounded-2xl border p-4 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <label className="block space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>What they sell</span>
                <textarea
                  value={offerDraft}
                  onChange={(e) => setOfferDraft(e.target.value)}
                  rows={2}
                  placeholder="e.g. Waterproofing inspections, leak detection, and remedial waterproofing"
                  className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none resize-y"
                  style={FIELD}
                />
              </label>
              <button
                type="button"
                onClick={handleSaveOfferAndRegen}
                className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-primary)' }}
              >
                Save offer & regenerate lists
              </button>
            </div>

            {snapshot.title && (
              <div className="rounded-2xl border p-4 space-y-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Scraped site</p>
                <p className="text-sm" style={{ color: 'var(--color-text)' }}>{snapshot.title}</p>
                {snapshot.description && (
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{snapshot.description}</p>
                )}
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {(snapshot.pages || []).length} page{(snapshot.pages || []).length === 1 ? '' : 's'} · {snapshot.charCount || 0} characters
                  {snapshot.htmlBytes ? ` · ${snapshot.htmlBytes} bytes HTML` : ''}
                  {snapshot.statusCode ? ` · HTTP ${snapshot.statusCode}` : ''}
                </p>
              </div>
            )}

            <div className="flex gap-1 border-b" style={{ borderColor: 'var(--color-border)' }}>
              {[
                { id: 'keywords', label: 'Keywords' },
                { id: 'ads', label: project.googleAdsCopy ? 'Ads' : 'Ads (none yet)' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPane(tab.id)}
                  className="px-3 py-2 text-sm transition-opacity hover:opacity-70"
                  style={{
                    color: pane === tab.id ? 'var(--color-text)' : 'var(--color-muted)',
                    borderBottom: pane === tab.id ? '2px solid var(--color-primary)' : '2px solid transparent',
                    fontWeight: pane === tab.id ? 600 : 400,
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {pane === 'keywords' && (
              <>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleRegenerate}
                    className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-80"
                    style={{ background: 'var(--color-primary)' }}
                  >
                    {project.googleAdsKeywords ? 'Regenerate keywords' : 'Generate keywords'}
                  </button>
                  <button
                    type="button"
                    onClick={() => copyList(keywords, 'Keywords')}
                    className="px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    Copy keywords
                  </button>
                  <button
                    type="button"
                    onClick={() => copyList(negatives, 'Negatives')}
                    className="px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    Copy negatives
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadCsv(`${project.name || 'google-ads'}-keywords.txt`, toKeywordExport(keywords))}
                    className="px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    Download keywords
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadCsv(`${project.name || 'google-ads'}-negatives.txt`, toKeywordExport(negatives))}
                    className="px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    Download negatives
                  </button>
                </div>

                {!project.googleAdsKeywords && (
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    No keyword lists yet. Tap Generate keywords — lists follow What they sell when that field is set.
                  </p>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <KeywordList title="Keywords" items={keywords} empty="No keywords yet." />
                  <KeywordList title="Negative keywords" items={negatives} empty="No negatives yet." />
                </div>
              </>
            )}

            {pane === 'ads' && (
              <AdCopySection
                copy={project.googleAdsCopy}
                projectName={project.name}
                adsFormat={adsFormat}
                setAdsFormat={setAdsFormat}
                onGenerate={handleGenerateAds}
                onCopy={copyList}
                onDownload={downloadCsv}
              />
            )}
          </section>
        )}
      </main>
    </div>
  );
}
