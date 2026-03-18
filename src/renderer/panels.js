import { PRESETS, SNAP_THRESH, FRAME_HEAD_H, MIN_W, MIN_H } from './constants.js';
import { state, clampRect, applyDecoRect }                  from './state.js';
import { toast }                                              from './utils.js';
import { saveLayout }                                         from './storage.js';

/* ── Laufzeitregister für eigene Geräte ───────────────────────── */
const _customRegistry = new Map(); // id → def

/** Registriert ein eigenes Gerät, damit openPreset() es öffnen kann. */
export function registerCustomDevice(def) { _customRegistry.set(def.id, def); }

/* ── Panel-ID-Zähler (kein Main-Prozess mehr nötig) ────────────────────── */
let _panelCounter = 0;

/* ── User-Agent (realer Browser, kein Electron) ───────────────────────── */
const PANEL_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36';

/* ── DOM-Refs ─────────────────────────────────────────────────────────────── */
const workspace = document.getElementById('workspace');
const welcome   = document.getElementById('welcome');
const toolbar   = document.getElementById('toolbar');
const viewCount = document.getElementById('view-count');

/* ── Snap-Guide DOM-Refs ──────────────────────────────────────────────────── */
const sgL  = document.getElementById('sg-l');
const sgCv = document.getElementById('sg-cv');
const sgR  = document.getElementById('sg-r');
const sgT  = document.getElementById('sg-t');
const sgCh = document.getElementById('sg-ch');
const sgB  = document.getElementById('sg-b');

/* Panel-Stapelreihenfolge: Index 0 = hinterster, letzter = vorderster */
let _stackOrder = [];

/* Webviews die gerade vollständig geladen sind (did-finish-load gefeuert, kein did-start-loading danach) */
const _wvReady = new WeakSet();
export function isWvReady(wv) { return _wvReady.has(wv); }

/* ══════════════════════════════════════════════════════════════════════════
   Snap-Guides
   ══════════════════════════════════════════════════════════════════════════ */

export function positionSnapGuides() {
  const { wsRect } = state;
  const oL = wsRect.x, oT = wsRect.y;
  sgL.style.left  = oL + 'px';
  sgCv.style.left = Math.round(oL + wsRect.w / 2) + 'px';
  sgR.style.left  = (oL + wsRect.w - 1) + 'px';
  sgT.style.top   = oT + 'px';
  sgCh.style.top  = Math.round(oT + wsRect.h / 2) + 'px';
  sgB.style.top   = (oT + wsRect.h - 1) + 'px';
}

function computeSnap(movId, x, y, w, h, scale) {
  if (!state.snapEnabled) return { x, y, guideX: new Set(), guideY: new Set() };
  const { wsRect } = state;
  const T = SNAP_THRESH, WW = wsRect.w, WH = wsRect.h;
  const s  = scale ?? state.panelScale;
  const vw = w * s, vh = h * s;
  let sx = x, sy = y;
  const gX = new Set(), gY = new Set();

  // Nur Workspace-Kanten und -Mitte einrasten, kein Panel-zu-Panel-Snap
  const xC = [
    { v: 0,              e: 'left'   },
    { v: WW / 2 - vw / 2, e: 'center' },
    { v: WW - vw,        e: 'right'  },
  ];
  const yC = [
    { v: 0,              e: 'top'    },
    { v: WH / 2 - vh / 2, e: 'center' },
    { v: WH - vh,        e: 'bottom' },
  ];

  let dX = T;
  for (const c of xC) { const d = Math.abs(x - c.v); if (d < dX) { dX = d; sx = c.v; gX.add(c.e); } }
  let dY = T;
  for (const c of yC) { const d = Math.abs(y - c.v); if (d < dY) { dY = d; sy = c.v; gY.add(c.e); } }

  return { x: sx, y: sy, guideX: gX, guideY: gY };
}

function renderSnapGuides(gX, gY) {
  sgL.classList.toggle('show',  gX.has('left'));
  sgCv.classList.toggle('show', gX.has('center') || gX.has('panel'));
  sgR.classList.toggle('show',  gX.has('right'));
  sgT.classList.toggle('show',  gY.has('top'));
  sgCh.classList.toggle('show', gY.has('center') || gY.has('panel'));
  sgB.classList.toggle('show',  gY.has('bottom'));
}

