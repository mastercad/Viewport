/**
 * Tests für computeScaleRect + clampRect (state.js)
 *
 * Verhalten:
 *  - Panel-Position (naturalX/Y) ist fester Anker für alle Skalierungen
 *  - scale+ clampt nur wenn das Panel den Workspace-Rand überschreiten würde
 *  - scale- kehrt exakt zur Ausgangsposition zurück (keine Zentrierung)
 *  - clampRect verwendet min(s, 1) da CSS scale() nur für s<1 wirkt
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { state, clampRect, computeScaleRect } from '../src/renderer/state.js';

beforeEach(() => {
  state.wsRect     = { x: 0, y: 0, w: 1000, h: 800 };
  state.panelScale = 1.0;
});

// ─── clampRect: korrekte visuelle Größe ───────────────────────────────────────

describe('clampRect – visuelle Größe = rect.w * min(s, 1)', () => {
  it('klemmt bei s=0.8 mit visueller Breite rect.w*0.8', () => {
    // max_x = 1000 - 300*0.8 = 760
    const r = clampRect({ x: 800, y: 50, w: 300, h: 200 }, 0.8);
    expect(r.x).toBe(760);
  });

  it('klemmt bei s=1.0 mit visueller Breite rect.w*1', () => {
    // max_x = 1000 - 300*1 = 700
    const r = clampRect({ x: 750, y: 50, w: 300, h: 200 }, 1.0);
    expect(r.x).toBe(700);
  });

  it('klemmt bei s=1.5 NICHT mehr als bei s=1.0 (CSS scale inaktiv)', () => {
    // max_x = 1000 - 300*min(1.5,1) = 1000 - 300 = 700 (gleich wie s=1.0)
    const r = clampRect({ x: 750, y: 50, w: 300, h: 200 }, 1.5);
    expect(r.x).toBe(700);
  });

  it('klemmt bei s=2.0 wie s=1.0', () => {
    const r = clampRect({ x: 800, y: 50, w: 300, h: 200 }, 2.0);
    expect(r.x).toBe(700);
  });

  it('panel innerhalb des Workspace bleibt unverändert', () => {
    const r = clampRect({ x: 100, y: 50, w: 300, h: 200 }, 0.8);
    expect(r.x).toBe(100);
  });
});

// ─── Symmetrie ohne Clamping ──────────────────────────────────────────────────

describe('computeScaleRect – Position bleibt stabil (kein Clamping)', () => {
  it('scale+ ändert rect.x nicht wenn kein Clamping nötig', () => {
    const p = { rect: { x: 100, y: 50, w: 300, h: 400 }, scale: 0.8 };
    const r = computeScaleRect(p, 0.9);
    expect(r.rect.x).toBe(100);
    expect(r.rect.y).toBe(50);
  });

  it('scale- ändert rect.x nicht', () => {
    const p = { rect: { x: 100, y: 50, w: 300, h: 400 }, scale: 0.9 };
    const r = computeScaleRect(p, 0.8);
    expect(r.rect.x).toBe(100);
    expect(r.rect.y).toBe(50);
  });

  it('scale+ dann scale- kehrt exakt zur Ausgangsposition zurück', () => {
    const p = { rect: { x: 100, y: 50, w: 300, h: 400 }, scale: 0.8 };

    const r1 = computeScaleRect(p, 0.9);
    const p2 = { ...p, rect: r1.rect, scale: 0.9, naturalX: r1.naturalX, naturalY: r1.naturalY };
    const r2 = computeScaleRect(p2, 0.8);

    expect(r2.rect.x).toBe(100);
    expect(r2.rect.y).toBe(50);
  });

  it('mehrfaches scale+ und scale- ist exakt symmetrisch', () => {
    let p = { rect: { x: 200, y: 80, w: 300, h: 400 }, scale: 0.5 };
    for (let i = 0; i < 5; i++) {
      const newS = Math.min(2.0, p.scale + 0.1);
      const r = computeScaleRect(p, newS);
      p = { ...p, rect: r.rect, scale: newS, naturalX: r.naturalX, naturalY: r.naturalY };
    }
    for (let i = 0; i < 5; i++) {
      const newS = Math.max(0.15, p.scale - 0.1);
      const r = computeScaleRect(p, newS);
      p = { ...p, rect: r.rect, scale: newS, naturalX: r.naturalX, naturalY: r.naturalY };
    }
    expect(p.rect.x).toBeCloseTo(200, 10);
    expect(p.rect.y).toBeCloseTo(80, 10);
  });
});

// ─── Clamping am rechten Rand ─────────────────────────────────────────────────

describe('computeScaleRect – Clamping und Rückkehr', () => {
  it('panel am rechten Rand bleibt beim Vergrößern im Workspace', () => {
    const p = { rect: { x: 760, y: 50, w: 300, h: 200 }, scale: 0.8 };
    const r = computeScaleRect(p, 0.9);
    expect(r.rect.x + 300 * 0.9).toBeLessThanOrEqual(1000);
  });

  it('nach scale+ (mit Clamping) kehrt scale- zur Originalposition zurück', () => {
    const p = { rect: { x: 760, y: 50, w: 300, h: 200 }, scale: 0.8 };
    const r1 = computeScaleRect(p, 0.9);
    const p2 = { ...p, rect: r1.rect, scale: 0.9, naturalX: r1.naturalX, naturalY: r1.naturalY };
    const r2 = computeScaleRect(p2, 0.8);
    expect(r2.rect.x).toBe(760);
    expect(r2.rect.y).toBe(50);
  });

  it('naturalX wird korrekt aus rect.x initialisiert', () => {
    const p = { rect: { x: 300, y: 100, w: 200, h: 150 }, scale: 0.8 };
    const r = computeScaleRect(p, 0.9);
    expect(r.naturalX).toBe(300);
    expect(r.naturalY).toBe(100);
  });

  it('bestehendes naturalX wird übernommen statt rect.x', () => {
    const p = { rect: { x: 730, y: 50, w: 300, h: 200 }, scale: 0.9, naturalX: 760, naturalY: 50 };
    const r = computeScaleRect(p, 0.8);
    expect(r.rect.x).toBe(760);
  });

  it('panel am unteren Rand bleibt beim Vergrößern im Workspace', () => {
    const p = { rect: { x: 100, y: 620, w: 300, h: 200 }, scale: 0.8, naturalX: 100, naturalY: 620 };
    const r = computeScaleRect(p, 0.9);
    expect(r.rect.y + 200 * 0.9).toBeLessThanOrEqual(800);
  });

  it('scale über 1.0 klemmt nicht stärker als s=1.0', () => {
    const p = { rect: { x: 700, y: 50, w: 300, h: 200 }, scale: 1.0 };
    const r = computeScaleRect(p, 1.1);
    expect(r.rect.x).toBe(700);
  });
});
