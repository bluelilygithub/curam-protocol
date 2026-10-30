import { AlignLeft, Check, ChevronLeft, Code, Compass, Copy, Droplet, FileCode, Image, Info, Link, Lock, Settings, Shapes, Table, Trash2, X, type LucideIcon } from 'lucide-react';

// Vault draws every icon with Lucide (client/src/providers/IconProvider.jsx), so the shelf does too.
const ICONS: Record<string, LucideIcon> = {
  text: AlignLeft, code: Code, link: Link, table: Table, image: Image, svg: Shapes, color: Droplet, html: FileCode,
  copy: Copy, trash: Trash2, lock: Lock, check: Check, x: X, back: ChevronLeft, gear: Settings, info: Info, compass: Compass,
};

export default function Icon({ name, size = 16, className = '' }: { name: string; size?: number; className?: string }) {
  const Glyph = ICONS[name] ?? AlignLeft;
  return <Glyph size={size} strokeWidth={1.8} className={className} aria-hidden="true" />;
}
