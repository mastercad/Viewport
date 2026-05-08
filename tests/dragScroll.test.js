// @vitest-environment happy-dom
/**
 * dragScroll.test.js
 *
 * Tests für den Touch-/Drag-Scroll-Polyfill (src/renderer/panels.js).
 *
 * Teststrategie:
 *   - Polyfill wird via Regex aus panels.js extrahiert und EINMALIG per eval()
 *     in der happy-dom-Umgebung registriert (beforeAll).
 *   - Da happy-dom getComputedStyle.overflowX aus inline-styles nicht korrekt
 *     reflektiert, landen Wheel-Events in findScrollable() am documentElement.
 *     Wheel-Laufzeittests werden deshalb durch Source-Invarianten ersetzt.
 *   - Drag-Tests: scrollLeft/scrollTop-Setter werden per Object.defineProperty
 *     als controllable spy gesetzt, sodass happy-dom's natives Scroll-Verhalten
 *     keinen Einfluss hat.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const DIR       = dirname(fileURLToPath(import.meta.url));
const panelsSrc = readFileSync(join(DIR, '../src/renderer/panels.js'), 'utf8');

// ── Inject-Code extrahieren ───────────────────────────────────────────────────
const INJECT_MATCH = panelsSrc.match(/executeJavaScript\(`([\s\S]*?__eTouchPf[\s\S]*?)`\)\.catch/);
if (!INJECT_MATCH) throw new Error('Touch-Polyfill nicht in panels.js gefunden');
const INJECT_CODE = INJECT_MATCH[1];

// ── Polyfill einmalig registrieren ────────────────────────────────────────────
// Einmaliger beforeAll verhindert Listener-Akkumulation über Tests hinweg.
beforeAll(() => {
  delete window.__eTouchPf;
  eval(INJECT_CODE);
});

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function fireMouseEvent(type, target, { clientX = 0, clientY = 0, button = 0, isTrusted = true } = {}) {
  const ev = new MouseEvent(type, {
    bubbles: true, cancelable: true,
    clientX, clientY, screenX: clientX, screenY: clientY, button,
  });
  Object.defineProperty(ev, 'isTrusted', { value: isTrusted });
  target.dispatchEvent(ev);
  return ev;
}

/**
 * Erstellt ein Element mit vollständig kontrollierbaren scroll-Properties.
 * Setter-Spies stellen sicher, dass happy-dom's eigene Scroll-Logik den
 * gemessenen Wert nicht beeinflusst.
 */
function makeScrollable() {
  const el = document.createElement('div');
  let _sl = 0, _st = 0;
  Object.defineProperty(el, 'scrollWidth',  { configurable: true, get: () => 1000 });
  Object.defineProperty(el, 'clientWidth',  { configurable: true, get: () => 300 });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 1000 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 300 });
  Object.defineProperty(el, 'scrollLeft', {
    configurable: true, get: () => _sl, set: v => { _sl = v; },
  });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true, get: () => _st, set: v => { _st = v; },
  });
  document.body.appendChild(el);
  return el;
}

// ─────────────────────────────────────────────────────────────────────────────
// Initialisierung / Idempotenz
// ─────────────────────────────────────────────────────────────────────────────

