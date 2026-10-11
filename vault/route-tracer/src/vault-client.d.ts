declare module '@vault-client/themes' {
  export const themes: Record<string, { label: string; bg: string; surface: string; border: string; primary: string; text: string; muted: string }>;
  export const fontOptions: { value: string; label: string; style: string }[];
}
