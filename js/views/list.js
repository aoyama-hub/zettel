import { encPath } from '../github.js';
import { formatDate, h } from '../dom.js';
import * as store from '../store.js';

const FILTER = 'zk.filter';
const INBOX_OPEN = 'zk.inboxOpen';

export function listView(root) {
  const filter = h('input', {
    type: 'search',
    class: 'filter',
    placeholder: 'Filter',
    autocapitalize: 'off',
    spellcheck: false,
    enterKeyHint: 'go',
    'aria-label': 'Filter notes by title',
    value: sessionStorage.getItem(FILTER) || '',
    onInput: () => {
      sessionStorage.setItem(FILTER, filter.value);
      render();
    },
    onKeydown: (e) => {
      if (e.key !== 'Enter') return;
      const q = filter.value.trim();
      const matches = visible(q);
      if (matches.length === 1) location.hash = `#/note/${encPath(matches[0].path)}`;
      else if (q && !store.findByTitle(q)) location.hash = `#/new?title=${encodeURIComponent(q)}`;
    },
  });

  const msg = h('p', { class: 'msg', role: 'status' });
  const newLink = h('a', { class: 'new', href: '#/new' });
  const list = h('ul', { class: 'notes' });
  const inboxCount = h('span', {});
  const inboxAction = h('span', { class: 'inbox-action' });
  const inboxBody = h('div', { hidden: localStorage.getItem(INBOX_OPEN) === '0' },
    h('p', { class: 'inbox-hint' }, 'Tap one to rewrite it as a permanent note.'),
  );
  const inboxList = h('ul', { class: 'notes inbox-list' });
  inboxBody.append(inboxList);
  const inboxToggle = h('button', {
    type: 'button',
    class: 'inbox-toggle',
    onClick: () => {
      inboxBody.hidden = !inboxBody.hidden;
      try { localStorage.setItem(INBOX_OPEN, inboxBody.hidden ? '0' : '1'); } catch {}
      render();
    },
  }, inboxCount, inboxAction);
  const inbox = h('section', { class: 'inbox' }, inboxToggle, inboxBody);

  const visible = (q) => {
    const k = q.toLowerCase();
    return store
      .permanentNotes()
      .filter((n) => n.title.toLowerCase().includes(k))
      .sort((a, b) => a.title.localeCompare(b.title));
  };

  function render() {
    const { state } = store;
    const q = filter.value.trim();
    msg.textContent = state.error || state.progress || (!state.ready && state.loading ? 'Loading…' : '');
    msg.classList.toggle('error', Boolean(state.error));

    const exact = q && store.findByTitle(q);
    newLink.textContent = q && !exact ? `+ New permanent note “${q}”` : '+ New permanent note';
    newLink.href = q && !exact ? `#/new?title=${encodeURIComponent(q)}` : '#/new';

    const notes = visible(q);
    list.replaceChildren(
      ...notes.map((n) =>
        h('li', {}, h('a', { href: `#/note/${encPath(n.path)}` },
          h('span', { class: 't' }, n.title),
          n.firstLine && h('span', { class: 'l' }, n.firstLine),
        )),
      ),
    );
    if (state.ready && !notes.length && !q) list.replaceChildren(h('li', { class: 'empty' }, 'No permanent notes yet.'));

    const pending = store.inboxNotes();
    inbox.hidden = Boolean(q) || !pending.length;
    inboxCount.textContent = `Unprocessed · ${pending.length}`;
    inboxAction.textContent = inboxBody.hidden ? 'Show' : 'Hide';
    inboxToggle.setAttribute('aria-expanded', String(!inboxBody.hidden));
    inboxList.replaceChildren(
      ...pending.map((n) =>
        h('li', {}, h('a', { href: `#/new?from=${encodeURIComponent(n.path)}` },
          h('span', { class: 't' }, n.firstLine || '(empty)'),
          h('span', { class: 'l' }, [n.type, formatDate(n.fm.created_at), n.fm.source].filter(Boolean).join(' · ')),
        )),
      ),
    );
  }

  root.replaceChildren(
    h('main', { class: 'view list' },
      h('header', { class: 'list-head' }, filter, h('a', { class: 'btn quiet', href: '#/' }, 'Capture')),
      h('div', { class: 'scroll' },
        msg,
        inbox,
        newLink,
        list,
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
