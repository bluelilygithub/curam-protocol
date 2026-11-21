/**
 * The app's one IndexedDB database in this browser ('doc-compare'). Nothing in it leaves the computer.
 *   decisions  review decisions per pair of files (key: pair:<sha256>:<sha256>)        since v1
 *   checks     saved checks: label, both files, verdict, dates (key: check id)          since v2
 */
const NAME = 'doc-compare';
const VERSION = 2;

let opened: Promise<IDBDatabase> | undefined;

export function openDb(): Promise<IDBDatabase> {
  return (opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('decisions')) db.createObjectStore('decisions');
      if (!db.objectStoreNames.contains('checks')) db.createObjectStore('checks', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opened = undefined; reject(req.error); };
  }));
}

/** One request in one transaction, as a promise. */
export async function run<T>(store: 'decisions' | 'checks', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}
