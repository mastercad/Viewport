/**
 * Tests für die navigateWv-Entscheidungslogik.
 *
 * navigateWvLogic() berechnet, was navigateWv() tun soll:
 *
 *  1. Gleiche URL (gleicher pathname+search)  → reload   (wenn bereit)
 *  2. Gleiche Origin, anderer Pfad, bereit    → pushState (kein Server-Roundtrip,
 *                                               kein Startseiten-Flash bei SPAs)
 *  3. Gleiche Origin, anderer Pfad, NOT bereit → loadURL  (Fallback)
 *  4. Andere Origin                            → loadURL
 *  5. wv = null                               → noop
 *
 *  REGRESSION:
 *  - `document.title === document.title` darf nie vorkommen (war immer true → Bug)
 *  - navigateWvLogic selbst ruft niemals wv.executeJavaScript() direkt auf (pure fn)
 *  - Andere Origin / about:blank → nie pushState
 */

import { describe, it, expect, vi } from 'vitest';
import { navigateWvLogic } from '../src/renderer/navLogic.js';

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

/**
 * Baut ein Fake-Webview-Objekt.
 * @param {string}  currentUrl  – aktuell geladene URL
 * @param {boolean} isReady     – ob did-stop-loading bereits gefeuert hat
 */
function makeWv(currentUrl, isReady = true) {
  return {
    _url:              currentUrl,
    _ready:            isReady,
    getURL:            vi.fn(() => currentUrl),
    reload:            vi.fn(),
    loadURL:           vi.fn().mockResolvedValue(undefined),
    executeJavaScript: vi.fn().mockResolvedValue(undefined),
    setAttribute:      vi.fn(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('navigateWvLogic – Entscheidungsbaum', () => {

  it('gibt reload für identische URL zurück', () => {
    const wv  = makeWv('https://example.com/page', true);
    const ops = navigateWvLogic(wv, 'https://example.com/page', wv._ready);
    expect(ops.action).toBe('reload');
    expect(ops.action).not.toBe('loadURL');
    expect(ops.action).not.toBe('pushState');
  });

  it('gibt reload für gleichen pathname+search zurück (Hash-Änderung ignoriert)', () => {
    const wv  = makeWv('https://example.com/page', true);
    const ops = navigateWvLogic(wv, 'https://example.com/page#section', wv._ready);
    expect(ops.action).toBe('reload');
  });

  it('gibt pushState für gleiche Origin + anderen Pfad zurück wenn bereit', () => {
    const wv  = makeWv('https://example.com/page-a', true);
    const ops = navigateWvLogic(wv, 'https://example.com/page-b', wv._ready);
    expect(ops.action).toBe('pushState');
    expect(ops.url).toBe('https://example.com/page-b');
    expect(ops.action).not.toBe('loadURL');
    expect(ops.action).not.toBe('reload');
  });

  it('gibt pushState für gleiche Origin + anderen Query-String zurück wenn bereit', () => {
    const wv  = makeWv('https://example.com/page?q=1', true);
    const ops = navigateWvLogic(wv, 'https://example.com/page?q=2', wv._ready);
    expect(ops.action).toBe('pushState');
    expect(ops.url).toBe('https://example.com/page?q=2');
  });

  it('gibt loadURL für gleiche Origin + anderen Pfad zurück wenn NICHT bereit (Fallback)', () => {
    const wv  = makeWv('https://example.com/page-a', false);
    const ops = navigateWvLogic(wv, 'https://example.com/page-b', false);
    expect(ops.action).toBe('loadURL');
    expect(ops.action).not.toBe('pushState');
    expect(ops.action).not.toBe('reload');
  });

  it('gibt loadURL für andere Origin zurück', () => {
    const wv  = makeWv('https://example.com/page', true);
    const ops = navigateWvLogic(wv, 'https://other.com/page', wv._ready);
    expect(ops.action).toBe('loadURL');
    expect(ops.action).not.toBe('pushState');
  });

  it('gibt loadURL wenn bisherige URL about:blank ist', () => {
    const wv  = makeWv('about:blank', true);
    const ops = navigateWvLogic(wv, 'https://example.com/', wv._ready);
    expect(ops.action).toBe('loadURL');
    expect(ops.action).not.toBe('pushState');
  });

  it('gibt noop zurück wenn wv null ist', () => {
    const ops = navigateWvLogic(null, 'https://example.com/', false);
    expect(ops.action).toBe('noop');
  });

  // ─── REGRESSIONS-TESTS ───────────────────────────────────────────────────

  it('REGRESSION: andere Origin und about:blank geben niemals pushState zurück', () => {
    const crossOriginCases = [
      ['https://example.com/a', 'https://other.com/b'],
      ['about:blank',            'https://example.com/'],
    ];
    for (const [cur, target] of crossOriginCases) {
      const wv  = makeWv(cur, true);
      const ops = navigateWvLogic(wv, target, wv._ready);
      expect(ops.action, `pushState für ${cur} → ${target}`).not.toBe('pushState');
    }
  });

  it('REGRESSION: nicht-bereite Panels geben niemals pushState zurück', () => {
    const cases = [
      ['https://example.com/a', 'https://example.com/b'],
      ['https://example.com/a', 'https://other.com/b'],
    ];
    for (const [cur, target] of cases) {
      const wv  = makeWv(cur, false);
      const ops = navigateWvLogic(wv, target, false);
      expect(ops.action, `pushState für nicht-bereites Panel ${cur} → ${target}`).not.toBe('pushState');
    }
  });

  it('REGRESSION: document.title-Vergleich darf nicht im zurückgegebenen payload existieren', () => {
    // Der ursprüngliche Bug: `document.title === document.title` war immer true.
    // navigateWvLogic gibt kein JS-Snippet zurück – wir stellen sicher, dass kein
    // url-Feld die tautologische Bedingung enthält.
    const wv  = makeWv('https://example.com/a', true);
    const ops = navigateWvLogic(wv, 'https://example.com/b', wv._ready);
    const payload = JSON.stringify(ops);
    expect(payload).not.toContain('document.title === document.title');
    expect(payload).not.toContain('document.title==document.title');
  });

  it('REGRESSION: navigateWvLogic ruft nie wv.executeJavaScript() auf (pure function)', () => {
    // Die reine Entscheidungsfunktion darf keine Seiteneffekte haben.
    // executeJavaScript wird erst von panels.js ausgeführt, nicht hier.
    const wv = makeWv('https://example.com/page-a', true);
    navigateWvLogic(wv, 'https://example.com/page-b', wv._ready);
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
  });
});

