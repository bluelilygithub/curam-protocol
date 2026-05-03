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
  files: { lucide: 'Files' },
  compare: { lucide: 'GitCompare' },
  debate: { lucide: 'Swords' },
  eye: { lucide: 'Eye' },
  'eye-off': { lucide: 'EyeOff' },
  'bar-chart': { lucide: 'BarChart2' },
  'clock': { lucide: 'Clock' },
  'history': { lucide: 'History' },
  'message-circle': { lucide: 'MessageCircle' },
  'list-checks': { lucide: 'ListChecks' },
  'check-circle': { lucide: 'CheckCircle2' },
  'circle': { lucide: 'Circle' },
  'calendar': { lucide: 'Calendar' },
  'tag': { lucide: 'Tag' },
  'wand': { lucide: 'Wand2' },
  'grip-vertical': { lucide: 'GripVertical' },
  'layout': { lucide: 'LayoutDashboard' },
  'columns': { lucide: 'Columns2' },
  'expand-horizontal': { lucide: 'ChevronsLeftRight' },
  'collapse-horizontal': { lucide: 'ChevronsRightLeft' },
  'share-2': { lucide: 'Share2' },
  'calendar-check': { lucide: 'CalendarCheck' },
  'arrow-right': { lucide: 'ArrowRight' },
  'check-square': { lucide: 'CheckSquare' },
  'target': { lucide: 'Target' },
  'compass': { lucide: 'Compass' },
  'pen-line': { lucide: 'PenLine' },
  'archive': { lucide: 'Archive' },
  'chevron-left': { lucide: 'ChevronLeft' },
  'lightbulb':    { lucide: 'Lightbulb' },
  'crosshair':    { lucide: 'Crosshair' },
  'briefcase':    { lucide: 'Briefcase' },
  'menu':           { lucide: 'Menu' },
  'smartphone':     { lucide: 'Smartphone' },
  'more-horizontal': { lucide: 'MoreHorizontal' },
  'help-circle':    { lucide: 'HelpCircle' },
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
