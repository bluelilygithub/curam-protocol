// Small inline icon set (no icon library: the planner is its own app).
const P: Record<string, string> = {
  select: 'M5 3l14 8-6 2-2 6z',
  boundary: 'M4 4h16v16H4z',
  house: 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6',
  bed: 'M4 15c0-4 3-7 8-7s8 3 8 7-3 5-8 5-8-1-8-5zM12 8V4M9 11l3-3 3 3',
  lawn: 'M3 19h18M6 19c0-4 1-7 3-9M12 19c0-5 0-8 1-12M18 19c0-4-1-7-3-9',
  path: 'M5 20c2-6 3-8 7-9s5-3 7-7',
  zone: 'M4 4h16v16H4zM4 12h16M12 4v16',
  structure: 'M4 20V9l8-5 8 5v11zM10 20v-6h4v6',
  plant: 'M12 21v-8M12 13c0-4-3-6-7-6 0 4 3 6 7 6zM12 13c0-4 3-6 7-6 0 4-3 6-7 6z',
  scale: 'M3 17l14-14 4 4L7 21zM8 12l2 2M11 9l2 2M14 6l2 2',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  folder: 'M3 6h6l2 2h10v11H3z',
  info: 'M12 8h.01M11 12h1v5h1M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  close: 'M5 5l14 14M19 5L5 19',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  panelLeft: 'M3 4h18v16H3zM9 4v16',
  panelRight: 'M3 4h18v16H3zM15 4v16',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9h.01',
  grid: 'M4 4h16v16H4zM4 9.33h16M4 14.66h16M9.33 4v16M14.66 4v16',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  check: 'M5 12l5 5 9-10',
  pipe: 'M3 9h12a3 3 0 0 1 0 6H3M3 6v12M17 12h4',
  alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
};

export function Icon({ name, size = 18 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? P.info} />
    </svg>
  );
}
