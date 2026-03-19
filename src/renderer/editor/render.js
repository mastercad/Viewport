import { state, ctx, dom, HANDLE_R } from './state.js';
import { normRect } from './geometry.js';
import { mkRng, drawMarkerArrow, drawMarkerCircle, drawMagnifier } from './draw.js';
import { getCropHandles, getHandles } from './hittest.js';

export function drawAnnotation(annCtx, ann) {
  const rng = mkRng(ann.seed);
  switch (ann.type) {
    case 'arrow':     drawMarkerArrow(annCtx, ann.x1, ann.y1, ann.x2, ann.y2, ann.color, ann.size, rng); break;
    case 'circle':    drawMarkerCircle(annCtx, ann.cx, ann.cy, ann.rx, ann.ry, ann.color, ann.size, rng); break;
    case 'magnifier': drawMagnifier(annCtx, dom.bgCanvas, ann.cx, ann.cy, ann.radius, ann.zoom, ann.color, ann.size, rng); break;
  }
}

export function redrawAll() {
  if (!ctx.draw) return;
  ctx.draw.clearRect(0, 0, dom.drawCanvas.width, dom.drawCanvas.height);
  for (const ann of state.annotations) drawAnnotation(ctx.draw, ann);
  renderHandles();
}

export function renderCropOverlay() {
  if (!ctx.prev || !state.cropRect) return;
  const W = dom.prevCanvas.width, H = dom.prevCanvas.height;
  const { x1, y1, x2, y2 } = normRect(state.cropRect);
  const w = x2 - x1, h = y2 - y1;
  ctx.prev.save();
  ctx.prev.fillStyle = 'rgba(0,0,0,0.52)';
  ctx.prev.fillRect(0,  0,  W,      y1);
  ctx.prev.fillRect(0,  y2, W,      H - y2);
  ctx.prev.fillRect(0,  y1, x1,     h);
  ctx.prev.fillRect(x2, y1, W - x2, h);
  ctx.prev.strokeStyle = '#fff';
  ctx.prev.lineWidth   = 1.5;
  ctx.prev.setLineDash([6, 4]);
  ctx.prev.strokeRect(x1, y1, w, h);
  ctx.prev.setLineDash([]);
  for (const h of getCropHandles()) {
    const r = h.id.length === 2 ? HANDLE_R : HANDLE_R - 2;
    ctx.prev.save();
    ctx.prev.beginPath();
    ctx.prev.arc(h.x, h.y, r, 0, Math.PI * 2);
    ctx.prev.fillStyle   = '#fff';
    ctx.prev.shadowColor = 'rgba(0,0,0,0.40)';
    ctx.prev.shadowBlur  = 5;
    ctx.prev.fill();
    ctx.prev.shadowBlur  = 0;
    ctx.prev.strokeStyle = '#4361ee';
    ctx.prev.lineWidth   = 2;
    ctx.prev.stroke();
    ctx.prev.restore();
  }
  const label = `${Math.round(w)} × ${Math.round(h)}`;
  ctx.prev.font = `bold ${Math.round(13 * (dom.prevCanvas.width / 1200 || 1))}px system-ui`;
  const lw = ctx.prev.measureText(label).width;
  const lh = 18;
  const lx = Math.min(x1, W - lw - 8);
  const ly = y1 > 28 ? y1 - 24 : y2 + 6;
  ctx.prev.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.prev.fillRect(lx - 4, ly, lw + 8, lh);
  ctx.prev.fillStyle = '#fff';
  ctx.prev.fillText(label, lx, ly + 13);
  ctx.prev.restore();
}

export function renderHandles() {
  if (!ctx.prev) return;
  ctx.prev.clearRect(0, 0, dom.prevCanvas.width, dom.prevCanvas.height);
  renderCropOverlay();
  if (state.selectedId == null) return;
  const ann = state.annotations.find(a => a.id === state.selectedId);
  if (!ann) return;

  ctx.prev.save();
  ctx.prev.strokeStyle = 'rgba(67,97,238,0.60)';
  ctx.prev.lineWidth   = 1.5;
  ctx.prev.setLineDash([5, 4]);
  if (ann.type === 'arrow') {
    ctx.prev.beginPath();
    ctx.prev.moveTo(ann.x1, ann.y1);
    ctx.prev.lineTo(ann.x2, ann.y2);
    ctx.prev.stroke();
  } else if (ann.type === 'circle') {
    ctx.prev.beginPath();
    ctx.prev.ellipse(ann.cx, ann.cy, ann.rx + 10, ann.ry + 10, 0, 0, Math.PI * 2);
    ctx.prev.stroke();
  } else if (ann.type === 'magnifier') {
    ctx.prev.beginPath();
    ctx.prev.arc(ann.cx, ann.cy, ann.radius + 10, 0, Math.PI * 2);
    ctx.prev.stroke();
  }
  ctx.prev.restore();

  for (const h of getHandles(ann)) {
    ctx.prev.save();
    ctx.prev.beginPath();
    ctx.prev.arc(h.x, h.y, HANDLE_R, 0, Math.PI * 2);
    ctx.prev.fillStyle   = '#fff';
    ctx.prev.strokeStyle = ann.color || '#4361ee';
    ctx.prev.lineWidth   = 2.5;
    ctx.prev.shadowColor = 'rgba(0,0,0,0.30)';
    ctx.prev.shadowBlur  = 4;
    ctx.prev.fill();
    ctx.prev.shadowBlur  = 0;
    ctx.prev.stroke();
    if (h.id === 'center') {
      ctx.prev.strokeStyle = '#999';
      ctx.prev.lineWidth   = 1.5;
      ctx.prev.beginPath();
      ctx.prev.moveTo(h.x - 3.5, h.y); ctx.prev.lineTo(h.x + 3.5, h.y);
      ctx.prev.moveTo(h.x, h.y - 3.5); ctx.prev.lineTo(h.x, h.y + 3.5);
      ctx.prev.stroke();
    }
    ctx.prev.restore();
  }
}
