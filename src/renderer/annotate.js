/**
 * annotate.js — Screenshot-Annotationswerkzeug
 *
 * Künstlerisch-handgezeichnete Marker-Werkzeuge, ausschließlich Canvas 2D.
 * Alle Formen werden als Objekte gespeichert und können nachträglich
 * verschoben, skaliert und (bei Pfeilen) an Start/Ende bearbeitet werden.
 *
 * Werkzeuge:
 *   select   – Auswählen, Verschieben, Handles ziehen          (S)
 *   arrow    – Marker-Pfeil  (geschwungener Schaft, Tinten-Klecks)  (A)
 *   circle   – Fasermaler-Kreis  (unregelmäßige Ellipse)         (C)
 *   magnifier – Lupe  (kreisförmiger Zoom-Ausschnitt)             (M)
 *
 * Shortcuts: S/A/C/M · Strg+Z · Esc · Entf = ausgewählte löschen
 */

/* ── DOM ─────────────────────────────────────────────────────────────────── */
const overlay     = document.getElementById('annotate-overlay');
const bgCanvas    = document.getElementById('annotate-bg');
const drawCanvas  = document.getElementById('annotate-draw');
const prevCanvas  = document.getElementById('annotate-preview');
const stack       = document.getElementById('annotate-stack');
const annotateBtn = document.getElementById('annotate-btn');
const undoBtn     = document.getElementById('annotate-undo');
const clearBtn    = document.getElementById('annotate-clear-btn');
const deleteBtn   = document.getElementById('annotate-delete');
const saveBtn     = document.getElementById('annotate-save');
const closeBtn    = document.getElementById('annotate-close-btn');
const hintEl      = document.getElementById('annotate-hint');
const toolBtns    = document.querySelectorAll('#annotate-tools [data-tool]');
const colorBtns   = document.querySelectorAll('#annotate-colors [data-color]');
const sizeSlider  = document.getElementById('annotate-size');
const zoomSlider  = document.getElementById('annotate-zoom');
const cropResetBtn    = document.getElementById('annotate-crop-reset');
const cropSaveBtn     = document.getElementById('annotate-crop-save-btn');
const cursorCb        = document.getElementById('annotate-cursor-cb');

/* ── Zustand ─────────────────────────────────────────────────────────────── */
let bgCtx = null, drawCtx = null, prevCtx = null;
let tool       = 'arrow';
let color      = '#FF3B30';
let sizeMul    = 1;
let magZoom    = 2.5;

/** Annotationen als Objekt-Array (nicht als Pixel). */
let annotations = [];
let nextId      = 1;

/** Undo-Stack: Snapshots des annotations-Arrays. */
let undoStack   = [];

/** Aktuell ausgewählte Annotation (null = keine). */
let selectedId  = null;

/** Aktiver Zuschnitt-Bereich (null = ganzes Bild). */
let cropRect = null;   // { x1, y1, x2, y2 } in Canvas-px

/** Letzter bekannter Cursor über dem Desktop-WebView (CSS-px). */
let lastCursorPos = null;  // { x, y }

/** Drag-Modus: null | 'create' | 'move' | 'handle' | 'crop' | 'crop-handle' */
let dragMode    = null;
/** Welcher Annotations-Handle wird gezogen. */
let activeHandle = null;
/** Welcher Crop-Handle wird gezogen ('tl'|'tr'|'br'|'bl'|'t'|'r'|'b'|'l'). */
let activeCropHandle = null;
/** Mausposition beim Drag-Start (Canvas-px). */
let dragStart   = { x: 0, y: 0 };
/** Kopie der Ann. zu Drag-Beginn (für Delta-Berechnungen). */
let originAnn   = null;

/* ── Geometrie-Konstanten ────────────────────────────────────────────────── */
const HANDLE_R   = 7;   // Handle-Radius (Canvas-px)
const HANDLE_HIT = 14;  // Hit-Radius für Handle-Erkennung
const HIT_THR    = 18;  // Schwelle für Annotation-Treffer

/* ══════════════════════════════════════════════════════════════════════════
   SEEDED-RNG  (Xorshift32 — schnell, deterministisch)
   ══════════════════════════════════════════════════════════════════════════ */

function mkRng(seed) {
  let s = ((seed ^ 0xdeadbeef) >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

/** Normiert ein Rechteck so dass x1 ≤ x2 und y1 ≤ y2 gilt. */
function normRect({ x1, y1, x2, y2 }) {
  return { x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2) };
}

/**
 * Zeichnet einen OS-ähnlichen Pfeilzeiger auf ctx an der Spitze (x, y).
 * s = Skalierungsfaktor (≈ devicePixelRatio).
 */
function drawCursorIcon(ctx, x, y, s = 1) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap  = 'round';
  const p = new Path2D();
  p.moveTo(x,           y);
  p.lineTo(x,           y + 16 * s);
  p.lineTo(x + 3.5 * s, y + 12 * s);
  p.lineTo(x + 6.5 * s, y + 18 * s);
  p.lineTo(x + 9 * s,   y + 17 * s);
  p.lineTo(x + 6 * s,   y + 11 * s);
  p.lineTo(x + 10 * s,  y + 11 * s);
  p.closePath();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth   = 1.5 * s;
  ctx.stroke(p);
  ctx.fillStyle   = '#1a1a1a';
  ctx.fill(p);
  ctx.restore();
}

