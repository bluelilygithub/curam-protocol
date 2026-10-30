import { useEffect, useRef, useState } from 'react';
import { ACTION_IDS, type ActionId, type Bridge, type Settings, type VerifyResult } from '../bridge/types';
import { HOTKEY_PROBLEM_TEXT, hotkeyFromEvent, hotkeyProblem } from '../lib/hotkey';
import { ACTION_LABELS, AUTO_CLEAR_CHOICES, DEFAULT_SETTINGS, RETENTION_MAX, RETENTION_MIN, clampRetention, normalizeAppName, normalizeBaseUrl } from '../lib/settings';
import { FONT_LIST, THEME_LIST } from '../lib/theme';
import { TIPS } from '../lib/tips';
import Icon from './Icon';
import Tooltip from './Tooltip';

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
    <section className="rounded-card border border-shelf-line bg-shelf-card/60 p-4 space-y-3">
      <h2 className="m-0 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Toggle({ label, hint, tip, checked, onChange }: { label: string; hint?: string; tip?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Tooltip text={tip}>
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[rgb(var(--shelf-accent))]" />
      <span>
        <span className="text-sm">{label}</span>
        {hint && <span className="block text-xs text-shelf-muted">{hint}</span>}
      </span>
    </label>
    </Tooltip>
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
        <kbd className={`px-2.5 py-1 rounded-lg border text-sm font-mono ${recording ? 'border-shelf-accent text-shelf-accent animate-pulse' : 'border-shelf-line'}`} aria-live="polite">
          {recording ? (heard ? `${heard}…` : 'Press the new shortcut…') : value}
        </kbd>
        <Tooltip text={TIPS.recordShortcut}><button type="button" onClick={() => { setRecording((r) => !r); setProblem(null); setHeard(null); }} className="px-3 py-1 rounded-lg text-xs border border-shelf-line hover:opacity-70 transition-opacity">{recording ? 'Cancel' : 'Record'}</button></Tooltip>
        {value !== DEFAULT_SETTINGS.hotkey && !recording && <Tooltip text={TIPS.resetShortcut}><button type="button" onClick={() => onChange(DEFAULT_SETTINGS.hotkey)} className="text-xs text-shelf-accent hover:opacity-70 transition-opacity">Reset to {DEFAULT_SETTINGS.hotkey}</button></Tooltip>}
      </div>
      {problem && <p className="m-0 text-xs text-shelf-danger" role="alert">{problem}</p>}
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

  // the shell checks every change itself and can refuse one (a shortcut another program already owns, a value that is not allowed): say so
  const [saveError, setSaveError] = useState<string | null>(null);
  const save = async (patch: Partial<Settings>) => {
    setSaveError(null);
    try { onSettings(await bridge.saveSettings(patch)); }
    catch (e) { setSaveError(e instanceof Error && e.message ? e.message : 'That setting could not be saved.'); }
  };
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

  const input = 'w-full px-3 py-2.5 rounded-xl border border-shelf-line bg-shelf-card/80 text-sm outline-none focus:border-shelf-accent focus:ring-1 focus:ring-shelf-accent';

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 mb-3">
        <Tooltip text={TIPS.back}><button type="button" onClick={onBack} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-sm hover:opacity-70 transition-opacity"><Icon name="back" size={16} /> Back</button></Tooltip>
        <h1 className="m-0 text-base font-semibold">Settings</h1>
      </div>
      {saveError && <p className="m-0 mb-2 rounded-card bg-shelf-danger/10 text-shelf-danger text-xs px-3 py-2" role="alert">{saveError}</p>}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="grid gap-3 lg:grid-cols-2 pb-3">
          <Section title="Appearance">
            <p className="m-0 text-xs text-shelf-muted">The same themes and fonts as Vault (Settings, Appearance in Vault). Pick the ones you use there to match.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
              {THEME_LIST.map((t) => {
                const on = settings.theme === t.id;
                return (
                  <Tooltip key={t.id} text={TIPS.theme}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => void save({ theme: t.id })}
                    className={`flex flex-col gap-1.5 p-2.5 rounded-xl border text-left transition-opacity hover:opacity-70 ${on ? 'border-shelf-accent ring-1 ring-shelf-accent' : 'border-shelf-line'}`}
                    style={{ background: t.bg, color: t.text }}
                  >
                    <span className="flex gap-1" aria-hidden="true">
                      {[t.surface, t.primary, t.border].map((c, i) => <span key={i} className="h-3.5 w-3.5 rounded-full border" style={{ background: c, borderColor: t.border }} />)}
                    </span>
                    <span className="text-xs font-medium">{t.label}</span>
                  </button>
                  </Tooltip>
                );
              })}
            </div>
            <Tooltip text={TIPS.font}><label className="block">
              <span className="text-xs text-shelf-muted">Font</span>
              <select value={settings.font} onChange={(e) => void save({ font: e.target.value })} className={input} style={{ fontFamily: FONT_LIST.find((f) => f.value === settings.font)?.style }}>
                {FONT_LIST.map((f) => <option key={f.value} value={f.value} style={{ fontFamily: f.style }}>{f.label}</option>)}
              </select>
            </label></Tooltip>
          </Section>

          <Section title="General and shortcuts">
            <div className="space-y-1"><div className="text-xs text-shelf-muted">Open the shelf with</div><HotkeyRecorder value={settings.hotkey} onChange={(hotkey) => void save({ hotkey })} /></div>
            <Toggle label="Start with Windows" hint="Opens quietly in the tray when you sign in." tip={TIPS.startWithWindows} checked={settings.startOnBoot} onChange={(startOnBoot) => void save({ startOnBoot })} />
            <Toggle label="Close the shelf after sending to Vault" tip={TIPS.closeAfterSend} checked={settings.autoDismiss} onChange={(autoDismiss) => void save({ autoDismiss })} />
          </Section>

          <Section title="Vault connection">
            <form onSubmit={checkConnection} className="space-y-2.5">
              <Tooltip text={TIPS.vaultAddress}><label className="block">
                <span className="text-xs text-shelf-muted">Vault address</span>
                <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="https://your-app.up.railway.app" inputMode="url" autoComplete="off" spellCheck={false} className={input} />
              </label></Tooltip>
              <Tooltip text={TIPS.ingestKey}><label className="block">
                <span className="text-xs text-shelf-muted">Ingest key</span>
                <input value={key} onChange={(e) => setKey(e.target.value)} type="password" placeholder={settings.hasKey ? 'A key is saved. Paste a new one to replace it.' : 'vsh_…'} autoComplete="off" spellCheck={false} className={`${input} font-mono`} />
              </label></Tooltip>
              <div className="flex items-center gap-3">
                <Tooltip text={TIPS.saveAndCheck}><button type="submit" disabled={checking} className="px-3.5 py-1.5 rounded-lg text-sm font-medium bg-shelf-accent text-shelf-onaccent hover:opacity-80 transition-opacity disabled:opacity-50">{checking ? 'Checking…' : 'Save and check'}</button></Tooltip>
                {settings.hasKey && !connError && verify?.ok && <span className="text-xs text-shelf-ok inline-flex items-center gap-1"><Icon name="check" size={14} /> Connected{verify.account ? ` as ${verify.account}` : ''}</span>}
              </div>
              {connError && <p className="m-0 text-xs text-shelf-danger" role="alert">{connError}</p>}
              <p className="m-0 text-xs text-shelf-muted">The key is kept in Windows Credential Manager, not in a file, and is never shown again. It is checked with Vault before it is saved.</p>
            </form>
            {verify?.ok && (
              <div className="text-xs text-shelf-muted space-y-0.5">
                {verify.keyLabel && <div>Key: {verify.keyLabel}</div>}
                {verify.unavailable.map((u) => <div key={u.scope}>Not available: {u.scope.replace(':', ' ')} ({u.reason})</div>)}
              </div>
            )}
          </Section>

          <Section title="Privacy and filters">
            <Toggle label="Ignore passwords" hint="Skip copies from password managers and anything marked as sensitive." tip={TIPS.ignorePasswords} checked={settings.ignorePasswords} onChange={(ignorePasswords) => void save({ ignorePasswords })} />
            <div>
              <label className="flex items-center justify-between text-sm" htmlFor="retention"><span>Keep the last</span><span className="font-mono">{retention} copies</span></label>
              <Tooltip text={TIPS.keepLast}><input id="retention" type="range" min={RETENTION_MIN} max={RETENTION_MAX} step={5} value={retention} onChange={(e) => changeRetention(Number(e.target.value))} className="w-full accent-[rgb(var(--shelf-accent))]" /></Tooltip>
            </div>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Clear copies automatically</span>
              <Tooltip text={TIPS.autoClear}><select value={settings.autoClearHours} onChange={(e) => void save({ autoClearHours: Number(e.target.value) })} className="px-2 py-1 rounded-lg border border-shelf-line bg-shelf-card/80 text-sm">
                {AUTO_CLEAR_CHOICES.map((h) => <option key={h} value={h}>{h === 0 ? 'Never' : h < 24 ? `After ${h} hour${h === 1 ? '' : 's'}` : `After ${h / 24} day${h === 24 ? '' : 's'}`}</option>)}
              </select></Tooltip>
            </label>
            <div className="space-y-1.5">
              <div className="text-xs text-shelf-muted">Never keep copies from these programs</div>
              <div className="flex flex-wrap gap-1.5">
                {settings.excludedApps.map((a) => (
                  <span key={a} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full bg-shelf-text/10 text-xs font-mono">
                    {a}<Tooltip text={TIPS.removeExcluded(a)}><button type="button" onClick={() => void save({ excludedApps: settings.excludedApps.filter((x) => x !== a) })} className="p-0.5 rounded-full hover:opacity-70 transition-opacity" aria-label={`Stop excluding ${a}`}><Icon name="x" size={12} /></button></Tooltip>
                  </span>
                ))}
                {settings.excludedApps.length === 0 && <span className="text-xs text-shelf-muted">None added.</span>}
              </div>
              <div className="flex gap-2">
                <Tooltip text={TIPS.excludedApp}><input value={appText} onChange={(e) => setAppText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addApp(); } }} placeholder="keepass.exe" spellCheck={false} className={`${input} font-mono`} aria-label="Program to exclude" /></Tooltip>
                <Tooltip text={TIPS.addExcluded}><button type="button" onClick={addApp} className="px-3 rounded-lg text-sm border border-shelf-line hover:opacity-70 transition-opacity">Add</button></Tooltip>
              </div>
              {appError && <p className="m-0 text-xs text-shelf-danger" role="alert">{appError}</p>}
            </div>
            <div className="pt-1">
              {confirmClear ? (
                <span className="text-sm inline-flex items-center gap-2">Clear everything on the shelf?
                  <Tooltip text={TIPS.confirmClear}><button type="button" onClick={async () => { await bridge.clearHistory(); setConfirmClear(false); onCleared(); }} className="font-medium text-shelf-danger hover:opacity-70 transition-opacity">Yes</button></Tooltip>
                  <button type="button" onClick={() => setConfirmClear(false)} className="text-shelf-muted hover:opacity-70 transition-opacity">No</button>
                </span>
              ) : <Tooltip text={TIPS.clearHistory}><button type="button" onClick={() => setConfirmClear(true)} className="text-sm text-shelf-danger hover:opacity-70 transition-opacity">Clear history…</button></Tooltip>}
            </div>
          </Section>

          <Section title="Quick-action buttons">
            <p className="m-0 text-xs text-shelf-muted">Choose which buttons show under a preview. A button your key cannot use is shown greyed out, with the reason.</p>
            <div className="space-y-2">
              {ACTION_IDS.map((id: ActionId) => (
                <Toggle key={id} label={ACTION_LABELS[id]} tip={TIPS.actionSwitch(ACTION_LABELS[id])} checked={settings.actions[id]} onChange={(on) => void save({ actions: { ...settings.actions, [id]: on } })} />
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
