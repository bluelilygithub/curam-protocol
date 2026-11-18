import React, { useState } from 'react';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { useIcon } from '../../providers/IconProvider';
import { citationParts } from './filterEntries.mjs';

// "Ask the changelog": one question, answered by the standard model from Settings using only the changelog entries the server picked
// for it (POST /api/changelog/ask, server/services/changelogAsk.js: date words in Brisbane time, area and file names, keywords, at most 40).
// Each [hash] in the answer is a link that opens that entry in the list below (onOpen). One model call per question; nothing is changed.

const EXAMPLES = ['What changed this week?', 'Which updates had untested concerns?', 'Everything that touched db.js'];

function HashLink({ hash, onOpen }) {
  return (
    <button
      type="button" onClick={() => onOpen(hash)}
      className="font-mono text-[12px] px-1 rounded hover:opacity-70 transition-opacity duration-200"
      style={{ background: 'var(--color-bg)', color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}
      aria-label={`Open update ${hash}`}
    >
      {hash}
    </button>
  );
}

export default function AskChangelog({ onOpen, disabled }) {
  const getIcon = useIcon();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState(null);
  const [showSources, setShowSources] = useState(false);

  const ask = async (q = question) => {
    const text = q.trim();
    if (text.length < 3 || busy) return;
    setBusy(true); setError(null); setAnswer(null); setShowSources(false);
    try {
      const r = await api.post('/api/changelog/ask', { question: text });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'The question could not be answered.');
      setAnswer({ ...d, question: text });
    } catch (err) {
      setError(err.message || 'The question could not be answered.');
    } finally {
      setBusy(false);
    }
  };

  const n = answer?.basedOn?.length || 0;
  const paragraphs = answer ? String(answer.answer || '').split(/\n{2,}/) : [];

  return (
    <section aria-label="Ask the changelog" className="rounded-xl border p-3 mb-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <Tooltip text="Ask a question about the updates, for example what changed in an area this week or which ones had concerns. Answered from the changelog entries only.">
            <div>
              <VoiceInput
                value={question} onChange={setQuestion} label="Ask the changelog"
                placeholder="Ask the changelog, e.g. What changed in PDF Tools since Monday?"
                maxLength={500} disabled={disabled}
              />
            </div>
          </Tooltip>
        </div>
        <Tooltip text="Send the question to the AI model set in Settings, with the matching updates only (at most 40). One model call; it changes nothing.">
          <button
            type="submit" disabled={busy || disabled || question.trim().length < 3}
            className="text-sm px-3 py-2.5 rounded-xl flex items-center gap-1.5 hover:opacity-70 transition-opacity duration-200 disabled:opacity-40"
            style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}
          >
            {getIcon(busy ? 'loader' : 'sparkles', { size: 14, className: busy ? 'animate-spin' : undefined })}
            {busy ? 'Reading…' : 'Ask'}
          </button>
        </Tooltip>
      </form>

      {!answer && !busy && !error && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2 text-xs" style={{ color: 'var(--color-muted)' }}>
          <span>Try:</span>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" disabled={disabled} onClick={() => { setQuestion(ex); ask(ex); }} className="px-2 py-0.5 rounded-full border hover:opacity-70 transition-opacity duration-200" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              {ex}
            </button>
          ))}
        </div>
      )}

      {busy && <div className="mt-3"><Skeleton lines={3} label="Reading the changelog" /></div>}
      {error && <p className="text-xs mt-2 px-3 py-2 rounded-md" role="alert" style={{ background: 'var(--color-bg)', color: '#ef4444' }}>{error}</p>}

      {answer && (
        <div className="mt-3 space-y-2 text-sm" style={{ color: 'var(--color-text)' }} aria-live="polite">
          {paragraphs.map((para, i) => (
            <p key={i} className="whitespace-pre-wrap leading-relaxed">
              {citationParts(para, answer.basedOn).map((piece, j) => (piece.hash
                ? <HashLink key={j} hash={piece.hash} onOpen={onOpen} />
                : <React.Fragment key={j}>{piece.text}</React.Fragment>))}
            </p>
          ))}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs pt-1" style={{ color: 'var(--color-muted)' }}>
            {n > 0 ? (
              <Tooltip text="The updates sent to the model with your question. Click to list them; each one opens in the list below.">
                <button type="button" onClick={() => setShowSources((v) => !v)} aria-expanded={showSources} className="flex items-center gap-1 hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>
                  {getIcon(showSources ? 'chevron-down' : 'chevron-right', { size: 12 })}
                  Based on {n} update{n === 1 ? '' : 's'}
                </button>
              </Tooltip>
            ) : <span>No updates matched, so no model was asked.</span>}
            {answer.matched > n && <span>{answer.matched} matched; only the {n} most relevant were sent</span>}
            {answer.range && <span>Dates read as {answer.range.label} (Brisbane time)</span>}
            {answer.areas?.length > 0 && <span>Area: {answer.areas.join(', ')}</span>}
            {answer.files?.length > 0 && <span>File: {answer.files.join(', ')}</span>}
            {answer.concernsOnly && <span>Only updates with concerns</span>}
            {answer.unknownCitations?.length > 0 && (
              <span style={{ color: '#f59e0b' }}>Cited {answer.unknownCitations.length} hash{answer.unknownCitations.length === 1 ? '' : 'es'} it was not given ({answer.unknownCitations.join(', ')}); treat those claims with care</span>
            )}
            {answer.model && <span>Model: {answer.model}</span>}
          </div>
          {showSources && (
            <div className="flex flex-wrap gap-1">
              {answer.basedOn.map((h) => <HashLink key={h} hash={h} onOpen={onOpen} />)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