/** Euklidische Distanz von Punkt (px,py) zur Strecke (ax,ay)–(bx,by). */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Tiefen-Copy einer Annotation. */
function cloneAnn(ann) { return JSON.parse(JSON.stringify(ann)); }

/* ── Crop-Handle-Hilfsfunktionen ─────────────────────────────────────────── */

/** Gibt die 8 Resize-Handles des aktuellen Ausschnitts zurück (normalisierte Positionen). */
function getCropHandles() {
  if (!cropRect) return [];
  const { x1, y1, x2, y2 } = normRect(cropRect);
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

/** Gibt den Crop-Handle an (mx,my) zurück oder null. */
function cropHandleAt(mx, my) {
  for (const h of getCropHandles()) {
    if (Math.hypot(mx - h.x, my - h.y) < HANDLE_HIT) return h;
  }
  return null;
}

/**
 * Wendet einen Crop-Handle-Drag auf cropRect an.
 * x,y sind bereits auf [0, canvasW/H] geclampt.
 */
function applyCropHandle(hId, x, y) {
  if      (hId === 'tl') { cropRect.x1 = x; cropRect.y1 = y; }
  else if (hId === 'tr') { cropRect.x2 = x; cropRect.y1 = y; }
  else if (hId === 'br') { cropRect.x2 = x; cropRect.y2 = y; }
  else if (hId === 'bl') { cropRect.x1 = x; cropRect.y2 = y; }
  else if (hId === 't')  { cropRect.y1 = y; }
  else if (hId === 'r')  { cropRect.x2 = x; }
  else if (hId === 'b')  { cropRect.y2 = y; }
  else if (hId === 'l')  { cropRect.x1 = x; }
}

/* ══════════════════════════════════════════════════════════════════════════
   ZEICHENALGORITHMEN
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Handgezeichneter Marker-Pfeil.
 *
 * Schaft: leicht geschwungene Quadratic-Bezier-Kurve mit senkrechter Auslenkung,
 *         plus zweiter, leicht versetzter Strich mit niedriger Opacity → Marker-Textur.
 * Pfeilspitze: zwei asymmetrische Flügel als separate Bezier-Striche,
 *              die an der Spitze leicht überschießen oder nicht ganz ankommen.
 * Startpunkt: kleiner Tinten-Klecks (Marker setzt auf Papier auf).
 */
function drawMarkerArrow(ctx, x1, y1, x2, y2, clr, sm, rng) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 6) return;

  const ux = dx / len, uy = dy / len;   // Einheitsvektor entlang des Pfeils
  const px = -uy, py = ux;              // Senkrechter Einheitsvektor

  const lw = (4.8 + rng() * 1.3) * sm;

  ctx.save();
  ctx.lineCap    = 'round';
  ctx.lineJoin   = 'round';
  ctx.strokeStyle = clr;
  ctx.fillStyle   = clr;

  // ── Tinten-Klecks am Startpunkt ──────────────────────────────────────
  ctx.globalAlpha = 0.60;
  ctx.beginPath();
  ctx.arc(
    x1 + (rng() - 0.5) * 2.5, y1 + (rng() - 0.5) * 2.5,
    lw * (0.52 + rng() * 0.28), 0, Math.PI * 2,
  );
  ctx.fill();

  // ── Schaft: sanft geschwungene Bezier ────────────────────────────────
  const side    = rng() < 0.5 ? 1 : -1;
  const wobAmp  = Math.min(len * 0.072, 22) * (0.3 + rng() * 0.9);
  const cpT     = 0.34 + rng() * 0.32;
  const cpx     = x1 + dx * cpT + px * wobAmp * side;
  const cpy     = y1 + dy * cpT + py * wobAmp * side;

  // Haupt-Strich
  ctx.globalAlpha = 0.93;
  ctx.lineWidth   = lw;
  ctx.beginPath();
  ctx.moveTo(x1 + px * (rng() - 0.5) * 4, y1 + py * (rng() - 0.5) * 4);
  ctx.quadraticCurveTo(cpx, cpy, x2, y2);
  ctx.stroke();

  // Zweiter, leicht versetzter Schatten-Strich → Marker-Körnung
  ctx.globalAlpha = 0.20;
  ctx.lineWidth   = lw * 0.55;
  ctx.beginPath();
  ctx.moveTo(
    x1 + px * side * (1.5 + rng() * 2.5),
    y1 + py * side * (1.5 + rng() * 2.5),
  );
  ctx.quadraticCurveTo(
    cpx + px * 2.5, cpy + py * 2.5,
    x2  + px * (rng() - 0.5) * 3.5,
    y2  + py * (rng() - 0.5) * 3.5,
  );
  ctx.stroke();

  // ── Pfeilspitze: zwei asymmetrische Flügel ───────────────────────────
  const headLen = Math.min(len * 0.34, 52) * sm;
  const spread  = Math.PI / 5.4;
  const angle   = Math.atan2(dy, dx);

  [-1, 1].forEach(s => {
    const wAng = angle + Math.PI + s * spread * (1 + (rng() - 0.5) * 0.26);
    const wLen = headLen * (0.76 + rng() * 0.38);
    // Leichter seitlicher Versatz → Asymmetrie
    const wx   = x2 + Math.cos(wAng) * wLen + px * s * rng() * 6;
    const wy   = y2 + Math.sin(wAng) * wLen + py * s * rng() * 6;
    // Kontrollpunkt: leicht über oder vor der Spitze → gelegentliches Überschießen
    const mcx  = (wx + x2) / 2 + ux * (rng() - 0.32) * headLen * 0.14;
    const mcy  = (wy + y2) / 2 + uy * (rng() - 0.32) * headLen * 0.14;

    ctx.globalAlpha = 0.92;
    ctx.lineWidth   = lw * (0.80 + rng() * 0.26);
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.quadraticCurveTo(mcx, mcy, x2, y2);
    ctx.stroke();
  });

  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * Fasermaler-Kreis / Oval.
 *
 * Leicht verzerrte Ellipse (gestörte Bezier-Kontrollpunkte) + doppelter Pinselstrich.
 * Pass 1: dicker, opak — das Hauptlinienbild.
 * Pass 2: leicht versetzt, halb-transparent — der typische Marker-Doppelzug,
 *         der entsteht wenn man einen breiten Fasermaler schnell kreisförmig führt.
 * Der Strich schließt sich mit leichtem Überlapp (wie ein schnell gezogener Kreis).
 */
