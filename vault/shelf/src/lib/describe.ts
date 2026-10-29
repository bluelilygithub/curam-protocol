// What a clip is, for the card's icon and the filter chips, worked out from its kind and (for text) its short preview.

import { classifyText, type Classified, type TextType } from './classify';
import type { ClipMeta } from '../bridge/types';

export type FilterId = 'all' | 'text' | 'images' | 'links' | 'tables';
export const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'text', label: 'Text' },
  { id: 'images', label: 'Images' },
  { id: 'links', label: 'Links' },
  { id: 'tables', label: 'Tables / CSV' },
];

export type ClipType = TextType | 'image' | 'svg' | 'html';
export interface Described { category: Exclude<FilterId, 'all'>; type: ClipType; label: string; classified: Classified | null }

const LABELS: Record<ClipType, string> = { text: 'Text', code: 'Code', color: 'Colour', link: 'Link', table: 'Table', image: 'Image', svg: 'SVG', html: 'HTML' };

export function describeClip(c: ClipMeta): Described {
  if (c.kind === 'image') return { category: 'images', type: 'image', label: LABELS.image, classified: null };
  if (c.kind === 'svg') return { category: 'images', type: 'svg', label: LABELS.svg, classified: null };
  if (c.kind === 'html') return { category: 'text', type: 'html', label: LABELS.html, classified: null };
  const classified = classifyText(c.preview, c.truncated);
  const category = classified.type === 'link' ? 'links' : classified.type === 'table' ? 'tables' : 'text';
  return { category, type: classified.type, label: LABELS[classified.type], classified };
}

export const matchesFilter = (d: Described, f: FilterId) => f === 'all' || d.category === f;

export function countByFilter(items: Described[]): Record<FilterId, number> {
  const out: Record<FilterId, number> = { all: items.length, text: 0, images: 0, links: 0, tables: 0 };
  for (const d of items) out[d.category]++;
  return out;
}
