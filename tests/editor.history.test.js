// @vitest-environment happy-dom
/**
 * Tests für editor/history.js
 *
 * Deckt ab:
 *  - pushUndo: Snapshot wird auf undoStack gelegt; Stack ist auf 60 begrenzt
 *  - undoStep: stellt Annotations-Zustand wieder her; leerer Stack → no-op
 *  - clearAll: leert Annotations nach Undo-Snapshot
 *  - deleteSelected: löscht ausgewählte Annotation; no-op ohne Selektion
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// render.js benötigt Canvas → mocken
vi.mock('../src/renderer/editor/render.js', () => ({
  redrawAll:         vi.fn(),
  renderHandles:     vi.fn(),
  renderCropOverlay: vi.fn(),
  drawAnnotation:    vi.fn(),
}));

import { state }                                      from '../src/renderer/editor/state.js';
import { pushUndo, undoStep, clearAll, deleteSelected } from '../src/renderer/editor/history.js';

function resetState() {
  state.annotations = [];
  state.undoStack   = [];
  state.selectedId  = null;
}

beforeEach(resetState);

// ── pushUndo ──────────────────────────────────────────────────────────────────

describe('pushUndo', () => {
  it('legt einen Snapshot der aktuellen Annotations auf den Stack', () => {
    state.annotations = [{ id: 1, type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10 }];
    pushUndo();
    expect(state.undoStack).toHaveLength(1);
    expect(state.undoStack[0]).toHaveLength(1);
    expect(state.undoStack[0][0].id).toBe(1);
  });

  it('der Snapshot ist eine tiefe Kopie – spätere Mutationen ändern ihn nicht', () => {
    state.annotations = [{ id: 1, type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10 }];
    pushUndo();
    state.annotations[0].x1 = 999;     // mutiere Original
    expect(state.undoStack[0][0].x1).toBe(0); // Snapshot unverändert
  });

  it('mehrere Snapshots werden gestapelt', () => {
    state.annotations = [{ id: 1, type: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1 }];
    pushUndo();
    state.annotations = [{ id: 2, type: 'circle', cx: 5, cy: 5, rx: 3, ry: 3 }];
    pushUndo();
    expect(state.undoStack).toHaveLength(2);
  });

  it('Stack ist auf 60 Einträge begrenzt', () => {
    for (let i = 0; i < 65; i++) {
      state.annotations = [{ id: i, type: 'arrow', x1: i, y1: 0, x2: i + 1, y2: 0 }];
      pushUndo();
    }
    expect(state.undoStack.length).toBeLessThanOrEqual(60);
  });

  it('Stack ist auf genau 60 Einträge begrenzt (älteste werden verworfen)', () => {
    for (let i = 0; i < 65; i++) {
      state.annotations = [{ id: i, type: 'arrow', x1: i, y1: 0, x2: i + 1, y2: 0 }];
      pushUndo();
    }
    expect(state.undoStack).toHaveLength(60);
    // Ältester Snapshot (id=5 war der 6te push, da 0–4 verschoben wurden)
    expect(state.undoStack[0][0].x1).toBe(5);
  });

  it('Snapshot bei leerer Annotations-Liste ist ein leeres Array', () => {
    state.annotations = [];
    pushUndo();
    expect(state.undoStack[0]).toEqual([]);
  });
});

// ── undoStep ──────────────────────────────────────────────────────────────────

describe('undoStep', () => {
  it('no-op bei leerem Stack', () => {
    state.annotations = [{ id: 1, type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10 }];
    undoStep();
    expect(state.annotations).toHaveLength(1); // unverändert
  });

  it('stellt vorherigen Annotation-Zustand wieder her', () => {
    state.annotations = [{ id: 1, type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10 }];
    pushUndo();
    state.annotations = [
      { id: 1, type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10 },
      { id: 2, type: 'circle', cx: 5, cy: 5, rx: 3, ry: 3 },
    ];
    undoStep();
    expect(state.annotations).toHaveLength(1);
    expect(state.annotations[0].id).toBe(1);
  });

  it('entfernt den Snapshot vom Stack', () => {
    pushUndo();
    undoStep();
    expect(state.undoStack).toHaveLength(0);
  });

  it('setzt selectedId auf null', () => {
    state.annotations = [{ id: 1, type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10 }];
    pushUndo();
    state.selectedId = 1;
    undoStep();
    expect(state.selectedId).toBeNull();
  });

  it('mehrfaches Undo geht durch alle Snapshots', () => {
    // Step 0: leer
    pushUndo();
    state.annotations = [{ id: 1, type: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1 }];
    // Step 1: 1 Annotation
    pushUndo();
    state.annotations = [
      { id: 1, type: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1 },
      { id: 2, type: 'circle', cx: 5, cy: 5, rx: 3, ry: 3 },
    ];
    undoStep(); // zurück auf 1 Annotation
    expect(state.annotations).toHaveLength(1);
    undoStep(); // zurück auf 0 Annotations
    expect(state.annotations).toHaveLength(0);
  });
});

// ── clearAll ──────────────────────────────────────────────────────────────────

describe('clearAll', () => {
  it('leert die Annotations-Liste', () => {
    state.annotations = [
      { id: 1, type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10 },
      { id: 2, type: 'circle', cx: 5, cy: 5, rx: 3, ry: 3 },
    ];
    clearAll();
    expect(state.annotations).toHaveLength(0);
  });

  it('legt vorher einen Undo-Snapshot an', () => {
    state.annotations = [{ id: 1, type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10 }];
    clearAll();
    expect(state.undoStack).toHaveLength(1);
    expect(state.undoStack[0]).toHaveLength(1); // der Snapshot enthält die gelöschte Annotation
  });

  it('Undo nach clearAll stellt alle Annotations wieder her', () => {
    state.annotations = [{ id: 1, type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10 }];
    clearAll();
    undoStep();
    expect(state.annotations).toHaveLength(1);
  });

  it('setzt selectedId auf null', () => {
    state.annotations = [{ id: 1, type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10 }];
    state.selectedId = 1;
    clearAll();
    expect(state.selectedId).toBeNull();
  });

  it('no-op auf bereits leerer Liste (kein Fehler)', () => {
    state.annotations = [];
    expect(() => clearAll()).not.toThrow();
    expect(state.annotations).toHaveLength(0);
  });
});

// ── deleteSelected ────────────────────────────────────────────────────────────

describe('deleteSelected', () => {
  it('no-op wenn keine Selektion', () => {
    state.annotations = [{ id: 1, type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10 }];
    state.selectedId  = null;
    deleteSelected();
    expect(state.annotations).toHaveLength(1);
    expect(state.undoStack).toHaveLength(0); // kein Undo-Snapshot erzeugt
  });

  it('löscht die ausgewählte Annotation', () => {
    state.annotations = [
      { id: 1, type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10 },
      { id: 2, type: 'circle', cx: 5, cy: 5, rx: 3, ry: 3 },
    ];
    state.selectedId = 1;
    deleteSelected();
    expect(state.annotations).toHaveLength(1);
    expect(state.annotations[0].id).toBe(2);
  });

  it('legt einen Undo-Snapshot vor dem Löschen an', () => {
    state.annotations = [{ id: 1, type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10 }];
    state.selectedId  = 1;
    deleteSelected();
    expect(state.undoStack).toHaveLength(1);
  });

  it('Undo nach deleteSelected stellt die Annotation wieder her', () => {
    state.annotations = [{ id: 1, type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10 }];
    state.selectedId  = 1;
    deleteSelected();
    undoStep();
    expect(state.annotations).toHaveLength(1);
    expect(state.annotations[0].id).toBe(1);
  });

  it('setzt selectedId auf null nach dem Löschen', () => {
    state.annotations = [{ id: 1, type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10 }];
    state.selectedId  = 1;
    deleteSelected();
    expect(state.selectedId).toBeNull();
  });
});
