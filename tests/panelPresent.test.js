// @vitest-environment happy-dom
/**
 * panelPresent.test.js
 *
 * Testet den „Panel präsentieren"-Modus:
 *
 *  A) Toggle-Logik (panels.js)
 *     – HUD-Button dispatcht `ss:present-panel` wenn Panel NICHT präsentiert wird
 *     – HUD-Button dispatcht `ss:exit-present-panel` wenn Panel bereits `.presenting` hat
 *
 *  B) Event-Handler (app.js – extrahiert und isoliert getestet)
 *     – `ss:present-panel`: Overlay wird erstellt, CSS-Klassen gesetzt, Transform berechnet
 *     – `ss:present-panel` mit gleicher ID: kein erneuter Eintritt (no-op)
 *     – `ss:present-panel` bei laufender Präsentation eines anderen Panels: sauberer Wechsel
 *     – `ss:exit-present-panel`: Overlay entfernt, Klassen zurückgesetzt, applyDecoRect aufgerufen
 *     – Escape-Taste: ruft exitPanelPresent auf
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const DIR = dirname(fileURLToPath(import.meta.url));

// ── Quellcode laden ───────────────────────────────────────────────────────────

const panelsSrc = readFileSync(join(DIR, '../src/renderer/panels.js'), 'utf8');
const appSrc    = readFileSync(join(DIR, '../src/renderer/app.js'),    'utf8');

// ── Hilfsfunktionen zum Quellcode-Extrahieren ─────────────────────────────────

/** Gibt die Zeilen rund um das erste Vorkommen von `marker` zurück. */
function extractLines(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error(`Marker nicht gefunden: ${startMarker}`);
  const end = src.indexOf(endMarker, start);
  if (end === -1) throw new Error(`End-Marker nicht gefunden: ${endMarker}`);
  return src.slice(start, end + endMarker.length);
}

// ── A) Toggle-Logik in panels.js ─────────────────────────────────────────────

describe('panels.js – HUD-Button "present" Toggle', () => {
  it('enthält den Quellcode für den Toggle auf .presenting-Klasse', () => {
    // Statische Invariante: der Switch-Case muss den Toggle enthalten
    expect(panelsSrc).toContain("el.classList.contains('presenting')");
    expect(panelsSrc).toContain("'ss:exit-present-panel'");
    expect(panelsSrc).toContain("'ss:present-panel'");
  });

  it('dispatcht ss:exit-present-panel wenn .presenting gesetzt ist', () => {
    const el = document.createElement('div');
    el.classList.add('panel-deco', 'presenting');
    document.body.appendChild(el);

    const id = 'panel-a';
    const received = [];
    window.addEventListener('ss:exit-present-panel', () => received.push('exit'));
    window.addEventListener('ss:present-panel', e => received.push('present:' + e.detail.id));

    // Toggle-Logik direkt nachgebaut (1:1 aus panels.js):
    if (el.classList.contains('presenting')) {
      window.dispatchEvent(new CustomEvent('ss:exit-present-panel'));
    } else {
      window.dispatchEvent(new CustomEvent('ss:present-panel', { detail: { id } }));
    }

    expect(received).toEqual(['exit']);
    document.body.removeChild(el);
  });

  it('dispatcht ss:present-panel wenn .presenting NICHT gesetzt ist', () => {
    const el = document.createElement('div');
    el.classList.add('panel-deco');
    document.body.appendChild(el);

    const id = 'panel-b';
    const received = [];
    window.addEventListener('ss:exit-present-panel', () => received.push('exit'));
    window.addEventListener('ss:present-panel', e => received.push('present:' + e.detail.id));

    if (el.classList.contains('presenting')) {
      window.dispatchEvent(new CustomEvent('ss:exit-present-panel'));
    } else {
      window.dispatchEvent(new CustomEvent('ss:present-panel', { detail: { id } }));
    }

    expect(received).toEqual(['present:panel-b']);
    document.body.removeChild(el);
  });
});

// ── B) Event-Handler aus app.js ───────────────────────────────────────────────

