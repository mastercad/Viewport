export function normalizeUrl(raw) {
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^localhost|^127\.|^\d+\.\d+\.\d+\.\d+/.test(raw)) return 'http://' + raw;
  return 'https://' + raw;
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function toast(msg, type = 'info', ms = 2800) {
  const el = document.createElement('div');
  el.className   = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ms);
}
