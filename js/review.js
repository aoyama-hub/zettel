// The review deck: a shuffled run through every permanent note, and the skip/connect tallies it records.
// Swipes are batched into one commit rather than one commit per card.
import { getConfig } from './config.js';
import * as gh from './github.js';
import { serializeNote } from './note.js';
import * as store from './store.js';

const DECK = 'zk.deck';
const PENDING = 'zk.reviewPending';
const FLUSH_DELAY = 8000;

const read = (key) => {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
};

function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * The card to show now. The shuffled order is kept until the last card is passed; only then is a new
 * order drawn, which is when notes added since the last shuffle join the deck.
 */
export function currentCard() {
  const notes = store.permanentNotes();
  if (!notes.length) return null;
  const byPath = new Map(notes.map((n) => [n.path, n]));
  let deck = read(DECK);
  if (deck?.order?.length) {
    // Drop notes that no longer exist, keeping the position in the run.
    const before = deck.order.slice(0, deck.i).filter((p) => byPath.has(p)).length;
    deck = { order: deck.order.filter((p) => byPath.has(p)), i: before };
  }
  if (!deck?.order?.length || deck.i >= deck.order.length) deck = { order: shuffle([...byPath.keys()]), i: 0 };
  write(DECK, deck);
  return { note: byPath.get(deck.order[deck.i]), index: deck.i, total: deck.order.length };
}

function advance() {
  const deck = read(DECK);
  if (deck) write(DECK, { ...deck, i: deck.i + 1 });
}

/**
 * Record a decision on a card and move on. `connected` means the user went off to write a linked note,
 * which clears the skip tally; otherwise the tally grows by one.
 */
export function record(note, { connected }) {
  const pending = read(PENDING) || {};
  const entry = pending[note.path] || { skips: 0 };
  if (connected) {
    entry.skips = 0;
    entry.reset = true;
  } else {
    entry.skips = (entry.skips || 0) + 1;
  }
  entry.at = new Date().toISOString();
  pending[note.path] = entry;
  write(PENDING, pending);
  advance();
  schedule();
}

export const pendingCount = () => Object.keys(read(PENDING) || {}).length;

let timer = null;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(flushReview, FLUSH_DELAY);
}

let flushing = null;
export function flushReview() {
  clearTimeout(timer);
  if (!getConfig() || flushing) return flushing || Promise.resolve();
  const pending = read(PENDING) || {};
  const paths = Object.keys(pending);
  if (!paths.length) return Promise.resolve();
  flushing = (async () => {
    const writes = [];
    for (const path of paths) {
      const n = store.state.notes.get(path);
      if (!n) continue; // note is gone; drop the tally with it
      const entry = pending[path];
      const skipped = entry.reset ? 0 : store.reviewStats(n).skipped + (entry.skips || 0);
      const fm = { ...n.fm, skipped: skipped || undefined, reviewed_at: entry.at };
      writes.push({ path, content: serializeNote({ fm, extra: n.extra, body: n.body }) });
    }
    if (writes.length) {
      await gh.commitNotes(writes, `Review: update ${writes.length} note${writes.length === 1 ? '' : 's'}`);
      for (const w of writes) store.upsertLocal(w.path, await gh.gitBlobSha(w.content), w.content);
    }
    // Only clear what we just wrote; anything swiped meanwhile stays pending.
    const left = read(PENDING) || {};
    for (const path of paths) delete left[path];
    write(PENDING, left);
  })()
    .catch(() => {}) // keep the tallies; the next flush retries
    .finally(() => { flushing = null; });
  return flushing;
}

document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushReview());
window.addEventListener('pagehide', () => flushReview());
