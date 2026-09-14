// In-memory note index (built from the repo tree + cached blobs) and the capture outbox.
import * as gh from './github.js';
import { cacheGetMany, cacheSet } from './cache.js';
import { getConfig } from './config.js';
import { SOURCE_LINE, extractLinks, serializeNote, timestampName, toNote, uniqueReferences } from './note.js';

const NOTE_RE = /^(fleeting|literature|permanent)\/.+\.md$/;

export const state = {
  notes: new Map(), // path -> note
  ready: false,
  loading: false,
  error: '',
  progress: '',
  outboxError: '',
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((fn) => fn());

// Local writes from the last few minutes, re-applied over fresh tree listings that may predate them.
const recent = new Map(); // path -> { note | null, t }
const RECENT_MS = 3 * 60 * 1000;

const treeKey = () => {
  const c = getConfig();
  return c ? `zk.tree:${c.owner}/${c.repo}@${c.branch}` : 'zk.tree';
};

async function build(entries, fetchMissing) {
  const notes = new Map();
  const missing = [];
  const unknown = entries.filter((e) => state.notes.get(e.path)?.sha !== e.sha);
  const cached = await cacheGetMany(unknown.map((e) => e.sha));
  for (const e of entries) {
    const prev = state.notes.get(e.path);
    if (prev && prev.sha === e.sha) notes.set(e.path, prev);
    else if (cached.has(e.sha)) notes.set(e.path, toNote(e.path, e.sha, cached.get(e.sha)));
    else missing.push(e);
  }
  if (fetchMissing && missing.length) await fetchBlobs(missing, notes);
  const now = Date.now();
  for (const [path, r] of recent) {
    if (now - r.t > RECENT_MS) recent.delete(path);
    else if (r.note) notes.set(path, r.note);
    else notes.delete(path);
  }
  state.notes = notes;
  state.ready = true;
}

const BATCH = 100;

async function fetchBlobs(missing, notes) {
  let done = 0;
  const add = (e, text) => {
    cacheSet(e.sha, text);
    notes.set(e.path, toNote(e.path, e.sha, text));
  };
  const progress = () => {
    state.progress = `Loading notes ${done}/${missing.length}`;
    emit();
  };
  // Batched GraphQL first; anything it can't return (or if GraphQL is unavailable) falls back to REST per blob.
  const rest = [];
  let graphqlOk = true;
  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH);
    if (!graphqlOk) {
      rest.push(...chunk);
      continue;
    }
    try {
      const texts = await gh.getBlobsBatch(chunk.map((e) => e.sha));
      for (const e of chunk) {
        if (texts.has(e.sha)) {
          add(e, texts.get(e.sha));
          done++;
        } else {
          rest.push(e);
        }
      }
      progress();
    } catch (err) {
      if (err.status === 401 || err.status === 429 || /rate limit/i.test(err.message)) throw err;
      graphqlOk = false;
      rest.push(...chunk);
    }
  }
  let next = 0;
  const worker = async () => {
    while (next < rest.length) {
      const e = rest[next++];
      add(e, await gh.getBlob(e.sha));
      if (++done % 10 === 0) progress();
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, rest.length) }, worker));
}

/** Instant index from the last known tree + blob cache, before the network answers. */
export async function loadCached() {
  try {
    const entries = JSON.parse(localStorage.getItem(treeKey()));
    if (Array.isArray(entries) && !state.ready) {
      await build(entries, false);
      emit();
    }
  } catch {}
}

// Single-flight helpers are reset in a .finally() callback, which always runs after the
// assignment (an async body that finishes synchronously would otherwise leave a stale promise).
let inflight = null;
export function refresh() {
  if (inflight) return inflight;
  state.loading = true;
  state.error = '';
  emit();
  inflight = (async () => {
    const entries = (await gh.listTree()).filter((e) => NOTE_RE.test(e.path));
    await build(entries, true);
    try { localStorage.setItem(treeKey(), JSON.stringify(entries)); } catch {}
  })()
    .catch((e) => { state.error = e.message; })
    .finally(() => {
      state.loading = false;
      state.progress = '';
      inflight = null;
      emit();
    });
  return inflight;
}

export function reset() {
  state.notes = new Map();
  state.ready = false;
  state.error = '';
  recent.clear();
  emit();
}

export function upsertLocal(path, sha, text) {
  cacheSet(sha, text);
  const note = toNote(path, sha, text);
  state.notes.set(path, note);
  recent.set(path, { note, t: Date.now() });
  emit();
  return note;
}

