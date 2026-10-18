import { getConfig, setConfig } from '../config.js';
import { checkAccess } from '../github.js';
import { h, toast } from '../dom.js';
import * as store from '../store.js';

/** The GitHub settings form, used on its own at first run and inside the Settings screen. */
export function configForm() {
  const current = getConfig();
  const field = (label, props) => {
    const input = h('input', { autocapitalize: 'off', autocomplete: 'off', spellcheck: false, ...props });
    input.setAttribute('autocorrect', 'off');
    return [h('label', {}, h('span', {}, label), input), input];
  };
  const [tokenRow, token] = field('GitHub access token', { type: 'password', value: current?.token || '', required: true });

  // GitHub only shows a token once, so let the user read this one back or copy it to another device.
  let hideTimer = null;
  const reveal = h('button', {
    type: 'button',
    class: 'quiet',
    onClick: () => {
      clearTimeout(hideTimer);
      const showing = token.type === 'text';
      token.type = showing ? 'password' : 'text';
      reveal.textContent = showing ? 'Show' : 'Hide';
      // Don't leave it on screen indefinitely.
      if (!showing) hideTimer = setTimeout(() => { token.type = 'password'; reveal.textContent = 'Show'; }, 30_000);
    },
  }, 'Show');

  const copy = h('button', {
    type: 'button',
    class: 'quiet',
    onClick: async () => {
      const value = token.value.trim();
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        const wasHidden = token.type === 'password';
        token.type = 'text';
        token.select();
        const ok = document.execCommand?.('copy');
        if (wasHidden) token.type = 'password';
        if (!ok) return toast('Copy failed — reveal it and copy by hand');
      }
      toast('Token copied');
    },
  }, 'Copy');

  tokenRow.querySelector('span').append(h('span', { class: 'field-actions' }, reveal, copy));
  const [ownerRow, owner] = field('Repo owner', { value: current?.owner || '', required: true });
  const [repoRow, repo] = field('Repo name', { value: current?.repo || '', required: true });
  const [branchRow, branch] = field('Branch', { value: current?.branch || 'main', placeholder: 'main' });
  const msg = h('p', { class: 'msg', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'primary' }, 'Save');

  // Accept "owner/repo" pasted into the owner field.
  owner.addEventListener('change', () => {
    const [o, r] = owner.value.trim().split('/');
    if (r && !repo.value) {
      owner.value = o;
      repo.value = r;
    }
  });

  const form = h('form', {
    class: 'config',
    onSubmit: async (e) => {
      e.preventDefault();
      const cfg = {
        token: token.value.trim(),
        owner: owner.value.trim(),
        repo: repo.value.trim(),
        branch: branch.value.trim() || 'main',
      };
      msg.textContent = 'Checking…';
      submit.disabled = true;
      try {
        await checkAccess(cfg);
        setConfig(cfg);
        store.reset();
        store.flushOutbox();
        store.refresh();
        location.hash = '#/';
      } catch (err) {
        msg.textContent = err.message;
      } finally {
        submit.disabled = false;
      }
    },
  },
    tokenRow, ownerRow, repoRow, branchRow, msg,
    h('div', { class: 'row' }, submit, current && h('a', { href: '#/notes' }, 'Cancel')),
  );

  form.focusFirst = () => token.focus();
  return form;
}

export function configView(root) {
  const form = configForm();
  root.replaceChildren(h('main', { class: 'view scroll' }, form));
  if (!getConfig()) form.focusFirst();
}
