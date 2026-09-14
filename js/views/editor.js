import * as gh from '../github.js';
import { attachWikilinkAutocomplete, caretRect } from '../autocomplete.js';
import { confirmButton, formatDate, h, insertText, keepFocus, toast, wrappingField } from '../dom.js';
import { renderMarkdown } from '../markdown.js';
import { SOURCE_LINE, basename, extractLinks, noteReferences, serializeNote, slugify, timestampName, toNote, uniqueReferences } from '../note.js';
import * as store from '../store.js';

// Autosave after this much idle time; leaving, Done, and hiding the page save immediately.
const SAVE_DELAY = 4000;
const LINKED_OPEN = 'zk.linkedOpen';
const DRAFT_PREFIX = 'zk.edit:';
const LINE_PREFIX = /^(\s*)(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/;

export function editorView(root, { path, title: initialTitle, from }) {
  const doc = { path: path || null, sha: null, fm: {}, extra: [] };
  let lastSaved = null; // serialized content known to be in the repo (or the untouched starting state)
  let originalTitle = ''; // title the filename was derived from; a change triggers a rename on leave
  let mode = path && !from ? 'read' : 'edit';
  let loaded = false;
  let deleted = false;
  let mounted = true;
  let conflict = false;
  let timer = null;
  let savedTimer = null;
  let chain = Promise.resolve();
  let renderedTitles = '';
  let refs = []; // references this note is connected to (frontmatter `references`)

  // ---- elements ----

  const status = h('button', { type: 'button', class: 'status quiet', onClick: onStatusClick });
  const titleEl = wrappingField({
    class: 'ed-title',
    placeholder: 'Title',
    spellcheck: false,
    enterKeyHint: 'next',
    'aria-label': 'Title',
    onInput: edited,
    onKeydown: (e) => {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        setMode('edit', { caret: 0 });
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

  const readTitle = h('h1', { class: 'read-title' });
  const prose = h('div', { class: 'prose' });
  const readRefs = h('p', { class: 'note-refs', hidden: true });
  const reader = h('article', { class: 'reader scroll', onClick: onReaderClick }, readTitle, readRefs, prose);

  const tool = (label, name, fn) =>
    h('button', { type: 'button', class: 'tool', title: name, 'aria-label': name, onPointerdown: keepFocus, onMousedown: keepFocus, onClick: fn }, label);
  const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
    tool('[[ ]]', 'Link to a note', insertWikilink),
    tool('#', 'Heading', () => toggleLinePrefix('heading')),
    tool('List', 'List', () => toggleLinePrefix('list')),
    tool('Task', 'Task', () => toggleLinePrefix('task')),
  );

  // ---- load ----

  function fill({ fm, extra, body, sha }) {
    doc.sha = sha;
    doc.fm = { created_at: new Date().toISOString(), ...fm };
    doc.extra = extra;
    const t = (typeof fm.title === 'string' && fm.title.trim()) || basename(doc.path);
    titleEl.value = t;
    originalTitle = t;
    bodyEl.value = body.replace(/\n$/, '');
    refs = noteReferences(fm, body);
    lastSaved = build();
    loaded = true;
    refresh();
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
        if (!cached) return setStatus(e.status === 404 ? 'This note no longer exists.' : e.message, true);
      }
      restoreDraft();
      return;
    }
    doc.fm = { created_at: new Date().toISOString() };
    titleEl.value = initialTitle || '';
    lastSaved = build();
    loaded = true;
    refresh();
    setMode('edit', initialTitle ? {} : { focus: 'title' });
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
    source = src;
    renderSource();
    // Prefill a fresh note with the source text to distil, unless the user already typed.
    // Its references come along as structured data, so rewriting the text can't lose them.
    if (!doc.path && build() === lastSaved) {
      bodyEl.value = src.body
        .split('\n')
        .filter((l) => !SOURCE_LINE.test(l))
        .join('\n')
        .trim();
      refs = uniqueReferences([...(src.type === 'literature' ? [src.fm.source] : []), ...src.references]);
      lastSaved = build();
      refresh();
    }
  }

  // ---- modes ----

  function setMode(next, { caret = null, focus = 'body' } = {}) {
    const leavingEdit = mode === 'edit' && next === 'read';
    const caretLine = lineAt(bodyEl.selectionStart);
    mode = next;
    main.classList.toggle('reading', next === 'read');
    main.classList.toggle('editing', next === 'edit');
    if (next === 'read') {
      ac.close();
      document.activeElement?.blur();
      renderRead();
      if (leavingEdit) {
        save().then(completeSource);
        scrollReaderToLine(caretLine);
      }
      return;
    }
    titleEl.fit();
    if (!loaded) return;
    if (focus === 'title') {
      titleEl.focus();
      return;
    }
    bodyEl.focus({ preventScroll: true });
    const pos = caret ?? bodyEl.value.length;
    bodyEl.setSelectionRange(pos, pos);
    revealCaret();
  }

  const lineAt = (pos) => bodyEl.value.slice(0, pos).split('\n').length - 1;

  function scrollReaderToLine(line) {
    if (line <= 0) {
      reader.scrollTop = 0;
      return;
    }
    let target = null;
    for (const el of prose.querySelectorAll('[data-line]')) {
      if (Number(el.dataset.line) <= line) target = el;
    }
    target?.scrollIntoView({ block: 'center' });
  }

  function revealCaret() {
    const c = caretRect(bodyEl, bodyEl.selectionStart);
    const y = c.top - bodyEl.getBoundingClientRect().top + bodyEl.scrollTop;
    if (y < bodyEl.scrollTop + 8 || y + c.height > bodyEl.scrollTop + bodyEl.clientHeight - 8) {
      bodyEl.scrollTop = Math.max(0, y - bodyEl.clientHeight / 3);
    }
  }

  function onReaderClick(e) {
    if (!loaded || e.target.closest('a, input, button, label')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && reader.contains(sel.anchorNode)) return; // selecting text to copy
    if (readTitle.contains(e.target)) setMode('edit', { focus: 'title' });
    else setMode('edit', { caret: offsetFromPoint(e) });
  }

  /** Map a tap on the rendered note to an offset in the markdown source. */
  function offsetFromPoint(e) {
    const lines = bodyEl.value.split('\n');
    const el = e.target.closest('[data-line]');
    if (!el || !prose.contains(el)) return bodyEl.value.length;
    let line = Number(el.dataset.line);
    const hit = caretAtPoint(e.clientX, e.clientY);
    let col = null;
    if (hit && el.contains(hit.node)) {
      if (el.tagName === 'PRE') {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.setEnd(hit.node, hit.offset);
        const before = range.toString();
        line += 1 + (before.match(/\n/g) || []).length;
        col = before.length - before.lastIndexOf('\n') - 1;
      } else if (hit.node.nodeType === Node.TEXT_NODE) {
        const idx = (lines[line] || '').indexOf(hit.node.data);
        if (idx >= 0) col = idx + hit.offset;
      }
    }
    line = Math.max(0, Math.min(line, lines.length - 1));
    let start = 0;
    for (let k = 0; k < line; k++) start += lines[k].length + 1;
    return start + Math.min(col ?? lines[line].length, lines[line].length);
  }

  const resolveWiki = (title) => {
    const n = store.findByTitle(title);
    return n
      ? { exists: true, href: `#/note/${gh.encPath(n.path)}` }
      : { exists: false, href: `#/new?title=${encodeURIComponent(title)}` };
  };

  function renderRead() {
    const title = titleEl.value.trim();
    readTitle.textContent = title || 'Untitled';
    readTitle.classList.toggle('placeholder', !title);
    renderedTitles = titlesKey();
    renderReadRefs();
    const body = bodyEl.value;
    prose.replaceChildren(
      body.trim()
        ? renderMarkdown(body, { resolveWiki, onTask: toggleTask })
        : h('p', { class: 'empty-note' }, loaded ? 'Empty. Tap to write.' : ''),
    );
  }

  const titlesKey = () => store.permanentNotes().map((n) => n.title).sort().join('\n');

  function toggleTask(line, checked) {
    const lines = bodyEl.value.split('\n');
    lines[line] = lines[line].replace(/\[[ xX]\]/, checked ? '[x]' : '[ ]');
    bodyEl.value = lines.join('\n');
    edited();
    renderRead();
  }

  function refresh() {
    titleEl.fit();
    if (mode === 'read') renderRead();
    renderRefsEdit();
    renderLinked();
  }

  // ---- editing helpers ----

  function insertWikilink() {
    const s = bodyEl.selectionStart;
    const selected = bodyEl.value.slice(s, bodyEl.selectionEnd);
    insertText(bodyEl, s, bodyEl.selectionEnd, `[[${selected}]]`);
    const caret = s + 2 + selected.length;
    bodyEl.setSelectionRange(caret, caret);
    ac.update();
  }

  function toggleLinePrefix(kind) {
    const v = bodyEl.value;
    const s = bodyEl.selectionStart;
    const e = bodyEl.selectionEnd;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    let le = v.indexOf('\n', e);
    if (le < 0) le = v.length;
    const block = v.slice(ls, le);
    const want = { heading: '# ', list: '- ', task: '- [ ] ' }[kind];
    const has = {
      heading: (p) => /^#{1,6}\s+$/.test(p),
      list: (p) => /^([-*+]|\d+[.)])\s+$/.test(p),
      task: (p) => /^[-*+]\s+\[[ xX]\]\s+$/.test(p),
    }[kind];
    const parsed = block.split('\n').map((l) => {
      const m = l.match(LINE_PREFIX);
      return { indent: m[1], prefix: m[2] || '', rest: l.slice(m[0].length) };
    });
    const remove = parsed.every((p) => has(p.prefix));
    const next = parsed.map((p) => p.indent + (remove ? '' : want) + p.rest).join('\n');
    insertText(bodyEl, ls, le, next);
    const caret = s === e ? Math.min(ls + next.length, Math.max(ls, s + next.length - block.length)) : ls + next.length;
    bodyEl.setSelectionRange(caret, caret);
  }

  // Enter on a list item continues the list; Enter on an empty item ends it.
  function onBodyKeydown(e) {
    if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    const v = bodyEl.value;
    const s = bodyEl.selectionStart;
    if (s !== bodyEl.selectionEnd) return;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    const m = v.slice(ls, s).match(/^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/);
    if (!m) return;
    e.preventDefault();
    let le = v.indexOf('\n', s);
    if (le < 0) le = v.length;
    if (!v.slice(ls + m[0].length, le).trim()) {
      insertText(bodyEl, ls, le, m[1]);
      return;
    }
    const marker = m[3] ? `${Number(m[3]) + 1}${m[4]}` : m[2];
    insertText(bodyEl, s, s, `\n${m[1]}${marker}${m[5]}${m[6] ? '[ ] ' : ''}`);
  }

  // ---- save ----

  function build() {
    const title = titleEl.value.trim();
    const body = bodyEl.value;
    const fm = {
      ...doc.fm,
      title: title || undefined,
      type: 'permanent',
      references: refs.length ? refs : undefined,
      links: extractLinks(body),
    };
    return serializeNote({ fm, extra: doc.extra, body: body && !body.endsWith('\n') ? `${body}\n` : body });
  }

  function edited() {
    if (!loaded || deleted) return;
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY);
    if (!conflict) setStatus('Edited');
    writeDraft();
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
    let content = build();
    if (content === lastSaved) {
      if (!status.classList.contains('error') && status.textContent === 'Edited') setStatus('');
      return;
    }
    setStatus('Saving…');
    doc.fm.updated_at = new Date().toISOString(); // drives "Recent" ordering
    content = build();
    try {
      if (!doc.path) {
        const t = titleEl.value.trim();
        doc.path = store.freePath('permanent', slugify(t) || timestampName());
        originalTitle = t;
        history.replaceState(null, '', `#/note/${gh.encPath(doc.path)}${source ? `?from=${encodeURIComponent(source.path)}` : ''}`);
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
      if (build() === lastSaved) {
        clearDraft();
        setStatus('Saved');
      } else {
        writeDraft();
        setStatus('Edited');
      }
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
    clearTimeout(savedTimer);
    status.textContent = text;
    status.classList.toggle('error', isError);
    if (text === 'Saved') savedTimer = setTimeout(() => status.textContent === 'Saved' && setStatus(''), 2000);
  }

  // ---- local draft backup (survives the tab being killed before a commit lands) ----

  function writeDraft() {
    if (!doc.path) return;
    try {
      localStorage.setItem(DRAFT_PREFIX + doc.path, JSON.stringify({ title: titleEl.value, body: bodyEl.value, refs, base: doc.sha }));
    } catch {}
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_PREFIX + doc.path); } catch {}
  }

  function restoreDraft() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(DRAFT_PREFIX + doc.path)); } catch {}
    if (!d) return;
    const sameRefs = !d.refs || d.refs.join('\n') === refs.join('\n');
    if (d.title === titleEl.value && d.body === bodyEl.value && sameRefs) return clearDraft();
    titleEl.value = d.title;
    bodyEl.value = d.body;
    if (d.refs) refs = d.refs;
    refresh();
    if (d.base && d.base !== doc.sha) {
      conflict = true;
      setStatus('Restored unsaved edits, but the note changed elsewhere. Tap to overwrite.', true);
    } else {
      setStatus('Restored unsaved edits');
      timer = setTimeout(save, 500);
    }
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
      if (doc.path) clearDraft();
      location.hash = '#/notes';
    } catch (e) {
      deleted = false;
      setStatus(e.message, true);
    }
  }, { class: 'quiet' });

  // ---- the fleeting / literature note this permanent note is made from ----

  const fromRow = h('div', { class: 'from', hidden: true });
  let source = null; // until the original has been deleted (fleeting) or marked processed (literature)
  let completing = null;

  const latestSource = () => store.state.notes.get(source.path) || source;
  const dropFromParam = () => history.replaceState(null, '', location.hash.replace(/\?from=[^&]*/, ''));

  function renderSource() {
    fromRow.hidden = !source;
    if (!source) return fromRow.replaceChildren();
    const fleeting = store.isFleeting(source);
    const original = h('div', { class: 'from-text', hidden: true }, source.body.trim());
    const label = [fleeting ? 'From fleeting note' : `From ${source.fm.source || 'literature note'}`, formatDate(source.fm.created_at)]
      .filter(Boolean)
      .join(' · ');
    fromRow.replaceChildren(
      h('div', { class: 'from-bar' },
        h('button', { type: 'button', class: 'quiet', title: 'Show original', onClick: () => { original.hidden = !original.hidden; } }, label),
        fleeting && h('span', { class: 'from-actions' }, confirmButton('Delete', 'Confirm delete', discardSource, { class: 'quiet' })),
      ),
      original,
    );
  }

  // Once this note is saved with a title: delete a fleeting original; mark a literature original processed.
  // Literature notes are never deleted.
  function completeSource() {
    if (completing) return completing;
    if (!source || deleted || conflict || !doc.path || !titleEl.value.trim() || build() !== lastSaved) return Promise.resolve();
    completing = (async () => {
      const n = latestSource();
      try {
        if (store.isFleeting(n)) {
          await store.deleteFleeting(n, `Delete ${basename(n.path)} (made permanent as ${basename(doc.path)})`);
          toast('Fleeting note deleted');
        } else if (n.type === 'literature' && !n.archived) {
          const content = serializeNote({ fm: { ...n.fm, archived: true }, extra: n.extra, body: n.body });
          const sha = await gh.putFile(n.path, content, n.sha, `Mark ${basename(n.path)} processed`);
          store.upsertLocal(n.path, sha, content);
        }
        source = null;
        if (mounted) {
          renderSource();
          dropFromParam();
        }
      } catch (e) {
        toast(`Couldn't update the original note: ${e.message}`);
      } finally {
        completing = null;
      }
    })();
    return completing;
  }

  async function discardSource() {
    try {
      const n = latestSource();
      await store.deleteFleeting(n, `Delete ${basename(n.path)}`);
      source = null;
      renderSource();
      dropFromParam();
      toast('Fleeting note deleted');
      if (!doc.path && build() === lastSaved) location.hash = '#/notes';
    } catch (e) {
      setStatus(e.message, true);
    }
  }

  // ---- references (sources) this note is connected to ----

  const refHref = (name) => `#/ref/${encodeURIComponent(name)}`;

  function renderReadRefs() {
    readRefs.hidden = !refs.length;
    readRefs.replaceChildren(
      ...refs.flatMap((r, i) => [i ? ' · ' : '', h('a', { href: refHref(r) }, r)]),
    );
  }

  const refInput = h('input', {
    class: 'ref-input',
    placeholder: 'Add a reference',
    spellcheck: false,
    autocapitalize: 'off',
    enterKeyHint: 'done',
    'aria-label': 'Add a reference',
    hidden: true,
    onInput: () => renderRefSuggestions(),
    onBlur: () => setTimeout(() => {
      if (document.activeElement === refInput) return;
      addRef(refInput.value);
      refInput.hidden = true;
      refSuggest.hidden = true;
    }, 150),
    onKeydown: (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        addRef(refInput.value);
        refInput.focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        refInput.value = '';
        refInput.blur();
      }
    },
  });
  const refSuggest = h('div', { class: 'source-suggest', hidden: true });
  const refChips = h('div', { class: 'ref-chips' });
  const refsEdit = h('div', { class: 'refs-edit' }, refChips, refInput, refSuggest);

  function renderRefsEdit() {
    refChips.replaceChildren(
      ...refs.map((r) =>
        h('span', { class: 'ref-chip' },
          h('span', {}, r),
          h('button', { type: 'button', class: 'quiet', 'aria-label': `Remove reference ${r}`, onPointerdown: keepFocus, onMousedown: keepFocus, onClick: () => removeRef(r) }, '×'))),
      refInput.hidden && h('button', {
        type: 'button',
        class: 'quiet add-ref',
        onClick: () => {
          refInput.hidden = false;
          refInput.focus();
          renderRefsEdit();
          renderRefSuggestions();
        },
      }, refs.length ? '+ Reference' : '+ Add reference'),
    );
  }

  function renderRefSuggestions() {
    const k = store.sourceKey(refInput.value);
    const taken = new Set(refs.map(store.sourceKey));
    const matches = store.references().filter((g) => !taken.has(g.key) && g.key.includes(k)).slice(0, 6);
    refSuggest.hidden = refInput.hidden || !matches.length;
    refSuggest.replaceChildren(
      ...matches.map((g) =>
        h('button', { type: 'button', class: 'quiet', onPointerdown: keepFocus, onMousedown: keepFocus, onClick: () => { addRef(g.name); refInput.focus(); } }, g.name)),
    );
  }

  function addRef(name) {
    const next = uniqueReferences([...refs, name]);
    refInput.value = '';
    if (next.length !== refs.length) {
      refs = next;
      edited();
    }
    renderRefsEdit();
    renderRefSuggestions();
  }

  function removeRef(name) {
    const key = store.sourceKey(name);
    refs = refs.filter((r) => store.sourceKey(r) !== key);
    // A legacy "Source: …" body line would bring it back on the next load; drop it too.
    const lines = bodyEl.value.split('\n');
    const kept = lines.filter((l) => store.sourceKey(l.match(SOURCE_LINE)?.[1]) !== key);
    if (kept.length !== lines.length) bodyEl.value = kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
    edited();
    renderRefsEdit();
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
  const group = (label, items) => items.length > 0 && h('div', { class: 'linked-group' }, h('h3', {}, label), h('ul', {}, items));

  function renderLinked() {
    const title = titleEl.value.trim();
    const outgoing = extractLinks(bodyEl.value).map((t) => ({ t, note: store.findByTitle(t) }));
    const incoming = store.backlinks(title, doc.path);
    const sharing = store.sharingReferences(refs, doc.path);
    const notes = new Set([
      ...outgoing.map((o) => o.note?.path || `?${o.t.toLowerCase()}`),
      ...incoming.map((n) => n.path),
      ...sharing.map((n) => n.path),
    ]);
    const count = refs.length + notes.size;
    linkedToggle.textContent = `Linked notes · ${count}`;
    linkedToggle.setAttribute('aria-expanded', String(!linkedBody.hidden));
    if (linkedBody.hidden) return;
    const refKeys = (n) => new Set(n.references.map(store.sourceKey));
    const groups = [
      group('References', refs.map((r) => h('li', {}, h('a', { href: refHref(r) }, r)))),
      group('Shares a reference', sharing.map((n) => {
        const shared = refs.filter((r) => refKeys(n).has(store.sourceKey(r)));
        return h('li', {}, h('a', { href: `#/note/${gh.encPath(n.path)}` }, n.title), h('span', { class: 'via' }, shared.join(', ')));
      })),
      group('Links to', outgoing.map(({ t, note }) =>
        note ? noteLink(note) : h('li', {}, h('a', { class: 'unresolved', href: `#/new?title=${encodeURIComponent(t)}` }, t)))),
      group('Linked from', incoming.map(noteLink)),
    ].filter(Boolean);
    linkedBody.replaceChildren(
      ...(groups.length ? groups : [h('p', { class: 'muted' }, 'Nothing yet. Add a reference, or type [[ to link a note.')]),
    );
  }

  // ---- mount ----

  const main = h('main', { class: `view editor ${mode === 'read' ? 'reading' : 'editing'}` },
    h('header', { class: 'ed-bar' },
      h('a', { class: 'btn quiet', href: '#/notes' }, 'Notes'),
      status,
      h('span', { class: 'spacer' }),
      h('span', { class: 'read-actions' },
        h('button', { type: 'button', class: 'quiet', onClick: () => setMode('edit') }, 'Edit'),
        deleteBtn,
      ),
      h('button', { type: 'button', class: 'done-btn', onClick: () => setMode('read') }, 'Done'),
    ),
    fromRow,
    reader,
    titleEl,
    refsEdit,
    bodyEl,
    toolbar,
    h('footer', { class: 'linked' }, linkedToggle, linkedBody),
  );
  root.replaceChildren(main);

  const ac = attachWikilinkAutocomplete(bodyEl, () => {
    const own = titleEl.value.trim().toLowerCase();
    return store.permanentNotes().map((n) => n.title).filter((t) => t.toLowerCase() !== own);
  });
  // Registered after the autocomplete so Enter picks a suggestion before continuing a list.
  bodyEl.addEventListener('keydown', onBodyKeydown);

  const onFocusChange = () => {
    const a = document.activeElement;
    main.classList.toggle('typing', a === bodyEl || a === titleEl);
    main.classList.toggle('typing-body', a === bodyEl);
  };
  main.addEventListener('focusin', onFocusChange);
  main.addEventListener('focusout', () => setTimeout(onFocusChange, 0));

  const unsubscribe = store.subscribe(() => {
    renderLinked();
    if (mode === 'read' && loaded && titlesKey() !== renderedTitles) renderRead();
  });
  const flush = () => { if (timer) save(); };
  const onVisibility = () => document.visibilityState === 'hidden' && flush();
  const onKey = (e) => {
    const typingTarget = e.target.closest?.('input, textarea, [contenteditable]');
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      save();
    } else if (mode === 'edit' && !e.defaultPrevented && (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey)))) {
      e.preventDefault();
      setMode('read');
    } else if (mode === 'read' && !typingTarget && e.key === 'e' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      setMode('edit');
    }
  };
  let viewportFrame = 0;
  const onViewport = () => {
    cancelAnimationFrame(viewportFrame);
    viewportFrame = requestAnimationFrame(() => {
      titleEl.fit(); // width changes (rotation, window resize) re-wrap the title
      if (document.activeElement === bodyEl) revealCaret();
    });
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('keydown', onKey);
  window.visualViewport?.addEventListener('resize', onViewport);
  window.addEventListener('resize', onViewport);

  refresh();
  load().then(() => from && loadSource());
  if (!store.state.ready) store.loadCached().then(() => store.refresh());

  return () => {
    unsubscribe();
    ac.destroy();
    clearTimeout(linkTimer);
    clearTimeout(savedTimer);
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('keydown', onKey);
    window.visualViewport?.removeEventListener('resize', onViewport);
    window.removeEventListener('resize', onViewport);
    mounted = false;
    if (deleted) return;
    save()
      .then(completeSource)
      .then(renameIfNeeded)
      .catch((e) => toast(`Rename failed: ${e.message}`));
  };
}

function caretAtPoint(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    return r && { node: r.startContainer, offset: r.startOffset };
  }
  return null;
}
