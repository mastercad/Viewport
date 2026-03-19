import { state, ctx, dom } from './state.js';
import { cloneAnn, normRect } from './geometry.js';
import { mkRng, drawMagnifier } from './draw.js';
import { cropHandleAt, applyCropHandle, hitTestAll, handleAt, applyHandle, applyMove } from './hittest.js';
import { renderCropOverlay, renderHandles, redrawAll, drawAnnotation } from './render.js';
import { pushUndo } from './history.js';

export function buildAnnotation(x1, y1, x2, y2, preview) {
  const id   = preview ? 0 : state.nextId++;
  const seed = (preview ? state.nextId : id) * 7919 + 1337 & 0x7fffffff || 1;
  if (state.tool === 'arrow' && Math.hypot(x2 - x1, y2 - y1) >= 6) {
    return { id, seed, type: 'arrow', x1, y1, x2, y2, color: state.color, size: state.sizeMul };
  }
  if (state.tool === 'circle') {
    const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
    if (rx >= 5 && ry >= 5)
      return { id, seed, type: 'circle', cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, rx, ry, color: state.color, size: state.sizeMul };
  }
  if (state.tool === 'magnifier') {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const radius = dist >= 20 ? dist : state.magRadius;
    state.magRadius = radius;
    return { id, seed, type: 'magnifier', cx: x1, cy: y1, radius, zoom: state.magZoom, color: state.color, size: state.sizeMul };
  }
  return null;
}

export function cvPos(e) {
  const r = dom.drawCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (dom.drawCanvas.width  / r.width),
    y: (e.clientY - r.top)  * (dom.drawCanvas.height / r.height),
  };
}

export function onDown(e) {
  if (e.button !== 0) return;
  const { x, y } = cvPos(e);
  state.dragStart = { x, y };

  if (state.tool === 'crop') {
    if (state.cropRect) {
      const h = cropHandleAt(x, y);
      if (h) {
        state.activeCropHandle = h.id;
        state.dragMode = 'crop-handle';
        dom.drawCanvas.style.cursor = h.cursor;
        return;
      }
    }
    state.cropRect = { x1: x, y1: y, x2: x, y2: y };
    state.dragMode = 'crop';
    return;
  }

  if (state.tool === 'select') {
    const h = handleAt(x, y);
    if (h) {
      const ann = state.annotations.find(a => a.id === state.selectedId);
      if (!ann) return;
      pushUndo();
      state.originAnn    = cloneAnn(ann);
      state.activeHandle = h.id;
      state.dragMode     = (h.id === 'center') ? 'move' : 'handle';
      dom.drawCanvas.style.cursor = h.cursor;
      return;
    }
    const hit = hitTestAll(x, y);
    if (hit) {
      state.selectedId   = hit.id;
      pushUndo();
      state.originAnn    = cloneAnn(hit);
      state.activeHandle = null;
      state.dragMode     = 'move';
      dom.drawCanvas.style.cursor = 'grabbing';
      renderHandles();
    } else {
      state.selectedId = null;
      state.dragMode   = null;
      renderHandles();
    }
    return;
  }

  pushUndo();
  state.dragMode = 'create';
}

