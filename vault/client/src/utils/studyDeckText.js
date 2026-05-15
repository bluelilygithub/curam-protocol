/** Plain text for clipboard / Anki-style export — works for flashcards, slides, quiz. */

export function deckPayloadToPlainText(title, payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const lines = [];
  lines.push(title || 'Study deck');
  lines.push('—'.repeat(40));
  const fc = Array.isArray(p.flashcards) ? p.flashcards : [];
  if (fc.length) {
    lines.push('');
    lines.push('FLASHCARDS');
    fc.forEach((c, i) => {
      lines.push('');
      lines.push(`Card ${i + 1}`);
      lines.push(`Q: ${c.front ?? c.q ?? ''}`);
      lines.push(`A: ${c.back ?? c.a ?? ''}`);
    });
  }
  const slides = Array.isArray(p.slides) ? p.slides : [];
  if (slides.length) {
    lines.push('');
    lines.push('SLIDES');
    slides.forEach((s, i) => {
      lines.push('');
      lines.push(`Slide ${i + 1}: ${s.title || ''}`);
      (Array.isArray(s.bullets) ? s.bullets : []).forEach((b) => lines.push(`• ${b}`));
      if (s.speakerNote) lines.push(`Note: ${s.speakerNote}`);
    });
  }
  const quiz = Array.isArray(p.quiz) ? p.quiz : [];
  if (quiz.length) {
    lines.push('');
    lines.push('QUIZ');
    quiz.forEach((q, i) => {
      lines.push('');
      lines.push(`Q${i + 1}: ${q.question || ''}`);
      (Array.isArray(q.choices) ? q.choices : []).forEach((ch) => {
        const mark = ch.id === q.correctId ? ' *' : '';
        lines.push(`  - ${ch.label || ch.id || ''}${mark}`);
      });
      if (q.explain) lines.push(`  Explanation: ${q.explain}`);
    });
  }
  return lines.join('\n').trim();
}
