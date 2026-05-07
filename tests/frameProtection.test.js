// @vitest-environment happy-dom
/**
 * frameProtection.test.js
 *
 * Testet die Frame-Protection-Logik aus panels.js:
 * – _setFrameProtection(active)
 * – mousemove-Handler: Erkennung ob Maus im Frame- oder Content-Bereich liegt
 * – mouseleave-Handler: setzt Protection zurück
 *
 * Die Logik wird als isolierte Funktion repliziert (1:1 aus panels.js),
 * da panels.js nicht importierbar ist (DOM-Abhängigkeiten beim Laden).
 * Quell-Invarianten prüfen zusätzlich, dass der echte Code die erwarteten
 * Muster enthält.
 *
 * Abgedeckte Fälle:
 *  A) Quell-Invarianten      – erwartete Muster in panels.js vorhanden
 *  B) _setFrameProtection    – aktiviert/deaktiviert pointer-events
 *  C) mousemove im Frame     – Maus im Rahmen außerhalb Viewport → aktiv
 *  D) mousemove im Content   – Maus im Viewport → nicht aktiv
 *  E) mousemove außerhalb    – Maus außerhalb Panel → nicht aktiv
 *  F) mehrere Panels         – erstes Frame-Treffer reicht
 *  G) mouseleave             – setzt Protection zurück
 *  H) kein Panel vorhanden   – kein Fehler, nicht aktiv
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const DIR     = dirname(fileURLToPath(import.meta.url));
const src     = readFileSync(join(DIR, '../src/renderer/panels.js'), 'utf8');

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

/**
 * Erstellt ein minimales Panel-Objekt mit steuerbaren BoundingClientRects.
 * decoOuter: äußeres Rect des panel-deco
 * vpInner:   Rect des panel-viewport (Teilmenge von decoOuter)
 */
function makePanel(decoOuter, vpInner) {
  const vpEl = {
    getBoundingClientRect: () => vpInner,
  };
  const decoEl = {
    getBoundingClientRect: () => decoOuter,
    querySelector: sel => sel === '.panel-viewport' ? vpEl : null,
  };
  return { decoEl };
}

/**
 * Isolierte Replik der Frame-Protection-Kern-Logik aus panels.js.
 * Gibt zurück ob die Maus im Frame-Bereich liegt.
 */
function isInFrame(panels, cx, cy) {
  for (const p of panels) {
    const r = p.decoEl.getBoundingClientRect();
    if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) continue;
    const vpEl = p.decoEl.querySelector('.panel-viewport');
    if (vpEl) {
      const vr = vpEl.getBoundingClientRect();
      if (cx >= vr.left && cx <= vr.right && cy >= vr.top && cy <= vr.bottom) continue;
    }
    return true;
  }
  return false;
}

/**
 * Replik von _setFrameProtection.
 */
function buildSetFrameProtection(desktopWv, panels) {
  let active = false;
  function set(next) {
    if (active === next) return;
    active = next;
    const pe = next ? 'none' : '';
    if (desktopWv) desktopWv.style.pointerEvents = pe;
    for (const p of panels) {
      const wv = p.decoEl?.querySelector?.('.panel-webview');
      if (wv) wv.style.pointerEvents = pe;
    }
  }
  return { set, getActive: () => active };
}

// ── A) Quell-Invarianten ──────────────────────────────────────────────────────

describe('A) Quell-Invarianten panels.js', () => {
  it('enthält _setFrameProtection', () => {
    expect(src).toContain('_setFrameProtection');
  });
  it('enthält _frameProtActive', () => {
    expect(src).toContain('_frameProtActive');
  });
  it('setzt pointer-events auf none wenn aktiv', () => {
    expect(src).toContain("active ? 'none' : ''");
  });
  it('prüft .panel-viewport per querySelector', () => {
    expect(src).toContain("'.panel-viewport'");
  });
  it('registriert mousemove auf document', () => {
    expect(src).toContain("document.addEventListener('mousemove'");
  });
  it('registriert mouseleave auf document', () => {
    expect(src).toContain("document.addEventListener('mouseleave'");
  });
  it('überspringt Handler bei laufendem Drag', () => {
    expect(src).toContain('if (drag || rsz) return');
  });
});

