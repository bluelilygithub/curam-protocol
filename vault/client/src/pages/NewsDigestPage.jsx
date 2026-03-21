import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/apiClient';
import useToastStore from '../store/toastStore';
import ConfirmModal from '../components/ConfirmModal';
import TopicChat from '../components/newsDigest/TopicChat';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.includes('T') ? '' : 'T00:00:00'));
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function prevDay(iso) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function nextDay(iso) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);

// ── Small components ──────────────────────────────────────────────────────────

function SectionPill({ emoji, label, color }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: color + '22', color }}
    >
      {emoji} {label}
    </span>
  );
}

function SubList({ label, items, color, icon = '•' }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      {label && <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>{label}</p>}
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="text-sm flex gap-2" style={{ color: 'var(--color-text)' }}>
            <span className="flex-shrink-0 mt-0.5" style={{ color }}>{icon}</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PerspectiveBlock({ emoji, label, color, data }) {
  const [open, setOpen] = useState(false);
  if (!data) return null;

  return (
    <div className="border rounded-xl overflow-hidden" style={{ borderColor: color + '44' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
        style={{ background: color + '11' }}
      >
        <span className="text-base">{emoji}</span>
        <span className="font-semibold text-sm flex-1" style={{ color }}>{label}</span>
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 py-3 space-y-3" style={{ background: 'var(--color-bg)' }}>
          {data.summary && (
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>{data.summary}</p>
          )}

          {/* Unbiased-only deep analysis fields */}
          {data.timeline && data.timeline.length > 0 && (
            <SubList label="Timeline" items={data.timeline} color={color} icon="→" />
          )}
          <SubList items={data.keyFacts}  color={color} />
          <SubList items={data.keyPoints} color={color} />
          {data.mechanisms && data.mechanisms.length > 0 && (
            <SubList label="How it works" items={data.mechanisms} color={color} icon="⚙" />
          )}
          {data.actorMotivations && data.actorMotivations.length > 0 && (
            <SubList label="Actor motivations" items={data.actorMotivations} color={color} icon="▸" />
          )}
          {data.uncertainties && data.uncertainties.length > 0 && (
            <SubList label="Gaps & uncertainties" items={data.uncertainties} color="#f59e0b" icon="?" />
          )}
          {data.sourceCredibility && (
            <p className="text-xs px-3 py-2 rounded-lg italic" style={{ background: '#f59e0b11', color: '#b45309' }}>
              Source note: {data.sourceCredibility}
            </p>
          )}

          {/* Left/Right specific fields */}
          {data.agreedFacts && data.agreedFacts.length > 0 && (
            <SubList label="Agreed facts" items={data.agreedFacts} color={color} icon="✓" />
          )}
          {data.coreDisagreement && (
            <p className="text-sm italic" style={{ color: 'var(--color-muted)' }}>
              Core disagreement: {data.coreDisagreement}
            </p>
          )}
          {data.emphasis && (
            <p className="text-xs px-3 py-2 rounded-lg" style={{ background: color + '11', color }}>
              Emphasis: {data.emphasis}
            </p>
          )}

          {data.sources && data.sources.length > 0 && (
            <div className="pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
              <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>Sources</p>
              <ul className="space-y-1">
                {data.sources.map((s, i) => (
                  <li key={i} className="text-xs flex gap-1.5 items-start">
                    <span className="flex-shrink-0 mt-0.5 opacity-40">{s.source}</span>
                    <a href={s.url} target="_blank" rel="noopener noreferrer"
                      className="hover:underline truncate" style={{ color }} title={s.title}>
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TopicCard({ result, date, onCommentarySave }) {
  const { topicId, title, analysis, articles, commentary: initCommentary } = result;
  const [expanded, setExpanded] = useState(false);
  const [commentary, setCommentary] = useState(initCommentary || '');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const saveTimer = useRef(null);
  const { addToast } = useToastStore();

  function buildCopyText() {
    const ana = analysis || {};
    const lines = [`# ${title}`, ''];

    function addBlock(label, data) {
      if (!data) return;
      lines.push(`## ${label}`);
      if (data.summary)              lines.push(data.summary);
      if (data.timeline?.length)     { lines.push(''); lines.push('Timeline:'); data.timeline.forEach(t => lines.push(`→ ${t}`)); }
      if (data.keyFacts?.length)     { lines.push(''); data.keyFacts.forEach(f => lines.push(`• ${f}`)); }
      if (data.keyPoints?.length)    { data.keyPoints.forEach(p => lines.push(`• ${p}`)); }
      if (data.mechanisms?.length)   { lines.push(''); lines.push('How it works:'); data.mechanisms.forEach(m => lines.push(`⚙ ${m}`)); }
      if (data.actorMotivations?.length) { lines.push(''); lines.push('Actor motivations:'); data.actorMotivations.forEach(m => lines.push(`▸ ${m}`)); }
      if (data.uncertainties?.length)    { lines.push(''); lines.push('Gaps & uncertainties:'); data.uncertainties.forEach(u => lines.push(`? ${u}`)); }
      if (data.sourceCredibility)    { lines.push(''); lines.push(`Source note: ${data.sourceCredibility}`); }
      if (data.agreedFacts?.length)  { lines.push(''); lines.push('Agreed facts:'); data.agreedFacts.forEach(f => lines.push(`✓ ${f}`)); }
      if (data.coreDisagreement)     lines.push(`Core disagreement: ${data.coreDisagreement}`);
      if (data.emphasis)             lines.push(`Emphasis: ${data.emphasis}`);
      lines.push('');
    }

    addBlock('Unbiased Summary', ana.unbiased);
    addBlock('Left-leaning perspective', ana.left);
    addBlock('Right-leaning perspective', ana.right);
    addBlock('Common ground', ana.commonGround);

    const articleList = Array.isArray(articles) ? articles : [];
    if (articleList.length > 0) {
      lines.push('## Sources');
      articleList.slice(0, 10).forEach(a => lines.push(`• [${a.source}] ${a.title}${a.link ? ' — ' + a.link : ''}`));
      lines.push('');
    }

    if (commentary) {
      lines.push('## My notes');
      lines.push(commentary);
    }

    return lines.join('\n');
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildCopyText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast('Failed to copy to clipboard', 'error');
    }
  }

  // Auto-save commentary after 1.5s idle
  const handleCommentaryChange = (val) => {
    setCommentary(val);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await api.put(`/api/news-digest/context/${topicId}`, { date, commentary: val });
        onCommentarySave(topicId, val);
      } catch {
        addToast('Failed to save commentary', 'error');
      } finally {
        setSaving(false);
      }
    }, 1500);
  };

  const ana = analysis || {};
  const articleList = Array.isArray(articles) ? articles : [];

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      {/* Header */}
      <div
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-3 px-5 py-4 text-left cursor-pointer"
      >
        <span className="text-xl mt-0.5">📰</span>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{title}</h3>
          {ana.unbiased?.summary && !expanded && (
            <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--color-muted)' }}>
              {ana.unbiased.summary}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 mt-1">
          {expanded && (
            <button
              onClick={e => { e.stopPropagation(); handleCopy(); }}
              className="flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium transition-all"
              style={{
                borderColor: copied ? '#22c55e' : 'var(--color-border)',
                color:       copied ? '#16a34a' : 'var(--color-muted)',
                background:  copied ? '#22c55e11' : 'transparent',
              }}
              title="Copy card content"
            >
              {copied ? '✓' : '⎘'}
            </button>
          )}
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {articleList.length} articles {expanded ? '▲' : '▼'}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-5 space-y-4">
          {/* Unbiased summary always shown first */}
          <PerspectiveBlock
            emoji="📋"
            label="Unbiased Summary"
            color="#6366f1"
            data={ana.unbiased}
          />

          {/* Left / Right / Common */}
          <PerspectiveBlock emoji="🔵" label="Left-leaning perspective" color="#3b82f6" data={ana.left} />
          <PerspectiveBlock emoji="🔴" label="Right-leaning perspective" color="#ef4444" data={ana.right} />
          <PerspectiveBlock emoji="⚖️" label="Common ground" color="#10b981" data={ana.commonGround} />

          {/* Sources */}
          {articleList.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer font-medium mb-2" style={{ color: 'var(--color-muted)' }}>
                Sources ({articleList.length})
              </summary>
              <ul className="space-y-1 mt-2">
                {articleList.slice(0, 10).map((a, i) => (
                  <li key={i} className="flex gap-2 items-start">
                    <span className="flex-shrink-0 opacity-50">{a.source}</span>
                    <a
                      href={a.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline truncate"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      {a.title}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Commentary */}
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--color-muted)' }}>
              Your commentary {saving && <span className="opacity-50 font-normal">(saving…)</span>}
            </label>
            <textarea
              value={commentary}
              onChange={e => handleCommentaryChange(e.target.value)}
              rows={3}
              placeholder="Add your thoughts, reactions, or notes… (saved automatically, used as context for tomorrow's digest)"
              className="w-full px-3 py-2 rounded-lg border text-sm resize-y"
              style={{
                background: 'var(--color-bg)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)',
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
          </div>

          {/* Per-topic Q&A chat */}
          <TopicChat topicId={topicId} />
        </div>
      )}
    </div>
  );
}

// ── Topic management panel ────────────────────────────────────────────────────

function TopicForm({ initial, onSave, onCancel }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [keywords, setKeywords] = useState(initial?.keywords || '');

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Topic title (e.g. Climate policy Australia)"
        autoFocus
        className="w-full px-3 py-2 rounded-lg border text-sm"
        style={{
          background: 'var(--color-bg)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-text)',
          fontFamily: 'inherit',
          outline: 'none',
        }}
      />
      <input
        type="text"
        value={keywords}
        onChange={e => setKeywords(e.target.value)}
        placeholder="Extra keywords (optional, comma-separated)"
        className="w-full px-3 py-2 rounded-lg border text-sm"
        style={{
          background: 'var(--color-bg)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-text)',
          fontFamily: 'inherit',
          outline: 'none',
        }}
      />
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-sm border"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          Cancel
        </button>
        <button
          onClick={() => title.trim() && onSave({ title: title.trim(), keywords: keywords.trim() })}
          disabled={!title.trim()}
          className="px-3 py-1.5 rounded-lg text-sm font-medium text-white"
          style={{ background: title.trim() ? 'var(--color-primary)' : 'var(--color-border)' }}
        >
          {initial ? 'Save' : 'Add topic'}
        </button>
      </div>
    </div>
  );
}

function TopicsPanel({ topics, onTopicsChange }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const { addToast } = useToastStore();

  const handleAdd = async ({ title, keywords }) => {
    try {
      const res = await api.post('/api/news-digest/topics', { title, keywords });
      const topic = await res.json();
      onTopicsChange([...topics, topic]);
      setAdding(false);
      addToast('Topic added');
    } catch {
      addToast('Failed to add topic', 'error');
    }
  };

  const handleEdit = async (id, { title, keywords }) => {
    try {
      const res = await api.put(`/api/news-digest/topics/${id}`, { title, keywords });
      const updated = await res.json();
      onTopicsChange(topics.map(t => t.id === id ? updated : t));
      setEditingId(null);
      addToast('Topic updated');
    } catch {
      addToast('Failed to update topic', 'error');
    }
  };

  const handleToggle = async (topic) => {
    try {
      const res = await api.put(`/api/news-digest/topics/${topic.id}`, { active: !topic.active });
      const updated = await res.json();
      onTopicsChange(topics.map(t => t.id === topic.id ? updated : t));
    } catch {
      addToast('Failed to update topic', 'error');
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/api/news-digest/topics/${id}`);
      onTopicsChange(topics.filter(t => t.id !== id));
      setDeleteConfirm(null);
      addToast('Topic deleted');
    } catch {
      addToast('Failed to delete topic', 'error');
    }
  };

  // Drag-to-reorder
  const handleDrop = async (targetId) => {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return; }
    const fromIdx = topics.findIndex(t => t.id === dragId);
    const toIdx   = topics.findIndex(t => t.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...topics];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    onTopicsChange(reordered);
    setDragId(null);
    setDragOverId(null);
    try {
      await api.put('/api/news-digest/topics/reorder', { ids: reordered.map(t => t.id) });
    } catch {
      addToast('Failed to save order', 'error');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          Topics ({topics.length})
        </h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="text-xs px-2.5 py-1 rounded-lg font-medium text-white"
            style={{ background: 'var(--color-primary)' }}
          >
            + Add topic
          </button>
        )}
      </div>

      {adding && (
        <div
          className="p-3 rounded-xl border"
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
        >
          <TopicForm onSave={handleAdd} onCancel={() => setAdding(false)} />
        </div>
      )}

      {topics.map(topic => (
        <div
          key={topic.id}
          draggable
          onDragStart={() => setDragId(topic.id)}
          onDragOver={e => { e.preventDefault(); setDragOverId(topic.id); }}
          onDragLeave={() => setDragOverId(null)}
          onDrop={() => handleDrop(topic.id)}
          onDragEnd={() => { setDragId(null); setDragOverId(null); }}
          className="rounded-xl border p-3 transition-opacity"
          style={{
            background: 'var(--color-bg)',
            borderColor: dragOverId === topic.id ? 'var(--color-primary)' : 'var(--color-border)',
            opacity: dragId === topic.id ? 0.4 : 1,
            cursor: 'grab',
          }}
        >
          {editingId === topic.id ? (
            <TopicForm
              initial={topic}
              onSave={data => handleEdit(topic.id, data)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div className="flex items-start gap-2">
              <span className="text-base mt-0.5 select-none opacity-40">⠿</span>
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-medium"
                  style={{ color: topic.active ? 'var(--color-text)' : 'var(--color-muted)' }}
                >
                  {topic.title}
                </p>
                {topic.keywords && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                    Keywords: {topic.keywords}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => handleToggle(topic)}
                  className="text-xs px-2 py-0.5 rounded-full border"
                  style={{
                    borderColor: topic.active ? '#22c55e44' : 'var(--color-border)',
                    color: topic.active ? '#16a34a' : 'var(--color-muted)',
                    background: topic.active ? '#22c55e11' : 'transparent',
                  }}
                  title={topic.active ? 'Disable topic' : 'Enable topic'}
                >
                  {topic.active ? 'On' : 'Off'}
                </button>
                <button
                  onClick={() => setEditingId(topic.id)}
                  className="w-6 h-6 flex items-center justify-center rounded hover:opacity-60 text-xs"
                  style={{ color: 'var(--color-muted)' }}
                  title="Edit"
                >
                  ✎
                </button>
                <button
                  onClick={() => setDeleteConfirm(topic)}
                  className="w-6 h-6 flex items-center justify-center rounded hover:opacity-60 text-xs"
                  style={{ color: '#ef4444' }}
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {topics.length === 0 && !adding && (
        <p className="text-sm text-center py-6" style={{ color: 'var(--color-muted)' }}>
          No topics yet. Add one to start receiving daily digests.
        </p>
      )}

      {deleteConfirm && (
        <ConfirmModal
          title="Delete topic?"
          message={`"${deleteConfirm.title}" and all its digests will be permanently deleted.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => handleDelete(deleteConfirm.id)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NewsDigestPage() {
  const [tab, setTab] = useState('digest'); // 'digest' | 'topics'
  const [date, setDate] = useState(today());
  const [digestData, setDigestData] = useState(null);
  const [loadingDigest, setLoadingDigest] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [topics, setTopics] = useState([]);
  const [availableDates, setAvailableDates] = useState([]);
  const { addToast } = useToastStore();

  // Load topics once
  useEffect(() => {
    api.get('/api/news-digest/topics')
      .then(r => r.json())
      .then(setTopics)
      .catch(() => {});

    api.get('/api/news-digest/dates')
      .then(r => r.json())
      .then(setAvailableDates)
      .catch(() => {});
  }, []);

  // Load digest whenever date changes
  const loadDigest = useCallback(async (d) => {
    setLoadingDigest(true);
    setDigestData(null);
    try {
      const res = await api.get(`/api/news-digest?date=${d}`);
      const data = await res.json();
      setDigestData(data);
    } catch {
      addToast('Failed to load digest', 'error');
    } finally {
      setLoadingDigest(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (tab === 'digest') loadDigest(date);
  }, [date, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await api.post('/api/news-digest/generate', { date });
      addToast('Digest generation started — this may take a minute');
      // Poll for completion
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const res = await api.get(`/api/news-digest?date=${date}`);
          const data = await res.json();
          if (data.topicResults && data.topicResults.length > 0) {
            setDigestData(data);
            clearInterval(poll);
            setGenerating(false);
            // Add date to available dates if not already present
            setAvailableDates(prev => prev.includes(date) ? prev : [date, ...prev].sort().reverse());
          }
        } catch {}
        if (attempts > 30) { clearInterval(poll); setGenerating(false); }
      }, 5000);
    } catch {
      addToast('Failed to start generation', 'error');
      setGenerating(false);
    }
  };

  const handleCommentarySave = useCallback((topicId, commentary) => {
    setDigestData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        topicResults: prev.topicResults.map(r =>
          r.topicId === topicId ? { ...r, commentary } : r
        ),
      };
    });
  }, []);

  const isToday = date === today();
  const canGoForward = date < today();

  return (
    <div className="h-full flex flex-col" style={{ color: 'var(--color-text)' }}>
      {/* Page header */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <span className="text-lg">📰</span>
        <h1 className="text-base font-semibold flex-1">News Digest</h1>

        {/* Tab toggle */}
        <div data-tour="news-tab-toggle" className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {[['digest', 'Digest'], ['topics', 'Topics']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="px-3 py-1.5 text-xs font-medium"
              style={{
                background: tab === key ? 'var(--color-primary)' : 'transparent',
                color: tab === key ? '#fff' : 'var(--color-muted)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {tab === 'topics' ? (
          <div className="max-w-xl mx-auto px-4 py-6">
            <TopicsPanel topics={topics} onTopicsChange={setTopics} />
          </div>
        ) : (
          <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
            {/* Date navigation */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setDate(d => prevDay(d))}
                className="w-8 h-8 flex items-center justify-center rounded-lg border hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                ←
              </button>

              <div className="flex-1 text-center">
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {formatDate(date)}
                </p>
                {isToday && (
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Today</span>
                )}
              </div>

              <button
                onClick={() => canGoForward && setDate(d => nextDay(d))}
                disabled={!canGoForward}
                className="w-8 h-8 flex items-center justify-center rounded-lg border hover:opacity-70 disabled:opacity-30"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                →
              </button>
            </div>

            {/* Date picker dropdown */}
            {availableDates.length > 0 && (
              <div className="flex justify-center">
                <select
                  value={availableDates.includes(date) ? date : ''}
                  onChange={e => e.target.value && setDate(e.target.value)}
                  className="text-xs px-2 py-1 rounded-lg border"
                  style={{
                    background: 'var(--color-bg)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-muted)',
                    outline: 'none',
                  }}
                >
                  <option value="">Jump to date…</option>
                  {availableDates.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Loading state */}
            {loadingDigest && (
              <div className="text-center py-12">
                <div
                  className="inline-block w-6 h-6 border-2 rounded-full animate-spin"
                  style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-primary)' }}
                />
                <p className="text-sm mt-3" style={{ color: 'var(--color-muted)' }}>Loading digest…</p>
              </div>
            )}

            {/* No digest yet */}
            {!loadingDigest && digestData && !digestData.digest && (
              <div
                className="rounded-2xl border p-8 text-center space-y-4"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
              >
                <p className="text-4xl">📭</p>
                <p className="font-semibold" style={{ color: 'var(--color-text)' }}>
                  No digest for {formatDate(date)}
                </p>
                {topics.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                    Add topics first to start receiving digests.
                    <button
                      onClick={() => setTab('topics')}
                      className="ml-1 underline"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      Manage topics →
                    </button>
                  </p>
                ) : (
                  <>
                    <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                      Digests are generated automatically at 7am. You can also generate one now.
                    </p>
                    <button
                      onClick={handleGenerate}
                      disabled={generating}
                      className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                      style={{ background: 'var(--color-primary)' }}
                    >
                      {generating ? 'Generating…' : 'Generate now'}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Digest content */}
            {!loadingDigest && digestData?.topicResults?.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {digestData.topicResults.length} topic{digestData.topicResults.length !== 1 ? 's' : ''}
                    {digestData.digest?.generatedAt && (
                      <span> · Generated {new Date(digestData.digest.generatedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}</span>
                    )}
                  </p>
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="text-xs px-2.5 py-1 rounded-lg border disabled:opacity-50"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                  >
                    {generating ? 'Refreshing…' : '↻ Refresh'}
                  </button>
                </div>

                <div className="space-y-3">
                  {digestData.topicResults.map(result => (
                    <TopicCard
                      key={result.topicId}
                      result={result}
                      date={date}
                      onCommentarySave={handleCommentarySave}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
