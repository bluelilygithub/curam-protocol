import { useEffect, useState } from 'react';
import { HOTKEY_PROBLEM_TEXT, hotkeyFromEvent, hotkeyProblem } from '../lib/hotkey';
import { DEFAULT_SETTINGS } from '../lib/settings';
import { NavIcon } from '../lib/navIcons';
import { TIPS } from '../lib/tips';
import Tooltip from './Tooltip';

// Small controls shared by the shelf's Settings screen and the launcher's own settings panel.

export function Toggle({ label, hint, tip, checked, onChange, icon }: { label: string; hint?: string; tip?: string; checked: boolean; onChange: (v: boolean) => void; icon?: string }) {
  return (
    <Tooltip text={tip}>
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[rgb(var(--shelf-accent))]" />
      <span>
        <span className="text-sm inline-flex items-center gap-1.5">{icon !== undefined && <span className="text-shelf-muted"><NavIcon name={icon} size={14} /></span>}{label}</span>
        {hint && <span className="block text-xs text-shelf-muted">{hint}</span>}
      </span>
    </label>
    </Tooltip>
  );
}

/** Press "Record", then the new shortcut. Escape cancels. The shortcut only counts if it passes the same rules the shell enforces. */
export function HotkeyRecorder({ value, onChange, defaultValue = DEFAULT_SETTINGS.hotkey, tip = TIPS.recordShortcut, resetTip = TIPS.resetShortcut }: { value: string; onChange: (hotkey: string) => void; defaultValue?: string; tip?: string; resetTip?: string }) {
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  useEffect(() => {
    if (!recording) return undefined;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { setRecording(false); setHeard(null); setProblem(null); return; }
      const h = hotkeyFromEvent(e);
      if (!h) { setHeard([e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win'].filter(Boolean).join('+') || null); return; }
      const p = hotkeyProblem(h);
      setHeard(h);
      if (p) { setProblem(HOTKEY_PROBLEM_TEXT[p]); return; }
      setProblem(null); setRecording(false); onChange(h);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, onChange]);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <kbd className={`px-2.5 py-1 rounded-lg border text-sm font-mono ${recording ? 'border-shelf-accent text-shelf-accent animate-pulse' : 'border-shelf-line'}`} aria-live="polite">
          {recording ? (heard ? `${heard}…` : 'Press the new shortcut…') : value}
        </kbd>
        <Tooltip text={tip}><button type="button" onClick={() => { setRecording((r) => !r); setProblem(null); setHeard(null); }} className="px-3 py-1 rounded-lg text-xs border border-shelf-line hover:opacity-70 transition-opacity">{recording ? 'Cancel' : 'Record'}</button></Tooltip>
        {value !== defaultValue && !recording && <Tooltip text={resetTip}><button type="button" onClick={() => onChange(defaultValue)} className="text-xs text-shelf-accent hover:opacity-70 transition-opacity">Reset to {defaultValue}</button></Tooltip>}
      </div>
      {problem && <p className="m-0 text-xs text-shelf-danger" role="alert">{problem}</p>}
    </div>
  );
}