function clearSnapGuides() {
  [sgL, sgCv, sgR, sgT, sgCh, sgB].forEach(e => e.classList.remove('show'));
}

/* ══════════════════════════════════════════════════════════════════════════
   Panel-Verwaltung
   ══════════════════════════════════════════════════════════════════════════ */

export async function addPanel(def, opts = {}) {
  const rect  = opts.rect  ?? calcInitialRect(def);
  const scale = opts.scale ?? state.panelScale;
  const id    = String(++_panelCounter);
  const url   = opts.url   ?? document.getElementById('url-input').value.trim();
  const decoEl = createDecoEl(id, def, scale);
  state.panels.set(id, { def, rect, scale, decoEl });
  workspace.appendChild(decoEl);
  applyDecoRect({ rect, decoEl, scale });
  bringToFront(id);
  // src-Attribut setzen → Electron navigiert nach DOM-Insertion ohne Race-Condition
  if (url) {
    const wv = decoEl.querySelector('.panel-webview');
    if (wv) wv.setAttribute('src', url);
  }
  updateChips();
  showWorkspace();
  saveLayout(state.panels);
}

export function removePanel(id) {
  const p = state.panels.get(id);
  if (!p) return;
  maybeExitFocusOnRemove(id);
  // Hover-Listener aufräumen
  if (p.decoEl._hudMoveHandler) {
    document.removeEventListener('mousemove', p.decoEl._hudMoveHandler);
  }
  // Webview-Readiness-Tracking aufräumen
  const wv = p.decoEl.querySelector('.panel-webview');
  if (wv) _wvReady.delete(wv);
  p.decoEl.remove();
  state.panels.delete(id);
  if (state.topId === id)
    state.topId = state.panels.size ? [...state.panels.keys()].at(-1) : null;
  _stackOrder = _stackOrder.filter(i => i !== id);
  _stackOrder.forEach((pid, idx) => {
    const panel = state.panels.get(pid);
    if (panel) panel.decoEl.style.zIndex = 10 + idx;
  });
  updateChips();
  saveLayout(state.panels);
}

export function openPreset(presetId) {
  for (const [id, p] of state.panels) {
    if (p.def.id === presetId) { removePanel(id); return; }
  }
  if (PRESETS[presetId])            { addPanel(PRESETS[presetId]); return; }
  if (_customRegistry.has(presetId)) { addPanel(_customRegistry.get(presetId)); }
}

function calcInitialRect(def) {
  const { wsRect, panels } = state;
  const fw = (def.frame?.l ?? 0) + (def.frame?.r ?? 0);
  const fh = (def.frame?.t ?? 0) + (def.frame?.b ?? 0);
  const w  = Math.min(def.w + fw, wsRect.w - 40);
  const h  = Math.min(def.h + FRAME_HEAD_H + fh, wsRect.h - 40);
  const STEP  = FRAME_HEAD_H + 6;
  const maxSt = Math.max(1, Math.floor((wsRect.h - h - 20) / STEP));
  const step  = panels.size % maxSt;
  const col   = Math.floor(panels.size / maxSt);
  const colW  = Math.min(200, Math.floor(wsRect.w / 5));
  return {
    x: Math.min(col * colW + step * 4 + 16, wsRect.w - w - 16),
    y: Math.min(step * STEP + 16,            wsRect.h - h - 16),
    w, h,
  };
}

export function bringToFront(id) {
  _stackOrder = _stackOrder.filter(i => i !== id);
  _stackOrder.push(id);
  state.topId = id;
  // CSS z-index: webview + rahmen bewegen sich gemeinsam im gleichen Stack
  _stackOrder.forEach((pid, idx) => {
    const p = state.panels.get(pid);
    if (p) p.decoEl.style.zIndex = 10 + idx;
  });
}

export function updateChips() {
  const active = new Set([...state.panels.values()].map(p => p.def.id));
  for (const chip of document.querySelectorAll('.chip[data-preset]')) {
    chip.classList.toggle('active', active.has(chip.dataset.preset));
  }
  const n = state.panels.size;
  viewCount.textContent = n === 0 ? '0 Ansichten' : `${n} Ansicht${n !== 1 ? 'en' : ''}`;
}

export function showWorkspace() {
  welcome.classList.add('hidden');
  toolbar.classList.remove('hidden');
}

export function showWelcome() {
  welcome.classList.remove('hidden');
  toolbar.classList.add('hidden');
}

