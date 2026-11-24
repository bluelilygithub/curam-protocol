import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import { useIcon } from '../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import { getAppsNavGroups } from '../config/appNavigation';
import { homeGroupsFor } from '../utils/homeTiles.mjs';
import AttentionSidebar from '../components/AttentionSidebar';

// hover darkens the tile (mixed with black, so it reads as darker in light and dark themes alike); background is a class so hover can win
const TILE = 'flex items-center gap-3 rounded-2xl border p-4 transition-colors bg-[var(--color-surface)] hover:bg-[color-mix(in_srgb,var(--color-surface),black_12%)]';
const TILE_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };

/**
 * Home (/home): the tiles an admin arranged under Settings → Navigation → Home page tiles, in their groups and order. Each person sees only
 * the apps they can use (feature switches, admin-only apps); a group with none of them is left out. See docs/home.md.
 */
export default function HomePage() {
  const getIcon = useIcon();
  const isAdmin = !!useAuthStore((s) => s.user?.isAdmin);
  const [homeTiles, setHomeTiles] = useState(undefined); // undefined while loading, null when not set up
  const [flags, setFlags] = useState(null);

  useEffect(() => {
    api.get('/api/settings/home-tiles').then((r) => (r.ok ? r.json() : {})).then((d) => setHomeTiles(d.homeTiles || null)).catch(() => setHomeTiles(null));
    api.get('/api/settings/feature-access').then((r) => (r.ok ? r.json() : {})).then((d) => setFlags({ ...DEFAULT_FEATURE_ACCESS, ...(d.flags || {}) }))
      .catch(() => setFlags({ ...DEFAULT_FEATURE_ACCESS }));
  }, []);

  const groups = useMemo(() => {
    if (!homeTiles || !flags) return [];
    const canUseFeature = (key) => isAdmin || flags[key] !== false;
    const visible = Object.fromEntries(getAppsNavGroups({ canUseFeature, isAdmin }).flatMap((g) => g.items).map((i) => [i.id, i]));
    return homeGroupsFor(homeTiles, visible);
  }, [homeTiles, flags, isAdmin]);

  const tile = (item) => {
    const inner = (
      <>
        <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-none" style={{ color: 'var(--color-primary)' }}>
          {getIcon(item.icon, { size: 18 })}
        </span>
        <span className="text-sm font-semibold">{item.label}</span>
      </>
    );
    return item.external || /^https?:/.test(item.path)
      ? <a key={item.id} href={item.path} target="_blank" rel="noopener noreferrer" className={TILE} style={TILE_STYLE}>{inner}</a>
      : <Link key={item.id} to={item.path} className={TILE} style={TILE_STYLE}>{inner}</Link>;
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* the attention sidebar comes first so a phone shows it above the tiles; on a wide screen it sits on the right */}
      <div className="max-w-[1600px] mx-auto p-4 sm:p-6 flex flex-col lg:flex-row-reverse gap-6 lg:gap-8">
      <div className="lg:w-80 lg:flex-none"><AttentionSidebar /></div>
      <div className="flex-1 min-w-0 space-y-8">
        {(homeTiles === undefined || (homeTiles && !flags)) && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
        {homeTiles !== undefined && flags && groups.length === 0 && (
          <div className="py-16 text-center space-y-3">
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              {homeTiles ? 'None of the apps on this page are switched on for you.' : 'No tiles have been set up yet.'}
            </p>
            {isAdmin && <Link to="/settings?tab=Navigation" className="text-sm underline" style={{ color: 'var(--color-primary)' }}>Arrange the Home page tiles</Link>}
          </div>
        )}
        {groups.map((g) => (
          <section key={g.id}>
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--color-muted)' }}>{g.label}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">{g.items.map(tile)}</div>
          </section>
        ))}
        {isAdmin && groups.length > 0 && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            <Link to="/settings?tab=Navigation" className="underline">Change these tiles</Link> (only admins see this link).
          </p>
        )}
      </div>
      </div>
    </div>
  );
}
