// The bottom bar: review, capture (shutter), settings.
import { h, svg } from '../dom.js';
import * as store from '../store.js';
import { LAST_TAB } from './list.js';

const lastTab = () => {
  try { return sessionStorage.getItem(LAST_TAB) || 'fleeting'; } catch { return 'fleeting'; }
};

const stroke = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };

const icon = (...children) => svg('svg', { viewBox: '0 0 24 24', width: 24, height: 24, 'aria-hidden': 'true', focusable: 'false' }, ...children);

// A stack of cards, for the review deck.
const reviewIcon = () => icon(
  svg('rect', { ...stroke, x: 5, y: 5, width: 12, height: 15, rx: 2, transform: 'rotate(-9 12 12)' }),
  svg('rect', { ...stroke, fill: 'var(--bg)', x: 8, y: 5, width: 12, height: 15, rx: 2 }),
);

// A camera shutter: capture.
const shutterIcon = () => icon(
  svg('circle', { ...stroke, cx: 12, cy: 12, r: 10 }),
  svg('circle', { cx: 12, cy: 12, r: 7, fill: 'currentColor' }),
);

// Sliders: settings (and the archive inside it).
const settingsIcon = () => icon(
  svg('path', { ...stroke, d: 'M3 7h11M18 7h3M3 12h3M10 12h11M3 17h8M15 17h6' }),
  svg('circle', { ...stroke, fill: 'var(--bg)', cx: 16, cy: 7, r: 2.2 }),
  svg('circle', { ...stroke, fill: 'var(--bg)', cx: 8, cy: 12, r: 2.2 }),
  svg('circle', { ...stroke, fill: 'var(--bg)', cx: 13, cy: 17, r: 2.2 }),
);

/** Returns the nav element with an `update()` that refreshes the review badge. */
export function navBar(active) {
  const badge = h('span', { class: 'badge', hidden: true });
  const item = (key, href, label, glyph, extra) =>
    h('a', {
      class: `nav-item${active === key ? ' active' : ''}${key === 'capture' ? ' shutter' : ''}`,
      href,
      'aria-label': label,
      'aria-current': active === key ? 'page' : null,
      title: label,
      // Tapping the icon you're already on goes back to the notes.
      onClick: (e) => {
        if (active !== key) return;
        e.preventDefault();
        location.hash = `#/${lastTab()}`;
      },
    }, glyph, extra);

  const nav = h('nav', { class: 'bottom-nav', 'aria-label': 'Main' },
    item('review', '#/review', 'Review', reviewIcon(), badge),
    item('capture', '#/capture', 'New note', shutterIcon()),
    item('settings', '#/settings', 'Settings', settingsIcon()),
  );

  nav.update = () => {
    const due = store.state.ready ? store.dueForReview().length : 0;
    badge.hidden = !due;
    badge.textContent = due > 99 ? '99+' : String(due);
    badge.setAttribute('aria-label', `${due} notes to review`);
  };
  nav.update();
  return nav;
}
