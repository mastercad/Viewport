export const HANDLE_R   = 7;
export const HANDLE_HIT = 14;
export const HIT_THR    = 18;

export const dom = {
  overlay:      document.getElementById('annotate-overlay'),
  bgCanvas:     document.getElementById('annotate-bg'),
  drawCanvas:   document.getElementById('annotate-draw'),
  prevCanvas:   document.getElementById('annotate-preview'),
  stack:        document.getElementById('annotate-stack'),
  annotateBtn:  document.getElementById('annotate-btn'),
  undoBtn:      document.getElementById('annotate-undo'),
  clearBtn:     document.getElementById('annotate-clear-btn'),
  deleteBtn:    document.getElementById('annotate-delete'),
  saveBtn:      document.getElementById('annotate-save'),
  closeBtn:     document.getElementById('annotate-close-btn'),
  hintEl:       document.getElementById('annotate-hint'),
  toolBtns:     document.querySelectorAll('#annotate-tools [data-tool]'),
  colorBtns:    document.querySelectorAll('#annotate-colors [data-color]'),
  sizeSlider:   document.getElementById('annotate-size'),
  zoomSlider:   document.getElementById('annotate-zoom'),
  cropResetBtn: document.getElementById('annotate-crop-reset'),
  cropSaveBtn:  document.getElementById('annotate-crop-save-btn'),
  cursorCb:     document.getElementById('annotate-cursor-cb'),
};

export const ctx = { bg: null, draw: null, prev: null };

export const state = {
  tool:             'arrow',
  color:            '#FF3B30',
  sizeMul:          1,
  magZoom:          2.5,
  magRadius:        100,
  annotations:      [],
  nextId:           1,
  undoStack:        [],
  selectedId:       null,
  cropRect:         null,
  lastCursorPos:    null,
  lastDrawPos:      { x: 0, y: 0 },
  dragMode:         null,
  activeHandle:     null,
  activeCropHandle: null,
  dragStart:        { x: 0, y: 0 },
  originAnn:        null,
};
