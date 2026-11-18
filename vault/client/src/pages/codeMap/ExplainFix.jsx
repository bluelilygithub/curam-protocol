import React, { useState } from 'react';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';
import { useIcon } from '../../providers/IconProvider';

// "Explain and plan a fix" under one finding: pick the tool (when the finding names several), ask, and show the answer with the files and
// lines it read. POST /api/code-map/findings/explain (server/services/codeMap/explain.js): the standard model from Settings, grounded only in
// the finding's evidence and up to 200 lines around each evidence line. One model call per press; nothing is changed.

const Ref = ({ r }) => <code className="text-[11px] px-1 rounded" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>{r}</code>;

export default function ExplainFix({ runId, finding, byId }) {
  const getIcon = useIcon();
  const tools = (finding.tools || []).filter((id) => byId[id]);
  const [toolId, setToolId] = useState(tools[0] || 'all');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState(null);

  // a rule finding needs a tool; a structural one may name none
  const needsTool = finding.kind === 'rule';
  if (needsTool && !tools.length) return null;

  const ask = async () => {
    setBusy(true); setError(null); setAnswer(null);
    try {
      const r = await api.post('/api/code-map/findings/explain', { runId, ruleId: finding.ruleId, toolId, findingId: finding.id });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not explain this finding.');
      setAnswer(d);
    } catch (err) {
      setError(err.message || 'Could not explain this finding.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2" data-guide="explain-fix">
      <div className="flex flex-wrap items-center gap-2">
        {tools.length > 1 && (
          <Tooltip text="Which tool to explain this finding for.">
            <select
              value={toolId} onChange={(e) => { setToolId(e.target.value); setAnswer(null); }} aria-label="Tool to explain"
              className="px-2 py-1 rounded-lg border text-xs"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              {tools.map((id) => <option key={id} value={id}>{byId[id].label}</option>)}
            </select>
          </Tooltip>
        )}
        <Tooltip text="Ask the AI model set in Settings to explain this finding and plan a fix, using only its evidence and the lines around it. One model call; it changes nothing.">
          <button
            type="button" onClick={ask} disabled={busy}
            className="text-xs px-2.5 py-1 rounded-lg border flex items-center gap-1 hover:opacity-70 transition-opacity duration-200 disabled:opacity-50"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            {getIcon(busy ? 'loader' : 'sparkles', { size: 12, className: busy ? 'animate-spin' : undefined })}
            {busy ? 'Reading the code…' : answer ? 'Ask again' : 'Explain and plan a fix'}
          </button>
        </Tooltip>
      </div>
      {error && <p className="text-xs mt-2 px-3 py-2 rounded-md" style={{ background: '#fff1f2', color: '#ef4444' }}>{error}</p>}
      {answer && (
        <div className="mt-2 rounded-xl border px-4 py-3 space-y-2 text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }} aria-live="polite">
          {answer.falsePositive && <p className="text-xs font-semibold" style={{ color: '#f59e0b' }}>The model thinks this is a false positive. Check the evidence below before acting.</p>}
          <p className="leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{answer.explanation}</p>
          {answer.steps?.length > 0 && (
            <ol className="list-decimal pl-5 space-y-1.5" style={{ color: 'var(--color-text)' }}>
              {answer.steps.map((s, i) => (
                <li key={i}>
                  <span className="whitespace-pre-wrap">{s.do}</span>
                  {s.refs?.length > 0 && <span className="ml-1 inline-flex flex-wrap gap-1">{s.refs.map((r) => <Ref key={r} r={r} />)}</span>}
                </li>
              ))}
            </ol>
          )}
          {answer.unsure && <p className="text-xs" style={{ color: 'var(--color-muted)' }}><b>Could not tell:</b> {answer.unsure}</p>}
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Read: {answer.read?.length ? answer.read.map((x) => `${x.file}:${x.from}-${x.to}`).join(', ') : 'nothing'}
            {answer.notRead?.length ? ` · not read: ${answer.notRead.map((x) => x.file).join(', ')}` : ''}
            {answer.droppedRefs?.length ? ` · ${answer.droppedRefs.length} reference${answer.droppedRefs.length > 1 ? 's' : ''} to lines it was not shown left out` : ''}
            {answer.model ? ` · ${answer.model}` : ''}. A model's reading of the code: check it before changing anything.
          </p>
        </div>
      )}
    </div>
  );
}