// ── B) _setFrameProtection ────────────────────────────────────────────────────

describe('B) _setFrameProtection', () => {
  let desktopWv, wvEl, panel, prot;

  beforeEach(() => {
    desktopWv = { style: { pointerEvents: '' } };
    wvEl = { style: { pointerEvents: '' } };
    const vpEl  = { getBoundingClientRect: () => ({ left: 10, right: 90, top: 40, bottom: 90 }) };
    const decoEl = {
      getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }),
      querySelector: sel => sel === '.panel-viewport' ? vpEl : (sel === '.panel-webview' ? wvEl : null),
    };
    panel = { decoEl };
    prot  = buildSetFrameProtection(desktopWv, [panel]);
  });

  it('setzt pointer-events:none auf desktopWv wenn aktiv', () => {
    prot.set(true);
    expect(desktopWv.style.pointerEvents).toBe('none');
  });

  it('setzt pointer-events:none auf panel-webview wenn aktiv', () => {
    prot.set(true);
    expect(wvEl.style.pointerEvents).toBe('none');
  });

  it('stellt pointer-events zurück wenn deaktiviert', () => {
    prot.set(true);
    prot.set(false);
    expect(desktopWv.style.pointerEvents).toBe('');
    expect(wvEl.style.pointerEvents).toBe('');
  });

  it('ist idempotent – zweimalig true ändert nichts (kein unnötiger DOM-Schreibzugriff)', () => {
    prot.set(true);
    wvEl.style.pointerEvents = 'SENTINEL';
    prot.set(true); // soll nichts schreiben, da bereits aktiv
    expect(wvEl.style.pointerEvents).toBe('SENTINEL');
  });

  it('ist idempotent – zweimalig false ändert nichts', () => {
    prot.set(false);
    desktopWv.style.pointerEvents = 'SENTINEL';
    prot.set(false);
    expect(desktopWv.style.pointerEvents).toBe('SENTINEL');
  });
});

// ── C) Maus im Frame-Bereich ──────────────────────────────────────────────────

describe('C) isInFrame – Maus im Rahmen außerhalb Viewport', () => {
  // Panel: deco 0–100 × 0–100, viewport 10–90 × 40–90
  const decoOuter = { left: 0, right: 100, top: 0, bottom: 100 };
  const vpInner   = { left: 10, right: 90, top: 40, bottom: 90 };
  const panels    = [makePanel(decoOuter, vpInner)];

  it('Maus auf Titelleiste (oben, innerhalb deco, oberhalb viewport)', () => {
    expect(isInFrame(panels, 50, 20)).toBe(true);
  });

  it('Maus auf linkem Rahmen (links von viewport, innerhalb deco)', () => {
    expect(isInFrame(panels, 5, 60)).toBe(true);
  });

  it('Maus auf rechtem Rahmen (rechts von viewport)', () => {
    expect(isInFrame(panels, 95, 60)).toBe(true);
  });

  it('Maus auf unterem Rahmen (unterhalb viewport)', () => {
    expect(isInFrame(panels, 50, 95)).toBe(true);
  });

  it('Maus exakt auf oberer Kante des deco', () => {
    expect(isInFrame(panels, 50, 0)).toBe(true);
  });

  it('Maus exakt auf linker Kante des deco', () => {
    expect(isInFrame(panels, 0, 50)).toBe(true);
  });
});

// ── D) Maus im Content-Bereich (Viewport) ─────────────────────────────────────

