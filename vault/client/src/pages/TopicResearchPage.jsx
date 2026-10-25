import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import useProcessingStore from '../store/processingStore';
import { useIcon } from '../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import { offerUndo } from '../utils/binUndo';
import { VoiceInputProvider, VoiceInput } from '../components/voiceInput/VoiceInput';
import ResultsView from './topicResearch/ResultsView';
import BriefView from './topicResearch/BriefView';
import SettingsPanel from './topicResearch/SettingsPanel';
import HistoryPanel from './topicResearch/HistoryPanel';
import TopicResearchTutorChat from './topicResearch/TopicResearchTutorChat';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { HOW_IT_WORKS, GUIDE_TOOLS } from './topicResearch/topicResearchTools.mjs';
import { startTopicResearchTour, TOUR_KEY } from '../utils/tours/topicResearchTour';
import { REFRESH_CHOICES, budgetBanner, heatBadge, orderTopics, refreshLabel, statusLabel, timeAgo } from './topicResearch/format.mjs';

// Status colours are deliberately outside the theme (see client/DESIGN.md).
const LEVEL = { good: '#16a34a', warn: '#f59e0b', bad: '#ef4444', info: 'var(--color-muted)' };

// Topic Research (milestone 1): search a topic across your RSS feeds, keep the topics you care about, read what each search found.
// Later milestones add more sources, a ranking, and a research brief. Docs: docs/topic-research.md.
export default function TopicResearchPage() {
  const getIcon = useIcon();
  const isAdmin = useAuthStore((s) => s.user?.isAdmin);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const [flagsLoaded, setFlagsLoaded] = useState(false);
  const canUse = isAdmin || featureAccess.topicResearch === true;
  const [params, setParams] = useSearchParams();
  const topicId = Number(params.get('topic')) || null;
  const briefId = Number(params.get('brief')) || null;
  const runId = Number(params.get('run')) || null; // an earlier search opened from History
  const tab = ['settings', 'history'].includes(params.get('tab')) ? params.get('tab') : 'topics';
  const info = useToolInfoModal('vault_topic_research_info_seen');
  const [usage, setUsage] = useState(null); // this month's spend, for the limit banner

  const [topics, setTopics] = useState(null);
  const [keyword, setKeyword] = useState('');
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => {
    api.get('/api/settings/feature-access').then((r) => r.json()).then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); }).catch(() => {}).finally(() => setFlagsLoaded(true));
  }, []);

  const loadTopics = useCallback(async () => {
    try {
      const r = await api.get('/api/topic-research/topics');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load your topics.');
      setTopics(d.topics);
    } catch (e) { setError(e.message || 'Could not reach the server.'); setTopics((cur) => cur || []); }
  }, []);
  useEffect(() => { loadTopics(); }, [loadTopics]);

  const loadUsage = useCallback(async () => {
    try {
      const r = await api.get('/api/topic-research/usage');
      const d = await r.json();
      if (r.ok) setUsage(d.usage);
    } catch { /* no banner if it cannot be read */ }
  }, []);
  useEffect(() => { loadUsage(); }, [loadUsage, topicId, briefId, tab]); // re-read after a search or a brief, and when changing tab

  // Settings -> Topic Research Tour opens /topic-research?tour=1
  useEffect(() => {
    if (params.get('tour')) {
      const next = new URLSearchParams(params); next.delete('tour');
      setParams(next, { replace: true });
      setTimeout(startTopicResearchTour, 300);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const startTour = () => {
    try { localStorage.removeItem(TOUR_KEY); } catch (_) { /* ignore */ }
    startTopicResearchTour();
  };
  // The guide's "Open" buttons: switch to the tab that holds the control.
  const openToolById = (id) => {
    const target = GUIDE_TOOLS.find((t) => t.id === id);
    const tool = target ? target.tool : id;
    setParams(tool === 'topics' ? {} : { tab: tool });
  };

  const setWatch = async (t, patch) => {
    setError('');
    try {
      const r = await api.patch(`/api/topic-research/topics/${t.id}`, patch);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not change that topic.');
      setTopics((cur) => (cur || []).map((x) => (x.id === t.id ? { ...x, onWatchlist: d.topic.onWatchlist, refreshHours: d.topic.refreshHours } : x)));
    } catch (e) { setError(e.message || 'Could not reach the server.'); }
  };

  const go = (next) => setParams(next, { replace: false });
  const openTopic = (id) => go({ topic: String(id) });
  const backToList = () => { setParams({}); loadTopics(); };

  const search = async () => {
    const k = keyword.trim();
    if (!k) return;
    setError('');
    startProcessing('Searching, reading the best pages and ranking…', 'This can take up to half a minute.');
    try {
      const r = await api.post('/api/topic-research/topics', { keyword: k });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not search.');
      setKeyword('');
      openTopic(d.topic.id);
    } catch (e) { setError(e.message || 'Could not reach the server.'); } finally { stopProcessing(); }
  };

  const remove = async (t) => {
    try {
      const r = await api.delete(`/api/topic-research/topics/${t.id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not delete.');
      setConfirmId(null);
      await loadTopics();
      offerUndo({ message: `"${t.keyword}" deleted`, binIds: d.binId, after: loadTopics });
    } catch (e) { setError(e.message || 'Could not reach the server.'); }
  };

  // this tool starts switched off, so wait for the real flags before deciding a member may not be here
  if (!canUse) return flagsLoaded ? <Navigate to="/" replace /> : null;

  const surface = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
  const text = { color: 'var(--color-text)' };
  const muted = { color: 'var(--color-muted)' };
  const tabBtn = (id, label) => (
    <button
      key={id} type="button" aria-pressed={tab === id && !topicId && !briefId}
      onClick={() => setParams(id === 'topics' ? {} : { tab: id })}
      title={id === 'topics' ? 'Search a topic and see your saved ones' : id === 'history' ? 'Past searches and briefs' : 'Feeds, site profile, ranking, spending'}
      className="px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity"
      style={tab === id && !topicId && !briefId ? { background: 'var(--color-primary)', color: '#fff' } : { border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
    >{label}</button>
  );

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
        <div className="w-full max-w-4xl mx-auto space-y-5">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold" style={text}>Topic Research</h1>
              <button type="button" title="How Topic Research works" aria-label="How Topic Research works" onClick={info.open} className="opacity-60 hover:opacity-100 transition-opacity" style={muted}>{getIcon('info', { size: 16 })}</button>
              <button type="button" title="Take the guided tour of Topic Research" aria-label="Take the guided tour of Topic Research" onClick={startTour} className="opacity-60 hover:opacity-100 transition-opacity" style={muted}>{getIcon('compass', { size: 16 })}</button>
            </div>
            <p className="text-sm leading-relaxed" style={muted}>
              Find what is being written about a topic, so you can write your own piece. It reads the feeds you choose and lists the matching articles. It never publishes or rewrites anyone else&apos;s work.
            </p>
          </div>

          <div className="flex flex-wrap gap-2" role="group" aria-label="Topic Research sections" data-tour="tr-tabs">
            {tabBtn('topics', 'Topics')}
            {tabBtn('history', 'History')}
            {tabBtn('settings', 'Settings')}
          </div>

          {budgetBanner(usage) && (
            <div className="rounded-xl border p-3 text-sm flex flex-wrap items-center gap-3" role="alert" data-tour="tr-banner" style={{ borderColor: '#f59e0b', background: 'var(--color-surface)', color: 'var(--color-text)' }}>
              <span className="flex-1 min-w-0">{budgetBanner(usage)}</span>
              {tab !== 'settings' && <button type="button" onClick={() => setParams({ tab: 'settings' })} className="font-medium hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }}>Change the limit</button>}
            </div>
          )}

          {briefId ? (
            <BriefView
              briefId={briefId} onOpenBrief={(id) => setParams({ brief: String(id) })}
              onBack={(backTopicId) => { if (backTopicId) setParams({ topic: String(backTopicId) }); else backToList(); }}
            />
          ) : topicId ? (
            <ResultsView
              topicId={topicId} pinnedRunId={runId} onShowLatest={() => setParams({ topic: String(topicId) })}
              onBack={backToList} onTopicChanged={loadTopics} onOpenBrief={(id) => setParams({ brief: String(id) })}
            />
          ) : tab === 'history' ? (
            <HistoryPanel onOpenRun={(tid, rid) => setParams({ topic: String(tid), run: String(rid) })} onOpenBrief={(id) => setParams({ brief: String(id) })} />
          ) : tab === 'settings' ? (
            <SettingsPanel onSaved={loadUsage} />
          ) : (
            <>
              <div className="rounded-2xl border p-6 space-y-3" style={surface} data-tour="tr-search">
                <h2 className="text-base font-semibold" style={text}>Search a topic</h2>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-1">
                    <VoiceInput
                      value={keyword} onChange={setKeyword} label="Topic to search for" placeholder="e.g. heat pumps Queensland" maxLength={120}
                      onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
                    />
                  </div>
                  <button
                    type="button" onClick={search} disabled={!keyword.trim()}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity disabled:opacity-40"
                    style={{ background: 'var(--color-primary)', color: '#fff' }}
                  >
                    {getIcon('search', { size: 14 })}Search
                  </button>
                </div>
                <p className="text-xs" style={muted}>Every word must appear in an article&apos;s title or summary. Searching the same words again updates that topic.</p>
                {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}
              </div>

              <div className="space-y-2" data-tour="tr-topics">
                <h2 className="text-base font-semibold" style={text}>Saved topics</h2>
                {topics === null && <p className="text-sm" style={muted}>Loading…</p>}
                {topics && topics.length === 0 && (
                  <p className="text-sm leading-relaxed" style={muted}>
                    No topics yet. Add a few feeds in Settings first, then search for a topic above.
                  </p>
                )}
                {orderTopics(topics).map((t) => {
                  const st = statusLabel(t.lastRun?.status);
                  return (
                    <div key={t.id} className="rounded-xl border p-4 flex flex-wrap items-center gap-3" style={{ ...surface, background: 'var(--color-bg)' }}>
                      <button type="button" onClick={() => openTopic(t.id)} className="flex-1 min-w-0 text-left hover:opacity-70 transition-opacity">
                        <span className="block text-sm font-medium break-words" style={text}>{t.keyword}</span>
                        <span className="block text-xs mt-0.5" style={muted}>
                          {t.lastRun
                            ? <>{t.lastRun.articleCount} article{t.lastRun.articleCount === 1 ? '' : 's'} · searched {timeAgo(t.lastRun.finishedAt)} · <span style={{ color: LEVEL[st.level] }}>{st.text}</span>{heatBadge(t.lastRun.heat) && <> · <span title={heatBadge(t.lastRun.heat).tip}>{heatBadge(t.lastRun.heat).text}</span></>}</>
                            : 'Not searched yet'}
                        </span>
                      </button>
                      <span className="flex items-center gap-2 text-xs" style={muted}>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer" title="Search this topic by itself in the background, so the latest is waiting for you">
                          <input type="checkbox" checked={t.onWatchlist} onChange={(e) => setWatch(t, { onWatchlist: e.target.checked })} aria-label={`Watch ${t.keyword}`} />
                          Watch
                        </label>
                        {t.onWatchlist && (
                          <select
                            value={t.refreshHours} onChange={(e) => setWatch(t, { refreshHours: Number(e.target.value) })} aria-label={`How often to refresh ${t.keyword}`} title={refreshLabel(t.refreshHours)}
                            className="px-2 py-1 rounded-lg border text-xs outline-none" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                          >
                            {REFRESH_CHOICES.map((c) => <option key={c.hours} value={c.hours}>{c.label}</option>)}
                          </select>
                        )}
                      </span>
                      {confirmId === t.id ? (
                        <span className="flex items-center gap-2 text-xs" style={muted}>
                          Delete?
                          <button type="button" onClick={() => remove(t)} className="font-medium hover:opacity-70 transition-opacity" style={{ color: '#ef4444' }}>Yes</button>
                          <button type="button" onClick={() => setConfirmId(null)} className="font-medium hover:opacity-70 transition-opacity" style={text}>No</button>
                        </span>
                      ) : (
                        <button
                          type="button" aria-label={`Delete ${t.keyword}`} title="Delete this topic (kept in the recycle bin for 30 days)"
                          onClick={() => setConfirmId(t.id)} className="opacity-60 hover:opacity-100 transition-opacity" style={muted}
                        >
                          {getIcon('trash', { size: 15 })}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {info.show && (
        <ToolInfoModal title="How Topic Research Works" onClose={info.close}>
          <p className="text-sm" style={text}>
            Find out what is being talked about on a topic, then write your own piece. Not sure where to start? Press the round button at the bottom right and tell the guide what you want to do.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, body]) => (
              <p key={heading} style={text}><strong>{heading}</strong> — {body}</p>
            ))}
          </div>
        </ToolInfoModal>
      )}

      <TopicResearchTutorChat currentTool={tab} onOpenTool={openToolById} />
    </VoiceInputProvider>
  );
}
