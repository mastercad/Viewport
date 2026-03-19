/**
 * push-webview-preload.js
 *
 * Wird über session.setPreloads() in jede Seite der persist:desktop-Session
 * injiziert (also in den Inhalt jedes Webviews).
 *
 * Läuft in der isolierten Welt (isolated world) mit Zugriff auf Electron-APIs.
 * Injiziert Code via webFrame.executeJavaScript() in die Hauptwelt (main world),
 * der PushManager.prototype.subscribe / getSubscription überschreibt und bei
 * "push service not available" unsere FCM-Bridge nutzt.
 * webFrame.executeJavaScript() umgeht die Content-Security-Policy der Seite –
 * auch wenn der Service Worker die Seite aus seinem Cache bedient.
 */

'use strict';

var { ipcRenderer, contextBridge, webFrame } = require('electron');

// Exponiert die Bridge-Funktion in der Hauptwelt.
// try-catch: Falls das Preload für dieselbe Seite mehrfach ausgeführt wird
// (z.B. nach In-Page-Navigation), darf das nicht abstürzen.
try {
  contextBridge.exposeInMainWorld('__electronPush__', {
    register: function (vapidKey) {
      return ipcRenderer.invoke('push:register', { vapidKey });
    },
  });
} catch (_) { /* Bereits exponiert – kein Problem */ }

// Code, der in der Hauptwelt läuft (PushManager-Override)
var MAIN_WORLD_CODE = /* JavaScript */ `
(function () {
  if (!window.__electronPush__) return;

  // ── Hilfsfunktionen ───────────────────────────────────────────
  function b64urlToBuffer(str) {
    var b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    var bin = atob(b64);
    var buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }

  // applicationServerKey → base64url-String (akzeptiert ArrayBuffer, Uint8Array, String)
  function toVapidBase64url(key) {
    if (!key) return null;
    var bytes;
    if (typeof key === 'string') {
      // schon base64url oder base64
      return key.replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    }
    bytes = key instanceof Uint8Array ? key : new Uint8Array(key);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  }

  function makeFakeSub(creds) {
    var p256dh = b64urlToBuffer(creds.keys.p256dh);
    var auth   = b64urlToBuffer(creds.keys.auth);
    var cacheKey = '__epush__:' + creds.vapidKey.slice(0, 32);
    return {
      endpoint:       creds.endpoint,
      expirationTime: null,
      getKey: function (name) {
        if (name === 'p256dh') return p256dh;
        if (name === 'auth')   return auth;
        return null;
      },
      toJSON: function () {
        return {
          endpoint:       creds.endpoint,
          expirationTime: null,
          keys: { p256dh: creds.keys.p256dh, auth: creds.keys.auth },
        };
      },
      unsubscribe: function () {
        try { localStorage.removeItem(cacheKey); } catch (_) {}
        return Promise.resolve(true);
      },
    };
  }

  // ── PushManager überschreiben ──────────────────────────────────
  var _origSubscribe       = PushManager.prototype.subscribe;
  var _origGetSubscription = PushManager.prototype.getSubscription;

  PushManager.prototype.subscribe = function (opts) {
    var self = this;
    return _origSubscribe.call(self, opts).catch(function (e) {
      var msg = e && e.message ? e.message : '';
      if (!msg.includes('push service not available') &&
          !msg.includes('Registration failed')) {
        throw e;
      }
      // Chromium-GCM nicht verfügbar → FCM-Bridge nutzen
      var vapidKey = toVapidBase64url(opts && opts.applicationServerKey);
      if (!vapidKey) throw new DOMException('Kein applicationServerKey angegeben', 'AbortError');

      // Cache prüfen (localStorage, pro vapidKey)
      var cacheKey = '__epush__:' + vapidKey.slice(0, 32);
      try {
        var stored = localStorage.getItem(cacheKey);
        if (stored) {
          var cached = JSON.parse(stored);
          cached.vapidKey = vapidKey;
          // MCS-Verbindung im Hintergrund sicherstellen (idempotent – kein Re-Registrieren)
          _ensureConnected(vapidKey);
          return Promise.resolve(makeFakeSub(cached));
        }
      } catch (_) { /* ignore */ }

      return window.__electronPush__.register(vapidKey).then(function (creds) {
        if (!creds) throw new DOMException('Push bridge nicht verfügbar', 'AbortError');
        creds.vapidKey = vapidKey;
        try { localStorage.setItem(cacheKey, JSON.stringify(creds)); } catch (_) {}
        return makeFakeSub(creds);
      });
    });
  };

  // Interne Hilfsfunktion: stellt MCS-Verbindung sicher ohne neue Registrierung
  function _ensureConnected(vapidKey) {
    if (!vapidKey || vapidKey.length <= 32) return; // kein voller VAPID-Key verfügbar
    window.__electronPush__.register(vapidKey).catch(function () {});
  }

  PushManager.prototype.getSubscription = function () {
    var self = this;
    return _origGetSubscription.call(self).then(function (native) {
      if (native) return native;
      // Suche gespeicherte Bridge-Sub in localStorage
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (!k || !k.startsWith('__epush__:')) continue;
          var stored = localStorage.getItem(k);
          if (!stored) continue;
          var creds = JSON.parse(stored);
          // Voller VAPID-Key aus dem JSON bevorzugen (87 Zeichen base64url);
          // Fallback: 32-Zeichen-Prefix aus dem localStorage-Schlüsselnamen
          var storedVapidKey = (typeof creds.vapidKey === 'string' && creds.vapidKey.length > 32)
            ? creds.vapidKey : null;
          creds.vapidKey = storedVapidKey || k.slice('__epush__:'.length);
          // MCS-Verbindung im Hintergrund sicherstellen (nur wenn voller Key vorhanden)
          _ensureConnected(storedVapidKey);
          return makeFakeSub(creds);
        }
      } catch (_) { /* ignore */ }
      return null;
    }).catch(function () {
      return null;
    });
  };

  console.log('[Blickfang] Push-Bridge aktiv (' + location.origin + ')');
})();
`;

// Code via webFrame.executeJavaScript() in die Hauptwelt injizieren.
// Vorteil gegenüber <script>-Tag: umgeht die Content-Security-Policy der Seite
// auch dann, wenn diese durch einen Service Worker aus dem Cache bedient wird
// (SW-Responses gehen nicht durch Electrons webRequest.onHeadersReceived).
webFrame.executeJavaScript(MAIN_WORLD_CODE).catch(function (e) {
  console.warn('[Push] Preload-Injektion fehlgeschlagen:', e && e.message);
});
