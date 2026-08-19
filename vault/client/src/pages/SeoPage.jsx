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

function toCsv(items) {
  const header = 'Keyword,Match type';
  const rows = (items || []).map((item) => {
    const phrase = String(item.phrase || '').replace(/"/g, '""');
    const match = item.matchType || 'phrase';
    return `"${phrase}",${match}`;
  });
  return [header, ...rows].join('\n');
}

function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
              <span className="text-xs leading-relaxed min-w-0" style={{ color: 'var(--color-text)' }}>
                {item.phrase}
              </span>
              <span className="text-[10px] shrink-0 uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                {item.matchType || 'phrase'}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
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
  const canUse = isAdmin || featureAccess.seo !== false;

  const [status, setStatus] = useState(null);
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [openGroup, setOpenGroup] = useState('projects');
  const [search, setSearch] = useState('');

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const loadList = useCallback(async () => {
    const res = await api.get('/api/seo/projects');
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
    api.get('/api/seo/status').then((r) => r.json()).then(setStatus).catch(() => {});
    loadList().catch((err) => addToast(err.message, 'error'));
  }, [canUse, loadList, addToast]);

  useEffect(() => {
    if (!canUse || !id) {
      setProject(null);
      return;
    }
    let cancelled = false;
    api.get(`/api/seo/projects/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Not found');
        if (!cancelled) setProject(data);
      })
      .catch((err) => {
        if (!cancelled) {
          addToast(err.message, 'error');
          navigate('/seo');
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
    startProcessing('Scraping the site…', 'Then building 100 keywords and 100 negatives for Google Ads.');
    try {
      const res = await api.post('/api/seo/projects', {
        url: url.trim(),
        name: name.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create project');
      await loadList();
      setName('');
      setUrl('');
      setNotes('');
      if (data.keywordError) {
        addToast(`Site saved, but keywords failed: ${data.keywordError}`, 'error');
      } else {
        addToast('Keyword lists ready', 'success');
      }
      navigate(`/seo/${data.id}`);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const handleRegenerate = async () => {
    if (!id) return;
    startProcessing('Generating keyword lists…', '100 keywords and 100 negatives from the scraped site.');
    try {
      const res = await api.post(`/api/seo/projects/${id}/keywords`);
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

  const handleDelete = async () => {
    if (!id) return;
    try {
      const res = await api.delete(`/api/seo/projects/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setDeleteConfirm(false);
      await loadList();
      addToast('Project deleted', 'success');
      navigate('/seo');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const copyList = async (items, label) => {
    const text = (items || []).map(googleAdsToken).join('\n');
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
            {getIcon('scan-search', { size: 16 })}
          </div>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>SEO</h1>
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
          data-tour="seo-new"
          onClick={() => navigate('/seo')}
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
                    onClick={() => navigate(`/seo/${p.id}`)}
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
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>New SEO project</h2>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                Paste a website URL. We scrape the homepage plus a few related pages, then build 100 Google Ads keywords and 100 negative keywords for the first campaign.
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
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Project name (optional)</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Defaults to the page title"
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={FIELD}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Notes (optional)</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Locations you serve, offers to push, competitors to exclude…"
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
              Scrape & generate keywords
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
                {project.googleAdsKeywords?.business && (
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                    {project.googleAdsKeywords.business}
                    {project.googleAdsKeywords.geo ? ` · ${project.googleAdsKeywords.geo}` : ''}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleRegenerate}
                  className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-80"
                  style={{ background: 'var(--color-primary)' }}
                >
                  Regenerate
                </button>
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

            {snapshot.title && (
              <div className="rounded-2xl border p-4 space-y-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Scraped site</p>
                <p className="text-sm" style={{ color: 'var(--color-text)' }}>{snapshot.title}</p>
                {snapshot.description && (
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{snapshot.description}</p>
                )}
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {(snapshot.pages || []).length} page{(snapshot.pages || []).length === 1 ? '' : 's'} · {snapshot.charCount || 0} characters
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
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
                onClick={() => downloadCsv(`${project.name || 'seo'}-keywords.csv`, toCsv(keywords))}
                className="px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                Download keywords CSV
              </button>
              <button
                type="button"
                onClick={() => downloadCsv(`${project.name || 'seo'}-negatives.csv`, toCsv(negatives))}
                className="px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                Download negatives CSV
              </button>
            </div>

            {!project.googleAdsKeywords && (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                No keyword lists yet. Tap <strong>Regenerate</strong> to build them from the scrape.
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <KeywordList title="Keywords" items={keywords} empty="No keywords yet." />
              <KeywordList title="Negative keywords" items={negatives} empty="No negatives yet." />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
