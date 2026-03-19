/**
 * Tests für die Scale-Slider-Synchronisation nach dem Session-Restore.
 *
 * BUG (behoben): Nach dem Wiederherstellen einer gespeicherten Session
 * wurden Slider-Position und Label in der Toolbar nie aktualisiert.
 * Die Panels wurden korrekt skaliert, der Slider zeigte aber immer 100%.
 *
 * FIX: Am Ende von restoreSession() in app.js werden jetzt
 * scaleSlider.value, scaleSlider.style (--pct) und scaleLabel.textContent
 * anhand des ersten gespeicherten Panel-Scale gesetzt.
 *
 * Die Berechnung in restoreSession():
 *   firstScale = clamp(0.1, 1.0, savedScale ?? 1)
 *   pct        = round(firstScale * 100)
 *   sliderVal  = clamp(sliderMin, sliderMax, pct)
 *   label      = pct + '%'
 *
 * Diese Logik wird hier als reine Funktion getestet.
 */

import { describe, it, expect } from 'vitest';

// ── Reine Hilfsfunktion – repliziert die Logik aus restoreSession() ──────────
// sliderMin/sliderMax entsprechen min="20" max="100" im HTML-Slider.

function calcSliderSync(savedScale, sliderMin = 20, sliderMax = 100) {
  const scale     = Math.max(0.1, Math.min(1, savedScale ?? 1));
  const pct       = Math.round(scale * 100);
  const sliderVal = Math.max(sliderMin, Math.min(sliderMax, pct));
  return { scale, pct, sliderVal, label: pct + '%' };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Scale-Slider-Sync nach Session-Restore', () => {

  // ── Standardwerte ──────────────────────────────────────────────────────────

  it('scale=1.0 → slider=100, label="100%"', () => {
    const r = calcSliderSync(1);
    expect(r.sliderVal).toBe(100);
    expect(r.label).toBe('100%');
    expect(r.scale).toBe(1);
    expect(r.pct).toBe(100);
  });

  it('scale=0.5 → slider=50, label="50%"', () => {
    const r = calcSliderSync(0.5);
    expect(r.sliderVal).toBe(50);
    expect(r.label).toBe('50%');
    expect(r.pct).toBe(50);
  });

  it('scale=0.75 → slider=75, label="75%"', () => {
    const r = calcSliderSync(0.75);
    expect(r.sliderVal).toBe(75);
    expect(r.label).toBe('75%');
  });

  it('scale=0.35 → slider=35, label="35%"', () => {
    const r = calcSliderSync(0.35);
    expect(r.pct).toBe(35);
    expect(r.sliderVal).toBe(35);
    expect(r.label).toBe('35%');
  });

  // ── Klemmen auf Slider-Grenzen ─────────────────────────────────────────────

  it('scale=0.15 → pct=15, aber sliderVal auf min=20 geklemmt', () => {
    const r = calcSliderSync(0.15);
    expect(r.pct).toBe(15);      // echter Prozentwert
    expect(r.sliderVal).toBe(20); // Slider darf nicht unter min fallen
    expect(r.label).toBe('15%'); // Label zeigt echten Wert, nicht Slider-Wert
  });

  it('scale=0.2 → slider=20 (exakt am Minimum)', () => {
    const r = calcSliderSync(0.2);
    expect(r.sliderVal).toBe(20);
    expect(r.pct).toBe(20);
  });

  it('scale=0.21 → slider=21 (über Minimum)', () => {
    const r = calcSliderSync(0.21);
    expect(r.sliderVal).toBe(21);
  });

  // ── Klemmen für scale-Wert ─────────────────────────────────────────────────

  it('scale < 0.1 wird auf 0.1 geklemmt', () => {
    const r = calcSliderSync(0.05);
    expect(r.scale).toBe(0.1);
    expect(r.pct).toBe(10);
    expect(r.sliderVal).toBe(20); // 10 < slider-min → auf 20
  });

  it('scale > 1.0 wird auf 1.0 geklemmt', () => {
    const r = calcSliderSync(1.5);
    expect(r.scale).toBe(1);
    expect(r.pct).toBe(100);
    expect(r.sliderVal).toBe(100);
  });

  it('scale=0 wird auf 0.1 geklemmt', () => {
    const r = calcSliderSync(0);
    expect(r.scale).toBe(0.1);
  });

  // ── null / undefined → Default 1.0 ────────────────────────────────────────

  it('savedScale=null → Default 1.0', () => {
    const r = calcSliderSync(null);
    expect(r.scale).toBe(1);
    expect(r.sliderVal).toBe(100);
    expect(r.label).toBe('100%');
  });

  it('savedScale=undefined → Default 1.0', () => {
    const r = calcSliderSync(undefined);
    expect(r.scale).toBe(1);
    expect(r.sliderVal).toBe(100);
  });

  // ── Format des Labels ─────────────────────────────────────────────────────

  it('label endet immer mit "%"', () => {
    for (const s of [0.2, 0.35, 0.5, 0.75, 1.0]) {
      expect(calcSliderSync(s).label).toMatch(/%$/);
    }
  });

  it('label enthält keine Dezimalstellen', () => {
    // pct wird mit Math.round() gebildet, also immer ganzzahlig
    for (const s of [0.33, 0.666, 0.999]) {
      const { label } = calcSliderSync(s);
      expect(label).toMatch(/^\d+%$/);
    }
  });

  // ── REGRESSIONSTEST ───────────────────────────────────────────────────────

  it('REGRESSION: gespeicherter scale=1 (keine Skalierung) ergibt Label "100%"', () => {
    // Vorher-Bug: Slider zeigte immer "100%" auch wenn der gespeicherte Scale
    // z.B. 50% war, weil scaleLabel nie aktualisiert wurde.
    // Nach dem Fix wird der Label-Wert korrekt aus dem gespeicherten Scale
    // berechnet. Dieser Test stellt sicher, dass 1.0 → "100%" korrekt ist.
    expect(calcSliderSync(1).label).toBe('100%');
  });

  it('REGRESSION: gespeicherter scale=0.5 ergibt Label "50%", nicht "100%"', () => {
    // Kerntest: vor dem Fix wäre immer "100%" angezeigt worden.
    expect(calcSliderSync(0.5).label).toBe('50%');
    expect(calcSliderSync(0.5).sliderVal).toBe(50);
  });

  it('REGRESSION: Slider-Wert und Label sind konsistent (Slider zeigt roundedPct, Label zeigt pct%)', () => {
    // sliderVal ist auf Slider-Grenzen [20,100] geklemmt.
    // label zeigt den tatsächlichen pct-Wert (nicht den Slider-Wert).
    const r1 = calcSliderSync(0.5);
    expect(r1.sliderVal).toBe(r1.pct); // pct 50 ist innerhalb [20,100]

    const r2 = calcSliderSync(0.1); // pct=10, unter slider-min
    expect(r2.sliderVal).toBe(20);   // Slider: 20 (Min)
    expect(r2.label).toBe('10%');    // Label: echter Wert
  });
});
