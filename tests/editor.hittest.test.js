// @vitest-environment happy-dom
/**
 * Tests für editor/hittest.js
 *
 * Deckt ab:
 *  - getCropHandles: korrekte 8 Handles aus einem cropRect
 *  - cropHandleAt:   treffsicherer Klick auf Handle / daneben
 *  - applyCropHandle: mutiert cropRect für alle 8 Handle-IDs
 *  - hitTest:        Arrow, Circle, Magnifier – innerhalb / außerhalb
 *  - hitTestAll:     letztes Annotation gewinnt (Z-Reihenfolge)
 *  - getHandles:     korrekte Handle-Menge je Annotationstyp
 *  - handleAt:       kein Selection → null; Klick auf Handle → Treffer
 *  - applyHandle:    mutiert Annotation für alle Handle-IDs
 *  - applyMove:      verschiebt Arrow- und Circle/Magnifier-Koordinaten
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// render.js hat Canvas-Abhängigkeiten → mocken
vi.mock('../src/renderer/editor/render.js', () => ({
  redrawAll:         vi.fn(),
  renderHandles:     vi.fn(),
  renderCropOverlay: vi.fn(),
  drawAnnotation:    vi.fn(),
}));

import { state, HIT_THR } from '../src/renderer/editor/state.js';
import {
  getCropHandles, cropHandleAt, applyCropHandle,
  hitTest, hitTestAll,
  getHandles, handleAt, applyHandle, applyMove,
} from '../src/renderer/editor/hittest.js';

function resetState() {
  state.annotations      = [];
  state.cropRect         = null;
  state.selectedId       = null;
  state.activeCropHandle = null;
  state.activeHandle     = null;
  state.dragMode         = null;
}

beforeEach(resetState);

// ── getCropHandles ────────────────────────────────────────────────────────────

describe('getCropHandles', () => {
  it('gibt leeres Array zurück wenn kein cropRect gesetzt', () => {
    expect(getCropHandles()).toEqual([]);
  });

  it('gibt 8 Handles zurück wenn cropRect gesetzt', () => {
    state.cropRect = { x1: 10, y1: 20, x2: 110, y2: 120 };
    expect(getCropHandles()).toHaveLength(8);
  });

  it('Handle "tl" liegt an oben-links', () => {
    state.cropRect = { x1: 10, y1: 20, x2: 110, y2: 120 };
    const tl = getCropHandles().find(h => h.id === 'tl');
    expect(tl).toMatchObject({ x: 10, y: 20 });
  });

  it('Handle "br" liegt an unten-rechts', () => {
    state.cropRect = { x1: 10, y1: 20, x2: 110, y2: 120 };
    const br = getCropHandles().find(h => h.id === 'br');
    expect(br).toMatchObject({ x: 110, y: 120 });
  });

  it('Handle "t" liegt mittig oben', () => {
    state.cropRect = { x1: 0, y1: 0, x2: 100, y2: 80 };
    const t = getCropHandles().find(h => h.id === 't');
    expect(t).toMatchObject({ x: 50, y: 0 });
  });

  it('normiert invertierte cropRect-Koordinaten', () => {
    // x1 > x2 → wird von normRect normiert
    state.cropRect = { x1: 110, y1: 120, x2: 10, y2: 20 };
    const tl = getCropHandles().find(h => h.id === 'tl');
    expect(tl).toMatchObject({ x: 10, y: 20 });
  });
});

// ── cropHandleAt ──────────────────────────────────────────────────────────────

describe('cropHandleAt', () => {
  beforeEach(() => {
    state.cropRect = { x1: 0, y1: 0, x2: 100, y2: 100 };
  });

  it('gibt Handle zurück wenn Klick nah genug', () => {
    const h = cropHandleAt(0, 0); // tl
    expect(h).not.toBeNull();
    expect(h.id).toBe('tl');
  });

  it('gibt null zurück wenn kein Handle in der Nähe', () => {
    expect(cropHandleAt(50, 50)).toBeNull(); // Mitte des Rects, kein Handle
  });

  it('findet den "br"-Handle', () => {
    const h = cropHandleAt(100, 100);
    expect(h?.id).toBe('br');
  });

  it('gibt null zurück ohne cropRect', () => {
    state.cropRect = null;
    expect(cropHandleAt(0, 0)).toBeNull();
  });
});

// ── applyCropHandle ───────────────────────────────────────────────────────────

describe('applyCropHandle', () => {
  beforeEach(() => {
    state.cropRect = { x1: 10, y1: 10, x2: 90, y2: 90 };
  });

  const cases = [
    ['tl', 5, 5,  { x1: 5,  y1: 5,  x2: 90, y2: 90 }],
    ['tr', 95, 5, { x1: 10, y1: 5,  x2: 95, y2: 90 }],
    ['br', 95, 95,{ x1: 10, y1: 10, x2: 95, y2: 95 }],
    ['bl', 5, 95, { x1: 5,  y1: 10, x2: 90, y2: 95 }],
    ['t',  0, 3,  { x1: 10, y1: 3,  x2: 90, y2: 90 }],
    ['r',  95, 0, { x1: 10, y1: 10, x2: 95, y2: 90 }],
    ['b',  0, 95, { x1: 10, y1: 10, x2: 90, y2: 95 }],
    ['l',  3, 0,  { x1: 3,  y1: 10, x2: 90, y2: 90 }],
  ];

  for (const [id, mx, my, expected] of cases) {
    it(`Handle "${id}" setzt korrekte Koordinaten`, () => {
      applyCropHandle(id, mx, my);
      expect(state.cropRect).toMatchObject(expected);
    });
  }
});

// ── hitTest ───────────────────────────────────────────────────────────────────

describe('hitTest – arrow', () => {
  const arrow = { type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 0 };

  it('Punkt auf dem Pfeilsegment → true', () => {
    expect(hitTest(arrow, 50, 0)).toBe(true);
  });

  it('Punkt sehr nah am Segment (< HIT_THR) → true', () => {
    expect(hitTest(arrow, 50, HIT_THR - 1)).toBe(true);
  });

  it('Punkt weit weg vom Segment → false', () => {
    expect(hitTest(arrow, 50, HIT_THR + 5)).toBe(false);
  });
});

describe('hitTest – circle', () => {
  const circle = { type: 'circle', cx: 50, cy: 50, rx: 40, ry: 30 };

  it('Punkt im Ellipsen-Innern → true', () => {
    expect(hitTest(circle, 50, 50)).toBe(true); // Mittelpunkt
  });

  it('Punkt nah am Rand (innerhalb 1.28× Faktor) → true', () => {
    expect(hitTest(circle, 50 + 40, 50)).toBe(true); // genau auf dem Rand
  });

  it('Punkt deutlich außerhalb der Ellipse → false', () => {
    expect(hitTest(circle, 200, 200)).toBe(false);
  });
});

describe('hitTest – magnifier', () => {
  const mag = { type: 'magnifier', cx: 50, cy: 50, radius: 30 };

  it('Punkt innerhalb radius+12 → true', () => {
    expect(hitTest(mag, 50, 50)).toBe(true); // Mitte
  });

  it('Punkt genau at radius + 11 → true', () => {
    expect(hitTest(mag, 50, 50 + 30 + 11)).toBe(true);
  });

  it('Punkt außerhalb radius+12 → false', () => {
    expect(hitTest(mag, 50, 50 + 30 + 13)).toBe(false);
  });
});

// ── hitTestAll ────────────────────────────────────────────────────────────────

describe('hitTestAll', () => {
  it('gibt null zurück bei leerer Annotation-Liste', () => {
    expect(hitTestAll(50, 50)).toBeNull();
  });

  it('gibt die letzte (oberste) Annotation bei Überlappung zurück', () => {
    state.annotations = [
      { id: 1, type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 0 },
      { id: 2, type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 0 }, // selbe Position, Z-top
    ];
    const hit = hitTestAll(50, 0);
    expect(hit?.id).toBe(2);
  });

  it('gibt null zurück wenn kein Treffer', () => {
    state.annotations = [{ id: 1, type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 0 }];
    expect(hitTestAll(500, 500)).toBeNull();
  });

  it('gibt die erste getroffene Annotation zurück wenn keine Überlappung', () => {
    state.annotations = [
      { id: 1, type: 'magnifier', cx: 50, cy: 50, radius: 30 },
      { id: 2, type: 'magnifier', cx: 200, cy: 200, radius: 30 },
    ];
    expect(hitTestAll(50, 50)?.id).toBe(1);
  });
});

// ── getHandles ────────────────────────────────────────────────────────────────

describe('getHandles', () => {
  it('Arrow: 2 Handles (tail + head)', () => {
    const handles = getHandles({ type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 100 });
    expect(handles).toHaveLength(2);
    expect(handles.map(h => h.id)).toEqual(['tail', 'head']);
  });

  it('Arrow: tail-Handle liegt an x1/y1', () => {
    const handles = getHandles({ type: 'arrow', x1: 10, y1: 20, x2: 80, y2: 90 });
    expect(handles.find(h => h.id === 'tail')).toMatchObject({ x: 10, y: 20 });
  });

  it('Circle: 5 Handles (center + 4 Kanten)', () => {
    const handles = getHandles({ type: 'circle', cx: 50, cy: 50, rx: 30, ry: 20 });
    expect(handles).toHaveLength(5);
    expect(handles.map(h => h.id)).toContain('center');
    expect(handles.map(h => h.id)).toContain('e');
  });

  it('Circle: "e"-Handle liegt bei cx+rx', () => {
    const handles = getHandles({ type: 'circle', cx: 50, cy: 50, rx: 30, ry: 20 });
    expect(handles.find(h => h.id === 'e')).toMatchObject({ x: 80, y: 50 });
  });

  it('Magnifier: 2 Handles (center + edge)', () => {
    const handles = getHandles({ type: 'magnifier', cx: 50, cy: 50, radius: 40 });
    expect(handles).toHaveLength(2);
    expect(handles.map(h => h.id)).toContain('center');
    expect(handles.map(h => h.id)).toContain('edge');
  });

  it('Magnifier: "edge"-Handle liegt bei cx+radius', () => {
    const handles = getHandles({ type: 'magnifier', cx: 50, cy: 50, radius: 40 });
    expect(handles.find(h => h.id === 'edge')).toMatchObject({ x: 90, y: 50 });
  });

  it('unbekannter Typ → leeres Array', () => {
    expect(getHandles({ type: 'unknown' })).toEqual([]);
  });
});

// ── handleAt ─────────────────────────────────────────────────────────────────

describe('handleAt', () => {
  it('gibt null zurück wenn selectedId null', () => {
    state.selectedId = null;
    state.annotations = [{ id: 1, type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 0 }];
    expect(handleAt(0, 0)).toBeNull();
  });

  it('gibt null zurück wenn selectedId nicht in Annotations', () => {
    state.selectedId = 99;
    state.annotations = [];
    expect(handleAt(0, 0)).toBeNull();
  });

  it('gibt Handle zurück bei Klick auf tail-Position', () => {
    state.selectedId  = 1;
    state.annotations = [{ id: 1, type: 'arrow', x1: 50, y1: 50, x2: 200, y2: 200 }];
    const h = handleAt(50, 50);
    expect(h?.id).toBe('tail');
  });

  it('gibt null zurück wenn Klick weit weg von Handle', () => {
    state.selectedId  = 1;
    state.annotations = [{ id: 1, type: 'arrow', x1: 50, y1: 50, x2: 200, y2: 200 }];
    expect(handleAt(500, 500)).toBeNull();
  });
});

// ── applyHandle ───────────────────────────────────────────────────────────────

describe('applyHandle', () => {
  it('Arrow "head" → aktualisiert x2/y2', () => {
    const ann = { type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 100 };
    applyHandle(ann, 'head', 200, 300);
    expect(ann.x2).toBe(200);
    expect(ann.y2).toBe(300);
  });

  it('Arrow "tail" → aktualisiert x1/y1', () => {
    const ann = { type: 'arrow', x1: 10, y1: 10, x2: 100, y2: 100 };
    applyHandle(ann, 'tail', 5, 5);
    expect(ann.x1).toBe(5);
    expect(ann.y1).toBe(5);
  });

  it('Circle "e" → aktualisiert rx, Minimum 5', () => {
    const ann = { type: 'circle', cx: 50, cy: 50, rx: 30, ry: 20 };
    applyHandle(ann, 'e', 90, 50);
    expect(ann.rx).toBe(40);
  });

  it('Circle "e" → Minimum 5 greift bei zu kleinem Wert', () => {
    const ann = { type: 'circle', cx: 50, cy: 50, rx: 30, ry: 20 };
    applyHandle(ann, 'e', 50, 50); // mx - cx = 0 < 5 → 5
    expect(ann.rx).toBe(5);
  });

  it('Circle "w" → aktualisiert rx via cx-mx', () => {
    const ann = { type: 'circle', cx: 50, cy: 50, rx: 30, ry: 20 };
    applyHandle(ann, 'w', 20, 50); // cx - mx = 30
    expect(ann.rx).toBe(30);
  });

  it('Circle "n" → aktualisiert ry', () => {
    const ann = { type: 'circle', cx: 50, cy: 50, rx: 30, ry: 20 };
    applyHandle(ann, 'n', 50, 25); // cy - my = 25
    expect(ann.ry).toBe(25);
  });

  it('Magnifier "edge" → radius = Abstand center→mouse, Minimum 15', () => {
    const ann = { type: 'magnifier', cx: 0, cy: 0, radius: 30 };
    applyHandle(ann, 'edge', 50, 0);
    expect(ann.radius).toBe(50);
  });

  it('Magnifier "edge" → Minimum 15 greift', () => {
    const ann = { type: 'magnifier', cx: 0, cy: 0, radius: 30 };
    applyHandle(ann, 'edge', 5, 0); // Abstand 5 < 15
    expect(ann.radius).toBe(15);
  });
});

// ── applyMove ─────────────────────────────────────────────────────────────────

describe('applyMove', () => {
  it('Arrow: verschiebt x1/y1/x2/y2 um dx/dy', () => {
    const ann    = { type: 'arrow', x1: 10, y1: 20, x2: 110, y2: 120 };
    const origin = { x1: 10, y1: 20, x2: 110, y2: 120 };
    applyMove(ann, origin, 5, -5);
    expect(ann).toMatchObject({ x1: 15, y1: 15, x2: 115, y2: 115 });
  });

  it('Circle: verschiebt cx/cy', () => {
    const ann    = { type: 'circle', cx: 50, cy: 50, rx: 30, ry: 20 };
    const origin = { cx: 50, cy: 50 };
    applyMove(ann, origin, -10, 20);
    expect(ann).toMatchObject({ cx: 40, cy: 70 });
  });

  it('Magnifier: verschiebt cx/cy', () => {
    const ann    = { type: 'magnifier', cx: 100, cy: 100, radius: 40 };
    const origin = { cx: 100, cy: 100 };
    applyMove(ann, origin, 30, -30);
    expect(ann).toMatchObject({ cx: 130, cy: 70 });
  });

  it('Bewegung um (0,0) lässt Annotation unverändert', () => {
    const ann    = { type: 'arrow', x1: 5, y1: 5, x2: 50, y2: 50 };
    const origin = { x1: 5, y1: 5, x2: 50, y2: 50 };
    applyMove(ann, origin, 0, 0);
    expect(ann).toMatchObject({ x1: 5, y1: 5, x2: 50, y2: 50 });
  });
});
