// The real bridge: every call is a command to the native Windows shell (window.shelfNative). The shell does the work and keeps the secrets;
// this file only maps names and refuses answers of the wrong shape, so a shell bug shows up as an error message instead of a blank tray.

import type { ActionId, Bridge, ClipContent, ClipMeta, DispatchResult, Settings, ShelfNative, VerifyResult } from './types';
import { DEFAULT_SETTINGS } from '../lib/settings';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const words = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : 'The Shelf app did not answer.');

function asClipMeta(v: unknown): ClipMeta | null {
  if (!isObj(v) || typeof v.id !== 'string' || !['text', 'html', 'svg', 'image'].includes(String(v.kind))) return null;
  return {
    id: v.id,
    kind: v.kind as ClipMeta['kind'],
    createdAt: Number(v.createdAt) || 0,
    sourceApp: typeof v.sourceApp === 'string' ? v.sourceApp : null,
    sizeBytes: Number(v.sizeBytes) || 0,
    preview: typeof v.preview === 'string' ? v.preview : '',
    truncated: v.truncated === true,
    masked: v.masked === true,
    ...(typeof v.width === 'number' ? { width: v.width } : {}),
    ...(typeof v.height === 'number' ? { height: v.height } : {}),
  };
}

function asContent(v: unknown): ClipContent | null {
  if (!isObj(v) || typeof v.id !== 'string') return null;
  if (v.kind === 'image' && typeof v.dataUrl === 'string' && /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(v.dataUrl)) {
    return { id: v.id, kind: 'image', mime: String(v.mime ?? 'image/png'), dataUrl: v.dataUrl, width: Number(v.width) || 0, height: Number(v.height) || 0 };
  }
  if ((v.kind === 'text' || v.kind === 'html' || v.kind === 'svg') && typeof v.text === 'string') return { id: v.id, kind: v.kind, text: v.text };
  return null;
}

const asVerify = (v: unknown): VerifyResult => {
  if (!isObj(v)) return { ok: false, scopes: [], unavailable: [], error: 'The Shelf app gave an unexpected answer.' };
  return {
    ok: v.ok === true,
    scopes: Array.isArray(v.scopes) ? (v.scopes.filter((s) => typeof s === 'string') as VerifyResult['scopes']) : [],
    unavailable: Array.isArray(v.unavailable) ? (v.unavailable.filter(isObj).map((u) => ({ scope: u.scope, reason: String(u.reason ?? '') })) as VerifyResult['unavailable']) : [],
    ...(typeof v.account === 'string' ? { account: v.account } : {}),
    ...(typeof v.keyLabel === 'string' ? { keyLabel: v.keyLabel } : {}),
    ...(typeof v.error === 'string' ? { error: v.error } : {}),
  };
};

const asDispatch = (v: unknown): DispatchResult => {
  if (!isObj(v)) return { ok: false, error: 'The Shelf app gave an unexpected answer.' };
  return {
    ok: v.ok === true,
    ...(v.duplicate === true ? { duplicate: true } : {}),
    ...(typeof v.error === 'string' ? { error: v.error } : {}),
    ...(Array.isArray(v.findings) ? { findings: v.findings.filter(isObj) as unknown as DispatchResult['findings'] } : {}),
    ...(typeof v.note === 'string' ? { note: v.note } : {}),
    ...(v.truncated === true ? { truncated: true } : {}),
  };
};

export function createNativeBridge(native: ShelfNative): Bridge {
  const call = (cmd: string, args?: Record<string, unknown>) => native.invoke(cmd, args);
  return {
    isMock: false,
    async listClips() {
      const r = await call('list_clips');
      return Array.isArray(r) ? r.map(asClipMeta).filter((c): c is ClipMeta => c !== null) : [];
    },
    async getClip(id) { return asContent(await call('get_clip', { id })); },
    async dispatch(action: ActionId, id) {
      try { return asDispatch(await call('dispatch', { action, id })); } catch (e) { return { ok: false, error: words(e) }; }
    },
    async copyClip(id) { await call('copy_clip', { id }); },
    async deleteClip(id) { await call('delete_clip', { id }); },
    async clearHistory() { await call('clear_history'); },
    async hide() { await call('hide_shelf'); },
    async verify() {
      try { return asVerify(await call('verify')); } catch (e) { return { ok: false, scopes: [], unavailable: [], error: words(e) }; }
    },
    async getSettings() {
      const r = await call('get_settings');
      return isObj(r) ? ({ ...DEFAULT_SETTINGS, ...r, actions: { ...DEFAULT_SETTINGS.actions, ...(isObj(r.actions) ? r.actions : {}) } } as Settings) : DEFAULT_SETTINGS;
    },
    async saveSettings(patch) {
      const r = await call('save_settings', { patch });
      return isObj(r) ? ({ ...DEFAULT_SETTINGS, ...r, actions: { ...DEFAULT_SETTINGS.actions, ...(isObj(r.actions) ? r.actions : {}) } } as Settings) : DEFAULT_SETTINGS;
    },
    async saveConnection(baseUrl, key) {
      try { return asVerify(await call('save_connection', { baseUrl, key })); } catch (e) { return { ok: false, scopes: [], unavailable: [], error: words(e) }; }
    },
    subscribe: (listener) => native.on(listener),
  };
}
