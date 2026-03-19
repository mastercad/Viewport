'use strict';

const wv          = document.getElementById('wv');
const cloneOverlay= document.getElementById('clone-overlay');
const cloneImg    = document.getElementById('clone-img');
const labelEl     = document.getElementById('panel-label');
const sizeEl      = document.getElementById('panel-size');
const dotClose    = document.getElementById('dot-close');
const dotMax      = document.getElementById('dot-max');
const dotFocus    = document.getElementById('dot-focus');

let cfg          = null;
let wvDomReady   = false;
let vpUrlApplied = false;  // Guard: Viewport+URL nur einmal konfigurieren

function getCfg() {
  return window.panelCfg || window.__PANEL_CFG__ || null;
}

function setup(c) {
  cfg = c;
  labelEl.textContent = cfg.def.label;
  sizeEl.textContent  = `${cfg.def.w}\u202F\xD7\u202F${cfg.def.h}`;
  applyViewportAndUrl();
}

// Konfiguriert Device-Emulation und lädt die initiale URL.
// Wartet per await auf enableDeviceEmulation (invoke) BEVOR wv.src gesetzt wird –
// verhindert ERR_ABORTED durch Race Condition mit GUEST_VIEW_MANAGER.
async function applyViewportAndUrl() {
  if (!cfg || !wvDomReady || vpUrlApplied) return;
  vpUrlApplied = true;
  const wvId = wv.getWebContentsId();
  await window.panelApi.setViewport(wvId, cfg.def.w, cfg.def.h);
  if (cfg.url) loadUrl(cfg.url);
}

// Direkt verfügbar oder auf executeJavaScript-Injektion warten
const initial = getCfg();
if (initial) {
  setup(initial);
} else {
  const iv = setInterval(() => {
    const c = getCfg();
    if (c) { clearInterval(iv); setup(c); }
  }, 20);
}

wv.addEventListener('dom-ready', () => {
  wvDomReady = true;
  applyViewportAndUrl();
});

let navFailed  = false;
let isLoading  = false;
let isSyncNav  = false;
let pendingNav = null;   // aufgeschobene Navigation: { url, sync }

wv.addEventListener('did-start-loading', () => { navFailed = false; isLoading = true; });
wv.addEventListener('did-fail-load',     () => { navFailed = true; });
wv.addEventListener('did-stop-loading',  () => {
  isLoading = false;
  const wasSync = isSyncNav;
  isSyncNav = false;

  // Aufgeschobene Navigation jetzt anwenden (kein Abbruch mehr möglich).
  // loadUrl() aufrufen – nicht direkt wv.src – damit der SPA-Pfad greift.
  if (pendingNav) {
    const nav = pendingNav;
    pendingNav = null;
    loadUrl(nav.url, nav.sync);
    return;
  }

  if (!cfg || navFailed) { navFailed = false; return; }
  if (wasSync) return; // Sync-Navigation nicht zurückmelden → kein Loop
  const url = wv.getURL();
  if (url && url !== 'about:blank') window.panelApi.navigated(cfg.id, url);
});
// In-Page-Navigation (Hash / pushState): nur bei nutzerausgelöster Navigation melden.
// isSyncNav hier zurücksetzen – did-stop-loading feuert bei SPA-Navigation nicht.
wv.addEventListener('did-navigate-in-page', e => {
  if (!e.isMainFrame || !cfg) return;
  if (isSyncNav) { isSyncNav = false; return; }
  window.panelApi.navigated(cfg.id, e.url);
});

// isSync=true → Navigation kommt vom Sync-System, nicht vom Nutzer.
function loadUrl(url, isSync = false) {
  if (!url || url === 'about:blank') return;
  const current = wv.getURL();
  if (current === url && !isLoading) return;

  // Sync + gleicher Origin + nicht am Laden →
  // SPA-Navigation via history.pushState + popstate-Event.
  // React Router, Vue Router, Angular Router, Next.js etc. hören alle auf
  // popstate und reagieren ohne vollen Seitenaufruf → kein /-Flash.
  if (isSync && !isLoading && current && current !== 'about:blank') {
    try {
      if (new URL(current).origin === new URL(url).origin) {
        isSyncNav = true;
        wv.executeJavaScript(
          `(function(u){` +
            `history.pushState({}, '', u);` +
            `window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));` +
          `})(${JSON.stringify(url)})`
        ).catch(() => { isSyncNav = true; wv.src = url; }); // Fallback
        return;
      }
    } catch (e) { /* nicht-parsierbare URL → normales Laden */ }
  }

  if (isLoading) { pendingNav = { url, sync: isSync }; return; }
  isSyncNav = isSync;
  wv.src = url;
}

dotClose.addEventListener( 'click', () => { if (cfg) window.panelApi.close(cfg.id); });
dotMax.addEventListener(   'click', () => { if (cfg) window.panelApi.toggleMaximize(cfg.id); });
dotFocus.addEventListener( 'click', () => { if (cfg) window.panelApi.toggleFocus(cfg.id); });

window.panelApi.onCommand((cmd, data) => {
  switch (cmd) {
    case 'navigate':
      loadUrl(data.url, true); // Sync-ausgelöst → nicht zurückmelden
      break;

    case 'focusMode':
      document.body.classList.toggle('focus-mode', !!data.active);
      break;
  }
});

document.getElementById('resize-handle').addEventListener('mousedown', e => {
  e.preventDefault();
  if (cfg) window.panelApi.startResize(cfg.id, { x: e.screenX, y: e.screenY });
});
