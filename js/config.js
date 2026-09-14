const KEY = 'zk.config';

export function getConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY));
    if (c && c.token && c.owner && c.repo) return { ...c, branch: c.branch || 'main' };
  } catch {}
  return null;
}

export function setConfig(c) {
  localStorage.setItem(KEY, JSON.stringify(c));
  persistStorage();
}

/** Ask the browser not to evict this site's storage (token, outbox, drafts) under storage pressure. */
export function persistStorage() {
  navigator.storage?.persist?.().catch(() => {});
}
