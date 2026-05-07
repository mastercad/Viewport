/**
 * Tests für calcInitialRect() – Positionierung beim Hinzufügen eines Panels.
 *
 * calcInitialRect() ist eine private Funktion in panels.js, deshalb wird die
 * Logik hier als reine Funktion repliziert (identisch mit dem Produktionscode).
 *
 * Geprüfte Invarianten:
 *
 * VISUELLE POSITION IN BOUNDS:
 *  - x + w*scale ≤ wsRect.w  (Panel bleibt horizontal im Sichtbereich)
 *  - y + h*scale ≤ wsRect.h  (Panel bleibt vertikal im Sichtbereich)
 *  - x ≥ 0
 *  - y ≥ 0
 *
 * LOGISCHE DIMENSIONEN UNVERÄNDERLICH:
 *  - w entspricht genau def.w + frame.l + frame.r
 *  - h entspricht genau def.h + FRAME_HEAD_H + frame.t + frame.b
 *  - Kein Klemmen an wsRect – das ist Aufgabe von CSS scale()
 *
 * ROTATIONS-KONSISTENZ:
 *  - Der von calcInitialRect() gelieferte w/h-Wert muss mit dem von
 *    rotatePanel() für Portrait berechneten Wert identisch sein, damit
 *    Portrait→Landscape→Portrait keinen Drift erzeugt.
 *
 * SZENARIEN:
 *  - scale=1.0 (kein CSS-Transform)
 *  - scale=0.45 (typischer Mobilgeräte-Scale, Panel größer als Workspace)
 *  - scale=0.75
 *  - scale=0.2  (Minimum)
 *  - Geräte: Android (360×800, frame t32 r12 b26 l12)
 *             iPhone  (390×844, frame t44 r14 b30 l14)
 *             Tablet  (768×1024, frame t24 r16 b20 l16)
 *             Laptop  (1366×768, frame t18 r10 b46 l10)
 *             Desktop (1920×1080, kein Frame)
 *  - Workspace: klein (800×600), mittel (1440×900), groß (2560×1440)
 *  - Mehrere Panels (step-Logik)
 */

import { describe, it, expect } from 'vitest';

// ── Konstanten identisch mit constants.js ─────────────────────────────────────

const FRAME_HEAD_H = 36;

const PRESETS = {
  android: { id: 'android', label: 'Android', w: 360,  h: 800,  frame: { t: 32, r: 12, b: 26, l: 12 } },
  iphone:  { id: 'iphone',  label: 'iPhone',  w: 390,  h: 844,  frame: { t: 44, r: 14, b: 30, l: 14 } },
  tablet:  { id: 'tablet',  label: 'Tablet',  w: 768,  h: 1024, frame: { t: 24, r: 16, b: 20, l: 16 } },
  laptop:  { id: 'laptop',  label: 'Laptop',  w: 1366, h: 768,  frame: { t: 18, r: 10, b: 46, l: 10 } },
  desktop: { id: 'desktop', label: 'Desktop', w: 1920, h: 1080, frame: null },
};

// ── Reine Funktion – identisch mit panels.js:calcInitialRect() ────────────────

