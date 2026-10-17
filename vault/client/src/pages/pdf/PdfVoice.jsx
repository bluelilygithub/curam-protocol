import { createContext, useContext, useEffect, useState } from 'react';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import Tooltip from '../../components/Tooltip';

/**
 * "Tell it what to do" box for PDF tools. Same pattern as Video Tools: the mic puts what you say into an editable box, nothing
 * happens until you press Apply, and the settings it changed are listed so you can check them in the form. The page supplies
 * `run(toolId, text)` through context because it owns each tool's state; tools that keep their own state (Crop, Header & Footer,
 * Pages per Sheet, Pages to Images, OCR) register a receiver with `useVoiceTarget`.
 * There is deliberately no box on Password Protect: a password is never sent to a model.
 */
export const PdfVoiceContext = createContext(null);

export const VOICE_EXAMPLES = {
  split: 'pages 1 to 3 and page 7',
  rotate: 'turn pages 2 to 4 upside down',
  watermark: 'say DRAFT in big red letters, faint, diagonal',
  pagenumbers: 'Page 1 of 10 at the top right, starting from 3',
  headerfooter: 'put the file name on the left of the footer and the date on the right',
  crop: 'trim 10 millimetres off the top and 15 off the left',
  nup: 'four to a sheet on Letter, no border',
  compress: 'make it as small as you can',
  pdf2img: 'JPG, print quality, pages 1 to 5',
  ocr: 'just pages 2 and 3',
  metadata: 'title Annual Report 2026, author Michael Barrett',
  img2pdf: 'A4 pages with a 10 point margin',
};

export function useVoiceTarget(toolId, apply) {
  const ctx = useContext(PdfVoiceContext);
  const register = ctx?.register;
  useEffect(() => {
    if (!register) return undefined;
    register(toolId, apply);
    return () => register(toolId, null);
  });
}

export function VoiceCommandBar({ toolId }) {
  const ctx = useContext(PdfVoiceContext);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { kind: 'ok'|'none'|'error', applied?, message? }
  if (!ctx || !VOICE_EXAMPLES[toolId]) return null;

  const apply = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await ctx.run(toolId, text.trim());
      setStatus(r.applied.length ? { kind: 'ok', applied: r.applied } : { kind: 'none' });
    } catch (e) {
      setStatus({ kind: 'error', message: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border p-3 mt-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Tell it what to do (optional)</p>
      <VoiceInput
        type="textarea"
        append
        rows={2}
        value={text}
        onChange={(v) => { setText(v.slice(0, 600)); setStatus(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); apply(); } }}
        placeholder={`e.g. ${VOICE_EXAMPLES[toolId]}. (Tap the mic to say it, then fix any words before applying.)`}
        label="Tell this tool what to do"
        className="!text-xs"
      />
      <div className="flex items-center gap-3 flex-wrap">
        <Tooltip text="Fill in this tool's settings from your words. Nothing is changed in your file until you press the tool's own button.">
          <button
            type="button"
            onClick={apply}
            disabled={!text.trim() || busy}
            className="px-4 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70 disabled:opacity-40"
            style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
          >
            {busy ? 'Working it out…' : 'Apply to settings'}
          </button>
        </Tooltip>
        {status?.kind === 'ok' && (
          <p className="text-xs" role="status" style={{ color: 'var(--color-text)' }}>
            <strong>Set:</strong> {status.applied.join(' · ')}
          </p>
        )}
        {status?.kind === 'none' && (
          <p className="text-xs" role="status" style={{ color: '#b45309' }}>No setting found in that. Edit the words and try again.</p>
        )}
        {status?.kind === 'error' && (
          <p className="text-xs" role="status" style={{ color: '#ef4444' }}>{status.message}</p>
        )}
      </div>
    </div>
  );
}
