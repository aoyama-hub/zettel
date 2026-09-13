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