export function onMove(e) {
  const { x, y } = cvPos(e);
  state.lastDrawPos = { x, y };

  if (state.dragMode === 'move') {
    const ann = state.annotations.find(a => a.id === state.selectedId);
    if (!ann || !state.originAnn) return;
    applyMove(ann, state.originAnn, x - state.dragStart.x, y - state.dragStart.y);
    redrawAll();
    return;
  }

  if (state.dragMode === 'handle') {
    const ann = state.annotations.find(a => a.id === state.selectedId);
    if (!ann) return;
    if (state.activeHandle === 'center') {
      applyMove(ann, state.originAnn, x - state.dragStart.x, y - state.dragStart.y);
    } else {
      applyHandle(ann, state.activeHandle, x, y);
    }
    redrawAll();
    return;
  }

  if (state.dragMode === 'crop' || state.dragMode === 'crop-handle') {
    return; // wird vollständig durch document-mousemove-Listener behandelt
  }

  if (state.dragMode === 'create') {
    ctx.prev.clearRect(0, 0, dom.prevCanvas.width, dom.prevCanvas.height);
    renderCropOverlay();
    const preview = buildAnnotation(state.dragStart.x, state.dragStart.y, x, y, true);
    if (preview) drawAnnotation(ctx.prev, preview);
    return;
  }

  if (state.tool === 'select') {
    const h = handleAt(x, y);
    if (h) { dom.drawCanvas.style.cursor = h.cursor; }
    else if (hitTestAll(x, y)) { dom.drawCanvas.style.cursor = 'grab'; }
    else { dom.drawCanvas.style.cursor = 'default'; }
  }
  if (state.tool === 'crop' && state.cropRect) {
    const h = cropHandleAt(x, y);
    dom.drawCanvas.style.cursor = h ? h.cursor : 'crosshair';
  }
  if (state.tool === 'magnifier') {
    ctx.prev.clearRect(0, 0, dom.prevCanvas.width, dom.prevCanvas.height);
    const seed = (state.nextId * 7919 + 1337) & 0x7fffffff || 1;
    drawMagnifier(ctx.prev, dom.bgCanvas, x, y, state.magRadius, state.magZoom, state.color, state.sizeMul, mkRng(seed));
  }
}

export function onUp(e) {
  if (state.dragMode === 'move' || state.dragMode === 'handle') {
    state.dragMode     = null;
    state.activeHandle = null;
    state.originAnn    = null;
    dom.drawCanvas.style.cursor = state.tool === 'select' ? 'default' : 'crosshair';
    return;
  }

  if (state.dragMode === 'crop-handle') {
    state.dragMode         = null;
    state.activeCropHandle = null;
    if (state.cropRect) state.cropRect = normRect(state.cropRect);
    dom.drawCanvas.style.cursor = 'crosshair';
    renderHandles();
    return;
  }

  if (state.dragMode === 'crop') {
    state.dragMode = null;
    const nr = normRect(state.cropRect);
    if (nr.x2 - nr.x1 < 8 || nr.y2 - nr.y1 < 8) {
      state.cropRect = null;
      dom.cropResetBtn?.classList.add('hidden');
      dom.cropSaveBtn?.classList.add('hidden');
      if (dom.hintEl) dom.hintEl.textContent = 'Ausschnitt: Bereich ziehen → beim Speichern wird nur dieser Bereich exportiert';
    } else {
      state.cropRect = nr;
      dom.cropResetBtn?.classList.remove('hidden');
      dom.cropSaveBtn?.classList.remove('hidden');
      if (dom.hintEl) dom.hintEl.textContent = `Ausschnitt aktiv (${Math.round(nr.x2 - nr.x1)} × ${Math.round(nr.y2 - nr.y1)} px) · ↓ Ausschnitt speichern oder neu ziehen`;
    }
    renderHandles();
    return;
  }

  if (state.dragMode !== 'create') return;
  state.dragMode = null;
  ctx.prev.clearRect(0, 0, dom.prevCanvas.width, dom.prevCanvas.height);

  const { x, y } = cvPos(e);
  const ann = buildAnnotation(state.dragStart.x, state.dragStart.y, x, y, false);
  if (ann) {
    state.annotations.push(ann);
    // Lupe nicht auto-selektieren – sonst würde Slider/Shift+Scroll sofort
    // deren Radius verändern, statt nur den Preview-Radius für die nächste.
    state.selectedId = ann.type === 'magnifier' ? null : ann.id;
    redrawAll();
  } else {
    // Zu kurze Geste: Undo-Eintrag wieder verwerfen
    state.undoStack.pop();
  }
}

export function onLeave() {
  if (state.dragMode === 'create') {
    ctx.prev.clearRect(0, 0, dom.prevCanvas.width, dom.prevCanvas.height);
    renderCropOverlay();
    state.dragMode = null;
    state.undoStack.pop();
  }
  // 'crop': nicht abbrechen – letzter geklemmter Stand bleibt, mouseup landet auf document
  if (state.tool === 'magnifier' && state.dragMode !== 'crop') {
    ctx.prev?.clearRect(0, 0, dom.prevCanvas.width, dom.prevCanvas.height);
    renderCropOverlay();
    if (state.selectedId !== null) renderHandles();
  }
}
