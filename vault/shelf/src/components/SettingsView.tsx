import { useEffect, useRef, useState } from 'react';
import { ACTION_IDS, type ActionId, type Bridge, type Settings, type VerifyResult } from '../bridge/types';
import { HOTKEY_PROBLEM_TEXT, hotkeyFromEvent, hotkeyProblem } from '../lib/hotkey';
import { ACTION_LABELS, AUTO_CLEAR_CHOICES, DEFAULT_SETTINGS, RETENTION_MAX, RETENTION_MIN, clampRetention, normalizeAppName, normalizeBaseUrl } from '../lib/settings';
import Icon from './Icon';

interface Props {
  bridge: Bridge;
  settings: Settings;
  verify: VerifyResult | null;
  onSettings: (s: Settings) => void;
  onVerify: (v: VerifyResult) => void;
  onBack: () => void;
  onCleared: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-shelf-line/10 bg-shelf-card/60 p-4 space-y-3">
      <h2 className="m-0 text-[13px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[rgb(var(--shelf-accent))]" />
      <span>
        <span className="text-[13px]">{label}</span>
        {hint && <span className="block text-[11.5px] text-shelf-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** Press "Record", then the new shortcut. Escape cancels. The shortcut only counts if it passes the same rules the shell enforces. */
function HotkeyRecorder({ value, onChange }: { value: string; onChange: (hotkey: string) => void }) {
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
        <kbd className={`px-2.5 py-1 rounded-md border text-[13px] font-mono ${recording ? 'border-shelf-accent text-shelf-accent animate-pulse' : 'border-shelf-line/25'}`} aria-live="polite">
          {recording ? (heard ? `${heard}…` : 'Press the new shortcut…') : value}
        </kbd>
        <button type="button" onClick={() => { setRecording((r) => !r); setProblem(null); setHeard(null); }} className="px-3 py-1 rounded-md text-[12.5px] border border-shelf-line/20 hover:bg-shelf-text/10 transition-colors">{recording ? 'Cancel' : 'Record'}</button>
        {value !== DEFAULT_SETTINGS.hotkey && !recording && <button type="button" onClick={() => onChange(DEFAULT_SETTINGS.hotkey)} className="text-[12px] text-shelf-accent hover:opacity-70 transition-opacity">Reset to {DEFAULT_SETTINGS.hotkey}</button>}
      </div>
      {problem && <p className="m-0 text-[12px] text-shelf-danger" role="alert">{problem}</p>}
    </div>
  );
}

export default function SettingsView({ bridge, settings, verify, onSettings, onVerify, onBack, onCleared }: Props) {
  const [address, setAddress] = useState(settings.baseUrl);
  const [key, setKey] = useState('');
  const [checking, setChecking] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [appText, setAppText] = useState('');
  const [appError, setAppError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [retention, setRetention] = useState(settings.retentionItems);
  const slider = useRef<number>(0);

  const save = async (patch: Partial<Settings>) => onSettings(await bridge.saveSettings(patch));
  const changeRetention = (n: number) => {
    setRetention(n);
    window.clearTimeout(slider.current);
    slider.current = window.setTimeout(() => { void save({ retentionItems: clampRetention(n) }); }, 350);
  };
  useEffect(() => () => window.clearTimeout(slider.current), []);

  async function checkConnection(e: React.FormEvent) {
    e.preventDefault();
    setConnError(null);
    const u = normalizeBaseUrl(address);
    if (!u.ok) { setConnError(u.error); return; }
    if (!key.trim() && !settings.hasKey) { setConnError('Paste your Vault key (Settings, Vault Shelf in Vault).'); return; }
    setChecking(true);
    try {
      const r = await bridge.saveConnection(u.url, key.trim());
      if (!r.ok) { setConnError(r.error || 'That key was not accepted.'); return; }
      setKey('');
      setAddress(u.url);
      onVerify(r);
      onSettings(await bridge.getSettings());
    } finally {
      setChecking(false);
    }
  }

  function addApp() {
    const name = normalizeAppName(appText);
    if (!name) { setAppError('Enter a program name such as keepass.exe (no folders).'); return; }
    setAppError(null); setAppText('');
    if (!settings.excludedApps.includes(name)) void save({ excludedApps: [...settings.excludedApps, name] });
  }

  const input = 'w-full px-3 py-2 rounded-md border border-shelf-line/20 bg-shelf-card/80 text-[13px] outline-none focus:border-shelf-accent focus:ring-1 focus:ring-shelf-accent';

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 mb-3">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[13px] hover:bg-shelf-text/10 transition-colors"><Icon name="back" size={16} /> Back</button>
        <h1 className="m-0 text-[15px] font-semibold">Settings</h1>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="grid gap-3 lg:grid-cols-2 pb-3">
          <Section title="General and shortcuts">
            <div className="space-y-1"><div className="text-[12px] text-shelf-muted">Open the shelf with</div><HotkeyRecorder value={settings.hotkey} onChange={(hotkey) => void save({ hotkey })} /></div>
            <Toggle label="Start with Windows" hint="Opens quietly in the tray when you sign in." checked={settings.startOnBoot} onChange={(startOnBoot) => void save({ startOnBoot })} />
            <Toggle label="Close the shelf after sending to Vault" checked={settings.autoDismiss} onChange={(autoDismiss) => void save({ autoDismiss })} />
          </Section>

          <Section title="Vault connection">
            <form onSubmit={checkConnection} className="space-y-2.5">
              <label className="block">
                <span className="text-[12px] text-shelf-muted">Vault address</span>
                <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="https://your-app.up.railway.app" inputMode="url" autoComplete="off" spellCheck={false} className={input} />
              </label>
              <label className="block">
                <span className="text-[12px] text-shelf-muted">Ingest key</span>
                <input value={key} onChange={(e) => setKey(e.target.value)} type="password" placeholder={settings.hasKey ? 'A key is saved. Paste a new one to replace it.' : 'vsh_…'} autoComplete="off" spellCheck={false} className={`${input} font-mono`} />
              </label>
              <div className="flex items-center gap-3">
                <button type="submit" disabled={checking} className="px-3.5 py-1.5 rounded-md text-[13px] font-medium bg-shelf-accent text-white hover:opacity-80 transition-opacity disabled:opacity-50">{checking ? 'Checking…' : 'Save and check'}</button>
                {settings.hasKey && !connError && verify?.ok && <span className="text-[12.5px] text-shelf-ok inline-flex items-center gap-1"><Icon name="check" size={14} /> Connected{verify.account ? ` as ${verify.account}` : ''}</span>}
              </div>
              {connError && <p className="m-0 text-[12.5px] text-shelf-danger" role="alert">{connError}</p>}
              <p className="m-0 text-[11.5px] text-shelf-muted">The key is kept in Windows Credential Manager, not in a file, and is never shown again. It is checked with Vault before it is saved.</p>
            </form>
            {verify?.ok && (
              <div className="text-[12px] text-shelf-muted space-y-0.5">
                {verify.keyLabel && <div>Key: {verify.keyLabel}</div>}
                {verify.unavailable.map((u) => <div key={u.scope}>Not available: {u.scope.replace(':', ' ')} ({u.reason})</div>)}
              </div>
            )}
          </Section>

          <Section title="Privacy and filters">
            <Toggle label="Ignore passwords" hint="Skip copies from password managers and anything marked as sensitive." checked={settings.ignorePasswords} onChange={(ignorePasswords) => void save({ ignorePasswords })} />
            <div>
              <label className="flex items-center justify-between text-[13px]" htmlFor="retention"><span>Keep the last</span><span className="font-mono">{retention} copies</span></label>
              <input id="retention" type="range" min={RETENTION_MIN} max={RETENTION_MAX} step={5} value={retention} onChange={(e) => changeRetention(Number(e.target.value))} className="w-full accent-[rgb(var(--shelf-accent))]" />
            </div>
            <label className="flex items-center justify-between gap-3 text-[13px]">
              <span>Clear copies automatically</span>
              <select value={settings.autoClearHours} onChange={(e) => void save({ autoClearHours: Number(e.target.value) })} className="px-2 py-1 rounded-md border border-shelf-line/20 bg-shelf-card/80 text-[13px]">
                {AUTO_CLEAR_CHOICES.map((h) => <option key={h} value={h}>{h === 0 ? 'Never' : h < 24 ? `After ${h} hour${h === 1 ? '' : 's'}` : `After ${h / 24} day${h === 24 ? '' : 's'}`}</option>)}
              </select>
            </label>
            <div className="space-y-1.5">
              <div className="text-[12px] text-shelf-muted">Never keep copies from these programs</div>
              <div className="flex flex-wrap gap-1.5">
                {settings.excludedApps.map((a) => (
                  <span key={a} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full bg-shelf-text/10 text-[12px] font-mono">
                    {a}<button type="button" onClick={() => void save({ excludedApps: settings.excludedApps.filter((x) => x !== a) })} className="p-0.5 rounded-full hover:bg-shelf-text/15 transition-colors" aria-label={`Stop excluding ${a}`}><Icon name="x" size={12} /></button>
                  </span>
                ))}
                {settings.excludedApps.length === 0 && <span className="text-[12px] text-shelf-muted">None added.</span>}
              </div>
              <div className="flex gap-2">
                <input value={appText} onChange={(e) => setAppText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addApp(); } }} placeholder="keepass.exe" spellCheck={false} className={`${input} font-mono`} aria-label="Program to exclude" />
                <button type="button" onClick={addApp} className="px-3 rounded-md text-[13px] border border-shelf-line/20 hover:bg-shelf-text/10 transition-colors">Add</button>
              </div>
              {appError && <p className="m-0 text-[12px] text-shelf-danger" role="alert">{appError}</p>}
            </div>
            <div className="pt-1">
              {confirmClear ? (
                <span className="text-[13px] inline-flex items-center gap-2">Clear everything on the shelf?
                  <button type="button" onClick={async () => { await bridge.clearHistory(); setConfirmClear(false); onCleared(); }} className="font-medium text-shelf-danger hover:opacity-70 transition-opacity">Yes</button>
                  <button type="button" onClick={() => setConfirmClear(false)} className="text-shelf-muted hover:opacity-70 transition-opacity">No</button>
                </span>
              ) : <button type="button" onClick={() => setConfirmClear(true)} className="text-[13px] text-shelf-danger hover:opacity-70 transition-opacity">Clear history…</button>}
            </div>
          </Section>

          <Section title="Quick-action buttons">
            <p className="m-0 text-[12px] text-shelf-muted">Choose which buttons show under a preview. A button your key cannot use is shown greyed out, with the reason.</p>
            <div className="space-y-2">
              {ACTION_IDS.map((id: ActionId) => (
                <Toggle key={id} label={ACTION_LABELS[id]} checked={settings.actions[id]} onChange={(on) => void save({ actions: { ...settings.actions, [id]: on } })} />
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
