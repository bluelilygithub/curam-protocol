declare module '@vault-client/themes' {
  export const themes: Record<string, { label: string; bg: string; surface: string; border: string; primary: string; text: string; muted: string }>;
  export const fontOptions: { value: string; label: string; style: string }[];
}

declare module '@vault-client/utils/units/numbers.mjs' {
  /** "twenty two point five" -> 22.5; null if it was not a number. */
  export function parseSpokenNumber(text: string): number | null;
}
