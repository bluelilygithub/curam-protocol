declare module '@vault-client/themes' {
  export const themes: Record<string, { label: string; bg: string; surface: string; border: string; primary: string; onPrimary?: string; text: string; muted: string }>;
  export const fontOptions: { value: string; label: string; style: string }[];
}

declare module '@vault-client/pages/docCompare/docCompareTools.mjs' {
  export const DOC_COMPARE_TOOLS: { id: string; label: string; group: string; icon: string }[];
  export const TOOL_BLURBS: Record<string, string>;
  export const HOW_IT_WORKS: [string, string][];
  export const GUIDE_TOOLS: { id: string; label: string; tool: string }[];
  export const OPEN_TYPE: string;
  export const VIEW_TYPE: string;
  export const CONTEXT_TYPE: string;
  export const FETCH_TYPE: string;
  export const FETCHED_TYPE: string;
}
