// One reference (a book, article, interview, post, URL…): its literature notes in the same day-grouped
// listing as the Fleeting tab, the permanent notes connected to it, and a box to add notes.
import { encPath } from '../github.js';
import { confirmButton, h, toast } from '../dom.js';
import { renderMarkdown } from '../markdown.js';
import * as store from '../store.js';
import { dayGroups, preview, referenceCounts, shortRow } from './rows.js';

export function referenceView(root, { name = '' }) {
  let current = name.trim();
  const open = new Set(); // paths of expanded notes

  const nameInput = h('input', {
    class: 'ed-title',
    placeholder: 'Reference: a book, article, interview, post, or URL',
    spellcheck: false,
    enterKeyHint: 'next',
    'aria-label': 'Reference name',
    onKeydown: (e) => {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        text.focus();
      }
    },
  });
  const heading = h('h1', { class: 'read-title ref-title' });
  const meta = h('p', { class: 'ref-meta' });
  const body = h('div', { class: 'ref-body' });
  const status = h('span', { class: 'status' });

  const text = h('textarea', {
    class: 'ref-add-text',
    rows: 1,
    placeholder: 'Add a note about this reference…',
    spellcheck: false,
    'aria-label': 'New note',
    onInput: grow,
    onKeydown: (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        add();
      }
    },
  });

  function grow() {
    text.style.height = 'auto';
    text.style.height = `${Math.min(text.scrollHeight, 320)}px`;
  }

  const resolveWiki = (title) => {
    const n = store.findByTitle(title);
    return n
      ? { exists: true, href: `#/note/${encPath(n.path)}` }
      : { exists: false, href: `#/new?title=${encodeURIComponent(title)}` };
  };

  function add() {
    const note = text.value.trim();
    const source = (current || nameInput.value).trim();
    if (!source) {
      status.textContent = 'Name the reference first';
      nameInput.focus();
      return;
    }
    if (!note) {
      text.focus();
      return;
    }
    store.capture({ text: note, source });
    text.value = '';
    grow();
    status.textContent = '';
    if (!current) {
      current = source;
      history.replaceState(null, '', `#/ref/${encodeURIComponent(source)}`);
    }
    render();
    text.focus();
  }

  async function removeNote(n) {
    try {
      await store.deleteLiteratureByUser(store.state.notes.get(n.path) || n);
      open.delete(n.path);
      toast('Note deleted');
    } catch (e) {
      status.textContent = e.message;
    }
  }

  function toggle(path) {
    if (open.has(path)) open.delete(path);
    else open.add(path);
    render();
  }

  function literatureRow(n) {
    if (!open.has(n.path)) return shortRow({ text: preview(n.body), onClick: () => toggle(n.path) });
    return h('li', { class: 'expanded' },
      h('div', {
        class: 'short-row',
        role: 'button',
        tabIndex: 0,
        'aria-expanded': 'true',
        onClick: (e) => { if (!e.target.closest('a') && window.getSelection()?.isCollapsed !== false) toggle(n.path); },
        onKeydown: (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(n.path); } },
      }, h('div', { class: 'prose' }, renderMarkdown(n.body.trim(), { resolveWiki }))),
      h('div', { class: 'row-actions' }, confirmButton('Delete', 'Confirm delete', () => removeNote(n), { class: 'quiet' })),
    );
  }

  function render() {
    const key = store.sourceKey(current);
    const group = current ? store.references().find((g) => g.key === key) : null;
    const pending = current ? store.pendingCaptures().filter((p) => store.sourceKey(p.source) === key) : [];
    const displayName = group?.name || current;

    nameInput.hidden = Boolean(current);
    heading.hidden = !current;
    heading.replaceChildren(
      /^https?:\/\//i.test(displayName)
        ? h('a', { class: 'external', href: displayName, target: '_blank', rel: 'noopener noreferrer' }, displayName)
        : displayName,
    );
    meta.textContent = current ? referenceCounts({ notes: [...(group?.notes || []), ...pending], permanent: group?.permanent || [] }) : '';
    if (!current) return body.replaceChildren();

    const rows = dayGroups([
      ...(group?.notes || []).map((n) => ({ time: store.lastTouched(n), node: literatureRow(n) })),
      ...pending.map((p) => ({
        time: Date.parse(p.created_at),
        node: h('li', { class: 'pending' }, h('span', { class: 'short-row' }, h('span', { class: 'clip' }, preview(p.text)))),
      })),
    ]);
    const permanent = group?.permanent || [];

    body.replaceChildren(
      rows.length ? h('ul', { class: 'notes short' }, rows) : h('p', { class: 'empty' }, 'No notes yet.'),
      permanent.length > 0 && h('section', { class: 'ref-permanent' },
        h('h2', { class: 'section-label' }, 'Permanent notes'),
        h('ul', { class: 'notes' },
          permanent.map((n) => h('li', {}, h('a', { href: `#/note/${encPath(n.path)}` },
            h('span', { class: 't' }, n.title),
            n.firstLine && h('span', { class: 'l' }, n.firstLine))))),
      ),
    );
  }

  root.replaceChildren(
    h('main', { class: 'view reference' },
      h('header', { class: 'ed-bar' },
        h('a', { class: 'btn quiet', href: '#/refs' }, 'References'),
        status,
      ),
      h('div', { class: 'scroll' },
        h('div', { class: 'ref-head' }, nameInput, heading, meta),
        body,
      ),
      h('div', { class: 'ref-add' },
        text,
        h('button', { type: 'button', class: 'primary', onClick: add }, 'Add'),
      ),
    ),
  );

  render();
  if (!current) nameInput.focus();
  const unsubscribe = store.subscribe(render);
  if (!store.state.ready) store.loadCached().then(() => store.refresh());
  return unsubscribe;
}
