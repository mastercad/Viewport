'use strict';

const {
  app, BrowserWindow, ipcMain,
  screen, session, Menu, globalShortcut
} = require('electron');
const path = require('path');
const fs   = require('fs');

// ── Push-Notification-Keys früh laden und an Chromium übergeben ─────────────
// app.commandLine.appendSwitch() muss VOR app.isReady() aufgerufen werden.
{
  const _kp = path.join(app.getPath('userData'), 'api-keys.json');
  try {
    const _k = JSON.parse(fs.readFileSync(_kp, 'utf8'));
    if (_k.apiKey)       app.commandLine.appendSwitch('google-api-key',        _k.apiKey);
    if (_k.clientId)     app.commandLine.appendSwitch('oauth2-client-id',      _k.clientId);
    if (_k.clientSecret) app.commandLine.appendSwitch('oauth2-client-secret',  _k.clientSecret);
  } catch { /* Noch nicht konfiguriert – kein Problem */ }
}

// ── Sicherheit: Context-Isolation erzwingen ──────────────────────────────────
// Unter Linux (AppImage) fehlt die SUID-chrome-sandbox → --no-sandbox setzen.
// Sicherheit wird stattdessen über contextIsolation + nodeIntegration:false
// in allen webPreferences sichergestellt.
//if (process.platform === 'linux') {
  // AppImage hat kein SUID-chrome-sandbox → Sandbox deaktivieren.
  // Sicherheit läuft über contextIsolation + nodeIntegration:false.
  // Hinweis: bei AppImage muss --no-sandbox auch via Wrapper-Script übergeben
  // werden (siehe scripts/after-pack.js), da dieser JS-Code für den Sandbox-
  // Check zu spät kommt.
  // app.commandLine.appendSwitch('no-sandbox');
//}

// ── Hauptfenster & View-Verwaltung ──────────────────────────────────────────
let mainWin = null;

// ── App ready ────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Desktop-Session: CSP/X-Frame-Options-Stripping + Permissions
  setupSession(session.fromPartition('persist:desktop', { cache: true }));

  createMainWindow();

  // Panel-Webviews: Session-Setup + User-Agent sobald ein neuer WebContents erzeugt wird
  const _setupDone = new Set();
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() !== 'webview') return;
    const ses = contents.session;
    const key = ses.storagePath ?? ses.id ?? Math.random();
    if (!_setupDone.has(key)) {
      _setupDone.add(key);
      setupSession(ses);
    }
    contents.setUserAgent(
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36'
    );
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Hauptfenster erstellen ───────────────────────────────────────────────────
function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWin = new BrowserWindow({
    width:  Math.min(1600, width  - 80),
    height: Math.min(960,  height - 60),
    minWidth:  900,
    minHeight: 600,
    title: 'Blickfang · Viewport',
    icon:  path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#f4f5f9',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag:      true,    // für eingebettete Desktop-WebView
    },
  });

  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Menü mit Tastaturkürzel: Ctrl+Shift+S schaltet Sync um – funktioniert auch
  // wenn ein WebContentsView den Keyboard-Fokus hat (Menu-Accelerator ist OS-level)
  const menu = Menu.buildFromTemplate([{
    label: 'Ansicht', submenu: [
      { label:       'Synchronisation umschalten',
        accelerator: 'CmdOrCtrl+Shift+S',
        click:       () => mainWin?.webContents.send('toggle:sync') },
      { label:       'DevTools (Renderer)',
        accelerator: 'CmdOrCtrl+Alt+I',
        click:       () => mainWin?.webContents.toggleDevTools() },
    ]
  }]);
  Menu.setApplicationMenu(menu);

  // Renderer-Crash anzeigen statt stillschweigend scheitern
  mainWin.webContents.on('render-process-gone', (_e, details) => {
    console.error('[Blickfang] Renderer crashed:', details.reason, details.exitCode);
  });
  mainWin.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[Blickfang] did-fail-load:', code, desc, url);
  });

  // DevTools nur während der Entwicklung (nicht im gebauten AppImage)
  if (!app.isPackaged) mainWin.webContents.openDevTools();

  // Panel-Views brauchen neue Bounds wenn das Fenster resized wird
  mainWin.on('resize', () => mainWin?.webContents.send('window:resized'));

  // Vollbild: globale Shortcuts registrieren damit der Desktop-Webview sie nicht verschluckt
  // F11 einmalig als Toggle registrieren – nie mehr deregistrieren, damit es nach jedem
  // Vollbild-Zyklus (auch durch Website-requestFullscreen) zuverlässig bleibt.
  globalShortcut.register('F11', () => {
    if (mainWin) mainWin.setFullScreen(!mainWin.isFullScreen());
  });

  mainWin.on('enter-full-screen', () => {
    mainWin?.webContents.send('window:fullscreen', true);
    // Escape nur im Vollbild registrieren (würde sonst andere Escape-Aktionen stören)
    globalShortcut.register('Escape', exitFullScreen);
  });
  mainWin.on('leave-full-screen', () => {
    globalShortcut.unregister('Escape');
    mainWin?.webContents.send('window:fullscreen', false);
  });

  mainWin.on('closed', () => {
    globalShortcut.unregisterAll();
    mainWin = null;
  });
}

