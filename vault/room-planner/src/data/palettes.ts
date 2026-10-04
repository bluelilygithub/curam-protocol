// Colour palettes for a room (shown in the 3D view). One palette sets the walls, floor, trim and the main colours of upholstery, wood and
// rugs together, so a room looks designed rather than coloured piece by piece. A finish chosen for a piece in the Inspector always wins.
// No palette (`undefined`) = the standard colours. Pure data; the 3D code reads it through `paletteOf`.
export interface Palette {
  id: string;
  name: string;
  /** Wall paint. */
  wall: string;
  /** Floor boards (a tone for the wood texture to multiply). */
  floor: string;
  /** Skirting, door and window frames. */
  trim: string;
  /** Sofas, armchairs, chair seats and other upholstery. */
  upholstery: string;
  /** Wood furniture (tops and frames that are wood by default). */
  wood: string;
  /** Rugs: the main colour and the border or pattern colour. */
  rug: string;
  rugAccent: string;
  /** One-line description for the picker. */
  note: string;
}

export const PALETTES: Palette[] = [
  { id: 'scandi', name: 'Scandinavian', wall: '#f4f2ee', floor: '#e3cba3', trim: '#ffffff', upholstery: '#c3c8ca', wood: '#e6cfa6', rug: '#ebe7dd', rugAccent: '#b7c2c5', note: 'Light, airy, pale wood and soft grey' },
  { id: 'coastal', name: 'Coastal', wall: '#e9f0f2', floor: '#cdb78f', trim: '#fbfbf8', upholstery: '#5f86a6', wood: '#d9c3a0', rug: '#f1ede3', rugAccent: '#7aa3b8', note: 'Sea blue and sand' },
  { id: 'sage', name: 'Sage & clay', wall: '#e6eadf', floor: '#b88a58', trim: '#f6f3ec', upholstery: '#7d8a84', wood: '#b98b57', rug: '#d9cfba', rugAccent: '#c07a5b', note: 'Calm green with terracotta touches' },
  { id: 'terracotta', name: 'Terracotta', wall: '#efd9c6', floor: '#b2763f', trim: '#faf3ea', upholstery: '#b5532f', wood: '#9a6a3f', rug: '#d2b58d', rugAccent: '#8e3f22', note: 'Warm earth tones' },
  { id: 'blush', name: 'Soft blush', wall: '#f3e2de', floor: '#d9bc92', trim: '#fffaf6', upholstery: '#d4a3a2', wood: '#d6b890', rug: '#efe3d8', rugAccent: '#c58f90', note: 'Gentle pink with pale wood' },
  { id: 'moody', name: 'Dark & moody', wall: '#4b4e53', floor: '#3b2d24', trim: '#e9e5dc', upholstery: '#2f3a44', wood: '#5b4332', rug: '#6b6f73', rugAccent: '#2a2d31', note: 'Slate walls, dark wood, rich navy' },
  { id: 'mono', name: 'Monochrome', wall: '#f1f1f0', floor: '#bdbcb9', trim: '#ffffff', upholstery: '#3b3b3d', wood: '#8d8c88', rug: '#e0dfdc', rugAccent: '#2b2b2d', note: 'Black, white and grey' },
  { id: 'warm', name: 'Warm neutral', wall: '#efe9de', floor: '#c79a62', trim: '#f3f0ea', upholstery: '#9a8f82', wood: '#c9a679', rug: '#e0d6c3', rugAccent: '#a58a63', note: 'Cream walls, oak and taupe' },
];

export const paletteOf = (id: string | undefined): Palette | undefined => (id ? PALETTES.find((p) => p.id === id) : undefined);
