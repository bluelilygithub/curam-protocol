declare module '@vault-client/utils/units/numbers.mjs' {
  /** "twenty three point five" -> 23.5; anything that is not a number -> null. Also accepts typed digits. */
  export function parseSpokenNumber(text: string): number | null;
}
