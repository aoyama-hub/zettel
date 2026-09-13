import * as gh from '../github.js';
import { attachWikilinkAutocomplete } from '../autocomplete.js';
import { confirmButton, formatDate, h, toast } from '../dom.js';
import { basename, extractLinks, serializeNote, slugify, timestampName, toNote } from '../note.js';
import * as store from '../store.js';
import { openExport } from './export.js';

const SAVE_DELAY = 1500;
const LINKED_OPEN = 'zk.linkedOpen';

export function editorView(root, { path, title: initialTitle, from }) {
  const doc = { path: path || null, sha: null, fm: {}, extra: [] };
  let lastSaved = null; // serialized content known to be in the repo (or the untouched starting state)
  let originalTitle = ''; // title the filename was derived from; a change triggers a rename on leave
  let loaded = false;
  let deleted = false;
  let conflict = false;
  let timer = null;
  let chain = Promise.resolve();
  let closeExport = null;

  const status = h('button', { type: 'button', class: 'status quiet', onClick: onStatusClick });
  const titleEl = h('input', {
    class: 'ed-title',
    placeholder: 'Title',
    spellcheck: false,
    enterKeyHint: 'next',
    'aria-label': 'Title',
    onInput: edited,
    onKeydown: (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        bodyEl.focus();
      }
    },
  });
  const bodyEl = h('textarea', {
    class: 'ed-body',
    spellcheck: false,
    placeholder: 'Write. Type [[ to link a note.',
    'aria-label': 'Body',
    onInput: edited,
  });

  // ---- load ----

  function fill({ fm, extra, body, sha }) {
    doc.sha = sha;
    doc.fm = { created_at: new Date().toISOString(), ...fm };
    doc.extra = extra;
    const t = (typeof fm.title === 'string' && fm.title.trim()) || basename(doc.path);
    titleEl.value = t;
    originalTitle = t;
    bodyEl.value = body.replace(/\n$/, '');
    lastSaved = build();
    loaded = true;
    setEditable(true);
    renderLinked();
  }

  async function load() {
    if (doc.path) {
      const cached = store.state.notes.get(doc.path);
      if (cached) fill(cached);
      else setStatus('Loading…');
      try {
        const f = await gh.getFile(doc.path);
        if (!cached || (f.sha !== doc.sha && build() === lastSaved)) fill(toNote(doc.path, f.sha, f.text));
        if (!cached) setStatus('');
      } catch (e) {
        if (!cached) setStatus(e.status === 404 ? 'This note no longer exists.' : e.message, true);
      }
      return;
    }
    doc.fm = { created_at: new Date().toISOString() };
    titleEl.value = initialTitle || '';
    lastSaved = build();
    loaded = true;
    setEditable(true);
    (initialTitle ? bodyEl : titleEl).focus();
  }

  async function loadSource() {
    let src = store.state.notes.get(from);
    if (!src) {
      try {
        const f = await gh.getFile(from);
        src = toNote(from, f.sha, f.text);
      } catch (e) {
        setStatus(e.message, true);
        return;
      }
    }
    fromRow.replaceChildren(...sourceControls(src));
    fromRow.hidden = false;
    // Prefill a fresh note with the source text to distil, unless the user already typed.
    if (!doc.path && build() === lastSaved) {
      bodyEl.value = src.body.trim() + (src.fm.source ? `\n\nSource: ${src.fm.source}` : '');
      lastSaved = build();
      renderLinked();
    }
  }

  // ---- save ----

  function build() {
    const title = titleEl.value.trim();
    const body = bodyEl.value;
    const fm = { ...doc.fm, title: title || undefined, type: 'permanent', links: extractLinks(body) };
    return serializeNote({ fm, extra: doc.extra, body: body && !body.endsWith('\n') ? `${body}\n` : body });
  }

  function edited() {
    if (!loaded || deleted) return;
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY);
    if (!conflict) setStatus('Edited');
    scheduleLinked();
  }

  function save() {
    clearTimeout(timer);
    timer = null;
    chain = chain.then(doSave);
    return chain;
  }

  async function doSave() {
    if (!loaded || deleted || conflict) return;
    const content = build();
    if (content === lastSaved) {
      if (!status.classList.contains('error')) setStatus(doc.path ? 'Saved' : '');
      return;
    }
    setStatus('Saving…');
    try {
      if (!doc.path) {
        const t = titleEl.value.trim();
        doc.path = store.freePath('permanent', slugify(t) || timestampName());
        originalTitle = t;
        history.replaceState(null, '', `#/note/${gh.encPath(doc.path)}${from ? `?from=${encodeURIComponent(from)}` : ''}`);
      }
      try {
        doc.sha = await gh.putFile(doc.path, content, doc.sha, `${doc.sha ? 'Update' : 'Add'} ${basename(doc.path)}`);
      } catch (e) {
        if (doc.sha || !gh.isExistsError(e)) throw e;
        // Someone else created this filename meanwhile: take a unique one.
        doc.path = store.freePath('permanent', `${basename(doc.path)}-${timestampName()}`);
        history.replaceState(null, '', `#/note/${gh.encPath(doc.path)}`);
        doc.sha = await gh.putFile(doc.path, content, null, `Add ${basename(doc.path)}`);
      }
      lastSaved = content;
      store.upsertLocal(doc.path, doc.sha, content);
      setStatus(build() === lastSaved ? 'Saved' : 'Edited');
    } catch (e) {
      if (e.status === 409 || (e.status === 404 && doc.sha)) {
        conflict = true;
        setStatus('Changed on another device. Tap to overwrite.', true);
      } else {
        setStatus(`${e.message} Tap to retry.`, true);
      }
    }
  }

  async function onStatusClick() {
    if (!status.classList.contains('error') || !loaded) return;
    if (conflict) {
      try {
        doc.sha = (await gh.getFile(doc.path)).sha;
      } catch (e) {
        if (e.status !== 404) return setStatus(e.message, true);
        doc.sha = null;
      }
      conflict = false;
      lastSaved = null;
    }
    setStatus('');
    save();
  }

  async function renameIfNeeded() {
    const t = titleEl.value.trim();
    if (!doc.path || deleted || conflict || !t || t === originalTitle || build() !== lastSaved) return;
    const slug = slugify(t);
    if (!slug || basename(doc.path) === slug) return;
    const oldPath = doc.path;
    const newPath = store.freePath('permanent', slug);
    const message = `Rename ${basename(oldPath)} to ${basename(newPath)}`;
    const sha = await gh.putFile(newPath, lastSaved, null, message);
    store.upsertLocal(newPath, sha, lastSaved);
    await gh.deleteFile(oldPath, doc.sha, message);
    store.removeLocal(oldPath);
  }

  function setStatus(text, isError = false) {
    status.textContent = text;
    status.classList.toggle('error', isError);
  }

  function setEditable(on) {
    titleEl.readOnly = !on;
    bodyEl.readOnly = !on;
  }

  // ---- delete ----

  const deleteBtn = confirmButton('Delete', 'Confirm delete', async () => {
    deleted = true;
    clearTimeout(timer);
    await chain;
    try {
      if (doc.path && doc.sha) {
        await gh.deleteFile(doc.path, doc.sha, `Delete ${basename(doc.path)}`);
        store.removeLocal(doc.path);
      }
      location.hash = '#/notes';
    } catch (e) {
      deleted = false;
      setStatus(e.message, true);
    }
  }, { class: 'quiet' });

  // ---- source (fleeting / literature) being processed ----

  const fromRow = h('div', { class: 'from', hidden: true });

  function sourceControls(src) {
    const text = h('div', { class: 'from-text', hidden: true }, src.body.trim());
    const actions = h('span', { class: 'from-actions' });
    const done = (message) => {
      actions.replaceChildren(h('span', { class: 'muted' }, message));
      if (!doc.path && build() === lastSaved) location.hash = '#/notes';
    };
    const current = () => store.state.notes.get(src.path) || src;

    if (src.archived) {
      actions.append(h('span', { class: 'muted' }, 'Source archived'));
    } else {
      const archive = h('button', {
        type: 'button',
        class: 'quiet',
        onClick: async () => {
          archive.disabled = true;
          try {
            const n = current();
            const content = serializeNote({ fm: { ...n.fm, archived: true }, extra: n.extra, body: n.body });
            const sha = await gh.putFile(n.path, content, n.sha, `Archive ${basename(n.path)}`);
            store.upsertLocal(n.path, sha, content);
            done('Source archived');
          } catch (e) {
            archive.disabled = false;
            setStatus(e.message, true);
          }
        },
      }, 'Archive source');
      const remove = confirmButton('Delete source', 'Confirm delete', async () => {
        try {
          const n = current();
          await gh.deleteFile(n.path, n.sha, `Delete ${basename(n.path)}`);
          store.removeLocal(n.path);
          done('Source deleted');
        } catch (e) {
          setStatus(e.message, true);
        }
      }, { class: 'quiet' });
      actions.append(archive, remove);
    }

    const label = [src.type, formatDate(src.fm.created_at)].filter(Boolean).join(' · ');
    return [
      h('div', { class: 'from-bar' },
        h('button', { type: 'button', class: 'quiet', onClick: () => { text.hidden = !text.hidden; } }, `From ${label}`),
        actions,
      ),
      text,
    ];
  }

  // ---- linked notes strip ----

  const linkedToggle = h('button', { type: 'button', class: 'linked-toggle quiet', onClick: toggleLinked });
  const linkedBody = h('div', { class: 'linked-body scroll', hidden: localStorage.getItem(LINKED_OPEN) !== '1' });
  let linkTimer = null;

  function toggleLinked() {
    linkedBody.hidden = !linkedBody.hidden;
    try { localStorage.setItem(LINKED_OPEN, linkedBody.hidden ? '0' : '1'); } catch {}
    renderLinked();
  }

  function scheduleLinked() {
    clearTimeout(linkTimer);
    linkTimer = setTimeout(renderLinked, 300);
  }

  const noteLink = (n) => h('li', {}, h('a', { href: `#/note/${gh.encPath(n.path)}` }, n.title));
  const group = (label, items) =>
    h('div', { class: 'linked-group' }, h('h3', {}, label), items.length ? h('ul', {}, items) : h('p', { class: 'muted' }, 'None'));

  function renderLinked() {
    const title = titleEl.value.trim();
    const outgoing = extractLinks(bodyEl.value).map((t) => ({ t, note: store.findByTitle(t) }));
    const incoming = store.backlinks(title, doc.path);
    const count = new Set([...outgoing.map((o) => o.note?.path || `?${o.t.toLowerCase()}`), ...incoming.map((n) => n.path)]).size;
    linkedToggle.textContent = `Linked notes · ${count}`;
    linkedToggle.setAttribute('aria-expanded', String(!linkedBody.hidden));
    if (linkedBody.hidden) return;
    linkedBody.replaceChildren(
      group('Links to', outgoing.map(({ t, note }) =>
        note ? noteLink(note) : h('li', {}, h('a', { class: 'unresolved', href: `#/new?title=${encodeURIComponent(t)}` }, t)))),
      group('Linked from', incoming.map(noteLink)),
    );
  }

  // ---- mount ----

  const current = () => {
    const body = bodyEl.value;
    return { path: doc.path, title: titleEl.value.trim(), body, links: extractLinks(body) };
  };

  root.replaceChildren(
    h('main', { class: 'view editor' },
      h('header', { class: 'ed-bar' },
        h('a', { class: 'btn quiet', href: '#/notes' }, 'Notes'),
        status,
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'quiet', onClick: () => { closeExport = openExport(current); } }, 'Export'),
        deleteBtn,
      ),
      fromRow,
      titleEl,
      bodyEl,
      h('footer', { class: 'linked' }, linkedToggle, linkedBody),
    ),
  );

  setEditable(false);
  const detachAc = attachWikilinkAutocomplete(bodyEl, () => {
    const own = titleEl.value.trim().toLowerCase();
    return store.permanentNotes().map((n) => n.title).filter((t) => t.toLowerCase() !== own);
  });
  const unsubscribe = store.subscribe(renderLinked);
  const flush = () => { if (timer) save(); };
  const onVisibility = () => document.visibilityState === 'hidden' && flush();
  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('keydown', onKey);

  renderLinked();
  load().then(() => from && loadSource());
  if (!store.state.ready) store.loadCached().then(() => store.refresh());

  return () => {
    unsubscribe();
    detachAc();
    closeExport?.();
    clearTimeout(linkTimer);
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('keydown', onKey);
    if (deleted) return;
    save().then(renameIfNeeded).catch((e) => toast(`Rename failed: ${e.message}`));
  };
}
