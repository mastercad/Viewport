/**
 * Tests für die autoArrange()-Layoutlogik.
 *
 * BUG (behoben): Die Funktion verwendete rect.w/rect.h direkt für Zeilenumbruch
 * und Vorschub, obwohl Panels einen eigenen scale-Faktor besitzen.
 * Bei scale < 1 war die berechnete visuelle Breite zu groß → Panels wurden
 * unnötig umgebrochen oder außerhalb des Workspace positioniert.
 *
 * FIX: Visuelle Breite (vw = rect.w * scale) und Höhe (vh = rect.h * scale)
 * werden für Zeilenumbruch, X-Vorschub, Sortierung und rowH verwendet.
 *
 * Die Logik wird hier als reine Funktion getestet – ohne DOM oder state.
 */

import { describe, it, expect } from 'vitest';

const PAD = 14;

/**
 * Repliziert die Kernarithmetik aus autoArrange().
 *
 * @param {Array<{id: string, rect: {w:number, h:number}, scale?: number}>} panels
 * @param {{w: number, h: number}} wsRect
 * @param {number} [defaultScale=1]
 * @returns {Map<string, {x: number, y: number, w: number, h: number}>}
 */
function runAutoArrange(panels, wsRect, defaultScale = 1) {
  if (panels.length === 0) return new Map();

  const entries = [...panels].sort((a, b) => {
    const sa = a.scale ?? defaultScale;
    const sb = b.scale ?? defaultScale;
    return b.rect.h * sb - a.rect.h * sa;
  });

  let x = PAD, y = PAD, rowH = 0;
  const result = new Map();

  for (const p of entries) {
    const s  = p.scale ?? defaultScale;
    const vw = p.rect.w * s;
    const vh = p.rect.h * s;
    if (x > PAD && x + vw > wsRect.w - PAD) {
      x = PAD; y += rowH + PAD; rowH = 0;
    }
    result.set(p.id, { x, y, w: p.rect.w, h: p.rect.h });
    x += vw + PAD;
    rowH = Math.max(rowH, vh);
  }

  return result;
}

// ─── Leere Panels ─────────────────────────────────────────────────────────────

describe('autoArrange – kein Panel', () => {
  it('gibt leere Map zurück wenn keine Panels vorhanden sind', () => {
    const result = runAutoArrange([], { w: 1366, h: 768 });
    expect(result.size).toBe(0);
  });
});

// ─── Einzelnes Panel ──────────────────────────────────────────────────────────

describe('autoArrange – ein Panel', () => {
  it('erstes Panel wird an PAD/PAD gesetzt', () => {
    const panels = [{ id: 'p1', rect: { w: 400, h: 800 } }];
    const result = runAutoArrange(panels, { w: 1366, h: 768 });
    expect(result.get('p1')).toEqual({ x: PAD, y: PAD, w: 400, h: 800 });
  });

  it('rect.w und rect.h bleiben unverändert (nur x/y werden gesetzt)', () => {
    const panels = [{ id: 'p1', rect: { w: 1366, h: 900 } }];
    const result = runAutoArrange(panels, { w: 2000, h: 1200 });
    const r = result.get('p1');
    expect(r.w).toBe(1366);
    expect(r.h).toBe(900);
  });
});

// ─── Mehrere Panels – Sortierung ──────────────────────────────────────────────

describe('autoArrange – Sortierung nach visueller Höhe', () => {
  it('höchstes Panel (scale=1) wird zuerst platziert (x=PAD)', () => {
    const panels = [
      { id: 'klein', rect: { w: 390,  h: 600  } },
      { id: 'groß',  rect: { w: 390,  h: 1000 } },
    ];
    const result = runAutoArrange(panels, { w: 1366, h: 1200 });
    expect(result.get('groß').x).toBe(PAD);
  });

  it('kleineres Panel kommt nach dem großen', () => {
    const panels = [
      { id: 'klein', rect: { w: 390,  h: 600  } },
      { id: 'groß',  rect: { w: 390,  h: 1000 } },
    ];
    const result = runAutoArrange(panels, { w: 1366, h: 1200 });
    expect(result.get('klein').x).toBeGreaterThan(result.get('groß').x);
  });

  it('Sortierung berücksichtigt scale: kleines Panel mit scale=1 vor großem mit scale=0.3', () => {
    // Panel A: rect.h=1000, scale=0.3 → vis. Höhe = 300
    // Panel B: rect.h=600,  scale=1   → vis. Höhe = 600
    // B muss zuerst kommen (x=PAD)
    const panels = [
      { id: 'A', rect: { w: 390, h: 1000 }, scale: 0.3 },
      { id: 'B', rect: { w: 390, h: 600  }, scale: 1   },
    ];
    const result = runAutoArrange(panels, { w: 1366, h: 1200 });
    expect(result.get('B').x).toBe(PAD);
    expect(result.get('A').x).toBeGreaterThan(PAD);
  });
});