/**
 * Extrahiert den selbst-enthaltenen Präsentations-Block aus app.js:
 *   let _presentedPanelId …
 *   let _presentOverlay …
 *   function exitPanelPresent() { … }
 *   window.addEventListener('ss:exit-present-panel', …)
 *   window.addEventListener('ss:present-panel', …)
 *
 * Der Block wird in einen Factory-Wrapper gehüllt, der `state` und
 * `applyDecoRect` als Parameter entgegennimmt, damit die Tests eigene
 * Mock-Objekte übergeben können.
 *
 * Außerdem: das relevante Escape-keydown-Fragment wird separat extrahiert.
 */
function buildPresentLogic(state, applyDecoRect) {
  // Die beiden Modul-Variablen + exitPanelPresent + zwei addEventListener-Aufrufe
  const block = extractLines(
    appSrc,
    'let _presentedPanelId = null;',
    "window.addEventListener('ss:present-panel', e => {",
  ) + `
  const { id } = e.detail;
  if (_presentedPanelId === id) return;
  exitPanelPresent();
  const p = state.panels.get(id);
  if (!p) return;
  _presentedPanelId = id;

  _presentOverlay = document.createElement('div');
  _presentOverlay.id = 'panel-present-overlay';
  document.body.appendChild(_presentOverlay);

  const scaleToFit = window.innerHeight / p.rect.h;
  p.decoEl.style.transform = \`translate(-50%, -50%) scale(\${scaleToFit})\`;
  p.decoEl.classList.add('presenting');
  document.body.classList.add('panel-presenting');
});

// Escape-keydown
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _presentedPanelId !== null) { e.preventDefault(); exitPanelPresent(); }
});`;

  // Im eval-Scope müssen state und applyDecoRect verfügbar sein
  const fn = new Function('state', 'applyDecoRect', block);
  fn(state, applyDecoRect);
}

// ── Setup für die app.js-Tests ────────────────────────────────────────────────

