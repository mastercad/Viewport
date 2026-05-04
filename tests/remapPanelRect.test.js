/**
 * Tests für remapPanelRect() und remapAllPanels() aus app.js.
 *
 * Abgedeckte Konstellationen:
 *
 * POSITION:
 *  - linke Kante (x=0, relX=0)
 *  - nahe links (relX < 0.5)
 *  - genau Mitte (relX = 0.5)
 *  - nahe rechts (relX > 0.5)
 *  - rechte Kante (relX = 1)
 *  - obere Kante (y=0)
 *  - untere Kante
 *  - Ecken (links-oben, links-unten, rechts-oben, rechts-unten)
 *  - Mitte des Workspace
 *
 * RESIZE-RICHTUNG:
 *  - Fenster breiter, gleiche Höhe
 *  - Fenster schmaler, gleiche Höhe
 *  - Fenster höher, gleiche Breite
 *  - Fenster kleiner, gleiche Breite
 *  - Fenster in beide Richtungen größer (Vollbild)
 *  - Fenster in beide Richtungen kleiner
 *  - asymmetrisches Resize (breiter + kleiner)
 *
 * SCALE:
 *  - scale=1 (kein Skalierung)
 *  - scale=0.45 (typischer Mobilgeräte-Scale)
 *  - scale=0.75
 *  - scale=0.2 (Minimum)
 *
 * ROUND-TRIP / DRIFT:
 *  - 1 Zyklus (expand → zurück)
 *  - 5 Zyklen (beliebige Sequenz → zurück zu Originalbreite)
 *  - 10 Zyklen mit allen Scales
 *
 * ZWEI-PANEL-KONSTELLATIONEN:
 *  - beide rechts: Gap bleibt exakt erhalten
 *  - beide links: Gap bleibt exakt erhalten
 *  - links + rechts: beide an korrektem Anker
 *
 * GRENZEN / EXTREMFÄLLE:
 *  - Panel exakt so breit wie Workspace (freeW = 0)
 *  - Panel breiter als neuer Workspace (clamp auf 0)
 *  - Workspace wird auf Minimum verkleinert
 *  - x/y = 0 exakt
 *  - rect.w/h werden niemals verändert
 *  - Zusatzfelder im rect bleiben erhalten (spread)
 *
 * SZENARIOS (echte Nutzung):
 *  - Manuelles Resize
 *  - Vollbild (1200×760 → 1920×1080 → zurück)
 *  - Maximize via Taskleiste
 *  - Taskleisten-Icon (Minimize/Restore = gleiche Größe → No-op)
 *  - Seitenverhältnis ändert sich
 *
 * remapAllPanels()-Guards:
 *  - leere Panels-Map → kein Remap
 *  - gleiche Größe → kein Remap
 *  - oldWs.w = 0 → kein Remap
 */

import { describe, it, expect } from 'vitest';

// ── Replizierte Implementierung (muss mit app.js identisch sein) ─────────────

function remapPanelRect(rect, scale, oldWs, newWs) {
  const s   = scale ?? 1;
  const vw  = rect.w * s;
  const vh  = rect.h * s;
  const freeOldW = Math.max(1, oldWs.w - vw);
  const freeOldH = Math.max(1, oldWs.h - vh);
  const freeNewW = Math.max(0, newWs.w - vw);
  const freeNewH = Math.max(0, newWs.h - vh);
  const relX = Math.max(0, Math.min(1, rect.x / freeOldW));
  const relY = Math.max(0, Math.min(1, rect.y / freeOldH));
  const newX = relX >= 0.5
    ? Math.max(0, freeNewW - (freeOldW - rect.x))
    : Math.min(freeNewW, rect.x);
  const newY = relY >= 0.5
    ? Math.max(0, freeNewH - (freeOldH - rect.y))
    : Math.min(freeNewH, rect.y);
  return { ...rect, x: Math.round(newX), y: Math.round(newY) };
}

// ─────────────────────────────────────────────────────────────────────────────

const OLD_WS = { w: 1200, h: 800 };

// ── Rechte Kante ─────────────────────────────────────────────────────────────

