// Rules for the Settings view: what an address, an app name or a slider value must look like, and which action buttons to show.

import { ACTION_IDS, ACTION_SCOPE, type ActionId, type Settings, type VerifyResult } from '../bridge/types';
import { DEFAULT_HOTKEY } from './hotkey';

export const RETENTION_MIN = 10;
export const RETENTION_MAX = 200;
export const AUTO_CLEAR_CHOICES = [0, 1, 4, 8, 24, 72, 168] as const;

export const DEFAULT_SETTINGS: Settings = {
  hotkey: DEFAULT_HOTKEY,
  theme: 'warm-sand',
  font: 'DM Sans',
  startOnBoot: false,
  autoDismiss: true,
  baseUrl: '',
  hasKey: false,
  ignorePasswords: true,
  retentionItems: 100,
  autoClearHours: 0,
  excludedApps: [],
  actions: { finance: true, notes: true, redact: true, crm: true },
};

export const clampRetention = (n: number) => Math.min(RETENTION_MAX, Math.max(RETENTION_MIN, Math.round(Number.isFinite(n) ? n : DEFAULT_SETTINGS.retentionItems)));

export const ACTION_LABELS: Record<ActionId, string> = {
  finance: '⚡ Ingest to Finance/BAS',
  notes: '📝 Save as Note',
  redact: '🔍 Ask Redaction / Audit',
  crm: '🤝 Attach to CRM Touchpoint',
};
export const ACTION_DONE: Record<ActionId, string> = { finance: 'Pushed to Vault', notes: 'Pushed to Vault', redact: 'Checked', crm: 'Pushed to Vault' };

/**
 * The Vault address, tidied: only the origin is kept (no path, query or login in it), https is required, and plain http is allowed only for a
 * server on this PC (for trying things out). Returns the address, or why it is not acceptable.
 */
export function normalizeBaseUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const text = raw.trim();
  if (!text) return { ok: false, error: 'Enter your Vault address.' };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let u: URL;
  try { u = new URL(withScheme); } catch { return { ok: false, error: 'That does not look like a web address.' }; }
  if (u.username || u.password) return { ok: false, error: 'Leave the name and password out of the address.' };
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol === 'http:' && !local) return { ok: false, error: 'The address must start with https:// so the key cannot be read on the way.' };
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return { ok: false, error: 'The address must start with https://.' };
  if (!u.hostname.includes('.') && !local) return { ok: false, error: 'That does not look like a full web address.' };
  return { ok: true, url: u.origin };
}

/** "KeePass.exe" -> "keepass.exe"; null when it is not a plain program file name (no folders, no odd characters). */
export function normalizeAppName(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  const withExt = /\.exe$/.test(t) ? t : `${t}.exe`;
  return /^[a-z0-9][a-z0-9 _.()+-]{0,63}\.exe$/.test(withExt) && !withExt.includes('..') ? withExt : null;
}

export interface ActionState { id: ActionId; label: string; enabled: boolean; reason?: string }

/**
 * The buttons under the preview. A button the person switched off in Settings is not shown at all; one the key cannot do right now is
 * shown greyed with the reason, so a missing button is never a mystery. No key / not verified yet = all greyed.
 */
export function visibleActions(settings: Pick<Settings, 'actions' | 'hasKey'>, verify: VerifyResult | null): ActionState[] {
  return ACTION_IDS.filter((id) => settings.actions[id]).map((id) => {
    const label = ACTION_LABELS[id];
    if (!settings.hasKey) return { id, label, enabled: false, reason: 'Add your Vault key in Settings first.' };
    if (!verify) return { id, label, enabled: false, reason: 'Checking your key…' };
    if (!verify.ok) return { id, label, enabled: false, reason: verify.error || 'The key was not accepted.' };
    if (verify.scopes.includes(ACTION_SCOPE[id])) return { id, label, enabled: true };
    const off = verify.unavailable.find((u) => u.scope === ACTION_SCOPE[id]);
    return { id, label, enabled: false, reason: off?.reason || 'This key is not allowed to do that.' };
  });
}