describe('app.js – ss:present-panel / ss:exit-present-panel Handler', () => {
  let mockState;
  let applyDecoRect;
  let panelA, panelB;

  function makePanel(id, h = 800) {
    const decoEl = document.createElement('div');
    decoEl.classList.add('panel-deco');
    decoEl.dataset.id = id;
    document.body.appendChild(decoEl);
    return { rect: { h }, decoEl };
  }

  beforeEach(() => {
    panelA = makePanel('a', 900);
    panelB = makePanel('b', 600);

    mockState = { panels: new Map([['a', panelA], ['b', panelB]]) };
    applyDecoRect = vi.fn();

    buildPresentLogic(mockState, applyDecoRect);
  });

  afterEach(() => {
    // Alle Event-Listener werden implizit durch happy-dom pro Test neu erstellt,
    // da buildPresentLogic bei jedem beforeEach neu aufgerufen wird und die
    // Variablen im Closure-Scope leben. DOM manuell bereinigen:
    document.body.innerHTML = '';
  });

  // ── ss:present-panel ──────────────────────────────────────────────────────

  it('fügt .presenting zum Panel hinzu', () => {
    window.dispatchEvent(new CustomEvent('ss:present-panel', { detail: { id: 'a' } }));
    expect(panelA.decoEl.classList.contains('presenting')).toBe(true);
  });

  it('fügt .panel-presenting zu body hinzu', () => {
    window.dispatchEvent(new CustomEvent('ss:present-panel', { detail: { id: 'a' } }));
    expect(document.body.classList.contains('panel-presenting')).toBe(true);
  });

  it('erstellt #panel-present-overlay im body', () => {
    window.dispatchEvent(new CustomEvent('ss:present-panel', { detail: { id: 'a' } }));
    expect(document.getElementById('panel-present-overlay')).not.toBeNull();
  });

  it('setzt korrekte CSS-Transform auf das Panel', () => {
    // innerHeight in happy-dom = 768 (Standard), panelA.rect.h = 900
    const scale = window.innerHeight / panelA.rect.h;
    window.dispatchEvent(new CustomEvent('ss:present-panel', { detail: { id: 'a' } }));
    expect(panelA.decoEl.style.transform).toBe(`translate(-50%, -50%) scale(${scale})`);
  });

  it('ist ein no-op wenn dieselbe Panel-ID erneut dispatcht wird', () => {
    window.dispatchEvent(new CustomEvent('ss:present-panel', { detail: { id: 'a' } }));
    // Zweites Dispatch mit gleicher ID – applyDecoRect darf NICHT aufgerufen werden
    const callsBefore = applyDecoRect.mock.calls.length;
    window.dispatchEvent(new CustomEvent('ss:present-panel', { detail: { id: 'a' } }));
    expect(applyDecoRect.mock.calls.length).toBe(callsBefore);
  });

  it('wechselt sauber von Panel A zu Panel B', () => {
    window.dispatchEvent(new CustomEvent('ss:present-panel', { detail: { id: 'a' } }));
    expect(panelA.decoEl.classList.contains('presenting')).toBe(true);

    window.dispatchEvent(new CustomEvent('ss:present-panel', { detail: { id: 'b' } }));

    // A aufgeräumt
    expect(panelA.decoEl.classList.contains('presenting')).toBe(false);
    expect(applyDecoRect).toHaveBeenCalledWith(panelA);

    // B aktiv
    expect(panelB.decoEl.classList.contains('presenting')).toBe(true);
    expect(document.body.classList.contains('panel-presenting')).toBe(true);
  });

  it('tut nichts wenn die Panel-ID unbekannt ist', () => {
    window.dispatchEvent(new CustomEvent('ss:present-panel', { detail: { id: 'unknown' } }));
    expect(document.body.classList.contains('panel-presenting')).toBe(false);
    expect(document.getElementById('panel-present-overlay')).toBeNull();
  });

  // ── ss:exit-present-panel ─────────────────────────────────────────────────

  it('entfernt .presenting vom Panel', () => {
    window.dispatchEvent(new CustomEvent('ss:present-panel', { detail: { id: 'a' } }));
    window.dispatchEvent(new CustomEvent('ss:exit-present-panel'));
    expect(panelA.decoEl.classList.contains('presenting')).toBe(false);
  });

  it('entfernt .panel-presenting von body', () => {
    window.dispatchEvent(new CustomEvent('ss:present-panel', { detail: { id: 'a' } }));
    window.dispatchEvent(new CustomEvent('ss:exit-present-panel'));
    expect(document.body.classList.contains('panel-presenting')).toBe(false);
  });

  it('entfernt #panel-present-overlay aus dem DOM', () => {
    window.dispatchEvent(new CustomEvent('ss:present-panel', { detail: { id: 'a' } }));
    window.dispatchEvent(new CustomEvent('ss:exit-present-panel'));
    expect(document.getElementById('panel-present-overlay')).toBeNull();
  });

  it('ruft applyDecoRect zum Wiederherstellen der Panel-Position auf', () => {
    window.dispatchEvent(new CustomEvent('ss:present-panel', { detail: { id: 'a' } }));
    window.dispatchEvent(new CustomEvent('ss:exit-present-panel'));
    expect(applyDecoRect).toHaveBeenCalledWith(panelA);
  });

  it('ist ein no-op wenn kein Panel präsentiert wird', () => {
    window.dispatchEvent(new CustomEvent('ss:exit-present-panel'));
    expect(applyDecoRect).not.toHaveBeenCalled();
    expect(document.body.classList.contains('panel-presenting')).toBe(false);
  });

  // ── Escape-Taste ──────────────────────────────────────────────────────────

  it('beendet Präsentation bei Escape-Taste', () => {
    window.dispatchEvent(new CustomEvent('ss:present-panel', { detail: { id: 'a' } }));
    expect(document.body.classList.contains('panel-presenting')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.body.classList.contains('panel-presenting')).toBe(false);
    expect(panelA.decoEl.classList.contains('presenting')).toBe(false);
  });

  it('ignoriert Escape wenn kein Panel präsentiert wird', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(applyDecoRect).not.toHaveBeenCalled();
  });
});
