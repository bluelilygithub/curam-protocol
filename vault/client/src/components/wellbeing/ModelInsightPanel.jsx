import React from 'react';

function paragraphsFromText(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  const explicit = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (explicit.length > 1 || text.length < 520) return explicit.length ? explicit : [text];

  const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) || [text];
  const paragraphs = [];
  let current = '';
  sentences.forEach((sentence) => {
    const next = current ? `${current} ${sentence}` : sentence;
    if (current && next.length > 420) {
      paragraphs.push(current);
      current = sentence;
    } else {
      current = next;
    }
  });
  if (current) paragraphs.push(current);
  return paragraphs;
}

function ParagraphText({ text, className = 'text-sm', style }) {
  const paragraphs = paragraphsFromText(text);
  if (!paragraphs.length) return null;
  return (
    <div className="space-y-3">
      {paragraphs.map((paragraph, idx) => (
        <p key={idx} className={className} style={style}>{paragraph}</p>
      ))}
    </div>
  );
}

export default function ModelInsightPanel({ insight, title = 'Deeper insight' }) {
  if (!insight || (!insight.summary && !Array.isArray(insight.sections))) return null;

  return (
    <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            {insight.generatedByModel ? 'Generated from the scored pattern using the configured model.' : 'Generated from deterministic fallback guidance.'}
          </p>
        </div>
      </div>

      <div className="mb-4">
        <ParagraphText text={insight.summary} className="text-sm" style={{ color: 'var(--color-text)' }} />
      </div>

      {Array.isArray(insight.sections) && insight.sections.length > 0 && (
        <div className="space-y-3">
          {insight.sections.map((section, idx) => (
            <div key={`${section.title || 'section'}-${idx}`} className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>{section.title}</p>
              <ParagraphText text={section.body} className="text-sm" style={{ color: 'var(--color-muted)' }} />
            </div>
          ))}
        </div>
      )}

      {Array.isArray(insight.questions) && insight.questions.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>Reflection questions</h3>
          <ul className="space-y-2">
            {insight.questions.map((question, idx) => (
              <li key={idx} className="text-sm" style={{ color: 'var(--color-muted)' }}>{question}</li>
            ))}
          </ul>
        </div>
      )}

      {insight.caveat && (
        <p className="text-xs mt-4" style={{ color: 'var(--color-muted)' }}>{insight.caveat}</p>
      )}
    </section>
  );
}
