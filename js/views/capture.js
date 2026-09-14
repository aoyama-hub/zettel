import { h, keepFocus } from '../dom.js';
import * as store from '../store.js';

const DRAFT = 'zk.draft';

export function captureView(root) {
  const text = h('textarea', {
    class: 'capture-text',
    spellcheck: false,
    autocapitalize: 'sentences',
    'aria-label': 'Note',
    value: localStorage.getItem(DRAFT) || '',
    onInput: () => {
      try { localStorage.setItem(DRAFT, text.value); } catch {}
    },
    onKeydown: (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commit();
      }
    },
  });

  const source = h('input', {
    class: 'source-input',
    hidden: true,
    placeholder: 'Book, article, interview, post, or URL',
    autocapitalize: 'off',
    spellcheck: false,
    'aria-label': 'Source',
    onInput: () => {
      syncChip();
      renderSuggestions();
    },
    onFocus: renderSuggestions,
    onBlur: () => setTimeout(() => { suggestions.hidden = true; }, 0),
    onKeydown: (e) => {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        text.focus();
      }
    },
  });

  // Existing references to pick from, so notes on the same source group together.
  const suggestions = h('div', { class: 'source-suggest', hidden: true });

  function renderSuggestions() {
    const k = store.sourceKey(source.value);
    const matches = store.references().filter((g) => g.key !== k && g.key.includes(k)).slice(0, 5);
    suggestions.hidden = source.hidden || document.activeElement !== source || !matches.length;
    suggestions.replaceChildren(
      ...matches.map((g) =>
        h('button', {
          type: 'button',
          class: 'quiet',
          onPointerdown: keepFocus,
          onMousedown: keepFocus,
          onClick: () => {
            source.value = g.name;
            syncChip();
            suggestions.hidden = true;
            text.focus();
          },
        }, g.name)),
    );
  }

  const chip = h('button', {
    type: 'button',
    class: 'chip',
    'aria-expanded': 'false',
    onClick: () => {
      if (source.hidden) {
        source.hidden = false;
        source.focus();
      } else if (!source.value.trim()) {
        source.hidden = true;
        text.focus();
      } else {
        source.focus();
      }
      syncChip();
    },
  }, 'Source');

  const status = h('span', { class: 'status', role: 'status' });

  function syncChip() {
    const value = source.value.trim();
    chip.classList.toggle('on', Boolean(value));
    chip.setAttribute('aria-expanded', String(!source.hidden));
    chip.textContent = value ? `Source: ${value.length > 28 ? `${value.slice(0, 28)}…` : value}` : 'Source';
  }

  function commit() {
    const body = text.value.trim();
    if (body) {
      store.capture({ text: body, source: source.value.trim() });
      text.value = '';
      source.value = '';
      source.hidden = true;
      suggestions.hidden = true;
      syncChip();
      try { localStorage.removeItem(DRAFT); } catch {}
    }
    text.focus();
  }

  function renderStatus() {
    const pending = store.pendingCount();
    if (store.state.outboxError) status.textContent = `${pending} not committed: ${store.state.outboxError}`;
    else if (pending) status.textContent = 'Committing…';
    else status.textContent = '';
    status.classList.toggle('error', Boolean(store.state.outboxError));
  }

  const retry = () => store.pendingCount() && store.flushOutbox();
  status.addEventListener('click', retry);

  root.replaceChildren(
    h('main', { class: 'view capture' },
      h('div', { class: 'capture-top' }, chip, status),
      source,
      suggestions,
      text,
      h('div', { class: 'bar' },
        h('a', { class: 'btn quiet', href: '#/notes', onPointerdown: keepFocus }, 'Exit'),
        h('button', { type: 'button', class: 'primary', onPointerdown: keepFocus, onMousedown: keepFocus, onClick: commit }, 'New'),
      ),
    ),
  );

  renderStatus();
  text.focus();
  const unsubscribe = store.subscribe(renderStatus);
  return unsubscribe;
}