// ─── Zeilenumbruch bei scale=1 ────────────────────────────────────────────────

describe('autoArrange – Zeilenumbruch (scale=1)', () => {
  it('kein Umbruch wenn beide Panels nebeneinander passen', () => {
    // 2 × 400px + 3 × PAD = 842 < 1000
    const panels = [
      { id: 'p1', rect: { w: 400, h: 800 } },
      { id: 'p2', rect: { w: 400, h: 800 } },
    ];
    const result = runAutoArrange(panels, { w: 1000, h: 1200 });
    expect(result.get('p1').y).toBe(PAD);
    expect(result.get('p2').y).toBe(PAD);
  });

  it('Umbruch wenn zweites Panel nicht mehr passt', () => {
    // p1: w=700, p2: w=700 → 700+PAD+700 = 1414 > 1000-PAD=986 → Umbruch
    const panels = [
      { id: 'p1', rect: { w: 700, h: 800 } },
      { id: 'p2', rect: { w: 700, h: 800 } },
    ];
    const result = runAutoArrange(panels, { w: 1000, h: 2000 });
    expect(result.get('p1').y).toBe(PAD);
    expect(result.get('p2').y).toBeGreaterThan(PAD); // neue Zeile
    expect(result.get('p2').x).toBe(PAD);            // zurück auf PAD
  });

  it('zweite Zeile beginnt nach rowH + PAD', () => {
    const panels = [
      { id: 'p1', rect: { w: 700, h: 800 } },
      { id: 'p2', rect: { w: 700, h: 600 } },
    ];
    const result = runAutoArrange(panels, { w: 1000, h: 3000 });
    // p1 ist höher (800 > 600) → kommt zuerst, rowH = 800
    // p2 bricht um → y = PAD + 800 + PAD = 828
    expect(result.get('p2').y).toBe(PAD + 800 + PAD);
  });
});

// ─── Zeilenumbruch mit scale < 1 ──────────────────────────────────────────────

describe('autoArrange – Zeilenumbruch mit scale < 1 (BUG-Regression)', () => {
  it('skaliertes Panel (scale=0.5) bricht nicht fälschlicherweise um', () => {
    // Ohne Fix: rect.w=1366 → passt nicht; Mit Fix: vw=683 → passt
    const panels = [
      { id: 'laptop', rect: { w: 1366, h: 768 }, scale: 0.5 },
      { id: 'mobile', rect: { w: 390,  h: 844 }, scale: 0.5 },
    ];
    // Workspace 1366px breit: vw(laptop)=683, vw(mobile)=195
    // 683 + PAD + 195 = 892 < 1366-PAD → kein Umbruch
    const result = runAutoArrange(panels, { w: 1366, h: 900 });
    expect(result.get('laptop').y).toBe(PAD);
    expect(result.get('mobile').y).toBe(PAD); // selbe Zeile!
  });

  it('skaliertes Panel bricht um wenn es wirklich nicht passt', () => {
    // scale=0.5: vw(laptop)=683 (erste), vw(tablet)=683 (zweite: 683+PAD+683=1380 > 1366-14=1352)
    const panels = [
      { id: 'laptop', rect: { w: 1366, h: 768 }, scale: 0.5 },
      { id: 'tablet', rect: { w: 1366, h: 900 }, scale: 0.5 }, // höher → zuerst
    ];
    const result = runAutoArrange(panels, { w: 1366, h: 2000 });
    // tablet (höher) kommt zuerst, x=PAD, dann laptop → 14 + 683 + 14 + 683 = 1394 > 1352 → Umbruch
    expect(result.get('laptop').y).toBeGreaterThan(PAD);
    expect(result.get('laptop').x).toBe(PAD);
  });

  it('X-Vorschub verwendet visuelle Breite, nicht rect.w', () => {
    // Bei scale=0.5: zweites Panel startet bei PAD + vw(p1) + PAD = 14 + 200 + 14 = 228
    const panels = [
      { id: 'p1', rect: { w: 400, h: 800 }, scale: 0.5 },
      { id: 'p2', rect: { w: 400, h: 600 }, scale: 0.5 },
    ];
    const result = runAutoArrange(panels, { w: 2000, h: 1200 });
    // p1 höher → zuerst bei x=PAD, p2 folgt bei PAD + 200 + PAD = 228
    expect(result.get('p1').x).toBe(PAD);
    expect(result.get('p2').x).toBe(PAD + 200 + PAD);
  });
});

