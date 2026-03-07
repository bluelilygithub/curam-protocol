import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useSettingsStore from '../store/settingsStore';
import api from '../utils/apiClient';
import { MODELS } from '../utils/models';

const DEBATE_MODELS = MODELS;

function getDebateModelById(id) {
  return DEBATE_MODELS.find((m) => m.id === id) || MODELS[1];
}

function LoadingDots() {
  return (
    <div className="flex items-center gap-1.5 py-4">
      <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--color-primary)', animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--color-primary)', animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--color-primary)', animationDelay: '300ms' }} />
    </div>
  );
}

const mdComponents = {
  code({ node, inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    return !inline && match ? (
      <SyntaxHighlighter
        style={oneDark}
        language={match[1]}
        PreTag="div"
        customStyle={{ borderRadius: '10px', fontSize: '0.8em', margin: '0.75em 0' }}
        {...props}
      >
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    ) : (
      <code
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', padding: '1px 5px', borderRadius: '4px', fontSize: '0.83em' }}
        {...props}
      >
        {children}
      </code>
    );
  },
  p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 pl-4 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 pl-4 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="list-disc">{children}</li>,
  h1: ({ children }) => <h1 className="text-base font-semibold mt-4 mb-2">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-semibold mt-3 mb-1.5">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-medium mt-2 mb-1">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 pl-3 my-2" style={{ borderColor: 'var(--color-primary)', color: 'var(--color-muted)' }}>
      {children}
    </blockquote>
  ),
};

function MarkdownContent({ text }) {
  return (
    <div className="prose prose-sm max-w-none text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{text}</ReactMarkdown>
    </div>
  );
}

