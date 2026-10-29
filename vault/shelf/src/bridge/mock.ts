// Development stand-in for the native shell: sample clips in memory, settings kept in this browser's localStorage (never a key), and fake
// answers from "Vault" that follow the real contract (a key that may do some things and not others, a pattern scan for Redaction).

import { PREVIEW_CHARS, type Bridge, type ClipMeta, type DispatchResult, type RedactFinding, type Settings, type ShellEvent, type VerifyResult } from './types';
import { DEFAULT_SETTINGS, normalizeBaseUrl } from '../lib/settings';
import { buildMockClips, mockContent, MOCK_ACCOUNT, type MockClips } from './mockData';

const SETTINGS_KEY = 'vault-shelf:mock-settings';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (raw && typeof raw === 'object') return { ...DEFAULT_SETTINGS, ...raw, actions: { ...DEFAULT_SETTINGS.actions, ...(raw.actions ?? {}) } };
  } catch { /* first run */ }
  return { ...DEFAULT_SETTINGS, baseUrl: 'https://your-vault.up.railway.app', hasKey: true };
}

/** A tiny stand-in for the server's pattern scan, enough to show findings on screen. */
function scan(text: string): RedactFinding[] {
  const out: RedactFinding[] = [];
  const rules: [RegExp, string, number][] = [
    [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'email', 0.95],
    [/\b\d{3} \d{3} \d{3}\b/g, 'tax_file_number', 0.9],
    [/\b\d{3}-\d{3}\s+(?:account\s+)?\d{6,10}\b/gi, 'bank_account', 0.92],
    [/\b0\d{3} \d{3} \d{3}\b/g, 'phone', 0.85],
  ];
  for (const [re, category, confidence] of rules) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) out.push({ start: m.index, end: m.index + m[0].length, text: m[0], category, confidence, rationale: 'Sample pattern' });
  }
  out.sort((a, b) => a.start - b.start);
  return out.filter((f, i) => i === 0 || f.start >= (out[i - 1] as RedactFinding).end);
}

export function createMockBridge(): Bridge {
  let data: MockClips = buildMockClips(100);
  let settings = loadSettings();
  const listeners = new Set<(e: ShellEvent) => void>();
  const emit = (e: ShellEvent) => listeners.forEach((l) => l(e));
  const persist = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private window */ } };

  const verifyResult = (): VerifyResult => settings.hasKey
    ? { ok: true, scopes: ['notes:write', 'crm:write', 'redact:check'], unavailable: [{ scope: 'finance:write', reason: 'Finance is switched off for your account.' }], account: MOCK_ACCOUNT, keyLabel: 'Work laptop' }
    : { ok: false, scopes: [], unavailable: [], error: 'No key saved yet.' };

  // lets a browser test (or a person in the console) add a clip the way the native side would. It is attached when the app subscribes, so it
  // always belongs to the bridge the app really uses (React StrictMode starts two in development and throws one away).
  const testHook = {
    addText(text: string, sourceApp = 'test.exe') {
      const id = `clip-new-${Date.now()}`;
      const meta: ClipMeta = { id, kind: 'text', createdAt: Date.now(), sourceApp, sizeBytes: text.length, preview: text.slice(0, PREVIEW_CHARS), truncated: text.length > PREVIEW_CHARS, masked: false };
      data = { ...data, metas: [meta, ...data.metas], texts: new Map(data.texts).set(id, text) };
      emit('clips_changed');
      return id;
    },
    emit,
  };

  return {
    isMock: true,
    async listClips() { await wait(40); return [...data.metas]; },
    async getClip(id) { await wait(60); return mockContent(data, id); },
    async dispatch(action, id): Promise<DispatchResult> {
      await wait(350);
      const meta = data.metas.find((c) => c.id === id);
      if (!meta) return { ok: false, error: 'That clip is no longer on the shelf.' };
      if (meta.masked) return { ok: false, error: 'This clip had a secret in it, so it is never sent anywhere.' };
      if (action === 'finance') return { ok: false, error: 'Finance is switched off for your account.' };
      if (action === 'redact') {
        const text = data.texts.get(id);
        if (text === undefined) return { ok: false, error: 'Only text can be checked.' };
        return { ok: true, findings: scan(text), note: 'This is a pattern scan. It finds things shaped like emails, phone numbers, ID, tax file, bank and card numbers and addresses. It does not find names or other free text, so read the text before you share it.' };
      }
      return { ok: true };
    },
    async copyClip(id) {
      const text = data.texts.get(id);
      if (text !== undefined) { try { await navigator.clipboard.writeText(text); } catch { /* the page may not have clipboard permission in a test */ } }
    },
    async deleteClip(id) { data = { ...data, metas: data.metas.filter((c) => c.id !== id) }; emit('clips_changed'); },
    async clearHistory() { data = { ...data, metas: [] }; emit('clips_changed'); },
    async hide() { /* the page stays; a real shell hides the window */ },
    async verify() { await wait(80); return verifyResult(); },
    async getSettings() { return { ...settings }; },
    async saveSettings(patch) { settings = { ...settings, ...patch, actions: { ...settings.actions, ...(patch.actions ?? {}) } }; persist(); return { ...settings }; },
    async saveConnection(baseUrl, key) {
      await wait(500);
      const u = normalizeBaseUrl(baseUrl);
      if (!u.ok) return { ok: false, scopes: [], unavailable: [], error: u.error };
      if (!/^vsh_[0-9a-f]{64}$/.test(key.trim())) return { ok: false, scopes: [], unavailable: [], error: 'That key was not accepted. Copy it again from Settings, Vault Shelf in Vault.' };
      settings = { ...settings, baseUrl: u.url, hasKey: true }; persist();
      return verifyResult();
    },
    subscribe(listener) { (window as unknown as { __shelfMock: unknown }).__shelfMock = testHook; listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
