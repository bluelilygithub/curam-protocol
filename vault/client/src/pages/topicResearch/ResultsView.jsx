import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { withProgress } from './withProgress';
import WorkflowBar from './WorkflowBar';
import PromptPanel from './PromptPanel';
import { useIcon } from '../../providers/IconProvider';
import {
  BRIEF_STEP_LABELS, RELEVANCE_STEP_LABELS, SEARCH_STEP_LABELS, breakdownRows, isShopPage, notUsedLine, searchedForLine, costText, defaultSelection, formatDate, heatBadge, rankingNote, readNote, selectionNote, signalBadges, sourceChip, statusLabel, timeAgo, toggleSelection,
} from './format.mjs';

const BRIEFS_CHANGED = 'topic-research:briefs-changed';

// Status colours are deliberately outside the theme (see client/DESIGN.md).
const LEVEL = { good: '#16a34a', warn: '#f59e0b', bad: '#ef4444', info: 'var(--color-muted)' };

// The score and, on hover, focus or tap, the parts it is made of.
function ScorePill({ article }) {
  const [open, setOpen] = useState(false);
  if (article.score == null) return null;
  const rows = breakdownRows(article.breakdown);
  return (
    <span className="relative inline-block" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button" aria-expanded={open} aria-label={`Score ${article.score} out of 100. Show how it is made up`}
        onClick={() => setOpen((o) => !o)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        className="text-xs font-semibold px-2 py-0.5 rounded-lg border hover:opacity-70 transition-opacity"
        style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
      >
        {article.score.toFixed(1)}
      </button>
      {open && rows.length > 0 && (
        <span
          role="tooltip" className="absolute right-0 z-20 mt-1 w-72 max-w-[80vw] rounded-xl border p-3 text-left shadow-lg space-y-1.5"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          <span className="block text-xs font-semibold">Score {article.score.toFixed(1)} out of 100</span>
          {rows.map((r) => (
            <span key={r.id} className="flex justify-between gap-3 text-xs" style={{ color: r.off ? 'var(--color-muted)' : 'var(--color-text)' }}>
              <span className="min-w-0"><strong>{r.label}</strong><span className="block" style={{ color: 'var(--color-muted)' }}>{r.text}</span></span>
              <span className="shrink-0 font-semibold">{r.off ? '–' : `${r.points < 0 ? '' : '+'}${r.points.toFixed(1)}`}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

function ArticleRow({ article, labels, checked, onToggle, showOriginal = true }) {
  const badges = signalBadges(article.signals, labels);
  const muted = { color: 'var(--color-muted)' };
  return (
    <li className="rounded-xl border p-4" style={{ borderColor: checked ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-bg)' }}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox" checked={!!checked} onChange={() => onToggle(article.id)} className="mt-1 shrink-0 cursor-pointer"
          aria-label={`Use "${article.title}" in the brief`} title="Use this article in the brief"
        />
        <div className="min-w-0 flex-1">
          <a href={article.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium break-words hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }}>
            {article.title}
          </a>
          <p className="text-xs mt-0.5" style={muted}>{article.domain} · {formatDate(article.publishedAt)}</p>
        </div>
        <ScorePill article={article} />
      </div>
      {article.snippet && <p className="text-xs mt-1.5 leading-relaxed break-words" style={muted}>{article.snippet}</p>}
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {isShopPage(article) && (
          <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ border: '1px solid #f59e0b', color: '#b45309' }} title="This looks like a shop page (a product or a list of products), not coverage of the topic. Its score is cut to 40% and it is not ticked for a brief unless you tick it.">Shop page</span>
        )}
        {showOriginal && article.isOriginal && (
          <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-primary)', color: '#fff' }} title="The earliest article found on this story, when two or more outlets covered it">Original</span>
        )}
        {badges.map((b) => (
          <span key={b.id} className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>{b.text}</span>
        ))}
        <span className="text-xs" style={muted}>{readNote(article.pageRead)}</span>
      </div>
    </li>
  );
}

// One topic's latest search: the stories it found (articles grouped by what they are about), best first, and any source that failed.
// "Search again" runs the topic afresh. When the owner has changed a ranking setting since the search, the page re-ranks it by itself.
// `pinnedRunId` opens one earlier search (from History) instead of the latest, with a note and a way back to the latest.
export default function ResultsView({ topicId, pinnedRunId = null, onShowLatest, onBack, onTopicChanged, onOpenBrief }) {
  const getIcon = useIcon();
  const [data, setData] = useState(null); // { run, topic, stories, articles }
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('stories');
  const [open, setOpen] = useState({});
  const [reranked, setReranked] = useState(false);
  const [picked, setPicked] = useState(new Set()); // article ids ticked for a brief
  const [angle, setAngle] = useState('');
  const [briefs, setBriefs] = useState([]); // earlier briefs for this search
  const [relevance, setRelevance] = useState(null); // the check before a brief, shown when the sources look off topic
  const [model, setModel] = useState(null); // which model will write a brief: { effectiveModel, name }
  const rerankTried = useRef(new Set()); // runs already re-ranked in this visit, so a run that stays "stale" cannot loop

  const load = useCallback(async () => {
    setError('');
    try {
      const t = await api.get(`/api/topic-research/topics/${topicId}`);
      const td = await t.json();
      if (!t.ok) throw new Error(td.error || 'Could not load that topic.');
      const latest = pinnedRunId ? { id: pinnedRunId } : td.runs[0];
      if (!latest) { setData({ run: null, topic: td.topic, stories: [], articles: [] }); return; }
      let r = await api.get(`/api/topic-research/runs/${latest.id}`);
      let rd = await r.json();
      if (!r.ok) throw new Error(rd.error || 'Could not load that search.');
      if (rd.run.weightsStale && !rerankTried.current.has(latest.id)) {
        rerankTried.current.add(latest.id);
        const had = !!rd.run.ranking;
        const rr = await api.post(`/api/topic-research/runs/${latest.id}/rescore`, {});
        if (rr.ok) {
          r = await api.get(`/api/topic-research/runs/${latest.id}`);
          const again = await r.json();
          if (r.ok) { rd = again; setReranked(had); }
        }
      }
      setData(rd);
      setOpen((cur) => (Object.keys(cur).length ? cur : { [rd.stories[0]?.id]: true }));
    } catch (e) { setError(e.message || 'Could not reach the server.'); } finally { setLoading(false); }
  }, [topicId, pinnedRunId]);

  useEffect(() => { setLoading(true); setData(null); setReranked(false); rerankTried.current = new Set(); load(); }, [load]);

  // the model Settings -> Topic Research has chosen for briefs (or the workspace default), shown above the Generate button
  useEffect(() => {
    let live = true;
    api.get('/api/topic-research/model-config').then((r) => r.json()).then((d) => {
      if (!live || !d) return;
      const hit = (d.choices || []).find((m) => m.id === d.effectiveModel);
      setModel(d.effectiveModel ? { id: d.effectiveModel, name: hit?.name || d.effectiveModel, own: !!d.modelId } : { id: null });
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  // a fresh search starts with its best ten articles ticked for a brief, and shows the briefs already written for it
  const runId = data?.run?.id;
  useEffect(() => {
    if (data) { setPicked(defaultSelection(data.articles)); setAngle(''); }
  }, [runId]); // eslint-disable-line react-hooks/exhaustive-deps
  // the list is re-read when a brief is deleted or brought back from the Brief page (it announces that with this event)
  const loadBriefs = useCallback(async () => {
    if (!runId) { setBriefs([]); return; }
    try {
      const r = await api.get(`/api/topic-research/runs/${runId}/briefs`);
      const d = await r.json();
      if (r.ok && Array.isArray(d.briefs)) setBriefs(d.briefs);
    } catch { /* the list simply stays as it was */ }
  }, [runId]);
  useEffect(() => {
    loadBriefs();
    window.addEventListener(BRIEFS_CHANGED, loadBriefs);
    return () => window.removeEventListener(BRIEFS_CHANGED, loadBriefs);
  }, [loadBriefs]);

  // First a small check that the ticked articles are about the topic. Good: write the brief at once. Mixed or poor: say so and let the person decide.
  // A check that could not run (no model, a fault) never blocks the brief; running out of this month's limit does.
  const generate = async () => {
    if (!selectionNote(picked.size).ok) return;
    setError(''); setRelevance(null);
    try {
      const r = await withProgress({ title: 'Checking the sources…', detail: 'A quick check before the brief is written.', steps: RELEVANCE_STEP_LABELS, poll: false }, () => api.post(`/api/topic-research/runs/${runId}/relevance`, { articleIds: [...picked] }));
      const d = await r.json().catch(() => ({}));
      if (r.status === 402) throw new Error(d.error || 'The monthly limit has been reached.');
      if (r.ok && d.relevance && d.relevance.verdict !== 'good') { setRelevance(d.relevance); return; }
    } catch (e) { setError(e.message || 'Could not reach the server.'); return; }
    await writeBrief();
  };
  const writeBrief = async () => {
    setRelevance(null);
    try {
      const r = await withProgress({ title: 'Writing the brief…', detail: 'This can take up to a minute and a half.', steps: BRIEF_STEP_LABELS }, (opId) => api.post(`/api/topic-research/runs/${runId}/brief`, { articleIds: [...picked], angle, opId }));
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(explainFailure(r, d, 'Could not write the brief.'));
      onOpenBrief(d.brief.id);
    } catch (e) { setError(e.message || 'Could not reach the server.'); }
  };
  const togglePick = (id) => setPicked((cur) => toggleSelection(cur, id));

  const searchAgain = async () => {
    try {
      const r = await withProgress({ title: 'Searching…', detail: 'This can take up to half a minute.', steps: SEARCH_STEP_LABELS }, (opId) => api.post(`/api/topic-research/topics/${topicId}/run`, { opId }));
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(explainFailure(r, d, 'Could not search.'));
      setOpen({}); setReranked(false);
      await load();
      onTopicChanged?.();
    } catch (e) { setError(e.message || 'Could not reach the server.'); }
  };

  const surface = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
  const text = { color: 'var(--color-text)' };
  const muted = { color: 'var(--color-muted)' };

  if (loading) return <p className="text-sm" style={muted}>Loading…</p>;
  if (!data) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={onBack} className="text-sm hover:opacity-70 transition-opacity" style={muted}>← All topics</button>
        <p className="text-sm" style={{ color: '#ef4444' }}>{error || 'That topic could not be found.'}</p>
      </div>
    );
  }

  const { run, topic, stories, articles } = data;
  const status = statusLabel(run?.status);
  const labels = Object.fromEntries((run?.sources || []).map((s) => [s.id, s.label]));
  const paa = run?.extras?.peopleAlsoAsk || [];
  const related = run?.extras?.relatedSearches || [];
  const byId = new Map(articles.map((a) => [a.id, a]));
  const heat = heatBadge(run?.heat);
  const note = rankingNote(run?.ranking);
  const sel = selectionNote(picked.size);
  const toggleBtn = (id, label) => (
    <button
      key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}
      className="px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity"
      style={view === id ? { background: 'var(--color-primary)', color: '#fff' } : { border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
    >{label}</button>
  );

  return (
    <div className="space-y-4">
      <WorkflowBar view="results" reached={briefs.length ? ['brief'] : []} go={{ search: onBack, brief: () => { if (briefs[0]) onOpenBrief(briefs[0].id); } }} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className="text-sm hover:opacity-70 transition-opacity" style={muted}>← All topics</button>
        <h2 className="text-lg font-semibold flex-1 min-w-0 break-words" style={text}>
          {topic.keyword}
          {heat && <span className="ml-3 align-middle text-xs font-medium px-2 py-0.5 rounded-lg border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }} title={heat.tip}>{heat.text}</span>}
        </h2>
        <button
          type="button" onClick={searchAgain}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity"
          style={{ background: 'var(--color-primary)', color: '#fff' }}
        >
          {getIcon('refresh-cw', { size: 14 })}Search again
        </button>
      </div>

      {pinnedRunId && run && (
        <div className="rounded-xl border p-3 flex flex-wrap items-center gap-3 text-sm" style={{ ...surface, background: 'var(--color-bg)' }} role="status">
          <span className="flex-1 min-w-0" style={text}>This is an earlier search, from {formatDate(run.startedAt)}.</span>
          {onShowLatest && <button type="button" onClick={onShowLatest} className="font-medium hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }}>See the latest search</button>}
        </div>
      )}

      {run && (
        <div className="space-y-0.5" data-guide="searched">
          <p className="text-xs" style={muted}>{searchedForLine(run.queries, topic.keyword)}</p>
          {notUsedLine(run.notAsked) && <p className="text-xs" style={muted}>{notUsedLine(run.notAsked)}</p>}
        </div>
      )}

      {run && (
        <p className="text-xs" style={muted}>
          Searched {timeAgo(run.finishedAt || run.startedAt)} ·{' '}
          <span style={{ color: LEVEL[status.level] }}>{status.text}</span> · {articles.length} article{articles.length === 1 ? '' : 's'}
          {stories.length > 0 && <> in {stories.length} {stories.length === 1 ? 'story' : 'stories'}</>}
        </p>
      )}
      {reranked && <p className="text-xs" style={muted} role="status">Re-ranked with your current ranking settings.</p>}
      {run?.sources?.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="What each source found">
          {run.sources.map((s) => (
            <span
              key={s.id} className="text-xs px-2 py-1 rounded-lg border"
              style={{ borderColor: s.answered === 0 ? '#f59e0b' : 'var(--color-border)', color: s.answered === 0 ? '#b45309' : 'var(--color-text)', background: 'var(--color-surface)' }}
              title={s.cached ? 'Saved from an earlier search today, so it cost nothing. Press Search again to ask afresh.' : undefined}
            >
              {sourceChip(s)}
            </span>
          ))}
        </div>
      )}
      {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}

      {run?.errors?.length > 0 && (
        <div className="rounded-xl border p-3 space-y-1" style={{ borderColor: '#f59e0b', background: 'var(--color-surface)' }} role="status">
          <p className="text-sm font-medium" style={text}>{run.errors.length === 1 ? 'One source had a problem' : `${run.errors.length} sources had a problem`}. The rest were searched.</p>
          {run.errors.map((e, i) => (
            <p key={`${e.source}-${i}`} className="text-xs break-words" style={muted}><strong style={text}>{e.source}</strong> — {e.message}</p>
          ))}
        </div>
      )}

      {(paa.length > 0 || related.length > 0) && (
        <div className="rounded-xl border p-4 space-y-3" style={surface}>
          {paa.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold" style={text}>People also ask</h3>
              <ul className="mt-1 space-y-1">
                {paa.map((q) => <li key={q.question} className="text-sm" style={text}>{q.question}</li>)}
              </ul>
            </div>
          )}
          {related.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold" style={text}>Related searches</h3>
              <p className="text-sm mt-1 leading-relaxed" style={muted}>{related.join(' · ')}</p>
            </div>
          )}
        </div>
      )}

      {!run && <p className="text-sm" style={muted}>This topic has not been searched yet. Press Search again.</p>}
      {run && articles.length === 0 && (
        <p className="text-sm leading-relaxed" style={muted}>
          Nothing the sources found mentions every word of this topic in the last 30 days. Try fewer words, or add more feeds in Settings.
        </p>
      )}

      {articles.length > 0 && (
        <>
          <div className="rounded-xl border p-4 space-y-3" style={surface}>
            <p className="text-sm font-semibold" style={text}>Write a research brief</p>
            <p className="text-xs leading-relaxed" style={muted}>
              Tick the articles to use below (the best ten start ticked). You get notes to write your own piece from: the facts with their sources, how outlets framed it, what is missing, three angles for your site and an outline. It never writes the article for you.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={angle} onChange={(e) => setAngle(e.target.value)} maxLength={200} placeholder="Angle for the outline (optional)" aria-label="Angle for the outline"
                className="flex-1 px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
              <button
                type="button" onClick={generate} disabled={!sel.ok}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity disabled:opacity-40"
                style={{ background: 'var(--color-primary)', color: '#fff' }}
              >
                {getIcon('sparkles', { size: 14 })}Generate brief
              </button>
            </div>
            <p className="text-xs" style={sel.ok ? muted : { color: '#b45309' }} role="status">{sel.text}</p>
            {model && (
              <p className="text-xs" style={muted}>
                {model.id ? <>Written by <strong>{model.name}</strong>{model.own ? '' : ' (the workspace default)'}. Change it in Vault Settings, under Topic Research.</> : 'No AI model is set up yet, so a brief cannot be written. Ask your admin to add one in Settings.'}
              </p>
            )}
            {relevance && (
              <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: '#f59e0b', background: 'var(--color-bg)' }} role="alert">
                <p className="text-sm font-semibold" style={text}>Check before you write this brief</p>
                <p className="text-sm leading-relaxed" style={text}>{relevance.message}</p>
                <ul className="space-y-1">
                  {relevance.scores.map((s) => {
                    const a = byId.get(s.id);
                    return (
                      <li key={s.id} className="text-xs break-words" style={muted}>
                        <strong style={{ color: s.score >= 2 ? '#16a34a' : '#b45309' }}>{s.score} of 3</strong> · <span style={text}>{a?.title || 'Article'}</span>{s.why ? ` — ${s.why}` : ''}
                      </li>
                    );
                  })}
                </ul>
                <PromptPanel prompt={relevance.prompt} label="What the AI was asked to check" />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setRelevance(null)} className="px-3 py-1.5 rounded-lg text-sm font-medium border hover:opacity-70 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Choose different articles</button>
                  <button type="button" onClick={onBack} className="px-3 py-1.5 rounded-lg text-sm font-medium border hover:opacity-70 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }} title="Back to the topic list, where you can search again with different words">Search again with different words</button>
                  <button type="button" onClick={writeBrief} className="px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity" style={{ background: 'var(--color-primary)', color: '#fff' }}>Write the brief anyway</button>
                </div>
              </div>
            )}
            {briefs.length > 0 && (
              <div>
                <p className="text-xs font-semibold" style={text}>Briefs already written for this search</p>
                <ul className="mt-1 space-y-1">
                  {briefs.map((b) => (
                    <li key={b.id}>
                      <button type="button" onClick={() => onOpenBrief(b.id)} className="text-sm text-left hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }}>
                        {b.chosenAngle || 'Research brief'}
                      </button>
                      <span className="text-xs" style={muted}> · {timeAgo(b.createdAt)} · {b.factCount} facts{b.overlapCount ? ` · ${b.overlapCount} to rewrite` : ''}{costText(b.costUsd) ? ` · ${costText(b.costUsd)}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-2" role="group" aria-label="How to show the results">
              {toggleBtn('stories', 'Stories')}
              {toggleBtn('all', 'All articles')}
            </div>
            {note && <p className="text-xs flex-1 min-w-[12rem]" style={muted}>{note}</p>}
          </div>

          {view === 'stories' && stories.length > 0 && (
            <ul className="space-y-3">
              {stories.map((s) => {
                const list = s.articleIds.map((id) => byId.get(id)).filter(Boolean);
                const lead = byId.get(s.originalId) || list[0];
                const isOpen = !!open[s.id];
                return (
                  <li key={s.id} className="rounded-2xl border" style={surface}>
                    <button
                      type="button" aria-expanded={isOpen} onClick={() => setOpen((cur) => ({ ...cur, [s.id]: !cur[s.id] }))}
                      className="w-full flex items-start gap-3 p-4 text-left hover:opacity-70 transition-opacity"
                    >
                      <span className="mt-0.5 shrink-0" style={muted}>{getIcon(isOpen ? 'chevron-down' : 'chevron-right', { size: 16 })}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold break-words" style={text}>{lead?.title}</span>
                        <span className="block text-xs mt-0.5" style={muted}>
                          {s.outlets} {s.outlets === 1 ? 'outlet' : 'outlets'} · {list.length} {list.length === 1 ? 'article' : 'articles'}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-lg" style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} title="The best score of any article in this story">{s.bestScore.toFixed(1)}</span>
                    </button>
                    {isOpen && (
                      <ul className="space-y-2 px-4 pb-4">
                        {list.map((a) => <ArticleRow key={a.id} article={a} labels={labels} checked={picked.has(a.id)} onToggle={togglePick} />)}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {(view === 'all' || stories.length === 0) && (
            <ul className="space-y-2">
              {articles.map((a) => <ArticleRow key={a.id} article={a} labels={labels} checked={picked.has(a.id)} onToggle={togglePick} />)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
