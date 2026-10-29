// The contract between this page (the tray UI) and the native Windows shell that hosts it.
// The shell owns everything sensitive: the clipboard, encryption, the Vault key and the network. This page only ever sees what it needs to
// draw (short previews, one clip at a time, 300px thumbnails) and asks the shell to act. See ../../README.md for the wire format.

export type ClipKind = 'text' | 'html' | 'svg' | 'image';

/** What the list needs for one card. Already secret-masked by the shell; the full text is fetched only when a card is opened. */
export interface ClipMeta {
  id: string;
  kind: ClipKind;
  /** Milliseconds since 1970. */
  createdAt: number;
  sourceApp: string | null;
  sizeBytes: number;
  /** The first characters of a text clip (at most PREVIEW_CHARS), or '' for a picture. */
  preview: string;
  /** True when `preview` is shorter than the whole clip. */
  truncated: boolean;
  /** The shell found a password / key / token in this clip and replaced it. It can be read but never sent anywhere. */
  masked: boolean;
  width?: number;
  height?: number;
}
export const PREVIEW_CHARS = 400;

export interface ClipText { id: string; kind: 'text' | 'html' | 'svg'; text: string }
/** A picture is always the small copy (at most 300px wide) as a data: URL; the original stays in the shell's encrypted store. */
export interface ClipImage { id: string; kind: 'image'; mime: string; dataUrl: string; width: number; height: number }
export type ClipContent = ClipText | ClipImage;

export type ActionId = 'finance' | 'notes' | 'redact' | 'crm';
export type ScopeName = 'notes:write' | 'finance:write' | 'crm:write' | 'redact:check';
/** Which key permission each action needs (the server's `GET /verify` reports the ones usable right now). */
export const ACTION_SCOPE: Record<ActionId, ScopeName> = { finance: 'finance:write', notes: 'notes:write', redact: 'redact:check', crm: 'crm:write' };
export const ACTION_IDS: ActionId[] = ['finance', 'notes', 'redact', 'crm'];

export interface VerifyResult {
  ok: boolean;
  scopes: ScopeName[];
  unavailable: { scope: ScopeName; reason: string }[];
  account?: string;
  keyLabel?: string;
  /** Why it failed, in words for the person (bad key, revoked, no connection, ...). */
  error?: string;
}

export interface RedactFinding { start: number; end: number; text: string; category: string; confidence: number; rationale: string }

export interface DispatchResult {
  ok: boolean;
  /** Already sent earlier (the shell retried a clip the server had). Still a success. */
  duplicate?: boolean;
  error?: string;
  /** Only for 'redact': what was found, and the server's plain-words note. */
  findings?: RedactFinding[];
  note?: string;
  truncated?: boolean;
}

export interface Settings {
  hotkey: string;
  /** Vault's own theme id (client/src/themes.js) and font name, chosen here because Vault keeps its choice only in the browser. */
  theme: string;
  font: string;
  startOnBoot: boolean;
  autoDismiss: boolean;
  /** The Vault address (origin only). Not secret. */
  baseUrl: string;
  /** The key itself is never given to this page: only whether the shell holds one. */
  hasKey: boolean;
  ignorePasswords: boolean;
  /** Most clips kept (10 to 200). */
  retentionItems: number;
  /** Delete clips older than this many hours; 0 = never. */
  autoClearHours: number;
  excludedApps: string[];
  /** Which quick-action buttons the person wants to see. */
  actions: Record<ActionId, boolean>;
}

export type ShellEvent = 'clips_changed' | 'show';

export interface Bridge {
  /** True for the fake data source used in development; the page says so on screen. */
  readonly isMock: boolean;
  listClips(): Promise<ClipMeta[]>;
  getClip(id: string): Promise<ClipContent | null>;
  /** Send one clip to Vault. For 'redact' the answer carries the findings. */
  dispatch(action: ActionId, id: string): Promise<DispatchResult>;
  /** Put a clip back on the clipboard in a ready-to-paste form (the shell makes sure it does not capture it again). */
  copyClip(id: string): Promise<void>;
  deleteClip(id: string): Promise<void>;
  clearHistory(): Promise<void>;
  /** Hide the tray and give the previous window back its focus. */
  hide(): Promise<void>;
  /** Ask Vault what the saved key may do right now. */
  verify(): Promise<VerifyResult>;
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<Settings>;
  /** Check an address + key against Vault; the shell saves the key to Windows Credential Manager only when it is good. */
  saveConnection(baseUrl: string, key: string): Promise<VerifyResult>;
  subscribe(listener: (event: ShellEvent) => void): () => void;
}

/** What the native shell injects as `window.shelfNative`. */
export interface ShelfNative {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  on(listener: (event: ShellEvent) => void): () => void;
}
