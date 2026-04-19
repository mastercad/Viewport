const LS_LAYOUT      = 'blickfang:layout';
const LS_CUSTOMS     = 'blickfang:customDevices';
const LS_TEMPLATES   = 'blickfang:templates';
const LS_SS_SETTINGS = 'blickfang:ssSettings';

/** @typedef {{ mode: 'single'|'workspace'|'combined', withFrame: boolean, withLabels: boolean }} ScreenshotSettings */
/** @type {ScreenshotSettings} */
export const SS_SETTINGS_DEFAULT = { mode: 'single', withFrame: true, withLabels: true };

/* ── Built-in Templates (nicht löschbar) ─────────────────────── */
export const BUILTIN_TEMPLATES = [
  { id: '__desktop_mobile__', name: 'Desktop + Mobil',     presets: ['laptop', 'iphone'] },
  { id: '__responsive__',     name: 'Responsive Trio',      presets: ['laptop', 'tablet', 'iphone'] },
  { id: '__all__',            name: 'Alle Standardgeräte', presets: ['laptop', 'tablet', 'iphone', 'android'] },
  { id: '__mobile__',         name: 'Nur Mobil',            presets: ['iphone', 'android'] },
];


export function saveLayout(panelsMap) {
  const data = [];
  for (const [, p] of panelsMap) {
    const wv = p.decoEl?.querySelector('.panel-webview');
    let url = '';
    try {
      url = (wv && typeof wv.getURL === 'function') ? wv.getURL() : '';
      if (!url || url === 'about:blank') url = wv?.getAttribute('src') ?? '';
    } catch { /* ignore */ }
    if (url === 'about:blank') url = '';
    data.push({
      id:    p.def.id,
      label: p.def.label,
      w:     p.def.w,
      h:     p.def.h,
      frame: p.def.frame ?? null,
      rect:  { ...p.rect },
      scale: p.scale,
      url,
    });
  }
  try { localStorage.setItem(LS_LAYOUT, JSON.stringify(data)); } catch { /* storage full */ }
}

export function loadLayout() {
  try {
    const raw = localStorage.getItem(LS_LAYOUT);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}


export function saveCustomDevice(def) {
  const list = loadCustomDevices();
  const idx  = list.findIndex(d => d.id === def.id);
  if (idx >= 0) list[idx] = def; else list.push(def);
  try { localStorage.setItem(LS_CUSTOMS, JSON.stringify(list)); } catch { /* ignore */ }
}

export function loadCustomDevices() {
  try {
    const raw = localStorage.getItem(LS_CUSTOMS);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function deleteCustomDevice(id) {
  const list = loadCustomDevices().filter(d => d.id !== id);
  try { localStorage.setItem(LS_CUSTOMS, JSON.stringify(list)); } catch { /* ignore */ }
}

export function clearLayout() {
  try { localStorage.removeItem(LS_LAYOUT); } catch { /* ignore */ }
}


export function loadTemplates() {
  try {
    const raw = localStorage.getItem(LS_TEMPLATES);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveTemplate(tpl) {
  const list = loadTemplates();
  const idx  = list.findIndex(t => t.id === tpl.id);
  if (idx >= 0) list[idx] = tpl; else list.push(tpl);
  try { localStorage.setItem(LS_TEMPLATES, JSON.stringify(list)); } catch { /* ignore */ }
}

export function deleteTemplate(id) {
  const list = loadTemplates().filter(t => t.id !== id);
  try { localStorage.setItem(LS_TEMPLATES, JSON.stringify(list)); } catch { /* ignore */ }
}

/* ── Screenshot-Einstellungen ────────────────────────────────── */

/** @param {ScreenshotSettings} s */
export function saveScreenshotSettings(s) {
  try { localStorage.setItem(LS_SS_SETTINGS, JSON.stringify(s)); } catch { /* ignore */ }
}

/** @returns {ScreenshotSettings} */
export function loadScreenshotSettings() {
  try {
    const raw = localStorage.getItem(LS_SS_SETTINGS);
    if (!raw) return { ...SS_SETTINGS_DEFAULT };
    const parsed = JSON.parse(raw);
    return {
      mode:       ['single', 'workspace', 'combined'].includes(parsed.mode) ? parsed.mode : SS_SETTINGS_DEFAULT.mode,
      withFrame:  typeof parsed.withFrame  === 'boolean' ? parsed.withFrame  : SS_SETTINGS_DEFAULT.withFrame,
      withLabels: typeof parsed.withLabels === 'boolean' ? parsed.withLabels : SS_SETTINGS_DEFAULT.withLabels,
    };
  } catch { return { ...SS_SETTINGS_DEFAULT }; }
}
