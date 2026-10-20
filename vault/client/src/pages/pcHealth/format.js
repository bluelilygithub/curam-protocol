// Small display helpers for the PC Health page. Sizes arrive in megabytes (drives in gigabytes) from the helper's report.

export const fmtMB = (mb) => {
  const n = Number(mb) || 0;
  if (n >= 1024 * 1024) return `${(n / 1048576).toFixed(1)} TB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} GB`;
  return `${Math.round(n)} MB`;
};

export const fmtGB = (gb) => fmtMB((Number(gb) || 0) * 1024);

export const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export const fmtDay = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
};

// Status colours are deliberately outside the theme (see client/DESIGN.md): red = High, amber = Watch.
export const SEVERITY = {
  high: { label: 'High', color: '#ef4444' },
  watch: { label: 'Watch', color: '#f59e0b' },
  info: { label: 'Info', color: null },
};

export const LEFTOVER_LABEL = {
  'crash-dump': 'Crash dumps', temp: 'Temporary files', cache: 'Caches', 'recycle-bin': 'Recycle Bin', 'old-windows': 'Old Windows install',
  installer: 'Installers in Downloads', 'disk-image': 'Disk images', 'package-cache': 'Package caches', 'system-file': 'Windows system files', other: 'Other',
};

export const STATUS_LABEL = {
  queued: 'Waiting for the helper', running: 'Scanning', done: 'Finished', failed: 'Failed', cancelled: 'Cancelled',
};
