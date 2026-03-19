import { state, HANDLE_R, HANDLE_HIT, HIT_THR } from './state.js';
import { normRect, distToSegment } from './geometry.js';

export function getCropHandles() {
  if (!state.cropRect) return [];
  const { x1, y1, x2, y2 } = normRect(state.cropRect);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  return [
    { id: 'tl', x: x1, y: y1, cursor: 'nw-resize' },
    { id: 'tr', x: x2, y: y1, cursor: 'ne-resize' },
    { id: 'br', x: x2, y: y2, cursor: 'se-resize' },
    { id: 'bl', x: x1, y: y2, cursor: 'sw-resize' },
    { id: 't',  x: mx, y: y1, cursor: 'n-resize'  },
    { id: 'r',  x: x2, y: my, cursor: 'e-resize'  },
    { id: 'b',  x: mx, y: y2, cursor: 's-resize'  },
    { id: 'l',  x: x1, y: my, cursor: 'w-resize'  },
  ];
}

export function cropHandleAt(mx, my) {
  for (const h of getCropHandles()) {
    if (Math.hypot(mx - h.x, my - h.y) < HANDLE_HIT) return h;
  }
  return null;
}

export function applyCropHandle(hId, x, y) {
  if      (hId === 'tl') { state.cropRect.x1 = x; state.cropRect.y1 = y; }
  else if (hId === 'tr') { state.cropRect.x2 = x; state.cropRect.y1 = y; }
  else if (hId === 'br') { state.cropRect.x2 = x; state.cropRect.y2 = y; }
  else if (hId === 'bl') { state.cropRect.x1 = x; state.cropRect.y2 = y; }
  else if (hId === 't')  { state.cropRect.y1 = y; }
  else if (hId === 'r')  { state.cropRect.x2 = x; }
  else if (hId === 'b')  { state.cropRect.y2 = y; }
  else if (hId === 'l')  { state.cropRect.x1 = x; }
}

export function hitTest(ann, mx, my) {
  if (ann.type === 'arrow') {
    return distToSegment(mx, my, ann.x1, ann.y1, ann.x2, ann.y2) < HIT_THR;
  }
  if (ann.type === 'circle') {
    const nx = (mx - ann.cx) / Math.max(1, ann.rx);
    const ny = (my - ann.cy) / Math.max(1, ann.ry);
    return Math.hypot(nx, ny) < 1.28;
  }
  if (ann.type === 'magnifier') {
    return Math.hypot(mx - ann.cx, my - ann.cy) < ann.radius + 12;
  }
  return false;
}

export function hitTestAll(mx, my) {
  for (let i = state.annotations.length - 1; i >= 0; i--) {
    if (hitTest(state.annotations[i], mx, my)) return state.annotations[i];
  }
  return null;
}

export function getHandles(ann) {
  if (ann.type === 'arrow') return [
    { id: 'tail', x: ann.x1, y: ann.y1, cursor: 'move' },
    { id: 'head', x: ann.x2, y: ann.y2, cursor: 'move' },
  ];
  if (ann.type === 'circle') return [
    { id: 'center', x: ann.cx,          y: ann.cy,          cursor: 'move'      },
    { id: 'e',      x: ann.cx + ann.rx, y: ann.cy,          cursor: 'ew-resize' },
    { id: 'w',      x: ann.cx - ann.rx, y: ann.cy,          cursor: 'ew-resize' },
    { id: 'n',      x: ann.cx,          y: ann.cy - ann.ry, cursor: 'ns-resize' },
    { id: 's',      x: ann.cx,          y: ann.cy + ann.ry, cursor: 'ns-resize' },
  ];
  if (ann.type === 'magnifier') return [
    { id: 'center', x: ann.cx,              y: ann.cy, cursor: 'move'      },
    { id: 'edge',   x: ann.cx + ann.radius, y: ann.cy, cursor: 'ew-resize' },
  ];
  return [];
}

export function handleAt(mx, my) {
  if (state.selectedId == null) return null;
  const ann = state.annotations.find(a => a.id === state.selectedId);
  if (!ann) return null;
  for (const h of getHandles(ann)) {
    if (Math.hypot(mx - h.x, my - h.y) < HANDLE_HIT) return h;
  }
  return null;
}

export function applyHandle(ann, hId, mx, my) {
  if (ann.type === 'arrow') {
    if (hId === 'head') { ann.x2 = mx; ann.y2 = my; }
    if (hId === 'tail') { ann.x1 = mx; ann.y1 = my; }
  }
  if (ann.type === 'circle') {
    if (hId === 'e') ann.rx = Math.max(5, mx - ann.cx);
    if (hId === 'w') ann.rx = Math.max(5, ann.cx - mx);
    if (hId === 'n') ann.ry = Math.max(5, ann.cy - my);
    if (hId === 's') ann.ry = Math.max(5, my - ann.cy);
  }
  if (ann.type === 'magnifier') {
    if (hId === 'edge') ann.radius = Math.max(15, Math.hypot(mx - ann.cx, my - ann.cy));
  }
}

export function applyMove(ann, origin, dx, dy) {
  if (ann.type === 'arrow') {
    ann.x1 = origin.x1 + dx; ann.y1 = origin.y1 + dy;
    ann.x2 = origin.x2 + dx; ann.y2 = origin.y2 + dy;
  }
  if (ann.type === 'circle' || ann.type === 'magnifier') {
    ann.cx = origin.cx + dx; ann.cy = origin.cy + dy;
  }
}
