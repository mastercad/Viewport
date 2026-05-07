// @vitest-environment happy-dom
/**
 * presentFullscreen.test.js
 *
 * Regressionstests für die drei Bugfixes im Geräte-Präsentationsmodus:
 *
 *  1. ResizeObserver-Scale: Nach Vollbild-Wechsel wird das präsentierte Panel
 *     auf Basis von window.innerHeight NEU skaliert (nicht beim Aktivieren,
 *     wo window.innerHeight noch den alten Wert hat).
 *
 *  2. onExitRequest-Routing: Escape/F11 kommen als globalShortcut aus dem
 *     Main-Prozess (window:exit-request IPC). Der Handler muss priorisieren:
 *     – Panel aktiv  → exitPanelPresent()
 *     – Nur Vollbild → togglePresentation(false)
 *     – Beides NIEMALS gleichzeitig
 *
 *  3. Keyboard-Routing (Renderer-keydown als Fallback):
 *     – F11 mit Panel → exitPanelPresent, NICHT togglePresentation
 *     – Escape mit Panel → exitPanelPresent, NICHT togglePresentation
 *     – F11 ohne Panel → togglePresentation
 *     – Escape ohne Panel, aber Präsentationsmodus → togglePresentation(false)
 *
 *  4. Source-Invarianten main.js + preload.js:
 *     – exitFullScreen schickt IPC statt direkt setFullScreen aufzurufen
 *     – F11-Shortcut im Main schickt IPC statt direkt setFullScreen aufzurufen
 *     – preload.js exponiert onExitRequest
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const DIR    = dirname(fileURLToPath(import.meta.url));
const appSrc = readFileSync(join(DIR, '../src/renderer/app.js'), 'utf8');
const mainSrc    = readFileSync(join(DIR, '../src/main.js'),         'utf8');
const preloadSrc = readFileSync(join(DIR, '../src/preload.js'),      'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// Hilfsfunktionen
// ─────────────────────────────────────────────────────────────────────────────

function makePanel(id, h = 800) {
  const decoEl = document.createElement('div');
  decoEl.classList.add('panel-deco');
  decoEl.dataset.id = id;
  document.body.appendChild(decoEl);
  return { rect: { h }, decoEl };
}

/**
 * Baut die _presentedPanelId-Closure aus app.js isoliert nach.
 *
 * Gibt { exitPanelPresent, presentPanel, getPresentedId, getPresentationMode,
 *         setPresentationMode, onExitRequestHandler, resizeHandler } zurück.
 *
 * `togglePresentation` und `applyDecoRect` können als Mocks übergeben werden.
 */
