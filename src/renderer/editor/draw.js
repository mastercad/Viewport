export function mkRng(seed) {
  let s = ((seed ^ 0xdeadbeef) >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

export function drawCursorIcon(ctx, x, y, s = 1) {
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

export function drawMarkerArrow(ctx, x1, y1, x2, y2, clr, sm, rng) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 6) return;

  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;              // Senkrechter Einheitsvektor

  const lw = (4.8 + rng() * 1.3) * sm;

  ctx.save();
  ctx.lineCap    = 'round';
  ctx.lineJoin   = 'round';
  ctx.strokeStyle = clr;
  ctx.fillStyle   = clr;

  ctx.globalAlpha = 0.60;
  ctx.beginPath();
  ctx.arc(
    x1 + (rng() - 0.5) * 2.5, y1 + (rng() - 0.5) * 2.5,
    lw * (0.52 + rng() * 0.28), 0, Math.PI * 2,
  );
  ctx.fill();

  const side    = rng() < 0.5 ? 1 : -1;
  const wobAmp  = Math.min(len * 0.072, 22) * (0.3 + rng() * 0.9);
  const cpT     = 0.34 + rng() * 0.32;
  const cpx     = x1 + dx * cpT + px * wobAmp * side;
  const cpy     = y1 + dy * cpT + py * wobAmp * side;

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

export function drawMarkerCircle(ctx, cx, cy, rx, ry, clr, sm, rng) {
  if (rx < 4 || ry < 4) return;

  const N = 8;
  ctx.save();
  ctx.lineCap    = 'round';
  ctx.lineJoin   = 'round';
  ctx.strokeStyle = clr;

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

export function drawMagnifier(ctx, bgCv, cx, cy, radius, zoom, clr, _sm, _rng) {
  if (radius < 15) return;

  // Linienstärken proportional zum Radius – unabhängig von sizeMul
  const ringW   = Math.max(3,   radius * 0.05);
  const shadowW = Math.max(5,   radius * 0.09);
  const glossW  = Math.max(1.5, radius * 0.03);
  const handleW = Math.max(4,   radius * 0.17);

  {
    const angle = Math.PI * 0.75; // 135° → unten-rechts
    const r0    = radius - 4;
    const hLen  = Math.max(22, radius * 0.72);
    const hx1   = cx + Math.cos(angle) * r0;
    const hy1   = cy + Math.sin(angle) * r0;
    const hx2   = cx + Math.cos(angle) * (r0 + hLen);
    const hy2   = cy + Math.sin(angle) * (r0 + hLen);

    ctx.save();
    ctx.lineCap       = 'round';
    ctx.strokeStyle   = clr;
    ctx.lineWidth     = handleW;
    ctx.globalAlpha   = 0.88;
    ctx.shadowColor   = 'rgba(0,0,0,0.40)';
    ctx.shadowBlur    = 10;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 5;
    ctx.beginPath();
    ctx.moveTo(hx1, hy1);
    ctx.lineTo(hx2, hy2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.shadowColor   = 'rgba(0,0,0,0.48)';
  ctx.shadowBlur    = 26;
  ctx.shadowOffsetY = 7;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 3, 0, Math.PI * 2);
  ctx.clip();
  ctx.shadowColor = 'transparent';

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

  const crossSize = Math.min(radius * 0.22, 14);
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth   = 1.2;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - crossSize, cy); ctx.lineTo(cx + crossSize, cy);
  ctx.moveTo(cx, cy - crossSize); ctx.lineTo(cx, cy + crossSize);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle   = 'rgba(0,0,0,0.38)';
  ctx.lineWidth     = shadowW;
  ctx.shadowColor   = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur    = 20;
  ctx.shadowOffsetY = 6;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
  ctx.strokeStyle = clr;
  ctx.lineWidth   = ringW;
  ctx.shadowColor = 'transparent';
  ctx.globalAlpha = 0.95;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, radius - 1.5, Math.PI * 1.05, Math.PI * 1.72);
  ctx.strokeStyle = 'rgba(255,255,255,0.50)';
  ctx.lineWidth   = glossW;
  ctx.globalAlpha = 1;
  ctx.stroke();

  ctx.restore();
}