describe('D) isInFrame – Maus im Viewport (Content)', () => {
  const decoOuter = { left: 0, right: 100, top: 0, bottom: 100 };
  const vpInner   = { left: 10, right: 90, top: 40, bottom: 90 };
  const panels    = [makePanel(decoOuter, vpInner)];

  it('Maus mittig im Viewport → nicht im Frame', () => {
    expect(isInFrame(panels, 50, 65)).toBe(false);
  });

  it('Maus exakt auf linker Viewport-Kante → nicht im Frame', () => {
    expect(isInFrame(panels, 10, 65)).toBe(false);
  });

  it('Maus exakt auf oberer Viewport-Kante → nicht im Frame', () => {
    expect(isInFrame(panels, 50, 40)).toBe(false);
  });

  it('Maus exakt auf rechter Viewport-Kante → nicht im Frame', () => {
    expect(isInFrame(panels, 90, 65)).toBe(false);
  });

  it('Maus exakt auf unterer Viewport-Kante → nicht im Frame', () => {
    expect(isInFrame(panels, 50, 90)).toBe(false);
  });
});

// ── E) Maus außerhalb Panel ───────────────────────────────────────────────────

describe('E) isInFrame – Maus außerhalb Panel', () => {
  const decoOuter = { left: 50, right: 150, top: 50, bottom: 150 };
  const vpInner   = { left: 60, right: 140, top: 86, bottom: 140 };
  const panels    = [makePanel(decoOuter, vpInner)];

  it('Maus links vom Panel', () => {
    expect(isInFrame(panels, 10, 100)).toBe(false);
  });

  it('Maus oberhalb des Panels', () => {
    expect(isInFrame(panels, 100, 10)).toBe(false);
  });

  it('Maus rechts vom Panel', () => {
    expect(isInFrame(panels, 200, 100)).toBe(false);
  });

  it('Maus unterhalb des Panels', () => {
    expect(isInFrame(panels, 100, 200)).toBe(false);
  });
});

// ── F) Mehrere Panels ─────────────────────────────────────────────────────────

describe('F) isInFrame – mehrere Panels', () => {
  // Panel A: 0–100 × 0–100, Viewport 10–90 × 36–90
  // Panel B: 200–300 × 0–100, Viewport 210–290 × 36–90
  const panelA = makePanel(
    { left: 0,   right: 100, top: 0, bottom: 100 },
    { left: 10,  right: 90,  top: 36, bottom: 90 },
  );
  const panelB = makePanel(
    { left: 200, right: 300, top: 0, bottom: 100 },
    { left: 210, right: 290, top: 36, bottom: 90 },
  );
  const panels = [panelA, panelB];

  it('Maus im Frame von Panel A → aktiv', () => {
    expect(isInFrame(panels, 5, 18)).toBe(true);
  });

  it('Maus im Frame von Panel B → aktiv', () => {
    expect(isInFrame(panels, 295, 18)).toBe(true);
  });

  it('Maus im Viewport von Panel A → nicht aktiv', () => {
    expect(isInFrame(panels, 50, 60)).toBe(false);
  });

  it('Maus im Viewport von Panel B → nicht aktiv', () => {
    expect(isInFrame(panels, 250, 60)).toBe(false);
  });

  it('Maus zwischen den Panels (außerhalb beider) → nicht aktiv', () => {
    expect(isInFrame(panels, 150, 50)).toBe(false);
  });
});

// ── G) mouseleave ─────────────────────────────────────────────────────────────

describe('G) _setFrameProtection – mouseleave setzt zurück', () => {
  it('deaktiviert wenn vorher aktiv', () => {
    const desktopWv = { style: { pointerEvents: '' } };
    const prot = buildSetFrameProtection(desktopWv, []);
    prot.set(true);
    expect(desktopWv.style.pointerEvents).toBe('none');
    prot.set(false); // simuliert mouseleave → _setFrameProtection(false)
    expect(desktopWv.style.pointerEvents).toBe('');
  });
});

// ── H) kein Panel vorhanden ───────────────────────────────────────────────────

describe('H) isInFrame – keine Panels', () => {
  it('gibt false zurück ohne Fehler', () => {
    expect(isInFrame([], 50, 50)).toBe(false);
  });
});