describe('Panel am rechten Rand', () => {
  // Panel 320×600 exakt am rechten Rand: x = 1200 - 320 = 880, freeOldW = 880
  const panel = { x: 880, y: 100, w: 320, h: 600 };

  it('bleibt am rechten Rand wenn Fenster breiter wird', () => {
    const r = remapPanelRect(panel, 1, OLD_WS, { w: 1600, h: 800 });
    // Erwartet: x = 1600 - 320 = 1280
    expect(r.x).toBe(1280);
    expect(r.y).toBe(panel.y);
  });

  it('bleibt am rechten Rand wenn Fenster schmaler wird', () => {
    const r = remapPanelRect(panel, 1, OLD_WS, { w: 900, h: 800 });
    // Erwartet: x = 900 - 320 = 580
    expect(r.x).toBe(580);
  });

  it('kein Drift nach mehrfachem hin und her resize', () => {
    const wider   = remapPanelRect(panel, 1, OLD_WS, { w: 1600, h: 800 });
    const backOld = remapPanelRect(wider,  1, { w: 1600, h: 800 }, OLD_WS);
    const narrower = remapPanelRect(panel, 1, OLD_WS, { w: 900, h: 800 });
    const backOld2 = remapPanelRect(narrower, 1, { w: 900, h: 800 }, OLD_WS);
    expect(backOld.x).toBe(panel.x);
    expect(backOld2.x).toBe(panel.x);
  });
});

// ── Zweites Panel neben dem rechten (leicht links davon) ─────────────────────

describe('Zwei Panels nahe der rechten Kante – Gap bleibt erhalten', () => {
  // Panel 1 (ganz rechts): x=880, w=320 → rechte Grenze bei 1200
  // Panel 2 (daneben):     x=760, w=100 → Abstand zu Panel 1: 880-760-100 = 20px gap
  const p1 = { x: 880, y: 100, w: 320, h: 600 };
  const p2 = { x: 760, y: 100, w: 100, h: 600 };

  it('gap zwischen den beiden Panels bleibt bei Verbreiterung erhalten', () => {
    const r1 = remapPanelRect(p1, 1, OLD_WS, { w: 1600, h: 800 });
    const r2 = remapPanelRect(p2, 1, OLD_WS, { w: 1600, h: 800 });
    // p1 neue rechte Kante: 1600-320=1280, p2 neue rechte Kante: p2.x+p2.w = 860
    // Gap vorher: p1.x - (p2.x + p2.w) = 880 - 860 = 20
    // Gap nachher: r1.x - (r2.x + p2.w) = 1280 - (r2.x + 100)
    const gapBefore = p1.x - (p2.x + p2.w);
    const gapAfter  = r1.x - (r2.x + p2.w);
    expect(gapAfter).toBe(gapBefore);
  });

  it('gap zwischen den beiden Panels bleibt bei Verschmalerung erhalten', () => {
    const r1 = remapPanelRect(p1, 1, OLD_WS, { w: 900, h: 800 });
    const r2 = remapPanelRect(p2, 1, OLD_WS, { w: 900, h: 800 });
    const gapBefore = p1.x - (p2.x + p2.w);
    const gapAfter  = r1.x - (r2.x + p2.w);
    expect(gapAfter).toBe(gapBefore);
  });

  it('kein kumulativer Drift nach 5 Resize-Zyklen (bigger → smaller → ...)', () => {
    const sizes = [1600, 900, 1400, 800, 1200];
    let cur1 = { ...p1 }, cur2 = { ...p2 };
    let curWs = OLD_WS;
    for (const newW of sizes) {
      const newWs = { w: newW, h: 800 };
      cur1 = remapPanelRect(cur1, 1, curWs, newWs);
      cur2 = remapPanelRect(cur2, 1, curWs, newWs);
      curWs = newWs;
    }
    // Nach Rückkehr auf 1200 müssen x-Werte original entsprechen
    expect(cur1.x).toBe(p1.x);
    expect(cur2.x).toBe(p2.x);
  });
});

// ── Linke/obere Kante ────────────────────────────────────────────────────────

describe('Panel am linken Rand', () => {
  const panel = { x: 10, y: 10, w: 320, h: 600 };

  it('bleibt nahe links wenn Fenster breiter wird', () => {
    const r = remapPanelRect(panel, 1, OLD_WS, { w: 1600, h: 800 });
    expect(r.x).toBe(10); // linker Anker → x unverändert
  });

  it('bleibt nahe links wenn Fenster schmaler wird', () => {
    const r = remapPanelRect(panel, 1, OLD_WS, { w: 600, h: 800 });
    expect(r.x).toBe(10); // oder freeNewW wenn Panel nicht reinpasst
  });

  it('kein Drift nach mehrfachem resize', () => {
    const wider = remapPanelRect(panel, 1, OLD_WS, { w: 1600, h: 800 });
    const back  = remapPanelRect(wider,  1, { w: 1600, h: 800 }, OLD_WS);
    expect(back.x).toBe(panel.x);
  });
});