/* ══════════════════════════════════════════════════════════════════════════
   Maximieren
   ══════════════════════════════════════════════════════════════════════════ */
const _prevMaxRect = new Map();

export function toggleMaximize(id) {
  const p = state.panels.get(id);
  if (!p) return;
  if (_prevMaxRect.has(id)) {
    p.rect = _prevMaxRect.get(id);
    _prevMaxRect.delete(id);
  } else {
    _prevMaxRect.set(id, { ...p.rect });
    const { wsRect } = state;
    const cW    = p.rect.w;
    const cH    = p.rect.h - FRAME_HEAD_H;
    const scale = Math.min(
      (wsRect.w - 20)              / cW,
      (wsRect.h - FRAME_HEAD_H - 20) / cH,
    );
    const newW = Math.round(cW * scale);
    const newH = Math.round(cH * scale) + FRAME_HEAD_H;
    p.rect = {
      x: Math.round((wsRect.w - newW) / 2),
      y: Math.max(0, Math.round((wsRect.h - newH) / 2)),
      w: newW,
      h: newH,
    };
  }
  applyDecoRect(p);
}

/* ══════════════════════════════════════════════════════════════════════════
   Auto-Arrange
   ══════════════════════════════════════════════════════════════════════════ */

export function autoArrange() {
  if (state.panels.size === 0) return;
  const PAD = 14;
  // Höchste Panels zuerst → Zeilenumbruch funktioniert optisch besser
  const entries = [...state.panels.entries()].sort(([, a], [, b]) => b.rect.h - a.rect.h);
  let x = PAD, y = PAD, rowH = 0;
  for (const [id, p] of entries) {
    if (x > PAD && x + p.rect.w > state.wsRect.w - PAD) {
      x = PAD; y += rowH + PAD; rowH = 0;
    }
    p.rect = { x, y, w: p.rect.w, h: p.rect.h };
    applyDecoRect(p);
    x += p.rect.w + PAD;
    rowH = Math.max(rowH, p.rect.h);
  }
  toast('Panels angeordnet', 'info');
}

/* ══════════════════════════════════════════════════════════════════════════
   Fokus-Modus
   ══════════════════════════════════════════════════════════════════════════ */
let focusedId = null;

export function toggleFocus(id) {
  if (focusedId === id) {
    focusedId = null;
    workspace.classList.remove('focus-mode');
    for (const [, p] of state.panels) p.decoEl.classList.remove('focused');
    toast('Fokus-Modus beendet', 'info', 1500);
  } else {
    focusedId = id;
    workspace.classList.add('focus-mode');
    for (const [pid, p] of state.panels) {
      p.decoEl.classList.toggle('focused', pid === id);
    }
    bringToFront(id);
    toast('Fokus-Modus aktiv', 'info', 2500);
  }
}

export function maybeExitFocusOnRemove(id) {
  if (focusedId !== id) return;
  focusedId = null;
  workspace.classList.remove('focus-mode');
}

/* ══════════════════════════════════════════════════════════════════════════
   Drag
   ══════════════════════════════════════════════════════════════════════════ */
let drag = null;

function startDrag(e, id) {
  e.preventDefault();
  bringToFront(id);
  // ALLE webviews (auch Desktop-WV!) deaktivieren, damit sie keine Mouse-Events stehlen
  document.querySelectorAll('webview').forEach(wv => { wv.style.pointerEvents = 'none'; });
  const p = state.panels.get(id);
  p.decoEl.classList.add('dragging');
  const { rect } = p;
  drag = { id, mx: e.clientX, my: e.clientY, ox: rect.x, oy: rect.y, w: rect.w, h: rect.h, scale: p.scale ?? state.panelScale, raf: null };
  document.addEventListener('mousemove',    onDragMove);
  document.addEventListener('mouseup',      onDragEnd);
  document.addEventListener('pointerup',    onDragEnd);
  document.addEventListener('pointercancel',onDragEnd);
  document.addEventListener('keydown',      onDragKey);
  window.addEventListener('blur',           onDragEnd);
}

