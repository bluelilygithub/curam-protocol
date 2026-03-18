import React from 'react';
import useToastStore from '../store/toastStore';

export default function Toast() {
  const { toasts, removeToast } = useToastStore();
  if (!toasts.length) return null;

  return (
    <div
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
              t.type === 'warn'  ? '#d97706' :
              '#16a34a',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            maxWidth: '320px',
            animation: 'toast-in 0.2s ease',
          }}
        >
          {t.message}
        </div>
      ))}
      <style>{`@keyframes toast-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }`}</style>
    </div>
  );
}
