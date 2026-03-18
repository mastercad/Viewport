/**
 * Blickfang · app.js  (Renderer-Einstiegspunkt)
 *
 * Importiert alle Fachmodule und verdrahtet IPC-Events,
 * Navigation, Sync, Chips und Tastaturkürzel.
 *
 * Modulstruktur:
 *   constants.js  – PRESETS, Schwellwerte, Konstanten
 *   state.js      – Gemeinsamer Zustand + Geometrie-Hilfen
 *   utils.js      – normalizeUrl, sleep, toast
 *   panels.js     – Panel-Lifecycle, Drag, Resize, Snap,
 *                   Maximize, Arrange, Fokus-Modus
 *   screenshot.js – Screenshot-Capture + Downloads
 *   dialogs.js    – Custom-, Hilfe- und Keys-Dialog
 */
import { state, normalizeWsRect, clampRect, applyDecoRect } from './state.js';
import { FRAME_HEAD_H } from './constants.js';
import { normalizeUrl, toast }        from './utils.js';
import {
  openPreset, positionSnapGuides,
  navigatePanel, navigateAllPanels,
  autoArrange, toggleMaximize, toggleFocus, removePanel, showWorkspace,
  isWvReady, addPanel, registerCustomDevice,
} from './panels.js';
import { wireScreenshot, captureScreenshot } from './screenshot.js';
import { wireAnnotate } from './annotate.js';
import { loadLayout, loadCustomDevices, saveCustomDevice, clearLayout } from './storage.js';
import './dialogs.js';

/* ── DOM-Refs ────────────────────────────────────────────────────────────── */
const urlInput   = document.getElementById('url-input');
const urlForm    = document.getElementById('url-form');
const clearBtn   = document.getElementById('clear-btn');
const syncCb     = document.getElementById('sync-cb');
const arrangeBtn = document.getElementById('arrange-btn');
const desktopWv  = document.getElementById('desktop-wv');
const scaleSlider = document.getElementById('scale-slider');
const scaleLabel  = document.getElementById('scale-label');

let syncEnabled  = true;
let _desktopUrl  = '';     // aktuelle URL der Desktop-View
let _desktopReady = false; // true nach did-finish-load, false beim nächsten did-start-loading
let _suppressPanelSync = false; // gesperrt während Click-Forwarding → verhindert Panel→Desktop Feedback-Loop
let _suppressTimer     = null;
let _isRestoring       = false; // gesperrt während Session-Restore → verhindert ERR_ABORTED durch Doppel-Navigation

/**
 * Navigiert den Desktop-WebView zur Ziel-URL.
 * Ist die Origin identisch (gleiche SPA), wird history.pushState + popstate
 * verwendet damit der SPA-Router direkt navigiert – kein Server-Roundtrip,
 * kein "/"-Flash durch Redirect-Ketten.
 */
function desktopNavigateSmart(url) {
  let sameOrigin = false;
  try {
    sameOrigin = !!_desktopUrl && new URL(_desktopUrl).origin === new URL(url).origin;
  } catch { /* ungültige URL → loadURL */ }

  if (sameOrigin) {
    if (!_desktopReady) {
      // Webview noch nicht bereit – loadURL vermeidet GUEST_VIEW_MANAGER-Fehler
      desktopWv.loadURL(url);
      return;
    }
    const { pathname, search, hash } = new URL(url);
    desktopWv.executeJavaScript(
      `(function(){` +
      `  history.pushState(null,'',${JSON.stringify(pathname + search + hash)});` +
      `  window.dispatchEvent(new PopStateEvent('popstate',{state:null}));` +
      `})()`,
    ).catch(() => desktopWv.loadURL(url));
  } else {
    desktopWv.loadURL(url);
  }
}

/* ═══════════════════════════════════════════════════════════════
   Init
   ═══════════════════════════════════════════════════════════════ */

async function init() {
  state.wsRect = normalizeWsRect(await window.ss.getWorkspace());
  positionSnapGuides();
  wireScreenshot();
  wireAnnotate();
  wireNavigation();
  wireSync();
  wireChips();
  wireScale();
  wireIpcEvents();
  wireShortcuts();
  wireDesktopInteraction();
  wirePresentationHint();
  await restoreSession();
}

