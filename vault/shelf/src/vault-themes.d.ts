// Types for Vault's own theme table, which is plain JavaScript (client/src/themes.js).
declare module '@vault-client/themes' {
  export interface VaultTheme { label: string; bg: string; surface: string; border: string; primary: string; text: string; muted: string }
  export const themes: Record<string, VaultTheme>;
  export const fontOptions: { value: string; label: string; style: string }[];
}
