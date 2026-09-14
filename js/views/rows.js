// The short-note listing shared by the Fleeting tab, Archive, and reference pages:
// equal-height rows (two lines, ending in "…" when longer) under small day labels.
import { h } from '../dom.js';
import { isoDay } from '../download.js';
import { plainText } from '../note.js';
import { DAY } from '../store.js';

export const preview = (body) => body.split('\n').map(plainText).filter(Boolean).join(' ');

export function dayLabel(ms) {
  const d = new Date(ms);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / DAY);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

/** items: [{ time, node }] -> <li> nodes, newest first, with a day label wherever the day changes. */
export function dayGroups(items) {
  const out = [];
  let last = '';
  for (const { time, node } of [...items].sort((a, b) => (b.time || 0) - (a.time || 0))) {
    const key = time ? isoDay(time) : 'unknown';
    if (key !== last) {
      out.push(h('li', { class: 'day' }, time ? dayLabel(time) : 'Undated'));
      last = key;
    }
    out.push(node);
  }
  return out;
}

/**
 * One row. The clamp lives on an inner box with a fixed two-line height and no padding, so a third line
 * can never peek out below and every row is exactly the same height.
 */
export function shortRow({ text, href, onClick, aside, className = '' }) {
  const inner = [h('span', { class: 'clip' }, text || '(empty)'), aside && h('span', { class: 'aside' }, aside)];
  const row = href
    ? h('a', { class: 'short-row', href }, inner)
    : h('button', { type: 'button', class: 'short-row', onClick }, inner);
  return h('li', { class: className }, row);
}

export const referenceCounts = (g) =>
  [
    `${g.notes.length} note${g.notes.length === 1 ? '' : 's'}`,
    g.permanent.length && `${g.permanent.length} permanent`,
  ].filter(Boolean).join(' · ');
