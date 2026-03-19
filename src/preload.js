'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ss', {
  setViewport:      (wvId, w, h, opts) => ipcRenderer.invoke('panel:setViewport', { wvId, w, h, ...opts }),

  keysLoad:      ()            => ipcRenderer.invoke('keys:load'),
  keysSave:      (keys)        => ipcRenderer.invoke('keys:save', keys),

  getWorkspace:  ()            => ipcRenderer.invoke('workspace:getBounds'),

  captureRect:      (rect)  => ipcRenderer.invoke('screenshot:capture-rect', rect),
  captureWv:        (wvId)  => ipcRenderer.invoke('screenshot:capture-wv', wvId),
  captureDesktopWv: (wvId)  => ipcRenderer.invoke('screenshot:capture-desktop-wv', wvId),

  setFullScreen:    (flag) => ipcRenderer.invoke('window:setFullScreen', flag),
  onFullScreenChange: (cb) => ipcRenderer.on('window:fullscreen', (_e, flag) => cb(flag)),

  onWindowResize:   (cb) => ipcRenderer.on('window:resized',      () => cb()),
  onToggleSync:     (cb) => ipcRenderer.on('toggle:sync',         () => cb()),
  onAutoArrange:    (cb) => ipcRenderer.on('cmd:autoArrange',     () => cb()),
  onScreenshot:     (cb) => ipcRenderer.on('cmd:screenshot',      () => cb()),
  onMaximize:       (cb) => ipcRenderer.on('panel:maximize',      (_e, id) => cb(id)),
  onFocusToggle:    (cb) => ipcRenderer.on('panel:focusToggle',   (_e, id) => cb(id)),

  onUpdateAvailable:  (cb) => ipcRenderer.on('updater:available',  (_e, v) => cb(v)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('updater:downloaded',  (_e, v) => cb(v)),
  installUpdate:      ()   => ipcRenderer.send('updater:install'),

  // Push-Notification-Konfiguration: wird ausgelöst wenn ein Webview
  // "push service not available" meldet (fehlender/ungültiger Google-API-Key).
  onPushConfigNeeded: (cb) => ipcRenderer.on('push:needs-config', () => cb()),

  // Startet die App sofort neu (nach dem Speichern von Google-API-Keys).
  appRestart: () => ipcRenderer.invoke('app:restart'),

  // Laufzeit-Diagnose: liefert Infos über geladene Keys und Switches.
  keysDiagnose: () => ipcRenderer.invoke('keys:diagnose'),

  // Löscht Service-Worker-Registrierungen der persist:desktop-Session
  // (setzt gecachten Push-State zurück, damit eine frische Subscription möglich ist).
  sessionClearPush: () => ipcRenderer.invoke('session:clearPush'),

  // Öffnet einen Link im System-Standardbrowser (nur https / mailto).
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
});