function DebatePage() {
  const getIcon = useIcon();
  const { token } = useAuthStore();
  const { allowedFileTypes } = useSettingsStore();

  // Setup state
  const [phase, setPhase] = useState('setup');
  const [topic, setTopic] = useState('');
  const [modelA, setModelA] = useState('claude-haiku-4-5-20251001');
  const [modelB, setModelB] = useState('claude-sonnet-4-6');
  const [saveDebate, setSaveDebate] = useState(false);
  const [saveProjectId, setSaveProjectId] = useState('');
  const [projects, setProjects] = useState([]);

  // Shared context files
  const [sharedFiles, setSharedFiles] = useState([]); // [{ name, extractedText, isImage, base64, mediaType }]
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef(null);

  // Debate state
  const [debateId, setDebateId] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [userComment, setUserComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [viewingRound, setViewingRound] = useState(null); // null = live

  // Summary state
  const [summary, setSummary] = useState('');
  const [loadingSummary, setLoadingSummary] = useState(false);

  const [error, setError] = useState('');

  const currentRoundData = rounds[rounds.length - 1];
  const currentRound = currentRoundData?.round || 0;
  const bothConverged = !loading && currentRoundData?.noChangeA && currentRoundData?.noChangeB;

  const displayedRound = viewingRound !== null
    ? rounds.find((r) => r.round === viewingRound)
    : currentRoundData;
  const isViewingHistory = viewingRound !== null;

  const modelAInfo = getDebateModelById(modelA);
  const modelBInfo = getDebateModelById(modelB);

  // Load projects when user enables save
  useEffect(() => {
    if (!saveDebate || projects.length > 0) return;
    api.get('/api/projects').then((r) => r.json()).then((data) => setProjects(data || [])).catch(() => {});
  }, [saveDebate]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileUpload = async (file) => {
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/debate/extract', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Upload failed'); }
      const data = await res.json();
      setSharedFiles((prev) => [...prev, data]);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingFile(false);
    }
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    Array.from(e.dataTransfer.files).forEach((file) => handleFileUpload(file));
  };

  const handleStart = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/api/debate/start', {
        topic: topic.trim(),
        modelA,
        modelB,
        save: saveDebate,
        projectId: saveProjectId ? parseInt(saveProjectId, 10) : undefined,
        sharedContextFiles: sharedFiles,
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Error ${res.status}`); }
      const data = await res.json();
      setRounds([{ round: 1, responseA: data.responseA, responseB: data.responseB, noChangeA: false, noChangeB: false }]);
      if (data.debateId) setDebateId(data.debateId);
      setPhase('debate');
      setViewingRound(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleNextRound = async () => {
    setLoading(true);
    setError('');
    setViewingRound(null);
    try {
      const res = await api.post('/api/debate/round', {
        debateId,
        topic: topic.trim(),
        modelA,
        modelB,
        roundNumber: currentRound + 1,
        responseA: currentRoundData.responseA,
        responseB: currentRoundData.responseB,
        userComment: userComment.trim() || undefined,
        sharedContextFiles: sharedFiles,
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Error ${res.status}`); }
      const data = await res.json();
      setRounds((prev) => [...prev, {
        round: currentRound + 1,
        responseA: data.responseA,
        responseB: data.responseB,
        noChangeA: data.noChangeA,
        noChangeB: data.noChangeB,
        userComment: userComment.trim() || undefined,
      }]);
      setUserComment('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = async () => {
    setPhase('summary');
    setLoadingSummary(true);
    setError('');
    try {
      const res = await api.post('/api/debate/summary', {
        topic: topic.trim(),
        finalResponseA: currentRoundData.responseA,
        modelA,
        finalResponseB: currentRoundData.responseB,
        modelB,
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Error ${res.status}`); }
      const data = await res.json();
      setSummary(data.summary || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingSummary(false);
    }
  };

  const handleExport = () => {
    let md = `# Debate: ${topic}\n\n`;
    md += `**Model A:** ${modelAInfo.emoji} ${modelAInfo.name}  \n**Model B:** ${modelBInfo.emoji} ${modelBInfo.name}\n\n`;
    if (sharedFiles.length) {
      md += `**Shared context files:** ${sharedFiles.map((f) => f.name).join(', ')}\n\n`;
    }
    md += `---\n\n`;
    rounds.forEach((r) => {
      md += `## Round ${r.round}\n\n`;
      if (r.userComment) md += `> User comment: ${r.userComment}\n\n`;
      md += `### ${modelAInfo.name}${r.noChangeA ? ' *(no change)*' : ''}\n\n${r.responseA}\n\n`;
      md += `### ${modelBInfo.name}${r.noChangeB ? ' *(no change)*' : ''}\n\n${r.responseB}\n\n---\n\n`;
    });
    if (summary) md += `## Synthesis\n\n${summary}\n`;
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debate-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setPhase('setup');
    setRounds([]);
    setSummary('');
    setDebateId(null);
    setError('');
    setUserComment('');
    setViewingRound(null);
    setSaveProjectId('');
  };

  // ─── PHASE 1: SETUP ───────────────────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-5">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Multi-Model Debate</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Pick two models, enter a topic, and watch them argue, critique each other, and refine their views over multiple rounds.
          </p>
        </div>

        <textarea
          value={topic}
          onChange={e => setTopic(e.target.value)}
          placeholder="Enter a debate topic or question — e.g. 'Is TypeScript worth the overhead for small projects?'"
          rows={3}
          className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none resize-none"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Model A</span>
            <select
              value={modelA}
              onChange={e => setModelA(e.target.value)}
              className="text-sm px-2.5 py-2 rounded-xl border outline-none"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            >
              {DEBATE_MODELS.map(m => <option key={m.id} value={m.id}>{m.emoji} {m.name} — {m.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Model B</span>
            <select
              value={modelB}
              onChange={e => setModelB(e.target.value)}
              className="text-sm px-2.5 py-2 rounded-xl border outline-none"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
            >
              {DEBATE_MODELS.map(m => <option key={m.id} value={m.id}>{m.emoji} {m.name} — {m.label}</option>)}
            </select>
          </div>
        </div>

        {/* Shared context files */}
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide block mb-2" style={{ color: 'var(--color-muted)' }}>
            Shared Context Files (optional)
          </span>
          <div
            className="rounded-xl border-2 border-dashed px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={allowedFileTypes}
              multiple
            onChange={(e) => { Array.from(e.target.files).forEach((f) => handleFileUpload(f)); e.target.value = ''; }}
            />
            {uploadingFile
              ? <>{getIcon('loader', { size: 14, className: 'animate-spin', style: { color: 'var(--color-muted)' } })}<span className="text-xs" style={{ color: 'var(--color-muted)' }}>Extracting…</span></>
              : <>{getIcon('upload', { size: 14, style: { color: 'var(--color-muted)' } })}<span className="text-xs" style={{ color: 'var(--color-muted)' }}>Drop a file or click to upload (PDF, TXT, image)</span></>
            }
          </div>
          {sharedFiles.length > 0 && (
            <ul className="mt-2 space-y-1">
              {sharedFiles.map((f, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  {getIcon(f.isImage ? 'file-image' : 'file-text', { size: 12, style: { color: 'var(--color-muted)' } })}
                  <span style={{ color: 'var(--color-text)' }}>{f.name}</span>
                  <button
                    onClick={() => setSharedFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="opacity-40 hover:opacity-100 transition-opacity ml-auto"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    {getIcon('x', { size: 12 })}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={saveDebate}
              onChange={e => setSaveDebate(e.target.checked)}
            />
            <span className="text-sm" style={{ color: 'var(--color-text)' }}>Save this debate to the database</span>
          </label>
          {saveDebate && (
            <div className="flex flex-col gap-1.5 ml-5">
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                Save to project (optional)
              </span>
              <select
                value={saveProjectId}
                onChange={(e) => setSaveProjectId(e.target.value)}
                className="text-sm px-2.5 py-1.5 rounded-xl border outline-none w-64"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
              >
                <option value="">No project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
        </div>

        {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}

        <button
          onClick={handleStart}
          disabled={!topic.trim() || loading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium self-start"
          style={{
            background: topic.trim() && !loading ? 'var(--color-primary)' : 'var(--color-border)',
            color: topic.trim() && !loading ? '#fff' : 'var(--color-muted)',
            opacity: topic.trim() && !loading ? 1 : 0.7,
            cursor: topic.trim() && !loading ? 'pointer' : 'default',
          }}
        >
          {loading
            ? getIcon('loader', { size: 14, className: 'animate-spin', style: { color: 'inherit' } })
            : getIcon('debate', { size: 14, style: { color: 'inherit' } })
          }
          {loading ? 'Starting…' : 'Start Debate'}
        </button>
      </div>
    );
  }

  // ─── PHASE 2 + 3: DEBATE / SUMMARY ───────────────────────────────────────────
  return (
    <div className="flex flex-col pb-8">
      {/* Sticky top bar */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b sticky top-0 z-10"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          {/* Round chips */}
          {rounds.map((r) => (
            <button
              key={r.round}
              onClick={() => setViewingRound(viewingRound === r.round ? null : r.round)}
              className="text-xs px-2 py-0.5 rounded-md border transition-colors flex-shrink-0"
              style={{
                borderColor: viewingRound === r.round ? 'var(--color-primary)' : 'var(--color-border)',
                color: viewingRound === r.round ? 'var(--color-primary)' : 'var(--color-muted)',
                background: viewingRound === r.round ? 'var(--color-primary)11' : 'transparent',
                fontWeight: r.round === currentRound && viewingRound === null ? 700 : 400,
              }}
            >
              R{r.round}
            </button>
          ))}
          <span className="text-sm truncate hidden sm:block" style={{ color: 'var(--color-muted)' }}>{topic}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {phase === 'debate' && !loading && !bothConverged && !isViewingHistory && (
            <button
              onClick={handleFinish}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              {getIcon('check', { size: 12 })}
              Finish
            </button>
          )}
          {isViewingHistory && (
            <button
              onClick={() => setViewingRound(null)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
            >
              ← Live
            </button>
          )}
          {phase === 'summary' && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              {getIcon('refresh-cw', { size: 12 })}
              New debate
            </button>
          )}
        </div>
      </div>

      {/* Viewing history banner */}
      {isViewingHistory && (
        <div
          className="px-4 py-1.5 text-xs text-center"
          style={{ background: 'var(--color-primary)11', color: 'var(--color-primary)' }}
        >
          Viewing Round {viewingRound} — <button onClick={() => setViewingRound(null)} className="underline">back to live</button>
        </div>
      )}

      {/* Two model columns */}
      <div className="grid grid-cols-1 md:grid-cols-2">
        {/* Column A */}
        <div
          className="p-4 flex flex-col gap-3 border-b md:border-b-0 md:border-r"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-center gap-2">
            <span className="text-base">{modelAInfo.emoji}</span>
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{modelAInfo.name}</span>
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
            >
              A
            </span>
          </div>
          {loading && !isViewingHistory ? (
            <LoadingDots />
          ) : (
            <>
              {displayedRound?.noChangeA && (
                <span
                  className="text-xs px-2 py-1 rounded-lg self-start"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                >
                  No change from previous round
                </span>
              )}
              {displayedRound && <MarkdownContent text={displayedRound.responseA} />}
            </>
          )}
        </div>

        {/* Column B */}
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-base">{modelBInfo.emoji}</span>
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{modelBInfo.name}</span>
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
            >
              B
            </span>
          </div>
          {loading && !isViewingHistory ? (
            <LoadingDots />
          ) : (
            <>
              {displayedRound?.noChangeB && (
                <span
                  className="text-xs px-2 py-1 rounded-lg self-start"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                >
                  No change from previous round
                </span>
              )}
              {displayedRound && <MarkdownContent text={displayedRound.responseB} />}
            </>
          )}
        </div>
      </div>

      {/* PHASE 2 — controls (only show when viewing live) */}
      {phase === 'debate' && !loading && !isViewingHistory && (
        <div
          className="px-4 pt-4 pb-2 flex flex-col gap-3 border-t"
          style={{ borderColor: 'var(--color-border)' }}
        >
          {bothConverged ? (
            <div
              className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-xl border"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            >
              <div className="flex items-center gap-2">
                {getIcon('check', { size: 14, style: { color: '#10b981' } })}
                <span className="text-sm" style={{ color: 'var(--color-text)' }}>
                  Both models have converged — no further refinement needed.
                </span>
              </div>
              <button
                onClick={handleFinish}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium flex-shrink-0"
                style={{ background: 'var(--color-primary)', color: '#fff' }}
              >
                {getIcon('sparkles', { size: 14, style: { color: 'inherit' } })}
                Show Summary
              </button>
            </div>
          ) : (
            <>
              <textarea
                value={userComment}
                onChange={e => setUserComment(e.target.value)}
                placeholder="Add your thoughts to guide the next round (optional)"
                rows={2}
                className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none resize-none"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
              />
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={handleNextRound}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
                  style={{ background: 'var(--color-primary)', color: '#fff' }}
                >
                  {getIcon('refresh-cw', { size: 14, style: { color: 'inherit' } })}
                  Next Round
                </button>
                <button
                  onClick={handleFinish}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                >
                  Finish
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* PHASE 3 — summary */}
      {phase === 'summary' && (
        <div
          className="px-4 pt-6 flex flex-col gap-4 border-t"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Synthesis</h2>
            {summary && (
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                {getIcon('file-down', { size: 12 })}
                Export Markdown
              </button>
            )}
          </div>
          {loadingSummary ? (
            <LoadingDots />
          ) : (
            <div
              className="rounded-xl border p-4"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            >
              <MarkdownContent text={summary} />
            </div>
          )}
        </div>
      )}

      {error && <p className="px-4 pt-3 text-sm" style={{ color: '#ef4444' }}>{error}</p>}
    </div>
  );
}

export default DebatePage;
