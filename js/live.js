// A plain-text editor that styles markdown as you type. Nothing is rendered away: the characters you
// typed stay exactly as typed (`**bold**` keeps its asterisks), they just get dimmed or weighted so the
// structure reads at a glance. The element quacks like a <textarea> (value, selectionStart,
// setSelectionRange) so the rest of the app can treat it as one.
import { h } from './dom.js';

const HEADING = /^(\s*)(#{1,6})(\s+)(.*)$/;
const QUOTE = /^(\s*)(>+\s?)(.*)$/;
const TASK = /^(\s*)([-*+])(\s+)(\[[ xX]\])(\s+)(.*)$/;
const BULLET = /^(\s*)([-*+])(\s+)(.*)$/;
const ORDERED = /^(\s*)(\d{1,9}[.)])(\s+)(.*)$/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;

// Deliberately flat: no nesting, so what you see while typing stays predictable.
const INLINE = new RegExp(
  [
    String.raw`(?<code>\x60[^\x60\n]+\x60)`,
    String.raw`(?<bold>\*\*[^\n]+?\*\*|__[^\n]+?__)`,
    String.raw`(?<strike>~~[^\n]+?~~)`,
    String.raw`(?<high>==[^\n]+?==)`,
    String.raw`(?<wiki>!?\[\[[^\[\]\n]+?\]\])`,
    String.raw`(?<link>\[[^\]\n]+?\]\([^)\s]*\))`,
    String.raw`(?<italic>\*[^*\n]+?\*|(?<![\p{L}\p{N}_])_[^_\n]+?_(?![\p{L}\p{N}_]))`,
  ].join('|'),
  'gu',
);

const text = (s) => ({ cls: '', text: s });
const span = (cls, ...parts) => parts.map((part) => (typeof part === 'string' ? { cls, text: part } : { ...part, cls: part.cls || cls }));
const mark = (s) => [{ cls: 'md-mark', text: s }];
const wrapped = (cls, open, inner, close) => [...mark(open), { cls, text: inner }, ...mark(close)];

function inlineNodes(line, cls = '') {
  const out = [];
  let last = 0;
  for (const m of line.matchAll(INLINE)) {
    if (m.index > last) out.push({ cls, text: line.slice(last, m.index) });
    out.push(...inlineToken(m).map((t) => (cls && !t.cls ? { ...t, cls } : t)));
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ cls, text: line.slice(last) });
  return out;
}

function inlineToken(m) {
  const s = m[0];
  const g = m.groups;
  if (g.code) return wrapped('md-code', '`', s.slice(1, -1), '`');
  if (g.bold) return wrapped('md-bold', s.slice(0, 2), s.slice(2, -2), s.slice(-2));
  if (g.strike) return wrapped('md-strike', '~~', s.slice(2, -2), '~~');
  if (g.high) return wrapped('md-high', '==', s.slice(2, -2), '==');
  if (g.wiki) {
    const open = s.startsWith('!') ? '![[' : '[[';
    return wrapped('md-wiki', open, s.slice(open.length, -2), ']]');
  }
  if (g.link) {
    const split = s.indexOf('](');
    return [mark('['), span('md-link', s.slice(1, split)), mark(s.slice(split))];
  }
  const d = s.startsWith('_') ? '_' : '*';
  return wrapped('md-italic', d, s.slice(1, -1), d);
}

/** Nodes for one source line. Their text, concatenated, is exactly the line. */
function lineNodes(line) {
  let m;
  if (RULE.test(line)) return span('md-rule', line);
  if ((m = line.match(HEADING))) {
    return [text(m[1]), ...mark(m[2] + m[3]), ...inlineNodes(m[4], `md-h${m[2].length}`)];
  }
  if ((m = line.match(QUOTE))) return [text(m[1]), ...mark(m[2]), ...inlineNodes(m[3], 'md-quote')];
  if ((m = line.match(TASK))) {
    const done = m[4][1] !== ' ';
    return [
      text(m[1]), ...span('md-bullet', m[2]), text(m[3]),
      ...span(done ? 'md-box md-done' : 'md-box', m[4]), text(m[5]),
      ...inlineNodes(m[6], done ? 'md-strike' : ''),
    ];
  }
  if ((m = line.match(BULLET))) return [text(m[1]), ...span('md-bullet', m[2]), text(m[3]), ...inlineNodes(m[4])];
  if ((m = line.match(ORDERED))) return [text(m[1]), ...span('md-bullet', m[2]), text(m[3]), ...inlineNodes(m[4])];
  return inlineNodes(line);
}

