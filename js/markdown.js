// A small markdown renderer that builds DOM nodes directly (never HTML strings).
// Block elements carry data-line = source line index so a tap can map back to the text.
import { h } from './dom.js';
import { linkTarget } from './note.js';

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;

/**
 * opts.resolveWiki(title) -> { href, exists }
 * opts.onTask(lineIndex, checked) — makes task checkboxes interactive
 */
export function renderMarkdown(text, opts = {}) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((t, n) => ({ t, n }));
  const frag = document.createDocumentFragment();
  frag.append(...blocks(lines, opts));
  return frag;
}

const isTableStart = (lines, i) =>
  lines[i].t.includes('|') && i + 1 < lines.length && lines[i + 1].t.includes('-') && TABLE_SEP.test(lines[i + 1].t);

const startsBlock = (lines, i) => {
  const t = lines[i].t;
  return FENCE.test(t) || HEADING.test(t) || HR.test(t) || QUOTE.test(t) || LIST.test(t) || isTableStart(lines, i);
};

function blocks(lines, opts) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const { t, n } = lines[i];
    let m;
    if (!t.trim()) {
      i++;
    } else if ((m = t.match(FENCE))) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].t.trim().startsWith(m[1])) body.push(lines[i++].t);
      i++;
      out.push(h('pre', { 'data-line': n }, h('code', {}, body.join('\n'))));
    } else if ((m = t.match(HEADING))) {
      out.push(h(`h${m[1].length}`, { 'data-line': n }, inline(m[2], opts)));
      i++;
    } else if (HR.test(t)) {
      out.push(h('hr', { 'data-line': n }));
      i++;
    } else if (QUOTE.test(t)) {
      const inner = [];
      while (i < lines.length && (m = lines[i].t.match(QUOTE))) inner.push({ t: m[1], n: lines[i++].n });
      out.push(h('blockquote', { 'data-line': n }, blocks(inner, opts)));
    } else if (LIST.test(t)) {
      const [node, next] = list(lines, i, opts);
      out.push(node);
      i = next;
    } else if (isTableStart(lines, i)) {
      const [node, next] = table(lines, i, opts);
      out.push(node);
      i = next;
    } else {
      const para = [lines[i++]];
      while (i < lines.length && lines[i].t.trim() && !startsBlock(lines, i)) para.push(lines[i++]);
      out.push(h('p', {}, lineSpans(para, opts)));
    }
  }
  return out;
}

// Single newlines are kept as line breaks: dictated notes rely on them.
function lineSpans(lines, opts) {
  const out = [];
  lines.forEach(({ t, n }, k) => {
    if (k) out.push(h('br'));
    out.push(h('span', { 'data-line': n }, inline(t.trim(), opts)));
  });
  return out;
}

function list(lines, i, opts) {
  const items = [];
  while (i < lines.length) {
    const { t, n } = lines[i];
    const m = t.match(LIST);
    if (m) {
      const indent = m[1].replace(/\t/g, '    ').length;
      // A different marker type at the top level starts a new list.
      if (items.length && indent <= items[0].indent && /\d/.test(m[2]) !== items[0].ordered) break;
      items.push({ indent, ordered: /\d/.test(m[2]), num: parseInt(m[2], 10), text: m[3], n, extra: [] });
      i++;
    } else if (!t.trim()) {
      let j = i;
      while (j < lines.length && !lines[j].t.trim()) j++;
      if (j < lines.length && LIST.test(lines[j].t)) i = j;
      else break;
    } else if (items.length && (/^\s{2,}\S/.test(t) || !startsBlock(lines, i))) {
      items[items.length - 1].extra.push({ t, n });
      i++;
    } else {
      break;
    }
  }
  return [buildList(items, opts), i];
}

function buildList(items, opts) {
  const base = items[0].indent;
  const el = h(items[0].ordered ? 'ol' : 'ul');
  if (items[0].ordered && items[0].num !== 1) el.start = items[0].num;
  let k = 0;
  while (k < items.length) {
    const item = items[k++];
    const children = [];
    while (k < items.length && items[k].indent > base) children.push(items[k++]);
    el.append(listItem(item, children.length ? buildList(children, opts) : null, opts));
  }
  return el;
}

function listItem(item, nested, opts) {
  const task = item.text.match(TASK);
  const text = [{ t: task ? task[2] : item.text, n: item.n }, ...item.extra];
  const li = h('li', { 'data-line': item.n }, task ? h('span', {}, lineSpans(text, opts)) : lineSpans(text, opts));
  if (task) {
    const box = h('input', {
      type: 'checkbox',
      checked: task[1] !== ' ',
      disabled: !opts.onTask,
      'aria-label': 'Done',
      onChange: (e) => opts.onTask?.(item.n, e.target.checked),
    });
    li.classList.add('task');
    li.classList.toggle('checked', task[1] !== ' ');
    li.prepend(box);
  }
  if (nested) li.append(nested);
  return li;
}