/* Eigene Geräte-Chips zur Device-Bar hinzufügen */
function addCustomChip(def) {
  const chips     = document.getElementById('chips');
  const customBtn = document.getElementById('custom-btn');
  // Kein Duplikat einfügen
  if (chips.querySelector(`[data-preset="${CSS.escape(def.id)}"]`)) return;
  const chip = document.createElement('button');
  chip.className    = 'chip';
  chip.dataset.preset = def.id;
  chip.title = `${def.label} – ${def.w}×${def.h}`;
  chip.innerHTML = `<span>${def.label}</span><span class="chip-size">${def.w}×${def.h}</span>`;
  chip.addEventListener('click', () => openPreset(def.id));
  chips.insertBefore(chip, customBtn);
}

/* Gespeichertes Layout + eigene Geräte wiederherstellen */
async function restoreSession() {
  // 1. Eigene Geräte als Chips einblenden (immer)
  const customs = loadCustomDevices();
  for (const def of customs) {
    registerCustomDevice(def);
    addCustomChip(def);
  }
  // 2. Panel-Layout nur wiederherstellen wenn vorhanden und User bestätigt
  const saved = loadLayout();
  if (!saved.length) return;

  const restore = await new Promise(resolve => {
    const id = 'session-restore-' + Date.now();
    const msg = `Letzte Session wiederherstellen? (${saved.length} Panel${saved.length !== 1 ? 's' : ''})`;
    // Kleines Banner oben einblenden
    const banner = document.createElement('div');
    banner.id = id;
    banner.style.cssText = [
      'position:fixed','top:12px','left:50%','transform:translateX(-50%)',
      'z-index:99999','background:#1e2030','color:#e0e4ff',
      'border:1px solid rgba(255,255,255,.12)','border-radius:10px',
      'padding:10px 16px','display:flex','align-items:center','gap:12px',
      'font-size:13px','font-weight:500','box-shadow:0 8px 32px rgba(0,0,0,.45)',
      'white-space:nowrap'
    ].join(';');
    banner.innerHTML = `
      <span>${msg}</span>
      <button id="${id}-yes" style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:4px 14px;font-size:12.5px;font-weight:700;cursor:pointer;">Ja</button>
      <button id="${id}-no"  style="background:rgba(255,255,255,.1);color:#e0e4ff;border:none;border-radius:6px;padding:4px 14px;font-size:12.5px;font-weight:600;cursor:pointer;">Nein</button>
    `;
    document.body.appendChild(banner);
    const cleanup = val => { banner.remove(); resolve(val); };
    document.getElementById(`${id}-yes`).addEventListener('click', () => cleanup(true));
    document.getElementById(`${id}-no`).addEventListener('click',  () => cleanup(false));
    // Automatisch nach 8 s wiederherstellen
    setTimeout(() => { if (document.getElementById(id)) cleanup(true); }, 8000);
  });

  if (!restore) { clearLayout(); return; }

  _isRestoring = true;
  try {
    for (const entry of saved) {
      const def = { id: entry.id, label: entry.label, w: entry.w, h: entry.h, frame: entry.frame ?? undefined };
      await addPanel(def, { rect: entry.rect, scale: entry.scale, url: entry.url || '' });
    }
  } finally {
    _isRestoring = false;
  }
}

/* Neues eigenes Gerät: aus dialogs.js via CustomEvent registrieren */
window.addEventListener('ss:custom-device-added', e => {
  const def = e.detail;
  registerCustomDevice(def);
  saveCustomDevice(def);
  addCustomChip(def);
});

function wirePresentationHint() {
  // Klick auf das Exit-Banner beendet den Präsentationsmodus
  document.getElementById('presentation-hint')
    ?.addEventListener('click', () => togglePresentation(false));

  // Exit-Hinweis oben einblenden wenn Maus in obere 60px des Bildschirms fährt
  let _hintTimer = null;
  document.addEventListener('mousemove', e => {
    if (!_presentationMode) return;
    const nearTop = e.clientY < 60;
    document.body.classList.toggle('show-exit-hint', nearTop);
    clearTimeout(_hintTimer);
    if (nearTop) {
      _hintTimer = setTimeout(() => {
        document.body.classList.remove('show-exit-hint');
      }, 2500);
    }
  });
}

/* ── Navigation ──────────────────────────────────────────────────────────── */

