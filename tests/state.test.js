/**
 * Tests für state.js
 *
 * normalizeWsRect und clampRect sind reine Geometrie-Hilfsfunktionen
 * ohne DOM-Abhängigkeiten und eignen sich optimal für Unit-Tests.
 * applyDecoRect wird hier nicht getestet (DOM-Seiteneffekte).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeWsRect, clampRect, state } from '../src/renderer/state.js';

// ─── normalizeWsRect ─────────────────────────────────────────────────────────

describe('normalizeWsRect', () => {
  it('gibt {x:0, y:0, w:800, h:600} bei null zurück', () => {
    expect(normalizeWsRect(null)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });

  it('gibt {x:0, y:0, w:800, h:600} bei undefined zurück', () => {
    expect(normalizeWsRect(undefined)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });

  it('gibt {x:0, y:0, w:800, h:600} bei leerem Objekt zurück', () => {
    // w und h fehlen → 0 || 800 = 800
    const r = normalizeWsRect({});
    expect(r.w).toBe(800);
    expect(r.h).toBe(600);
  });

  it('übernimmt vollständiges w/h-Objekt unverändert', () => {
    const r = normalizeWsRect({ x: 10, y: 20, w: 1920, h: 1080 });
    expect(r).toEqual({ x: 10, y: 20, w: 1920, h: 1080 });
  });

  it('akzeptiert width/height als Aliase für w/h', () => {
    const r = normalizeWsRect({ width: 1366, height: 768 });
    expect(r).toEqual({ x: 0, y: 0, w: 1366, h: 768 });
  });

  it('füllt fehlendes x und y mit 0 auf', () => {
    const r = normalizeWsRect({ w: 1000, h: 500 });
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.w).toBe(1000);
    expect(r.h).toBe(500);
  });

  it('gibt neue Objekte zurück (keine direkte Referenz)', () => {
    const input = { x: 0, y: 0, w: 1000, h: 800 };
    const r = normalizeWsRect(input);
    r.w = 9999;
    expect(input.w).toBe(1000); // Original unberührt
  });
});

// ─── clampRect ──────────────────────────────────────────────────────────────

describe('clampRect', () => {
  beforeEach(() => {
    // Workspace: 1000 × 800 px, oben links bei (0, 0)
    state.wsRect     = { x: 0, y: 0, w: 1000, h: 800 };
    state.panelScale = 1.0;
  });

  it('lässt Panel das vollständig innen liegt unverändert', () => {
    const r = clampRect({ x: 100, y: 100, w: 200, h: 150 }, 1);
    expect(r.x).toBe(100);
    expect(r.y).toBe(100);
  });

  it('klemmt x auf 0 wenn Panel links außerhalb des Workspace liegt', () => {
    const r = clampRect({ x: -50, y: 100, w: 200, h: 150 }, 1);
    expect(r.x).toBe(0);
  });

  it('klemmt y auf 0 wenn Panel oben außerhalb des Workspace liegt', () => {
    const r = clampRect({ x: 100, y: -30, w: 200, h: 150 }, 1);
    expect(r.y).toBe(0);
  });

  it('klemmt x wenn Panel rechts überläuft (scale=1)', () => {
    // max x = wsRect.w - panel.w * scale = 1000 - 200 * 1 = 800
    const r = clampRect({ x: 900, y: 100, w: 200, h: 150 }, 1);
    expect(r.x).toBe(800);
  });

  it('klemmt y wenn Panel unten überläuft (scale=1)', () => {
    // max y = wsRect.h - panel.h * scale = 800 - 150 * 1 = 650
    const r = clampRect({ x: 100, y: 700, w: 200, h: 150 }, 1);
    expect(r.y).toBe(650);
  });

  it('berücksichtigt scale=0.5 beim Klemmen (visuelle Größe ist kleiner)', () => {
    // Visuelle Breite = 200 * 0.5 = 100 → max x = 1000 - 100 = 900
    const r = clampRect({ x: 950, y: 100, w: 200, h: 150 }, 0.5);
    expect(r.x).toBe(900);
  });

  it('berücksichtigt scale=0.5 für y-Klemmen', () => {
    // Visuelle Höhe = 150 * 0.5 = 75 → max y = 800 - 75 = 725
    const r = clampRect({ x: 100, y: 800, w: 200, h: 150 }, 0.5);
    expect(r.y).toBe(725);
  });

  it('behält w und h des Rects unverändert', () => {
    const r = clampRect({ x: 0, y: 0, w: 300, h: 200 }, 1);
    expect(r.w).toBe(300);
    expect(r.h).toBe(200);
  });

  it('verwendet state.panelScale wenn kein scale-Parameter übergeben wird', () => {
    state.panelScale = 0.5;
    // Visuelle Breite = 200 * 0.5 = 100 → max x = 1000 - 100 = 900
    const r = clampRect({ x: 950, y: 100, w: 200, h: 150 });
    expect(r.x).toBe(900);
  });

  it('Panel-Position (0, 0) bleibt unverändert', () => {
    const r = clampRect({ x: 0, y: 0, w: 100, h: 100 }, 1);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it('Panel exakt am rechten Rand bleibt unverändert', () => {
    // max x = 1000 - 200 = 800
    const r = clampRect({ x: 800, y: 0, w: 200, h: 100 }, 1);
    expect(r.x).toBe(800);
  });
});
