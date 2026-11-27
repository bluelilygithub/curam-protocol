import React, { useEffect, useMemo, useState } from 'react';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import { useIcon } from '../../providers/IconProvider';
import { encodeQr, qrToSvg } from '../graphics/qrEncode.mjs';
import { downloadBlob } from '../../utils/exportHelpers';

// Admins' second step at sign-in (docs/two-step-login.md): an authenticator code or a backup code, or, for an admin with no
// authenticator yet, setting one up (QR drawn here from the otpauth link; the server never sends an image) and then the
// 10 backup codes, shown once. No VoiceInput on code fields, on purpose.

const box = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
const field = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const label = 'block text-xs font-semibold uppercase tracking-wider mb-1.5';
const primary = 'w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity duration-200 hover:opacity-70 disabled:opacity-50';
const link = 'text-xs transition-opacity duration-200 hover:opacity-70';

function CodeInput({ value, onChange, id, hint }) {
  return (
    <Tooltip text={hint}>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        autoComplete="one-time-code"
        inputMode="numeric"
        pattern="[0-9]{6}"
        required
        autoFocus
        placeholder="123456"
        className="w-full px-3 py-2.5 rounded-xl border text-lg tracking-[0.4em] text-center"
        style={field}
      />
    </Tooltip>
  );
}

function Remember({ checked, onChange, days }) {
  return (
    <Tooltip text="Untick on a shared or public computer. A new password, or a reset of your two-step login, forgets every remembered device.">
      <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: 'var(--color-primary)' }} />
        Remember this device for {days} days
      </label>
    </Tooltip>
  );
}

const ErrorLine = ({ text }) => (text ? <p className="text-xs" role="alert" style={{ color: '#ef4444' }}>{text}</p> : null);

/** The 10 backup codes, once, with Copy and Download; Continue only after "I've saved these". */
function BackupCodes({ codes, onContinue }) {
  const getIcon = useIcon();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = `Curam Vault backup codes (each works once)\n\n${codes.join('\n')}\n`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  };
  return (
    <div className="rounded-2xl border p-6 space-y-4" style={box}>
      <div className="flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
        {getIcon('shield-check', { size: 18 })}
        <h2 className="text-sm font-semibold">Save your backup codes</h2>
      </div>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        If you lose your phone, each of these lets you sign in once instead of an authenticator code. This is the only time they are shown.
        Keep them somewhere safe, away from this computer, such as a password manager.
      </p>
      <ul className="grid grid-cols-2 gap-2 font-mono text-sm" aria-label="Backup codes">
        {codes.map((c) => <li key={c} className="px-2 py-1.5 rounded-lg border text-center" style={field}>{c}</li>)}
      </ul>
      <div className="flex gap-2">
        <Tooltip text="Copy all 10 codes">
          <button type="button" onClick={copy} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border text-xs transition-opacity duration-200 hover:opacity-70" style={field}>
            {getIcon(copied ? 'check' : 'copy', { size: 14 })}{copied ? 'Copied' : 'Copy'}
          </button>
        </Tooltip>
        <Tooltip text="Save the codes as a text file">
          <button type="button" onClick={() => downloadBlob(new Blob([text], { type: 'text/plain' }), 'curam-vault-backup-codes.txt')} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border text-xs transition-opacity duration-200 hover:opacity-70" style={field}>
            {getIcon('download', { size: 14 })}Download
          </button>
        </Tooltip>
      </div>
      <Tooltip text="Tick once the codes are saved somewhere you can reach without this computer">
        <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} style={{ accentColor: 'var(--color-primary)' }} />
          I've saved these
        </label>
      </Tooltip>
      <Tooltip text="Finish signing in">
        <button type="button" disabled={!saved} onClick={onContinue} className={primary} style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>
          Continue
        </button>
      </Tooltip>
    </div>
  );
}

