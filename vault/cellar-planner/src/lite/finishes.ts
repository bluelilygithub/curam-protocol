// How each rack finish looks in the pictures. Colours only; the finish never changes a bottle count.

export type FinishKey = 'OAK' | 'WALNUT' | 'BLACK';
type RGB = [number, number, number];
export interface FinishLook {
  /** Inside view: top, end panel and open front of a rack. */
  top: RGB; end: RGB; front: RGB;
  /** Plan view: rack block gradient and outline. */
  planFrom: string; planTo: string; planLine: string;
  /** The little swatch on the button. */
  swatch: string;
}
export const FINISH_LOOK: Record<FinishKey, FinishLook> = {
  OAK: { top: [205, 152, 98], end: [128, 84, 45], front: [112, 74, 42], planFrom: '#c99560', planTo: '#a2723f', planLine: '#6f4a28', swatch: '#c99560' },
  WALNUT: { top: [140, 98, 66], end: [88, 58, 38], front: [78, 51, 33], planFrom: '#8a6040', planTo: '#6a452b', planLine: '#432b19', swatch: '#6a452b' },
  BLACK: { top: [74, 76, 80], end: [38, 40, 44], front: [52, 54, 58], planFrom: '#4a4d52', planTo: '#2f3236', planLine: '#16181a', swatch: '#2f3236' },
};
