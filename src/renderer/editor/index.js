// Werkzeuge: select (S) · arrow (A) · circle (C) · magnifier (M)
// Shortcuts: S/A/C/M · Strg+Z · Esc · Entf

import { state, ctx, dom } from './state.js';
import { normRect } from './geometry.js';
import { drawCursorIcon, mkRng, drawMagnifier } from './draw.js';
import { applyCropHandle, cropHandleAt } from './hittest.js';
import { redrawAll, renderHandles, renderCropOverlay } from './render.js';
import { pushUndo, undoStep, clearAll, deleteSelected } from './history.js';
import { onDown, onMove, onUp, onLeave, buildAnnotation } from './input.js';

function setTool(name) {
  state.tool = name;
  dom.toolBtns.forEach(b => b.classList.toggle('at-tool-active', b.dataset.tool === name));
  const cursors = { select: 'default', arrow: 'crosshair', circle: 'crosshair', magnifier: 'zoom-in', crop: 'crosshair' };
  if (dom.drawCanvas) dom.drawCanvas.style.cursor = cursors[name] ?? 'crosshair';
  renderHandles();
  const hints = {
    select:    'Klicken = auswählen · Ziehen = verschieben · Handles = bearbeiten · Entf = löschen',
    arrow:     'Pfeil: Startpunkt klicken · zur Spitze ziehen',
    circle:    'Kreis: Ecke klicken · zur gegenüberliegenden Ecke ziehen',
    magnifier: 'Lupe: Klicken = setzen · Ziehen = Radius · Shift+Scroll = Radius · Scroll = Zoom',
    crop:      'Ausschnitt: Bereich ziehen → beim Speichern wird nur dieser Bereich exportiert',
  };
  if (dom.hintEl) dom.hintEl.textContent = hints[name] ?? '';

  // Größe-Slider: im Lupe-Modus steuert er den Radius (20–400), sonst Strichdicke (0.6–2.5)
  if (dom.sizeSlider) {
    if (name === 'magnifier') {
      dom.sizeSlider.min   = '20';
      dom.sizeSlider.max   = '400';
      dom.sizeSlider.step  = '10';
      dom.sizeSlider.value = String(state.magRadius);
    } else {
      dom.sizeSlider.min   = '0.6';
      dom.sizeSlider.max   = '2.5';
      dom.sizeSlider.step  = '0.1';
      dom.sizeSlider.value = String(state.sizeMul);
    }
  }
}

async function openEditor() {
  const desktopWv = document.getElementById('desktop-wv');
  if (!desktopWv) return;

  let nativeImg;
  try { nativeImg = await desktopWv.capturePage(); } catch { return; }

  const { width, height } = nativeImg.getSize();
  [dom.bgCanvas, dom.drawCanvas, dom.prevCanvas].forEach(cv => { cv.width = width; cv.height = height; });
  ctx.bg   = dom.bgCanvas.getContext('2d');
  ctx.draw = dom.drawCanvas.getContext('2d');
  ctx.prev = dom.prevCanvas.getContext('2d');

  const img = new Image();
  await new Promise(res => { img.onload = res; img.src = nativeImg.toDataURL(); });
  ctx.bg.drawImage(img, 0, 0);

  if (dom.cursorCb?.checked && state.lastCursorPos) {
    const dpr = window.devicePixelRatio || 1;
    drawCursorIcon(ctx.bg, state.lastCursorPos.x * dpr, state.lastCursorPos.y * dpr, dpr);
  }

  const toolbarH = document.getElementById('annotate-toolbar')?.offsetHeight ?? 56;
  const availW   = window.innerWidth  - 32;
  const availH   = window.innerHeight - toolbarH - 32;
  const ratio    = Math.min(1, availW / width, availH / height);
  if (dom.stack) {
    dom.stack.style.width  = Math.round(width  * ratio) + 'px';
    dom.stack.style.height = Math.round(height * ratio) + 'px';
  }

  state.annotations = [];
  state.undoStack   = [];
  state.selectedId  = null;
  state.dragMode    = null;
  state.cropRect    = null;
  dom.cropResetBtn?.classList.add('hidden');
  dom.cropSaveBtn?.classList.add('hidden');
  dom.overlay.classList.remove('hidden');
  setTool('arrow');
  document.querySelector('#annotate-colors [data-color]')?.click();
  redrawAll();
}

function closeEditor() {
  dom.overlay.classList.add('hidden');
  state.dragMode    = null;
  state.selectedId  = null;
  state.annotations = [];
  state.undoStack   = [];
  state.cropRect    = null;
  dom.cropResetBtn?.classList.add('hidden');
  dom.cropSaveBtn?.classList.add('hidden');
}

