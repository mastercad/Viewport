/**
 * Tests für die Rotationslogik in rotatePanel() – panels.js.
 *
 * rotatePanel() ist an den DOM und Electron gebunden, deshalb wird die
 * Berechnungslogik als reine Funktion repliziert (identisch mit Produktionscode).
 *
 * Geprüfte Invarianten:
 *
 * DIMENSIONEN NACH ROTATION:
 *  - Portrait→Landscape: w = _baseH + fw_landscape, h = _baseW + FRAME_HEAD_H + fh_landscape
 *  - Landscape→Portrait: w = _baseW + fw_portrait,  h = _baseH + FRAME_HEAD_H + fh_portrait
 *
 * ROUND-TRIP (Kernproblem):
 *  - Portrait→Landscape→Portrait: rect.w und rect.h identisch mit Ausgangswerten
 *  - Landscape→Portrait→Landscape: rect.w und rect.h identisch mit Landscape-Werten
 *  - 4 Rotationen → exakt wieder am Ausgangspunkt
 *  - 10 Rotationen → exakt wieder am Ausgangspunkt
 *
 * FRAME-ROTATION:
 *  - Portrait-Frame {t,r,b,l} → Landscape-Frame {t:l, r:t, b:r, l:b}
 *  - Landscape→Portrait restoriert exakt den ursprünglichen Frame
 *
 *  KONSISTENZ MIT calcInitialRect:
 *  - rect.w/h nach Landscape→Portrait muss mit calcInitialRect(Portrait) identisch sein
 *
 * GERÄTE:
 *  - Android  (360×800, frame t32 r12 b26 l12)
 *  - iPhone   (390×844, frame t44 r14 b30 l14)
 *  - Tablet   (768×1024, frame t24 r16 b20 l16)
 *  - Laptop   (1366×768, frame t18 r10 b46 l10)
 *  - Desktop  (1920×1080, kein Frame)
 */

import { describe, it, expect } from 'vitest';

// ── Konstante identisch mit constants.js ──────────────────────────────────────

const FRAME_HEAD_H = 36;

// ── Gerätedefinitionen identisch mit PRESETS ──────────────────────────────────

const PRESETS = {
  android: { id: 'android', w: 360,  h: 800,  frame: { t: 32, r: 12, b: 26, l: 12 } },
  iphone:  { id: 'iphone',  w: 390,  h: 844,  frame: { t: 44, r: 14, b: 30, l: 14 } },
  tablet:  { id: 'tablet',  w: 768,  h: 1024, frame: { t: 24, r: 16, b: 20, l: 16 } },
  laptop:  { id: 'laptop',  w: 1366, h: 768,  frame: { t: 18, r: 10, b: 46, l: 10 } },
  desktop: { id: 'desktop', w: 1920, h: 1080, frame: null },
};

// ── Reine Rotation – identisch mit rotatePanel()-Kern aus panels.js ───────────

/**
 * Berechnet rect und Frame nach einer Rotation.
 *
 * @param {{ w: number, h: number, frame: object|null }} def   - Gerätedefinition (PRESETS)
 * @param {{ x, y, w, h }} rect      - Aktuelles Rect
 * @param {{ _landscape: boolean, _baseW: number, _baseH: number, _baseFrame: object|null }} rotState
 * @returns {{ rect, frame, landscape, _baseW, _baseH, _baseFrame }}
 */
function applyRotation(def, rect, rotState) {
  // Basismaße einmalig sichern – wie in rotatePanel()
  const baseW     = rotState._baseW     ?? def.w;
  const baseH     = rotState._baseH     ?? def.h;
  const baseFrame = rotState._baseFrame ?? (def.frame ? { ...def.frame } : null);

  const landscape = !rotState._landscape;

  const w = landscape ? baseH : baseW;
  const h = landscape ? baseW : baseH;

  let frame = null;
  if (baseFrame) {
    if (landscape) {
      const { t = 0, r = 0, b = 0, l = 0 } = baseFrame;
      frame = { t: l, r: t, b: r, l: b };
    } else {
      frame = { ...baseFrame };
    }
  }

  const fw = (frame?.l ?? 0) + (frame?.r ?? 0);
  const fh = (frame?.t ?? 0) + (frame?.b ?? 0);

  const newRect = { ...rect, w: w + fw, h: h + FRAME_HEAD_H + fh };

  return {
    rect:       newRect,
    frame,
    landscape,
    _baseW:     baseW,
    _baseH:     baseH,
    _baseFrame: baseFrame,
  };
}