export function removeLocal(path) {
  state.notes.delete(path);
  recent.set(path, { note: null, t: Date.now() });
  emit();
}

export const permanentNotes = () => [...state.notes.values()].filter((n) => n.type === 'permanent');

// ---- Fleeting note lifecycle ----

export const DAY = 24 * 60 * 60 * 1000;
export const ARCHIVE_AFTER_DAYS = 7;
export const DELETE_AFTER_DAYS = 90;

/** Newest known change time for a note: updated_at, created_at, or the capture timestamp in its filename. */
export function lastTouched(n) {
  const dates = [Date.parse(n.fm.updated_at), Date.parse(n.fm.created_at)].filter((t) => !Number.isNaN(t));
  if (dates.length) return Math.max(...dates);
  const m = n.path.match(/\/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})[^/]*\.md$/);
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null;
}

/**
 * Whether a note is a fleeting note the app may remove. Literature and permanent notes never qualify.
 * strict (automatic cleanup) also requires the note to be explicitly tagged `type: fleeting`.
 */
export function isFleeting(n, { strict = false } = {}) {
  if (!n || !/^fleeting\/[^/]+\.md$/.test(n.path) || n.type !== 'fleeting' || n.fm.source) return false;
  return strict ? n.fm.type === 'fleeting' : n.fm.type === undefined || n.fm.type === 'fleeting';
}

const ageDays = (n, now = Date.now()) => {
  const t = lastTouched(n);
  return t == null ? 0 : (now - t) / DAY;
};

/** Fleeting notes that left the inbox: archived, or old enough that the next cleanup will archive them. */
export const isArchivedFleeting = (n) =>
  n.type === 'fleeting' && (n.archived || (isFleeting(n, { strict: true }) && ageDays(n) > ARCHIVE_AFTER_DAYS));

/** Days until cleanup deletes the note, or null when cleanup will never delete it (not tagged fleeting). */
export const daysUntilDeletion = (n) =>
  isFleeting(n, { strict: true }) ? Math.max(0, Math.ceil(DELETE_AFTER_DAYS - ageDays(n))) : null;

const newestFirst = (a, b) => String(b.fm.created_at || b.path).localeCompare(String(a.fm.created_at || a.path));

export const fleetingNotes = () => [...state.notes.values()].filter((n) => n.type === 'fleeting' && !isArchivedFleeting(n));

export const archivedFleetingNotes = () => [...state.notes.values()].filter(isArchivedFleeting).sort(newestFirst);

/** Delete a fleeting note the user promoted or discarded. Refuses anything that isn't a fleeting note. */
export async function deleteFleeting(n, message) {
  if (!isFleeting(n)) throw new Error('Only fleeting notes can be deleted this way.');
  await gh.deleteFleetingFile(n.path, n.sha, message);
  removeLocal(n.path);
}

/**
 * Connect a permanent note to a reference, or disconnect it, by rewriting its `references` list.
 * Disconnecting also drops a legacy "Source: …" body line naming that reference.
 */
export async function setConnected(note, reference, connected) {
  const n = state.notes.get(note.path) || note;
  if (n.type !== 'permanent') throw new Error('Only permanent notes can be connected to a reference.');
  const key = sourceKey(reference);
  const refs = connected
    ? uniqueReferences([...n.references, reference])
    : n.references.filter((r) => sourceKey(r) !== key);
  const body = connected
    ? n.body
    : n.body
      .split('\n')
      .filter((l) => sourceKey(l.match(SOURCE_LINE)?.[1]) !== key)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s*$/, '\n');
  const fm = { ...n.fm, references: refs.length ? refs : undefined, updated_at: new Date().toISOString() };
  const content = serializeNote({ fm, extra: n.extra, body });
  const name = n.path.split('/').pop();
  const sha = await gh.putFile(n.path, content, n.sha, `${connected ? 'Connect' : 'Disconnect'} ${name} ${connected ? 'to' : 'from'} ${reference}`);
  return upsertLocal(n.path, sha, content);
}

