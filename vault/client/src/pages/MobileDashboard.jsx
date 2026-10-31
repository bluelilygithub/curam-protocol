import React, { useState, useEffect } from 'react';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import { DEFAULT_TILES, APP_TILES, FEATURE_BY_TILE_ID, mergeWithDefaults } from '../utils/mobileConfig';
import AppLaunchTile from '../components/mobile/AppLaunchTile';
import NeedsAttention from '../components/NeedsAttention';
import TasksTile from '../components/mobile/TasksTile';
import FinanceTile from '../components/mobile/FinanceTile';
import ChatHistoryTile from '../components/mobile/ChatHistoryTile';
import ProjectsTile from '../components/mobile/ProjectsTile';
import NotesTile from '../components/mobile/NotesTile';
import StudentTile from '../components/mobile/StudentTile';
import SharesTile from '../components/mobile/SharesTile';

const TILE_MAP = {
  tasks:    TasksTile,
  finance:  FinanceTile,
  history:  ChatHistoryTile,
  projects: ProjectsTile,
  notes:    NotesTile,
  student:  StudentTile,
  shares:   SharesTile,
};

export default function MobileDashboard() {
  const { user } = useAuthStore();
  const getIcon = useIcon();
  const isAdmin = !!user?.isAdmin;
  const [tiles, setTiles] = useState(null);
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });

  useEffect(() => {
    api.get('/api/settings/mobile').then(r => r.json()).then(data => {
      try {
        const saved = JSON.parse(data.mobile_dashboard_tiles || 'null');
        setTiles(mergeWithDefaults(saved, DEFAULT_TILES));
      } catch {
        setTiles(DEFAULT_TILES.map(t => ({ ...t })));
      }
    }).catch(() => setTiles(DEFAULT_TILES.map(t => ({ ...t }))));
  }, []);

  useEffect(() => {
    api.get('/api/settings/feature-access').then(r => r.json()).then(data => {
      if (data?.flags && typeof data.flags === 'object') {
        setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...data.flags });
      }
    }).catch(() => {});
  }, []);

  const visible = (tiles || DEFAULT_TILES)
    .filter(t => t.enabled !== false)
    .filter(t => {
      if (isAdmin) return true;
      const featureKey = FEATURE_BY_TILE_ID[t.id];
      if (!featureKey) return true;
      return featureAccess[featureKey] !== false;
    });

  return (
    <div className="px-4 pt-4 pb-24 space-y-4">
      {/* Looks like a search box; opens the same command palette as Ctrl/Cmd+K (notes, clients, invoices, chats, tasks, apps, settings). */}
      <button
        type="button"
        onClick={() => document.dispatchEvent(new CustomEvent('vault:open-search'))}
        className="w-full flex items-center gap-3 px-4 rounded-xl border text-left hover:opacity-70 transition-opacity duration-200"
        style={{ minHeight: 48, background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
      >
        {getIcon('search', { size: 18 })}
        <span className="text-sm">Search notes, clients, chats, apps...</span>
      </button>
      <NeedsAttention />
      {visible.map(tile => {
        const TileComponent = TILE_MAP[tile.id];
        if (TileComponent) return <TileComponent key={tile.id} />;
        const app = APP_TILES[tile.id];
        if (!app) return null;
        return <AppLaunchTile key={tile.id} label={tile.label} {...app} />;
      })}
    </div>
  );
}
