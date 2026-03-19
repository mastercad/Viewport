/**
 * pushPreload.integrity.test.js
 *
 * STATISCHE STRUKTURPRÜFUNG von push-webview-preload.js.
 *
 * Diese Tests analysieren den Quellcode als Text und stellen sicher, dass
 * kritische Implementierungsdetails vorhanden sind, die für funktionierende
 * Push-Benachrichtigungen ZWINGEND erforderlich sind.
 *
 * ► Kein Aufbau einer Laufzeitumgebung nötig – rein strukturell.
 * ► Fängt Rückschritte auf, die Unit-Tests nicht abdecken können:
 *     – Wechsel der Injektionsmethode (<script>-Tag statt webFrame)
 *     – Entfernen des try-catch um contextBridge
 *     – Löschen von _ensureConnected-Aufrufen
 *     – Verlust des vapidKey-Fallbacks
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const src = readFileSync(
  new URL('../src/push-webview-preload.js', import.meta.url),
  'utf8',
);

// ── Injektionsmethode ─────────────────────────────────────────────────────────

describe('Injektionsmethode: webFrame.executeJavaScript() [CSP-Bypass]', () => {
  it('nutzt webFrame.executeJavaScript(MAIN_WORLD_CODE) zur Code-Injektion', () => {
    // PFLICHT: webFrame.executeJavaScript() umgeht CSP – auch wenn der
    // Service Worker die Seite aus seinem Cache bedient.
    expect(src).toContain('webFrame.executeJavaScript(MAIN_WORLD_CODE)');
  });

  it('enthält KEIN document.createElement("script") [war der CSP-Bug!]', () => {
    // <script>-Tag-Injection wird durch Service-Worker-Cache-CSP blockiert.
    // Dies war der Bug, der dazu führte dass Push nach SW-Aktivierung brach.
    expect(src).not.toMatch(/createElement\(['"]script['"]\)/);
  });

  it('enthält KEIN script.textContent = MAIN_WORLD_CODE', () => {
    expect(src).not.toContain('script.textContent');
  });

  it('enthält kein appendChild(script) [alter Injektionspfad]', () => {
    expect(src).not.toMatch(/appendChild\s*\(\s*script\s*\)/);
  });

  it('enthält kein script.remove() [alter Injektionspfad]', () => {
    expect(src).not.toContain('script.remove()');
  });

  it('importiert webFrame aus require("electron")', () => {
    // webFrame muss destructured werden, sonst schlägt der Aufruf zur Laufzeit fehl.
    expect(src).toMatch(/\bwebFrame\b/);
    expect(src).toMatch(/require\(['"]electron['"]\)/);
  });
});

// ── contextBridge.exposeInMainWorld: Idempotenz-Schutz ───────────────────────

describe('contextBridge.exposeInMainWorld: try-catch Idempotenz-Schutz', () => {
  it('exposeInMainWorld ist in try-catch eingewickelt', () => {
    // Das Preload kann bei In-Page-Navigation mehrfach laufen.
    // Ohne try-catch crasht exposeInMainWorld beim zweiten Aufruf.
    expect(src).toMatch(/try\s*\{[\s\S]{0,200}contextBridge\.exposeInMainWorld/);
  });

  it('catch-Block ist direkt nach exposeInMainWorld vorhanden', () => {
    expect(src).toMatch(/\}\s*catch\s*\(\s*_\s*\)\s*\{/);
  });

  it('expose wird via ipcRenderer aufgerufen (kein direkter Zugriff ohne Bridge)', () => {
    // Der Renderer-Prozess darf nur via ipcRenderer.invoke mit dem Main kommunizieren.
    expect(src).toContain('ipcRenderer.invoke');
    expect(src).toContain('push:register');
  });
});

// ── MCS-Verbindungssicherung: _ensureConnected ────────────────────────────────

describe('_ensureConnected: MCS-Verbindung im Cache-Hit sicherstellen', () => {
  it('_ensureConnected Funktion ist definiert', () => {
    // MCS-Connection-Helper muss im MAIN_WORLD_CODE vorhanden sein.
    expect(src).toMatch(/function _ensureConnected\s*\(/);
  });

  it('_ensureConnected prüft Key-Länge > 32 (kein Aufruf bei kurzem Prefix)', () => {
    // Ein 32-Zeichen-Prefix ist kein vollständiger VAPID-Key → kein register()-Aufruf.
    expect(src).toMatch(/\.length\s*<=\s*32/);
  });

  it('_ensureConnected ruft window.__electronPush__.register() auf', () => {
    expect(src).toMatch(/_ensureConnected[\s\S]{0,200}__electronPush__\.register/);
  });

  it('_ensureConnected wird im subscribe() Cache-Hit-Pfad aufgerufen', () => {
    // Schneidet den subscribe()-Bereich aus (bis getSubscription beginnt)
    const subscribeSection = src.slice(
      src.indexOf('PushManager.prototype.subscribe'),
      src.indexOf('// Interne Hilfsfunktion'),
    );
    // Muss nach "cached.vapidKey = vapidKey" aufgerufen werden
    expect(subscribeSection).toMatch(/cached\.vapidKey\s*=\s*vapidKey[\s\S]{0,300}_ensureConnected\(vapidKey\)/);
  });

  it('_ensureConnected wird im getSubscription() Cache-Treffer-Pfad aufgerufen', () => {
    const getSubSection = src.slice(
      src.indexOf('PushManager.prototype.getSubscription'),
    );
    expect(getSubSection).toContain('_ensureConnected(storedVapidKey)');
  });
});

// ── VAPID-Key Fallback in getSubscription() ───────────────────────────────────

describe('getSubscription(): vapidKey-Fallback aus localStorage-Schlüssel', () => {
  it('Fallback "storedVapidKey || k.slice(...)" ist vorhanden', () => {
    // ZWINGEND: Verhindert TypeError in makeFakeSub wenn ältere Cache-Einträge
    // kein vapidKey-Feld im gespeicherten JSON haben.
    // (War der ursprüngliche Crash nach der ersten Fehlerbehebung.)
    expect(src).toMatch(/storedVapidKey\s*\|\|\s*k\.slice\s*\(\s*['"]__epush__:['"]\.length\s*\)/);
  });

  it('voller VAPID-Key-Check: creds.vapidKey.length > 32', () => {
    // Unterscheidet 32-Zeichen-Prefix (aus LS-Key) von vollständigem 87-Zeichen-Key
    expect(src).toMatch(/creds\.vapidKey[\s\S]{0,100}\.length\s*>\s*32/);
  });
});

// ── MAIN_WORLD_CODE Vollständigkeit ───────────────────────────────────────────

describe('MAIN_WORLD_CODE: Vollständigkeit der PushManager-Overrides', () => {
  it('MAIN_WORLD_CODE Template-Literal ist definiert', () => {
    expect(src).toMatch(/var MAIN_WORLD_CODE\s*=\s*\/\* JavaScript \*\/\s*`/);
  });

  it('enthält PushManager.prototype.subscribe Override', () => {
    expect(src).toContain('PushManager.prototype.subscribe');
  });

  it('enthält PushManager.prototype.getSubscription Override', () => {
    expect(src).toContain('PushManager.prototype.getSubscription');
  });

  it('enthält makeFakeSub (Fake-PushSubscription-Objekt)', () => {
    expect(src).toContain('function makeFakeSub(');
  });

  it('enthält toVapidBase64url (Key-Format-Konvertierung)', () => {
    expect(src).toContain('function toVapidBase64url(');
  });

  it('enthält b64urlToBuffer (für getKey("p256dh") und getKey("auth"))', () => {
    expect(src).toContain('function b64urlToBuffer(');
  });

  it('MAIN_WORLD_CODE endet mit webFrame.executeJavaScript-Aufruf', () => {
    // Der Injektions-Aufruf muss NACH der Template-Literal-Definition kommen.
    // Suche nach dem konkreten Aufruf inkl. Argument – nicht nur dem Funktionsnamen
    // (der Funktionsname erscheint auch im Datei-Header-Kommentar vor MAIN_WORLD_CODE).
    const mwcPos    = src.indexOf('var MAIN_WORLD_CODE');
    const injectPos = src.indexOf('webFrame.executeJavaScript(MAIN_WORLD_CODE)');
    expect(injectPos).toBeGreaterThan(mwcPos);
  });
});

// ── Sicherheit: IPC-Kanalname ─────────────────────────────────────────────────

describe('Sicherheit: IPC-Kanalnamen', () => {
  it('nutzt eingehenden Kanal "push:register" (nicht offen für beliebige IPC)', () => {
    expect(src).toContain("'push:register'");
  });

  it('übergibt nur vapidKey an den Main-Prozess (kein unkontrolliertes Objekt)', () => {
    // Das Argument muss ein Objekt mit genau { vapidKey } sein
    expect(src).toContain('{ vapidKey }');
  });
});
