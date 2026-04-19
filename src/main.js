import { app, BrowserWindow, ipcMain, screen, session, Menu, globalShortcut, webContents, net, shell, dialog } from 'electron';
import path    from 'path';
import fs      from 'fs';
import { fileURLToPath } from 'url';
import updaterPkg from 'electron-updater';
import { initPushBridge } from './push-bridge.js';
const { autoUpdater } = updaterPkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Auf Linux fehlt oft das SUID-Sandbox-Setup → no-sandbox als Fallback.
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');

{
  const _kp = path.join(app.getPath('userData'), 'api-keys.json');
  try {
    const _k = JSON.parse(fs.readFileSync(_kp, 'utf8'));
    // Der google-api-key-Switch allein genügt Electron nicht (kein GCM-Treiber).
    // push-bridge.js übernimmt das FCM-Protokoll komplett in Node.js.
    if (_k.apiKey) app.commandLine.appendSwitch('google-api-key', _k.apiKey);
  } catch { /* api-keys.json fehlt noch, push-bridge arbeitet trotzdem */ }
}

let mainWin = null;

app.whenReady().then(() => {
  setupSession(session.fromPartition('persist:desktop', { cache: true }));
  initPushBridge();
  createMainWindow();

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
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    // ERR_ABORTED (-3) taucht bei Auth-Redirects auf – harmlos.
    contents.on('did-fail-load', (_e, code) => { if (code === -3) return; });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });

  if (app.isPackaged) {
    autoUpdater.autoDownload         = true;
    autoUpdater.autoInstallOnAppQuit = true;

    // Internen Logger von electron-updater stumm schalten – verhindert den
    // "Error: Cannot find latest-*.yml"-Block der vom Paket selbst protokolliert wird.
    autoUpdater.logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, silly: () => {}, verbose: () => {} };

    autoUpdater.on('update-available', info => {
      mainWin?.webContents.send('updater:available', info.version);
    });
    autoUpdater.on('update-downloaded', info => {
      mainWin?.webContents.send('updater:downloaded', info.version);
    });
    autoUpdater.on('error', err => {
      const msg = String(err?.message ?? err);
      if (/no published versions/i.test(msg)) return;
      if (/Cannot find latest/i.test(msg)) return;
      if (/404/i.test(msg)) return;
      console.log('[updater]', msg);
    });

    autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

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
      webviewTag: true,
    },
  });

  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));

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

  mainWin.webContents.on('render-process-gone', (_e, details) => {
    console.error('[Blickfang] Renderer crashed:', details.reason, details.exitCode);
  });
  mainWin.webContents.on('did-fail-load', (_e, code, desc, url) => {
    if (code === -3) return; // ERR_ABORTED – harmlos bei Redirects
    console.error('[Blickfang] did-fail-load:', code, desc, url);
  });

  if (!app.isPackaged) mainWin.webContents.openDevTools();

  mainWin.on('resize', () => mainWin?.webContents.send('window:resized'));

  globalShortcut.register('F11', () => {
    if (mainWin) mainWin.setFullScreen(!mainWin.isFullScreen());
  });

  mainWin.on('enter-full-screen', () => {
    mainWin?.webContents.send('window:fullscreen', true);
    globalShortcut.register('Escape', exitFullScreen); // nur im Vollbild, sonst stört Escape
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

const ALLOWED_PERMISSIONS = new Set([
  'notifications', 'push', 'media', 'mediaKeySystem',
  'geolocation', 'clipboard-read', 'clipboard-sanitized-write',
  'fullscreen', 'openExternal',
]);

function setupSession(ses) {
  // Preload für alle Seiten in dieser Session (also Webview-Inhalte).
  // Überschreibt PushManager.subscribe() mit unserer FCM-Bridge.
  ses.setPreloads([path.join(__dirname, 'push-webview-preload.js')]);

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

const _keysPath = path.join(app.getPath('userData'), 'api-keys.json');
ipcMain.handle('keys:load', () => {
  try {
    const raw = fs.readFileSync(_keysPath);
    return JSON.parse(raw.toString());
  } catch { return {}; }
});

ipcMain.handle('keys:save', (_e, keys) => {
  try {
    fs.writeFileSync(_keysPath, JSON.stringify(keys));
    return true;
  } catch { return false; }
});

ipcMain.handle('panel:setViewport', async (_e, { wvId, w, h, mobile, ua }) => {
  const wc = webContents.fromId(wvId);
  if (!wc || wc.isDestroyed()) return;
  if (ua) wc.setUserAgent(ua);

  if (mobile) {
    wc.enableDeviceEmulation({
      screenPosition:    'mobile',
      screenSize:        { width: w, height: h },
      viewPosition:      { x: 0, y: 0 },
      deviceScaleFactor: 0,
      scale:             1,
    });
    if (!wc.debugger.isAttached()) {
      try { wc.debugger.attach('1.3'); } catch (_) { /* already attached */ }
    }
    if (wc.debugger.isAttached()) {
      await wc.debugger.sendCommand('Emulation.setTouchEmulationEnabled', {
        enabled: true, maxTouchPoints: 5,
      }).catch(() => {});
    }
  } else {
    wc.disableDeviceEmulation();
    if (wc.debugger.isAttached()) {
      await wc.debugger.sendCommand('Emulation.setTouchEmulationEnabled', {
        enabled: false, maxTouchPoints: 0,
      }).catch(() => {});
    }
  }
});

ipcMain.handle('workspace:getBounds', () => {
  if (!mainWin) return null;
  const [winW, winH] = mainWin.getContentSize();
  const fullscreen    = mainWin.isFullScreen();
  const topOffset     = fullscreen ? 0 : 110;  // header 60 + device-bar 50
  const bottomOffset  = fullscreen ? 0 : 60;   // toolbar
  return { x: 0, y: topOffset, width: winW, height: winH - topOffset - bottomOffset };
});

const _ZERO = v => Math.max(0, Math.round(v));
ipcMain.handle('screenshot:capture-rect', (_e, rect) => {
  if (!mainWin) return null;
  return mainWin.webContents
    .capturePage({ x: _ZERO(rect.x), y: _ZERO(rect.y), width: _ZERO(rect.width), height: _ZERO(rect.height) })
    .then(img => img.toPNG().toString('base64'))
    .catch(() => null);
});

// Direkt die WebContents eines beliebigen Webview capen
ipcMain.handle('screenshot:capture-wv', (_e, wvId) => {
  const wc = webContents.fromId(wvId);
  if (!wc) return null;
  return wc.capturePage()
    .then(img => img.toPNG().toString('base64'))
    .catch(() => null);
});

// Desktop-Webview: Viewport per enableDeviceEmulation auf Zielgröße forcieren,
// dann capen, dann Emulation wieder deaktivieren – alles im Main-Prozess,
// keine CSS-Manipulation und kein Polling aus dem Renderer nötig.
ipcMain.handle('screenshot:capture-desktop-wv', async (_e, wvId) => {
  const wc = webContents.fromId(wvId);
  if (!wc || wc.isDestroyed() || !mainWin) return null;
  const [winW, winH] = mainWin.getContentSize();
  const fullscreen   = mainWin.isFullScreen();
  const topOffset    = fullscreen ? 0 : 110;  // header 60 + device-bar 50
  const botOffset    = fullscreen ? 0 : 60;   // toolbar
  const captureH     = winH - topOffset;       // Workspace + Toolbar (= was der Benutzer sieht)
  const wsH          = winH - topOffset - botOffset; // nur Workspace (ohne Toolbar)
  try {
    wc.enableDeviceEmulation({
      screenPosition:    'desktop',
      screenSize:        { width: winW, height: captureH },
      viewPosition:      { x: 0, y: 0 },
      deviceScaleFactor: 0,
      scale:             1,
    });
    // Kurz warten bis der Gast-Prozess den neuen Viewport gerendert hat
    await new Promise(r => setTimeout(r, 350));
    const img = await wc.capturePage();
    return { png: img.toPNG().toString('base64'), w: winW, h: captureH, wsH };
  } catch { return null; }
  finally {
    try { wc.disableDeviceEmulation(); } catch { /* ignore */ }
  }
});

ipcMain.handle('window:setFullScreen', (_e, flag) => {
  mainWin?.setFullScreen(!!flag);
});

ipcMain.on('updater:install', () => {
  autoUpdater.quitAndInstall();
});

// Neustart nach Schlüssel-Konfiguration – commandLine.appendSwitch() wirkt nur
// beim nächsten Prozess-Start, daher app.relaunch() + app.exit().
ipcMain.handle('app:restart', () => {
  app.relaunch();
  app.exit(0);
});

// Zeigt einen nativen „Speichern unter"-Dialog und schreibt dann die Datei.
// Funktioniert auf Linux, macOS und Windows gleich: pro Datei ein Dialog.
ipcMain.handle('screenshot:save', async (_e, { b64, filename }) => {
  const safe = path.basename(filename).replace(/[^\w\-. ]/g, '_');
  const { canceled, filePath: dest } = await dialog.showSaveDialog(mainWin, {
    title:       'Screenshot speichern',
    defaultPath: path.join(app.getPath('downloads'), safe),
    filters:     [{ name: 'PNG-Bilder', extensions: ['png'] }],
  });
  if (canceled || !dest) return { ok: false, canceled: true };
  const buf = Buffer.from(b64, 'base64');
  return fs.promises.writeFile(dest, buf)
    .then(() => ({ ok: true, path: dest }))
    .catch(err => ({ ok: false, error: err.message }));
});

// Öffnet externe Links im System-Browser – nur https: und mailto: erlaubt.
ipcMain.handle('shell:openExternal', (_e, url) => {
  let parsed;
  try { parsed = new URL(url); } catch { return; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'mailto:') return;
  shell.openExternal(url);
});

// Laufzeit-Diagnose: Zeigt, welche Schlüssel beim Start tatsächlich geladen
// wurden und ob die commandLine-Switches gesetzt sind.
ipcMain.handle('keys:diagnose', async () => {
  const ses = session.fromPartition('persist:desktop');
  const sessionStoragePath = ses.storagePath;

  // GCM Store liegt im tatsächlichen storagePath der Session (nicht angenommener Pfad)
  const gcmStorePath    = sessionStoragePath ? path.join(sessionStoragePath, 'GCM Store') : '(kein storagePath)';
  const gcmStoreExists  = sessionStoragePath ? fs.existsSync(gcmStorePath) : false;

  // FCM-Erreichbarkeit aus der persist:desktop-Session testen.
  const fcmTest = await new Promise(resolve => {
    try {
      const req = net.request({
        method:  'GET',
        url:     'https://fcm.googleapis.com/',
        session: session.fromPartition('persist:desktop'),
      });
      const t = setTimeout(() => resolve({ ok: false, error: 'timeout (5s)' }), 5000);
      req.on('response', res => { clearTimeout(t); resolve({ ok: true, status: res.statusCode }); });
      req.on('error',    err => { clearTimeout(t); resolve({ ok: false, error: err.message }); });
      req.end();
    } catch (e) { resolve({ ok: false, error: e.message }); }
  });

  // GCM Checkin-Endpunkt testen (dieser Schritt initialisiert den GCM-Treiber)
  const checkinTest = await new Promise(resolve => {
    try {
      const req = net.request({
        method:  'POST',
        url:     'https://android.clients.google.com/checkin',
        session: session.fromPartition('persist:desktop'),
      });
      const t = setTimeout(() => resolve({ ok: false, error: 'timeout (5s)' }), 5000);
      req.on('response', res => { clearTimeout(t); resolve({ ok: true, status: res.statusCode }); });
      req.on('error',    err => { clearTimeout(t); resolve({ ok: false, error: err.message }); });
      req.end();
    } catch (e) { resolve({ ok: false, error: e.message }); }
  });

  return {
    userData:         app.getPath('userData'),
    keysFile:         _keysPath,
    hasApiKey:        app.commandLine.hasSwitch('google-api-key'),
    apiKeyPrefix:     app.commandLine.getSwitchValue('google-api-key').slice(0, 8) || '(leer)',
    sessionStorePath: sessionStoragePath ?? '(null)',
    gcmStoreExists,
    gcmStorePath,
    fcmReachable:     fcmTest.ok,
    fcmResult:        fcmTest.ok ? `HTTP ${fcmTest.status}` : `FEHLER: ${fcmTest.error}`,
    checkinReachable: checkinTest.ok,
    checkinResult:    checkinTest.ok ? `HTTP ${checkinTest.status}` : `FEHLER: ${checkinTest.error}`,
    electron:         process.versions.electron,
    chrome:           process.versions.chrome,
    platform:         process.platform,
  };
});

// Service-Worker + GCM-State der persist:desktop-Session löschen,
// damit Push-Subscription beim nächsten Besuch neu registriert wird.
ipcMain.handle('session:clearPush', async () => {
  const ses = session.fromPartition('persist:desktop');
  await ses.clearStorageData({ storages: ['serviceworkers'] });
  return true;
});

function exitFullScreen() {
  if (mainWin?.isFullScreen()) mainWin.setFullScreen(false);
}