function drawMarkerCircle(ctx, cx, cy, rx, ry, clr, sm, rng) {
  if (rx < 4 || ry < 4) return;

  const N = 8;
  ctx.save();
  ctx.lineCap    = 'round';
  ctx.lineJoin   = 'round';
  ctx.strokeStyle = clr;

  // Stabile, leicht verzerrte Stützpunkte (einmal für beide Passes)
  const pts = Array.from({ length: N }, (_, i) => {
    const a  = (i / N) * Math.PI * 2;
    const rw = 1 + (rng() - 0.5) * 0.17;
    return {
      x: cx + Math.cos(a) * rx * rw + (rng() - 0.5) * 7,
      y: cy + Math.sin(a) * ry * rw + (rng() - 0.5) * 7,
    };
  });

  function drawPath(dxOfs, dyOfs) {
    const p0 = pts[0];
    ctx.beginPath();
    ctx.moveTo(p0.x + dxOfs + (rng() - 0.5) * 3.5, p0.y + dyOfs + (rng() - 0.5) * 3.5);
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[(i + 1) % N];
      ctx.quadraticCurveTo(
        a.x + dxOfs, a.y + dyOfs,
        (a.x + b.x) / 2 + dxOfs, (a.y + b.y) / 2 + dyOfs,
      );
    }
    // Schlusspunkt leicht über den Start hinaus → natürlicher Überlapp
    ctx.quadraticCurveTo(
      pts[N - 1].x + dxOfs, pts[N - 1].y + dyOfs,
      p0.x + dxOfs + (rng() - 0.5) * 5, p0.y + dyOfs + (rng() - 0.5) * 5,
    );
  }

  // Pass 1: Hauptkontur — dicker, stark opak
  ctx.globalAlpha = 0.85;
  ctx.lineWidth   = (7.5 + rng() * 2.5) * sm;
  drawPath(0, 0);
  ctx.stroke();

  // Pass 2: leicht versetzter Innen-Zug — Marker-Schichteffekt
  const ix = (rng() - 0.5) * 5, iy = (rng() - 0.5) * 5;
  ctx.globalAlpha = 0.30;
  ctx.lineWidth   = (4.5 + rng() * 2) * sm;
  drawPath(ix, iy);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * Lupe — kreisförmiger Zoom-Ausschnitt.
 *
 * Zieht einen konfigurierbaren Bereich der bgCanvas vergrößert in einen
 * beschnittenen Kreis. Glas-Schimmer durch radialen Gradienten.
 * Umrahmt von einem handgezeichneten Marker-Ring (zwei Passes, leicht unregelmäßig).
 * Kleines Fadenkreuz im Mittelpunkt.
 */
function drawMagnifier(ctx, bgCv, cx, cy, radius, zoom, clr, sm, rng) {
  if (radius < 15) return;

  ctx.save();

  // Drop-Shadow hinter dem Glas
  ctx.shadowColor   = 'rgba(0,0,0,0.48)';
  ctx.shadowBlur    = 26;
  ctx.shadowOffsetY = 7;

  // Clip auf Kreis → Inhalt zeichnen
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 3, 0, Math.PI * 2);
  ctx.clip();
  ctx.shadowColor = 'transparent';

  // Vergrößerter Screenshot-Ausschnitt
  const srcW = (radius * 2) / zoom, srcH = (radius * 2) / zoom;
  ctx.drawImage(
    bgCv,
    cx - srcW / 2, cy - srcH / 2, srcW, srcH,
    cx - radius,   cy - radius,   radius * 2, radius * 2,
  );

  // Glasglanz (Aufhellung links-oben → Linsen-Schimmer)
  const grd = ctx.createRadialGradient(
    cx - radius * 0.22, cy - radius * 0.28, 0,
    cx, cy, radius,
  );
  grd.addColorStop(0,    'rgba(255,255,255,0.26)');
  grd.addColorStop(0.52, 'rgba(255,255,255,0.02)');
  grd.addColorStop(1,    'rgba(0,0,0,0.10)');
  ctx.fillStyle = grd;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

  ctx.restore();

  // ── Marker-Ring (stabile Zufälligkeit per Mittelpunkt) ───────────────
  const ringRng = mkRng((Math.round(cx) * 47 + Math.round(cy) * 31 + 1337) & 0x7fffffff || 1);
  const N       = 12;

  ctx.save();
  ctx.lineCap    = 'round';
  ctx.lineJoin   = 'round';
  ctx.strokeStyle = clr;

  [{ a: 0.90, lw: 6.5, ofs: 0 }, { a: 0.34, lw: 4.0, ofs: 3 }].forEach(({ a, lw, ofs }) => {
    ctx.globalAlpha = a;
    ctx.lineWidth   = lw * sm;
    const r = radius - ofs;

    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const t  = (i / N) * Math.PI * 2;
      const rw = r * (1 + (ringRng() - 0.5) * 0.07);
      const qx = cx + Math.cos(t) * rw + (ringRng() - 0.5) * 4;
      const qy = cy + Math.sin(t) * rw + (ringRng() - 0.5) * 4;
      i === 0 ? ctx.moveTo(qx, qy) : ctx.lineTo(qx, qy);
    }
    ctx.closePath();
    ctx.stroke();
  });

  // Fadenkreuz
  ctx.globalAlpha  = 0.50;
  ctx.strokeStyle  = '#fff';
  ctx.lineWidth    = 1.3;
  ctx.beginPath();
  ctx.moveTo(cx - 11, cy); ctx.lineTo(cx + 11, cy);
  ctx.moveTo(cx, cy - 11); ctx.lineTo(cx, cy + 11);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.restore();
}

