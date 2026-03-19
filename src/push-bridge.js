/**
 * push-bridge.js – FCM-Bridge für Web-Push in Electron.
 *
 * Electron's Chromium-Build hat keinen GCM-Treiber → PushManager.subscribe()
 * schlägt mit "push service not available" fehl. Diese Bridge implementiert
 * das Web-Push-Protokoll vollständig in Node.js via @eneris/push-receiver.
 *
 * Pro VAPID-Key (= pro Website) wird eine eigene PushReceiver-Instanz angelegt.
 * Credentials werden gecacht, sodass nach Neustart keine Re-Registrierung nötig.
 *
 * Benötigt in api-keys.json: apiKey, appId, projectId, messagingSenderId
 * (alle aus der Firebase-Konsole, Projekteinstellungen → Deine Apps → Web-App).
 */

import path from 'path';
import fs   from 'fs';
import { app, ipcMain, Notification, BrowserWindow } from 'electron';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const { PushReceiver } = _require('@eneris/push-receiver');

// vapidKey → { receiver, creds }
const _receivers = new Map();
let _firebaseConfig = null;

function _credsDir() {
  const d = path.join(app.getPath('userData'), 'push-creds');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function _credsFile(vapidKey) {
  const safe = vapidKey.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  return path.join(_credsDir(), `${safe}.json`);
}

function _loadCreds(vapidKey) {
  try { return JSON.parse(fs.readFileSync(_credsFile(vapidKey), 'utf8')); }
  catch { return null; }
}

function _saveCreds(vapidKey, creds) {
  try { fs.writeFileSync(_credsFile(vapidKey), JSON.stringify(creds)); }
  catch (e) { console.error('[Push] Credentials speichern fehlgeschlagen:', e.message); }
}

function _pidsFile(vapidKey) {
  const safe = vapidKey.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  return path.join(_credsDir(), `${safe}.pids.json`);
}

function _loadPersistentIds(vapidKey) {
  try { return JSON.parse(fs.readFileSync(_pidsFile(vapidKey), 'utf8')); }
  catch { return []; }
}

function _savePersistentId(vapidKey, pid) {
  if (!pid) return;
  try {
    const current = _loadPersistentIds(vapidKey);
    // De-duplizieren, maximal 200 IDs behalten (verhindert unbegrenztes Wachstum)
    const updated = [...new Set([...current, pid])].slice(-200);
    fs.writeFileSync(_pidsFile(vapidKey), JSON.stringify(updated));
  } catch (e) {
    console.error('[Push] persistentIds speichern fehlgeschlagen:', e.message);
  }
}

function _loadFirebaseConfig() {
  try {
    const kp = path.join(app.getPath('userData'), 'api-keys.json');
    const k  = JSON.parse(fs.readFileSync(kp, 'utf8'));
    if (!k.apiKey || !k.appId || !k.projectId || !k.messagingSenderId) return null;
    return {
      apiKey:            k.apiKey,
      appId:             k.appId,
      projectId:         k.projectId,
      messagingSenderId: k.messagingSenderId,
    };
  } catch {
    return null;
  }
}

/**
 * Baut aus den @eneris/push-receiver-Credentials ein PushSubscription-
 * kompatibles Objekt, das dem Webview zurückgegeben wird.
 */
function _serializeSub(creds) {
  const gcmToken = creds?.gcm?.token;
  if (!gcmToken) return null;
  return {
    // Endpoint für Web-Push-Zustellung (legacy format, unterstützt von allen Servern)
    endpoint: `https://fcm.googleapis.com/fcm/send/${gcmToken}`,
    keys: {
      p256dh: creds.keys.publicKey,   // bereits base64url (von @eneris/push-receiver)
      auth:   creds.keys.authSecret,  // bereits base64url
    },
  };
}

async function _getOrCreateReceiver(vapidKey) {
  if (_receivers.has(vapidKey)) return _receivers.get(vapidKey);

  const savedCreds = _loadCreds(vapidKey);
  // Bereits gesehene Nachricht-IDs laden → MCS liefert diese nicht erneut aus.
  // Ohne persistente IDs: jede Verbindung empfängt alle Nachrichten neu (bis 4 Wochen).
  const savedPids  = _loadPersistentIds(vapidKey);

  const receiver = new PushReceiver({
    debug:         false,
    firebase:      _firebaseConfig,
    vapidKey,
    credentials:   savedCreds ?? undefined,
    persistentIds: savedPids,
  });

  // Neue Credentials (nach Re-Registrierung) sofort speichern
  receiver.onCredentialsChanged(({ newCredentials }) => {
    _saveCreds(vapidKey, newCredentials);
    console.log('[Push] Credentials aktualisiert für', vapidKey.slice(0, 16) + '…');
  });

  // Eingehende Push-Nachrichten → OS-Notification
  receiver.onNotification((notification) => {
    // persistentId merken: verhindert Re-Zustellung nach Neustart/Reconnect
    _savePersistentId(vapidKey, notification?.persistentId);
    // @eneris/push-receiver liefert: { message: {...decrypted payload...}, persistentId, ... }
    // Das Payload-Format kann je nach Website variieren:
    //   { notification: { title, body, icon } } – Standard-Format
    //   { title, body, icon }                   – direktes Objekt
    //   { data: { title, body } }               – data-only
    const msg = notification?.message ?? notification ?? {};
    const n   = msg.notification ?? {};
    const d   = msg.data ?? {};
    const title = n.title ?? d.title ?? msg.title ?? 'Blickfang';
    const body  = n.body  ?? d.body  ?? msg.body  ?? d.message ?? msg.message ?? '';
    const icon  = n.icon  ?? d.icon  ?? msg.icon;
    console.log('[Push] Nachricht empfangen:', title);

    const notif = new Notification({
      title,
      body,
      ...(icon ? { icon } : {}),
    });
    notif.show();
    notif.on('click', () => {
      const [win] = BrowserWindow.getAllWindows();
      if (win) { win.show(); win.focus(); }
    });
  });

  // Registrierung bei GCM/FCM mit dem VAPID-Key der anfragenden Website.
  // registerIfNeeded() gibt Credentials zurück (aus Cache oder neu registriert).
  const creds = await receiver.registerIfNeeded();

  // TCP-Verbindung für eingehende Pushes im Hintergrund aufbauen
  receiver.connect().catch(e =>
    console.error('[Push] Verbindungsfehler für', vapidKey.slice(0, 16) + '…:', e.message)
  );

  const entry = { receiver, creds };
  _receivers.set(vapidKey, entry);
  return entry;
}

export function initPushBridge() {
  _firebaseConfig = _loadFirebaseConfig();
  if (!_firebaseConfig) {
    console.warn('[Push] Firebase-Konfiguration unvollständig – Push-Bridge inaktiv.');
    console.warn('[Push] Bitte apiKey, appId, projectId, messagingSenderId in den Einstellungen eintragen.');
  } else {
    console.log('[Push] Bridge initialisiert. Projekt:', _firebaseConfig.projectId);
  }

  /**
   * Wird von push-webview-preload.js aufgerufen wenn PushManager.subscribe() läuft.
   * vapidKey: base64url-kodierter VAPID Public Key der Website.
   * Gibt { endpoint, keys: { p256dh, auth } } zurück oder null bei Fehler.
   */
  ipcMain.handle('push:register', async (_e, { vapidKey }) => {
    if (!_firebaseConfig) {
      // Nutzer informieren, dass die Konfiguration fehlt
      BrowserWindow.getAllWindows()[0]?.webContents.send('push:needs-config');
      return null;
    }
    if (!vapidKey || typeof vapidKey !== 'string') {
      console.warn('[Push] push:register ohne VAPID-Key aufgerufen');
      return null;
    }
    try {
      const { creds } = await _getOrCreateReceiver(vapidKey);
      const sub = _serializeSub(creds);
      console.log('[Push] Subscription bereit:', sub?.endpoint?.slice(0, 60) + '…');
      return sub;
    } catch (e) {
      console.error('[Push] Registrierung fehlgeschlagen:', e.message);
      return null;
    }
  });

  // Renderer kann abfragen ob Firebase-Config vorhanden
  ipcMain.handle('push:configured', () => !!_firebaseConfig);
}
