import React from 'react';
import { useNavigate } from 'react-router-dom';
import useToastStore from '../store/toastStore';

export default function Toast() {
  const { toasts, removeToast } = useToastStore();
  const navigate = useNavigate();
  // The live region is always on the page (even with no toasts) so a screen reader announces a toast the moment it is added.
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        pointerEvents: 'none',
      }}
    >
      {toasts.map(t => (
        <div
          key={t.id}
          role={t.type === 'error' ? 'alert' : 'status'}
          onClick={() => removeToast(t.id)}
          style={{
            pointerEvents: 'auto',
            cursor: 'pointer',
            padding: '10px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 500,
            color: '#fff',
            background:
              t.type === 'error' ? '#dc2626' :
              t.type === 'warn'  ? '#b45309' :
              '#15803d', // darker than the usual green/amber so white text is 4.5:1 or better
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            maxWidth: '320px',
            animation: 'toast-in 0.2s ease',
          }}
        >
          {t.message}
          {t.action && (
            <>
              {' '}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeToast(t.id); if (t.action.onClick) t.action.onClick(); else navigate(t.action.href); }}
                style={{ textDecoration: 'underline', fontWeight: 700, background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }}
              >
                {t.action.label}
              </button>
            </>
          )}
        </div>
      ))}
      <style>{`@keyframes toast-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }`}</style>
    </div>
  );
}
