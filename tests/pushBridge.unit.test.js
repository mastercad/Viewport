/**
 * pushBridge.unit.test.js
 *
 * Unit-Tests für die reine Logik in push-bridge.js.
 *
 * Da push-bridge.js Electron-APIs und @eneris/push-receiver importiert,
 * werden die testbaren reinen Funktionen via Quellcode-Extraktion isoliert:
 *
 *  _serializeSub(creds)     – konvertiert @eneris-Credentials in Web-Push-Format
 *  Notification-Payload     – extrahiert Titel/Body/Icon aus allen Payload-Formaten
 *  Firebase-Config-Check    – prüft ob alle 4 Pflichtfelder vorhanden sind
 *  _credsFile Sanitierung   – schützt vor Path-Traversal im Dateinamen
 *
 * Außerdem: statische Quellcode-Analysen von push-bridge.js auf kritische
 * Invarianten (Endpoint-Format, Feldnamen, Config-Validierung).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// ── Quellcode laden und reine Funktionen extrahieren ─────────────────────────

const src = readFileSync(
  new URL('../src/push-bridge.js', import.meta.url),
  'utf8',
);

/**
 * Extrahiert eine named function aus dem Quellcode via Klammertiefenzählung.
 * Gibt die Funktion ausgewerted zurück (eval in isoliertem Scope).
 */
function extractFn(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Funktion "${name}" nicht in push-bridge.js gefunden`);
  const slice = source.slice(start);
  let depth = 0;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] === '{') depth++;
    else if (slice[i] === '}' && --depth === 0) {
      // eslint-disable-next-line no-eval
      return eval(`(${slice.slice(0, i + 1)})`);
    }
  }
  throw new Error(`Kein schließendes } für "${name}" gefunden`);
}

/**
 * Extrahiert die Notification-Payload-Parsing-Logik aus dem onNotification-Handler.
 * Gibt eine Funktion(notification) → { title, body, icon } zurück.
 */
function extractNotifParser(source) {
  const start = source.indexOf('const msg = notification?.message');
  if (start === -1) throw new Error('Notification-Parser nicht in push-bridge.js gefunden');
  const end = source.indexOf("console.log('[Push] Nachricht empfangen:", start);
  if (end === -1) throw new Error('Ende des Notification-Parsers nicht gefunden');
  const logic = source.slice(start, end).trim();
  // eslint-disable-next-line no-new-func
  return new Function('notification', `${logic}\nreturn { title, body, icon };`);
}

const _serializeSub  = extractFn(src, '_serializeSub');
const parseNotif     = extractNotifParser(src);

// ── _serializeSub ─────────────────────────────────────────────────────────────

describe('_serializeSub(creds): @eneris-Credentials → Web-Push-Format', () => {
  const FAKE_TOKEN  = 'FAKE_GCM_TOKEN_12345';
  const FAKE_PUB    = 'BHMUIiedJilu4yFakePublicKeyBase64url';
  const FAKE_AUTH   = 'FakeAuthSecretBase64';

  function makeCreds(overrides = {}) {
    return {
      gcm:  { token: FAKE_TOKEN, ...overrides.gcm },
      keys: { publicKey: FAKE_PUB, authSecret: FAKE_AUTH, ...overrides.keys },
      ...overrides,
    };
  }

  it('gibt ein Objekt mit endpoint, keys.p256dh und keys.auth zurück', () => {
    const sub = _serializeSub(makeCreds());
    expect(sub).not.toBeNull();
    expect(sub).toHaveProperty('endpoint');
    expect(sub).toHaveProperty('keys.p256dh');
    expect(sub).toHaveProperty('keys.auth');
  });

  it('endpoint-Format ist https://fcm.googleapis.com/fcm/send/<token>', () => {
    // KRITISCH: Dieses Format (legacy FCM) muss 1:1 erhalten bleiben.
    // Alle Push-Server (kaderblick.de, etc.) senden an diesen Endpoint.
    const sub = _serializeSub(makeCreds());
    expect(sub.endpoint).toBe(`https://fcm.googleapis.com/fcm/send/${FAKE_TOKEN}`);
  });

  it('endpoint enthält exakt den GCM-Token aus creds.gcm.token', () => {
    const token = 'UNIQUE_TOKEN_XYZ_987';
    const sub = _serializeSub(makeCreds({ gcm: { token } }));
    expect(sub.endpoint).toContain(token);
    expect(sub.endpoint).not.toContain(FAKE_TOKEN);
  });

  it('keys.p256dh kommt aus creds.keys.publicKey (nicht privateKey!)', () => {
    // @eneris/push-receiver liefert publicKey – muss als p256dh weitergegeben werden
    const sub = _serializeSub(makeCreds());
    expect(sub.keys.p256dh).toBe(FAKE_PUB);
  });

  it('keys.auth kommt aus creds.keys.authSecret (nicht auth!)', () => {
    // @eneris/push-receiver liefert authSecret – muss als auth weitergegeben werden
    const sub = _serializeSub(makeCreds());
    expect(sub.keys.auth).toBe(FAKE_AUTH);
  });

  it('gibt null zurück wenn creds.gcm fehlt', () => {
    expect(_serializeSub({ keys: { publicKey: FAKE_PUB, authSecret: FAKE_AUTH } })).toBeNull();
  });

  it('gibt null zurück wenn creds.gcm.token fehlt', () => {
    expect(_serializeSub({ gcm: {}, keys: { publicKey: FAKE_PUB, authSecret: FAKE_AUTH } })).toBeNull();
  });

  it('gibt null zurück wenn creds null/undefined ist', () => {
    expect(_serializeSub(null)).toBeNull();
    expect(_serializeSub(undefined)).toBeNull();
  });

  it('gibt null zurück wenn creds.gcm.token leer ist', () => {
    expect(_serializeSub(makeCreds({ gcm: { token: '' } }))).toBeNull();
  });

  it('endpoint beginnt mit https:// (kein unsicheres http)', () => {
    const sub = _serializeSub(makeCreds());
    expect(sub.endpoint.startsWith('https://')).toBe(true);
  });

  it('gibt kein expirationTime-Feld zurück (nicht Teil des Web-Push-Formats)', () => {
    // Das Subscription-Objekt wird vom Service Worker erweitert – kein extra-Feld nötig
    const sub = _serializeSub(makeCreds());
    expect(Object.keys(sub)).toEqual(['endpoint', 'keys']);
  });
});

