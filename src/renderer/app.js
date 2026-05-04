import { state, normalizeWsRect, clampRect, applyDecoRect } from './state.js';
import { normalizeUrl, toast }        from './utils.js';
import {
  openPreset, positionSnapGuides,
  navigatePanel, navigateAllPanels,
  autoArrange, toggleMaximize, toggleFocus, removePanel, showWorkspace,
  addPanel, registerCustomDevice,
} from './panels.js';
import { wireScreenshot, captureScreenshot } from './screenshot.js';
import { wireEditor } from './editor/index.js';
import { loadLayout, saveLayout, loadCustomDevices, saveCustomDevice, deleteCustomDevice, clearLayout,
  BUILTIN_TEMPLATES, loadTemplates, saveTemplate, deleteTemplate } from './storage.js';
import { openKeysDlg } from './dialogs.js';

/* ── DOM-Refs ── */
const urlInput   = document.getElementById('url-input');
const urlForm    = document.getElementById('url-form');
const clearBtn   = document.getElementById('clear-btn');
const syncCb     = document.getElementById('sync-cb');
const arrangeBtn = document.getElementById('arrange-btn');
const desktopWv  = document.getElementById('desktop-wv');
const scaleSlider = document.getElementById('scale-slider');
const scaleLabel  = document.getElementById('scale-label');

let syncEnabled  = true;
let _desktopUrl   = '';
let _desktopReady = false; // true nach did-finish-load, false beim nächsten did-start-loading
let _suppressPanelSync = false; // verhindert Panel→Desktop-Feedback-Loop beim Click-Forwarding
let _suppressTimer     = null;
let _isRestoring       = false; // gesperrt während Session-Restore – verhindert ERR_ABORTED durch Doppel-Navigation

