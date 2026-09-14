// One reference (a book, article, interview, post, URL…): its literature notes in the same day-grouped
// listing as the Fleeting tab, the permanent notes connected to it, and a box to add notes.
import { encPath } from '../github.js';
import { confirmButton, h, keepFocus, toast, wrappingField } from '../dom.js';
import { renderMarkdown } from '../markdown.js';
import * as store from '../store.js';
import { dayGroups, preview, referenceCounts, shortRow } from './rows.js';

export function referenceView(root, { name = '' }) {
  let current = name.trim();
  const open = new Set(); // paths of expanded notes
  let connecting = false; // the "connect a permanent note" search is showing
  const busy = new Set(); // paths being connected/disconnected

  const nameInput = wrappingField({
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

  // ---- connecting permanent notes ----

  const connectInput = h('input', {
    type: 'search',
    class: 'search connect-search',
    placeholder: 'Search permanent notes',
    autocapitalize: 'off',
    spellcheck: false,
    enterKeyHint: 'done',
    'aria-label': 'Search permanent notes to connect',
    onInput: () => renderPicker(),
    onKeydown: (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closePicker();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const first = candidates()[0];
        if (first) connect(first);
      }
    },
  });
  const pickerList = h('ul', { class: 'notes picker' });

  const connectedKey = () => store.sourceKey(current);
  const candidates = () => {
    const k = connectInput.value.trim().toLowerCase();
    return store
      .permanentNotes()
      .filter((n) => !n.references.some((r) => store.sourceKey(r) === connectedKey()))
      .filter((n) => !k || `${n.title}\n${n.body}`.toLowerCase().includes(k))
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, 8);
  };

  function renderPicker() {
    const list = candidates();
    pickerList.replaceChildren(
      ...list.map((n) =>
        h('li', {}, h('button', {
          type: 'button',
          class: 'pick',
          disabled: busy.has(n.path),
          onPointerdown: keepFocus,
          onMousedown: keepFocus,
          onClick: () => connect(n),
        }, h('span', { class: 't' }, n.title), n.firstLine && h('span', { class: 'l' }, n.firstLine)))),
      !list.length && h('li', { class: 'empty' }, store.permanentNotes().length ? 'No other notes match.' : 'No permanent notes yet.'),
    );
  }

  function openPicker() {
    connecting = true;
    connectInput.value = '';
    render();
    connectInput.focus();
  }

  function closePicker() {
    connecting = false;
    render();
  }

  async function setConnected(n, connected) {
    busy.add(n.path);
    render();
    try {
      await store.setConnected(n, displayName(), connected);
      toast(connected ? `Connected “${n.title}”` : `Disconnected “${n.title}”`);
    } catch (e) {
      status.textContent = e.message;
    } finally {
      busy.delete(n.path);
      render();
    }
  }

  const connect = (n) => {
    connectInput.value = '';
    return setConnected(n, true);
  };

  const displayName = () => store.references().find((g) => g.key === connectedKey())?.name || current;

  function permanentSection(permanent) {
    return h('section', { class: 'ref-permanent' },
      h('div', { class: 'section-head' },
        h('h2', { class: 'section-label' }, 'Permanent notes'),
        h('button', { type: 'button', class: 'quiet', onClick: connecting ? closePicker : openPicker }, connecting ? 'Done' : '+ Connect'),
      ),
      connecting && h('div', { class: 'picker-wrap' }, connectInput, pickerList),
      permanent.length
        ? h('ul', { class: 'notes connected' },
          permanent.map((n) => h('li', {},
            h('a', { href: `#/note/${encPath(n.path)}` },
              h('span', { class: 't' }, n.title),
              n.firstLine && h('span', { class: 'l' }, n.firstLine)),
            h('button', {
              type: 'button',
              class: 'quiet disconnect',
              disabled: busy.has(n.path),
              title: 'Disconnect',
              'aria-label': `Disconnect ${n.title}`,
              onClick: () => setConnected(n, false),
            }, '×'))))
        : !connecting && h('p', { class: 'empty' }, 'No permanent notes connected yet.'),
    );
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

    const typing = document.activeElement === connectInput;
    body.replaceChildren(
      rows.length ? h('ul', { class: 'notes short' }, rows) : h('p', { class: 'empty' }, 'No notes yet.'),
      permanentSection(permanent),
    );
    if (connecting) renderPicker();
    if (typing && connecting) connectInput.focus({ preventScroll: true }); // re-rendering detached it
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
  if (!current) {
    nameInput.fit();
    nameInput.focus();
  }
  const unsubscribe = store.subscribe(render);
  if (!store.state.ready) store.loadCached().then(() => store.refresh());
  return unsubscribe;
}