function wireNavigation() {
  urlForm.addEventListener('submit', e => {
    e.preventDefault();
    const raw = urlInput.value.trim();
    if (!raw) return;
    // Keine Punkte, kein Protokoll, kein Slash → sieht nicht wie eine URL aus → Navigation blockieren
    if (!raw.includes('.') && !raw.includes(':') && !raw.includes('/') &&
        !/^localhost$/i.test(raw)) {
      toast(`„${raw}" sieht nicht wie eine Webadresse aus – bitte z.B. ${raw}.de oder ${raw}.com eingeben`, 'warning', 5000);
      return;
    }
    const url = normalizeUrl(raw);
    urlInput.value = url;
    updateClearBtn();
    desktopNavigateSmart(url);
    showWorkspace();
    // Mit Sync: Panels folgen dem Desktop über did-navigate-in-page
    // (SPA-Router feuert popstate → did-navigate-in-page → navigateAllPanels)
    // Ohne Sync nur das aktive Panel direkt navigieren.
    if (!syncEnabled && state.topId) {
      navigatePanel(state.topId, url);
    }
  });

  urlInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { urlInput.value = ''; updateClearBtn(); urlInput.blur(); }
  });
  urlInput.addEventListener('input', updateClearBtn);

  clearBtn.addEventListener('click', () => {
    urlInput.value = '';
    updateClearBtn();
    urlInput.focus();
  });
}

function updateClearBtn() {
  clearBtn.hidden = urlInput.value.length === 0;
}

/* ── Sync ────────────────────────────────────────────────────────────────── */

function wireSync() {
  if (!syncCb) return;
  syncCb.addEventListener('change', () => {
    syncEnabled = syncCb.checked;
    toast(
      syncEnabled
        ? 'Sync aktiv – alle Ansichten navigieren gemeinsam'
        : 'Sync deaktiviert – Ansichten unabhängig',
      'info', 1800,
    );
  });
  arrangeBtn.addEventListener('click', autoArrange);
}

/* ── Panel-Skalierung ─────────────────────────────────────────────────────── */

function wireScale() {
  if (!scaleSlider) return;
  // Initiale CSS-Variable für die Slider-Füllung
  scaleSlider.style.setProperty('--pct', scaleSlider.value);
  scaleSlider.addEventListener('input', () => {
    scaleSlider.style.setProperty('--pct', scaleSlider.value);
    applyPanelScale(Number(scaleSlider.value) / 100);
  });

  const snapCb = document.getElementById('snap-cb');
  if (snapCb) {
    snapCb.addEventListener('change', () => { state.snapEnabled = snapCb.checked; });
  }
}

/**
 * Skaliert alle offenen Panels proportional.
 * Die rect-Koordinaten der Panels (logische Größe bei Scale=1) bleiben
 * unverändert. CSS-Transform + ZoomFactor der WebContentsViews passen sich an,
 * sodass die Seiten weiterhin ihre volle Gerät-Auflösung sehen.
 */
function applyPanelScale(newScale) {
  state.panelScale = Math.max(0.1, Math.min(1, newScale));
  const pct = Math.round(state.panelScale * 100);
  if (scaleLabel) scaleLabel.textContent = pct + '%';

  // Per-Panel-Scale aktualisieren + Titlebar-Anzeige sync
  for (const p of state.panels.values()) {
    p.scale = state.panelScale;
    const pscVal = p.decoEl.querySelector('.psc-val');
    if (pscVal) pscVal.textContent = pct + '%';
    applyDecoRect(p);
  }
}

/* ── Chips ─────────────────────────────────────────────────────────────────── */

function wireChips() {
  for (const chip of document.querySelectorAll('.chip[data-preset]')) {
    chip.addEventListener('click', () => openPreset(chip.dataset.preset));
  }
}

/* ── IPC-Events ─────────────────────────────────────────────────────────── */