// ─── rowH mit scale ───────────────────────────────────────────────────────────

describe('autoArrange – rowH-Berechnung mit scale', () => {
  it('zweite Zeile startet nach visueller Höhe der ersten Zeile', () => {
    // p1: rect.h=1000, scale=0.5 → vh=500
    // p2 und p3 brechen um → y = PAD + 500 + PAD = 528
    const panels = [
      { id: 'p1', rect: { w: 2000, h: 1000 }, scale: 0.5 }, // breit, um Umbruch zu erzwingen
      { id: 'p2', rect: { w: 2000, h:  600 }, scale: 0.5 },
    ];
    const result = runAutoArrange(panels, { w: 1366, h: 3000 });
    // p1 (höher) zuerst, vh=500, dann p2 Umbruch
    expect(result.get('p2').y).toBe(PAD + 500 + PAD);
  });

  it('rowH = max(vh) der Zeile, nicht rect.h', () => {
    // Zeile 1: p1(vw=300,vh=600), p2(vw=300,vh=400) → nach p2: x=642, rowH=600
    // p3: vw=1100, 642+1100=1742 > 1366-14=1352 → Umbruch, y = PAD + 600 + PAD = 628
    const panels = [
      { id: 'p1', rect: { w: 600, h: 1200 }, scale: 0.5 }, // vw=300, vh=600
      { id: 'p2', rect: { w: 600, h:  800 }, scale: 0.5 }, // vw=300, vh=400
      { id: 'p3', rect: { w: 2200, h: 500 }, scale: 0.5 }, // vw=1100, bricht um
    ];
    const result = runAutoArrange(panels, { w: 1366, h: 3000 });
    expect(result.get('p3').y).toBe(PAD + 600 + PAD);
  });
});

// ─── Keine negative Position ──────────────────────────────────────────────────

describe('autoArrange – Startposition immer bei PAD', () => {
  it('x startet immer bei PAD, nie kleiner', () => {
    const panels = [{ id: 'p1', rect: { w: 100, h: 200 } }];
    const result = runAutoArrange(panels, { w: 1366, h: 768 });
    expect(result.get('p1').x).toBeGreaterThanOrEqual(PAD);
    expect(result.get('p1').y).toBeGreaterThanOrEqual(PAD);
  });

  it('nach Umbruch startet neue Zeile wieder bei x=PAD', () => {
    const panels = [
      { id: 'p1', rect: { w: 700, h: 500 } },
      { id: 'p2', rect: { w: 700, h: 400 } },
      { id: 'p3', rect: { w: 700, h: 300 } },
    ];
    const result = runAutoArrange(panels, { w: 1000, h: 3000 });
    // alle brechen um – jedes Panel in eigener Zeile
    for (const r of result.values()) {
      expect(r.x).toBe(PAD);
    }
  });
});

// ─── Drei Zeilen ──────────────────────────────────────────────────────────────

describe('autoArrange – drei Zeilen', () => {
  it('drei Panels in drei Zeilen wenn Workspace zu schmal', () => {
    const panels = [
      { id: 'p1', rect: { w: 700, h: 900 } },
      { id: 'p2', rect: { w: 700, h: 800 } },
      { id: 'p3', rect: { w: 700, h: 700 } },
    ];
    const result = runAutoArrange(panels, { w: 1000, h: 4000 });
    expect(result.get('p1').y).toBe(PAD);
    expect(result.get('p2').y).toBe(PAD + 900 + PAD);
    expect(result.get('p3').y).toBe(PAD + 900 + PAD + 800 + PAD);
  });
});