/** Other permanent notes that share at least one reference with these references. */
export function sharingReferences(refs, excludePath) {
  const keys = new Set(refs.map(sourceKey));
  if (!keys.size) return [];
  return permanentNotes()
    .filter((n) => n.path !== excludePath && n.references.some((r) => keys.has(sourceKey(r))))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Delete a literature note the user explicitly chose to delete from its reference page (after confirming).
 * No automatic path calls this; cleanup and promotion never remove literature notes.
 */
export async function deleteLiteratureByUser(n) {
  if (!n || n.type !== 'literature' || !/^literature\/[^/]+\.md$/.test(n.path)) throw new Error('Not a literature note.');
  await gh.deleteFile(n.path, n.sha, `Delete literature note ${n.path.split('/').pop()}`);
  removeLocal(n.path);
}

// ---- References: literature notes grouped by their source ----

export const sourceKey = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

const touchedIso = (n) => String(n.fm.updated_at || n.fm.created_at || '');

/**
 * References: literature notes grouped by their source, plus permanent notes connected to each reference.
 * A reference exists as soon as either kind of note names it.
 */
export function references() {
  const groups = new Map();
  const groupFor = (rawName, stamp) => {
    const name = String(rawName || '').trim().replace(/\s+/g, ' ') || 'No source';
    const key = sourceKey(name);
    const g = groups.get(key) || { key, name, notes: [], permanent: [], latest: '' };
    if (stamp >= g.latest) {
      g.latest = stamp;
      g.name = name;
    }
    groups.set(key, g);
    return g;
  };
  for (const n of state.notes.values()) {
    if (n.type === 'literature') groupFor(n.fm.source, touchedIso(n)).notes.push(n);
    else if (n.type === 'permanent') for (const r of n.references) groupFor(r, touchedIso(n)).permanent.push(n);
  }
  for (const g of groups.values()) {
    g.notes.sort((a, b) => -newestFirst(a, b));
    g.permanent.sort((a, b) => a.title.localeCompare(b.title));
  }
  return [...groups.values()].sort((a, b) => b.latest.localeCompare(a.latest));
}

export function findByTitle(title) {
  const k = title.trim().toLowerCase();
  return k ? permanentNotes().find((n) => n.title.toLowerCase() === k) : undefined;
}

export function backlinks(title, excludePath) {
  const k = title.trim().toLowerCase();
  if (!k) return [];
  return permanentNotes().filter((n) => n.path !== excludePath && n.links.some((l) => l.toLowerCase() === k));
}

/** A path under folder/ that doesn't collide with a known note. */
export function freePath(folder, name, ownPath) {
  for (let n = 1; ; n++) {
    const path = `${folder}/${name}${n > 1 ? `-${n}` : ''}.md`;
    if (path === ownPath || !state.notes.has(path)) return path;
  }
}

// ---- Capture outbox: captured text survives reloads and flaky networks until committed. ----

const OUTBOX = 'zk.outbox';
const readOutbox = () => {
  try { return JSON.parse(localStorage.getItem(OUTBOX)) || []; } catch { return []; }
};
const writeOutbox = (items) => localStorage.setItem(OUTBOX, JSON.stringify(items));

export const pendingCount = () => readOutbox().length;
export const pendingCaptures = () => readOutbox();

export function capture({ text, source }) {
  const now = new Date();
  writeOutbox([
    ...readOutbox(),
    { id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`, text, source, created_at: now.toISOString(), stamp: timestampName(now) },
  ]);
  emit();
  flushOutbox();
}

let flushing = null;
export function flushOutbox() {
  if (!getConfig()) return Promise.resolve();
  if (flushing) return flushing;
  flushing = (async () => {
    for (let item; (item = readOutbox()[0]); ) {
      await commitCapture(item);
      writeOutbox(readOutbox().filter((i) => i.id !== item.id));
      state.outboxError = '';
      emit();
    }
  })()
    .catch((e) => { state.outboxError = e.message; })
    .finally(() => {
      flushing = null;
      emit();
    });
  return flushing;
}

async function commitCapture(item) {
  const type = item.source ? 'literature' : 'fleeting';
  const body = item.text.endsWith('\n') ? item.text : `${item.text}\n`;
  const text = serializeNote({
    fm: { type, source: item.source || undefined, created_at: item.created_at, links: extractLinks(item.text) },
    body,
  });
  const stamp = item.stamp || timestampName(new Date(item.created_at));
  for (let n = 1; n <= 20; n++) {
    const path = `${type}/${stamp}${n > 1 ? `-${n}` : ''}.md`;
    if (state.notes.has(path) && state.notes.get(path).body !== body) continue;
    try {
      const sha = await gh.putFile(path, text, null, `Add ${type} note ${stamp}`);
      upsertLocal(path, sha, text);
      return;
    } catch (e) {
      if (!gh.isExistsError(e)) throw e;
      // Already there: either a previous attempt landed without us hearing back, or a real collision.
      const existing = await gh.getFile(path);
      if (existing.text === text) {
        upsertLocal(path, existing.sha, text);
        return;
      }
    }
  }
  throw new Error('Could not find a free filename for the note.');
}
