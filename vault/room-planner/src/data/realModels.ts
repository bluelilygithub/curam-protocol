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
  /** Title and author(s) as published by Poly Haven. */
  title: string;
  author: string;
  /** Poly Haven page id when it differs from the folder (a rug is built from a Poly Haven fabric texture). */
  asset?: string;
}

export const MODEL_LICENCE = { name: 'CC0 1.0 (public domain)', url: 'https://creativecommons.org/publicdomain/zero/1.0/' } as const;
export const modelPageUrl = (m: RealModel): string => `https://polyhaven.com/a/${m.asset ?? m.folder}`;

export const REAL_MODELS: Record<string, RealModel> = {
  'real-armchair': { folder: 'modern_arm_chair_01', blockAs: 'armchair', turn: 0, title: 'Modern Arm Chair 01', author: 'Vibrant Nordic' },
  'real-lounge-chair': { folder: 'mid_century_lounge_chair', blockAs: 'armchair', turn: 0, title: 'Mid Century Lounge Chair', author: 'Kuutti Siitonen' },
  'real-coffee-table': { folder: 'modern_coffee_table_01', blockAs: 'coffee-table', turn: 90, title: 'Modern Coffee Table 01', author: 'Amin' },
  'real-sofa': { folder: 'sofa_02', blockAs: 'sofa-3', turn: 0, title: 'Sofa 02', author: 'Kirill Sannikov' },
  'real-dining-chair': { folder: 'dining_chair_02', blockAs: 'dining-chair', turn: 0, title: 'Dining Chair 02', author: 'James Ray Cock' },
  'real-bed': { folder: 'GothicBed_01', blockAs: 'bed-queen', turn: 0, title: 'Gothic Bed 01', author: 'Kirill Sannikov' },
  'real-desk': { folder: 'metal_office_desk', blockAs: 'desk', turn: 0, title: 'Metal Office Desk', author: 'Ulan Cabanilla' },
  'real-vase': { folder: 'ceramic_vase_01', blockAs: 'vase', turn: 0, title: 'Ceramic Vase 01', author: 'James Ray Cock' },
  'real-ceiling-lamp': { folder: 'modern_ceiling_lamp_01', blockAs: 'pendant-light', turn: 0, title: 'Modern Ceiling Lamp 01', author: 'James Ray Cock' },
  'real-mirror': { folder: 'ornate_mirror_01', blockAs: 'mirror-wall', turn: 0, title: 'Ornate Mirror 01', author: 'James Ray Cock' },
  'real-picture': { folder: 'fancy_picture_frame_01', blockAs: 'art-landscape', turn: 0, title: 'Fancy Picture Frame 01', author: 'Rob Tuytel and Rico Cilliers' },
  'real-rug': { folder: 'rug_poly_wool_herringbone', blockAs: 'rug-rect', turn: 0, title: 'Poly Wool Herringbone (fabric texture on a rug)', author: 'colormass and Rico Cilliers', asset: 'poly_wool_herringbone' },
  'real-display-shelves': { folder: 'wooden_display_shelves_01', blockAs: 'bookshelf', turn: 270, title: 'Wooden Display Shelves 01', author: 'James Ray Cock' },
};

/** Where a model's Library thumbnail is (made by scripts/stills-thumbs.mjs). */
export const thumbUrl = (definitionId: string): string => `${import.meta.env.BASE_URL}models/thumbs/${definitionId}.png`;

export const isRealModel = (definitionId: string): boolean => definitionId in REAL_MODELS;
