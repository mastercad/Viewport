'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ss', {
  // Google-API-Keys für Push-Notifications lesen / speichern
  keysLoad:      ()            => ipcRenderer.invoke('keys:load'),
  keysSave:      (keys)        => ipcRenderer.invoke('keys:save', keys),

  // Workspace-Bounds
  getWorkspace:  ()            => ipcRenderer.invoke('workspace:getBounds'),

  // Screenshots inkl. CSS-Rahmen (liefert base64-PNG-String)
  captureRect:   (rect)        => ipcRenderer.invoke('screenshot:capture-rect', rect),

  // Vollbild steuern
  setFullScreen:    (flag) => ipcRenderer.invoke('window:setFullScreen', flag),
  onFullScreenChange: (cb) => ipcRenderer.on('window:fullscreen', (_e, flag) => cb(flag)),

  // Events vom Main-Prozess
  onWindowResize:   (cb) => ipcRenderer.on('window:resized',      () => cb()),
  onToggleSync:     (cb) => ipcRenderer.on('toggle:sync',         () => cb()),
  onAutoArrange:    (cb) => ipcRenderer.on('cmd:autoArrange',     () => cb()),
  onScreenshot:     (cb) => ipcRenderer.on('cmd:screenshot',      () => cb()),
  onMaximize:       (cb) => ipcRenderer.on('panel:maximize',      (_e, id) => cb(id)),
  onFocusToggle:    (cb) => ipcRenderer.on('panel:focusToggle',   (_e, id) => cb(id)),
});