/** First sign-in for an admin with no authenticator: scan, confirm a code, then the backup codes. */
function Enrol({ challenge, postJson, onSignedIn, onStartOver }) {
  const getIcon = useIcon();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [keyCopied, setKeyCopied] = useState(false);

  useEffect(() => {
    postJson('/api/auth/challenge/enrol/start', { challengeId: challenge.challengeId }).then(({ ok, data }) => {
      if (ok) setSetup(data);
      else onStartOver(data.error || 'This sign-in has expired. Start again.');
    }).catch(() => setError('Network error — please try again'));
  }, [challenge.challengeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const qrSrc = useMemo(() => {
    if (!setup) return '';
    const svg = qrToSvg(encodeQr(setup.otpauthUri, { ecc: 'M' }), { margin: 4 });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [setup]);

  const confirm = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { ok, data } = await postJson('/api/auth/challenge/enrol/confirm', { challengeId: challenge.challengeId, code, rememberDevice: remember });
      if (ok) { setDone(data); return; }
      if (data.code === 'challenge_dead') return onStartOver(data.error);
      setError(data.error || "That code didn't work.");
      setCode('');
    } catch {
      setError('Network error — please try again');
    } finally {
      setBusy(false);
    }
  };

  if (done) return <BackupCodes codes={done.backupCodes} onContinue={() => onSignedIn(done)} />;

  return (
    <form onSubmit={confirm} className="rounded-2xl border p-6 space-y-4" style={box}>
      <div className="flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
        {getIcon('smartphone', { size: 18 })}
        <h2 className="text-sm font-semibold">Set up your authenticator app</h2>
      </div>
      <ol className="text-xs space-y-1 list-decimal pl-4" style={{ color: 'var(--color-muted)' }}>
        <li>Admins need an authenticator app. Install one on your phone if you have none (Google Authenticator, Microsoft Authenticator or 1Password all work).</li>
        <li>In the app, add an account and scan this code.</li>
        <li>Type the 6-digit code the app shows.</li>
      </ol>
      <div className="flex justify-center">
        {qrSrc
          ? <img src={qrSrc} alt="QR code to scan with your authenticator app" width={200} height={200} className="rounded-lg" data-otpauth-qr />
          : <div className="w-[200px]"><Skeleton className="h-[200px] rounded-lg" label="Making your QR code" /></div>}
      </div>
      {setup && (
        <div>
          <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Can't scan it? Type this key into the app instead:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-2 py-1.5 rounded-lg border text-xs break-all" style={field} data-manual-key>{setup.manualKey}</code>
            <Tooltip text={keyCopied ? 'Copied' : 'Copy the key'}>
              <button type="button" onClick={() => navigator.clipboard.writeText(setup.manualKey.replace(/ /g, '')).then(() => setKeyCopied(true), () => {})} className="p-2 rounded-lg border transition-opacity duration-200 hover:opacity-70" style={field} aria-label="Copy the key">
                {getIcon(keyCopied ? 'check' : 'copy', { size: 14 })}
              </button>
            </Tooltip>
          </div>
        </div>
      )}
      <div>
        <label htmlFor="enrol-code" className={label} style={{ color: 'var(--color-muted)' }}>Code from the app</label>
        <CodeInput id="enrol-code" value={code} onChange={setCode} hint="The 6-digit code your authenticator app shows for Curam Vault. It changes every 30 seconds." />
      </div>
      <Remember checked={remember} onChange={setRemember} days={challenge.rememberDays || 7} />
      <ErrorLine text={error} />
      <Tooltip text="Check the code, switch the authenticator on and show your backup codes">
        <button type="submit" disabled={busy || !setup || code.length !== 6} className={primary} style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>
          {busy ? 'Checking…' : 'Turn on and continue'}
        </button>
      </Tooltip>
      <Tooltip text="Go back and sign in again">
        <button type="button" onClick={() => onStartOver('')} className={link} style={{ color: 'var(--color-muted)' }}>Start again</button>
      </Tooltip>
    </form>
  );
}

/** An enrolled admin: authenticator code, or a backup code instead. */
function TotpStep({ challenge, postJson, onSignedIn, onStartOver }) {
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { ok, data } = useBackup
        ? await postJson('/api/auth/challenge/backup', { challengeId: challenge.challengeId, backupCode: backup, rememberDevice: remember })
        : await postJson('/api/auth/challenge/verify', { challengeId: challenge.challengeId, code, rememberDevice: remember });
      if (ok) return onSignedIn(data);
      if (data.code === 'challenge_dead') return onStartOver(data.error);
      setError(data.error || "That code didn't work.");
      setCode('');
      setBackup('');
    } catch {
      setError('Network error — please try again');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border p-6 space-y-4" style={box}>
      <p className="text-sm" style={{ color: 'var(--color-text)' }}>
        {useBackup ? 'Type one of your backup codes. Each works once.' : 'Type the 6-digit code from your authenticator app.'}
      </p>
      {useBackup ? (
        <div>
          <label htmlFor="backup-code" className={label} style={{ color: 'var(--color-muted)' }}>Backup code</label>
          <Tooltip text="One of the 10 codes you saved when you set up the authenticator, such as ABCDE-FGHJK">
            <input id="backup-code" value={backup} onChange={(e) => setBackup(e.target.value)} autoComplete="off" autoFocus required placeholder="ABCDE-FGHJK"
              className="w-full px-3 py-2.5 rounded-xl border text-base tracking-widest text-center font-mono uppercase" style={field} />
          </Tooltip>
        </div>
      ) : (
        <div>
          <label htmlFor="totp-code" className={label} style={{ color: 'var(--color-muted)' }}>Authenticator code</label>
          <CodeInput id="totp-code" value={code} onChange={setCode} hint="The code your authenticator app shows for Curam Vault. It changes every 30 seconds." />
        </div>
      )}
      <Remember checked={remember} onChange={setRemember} days={challenge.rememberDays || 7} />
      <ErrorLine text={error} />
      <Tooltip text="Check the code and sign in">
        <button type="submit" disabled={busy || (useBackup ? backup.replace(/[^a-z0-9]/gi, '').length !== 10 : code.length !== 6)} className={primary} style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </Tooltip>
      <div className="flex items-center justify-between">
        <Tooltip text="Go back and sign in again">
          <button type="button" onClick={() => onStartOver('')} className={link} style={{ color: 'var(--color-muted)' }}>Start again</button>
        </Tooltip>
        <Tooltip text={useBackup ? 'Type a code from your authenticator app instead' : "Lost your phone? Use one of the backup codes you saved"}>
          <button type="button" onClick={() => { setUseBackup((v) => !v); setError(''); }} className={link} style={{ color: 'var(--color-primary)' }}>
            {useBackup ? 'Use the authenticator app' : 'Use a backup code'}
          </button>
        </Tooltip>
      </div>
    </form>
  );
}

export default function AdminSecondStep(props) {
  return props.challenge.method === 'totp_enrol' ? <Enrol {...props} /> : <TotpStep {...props} />;
}