function onDragMove(e) {
  if (!drag) return;
  // rAF-Throttle: unabhängig von Maus-Polling-Rate (125– 1000 Hz) max 1×/Frame
  drag._ex = e.clientX; drag._ey = e.clientY;
  if (drag.raf) return;
  drag.raf = requestAnimationFrame(() => {
    drag.raf = null;
    if (!drag) return;
    const p = state.panels.get(drag.id);
    if (!p) return;
    let nx = drag.ox + (drag._ex - drag.mx);
    let ny = drag.oy + (drag._ey - drag.my);
    ({ x: nx, y: ny } = clampRect({ x: nx, y: ny, w: drag.w, h: drag.h }, drag.scale));
    // Live-Snap: Panel magnetisiert zu Kanten/Mitte, Guides werden sofort angezeigt
    if (state.snapEnabled) {
      const sn = computeSnap(drag.id, nx, ny, drag.w, drag.h, drag.scale);
      nx = sn.x; ny = sn.y;
      renderSnapGuides(sn.guideX, sn.guideY);
    }
    p.rect = { x: nx, y: ny, w: drag.w, h: drag.h };
    const s = drag.scale;
    p.decoEl.style.transform = s < 1
      ? `translate(${nx - drag.ox}px, ${ny - drag.oy}px) scale(${s})`
      : `translate(${nx - drag.ox}px, ${ny - drag.oy}px)`;
  });
}

function onDragEnd() {
  if (!drag) return;
  const id = drag.id;
  if (drag.raf) { cancelAnimationFrame(drag.raf); }
  drag = null;
  clearSnapGuides();
  document.removeEventListener('mousemove',    onDragMove);
  document.removeEventListener('mouseup',      onDragEnd);
  document.removeEventListener('pointerup',    onDragEnd);
  document.removeEventListener('pointercancel',onDragEnd);
  document.removeEventListener('keydown',      onDragKey);
  window.removeEventListener('blur',           onDragEnd);
  const pp = state.panels.get(id);
  if (pp) {
    pp.decoEl.classList.remove('dragging');
    if (state.snapEnabled) {
      const pScale = pp.scale ?? state.panelScale;
      const sn = computeSnap(id, pp.rect.x, pp.rect.y, pp.rect.w, pp.rect.h, pScale);
      pp.rect = clampRect({ x: sn.x, y: sn.y, w: pp.rect.w, h: pp.rect.h }, pScale);
      renderSnapGuides(sn.guideX, sn.guideY);
      setTimeout(clearSnapGuides, 600);
    }
  }
  // Endposition schreiben, transform zurücksetzen; webviews wieder aktiv
  for (const p of state.panels.values()) applyDecoRect(p);
  document.querySelectorAll('webview').forEach(wv => { wv.style.pointerEvents = ''; });
  saveLayout(state.panels);
}

function onDragKey(e) {
  if (e.key === 'Escape') onDragEnd();
}

/* ══════════════════════════════════════════════════════════════════════════
   Resize
   ══════════════════════════════════════════════════════════════════════════ */
let rsz = null;

function startResize(e, id) {
  e.preventDefault(); e.stopPropagation();
  bringToFront(id);
  document.querySelectorAll('webview').forEach(wv => { wv.style.pointerEvents = 'none'; });
  const p = state.panels.get(id);
  const { rect } = p;
  rsz = { id, mx: e.clientX, my: e.clientY, sw: rect.w, sh: rect.h, x: rect.x, y: rect.y, scale: p.scale ?? state.panelScale, raf: null };
  document.addEventListener('mousemove',    onResizeMove);
  document.addEventListener('mouseup',      onResizeEnd);
  document.addEventListener('pointerup',    onResizeEnd);
  document.addEventListener('pointercancel',onResizeEnd);
  document.addEventListener('keydown',      onResizeKey);
  window.addEventListener('blur',           onResizeEnd);
}

function onResizeMove(e) {
  if (!rsz) return;
  rsz._ex = e.clientX; rsz._ey = e.clientY;
  if (rsz.raf) return;
  rsz.raf = requestAnimationFrame(() => {
    rsz.raf = null;
    if (!rsz) return;
    const p = state.panels.get(rsz.id);
    if (!p) return;
    const s = rsz.scale;
    const { wsRect } = state;
    const w = Math.min(Math.max(MIN_W, rsz.sw + (rsz._ex - rsz.mx)), (wsRect.w - rsz.x) / s);
    const h = Math.min(Math.max(MIN_H, rsz.sh + (rsz._ey - rsz.my)), (wsRect.h - rsz.y) / s);
    p.rect = { x: rsz.x, y: rsz.y, w, h };
    applyDecoRect(p);
  });
}

