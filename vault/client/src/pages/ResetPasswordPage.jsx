import React, { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useIcon } from '../providers/IconProvider';

function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const getIcon = useIcon();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirm) return setStatus({ ok: false, msg: 'Passwords do not match' });
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch('/api/auth/reset-password-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) return setStatus({ ok: false, msg: data.error || 'Failed to reset password' });
      setStatus({ ok: true, msg: 'Password reset! Redirecting to sign in…' });
      setTimeout(() => navigate('/login', { replace: true }), 2000);
    } catch {
      setStatus({ ok: false, msg: 'Network error' });
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--color-bg)' }}>
        <div className="text-center space-y-3">
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Invalid or missing reset link.</p>
          <Link to="/login" className="text-sm" style={{ color: 'var(--color-primary)' }}>Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--color-bg)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 text-xl font-bold"
            style={{ background: 'var(--color-surface)', color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}
          >
            ✦
          </div>
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text)' }}>Set new password</h1>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Enter your new password below</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border p-6 space-y-4"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          {[
            { label: 'New Password', key: 'pw', value: password, onChange: setPassword },
            { label: 'Confirm Password', key: 'confirm', value: confirm, onChange: setConfirm },
          ].map(({ label, key, value, onChange }) => (
            <div key={key}>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
                {label}
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
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
          ))}

          {status && (
            <p className="text-xs" style={{ color: status.ok ? 'var(--color-primary)' : '#ef4444' }}>
              {status.msg}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ background: 'var(--color-primary)' }}
          >
            {loading ? 'Resetting…' : 'Reset Password'}
          </button>

          <div className="text-center">
            <Link to="/login" className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Back to sign in
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ResetPasswordPage;
