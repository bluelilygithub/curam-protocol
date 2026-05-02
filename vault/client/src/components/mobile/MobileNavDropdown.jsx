import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import api from '../../utils/apiClient';
import { DEFAULT_NAV_ITEMS, mergeWithDefaults } from '../../utils/mobileConfig';

export default function MobileNavDropdown({ onClose }) {
  const location = useLocation();
  const [items, setItems] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    api.get('/api/settings').then(r => r.json()).then(data => {
      try {
        const saved = JSON.parse(data.mobile_nav_items || 'null');
        setItems(mergeWithDefaults(saved, DEFAULT_NAV_ITEMS));
      } catch {
        setItems(DEFAULT_NAV_ITEMS.map(i => ({ ...i })));
      }
    }).catch(() => {
      setItems(DEFAULT_NAV_ITEMS.map(i => ({ ...i })));
    });
  }, []);

  const visible = items ? items.filter(i => i.enabled !== false) : DEFAULT_NAV_ITEMS;

  return (
    <div
      className="fixed inset-0 z-50"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={ref}
        className="absolute top-11 left-0 right-0 border-b shadow-xl overflow-y-auto"
        style={{
          background: 'var(--color-surface)',
          borderColor: 'var(--color-border)',
          maxHeight: 'calc(100dvh - 44px)',
        }}
      >
        {/* Dashboard shortcut at top */}
        <Link
          to="/mobile-dashboard"
          onClick={onClose}
          className="flex items-center px-4 py-3 text-sm font-semibold border-b"
          style={{
            color: location.pathname === '/mobile-dashboard' ? 'var(--color-primary)' : 'var(--color-text)',
            borderColor: 'var(--color-border)',
            background: location.pathname === '/mobile-dashboard' ? 'var(--color-bg)' : undefined,
          }}
        >
          Dashboard
        </Link>
        {visible.map(item => (
          <Link
            key={item.id}
            to={item.path}
            onClick={onClose}
            className="flex items-center px-4 py-3 text-sm border-b hover:opacity-70 transition-opacity"
            style={{
              color: location.pathname === item.path ? 'var(--color-primary)' : 'var(--color-text)',
              borderColor: 'var(--color-border)',
              fontWeight: location.pathname === item.path ? 600 : 400,
              background: location.pathname === item.path ? 'var(--color-bg)' : undefined,
            }}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