/** The styling plan for a source string: a flat list of { cls, text } whose text, joined, is the source. */
export function styledSpans(source) {
  const out = [];
  const lines = source.split('\n');
  lines.forEach((line, i) => {
    if (line) out.push(...lineNodes(line));
    if (i < lines.length - 1) out.push(text('\n'));
  });
  return out.filter((part) => part.text !== '');
}

const toNode = (part) => (part.cls ? h('span', { class: part.cls }, part.text) : document.createTextNode(part.text));
const nodeClass = (node) => (node.nodeType === Node.TEXT_NODE ? '' : node.getAttribute?.('class') || '');

// A trailing newline has no line to land on, so browsers snap the caret back before it. This <br>
// gives that last line something to be, and carries no text of its own.
const EOL = 'md-eol';
const needsEol = (source) => source === '' || source.endsWith('\n');
const buildNodes = (parts, source) => {
  const nodes = parts.map(toNode);
  if (needsEol(source)) nodes.push(h('br', { class: EOL }));
  return nodes;
};

export function createLiveEditor({ className = '', placeholder = '', ariaLabel } = {}) {
  const el = h('div', {
    class: `live ${className}`.trim(),
    contenteditable: 'true',
    role: 'textbox',
    spellcheck: false,
    'aria-multiline': 'true',
    'aria-label': ariaLabel,
    'data-placeholder': placeholder,
  });
  el.isLiveEditor = true;

  let rendered = '';
  let composing = false;

  // ---- text model: a flat run of styled spans and literal newlines ----

  const readText = () => {
    // A stray block element would hide its line break from textContent; innerText sees it.
    if (el.querySelector(`div, p, br:not(.${EOL})`)) return el.innerText.replace(/\r\n?/g, '\n').replace(/\n$/, '');
    return el.textContent;
  };

  function offsetOf(node, offset) {
    if (node === el) {
      let total = 0;
      for (const child of [...el.childNodes].slice(0, offset)) total += child.textContent.length;
      return total;
    }
    let total = 0;
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walk.nextNode())) {
      if (n === node) return total + offset;
      total += n.data.length;
    }
    return total;
  }

  /**
   * Where offset `target` sits in the DOM. Positions that fall between two nodes are anchored to the
   * element itself: a caret placed just after a newline inside a text node gets normalised back onto
   * the previous line, which silently sends typing to the wrong place.
   */
  function locate(target) {
    const kids = [...el.childNodes];
    let total = 0;
    for (let i = 0; i < kids.length; i++) {
      const len = kids[i].textContent.length;
      if (target === total) return [el, i];
      if (target < total + len) {
        const node = kids[i].nodeType === Node.TEXT_NODE ? kids[i] : kids[i].firstChild;
        return [node, target - total];
      }
      total += len;
    }
    return [el, kids.length];
  }

  function getCaret() {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!el.contains(r.startContainer)) return null;
    return { start: offsetOf(r.startContainer, r.startOffset), end: offsetOf(r.endContainer, r.endOffset) };
  }

  function setCaret(start, end = start) {
    const [sn, so] = locate(start);
    const [en, eo] = locate(end);
    const r = document.createRange();
    r.setStart(sn, so);
    r.setEnd(en, eo);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  /**
   * Re-style the text. Typing a plain character changes no markup, so the common case patches nothing
   * and leaves the caret alone — rebuilding the DOM mid-keystroke makes browsers drop characters.
   */
  function render({ force = false } = {}) {
    const source = readText();
    if (!force && source === rendered) return;
    const parts = styledSpans(source);
    if (!force && patch(parts, source)) {
      rendered = source;
      return;
    }
    const keep = document.activeElement === el ? getCaret() : null;
    el.replaceChildren(...buildNodes(parts, source));
    rendered = source;
    if (keep) setCaret(Math.min(keep.start, source.length), Math.min(keep.end, source.length));
  }

  /** True when the existing nodes already carry this styling (only their text needed touching up). */
  function patch(parts, source) {
    const nodes = [...el.childNodes].filter((n) => !(n.nodeName === 'BR' && n.classList?.contains(EOL)));
    if (needsEol(source) !== (nodes.length !== el.childNodes.length)) return false;
    if (nodes.length !== parts.length) return false;
    if (nodes.some((node, i) => nodeClass(node) !== parts[i].cls)) return false;
    nodes.forEach((node, i) => {
      const target = node.nodeType === Node.TEXT_NODE ? node : node.firstChild;
      if (!target || target.data === parts[i].text) return;
      target.data = parts[i].text; // the browser has usually already done this for us
    });
    return true;
  }

  // ---- history (rebuilding the DOM loses the browser's own undo stack) ----

  let history = [{ text: '', caret: 0 }];
  let at = 0;
  let lastEdit = 0;
  let coalescing = false;
  let programmatic = false;

  function record() {
    const source = rendered;
    const caret = getCaret()?.start ?? source.length;
    const current = history[at];
    if (current.text === source) {
      current.caret = caret;
      return;
    }
    const now = Date.now();
    const single = Math.abs(source.length - current.text.length) <= 2;
    // Only fold consecutive keystrokes together: a toolbar insert or paste deserves its own undo step.
    const typing = single && coalescing && now - lastEdit < 600 && at === history.length - 1;
    // Typing after a programmatic edit starts its own step too, so one undo doesn't swallow both.
    coalescing = single && !programmatic;
    programmatic = false;
    if (typing) history[at] = { text: source, caret };
    else {
      history = [...history.slice(0, at + 1), { text: source, caret }];
      at = history.length - 1;
    }
    lastEdit = now;
  }

  function step(delta) {
    const next = at + delta;
    if (next < 0 || next >= history.length) return;
    at = next;
    const entry = history[at];
    el.replaceChildren(...buildNodes(styledSpans(entry.text), entry.text));
    rendered = entry.text;
    setCaret(Math.min(entry.caret, entry.text.length));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ---- input plumbing ----

  el.addEventListener('compositionstart', () => { composing = true; });
  el.addEventListener('compositionend', () => {
    composing = false;
    render();
    record();
  });
  el.addEventListener('input', () => {
    if (composing) return; // mid-IME or dictation: leave the text alone until it settles
    render();
    record();
  });

  el.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
    e.preventDefault();
    step(e.shiftKey ? 1 : -1);
  });

  // Paste and drop arrive as plain text so the model stays plain text.
  const insertPlain = (e, data) => {
    const value = data?.getData('text/plain');
    if (value == null) return;
    e.preventDefault();
    coalescing = false; // a paste is its own undo step
    programmatic = true;
    document.execCommand('insertText', false, value.replace(/\r\n?/g, '\n'));
  };
  el.addEventListener('paste', (e) => insertPlain(e, e.clipboardData));
  el.addEventListener('drop', (e) => insertPlain(e, e.dataTransfer));

  // ---- the textarea-shaped surface the rest of the app uses ----

  Object.defineProperty(el, 'value', {
    get: () => readText(),
    set: (v) => {
      const source = String(v ?? '');
      el.replaceChildren(...buildNodes(styledSpans(source), source));
      rendered = source;
      history = [{ text: source, caret: source.length }];
      at = 0;
    },
  });
  Object.defineProperty(el, 'selectionStart', { get: () => getCaret()?.start ?? readText().length });
  Object.defineProperty(el, 'selectionEnd', { get: () => getCaret()?.end ?? readText().length });
  el.setSelectionRange = (start, end = start) => setCaret(start, end);
  /** Start a fresh undo step: programmatic edits shouldn't merge into whatever was typed before. */
  el.breakUndo = () => { coalescing = false; programmatic = true; };
  el.restyle = () => render({ force: true });

  return el;
}
