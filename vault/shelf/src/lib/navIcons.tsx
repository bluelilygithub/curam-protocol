// The icon each Vault tool has in Vault itself. Vault names icons semantically (client/src/config/appNavigation.js says icon: 'finance') and maps each name to
// a Lucide component in client/src/providers/iconMap.js; the shelf reads that same table, so a tool looks the same here as in Vault's Apps menu.
// Lucide components are imported one by one (not the whole library) to keep the page small; the test in tests/launcher.test.ts fails when Vault starts
// using an icon that is not listed here.

import {
  Armchair, BarChart3, Brain, Briefcase, Brush, ClipboardList, Clock, Coins, Compass, Cpu, Dumbbell, ExternalLink, FilePen, FileText, Film, Gauge, Globe,
  GraduationCap, Guitar, Heart, HeartPulse, HelpCircle, Home, Inbox, KeyRound, Languages, LayoutGrid, LineChart, ListChecks, Mail, Megaphone, Mic,
  MousePointer2, Music, Newspaper, Palette, PenLine, Receipt, Route, Ruler, ScanSearch, Scissors, Settings, ShoppingCart, Smartphone, Sprout, Target,
  SquarePlay, TrendingUp, Type, UtensilsCrossed, Wine, Zap, type LucideIcon,
} from 'lucide-react';
import { semanticMap } from '@vault-client/providers/iconMap';

export const LUCIDE_BY_NAME: Record<string, LucideIcon> = {
  Armchair, BarChart3, Brain, Briefcase, Brush, ClipboardList, Clock, Coins, Compass, Cpu, Dumbbell, ExternalLink, FilePen, FileText, Film, Gauge, Globe,
  GraduationCap, Guitar, Heart, HeartPulse, HelpCircle, Home, Inbox, KeyRound, Languages, LayoutGrid, LineChart, ListChecks, Mail, Megaphone, Mic,
  MousePointer2, Music, Newspaper, Palette, PenLine, Receipt, Route, Ruler, ScanSearch, Scissors, Settings, ShoppingCart, Smartphone, Sprout, Target,
  // Vault's client uses Lucide's brand icon 'Youtube'; the newer Lucide the shelf ships no longer has brand logos, so the closest plain icon stands in
  Youtube: SquarePlay,
  TrendingUp, Type, UtensilsCrossed, Wine, Zap,
};

/** The Lucide component for one of Vault's semantic icon names, or null when this page does not carry it. */
export function navIcon(name: string | undefined): LucideIcon | null {
  const lucide = name ? semanticMap[name]?.lucide : undefined;
  return (lucide && LUCIDE_BY_NAME[lucide]) || null;
}

/** Draws the tool's own Vault icon (a plain grid icon when it has none). */
export function NavIcon({ name, size = 16, strokeWidth = 1.8, className = '' }: { name: string | undefined; size?: number; strokeWidth?: number; className?: string }) {
  const Glyph = navIcon(name) ?? LayoutGrid;
  return <Glyph size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />;
}
