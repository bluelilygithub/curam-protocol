// Small inline icons, so the app needs no icon library. Most are drawn on the 20-unit grid with a 1.6 stroke, the same set and look as Room
// Planner's toolbar; `close` keeps its older 24-unit drawing.
const G20 = {
  info: ['M3 10a7 7 0 1 0 14 0a7 7 0 1 0-14 0', 'M10 9v5m0-7.5h.01'],
  compass: ['M3 10a7 7 0 1 0 14 0a7 7 0 1 0-14 0', 'M12.8 7.2l-1.6 4-4 1.6 1.6-4z'],
  undo: ['M7 4L3 8l4 4M3 8h8a5 5 0 010 10H8'],
  redo: ['M13 4l4 4-4 4m4-4H9a5 5 0 000 10h3'],
  file: ['M5 2h7l4 4v12H5zM12 2v4h4'],
  list: ['M7 5h10M7 10h10M7 15h10M3.5 5h.01M3.5 10h.01M3.5 15h.01'],
  download: ['M10 3v9m0 0l-3.5-3.5M10 12l3.5-3.5M4 16h12'],
  upload: ['M10 12V3m0 0L6.5 6.5M10 3l3.5 3.5M4 16h12'],
} as const;
const G24 = {
  close: ['M18 6L6 18', 'M6 6l12 12'],
} as const;

export function Icon({ name, size = 16 }: { name: keyof typeof G20 | keyof typeof G24; size?: number }) {
  const small = name in G20;
  const paths: readonly string[] = small ? G20[name as keyof typeof G20] : G24[name as keyof typeof G24];
  return (
    <svg width={small ? 18 : size} height={small ? 18 : size} viewBox={small ? '0 0 20 20' : '0 0 24 24'} fill="none" stroke="currentColor" strokeWidth={small ? 1.6 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
