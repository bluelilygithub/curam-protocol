import React, { useRef } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import GeneratorPanel from './GeneratorPanel';
import { BTN, BTN_OUTLINE, BTN_PRIMARY, CARD, CARD_STYLE, copySecret, loadGenOptions, saveGenOptions } from './shared';

/** Works without unlocking: it saves nothing. `onUse(password)` carries the result into a new login. */
export default function GeneratorTool({ onUse }) {
  const getIcon = useIcon();
  const current = useRef('');
  const [, force] = React.useReducer((n) => n + 1, 0);

  return (
    <div className={CARD} style={CARD_STYLE}>
      <GeneratorPanel
        startOptions={loadGenOptions()}
        onChange={(options, password) => { saveGenOptions(options); current.current = password; force(); }}
      />
      <div className="flex flex-wrap gap-2">
        <Tooltip text="Copy it. It is cleared from the clipboard after 30 seconds.">
          <button type="button" onClick={() => current.current && copySecret(current.current)} disabled={!current.current} className={BTN} style={BTN_PRIMARY}>{getIcon('copy', { size: 14 })}Copy</button>
        </Tooltip>
        <Tooltip text="Start a new login with this password already filled in. You will be asked for your master password if the vault is locked.">
          <button type="button" onClick={() => current.current && onUse(current.current)} disabled={!current.current} className={BTN} style={BTN_OUTLINE}>{getIcon('key-round', { size: 14 })}Put it in a new login</button>
        </Tooltip>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>Made on this device with your browser's secure random numbers. Nothing is sent or saved until you put it in a login. Your choices are remembered on this browser only.</p>
    </div>
  );
}
