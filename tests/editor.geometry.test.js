/**
 * Tests für editor/geometry.js
 *
 * Alle drei Funktionen sind rein (pure), ohne DOM oder State – ideal für Unit-Tests.
 */

import { describe, it, expect } from 'vitest';
import { normRect, distToSegment, cloneAnn } from '../src/renderer/editor/geometry.js';

// ── normRect ─────────────────────────────────────────────────────────────────

describe('normRect', () => {
  it('lässt bereits normiertes Rechteck unverändert', () => {
    expect(normRect({ x1: 1, y1: 2, x2: 3, y2: 4 })).toEqual({ x1: 1, y1: 2, x2: 3, y2: 4 });
  });

  it('normiert x-Koordinaten wenn x1 > x2', () => {
    expect(normRect({ x1: 5, y1: 0, x2: 1, y2: 4 })).toEqual({ x1: 1, y1: 0, x2: 5, y2: 4 });
  });

  it('normiert y-Koordinaten wenn y1 > y2', () => {
    expect(normRect({ x1: 0, y1: 9, x2: 4, y2: 3 })).toEqual({ x1: 0, y1: 3, x2: 4, y2: 9 });
  });

  it('normiert beide Achsen gleichzeitig', () => {
    expect(normRect({ x1: 8, y1: 6, x2: 2, y2: 1 })).toEqual({ x1: 2, y1: 1, x2: 8, y2: 6 });
  });

  it('liefert identisches Objekt bei gleichen Koordinaten', () => {
    expect(normRect({ x1: 5, y1: 5, x2: 5, y2: 5 })).toEqual({ x1: 5, y1: 5, x2: 5, y2: 5 });
  });
});

// ── distToSegment ─────────────────────────────────────────────────────────────

describe('distToSegment', () => {
  // Horizontales Segment von (0,0) nach (10,0)
  it('Punkt auf dem Segment → Abstand 0', () => {
    expect(distToSegment(5, 0, 0, 0, 10, 0)).toBeCloseTo(0);
  });

  it('Punkt senkrecht zur Segmentmitte → senkrechter Abstand', () => {
    expect(distToSegment(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
  });

  it('Punkt senkrecht zum Startpunkt von der Seite → senkrechter Abstand', () => {
    expect(distToSegment(0, 4, 0, 0, 10, 0)).toBeCloseTo(4);
  });

  it('Punkt vor dem Startpunkt → Abstand zum Startpunkt', () => {
    expect(distToSegment(-3, 0, 0, 0, 10, 0)).toBeCloseTo(3);
  });

  it('Punkt hinter dem Endpunkt → Abstand zum Endpunkt', () => {
    expect(distToSegment(14, 0, 0, 0, 10, 0)).toBeCloseTo(4);
  });

  it('Punkt diagonal hinter dem Endpunkt → euklidischer Abstand zum Endpunkt', () => {
    // Punkt bei (13,4), Endpunkt bei (10,0) → hypot(3,4) = 5
    expect(distToSegment(13, 4, 0, 0, 10, 0)).toBeCloseTo(5);
  });

  it('degeneriertes Segment (Start = Ende) → Abstand zum Punkt', () => {
    // hypot(3,4) = 5
    expect(distToSegment(3, 4, 0, 0, 0, 0)).toBeCloseTo(5);
  });

  it('Punkt liegt auf dem Startpunkt → Abstand 0', () => {
    expect(distToSegment(0, 0, 0, 0, 10, 0)).toBeCloseTo(0);
  });

  it('Punkt liegt auf dem Endpunkt → Abstand 0', () => {
    expect(distToSegment(10, 0, 0, 0, 10, 0)).toBeCloseTo(0);
  });

  it('diagonales Segment – Lot auf Mitte', () => {
    // Segment von (0,0) nach (4,4), Mittelpunkt (2,2)
    // Punkt senkrecht zur Diagonalen bei (2,2): (0,4) oder (4,0)
    // Abstand von (0,4) zur Diagonalen = sqrt(2^2 + 2^2) / sqrt(2) = 2
    expect(distToSegment(0, 4, 0, 0, 4, 4)).toBeCloseTo(Math.SQRT2 * 2);
  });
});

// ── cloneAnn ─────────────────────────────────────────────────────────────────

describe('cloneAnn', () => {
  it('erzeugt eine neue Objektinstanz', () => {
    const original = { id: 1, type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 100 };
    const clone = cloneAnn(original);
    expect(clone).not.toBe(original);
  });

  it('enthält dieselben Werte wie das Original', () => {
    const original = { id: 2, type: 'circle', cx: 50, cy: 50, rx: 30, ry: 20, color: '#fff' };
    expect(cloneAnn(original)).toEqual(original);
  });

  it('Änderungen am Klon beeinflussen das Original nicht', () => {
    const original = { id: 3, type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10 };
    const clone = cloneAnn(original);
    clone.x1 = 999;
    expect(original.x1).toBe(0);
  });

  it('klont verschachtelte Objekte tief', () => {
    const original = { id: 4, type: 'magnifier', meta: { color: '#f00' } };
    const clone = cloneAnn(original);
    clone.meta.color = '#00f';
    expect(original.meta.color).toBe('#f00');
  });
});