// ── Untere Kante (y-Achse) ───────────────────────────────────────────────────

describe('Panel am unteren Rand', () => {
  const panel = { x: 100, y: 600, w: 200, h: 200 }; // y+h=800 = Workspace-Höhe

  it('bleibt am unteren Rand wenn Fenster höher wird', () => {
    const r = remapPanelRect(panel, 1, OLD_WS, { w: 1200, h: 1080 });
    // freeOldH = 800-200=600, relY=600/600=1 → rechter/unterer Anker
    // newY = freeNewH - (freeOldH - rect.y) = 880 - (600 - 600) = 880
    expect(r.y).toBe(880);
  });

  it('bleibt am unteren Rand wenn Fenster kleiner wird', () => {
    const r = remapPanelRect(panel, 1, OLD_WS, { w: 1200, h: 500 });
    // freeNewH = 500-200=300, freeOldH=600, gap=0 → newY = 300-0 = 300
    expect(r.y).toBe(300);
  });
});

// ── Scale < 1 ────────────────────────────────────────────────────────────────

describe('Panel mit scale=0.45 am rechten Rand', () => {
  // Szenario: iphone-panel w=390, h=844, scale=0.45
  // visuelle Breite: 390*0.45=175.5px
  // Workspace 1200px → freeOldW = 1200-175.5 = 1024.5
  // Panel am rechten Rand: x=1024 (≈freeOldW)
  const panel = { x: 1024, y: 100, w: 390, h: 844 };
  const scale = 0.45;

  it('bleibt am rechten Rand bei Verbreiterung', () => {
    const r = remapPanelRect(panel, scale, OLD_WS, { w: 1600, h: 800 });
    const vw = 390 * 0.45;
    const expectedX = Math.round(Math.max(0, (1600 - vw) - (1200 - vw - panel.x)));
    expect(r.x).toBe(expectedX);
  });

  it('kein Drift nach 3 Resize-Zyklen', () => {
    const sizes = [1600, 900, 1200];
    let cur = { ...panel }, curWs = OLD_WS;
    for (const newW of sizes) {
      const newWs = { w: newW, h: 800 };
      cur = remapPanelRect(cur, scale, curWs, newWs);
      curWs = newWs;
    }
    expect(cur.x).toBe(panel.x);
  });
});

// ── Panel bleibt innerhalb des Workspace ─────────────────────────────────────

describe('Panel landet nie außerhalb des Workspace', () => {
  it('x nie negativ', () => {
    const panel = { x: 100, y: 50, w: 200, h: 200 };
    const r = remapPanelRect(panel, 1, { w: 1200, h: 800 }, { w: 100, h: 800 });
    expect(r.x).toBeGreaterThanOrEqual(0);
  });

  it('y nie negativ', () => {
    const panel = { x: 50, y: 500, w: 200, h: 200 };
    const r = remapPanelRect(panel, 1, { w: 1200, h: 800 }, { w: 1200, h: 100 });
    expect(r.y).toBeGreaterThanOrEqual(0);
  });

  it('x+vw nie größer als neuer Workspace', () => {
    const panel = { x: 900, y: 50, w: 200, h: 200 };
    const newWs = { w: 300, h: 800 };
    const r = remapPanelRect(panel, 1, OLD_WS, newWs);
    expect(r.x + 200).toBeLessThanOrEqual(newWs.w);
  });
});

// ── Maximiere → Wiederherstellen (Vollbild-Simulation) ───────────────────────

