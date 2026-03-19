/**
 * push-webview-preload.js
 *
 * Wird über session.setPreloads() in jede Seite der persist:desktop-Session
 * injiziert. Läuft in der isolierten Welt, schleust per <script>-Tag Code in
 * die Hauptwelt ein, der PushManager.prototype.subscribe überschreibt.
 *
 * Ablauf:
 *   1. Website ruft PushManager.subscribe({ applicationServerKey }) auf
 *   2. Chromium scheitert (kein GCM-Treiber) → Fehler wird abgefangen
 *   3. applicationServerKey (VAPID Public Key) wird als base64url extrahiert
 *   4. IPC-Aufruf push:register → Hauptprozess registriert bei FCM
 *   5. Fake-PushSubscription mit echtem FCM-Endpoint wird zurückgegeben
 *   6. Website sendet Subscription an ihren Server → Server schickt Pushes
 *      an den FCM-Endpoint → Hauptprozess empfängt → OS-Notification
 *
 * Das funktioniert für jede Website, weil VAPID ein offener Standard ist.
 * Der Website-Server kennt nur Endpoint + Keys – mehr braucht er nicht.
 */

'use strict';

var { ipcRenderer, contextBridge } = require('electron');

// Bridge-Funktion in die Hauptwelt exponieren
contextBridge.exposeInMainWorld('__electronPush__', {
  /**
   * vapidKey: base64url-String des VAPID Public Keys der Website
   * gibt Promise<{ endpoint, keys: { p256dh, auth } }> oder null zurück
   */
  register: function (vapidKey) {
    return ipcRenderer.invoke('push:register', { vapidKey });
  },
});

// Code für die Hauptwelt (PushManager-Override)
var MAIN_WORLD_CODE = /* JavaScript */ `
(function () {
  if (!window.__electronPush__) return;

  // ── Hilfsfunktionen ───────────────────────────────────────────────────────

  function bufferToBase64url(buf) {
    var bytes = new Uint8Array(buf);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin)
      .replace(/=/g, '')
      .replace(/\\+/g, '-')
      .replace(/\\//g, '_');
  }

  function b64urlToBuffer(str) {
    var b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    var bin = atob(b64);
    var buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }

  /**
   * Normalisiert applicationServerKey zu einem base64url-String.
   * Akzeptiert: Uint8Array, ArrayBuffer, base64url-String.
   */
  function toVapidBase64url(key) {
    if (!key) return null;
    if (typeof key === 'string') {
      return key.replace(/=/g, '').replace(/\\+/g, '-').replace(/\\//g, '_');
    }
    if (key instanceof ArrayBuffer) return bufferToBase64url(key);
    if (ArrayBuffer.isView(key)) {
      var view = new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
      return bufferToBase64url(view.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength));
    }
    return null;
  }

  function makeFakeSub(creds) {
    var p256dh = b64urlToBuffer(creds.keys.p256dh);
    var auth   = b64urlToBuffer(creds.keys.auth);
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
        try {
          var keyPrefix = creds.keys.p256dh.slice(0, 32);
          localStorage.removeItem('__epush__:' + keyPrefix);
        } catch (_) {}
        return Promise.resolve(true);
      },
    };
  }

  // ── PushManager.prototype.subscribe überschreiben ─────────────────────────

  var _origSubscribe       = PushManager.prototype.subscribe;
  var _origGetSubscription = PushManager.prototype.getSubscription;

  PushManager.prototype.subscribe = function (opts) {
    var self = this;

    return Promise.resolve()
      .then(function () { return _origSubscribe.call(self, opts); })
      .catch(function (e) {
        var msg = e && e.message ? e.message : '';
        // Alle anderen Fehler (z.B. Permission denied) direkt weiterwerfen
        if (!msg.includes('push service not available') &&
            !msg.includes('Registration failed') &&
            !msg.includes('GCM')) {
          throw e;
        }

        // VAPID-Key aus opts extrahieren
        var vapidKey = toVapidBase64url(opts && opts.applicationServerKey);
        if (!vapidKey) {
          console.warn('[Blickfang-Push] Kein applicationServerKey in subscribe() – Bridge kann nicht helfen');
          throw e;
        }

        // Im localStorage nach gecachter Subscription suchen
        var cacheKey = '__epush__:' + vapidKey.slice(0, 32);
        try {
          var stored = localStorage.getItem(cacheKey);
          if (stored) {
            var parsed = JSON.parse(stored);
            console.log('[Blickfang-Push] Gecachte Subscription geladen für ' + location.origin);
            return makeFakeSub(parsed);
          }
        } catch (_) {}

        // Neue Registrierung über Bridge anfordern
        console.log('[Blickfang-Push] Registriere via FCM-Bridge für ' + location.origin + ' (VAPID: ' + vapidKey.slice(0, 16) + '…)');
        return window.__electronPush__.register(vapidKey).then(function (creds) {
          if (!creds) {
            throw new DOMException(
              'Push-Bridge nicht verfügbar – Firebase-Konfiguration in den Einstellungen prüfen',
              'AbortError'
            );
          }
          // Subscription cachen
          try { localStorage.setItem(cacheKey, JSON.stringify(creds)); } catch (_) {}
          console.log('[Blickfang-Push] Subscription bereit:', creds.endpoint.slice(0, 60) + '…');
          return makeFakeSub(creds);
        });
      });
  };

  // ── PushManager.prototype.getSubscription überschreiben ──────────────────

  PushManager.prototype.getSubscription = function () {
    var self = this;
    return Promise.resolve()
      .then(function () { return _origGetSubscription.call(self); })
      .then(function (native) {
        if (native) return native;
        // Keine native Subscription – localStorage nach Bridge-Sub durchsuchen
        try {
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && k.startsWith('__epush__:')) {
              var stored = localStorage.getItem(k);
              if (stored) return makeFakeSub(JSON.parse(stored));
            }
          }
        } catch (_) {}
        return null;
      })
      .catch(function () { return null; });
  };

  console.log('[Blickfang-Push] Bridge aktiv für ' + location.origin);
})();
`;

// Skript-Tag in die Hauptwelt einschleusen
var script = document.createElement('script');
script.textContent = MAIN_WORLD_CODE;
document.documentElement.appendChild(script);
script.remove();
