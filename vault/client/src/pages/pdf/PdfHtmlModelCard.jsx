import { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';
import { formatModelSelectLabel } from '../../utils/models';

/**
 * Settings → PDF Tools: which connected model writes PDF → HTML pages. Only models that can look at pictures are offered (the server
 * filters: DeepSeek and local models cannot). Empty = automatic: the default model when it can see pictures, else the first Claude model,
 * else the first Gemini one. Server: services/pdfToHtmlModel.js, GET/POST /api/pdf/to-html/model-config.
 */
export default function PdfHtmlModelCard() {
  const url = '/api/pdf/to-html/model-config';
  const [config, setConfig] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.get(url).then((r) => r.json()).then((d) => { if (live && d && !d.error) setConfig(d); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const change = async (modelId) => {
    setError(''); setSaved(false);
    try {
      const r = await api.post(url, { modelId });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save the model.');
      setConfig(d);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError(e.message || 'Could not reach the server.'); }
  };

  const muted = { color: 'var(--color-muted)' };
  const chosen = config?.modelId || '';
  const choices = config?.choices || [];
  const inList = !chosen || choices.some((m) => m.id === chosen);
  const autoNote = !config ? '' : (config.automaticModel || 'none can see pictures');
  const autoWhy = config?.automaticModel && !config.standardCanSee && config.standard
    ? `Your default model (${config.standard}) cannot look at pictures, so Automatic uses ${config.automaticModel}.` : '';

  return (
    <section className="mb-8">
      <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={muted}>PDF → HTML model</h2>
      <p className="text-xs mb-4" style={muted}>
        PDF → HTML shows the AI model each page as a picture, plus the pictures inside the PDF, so it needs a model that can look at pictures:
        a Claude or Gemini model. DeepSeek and local models cannot, so they are not offered here. On Automatic it uses your default model when
        that can see pictures, otherwise the first Claude model connected under AI &amp; Chat, otherwise the first Gemini one.
      </p>
      <label className="block text-xs font-medium mb-1.5" style={muted} htmlFor="pdf-html-model">Model</label>
      <div className="flex items-center gap-2 flex-wrap">
        <Tooltip text="Pick the model that writes PDF → HTML pages, or leave it on Automatic.">
          <select
            id="pdf-html-model" value={chosen} onChange={(e) => change(e.target.value)} disabled={!config}
            className="px-3 py-1.5 rounded-lg border text-sm min-w-[240px] max-w-full"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            <option value="">Automatic ({autoNote || '…'})</option>
            {!inList && <option value={chosen}>{chosen} (no longer connected)</option>}
            {choices.map((m) => <option key={m.id} value={m.id}>{formatModelSelectLabel(m)}</option>)}
          </select>
        </Tooltip>
        <span className="text-xs" style={{ color: saved ? '#22c55e' : 'var(--color-muted)' }}>{saved ? 'Saved ✓' : (chosen || 'Automatic')}</span>
      </div>
      {autoWhy && !chosen && <p className="text-xs mt-2" style={muted}>{autoWhy}</p>}
      {config && chosen && config.assignmentValid === false && (
        <p className="text-xs mt-2" style={{ color: '#b45309' }}>
          That model is no longer connected, so PDF → HTML uses {config.automaticModel || 'nothing'} until you choose another.
        </p>
      )}
      {config?.fromAdmin && !chosen && <p className="text-xs mt-2" style={muted}>Inherited from an admin&apos;s choice.</p>}
      {config && !config.effectiveModel && (
        <p className="text-xs mt-2" style={{ color: '#b45309' }}>None of your connected models can look at pictures. Add a Claude or Gemini model under AI &amp; Chat.</p>
      )}
      {error && <p className="text-xs mt-2" style={{ color: '#b45309' }}>{error}</p>}
    </section>
  );
}
