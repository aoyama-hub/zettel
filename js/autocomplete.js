// [[wikilink]] autocomplete for a textarea: typing "[[" opens a dropdown of note titles.
import { h, keepFocus } from './dom.js';

const MAX = 8;

export function attachWikilinkAutocomplete(ta, getTitles) {
  const menu = h('ul', { class: 'ac', role: 'listbox', hidden: true });
  document.body.append(menu);
  let items = [];
  let active = 0;
  let start = -1;

  function update() {
    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return close();
    const m = ta.value.slice(0, pos).match(/\[\[([^\[\]\n|#]*)$/);
    if (!m) return close();
    start = pos - m[1].length;
    items = rank(getTitles(), m[1].trim().toLowerCase());
    if (!items.length) return close();
    active = 0;
    render();
    position();
  }

  function rank(titles, q) {
    const starts = [];
    const contains = [];
    for (const t of titles) {
      const k = t.toLowerCase();
      if (k.startsWith(q)) starts.push(t);
      else if (k.includes(q)) contains.push(t);
    }
    const byName = (a, b) => a.localeCompare(b);
    return [...starts.sort(byName), ...contains.sort(byName)].slice(0, MAX);
  }

  function render() {
    menu.replaceChildren(
      ...items.map((t, i) =>
        h('li', {
          role: 'option',
          class: i === active ? 'active' : '',
          'aria-selected': String(i === active),
          onPointerdown: keepFocus,
          onMousedown: keepFocus,
          onClick: () => choose(i),
        }, t),
      ),
    );
    menu.hidden = false;
  }

  function position() {
    const caret = caretRect(ta, ta.selectionStart);
    const vv = window.visualViewport;
    const viewTop = vv ? vv.offsetTop : 0;
    const viewH = vv ? vv.height : window.innerHeight;
    const viewW = vv ? vv.width : window.innerWidth;
    const mh = menu.offsetHeight;
    const mw = menu.offsetWidth;
    let top = caret.top + caret.height + 4;
    if (top + mh > viewTop + viewH - 8 && caret.top - mh - 4 > viewTop) top = caret.top - mh - 4;
    menu.style.top = `${top}px`;
    menu.style.left = `${Math.max(8, Math.min(caret.left, viewW - mw - 8))}px`;
  }

  function choose(i) {
    const title = items[i];
    const pos = ta.selectionStart;
    const closed = ta.value.slice(pos).startsWith(']]');
    const insert = closed ? title : `${title}]]`;
    ta.focus();
    ta.setSelectionRange(start, pos);
    // execCommand keeps the native undo stack; fall back when unsupported.
    if (!document.execCommand('insertText', false, insert)) {
      ta.setRangeText(insert, start, pos, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (closed) ta.setSelectionRange(start + title.length + 2, start + title.length + 2);
    close();
  }

  function close() {
    menu.hidden = true;
    items = [];
  }

  function onKeydown(e) {
    if (menu.hidden || e.isComposing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      render();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  const onKeyup = (e) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) update();
  };

  ta.addEventListener('keydown', onKeydown);
  ta.addEventListener('keyup', onKeyup);
  ta.addEventListener('input', update);
  ta.addEventListener('click', update);
  ta.addEventListener('blur', close);
  ta.addEventListener('scroll', close);

  return () => {
    ta.removeEventListener('keydown', onKeydown);
    ta.removeEventListener('keyup', onKeyup);
    ta.removeEventListener('input', update);
    ta.removeEventListener('click', update);
    ta.removeEventListener('blur', close);
    ta.removeEventListener('scroll', close);
    menu.remove();
  };
}

const MIRROR_PROPS = [
  'boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight',
  'fontStretch', 'fontSize', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent',
  'letterSpacing', 'wordSpacing', 'tabSize', 'wordBreak', 'overflowWrap',
];

/** Viewport coordinates of the caret, via an off-screen mirror of the textarea. */
function caretRect(ta, pos) {
  const cs = getComputedStyle(ta);
  const mirror = document.createElement('div');
  for (const p of MIRROR_PROPS) mirror.style[p] = cs[p];
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.textContent = ta.value.slice(0, pos);
  const marker = document.createElement('span');
  marker.textContent = ta.value.slice(pos) || '.';
  mirror.append(marker);
  document.body.append(mirror);
  const r = ta.getBoundingClientRect();
  const top = r.top + marker.offsetTop + parseFloat(cs.borderTopWidth) - ta.scrollTop;
  const left = r.left + marker.offsetLeft + parseFloat(cs.borderLeftWidth) - ta.scrollLeft;
  const height = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
  mirror.remove();
  return { top, left, height };
}
