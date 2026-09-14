// Note file format: YAML frontmatter + markdown body.
export const TYPES = ['fleeting', 'literature', 'permanent'];

// Keys this app reads and rewrites, in output order. Any other frontmatter keys are preserved verbatim.
const KNOWN = ['title', 'type', 'source', 'created_at', 'updated_at', 'links', 'archived', 'archived_at'];

export function parseNote(text) {
  const m = text.match(/^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/);
  if (!m) return { fm: {}, extra: [], body: text };
  const entries = [];
  for (const line of (m[1] || '').split(/\r?\n/)) {
    const k = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (k) entries.push({ key: k[1], rest: k[2].trim(), lines: [line] });
    else if (entries.length) entries[entries.length - 1].lines.push(line);
  }
  const fm = {};
  const extra = [];
  for (const e of entries) {
    if (KNOWN.includes(e.key)) fm[e.key] = parseValue(e.rest, e.lines.slice(1));
    else extra.push(e.lines.join('\n'));
  }
  return { fm, extra, body: text.slice(m[0].length) };
}

function parseValue(rest, more) {
  if (rest === '' && more.some((l) => /^\s*-(\s|$)/.test(l))) {
    return more.map((l) => l.match(/^\s*-\s*(.*)$/)).filter(Boolean).map((x) => unquote(x[1])).filter(Boolean);
  }
  if (rest.startsWith('[') && rest.endsWith(']')) return splitFlow(rest.slice(1, -1)).map(unquote).filter(Boolean);
  if (rest === 'true') return true;
  if (rest === 'false') return false;
  return unquote(rest);
}

function unquote(s) {
  s = s.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

function splitFlow(s) {
  const out = [];
  let cur = '';
  let quote = null;
  let escaped = false;
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (escaped) escaped = false;
      else if (ch === '\\' && quote === '"') escaped = true;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function yamlStr(s, inFlow = false) {
  const needsQuotes =
    s === '' ||
    /^\s|\s$/.test(s) ||
    /^[-?:,\[\]{}#&*!|>'"%@`]/.test(s) ||
    /: |:$| #|[\n\\"]/.test(s) ||
    (inFlow && /[,\[\]{}]/.test(s)) ||
    /^(true|false|yes|no|on|off|null|~|[-+]?(\d[\d_]*)?\.?\d+([eE][-+]?\d+)?)$/i.test(s);
  return needsQuotes ? JSON.stringify(s) : s;
}

export function serializeNote({ fm, extra = [], body }) {
  const lines = [];
  for (const key of KNOWN) {
    const v = fm[key];
    if (Array.isArray(v)) lines.push(`${key}: [${v.map((x) => yamlStr(String(x), true)).join(', ')}]`);
    else if (typeof v === 'boolean') { if (v) lines.push(`${key}: true`); }
    else if (v != null && String(v) !== '') lines.push(`${key}: ${yamlStr(String(v))}`);
  }
  lines.push(...extra);
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

export function linkTarget(s) {
  return String(s).replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
}

/** Unique [[wikilink]] targets in order of appearance. */
export function extractLinks(body) {
  const out = [];
  const seen = new Set();
  for (const m of body.matchAll(/\[\[([^\[\]\n]+?)\]\]/g)) {
    const t = linkTarget(m[1]);
    const k = t.toLowerCase();
    if (t && !seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

export function slugify(s) {
  const slug = s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return Array.from(slug).slice(0, 80).join('').replace(/-+$/, '');
}

export function timestampName(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export const basename = (path) => path.split('/').pop().replace(/\.md$/i, '');

/** One line of markdown reduced to readable plain text (for list previews). */
export function plainText(line) {
  return line
    .replace(/^(\s*(#{1,6}|[-*+]|>|\d+[.)])\s+)+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/!?\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|==|`)/g, '')
    .replace(/(^|[\s(])[*_](\S[^*_]*\S|\S)[*_](?=[\s.,;:!?)]|$)/g, '$1$2')
    .trim();
}

function firstLine(body) {
  const line = body.split('\n').map((l) => l.trim()).find((l) => l && !/^(```|~~~|---+$)/.test(l)) || '';
  return plainText(line).slice(0, 140);
}

/** Build the in-memory note record from a file. */
export function toNote(path, sha, text) {
  const { fm, extra, body } = parseNote(text);
  const folder = path.split('/')[0];
  const type = TYPES.includes(folder) ? folder : fm.type || 'fleeting';
  const title = (typeof fm.title === 'string' && fm.title.trim()) || basename(path);
  const fmLinks = Array.isArray(fm.links) ? fm.links : typeof fm.links === 'string' && fm.links ? [fm.links] : [];
  const links = [];
  const seen = new Set();
  for (const l of [...fmLinks.map(linkTarget), ...extractLinks(body)]) {
    if (l && !seen.has(l.toLowerCase())) {
      seen.add(l.toLowerCase());
      links.push(l);
    }
  }
  return { path, sha, type, title, fm, extra, body, links, firstLine: firstLine(body), archived: fm.archived === true };
}