function desktopNavigateSmart(url) {
  let sameOrigin = false;
  try {
    sameOrigin = !!_desktopUrl && new URL(_desktopUrl).origin === new URL(url).origin;
  } catch { /* ungültige URL → loadURL */ }

  if (sameOrigin) {
    if (!_desktopReady) {
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

/**
 * Bildet ein Panel-Rect von einem Workspace auf einen anderen ab und
 * erhält dabei die relative Position innerhalb des freien Bewegungsraums.
 * Beispiel: Panel klebt am rechten Rand  → bleibt am rechten Rand.
 *           Panel ist zentriert           → bleibt zentriert.
 * Funktioniert korrekt weil Panels eine feste visuelle Größe haben.
 */
function remapPanelRect(rect, scale, oldWs, newWs) {
  const s   = scale ?? state.panelScale;
  const vw  = rect.w * s;
  const vh  = rect.h * s;
  // freier Raum (wie weit darf das Panel maximal verschoben werden?)
  const freeOldW = Math.max(1, oldWs.w - vw);
  const freeOldH = Math.max(1, oldWs.h - vh);
  const freeNewW = Math.max(0, newWs.w - vw);
  const freeNewH = Math.max(0, newWs.h - vh);
  // relative Position 0..1 (0=links/oben, 1=rechts/unten)
  const relX = Math.max(0, Math.min(1, rect.x / freeOldW));
  const relY = Math.max(0, Math.min(1, rect.y / freeOldH));
  // Nearest-Edge-Anker: Panels in der rechten Hälfte behalten den absoluten
  // Abstand zur rechten Kante (Gap exakt erhalten, kein kumulativer Drift).
  // Panels in der linken Hälfte behalten den absoluten Abstand zur linken Kante.
  // Rund-Trip-stabil: rightGap = freeOldW - rect.x bleibt exakt erhalten.
  const newX = relX >= 0.5
    ? Math.max(0, freeNewW - (freeOldW - rect.x))
    : Math.min(freeNewW, rect.x);
  const newY = relY >= 0.5
    ? Math.max(0, freeNewH - (freeOldH - rect.y))
    : Math.min(freeNewH, rect.y);
  return { ...rect, x: Math.round(newX), y: Math.round(newY) };
}

/**
 * Liest die tatsächlich gerenderte Größe des #workspace-Elements via getBoundingClientRect.
 * Kein Parameter, kein Flag, keine hartkodierte Konstante.
 * Reagiert sofort auf CSS-Änderungen (z.B. body.presentation entfernt top/bottom-Offsets)
 * weil getBoundingClientRect() einen synchronen Layout-Flush auslöst.
 */
function computeWsRectFromDOM() {
  const wsEl = document.getElementById('workspace');
  const r = wsEl.getBoundingClientRect();
  return { x: 0, y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
}

/** Remappt alle Panels von oldWs auf state.wsRect und speichert das Layout. */
function remapAllPanels(oldWs) {
  if (!oldWs || oldWs.w <= 0 || oldWs.h <= 0 || state.panels.size === 0) return;
  if (oldWs.w === state.wsRect.w && oldWs.h === state.wsRect.h) return; // No-op bei unveränderter Größe
  for (const [, panel] of state.panels) {
    panel.rect = remapPanelRect(panel.rect, panel.scale ?? state.panelScale, oldWs, state.wsRect);
    applyDecoRect(panel);
  }
  saveLayout(state.panels, state.wsRect);
}

/**
 * Zentraler Workspace-Resize-Handler, der ALLE Größenänderungen abdeckt:
 * manuelles Resize, Maximize, Taskleisten-Restore, Vollbild.
 * Wird als ResizeObserver auf #workspace registriert – feuert exakt nach dem
 * Layout-Commit des Browsers mit den korrekten Maßen.
 */
function wireWorkspaceResizeObserver() {
  const wsEl = document.getElementById('workspace');
  let _rafId  = null;
  const obs   = new ResizeObserver(() => {
    if (_isRestoring) return; // Kein Remap während Session-Restore
    if (_rafId) return;       // Throttle: max 1× pro Frame
    _rafId = requestAnimationFrame(() => {
      _rafId = null;
      const oldRect  = { ...state.wsRect };
      state.wsRect   = computeWsRectFromDOM();
      positionSnapGuides();
      remapAllPanels(oldRect);
    });
  });
  obs.observe(wsEl);
}

async function init() {
  state.wsRect = computeWsRectFromDOM();
  positionSnapGuides();
  // Startup-Hinweis wenn Google-API-Key fehlt (Push-Notifications funktionieren dann nicht).
  window.ss.keysLoad().then(k => {
    if (!k.apiKey) toast('⚠ Push-Notifications: kein Google-API-Key konfiguriert – bitte 🔑 öffnen.', 'info', 9000);
  }).catch(() => {});
  wireScreenshot();
  wireEditor();
  wireNavigation();
  wireSync();
  wireChips();
  wireTemplates();
  wireScale();
  wireIpcEvents();
  wireShortcuts();
  wireDesktopInteraction();
  wirePresentationHint();
  wireWorkspaceResizeObserver();
  await restoreSession();
}

/* Eigene Geräte-Chips zur Device-Bar hinzufügen */
function addCustomChip(def) {
  const chips     = document.getElementById('chips');
  const customBtn = document.getElementById('custom-btn');
  if (chips.querySelector(`[data-preset="${CSS.escape(def.id)}"]`)) return;

  const wrap = document.createElement('div');
  wrap.className = 'chip-wrap';

  const chip = document.createElement('button');
  chip.className    = 'chip';
  chip.dataset.preset = def.id;
  chip.title = `${def.label} – ${def.w}×${def.h}`;
  chip.innerHTML = `<span>${def.label}</span><span class="chip-size">${def.w}×${def.h}</span>`;
  chip.addEventListener('click', () => openPreset(def.id));

  const delBtn = document.createElement('button');
  delBtn.className = 'chip-del';
  delBtn.title = `„${def.label}“ aus der Liste entfernen`;
  delBtn.setAttribute('aria-label', `${def.label} entfernen`);
  delBtn.textContent = '✕';
  delBtn.addEventListener('click', () => {
    for (const [id, p] of state.panels) {
      if (p.def.id === def.id) { removePanel(id); break; }
    }
    deleteCustomDevice(def.id);
    wrap.remove();
  });

  wrap.appendChild(chip);
  wrap.appendChild(delBtn);
  chips.insertBefore(wrap, customBtn);
}

async function restoreSession() {
  const customs = loadCustomDevices();
  for (const def of customs) {
    registerCustomDevice(def);
    addCustomChip(def);
  }
  const { ws: savedWs, panels: saved } = loadLayout();
  if (!saved.length) return;

  const restore = await new Promise(resolve => {
    const id = 'session-restore-' + Date.now();
    const msg = `Letzte Session wiederherstellen? (${saved.length} Panel${saved.length !== 1 ? 's' : ''})`;
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
    setTimeout(() => { if (document.getElementById(id)) cleanup(true); }, 8000); // auto-restore nach 8 s
  });

  if (!restore) { clearLayout(); return; }

  _isRestoring = true;
  try {
    for (const entry of saved) {
      const def = { id: entry.id, label: entry.label, w: entry.w, h: entry.h, frame: entry.frame ?? undefined };
      const rect = savedWs
        ? remapPanelRect(entry.rect, entry.scale ?? state.panelScale, savedWs, state.wsRect)
        : entry.rect;
      await addPanel(def, { rect, scale: entry.scale, url: entry.url || '', skipSave: true });
    }
  } finally {
    _isRestoring = false;
    saveLayout(state.panels, state.wsRect);
  }

  if (saved.length && scaleSlider) {
    const firstScale = Math.max(0.1, Math.min(1, saved[0].scale ?? 1));
    state.panelScale = firstScale;
    const pct = Math.round(firstScale * 100);
    const sliderVal = Math.max(Number(scaleSlider.min), Math.min(Number(scaleSlider.max), pct));
    scaleSlider.value = sliderVal;
    scaleSlider.style.setProperty('--pct', sliderVal);
    if (scaleLabel) scaleLabel.textContent = pct + '%';
  }
}

window.addEventListener('ss:custom-device-added', e => {
  const def = e.detail;
  registerCustomDevice(def);
  saveCustomDevice(def);
  addCustomChip(def);
});

function wirePresentationHint() {
  document.getElementById('presentation-hint')
    ?.addEventListener('click', () => togglePresentation(false));

  // mouseenter auf dem Trigger-Strip ist zuverlässiger als mousemove auf document,
  // weil Webviews eigene Maus-Events schlucken
  document.getElementById('hint-trigger')
    ?.addEventListener('mouseenter', () => {
      if (!_presentationMode) return;
      document.body.classList.remove('hint-hidden');
      clearTimeout(_hintHideTimer);
      _hintHideTimer = setTimeout(() => document.body.classList.add('hint-hidden'), 3000);
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
    // Panels direkt navigieren – nicht auf Desktop-did-navigate warten,
    // da der Desktop-Webview beim ersten Start noch nicht initialisiert sein kann.
    if (state.panels.size > 0) {
      // Unterdrücke Panel→Desktop Feedback-Loop während Panels laden
      _suppressPanelSync = true;
      clearTimeout(_suppressTimer);
      _suppressTimer = setTimeout(() => { _suppressPanelSync = false; }, 3000);
      navigateAllPanels(url);
    } else if (!syncEnabled && state.topId) {
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

function wireScale() {
  if (!scaleSlider) return;
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

function applyPanelScale(newScale) {
  state.panelScale = Math.max(0.1, Math.min(1, newScale));
  const pct = Math.round(state.panelScale * 100);
  if (scaleLabel) scaleLabel.textContent = pct + '%';

  for (const p of state.panels.values()) {
    p.scale = state.panelScale;
    const pscVal = p.decoEl.querySelector('.psc-val');
    if (pscVal) pscVal.textContent = pct + '%';
    applyDecoRect(p);
  }
}

function wireChips() {
  for (const chip of document.querySelectorAll('.chip[data-preset]')) {
    chip.addEventListener('click', () => openPreset(chip.dataset.preset));
  }

  const viewsBtn = document.getElementById('views-btn');
  const viewsDd  = document.getElementById('views-dropdown');
  if (!viewsBtn || !viewsDd) return;

  function positionDropdown() {
    const br = viewsBtn.getBoundingClientRect();
    viewsDd.style.top  = (br.bottom + 8) + 'px';
    viewsDd.style.left = br.left + 'px';
  }

  viewsBtn.addEventListener('click', () => {
    const nowOpen = viewsDd.hidden;
    if (nowOpen) positionDropdown();
    viewsDd.hidden = !nowOpen;
    viewsBtn.setAttribute('aria-expanded', String(nowOpen));
  });

  document.addEventListener('click', e => {
    if (!viewsDd.hidden &&
        !viewsBtn.contains(e.target) &&
        !viewsDd.contains(e.target)) {
      viewsDd.hidden = true;
      viewsBtn.setAttribute('aria-expanded', 'false');
    }
  }, true);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !viewsDd.hidden) {
      viewsDd.hidden = true;
      viewsBtn.setAttribute('aria-expanded', 'false');
      viewsBtn.focus();
    }
  });
}

function wireTemplates() {
  const sel      = document.getElementById('template-select');
  const loadBtn  = document.getElementById('template-load-btn');
  const saveBtn  = document.getElementById('template-save-btn');
  const delBtn   = document.getElementById('template-del-btn');
  if (!sel) return;

  function rebuildOptions() {
    sel.length = 1;
    for (const t of BUILTIN_TEMPLATES) {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.name;
      o.dataset.builtin = '1';
      sel.appendChild(o);
    }
    const sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = '───────────────';
    sel.appendChild(sep);
    for (const t of loadTemplates()) {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.name;
      sel.appendChild(o);
    }
  }

  rebuildOptions();

  sel.addEventListener('change', () => {
    const v = sel.value;
    loadBtn.disabled = !v;
    const opt = sel.options[sel.selectedIndex];
    delBtn.disabled = !v || !!opt?.dataset.builtin; // nur eigene Templates löschbar
  });

  loadBtn.addEventListener('click', async () => {
    const v = sel.value;
    if (!v) return;
    const all = [...BUILTIN_TEMPLATES, ...loadTemplates()];
    const tpl = all.find(t => t.id === v);
    if (!tpl) return;

    for (const [id] of [...state.panels]) removePanel(id);
    await new Promise(r => setTimeout(r, 80)); // kurz warten damit DOM aufgeräumt ist
    for (const presetId of tpl.presets) openPreset(presetId);
    toast(`Template »${tpl.name}« geladen.`);
  });

  saveBtn.addEventListener('click', () => {
    if (state.panels.size === 0) { toast('Keine Ansichten geöffnet.'); return; }
    const presets = [...state.panels.values()].map(p => p.def.id);
    const defaultName = presets.map(id => id.charAt(0).toUpperCase() + id.slice(1)).join(' + ');
    const name = window.prompt('Template-Name:', defaultName);
    if (!name?.trim()) return;
    const tpl = { id: `tpl_${Date.now()}`, name: name.trim(), presets };
    saveTemplate(tpl);
    rebuildOptions();
    sel.value = tpl.id;
    sel.dispatchEvent(new Event('change'));
    toast(`Template »${tpl.name}« gespeichert.`);
  });

  delBtn.addEventListener('click', () => {
    const v = sel.value;
    if (!v) return;
    const name = sel.options[sel.selectedIndex]?.textContent ?? v;
    if (!window.confirm(`Template »${name}« löschen?`)) return;
    deleteTemplate(v);
    rebuildOptions();
    sel.value = '';
    sel.dispatchEvent(new Event('change'));
    toast(`Template gelöscht.`);
  });
}
function wireIpcEvents() {
  let _navTimer = null; // Debounce: Panel-Sync erst nach Ende der Redirect-Kette
  window.addEventListener('ss:navigated', ({ detail: { url } }) => {
    if (!url || url === 'about:blank') return;
    urlInput.value = url;
    updateClearBtn();
    if (syncEnabled && url !== _desktopUrl && !_suppressPanelSync && !_isRestoring) {
      desktopNavigateSmart(url);
    }
  });

  desktopWv.addEventListener('did-navigate', e => {
    const url = e.url;
    if (!url || url === 'about:blank') return;
    _desktopUrl = url;
    urlInput.value = url;
    updateClearBtn();
    clearTimeout(_navTimer);
    if (syncEnabled && !_isRestoring) {
      _navTimer = setTimeout(() => {
        _suppressPanelSync = true;
        clearTimeout(_suppressTimer);
        _suppressTimer = setTimeout(() => { _suppressPanelSync = false; }, 3000);
        navigateAllPanels(_desktopUrl);
      }, 400);
    }
  });

  desktopWv.addEventListener('did-fail-load', e => {
    // errorCode -3 = Nutzerabbruch (back/forward/Reload), -0 = OK – kein Toast
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

  desktopWv.addEventListener('did-navigate-in-page', e => {
    if (!e.isMainFrame) return;
    const url = e.url;
    if (!url || url === 'about:blank') return;
    clearTimeout(_navTimer);
    _navTimer = null;
    _desktopUrl = url;
    urlInput.value = url;
    updateClearBtn();
    if (syncEnabled) {
      _suppressPanelSync = true;
      clearTimeout(_suppressTimer);
      _suppressTimer = setTimeout(() => { _suppressPanelSync = false; }, 3000);
      navigateAllPanels(url);
    }
  });

  desktopWv.addEventListener('new-window', e => {
    const url = e.url;
    if (!url || url === 'about:blank') return;
    urlInput.value = url; updateClearBtn();
    desktopWv.loadURL(url).catch(() => {}); showWorkspace();
    if (syncEnabled) {
      _suppressPanelSync = true;
      clearTimeout(_suppressTimer);
      _suppressTimer = setTimeout(() => { _suppressPanelSync = false; }, 3000);
      navigateAllPanels(url);
    }
  });
  window.addEventListener('ss:popup', ({ detail: { url } }) => {
    if (!url || url === 'about:blank') return;
    urlInput.value = url; updateClearBtn();
    desktopWv.loadURL(url).catch(() => {}); showWorkspace();
    if (syncEnabled) {
      _suppressPanelSync = true;
      clearTimeout(_suppressTimer);
      _suppressTimer = setTimeout(() => { _suppressPanelSync = false; }, 3000);
      navigateAllPanels(url);
    }
  });

  // Resize-Logik übernimmt wireWorkspaceResizeObserver() via ResizeObserver.
  // onWindowResize bleibt als Hook erhalten, tut hier nichts mehr.
  window.ss.onWindowResize(() => {});

  window.ss.onToggleSync(() => {
    if (syncCb) { syncCb.checked = !syncCb.checked; syncCb.dispatchEvent(new Event('change')); }
  });

  window.ss.onScreenshot  (()  => captureScreenshot());
  window.ss.onMaximize    (id  => toggleMaximize(id));
  window.ss.onFocusToggle (id  => toggleFocus(id));

  // Wenn ein Webview Push-Subscribe mit "push service not available" scheitert,
  // öffnet der Haupt-Prozess diesen Dialog automatisch.
  window.ss.onPushConfigNeeded(() => openKeysDlg());
}


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
  // XPath-String-Literal escapen – kein Backslash, damit template-literal-sicher
  function _xpStr(s){
    var sq=String.fromCharCode(39),dq=String.fromCharCode(34);
    if(s.indexOf(sq)<0)return sq+s+sq;
    if(s.indexOf(dq)<0)return dq+s+dq;
    var res='concat(';
    var parts=s.split(sq);
    for(var i=0;i<parts.length;i++){if(i>0)res+=','+dq+sq+dq+',';if(parts[i])res+=sq+parts[i]+sq;}
    return res+')';
  }
  function sel(el){
    if(!el||el===document.body)return'body';
    var _tag=el.tagName.toLowerCase();
    var _isField=(_tag==='input'||_tag==='textarea'||_tag==='select');
    // 1. name – entwicklergesetzt, stabil
    var nm=el.getAttribute('name');
    if(nm)return _tag+'[name='+JSON.stringify(nm)+']';
    // 2. aria-label direkt am Element
    var al=el.getAttribute('aria-label');
    if(al)return _tag+'[aria-label='+JSON.stringify(al)+']';
    // 3. aria-labelledby – Wert ist Referenz-ID, entwicklergesetzt
    var alby=el.getAttribute('aria-labelledby');
    if(alby)return _tag+'[aria-labelledby='+JSON.stringify(alby)+']';
    // 4. data-testid / data-id
    var dt=el.getAttribute('data-testid')||el.getAttribute('data-id');
    if(dt)return _tag+'[data-testid='+JSON.stringify(dt)+']';
    // 5. placeholder
    var ph=el.getAttribute('placeholder');
    if(ph)return _tag+'[placeholder='+JSON.stringify(ph)+']';
    // 6. label[for=id] → Label-Text per XPath (React generiert id+for auto → #id instabil)
    if(el.id){try{var _lbl=document.querySelector('label[for='+JSON.stringify(el.id)+']');if(_lbl){var _lblt=(_lbl.textContent||'').trim().replace(/\\s+/g,' ');if(_lblt)return'//label[normalize-space(.)='+_xpStr(_lblt)+']/descendant::'+_tag;}}catch(_){}}
    // 7. Umschließendes <label> → XPath über Label-Text (// = XPath-Signal für Auswertung)
    var wl=el.closest('label');
    if(wl){
      var wltxt=(wl.textContent||'').trim().replace(/\\s+/g,' ');
      if(wltxt)return'//label[normalize-space(.)='+_xpStr(wltxt)+']/descendant::'+_tag;
    }
    // 8. Nicht-Feld mit beliebiger ID
    if(!_isField&&el.id)return'#'+CSS.escape(el.id);
    // 8b. <a href="..."> → href ist layout-unabhängig und stabil
    //     Vorzugsweise eindeutiger CSS-Selektor, sonst XPath
    if(_tag==='a'){
      var _href=el.getAttribute('href');
      if(_href&&_href!=='#'&&_href!=='javascript:void(0)'&&_href!=='javascript:;'){
        try{
          var _hrefAll=document.querySelectorAll('a[href='+JSON.stringify(_href)+']');
          if(_hrefAll.length===1)return'a[href='+JSON.stringify(_href)+']';
          // mehrere Links mit gleichem href → XPath mit Position sicherer als Strukturpfad
          if(_hrefAll.length>1){
            var _hi=0;for(var _hj=0;_hj<_hrefAll.length;_hj++){if(_hrefAll[_hj]===el){_hi=_hj+1;break;}}
            if(_hi>0)return'(//a[@href='+_xpStr(_href)+'])['+_hi+']';
          }
        }catch(_e){}
      }
    }
    // 8c. <a>, <button> oder role=button/link → Text-Inhalt XPath (layout-unabhängig)
    //     Funktioniert auch wenn responsive Design das Element in anderer Stelle hat.
    //     Zählung per querySelectorAll+Textvergleich statt document.evaluate(count()),
    //     damit der Branch auch in Umgebungen mit eingeschränktem XPath-Support greift.
    if(_tag==='a'||_tag==='button'||el.getAttribute('role')==='button'||el.getAttribute('role')==='link'){
      // textContent statt innerText: XPath normalize-space(.) wertet Textknoten aus (= textContent),
      // NICHT das CSS-gerenderte innerText. Bei text-transform:uppercase würde innerText
      // "EINSTELLUNGEN" liefern, aber normalize-space(.) findet nur "Einstellungen" → NULL.
      var _txt=(el.textContent||el.getAttribute('aria-label')||'').trim().replace(/\\s+/g,' ');
      if(_txt){
        try{
          var _xp='//'+_tag+'[normalize-space(.)='+_xpStr(_txt)+']';
          var _tall=document.querySelectorAll(_tag);
          var _tmatch=0,_tidx=0;
          for(var _ti=0;_ti<_tall.length;_ti++){
            var _tnt=(_tall[_ti].textContent||'').trim().replace(/\\s+/g,' ');
            if(_tnt===_txt){_tmatch++;if(_tall[_ti]===el)_tidx=_tmatch;}
          }
          if(_tmatch===1)return _xp;
          // Mehrfach gleicher Text → XPath-Positionierung unter gleichem Text (NICHT unter allen _tag!)
          // (//button)[2] wäre falsch – das ist der 2. Button insgesamt, nicht der 2. mit diesem Text.
          if(_tmatch>1&&_tidx>0)return'('+_xp+')['+_tidx+']';
        }catch(_e){}
      }
    }
    // 9. Position innerhalb <form> – :nth-of-type zählt NUR nach Tag, daher OHNE type-Filter
    var tp=el.getAttribute('type');
    var form=el.closest('form');
    if(_isField&&form){
      var allInForm=[].slice.call(form.querySelectorAll(_tag));
      var fIdx=allInForm.indexOf(el);
      if(fIdx>=0){
        var fs=form.id?'form#'+CSS.escape(form.id):'form';
        return fs+' '+_tag+':nth-of-type('+(fIdx+1)+')';
      }
    }
    // 10. Kein form oder Suche fehlgeschlagen → XPath nth-occurrence dokument-weit
    //     el.ownerDocument statt document: funktioniert auch in Frames
    if(_isField){
      var _doc=el.ownerDocument||document;
      var _all=_doc.getElementsByTagName(_tag);
      var _n=0,_found=false;
      for(var _i=0;_i<_all.length;_i++){if(_all[_i]===el){_found=true;_n=_i+1;break;}}
      if(_found)return'(//'+_tag+')['+_n+']';
    }
    // 11. ID als letzter Ausweg
    if(el.id)return'#'+CSS.escape(el.id);
    // 11. Struktureller Pfad – verankert an body, damit querySelector dokumentweit eindeutig bleibt
    var path=[];
    for(var cur=el,i=0;i<8&&cur&&cur!==document.body;cur=cur.parentElement,i++){
      var s=cur.tagName.toLowerCase();
      var sibs=cur.parentElement?[...cur.parentElement.children]:[];
      var same=sibs.filter(function(x){return x.tagName===cur.tagName;});
      if(same.length>1)s+=':nth-of-type('+(same.indexOf(cur)+1)+')';
      path.unshift(s);
    }
    return'body>'+path.join('>');
  }
  _log('__SS_READY__');
  document.addEventListener('click',function(e){
    try{
      var tgt=interactive(e.target);
      _log('__SS_CLICK__:'+encodeURIComponent(sel(tgt)));
      if(!_ITAGS.has(tgt.tagName.toLowerCase())&&!_IROLES.has((tgt.getAttribute('role')||''))&&tgt.getAttribute('onclick')==null)_log('__SS_BACKDROP__');
    }catch(_){}
  },true);
  document.addEventListener('keydown',function(e){
    try{
      var k=e.key;
      if(k==='Enter'||k==='Tab'||k==='Escape'){
        _log('__SS_KEYDOWN__:'+JSON.stringify({k:k,s:sel(document.activeElement)}));
      }
    }catch(_){}
  },true);
  var _ssRaf=null;
  window.addEventListener('scroll',function(){
    if(_ssRaf)return;
    _ssRaf=requestAnimationFrame(function(){
      _ssRaf=null;
      _log('__SS_SCROLL__:'+Math.round(window.scrollX)+'|'+Math.round(window.scrollY));
    });
  },{passive:true,capture:true});
  document.addEventListener('input',function(e){
    try{
      var t=e.target,tag=t.tagName;
      if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'){
        var isChk=(t.type==='checkbox'||t.type==='radio');
        var _ltag=tag.toLowerCase();
        // Stabiler Selektor: name > aria-label > placeholder > (//tag)[N] > label-text XPath
        var _s='';
        var _doc=t.ownerDocument||document;
        // 1) name — nur eindeutig verwenden; Radio-Gruppen/doppelte Namen → (//tag)[N]
        var _nm=t.getAttribute('name');
        if(_nm){try{var _nmAll=_doc.querySelectorAll(_ltag+'[name='+JSON.stringify(_nm)+']');if(_nmAll.length===1||_nmAll[0]===t){_s=_ltag+'[name='+JSON.stringify(_nm)+']';}}catch(_e){}}
        // 2) aria-label — nur wenn eindeutig auf dieser Seite
        if(!_s){var _al=t.getAttribute('aria-label');if(_al){try{var _alAll=_doc.querySelectorAll(_ltag+'[aria-label='+JSON.stringify(_al)+']');if(_alAll.length===1||_alAll[0]===t){_s=_ltag+'[aria-label='+JSON.stringify(_al)+']';}}catch(_e){}}}
        // 3) placeholder — nur wenn eindeutig auf dieser Seite
        if(!_s){var _ph=t.getAttribute('placeholder');if(_ph){try{var _phAll=_doc.querySelectorAll(_ltag+'[placeholder='+JSON.stringify(_ph)+']');if(_phAll.length===1||_phAll[0]===t){_s=_ltag+'[placeholder='+JSON.stringify(_ph)+']';}}catch(_e){}}}
        // 4) (//tag)[N]: Beide Webviews laden dieselbe URL → gleiche DOM-Struktur → N ist stabil.
        if(!_s){
          var _all=_doc.getElementsByTagName(_ltag);
          for(var _i=0;_i<_all.length;_i++){
            if(_all[_i]===t){_s='(//'+_ltag+')['+ (_i+1)+']';break;}
          }
        }
        if(!_s&&t.id){try{var _lbl=(t.ownerDocument||document).querySelector('label[for='+JSON.stringify(t.id)+']');if(_lbl){var _lbltxt=(_lbl.textContent||'').trim().replace(/\\s+/g,' ');if(_lbltxt)_s='//label[normalize-space(.)='+_xpStr(_lbltxt)+']/descendant::'+_ltag;}}catch(_e){}}
        if(!_s){var _wl=t.closest('label');if(_wl){var _wltxt=(_wl.textContent||'').trim().replace(/\\s+/g,' ');if(_wltxt)_s='//label[normalize-space(.)='+_xpStr(_wltxt)+']/descendant::'+_ltag;}}
        if(!_s)_s=sel(t);
        _log('__SS_INPUT__::'+JSON.stringify({s:_s,v:isChk?t.checked:t.value}));
      }
    }catch(_){}
  },true);
})();`;

/**
 * Builds JS to set an input/checkbox value in a panel webview.
 *
 * Robustness for all frameworks (vanilla, React, Vue, react-hook-form, …):
 *  1. el.focus()          – many framework forms only react to events on the
 *                           focused element; also ensures React's FocusEvent
 *                           bookkeeping is up to date.
 *  2. native prototype setter – bypasses framework wrappers so el.value is
 *                           actually updated at the DOM level.
 *  3. _valueTracker reset  – React stores the last-seen value here.  If we
 *                           don't reset it React compares el.value against the
 *                           previously tracked value and may conclude "nothing
 *                           changed" → silent drop of the input event.
 *                           Setting it to '' forces the comparison to always
 *                           see a diff and call onChange.
 *  4. input + change events – covers both React synthetic (input) and native
 *                           change listeners used by other libraries.
 */
// Liefert JS-Snippet zum Finden eines Elements per CSS-Selektor oder XPath (Präfix '//').
function _findElJs(selector) {
  const s = JSON.stringify(selector);
  if (selector.startsWith('//') || selector.startsWith('(//')) {
    // Fallback für text-basiertes XPath: wenn exaktes normalize-space-Match fehlt
    // (z.B. weil textContent im Quell-Webview einzelne Zeichen als Leerzeichen liefert),
    // wird ein contains()-Ausdruck für alle Wörter ≥4 Zeichen als Fallback versucht.
    const m = selector.match(/\/\/(\w+)\[normalize-space\(\.\)='([^']*)'\]/);
    if (m) {
      const tag = m[1], text = m[2];
      const words = text.split(/\s+/).filter(w => w.length >= 4);
      if (words.length >= 2) {
        const conds = words.map(w => `contains(normalize-space(.),'${w}')`).join(' and ');
        const fbSel = selector.replace(
          `//` + tag + `[normalize-space(.)='` + text + `']`,
          `//` + tag + `[` + conds + `]`
        );
        const fb = JSON.stringify(fbSel);
        return `(document.evaluate(${s},document,null,9,null).singleNodeValue`
             + `||document.evaluate(${fb},document,null,9,null).singleNodeValue)`;
      }
    }
    return `document.evaluate(${s},document,null,9,null).singleNodeValue`;
  }
  return `document.querySelector(${s})`;
}

