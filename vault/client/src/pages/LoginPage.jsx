import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { useIcon } from '../providers/IconProvider';
import Dialog from '../components/Dialog';
import Tooltip from '../components/Tooltip';

function safeNextPath(search) {
  const next = new URLSearchParams(search || '').get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/';
  if (next.startsWith('/login') || next.startsWith('/reset-password')) return '/';
  return next;
}

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const getIcon = useIcon();
  const nextPath = safeNextPath(location.search);

  // Two-step login (docs/two-step-login.md): set when the password was right and a code is needed
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!challenge || resendAt <= Date.now()) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [challenge, resendAt]);
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  // Forgot password modal state
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotStatus, setForgotStatus] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Login failed'); return; }
      if (data.challengeId) {
        setChallenge(data);
        setCode('');
        setResendAt(data.sendFailed ? 0 : Date.now() + 60000);
        if (data.sendFailed) setError(data.error);
        return;
      }
      setAuth(data.token, data.user);
      navigate(nextPath, { replace: true });
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  };

  // Second step. Raw fetch like the password step: apiClient's 401 handler reloads /login and would lose the challenge.
  const postJson = async (url, body) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  };

  const startOver = (msg) => { setChallenge(null); setCode(''); setPassword(''); setError(msg || ''); };

  const handleVerify = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { ok, data } = await postJson('/api/auth/challenge/verify', { challengeId: challenge.challengeId, code, rememberDevice: remember });
      if (ok) { setAuth(data.token, data.user); navigate(nextPath, { replace: true }); return; }
      if (data.code === 'challenge_dead') return startOver(data.error);
      setError(data.error || "That code didn't work.");
      setCode('');
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setLoading(true);
    try {
      const { ok, data } = await postJson('/api/auth/challenge/resend', { challengeId: challenge.challengeId });
      if (data.code === 'challenge_dead') return startOver(data.error);
      if (ok) { setResendAt(Date.now() + 60000); setCode(''); return; }
      setError(data.error || "We couldn't send your code. Try again, or ask an admin.");
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    setForgotLoading(true);
    setForgotStatus(null);
    try {
      const res = await fetch('/api/auth/reset-password-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      });
      const data = await res.json();
      if (!res.ok) return setForgotStatus({ ok: false, msg: data.error || 'Failed' });
      setForgotStatus({ ok: true, msg: 'If that email is registered, a reset link has been sent.' });
    } catch {
      setForgotStatus({ ok: false, msg: 'Network error' });
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--color-bg)' }}
    >
      {/* Forgot password modal */}
      {showForgot && (
        <Dialog raw onClose={() => setShowForgot(false)}
        overlayClassName="fixed inset-0 z-50 flex items-center justify-center px-4"
        overlayStyle={{ background: 'rgba(0,0,0,0.5)' }}
        panelClassName="w-full max-w-sm rounded-2xl border p-6 space-y-4"
        panelStyle={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Reset Password</h2>
              <button
                onClick={() => setShowForgot(false)}
                className="opacity-50 hover:opacity-100 transition-opacity"
                style={{ color: 'var(--color-muted)' }}
              >
                {getIcon('x', { size: 16 })}
              </button>
            </div>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Enter your email address and we'll send a password reset link.
            </p>
            <form onSubmit={handleForgotSubmit} className="space-y-3">
              <input
                type="email"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                required
                autoFocus
                placeholder="you@example.com"
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
              {forgotStatus && (
                <p className="text-xs" style={{ color: forgotStatus.ok ? 'var(--color-primary)' : '#ef4444' }}>
                  {forgotStatus.msg}
                </p>
              )}
              <button
                type="submit"
                disabled={forgotLoading}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                {forgotLoading ? 'Sending…' : 'Send Reset Link'}
              </button>
            </form>
          </Dialog>
      )}

      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 text-xl font-bold"
            style={{ background: 'var(--color-surface)', color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}
          >
            ✦
          </div>
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text)' }}>Project Vault</h1>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Sign in to your workspace. Accounts are created by an administrator.</p>
        </div>

        {challenge ? (
          <form
            onSubmit={handleVerify}
            className="rounded-2xl border p-6 space-y-4"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>
              {challenge.sendFailed && !resendAt ? 'Your password was right. Send a sign-in code to ' : 'We sent a 6-digit code to '}
              <strong>{challenge.emailHint}</strong>.
            </p>
            {/* Deliberately no VoiceInput: a code is read off another screen and typed or pasted (docs/two-step-login.md) */}
            <div>
              <label htmlFor="login-code" className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
                Sign-in code
              </label>
              <Tooltip text="The 6-digit code from the email. It works for 10 minutes. Pasting the whole code is fine.">
                <input
                  id="login-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  required
                  autoFocus
                  placeholder="123456"
                  className="w-full px-3 py-2.5 rounded-xl border text-lg tracking-[0.4em] text-center"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
              </Tooltip>
            </div>

            <Tooltip text="Untick on a shared or public computer. A new password forgets every remembered device.">
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ accentColor: 'var(--color-primary)' }} />
                Remember this device for {challenge.rememberDays || 30} days
              </label>
            </Tooltip>

            {error && <p className="text-xs" role="alert" style={{ color: '#ef4444' }}>{error}</p>}

            <Tooltip text="Check the code and sign in">
              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity duration-200 hover:opacity-70 disabled:opacity-50"
                style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}
              >
                {loading ? 'Checking…' : 'Sign in'}
              </button>
            </Tooltip>

            <div className="flex items-center justify-between text-xs">
              <Tooltip text="Go back and sign in again">
                <button type="button" onClick={() => startOver('')} className="transition-opacity duration-200 hover:opacity-70" style={{ color: 'var(--color-muted)' }}>
                  Start again
                </button>
              </Tooltip>
              <Tooltip text={resendIn ? 'You can ask for a new code once a minute' : 'Email a new code. The old one stops working.'}>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={loading || resendIn > 0}
                  className="transition-opacity duration-200 hover:opacity-70 disabled:opacity-50"
                  style={{ color: 'var(--color-primary)' }}
                >
                  {resendIn ? `Resend in ${resendIn}s` : (challenge.sendFailed && !resendAt ? 'Send code' : 'Resend code')}
                </button>
              </Tooltip>
            </div>
          </form>
        ) : (
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border p-6 space-y-4"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              placeholder="you@example.com"
              className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Password
            </label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full px-3 py-2.5 pr-10 rounded-xl border text-sm outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 transition-opacity"
                style={{ color: 'var(--color-muted)' }}
              >
                {getIcon(showPw ? 'eye-off' : 'eye', { size: 14 })}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ background: 'var(--color-primary)' }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        )}

        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={() => { setShowForgot(true); setForgotStatus(null); setForgotEmail(''); }}
            className="text-xs hover:opacity-70 transition-opacity"
            style={{ color: 'var(--color-muted)' }}
          >
            Forgot password?
          </button>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