function wireIpcEvents() {
  let _navTimer = null;  // Debounce-Timer: Panel-Sync erst nach Ende der Redirect-Kette

  // Panel-Navigation (Custom-Event aus panels.js) → URL-Bar aktualisieren
  // und Desktop mitführen, damit andere Panels über did-navigate folgen können.
  window.addEventListener('ss:navigated', ({ detail: { id, url } }) => {
    if (!url || url === 'about:blank') return;
    urlInput.value = url;
    updateClearBtn();
    if (syncEnabled && url !== _desktopUrl && !_suppressPanelSync && !_isRestoring) {
      desktopNavigateSmart(url);
    }
  });

  // Desktop: abgeschlossene Navigation (inkl. Server-Redirects)
  // URL-Bar sofort aktualisieren; Panel-Sync erst nach 400 ms Ruhe (Redirect-Kette abwarten)
  desktopWv.addEventListener('did-navigate', e => {
    const url = e.url;
    if (!url || url === 'about:blank') return;
    _desktopUrl = url;
    urlInput.value = url;
    updateClearBtn();
    clearTimeout(_navTimer);
    if (syncEnabled && !_isRestoring) {
      _navTimer = setTimeout(() => navigateAllPanels(_desktopUrl), 400);
    }
  });

  // Desktop: Ladefehler (DNS, TLS, Timeout, …) → Toast mit verständlicher Meldung
  desktopWv.addEventListener('did-fail-load', e => {
    // errorCode -3 = Abbruch durch Benutzer (back/forward/Reload) – kein Toast
    // errorCode -301/-302 = Redirect – kein Toast
    if (!e.isMainFrame) return;
    if (e.errorCode === -3 || e.errorCode === 0) return;
    const friendly = {
      '-105': 'Die URL konnte nicht gefunden werden – bitte Domain prüfen.',
      '-106': 'Kein Internetzugang.',
      '-102': 'Verbindung abgebrochen.',
      '-103': 'Verbindung abgelehnt.',
      '-118': 'Verbindungszeitüberschreitung.',
      '-200': 'TLS/SSL-Fehler – Zertifikat ungültig.',
    };
    const msg = friendly[String(e.errorCode)]
      ?? `Ladefehler (${e.errorCode}): ${e.errorDescription}`;
    toast(`⚠ ${msg}`, 'error', 6000);
  });

  // Desktop: SPA-/History-Navigation (pushState / replaceState / Hash)
  // Das ist die finale URL – sofort synchen und Debounce-Timer abbrechen
  desktopWv.addEventListener('did-navigate-in-page', e => {
    if (!e.isMainFrame) return;
    const url = e.url;
    if (!url || url === 'about:blank') return;
    clearTimeout(_navTimer);
    _navTimer = null;
    _desktopUrl = url;
    urlInput.value = url;
    updateClearBtn();
    if (syncEnabled) navigateAllPanels(url);
  });

  // Popup / window.open → alle Ansichten auf neue URL navigieren
  desktopWv.addEventListener('new-window', e => {
    const url = e.url;
    if (!url || url === 'about:blank') return;
    urlInput.value = url; updateClearBtn();
    desktopWv.loadURL(url); showWorkspace();
    if (syncEnabled) navigateAllPanels(url);
  });
  window.addEventListener('ss:popup', ({ detail: { url } }) => {
    if (!url || url === 'about:blank') return;
    urlInput.value = url; updateClearBtn();
    desktopWv.loadURL(url); showWorkspace();
    if (syncEnabled) navigateAllPanels(url);
  });

  window.ss.onWindowResize(async () => {
    state.wsRect = normalizeWsRect(await window.ss.getWorkspace());
    positionSnapGuides();
    for (const [, panel] of state.panels) {
      const c = clampRect(panel.rect, panel.scale);
      if (c.x !== panel.rect.x || c.y !== panel.rect.y) {
        panel.rect = c;
        applyDecoRect(panel);
      }
    }
  });

  window.ss.onToggleSync(() => {
    if (syncCb) { syncCb.checked = !syncCb.checked; syncCb.dispatchEvent(new Event('change')); }
  });

  window.ss.onScreenshot  (()  => captureScreenshot());
  window.ss.onMaximize    (id  => toggleMaximize(id));
  window.ss.onFocusToggle (id  => toggleFocus(id));
}

/* ── Interaktions-Sync (Klicks/Scroll im Desktop-WebView → alle Panels) ─────
 *
 * Klicks: Nach jedem Seitenlade-Event wird ein Listener per executeJavaScript
 * in den Desktop-Webview injiziert. Er baut einen stabilen CSS-Selector für
 * das geklickte Element und meldet ihn per console.log (Prefix __SS_CLICK__:)
 * an den Host-Renderer. Der Host ruft dann in jedem Panel-Webview
 * element.click() auf den selektierten Element auf – dadurch öffnen sich
 * Modals, Menüs und Dropdowns korrekt, weil echte JS-Click-Handler ausgelöst
 * werden (kein Koordinaten-Mapping das bei überlagernden Elementen versagt).
 *
 * Scroll-Events werden über sendInputEvent weitergeleitet (ohne Koordinaten-
 * Problem, da wir immer in die Mitte des Viewports scrollen).
 * ─────────────────────────────────────────────────────────────────────────── */