describe('Polyfill – Initialisierung', () => {
  it('setzt window.__eTouchPf = 1', () => {
    expect(window.__eTouchPf).toBe(1);
  });

  it('zweimaliges Injizieren überschreibt __eTouchPf NICHT (Guard greift)', () => {
    window.__eTouchPf = 42;
    eval(INJECT_CODE); // if(window.__eTouchPf)return; → frühes return
    expect(window.__eTouchPf).toBe(42);
    window.__eTouchPf = 1; // zurücksetzen
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mousedown → touchstart
// ─────────────────────────────────────────────────────────────────────────────

describe('mousedown → touchstart', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('löst touchstart auf dem Ziel-Element aus', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    let count = 0;
    el.addEventListener('touchstart', () => count++);
    fireMouseEvent('mousedown', el, { clientX: 10, clientY: 20 });
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('touchstart hat korrekte clientX/clientY', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const touches = [];
    el.addEventListener('touchstart', e => touches.push(e.touches[0]));
    fireMouseEvent('mousedown', el, { clientX: 55, clientY: 77 });
    expect(touches[0]?.clientX).toBe(55);
    expect(touches[0]?.clientY).toBe(77);
  });

  it('button !== 0 → kein touchstart', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    let fired = false;
    el.addEventListener('touchstart', () => { fired = true; });
    fireMouseEvent('mousedown', el, { button: 2 });
    expect(fired).toBe(false);
  });

  it('isTrusted=false → kein touchstart', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    let fired = false;
    el.addEventListener('touchstart', () => { fired = true; });
    fireMouseEvent('mousedown', el, { isTrusted: false });
    expect(fired).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mouseup → touchend
// ─────────────────────────────────────────────────────────────────────────────

describe('mouseup → touchend', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('löst touchend aus nach mousedown + mouseup', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    let count = 0;
    el.addEventListener('touchend', () => count++);
    fireMouseEvent('mousedown', el, { clientX: 10, clientY: 10 });
    fireMouseEvent('mouseup',   el, { clientX: 10, clientY: 10 });
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('touchend hat leere touches-Liste', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    let ev = null;
    el.addEventListener('touchend', e => { ev = e; });
    fireMouseEvent('mousedown', el);
    fireMouseEvent('mouseup',   el);
    expect(ev?.touches.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Drag – horizontales Scrollen
// ─────────────────────────────────────────────────────────────────────────────

describe('Drag – horizontales Scrollen', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('Drag nach links (clientX nimmt ab) erhöht scrollLeft', () => {
    const el = makeScrollable();
    fireMouseEvent('mousedown', el, { clientX: 200, clientY: 100 });
    fireMouseEvent('mousemove', el, { clientX: 190, clientY: 100 }); // dx=-10 → scrollLeft+=10
    fireMouseEvent('mousemove', el, { clientX: 180, clientY: 100 }); // dx=-10 → scrollLeft+=10
    expect(el.scrollLeft).toBeGreaterThan(0);
  });

  it('Drag nach rechts (clientX nimmt zu) verringert scrollLeft', () => {
    const el = makeScrollable();
    el.scrollLeft = 100;
    fireMouseEvent('mousedown', el, { clientX: 100, clientY: 100 });
    fireMouseEvent('mousemove', el, { clientX: 110, clientY: 100 }); // dx=+10 → scrollLeft-=10
    fireMouseEvent('mousemove', el, { clientX: 120, clientY: 100 }); // dx=+10 → scrollLeft-=10
    expect(el.scrollLeft).toBeLessThan(100);
  });

  it('Bewegung unter DRAG_THRESHOLD scrollt nicht', () => {
    const el = makeScrollable();
    fireMouseEvent('mousedown', el, { clientX: 100, clientY: 100 });
    fireMouseEvent('mousemove', el, { clientX: 103, clientY: 100 }); // 3px < DRAG_THRESHOLD=5
    fireMouseEvent('mouseup',   el, { clientX: 103, clientY: 100 });
    expect(el.scrollLeft).toBe(0);
  });

  it('horizontale Dominanz → X-Achse scrollt', () => {
    const el = makeScrollable();
    fireMouseEvent('mousedown', el, { clientX: 100, clientY: 100 });
    fireMouseEvent('mousemove', el, { clientX: 90, clientY: 102 }); // dx=10 >> dy=2
    expect(el.scrollLeft).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Drag – vertikales Scrollen
// ─────────────────────────────────────────────────────────────────────────────

describe('Drag – vertikales Scrollen', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('Drag nach oben (clientY nimmt ab) erhöht scrollTop', () => {
    const el = makeScrollable();
    fireMouseEvent('mousedown', el, { clientX: 100, clientY: 200 });
    fireMouseEvent('mousemove', el, { clientX: 100, clientY: 190 });
    fireMouseEvent('mousemove', el, { clientX: 100, clientY: 180 });
    expect(el.scrollTop).toBeGreaterThan(0);
  });

  it('vertikale Dominanz → scrollTop wird gesetzt', () => {
    const el = makeScrollable();
    fireMouseEvent('mousedown', el, { clientX: 100, clientY: 100 });
    // dy=10 >> dx=2 → vertikale Achse gewählt; scrollTop-=dy gesetzt
    fireMouseEvent('mousemove', el, { clientX: 102, clientY: 90 });
    expect(el.scrollTop).toBeGreaterThan(0);
    // Hinweis: der Polyfill scrollt beide Achsen (scrollLeft-=dx, scrollTop-=dy),
    // die Achsenwahl via findScrollable bestimmt nur das Ziel-Element, nicht
    // welche Achse gescrollt wird. scrollLeft kann daher auch ≠ 0 sein.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Click-Unterdrückung nach Drag
// ─────────────────────────────────────────────────────────────────────────────

describe('Click-Unterdrückung nach Drag', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('click nach Drag wird unterdrückt (stopPropagation auf document-capture)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    let clicked = false;
    document.addEventListener('click', () => { clicked = true; });

    fireMouseEvent('mousedown', el, { clientX: 100, clientY: 100 });
    fireMouseEvent('mousemove', el, { clientX: 90,  clientY: 100 }); // 10px > Threshold
    fireMouseEvent('mouseup',   el, { clientX: 90,  clientY: 100 });

    const clickEv = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(clickEv, 'isTrusted', { value: true });
    el.dispatchEvent(clickEv);

    expect(clicked).toBe(false);
  });

  it('click ohne Drag wird NICHT unterdrückt', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    let clicked = false;
    document.addEventListener('click', () => { clicked = true; }, true);

    fireMouseEvent('mousedown', el, { clientX: 100, clientY: 100 });
    fireMouseEvent('mouseup',   el, { clientX: 100, clientY: 100 });

    const clickEv = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(clickEv, 'isTrusted', { value: true });
    el.dispatchEvent(clickEv);

    expect(clicked).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wheel – Source-Invarianten
// (happy-dom reflektiert getComputedStyle.overflowX nicht aus inline-styles,
//  weshalb findScrollable() immer documentElement wählt → Laufzeittests wären
//  ohne vollständige JSDOM-Kompatibilität nicht zuverlässig.)
// ─────────────────────────────────────────────────────────────────────────────

describe('Wheel – horizontales Scrollen (Source-Invariante)', () => {
  it("Wheel-Handler ist mit {passive:false} registriert", () => {
    expect(INJECT_CODE).toContain("'wheel'");
    expect(INJECT_CODE).toContain('passive:false');
  });

  it('deltaX wird direkt für scrollLeft+=dx verwendet', () => {
    expect(INJECT_CODE).toContain('scrollLeft+=dx');
  });

  it('Shift+Wheel: shiftKey?e.deltaY:e.deltaX – deltaY als dx', () => {
    expect(INJECT_CODE).toContain('shiftKey?e.deltaY:e.deltaX');
  });

  it('preventDefault wird aufgerufen um natives Scrollen zu verhindern', () => {
    expect(INJECT_CODE).toContain('e.preventDefault()');
  });

  it('deltaX=0 ohne Shift → früher return (if(!dx)return)', () => {
    expect(INJECT_CODE).toContain('if(!dx)return');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-Invarianten: panels.js
// ─────────────────────────────────────────────────────────────────────────────

describe('Source-Invariante: Touch-Polyfill in panels.js', () => {
  it('Polyfill enthält DRAG_THRESHOLD', () => {
    expect(INJECT_CODE).toContain('DRAG_THRESHOLD');
  });

  it('Polyfill enthält findScrollable', () => {
    expect(INJECT_CODE).toContain('findScrollable');
  });

  it('Polyfill enthält mousemove-Handler mit scrollLeft-=dx', () => {
    expect(INJECT_CODE).toContain('scrollLeft-=dx');
  });

  it('Polyfill enthält mousemove-Handler mit scrollTop-=dy', () => {
    expect(INJECT_CODE).toContain('scrollTop-=dy');
  });

  it('Polyfill enthält wheel-Handler', () => {
    expect(INJECT_CODE).toContain("'wheel'");
  });

  it('Polyfill enthält Click-Unterdrückung nach Drag', () => {
    expect(INJECT_CODE).toContain('wasDrag');
    expect(INJECT_CODE).toContain('stopPropagation');
  });

  it('REGRESSION: setEmitTouchEventsForMouse wird NICHT verwendet', () => {
    expect(panelsSrc).not.toContain('setEmitTouchEventsForMouse');
  });

  it('Polyfill wird nur für mobile Webviews injiziert (nach if(mobile)-Block)', () => {
    const mobileIdx   = panelsSrc.indexOf('if (mobile) {');
    const polyfillIdx = panelsSrc.indexOf('__eTouchPf');
    expect(mobileIdx).toBeGreaterThan(-1);
    expect(polyfillIdx).toBeGreaterThan(mobileIdx);
  });

  it('touchmove dispatcht Touch-Event weiter', () => {
    expect(INJECT_CODE).toContain('touchmove');
  });

  it('Achsenerkennung: horizontale Dominanz wählt x-Achse', () => {
    expect(INJECT_CODE).toContain("findScrollable(_startEl,'x')");
  });

  it('Achsenerkennung: vertikale Dominanz wählt y-Achse', () => {
    expect(INJECT_CODE).toContain("findScrollable(_startEl,'y')");
  });
});
