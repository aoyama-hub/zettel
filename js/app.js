import { getConfig, persistStorage } from './config.js';
import * as store from './store.js';
import { captureView } from './views/capture.js';
import { configView } from './views/config.js';
import { editorView } from './views/editor.js';
import { listView } from './views/list.js';

const root = document.getElementById('app');
let teardown = null;

function route() {
  const [path, query = ''] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(query);

  if (!getConfig() && path !== '/config') {
    location.replace('#/config');
    return;
  }

  teardown?.();
  teardown = null;

  if (path === '/config') teardown = configView(root);
  else if (path === '/notes') teardown = listView(root);
  else if (path.startsWith('/note/')) {
    const notePath = path.slice('/note/'.length).split('/').map(decodeURIComponent).join('/');
    teardown = editorView(root, { path: notePath, from: params.get('from') });
  } else if (path === '/new') {
    teardown = editorView(root, { title: params.get('title'), from: params.get('from') });
  } else teardown = captureView(root);
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
  if (Date.now() - lastRefresh > 60_000) {
    lastRefresh = Date.now();
    store.refresh();
  }
});

// A launcher saved from the setup screen reopens at #/config. Once set up, start at capture instead.
if (getConfig() && location.hash.startsWith('#/config')) history.replaceState(null, '', `${location.pathname}${location.search}#/`);

route();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

if (getConfig()) {
  persistStorage();
  store.flushOutbox();
  // Warm the index in the background so autocomplete and the list are ready.
  store.loadCached().then(() => store.refresh());
}