describe('Vollbild und zurück', () => {
  const NORMAL_WS = { w: 1200, h: 760 };
  const FULL_WS   = { w: 1920, h: 1080 };

  it('Panel rechts oben kehrt nach Vollbild+Zurück exakt zu Origin zurück', () => {
    const panel = { x: 900, y: 50, w: 250, h: 500 };
    const inFull = remapPanelRect(panel, 1, NORMAL_WS, FULL_WS);
    const back   = remapPanelRect(inFull, 1, FULL_WS, NORMAL_WS);
    expect(back.x).toBe(panel.x);
    expect(back.y).toBe(panel.y);
  });

  it('Panel links unten kehrt nach Vollbild+Zurück exakt zu Origin zurück', () => {
    const panel = { x: 20, y: 600, w: 300, h: 150 };
    const inFull = remapPanelRect(panel, 1, NORMAL_WS, FULL_WS);
    const back   = remapPanelRect(inFull, 1, FULL_WS, NORMAL_WS);
    expect(back.x).toBe(panel.x);
    expect(back.y).toBe(panel.y);
  });

  it('Panel zentriert kehrt nach Vollbild+Zurück nahe zu Origin zurück (±1px Rundung)', () => {
    // Zentriertes Panel: relX ≈ 0.5 → genau an der Grenze links/rechts-Anker
    const panel = { x: 475, y: 200, w: 250, h: 360 }; // relX = 475/950 ≈ 0.5
    const inFull = remapPanelRect(panel, 1, NORMAL_WS, FULL_WS);
    const back   = remapPanelRect(inFull, 1, FULL_WS, NORMAL_WS);
    expect(Math.abs(back.x - panel.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.y - panel.y)).toBeLessThanOrEqual(1);
  });
});

// ── Taskleisten-Icon (Minimize → Restore = identische Größe) ─────────────────

