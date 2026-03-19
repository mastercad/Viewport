import { state }               from './state.js';
import { sleep, toast }        from './utils.js';
import { screenshotAllPanels } from './panels.js';
export { panelCompositeLayout } from './screenshot-utils.js';

const ssBtn     = document.getElementById('screenshot-btn');
const ssMode    = document.getElementById('ss-mode');
const workspace = document.getElementById('workspace');
const desktopWv = document.getElementById('desktop-wv');

export function wireScreenshot() {
  ssBtn.addEventListener('click', captureScreenshot);
}

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

async function captureDesktopPanel() {
  if (typeof desktopWv.getWebContentsId !== 'function') return null;
  // Main-Prozess übernimmt alles: kennt Fenstergröße, forciert Viewport per
  // enableDeviceEmulation auf Workspace+Toolbar-Höhe, capturePage, stellt zurück.
  // Kein CSS-Hack, kein Renderer-seitiges Polling erforderlich.
  const res = await window.ss.captureDesktopWv(desktopWv.getWebContentsId());
  if (!res?.png) return null;
  return {
    id: 'desktop', label: 'Desktop',
    w: res.w, h: res.h, visW: res.w, visH: res.h,
    wsH: res.wsH,
    png: res.png,
  };
}

export async function captureScreenshot() {
  workspace.style.pointerEvents = 'none';
  document.body.classList.add('screenshot-mode');
  await sleep(200); // desktop-wv braucht Zeit um auf bottom:0 zu reflowieren
  try {
    const mode = ssMode?.value ?? 'single';

    if (mode === 'combined') {
      // WYSIWYG: gesamter Workspace-Bereich als ein Bildschirmfoto
      await captureWorkspaceSnapshot();
      toast('Screenshot gespeichert', 'success');
      return;
    }

    // Desktop ZUERST – vor Panels, kein Overlay einblenden (WYSIWYG)
    const desktopResult = await captureDesktopPanel();
    const panelResults  = state.panels.size > 0 ? (await screenshotAllPanels()) : [];

    const results = [
      ...(desktopResult ? [desktopResult] : []),
      ...panelResults,
    ];

    if (!results.length) { toast('Screenshot fehlgeschlagen', 'error'); return; }

    if (mode === 'workspace' && results.length > 1) {
      await downloadWorkspaceComposite(results);
    } else {
      for (const r of results) {
        // Desktop bekommt weiterhin einen Monitor-Rahmen (der CSS-Monitor-Overlay
        // ist in screenshot-mode versteckt und landet nicht im captureDesktopWv).
        // Panel-Screenshots sind WYSIWYG – kein weiteres Compositing nötig.
        let png = r.png;
        if (r.id === 'desktop') {
          png = (await composeMonitorFrame(r)) ?? r.png;
        }
        downloadBase64(png, ssFilename(r.label, r.w, r.h));
        await sleep(120);
      }
    }
    toast('Screenshot gespeichert', 'success');
  } catch (err) {
    console.error('Screenshot:', err);
    toast('Screenshot fehlgeschlagen', 'error');
  } finally {
    document.body.classList.remove('screenshot-mode');
    workspace.style.pointerEvents = '';
  }
}

/** Nimmt den sichtbaren Workspace-Bereich als eine einzige Aufnahme auf –
 *  exakt wie er im Fenster aussieht, inkl. aller CSS-Geräterahmen und Positionen. */
async function captureWorkspaceSnapshot() {
  const br  = workspace.getBoundingClientRect();
  const png = await window.ss.captureRect({ x: br.left, y: br.top, width: br.width, height: br.height });
  if (!png) throw new Error('captureRect failed');
  downloadBase64(png, ssFilename('screenshare_workspace'));
}