/* ══════════════════════════════════════════════════════════════════════════
   ANNOTATION-OBJEKTE  (drawAnnotation, redrawAll)
   ══════════════════════════════════════════════════════════════════════════ */

function drawAnnotation(ctx, ann) {
  const rng = mkRng(ann.seed);
  switch (ann.type) {
    case 'arrow':     drawMarkerArrow(ctx, ann.x1, ann.y1, ann.x2, ann.y2, ann.color, ann.size, rng); break;
    case 'circle':    drawMarkerCircle(ctx, ann.cx, ann.cy, ann.rx, ann.ry, ann.color, ann.size, rng); break;
    case 'magnifier': drawMagnifier(ctx, bgCanvas, ann.cx, ann.cy, ann.radius, ann.zoom, ann.color, ann.size, rng); break;
  }
}

function redrawAll() {
  if (!drawCtx) return;
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  for (const ann of annotations) drawAnnotation(drawCtx, ann);
  renderHandles();
}

/* ══════════════════════════════════════════════════════════════════════════
   HIT-TEST
   ══════════════════════════════════════════════════════════════════════════ */

function hitTest(ann, mx, my) {
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

/** Gibt die vorderste getroffene Annotation zurück (umgekehrte Reihenfolge). */
function hitTestAll(mx, my) {
  for (let i = annotations.length - 1; i >= 0; i--) {
    if (hitTest(annotations[i], mx, my)) return annotations[i];
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
   HANDLES  (getHandles, handleAt, applyHandle, applyMove, renderHandles)
   ══════════════════════════════════════════════════════════════════════════ */

function getHandles(ann) {
  if (ann.type === 'arrow') return [
    { id: 'tail', x: ann.x1, y: ann.y1, cursor: 'move' },
    { id: 'head', x: ann.x2, y: ann.y2, cursor: 'move' },
  ];
  if (ann.type === 'circle') return [
    { id: 'center', x: ann.cx,         y: ann.cy,         cursor: 'move' },
    { id: 'e',      x: ann.cx + ann.rx, y: ann.cy,         cursor: 'ew-resize' },
    { id: 'w',      x: ann.cx - ann.rx, y: ann.cy,         cursor: 'ew-resize' },
    { id: 'n',      x: ann.cx,         y: ann.cy - ann.ry, cursor: 'ns-resize' },
    { id: 's',      x: ann.cx,         y: ann.cy + ann.ry, cursor: 'ns-resize' },
  ];
  if (ann.type === 'magnifier') return [
    { id: 'center', x: ann.cx,              y: ann.cy, cursor: 'move' },
    { id: 'edge',   x: ann.cx + ann.radius, y: ann.cy, cursor: 'ew-resize' },
  ];
  return [];
}

/** Gibt den Handle zurück, der an (mx,my) liegt – oder null. */
function handleAt(mx, my) {
  if (selectedId == null) return null;
  const ann = annotations.find(a => a.id === selectedId);
  if (!ann) return null;
  for (const h of getHandles(ann)) {
    if (Math.hypot(mx - h.x, my - h.y) < HANDLE_HIT) return h;
  }
  return null;
}

/** Wendet einen Handle-Drag auf eine Annotation an. */
function applyHandle(ann, hId, mx, my) {
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

/** Verschiebt eine Annotation um (dx, dy) ausgehend von einem Origin-Snapshot. */
function applyMove(ann, origin, dx, dy) {
  if (ann.type === 'arrow') {
    ann.x1 = origin.x1 + dx; ann.y1 = origin.y1 + dy;
    ann.x2 = origin.x2 + dx; ann.y2 = origin.y2 + dy;
  }
  if (ann.type === 'circle' || ann.type === 'magnifier') {
    ann.cx = origin.cx + dx; ann.cy = origin.cy + dy;
  }
}

/** Zeichnet die Zuschnitt-Maske auf prevCanvas (außerhalb = abgedunkelt). */
function renderCropOverlay() {
  if (!prevCtx || !cropRect) return;
  const W = prevCanvas.width, H = prevCanvas.height;
  const { x1, y1, x2, y2 } = normRect(cropRect);
  const w = x2 - x1, h = y2 - y1;
  prevCtx.save();
  prevCtx.fillStyle = 'rgba(0,0,0,0.52)';
  prevCtx.fillRect(0,  0,  W,      y1);        // oben
  prevCtx.fillRect(0,  y2, W,      H - y2);    // unten
  prevCtx.fillRect(0,  y1, x1,     h);         // links
  prevCtx.fillRect(x2, y1, W - x2, h);         // rechts
  // Gestrichelte Grenze
  prevCtx.strokeStyle = '#fff';
  prevCtx.lineWidth   = 1.5;
  prevCtx.setLineDash([6, 4]);
  prevCtx.strokeRect(x1, y1, w, h);
  // Handles: 4 Ecken (groß) + 4 Kantenmittelpunkte (kleiner)
  prevCtx.setLineDash([]);
  for (const h of getCropHandles()) {
    const r = h.id.length === 2 ? HANDLE_R : HANDLE_R - 2;   // Ecken größer
    prevCtx.save();
    prevCtx.beginPath();
    prevCtx.arc(h.x, h.y, r, 0, Math.PI * 2);
    prevCtx.fillStyle   = '#fff';
    prevCtx.shadowColor = 'rgba(0,0,0,0.40)';
    prevCtx.shadowBlur  = 5;
    prevCtx.fill();
    prevCtx.shadowBlur  = 0;
    prevCtx.strokeStyle = '#4361ee';
    prevCtx.lineWidth   = 2;
    prevCtx.stroke();
    prevCtx.restore();
  }
  // Maße-Label
  const label = `${Math.round(w)} × ${Math.round(h)}`;
  prevCtx.font      = `bold ${Math.round(13 * (prevCanvas.width / 1200 || 1))}px system-ui`;
  const lw = prevCtx.measureText(label).width;
  const lh = 18;
  const lx = Math.min(x1, W - lw - 8);
  const ly = y1 > 28 ? y1 - 24 : y2 + 6;
  prevCtx.fillStyle = 'rgba(0,0,0,0.72)';
  prevCtx.fillRect(lx - 4, ly, lw + 8, lh);
  prevCtx.fillStyle = '#fff';
  prevCtx.fillText(label, lx, ly + 13);
  prevCtx.restore();
}

/** Zeichnet Auswahl-Highlight + Handles auf prevCanvas. */
function renderHandles() {
  if (!prevCtx) return;
  prevCtx.clearRect(0, 0, prevCanvas.width, prevCanvas.height);
  renderCropOverlay();
  if (selectedId == null) return;
  const ann = annotations.find(a => a.id === selectedId);
  if (!ann) return;

  // Auswahl-Highlight
  prevCtx.save();
  prevCtx.strokeStyle = 'rgba(67,97,238,0.60)';
  prevCtx.lineWidth   = 1.5;
  prevCtx.setLineDash([5, 4]);
  if (ann.type === 'arrow') {
    prevCtx.beginPath();
    prevCtx.moveTo(ann.x1, ann.y1);
    prevCtx.lineTo(ann.x2, ann.y2);
    prevCtx.stroke();
  } else if (ann.type === 'circle') {
    prevCtx.beginPath();
    prevCtx.ellipse(ann.cx, ann.cy, ann.rx + 10, ann.ry + 10, 0, 0, Math.PI * 2);
    prevCtx.stroke();
  } else if (ann.type === 'magnifier') {
    prevCtx.beginPath();
    prevCtx.arc(ann.cx, ann.cy, ann.radius + 10, 0, Math.PI * 2);
    prevCtx.stroke();
  }
  prevCtx.restore();

  // Handles
  for (const h of getHandles(ann)) {
    prevCtx.save();
    prevCtx.beginPath();
    prevCtx.arc(h.x, h.y, HANDLE_R, 0, Math.PI * 2);
    prevCtx.fillStyle   = '#fff';
    prevCtx.strokeStyle = ann.color || '#4361ee';
    prevCtx.lineWidth   = 2.5;
    prevCtx.shadowColor = 'rgba(0,0,0,0.30)';
    prevCtx.shadowBlur  = 4;
    prevCtx.fill();
    prevCtx.shadowBlur  = 0;
    prevCtx.stroke();
    if (h.id === 'center') {   // Kreuz: zeigt Verschiebbarkeit
      prevCtx.strokeStyle = '#999';
      prevCtx.lineWidth   = 1.5;
      prevCtx.beginPath();
      prevCtx.moveTo(h.x - 3.5, h.y); prevCtx.lineTo(h.x + 3.5, h.y);
      prevCtx.moveTo(h.x, h.y - 3.5); prevCtx.lineTo(h.x, h.y + 3.5);
      prevCtx.stroke();
    }
    prevCtx.restore();
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   UNDO / CLEAR / DELETE
   ══════════════════════════════════════════════════════════════════════════ */

function pushUndo() {
  undoStack.push(annotations.map(cloneAnn));
  if (undoStack.length > 60) undoStack.shift();
}

function undoStep() {
  if (!undoStack.length) return;
  annotations = undoStack.pop();
  selectedId  = null;
  redrawAll();
}

function clearAll() {
  pushUndo();
  annotations = [];
  selectedId  = null;
  redrawAll();
}

function deleteSelected() {
  if (selectedId == null) return;
  pushUndo();
  annotations = annotations.filter(a => a.id !== selectedId);
  selectedId  = null;
  redrawAll();
}

/* ══════════════════════════════════════════════════════════════════════════
   OVERLAY-LIFECYCLE
   ══════════════════════════════════════════════════════════════════════════ */

export function wireAnnotate() {
  annotateBtn?.addEventListener('click',  openAnnotate);
  closeBtn?.addEventListener('click',     closeAnnotate);
  saveBtn?.addEventListener('click',      saveAnnotation);
  undoBtn?.addEventListener('click',      undoStep);
  clearBtn?.addEventListener('click',     clearAll);
  deleteBtn?.addEventListener('click',    deleteSelected);

  toolBtns.forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

  colorBtns.forEach(b => b.addEventListener('click', () => {
    color = b.dataset.color;
    colorBtns.forEach(c => c.classList.toggle('at-color-active', c === b));
  }));

  sizeSlider?.addEventListener('input', () => { sizeMul = +sizeSlider.value; });
  zoomSlider?.addEventListener('input', () => { magZoom = +zoomSlider.value; });

  drawCanvas?.addEventListener('mousedown',  onDown);
  drawCanvas?.addEventListener('mousemove',  onMove);
  drawCanvas?.addEventListener('mouseup',    onUp);
  drawCanvas?.addEventListener('mouseleave', onLeave);

  document.addEventListener('keydown', e => {
    if (!overlay || overlay.classList.contains('hidden')) return;
    if (e.key === 'Escape') {
      if (selectedId !== null) { selectedId = null; renderHandles(); }
      else { closeAnnotate(); }
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

  // Cursor-Position über dem Desktop-WebView tracken
  document.getElementById('desktop-wv')?.addEventListener('mousemove', e => {
    const wv = document.getElementById('desktop-wv');
    if (!wv) return;
    const r = wv.getBoundingClientRect();
    lastCursorPos = { x: e.clientX - r.left, y: e.clientY - r.top };
  });

  cropSaveBtn?.addEventListener('click', saveAnnotation);

  cropResetBtn?.addEventListener('click', () => {
    cropRect = null;
    cropResetBtn.classList.add('hidden');
    cropSaveBtn?.classList.add('hidden');
    if (hintEl) hintEl.textContent = 'Ausschnitt: Bereich ziehen → beim Speichern wird nur dieser Bereich exportiert';
    renderHandles();
  });

  // Crop: document-level mousemove → flüssig auch außerhalb des Canvas
  document.addEventListener('mousemove', e => {
    if (!overlay || overlay.classList.contains('hidden')) return;
    if (dragMode !== 'crop' && dragMode !== 'crop-handle') return;
    const W = drawCanvas.width, H = drawCanvas.height;
    const r = drawCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(W, (e.clientX - r.left) * (W / r.width)));
    const y = Math.max(0, Math.min(H, (e.clientY - r.top)  * (H / r.height)));
    if (dragMode === 'crop') {
      cropRect = { x1: dragStart.x, y1: dragStart.y, x2: x, y2: y };
    } else {
      applyCropHandle(activeCropHandle, x, y);
    }
    renderHandles();
  });

  // Mouseup außerhalb des Canvas: Crop-Drag trotzdem finalisieren
  document.addEventListener('mouseup', () => {
    if (dragMode !== 'crop' && dragMode !== 'crop-handle') return;
    const wasCropHandle = dragMode === 'crop-handle';
    dragMode = null;
    if (wasCropHandle) {
      activeCropHandle = null;
      if (cropRect) {
        cropRect = normRect(cropRect);
        const nr = cropRect;
        if (hintEl && nr.x2 - nr.x1 >= 8 && nr.y2 - nr.y1 >= 8)
          hintEl.textContent = `Ausschnitt aktiv (${Math.round(nr.x2 - nr.x1)} × ${Math.round(nr.y2 - nr.y1)} px) · ↓ Ausschnitt speichern oder neu ziehen`;
      }
      renderHandles();
      return;
    }
    // 'crop'-Modus: onUp hat In-Canvas-Fall bereits behandelt (dragMode schon null)
    // Wir landen hier nur wenn außerhalb losgelassen wurde.
    if (!cropRect) return;
    const nr = normRect(cropRect);
    if (nr.x2 - nr.x1 < 8 || nr.y2 - nr.y1 < 8) {
      cropRect = null;
      cropResetBtn?.classList.add('hidden');
      cropSaveBtn?.classList.add('hidden');
      if (hintEl) hintEl.textContent = 'Ausschnitt: Bereich ziehen → beim Speichern wird nur dieser Bereich exportiert';
    } else {
      cropRect = nr;
      cropResetBtn?.classList.remove('hidden');
      cropSaveBtn?.classList.remove('hidden');
      if (hintEl) hintEl.textContent = `Ausschnitt aktiv (${Math.round(nr.x2 - nr.x1)} × ${Math.round(nr.y2 - nr.y1)} px) · ↓ Ausschnitt speichern oder neu ziehen`;
    }
    renderHandles();
  });
}

function setTool(name) {
  tool = name;
  toolBtns.forEach(b => b.classList.toggle('at-tool-active', b.dataset.tool === name));
  const cursors = { select: 'default', arrow: 'crosshair', circle: 'crosshair', magnifier: 'zoom-in', crop: 'crosshair' };
  if (drawCanvas) drawCanvas.style.cursor = cursors[name] ?? 'crosshair';
  // prevCanvas neu zeichnen (Handles + Crop-Overlay)
  renderHandles();
  const hints = {
    select:    'Klicken = auswählen · Ziehen = verschieben · Handles = bearbeiten · Entf = löschen',
    arrow:     'Pfeil: Startpunkt klicken · zur Spitze ziehen',
    circle:    'Kreis: Ecke klicken · zur gegenüberliegenden Ecke ziehen',
    magnifier: 'Lupe: Mittelpunkt klicken · Ziehen = Radius',
    crop:      'Ausschnitt: Bereich ziehen → beim Speichern wird nur dieser Bereich exportiert',
  };
  if (hintEl) hintEl.textContent = hints[name] ?? '';
}

async function openAnnotate() {
  const desktopWv = document.getElementById('desktop-wv');
  if (!desktopWv) return;

  let nativeImg;
  try { nativeImg = await desktopWv.capturePage(); } catch { return; }

  const { width, height } = nativeImg.getSize();
  [bgCanvas, drawCanvas, prevCanvas].forEach(cv => { cv.width = width; cv.height = height; });
  bgCtx   = bgCanvas.getContext('2d');
  drawCtx = drawCanvas.getContext('2d');
  prevCtx = prevCanvas.getContext('2d');

  const img = new Image();
  await new Promise(res => { img.onload = res; img.src = nativeImg.toDataURL(); });
  bgCtx.drawImage(img, 0, 0);

  // Optional: Mauszeiger einzeichnen
  if (cursorCb?.checked && lastCursorPos) {
    const dpr = window.devicePixelRatio || 1;
    drawCursorIcon(bgCtx, lastCursorPos.x * dpr, lastCursorPos.y * dpr, dpr);
  }

  // Canvas-Stack proportional in den Viewport einpassen
  const toolbarH = document.getElementById('annotate-toolbar')?.offsetHeight ?? 56;
  const availW   = window.innerWidth  - 32;
  const availH   = window.innerHeight - toolbarH - 32;
  const ratio    = Math.min(1, availW / width, availH / height);
  if (stack) {
    stack.style.width  = Math.round(width  * ratio) + 'px';
    stack.style.height = Math.round(height * ratio) + 'px';
  }

  annotations = [];
  undoStack   = [];
  selectedId  = null;
  dragMode    = null;
  cropRect    = null;
  cropResetBtn?.classList.add('hidden');
  cropSaveBtn?.classList.add('hidden');
  overlay.classList.remove('hidden');
  setTool('arrow');
  document.querySelector('#annotate-colors [data-color]')?.click();
  redrawAll();
}

function closeAnnotate() {
  overlay.classList.add('hidden');
  dragMode    = null;
  selectedId  = null;
  annotations = [];
  undoStack   = [];
  cropRect    = null;
  cropResetBtn?.classList.add('hidden');
  cropSaveBtn?.classList.add('hidden');
}

function saveAnnotation() {
  // Zuschnitt anwenden wenn aktiv
  let sx = 0, sy = 0, sw = bgCanvas.width, sh = bgCanvas.height;
  if (cropRect) {
    const nr = normRect(cropRect);
    sx = nr.x1; sy = nr.y1;
    sw = Math.max(1, nr.x2 - nr.x1);
    sh = Math.max(1, nr.y2 - nr.y1);
  }
  const out = document.createElement('canvas');
  out.width  = sw;
  out.height = sh;
  const ctx  = out.getContext('2d');
  ctx.drawImage(bgCanvas,   sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.drawImage(drawCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  out.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: `annotation_${Date.now()}.png` }).click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

/* ══════════════════════════════════════════════════════════════════════════
   MAUS-EVENTS
   ══════════════════════════════════════════════════════════════════════════ */

function cvPos(e) {
  const r = drawCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (drawCanvas.width  / r.width),
    y: (e.clientY - r.top)  * (drawCanvas.height / r.height),
  };
}

function onDown(e) {
  if (e.button !== 0) return;
  const { x, y } = cvPos(e);
  dragStart = { x, y };

  if (tool === 'crop') {
    cropRect = { x1: x, y1: y, x2: x, y2: y };
    dragMode = 'crop';
    return;
  }

  if (tool === 'select') {
    // Handle zuerst prüfen (hat Vorrang vor Annotation-Körper)
    const h = handleAt(x, y);
    if (h) {
      const ann = annotations.find(a => a.id === selectedId);
      if (!ann) return;
      pushUndo();
      originAnn    = cloneAnn(ann);
      activeHandle = h.id;
      dragMode     = (h.id === 'center') ? 'move' : 'handle';
      drawCanvas.style.cursor = h.cursor;
      return;
    }
    // Annotation-Treffer?
    const hit = hitTestAll(x, y);
    if (hit) {
      selectedId   = hit.id;
      pushUndo();
      originAnn    = cloneAnn(hit);
      activeHandle = null;
      dragMode     = 'move';
      drawCanvas.style.cursor = 'grabbing';
      renderHandles();
    } else {
      selectedId = null;
      dragMode   = null;
      renderHandles();
    }
    return;
  }

  // Erstell-Modus
  pushUndo();
  dragMode = 'create';
}

function onMove(e) {
  const { x, y } = cvPos(e);

  if (dragMode === 'move') {
    const ann = annotations.find(a => a.id === selectedId);
    if (!ann || !originAnn) return;
    applyMove(ann, originAnn, x - dragStart.x, y - dragStart.y);
    redrawAll();
    return;
  }

  if (dragMode === 'handle') {
    const ann = annotations.find(a => a.id === selectedId);
    if (!ann) return;
    // 'center'-Handle → Verschieben via Delta
    if (activeHandle === 'center') {
      applyMove(ann, originAnn, x - dragStart.x, y - dragStart.y);
    } else {
      applyHandle(ann, activeHandle, x, y);
    }
    redrawAll();
    return;
  }

  if (dragMode === 'crop' || dragMode === 'crop-handle') {
    return; // wird vollständig durch document-mousemove-Listener behandelt
  }

  if (dragMode === 'create') {
    prevCtx.clearRect(0, 0, prevCanvas.width, prevCanvas.height);
    renderCropOverlay();
    const preview = buildAnnotation(dragStart.x, dragStart.y, x, y, true);
    if (preview) drawAnnotation(prevCtx, preview);
    return;
  }

  // Kein Drag: Cursor-Feedback
  if (tool === 'select') {
    const h = handleAt(x, y);
    if (h) { drawCanvas.style.cursor = h.cursor; }
    else if (hitTestAll(x, y)) { drawCanvas.style.cursor = 'grab'; }
    else { drawCanvas.style.cursor = 'default'; }
  }
  if (tool === 'crop' && cropRect) {
    const h = cropHandleAt(x, y);
    drawCanvas.style.cursor = h ? h.cursor : 'crosshair';
  }
  if (tool === 'magnifier') {
    prevCtx.clearRect(0, 0, prevCanvas.width, prevCanvas.height);
    const seed = (nextId * 7919 + 1337) & 0x7fffffff || 1;
    drawMagnifier(prevCtx, bgCanvas, x, y, 100, magZoom, color, sizeMul, mkRng(seed));
  }
}

function onUp(e) {
  if (dragMode === 'move' || dragMode === 'handle') {
    dragMode     = null;
    activeHandle = null;
    originAnn    = null;
    drawCanvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
    return;
  }

  if (dragMode === 'crop-handle') {
    dragMode         = null;
    activeCropHandle = null;
    if (cropRect) cropRect = normRect(cropRect);
    drawCanvas.style.cursor = 'crosshair';
    renderHandles();
    return;
  }

  if (dragMode === 'crop') {
    dragMode = null;
    const nr = normRect(cropRect);
    if (nr.x2 - nr.x1 < 8 || nr.y2 - nr.y1 < 8) {
      cropRect = null;
      cropResetBtn?.classList.add('hidden');
      cropSaveBtn?.classList.add('hidden');
      if (hintEl) hintEl.textContent = 'Ausschnitt: Bereich ziehen → beim Speichern wird nur dieser Bereich exportiert';
    } else {
      cropRect = nr;
      cropResetBtn?.classList.remove('hidden');
      cropSaveBtn?.classList.remove('hidden');
      if (hintEl) hintEl.textContent = `Ausschnitt aktiv (${Math.round(nr.x2 - nr.x1)} × ${Math.round(nr.y2 - nr.y1)} px) · ↓ Ausschnitt speichern oder neu ziehen`;
    }
    renderHandles();
    return;
  }

  if (dragMode !== 'create') return;
  dragMode = null;
  prevCtx.clearRect(0, 0, prevCanvas.width, prevCanvas.height);

  const { x, y } = cvPos(e);
  const ann = buildAnnotation(dragStart.x, dragStart.y, x, y, false);
  if (ann) {
    annotations.push(ann);
    selectedId = ann.id;
    redrawAll();
  } else {
    // Zu kurze Geste: Undo-Eintrag wieder verwerfen
    undoStack.pop();
  }
}

function onLeave() {
  if (dragMode === 'create') {
    prevCtx.clearRect(0, 0, prevCanvas.width, prevCanvas.height);
    renderCropOverlay();
    dragMode = null;
    undoStack.pop();  // Abgebrochene Geste: Undo-Eintrag rückgängig machen
  }
  // 'crop': nicht abbrechen – letzter geklemmter Stand bleibt, mouseup landet auf document
  if (tool === 'magnifier' && dragMode !== 'crop') {
    prevCtx?.clearRect(0, 0, prevCanvas.width, prevCanvas.height);
    renderCropOverlay();
    if (selectedId !== null) renderHandles();
  }
}

/* ── Annotation erstellen ────────────────────────────────────────────────── */

/**
 * Baut ein Annotationsobjekt. preview=true → nextId nicht erhöhen (Vorschau).
 */
function buildAnnotation(x1, y1, x2, y2, preview) {
  const id   = preview ? 0 : nextId++;
  const seed = (preview ? nextId : id) * 7919 + 1337 & 0x7fffffff || 1;
  if (tool === 'arrow' && Math.hypot(x2 - x1, y2 - y1) >= 6) {
    return { id, seed, type: 'arrow', x1, y1, x2, y2, color, size: sizeMul };
  }
  if (tool === 'circle') {
    const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
    if (rx >= 5 && ry >= 5)
      return { id, seed, type: 'circle', cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, rx, ry, color, size: sizeMul };
  }
  if (tool === 'magnifier') {
    const radius = Math.max(20, Math.hypot(x2 - x1, y2 - y1));
    return { id, seed, type: 'magnifier', cx: x1, cy: y1, radius, zoom: magZoom, color, size: sizeMul };
  }
  return null;
}