function onResizeEnd() {
  if (!rsz) return;
  if (rsz.raf) { cancelAnimationFrame(rsz.raf); }
  rsz = null;
  document.removeEventListener('mousemove',    onResizeMove);
  document.removeEventListener('mouseup',      onResizeEnd);
  document.removeEventListener('pointerup',    onResizeEnd);
  document.removeEventListener('pointercancel',onResizeEnd);
  document.removeEventListener('keydown',      onResizeKey);
  window.removeEventListener('blur',           onResizeEnd);
  document.querySelectorAll('webview').forEach(wv => { wv.style.pointerEvents = ''; });
  saveLayout(state.panels);
}

function onResizeKey(e) {
  if (e.key === 'Escape') onResizeEnd();
}

const _pendingBounds = new Map();

/**
 * Navigiert ein Webview-Element zur Ziel-URL.
 *
 * Wenn das Webview bereits auf derselben Origin geladen ist, wird
 * client-seitiges Routing per history.pushState + popstate verwendet –
 * dadurch entfällt der Server-Roundtrip und die SPA navigiert direkt
 * ohne den "/"-Flash durch Redirect-Ketten.
 *
 * Nur bei unterschiedlicher Origin oder noch nicht geladenem Webview
 * wird loadURL (vollständiger Seitenaufruf) verwendet.
 */
function navigateWv(wv, url) {
  if (!wv) return;

  let currentOrigin = null;
  let targetOrigin  = null;
  try {
    const cur = typeof wv.getURL === 'function' ? wv.getURL() : '';
    if (cur && cur !== 'about:blank') currentOrigin = new URL(cur).origin;
    targetOrigin = new URL(url).origin;
  } catch { /* ungültige URL → loadURL verwenden */ }

  if (currentOrigin && currentOrigin === targetOrigin) {
    // Gleiche Origin → SPA-Router direkt ansprechen, kein Server-Redirect, kein Flash
    const { pathname, search, hash } = new URL(url);
    const path = pathname + search + hash;
    // Aktuellen Pfad prüfen – nicht navigieren wenn bereits dort
    try {
      if (currentOrigin && new URL(typeof wv.getURL === 'function' ? wv.getURL() : '').pathname + new URL(typeof wv.getURL === 'function' ? wv.getURL() : '').search === pathname + search) return;
    } catch { /* ignorieren */ }
    if (!_wvReady.has(wv)) {
      // Webview lädt noch → loadURL statt executeJavaScript (kein GUEST_VIEW_MANAGER Fehler)
      if (typeof wv.loadURL === 'function') {
        wv.loadURL(url).catch(() => wv.setAttribute('src', url));
      } else {
        wv.setAttribute('src', url);
      }
      return;
    }
    wv.executeJavaScript(
      `(function(){` +
      `  history.pushState(null,'',${JSON.stringify(path)});` +
      `  window.dispatchEvent(new PopStateEvent('popstate',{state:null}));` +
      `})()`,
    ).catch(() => {
      // Falls executeJavaScript schlägt fehl (z.B. webview noch nicht bereit): loadURL
      if (typeof wv.loadURL === 'function') {
        wv.loadURL(url).catch(() => wv.setAttribute('src', url));
      } else {
        wv.setAttribute('src', url);
      }
    });
  } else {
    // Andere Origin oder noch nicht geladen → vollständiger Seitenaufruf
    if (typeof wv.loadURL === 'function') {
      wv.loadURL(url).catch(() => wv.setAttribute('src', url));
    } else {
      wv.setAttribute('src', url);
    }
  }
}

/* Navigiere ein Panel per webview (für app.js aufrufbar). */
export function navigatePanel(id, url) {
  const p = state.panels.get(id);
  if (!p) return;
  navigateWv(p.decoEl.querySelector('.panel-webview'), url);
}

export function navigateAllPanels(url) {
  for (const p of state.panels.values()) {
    navigateWv(p.decoEl.querySelector('.panel-webview'), url);
  }
}

/* Screenshot eines Panels über das webview-Element. */
export async function screenshotPanel(id) {
  const p = state.panels.get(id);
  if (!p) return null;
  const wv = p.decoEl.querySelector('.panel-webview');
  if (!wv) return null;
  try {
    const img  = await wv.capturePage();
    const size = img.getSize();
    return { id, label: p.def.label, w: p.def.w, h: p.def.h,
             png: img.toDataURL().split(',')[1], visW: size.width, visH: size.height };
  } catch { return null; }
}

