/**
 * pushPreload.test.js
 *
 * Tests für die MAIN_WORLD_CODE-Logik aus push-webview-preload.js.
 *
 * Testet alle kritischen Pfade der PushManager-Override-Logik:
 *  - subscribe() Cache-Miss  → register() wird aufgerufen, Sub in LS gespeichert
 *  - subscribe() Cache-Hit   → register() für MCS-Connect aufgerufen (war der Bug!)
 *  - subscribe() fremder Fehler → wird weitergeworfen (kein Schlucken)
 *  - subscribe() kein VAPID-Key → AbortError
 *  - getSubscription() nativer Treffer → direkt zurück
 *  - getSubscription() LS-Treffer mit vollem VAPID-Key → register() aufgerufen
 *  - getSubscription() LS-Treffer mit altem Cache (kein vapidKey im JSON) → kein Crash
 *  - getSubscription() leer (kein Native, kein LS) → null
 *  - getSubscription() korruptes JSON → null (kein Crash)
 *  - makeFakeSub → korrekte Struktur (getKey, toJSON, unsubscribe)
 *  - _ensureConnected → nur bei vollständigem Key aktiv (>32 Zeichen)
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';

// ── MAIN_WORLD_CODE aus der Quelldatei extrahieren ────────────────────────────

const preloadSource = readFileSync(
  new URL('../src/push-webview-preload.js', import.meta.url),
  'utf8',
);

// Backtick-Inhalt zwischen `var MAIN_WORLD_CODE = /* JavaScript */ \`` und schließendem `\`;`
const mwcMatch = preloadSource.match(
  /var MAIN_WORLD_CODE = \/\* JavaScript \*\/ `([\s\S]*?)`;[\r\n]/,
);
if (!mwcMatch) throw new Error('MAIN_WORLD_CODE nicht in push-webview-preload.js gefunden');

// Template-Literal enthält \\+ etc. (doppelt escaped für den äußeren JS-String).
// Für eval müssen wir diese wieder auf einfache Escapes reduzieren.
const MAIN_WORLD_CODE = mwcMatch[1]
  .replace(/\\\\([+/])/g, '\\$1')  // \\+ → \+  und  \\/ → \/
  .replace(/\\\\/g, '\\');          // verbleibende \\\\ → \\

// ── Test-Umgebung ─────────────────────────────────────────────────────────────

const FAKE_P256DH  = btoa('P'.repeat(65)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const FAKE_AUTH    = btoa('A'.repeat(16)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const FAKE_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/FAKE_GCM_TOKEN';
// Echter VAPID-Key ist 87 Zeichen base64url (65-Byte P-256 Public Key)
const FULL_VAPID_KEY = 'B' + 'x'.repeat(86); // 87 Zeichen

function fakeCreds(vapidKey = FULL_VAPID_KEY) {
  return {
    endpoint: FAKE_ENDPOINT,
    keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH },
    vapidKey,
  };
}

/**
 * Baut eine isolierte Browser-ähnliche Umgebung und führt MAIN_WORLD_CODE darin aus.
 * Gibt die überschriebenen PushManager-Methoden und alle Mocks zurück.
 */
function buildEnv({
  nativeSubscribeError = new Error('push service not available'),
  nativeSubscribeResult = null,   // wenn null → wirft nativeSubscribeError
  nativeGetSubResult = null,      // null = kein native Sub
  lsInitial = {},                 // Vorbe-füllter localStorage
  registerResult = fakeCreds(),   // Was push:register zurückgibt (null = Bridge-Fehler)
} = {}) {
  // localStorage-Mock
  const store = { ...lsInitial };
  const keys  = () => Object.keys(store);
  const mockLS = {
    getItem:    (k)    => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k)    => { delete store[k]; },
    key:        (i)    => keys()[i] ?? null,
    get length()       { return keys().length; },
  };

  // push:register Mock
  const mockRegister = vi.fn().mockResolvedValue(registerResult);

  // PushManager-Mock
  function PushManager() {}
  PushManager.prototype.subscribe = nativeSubscribeResult !== null
    ? vi.fn().mockResolvedValue(nativeSubscribeResult)
    : vi.fn().mockRejectedValue(nativeSubscribeError);
  PushManager.prototype.getSubscription = vi.fn().mockResolvedValue(nativeGetSubResult);

  // DOMException-Mock (Node hat es seit v18, aber sicherheitshalber)
  class MockDOMException extends Error {
    constructor(msg, name) { super(msg); this.name = name ?? 'Error'; }
  }

  // Code in abgeschlossenem Scope auswerten
  const fn = new Function(
    'window', 'localStorage', 'PushManager', 'DOMException', 'atob', 'btoa', 'location',
    // Wrapper: IIFE ausführen (enthält bereits die eigene IIFE)
    MAIN_WORLD_CODE,
  );

  const mockWindow = {
    __electronPush__: { register: mockRegister },
  };

  fn(mockWindow, mockLS, PushManager, MockDOMException, atob, btoa, { origin: 'https://test.example.com' });

  const pm = new PushManager();
  return { pm, PushManager, mockRegister, store, mockLS };
}

