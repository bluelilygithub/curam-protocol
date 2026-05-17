import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import api from '../../utils/apiClient';
import { DEFAULT_NAV_ITEMS, mergeWithDefaults } from '../../utils/mobileConfig';
import { DEFAULT_FEATURE_ACCESS } from '../../utils/featureAccess';

export default function MobileNavDropdown({ onClose, isAdmin = false }) {
  const location = useLocation();
  const [items, setItems] = useState(null);
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
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

  useEffect(() => {
    api.get('/api/settings/feature-access').then(r => r.json()).then(data => {
      if (data?.flags && typeof data.flags === 'object') {
        setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...data.flags });
      }
    }).catch(() => {});
  }, []);

  const visible = (items ? items : DEFAULT_NAV_ITEMS)
    .filter(i => i.enabled !== false)
    .filter(i => {
      if (isAdmin) return true;
      const featureByNavId = {
        clients: 'clients',
        goals: 'goals',
        chains: 'chains',
        graph: 'graph',
        debate: 'debate',
        compare: 'compare',
        finance: 'finance',
        shares: 'shares',
        usage: 'usage',
        mood: 'mood',
        news: 'newsDigest',
        studentSection: 'student',
      };
      const featureKey = featureByNavId[i.id];
      if (!featureKey) return true;
      return featureAccess[featureKey] !== false;
    })
    .filter(i => (i.id === 'admin' ? isAdmin : true));

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
        {visible.map((item) => {
          if (item.id === 'studentSection') {
            return (
              <React.Fragment key={item.id}>
                <div
                  className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider border-b"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                >
                  Student
                </div>
                <Link
                  to="/student/quiz"
                  onClick={onClose}
                  className="flex items-center px-4 py-3 text-sm border-b hover:opacity-70 transition-opacity"
                  style={{
                    color: location.pathname === '/student/quiz' ? 'var(--color-primary)' : 'var(--color-text)',
                    borderColor: 'var(--color-border)',
                    fontWeight: location.pathname === '/student/quiz' ? 600 : 400,
                    background: location.pathname === '/student/quiz' ? 'var(--color-bg)' : undefined,
                  }}
                >
                  Quiz
                </Link>
                <Link
                  to="/student/cards"
                  onClick={onClose}
                  className="flex items-center px-4 py-3 text-sm border-b hover:opacity-70 transition-opacity"
                  style={{
                    color: location.pathname === '/student/cards' ? 'var(--color-primary)' : 'var(--color-text)',
                    borderColor: 'var(--color-border)',
                    fontWeight: location.pathname === '/student/cards' ? 600 : 400,
                    background: location.pathname === '/student/cards' ? 'var(--color-bg)' : undefined,
                  }}
                >
                  Cards
                </Link>
                <Link
                  to="/student/saved-decks"
                  onClick={onClose}
                  className="flex items-center px-4 py-3 text-sm border-b hover:opacity-70 transition-opacity"
                  style={{
                    color: location.pathname === '/student/saved-decks' ? 'var(--color-primary)' : 'var(--color-text)',
                    borderColor: 'var(--color-border)',
                    fontWeight: location.pathname === '/student/saved-decks' ? 600 : 400,
                    background: location.pathname === '/student/saved-decks' ? 'var(--color-bg)' : undefined,
                  }}
                >
                  Saved decks
                </Link>
              </React.Fragment>
            );
          }
          return (
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
          );
        })}
      </div>
    </div>
  );
}
