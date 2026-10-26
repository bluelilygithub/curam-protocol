import React, { useEffect, useRef, useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import GeneratorPanel from './GeneratorPanel';
import { BTN, BTN_OUTLINE, BTN_PRIMARY } from './shared';

/**
 * "Make one" for a single login: every generator option in a window, so each login can have its own rules (length, kinds of character,
 * characters a site rejects). The rules can be kept with the login, so they are there next time its password is changed.
 * `onUse(password, options, remember)`.
 */
export default function GeneratorModal({ title, startOptions, hasSavedRules, onUse, onClose }) {
  const getIcon = useIcon();
  const latest = useRef({ options: null, password: '' });
  const [ready, setReady] = useState(false);
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      // z-[44], not the usual z-50: tooltips are z-45, and this window is full of controls that have one
      className="fixed inset-0 z-[44] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label="Password rules for this login" className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Password rules{title ? ` for ${title}` : ''}</h2>
          <Tooltip text="Close without using a password. Nothing changes.">
            <button type="button" onClick={onClose} aria-label="Close" className="hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 18 })}</button>
          </Tooltip>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            {hasSavedRules ? 'These are the rules saved with this login.' : 'Set the rules this login\'s password has to follow.'} A new password is made each time you change one.
          </p>
          <GeneratorPanel startOptions={startOptions} onChange={(options, password) => { latest.current = { options, password }; setReady(!!password); }} />
          <Tooltip text="Save the length and character choices with this login, locked like the rest of it, so Make one starts from them next time. Untick to use them just once.">
            <label className="flex items-start gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-1" />
              Keep these rules with this login (locked along with it), so they are here next time.
            </label>
          </Tooltip>
        </div>
        <div className="flex gap-2 px-5 py-4 border-t flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <Tooltip text="Put the password shown above into the login. It is not saved until you press Save on the login.">
            <button type="button" disabled={!ready} onClick={() => onUse(latest.current.password, latest.current.options, remember)} className={BTN} style={BTN_PRIMARY}>{getIcon('check', { size: 14 })}Use this password</button>
          </Tooltip>
          <button type="button" onClick={onClose} className={BTN} style={BTN_OUTLINE}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
