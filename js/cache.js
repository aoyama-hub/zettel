// IndexedDB cache of note file contents keyed by git blob sha (content-addressed, never stale).
let dbPromise;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('zk', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('blobs');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function cacheGet(sha) {
  try {
    const d = await db();
    return await new Promise((resolve) => {
      const req = d.transaction('blobs').objectStore('blobs').get(sha);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

export async function cacheSet(sha, text) {
  try {
    const d = await db();
    d.transaction('blobs', 'readwrite').objectStore('blobs').put(text, sha);
  } catch {}
}

/** Look up many shas in one transaction. Resolves to Map(sha -> text) of the hits. */
export async function cacheGetMany(shas) {
  const found = new Map();
  try {
    const d = await db();
    await new Promise((resolve) => {
      const tx = d.transaction('blobs');
      const store = tx.objectStore('blobs');
      for (const sha of shas) {
        const req = store.get(sha);
        req.onsuccess = () => req.result != null && found.set(sha, req.result);
      }
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    });
  } catch {}
  return found;
}