function table(lines, i, opts) {
  const cells = (t) => t.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
  const head = cells(lines[i].t);
  const aligns = cells(lines[i + 1].t).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
  const headLine = lines[i].n;
  i += 2;
  const rows = [];
  while (i < lines.length && lines[i].t.trim() && lines[i].t.includes('|')) rows.push(lines[i++]);
  const cell = (tag, text, k) => {
    const el = h(tag, {}, inline(text, opts));
    if (aligns[k]) el.style.textAlign = aligns[k];
    return el;
  };
  const node = h('div', { class: 'table-wrap' },
    h('table', {},
      h('thead', {}, h('tr', { 'data-line': headLine }, head.map((c, k) => cell('th', c, k)))),
      h('tbody', {}, rows.map((r) => h('tr', { 'data-line': r.n }, cells(r.t).map((c, k) => cell('td', c, k))))),
    ),
  );
  return [node, i];
}

const INLINE = new RegExp(
  [
    String.raw`(?<esc>\\[\\\x60*_{}\[\]()#+\-.!|~=<>])`,
    String.raw`(?<code>\x60\x60[^\x60\n][\s\S]*?\x60\x60|\x60[^\x60\n]+\x60)`,
    String.raw`(?<wiki>!?\[\[[^\[\]\n]+?\]\])`,
    String.raw`(?<img>!\[[^\]\n]*\]\([^)\s]+(?:\s+"[^"\n]*")?\))`,
    String.raw`(?<link>\[[^\]\n]+\]\([^)\s]+(?:\s+"[^"\n]*")?\))`,
    String.raw`(?<auto><https?:\/\/[^>\s]+>|https?:\/\/[^\s<]*[^\s<.,;:!?)\]'"*_~])`,
    String.raw`(?<strong>\*\*(?=\S)[\s\S]*?\S\*\*|__(?=\S)[\s\S]*?\S__)`,
    String.raw`(?<del>~~(?=\S)[\s\S]*?\S~~)`,
    String.raw`(?<mark>==(?=\S)[\s\S]*?\S==)`,
    String.raw`(?<em>\*(?=[^\s*])[\s\S]*?[^\s*]\*|(?<![\p{L}\p{N}_])_(?=[^\s_])[\s\S]*?[^\s_]_(?![\p{L}\p{N}_]))`,
  ].join('|'),
  'gu',
);

function inline(text, opts = {}) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(token(m, opts));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function token(m, opts) {
  const s = m[0];
  const g = m.groups;
  if (g.esc) return s.slice(1);
  if (g.code) return h('code', {}, s.startsWith('``') ? s.slice(2, -2).trim() : s.slice(1, -1));
  if (g.wiki) {
    const raw = s.replace(/^!?\[\[|\]\]$/g, '');
    const title = linkTarget(raw);
    const bar = raw.indexOf('|');
    const label = bar >= 0 ? raw.slice(bar + 1).trim() : raw.trim();
    const target = opts.resolveWiki?.(title);
    return h('a', { class: target?.exists ? 'wikilink' : 'wikilink unresolved', href: target?.href || '#' }, label || title);
  }
  if (g.img) {
    const [, alt, url] = s.match(/^!\[([^\]]*)\]\(([^)\s]+)/);
    if (/^https:\/\//i.test(url)) return h('img', { src: url, alt, loading: 'lazy', referrerPolicy: 'no-referrer' });
    return h('span', { class: 'muted' }, alt || url);
  }
  if (g.link) {
    const [, label, url] = s.match(/^\[([^\]]+)\]\(([^)\s]+)/);
    return externalLink(url, inline(label, opts));
  }
  if (g.auto) {
    const url = s.replace(/^<|>$/g, '');
    return externalLink(url, url);
  }
  if (g.strong) return h('strong', {}, inline(s.slice(2, -2), opts));
  if (g.del) return h('del', {}, inline(s.slice(2, -2), opts));
  if (g.mark) return h('mark', {}, inline(s.slice(2, -2), opts));
  if (g.em) return h('em', {}, inline(s.slice(1, -1), opts));
  return s;
}

function externalLink(url, children) {
  if (!/^(https?:|mailto:)/i.test(url)) return h('span', {}, children);
  return h('a', { class: 'external', href: url, target: '_blank', rel: 'noopener noreferrer' }, children);
}