// ── Notification-Payload-Parsing ──────────────────────────────────────────────

describe('Notification-Payload-Parsing: alle Eingangsformate', () => {
  describe('Standard-Format: { message: { notification: { title, body, icon } } }', () => {
    const notification = {
      message: {
        notification: { title: 'Tor!', body: 'Das 1:0 ist gefallen', icon: '/icon.png' },
      },
    };

    it('title korrekt extrahiert', () => {
      expect(parseNotif(notification).title).toBe('Tor!');
    });

    it('body korrekt extrahiert', () => {
      expect(parseNotif(notification).body).toBe('Das 1:0 ist gefallen');
    });

    it('icon korrekt extrahiert', () => {
      expect(parseNotif(notification).icon).toBe('/icon.png');
    });
  });

  describe('Direktes Format: { message: { title, body } } (kein notification-Wrapper)', () => {
    const notification = {
      message: { title: 'Spielende', body: 'Abpfiff!' },
    };

    it('title korrekt extrahiert', () => {
      expect(parseNotif(notification).title).toBe('Spielende');
    });

    it('body korrekt extrahiert', () => {
      expect(parseNotif(notification).body).toBe('Abpfiff!');
    });

    it('icon ist undefined wenn nicht vorhanden', () => {
      expect(parseNotif(notification).icon).toBeUndefined();
    });
  });

  describe('Data-Format: { message: { data: { title, body } } }', () => {
    const notification = {
      message: { data: { title: 'Aufstellung', body: 'Neue Aufstellung bekannt' } },
    };

    it('title aus data korrekt extrahiert', () => {
      expect(parseNotif(notification).title).toBe('Aufstellung');
    });

    it('body aus data korrekt extrahiert', () => {
      expect(parseNotif(notification).body).toBe('Neue Aufstellung bekannt');
    });
  });

  describe('Body über data.message-Feld (manche Firebase-Payloads)', () => {
    const notification = {
      message: { data: { title: 'Info', message: 'Spiel beginnt in 5 Minuten' } },
    };

    it('body aus data.message extrahiert wenn data.body fehlt', () => {
      expect(parseNotif(notification).body).toBe('Spiel beginnt in 5 Minuten');
    });
  });

  describe('Kein message-Wrapper: notification direkt als Payload', () => {
    // Manche Versionen von @eneris/push-receiver liefern das Objekt direkt
    const notification = {
      notification: { title: 'Direktnachricht', body: 'Ohne message-Wrapper' },
    };

    it('title korrekt extrahiert', () => {
      expect(parseNotif(notification).title).toBe('Direktnachricht');
    });
  });

  describe('Fallback-Verhalten bei fehlendem Payload', () => {
    it('title fällt auf "Blickfang" zurück wenn nichts gesetzt', () => {
      expect(parseNotif({}).title).toBe('Blickfang');
      expect(parseNotif(null).title).toBe('Blickfang');
      expect(parseNotif({ message: {} }).title).toBe('Blickfang');
    });

    it('body fällt auf "" zurück wenn nichts gesetzt', () => {
      expect(parseNotif({}).body).toBe('');
      expect(parseNotif(null).body).toBe('');
    });

    it('icon ist undefined wenn nirgends gesetzt', () => {
      expect(parseNotif({}).icon).toBeUndefined();
    });
  });

  describe('Icon aus verschiedenen Formaten', () => {
    it('icon aus notification.icon', () => {
      expect(parseNotif({ message: { notification: { title: 'X', icon: '/n.png' } } }).icon).toBe('/n.png');
    });

    it('icon aus data.icon als Fallback', () => {
      expect(parseNotif({ message: { data: { title: 'X', icon: '/d.png' } } }).icon).toBe('/d.png');
    });

    it('icon direkt aus message.icon als letzter Fallback', () => {
      expect(parseNotif({ message: { title: 'X', icon: '/m.png' } }).icon).toBe('/m.png');
    });
  });
});