/** Selector-Builder + Scroll-Injection im Desktop-Webview-Kontext. */
const _CLICK_INJECT = `(function(){
  if(window.__ssCF)return;
  window.__ssCF=true;
  var _log=Function.prototype.bind.call(console.log,console);
  var _ITAGS=new Set(['button','a','input','select','textarea','label','summary']);
  var _IROLES=new Set(['button','link','menuitem','menuitemcheckbox','menuitemradio','tab','option','checkbox','radio','switch']);
  function interactive(el){
    for(var cur=el;cur&&cur!==document.body;cur=cur.parentElement){
      if(_ITAGS.has(cur.tagName.toLowerCase()))return cur;
      var r=cur.getAttribute('role');if(r&&_IROLES.has(r))return cur;
      if(cur.getAttribute('onclick')!=null)return cur;
    }
    return el;
  }
  function sel(el){
    if(!el||el===document.body)return'body';
    if(el.id)return'#'+CSS.escape(el.id);
    var al=el.getAttribute('aria-label');
    if(al)return el.tagName.toLowerCase()+'[aria-label='+JSON.stringify(al)+']';
    var dt=el.getAttribute('data-testid')||el.getAttribute('data-id');
    if(dt)return el.tagName.toLowerCase()+'[data-testid='+JSON.stringify(dt)+']';
    var path=[];
    for(var cur=el,i=0;i<8&&cur&&cur!==document.body;cur=cur.parentElement,i++){
      var s=cur.tagName.toLowerCase();
      if(cur.id){path.unshift('#'+CSS.escape(cur.id));break;}
      var al2=cur.getAttribute('aria-label');
      if(al2){path.unshift(s+'[aria-label='+JSON.stringify(al2)+']');break;}
      var dt2=cur.getAttribute('data-testid')||cur.getAttribute('data-id');
      if(dt2){path.unshift(s+'[data-testid='+JSON.stringify(dt2)+']');break;}
      var sibs=cur.parentElement?[...cur.parentElement.children]:[];
      var same=sibs.filter(function(x){return x.tagName===cur.tagName;});
      if(same.length>1)s+=':nth-of-type('+(same.indexOf(cur)+1)+')';
      path.unshift(s);
    }
    return path.join('>');
  }
  _log('__SS_READY__');
  document.addEventListener('click',function(e){
    try{_log('__SS_CLICK__:'+sel(interactive(e.target)));}catch(_){}
  },true);
  var _ssRaf=null;
  window.addEventListener('scroll',function(){
    if(_ssRaf)return;
    _ssRaf=requestAnimationFrame(function(){
      _ssRaf=null;
      _log('__SS_SCROLL__:'+Math.round(window.scrollX)+'|'+Math.round(window.scrollY));
    });
  },{passive:true,capture:true});
})();`;

function wireDesktopInteraction() {
  // Readiness des Desktop-Webviews tracken
  desktopWv.addEventListener('did-start-loading', () => { _desktopReady = false; });

  // Klick-Listener nach jedem Seitenlade-Event neu injizieren (SPA ersetzt DOM)
  function injectClickForwarder() {
    _desktopReady = true;
    desktopWv.executeJavaScript(_CLICK_INJECT).catch(() => {});
  }
  desktopWv.addEventListener('did-finish-load',    injectClickForwarder);
  desktopWv.addEventListener('did-navigate-in-page', injectClickForwarder);

  // console-message vom Desktop-Webview empfangen und an Panels weiterleiten
  desktopWv.addEventListener('console-message', e => {
    const msg = e.message ?? '';
    if (msg.startsWith('__SS_')) console.log('[SS-sync]', msg.slice(0, 120));

    if (!syncEnabled) return;
    if (state.panels.size === 0) return;

    if (msg.startsWith('__SS_CLICK__:')) {
      const selector = msg.slice('__SS_CLICK__:'.length);
      if (!selector) return;
      // Panel-Navigation die durch diesen Click ausgelöst wird, darf den Desktop
      // nicht mitziehen (Feedback-Loop: Panel navigiert → ss:navigated → Desktop
      // verlässt aktuelle Seite und offene Dropdowns/Modals schließen sich).
      _suppressPanelSync = true;
      clearTimeout(_suppressTimer);
      _suppressTimer = setTimeout(() => { _suppressPanelSync = false; }, 2000);
      const js = `(function(){var el=document.querySelector(${JSON.stringify(selector)});if(el)el.click();})();`;
      for (const [, { decoEl }] of state.panels) {
        const wv = decoEl.querySelector('.panel-webview');
        // Kein isWvReady-Guard – wie beim Scroll; executeJavaScript wirft sonst
        // stumm wenn das Panel kurz lädt (Fehler wird ohnehin gecatcht).
        if (wv) wv.executeJavaScript(js).catch(() => {});
      }

    } else if (msg.startsWith('__SS_SCROLL__:')) {
      const parts = msg.slice('__SS_SCROLL__:'.length).split('|');
      const sx = parseInt(parts[0], 10) || 0;
      const sy = parseInt(parts[1], 10) || 0;
      const js = `window.scrollTo(${sx},${sy});`;
      for (const [, { decoEl }] of state.panels) {
        const wv = decoEl.querySelector('.panel-webview');
        // scrollTo ist eine sichere Operation – kein isWvReady-Guard nötig
        if (wv) wv.executeJavaScript(js).catch(() => {});
      }
    }
  });
}

