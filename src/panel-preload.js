'use strict';
/* panel-preload.js – läuft im Panel-BrowserWindow */

const { contextBridge, ipcRenderer } = require('electron');

// Konfiguration vom Main-Prozess empfangen (einmalig beim Erstellen injiziert)
const cfg = JSON.parse(process.env.PANEL_CFG || 'null');

contextBridge.exposeInMainWorld('panelCfg', cfg);

contextBridge.exposeInMainWorld('panelApi', {
  // Renderer → Main
  navigated:       (id, url)        => ipcRenderer.send('panel:navigated',       { id, url }),
  titleUpdated:    (id, title)      => ipcRenderer.send('panel:titleUpdated',     { id, title }),
  close:           (id)             => ipcRenderer.send('panel:closeReq',         id),
  toggleMaximize:  (id)             => ipcRenderer.send('panel:maximizeReq',      id),
  toggleFocus:     (id)             => ipcRenderer.send('panel:focusReq',         id),
  startResize:     (id, pos)        => ipcRenderer.send('panel:resizeStart',      { id, pos }),
  // Viewport-Emulation: webview-WebContentsId + Gerätegröße an Main melden.
  // invoke (nicht send) damit caller auf Abschluss warten kann bevor URL geladen wird.
  setViewport:     (wvId, w, h)     => ipcRenderer.invoke('panel:setViewport',    { wvId, w, h }),

  // Main → Renderer
  onCommand: (cb) => {
    ipcRenderer.on('panel:cmd', (_e, cmd, data) => cb(cmd, data));
  },
});
