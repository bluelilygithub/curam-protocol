import type { PlantRecord } from './types';

/**
 * The name to search photos under. A species ("Grevillea robusta") is searched by species. A cultivar or hybrid whose record has only a genus
 * ("Grevillea 'Robyn Gordon'") is searched by its full name, because photos of the genus would be photos of other plants.
 */
export function photoSearchName(p: Pick<PlantRecord, 'botanical' | 'cultivar'>): string {
  const words = p.botanical.trim().split(/\s+/);
  const speciesLevel = words.length >= 2 && !/^x$/i.test(words[1]);
  return speciesLevel || !p.cultivar ? p.botanical.trim() : `${p.botanical.trim()} '${p.cultivar}'`;
}
