import type { ServiceKind, EdgingType, FenceType, GrassType, MulchType, PathMaterial, StructureKind } from '../domain/types';

// Plan colours. Status colours (warn/error) are fixed; the rest are tuned to sit on Vault's warm-sand background.
export const COLOURS = {
  bg: '#F5F5F0', gridMinor: '#E6E6DD', gridMajor: '#D8D8CD', text: '#1A1A1A', muted: '#7a7a72',
  primary: '#CC785C', select: '#CC785C', handleFill: '#ffffff', warn: '#f59e0b', error: '#ef4444',
  house: '#e4dfd3', houseStroke: '#4a4a44', zone: '#9aa8b8', soil: '#b99a72', water: '#8fc4e0',
};

export const FENCE_COLOUR: Record<FenceType, string> = {
  colorbond: '#6b7b6e', timber_paling: '#9a7a52', brick: '#a8553f', hedge: '#4f7a3b', open: '#b5b5aa',
};
export const MULCH_COLOUR: Record<MulchType, string> = { none: '#b99a72', bark: '#8a6446', sugarcane: '#c8a96a', gravel: '#b8b5ad', pebbles: '#a9a9a2' };
export const EDGING_COLOUR: Record<EdgingType, string> = { none: '#8a6a44', timber: '#7a5a38', steel: '#5a6068', brick: '#a8553f', stone: '#9a9a92' };
export const PATH_COLOUR: Record<PathMaterial, string> = {
  gravel: '#cfc8b8', pavers: '#c9c0b0', concrete: '#c4c4be', timber: '#a98a62', stepping_stones: '#b8b2a4', brick: '#b8664f',
};
export const GRASS_COLOUR: Record<GrassType, string> = {
  buffalo: '#a9cf8a', kikuyu: '#9bc77a', couch: '#b2d594', zoysia: '#a2cc84', fescue: '#9cc486', synthetic: '#8fcf7a',
};
export const SERVICE_COLOUR: Record<ServiceKind, string> = {
  sewer: '#8a5a2a', water: '#2a7ab8', stormwater: '#2a9a9a', gas: '#d9a400', power: '#c8282a', easement: '#7d4fa8',
};
export const STRUCTURE_COLOUR: Record<StructureKind, string> = {
  pergola: '#c9ad82', shed: '#b9c2b0', deck: '#b58f60', raised_bed: '#a07a52', water_tank: '#9ec3d8', clothesline: '#d6d6cf',
  pool: '#8fd0e8', retaining_wall: '#9a9488', trellis: '#c9ad82', gate: '#8a6a44',
};
