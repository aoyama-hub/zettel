// Tiny DOM helpers. Note content is only ever inserted as text, never as HTML.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && !k.includes('-')) el[k] = v; // properties take false too (spellcheck: false)
    else if (v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

/** Replace [start, end) of a textarea, keeping the native undo stack where supported. Fires input. */
export function insertText(ta, start, end, text) {
  ta.focus();
  ta.setSelectionRange(start, end);
  if (!document.execCommand('insertText', false, text)) {
    ta.setRangeText(text, start, end, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/** Keep focus where it is when a button is tapped (so the phone keyboard stays up). */
export const keepFocus = (e) => e.preventDefault();

let toastTimer;
export function toast(message) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = h('div', { class: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/** A button that needs a second tap within a few seconds to fire. */
export function confirmButton(label, confirmLabel, onConfirm, props = {}) {
  let armed = false;
  let timer;
  const btn = h('button', {
    type: 'button',
    ...props,
    onClick: () => {
      if (!armed) {
        armed = true;
        btn.textContent = confirmLabel;
        btn.classList.add('armed');
        timer = setTimeout(disarm, 4000);
        return;
      }
      disarm();
      onConfirm();
    },
  }, label);
  function disarm() {
    clearTimeout(timer);
    armed = false;
    btn.textContent = label;
    btn.classList.remove('armed');
  }
  return btn;
}

export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