async function downloadWorkspaceComposite(results) {
  const { wsRect } = state;
  const PAD = 20;
  const cv  = document.createElement('canvas');
  cv.width  = wsRect.w + PAD * 2;
  cv.height = wsRect.h + PAD * 2;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#e8eaf0';
  ctx.fillRect(0, 0, cv.width, cv.height);

  // Desktop-Ansicht als Hintergrund
  const desktopR = results.find(r => r.id === 'desktop');
  const panelR   = results.filter(r => r.id !== 'desktop');

  if (desktopR) {
    const img = new Image();
    await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + desktopR.png; });
    const wsH  = desktopR.wsH ?? desktopR.visH;
    const srcH = Math.round(img.naturalHeight * wsH / desktopR.visH);
    ctx.drawImage(img, 0, 0, img.naturalWidth, srcH, PAD, PAD, wsRect.w, wsRect.h);
  }

  // Panels: WYSIWYG-PNGs an ihrer Workspace-Position einzeichnen.
  // Größte zuerst → kleinere liegen optisch vorne.
  const sorted = [...panelR].sort((a, b) => b.w * b.h - a.w * a.h);
  for (const r of sorted) {
    const img = new Image();
    await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + r.png; });
    ctx.drawImage(img, PAD + r.wsX, PAD + r.wsY, r.w, r.h);
  }

  await blobDownload(cv, ssFilename('screenshare_layout'));
}

/** Erzeugt einen einheitlichen Screenshot-Dateinamen mit Timestamp.
 *  @param {string} label  – Bezeichner (z.B. "Desktop", "screenshare_layout")
 *  @param {number} [w]    – Breite in px (optional)
 *  @param {number} [h]    – Höhe in px (optional)
 *  @returns {string} z.B. "Desktop_1920x1080_1742300000000.png" */
function ssFilename(label, w, h) {
  const size = (w && h) ? `_${w}x${h}` : '';
  return `${label}${size}_${Date.now()}.png`;
}

function downloadBase64(b64, name) {
  const a = document.createElement('a');
  a.href = 'data:image/png;base64,' + b64;
  a.download = name;
  a.click();
}

function blobDownload(canvas, name) {
  return new Promise(res => {
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
 a      =   
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
      res();
    }, 'image/png');
  });
}

function canvasToBase64(cv) {
  return new Promise(res => {
    cv.toBlob(blob => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result.split(',')[1]);
      reader.readAsDataURL(blob);
    }, 'image/png');
  });
}

/** Zeichnet einen Monitor-Rahmen um den Desktop-Screenshot. */
async function composeMonitorFrame(r) {
  // Bild zuerst laden – naturalWidth/Height entspricht den echten Pixeln des PNG
  // (captureRect liefert native Pixel, visW/visH sind CSS-Pixel → DPR kann > 1 sein).
  const img = new Image();
  await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + r.png; });
  const nW  = img.naturalWidth;
  const nH  = img.naturalHeight;
  const dpr = r.visW ? nW / r.visW : 1;   // device pixel ratio

  const BT     = Math.round(18  * dpr);
  const BLR    = Math.round(12  * dpr);
  const BC     = Math.round(24  * dpr);
  const NECK_W = Math.round(14  * dpr);
  const NECK_H = Math.round(18  * dpr);
  const BASE_W = Math.round(120 * dpr);
  const BASE_H = Math.round(8   * dpr);
  const CR     = Math.round(10  * dpr);
  const CAM_R  = Math.round(3   * dpr);

  const bodyW  = nW + BLR * 2;
  const bodyH  = nH + BT + BC;
  const totalW = bodyW;
  const totalH = bodyH + NECK_H + BASE_H;

  const cv  = document.createElement('canvas');
  cv.width  = totalW;
  cv.height = totalH;
  const ctx = cv.getContext('2d');

  // Monitor-Body
  ctx.fillStyle = '#1e1e24';
  roundRect(ctx, 0, 0, bodyW, bodyH, CR);
  ctx.fill();

  // Chin – einfaches Rect (Body-Radius deckt obere Ecken ab)
  ctx.fillStyle = '#252530';
  ctx.fillRect(0, nH + BT, bodyW, BC);

  // Kamera-Punkt
  ctx.fillStyle = '#3a3a3c';
  ctx.beginPath();
  ctx.arc(totalW / 2, BT / 2, CAM_R, 0, Math.PI * 2);
  ctx.fill();

  // Website-Inhalt in nativer Auflösung einzeichnen
  ctx.drawImage(img, BLR, BT, nW, nH);

  // Standfuss: Hals
  ctx.fillStyle = '#2a2a34';
  ctx.fillRect((totalW - NECK_W) / 2, bodyH, NECK_W, NECK_H);

  // Standfuss: Basis
  ctx.fillStyle = '#222230';
  roundRect(ctx, (totalW - BASE_W) / 2, bodyH + NECK_H, BASE_W, BASE_H, Math.round(4 * dpr));
  ctx.fill();

  return canvasToBase64(cv);
}
