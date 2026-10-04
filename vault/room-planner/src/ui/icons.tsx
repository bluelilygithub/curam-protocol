import type { ReactNode } from 'react';

/** Small inline line icons (1.6 px stroke, 20 px grid). No icon dependency. */
const base = { width: 18, height: 18, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const I = ({ children }: { children: ReactNode }) => <svg {...base} aria-hidden="true">{children}</svg>;

export const Icons = {
  select: <I><path d="M4 3l11 6.2-5 1.4-2.2 5z" /></I>,
  pan: <I><path d="M7 10V5a1 1 0 012 0v4m0-5a1 1 0 012 0v5m0-4a1 1 0 012 0v5m0-3a1 1 0 012 0v6a5 5 0 01-5 5H9a4 4 0 01-3.3-1.7L3 11.5a1.2 1.2 0 011.9-1.4L7 12" /></I>,
  wall: <I><path d="M3 15V5h14v10M3 9h14M7 5v4m6 0v6" /></I>,
  measure: <I><path d="M3 13l10-10 4 4-10 10zM6.5 9.5l1.6 1.6m.9-3.9l1.6 1.6m.9-3.9l1.6 1.6" /></I>,
  undo: <I><path d="M7 4L3 8l4 4M3 8h8a5 5 0 010 10H8" /></I>,
  redo: <I><path d="M13 4l4 4-4 4m4-4H9a5 5 0 000 10h3" /></I>,
  clearance: <I><rect x="7" y="7" width="6" height="6" rx="1" /><rect x="3" y="3" width="14" height="14" rx="2" strokeDasharray="2.5 2.5" /></I>,
  grid: <I><path d="M3 7h14M3 13h14M7 3v14m6-14v14" /></I>,
  fit: <I><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" /></I>,
  file: <I><path d="M5 2h7l4 4v12H5zM12 2v4h4" /></I>,
  lock: <I><rect x="4.5" y="9" width="11" height="8" rx="1.5" /><path d="M7 9V6.5a3 3 0 016 0V9" /></I>,
  unlock: <I><rect x="4.5" y="9" width="11" height="8" rx="1.5" /><path d="M7 9V6.5a3 3 0 015.6-1.5" /></I>,
  rotate: <I><path d="M16 10a6 6 0 11-2-4.5M16 3v4h-4" /></I>,
  copy: <I><rect x="7" y="7" width="10" height="10" rx="1.5" /><path d="M13 7V4.5A1.5 1.5 0 0011.5 3h-7A1.5 1.5 0 003 4.5v7A1.5 1.5 0 004.5 13H7" /></I>,
  trash: <I><path d="M4 6h12M8 6V4h4v2m-6 0l.7 10h6.6L14 6" /></I>,
  door: <I><path d="M4 17V3h8l4 2v12M4 17h12M12 3v14M10 10h.01" /></I>,
  window: <I><rect x="3.5" y="4" width="13" height="12" rx="1" /><path d="M10 4v12M3.5 10h13" /></I>,
  warn: <I><path d="M10 3L2 17h16zM10 8v4m0 2.5h.01" /></I>,
  panelLeft: <I><rect x="3" y="4" width="14" height="12" rx="1.5" /><path d="M8 4v12" /></I>,
  panelRight: <I><rect x="3" y="4" width="14" height="12" rx="1.5" /><path d="M12 4v12" /></I>,
  compass: <I><circle cx="10" cy="10" r="7" /><path d="M12.8 7.2l-1.6 4-4 1.6 1.6-4z" /></I>,
  info: <I><circle cx="10" cy="10" r="7" /><path d="M10 9v5m0-7.5h.01" /></I>,
  rect: <I><rect x="3" y="5" width="14" height="10" rx="1" /></I>,
  pencil: <I><path d="M3 17l1-4 9-9 3 3-9 9zM12 5l3 3" /></I>,
} as const;