export async function screenshotAllPanels() {
  const results = [];
  for (const [id] of state.panels) {
    const r = await screenshotPanel(id);
    if (r) results.push(r);
  }
  return results;
}

/* ══════════════════════════════════════════════════════════════════════════
   Dekoration
   ══════════════════════════════════════════════════════════════════════════ */

/** Für eigene Panels: Frame-Stil anhand der Dimensionen ermitteln. */
function detectFrameDevice(def) {
  if (!def.id.startsWith('custom-')) return def.id;
  const { w, h } = def;
  const portrait = h >= w;
  if (portrait && Math.min(w, h) <= 500) return 'android';
  if (portrait && Math.min(w, h) <= 900) return 'tablet';
  if (w >= 900) return 'laptop';
  return 'desktop';
}

function createDecoEl(id, def, scale = state.panelScale) {
  const el = document.createElement('div');
  el.className      = 'panel-deco';
  el.dataset.id     = id;
  // Preset: def.id ("iphone", "laptop" …); Custom: erkannter Frame-Stil
  el.dataset.device = detectFrameDevice(def);
  // Für eigene Panels mit erkanntem Frame: Rahmenmaße aus dem Stil-Preset ableiten
  let { frame } = def;
  if (def.id.startsWith('custom-') && !frame) {
    const framePresets = {
      android: { t: 32, r: 12, b: 26, l: 12 },
      tablet:  { t: 24, r: 16, b: 20, l: 16 },
      laptop:  { t: 18, r: 10, b: 46, l: 10 },
    };
    frame = framePresets[el.dataset.device];
  }
  // Frame-CSS-Variablen für alle Seiten
  const fl = frame?.l ?? 0, fr = frame?.r ?? 0;
  const ft = frame?.t ?? 0, fb = frame?.b ?? 0;
  el.style.setProperty('--ft', ft + 'px');
  el.style.setProperty('--fb', fb + 'px');
  el.style.setProperty('--fl', fl + 'px');
  el.style.setProperty('--fr', fr + 'px');
  el.innerHTML  = `
    <div class="panel-titlebar"><span class="panel-titlelabel">${def.label ?? def.id}</span></div>
    <div class="panel-device-top">
      <span class="device-island"></span>
      <span class="device-camera"></span>
    </div>
    <div class="panel-hud">
      <span class="hud-label" title="Doppelklick zum Umbenennen">${def.label ?? def.id}</span>
      <div class="hud-sep"></div>
      <button class="hud-btn" data-hud="reload" title="Neu laden">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 7A5.5 5.5 0 1 0 3.2 3.2M1.5 1v2.5H4"/></svg>
      </button>
      <button class="hud-btn" data-hud="scale-" title="Verkleinern">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2.5" y1="7" x2="11.5" y2="7"/></svg>
      </button>
      <button class="hud-btn" data-hud="scale+" title="Vergrößern">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="7" y1="2.5" x2="7" y2="11.5"/><line x1="2.5" y1="7" x2="11.5" y2="7"/></svg>
      </button>
      <div class="hud-sep"></div>
      <button class="hud-btn hud-close" data-hud="close" title="Schließen">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2.5" y1="2.5" x2="11.5" y2="11.5"/><line x1="11.5" y1="2.5" x2="2.5" y2="11.5"/></svg>
      </button>
    </div>
    <div class="panel-viewport">
      <div class="panel-loading hidden"><div class="spinner"></div></div>
      <webview class="panel-webview"
        partition="persist:desktop"
        allowpopups
      ></webview>
    </div>
    <div class="panel-device-bot">
      <span class="device-home"></span>
    </div>
    <div class="panel-resize">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M9 1L1 9M9 5L5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </div>`;

  // Navigation-Events: dom-Events für app.js weiterleiten
  const wv = el.querySelector('.panel-webview');
  wv.addEventListener('did-navigate', e => {
    window.dispatchEvent(new CustomEvent('ss:navigated', { detail: { id, url: e.url } }));
  });
  wv.addEventListener('did-navigate-in-page', e => {
    if (e.isMainFrame)
      window.dispatchEvent(new CustomEvent('ss:navigated', { detail: { id, url: e.url } }));
  });
  wv.addEventListener('new-window', e => {
    window.dispatchEvent(new CustomEvent('ss:popup', { detail: { url: e.url } }));
  });

  // ── Lade-Spinner ─────────────────────────────────────────────────────────
  const loadingEl = el.querySelector('.panel-loading');
  let _spinnerTimer = null;
  const showSpinner = () => {
    clearTimeout(_spinnerTimer);
    loadingEl.classList.remove('hidden');
    // Fallback: Spinner nie länger als 20 s anzeigen
    _spinnerTimer = setTimeout(() => loadingEl.classList.add('hidden'), 20_000);
  };
  const hideSpinner = () => {
    clearTimeout(_spinnerTimer);
    loadingEl.classList.add('hidden');
  };

  wv.addEventListener('did-start-loading', () => { _wvReady.delete(wv); showSpinner(); });
  wv.addEventListener('did-stop-loading',  () => { _wvReady.add(wv);    hideSpinner(); });
  wv.addEventListener('did-finish-load',   () => {
    wv.insertCSS('::-webkit-scrollbar{display:none!important}*{scrollbar-width:none!important}').catch(() => {});
  });
  wv.addEventListener('did-fail-load', e => { if (e.isMainFrame) hideSpinner(); });

  // ── Doppelklick auf Titelleiste → Bezeichnung umbenennen ─────────────────
  const hudLabel    = el.querySelector('.hud-label');
  const titleLabel  = el.querySelector('.panel-titlelabel');
  titleLabel.addEventListener('dblclick', e => {
    e.preventDefault(); e.stopPropagation();
    const p = state.panels.get(id);
    if (titleLabel._renaming) return;
    titleLabel._renaming = true;
    const prevText = titleLabel.textContent;
    const inp = document.createElement('input');
    inp.className = 'panel-titlelabel-edit';
    inp.value     = p?.def.label ?? def.label;
    inp.maxLength = 28;
    titleLabel.textContent = '';
    titleLabel.appendChild(inp);
    inp.focus(); inp.select();
    const save = () => {
      const newLabel = inp.value.trim() || prevText;
      def.label = newLabel;
      if (p) p.def.label = newLabel;
      titleLabel.textContent = newLabel;
      titleLabel._renaming = false;
      if (hudLabel) hudLabel.textContent = newLabel;
      saveLayout(state.panels);
    };
    inp.addEventListener('blur', save);
    inp.addEventListener('keydown', ke => {
      if (ke.key === 'Enter')  { ke.preventDefault(); save(); }
      if (ke.key === 'Escape') { titleLabel.textContent = prevText; titleLabel._renaming = false; }
      ke.stopPropagation();
    });
  });

  el.querySelector('.panel-titlebar').addEventListener('mousedown', e => {
    if (e.detail >= 2) return; // Doppelklick nicht in Drag umwandeln
    startDrag(e, id);
  });
  el.querySelector('.panel-resize').addEventListener('mousedown', e => startResize(e, id));
  el.addEventListener('mousedown', () => bringToFront(id));

  // ── Hover-HUD: Buttons verdrahten ─────────────────────────────────────
  el.querySelector('.panel-hud').addEventListener('click', e => {
    const btn = e.target.closest('[data-hud]');
    if (!btn) return;
    e.stopPropagation();
    const p = state.panels.get(id);
    switch (btn.dataset.hud) {
      case 'reload': {
        const wv = el.querySelector('.panel-webview');
        if (wv) wv.reload();
        break;
      }
      case 'scale-': {
        if (p) {
          p.scale = Math.max(0.15, (p.scale ?? state.panelScale) - 0.1);
          applyDecoRect(p);
          saveLayout(state.panels);
        }
        break;
      }
      case 'scale+': {
        if (p) {
          p.scale = Math.min(2.0, (p.scale ?? state.panelScale) + 0.1);
          applyDecoRect(p);
          saveLayout(state.panels);
        }
        break;
      }
      case 'close': removePanel(id); break;
    }
  });

  // ── Hover-Tracking für HUD-Sichtbarkeit ───────────────────────────────
  const _hudMove = e => {
    const r = el.getBoundingClientRect();
    el.classList.toggle('hud-visible',
      e.clientX >= r.left && e.clientX <= r.right &&
      e.clientY >= r.top  && e.clientY <= r.bottom,
    );
  };
  document.addEventListener('mousemove', _hudMove);
  el._hudMoveHandler = _hudMove;

  return el;
}
