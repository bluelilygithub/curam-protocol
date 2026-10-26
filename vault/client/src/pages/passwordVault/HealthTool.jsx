import React, { useMemo } from 'react';
import UnlockGate from './UnlockGate';
import { KINDS, checkHealth } from './vaultHealth.mjs';
import { BTN, BTN_OUTLINE, CARD, CARD_STYLE, STATUS } from './shared';

const KIND_COLOR = { reused: STATUS.bad, weak: STATUS.bad, old: STATUS.warn, missing: STATUS.warn };

export default function HealthTool({ vault, onOpenEntry, onForgot }) {
  const report = useMemo(() => checkHealth(vault.items.filter((i) => !i.unreadable)), [vault.items]);
  const usable = vault.status?.setUp && vault.unlocked;
  if (!usable) return <UnlockGate vault={vault} onForgot={onForgot} />;

  const unreadable = vault.items.filter((i) => i.unreadable).length;
  const { findings, counts, checked } = report;

  return (
    <div className="space-y-4" data-guide="health">
      <div className={CARD} style={CARD_STYLE}>
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
          {checked === 0 ? 'Nothing to check yet' : findings.length === 0 ? 'Your passwords look healthy' : `${findings.length} thing${findings.length === 1 ? '' : 's'} worth a look`}
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          Checked {checked} login{checked === 1 ? '' : 's'} on this device. {checked === 0 ? 'Add some in My passwords.' : 'Nothing was sent anywhere.'} This cannot tell whether a password has appeared in a data breach.
        </p>
        {findings.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => (
              <span key={k} className="text-xs font-semibold px-2 py-0.5 rounded-full border" style={{ borderColor: KIND_COLOR[k], color: KIND_COLOR[k] }}>{KINDS[k].word}: {n}</span>
            ))}
          </div>
        )}
        {unreadable > 0 && <p className="text-xs" style={{ color: STATUS.bad }}>{unreadable} could not be opened with your master password and was skipped.</p>}
      </div>

      <ul className="space-y-2">
        {findings.map((f, i) => (
          <li key={`${f.entryId}-${f.kind}-${i}`} className="rounded-xl border p-4 flex items-start gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                <span className="inline-block text-xs font-semibold mr-2 px-1.5 py-0.5 rounded" style={{ color: KIND_COLOR[f.kind], border: `1px solid ${KIND_COLOR[f.kind]}` }}>{KINDS[f.kind].word}</span>
                {f.title}
              </p>
              <p className="text-xs mt-1 leading-relaxed break-words" style={{ color: 'var(--color-muted)' }}>{f.detail}</p>
            </div>
            <button type="button" onClick={() => onOpenEntry(f.entryId)} className={`${BTN} shrink-0`} style={BTN_OUTLINE}>Open</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
