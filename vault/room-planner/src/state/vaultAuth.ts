/**
 * The planner is served by Vault from the same origin, so it can use the signed-in user's token. Vault keeps it in
 * `localStorage['vault-auth']` as `{ state: { token, user }, version }` (zustand persist). Read defensively: anything unexpected
 * means "not signed in", and the planner falls back to saving in this browser.
 */
export const VAULT_AUTH_KEY = 'vault-auth';

export interface ReadableStorage { getItem(key: string): string | null }

export function readVaultToken(storage: ReadableStorage | undefined): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(VAULT_AUTH_KEY);
    if (!raw) return null;
    const token = (JSON.parse(raw) as { state?: { token?: unknown } } | null)?.state?.token;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}
