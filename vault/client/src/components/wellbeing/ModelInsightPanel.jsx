import React from 'react';

function blocksFromText(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  const explicit = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (explicit.length > 1) {
    return explicit.map((part) => {
      const lines = part.split(/\n/).map((line) => line.trim()).filter(Boolean);
      return lines.length > 1 ? { type: 'lines', lines } : { type: 'paragraph', text: lines[0] || part };
    });
  }

  const singleLines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  if (singleLines.length > 1) return [{ type: 'lines', lines: singleLines }];
  if (text.length < 520) return [{ type: 'paragraph', text }];

  const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) || [text];
  const blocks = [];
  let current = '';
  sentences.forEach((sentence) => {
    const next = current ? `${current} ${sentence}` : sentence;
    if (current && next.length > 420) {
      blocks.push({ type: 'paragraph', text: current });
      current = sentence;
    } else {
      current = next;
    }
  });
  if (current) blocks.push({ type: 'paragraph', text: current });
  return blocks;
}

function ParagraphText({ text, className = 'text-sm', style }) {
  const blocks = blocksFromText(text);
  if (!blocks.length) return null;
  return (
    <div className="space-y-4">
      {blocks.map((block, idx) => (
        block.type === 'lines' ? (
          <div key={idx} className="space-y-1.5">
            {block.lines.map((line, lineIdx) => (
              <p key={lineIdx} className={`${className} leading-relaxed`} style={style}>{line}</p>
            ))}
          </div>
        ) : (
          <p key={idx} className={`${className} leading-relaxed`} style={style}>{block.text}</p>
        )
      ))}
    </div>
  );
}

export default function ModelInsightPanel({ insight, title = 'Deeper insight' }) {
  if (!insight || (!insight.summary && !Array.isArray(insight.sections))) return null;

  return (
    <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            {insight.generatedByModel ? 'Generated from the scored pattern using the configured model.' : 'Generated from deterministic fallback guidance.'}
          </p>
        </div>
      </div>

      <div className="mb-5">
        <ParagraphText text={insight.summary} className="text-sm" style={{ color: 'var(--color-text)' }} />
      </div>

      {Array.isArray(insight.sections) && insight.sections.length > 0 && (
        <div className="space-y-4">
          {insight.sections.map((section, idx) => (
            <div key={`${section.title || 'section'}-${idx}`} className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <p className="text-sm font-medium mb-2" style={{ color: 'var(--color-text)' }}>{section.title}</p>
              <ParagraphText text={section.body} className="text-sm" style={{ color: 'var(--color-muted)' }} />
            </div>
          ))}
        </div>
      )}

      {Array.isArray(insight.questions) && insight.questions.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>Reflection questions</h3>
          <ul className="space-y-2.5">
            {insight.questions.map((question, idx) => (
              <li key={idx} className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>{question}</li>
            ))}
          </ul>
        </div>
      )}

      {insight.caveat && (
        <div className="text-xs mt-5" style={{ color: 'var(--color-muted)' }}>
          <ParagraphText text={insight.caveat} className="text-xs" style={{ color: 'var(--color-muted)' }} />
        </div>
      )}
    </section>
  );
}
