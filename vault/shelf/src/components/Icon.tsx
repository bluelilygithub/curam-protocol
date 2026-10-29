import type { ReactNode } from 'react';

// A handful of line icons drawn here, so the page needs no icon library.
const PATHS: Record<string, ReactNode> = {
  text: <><path d="M5 6h14M5 12h14M5 18h9" /></>,
  code: <><path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  table: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 10h16M4 14.5h16M10 5v14" /></>,
  image: <><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m5 17 5-4.5 3.5 3 2.5-2L19 17" /></>,
  svg: <><path d="M5 17c3-10 5-10 7-5s4 5 7-5" /><circle cx="5" cy="17" r="1.4" /><circle cx="19" cy="7" r="1.4" /></>,
  color: <><path d="M12 3.5c3.5 4 6 6.7 6 10a6 6 0 0 1-12 0c0-3.3 2.5-6 6-10Z" /></>,
  html: <><path d="m8 8-4 4 4 4M16 8l4 4-4 4" /><path d="M10.5 18 13.5 6" /></>,
  copy: <><rect x="9" y="9" width="10" height="10" rx="2" /><path d="M5 15V7a2 2 0 0 1 2-2h8" /></>,
  trash: <><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5" /></>,
  lock: <><rect x="6" y="11" width="12" height="9" rx="2" /><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" /></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7.5" /></>,
  x: <><path d="m6 6 12 12M18 6 6 18" /></>,
  back: <><path d="m14 6-6 6 6 6" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18" /></>,
};

export default function Icon({ name, size = 16, className = '' }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {PATHS[name] ?? PATHS.text}
    </svg>
  );
}
