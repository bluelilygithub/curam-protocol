import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../utils/apiClient';
import useAuthStore from '../../store/authStore';
import usePasswordVaultStore from '../../store/passwordVaultStore';
import { aadFor, createKeySettings, decryptJson, encryptJson, unlockWith } from '../../utils/vaultCrypto.mjs';

const json = async (r, fallback) => {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || fallback); e.code = d.code; throw e; }
  return d;
};

/**
 * Everything the Password Vault page needs: the vault's key settings, the saved entries (decrypted in the browser while unlocked), the
 * CRM clients for linking, and the actions. The master password and key never leave this file's browser-side calls; the server is only
 * ever sent the key settings made by createKeySettings() and ciphertext from encryptJson().
 */
export default function useVault() {
  const userId = useAuthStore((s) => s.user?.id);
  const key = usePasswordVaultStore((s) => s.key);
  const unlockStore = usePasswordVaultStore((s) => s.unlock);
  const lockStore = usePasswordVaultStore((s) => s.lock);
  const aad = useMemo(() => aadFor(userId), [userId]);

  const [status, setStatus] = useState(null); // null while loading, then { setUp, ... }
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [items, setItems] = useState([]);
  const [loadError, setLoadError] = useState('');

  const reload = useCallback(async () => {
    try {
      const [s, e, c] = await Promise.all([
        api.get('/api/password-vault/status').then((r) => json(r, 'Could not load the vault.')),
        api.get('/api/password-vault/entries').then((r) => json(r, 'Could not load your passwords.')),
        api.get('/api/clients').then((r) => (r.ok ? r.json() : [])).catch(() => []),
      ]);
      setStatus(s); setRows(Array.isArray(e) ? e : []);
      setClients((Array.isArray(c) ? c : []).filter((x) => x.status !== 'archived').map((x) => ({ id: x.id, name: x.name, company: x.company })));
      setLoadError('');
    } catch (err) { setLoadError(err.message || 'Could not reach the server.'); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Decrypt whenever the key or the stored rows change. A row that will not open (wrong key version, damaged) is marked, never dropped.
  useEffect(() => {
    let cancelled = false;
    if (!key) { setItems([]); return undefined; }
    (async () => {
      const out = await Promise.all(rows.map(async (r) => {
        const base = { id: r.id, clientId: r.clientId, clientName: r.clientName, createdAt: r.createdAt, updatedAt: r.updatedAt };
        try { return { ...base, ...(await decryptJson(key, r, aad)) }; } catch { return { ...base, unreadable: true, title: '(could not be opened)' }; }
      }));
      if (!cancelled) setItems(out);
    })();
    return () => { cancelled = true; };
  }, [key, rows, aad]);

  const keyVersion = status?.keyVersion;

  const setUp = async (masterPassword) => {
    const { settings, key: k } = await createKeySettings(masterPassword, aad);
    await json(await api.post('/api/password-vault/setup', settings), 'Could not set up the vault.');
    await reload();
    unlockStore(k);
  };

  // true = unlocked, false = wrong master password
  const unlock = async (masterPassword) => {
    const k = await unlockWith(masterPassword, status, aad);
    if (!k) return false;
    unlockStore(k);
    return true;
  };

  const save = async ({ id, clientId, data }) => {
    const blob = await encryptJson(key, data, aad);
    const body = { ...blob, clientId: clientId || null, keyVersion };
    const r = id ? await api.put(`/api/password-vault/entries/${id}`, body) : await api.post('/api/password-vault/entries', body);
    try { await json(r, 'Could not save.'); } catch (e) { if (e.code === 'KEY_CHANGED') lockStore(); throw e; }
    await reload();
  };

  const remove = async (id) => {
    const d = await json(await api.delete(`/api/password-vault/entries/${id}`), 'Could not delete.');
    await reload();
    return d;
  };

  const setClient = async (id, clientId) => {
    await json(await api.patch(`/api/password-vault/entries/${id}/client`, { clientId: clientId || null }), 'Could not change the client.');
    await reload();
  };

  // Decrypt everything with the current key, then lock it all again under a new master password and swap it in one go.
  const changeMaster = async (oldPassword, newPassword) => {
    const current = await unlockWith(oldPassword, status, aad);
    if (!current) return false;
    const plain = await Promise.all(rows.map(async (r) => ({ id: r.id, data: await decryptJson(current, r, aad) })));
    const { settings, key: fresh } = await createKeySettings(newPassword, aad);
    const entries = await Promise.all(plain.map(async (p) => ({ id: p.id, ...(await encryptJson(fresh, p.data, aad)) })));
    await json(await api.post('/api/password-vault/rekey', { ...settings, entries, expectedKeyVersion: keyVersion }), 'Could not change the master password.');
    await reload();
    unlockStore(fresh);
    return true;
  };

  const eraseAll = async () => {
    await json(await api.post('/api/password-vault/reset', { confirm: 'DELETE EVERYTHING' }), 'Could not erase the vault.');
    lockStore();
    await reload();
  };

  return { status, rows, items, clients, loadError, unlocked: !!key, reload, setUp, unlock, lock: lockStore, save, remove, setClient, changeMaster, eraseAll };
}
