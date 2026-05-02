import React, { useState, useEffect } from 'react';
import api from '../utils/apiClient';
import { DEFAULT_TILES, mergeWithDefaults } from '../utils/mobileConfig';
import TasksTile from '../components/mobile/TasksTile';
import FinanceTile from '../components/mobile/FinanceTile';
import ChatHistoryTile from '../components/mobile/ChatHistoryTile';
import ProjectsTile from '../components/mobile/ProjectsTile';
import NotesTile from '../components/mobile/NotesTile';

const TILE_MAP = {
  tasks:    TasksTile,
  finance:  FinanceTile,
  history:  ChatHistoryTile,
  projects: ProjectsTile,
  notes:    NotesTile,
};

export default function MobileDashboard() {
  const [tiles, setTiles] = useState(null);

  useEffect(() => {
    api.get('/api/settings').then(r => r.json()).then(data => {
      try {
        const saved = JSON.parse(data.mobile_dashboard_tiles || 'null');
        setTiles(mergeWithDefaults(saved, DEFAULT_TILES));
      } catch {
        setTiles(DEFAULT_TILES.map(t => ({ ...t })));
      }
    }).catch(() => setTiles(DEFAULT_TILES.map(t => ({ ...t }))));
  }, []);

  const visible = (tiles || DEFAULT_TILES).filter(t => t.enabled !== false);

  return (
    <div className="px-4 pt-4 pb-24 space-y-4">
      {visible.map(tile => {
        const TileComponent = TILE_MAP[tile.id];
        if (!TileComponent) return null;
        return <TileComponent key={tile.id} />;
      })}
    </div>
  );
}
