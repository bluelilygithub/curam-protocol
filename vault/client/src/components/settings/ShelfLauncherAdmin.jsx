import React, { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import Tooltip from '../Tooltip';

/**
 * Settings -> Vault Shelf (admins only): the on/off switch for the "Open Shelf" button in everyone's top bar, and the web address people
 * download the Windows installer from. Off by default: switch it on once the installer is somewhere people can reach it.
 */
export default function ShelfLauncherAdmin() {
  const addToast = useToastStore((s) => s.addToast);
  const [state, setState] = useState('loading'); // loading | hidden | ready
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/shelf-tokens/launcher');
      if (!res.ok) { setState('hidden'); return; }
      const d = await res.json();
      if (!d.canEdit) { setState('hidden'); return; }
      setEnabled(!!d.enabled); setUrl(d.installerUrl || ''); setSaved(d.installerUrl || '');
      setState('ready');
    } catch { setState('hidden'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function put(body, done) {
    if (busy) return false;
    setBusy(true);
    try {
      const res = await api.put('/api/shelf-tokens/launcher', body);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { addToast(d.error || 'Could not save that.', 'error'); return false; }
      setEnabled(!!d.enabled); setUrl(d.installerUrl || ''); setSaved(d.installerUrl || '');
      addToast(done, 'success');
      return true;
    } catch { addToast('Could not save that. Try again.', 'error'); return false; }
    finally { setBusy(false); }
  }

  if (state !== 'ready') return null;
  const border = { borderColor: 'var(--color-border)' };
  const field = { background: 'var(--color-bg)', color: 'var(--color-text)', borderColor: 'var(--color-border)' };

  return (
    <div className="rounded-xl border p-4 space-y-3" style={{ ...border, background: 'var(--color-bg)' }} data-tour="shelf-launcher">
      <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Open Shelf button (admin)</div>
      <Tooltip text="Adds an Open Shelf button to the top bar for everyone who may use the Shelf, on Windows computers only. Switch it on once people can download the installer.">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox" role="switch" className="mt-0.5 h-4 w-4" checked={enabled} disabled={busy}
            onChange={(e) => put({ enabled: e.target.checked }, e.target.checked ? 'Open Shelf button is on for everyone.' : 'Open Shelf button is off.')}
          />
          <span>
            <span className="text-sm" style={{ color: 'var(--color-text)' }}>Show the Open Shelf button in the top bar</span>
            <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>Windows desktop browsers only. Off by default.</span>
          </span>
        </label>
      </Tooltip>
      <form onSubmit={(e) => { e.preventDefault(); put({ installerUrl: url }, url.trim() ? 'Installer address saved.' : 'Installer address cleared.'); }} className="space-y-1.5">
        <Tooltip text="Where people download VaultShelfSetup.exe (an https address you host it at). It shows in the note under the button if the app is not installed yet.">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Installer download address</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/downloads/VaultShelfSetup.exe" inputMode="url" autoComplete="off" spellCheck={false} maxLength={500} className="px-3 py-2.5 rounded-xl border text-sm outline-none" style={field} />
          </label>
        </Tooltip>
        <Tooltip text="Save the installer address.">
          <button type="submit" disabled={busy || url.trim() === saved} className="px-3.5 py-1.5 text-sm font-medium rounded-lg hover:opacity-70 transition-opacity disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff' }}>Save address</button>
        </Tooltip>
      </form>
    </div>
  );
}