function saveAnnotation() {
  let sx = 0, sy = 0, sw = dom.bgCanvas.width, sh = dom.bgCanvas.height;
  if (state.cropRect) {
    const nr = normRect(state.cropRect);
    sx = nr.x1; sy = nr.y1;
    sw = Math.max(1, nr.x2 - nr.x1);
    sh = Math.max(1, nr.y2 - nr.y1);
  }
  const out = document.createElement('canvas');
  out.width  = sw;
  out.height = sh;
  const outCtx = out.getContext('2d');
  outCtx.drawImage(dom.bgCanvas,   sx, sy, sw, sh, 0, 0, sw, sh);
  outCtx.drawImage(dom.drawCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  out.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: `annotation_${Date.now()}.png` }).click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

export function wireEditor() {
  dom.annotateBtn?.addEventListener('click',  openEditor);
  dom.closeBtn?.addEventListener('click',     closeEditor);
  dom.saveBtn?.addEventListener('click',      saveAnnotation);
  dom.undoBtn?.addEventListener('click',      undoStep);
  dom.clearBtn?.addEventListener('click',     clearAll);
  dom.deleteBtn?.addEventListener('click',    deleteSelected);

  dom.toolBtns.forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

  dom.colorBtns.forEach(b => b.addEventListener('click', () => {
    state.color = b.dataset.color;
    dom.colorBtns.forEach(c => c.classList.toggle('at-color-active', c === b));
  }));

  dom.sizeSlider?.addEventListener('input', () => {
    const ann = state.selectedId !== null ? state.annotations.find(a => a.id === state.selectedId) : null;
    if (state.tool === 'magnifier') {
      state.magRadius = +dom.sizeSlider.value;
      if (ann?.type === 'magnifier') { ann.radius = state.magRadius; redrawAll(); }
      if (ctx.prev && state.lastDrawPos.x !== 0) {
        ctx.prev.clearRect(0, 0, dom.prevCanvas.width, dom.prevCanvas.height);
        const seed = (state.nextId * 7919 + 1337) & 0x7fffffff || 1;
        drawMagnifier(ctx.prev, dom.bgCanvas, state.lastDrawPos.x, state.lastDrawPos.y, state.magRadius, state.magZoom, state.color, state.sizeMul, mkRng(seed));
      }
    } else {
      state.sizeMul = +dom.sizeSlider.value;
      if (ann) { ann.size = state.sizeMul; redrawAll(); }
    }
  });
  dom.zoomSlider?.addEventListener('input', () => { state.magZoom = +dom.zoomSlider.value; });

  document.getElementById('annotate-exit-btn')?.addEventListener('click', closeEditor);

  dom.drawCanvas?.addEventListener('mousedown',  onDown);
  dom.drawCanvas?.addEventListener('mousemove',  onMove);
  dom.drawCanvas?.addEventListener('mouseup',    onUp);
  dom.drawCanvas?.addEventListener('mouseleave', onLeave);
  dom.drawCanvas?.addEventListener('wheel', e => {
    if (!dom.overlay || dom.overlay.classList.contains('hidden')) return;
    e.preventDefault();
    // Shift+Scroll erzeugt auf Linux/Electron oft deltaX statt deltaY
    const rawDelta = e.shiftKey && e.deltaX !== 0 ? e.deltaX : e.deltaY;
    const up  = rawDelta < 0;
    const ann = state.selectedId !== null ? state.annotations.find(a => a.id === state.selectedId) : null;
    const isMagTool = state.tool === 'magnifier';
    const isMagAnn  = ann?.type === 'magnifier';

    if (isMagTool || isMagAnn) {
      if (e.shiftKey) {
        state.magRadius = Math.round(Math.min(400, Math.max(20, state.magRadius + (up ? 10 : -10))));
        if (dom.sizeSlider && isMagTool) dom.sizeSlider.value = String(state.magRadius);
        if (isMagAnn) { ann.radius = state.magRadius; redrawAll(); }
        if (ctx.prev && isMagTool) {
          ctx.prev.clearRect(0, 0, dom.prevCanvas.width, dom.prevCanvas.height);
          const seed = (state.nextId * 7919 + 1337) & 0x7fffffff || 1;
          drawMagnifier(ctx.prev, dom.bgCanvas, state.lastDrawPos.x, state.lastDrawPos.y, state.magRadius, state.magZoom, state.color, state.sizeMul, mkRng(seed));
        }
      } else {
        state.magZoom = Math.round(Math.min(5, Math.max(1.5, state.magZoom + (up ? 0.25 : -0.25))) * 4) / 4;
        if (dom.zoomSlider) dom.zoomSlider.value = state.magZoom;
        if (isMagAnn) { ann.zoom = state.magZoom; redrawAll(); }
        if (ctx.prev && isMagTool) {
          ctx.prev.clearRect(0, 0, dom.prevCanvas.width, dom.prevCanvas.height);
          const seed = (state.nextId * 7919 + 1337) & 0x7fffffff || 1;
          drawMagnifier(ctx.prev, dom.bgCanvas, state.lastDrawPos.x, state.lastDrawPos.y, state.magRadius, state.magZoom, state.color, state.sizeMul, mkRng(seed));
        }
      }
    } else {
      state.sizeMul = Math.round(Math.min(2.5, Math.max(0.6, state.sizeMul + (up ? 0.1 : -0.1))) * 10) / 10;
      if (dom.sizeSlider) dom.sizeSlider.value = state.sizeMul;
      if (ann) { ann.size = state.sizeMul; redrawAll(); }
    }
  }, { passive: false });

  document.addEventListener('keydown', e => {
    if (!dom.overlay || dom.overlay.classList.contains('hidden')) return;
    if (e.key === 'Escape') {
      if (state.selectedId !== null) { state.selectedId = null; renderHandles(); }
      else { closeEditor(); }
      e.preventDefault(); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { undoStep(); e.preventDefault(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); e.preventDefault(); return; }
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if      (e.key === 's') setTool('select');
      else if (e.key === 'a') setTool('arrow');
      else if (e.key === 'c') setTool('circle');
      else if (e.key === 'm') setTool('magnifier');
      else if (e.key === 'k') setTool('crop');
    }
  });

  document.getElementById('desktop-wv')?.addEventListener('mousemove', e => {
    const wv = document.getElementById('desktop-wv');
    if (!wv) return;
    const r = wv.getBoundingClientRect();
    state.lastCursorPos = { x: e.clientX - r.left, y: e.clientY - r.top };
  });

  dom.cropSaveBtn?.addEventListener('click', saveAnnotation);

  dom.cropResetBtn?.addEventListener('click', () => {
    state.cropRect = null;
    dom.cropResetBtn.classList.add('hidden');
    dom.cropSaveBtn?.classList.add('hidden');
    if (dom.hintEl) dom.hintEl.textContent = 'Ausschnitt: Bereich ziehen → beim Speichern wird nur dieser Bereich exportiert';
    renderHandles();
  });

  // Crop: document-level mousemove → flüssig auch außerhalb des Canvas
  document.addEventListener('mousemove', e => {
    if (!dom.overlay || dom.overlay.classList.contains('hidden')) return;
    if (state.dragMode !== 'crop' && state.dragMode !== 'crop-handle') return;
    const W = dom.drawCanvas.width, H = dom.drawCanvas.height;
    const r = dom.drawCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(W, (e.clientX - r.left) * (W / r.width)));
    const y = Math.max(0, Math.min(H, (e.clientY - r.top)  * (H / r.height)));
    if (state.dragMode === 'crop') {
      state.cropRect = { x1: state.dragStart.x, y1: state.dragStart.y, x2: x, y2: y };
    } else {
      applyCropHandle(state.activeCropHandle, x, y);
    }
    renderHandles();
  });

  // Mouseup außerhalb des Canvas: Crop-Drag trotzdem finalisieren
  document.addEventListener('mouseup', () => {
    if (state.dragMode !== 'crop' && state.dragMode !== 'crop-handle') return;
    const wasCropHandle = state.dragMode === 'crop-handle';
    state.dragMode = null;
    if (wasCropHandle) {
      state.activeCropHandle = null;
      if (state.cropRect) {
        state.cropRect = normRect(state.cropRect);
        const nr = state.cropRect;
        if (dom.hintEl && nr.x2 - nr.x1 >= 8 && nr.y2 - nr.y1 >= 8)
          dom.hintEl.textContent = `Ausschnitt aktiv (${Math.round(nr.x2 - nr.x1)} × ${Math.round(nr.y2 - nr.y1)} px) · ↓ Ausschnitt speichern oder neu ziehen`;
      }
      renderHandles();
      return;
    }
    // 'crop'-Modus: onUp hat In-Canvas-Fall bereits behandelt (dragMode schon null)
    // Wir landen hier nur wenn außerhalb losgelassen wurde.
    if (!state.cropRect) return;
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
  });
}
