import React, { createContext, useContext, useMemo } from 'react';
import useSettingsStore from '../store/settingsStore';
import * as LucideIcons from 'lucide-react';

const semanticMap = {
  folder: { lucide: 'Folder' },
  file: { lucide: 'File' },
  chat: { lucide: 'MessageSquare' },
  search: { lucide: 'Search' },
  settings: { lucide: 'Settings' },
  mic: { lucide: 'Mic' },
  speaker: { lucide: 'Volume2' },
  download: { lucide: 'Download' },
  mail: { lucide: 'Mail' },
  trash: { lucide: 'Trash2' },
  plus: { lucide: 'Plus' },
  edit: { lucide: 'Pencil' },
  x: { lucide: 'X' },
  check: { lucide: 'Check' },
  'chevron-right': { lucide: 'ChevronRight' },
  'chevron-down': { lucide: 'ChevronDown' },
  'more-vertical': { lucide: 'MoreVertical' },
  upload: { lucide: 'Upload' },
  'file-text': { lucide: 'FileText' },
  'file-image': { lucide: 'FileImage' },
  send: { lucide: 'Send' },
  home: { lucide: 'Home' },
  'stop-circle': { lucide: 'StopCircle' },
  loader: { lucide: 'Loader2' },
  'alert-circle': { lucide: 'AlertCircle' },
  copy: { lucide: 'Copy' },
  'external-link': { lucide: 'ExternalLink' },
  'log-out': { lucide: 'LogOut' },
  sparkles: { lucide: 'Sparkles' },
  'file-down': { lucide: 'FileDown' },
  'alert-triangle': { lucide: 'AlertTriangle' },
  compress: { lucide: 'Minimize2' },
  link: { lucide: 'Link' },
  star: { lucide: 'Star' },
  'star-off': { lucide: 'StarOff' },
  book: { lucide: 'BookOpen' },
  brain: { lucide: 'Brain' },
  keyboard: { lucide: 'Keyboard' },
  flame: { lucide: 'Flame' },
  coins: { lucide: 'Coins' },
  'git-branch': { lucide: 'GitBranch' },
  'refresh-cw': { lucide: 'RefreshCw' },
  user: { lucide: 'User' },
  pin: { lucide: 'Pin' },
  'folder-open': { lucide: 'FolderOpen' },
  'folder-plus': { lucide: 'FolderPlus' },
  cpu: { lucide: 'Cpu' },
};

const IconContext = createContext(null);

export function IconProvider({ children }) {
  const iconPack = useSettingsStore((s) => s.iconPack);

  const getIcon = useMemo(() => {
    return (name, props = {}) => {
      const mapping = semanticMap[name];
      if (!mapping) return null;
      const lucideName = mapping.lucide;
      const Icon = LucideIcons[lucideName];
      if (!Icon) return null;
      return <Icon size={18} {...props} />;
    };
  }, [iconPack]);

  return (
    <IconContext.Provider value={getIcon}>
      {children}
    </IconContext.Provider>
  );
}

export function useIcon() {
  return useContext(IconContext);
}

export default IconProvider;
