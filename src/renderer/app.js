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

async function init() {
  state.wsRect = normalizeWsRect(await window.ss.getWorkspace());
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
  const saved = loadLayout();
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
      await addPanel(def, { rect: entry.rect, scale: entry.scale, url: entry.url || '', skipSave: true });
    }
  } finally {
    _isRestoring = false;
    saveLayout(state.panels);
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
  window.addEventListener('ss:navigated', ({ detail: { id, url } }) => {
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
    try{
      var tgt=interactive(e.target);
      _log('__SS_CLICK__:'+sel(tgt));
      if(!_ITAGS.has(tgt.tagName.toLowerCase())&&!_IROLES.has((tgt.getAttribute('role')||''))&&tgt.getAttribute('onclick')==null)_log('__SS_BACKDROP__');
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
        _log('__SS_INPUT__::'+JSON.stringify({s:sel(t),v:isChk?t.checked:t.value}));
      }
    }catch(_){}
  },true);
})();`;

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
    if (msg.startsWith('__SS_')) console.log('[SS-sync]', msg.slice(0, 120));

    if (!syncEnabled) return;
    if (state.panels.size === 0) return;

    if (msg.startsWith('__SS_CLICK__:')) {
      const selector = msg.slice('__SS_CLICK__:'.length);
      if (!selector) return;
      // _suppressPanelSync verhindert, dass die durch den Click ausgelöste Panel-Navigation
      // den Desktop zurück navigiert und offene Dropdowns/Modals schließt.
      _suppressPanelSync = true;
      clearTimeout(_suppressTimer);
      _suppressTimer = setTimeout(() => { _suppressPanelSync = false; }, 2000);
      const js = `(function(){var el=document.querySelector(${JSON.stringify(selector)});if(el)el.click();})();`;
      for (const [, { decoEl }] of state.panels) {
        const wv = decoEl.querySelector('.panel-webview');
        if (wv) wv.executeJavaScript(js).catch(() => {});
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
      let js;
      if (typeof value === 'boolean') {
        js = `(function(){var el=document.querySelector(${JSON.stringify(selector)});` +
          `if(el){el.checked=${value};el.dispatchEvent(new Event('change',{bubbles:true}));}})();`;
      } else {
        const sv = JSON.stringify(String(value));
        js = `(function(){` +
          `var el=document.querySelector(${JSON.stringify(selector)});if(!el)return;` +
          `try{var proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:` +
          `el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;` +
          `Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${sv});}` +
          `catch(_){el.value=${sv};}` +
          `el.dispatchEvent(new Event('input',{bubbles:true}));` +
          `el.dispatchEvent(new Event('change',{bubbles:true}));` +
          `})();`;
      }
      for (const [, { decoEl }] of state.panels) {
        const wv = decoEl.querySelector('.panel-webview');
        if (wv) wv.executeJavaScript(js).catch(() => {});
      }
    } else if (msg === '__SS_BACKDROP__') {
      const js = `(function(){if(document.activeElement)document.activeElement.blur();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));document.dispatchEvent(new KeyboardEvent('keyup',{key:'Escape',bubbles:true}));})();`;
      for (const [, { decoEl }] of state.panels) {
        const wv = decoEl.querySelector('.panel-webview');
        if (wv) wv.executeJavaScript(js).catch(() => {});
      }
    }
  });
}


let _presentationMode = false;
let _hintHideTimer    = null;

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
    if (flag === _presentationMode) return;
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