function calcInitialRect(def, wsRect, panelCount, panelScale) {
  const fw = (def.frame?.l ?? 0) + (def.frame?.r ?? 0);
  const fh = (def.frame?.t ?? 0) + (def.frame?.b ?? 0);
  const s  = Math.min(panelScale, 1);
  const w  = def.w + fw;
  const h  = def.h + FRAME_HEAD_H + fh;
  const vw = w * s;
  const vh = h * s;
  const STEP  = FRAME_HEAD_H + 6;
  const maxSt = Math.max(1, Math.floor((wsRect.h - vh - 20) / STEP));
  const step  = panelCount % maxSt;
  const col   = Math.floor(panelCount / maxSt);
  const colW  = Math.min(200, Math.floor(wsRect.w / 5));
  return {
    x: Math.min(col * colW + step * 4 + 16, Math.max(0, wsRect.w - vw - 16)),
    y: Math.min(step * STEP + 16,            Math.max(0, wsRect.h - vh - 16)),
    w, h,
  };
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

const WS_SMALL  = { w: 800,  h: 600  };
const WS_MEDIUM = { w: 1440, h: 900  };
const WS_LARGE  = { w: 2560, h: 1440 };

function assertVisuallyInBounds(rect, wsRect, scale, label) {
  const s  = Math.min(scale, 1);
  const vw = rect.w * s;
  const vh = rect.h * s;
  // Position ist immer >= 0
  expect(rect.x, `${label}: x >= 0`).toBeGreaterThanOrEqual(0);
  expect(rect.y, `${label}: y >= 0`).toBeGreaterThanOrEqual(0);
  // Wenn das Panel in den Workspace passt, muss es auch visuell drin bleiben.
  // Passt es nicht (Panel zu groß für WS), ist x=0 das Beste – kein Overflow-Test.
  if (vw <= wsRect.w) {
    expect(
      rect.x + vw,
      `${label}: x + w*s <= wsRect.w`
    ).toBeLessThanOrEqual(wsRect.w + 0.001);
  } else {
    expect(rect.x, `${label}: Panel zu groß → x=0`).toBe(0);
  }
  if (vh <= wsRect.h) {
    expect(
      rect.y + vh,
      `${label}: y + h*s <= wsRect.h`
    ).toBeLessThanOrEqual(wsRect.h + 0.001);
  } else {
    expect(rect.y, `${label}: Panel zu groß → y=0`).toBe(0);
  }
}

function assertLogicalDimensions(rect, def, label) {
  const fw = (def.frame?.l ?? 0) + (def.frame?.r ?? 0);
  const fh = (def.frame?.t ?? 0) + (def.frame?.b ?? 0);
  expect(rect.w, `${label}: w = def.w + fw`).toBe(def.w + fw);
  expect(rect.h, `${label}: h = def.h + FRAME_HEAD_H + fh`).toBe(def.h + FRAME_HEAD_H + fh);
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 1: Visuelle Position immer im Sichtbereich
// ─────────────────────────────────────────────────────────────────────────────

describe('calcInitialRect – Panel bleibt visuell im Workspace', () => {

  const scales = [1.0, 0.75, 0.45, 0.2];
  const workspaces = [
    ['klein (800×600)',   WS_SMALL],
    ['mittel (1440×900)', WS_MEDIUM],
    ['groß (2560×1440)',  WS_LARGE],
  ];

  for (const [wsLabel, ws] of workspaces) {
    for (const scale of scales) {
      for (const [devId, dev] of Object.entries(PRESETS)) {
        it(`${devId} @ scale=${scale}, ws=${wsLabel} – visuell in bounds`, () => {
          const rect = calcInitialRect(dev, ws, 0, scale);
          assertVisuallyInBounds(rect, ws, scale, `${devId}@${scale} ws=${wsLabel}`);
        });
      }
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 2: Logische Dimensionen = Device-Dimensionen (kein Workspace-Clamping)
// ─────────────────────────────────────────────────────────────────────────────

describe('calcInitialRect – logische Dimensionen entsprechen Device-Maßen', () => {

  it('Android @ scale=1.0, ws=800×600: w und h nicht an ws geklamt', () => {
    const rect = calcInitialRect(PRESETS.android, WS_SMALL, 0, 1.0);
    assertLogicalDimensions(rect, PRESETS.android, 'android@1.0/small');
  });

  it('Android @ scale=0.45, ws=800×600: logische Dims unverändert', () => {
    const rect = calcInitialRect(PRESETS.android, WS_SMALL, 0, 0.45);
    assertLogicalDimensions(rect, PRESETS.android, 'android@0.45/small');
  });

  it('iPhone @ scale=0.45, ws=800×600', () => {
    const rect = calcInitialRect(PRESETS.iphone, WS_SMALL, 0, 0.45);
    assertLogicalDimensions(rect, PRESETS.iphone, 'iphone@0.45/small');
  });

  it('Tablet @ scale=0.45, ws=800×600', () => {
    const rect = calcInitialRect(PRESETS.tablet, WS_SMALL, 0, 0.45);
    assertLogicalDimensions(rect, PRESETS.tablet, 'tablet@0.45/small');
  });

  it('Laptop @ scale=0.45, ws=800×600', () => {
    const rect = calcInitialRect(PRESETS.laptop, WS_SMALL, 0, 0.45);
    assertLogicalDimensions(rect, PRESETS.laptop, 'laptop@0.45/small');
  });

  it('Desktop @ scale=0.45, ws=800×600', () => {
    const rect = calcInitialRect(PRESETS.desktop, WS_SMALL, 0, 0.45);
    assertLogicalDimensions(rect, PRESETS.desktop, 'desktop@0.45/small');
  });

  it('Android @ scale=1.0, ws=1440×900', () => {
    const rect = calcInitialRect(PRESETS.android, WS_MEDIUM, 0, 1.0);
    assertLogicalDimensions(rect, PRESETS.android, 'android@1.0/medium');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 3: Rotations-Konsistenz – calcInitialRect muss mit rotatePanel übereinstimmen
//
// rotatePanel() berechnet für Portrait:  w = _baseW + fw_portrait
//                                        h = _baseH + FRAME_HEAD_H + fh_portrait
// calcInitialRect() muss dasselbe Ergebnis liefern, sonst entsteht Drift.
// ─────────────────────────────────────────────────────────────────────────────

describe('calcInitialRect – Dimensions-Konsistenz mit rotatePanel', () => {

  // Android Portrait: w=360, h=800, frame={t:32,r:12,b:26,l:12}
  // Erwartet: w = 360+12+12=384, h = 800+36+32+26=894
  it('Android Portrait: rect.w = 384, rect.h = 894', () => {
    const rect = calcInitialRect(PRESETS.android, WS_MEDIUM, 0, 0.45);
    expect(rect.w).toBe(384);  // 360 + 12(l) + 12(r)
    expect(rect.h).toBe(894);  // 800 + 36(titlebar) + 32(t) + 26(b)
  });

  // iPhone Portrait: w=390, h=844, frame={t:44,r:14,b:30,l:14}
  // Erwartet: w = 390+14+14=418, h = 844+36+44+30=954
  it('iPhone Portrait: rect.w = 418, rect.h = 954', () => {
    const rect = calcInitialRect(PRESETS.iphone, WS_MEDIUM, 0, 0.45);
    expect(rect.w).toBe(418);  // 390 + 14(l) + 14(r)
    expect(rect.h).toBe(954);  // 844 + 36 + 44 + 30
  });

  // Tablet Portrait: w=768, h=1024, frame={t:24,r:16,b:20,l:16}
  // Erwartet: w = 768+16+16=800, h = 1024+36+24+20=1104
  it('Tablet Portrait: rect.w = 800, rect.h = 1104', () => {
    const rect = calcInitialRect(PRESETS.tablet, WS_MEDIUM, 0, 0.45);
    expect(rect.w).toBe(800);
    expect(rect.h).toBe(1104);
  });

  // Laptop: w=1366, h=768, frame={t:18,r:10,b:46,l:10}
  // Erwartet: w = 1366+10+10=1386, h = 768+36+18+46=868
  it('Laptop: rect.w = 1386, rect.h = 868', () => {
    const rect = calcInitialRect(PRESETS.laptop, WS_MEDIUM, 0, 0.45);
    expect(rect.w).toBe(1386);
    expect(rect.h).toBe(868);
  });

  // Desktop: w=1920, h=1080, kein Frame
  // Erwartet: w = 1920, h = 1080+36=1116
  it('Desktop: rect.w = 1920, rect.h = 1116', () => {
    const rect = calcInitialRect(PRESETS.desktop, WS_MEDIUM, 0, 0.45);
    expect(rect.w).toBe(1920);
    expect(rect.h).toBe(1116);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 4: Mehrere Panels – alle bleiben visuell im Workspace
// ─────────────────────────────────────────────────────────────────────────────

describe('calcInitialRect – mehrere Panels bleiben in bounds', () => {

  it('Panels 0–9: Android @ scale=0.45, ws=1440×900 bleiben alle in bounds', () => {
    for (let i = 0; i < 10; i++) {
      const rect = calcInitialRect(PRESETS.android, WS_MEDIUM, i, 0.45);
      assertVisuallyInBounds(rect, WS_MEDIUM, 0.45, `android panel ${i}`);
    }
  });

  it('Panels 0–9: iPhone @ scale=0.45, ws=800×600 bleiben alle in bounds', () => {
    for (let i = 0; i < 10; i++) {
      const rect = calcInitialRect(PRESETS.iphone, WS_SMALL, i, 0.45);
      assertVisuallyInBounds(rect, WS_SMALL, 0.45, `iphone panel ${i}`);
    }
  });

  it('Panels 0–5: Tablet @ scale=0.75, ws=1440×900 bleiben alle in bounds', () => {
    for (let i = 0; i < 6; i++) {
      const rect = calcInitialRect(PRESETS.tablet, WS_MEDIUM, i, 0.75);
      assertVisuallyInBounds(rect, WS_MEDIUM, 0.75, `tablet panel ${i}`);
    }
  });

  it('Panels 0–3: Laptop @ scale=0.45, ws=800×600 bleiben alle in bounds', () => {
    for (let i = 0; i < 4; i++) {
      const rect = calcInitialRect(PRESETS.laptop, WS_SMALL, i, 0.45);
      assertVisuallyInBounds(rect, WS_SMALL, 0.45, `laptop panel ${i}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 5: Grenzfälle
// ─────────────────────────────────────────────────────────────────────────────

describe('calcInitialRect – Grenzfälle', () => {

  it('scale=1.0 → visuelle und logische Größe identisch', () => {
    const rect = calcInitialRect(PRESETS.android, WS_MEDIUM, 0, 1.0);
    // Bei scale=1 ist vw = w * 1 = w, also gelten dieselben Regeln
    expect(rect.w).toBe(384);
    expect(rect.h).toBe(894);
    assertVisuallyInBounds(rect, WS_MEDIUM, 1.0, 'android@1.0/medium');
  });

  it('scale=0.2 (Minimum) → Panel noch im Workspace', () => {
    const rect = calcInitialRect(PRESETS.desktop, WS_SMALL, 0, 0.2);
    assertVisuallyInBounds(rect, WS_SMALL, 0.2, 'desktop@0.2/small');
  });

  it('x-Position ist immer >= 0', () => {
    // Auch bei extremen Szenarien kein negatives x
    const rect = calcInitialRect(PRESETS.desktop, WS_SMALL, 0, 1.0);
    expect(rect.x).toBeGreaterThanOrEqual(0);
  });

  it('y-Position ist immer >= 0', () => {
    const rect = calcInitialRect(PRESETS.desktop, WS_SMALL, 0, 1.0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
  });

  it('Panel ohne Frame: fw=0, fh=0', () => {
    const rect = calcInitialRect(PRESETS.desktop, WS_LARGE, 0, 0.5);
    expect(rect.w).toBe(1920);     // 1920 + 0
    expect(rect.h).toBe(1116);     // 1080 + 36 + 0
    assertVisuallyInBounds(rect, WS_LARGE, 0.5, 'desktop@0.5/large');
  });
});
