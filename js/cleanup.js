// Fleeting note housekeeping, run in the background at most a few times a day:
// - older than ARCHIVE_AFTER_DAYS: archived (hidden from Unprocessed, listed under Archive)
// - untouched for DELETE_AFTER_DAYS: deleted
// Only notes in fleeting/ explicitly tagged `type: fleeting` are considered. Literature and permanent notes
// are never touched; gh.commitCleanup also rejects any path outside fleeting/.
import * as gh from './github.js';
import { getConfig } from './config.js';
import { serializeNote } from './note.js';
import * as store from './store.js';

const PREFIX = 'Zettel cleanup:';
const EVERY = 6 * 60 * 60 * 1000;
const MAX_HISTORY_CHECKS = 50;

const lastRunKey = () => {
  const c = getConfig();
  return `zk.cleanup:${c.owner}/${c.repo}@${c.branch}`;
};

let running = null;

export function runCleanup({ force = false } = {}) {
  if (!getConfig() || !store.state.ready || store.state.error) return Promise.resolve();
  try {
    if (!force && Date.now() - Number(localStorage.getItem(lastRunKey()) || 0) < EVERY) return Promise.resolve();
  } catch {}
  if (running) return running;
  running = cleanup()
    .then(() => {
      try { localStorage.setItem(lastRunKey(), String(Date.now())); } catch {}
    })
    .catch(() => {}) // retried on the next run; never blocks the app
    .finally(() => { running = null; });
  return running;
}

async function cleanup() {
  const now = Date.now();
  const toArchive = [];
  const toDelete = [];

  for (const n of store.state.notes.values()) {
    if (!store.isFleeting(n, { strict: true })) continue;
    const touched = store.lastTouched(n);
    if (touched == null) continue;
    const age = (now - touched) / store.DAY;
    if (age > store.DELETE_AFTER_DAYS) toDelete.push(n);
    else if (age > store.ARCHIVE_AFTER_DAYS && !n.archived) toArchive.push(n);
  }

  // Before deleting, confirm with git history that nothing but cleanup has changed the file in 90 days.
  // A newer edit (e.g. made in Obsidian) is recorded as updated_at so the note's age reflects it from now on.
  const confirmed = [];
  const touchedLater = new Map(); // path -> ms of a git edit newer than the frontmatter says
  for (const n of toDelete.slice(0, MAX_HISTORY_CHECKS)) {
    try {
      const committed = await gh.lastCommitDate(n.path, PREFIX);
      if (committed == null) continue;
      const age = (now - Math.max(committed, store.lastTouched(n))) / store.DAY;
      if (age > store.DELETE_AFTER_DAYS) {
        confirmed.push(n);
      } else {
        touchedLater.set(n.path, committed);
        if (age > store.ARCHIVE_AFTER_DAYS && !n.archived) toArchive.push(n);
      }
    } catch {
      // Unknown history: leave the note alone this time.
    }
  }

  const archivedAt = new Date(now).toISOString();
  const archivePaths = new Set(toArchive.map((n) => n.path));
  const toWrite = [...toArchive, ...toDelete.filter((n) => touchedLater.has(n.path) && !archivePaths.has(n.path))];
  const writes = toWrite.map((n) => {
    const fm = { ...n.fm };
    if (archivePaths.has(n.path)) Object.assign(fm, { archived: true, archived_at: archivedAt });
    if (touchedLater.has(n.path)) fm.updated_at = new Date(touchedLater.get(n.path)).toISOString();
    return { path: n.path, content: serializeNote({ fm, extra: n.extra, body: n.body }) };
  });
  const removals = confirmed.map((n) => ({ path: n.path, remove: true }));
  if (!writes.length && !removals.length) return;

  const parts = [];
  if (archivePaths.size) parts.push(`archive ${archivePaths.size} fleeting note${archivePaths.size === 1 ? '' : 's'} older than ${store.ARCHIVE_AFTER_DAYS} days`);
  if (writes.length > archivePaths.size) parts.push(`record recent edits on ${writes.length - archivePaths.size}`);
  if (removals.length) parts.push(`delete ${removals.length} untouched for ${store.DELETE_AFTER_DAYS} days`);
  await gh.commitCleanup([...writes, ...removals], `${PREFIX} ${parts.join(', ')}`);

  for (const w of writes) store.upsertLocal(w.path, await gh.gitBlobSha(w.content), w.content);
  for (const r of removals) store.removeLocal(r.path);
}
