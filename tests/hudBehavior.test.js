// @vitest-environment happy-dom
/**
 * hudBehavior.test.js
 *
 * Testet das HUD-Verhalten der Geräteansichten (aus panels.js).
 *
 * Die _hudMove-Closure wird als isolierter Factory-Baustein reproduziert,
 * der dieselbe Logik wie panels.js enthält. Zusätzlich prüfen Quell-
 * Invarianten, dass panels.js die erwarteten Konstanten und Muster enthält.
 *
 * Abgedeckte Fälle:
 *  A) Quell-Invarianten  – Konstanten und Codemuster in panels.js vorhanden
 *  B) Normalmodus        – Trigger-Zone, Show-Delay, Hide-Delay, Grenzen
 *  C) Present-Modus      – Top-Edge-Trigger, kürzerer Delay
 *  D) overHud-Scoping    – eigenes HUD hält visible; fremdes HUD hat keinen Effekt
 *  E) Timer-Korrektheit  – kein Doppel-Timer, vorzeitiger Abbruch
 *  F) Cleanup            – _hudCleanup verhindert Show/Hide nach Aufruf
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const DIR = dirname(fileURLToPath(import.meta.url));
const panelsSrc = readFileSync(join(DIR, '../src/renderer/panels.js'), 'utf8');

// ── Konstanten (spiegeln panels.js) ──────────────────────────────────────────
const FRAME_HEAD_H       = 36;
const DWELL_SHOW         = 350;
const DWELL_SHOW_PRESENT = 120;
const DWELL_HIDE         = 200;

// ── Factory: baut dieselbe _hudMove-Closure wie panels.js ────────────────────
//
// Gibt { handler, cleanup } zurück. `el` muss ein DOM-Element sein,
// dessen getBoundingClientRect() per vi.spyOn gesteuert werden kann.
function buildHudHandler(el) {
  let _hudShowTimer = null;
  let _hudHideTimer = null;

  const handler = e => {
    const presenting = el.classList.contains('presenting');
    const overHud    = el.contains(e.target) && !!e.target.closest('.panel-hud');
    let inside;
    if (overHud) {
      inside = true;
    } else if (presenting) {
      inside = e.clientY <= 64;
    } else {
      const r = el.getBoundingClientRect();
      inside = e.clientX >= r.left && e.clientX <= r.right &&
               e.clientY >= r.top  && e.clientY <= r.top + FRAME_HEAD_H;
    }

    if (inside) {
      clearTimeout(_hudHideTimer);
      _hudHideTimer = null;
      if (!el.classList.contains('hud-visible') && !_hudShowTimer) {
        const delay = el.classList.contains('presenting') ? DWELL_SHOW_PRESENT : DWELL_SHOW;
        _hudShowTimer = setTimeout(() => {
          _hudShowTimer = null;
          el.classList.add('hud-visible');
        }, delay);
      }
    } else {
      clearTimeout(_hudShowTimer);
      _hudShowTimer = null;
      if (el.classList.contains('hud-visible') && !_hudHideTimer) {
        _hudHideTimer = setTimeout(() => {
          _hudHideTimer = null;
          el.classList.remove('hud-visible');
        }, DWELL_HIDE);
      }
    }
  };

  const cleanup = () => {
    clearTimeout(_hudShowTimer);
    clearTimeout(_hudHideTimer);
  };

  return { handler, cleanup };
}

// ── Hilfsfunktion: Event-Objekt mit Target erzeugen ────────────────────────
// Plain-Object statt MouseEvent: handler greift nur auf clientX/clientY/target zu.
function moveEvent(clientX, clientY, target = document.body) {
  return { clientX, clientY, target };
}

// ── Hilfsfunktion: Panel-Element mit HUD-Struktur ────────────────────────────
function makePanel(rect = { left: 100, top: 200, right: 400, bottom: 600 }) {
  const el  = document.createElement('div');
  el.className = 'panel-deco';
  const hud = document.createElement('div');
  hud.className = 'panel-hud';
  el.appendChild(hud);
  document.body.appendChild(el);

  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left:   rect.left,
    top:    rect.top,
    right:  rect.right,
    bottom: rect.bottom,
    width:  rect.right - rect.left,
    height: rect.bottom - rect.top,
  });

  return { el, hud };
}

// ─────────────────────────────────────────────────────────────────────────────
// A) Quell-Invarianten
// ─────────────────────────────────────────────────────────────────────────────

describe('A) Quell-Invarianten – panels.js enthält erwartete Konstanten/Muster', () => {
  it('enthält DWELL_SHOW = 350', () => {
    expect(panelsSrc).toContain('DWELL_SHOW = 350');
  });

  it('enthält DWELL_SHOW_PRESENT = 120', () => {
    expect(panelsSrc).toContain('DWELL_SHOW_PRESENT = 120');
  });

  it('enthält DWELL_HIDE = 200', () => {
    expect(panelsSrc).toContain('DWELL_HIDE = 200');
  });

  it('enthält Top-Edge-Trigger mit Grenzwert 64 im Present-Modus', () => {
    expect(panelsSrc).toContain('e.clientY <= 64');
  });

  it('enthält Frame-Kopf-Zone mit FRAME_HEAD_H', () => {
    expect(panelsSrc).toContain('r.top + FRAME_HEAD_H');
  });

  it('enthält overHud-Check mit el.contains', () => {
    expect(panelsSrc).toContain('el.contains(e.target)');
  });

  it('enthält _hudCleanup mit clearTimeout für beide Timer', () => {
    // Ab der Definition von el._hudCleanup die nächsten 120 Zeichen prüfen
    const defMarker = 'el._hudCleanup = () => {';
    const pos = panelsSrc.indexOf(defMarker);
    expect(pos).toBeGreaterThanOrEqual(0);
    const cleanupBlock = panelsSrc.slice(pos, pos + 120);
    expect(cleanupBlock).toContain('clearTimeout(_hudShowTimer)');
    expect(cleanupBlock).toContain('clearTimeout(_hudHideTimer)');
  });

  it('ruft _hudCleanup vor removeEventListener in removePanel auf', () => {
    const removePanelBlock = panelsSrc.slice(
      panelsSrc.indexOf('export function removePanel'),
      panelsSrc.indexOf('export function removePanel') + 500,
    );
    const cleanupPos = removePanelBlock.indexOf('_hudCleanup');
    const removePos  = removePanelBlock.indexOf('removeEventListener');
    expect(cleanupPos).toBeGreaterThanOrEqual(0);
    expect(removePos).toBeGreaterThanOrEqual(0);
    expect(cleanupPos).toBeLessThan(removePos);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B) Normalmodus
// ─────────────────────────────────────────────────────────────────────────────

describe('B) Normalmodus – Trigger-Zone, Show-/Hide-Delay', () => {
  let el, hud, handler, cleanup;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ el, hud } = makePanel({ left: 100, top: 200, right: 400, bottom: 600 }));
    ({ handler, cleanup } = buildHudHandler(el));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  // ── Zone: innerhalb Frame-Kopf ────────────────────────────────────────────

  it('startet Show-Timer wenn Maus im Frame-Kopf (obere 36px)', () => {
    handler(moveEvent(200, 210)); // y=210, top=200 → Δ=10, innerhalb 36px
    expect(el.classList.contains('hud-visible')).toBe(false);
    vi.advanceTimersByTime(DWELL_SHOW);
    expect(el.classList.contains('hud-visible')).toBe(true);
  });

  it('zeigt HUD exakt an der unteren Grenze der Frame-Kopf-Zone (top + 36px)', () => {
    handler(moveEvent(200, 200 + FRAME_HEAD_H)); // genau an der Grenze
    vi.advanceTimersByTime(DWELL_SHOW);
    expect(el.classList.contains('hud-visible')).toBe(true);
  });

  it('zeigt HUD NICHT einen Pixel unterhalb der Frame-Kopf-Zone', () => {
    handler(moveEvent(200, 200 + FRAME_HEAD_H + 1));
    vi.advanceTimersByTime(DWELL_SHOW);
    expect(el.classList.contains('hud-visible')).toBe(false);
  });

  it('zeigt HUD NICHT wenn Maus außerhalb des Panel-X-Bereichs', () => {
    handler(moveEvent(50, 210)); // x=50, links vom Panel (left=100)
    vi.advanceTimersByTime(DWELL_SHOW);
    expect(el.classList.contains('hud-visible')).toBe(false);
  });

  it('zeigt HUD NICHT wenn Maus im Webview-Bereich unterhalb Frame-Kopf', () => {
    handler(moveEvent(200, 400)); // y=400, weit unterhalb des Kopfes
    vi.advanceTimersByTime(DWELL_SHOW);
    expect(el.classList.contains('hud-visible')).toBe(false);
  });

  // ── Show-Delay: DWELL_SHOW = 350ms ───────────────────────────────────────

  it('zeigt HUD nicht vor Ablauf des Dwell-Delays (349ms)', () => {
    handler(moveEvent(200, 210));
    vi.advanceTimersByTime(DWELL_SHOW - 1);
    expect(el.classList.contains('hud-visible')).toBe(false);
  });

  it('zeigt HUD nach exakt DWELL_SHOW ms', () => {
    handler(moveEvent(200, 210));
    vi.advanceTimersByTime(DWELL_SHOW);
    expect(el.classList.contains('hud-visible')).toBe(true);
  });

  // ── Hide-Delay: DWELL_HIDE = 200ms ───────────────────────────────────────

  it('startet Hide-Timer wenn HUD sichtbar und Maus verlässt Zone', () => {
    el.classList.add('hud-visible');
    handler(moveEvent(200, 500)); // außerhalb
    expect(el.classList.contains('hud-visible')).toBe(true); // noch nicht weg
    vi.advanceTimersByTime(DWELL_HIDE);
    expect(el.classList.contains('hud-visible')).toBe(false);
  });

  it('versteckt HUD nicht vor Ablauf des Hide-Delays (199ms)', () => {
    el.classList.add('hud-visible');
    handler(moveEvent(200, 500));
    vi.advanceTimersByTime(DWELL_HIDE - 1);
    expect(el.classList.contains('hud-visible')).toBe(true);
  });

  it('bricht Hide-Timer ab wenn Maus in die Zone zurückkehrt', () => {
    el.classList.add('hud-visible');
    handler(moveEvent(200, 500)); // verlässt Zone → Hide-Timer gestartet
    vi.advanceTimersByTime(DWELL_HIDE - 50);
    handler(moveEvent(200, 215)); // kehrt zurück → Hide-Timer abgebrochen
    vi.advanceTimersByTime(100);
    expect(el.classList.contains('hud-visible')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C) Present-Modus
// ─────────────────────────────────────────────────────────────────────────────

describe('C) Present-Modus – Top-Edge-Trigger, kürzerer Delay', () => {
  let el, hud, handler, cleanup;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ el, hud } = makePanel());
    el.classList.add('presenting');
    ({ handler, cleanup } = buildHudHandler(el));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('triggert HUD wenn clientY ≤ 64', () => {
    handler(moveEvent(0, 64));
    vi.advanceTimersByTime(DWELL_SHOW_PRESENT);
    expect(el.classList.contains('hud-visible')).toBe(true);
  });

  it('triggert HUD bei clientY = 0', () => {
    handler(moveEvent(0, 0));
    vi.advanceTimersByTime(DWELL_SHOW_PRESENT);
    expect(el.classList.contains('hud-visible')).toBe(true);
  });

  it('triggert HUD NICHT bei clientY = 65', () => {
    handler(moveEvent(0, 65));
    vi.advanceTimersByTime(DWELL_SHOW_PRESENT);
    expect(el.classList.contains('hud-visible')).toBe(false);
  });

  it('verwendet DWELL_SHOW_PRESENT (120ms) statt DWELL_SHOW (350ms)', () => {
    handler(moveEvent(0, 20));
    vi.advanceTimersByTime(DWELL_SHOW_PRESENT);
    expect(el.classList.contains('hud-visible')).toBe(true);
  });

  it('zeigt HUD nicht bereits nach DWELL_SHOW_PRESENT - 1 ms', () => {
    handler(moveEvent(0, 20));
    vi.advanceTimersByTime(DWELL_SHOW_PRESENT - 1);
    expect(el.classList.contains('hud-visible')).toBe(false);
  });

  it('ignoriert Panel-Bounding-Box im Present-Modus (X-Koordinate egal)', () => {
    // Im Present-Modus wird getBoundingClientRect nicht verwendet
    handler(moveEvent(9999, 20)); // x weit außerhalb
    vi.advanceTimersByTime(DWELL_SHOW_PRESENT);
    expect(el.classList.contains('hud-visible')).toBe(true);
  });

  it('beendet Present-Modus: Normalmodus-Delay gilt wieder', () => {
    el.classList.remove('presenting');
    handler(moveEvent(200, 215)); // in Frame-Kopf-Zone
    vi.advanceTimersByTime(DWELL_SHOW_PRESENT);
    expect(el.classList.contains('hud-visible')).toBe(false); // 120ms reichen nicht mehr
    vi.advanceTimersByTime(DWELL_SHOW - DWELL_SHOW_PRESENT);
    expect(el.classList.contains('hud-visible')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D) overHud-Scoping
// ─────────────────────────────────────────────────────────────────────────────

describe('D) overHud-Scoping – eigenes HUD hält visible; fremdes hat keinen Effekt', () => {
  let el, hud, handler, cleanup;
  let el2, hud2, handler2, cleanup2;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ el, hud }   = makePanel({ left: 100, top: 200, right: 400, bottom: 600 }));
    ({ el: el2, hud: hud2 } = makePanel({ left: 500, top: 200, right: 800, bottom: 600 }));
    ({ handler, cleanup }   = buildHudHandler(el));
    ({ handler: handler2, cleanup: cleanup2 } = buildHudHandler(el2));
  });

  afterEach(() => {
    cleanup(); cleanup2();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('zeigt HUD sofort wenn Maus über eigenem HUD-Element ist (kein Delay nötig)', () => {
    // Kein Delay: inside=true → Show-Timer wird gesetzt, aber da wir
    // direkt nach advanceTimersByTime prüfen, genügt DWELL_SHOW.
    handler(moveEvent(200, 500, hud));
    vi.advanceTimersByTime(DWELL_SHOW);
    expect(el.classList.contains('hud-visible')).toBe(true);
  });

  it('hält HUD sichtbar wenn Maus vom Frame-Kopf zum eigenen HUD wandert', () => {
    // 1. HUD einblenden (via Frame-Kopf)
    handler(moveEvent(200, 210));
    vi.advanceTimersByTime(DWELL_SHOW);
    expect(el.classList.contains('hud-visible')).toBe(true);

    // 2. Maus auf HUD bewegen – outside der Frame-Kopf-Zone, aber overHud=true
    handler(moveEvent(200, 500, hud));
    vi.advanceTimersByTime(DWELL_HIDE + 100);
    expect(el.classList.contains('hud-visible')).toBe(true);
  });

  it('triggert HUD von Panel 1 NICHT durch Maus über HUD von Panel 2', () => {
    // hud2 gehört zu el2, nicht zu el → el.contains(hud2) = false
    handler(moveEvent(200, 500, hud2));
    vi.advanceTimersByTime(DWELL_SHOW);
    expect(el.classList.contains('hud-visible')).toBe(false);
  });

  it('Panel 2 reagiert korrekt auf eigenes HUD', () => {
    handler2(moveEvent(600, 500, hud2));
    vi.advanceTimersByTime(DWELL_SHOW);
    expect(el2.classList.contains('hud-visible')).toBe(true);
    expect(el.classList.contains('hud-visible')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E) Timer-Korrektheit – kein Doppel-Timer, vorzeitiger Abbruch
// ─────────────────────────────────────────────────────────────────────────────

describe('E) Timer-Korrektheit', () => {
  let el, hud, handler, cleanup;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ el, hud } = makePanel({ left: 100, top: 200, right: 400, bottom: 600 }));
    ({ handler, cleanup } = buildHudHandler(el));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('startet Show-Timer nur einmal bei mehreren mousemove in der Zone', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    handler(moveEvent(200, 210));
    handler(moveEvent(201, 212));
    handler(moveEvent(202, 214));
    // Nur ein setTimeout-Aufruf für den Show-Timer erwartet
    const showCalls = setTimeoutSpy.mock.calls.length;
    expect(showCalls).toBe(1);
    vi.advanceTimersByTime(DWELL_SHOW);
    expect(el.classList.contains('hud-visible')).toBe(true);
    setTimeoutSpy.mockRestore();
  });

  it('bricht Show-Timer ab wenn Maus Zone verlässt bevor Timer feuert', () => {
    handler(moveEvent(200, 210));        // Zone → Show-Timer gestartet
    vi.advanceTimersByTime(DWELL_SHOW - 50);
    handler(moveEvent(200, 500));        // verlässt Zone → Timer abbrechen
    vi.advanceTimersByTime(200);         // weit über DWELL_SHOW hinaus
    expect(el.classList.contains('hud-visible')).toBe(false);
  });

  it('startet Hide-Timer nur einmal bei mehreren mousemove außerhalb', () => {
    el.classList.add('hud-visible');
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    handler(moveEvent(200, 500));
    handler(moveEvent(201, 501));
    handler(moveEvent(202, 502));
    expect(setTimeoutSpy.mock.calls.length).toBe(1);
    setTimeoutSpy.mockRestore();
  });

  it('bricht Hide-Timer ab wenn Maus in Zone zurückkehrt', () => {
    el.classList.add('hud-visible');
    handler(moveEvent(200, 500));              // verlässt → Hide-Timer
    vi.advanceTimersByTime(DWELL_HIDE - 50);
    handler(moveEvent(200, 210));              // Zone → Hide-Timer abgebrochen
    vi.advanceTimersByTime(DWELL_HIDE);
    expect(el.classList.contains('hud-visible')).toBe(true);
  });

  it('startet keinen Show-Timer wenn HUD bereits sichtbar ist', () => {
    el.classList.add('hud-visible');
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    handler(moveEvent(200, 210));
    expect(setTimeoutSpy.mock.calls.length).toBe(0);
    setTimeoutSpy.mockRestore();
  });

  it('startet keinen Hide-Timer wenn HUD bereits versteckt ist', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    handler(moveEvent(200, 500)); // außerhalb, HUD schon hidden
    expect(setTimeoutSpy.mock.calls.length).toBe(0);
    setTimeoutSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F) Cleanup
// ─────────────────────────────────────────────────────────────────────────────

describe('F) Cleanup – _hudCleanup verhindert Show/Hide nach Aufruf', () => {
  let el, hud, handler, cleanup;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ el, hud } = makePanel({ left: 100, top: 200, right: 400, bottom: 600 }));
    ({ handler, cleanup } = buildHudHandler(el));
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('verhindert dass Show-Timer nach cleanup noch feuert', () => {
    handler(moveEvent(200, 210)); // Show-Timer gestartet
    cleanup();
    vi.advanceTimersByTime(DWELL_SHOW + 100);
    expect(el.classList.contains('hud-visible')).toBe(false);
  });

  it('verhindert dass Hide-Timer nach cleanup noch feuert', () => {
    el.classList.add('hud-visible');
    handler(moveEvent(200, 500)); // Hide-Timer gestartet
    cleanup();
    vi.advanceTimersByTime(DWELL_HIDE + 100);
    expect(el.classList.contains('hud-visible')).toBe(true);
  });

  it('ist idempotent – doppelter cleanup-Aufruf wirft keinen Fehler', () => {
    handler(moveEvent(200, 210));
    expect(() => { cleanup(); cleanup(); }).not.toThrow();
  });
});
