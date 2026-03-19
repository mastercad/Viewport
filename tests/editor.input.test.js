// @vitest-environment happy-dom
/**
 * Tests für editor/input.js → buildAnnotation
 *
 * Deckt ab:
 *  - arrow: ausreichende Länge ≥ 6 → Annotation; zu kurz → null
 *  - circle: rx ≥ 5 UND ry ≥ 5 → Annotation; zu klein → null
 *  - magnifier: Zug ≥ 20 → radius = dist; Zug < 20 → radius = state.magRadius
 *  - preview=true → id=0, nextId unverändt; preview=false → id=nextId, inkrementiert
 *  - unbekanntes Tool → null
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// render.js benötigt Canvas → mocken
vi.mock('../src/renderer/editor/render.js', () => ({
  redrawAll:         vi.fn(),
  renderHandles:     vi.fn(),
  renderCropOverlay: vi.fn(),
  drawAnnotation:    vi.fn(),
}));

// draw.js zeichnet auf Canvas → mocken
vi.mock('../src/renderer/editor/draw.js', () => ({
  mkRng:           vi.fn(() => () => 0.5),
  drawMagnifier:   vi.fn(),
  drawMarkerArrow: vi.fn(),
  drawMarkerCircle: vi.fn(),
  drawCursorIcon:  vi.fn(),
}));

import { state }              from '../src/renderer/editor/state.js';
import { buildAnnotation }    from '../src/renderer/editor/input.js';

function resetState() {
  state.tool       = 'arrow';
  state.color      = '#FF3B30';
  state.sizeMul    = 1;
  state.magZoom    = 2.5;
  state.magRadius  = 100;
  state.annotations  = [];
  state.nextId       = 1;
  state.undoStack    = [];
  state.selectedId   = null;
  state.cropRect     = null;
  state.dragMode     = null;
  state.activeHandle = null;
  state.dragStart    = { x: 0, y: 0 };
}

beforeEach(resetState);

// ── arrow ──────────────────────────────────────────────────────────────────────

describe('buildAnnotation – arrow', () => {
  it('gibt ein arrow-Objekt zurück wenn Länge ≥ 6', () => {
    state.tool = 'arrow';
    const ann = buildAnnotation(0, 0, 10, 0, false);
    expect(ann).not.toBeNull();
    expect(ann.type).toBe('arrow');
  });

  it('enthält korrekte Start-/Endkoordinaten', () => {
    state.tool = 'arrow';
    const ann = buildAnnotation(5, 10, 20, 30, false);
    expect(ann).toMatchObject({ x1: 5, y1: 10, x2: 20, y2: 30 });
  });

  it('enthält color und size aus state', () => {
    state.tool    = 'arrow';
    state.color   = '#00FF00';
    state.sizeMul = 2;
    const ann = buildAnnotation(0, 0, 10, 0, false);
    expect(ann).toMatchObject({ color: '#00FF00', size: 2 });
  });

  it('gibt null zurück wenn Länge < 6', () => {
    state.tool = 'arrow';
    const ann = buildAnnotation(0, 0, 2, 2, false); // hypot≈2.83 < 6
    expect(ann).toBeNull();
  });

  it('gibt null zurück bei Länge exakt 0', () => {
    state.tool = 'arrow';
    expect(buildAnnotation(5, 5, 5, 5, false)).toBeNull();
  });

  it('gibt kein null zurück bei Länge exakt 6', () => {
    state.tool = 'arrow';
    // horizontaler Vektor der Länge 6
    expect(buildAnnotation(0, 0, 6, 0, false)).not.toBeNull();
  });
});

// ── circle ──────────────────────────────────────────────────────────────────────

describe('buildAnnotation – circle', () => {
  it('gibt ein circle-Objekt zurück wenn rx ≥ 5 und ry ≥ 5', () => {
    state.tool = 'circle';
    const ann = buildAnnotation(0, 0, 20, 14, false); // rx=10, ry=7
    expect(ann).not.toBeNull();
    expect(ann.type).toBe('circle');
  });

  it('Mittelpunkt ist korrekt berechnet', () => {
    state.tool = 'circle';
    const ann = buildAnnotation(0, 0, 20, 10, false); // cx=10, cy=5
    expect(ann).toMatchObject({ cx: 10, cy: 5, rx: 10, ry: 5 });
  });

  it('gibt null zurück wenn rx < 5', () => {
    state.tool = 'circle';
    const ann = buildAnnotation(0, 0, 6, 20, false); // rx=3 < 5
    expect(ann).toBeNull();
  });

  it('gibt null zurück wenn ry < 5', () => {
    state.tool = 'circle';
    const ann = buildAnnotation(0, 0, 20, 6, false); // ry=3 < 5
    expect(ann).toBeNull();
  });

  it('gibt null zurück wenn beide Radien zu klein', () => {
    state.tool = 'circle';
    const ann = buildAnnotation(0, 0, 4, 4, false); // rx=ry=2
    expect(ann).toBeNull();
  });

  it('enthält color und size aus state', () => {
    state.tool    = 'circle';
    state.color   = '#0000FF';
    state.sizeMul = 3;
    const ann = buildAnnotation(0, 0, 20, 14, false);
    expect(ann).toMatchObject({ color: '#0000FF', size: 3 });
  });
});

// ── magnifier ──────────────────────────────────────────────────────────────────

describe('buildAnnotation – magnifier', () => {
  it('gibt ein magnifier-Objekt zurück', () => {
    state.tool = 'magnifier';
    const ann = buildAnnotation(50, 50, 90, 80, false); // dist=50
    expect(ann).not.toBeNull();
    expect(ann.type).toBe('magnifier');
  });

  it('Mittelpunkt ist am Startpunkt (x1, y1)', () => {
    state.tool = 'magnifier';
    const ann = buildAnnotation(50, 50, 90, 80, false);
    expect(ann).toMatchObject({ cx: 50, cy: 50 });
  });

  it('Radius = Zug-Distanz wenn dist ≥ 20', () => {
    state.tool      = 'magnifier';
    state.magRadius = 100;
    const dist = Math.hypot(40, 30); // 50
    const ann  = buildAnnotation(0, 0, 40, 30, false);
    expect(ann.radius).toBeCloseTo(dist);
  });

  it('Radius = state.magRadius wenn dist < 20', () => {
    state.tool      = 'magnifier';
    state.magRadius = 80;
    const ann = buildAnnotation(0, 0, 5, 5, false); // dist≈7.07 < 20
    expect(ann.radius).toBe(80);
  });

  it('aktualisiert state.magRadius auch wenn dist < 20', () => {
    state.tool      = 'magnifier';
    state.magRadius = 80;
    buildAnnotation(0, 0, 5, 5, false); // dist < 20 → radius = 80
    expect(state.magRadius).toBe(80); // bleibt erhalten (wird neu zugewiesen)
  });

  it('aktualisiert state.magRadius wenn dist ≥ 20', () => {
    state.tool      = 'magnifier';
    state.magRadius = 100;
    buildAnnotation(0, 0, 40, 30, false); // dist = 50
    expect(state.magRadius).toBeCloseTo(50);
  });

  it('enthält zoom aus state', () => {
    state.tool    = 'magnifier';
    state.magZoom = 3.0;
    const ann = buildAnnotation(0, 0, 40, 30, false);
    expect(ann.zoom).toBe(3.0);
  });
});

// ── preview / id / nextId ──────────────────────────────────────────────────────

describe('buildAnnotation – preview & id', () => {
  it('preview=false → id = state.nextId vor dem Aufruf', () => {
    state.tool   = 'arrow';
    state.nextId = 5;
    const ann = buildAnnotation(0, 0, 10, 0, false);
    expect(ann.id).toBe(5);
  });

  it('preview=false → state.nextId wird inkrementiert', () => {
    state.tool   = 'arrow';
    state.nextId = 5;
    buildAnnotation(0, 0, 10, 0, false);
    expect(state.nextId).toBe(6);
  });

  it('preview=true → id = 0', () => {
    state.tool = 'arrow';
    const ann  = buildAnnotation(0, 0, 10, 0, true);
    expect(ann.id).toBe(0);
  });

  it('preview=true → state.nextId bleibt unverändert', () => {
    state.tool   = 'arrow';
    state.nextId = 7;
    buildAnnotation(0, 0, 10, 0, true);
    expect(state.nextId).toBe(7);
  });

  it('mehrere preview=false Aufrufe erhöhen nextId jeweils um 1', () => {
    state.tool   = 'arrow';
    state.nextId = 1;
    const a = buildAnnotation(0, 0, 10, 0, false);
    const b = buildAnnotation(0, 0, 10, 0, false);
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
    expect(state.nextId).toBe(3);
  });
});

// ── unbekanntes Tool ──────────────────────────────────────────────────────────

describe('buildAnnotation – unbekanntes Tool', () => {
  it('gibt null zurück wenn tool nicht bekannt ist', () => {
    state.tool = 'laser'; // existiert nicht
    expect(buildAnnotation(0, 0, 50, 50, false)).toBeNull();
  });
});
