// Browser-only history for Presentations (opt-in). Decks themselves live on the server; this is just a convenient
// "recently opened" list on this device — never a backup. 40 decks / 150 MB, like Graphics history.

export const HISTORY_DB = 'vault-presentations-history';
export const HISTORY_MAX_ITEMS = 40;
export const HISTORY_MAX_BYTES = 150 * 1024 * 1024;
export const HISTORY_ON_KEY = 'vault_presentations_history_on';

export function historyEnabled() {
  try { return localStorage.getItem(HISTORY_ON_KEY) === '1'; } catch { return false; }
}

export function setHistoryEnabled(on) {
  try { localStorage.setItem(HISTORY_ON_KEY, on ? '1' : '0'); } catch { /* private window */ }
}

/** Approximate stored size of a deck (the JSON is what IndexedDB holds). */
export function deckBytes(deck) {
  return new TextEncoder().encode(JSON.stringify(deck || {})).length;
}

/** Oldest-first ids to drop so the kept entries fit both limits. */
export function planPrune(entries, { maxItems = HISTORY_MAX_ITEMS, maxBytes = HISTORY_MAX_BYTES } = {}) {
  const newestFirst = [...entries].sort((a, b) => b.createdAt - a.createdAt);
  const drop = [];
  let count = 0;
  let bytes = 0;
  for (const entry of newestFirst) {
    count += 1;
    bytes += entry.bytes || 0;
    if (count > maxItems || bytes > maxBytes) {
      drop.push(entry.id);
      count -= 1;
      bytes -= entry.bytes || 0;
    }
  }
  return drop;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HISTORY_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('decks', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('decks', mode);
      const out = fn(tx.objectStore('decks'));
      tx.oncomplete = () => resolve(out?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Newest first, metadata only (no deck JSON) so the list stays light. */
export async function listHistory() {
  const all = await run('readonly', (s) => s.getAll());
  return (all || [])
    .map(({ deck, ...rest }) => rest)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, HISTORY_MAX_ITEMS);
}

export async function getHistoryDeck(id) {
  const row = await run('readonly', (s) => s.get(Number(id)));
  return row?.deck || null;
}

export async function addHistory({ title, deck, sourceType = '' }) {
  if (!deck) return false;
  await run('readwrite', (s) => s.add({
    title: title || deck.title || 'Untitled deck',
    sourceType,
    createdAt: Date.now(),
    bytes: deckBytes(deck),
    deck,
  }));
  const drop = planPrune(await listHistory());
  if (drop.length) await removeHistory(drop);
  return true;
}

export async function removeHistory(ids) {
  const list = Array.isArray(ids) ? ids.map(Number) : [Number(ids)];
  await run('readwrite', (s) => { list.forEach((id) => s.delete(id)); });
}

export async function clearHistory() {
  await run('readwrite', (s) => s.clear());
}