/* ── Tastaturkürzel ──────────────────────────────────────────────────────── */

/* ── Präsentationsmodus ──────────────────────────────────────────────────── */
let _presentationMode = false;

function togglePresentation(force) {
  _presentationMode = (force !== undefined) ? !!force : !_presentationMode;
  document.body.classList.toggle('presentation', _presentationMode);
  window.ss.setFullScreen(_presentationMode);
  const presentBtn = document.getElementById('present-btn');
  if (presentBtn) presentBtn.classList.toggle('active', _presentationMode);
  if (_presentationMode) {
    // Fokus aus dem URL-Feld nehmen, damit Escape sauber greift
    document.activeElement?.blur();
    toast('Präsentationsmodus – Esc oder F11 zum Beenden', 'info', 2800);
  }
}

function wireShortcuts() {
  document.getElementById('present-btn')?.addEventListener('click', () => togglePresentation());

  // OS-Vollbild-änderung (auch via F11-globalShortcut in main.js) → UI synchronisieren
  // OHNE setFullScreen erneut aufzurufen (würde Endlosschleife erzeugen)
  window.ss.onFullScreenChange(flag => {
    if (flag === _presentationMode) return;  // bereits korrekt
    _presentationMode = flag;
    document.body.classList.toggle('presentation', flag);
    const presentBtn = document.getElementById('present-btn');
    if (presentBtn) presentBtn.classList.toggle('active', flag);
    if (flag) document.activeElement?.blur();
  });

  document.addEventListener('keydown', e => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'F11')                     { e.preventDefault(); togglePresentation(); }
    if (e.key === 'Escape' && _presentationMode) { e.preventDefault(); togglePresentation(false); }
    if (ctrl && e.shiftKey && e.key === 'A') { e.preventDefault(); autoArrange(); }
    if (ctrl && e.key === 'p')               { e.preventDefault(); captureScreenshot(); }
    if (ctrl && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      if (syncCb) { syncCb.checked = !syncCb.checked; syncCb.dispatchEvent(new Event('change')); }
    }
    // Desktop-Webview-Inhalt zoomen (Ctrl+= Ctrl+-  Ctrl+0)
    if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); adjustDesktopZoom(+0.1); }
    if (ctrl && e.key === '-')                     { e.preventDefault(); adjustDesktopZoom(-0.1); }
    if (ctrl && e.key === '0')                     { e.preventDefault(); adjustDesktopZoom(0, true); }
  });
}

/* ── Desktop-Zoom ──────────────────────────────────────────────────────── */
let _desktopZoom = 1.0;

function adjustDesktopZoom(delta, reset = false) {
  _desktopZoom = reset ? 1.0 : Math.max(0.25, Math.min(3, _desktopZoom + delta));
  desktopWv.setZoomFactor(_desktopZoom);
  const badge = document.getElementById('zoom-badge');
  const pct   = Math.round(_desktopZoom * 100);
  if (badge) {
    badge.textContent = pct + '%';
    badge.style.fontWeight = pct === 100 ? '' : '800';
    badge.style.color = pct === 100 ? '' : 'var(--accent)';
  }
  if (reset && pct !== 100) toast('Zoom zurückgesetzt', 'info', 1400);
  else if (reset) { /* already at 100% */ }
}

// Zoom-Steuerung verdrahten
document.getElementById('zoom-badge')?.addEventListener('click', () => adjustDesktopZoom(0, true));
document.getElementById('zoom-out')  ?.addEventListener('click', () => adjustDesktopZoom(-0.1));
document.getElementById('zoom-in')   ?.addEventListener('click', () => adjustDesktopZoom(+0.1));

init();
