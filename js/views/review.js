// Review: one random permanent note at a time. Swipe left to skip, right to write a note linked to it.
import { encPath } from '../github.js';
import { h, svg } from '../dom.js';
import { renderMarkdown } from '../markdown.js';
import * as review from '../review.js';
import * as store from '../store.js';

const THRESHOLD = 90; // px of horizontal travel that counts as a decision
const DAY = 24 * 60 * 60 * 1000;

export function reviewView(root) {
  const stamp = (kind, label, glyph) =>
    h('span', { class: `stamp stamp-${kind}`, 'aria-hidden': 'true' },
      svg('svg', { viewBox: '0 0 24 24', width: 20, height: 20 }, glyph), label);
  // Shown while dragging, so the gesture says what it will do without any buttons on screen.
  const connectStamp = stamp('connect', 'Connect',
    svg('path', { d: 'M9 12h6M12 9v6', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' }));
  const skipStamp = stamp('skip', 'Skip',
    svg('path', { d: 'M15 9l-6 6M9 9l6 6', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' }));

  const card = h('article', { class: 'card' }, connectStamp, skipStamp);
  const stack = h('div', { class: 'card-stack' }, card);
  const progress = h('span', { class: 'progress' });
  let current = null;
  let animating = false;

  const resolveWiki = (title) => {
    const n = store.findByTitle(title);
    return n
      ? { exists: true, href: `#/note/${encPath(n.path)}` }
      : { exists: false, href: `#/new?title=${encodeURIComponent(title)}` };
  };

  function reviewedLabel(n) {
    const { skipped, reviewedAt } = store.reviewStats(n);
    const days = reviewedAt ? Math.floor((Date.now() - reviewedAt) / DAY) : null;
    return [
      days == null ? 'Not reviewed yet' : days === 0 ? 'Reviewed today' : `Reviewed ${days} day${days === 1 ? '' : 's'} ago`,
      skipped ? `skipped ${skipped}×` : '',
    ].filter(Boolean).join(' · ');
  }

  function show() {
    const next = review.currentCard();
    current = next?.note || null;
    card.style.transition = '';
    card.style.transform = '';
    card.style.opacity = '';
    setStamps(0);
    if (!current) {
      progress.textContent = '';
      card.classList.add('empty');
      card.replaceChildren(h('p', { class: 'empty' },
        store.state.ready ? 'No permanent notes yet. Promote a fleeting note to start reviewing.' : 'Loading…'));
      return;
    }
    card.classList.remove('empty');
    progress.textContent = `${next.index + 1} / ${next.total}`;
    card.replaceChildren(
      connectStamp,
      skipStamp,
      h('h2', { class: 'card-title' }, current.title),
      h('div', { class: 'prose card-body' }, renderMarkdown(current.body.trim() || '(empty)', { resolveWiki })),
      h('div', { class: 'card-meta' },
        h('span', {}, reviewedLabel(current)),
        current.references.length ? h('span', {}, current.references.join(' · ')) : null,
      ),
    );
    card.animate?.([{ opacity: 0, transform: 'scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: 140, easing: 'ease-out' });
  }

  function setStamps(dx) {
    const strength = (d) => Math.min(1, Math.max(0, (d - 20) / 70));
    connectStamp.style.opacity = String(strength(dx));
    skipStamp.style.opacity = String(strength(-dx));
  }

  function decide(connect) {
    if (!current || animating) return;
    const note = current;
    animating = true;
    card.style.transition = 'transform .25s ease-out, opacity .25s ease-out';
    card.style.transform = `translateX(${connect ? 480 : -480}px) rotate(${connect ? 12 : -12}deg)`;
    card.style.opacity = '0';
    setStamps(connect ? 120 : -120);
    review.record(note, { connected: connect });
    setTimeout(() => {
      animating = false;
      if (connect) location.hash = `#/capture?link=${encodeURIComponent(note.title)}`;
      else show();
    }, connect ? 160 : 230);
  }

  // ---- dragging ----
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dragging = false;
  let decided = false;

  const onPointerDown = (e) => {
    if (animating || !current || e.button > 0) return;
    startX = e.clientX;
    startY = e.clientY;
    dx = 0;
    dragging = false;
    decided = false;
    card.style.transition = '';
  };

  const onPointerMove = (e) => {
    if (animating || !current || decided || e.buttons === 0) return;
    const moveX = e.clientX - startX;
    const moveY = e.clientY - startY;
    if (!dragging) {
      if (Math.abs(moveX) < 10 || Math.abs(moveX) < Math.abs(moveY)) return; // let vertical scrolling through
      dragging = true;
      card.setPointerCapture?.(e.pointerId);
    }
    e.preventDefault();
    dx = moveX;
    card.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
    card.style.opacity = String(Math.max(0.35, 1 - Math.abs(dx) / 520));
    setStamps(dx);
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    if (Math.abs(dx) > THRESHOLD) {
      decided = true;
      decide(dx > 0);
    } else {
      card.style.transition = 'transform .2s ease-out, opacity .2s ease-out';
      card.style.transform = '';
      card.style.opacity = '';
      setStamps(0);
    }
  };

  const onClick = (e) => {
    if (dragging || decided || animating || !current) return;
    if (e.target.closest('a')) return;
    location.hash = `#/note/${encPath(current.path)}`;
  };

  card.addEventListener('pointerdown', onPointerDown);
  card.addEventListener('pointermove', onPointerMove);
  card.addEventListener('pointerup', onPointerUp);
  card.addEventListener('pointercancel', onPointerUp);
  card.addEventListener('click', onClick);

  const onKey = (e) => {
    if (e.target?.closest?.('input, textarea')) return; // the target can be the document itself
    if (e.key === 'ArrowLeft') decide(false);
    else if (e.key === 'ArrowRight') decide(true);
  };
  document.addEventListener('keydown', onKey);

  root.replaceChildren(
    h('main', { class: 'view review' },
      h('header', { class: 'review-head' },
        h('h1', { class: 'page-heading' }, 'Review'),
        progress,
      ),
      stack,
    ),
  );

  show();
  const unsubscribe = store.subscribe(() => {
    if (!current) show(); // notes finished loading
  });
  if (!store.state.ready) store.loadCached().then(() => store.refresh());

  return () => {
    unsubscribe();
    document.removeEventListener('keydown', onKey);
    review.flushReview();
  };
}
