// Types for Vault's own theme table, which is plain JavaScript (client/src/themes.js).
declare module '@vault-client/themes' {
  export interface VaultTheme { label: string; bg: string; surface: string; border: string; primary: string; text: string; muted: string }
  export const themes: Record<string, VaultTheme>;
  export const fontOptions: { value: string; label: string; style: string }[];
}

// Vault's navigation catalog (client/src/config/appNavigation.js), plain JavaScript. Only the part the quick launcher reads.
declare module '@vault-client/config/appNavigation' {
  export interface NavItem { id: string; label: string; path: string; icon?: string; external?: boolean; adminOnly?: boolean }
  export interface NavGroup { id: string; label: string; items: NavItem[] }
  export const APP_NAV_GROUPS: NavGroup[];
  export const HABITS_NAV_GROUP: NavGroup;
}

// Vault's icon-name table (client/src/providers/iconMap.js).
declare module '@vault-client/providers/iconMap' {
  export const semanticMap: Record<string, { lucide: string }>;
}
