/**
 * Real 3D furniture models (CC0, from Poly Haven) shown in the Realistic look and in Render photo in place of the built-in block shapes.
 * The files live in `public/models/<folder>/` (glTF + 1K textures, fetched by `scripts/fetch-polyhaven.py`). Each library item here keeps a block
 * recipe (`blockAs`) that the Standard and Clay looks, drag previews and the moment before a model has loaded still use.
 * The Credits panel is built from this table, so a model cannot be added without its author.
 */
export interface RealModel {
  /** Folder under public/models, also the Poly Haven asset id. */
  folder: string;
  /** Library item whose block recipe stands in when the model is not drawn. */
  blockAs: string;
  /** Turn the model about the vertical axis so its long side runs along the piece's width (degrees, multiples of 90). */
  turn: 0 | 90 | 180 | 270;
  /** Title and author as published by Poly Haven. */
  title: string;
  author: string;
}

export const MODEL_LICENCE = { name: 'CC0 1.0 (public domain)', url: 'https://creativecommons.org/publicdomain/zero/1.0/' } as const;
export const modelPageUrl = (m: RealModel): string => `https://polyhaven.com/a/${m.folder}`;

export const REAL_MODELS: Record<string, RealModel> = {
  'real-armchair': { folder: 'modern_arm_chair_01', blockAs: 'armchair', turn: 0, title: 'Modern Arm Chair 01', author: 'Vibrant Nordic' },
  'real-lounge-chair': { folder: 'mid_century_lounge_chair', blockAs: 'armchair', turn: 0, title: 'Mid Century Lounge Chair', author: 'Kuutti Siitonen' },
  'real-coffee-table': { folder: 'modern_coffee_table_01', blockAs: 'coffee-table', turn: 90, title: 'Modern Coffee Table 01', author: 'Amin' },
  'real-sofa': { folder: 'sofa_02', blockAs: 'sofa-3', turn: 0, title: 'Sofa 02', author: 'Kirill Sannikov' },
  'real-dining-chair': { folder: 'dining_chair_02', blockAs: 'dining-chair', turn: 0, title: 'Dining Chair 02', author: 'James Ray Cock' },
  'real-display-shelves': { folder: 'wooden_display_shelves_01', blockAs: 'bookshelf', turn: 270, title: 'Wooden Display Shelves 01', author: 'James Ray Cock' },
};

export const isRealModel = (definitionId: string): boolean => definitionId in REAL_MODELS;
