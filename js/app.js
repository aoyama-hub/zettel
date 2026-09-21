import { getConfig, persistStorage } from './config.js';
import { runCleanup } from './cleanup.js';
import { h } from './dom.js';
import * as store from './store.js';
import { captureView } from './views/capture.js';
import { configView } from './views/config.js';
import { editorView } from './views/editor.js';
import { LAST_TAB, listView } from './views/list.js';
import { navBar } from './views/nav.js';
import { referenceView } from './views/reference.js';
import { reviewView } from './views/review.js';
import { settingsView } from './views/settings.js';

const root = document.getElementById('app');
const viewHost = h('div', { class: 'view-host' });
root.replaceChildren(viewHost);
let teardown = null;
let nav = null;

const LIST_TABS = ['/fleeting', '/permanent', '/refs', '/archive'];
// Screens that keep the bottom bar; the capture, editor and reference screens are full-screen.
const NAV_ACTIVE = { '/review': 'review', '/settings': 'settings', '/archive': 'settings' };

function syncNav(path) {
  const show = path in NAV_ACTIVE || LIST_TABS.includes(path);
  const active = NAV_ACTIVE[path] || null;
  nav?.remove();
  nav = null;
  if (show) {
    nav = navBar(active);
    root.append(nav);
  }
}

const lastTab = () => {
  try { return sessionStorage.getItem(LAST_TAB) || 'fleeting'; } catch { return 'fleeting'; }
};

function route() {
  const [path, query = ''] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(query);

  if (!getConfig() && path !== '/config') {
    location.replace('#/config');
    return;
  }
  if (getConfig() && path === '/config') {
    location.replace('#/settings');
    return;
  }

  teardown?.();
  teardown = null;
  syncNav(path);

  if (path === '/config') teardown = configView(viewHost);
  else if (path === '/' || path === '/notes') {
    // The lists are the home screen: reopen whichever tab was used last.
    location.replace(`#/${lastTab()}`);
    return;
  } else if (LIST_TABS.includes(path)) teardown = listView(viewHost, { tab: path.slice(1) });
  else if (path === '/review') teardown = reviewView(viewHost);
  else if (path === '/settings') teardown = settingsView(viewHost);
  else if (path === '/capture') teardown = captureView(viewHost, { link: params.get('link') || '' });
  else if (path.startsWith('/ref/')) teardown = referenceView(viewHost, { name: decodeURIComponent(path.slice('/ref/'.length)) });
  else if (path.startsWith('/note/')) {
    const notePath = path.slice('/note/'.length).split('/').map(decodeURIComponent).join('/');
    teardown = editorView(viewHost, { path: notePath, from: params.get('from') });
  } else if (path === '/new') {
    teardown = editorView(viewHost, { title: params.get('title'), from: params.get('from') });
  } else {
    location.replace(`#/${lastTab()}`);
  }
}

// Size the app to the visual viewport so bottom bars sit above the on-screen keyboard.
function fitViewport() {
  const vv = window.visualViewport;
  const style = document.documentElement.style;
  style.setProperty('--app-h', `${vv ? vv.height : window.innerHeight}px`);
  style.setProperty('--app-top', `${vv ? vv.offsetTop : 0}px`);
}
window.visualViewport?.addEventListener('resize', fitViewport);
window.visualViewport?.addEventListener('scroll', fitViewport);
window.addEventListener('resize', fitViewport);
fitViewport();

window.addEventListener('hashchange', route);
window.addEventListener('online', () => store.flushOutbox());
// Coming back to the app (e.g. after writing on another device): commit pending captures, pick up remote changes.
let lastRefresh = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !getConfig()) return;
  store.flushOutbox();
  nav?.update();
  if (Date.now() - lastRefresh > 60_000) {
    lastRefresh = Date.now();
    store.refresh().then(() => runCleanup());
  }
});

// A launcher saved from the setup screen reopens at #/config. Once set up, start on the lists instead.
if (getConfig() && location.hash.startsWith('#/config')) history.replaceState(null, '', `${location.pathname}${location.search}#/`);

route();
store.subscribe(() => nav?.update());

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

if (getConfig()) {
  persistStorage();
  store.flushOutbox();
  // Warm the index in the background so autocomplete and the list are ready.
  store.loadCached().then(() => store.refresh()).then(() => runCleanup());
}
