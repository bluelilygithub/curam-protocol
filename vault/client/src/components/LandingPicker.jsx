import React, { useState, useEffect } from 'react';
import { APP_NAV_GROUPS } from '../config/appNavigation';

// "Where Vault opens": pick an app, or a custom link (an app path like /finance, or a full https:// link).
// value '' = none / inherit. onSave(path) is called with the new value ('' clears it).
const APPS = APP_NAV_GROUPS.flatMap((g) => g.items.filter((i) => !i.external && i.path).map((i) => ({ path: i.path, label: i.label, group: g.label })));
const CUSTOM = '__custom';

export default function LandingPicker({ value, onSave, emptyLabel, disabled }) {
  const known = !value || APPS.some((a) => a.path === value);
  const [custom, setCustom] = useState(!known);
  const [text, setText] = useState(known ? '' : value);
  useEffect(() => {
    const k = !value || APPS.some((a) => a.path === value);
    setCustom(!k);
    setText(k ? '' : value);
  }, [value]);

  const fieldStyle = { borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' };
  const groups = [...new Set(APPS.map((a) => a.group))];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={custom ? CUSTOM : value}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === CUSTOM) { setCustom(true); return; }
          setCustom(false);
          onSave(e.target.value);
        }}
        className="px-2.5 py-1.5 rounded-md border text-xs outline-none max-w-[14rem]"
        style={fieldStyle}
      >
        <option value="">{emptyLabel}</option>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {APPS.filter((a) => a.group === g).map((a) => <option key={a.path} value={a.path}>{a.label}</option>)}
          </optgroup>
        ))}
        <option value={CUSTOM}>Custom link…</option>
      </select>
      {custom && (
        <>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="/finance or https://…"
            className="px-2.5 py-1.5 rounded-md border text-xs outline-none w-48"
            style={fieldStyle}
          />
          <button
            onClick={() => onSave(text.trim())}
            disabled={disabled}
            className="px-2.5 py-1.5 rounded-md text-xs text-white disabled:opacity-50 hover:opacity-80 transition-opacity"
            style={{ background: 'var(--color-primary)' }}
          >
            Save
          </button>
        </>
      )}
    </div>
  );
}