// ── Statische Integritätsprüfung push-bridge.js ───────────────────────────────

describe('push-bridge.js – Statische Integritätsprüfung', () => {
  describe('Firebase-Konfiguration: Pflichtfelder', () => {
    it('prüft alle 4 Pflichtfelder (apiKey, appId, projectId, messagingSenderId)', () => {
      // Fehlt auch nur eines → return null → Bridge inaktiv.
      // Wird für GCM/FCM-Registrierung benötigt.
      expect(src).toContain('!k.apiKey');
      expect(src).toContain('!k.appId');
      expect(src).toContain('!k.projectId');
      expect(src).toContain('!k.messagingSenderId');
    });

    it('gibt bei unvollständiger Config null zurück (nicht undefined oder leeres Objekt)', () => {
      expect(src).toMatch(/if\s*\(!k\.apiKey.*\|\|.*messagingSenderId[\s\S]{0,10}\)\s*return null/);
    });
  });

  describe('GCM-Token: Sicherheit und Format', () => {
    it('Endpoint-Basis ist https://fcm.googleapis.com/fcm/send/ (Legacy-Format)', () => {
      expect(src).toContain('https://fcm.googleapis.com/fcm/send/');
    });

    it('Endpoint verwendet Template-Literal mit gcmToken', () => {
      expect(src).toMatch(/`https:\/\/fcm\.googleapis\.com\/fcm\/send\/\$\{gcmToken\}`/);
    });
  });

  describe('Credentials-Dateipfad: Path-Traversal-Schutz', () => {
    it('vapidKey wird für Dateinamen sanitiert (nur alphanumerisch + _ + -)', () => {
      // Verhindert Angriffe wie vapidKey = "../../etc/passwd"
      expect(src).toMatch(/replace\(\/\[.*a-zA-Z0-9.*\]\/g,\s*''\)/);
    });

    it('Dateiname wird auf 40 Zeichen begrenzt', () => {
      expect(src).toContain('.slice(0, 40)');
    });

    it('Dateiendung ist .json (kein ausführbares Format)', () => {
      expect(src).toMatch(/`\$\{safe\}\.json`/);
    });
  });

  describe('push:register IPC-Handler', () => {
    it('push:register Handler ist registriert', () => {
      expect(src).toContain("ipcMain.handle('push:register'");
    });

    it('gibt null zurück wenn vapidKey fehlt oder kein String ist', () => {
      // Schutz vor Missbrauch des IPC-Kanals
      expect(src).toContain("typeof vapidKey !== 'string'");
    });

    it('gibt null zurück wenn Firebase-Config fehlt', () => {
      // Zwischen if (!_firebaseConfig) und return null steht ein BrowserWindow.send()-Aufruf
      expect(src).toMatch(/if\s*\(!_firebaseConfig\)[\s\S]{0,300}return null/);
    });

    it('Fehler in _getOrCreateReceiver werden gecatcht (kein unhandled rejection)', () => {
      expect(src).toMatch(/catch\s*\(e\)[\s\S]{0,100}return null/);
    });
  });

  describe('_receivers Map: Idempotenz (kein doppelter Receiver)', () => {
    it('prüft _receivers.has(vapidKey) vor neuer Instanz', () => {
      // Verhindert mehrfache MCS-Verbindungen für denselben VAPID-Key
      expect(src).toContain('_receivers.has(vapidKey)');
    });

    it('gibt bei Cache-Treffer direkt _receivers.get(vapidKey) zurück', () => {
      expect(src).toContain('_receivers.get(vapidKey)');
    });

    it('speichert neuen Receiver in _receivers nach connect()', () => {
      expect(src).toContain('_receivers.set(vapidKey, entry)');
    });
  });

  describe('Credentials-Persistenz', () => {
    it('onCredentialsChanged speichert neue Credentials', () => {
      // Nach GCM-Re-Registrierung müssen neue Credentials persistent sein
      expect(src).toContain('onCredentialsChanged');
      expect(src).toContain('_saveCreds(vapidKey, newCredentials)');
    });

    it('gespeicherte Credentials werden beim Start geladen', () => {
      expect(src).toContain('_loadCreds(vapidKey)');
    });
  });

  describe('persistentIds-Persistenz: keine Re-Zustellung alter Nachrichten', () => {
    it('_loadPersistentIds ist definiert', () => {
      // Verhindert Re-Zustellung bei Neustart (persistentIds: [] = "alle neu").
      expect(src).toContain('function _loadPersistentIds(');
    });

    it('_savePersistentId ist definiert', () => {
      expect(src).toContain('function _savePersistentId(');
    });

    it('gespeicherte persistentIds werden an PushReceiver übergeben (NICHT hardcodiertes [])', () => {
      // persistentIds: [] würde MCS anweisen, alle Nachrichten erneut zuzustellen.
      expect(src).toContain('persistentIds: savedPids');
      expect(src).not.toMatch(/persistentIds:\s*\[\]/);
    });

    it('_savePersistentId wird im onNotification-Handler aufgerufen', () => {
      // Jede empfangene Nachricht muss ihre ID persistent machen.
      expect(src).toMatch(/_savePersistentId\(vapidKey,\s*notification/);
    });

    it('IDs sind auf maximal 200 begrenzt (kein unbegrenztes Wachstum)', () => {
      expect(src).toMatch(/\.slice\(-200\)/);
    });

    it('De-Duplizierung via Set (keine doppelten IDs)', () => {
      expect(src).toContain('new Set([');
    });
  });
});

// ── _credsFile Sanitierung: Unit-Test der Sanitierungslogik ──────────────────

describe('_credsFile Sanitierung: Path-Traversal-Schutz', () => {
  // Die Sanitierungslogik direkt testen (ohne path.join da nicht exportiert)
  function sanitizeKey(vapidKey) {
    return vapidKey.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  }

  it('normaler VAPID-Key bleibt unverändert (nur alphanumerisch + - + _)', () => {
    const key = 'BDHMUIiedJilu4yABCDEFGHIJKLMNOPQRSTUVWXYZ12';
    expect(sanitizeKey(key)).toBe(key.slice(0, 40));
  });

  it('Path-Traversal "../" wird entfernt', () => {
    const malicious = '../../../etc/passwd';
    expect(sanitizeKey(malicious)).not.toContain('..');
    expect(sanitizeKey(malicious)).not.toContain('/');
  });

  it('Schrägstriche werden entfernt', () => {
    expect(sanitizeKey('abc/def/ghi')).toBe('abcdefghi');
  });

  it('Punkte werden entfernt', () => {
    expect(sanitizeKey('abc.def')).toBe('abcdef');
  });

  it('Leerzeichen werden entfernt', () => {
    expect(sanitizeKey('abc def')).toBe('abcdef');
  });

  it('Sonderzeichen <, >, ", \' werden entfernt', () => {
    expect(sanitizeKey('<script>alert("xss")</script>')).not.toMatch(/[<>"']/);
  });

  it('Ergebnis ist maximal 40 Zeichen lang', () => {
    const long = 'A'.repeat(100);
    expect(sanitizeKey(long).length).toBeLessThanOrEqual(40);
  });

  it('leerer Key ergibt leeren String (kein Crash)', () => {
    expect(sanitizeKey('')).toBe('');
  });
});

// ── persistentIds-Aktualisierungslogik: Unit-Test ─────────────────────────────

describe('persistentId-Akkumulation: Logik ohne Disk-I/O', () => {
  // Die Kernlogik aus _savePersistentId isoliert testen
  function accumulatePids(current, newPid, max = 200) {
    if (!newPid) return current;
    return [...new Set([...current, newPid])].slice(-max);
  }

  it('fügt neue ID zu leerer Liste hinzu', () => {
    expect(accumulatePids([], 'pid-001')).toEqual(['pid-001']);
  });

  it('fügt neue ID zu bestehender Liste hinzu', () => {
    const result = accumulatePids(['pid-001', 'pid-002'], 'pid-003');
    expect(result).toContain('pid-001');
    expect(result).toContain('pid-002');
    expect(result).toContain('pid-003');
  });

  it('ignoriert null/undefined (kein Crash, keine Änderung)', () => {
    expect(accumulatePids(['pid-001'], null)).toEqual(['pid-001']);
    expect(accumulatePids(['pid-001'], undefined)).toEqual(['pid-001']);
    expect(accumulatePids(['pid-001'], '')).toEqual(['pid-001']);
  });

  it('De-dupliziert: dieselbe ID wird nicht doppelt gespeichert', () => {
    const result = accumulatePids(['pid-001', 'pid-002'], 'pid-001');
    const occurrences = result.filter(id => id === 'pid-001').length;
    expect(occurrences).toBe(1);
  });

  it('begrenzt auf max 200 IDs (älteste werden verdrängt)', () => {
    const existing = Array.from({ length: 200 }, (_, i) => `pid-${i}`);
    const result = accumulatePids(existing, 'pid-new');
    expect(result.length).toBe(200);
    expect(result).toContain('pid-new');
    expect(result).not.toContain('pid-0'); // älteste verdrängt
  });

  it('behält die 200 neuesten IDs (nicht die ältesten)', () => {
    const existing = Array.from({ length: 200 }, (_, i) => `pid-${String(i).padStart(3, '0')}`);
    const result = accumulatePids(existing, 'pid-newest');
    expect(result.at(-1)).toBe('pid-newest');
    expect(result.at(0)).toBe('pid-001'); // pid-000 wurde verdrängt
  });

  it('überlebt eine leere IDs-Liste als Ausgangs-Array', () => {
    expect(() => accumulatePids([], 'pid-x')).not.toThrow();
  });
});