function buildInputJs(selector, value) {
  // inline: CSS oder XPath (Präfix '//' oder '(//')
  const find = (selector.startsWith('//') || selector.startsWith('(//'))
    ? `document.evaluate(${JSON.stringify(selector)},document,null,9,null).singleNodeValue`
    : `document.querySelector(${JSON.stringify(selector)})`;
  if (typeof value === 'boolean') {
    return `(function(){` +
      `var el=${find};` +
      `if(!el)return;` +
      `el.focus();` +
      `el.checked=${value};` +
      `var t=el._valueTracker;if(t)t.setValue(String(!${value}));` +
      `el.dispatchEvent(new Event('change',{bubbles:true}));` +
      `})();`;
  }
  const val = JSON.stringify(String(value));
  return `(function(){` +
    `var el=${find};` +
    `if(!el)return;` +
    `el.focus();` +
    `try{` +
      `var proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:` +
               `el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;` +
      `Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${val});` +
    `}catch(e){el.value=${val};}` +
    `var t=el._valueTracker;` +
    `try{if(t)t.setValue('');}catch(_){}` +
    `el.dispatchEvent(new Event('input',{bubbles:true}));` +
    `el.dispatchEvent(new Event('change',{bubbles:true}));` +
    `})();`;
}

function wireDesktopInteraction() {
  desktopWv.addEventListener('did-start-loading', () => { _desktopReady = false; });

  function injectClickForwarder() {
    _desktopReady = true;
    desktopWv.executeJavaScript(_CLICK_INJECT).catch(() => {});
  }
  desktopWv.addEventListener('did-finish-load',    injectClickForwarder);
  desktopWv.addEventListener('did-navigate-in-page', injectClickForwarder);

  desktopWv.addEventListener('console-message', e => {
    const msg = e.message ?? '';
    if (!msg.startsWith('__SS_')) return;

    if (!syncEnabled) return;
    if (state.panels.size === 0) return;

    if (msg.startsWith('__SS_CLICK__:')) {
      const encoded = msg.slice('__SS_CLICK__:'.length);
      if (!encoded) return;
      const selector = decodeURIComponent(encoded);
      // eslint-disable-next-line no-console
      console.log('[SS:CLICK] ENCODED:', encoded);
      // eslint-disable-next-line no-console
      console.log('[SS:CLICK] DECODED:', selector);
      // _suppressPanelSync verhindert, dass die durch den Click ausgelöste Panel-Navigation
      // den Desktop zurück navigiert und offene Dropdowns/Modals schließt.
      _suppressPanelSync = true;
      clearTimeout(_suppressTimer);
      _suppressTimer = setTimeout(() => { _suppressPanelSync = false; }, 2000);
      // Debug: Return-Value der IIFE → landet im .then() des Renderers, nicht in Panel-DevTools
      const js = `(function(){
        var el;
        try{ el=${_findElJs(selector)}; }catch(e){ return 'FIND_ERROR:'+e; }
        if(!el) return 'NULL url='+location.href+' title='+document.title.slice(0,30);
        try{ el.click(); return 'CLICKED:'+el.tagName+(el.id?'#'+el.id:'')+'['+el.textContent.trim().slice(0,40)+']'; }
        catch(e){ return 'CLICK_ERROR:'+e; }
      })()`;
      for (const [panelId, { decoEl }] of state.panels) {
        const wv = decoEl.querySelector('.panel-webview');
        if (wv) {
          wv.executeJavaScript(js)
            // eslint-disable-next-line no-console
            .then(r  => console.log('[SS:CLICK] panel', panelId, '→', r))
            // eslint-disable-next-line no-console
            .catch(e => console.log('[SS:CLICK] panel', panelId, '→ JS_ERROR:', e));
        }
      }

    } else if (msg.startsWith('__SS_SCROLL__:')) {
      const parts = msg.slice('__SS_SCROLL__:'.length).split('|');
      const sx = parseInt(parts[0], 10) || 0;
      const sy = parseInt(parts[1], 10) || 0;
      const js = `window.scrollTo(${sx},${sy});`;
      for (const [, { decoEl }] of state.panels) {
        const wv = decoEl.querySelector('.panel-webview');
        if (wv) wv.executeJavaScript(js).catch(() => {});
      }

    } else if (msg.startsWith('__SS_INPUT__::')) {
      let data;
      try { data = JSON.parse(msg.slice('__SS_INPUT__::'.length)); } catch { return; }
      const { s: selector, v: value } = data;
      if (!selector) return;
      const js = buildInputJs(selector, value);
      for (const [, { decoEl }] of state.panels) {
        const wv = decoEl.querySelector('.panel-webview');
        if (wv) wv.executeJavaScript(js).catch(() => {});
      }
    } else if (msg.startsWith('__SS_KEYDOWN__:')) {
      let kdata;
      try { kdata = JSON.parse(msg.slice('__SS_KEYDOWN__:'.length)); } catch { return; }
      const { k: key, s: ksel } = kdata;
      if (!key) return;
      const kjs = `(function(){` +
        `var el=${ksel ? _findElJs(ksel) : 'null'};` +
        `if(!el)el=document.activeElement||document.body;` +
        `el.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true}));` +
        `el.dispatchEvent(new KeyboardEvent('keyup',{key:${JSON.stringify(key)},bubbles:true}));` +
        `})();`;
      for (const [, { decoEl }] of state.panels) {
        const wv = decoEl.querySelector('.panel-webview');
        if (wv) wv.executeJavaScript(kjs).catch(() => {});
      }
    } else if (msg === '__SS_BACKDROP__') {
      const js = `(function(){var bd=document.querySelector('.MuiBackdrop-root,.modal-backdrop');if(bd)bd.click();if(document.activeElement)document.activeElement.blur();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));document.dispatchEvent(new KeyboardEvent('keyup',{key:'Escape',bubbles:true}));})();`;
      for (const [, { decoEl }] of state.panels) {
        const wv = decoEl.querySelector('.panel-webview');
        if (wv) wv.executeJavaScript(js).catch(() => {});
      }
    }
  });
}


