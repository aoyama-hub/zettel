// Bundle permanent notes into one plain-text file that reads cleanly for an LLM, and hand it to the user.
import { h } from './dom.js';

const RULE = '='.repeat(64);

export const isoDay = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function permanentNotesText(notes) {
  const today = isoDay(Date.now());
  const head = [
    'ZETTELKASTEN: PERMANENT NOTES',
    `${notes.length} note${notes.length === 1 ? '' : 's'}, exported ${today}`,
    'Each note begins with a separator line, then its TITLE and CREATED date. [[Double brackets]] link to other notes by title.',
  ].join('\n');
  const blocks = notes.map((n, i) =>
    [RULE, `NOTE ${i + 1} OF ${notes.length}`, `TITLE: ${n.title}`, `CREATED: ${isoDay(n.fm.created_at)}`, RULE, '', n.body.trim() || '(empty)'].join('\n'));
  return `${head}\n\n${blocks.join('\n\n')}\n`;
}

/** Save text as a .txt file: a normal download on desktop, the share sheet (Save to Files) on iPhone/iPad. */
export async function saveTextFile(text, filename) {
  const file = new File([text], filename, { type: 'text/plain;charset=utf-8' });
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: filename, class: 'offscreen' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}
