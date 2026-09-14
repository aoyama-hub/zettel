import { encPath } from '../github.js';
import { h, toast } from '../dom.js';
import { isoDay, permanentNotesText, saveTextFile } from '../download.js';
import { plainText } from '../note.js';
import * as store from '../store.js';

const TABS = [
  ['fleeting', 'Fleeting'],
  ['permanent', 'Permanent'],
  ['refs', 'References'],
];
export const LAST_TAB = 'zk.lastTab';
const SORT = 'zk.sort';

const terms = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);
const matchesAll = (text, ts) => ts.every((t) => text.includes(t));
const preview = (body) => body.split('\n').map(plainText).filter(Boolean).join(' ');
const edited = (n) => Date.parse(n.fm.updated_at) || Date.parse(n.fm.created_at) || 0;

function snippet(body, ts) {
  const text = preview(body);
  const lower = text.toLowerCase();
  const at = ts.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (at == null) return null;
  const start = Math.max(0, at - 30);
  return `${start ? '…' : ''}${text.slice(start, at + 90).trim()}${at + 90 < text.length ? '…' : ''}`;
}

function dayLabel(ms) {
  const d = new Date(ms);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / store.DAY);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

/** Rows grouped under small day labels, newest day first. items: [{ time, node }] */
function byDay(items) {
  const out = [];
  let last = '';
  for (const { time, node } of items.sort((a, b) => b.time - a.time)) {
    const key = time ? isoDay(time) : 'unknown';
    if (key !== last) {
      out.push(h('li', { class: 'day' }, time ? dayLabel(time) : 'Undated'));
      last = key;
    }
    out.push(node);
  }
  return out;
}

