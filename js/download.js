// Bundle permanent notes into one plain-text file that reads cleanly for an LLM, and hand it to the user.
import { h } from './dom.js';

export const isoDay = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Read by an LLM before the notes. The author's prompt, verbatim.
const PROMPT = `You are helping me find emergent connections across my personal Zettelkasten — atomic permanent notes, each one idea in my own words. Below this prompt is my full export: title, date, sources (if any), body text, and [[wikilinks]] I've already drawn between them.

Work in two passes.

PASS 1 — Analysis (show this before your final answer)
Go through the notes and, for each pair or cluster that shares an underlying mechanism, briefly note what the shared structure actually is. Focus specifically on pairs with NO existing [[link]] between them. Also flag any pair where following one note's logic complicates or pushes against another. Base every observation on specific note content — quote or paraphrase the exact line that supports it.

PASS 2 — Candidate notes, in two tiers

Tier 1 — Solid: connections you'd stand behind, where the shared mechanism is concrete and traceable to specific lines in the notes.

Tier 2 — Stretch: connections that are genuinely plausible but you're less sure of — a structural echo you noticed but can't fully justify, an analogy that might be reaching, a link that only works if you squint. Include these. Label them clearly as Tier 2 and briefly say what makes you uncertain about each one. This tier is where the actually novel combinations tend to live — don't self-censor here, just don't disguise a stretch as a solid finding.

For both tiers, write each as a new candidate permanent note, matching the exact style of my existing notes:

Example of the target format:
---
Title in my voice, same tone as my existing titles
One or two sentences, first person or declarative, no hedging, no "this suggests" academic framing.
---

Aim for 3-5 in Tier 1 and however many genuine Tier 2 candidates you find — don't pad Tier 1 to hit a number, and don't suppress Tier 2 to look more certain than you are.

[notes follow below]`;

/**
 * Minimal formatting to keep token counts low, after the prompt:
 *   ---
 *   Title
 *   2026-08-25 · Reference; Other reference
 *   body
 */
export function permanentNotesText(notes) {
  const blocks = notes.map((n) => {
    const meta = [isoDay(n.fm.created_at), n.references?.length ? n.references.join('; ') : ''].filter(Boolean).join(' · ');
    const body = n.body
      .trim()
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^[ \t]*-{3,}[ \t]*$/gm, '***'); // a markdown divider must not look like the note separator
    return [n.title, meta, body].filter(Boolean).join('\n');
  });
  return `${[PROMPT, ...blocks].join('\n---\n')}\n`;
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
