import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';

function AuthGuard({ children }) {
  const { token, setAuth, clearAuth } = useAuthStore();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!token) {
      navigate('/login', { replace: true });
      setChecking(false);
      return;
    }
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    }).then(async (res) => {
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data?.user) setAuth(token, data.user);
        setChecking(false);
      } else {
        clearAuth();
        navigate('/login', { replace: true });
        setChecking(false);
      }
    }).catch(() => {
      clearAuth();
      navigate('/login', { replace: true });
      setChecking(false);
    });
  }, []);

  if (checking) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--color-bg)' }}>
        <div className="flex gap-1.5">
          <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--color-primary)', animationDelay: '0ms' }} />
          <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--color-primary)', animationDelay: '150ms' }} />
          <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--color-primary)', animationDelay: '300ms' }} />
        </div>
      </div>
    );
  }

  return children;
}

export default AuthGuard;