// ── Session-Setup: CSP-Stripping + Permissions (Desktop & Panels) ────────────
const ALLOWED_PERMISSIONS = new Set([
  'notifications', 'push', 'media', 'mediaKeySystem',
  'geolocation', 'clipboard-read', 'clipboard-sanitized-write',
  'fullscreen', 'openExternal',
]);

function setupSession(ses) {
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers['x-frame-options'];
    delete headers['X-Frame-Options'];
    const cspKey = Object.keys(headers)
      .find(k => k.toLowerCase() === 'content-security-policy');
    if (cspKey) delete headers[cspKey];
    callback({ responseHeaders: headers });
  });
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission))
  );
  ses.setPermissionCheckHandler((_wc, permission) =>
    ALLOWED_PERMISSIONS.has(permission)
  );
}

// ── IPC: API-Keys laden ──────────────────────────────────────────────────────
const { safeStorage, app: _app } = require('electron');
const _keysPath = require('path').join(
  require('electron').app.getPath('userData'), 'api-keys.json'
);
ipcMain.handle('keys:load', () => {
  try {
    const raw = require('fs').readFileSync(_keysPath);
    return JSON.parse(raw.toString());
  } catch { return {}; }
});

// ── IPC: API-Keys speichern ──────────────────────────────────────────────────
ipcMain.handle('keys:save', (_e, keys) => {
  try {
    require('fs').writeFileSync(_keysPath, JSON.stringify(keys));
    return true;
  } catch { return false; }
});

// ── IPC: Zoom (kein Panel-IPC mehr nötig, webview skaliert per CSS) ──────────
// Nur noch onWindowResize-Event für Workspace-Bounds

// ── IPC: Workspace-Bereich melden (für korrekte Bounds-Berechnung) ────────────
ipcMain.handle('workspace:getBounds', () => {
  if (!mainWin) return null;
  const [winW, winH] = mainWin.getContentSize();
  const fullscreen    = mainWin.isFullScreen();
  const topOffset     = fullscreen ? 0 : 110;   // header (60) + device-bar (50)
  const bottomOffset  = fullscreen ? 0 : 60;     // toolbar
  return { x: 0, y: topOffset, width: winW, height: winH - topOffset - bottomOffset };
});

// ── IPC: Screenshot eines DOM-Rects (inkl. CSS-Geräterahmen) ────────────────────────
const _ZERO = v => Math.max(0, Math.round(v));
ipcMain.handle('screenshot:capture-rect', (_e, rect) => {
  if (!mainWin) return null;
  return mainWin.webContents
    .capturePage({ x: _ZERO(rect.x), y: _ZERO(rect.y), width: _ZERO(rect.width), height: _ZERO(rect.height) })
    .then(img => img.toPNG().toString('base64'))
    .catch(() => null);
});

// ── IPC: Vollbild-Modus ──────────────────────────────────────────────────────
ipcMain.handle('window:setFullScreen', (_e, flag) => {
  mainWin?.setFullScreen(!!flag);
});

function exitFullScreen() {
  if (mainWin?.isFullScreen()) mainWin.setFullScreen(false);
}
