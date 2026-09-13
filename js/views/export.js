// Export a note and its neighbourhood as one markdown blob on the clipboard. No LLM calls.
import { h, toast } from '../dom.js';
import * as store from '../store.js';

const SCOPES = [
  ['This note only', 0],
  ['This note + direct links', 1],
  ['This note + 2 hops out', 2],
];

/** getCurrent() -> { path, title, body, links } for the note being edited (including unsaved text). */
export function openExport(getCurrent) {
  const onKey = (e) => e.key === 'Escape' && close();
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Export to LLM' },
    h('h2', {}, 'Copy to clipboard'),
    SCOPES.map(([label, hops]) => h('button', { type: 'button', onClick: () => run(hops) }, label)),
    h('button', { type: 'button', class: 'quiet', onClick: () => close() }, 'Cancel'),
  );
  const backdrop = h('div', { class: 'sheet-backdrop', onClick: (e) => e.target === backdrop && close() }, panel);

  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  }

  function run(hops) {
    const notes = collect(getCurrent(), hops);
    const blob = `${notes.map((n) => `# ${n.title || 'Untitled'}\n\n${n.body.trim()}`).join('\n\n---\n\n')}\n`;
    // Called synchronously inside the tap so mobile browsers keep clipboard permission.
    copy(blob).then((ok) => toast(ok ? `Copied ${notes.length} note${notes.length === 1 ? '' : 's'}` : 'Copy failed'));
    close();
  }

  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  panel.querySelector('button').focus();
  return close;
}

const key = (n) => n.path || `title:${n.title.toLowerCase()}`;

// Neighbours are undirected: notes this one links to plus notes linking back to it.
function neighbours(n) {
  const outgoing = n.links.map((t) => store.findByTitle(t)).filter(Boolean);
  return [...outgoing, ...store.backlinks(n.title, n.path)];
}

function collect(current, hops) {
  const result = [current];
  const seen = new Set([key(current)]);
  let frontier = [current];
  for (let depth = 0; depth < hops; depth++) {
    const next = [];
    for (const n of frontier) {
      for (const m of neighbours(n)) {
        if (seen.has(key(m))) continue;
        seen.add(key(m));
        result.push(m);
        next.push(m);
      }
    }
    frontier = next;
  }
  return result;
}

function copy(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
  return Promise.resolve(legacyCopy(text));
}

function legacyCopy(text) {
  const ta = h('textarea', { value: text, readOnly: true, class: 'offscreen' });
  document.body.append(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  return ok;
}
