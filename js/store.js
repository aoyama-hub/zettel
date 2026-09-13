// In-memory note index (built from the repo tree + cached blobs) and the capture outbox.
import * as gh from './github.js';
import { cacheGet, cacheSet } from './cache.js';
import { getConfig } from './config.js';
import { extractLinks, serializeNote, timestampName, toNote } from './note.js';

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
  for (const e of entries) {
    const prev = state.notes.get(e.path);
    if (prev && prev.sha === e.sha) {
      notes.set(e.path, prev);
      continue;
    }
    const text = await cacheGet(e.sha);
    if (text != null) notes.set(e.path, toNote(e.path, e.sha, text));
    else missing.push(e);
  }
  if (fetchMissing && missing.length) {
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < missing.length) {
        const e = missing[next++];
        const text = await gh.getBlob(e.sha);
        cacheSet(e.sha, text);
        notes.set(e.path, toNote(e.path, e.sha, text));
        if (++done % 10 === 0) {
          state.progress = `Loading notes ${done}/${missing.length}`;
          emit();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, missing.length) }, worker));
  }
  const now = Date.now();
  for (const [path, r] of recent) {
    if (now - r.t > RECENT_MS) recent.delete(path);
    else if (r.note) notes.set(path, r.note);
    else notes.delete(path);
  }
  state.notes = notes;
  state.ready = true;
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

export const inboxNotes = () =>
  [...state.notes.values()]
    .filter((n) => n.type !== 'permanent' && !n.archived)
    .sort((a, b) => String(b.fm.created_at || b.path).localeCompare(String(a.fm.created_at || a.path)));

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