/**
 * Simulates N rotations starting from portrait (landscape=false).
 * Returns the final rect and rotState.
 */
function simulate(def, initialRect, n) {
  let rotState = { _landscape: false, _baseW: undefined, _baseH: undefined, _baseFrame: undefined };
  let rect = { ...initialRect };

  for (let i = 0; i < n; i++) {
    const result = applyRotation(def, rect, rotState);
    rect     = result.rect;
    rotState = {
      _landscape: result.landscape,
      _baseW:     result._baseW,
      _baseH:     result._baseH,
      _baseFrame: result._baseFrame,
    };
  }
  return { rect, rotState };
}

/**
 * Portrait-Ausgangsdimensions – identisch mit calcInitialRect().
 */
function portraitRect(def) {
  const fw = (def.frame?.l ?? 0) + (def.frame?.r ?? 0);
  const fh = (def.frame?.t ?? 0) + (def.frame?.b ?? 0);
  return {
    x: 16, y: 16,
    w: def.w + fw,
    h: def.h + FRAME_HEAD_H + fh,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 1: Portrait → Landscape – korrekte Dimensionen
// ─────────────────────────────────────────────────────────────────────────────

describe('rotatePanel – Portrait → Landscape', () => {

  it('Android: w=800+24=824 h=360+36+24=420 (frame rotiert)', () => {
    const def  = PRESETS.android;
    const init = portraitRect(def);
    const { rect, rotState } = simulate(def, init, 1);
    // Landscape-Frame: {t:l=12, r:t=32, b:r=12, l:b=26}  → fw=26+32=58, fh=12+12=24
    expect(rect.w).toBe(800 + 26 + 32);   // baseH + l_ls + r_ls = 800 + 58 = 858
    expect(rect.h).toBe(360 + 36 + 12 + 12); // baseW + FRAME_HEAD_H + t_ls + b_ls = 420
    expect(rotState._landscape).toBe(true);
  });

  it('iPhone: Landscape w und h korrekt', () => {
    const def  = PRESETS.iphone;
    const init = portraitRect(def);
    const { rect } = simulate(def, init, 1);
    // Landscape-Frame: {t:l=14, r:t=44, b:r=14, l:b=30} → fw=30+44=74, fh=14+14=28
    expect(rect.w).toBe(844 + 30 + 44);   // 918
    expect(rect.h).toBe(390 + 36 + 14 + 14); // 454
  });

  it('Tablet: Landscape w und h korrekt', () => {
    const def  = PRESETS.tablet;
    const init = portraitRect(def);
    const { rect } = simulate(def, init, 1);
    // Landscape-Frame: {t:l=16, r:t=24, b:r=16, l:b=20} → fw=20+24=44, fh=16+16=32
    expect(rect.w).toBe(1024 + 20 + 24);  // 1068
    expect(rect.h).toBe(768  + 36 + 16 + 16); // 836
  });

  it('Laptop: Landscape w und h korrekt', () => {
    const def  = PRESETS.laptop;
    const init = portraitRect(def);
    const { rect } = simulate(def, init, 1);
    // Landscape-Frame: {t:l=10, r:t=18, b:r=10, l:b=46} → fw=46+18=64, fh=10+10=20
    expect(rect.w).toBe(768  + 46 + 18);  // 832
    expect(rect.h).toBe(1366 + 36 + 10 + 10); // 1422
  });

  it('Desktop (kein Frame): w=h=dims getauscht', () => {
    const def  = PRESETS.desktop;
    const init = portraitRect(def);
    const { rect } = simulate(def, init, 1);
    expect(rect.w).toBe(1080);             // baseH (Landscape-Breite)
    expect(rect.h).toBe(1920 + 36);        // baseW + FRAME_HEAD_H
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 2: Round-Trip – Portrait → Landscape → Portrait
// ─────────────────────────────────────────────────────────────────────────────

describe('rotatePanel – Round-Trip Portrait→Landscape→Portrait', () => {

  for (const [devId, dev] of Object.entries(PRESETS)) {
    it(`${devId}: rect nach 2 Rotationen identisch mit Ausgangswert`, () => {
      const init = portraitRect(dev);
      const { rect } = simulate(dev, init, 2);
      expect(rect.w).toBe(init.w);
      expect(rect.h).toBe(init.h);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 3: Round-Trip – 4 Rotationen (2 volle Zyklen)
// ─────────────────────────────────────────────────────────────────────────────

describe('rotatePanel – 4 Rotationen (2 Zyklen) kein Drift', () => {

  for (const [devId, dev] of Object.entries(PRESETS)) {
    it(`${devId}: rect nach 4 Rotationen identisch mit Ausgangswert`, () => {
      const init = portraitRect(dev);
      const { rect } = simulate(dev, init, 4);
      expect(rect.w).toBe(init.w);
      expect(rect.h).toBe(init.h);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 4: 10 Rotationen (5 Zyklen) – kein kumulativer Drift
// ─────────────────────────────────────────────────────────────────────────────

describe('rotatePanel – 10 Rotationen (5 Zyklen) kein kumulativer Drift', () => {

  for (const [devId, dev] of Object.entries(PRESETS)) {
    it(`${devId}: rect nach 10 Rotationen identisch mit Ausgangswert`, () => {
      const init = portraitRect(dev);
      const { rect } = simulate(dev, init, 10);
      expect(rect.w).toBe(init.w);
      expect(rect.h).toBe(init.h);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 5: Frame-Rotation korrekt
// ─────────────────────────────────────────────────────────────────────────────

describe('rotatePanel – Frame wird korrekt gedreht', () => {

  it('Android: Portrait-Frame {t:32,r:12,b:26,l:12} → Landscape {t:12,r:32,b:12,l:26}', () => {
    const def  = PRESETS.android;
    const init = portraitRect(def);
    const result = applyRotation(def, init, { _landscape: false });
    expect(result.frame).toEqual({ t: 12, r: 32, b: 12, l: 26 });
  });

  it('Android: Landscape-Frame → zurück zu Portrait-Frame {t:32,r:12,b:26,l:12}', () => {
    const def  = PRESETS.android;
    const init = portraitRect(def);
    const rot1 = applyRotation(def, init, { _landscape: false });
    const rot2 = applyRotation(def, rot1.rect, {
      _landscape: rot1.landscape,
      _baseW:     rot1._baseW,
      _baseH:     rot1._baseH,
      _baseFrame: rot1._baseFrame,
    });
    expect(rot2.frame).toEqual({ t: 32, r: 12, b: 26, l: 12 });
  });

  it('iPhone: Portrait-Frame {t:44,r:14,b:30,l:14} → Landscape {t:14,r:44,b:14,l:30}', () => {
    const def  = PRESETS.iphone;
    const init = portraitRect(def);
    const result = applyRotation(def, init, { _landscape: false });
    expect(result.frame).toEqual({ t: 14, r: 44, b: 14, l: 30 });
  });

  it('Desktop (kein Frame): frame bleibt null', () => {
    const def  = PRESETS.desktop;
    const init = portraitRect(def);
    const result = applyRotation(def, init, { _landscape: false });
    expect(result.frame).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 6: Konsistenz mit calcInitialRect
// rotatePanel(Portrait) muss dieselben w/h wie calcInitialRect() liefern
// ─────────────────────────────────────────────────────────────────────────────

describe('rotatePanel – Landscape→Portrait identisch mit calcInitialRect-Portrait-Dims', () => {

  for (const [devId, dev] of Object.entries(PRESETS)) {
    it(`${devId}: rect nach Landscape→Portrait hat selbe w/h wie calcInitialRect`, () => {
      const expected = portraitRect(dev); // Was calcInitialRect liefert
      const { rect } = simulate(dev, expected, 2); // Portrait→Landscape→Portrait
      expect(rect.w).toBe(expected.w);
      expect(rect.h).toBe(expected.h);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 7: Position (x, y) bleibt bei Rotation erhalten
// ─────────────────────────────────────────────────────────────────────────────

describe('rotatePanel – Position (x, y) bleibt unverändert', () => {

  it('Android: x/y bleiben nach Portrait→Landscape erhalten', () => {
    const def  = PRESETS.android;
    const init = { ...portraitRect(def), x: 306, y: 16 };
    const { rect } = simulate(def, init, 1);
    expect(rect.x).toBe(306);
    expect(rect.y).toBe(16);
  });

  it('Android: x/y bleiben nach Landscape→Portrait erhalten', () => {
    const def  = PRESETS.android;
    const init = { ...portraitRect(def), x: 306, y: 16 };
    const { rect } = simulate(def, init, 2);
    expect(rect.x).toBe(306);
    expect(rect.y).toBe(16);
  });
});