function buildLogic({ state, applyDecoRect = vi.fn(), togglePresentation = vi.fn() } = {}) {
  let _presentedPanelId  = null;
  let _presentationMode  = false;
  let _presentOverlay    = null;

  function exitPanelPresent() {
    if (_presentedPanelId === null) return;
    const p = state.panels.get(_presentedPanelId);
    if (p) {
      p.decoEl.classList.remove('presenting');
      applyDecoRect(p);
    }
    _presentOverlay?.remove();
    _presentOverlay = null;
    document.body.classList.remove('panel-presenting');
    _presentedPanelId = null;
    if (_presentationMode) togglePresentation(false);
  }

  function presentPanel(id) {
    if (_presentedPanelId === id) return;
    exitPanelPresent();
    const p = state.panels.get(id);
    if (!p) return;
    _presentedPanelId = id;

    _presentOverlay    = document.createElement('div');
    _presentOverlay.id = 'panel-present-overlay';
    document.body.appendChild(_presentOverlay);

    const scaleToFit = window.innerHeight / p.rect.h;
    p.decoEl.style.transform = `translate(-50%, -50%) scale(${scaleToFit})`;
    p.decoEl.classList.add('presenting');
    document.body.classList.add('panel-presenting');
    if (!_presentationMode) togglePresentation(true);
  }

  /** Logik aus wireWorkspaceResizeObserver – nach RAF-Commit. */
  function resizeHandler() {
    if (_presentedPanelId !== null) {
      const p = state.panels.get(_presentedPanelId);
      if (p) {
        const scaleToFit = window.innerHeight / p.rect.h;
        p.decoEl.style.transform = `translate(-50%, -50%) scale(${scaleToFit})`;
      }
    }
  }

  /** Logik aus onExitRequest (IPC vom Main-Prozess). */
  function onExitRequestHandler() {
    if (_presentedPanelId !== null) exitPanelPresent();
    else if (_presentationMode)     togglePresentation(false);
  }

  /** Keyboard-Routing aus wireShortcuts (Renderer-keydown-Fallback). */
  function keydownHandler(e) {
    if (e.key === 'F11') {
      e.preventDefault?.();
      if (_presentedPanelId !== null) exitPanelPresent(); else togglePresentation();
    }
    if (e.key === 'Escape') {
      if (_presentedPanelId !== null)   { e.preventDefault?.(); exitPanelPresent(); }
      else if (_presentationMode)       { e.preventDefault?.(); togglePresentation(false); }
    }
  }

  return {
    exitPanelPresent,
    presentPanel,
    resizeHandler,
    onExitRequestHandler,
    keydownHandler,
    getPresentedId:      () => _presentedPanelId,
    getPresentationMode: () => _presentationMode,
    setPresentationMode: (v) => { _presentationMode = v; },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. ResizeObserver: Scale-Neuberechnung nach Vollbild-Wechsel
// ─────────────────────────────────────────────────────────────────────────────

describe('ResizeObserver – Scale-Neuberechnung bei präsentiertem Panel', () => {
  let panelA, state, logic, togglePresentation, applyDecoRect;

  beforeEach(() => {
    panelA           = makePanel('a', 900);
    state            = { panels: new Map([['a', panelA]]) };
    togglePresentation = vi.fn();
    applyDecoRect      = vi.fn();
    logic            = buildLogic({ state, togglePresentation, applyDecoRect });
  });

  afterEach(() => { document.body.innerHTML = ''; });

  it('resizeHandler aktualisiert Transform des präsentierten Panels', () => {
    logic.presentPanel('a');

    // Vollbild simulieren: innerHeight von 768 → 1080
    Object.defineProperty(window, 'innerHeight', { value: 1080, configurable: true });
    logic.resizeHandler();

    const expected = `translate(-50%, -50%) scale(${1080 / 900})`;
    expect(panelA.decoEl.style.transform).toBe(expected);
  });

  it('resizeHandler ist ein no-op wenn kein Panel präsentiert wird', () => {
    const before = panelA.decoEl.style.transform;
    logic.resizeHandler();
    expect(panelA.decoEl.style.transform).toBe(before);
  });

  it('Erst presentPanel, dann resizeHandler: Transform basiert auf neuem innerHeight', () => {
    // Beim Aktivieren: innerHeight = 768 (klein, vor Vollbild)
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
    logic.presentPanel('a');
    const scaleAtActivation = `translate(-50%, -50%) scale(${768 / 900})`;
    expect(panelA.decoEl.style.transform).toBe(scaleAtActivation);

    // ResizeObserver feuert nach Vollbild-Commit: innerHeight = 1080
    Object.defineProperty(window, 'innerHeight', { value: 1080, configurable: true });
    logic.resizeHandler();
    const scaleAfterFullscreen = `translate(-50%, -50%) scale(${1080 / 900})`;
    expect(panelA.decoEl.style.transform).toBe(scaleAfterFullscreen);
  });

  it('resizeHandler verwendet window.innerHeight, nicht p.rect.h allein', () => {
    logic.presentPanel('a'); // rect.h = 900
    Object.defineProperty(window, 'innerHeight', { value: 1440, configurable: true });
    logic.resizeHandler();
    expect(panelA.decoEl.style.transform).toContain(`scale(${1440 / 900})`);
  });

  it('resizeHandler bei unbekanntem Panel-ID tut nichts (Defensive)', () => {
    // _presentedPanelId manuell setzen würde intern einen unbekannten Key erzeugen
    // → hier testen wir: wenn panels.get() undefined liefert, kein Crash
    const state2   = { panels: new Map() }; // leere Map
    const logic2   = buildLogic({ state: state2 });
    // Direkt resizeHandler – kein Panel aktiv, kein Fehler erwartet
    expect(() => logic2.resizeHandler()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. onExitRequest-Routing (IPC window:exit-request)
// ─────────────────────────────────────────────────────────────────────────────

describe('onExitRequest – Routing zwischen exitPanelPresent und togglePresentation', () => {
  let panelA, state, logic, togglePresentation, applyDecoRect;

  beforeEach(() => {
    panelA           = makePanel('a', 800);
    state            = { panels: new Map([['a', panelA]]) };
    togglePresentation = vi.fn();
    applyDecoRect      = vi.fn();
    logic            = buildLogic({ state, togglePresentation, applyDecoRect });
  });

  afterEach(() => { document.body.innerHTML = ''; });

  it('ruft exitPanelPresent auf wenn Panel präsentiert wird', () => {
    logic.presentPanel('a');
    togglePresentation.mockClear();

    logic.onExitRequestHandler();

    expect(panelA.decoEl.classList.contains('presenting')).toBe(false);
    expect(document.body.classList.contains('panel-presenting')).toBe(false);
  });

  it('ruft togglePresentation(false) auf wenn nur Vollbild aktiv (kein Panel)', () => {
    logic.setPresentationMode(true);
    logic.onExitRequestHandler();

    expect(togglePresentation).toHaveBeenCalledWith(false);
    expect(togglePresentation).toHaveBeenCalledTimes(1);
  });

  it('ruft NICHT togglePresentation auf wenn weder Vollbild noch Panel aktiv', () => {
    logic.onExitRequestHandler();
    expect(togglePresentation).not.toHaveBeenCalled();
  });

  it('ruft exitPanelPresent NICHT und togglePresentation NICHT doppelt auf', () => {
    // Panel + Vollbild aktiv → nur exitPanelPresent (welches intern togglePresentation aufruft)
    logic.setPresentationMode(true);
    logic.presentPanel('a');
    togglePresentation.mockClear();

    logic.onExitRequestHandler();

    // exitPanelPresent ruft togglePresentation(false) weil _presentationMode=true
    expect(togglePresentation).toHaveBeenCalledWith(false);
    expect(togglePresentation).toHaveBeenCalledTimes(1);
  });

  it('Panel wird vollständig bereinigt: Overlay, Klassen, applyDecoRect', () => {
    logic.presentPanel('a');
    expect(document.getElementById('panel-present-overlay')).not.toBeNull();

    logic.onExitRequestHandler();

    expect(document.getElementById('panel-present-overlay')).toBeNull();
    expect(panelA.decoEl.classList.contains('presenting')).toBe(false);
    expect(document.body.classList.contains('panel-presenting')).toBe(false);
    expect(applyDecoRect).toHaveBeenCalledWith(panelA);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Keyboard-Routing (Renderer-keydown-Fallback)
// ─────────────────────────────────────────────────────────────────────────────

describe('keydown-Routing – F11 und Escape mit/ohne präsentiertem Panel', () => {
  let panelA, state, logic, togglePresentation, applyDecoRect;

  function key(k) {
    let defaultPrevented = false;
    logic.keydownHandler({
      key: k,
      preventDefault: () => { defaultPrevented = true; },
      _defaultPrevented: () => defaultPrevented,
    });
    return defaultPrevented;
  }

  beforeEach(() => {
    panelA             = makePanel('a', 800);
    state              = { panels: new Map([['a', panelA]]) };
    togglePresentation = vi.fn();
    applyDecoRect      = vi.fn();
    logic              = buildLogic({ state, togglePresentation, applyDecoRect });
  });

  afterEach(() => { document.body.innerHTML = ''; });

  // ── F11 ──────────────────────────────────────────────────────────────────

  it('F11 mit aktivem Panel → exitPanelPresent, NICHT togglePresentation direkt', () => {
    logic.setPresentationMode(true);  // Vollbild war aktiv → exitPanelPresent ruft togglePresentation(false)
    logic.presentPanel('a');
    togglePresentation.mockClear();

    key('F11');

    expect(panelA.decoEl.classList.contains('presenting')).toBe(false);
    // exitPanelPresent ruft togglePresentation(false) weil _presentationMode=true
    expect(togglePresentation).toHaveBeenCalledWith(false);
    // kein zweites togglePresentation(true) durch den keydown-Handler selbst
    expect(togglePresentation).not.toHaveBeenCalledWith(true);
  });

  it('F11 ohne Panel, aber im Präsentationsmodus → togglePresentation()', () => {
    logic.setPresentationMode(true);
    key('F11');
    expect(togglePresentation).toHaveBeenCalledTimes(1);
    // Kein Argument (toggle) – nicht false und nicht true
    expect(togglePresentation).toHaveBeenCalledWith();
  });

  it('F11 ohne Panel und ohne Präsentationsmodus → togglePresentation()', () => {
    key('F11');
    expect(togglePresentation).toHaveBeenCalledTimes(1);
  });

  it('F11 mit aktivem Panel ruft togglePresentation NICHT doppelt auf', () => {
    logic.setPresentationMode(true);  // damit exitPanelPresent togglePresentation(false) auslöst
    logic.presentPanel('a');
    togglePresentation.mockClear();
    key('F11');
    // Nur einmal: durch exitPanelPresent → togglePresentation(false)
    expect(togglePresentation).toHaveBeenCalledTimes(1);
  });

  // ── Escape ────────────────────────────────────────────────────────────────

  it('Escape mit aktivem Panel → exitPanelPresent', () => {
    logic.presentPanel('a');
    togglePresentation.mockClear();

    key('Escape');

    expect(panelA.decoEl.classList.contains('presenting')).toBe(false);
    expect(document.body.classList.contains('panel-presenting')).toBe(false);
  });

  it('Escape mit aktivem Panel ruft togglePresentation NICHT extra auf', () => {
    logic.setPresentationMode(true);  // damit exitPanelPresent togglePresentation(false) auslöst
    logic.presentPanel('a');
    togglePresentation.mockClear();

    key('Escape');

    // Nur togglePresentation(false) via exitPanelPresent, nicht ein zweites Mal
    expect(togglePresentation).toHaveBeenCalledTimes(1);
    expect(togglePresentation).toHaveBeenCalledWith(false);
  });

  it('Escape ohne Panel, aber im Vollbild-Modus → togglePresentation(false)', () => {
    logic.setPresentationMode(true);
    key('Escape');
    expect(togglePresentation).toHaveBeenCalledWith(false);
    expect(togglePresentation).toHaveBeenCalledTimes(1);
  });

  it('Escape ohne Panel und ohne Vollbild → kein Aufruf', () => {
    key('Escape');
    expect(togglePresentation).not.toHaveBeenCalled();
  });

  it('Escape ruft preventDefault wenn Panel präsentiert wird', () => {
    logic.presentPanel('a');
    const prevented = key('Escape');
    expect(prevented).toBe(true);
  });

  it('Escape ruft preventDefault wenn nur Vollbild aktiv', () => {
    logic.setPresentationMode(true);
    const prevented = key('Escape');
    expect(prevented).toBe(true);
  });

  it('Escape ruft KEIN preventDefault wenn weder Panel noch Vollbild', () => {
    const prevented = key('Escape');
    expect(prevented).toBe(false);
  });

  // ── Kombiniert: Panel + Vollbild ──────────────────────────────────────────

  it('Escape mit Panel UND Vollbild → nur exitPanelPresent, kein zweites togglePresentation', () => {
    logic.setPresentationMode(true);
    logic.presentPanel('a');
    togglePresentation.mockClear();

    key('Escape');

    // exitPanelPresent ruft togglePresentation(false) genau einmal
    expect(togglePresentation).toHaveBeenCalledTimes(1);
    expect(togglePresentation).toHaveBeenCalledWith(false);
    expect(panelA.decoEl.classList.contains('presenting')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Source-Invarianten: main.js, preload.js, app.js
// ─────────────────────────────────────────────────────────────────────────────

describe('Source-Invariante: main.js – exitFullScreen schickt IPC statt setFullScreen', () => {
  it('exitFullScreen sendet window:exit-request an den Renderer', () => {
    expect(mainSrc).toContain("'window:exit-request'");
    // Muss send (fire-and-forget) verwenden, kein invoke nötig
    const exitBlock = mainSrc.slice(
      mainSrc.indexOf('function exitFullScreen()'),
      mainSrc.indexOf('function exitFullScreen()') + 300,
    );
    expect(exitBlock).toContain("'window:exit-request'");
  });

  it('exitFullScreen ruft NICHT mehr direkt setFullScreen auf', () => {
    const exitBlock = mainSrc.slice(
      mainSrc.indexOf('function exitFullScreen()'),
      mainSrc.indexOf('function exitFullScreen()') + 300,
    );
    expect(exitBlock).not.toContain('setFullScreen(false)');
  });

  it('F11-globalShortcut schickt IPC wenn Fenster im Vollbild ist', () => {
    // Der Block nach isFullScreen()-Check muss exit-request enthalten
    const f11Idx   = mainSrc.indexOf("globalShortcut.register('F11'");
    const f11Block = mainSrc.slice(f11Idx, f11Idx + 600);
    expect(f11Block).toContain("'window:exit-request'");
  });

  it('F11-globalShortcut ruft NICHT mehr direkt setAlwaysOnTop(false) + setFullScreen(false) auf', () => {
    const f11Idx   = mainSrc.indexOf("globalShortcut.register('F11'");
    const f11Block = mainSrc.slice(f11Idx, f11Idx + 600);
    // Der "isFullScreen → exit"-Pfad darf kein direktes setFullScreen(false) enthalten
    const isFullIdx = f11Block.indexOf('isFullScreen()');
    const exitPath  = f11Block.slice(isFullIdx, isFullIdx + 200);
    expect(exitPath).not.toContain('setFullScreen(false)');
  });
});

describe('Source-Invariante: preload.js – onExitRequest exponiert', () => {
  it('exponiert onExitRequest', () => {
    expect(preloadSrc).toContain('onExitRequest');
  });

  it('onExitRequest hört auf window:exit-request', () => {
    expect(preloadSrc).toContain("'window:exit-request'");
  });

  it('onFullScreenChange hört auf window:fullscreen', () => {
    expect(preloadSrc).toContain("'window:fullscreen'");
  });
});

describe('Source-Invariante: app.js – onExitRequest verdrahtet, ResizeObserver aktualisiert Scale', () => {
  it('app.js registriert onExitRequest-Handler', () => {
    expect(appSrc).toContain('onExitRequest');
  });

  it('onExitRequest priorisiert exitPanelPresent vor togglePresentation', () => {
    // Muster: _presentedPanelId !== null → exitPanelPresent, sonst togglePresentation
    const reqIdx  = appSrc.indexOf('onExitRequest');
    const reqBlock = appSrc.slice(reqIdx, reqIdx + 300);
    expect(reqBlock).toContain('_presentedPanelId !== null');
    expect(reqBlock).toContain('exitPanelPresent');
    expect(reqBlock).toContain('togglePresentation(false)');
  });

  it('ResizeObserver-Callback aktualisiert Transform des präsentierten Panels', () => {
    expect(appSrc).toContain('window.innerHeight / p.rect.h');
    // Muss im wireWorkspaceResizeObserver-Block stehen
    const obsIdx   = appSrc.indexOf('function wireWorkspaceResizeObserver()');
    const obsBlock = appSrc.slice(obsIdx, obsIdx + 1200);
    expect(obsBlock).toContain('window.innerHeight / p.rect.h');
    expect(obsBlock).toContain('translate(-50%, -50%) scale');
  });

  it('ResizeObserver prüft _presentedPanelId !== null bevor er skaliert', () => {
    const obsIdx   = appSrc.indexOf('wireWorkspaceResizeObserver');
    const obsBlock = appSrc.slice(obsIdx, obsIdx + 800);
    expect(obsBlock).toContain('_presentedPanelId !== null');
  });
});