// ── subscribe() ───────────────────────────────────────────────────────────────

describe('subscribe() – Cache-Miss (kein localStorage-Eintrag)', () => {
  it('ruft register() mit dem VAPID-Key auf', async () => {
    const { pm, mockRegister } = buildEnv();
    await pm.subscribe({ applicationServerKey: FULL_VAPID_KEY });
    expect(mockRegister).toHaveBeenCalledOnce();
    expect(mockRegister).toHaveBeenCalledWith(FULL_VAPID_KEY);
  });

  it('speichert die erhaltenen Credentials in localStorage', async () => {
    const { pm, store } = buildEnv();
    await pm.subscribe({ applicationServerKey: FULL_VAPID_KEY });
    const cacheKey = '__epush__:' + FULL_VAPID_KEY.slice(0, 32);
    expect(store[cacheKey]).toBeDefined();
    const saved = JSON.parse(store[cacheKey]);
    expect(saved.endpoint).toBe(FAKE_ENDPOINT);
    expect(saved.vapidKey).toBe(FULL_VAPID_KEY);
  });

  it('gibt ein gültiges Sub-Objekt zurück', async () => {
    const { pm } = buildEnv();
    const sub = await pm.subscribe({ applicationServerKey: FULL_VAPID_KEY });
    expect(sub.endpoint).toBe(FAKE_ENDPOINT);
    expect(sub.getKey).toBeTypeOf('function');
    expect(sub.toJSON).toBeTypeOf('function');
    expect(sub.unsubscribe).toBeTypeOf('function');
    expect(sub.getKey('p256dh')).toBeInstanceOf(ArrayBuffer);
    expect(sub.getKey('auth')).toBeInstanceOf(ArrayBuffer);
  });

  it('wirft AbortError wenn register() null zurückgibt (Bridge nicht verfügbar)', async () => {
    const { pm } = buildEnv({ registerResult: null });
    await expect(pm.subscribe({ applicationServerKey: FULL_VAPID_KEY }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('wirft AbortError wenn kein applicationServerKey angegeben', async () => {
    const { pm } = buildEnv();
    await expect(pm.subscribe({})).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('subscribe() – Cache-Hit (Sub bereits in localStorage)', () => {
  function makeEnvWithCache() {
    const cacheKey = '__epush__:' + FULL_VAPID_KEY.slice(0, 32);
    return buildEnv({
      lsInitial: { [cacheKey]: JSON.stringify(fakeCreds(FULL_VAPID_KEY)) },
    });
  }

  it('gibt gecachte Sub zurück ohne erneut zu registrieren', async () => {
    const { pm } = makeEnvWithCache();
    const sub = await pm.subscribe({ applicationServerKey: FULL_VAPID_KEY });
    expect(sub.endpoint).toBe(FAKE_ENDPOINT);
  });

  it('ruft register() für MCS-Verbindung auf (Kern-Fix!)', async () => {
    // DIES WAR DER BUG: Cache-Hit rief register() nie auf → kein MCS-Connect → keine Notifications
    const { pm, mockRegister } = makeEnvWithCache();
    await pm.subscribe({ applicationServerKey: FULL_VAPID_KEY });
    expect(mockRegister).toHaveBeenCalledWith(FULL_VAPID_KEY);
  });

  it('ruft register() nur einmal auf (nicht doppelt)', async () => {
    const { pm, mockRegister } = makeEnvWithCache();
    await pm.subscribe({ applicationServerKey: FULL_VAPID_KEY });
    // register() im Hintergrund – warten bis alle Promises abgearbeitet
    await new Promise(r => setTimeout(r, 0));
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });
});

describe('subscribe() – Fehlerbehandlung', () => {
  it('leitet andere Fehler (nicht push-service-Fehler) direkt weiter', async () => {
    const networkError = new Error('Netzwerkfehler');
    const { pm } = buildEnv({ nativeSubscribeError: networkError });
    await expect(pm.subscribe({ applicationServerKey: FULL_VAPID_KEY }))
      .rejects.toThrow('Netzwerkfehler');
  });

  it('behandelt auch "Registration failed" als Push-Fehler', async () => {
    const { pm, mockRegister } = buildEnv({
      nativeSubscribeError: new Error('Registration failed – no push service'),
    });
    await pm.subscribe({ applicationServerKey: FULL_VAPID_KEY });
    expect(mockRegister).toHaveBeenCalledOnce();
  });

  it('gibt native Sub zurück wenn Chromium doch Push unterstützt', async () => {
    const nativeSub = { endpoint: 'https://native', getKey: () => null };
    const { pm, mockRegister } = buildEnv({ nativeSubscribeResult: nativeSub });
    const sub = await pm.subscribe({ applicationServerKey: FULL_VAPID_KEY });
    expect(sub).toBe(nativeSub);
    expect(mockRegister).not.toHaveBeenCalled();
  });
});

// ── getSubscription() ─────────────────────────────────────────────────────────

describe('getSubscription() – kein Treffer', () => {
  it('gibt null zurück wenn kein native und kein LS-Eintrag', async () => {
    const { pm } = buildEnv();
    const sub = await pm.getSubscription();
    expect(sub).toBeNull();
  });

  it('gibt null zurück wenn LS korruptes JSON enthält', async () => {
    const cacheKey = '__epush__:' + FULL_VAPID_KEY.slice(0, 32);
    const { pm } = buildEnv({ lsInitial: { [cacheKey]: 'kein-json{{{' } });
    const sub = await pm.getSubscription();
    expect(sub).toBeNull();
  });

  it('gibt null zurück wenn LS irrelevante Keys enthält (kein __epush__:)', async () => {
    const { pm } = buildEnv({ lsInitial: { 'some-other-key': '{"data":1}' } });
    const sub = await pm.getSubscription();
    expect(sub).toBeNull();
  });
});

describe('getSubscription() – native Sub vorhanden', () => {
  it('gibt native Sub direkt zurück ohne LS zu prüfen', async () => {
    const nativeSub = { endpoint: 'https://native-push.example.com' };
    const { pm, mockRegister } = buildEnv({ nativeGetSubResult: nativeSub });
    const sub = await pm.getSubscription();
    expect(sub).toBe(nativeSub);
    expect(mockRegister).not.toHaveBeenCalled();
  });
});

describe('getSubscription() – LS-Treffer mit vollem VAPID-Key', () => {
  function makeEnvWithFullKey() {
    const cacheKey = '__epush__:' + FULL_VAPID_KEY.slice(0, 32);
    return buildEnv({
      lsInitial: { [cacheKey]: JSON.stringify(fakeCreds(FULL_VAPID_KEY)) },
    });
  }

  it('gibt gültiges Sub-Objekt zurück', async () => {
    const { pm } = makeEnvWithFullKey();
    const sub = await pm.getSubscription();
    expect(sub).not.toBeNull();
    expect(sub.endpoint).toBe(FAKE_ENDPOINT);
  });

  it('ruft register() mit vollem VAPID-Key auf (Kern-Fix: MCS-Connect!)', async () => {
    // DIES WAR DER HAUPT-BUG: Kein register() → kein MCS → keine eingehenden Nachrichten
    const { pm, mockRegister } = makeEnvWithFullKey();
    await pm.getSubscription();
    await new Promise(r => setTimeout(r, 0)); // _ensureConnected ist fire-and-forget
    expect(mockRegister).toHaveBeenCalledWith(FULL_VAPID_KEY);
  });
});

describe('getSubscription() – LS-Treffer mit altem Cache (kein vapidKey im JSON)', () => {
  // Ältere Cache-Einträge wurden ohne vapidKey im JSON gespeichert
  function makeEnvWithOldCache() {
    const cacheKey = '__epush__:' + FULL_VAPID_KEY.slice(0, 32);
    const oldCreds = {
      endpoint: FAKE_ENDPOINT,
      keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH },
      // kein vapidKey-Feld!
    };
    return buildEnv({ lsInitial: { [cacheKey]: JSON.stringify(oldCreds) } });
  }

  it('gibt gültiges Sub-Objekt zurück ohne zu crashen', async () => {
    const { pm } = makeEnvWithOldCache();
    const sub = await pm.getSubscription();
    expect(sub).not.toBeNull();
    expect(sub.endpoint).toBe(FAKE_ENDPOINT);
  });

  it('ruft register() NICHT auf (kein voller Key verfügbar – LS-Key ist nur 32-Zeichen-Prefix)', async () => {
    const { pm, mockRegister } = makeEnvWithOldCache();
    await pm.getSubscription();
    await new Promise(r => setTimeout(r, 0));
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('setzt vapidKey auf den 32-Zeichen-Prefix (Fallback für makeFakeSub)', async () => {
    const { pm } = makeEnvWithOldCache();
    const sub = await pm.getSubscription();
    // unsubscribe() nutzt creds.vapidKey.slice(0,32) für removeItem – darf nicht crashen
    await expect(sub.unsubscribe()).resolves.toBe(true);
  });
});

// ── _ensureConnected Grenzfälle ───────────────────────────────────────────────

describe('_ensureConnected – wird durch getSubscription ausgelöst', () => {
  it('register() wird NICHT aufgerufen bei 32-Zeichen-Key (Prefix, kein voller Key)', async () => {
    const shortKey = 'x'.repeat(32); // genau 32 Zeichen = nur Prefix, kein voller VAPID-Key
    const cacheKey = '__epush__:' + shortKey;
    const credsWithShortKey = {
      endpoint: FAKE_ENDPOINT,
      keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH },
      vapidKey: shortKey,
    };
    const { pm, mockRegister } = buildEnv({
      lsInitial: { [cacheKey]: JSON.stringify(credsWithShortKey) },
    });
    await pm.getSubscription();
    await new Promise(r => setTimeout(r, 0));
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('register() wird aufgerufen bei 87-Zeichen-Key (voller VAPID-Key)', async () => {
    const cacheKey = '__epush__:' + FULL_VAPID_KEY.slice(0, 32);
    const { pm, mockRegister } = buildEnv({
      lsInitial: { [cacheKey]: JSON.stringify(fakeCreds(FULL_VAPID_KEY)) },
    });
    await pm.getSubscription();
    await new Promise(r => setTimeout(r, 0));
    expect(mockRegister).toHaveBeenCalledWith(FULL_VAPID_KEY);
  });
});

// ── Sub-Objekt Struktur ───────────────────────────────────────────────────────

describe('Sub-Objekt (makeFakeSub) Struktur', () => {
  async function getSub() {
    const { pm } = buildEnv();
    return pm.subscribe({ applicationServerKey: FULL_VAPID_KEY });
  }

  it('hat endpoint', async () => {
    expect((await getSub()).endpoint).toBe(FAKE_ENDPOINT);
  });

  it('hat expirationTime null', async () => {
    expect((await getSub()).expirationTime).toBeNull();
  });

  it('getKey("p256dh") gibt ArrayBuffer zurück', async () => {
    const buf = (await getSub()).getKey('p256dh');
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it('getKey("auth") gibt ArrayBuffer zurück', async () => {
    const buf = (await getSub()).getKey('auth');
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it('getKey mit unbekanntem Namen gibt null zurück', async () => {
    expect((await getSub()).getKey('unknown')).toBeNull();
  });

  it('toJSON() gibt endpoint und keys zurück', async () => {
    const json = (await getSub()).toJSON();
    expect(json.endpoint).toBe(FAKE_ENDPOINT);
    expect(json.keys.p256dh).toBe(FAKE_P256DH);
    expect(json.keys.auth).toBe(FAKE_AUTH);
    expect(json.expirationTime).toBeNull();
  });

  it('unsubscribe() löscht localStorage-Eintrag und resolved true', async () => {
    const cacheKey = '__epush__:' + FULL_VAPID_KEY.slice(0, 32);
    const creds    = fakeCreds(FULL_VAPID_KEY);
    const { pm, store } = buildEnv({
      lsInitial: { [cacheKey]: JSON.stringify(creds) },
    });
    const sub = await pm.getSubscription();
    expect(store[cacheKey]).toBeDefined();
    const result = await sub.unsubscribe();
    expect(result).toBe(true);
    expect(store[cacheKey]).toBeUndefined();
  });
});