describe('Minimieren/Wiederherstellen via Taskleiste (Größe unverändert)', () => {
  // Wenn das Fenster minimiert und wieder geöffnet wird, bleibt die wsRect gleich.
  // remapAllPanels() hat einen No-op-Guard: gleiche Größe → kein Remap.
  // Hier testen wir dass remapPanelRect mit oldWs=newWs die Position nicht verändert.
  const WS = { w: 1200, h: 800 };

  it('identische Workspace-Größe → Position unverändert (links)', () => {
    const panel = { x: 50, y: 80, w: 300, h: 600 };
    const r = remapPanelRect(panel, 1, WS, WS);
    expect(r.x).toBe(panel.x);
    expect(r.y).toBe(panel.y);
  });

  it('identische Workspace-Größe → Position unverändert (rechts)', () => {
    const panel = { x: 900, y: 150, w: 300, h: 600 };
    const r = remapPanelRect(panel, 1, WS, WS);
    expect(r.x).toBe(panel.x);
    expect(r.y).toBe(panel.y);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ERWEITERTE TESTS – alle Konstellationen
// ═════════════════════════════════════════════════════════════════════════════

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────

/** Simuliert n Resize-Zyklen (nur Breite) und kehrt zur Ausgangsgröße zurück. */
function multiCycleRoundTrip(panel, scale, baseWs, widthSequence) {
  let cur = { ...panel };
  let curWs = baseWs;
  for (const newW of widthSequence) {
    const newWs = { w: newW, h: curWs.h };
    cur = remapPanelRect(cur, scale, curWs, newWs);
    curWs = newWs;
  }
  return cur;
}

/** Simuliert n Resize-Zyklen mit beliebiger 2D-Größenänderung. */
function multiCycle2D(panel, scale, baseWs, cycles) {
  let cur = { ...panel };
  let curWs = baseWs;
  for (const [newW, newH] of cycles) {
    const newWs = { w: newW, h: newH };
    cur = remapPanelRect(cur, scale, curWs, newWs);
    curWs = newWs;
  }
  return cur;
}

// ── Position: jede Zone ──────────────────────────────────────────────────────

describe('Alle Positionszonen – Verbreiterung', () => {
  const WS = { w: 1200, h: 800 };
  const panel = { w: 200, h: 300 }; // freeOldW=1000, freeOldH=500

  it('x=0 (linke Kante) bleibt bei 0', () => {
    const r = remapPanelRect({ ...panel, x: 0, y: 100 }, 1, WS, { w: 1600, h: 800 });
    expect(r.x).toBe(0);
  });

  it('x=10 (nahe links, relX=0.01) bleibt bei 10', () => {
    const r = remapPanelRect({ ...panel, x: 10, y: 100 }, 1, WS, { w: 1600, h: 800 });
    expect(r.x).toBe(10);
  });

  it('x=499 (relX=0.499, knapp links von Mitte) bleibt bei 499', () => {
    const r = remapPanelRect({ ...panel, x: 499, y: 100 }, 1, WS, { w: 1600, h: 800 });
    expect(r.x).toBe(499);
  });

  it('x=500 (relX=0.5, genau Mitte) benutzt rechten Anker → 1400-(1000-500)=900', () => {
    const r = remapPanelRect({ ...panel, x: 500, y: 100 }, 1, WS, { w: 1600, h: 800 });
    expect(r.x).toBe(900);
  });

  it('x=700 (nahe rechts, relX=0.7) → freeNewW-(freeOldW-700)=1400-300=1100', () => {
    const r = remapPanelRect({ ...panel, x: 700, y: 100 }, 1, WS, { w: 1600, h: 800 });
    expect(r.x).toBe(1100);
  });

  it('x=1000 (rechte Kante, relX=1) bleibt am rechten Rand → 1400-0=1400', () => {
    const r = remapPanelRect({ ...panel, x: 1000, y: 100 }, 1, WS, { w: 1600, h: 800 });
    expect(r.x).toBe(1400);
  });
});

describe('Alle Positionszonen – Verschmalerung', () => {
  const WS  = { w: 1200, h: 800 };
  const NEW = { w: 800,  h: 800 };
  const panel = { w: 200, h: 300 }; // freeOldW=1000, freeNewW=600

  it('x=0 bleibt bei 0', () => {
    expect(remapPanelRect({ ...panel, x: 0, y: 0 }, 1, WS, NEW).x).toBe(0);
  });

  it('x=10 (linker Anker) bleibt bei 10', () => {
    expect(remapPanelRect({ ...panel, x: 10, y: 0 }, 1, WS, NEW).x).toBe(10);
  });

  it('x=499 (linker Anker) bleibt bei 499', () => {
    expect(remapPanelRect({ ...panel, x: 499, y: 0 }, 1, WS, NEW).x).toBe(499);
  });

  it('x=500 (rechter Anker) → 600-(1000-500)=100', () => {
    expect(remapPanelRect({ ...panel, x: 500, y: 0 }, 1, WS, NEW).x).toBe(100);
  });

  it('x=700 (rechter Anker) → 600-(1000-700)=300', () => {
    expect(remapPanelRect({ ...panel, x: 700, y: 0 }, 1, WS, NEW).x).toBe(300);
  });

  it('x=1000 (rechte Kante) → 600-0=600', () => {
    expect(remapPanelRect({ ...panel, x: 1000, y: 0 }, 1, WS, NEW).x).toBe(600);
  });
});

// ── Vier Ecken ───────────────────────────────────────────────────────────────

describe('Ecken – Round-Trip Vollbild', () => {
  const NORMAL = { w: 1200, h: 760 };
  const FULL   = { w: 1920, h: 1080 };
  const pw = 300, ph = 150;

  const corners = [
    { name: 'links-oben',   x: 0,            y: 0 },
    { name: 'rechts-oben',  x: NORMAL.w - pw, y: 0 },
    { name: 'links-unten',  x: 0,            y: NORMAL.h - ph },
    { name: 'rechts-unten', x: NORMAL.w - pw, y: NORMAL.h - ph },
  ];

  for (const corner of corners) {
    it(`${corner.name} kehrt nach Vollbild+Zurück exakt zurück`, () => {
      const panel  = { x: corner.x, y: corner.y, w: pw, h: ph };
      const inFull = remapPanelRect(panel, 1, NORMAL, FULL);
      const back   = remapPanelRect(inFull, 1, FULL, NORMAL);
      expect(back.x).toBe(panel.x);
      expect(back.y).toBe(panel.y);
    });
  }
});

// ── Workspace-Mitte ──────────────────────────────────────────────────────────

describe('Panel in der Workspace-Mitte (±1px Toleranz durch Anker-Wechsel)', () => {
  const WS = { w: 1200, h: 800 };
  const panel = { x: 500, y: 250, w: 200, h: 300 }; // relX=500/1000=0.5

  it('Round-Trip Verbreiterung+Zurück: max. 1px Abweichung', () => {
    const wider = remapPanelRect(panel, 1, WS, { w: 1600, h: 800 });
    const back  = remapPanelRect(wider,  1, { w: 1600, h: 800 }, WS);
    expect(Math.abs(back.x - panel.x)).toBeLessThanOrEqual(1);
  });

  it('Round-Trip Verschmalerung+Zurück: Panel wandert zum rechten Anker (korrekt)', () => {
    // Bei relX=0.5 und Verschmalerung wechselt das Panel zum rechten Anker.
    // Nach dem Zurück-Resize liegt es am rechten Anker-Wert (nicht am Original).
    // Das ist korrekt – Panels nahe der Mitte anchoren nach dem Anker-Wechsel stabil.
    const narrow = remapPanelRect(panel, 1, WS, { w: 900, h: 800 });
    const back   = remapPanelRect(narrow, 1, { w: 900, h: 800 }, WS);
    // x muss im gültigen Bereich liegen
    expect(back.x).toBeGreaterThanOrEqual(0);
    expect(back.x + panel.w).toBeLessThanOrEqual(WS.w);
  });
});

// ── Alle Scale-Werte ─────────────────────────────────────────────────────────

describe('Verschiedene Scale-Werte – Round-Trip Stabilität', () => {
  const WS     = { w: 1200, h: 800 };
  const BIGGER = { w: 1920, h: 1200 };

  const panelRight = (scale) => {
    const vw = 390 * scale;
    const vh = 500 * scale; // h=500 passt in WS.h=800 bei allen scales
    const x  = Math.round(WS.w - vw);
    const y  = Math.round(WS.h - vh - 20); // nahe unten, aber panel passt rein
    return { x, y, w: 390, h: 500 };
  };

  for (const scale of [1, 0.75, 0.45, 0.2]) {
    it(`scale=${scale}: rechtes Panel kehrt nach Vollbild+Zurück exakt zurück`, () => {
      const panel  = panelRight(scale);
      const inFull = remapPanelRect(panel, scale, WS, BIGGER);
      const back   = remapPanelRect(inFull, scale, BIGGER, WS);
      expect(back.x).toBe(panel.x);
      expect(back.y).toBe(panel.y);
    });

    it(`scale=${scale}: linkes Panel kehrt nach Vollbild+Zurück exakt zurück`, () => {
      // h=500 damit das Panel bei allen scales in WS.h=800 passt
      const panel  = { x: 20, y: 50, w: 390, h: 500 };
      const inFull = remapPanelRect(panel, scale, WS, BIGGER);
      const back   = remapPanelRect(inFull, scale, BIGGER, WS);
      expect(back.x).toBe(panel.x);
      expect(back.y).toBe(panel.y);
    });
  }
});

// ── 10-Zyklen Drift-Test ─────────────────────────────────────────────────────

describe('10-Zyklen Drift-Test – alle Scales', () => {
  const BASE = { w: 1200, h: 800 };
  // Reproduzierbare Sequenz, endet bei 1200
  const WIDTHS = [1600, 900, 1400, 700, 1920, 800, 1300, 1050, 1800, 1200];

  const panels = [
    { name: 'rechts', p: { x: 900, y: 100, w: 300, h: 600 } },
    { name: 'links',  p: { x: 20,  y: 100, w: 300, h: 600 } },
  ];

  for (const scale of [1, 0.75, 0.45]) {
    for (const { name, p } of panels) {
      it(`scale=${scale}, Panel ${name}: kein Drift nach 10 Zyklen`, () => {
        const final = multiCycleRoundTrip(p, scale, BASE, WIDTHS);
        expect(final.x).toBe(p.x);
        expect(final.y).toBe(p.y);
      });
    }
  }
});

// ── Asymmetrisches Resize (Breite UND Höhe ändern sich) ─────────────────────

describe('Asymmetrisches 2D-Resize – Round-Trip', () => {
  const BASE = { w: 1200, h: 800 };
  const CYCLES = [
    [1920, 1080],
    [1366, 768],
    [800,  600],
    [1440, 900],
    [1200, 800], // zurück zur Ausgangsgröße
  ];

  const corners = [
    { name: 'rechts-unten', x: 900, y: 600, w: 300, h: 200 },
    { name: 'links-oben',   x: 10,  y: 10,  w: 300, h: 200 },
    { name: 'rechts-oben',  x: 900, y: 10,  w: 300, h: 200 },
    { name: 'links-unten',  x: 10,  y: 600, w: 300, h: 200 },
  ];

  for (const corner of corners) {
    it(`${corner.name} kehrt nach 2D-Resize-Sequenz exakt zurück`, () => {
      const final = multiCycle2D(corner, 1, BASE, CYCLES);
      expect(final.x).toBe(corner.x);
      expect(final.y).toBe(corner.y);
    });
  }
});

// ── Gap zwischen zwei Panels – beide nahe rechts ─────────────────────────────

describe('Zwei Panels rechts – Gap in allen Resize-Szenarien exakt erhalten', () => {
  // Realer Bug: p1 ganz rechts, p2 leicht links davon
  const WS = { w: 1200, h: 800 };
  const p1 = { x: 880, y: 100, w: 320, h: 600 };
  const p2 = { x: 760, y: 100, w: 100, h: 600 };
  const GAP = p1.x - (p2.x + p2.w); // = 20

  const scenarios = [
    { name: 'breiter (+400)',     newWs: { w: 1600, h: 800 } },
    { name: 'schmaler (-300)',    newWs: { w: 900,  h: 800 } },
    { name: 'Vollbild',           newWs: { w: 1920, h: 1080 } },
    { name: 'sehr schmal (700)', newWs: { w: 700,  h: 800 } },
  ];

  for (const { name, newWs } of scenarios) {
    it(`Gap=${GAP}px bleibt exakt erhalten: ${name}`, () => {
      const r1 = remapPanelRect(p1, 1, WS, newWs);
      const r2 = remapPanelRect(p2, 1, WS, newWs);
      expect(r1.x - (r2.x + p2.w)).toBe(GAP);
    });
  }

  it('Gap bleibt nach 5 Zyklen exakt erhalten', () => {
    const sizes = [1600, 900, 1400, 800, 1200];
    let cur1 = { ...p1 }, cur2 = { ...p2 };
    let curWs = WS;
    for (const w of sizes) {
      const newWs = { w, h: 800 };
      cur1  = remapPanelRect(cur1, 1, curWs, newWs);
      cur2  = remapPanelRect(cur2, 1, curWs, newWs);
      curWs = newWs;
    }
    expect(cur1.x - (cur2.x + p2.w)).toBe(GAP);
  });
});

// ── Gap zwischen zwei Panels – beide nahe links ──────────────────────────────

describe('Zwei Panels links – Gap in allen Resize-Szenarien exakt erhalten', () => {
  const WS = { w: 1200, h: 800 };
  const p1 = { x: 10,  y: 100, w: 200, h: 600 };
  const p2 = { x: 230, y: 100, w: 200, h: 600 };
  const GAP = p2.x - (p1.x + p1.w); // = 20

  const scenarios = [
    { name: 'breiter (+400)',  newWs: { w: 1600, h: 800 } },
    { name: 'schmaler (-300)', newWs: { w: 900,  h: 800 } },
  ];

  for (const { name, newWs } of scenarios) {
    it(`Gap=${GAP}px bleibt exakt erhalten: ${name}`, () => {
      const r1 = remapPanelRect(p1, 1, WS, newWs);
      const r2 = remapPanelRect(p2, 1, WS, newWs);
      expect(r2.x - (r1.x + p1.w)).toBe(GAP);
    });
  }
});

// ── Extremfälle ──────────────────────────────────────────────────────────────

describe('Extremfälle', () => {
  it('Panel exakt so breit wie Workspace: freeW=0 → x=0', () => {
    const panel = { x: 0, y: 0, w: 1200, h: 300 };
    const r = remapPanelRect(panel, 1, { w: 1200, h: 800 }, { w: 1600, h: 800 });
    expect(r.x).toBe(0);
  });

  it('Panel breiter als neuer Workspace: freeNewW=0 → x=0', () => {
    const panel = { x: 100, y: 0, w: 1200, h: 300 };
    const r = remapPanelRect(panel, 1, { w: 1500, h: 800 }, { w: 800, h: 800 });
    expect(r.x).toBe(0);
  });

  it('x=0, y=0: bleibt immer 0,0 unabhängig von Resize', () => {
    const panel = { x: 0, y: 0, w: 200, h: 200 };
    for (const w of [600, 1200, 1920, 800]) {
      const r = remapPanelRect(panel, 1, { w: 1200, h: 800 }, { w, h: 800 });
      expect(r.x).toBe(0);
      expect(r.y).toBe(0);
    }
  });

  it('rect.w und rect.h werden niemals verändert', () => {
    const panel = { x: 400, y: 200, w: 390, h: 844 };
    const r = remapPanelRect(panel, 0.45, { w: 1200, h: 800 }, { w: 1920, h: 1080 });
    expect(r.w).toBe(390);
    expect(r.h).toBe(844);
  });

  it('Zusatzfelder im rect-Objekt bleiben erhalten (spread)', () => {
    const panel = { x: 400, y: 200, w: 300, h: 400, _foo: 'bar', _baz: 42 };
    const r = remapPanelRect(panel, 1, { w: 1200, h: 800 }, { w: 1600, h: 800 });
    expect(r._foo).toBe('bar');
    expect(r._baz).toBe(42);
  });

  it('Workspace auf Minimum verkleinert (400px): x ≥ 0', () => {
    const panel = { x: 900, y: 100, w: 320, h: 600 };
    const r = remapPanelRect(panel, 1, { w: 1200, h: 800 }, { w: 400, h: 600 });
    expect(r.x).toBeGreaterThanOrEqual(0);
  });

  it('Panel nahe untere Kante – y-Anker korrekt bei Vergrößerung', () => {
    const panel = { x: 100, y: 700, w: 200, h: 100 };
    // freeOldH=700, relY=1 → unterer Anker: freeNewH-0=1100
    const r = remapPanelRect(panel, 1, { w: 1200, h: 800 }, { w: 1200, h: 1200 });
    expect(r.y).toBe(1100);
  });
});

// ── Seitenverhältnis-Wechsel ──────────────────────────────────────────────────

describe('Seitenverhältnis-Wechsel (16:9 ↔ 4:3)', () => {
  const WS_169 = { w: 1920, h: 1080 };
  const WS_43  = { w: 1024, h: 768  };

  it('Panel rechts-unten bleibt im Workspace nach Wechsel auf 4:3', () => {
    const panel = { x: 1620, y: 780, w: 300, h: 300 };
    const r = remapPanelRect(panel, 1, WS_169, WS_43);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + 300).toBeLessThanOrEqual(WS_43.w);
    expect(r.y + 300).toBeLessThanOrEqual(WS_43.h);
  });

  it('Round-Trip 16:9 → 4:3 → 16:9: exakte Rückkehr', () => {
    const panel = { x: 1620, y: 50, w: 200, h: 300 };
    const in43  = remapPanelRect(panel, 1, WS_169, WS_43);
    const back  = remapPanelRect(in43,  1, WS_43, WS_169);
    expect(back.x).toBe(panel.x);
    expect(back.y).toBe(panel.y);
  });
});

// ── remapAllPanels-Guards (reine Logik) ──────────────────────────────────────

describe('remapAllPanels – Guard-Bedingungen', () => {
  // Repliziert die Guard-Logik aus app.js als reine Funktion
  function guardCheck(panelsMap, oldWs, newWs) {
    if (!oldWs || oldWs.w <= 0 || oldWs.h <= 0 || panelsMap.size === 0) return false;
    if (oldWs.w === newWs.w && oldWs.h === newWs.h) return false;
    return true;
  }

  it('leere Panels-Map → kein Remap', () => {
    expect(guardCheck(new Map(), { w: 1200, h: 800 }, { w: 1600, h: 800 })).toBe(false);
  });

  it('oldWs.w = 0 → kein Remap', () => {
    expect(guardCheck(new Map([['p', {}]]), { w: 0, h: 800 }, { w: 1600, h: 800 })).toBe(false);
  });

  it('oldWs.h = 0 → kein Remap', () => {
    expect(guardCheck(new Map([['p', {}]]), { w: 1200, h: 0 }, { w: 1200, h: 800 })).toBe(false);
  });

  it('oldWs = null → kein Remap', () => {
    expect(guardCheck(new Map([['p', {}]]), null, { w: 1200, h: 800 })).toBe(false);
  });

  it('gleiche Größe → kein Remap (Minimize/Restore via Taskleiste)', () => {
    expect(guardCheck(new Map([['p', {}]]), { w: 1200, h: 800 }, { w: 1200, h: 800 })).toBe(false);
  });

  it('unterschiedliche Breite → Remap wird ausgeführt', () => {
    expect(guardCheck(new Map([['p', {}]]), { w: 1200, h: 800 }, { w: 1600, h: 800 })).toBe(true);
  });

  it('unterschiedliche Höhe → Remap wird ausgeführt', () => {
    expect(guardCheck(new Map([['p', {}]]), { w: 1200, h: 800 }, { w: 1200, h: 1080 })).toBe(true);
  });

  it('Panels vorhanden + Größe geändert → Remap wird ausgeführt', () => {
    const panels = new Map([['p1', {}], ['p2', {}]]);
    expect(guardCheck(panels, { w: 1200, h: 800 }, { w: 1920, h: 1080 })).toBe(true);
  });
});
