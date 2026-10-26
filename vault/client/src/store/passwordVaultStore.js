import { create } from 'zustand';
import useAuthStore from './authStore';

// Password Vault lock state. The key lives ONLY here, in memory: it is never written to localStorage, IndexedDB or the server, so a
// reload, a closed tab or signing out all lock the vault. The key is a non-extractable Web Crypto object (script cannot read its bytes).
// The vault also locks itself after the chosen quiet time, wherever in Vault the person has gone (this runs outside any page).

const AUTO_LOCK_KEY = 'vault:passwordVaultAutoLockMin';
export const AUTO_LOCK_CHOICES = [1, 5, 15, 30];
const DEFAULT_AUTO_LOCK = 5;
const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart'];

export function getAutoLockMinutes() {
  try {
    const n = Number(localStorage.getItem(AUTO_LOCK_KEY));
    return AUTO_LOCK_CHOICES.includes(n) ? n : DEFAULT_AUTO_LOCK;
  } catch { return DEFAULT_AUTO_LOCK; }
}

export function setAutoLockMinutes(n) {
  try { localStorage.setItem(AUTO_LOCK_KEY, String(n)); } catch { /* private window: just not remembered */ }
}

let timer = null;
let lastActive = Date.now();
const touch = () => { lastActive = Date.now(); };

function startWatching(lock) {
  stopWatching();
  lastActive = Date.now();
  ACTIVITY.forEach((e) => window.addEventListener(e, touch, { passive: true }));
  timer = setInterval(() => {
    if (Date.now() - lastActive > getAutoLockMinutes() * 60000) lock();
  }, 10000);
}

function stopWatching() {
  if (timer) clearInterval(timer);
  timer = null;
  ACTIVITY.forEach((e) => window.removeEventListener(e, touch));
}

const usePasswordVaultStore = create((set, get) => ({
  key: null, // CryptoKey while unlocked, else null
  unlock: (key) => {
    set({ key });
    startWatching(() => get().lock());
  },
  lock: () => {
    stopWatching();
    set({ key: null });
  },
}));

// Signing out (or the session ending) locks the vault.
useAuthStore.subscribe((s) => { if (!s.token) usePasswordVaultStore.getState().lock(); });

export default usePasswordVaultStore;
