/**
 * Blickfang · storage.js
 *
 * Persistenz via localStorage – kein IPC nötig, da Electron
 * localStorage pro Partition isoliert.
 */

const LS_LAYOUT  = 'blickfang:layout';
const LS_CUSTOMS = 'blickfang:customDevices';

/* ── Layout ─────────────────────────────────────────────────── */

/**
 * Speichert den aktuellen Panel-Zustand (Map<id, panel>) in localStorage.
 * Jeder Eintrag enthält Gerätedefinition, Position, Skalierung und aktuelle URL.
 */
export function saveLayout(panelsMap) {
  const data = [];
  for (const [, p] of panelsMap) {
    const wv = p.decoEl?.querySelector('.panel-webview');
    let url = '';
    try { url = (wv && typeof wv.getURL === 'function') ? wv.getURL() : (wv?.getAttribute('src') ?? ''); } catch { /* ignore */ }
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

/**
 * Lädt gespeichertes Layout. Gibt leeres Array bei Fehler oder leerem Speicher zurück.
 */
export function loadLayout() {
  try {
    const raw = localStorage.getItem(LS_LAYOUT);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/* ── Eigene Geräte ───────────────────────────────────────────── */

/**
 * Speichert eine neue eigene Gerätedefinition.
 * Duplikate (per id) werden überschrieben.
 */
export function saveCustomDevice(def) {
  const list = loadCustomDevices();
  const idx  = list.findIndex(d => d.id === def.id);
  if (idx >= 0) list[idx] = def; else list.push(def);
  try { localStorage.setItem(LS_CUSTOMS, JSON.stringify(list)); } catch { /* ignore */ }
}

/**
 * Gibt alle gespeicherten eigenen Gerätedefinitionen zurück.
 */
export function loadCustomDevices() {
  try {
    const raw = localStorage.getItem(LS_CUSTOMS);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/**
 * Löscht das gespeicherte Layout, z.B. beim Schließen aller Panels.
 */
export function clearLayout() {
  try { localStorage.removeItem(LS_LAYOUT); } catch { /* ignore */ }
}
