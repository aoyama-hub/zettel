// One reference (a book, article, interview, post, URL…): its literature notes, read in order, plus a box to add more.
import { encPath } from '../github.js';
import { confirmButton, formatDate, h, toast } from '../dom.js';
import { renderMarkdown } from '../markdown.js';
import * as store from '../store.js';

export function referenceView(root, { name = '' }) {
  let current = name.trim();

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
  const notesEl = h('div', { class: 'ref-notes' });
  const citedEl = h('div', { class: 'ref-cited' });
  const status = h('span', { class: 'status' });

  const text = h('textarea', {
    class: 'ref-add-text',
    rows: 3,
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
    const body = text.value.trim();
    const source = (current || nameInput.value).trim();
    if (!source) {
      status.textContent = 'Name the reference first';
      nameInput.focus();
      return;
    }
    if (!body) {
      text.focus();
      return;
    }
    store.capture({ text: body, source });
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
      toast('Note deleted');
    } catch (e) {
      status.textContent = e.message;
    }
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

    const count = (group?.notes.length || 0) + pending.length;
    meta.textContent = current ? `${count} note${count === 1 ? '' : 's'}` : '';

    notesEl.replaceChildren(
      ...(group?.notes || []).map((n) =>
        h('article', { class: 'ref-note' },
          h('div', { class: 'prose' }, renderMarkdown(n.body.trim(), { resolveWiki })),
          h('div', { class: 'ref-note-meta' },
            h('span', {}, formatDate(n.fm.created_at)),
            confirmButton('Delete', 'Confirm delete', () => removeNote(n), { class: 'quiet' }),
          ),
        )),
      ...pending.map((p) =>
        h('article', { class: 'ref-note pending' },
          h('div', { class: 'prose' }, renderMarkdown(p.text, { resolveWiki })),
          h('div', { class: 'ref-note-meta' }, h('span', {}, store.state.outboxError ? `Not saved yet: ${store.state.outboxError}` : 'Saving…')),
        )),
    );
    if (current && !count) notesEl.replaceChildren(h('p', { class: 'empty-note' }, 'No notes yet.'));

    // Permanent notes distilled from this reference carry a "Source: …" line.
    const cited = current
      ? store.permanentNotes().filter((n) => n.body.split('\n').some((l) => /^source:/i.test(l.trim()) && store.sourceKey(l.trim().slice(7)) === key))
      : [];
    citedEl.hidden = !cited.length;
    citedEl.replaceChildren(
      h('h3', {}, 'Permanent notes'),
      h('ul', {}, cited.map((n) => h('li', {}, h('a', { href: `#/note/${encPath(n.path)}` }, n.title)))),
    );
  }

  root.replaceChildren(
    h('main', { class: 'view reference' },
      h('header', { class: 'ed-bar' },
        h('a', { class: 'btn quiet', href: '#/refs' }, 'References'),
        status,
      ),
      h('div', { class: 'reader scroll' },
        nameInput,
        heading,
        meta,
        notesEl,
        citedEl,
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
