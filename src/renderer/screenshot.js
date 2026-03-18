import { state }           from './state.js';
import { FRAME_HEAD_H }    from './constants.js';
import { sleep, toast }    from './utils.js';

const ssBtn     = document.getElementById('screenshot-btn');
const ssMode    = document.getElementById('ss-mode');
const ssOverlay = document.getElementById('ss-overlay');
const workspace = document.getElementById('workspace');
const desktopWv = document.getElementById('desktop-wv');

export function wireScreenshot() {
  ssBtn.addEventListener('click', captureScreenshot);
}

/* ── Canvas-Hilfsfunktionen ──────────────────────────────────────────────── */

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,      y + h, x,       y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x,      y,     x + r,   y,         r);
  ctx.closePath();
}

async function imgElFromNative(nativeImg) {
  const el = new Image();
  await new Promise(res => { el.onload = res; el.src = nativeImg.toDataURL(); });
  return el;
}

/**
 * Zeichnet Geräterahmen + Webview-Inhalt auf den Canvas.
 * x/y sind Workspace-relative Pixel-Koordinaten.
 */
function drawDeviceFrame(ctx, def, scale, x, y, visW, visH, imgEl) {
  const d         = def.id;
  const isPhone   = d === 'iphone' || d === 'android';
  const isTablet  = d === 'tablet';
  const darkFrame = isPhone || isTablet;
  const br        = isPhone ? 46 * scale : isTablet ? 24 * scale : 8;

  // Rahmen-Hintergrund mit Schatten
  ctx.save();
  ctx.shadowColor   = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur    = 24 * scale;
  ctx.shadowOffsetY = 5 * scale;
  roundRect(ctx, x, y, visW, visH, br);
  ctx.fillStyle = darkFrame ? '#1c1c1e' : '#e8e8ed';
  ctx.fill();
  ctx.restore();

  // Webview-Inhalt in Viewport-Bereich einzeichnen
  const FH = FRAME_HEAD_H * scale;
  const ft = (def.frame?.t ?? 0) * scale;
  const fb = (def.frame?.b ?? 0) * scale;
  const fl = (def.frame?.l ?? 0) * scale;
  const fr = (def.frame?.r ?? 0) * scale;
  const vpX = x + fl,       vpY = y + FH + ft;
  const vpW = visW - fl - fr, vpH = visH - FH - ft - fb;

  if (imgEl && vpW > 0 && vpH > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(vpX, vpY, vpW, vpH);
    ctx.clip();
    ctx.drawImage(imgEl, vpX, vpY, vpW, vpH);
    ctx.restore();
  }

  // Dynamic Island (iPhone)
  if (d === 'iphone') {
    const iW = 96 * scale, iH = 30 * scale;
    ctx.fillStyle = '#000';
    roundRect(ctx, x + visW / 2 - iW / 2, y + FH + 4 * scale, iW, iH, 20 * scale);
    ctx.fill();
  }
  // Kamera-Punkt (Android, Tablet)
  if (d === 'android' || d === 'tablet') {
    ctx.fillStyle = '#3a3a3c';
    ctx.beginPath();
    ctx.arc(x + visW / 2, y + FH + (ft / 2), 4 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  // Home-Indicator
  if (isPhone || isTablet) {
    const hW = (isTablet ? 70 : 100) * scale, hH = 4 * scale;
    ctx.fillStyle = '#636366';
    roundRect(ctx, x + visW / 2 - hW / 2, y + visH - fb / 2 - hH / 2, hW, hH, hH / 2);
    ctx.fill();
  }
}

/* ── Screenshot-Capture ──────────────────────────────────────────────────── */

export async function captureScreenshot() {
  // 1. HUDs ausblenden, Interaktion sperren, kurz warten
  document.body.classList.add('screenshot-mode');
  workspace.style.pointerEvents = 'none';
  await sleep(220);   // HUD-Transition abwarten

  try {
    // 2. Alle Webviews einzeln erfassen (zuverlässig für separate WebContents)
    let desktopNative = null;
    try { desktopNative = await desktopWv.capturePage(); } catch { /* ignore */ }

    const wsBr = workspace.getBoundingClientRect();
    const panelCaptures = [];
    for (const [, p] of state.panels) {
      const wv = p.decoEl.querySelector('.panel-webview');
      if (!wv) continue;
      try {
        const nativeImg = await wv.capturePage();
        const br        = p.decoEl.getBoundingClientRect();
        panelCaptures.push({
          p,
          nativeImg,
          relX: br.left - wsBr.left,   // Position relativ zum Workspace
          relY: br.top  - wsBr.top,
          visW: br.width,
          visH: br.height,
        });
      } catch { /* ignore */ }
    }

    // 3. Overlay erst NACH dem Capture zeigen (sonst wird es mitgeknipst)
    ssOverlay?.classList.remove('hidden');

    const mode = ssMode?.value ?? 'single';

    if (mode === 'combined' || mode === 'workspace') {
      await renderWorkspaceCanvas(desktopNative, panelCaptures);
    } else {
      // Einzeln: Desktop als Vollbild
      if (desktopNative) {
        const cv = document.createElement('canvas');
        const sz = desktopNative.getSize();
        cv.width = sz.width; cv.height = sz.height;
        cv.getContext('2d').drawImage(await imgElFromNative(desktopNative), 0, 0);
        await blobDownload(cv, `Desktop_${sz.width}x${sz.height}.png`);
        await sleep(100);
      }
      // Einzeln: jedes Panel mit Geräterahmen
      for (const { p, nativeImg, visW, visH } of panelCaptures) {
        const cv    = document.createElement('canvas');
        cv.width    = Math.round(visW);
        cv.height   = Math.round(visH);
        const ctx   = cv.getContext('2d');
        const imgEl = await imgElFromNative(nativeImg);
        drawDeviceFrame(ctx, p.def, p.scale ?? state.panelScale, 0, 0, visW, visH, imgEl);
        await blobDownload(cv, `${p.def.label}_${Math.round(visW)}x${Math.round(visH)}.png`);
        await sleep(100);
      }
    }

    toast('Screenshot gespeichert', 'success');
  } catch (err) {
    console.error('Screenshot:', err);
    toast('Screenshot fehlgeschlagen', 'error');
  } finally {
    document.body.classList.remove('screenshot-mode');
    ssOverlay?.classList.add('hidden');
    workspace.style.pointerEvents = '';
  }
}

/**
 * Workspace-Canvas: Desktop-WebView als Hintergrund, Panels mit Geräterahmen
 * an ihrer tatsächlichen Position — genau so wie in der App sichtbar.
 */
async function renderWorkspaceCanvas(desktopNative, panelCaptures) {
  const W = state.wsRect.w, H = state.wsRect.h;
  const cv  = document.createElement('canvas');
  cv.width  = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // Workspace-Hintergrund (Punkte-Muster)
  ctx.fillStyle = '#eef0f6';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(148,152,185,0.32)';
  for (let px = 11; px < W; px += 22)
    for (let py = 11; py < H; py += 22) {
      ctx.beginPath(); ctx.arc(px, py, 1, 0, Math.PI * 2); ctx.fill();
    }

  // Desktop-WebView als Hintergrund
  if (desktopNative) {
    const imgEl = await imgElFromNative(desktopNative);
    ctx.drawImage(imgEl, 0, 0, W, H);
  }

  // Panels: größte zuerst (tiefster Z-Stack)
  const sorted = [...panelCaptures].sort((a, b) => b.visW * b.visH - a.visW * a.visH);
  for (const { p, nativeImg, relX, relY, visW, visH } of sorted) {
    const imgEl = await imgElFromNative(nativeImg);
    drawDeviceFrame(ctx, p.def, p.scale ?? state.panelScale, relX, relY, visW, visH, imgEl);
  }

  await blobDownload(cv, `screenshare_workspace_${Date.now()}.png`);
}

/* ── Download-Helfer ─────────────────────────────────────────────────────── */

function blobDownload(canvas, name) {
  return new Promise(res => {
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
      res();
    }, 'image/png');
  });
}

