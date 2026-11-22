import React from 'react';
import Tooltip from '../../components/Tooltip';
import { CARD, FIELD, FOCUS_RING, PrimaryButton, VERIFY_BADGE } from './shared';
import { useContractReview } from './context';

// Ask about this contract: a question answered from the clause text, quoting the clause.
export default function AskView() {
  const { getIcon, contract, question, setQuestion, qaHistory, qaLoading, askQuestion } = useContractReview();

  return (
    <div className="rounded-lg border p-4" style={CARD} data-guide="ask">
      <h2 className="text-base font-semibold mb-2">Ask about this contract</h2>
      <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>Searches every document and revision under this contract, not just the one currently open.</p>
      <div className="flex gap-2 mb-3">
        <Tooltip text="Answers are grounded in the actual clause text and quote the clause they're based on — searches every document and revision under this contract.">
          <input
            type="text" value={question} onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !qaLoading) askQuestion(); }}
            placeholder="e.g. How much notice do I need to give to terminate?"
            className={`flex-1 rounded border px-3 py-2 text-sm ${FOCUS_RING}`} style={FIELD}
          />
        </Tooltip>
        <PrimaryButton onClick={askQuestion} disabled={qaLoading || !question.trim()}>
          {qaLoading ? 'Asking…' : 'Ask'}
        </PrimaryButton>
      </div>
      <div className="space-y-3">
        {qaHistory.map((h, i) => (
          <div key={i} className="rounded border p-3" style={FIELD}>
            <div className="text-xs font-semibold mb-1">{h.question}</div>
            {h.answeredByContract ? (
              <>
                <p className="text-sm mb-1">{h.answer}</p>
                {h.quote && (
                  <div className="text-xs mt-1 rounded p-2 flex items-start gap-2" style={{ background: 'var(--color-bg)' }}>
                    {getIcon((VERIFY_BADGE[h.quote.verificationStatus] || VERIFY_BADGE.failed).icon, { size: 12, style: { marginTop: 2, color: (VERIFY_BADGE[h.quote.verificationStatus] || VERIFY_BADGE.failed).color } })}
                    <span>"{h.quote.text}"{h.documentVersion != null && ` — version ${h.documentVersion}`}</span>
                  </div>
                )}
                {h.perspectiveNote && (
                  <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Perspective: {h.perspectiveNote}</div>
                )}
              </>
            ) : (
              <p className="text-sm italic" style={{ color: 'var(--color-muted)' }}>{h.answer}</p>
            )}
          </div>
        ))}
        {!qaHistory.length && <div className="text-sm" style={{ color: 'var(--color-muted)' }}>Ask a question about this contract — answers quote the clause they're based on.</div>}
      </div>
    </div>
  );
}