export function listView(root, { tab }) {
  if (tab !== 'archive') {
    try { sessionStorage.setItem(LAST_TAB, tab); } catch {}
  }
  let sort = localStorage.getItem(SORT) === 'recent' ? 'recent' : 'alpha';
  const searchKey = `zk.search.${tab}`;

  const search = h('input', {
    type: 'search',
    class: 'search',
    placeholder: 'Search',
    autocapitalize: 'off',
    spellcheck: false,
    enterKeyHint: 'search',
    'aria-label': 'Search',
    value: sessionStorage.getItem(searchKey) || '',
    onInput: () => {
      sessionStorage.setItem(searchKey, search.value);
      render();
    },
    onKeydown: (e) => {
      if (e.key === 'Enter') search.blur();
    },
  });

  const msg = h('p', { class: 'msg', role: 'status' });
  const content = h('div', { class: 'list-content' });

  const tools = (count, noun, extra) =>
    h('div', { class: 'list-tools' },
      h('span', { class: 'count' }, `${count} ${noun}${count === 1 ? '' : 's'}`),
      h('span', { class: 'sort', role: 'group', 'aria-label': 'Order' },
        ['alpha', 'recent'].map((key) =>
          h('button', {
            type: 'button',
            class: sort === key ? 'active' : '',
            'aria-pressed': String(sort === key),
            onClick: () => {
              sort = key;
              try { localStorage.setItem(SORT, key); } catch {}
              render();
            },
          }, key === 'alpha' ? 'A–Z' : 'Recent')),
      ),
      extra,
    );

  const sortPermanent = (notes) =>
    notes.sort(sort === 'recent' ? (a, b) => edited(b) - edited(a) : (a, b) => a.title.localeCompare(b.title));

  function renderFleeting(ts) {
    const notes = store.fleetingNotes().filter((n) => matchesAll(n.body.toLowerCase(), ts));
    const pending = ts.length ? [] : store.pendingCaptures().filter((p) => !p.source);
    const rows = byDay([
      ...pending.map((p) => ({
        time: Date.parse(p.created_at),
        node: h('li', { class: 'pending' }, h('span', { class: 'fleeting-item' }, preview(p.text))),
      })),
      ...notes.map((n) => ({
        time: store.lastTouched(n),
        node: h('li', {}, h('a', { class: 'fleeting-item', href: `#/new?from=${encodeURIComponent(n.path)}` }, preview(n.body) || '(empty)')),
      })),
    ]);
    if (store.state.ready && !rows.length) return [h('p', { class: 'empty' }, ts.length ? 'No matches.' : 'No fleeting notes.')];
    return [h('ul', { class: 'notes fleeting' }, rows)];
  }

  function renderPermanent(ts) {
    const all = store.permanentNotes();
    const notes = sortPermanent(all.filter((n) => matchesAll(`${n.title}\n${n.body}`.toLowerCase(), ts)));
    const exportButton = h('button', { type: 'button', class: 'primary export', onClick: exportAll }, 'Export');
    return [
      tools(ts.length ? notes.length : all.length, 'note', exportButton),
      h('ul', { class: 'notes' },
        notes.map((n) => {
          const inTitle = ts.length && matchesAll(n.title.toLowerCase(), ts);
          const line = ts.length && !inTitle ? snippet(n.body, ts) : n.firstLine;
          return h('li', {}, h('a', { href: `#/note/${encPath(n.path)}` },
            h('span', { class: 't' }, n.title),
            line && h('span', { class: 'l' }, line)));
        }),
      ),
      store.state.ready && !notes.length && h('p', { class: 'empty' }, ts.length ? 'No matches.' : 'No permanent notes yet.'),
    ];
  }

  async function exportAll() {
    const notes = sortPermanent(store.permanentNotes());
    if (!notes.length) return toast('No permanent notes to export');
    const saved = await saveTextFile(permanentNotesText(notes), `permanent-notes-${isoDay(Date.now())}.txt`);
    if (saved) toast(`Exported ${notes.length} note${notes.length === 1 ? '' : 's'}`);
  }

  function renderRefs(ts, q) {
    const all = store.references();
    const refs = all
      .filter((g) => matchesAll(`${g.name}\n${g.notes.map((n) => n.body).join('\n')}`.toLowerCase(), ts))
      .sort(sort === 'recent' ? (a, b) => b.latest.localeCompare(a.latest) : (a, b) => a.name.localeCompare(b.name));
    const exact = q && all.some((g) => g.key === store.sourceKey(q));
    return [
      tools(ts.length ? refs.length : all.length, 'reference'),
      h('ul', { class: 'notes' },
        refs.map((g) => h('li', {}, h('a', { href: `#/ref/${encodeURIComponent(g.name)}` },
          h('span', { class: 't' }, g.name),
          h('span', { class: 'l' }, `${g.notes.length} note${g.notes.length === 1 ? '' : 's'}`)))),
        q && !exact && h('li', {}, h('a', { class: 'create', href: `#/ref/${encodeURIComponent(q)}` }, `Create reference “${q}”`)),
      ),
      store.state.ready && !refs.length && !q && h('p', { class: 'empty' }, 'No references yet. Add a Source when you capture.'),
    ];
  }

  function renderArchive(ts) {
    const notes = store.archivedFleetingNotes().filter((n) => matchesAll(n.body.toLowerCase(), ts));
    const rows = byDay(notes.map((n) => {
      const days = store.daysUntilDeletion(n);
      return {
        time: store.lastTouched(n),
        node: h('li', {}, h('a', { class: 'fleeting-item', href: `#/new?from=${encodeURIComponent(n.path)}` },
          preview(n.body) || '(empty)',
          h('span', { class: 'countdown' }, days == null ? 'kept' : days ? `${days}d left` : 'deleting'))),
      };
    }));
    return [
      h('p', { class: 'hint' }, `Fleeting notes land here after ${store.ARCHIVE_AFTER_DAYS} days and are deleted ${store.DELETE_AFTER_DAYS} days after their last edit.`),
      rows.length ? h('ul', { class: 'notes fleeting' }, rows) : store.state.ready && h('p', { class: 'empty' }, ts.length ? 'No matches.' : 'Nothing archived.'),
    ];
  }

  function render() {
    const { state } = store;
    const q = search.value.trim();
    const ts = terms(q);
    msg.textContent = state.error || state.progress || (!state.ready && state.loading ? 'Loading…' : '');
    msg.classList.toggle('error', Boolean(state.error));
    const parts =
      tab === 'permanent' ? renderPermanent(ts)
        : tab === 'refs' ? renderRefs(ts, q)
          : tab === 'archive' ? renderArchive(ts)
            : renderFleeting(ts);
    content.replaceChildren(...parts.filter(Boolean));
  }

  const header = tab === 'archive'
    ? h('header', { class: 'list-head' },
      h('a', { class: 'btn quiet', href: '#/fleeting' }, 'Fleeting'),
      h('span', { class: 'page-title' }, 'Archive'),
      h('span', { class: 'spacer' }))
    : h('header', { class: 'list-head' },
      h('nav', { class: 'tabs', 'aria-label': 'Sections' },
        TABS.map(([key, label]) =>
          h('a', { class: key === tab ? 'tab active' : 'tab', href: `#/${key}`, 'aria-current': key === tab ? 'page' : null }, label)),
      ),
      h('a', { class: 'btn quiet', href: '#/' }, 'Capture'));

  root.replaceChildren(
    h('main', { class: 'view list' },
      header,
      h('div', { class: 'search-row' }, search),
      h('div', { class: 'scroll' },
        msg,
        content,
        h('footer', { class: 'list-foot' },
          tab !== 'archive' && h('a', { href: '#/archive' }, 'Archive'),
          h('a', { href: '#/config' }, 'Settings')),
      ),
    ),
  );

  render();
  let frame = 0;
  const unsubscribe = store.subscribe(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  });
  store.refresh();
  return () => {
    cancelAnimationFrame(frame);
    unsubscribe();
  };
}
