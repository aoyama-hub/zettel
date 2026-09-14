import { encPath } from '../github.js';
import { formatDate, h } from '../dom.js';
import * as store from '../store.js';

const TABS = [
  ['notes', 'Notes', '#/notes'],
  ['refs', 'References', '#/refs'],
  ['archive', 'Archive', '#/archive'],
];

export function listView(root, { tab = 'notes' } = {}) {
  const filterKey = `zk.filter.${tab}`;
  const filter = h('input', {
    type: 'search',
    class: 'filter',
    placeholder: tab === 'refs' ? 'Filter references' : 'Filter',
    autocapitalize: 'off',
    spellcheck: false,
    enterKeyHint: 'go',
    'aria-label': 'Filter',
    value: sessionStorage.getItem(filterKey) || '',
    onInput: () => {
      sessionStorage.setItem(filterKey, filter.value);
      render();
    },
    onKeydown: (e) => {
      if (e.key !== 'Enter') return;
      const q = filter.value.trim();
      if (tab === 'notes') {
        const matches = visibleNotes(q);
        if (matches.length === 1) location.hash = `#/note/${encPath(matches[0].path)}`;
        else if (q && !store.findByTitle(q)) location.hash = `#/new?title=${encodeURIComponent(q)}`;
      } else if (tab === 'refs') {
        const matches = visibleRefs(q);
        if (matches.length === 1) location.hash = refHref(matches[0].name);
        else if (q) location.hash = refHref(q);
      }
    },
  });

  const msg = h('p', { class: 'msg', role: 'status' });
  const content = h('div', { class: 'list-content' });

  const refHref = (name) => `#/ref/${encodeURIComponent(name)}`;

  const visibleNotes = (q) => {
    const k = q.toLowerCase();
    return store
      .permanentNotes()
      .filter((n) => n.title.toLowerCase().includes(k))
      .sort((a, b) => a.title.localeCompare(b.title));
  };

  const visibleRefs = (q) => {
    const k = store.sourceKey(q);
    return store.references().filter((g) => g.key.includes(k));
  };

  const row = (href, title, meta) =>
    h('li', {}, h('a', { href }, h('span', { class: 't' }, title), meta && h('span', { class: 'l' }, meta)));

  function renderNotes(q) {
    const exact = q && store.findByTitle(q);
    const notes = visibleNotes(q);
    const pending = q ? [] : store.inboxNotes();
    return [
      h('a', { class: 'new', href: q && !exact ? `#/new?title=${encodeURIComponent(q)}` : '#/new' },
        q && !exact ? `+ New permanent note “${q}”` : '+ New permanent note'),
      h('ul', { class: 'notes' },
        notes.map((n) => row(`#/note/${encPath(n.path)}`, n.title, n.firstLine)),
        store.state.ready && !notes.length && !q && h('li', { class: 'empty' }, 'No permanent notes yet.'),
      ),
      pending.length > 0 && h('section', { class: 'inbox' },
        h('h2', {}, `Unprocessed · ${pending.length}`),
        h('ul', { class: 'notes' },
          pending.map((n) => row(`#/new?from=${encodeURIComponent(n.path)}`, n.firstLine || '(empty)',
            [n.type, formatDate(n.fm.created_at), n.fm.source].filter(Boolean).join(' · ')))),
      ),
    ];
  }

  function renderRefs(q) {
    const refs = visibleRefs(q);
    const exact = q && refs.some((g) => g.key === store.sourceKey(q));
    return [
      h('a', { class: 'new', href: q && !exact ? refHref(q) : '#/ref/' },
        q && !exact ? `+ New reference “${q}”` : '+ New reference'),
      h('ul', { class: 'notes' },
        refs.map((g) => row(refHref(g.name), g.name,
          [`${g.notes.length} note${g.notes.length === 1 ? '' : 's'}`, formatDate(g.latest)].filter(Boolean).join(' · '))),
        store.state.ready && !refs.length && !q &&
          h('li', { class: 'empty' }, 'No references yet. Add a Source when capturing, or create one here.'),
      ),
    ];
  }

  function renderArchive(q) {
    const k = q.toLowerCase();
    const notes = store.archivedFleetingNotes().filter((n) => !k || n.body.toLowerCase().includes(k));
    return [
      h('p', { class: 'hint' },
        `Fleeting notes move here after ${store.ARCHIVE_AFTER_DAYS} days and are deleted after ${store.DELETE_AFTER_DAYS} days without changes. Tap one to make it permanent.`),
      h('ul', { class: 'notes archive-list' },
        notes.map((n) => {
          const days = store.daysUntilDeletion(n);
          return row(`#/new?from=${encodeURIComponent(n.path)}`, n.firstLine || '(empty)',
            [formatDate(n.fm.created_at), days == null ? 'kept (not tagged fleeting)' : days ? `deleted in ${days} day${days === 1 ? '' : 's'}` : 'deleted at next cleanup'].filter(Boolean).join(' · '));
        }),
        store.state.ready && !notes.length && h('li', { class: 'empty' }, q ? 'No matches.' : 'Nothing archived.'),
      ),
    ];
  }

  function render() {
    const { state } = store;
    const q = filter.value.trim();
    msg.textContent = state.error || state.progress || (!state.ready && state.loading ? 'Loading…' : '');
    msg.classList.toggle('error', Boolean(state.error));
    const parts = tab === 'refs' ? renderRefs(q) : tab === 'archive' ? renderArchive(q) : renderNotes(q);
    content.replaceChildren(...parts.filter(Boolean));
  }

  root.replaceChildren(
    h('main', { class: 'view list' },
      h('header', { class: 'list-head' },
        h('nav', { class: 'tabs', 'aria-label': 'Sections' },
          TABS.map(([key, label, href]) =>
            h('a', { class: key === tab ? 'tab active' : 'tab', href, 'aria-current': key === tab ? 'page' : null }, label)),
        ),
        h('a', { class: 'btn quiet', href: '#/' }, 'Capture'),
      ),
      h('div', { class: 'filter-row' }, filter),
      h('div', { class: 'scroll' },
        msg,
        content,
        h('footer', { class: 'list-foot' }, h('a', { href: '#/config' }, 'Settings')),
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