let _presentationMode = false;
let _hintHideTimer    = null;
let _presentedPanelId = null;

let _presentOverlay = null;

function exitPanelPresent() {
  if (_presentedPanelId === null) return;
  const p = state.panels.get(_presentedPanelId);
  if (p) {
    p.decoEl.classList.remove('presenting');
    applyDecoRect(p); // ursprüngliche Position/Scale wiederherstellen
  }
  _presentOverlay?.remove();
  _presentOverlay = null;
  document.body.classList.remove('panel-presenting');
  _presentedPanelId = null;
}

window.addEventListener('ss:exit-present-panel', () => exitPanelPresent());

window.addEventListener('ss:present-panel', e => {
  const { id } = e.detail;
  if (_presentedPanelId === id) return;
  exitPanelPresent();
  const p = state.panels.get(id);
  if (!p) return;
  _presentedPanelId = id;

  // Overlay direkt in body – unter #workspace (z-index 9997), deckt #desktop-wv ab
  _presentOverlay = document.createElement('div');
  _presentOverlay.id = 'panel-present-overlay';
  document.body.appendChild(_presentOverlay);

  // CSS-Scale: Panel auf 100 % Viewport-Höhe skalieren (Webview-Auflösung bleibt unverändert)
  const scaleToFit = window.innerHeight / p.rect.h;
  p.decoEl.style.transform = `translate(-50%, -50%) scale(${scaleToFit})`;
  p.decoEl.classList.add('presenting');
  document.body.classList.add('panel-presenting');
});

