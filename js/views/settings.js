// Settings: the archive, plus the GitHub connection.
import { getConfig } from '../config.js';
import { h } from '../dom.js';
import * as store from '../store.js';
import { configForm } from './config.js';

export function settingsView(root) {
  const cfg = getConfig();
  const archived = store.archivedFleetingNotes().length;
  const summary = h('p', { class: 'hint' });

  const render = () => {
    const counts = [
      `${store.permanentNotes().length} permanent`,
      `${store.fleetingNotes().length} fleeting`,
      `${store.references().length} references`,
    ].join(' · ');
    summary.textContent = store.state.ready ? counts : 'Loading…';
  };

  root.replaceChildren(
    h('main', { class: 'view settings' },
      h('div', { class: 'scroll' },
        h('h1', { class: 'page-heading' }, 'Settings'),
        h('ul', { class: 'notes menu' },
          h('li', {}, h('a', { href: '#/archive' },
            h('span', { class: 't' }, 'Archive'),
            h('span', { class: 'l' }, archived ? `${archived} fleeting note${archived === 1 ? '' : 's'}` : 'Nothing archived'))),
        ),
        h('h2', { class: 'section-label' }, 'Notes repo'),
        configForm(),
        summary,
        h('p', { class: 'hint' }, cfg ? `Signed in to ${cfg.owner}/${cfg.repo} on ${cfg.branch}.` : ''),
      ),
    ),
  );

  render();
  return store.subscribe(render);
}
