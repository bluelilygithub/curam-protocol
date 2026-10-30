import React, { useEffect, useRef, useState } from 'react';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import { SHELF_URL, isWindowsDesktop, launcherHelp } from '../utils/shelfLauncher.mjs';

/**
 * "Open Shelf" in the top bar: opens the Vault Shelf Windows app (a vault-shelf://open link the installer registers). Shown only on a Windows
 * desktop browser, only to people who may use the Shelf, and only while an admin has the button switched on (Settings -> Vault Shelf).
 * The browser cannot say whether the app opened, so after the press a small note explains what to do if it did not (and offers the installer
 * the admin chose). Nothing is sent to the app: the link carries no information.
 */
export default function ShelfLauncher({ allowed }) {
  const getIcon = useIcon();
  const [setting, setSetting] = useState(null); // { enabled, installerUrl } once loaded
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const windows = typeof navigator !== 'undefined' && isWindowsDesktop(navigator, window.innerWidth);

  useEffect(() => {
    if (!allowed || !windows) return undefined;
    let live = true;
    api.get('/api/shelf-tokens/launcher')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setSetting({ enabled: !!d.enabled, installerUrl: d.installerUrl || '' }); })
      .catch(() => {});
    return () => { live = false; };
  }, [allowed, windows]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!allowed || !windows || !setting?.enabled) return null;
  const help = launcherHelp(setting.installerUrl);

  return (
    <div className="relative hidden sm:block" ref={box}>
      <button
        type="button"
        onClick={() => { setOpen(true); window.location.href = SHELF_URL; }}
        className="w-7 h-7 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity"
        style={{ color: open ? 'var(--color-primary)' : 'var(--color-muted)' }}
        data-tip="Open Shelf (your clipboard history)"
        aria-label="Open Shelf"
      >
        {getIcon('clipboard-list', { size: 16 })}
      </button>
      {open && (
        <div
          role="status"
          className="absolute right-0 top-9 z-20 w-72 rounded-xl border p-3 text-xs space-y-2 shadow-lg"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          <div className="text-sm font-semibold">{help.title}</div>
          <p style={{ color: 'var(--color-muted)' }}>{help.text}</p>
          {help.installerUrl
            ? <a href={help.installerUrl} className="inline-flex items-center gap-1.5 font-medium hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }} rel="noopener noreferrer">{getIcon('download', { size: 14 })} Download the installer</a>
            : <p style={{ color: 'var(--color-muted)' }}>{help.fallback}</p>}
        </div>
      )}
    </div>
  );
}
