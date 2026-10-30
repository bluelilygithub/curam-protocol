import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import Tooltip from '../Tooltip';
import { useIcon } from '../../providers/IconProvider';
import { formatSize } from '../../utils/shelfLauncher.mjs';

/**
 * Settings -> Vault Shelf (admins only): the on/off switch for the "Open Shelf" button in everyone's top bar, the installer file itself
 * (uploaded here, kept on this server's upload volume, downloaded by signed-in Shelf users), and, as an alternative, an outside web address
 * for it. Off by default: switch it on once the installer is uploaded.
 */
export default function ShelfLauncherAdmin() {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const fileInput = useRef(null);
  const [state, setState] = useState('loading'); // loading | hidden | ready
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('');
  const [saved, setSaved] = useState('');
  const [installer, setInstaller] = useState({ available: false });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/shelf-tokens/launcher');
      if (!res.ok) { setState('hidden'); return; }
      const d = await res.json();
      if (!d.canEdit) { setState('hidden'); return; }
      setEnabled(!!d.enabled); setUrl(d.installerUrl || ''); setSaved(d.installerUrl || ''); setInstaller(d.installer || { available: false });
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

  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || uploading) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.postForm('/api/shelf-tokens/installer', fd);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { addToast(d.error || 'Could not upload the installer.', 'error'); return; }
      setInstaller(d.installer || { available: false });
      addToast('Installer uploaded. Compare the fingerprint with the one the build printed.', 'success');
    } catch { addToast('Could not upload the installer. Try again.', 'error'); }
    finally { setUploading(false); }
  }

  async function remove() {
    setConfirmRemove(false);
    try {
      const res = await api.delete('/api/shelf-tokens/installer');
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { addToast(d.error || 'Could not remove the installer.', 'error'); return; }
      setInstaller(d.installer || { available: false });
      addToast('Installer removed.', 'success');
    } catch { addToast('Could not remove the installer. Try again.', 'error'); }
  }

  async function copyHash() {
    try { await navigator.clipboard.writeText(installer.sha256); addToast('Fingerprint copied ✓', 'success'); }
    catch { addToast('Copy was blocked by the browser. Select the text and copy it by hand.', 'error'); }
  }

  if (state !== 'ready') return null;
  const border = { borderColor: 'var(--color-border)' };
  const field = { background: 'var(--color-bg)', color: 'var(--color-text)', borderColor: 'var(--color-border)' };
  const muted = { color: 'var(--color-muted)' };
  const outline = 'px-3 py-1.5 text-sm rounded-lg border hover:opacity-70 transition-opacity disabled:opacity-40 inline-flex items-center gap-1.5';

  return (
    <div className="rounded-xl border p-4 space-y-4" style={{ ...border, background: 'var(--color-bg)' }} data-tour="shelf-launcher">
      <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Open Shelf button and installer (admin)</div>

      <Tooltip text="Adds an Open Shelf button to the top bar for everyone who may use the Shelf, on Windows computers only. Switch it on once the installer is uploaded.">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox" role="switch" className="mt-0.5 h-4 w-4" checked={enabled} disabled={busy}
            onChange={(e) => put({ enabled: e.target.checked }, e.target.checked ? 'Open Shelf button is on for everyone.' : 'Open Shelf button is off.')}
          />
          <span>
            <span className="text-sm" style={{ color: 'var(--color-text)' }}>Show the Open Shelf button in the top bar</span>
            <span className="block text-xs" style={muted}>Windows desktop browsers only. Off by default.</span>
          </span>
        </label>
      </Tooltip>

      <div className="space-y-2">
        <div className="text-xs font-medium" style={muted}>Installer file (VaultShelfSetup.exe)</div>
        {installer.available ? (
          <div className="rounded-lg border p-3 text-sm space-y-1" style={{ ...border, background: 'var(--color-surface)', color: 'var(--color-text)' }}>
            <div>{formatSize(installer.sizeBytes)} · uploaded {installer.uploadedAt ? new Date(installer.uploadedAt).toLocaleString() : ''}</div>
            {installer.sha256 && (
              <div className="flex flex-wrap items-center gap-2 text-xs" style={muted}>
                <span>Fingerprint (SHA-256):</span>
                <code className="font-mono break-all">{installer.sha256}</code>
                <Tooltip text="Copy the fingerprint. The build prints the same one, so you can check this is the file you built."><button type="button" onClick={copyHash} className="hover:opacity-70 transition-opacity" aria-label="Copy fingerprint">{getIcon('copy', { size: 13 })}</button></Tooltip>
              </div>
            )}
          </div>
        ) : <p className="text-xs" style={muted}>Nothing uploaded yet.</p>}
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileInput} type="file" accept=".exe" className="hidden" onChange={upload} />
          <Tooltip text="Choose VaultShelfSetup.exe from your computer. It is kept on this server and signed-in Shelf users download it from the Open Shelf button. It is never run here.">
            <button type="button" disabled={uploading} onClick={() => fileInput.current?.click()} className={outline} style={{ ...border, color: 'var(--color-text)' }}>
              {getIcon('upload', { size: 14 })} {uploading ? 'Uploading…' : installer.available ? 'Replace installer' : 'Upload installer'}
            </button>
          </Tooltip>
          {installer.available && (confirmRemove ? (
            <span className="text-sm inline-flex items-center gap-2" style={{ color: 'var(--color-text)' }}>Remove it?
              <button type="button" onClick={remove} className="font-medium hover:opacity-70 transition-opacity" style={{ color: '#ef4444' }}>Yes</button>
              <button type="button" onClick={() => setConfirmRemove(false)} className="hover:opacity-70 transition-opacity" style={muted}>No</button>
            </span>
          ) : (
            <Tooltip text="Take the uploaded installer off this server. People can then no longer download it from the button."><button type="button" onClick={() => setConfirmRemove(true)} className="text-sm hover:opacity-70 transition-opacity" style={{ color: '#ef4444' }}>Remove</button></Tooltip>
          ))}
        </div>
        <p className="text-xs" style={muted}>The file is not signed, so Windows will warn people the first time they run it. Build it with <code className="font-mono">shelf/setup/build-installer.ps1</code>.</p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); put({ installerUrl: url }, url.trim() ? 'Installer address saved.' : 'Installer address cleared.'); }} className="space-y-1.5">
        <Tooltip text="Only if you host the installer somewhere else: an https address. It is used when no file is uploaded here.">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={muted}>Or an outside download address (optional)</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/downloads/VaultShelfSetup.exe" inputMode="url" autoComplete="off" spellCheck={false} maxLength={500} className="px-3 py-2.5 rounded-xl border text-sm outline-none" style={field} />
          </label>
        </Tooltip>
        <Tooltip text="Save the outside download address.">
          <button type="submit" disabled={busy || url.trim() === saved} className="px-3.5 py-1.5 text-sm font-medium rounded-lg hover:opacity-70 transition-opacity disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff' }}>Save address</button>
        </Tooltip>
      </form>
    </div>
  );
}