function togglePresentation(force) {
  _presentationMode = (force !== undefined) ? !!force : !_presentationMode;
  document.body.classList.toggle('presentation', _presentationMode);
  window.ss.setFullScreen(_presentationMode);
  const presentBtn = document.getElementById('present-btn');
  if (presentBtn) presentBtn.classList.toggle('active', _presentationMode);
  if (_presentationMode) {
    document.activeElement?.blur();
    // Hinweis einblenden, nach 4 s automatisch ausblenden
    document.body.classList.remove('hint-hidden');
    clearTimeout(_hintHideTimer);
    _hintHideTimer = setTimeout(() => document.body.classList.add('hint-hidden'), 4000);
  } else {
    document.body.classList.remove('hint-hidden');
    clearTimeout(_hintHideTimer);
  }
}

function wireShortcuts() {
  document.getElementById('present-btn')?.addEventListener('click', () => togglePresentation());

  window.ss.onFullScreenChange(flag => {
    // wsRect + remap übernimmt der ResizeObserver automatisch wenn das DOM
    // nach dem Vollbild-Wechsel seine Größe ändert.
    _presentationMode = flag;
    document.body.classList.toggle('presentation', flag);
    const presentBtn = document.getElementById('present-btn');
    if (presentBtn) presentBtn.classList.toggle('active', flag);
    if (flag) {
      document.activeElement?.blur();
      document.body.classList.remove('hint-hidden');
      clearTimeout(_hintHideTimer);
      _hintHideTimer = setTimeout(() => document.body.classList.add('hint-hidden'), 4000);
    } else {
      document.body.classList.remove('hint-hidden');
      clearTimeout(_hintHideTimer);
    }
  });

  document.addEventListener('keydown', e => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'F11')                         { e.preventDefault(); togglePresentation(); }
    if (e.key === 'Escape' && _presentationMode) { e.preventDefault(); togglePresentation(false); }
    if (e.key === 'Escape' && _presentedPanelId !== null) { e.preventDefault(); exitPanelPresent(); }
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

/* ── Auto-Updater ─────────────────────────────────────────────────────────── */
function wireUpdater() {
  window.ss.onUpdateAvailable?.(version => {
    toast(`⬇ Update ${version} wird heruntergeladen …`, 'info', 5000);
  });
  window.ss.onUpdateDownloaded?.(version => {
    const banner = document.createElement('div');
    banner.style.cssText = [
      'position:fixed', 'bottom:16px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:99999', 'background:#1e2030', 'color:#e0e4ff',
      'border:1px solid rgba(255,255,255,.15)', 'border-radius:10px',
      'padding:10px 16px', 'display:flex', 'align-items:center', 'gap:12px',
      'font-size:13px', 'font-weight:500', 'box-shadow:0 8px 32px rgba(0,0,0,.5)',
      'white-space:nowrap',
    ].join(';');
    banner.innerHTML = `
      <span>🚀 Update <b>${version}</b> bereit – App neu starten?</span>
      <button id="upd-yes" style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:4px 14px;font-size:12.5px;font-weight:700;cursor:pointer;">Jetzt neu starten</button>
      <button id="upd-no"  style="background:rgba(255,255,255,.1);color:#e0e4ff;border:none;border-radius:6px;padding:4px 14px;font-size:12.5px;font-weight:600;cursor:pointer;">Später</button>
    `;
    document.body.appendChild(banner);
    document.getElementById('upd-yes').addEventListener('click', () => window.ss.installUpdate());
    document.getElementById('upd-no') .addEventListener('click', () => banner.remove());
  });
}

wireUpdater();

/* ── Dark Mode ────────────────────────────────────────────────────────────── */
(function wireDarkMode() {
  const btn = document.getElementById('darkmode-btn');
  if (!btn) return;
  const moon = document.getElementById('darkmode-icon-moon');
  const sun  = document.getElementById('darkmode-icon-sun');
  const apply = dark => {
    document.body.classList.toggle('dark', dark);
    localStorage.setItem('blickfang-dark', dark ? '1' : '0');
    if (moon) moon.style.display = dark ? 'none' : '';
    if (sun)  sun.style.display  = dark ? '' : 'none';
  };
  // Gespeicherte Präferenz laden, sonst Systemeinstellung
  const stored = localStorage.getItem('blickfang-dark');
  apply(stored !== null ? stored === '1' : window.matchMedia('(prefers-color-scheme: dark)').matches);
  btn.addEventListener('click', () => apply(!document.body.classList.contains('dark')));
})();

/* ── About-Dialog ──────────────────────────────────────────────────── */
(function wireAbout() {
  const dlg   = document.getElementById('about-dialog');
  const btn   = document.getElementById('about-btn');
  const close = document.getElementById('about-close');
  if (!dlg || !btn) return;

  btn.addEventListener('click', () => dlg.showModal());
  close.addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

  dlg.addEventListener('click', e => {
    const link = e.target.closest('.about-link');
    if (!link) return;
    e.preventDefault();
    const url = link.dataset.href;
    if (url) window.ss.openExternal(url);
  });
})();

init();
