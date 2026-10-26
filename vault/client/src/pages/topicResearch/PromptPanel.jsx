import React from 'react';
import useToastStore from '../../store/toastStore';
import { promptText } from './format.mjs';

/**
 * "What the AI was asked": the exact prompt of one AI call, as it was sent: the model, the rules, the request with its material (the page text of
 * other outlets is shown as sent), and the extra text of a second try if there was one. Collapsed until opened. `prompt` null means it is not kept
 * (the brief or draft was made before prompts were stored, or is older than 30 days: the stored prompt goes with the page text it carries).
 */
export default function PromptPanel({ prompt, label = 'What the AI was asked', kept = true }) {
  const addToast = useToastStore((s) => s.addToast);
  const muted = { color: 'var(--color-muted)' };
  const text = { color: 'var(--color-text)' };

  if (!prompt) {
    return kept ? null : (
      <p className="text-xs mt-4" style={muted} data-guide="prompts">{label}: not kept for this one. It was made before prompts were stored, or it is more than 30 days old (a stored prompt goes with the page text it carries).</p>
    );
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(promptText(prompt)); addToast('Prompt copied', 'success'); } catch { addToast('Could not copy. Select the text instead.', 'error'); }
  };
  const block = (title, body) => (
    <div className="space-y-1">
      <p className="text-xs font-semibold" style={text}>{title}</p>
      <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words rounded-lg border p-3 overflow-auto" style={{ maxHeight: '18rem', borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>{body}</pre>
    </div>
  );
  return (
    <details className="mt-4 rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }} data-guide="prompts">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium hover:opacity-70 transition-opacity" style={text}>{label}</summary>
      <div className="px-3 pb-3 space-y-3">
        <p className="text-xs leading-relaxed" style={muted}>
          This is exactly what was sent to <strong style={text}>{prompt.model || 'the model'}</strong>: the rules it was given, then the request. Other outlets&apos; text is shown as it was sent.
        </p>
        {block('The rules (system)', prompt.system)}
        {block('The request and its material (user)', prompt.user)}
        {prompt.retry ? block('Second try: this was added to the request', prompt.retry) : null}
        <button type="button" onClick={copy} className="px-3 py-1.5 rounded-lg text-sm font-medium border hover:opacity-70 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Copy the whole prompt</button>
      </div>
    </details>
  );
}
