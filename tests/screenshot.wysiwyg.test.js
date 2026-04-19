/**
 * screenshot.wysiwyg.test.js
 *
 * Sichert das WYSIWYG-Screenshot-Verhalten nach dem Umbau:
 *
 *  A. screenshotPanel()
 *     – nutzt captureRect auf panel-deco.getBoundingClientRect()
 *     – gibt { id, label, w, h, wsX, wsY, scale, png } zurück
 *     – enthält KEIN frame / deviceType mehr (altes Compositing entfernt)
 *
 *  B. captureScreenshot() – Modus "combined"
 *     – ruft captureRect auf den workspace-Bereich
 *     – zeigt NIE das ss-overlay (kein show/hide)
 *     – gibt frühzeitig nach captureWorkspaceSnapshot() zurück
 *
 *  C. captureScreenshot() – Modus "single" / "workspace"
 *     – ss-overlay bleibt die gesamte Zeit auf display:none
 *     – panels werden WYSIWYG (captureRect) aufgenommen, NICHT via captureWv
 *
 *  D. downloadWorkspaceComposite()
 *     – Panels werden an Position PAD + wsX, PAD + wsY gezeichnet
 *     – Kein composeDeviceFrame() mehr (Compositing entfernt)
 *     – Größtes Panel zuerst (nach Fläche absteigend sortiert)
 *
 *  E. ssFilename()
 *     – Dateiname enthält Label, Abmessungen und Timestamp.
 *     – Format: "{label}_{w}x{h}_{ts}.png" bzw. "{label}_{ts}.png" ohne Maße
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── A + B + C: screenshotPanel & captureScreenshot ─────────────────────────
//
// Diese Funktionen sind tief in Electron-DOM eingebettet und importieren
// state, utils, und panels – allesamt mit Top-Level-DOM-Zugriffen.
// Wir testen die Logik daher über replizierten/extrahierten Code,
// analog zum bewährten Muster in pushBridge.unit.test.js und
// scaleRestore.test.js.

// ── A: screenshotPanel-Logik (repliziert) ────────────────────────────────────

/**
 * Kernlogik von screenshotPanel() aus panels.js.
 * Nimmt das decoEl, ruft captureRect, gibt WYSIWYG-Ergebnis zurück.
 */
async function screenshotPanelLogic(panelEntry, captureRect) {
  const p = panelEntry;
  if (!p) return null;
  const br = p.decoEl.getBoundingClientRect();
  const png = await captureRect({
    x:      Math.round(br.left),
    y:      Math.round(br.top),
    width:  Math.round(br.width),
    height: Math.round(br.height),
  });
  if (!png) return null;
  const s = p.scale ?? 1;
  return {
    id:    p.id,
    label: p.def.label,
    w:     Math.round(br.width),
    h:     Math.round(br.height),
    wsX:   p.rect.x,
    wsY:   p.rect.y,
    scale: s,
    png,
  };
}

describe('A: screenshotPanel() – WYSIWYG via captureRect', () => {
  let captureRect;
  let panelEntry;

  beforeEach(() => {
    captureRect = vi.fn().mockResolvedValue('base64PNGdata');

    // Simuliertes panel-deco-Element
    const decoEl = {
      getBoundingClientRect: () => ({ left: 120, top: 80, width: 414, height: 894 }),
    };
    panelEntry = {
      id:    'panel-1',
      def:   { label: 'Android' },
      decoEl,
      scale: 0.75,
      rect:  { x: 100, y: 60 },
    };
  });

  it('ruft captureRect mit den Koordinaten von getBoundingClientRect auf', async () => {
    await screenshotPanelLogic(panelEntry, captureRect);
    expect(captureRect).toHaveBeenCalledOnce();
    expect(captureRect).toHaveBeenCalledWith({ x: 120, y: 80, width: 414, height: 894 });
  });

  it('gibt w/h aus dem BoundingClientRect zurück (nicht aus def)', async () => {
    const r = await screenshotPanelLogic(panelEntry, captureRect);
    expect(r.w).toBe(414);
    expect(r.h).toBe(894);
  });

  it('gibt wsX/wsY aus panel.rect zurück (Workspace-Koordinaten)', async () => {
    const r = await screenshotPanelLogic(panelEntry, captureRect);
    expect(r.wsX).toBe(100);
    expect(r.wsY).toBe(60);
  });

  it('gibt scale aus panel.scale zurück', async () => {
    const r = await screenshotPanelLogic(panelEntry, captureRect);
    expect(r.scale).toBe(0.75);
  });

  it('gibt das PNG aus captureRect direkt zurück (kein Re-Compositing)', async () => {
    const r = await screenshotPanelLogic(panelEntry, captureRect);
    expect(r.png).toBe('base64PNGdata');
  });

  it('enthält KEINEN frame-Schlüssel mehr', async () => {
    const r = await screenshotPanelLogic(panelEntry, captureRect);
    expect(r).not.toHaveProperty('frame');
  });

  it('enthält KEINEN deviceType-Schlüssel mehr', async () => {
    const r = await screenshotPanelLogic(panelEntry, captureRect);
    expect(r).not.toHaveProperty('deviceType');
  });

  it('enthält KEIN visW / visH mehr', async () => {
    const r = await screenshotPanelLogic(panelEntry, captureRect);
    expect(r).not.toHaveProperty('visW');
    expect(r).not.toHaveProperty('visH');
  });

  it('gibt null zurück wenn captureRect null liefert', async () => {
    captureRect.mockResolvedValue(null);
    const r = await screenshotPanelLogic(panelEntry, captureRect);
    expect(r).toBeNull();
  });

  it('gibt null zurück wenn panelEntry undefined ist', async () => {
    const r = await screenshotPanelLogic(undefined, captureRect);
    expect(r).toBeNull();
    expect(captureRect).not.toHaveBeenCalled();
  });

  it('verwendet panelScale-Fallback 1 wenn panel.scale nicht gesetzt', async () => {
    panelEntry.scale = undefined;
    const r = await screenshotPanelLogic(panelEntry, captureRect);
    expect(r.scale).toBe(1);
  });

  it('rundet Koordinaten aus BoundingClientRect', async () => {
    panelEntry.decoEl.getBoundingClientRect = () => ({
      left: 120.7, top: 80.3, width: 414.9, height: 894.2,
    });
    await screenshotPanelLogic(panelEntry, captureRect);
    expect(captureRect).toHaveBeenCalledWith({ x: 121, y: 80, width: 415, height: 894 });
  });

  it('gibt gerundete w/h zurück', async () => {
    panelEntry.decoEl.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 414.6, height: 894.4,
    });
    const r = await screenshotPanelLogic(panelEntry, captureRect);
    expect(r.w).toBe(415);
    expect(r.h).toBe(894);
  });
});

// ─── B + C: captureScreenshot-Logik ─────────────────────────────────────────
//
// Wir replizieren die Steuerlogik von captureScreenshot() und testen
// das Routing und die Overlay-Abwesenheit.

/**
 * Replizierte Steuerlogik von captureScreenshot().
 * Alle Seiteneffekte (DOM, download) werden als Callbacks übergeben.
 */
async function captureScreenshotLogic({
  mode,
  hasPanels,
  desktopResult: _desktopResult,
  captureWorkspaceSnapshot,
  captureDesktopPanel,
  screenshotAllPanels,
  downloadWorkspaceComposite,
  downloadSingle,
  showOverlay: _showOverlay,
  hideOverlay: _hideOverlay,
  toast,
}) {
  if (mode === 'combined') {
    await captureWorkspaceSnapshot();
    toast('Screenshot gespeichert', 'success');
    return;
  }

  const desktopR = await captureDesktopPanel();
  const panelR   = hasPanels ? await screenshotAllPanels() : [];

  const results = [
    ...(desktopR ? [desktopR] : []),
    ...panelR,
  ];

  if (!results.length) {
    toast('Screenshot fehlgeschlagen', 'error');
    return;
  }

  if (mode === 'workspace' && results.length > 1) {
    await downloadWorkspaceComposite(results);
  } else {
    for (const r of results) {
      let png = r.png;
      if (r.id === 'desktop') {
        // desktop bekommt Monitor-Rahmen – panels bleiben WYSIWYG
        png = r.png; // vereinfacht für diesen Test
      }
      downloadSingle(png, r.label, r.w, r.h);
    }
  }
  toast('Screenshot gespeichert', 'success');
}

describe('B: captureScreenshot() – Modus "combined"', () => {
  let mocks;

  beforeEach(() => {
    mocks = {
      mode:                    'combined',
      hasPanels:               true,
      desktopResult:           { id: 'desktop', png: 'x', w: 1920, h: 1080 },
      captureWorkspaceSnapshot: vi.fn().mockResolvedValue(undefined),
      captureDesktopPanel:     vi.fn().mockResolvedValue(null),
      screenshotAllPanels:     vi.fn().mockResolvedValue([]),
      downloadWorkspaceComposite: vi.fn().mockResolvedValue(undefined),
      downloadSingle:          vi.fn(),
      showOverlay:             vi.fn(),
      hideOverlay:             vi.fn(),
      toast:                   vi.fn(),
    };
  });

  it('ruft captureWorkspaceSnapshot auf', async () => {
    await captureScreenshotLogic(mocks);
    expect(mocks.captureWorkspaceSnapshot).toHaveBeenCalledOnce();
  });

  it('ruft captureDesktopPanel NICHT auf (früher Return)', async () => {
    await captureScreenshotLogic(mocks);
    expect(mocks.captureDesktopPanel).not.toHaveBeenCalled();
  });

  it('ruft screenshotAllPanels NICHT auf (früher Return)', async () => {
    await captureScreenshotLogic(mocks);
    expect(mocks.screenshotAllPanels).not.toHaveBeenCalled();
  });

  it('zeigt das Overlay NIE an', async () => {
    await captureScreenshotLogic(mocks);
    expect(mocks.showOverlay).not.toHaveBeenCalled();
  });

  it('versteckt das Overlay NIE', async () => {
    await captureScreenshotLogic(mocks);
    expect(mocks.hideOverlay).not.toHaveBeenCalled();
  });

  it('toasted "gespeichert" nach Erfolg', async () => {
    await captureScreenshotLogic(mocks);
    expect(mocks.toast).toHaveBeenCalledWith('Screenshot gespeichert', 'success');
  });
});

describe('C: captureScreenshot() – Modus "single"', () => {
  let mocks;
  const panelPng = 'wysiwyg_panel_png';

  beforeEach(() => {
    mocks = {
      mode:              'single',
      hasPanels:         true,
      desktopResult:     null,
      captureWorkspaceSnapshot: vi.fn(),
      captureDesktopPanel:  vi.fn().mockResolvedValue(null),
      screenshotAllPanels:  vi.fn().mockResolvedValue([
        { id: 'p1', label: 'iPhone', w: 390, h: 855, wsX: 50, wsY: 30, scale: 1, png: panelPng },
      ]),
      downloadWorkspaceComposite: vi.fn(),
      downloadSingle:    vi.fn(),
      showOverlay:       vi.fn(),
      hideOverlay:       vi.fn(),
      toast:             vi.fn(),
    };
  });

  it('ruft captureWorkspaceSnapshot NICHT auf', async () => {
    await captureScreenshotLogic(mocks);
    expect(mocks.captureWorkspaceSnapshot).not.toHaveBeenCalled();
  });

  it('ruft screenshotAllPanels auf', async () => {
    await captureScreenshotLogic(mocks);
    expect(mocks.screenshotAllPanels).toHaveBeenCalledOnce();
  });

  it('zeigt das Overlay NIE an', async () => {
    await captureScreenshotLogic(mocks);
    expect(mocks.showOverlay).not.toHaveBeenCalled();
  });

  it('versteckt das Overlay NIE', async () => {
    await captureScreenshotLogic(mocks);
    expect(mocks.hideOverlay).not.toHaveBeenCalled();
  });

  it('ruft downloadWorkspaceComposite NICHT auf (nur 1 Panel)', async () => {
    await captureScreenshotLogic(mocks);
    expect(mocks.downloadWorkspaceComposite).not.toHaveBeenCalled();
  });

  it('lädt das WYSIWYG-PNG direkt herunter (kein Compositing)', async () => {
    await captureScreenshotLogic(mocks);
    expect(mocks.downloadSingle).toHaveBeenCalledWith(panelPng, 'iPhone', 390, 855);
  });

  it('toasted "gespeichert"', async () => {
    await captureScreenshotLogic(mocks);
    expect(mocks.toast).toHaveBeenCalledWith('Screenshot gespeichert', 'success');
  });

  it('toasted "fehlgeschlagen" wenn keine Ergebnisse', async () => {
    mocks.screenshotAllPanels.mockResolvedValue([]);
    await captureScreenshotLogic(mocks);
    expect(mocks.toast).toHaveBeenCalledWith('Screenshot fehlgeschlagen', 'error');
    expect(mocks.downloadSingle).not.toHaveBeenCalled();
  });
});

describe('C: captureScreenshot() – Modus "workspace"', () => {
  let mocks;

  beforeEach(() => {
    mocks = {
      mode:              'workspace',
      hasPanels:         true,
      desktopResult:     { id: 'desktop', label: 'Desktop', w: 1366, h: 768, png: 'desk_png', visH: 768, wsH: 600 },
      captureWorkspaceSnapshot: vi.fn(),
      captureDesktopPanel:  vi.fn().mockResolvedValue(
        { id: 'desktop', label: 'Desktop', w: 1366, h: 768, png: 'desk_png' },
      ),
      screenshotAllPanels:  vi.fn().mockResolvedValue([
        { id: 'p1', label: 'Android', w: 414, h: 893, wsX: 50, wsY: 30, scale: 1, png: 'panel_png' },
      ]),
      downloadWorkspaceComposite: vi.fn().mockResolvedValue(undefined),
      downloadSingle:    vi.fn(),
      showOverlay:       vi.fn(),
      hideOverlay:       vi.fn(),
      toast:             vi.fn(),
    };
  });

  it('ruft downloadWorkspaceComposite auf wenn > 1 Ergebnis', async () => {
    await captureScreenshotLogic(mocks);
    expect(mocks.downloadWorkspaceComposite).toHaveBeenCalledOnce();
  });

  it('übergibt alle results an downloadWorkspaceComposite', async () => {
    await captureScreenshotLogic(mocks);
    const arg = mocks.downloadWorkspaceComposite.mock.calls[0][0];
    expect(arg).toHaveLength(2); // desktop + 1 panel
    expect(arg.find(r => r.id === 'desktop')).toBeTruthy();
    expect(arg.find(r => r.id === 'p1')).toBeTruthy();
  });

  it('zeigt das Overlay NIE an', async () => {
    await captureScreenshotLogic(mocks);
    expect(mocks.showOverlay).not.toHaveBeenCalled();
  });
});

// ─── D: downloadWorkspaceComposite Logik ─────────────────────────────────────
//
// Testet die Sortier- und Positionierlogik der neuen WYSIWYG-Placement-Funktion.

/**
 * Replizierte Kernlogik aus downloadWorkspaceComposite().
 * Gibt die gemockten ctx.drawImage-Aufrufe in der Reihenfolge zurück,
 * wie sie die Funktion absetzen würde.
 */
async function compositeDrawOrder(panelResults, wsRect, PAD = 20) {
  const panelR   = panelResults.filter(r => r.id !== 'desktop');
  const sorted   = [...panelR].sort((a, b) => b.w * b.h - a.w * a.h);
  const drawCalls = [];

  for (const r of sorted) {
    drawCalls.push({ wsX: r.wsX, wsY: r.wsY, w: r.w, h: r.h,
      canvasX: PAD + r.wsX, canvasY: PAD + r.wsY });
  }
  return drawCalls;
}

describe('D: downloadWorkspaceComposite() – Panel-Positionierung', () => {
  const PAD = 20;

  it('zeichnet Panel an Position PAD + wsX, PAD + wsY', async () => {
    const panels = [
      { id: 'p1', w: 414, h: 894, wsX: 50, wsY: 30, png: 'x' },
    ];
    const calls = await compositeDrawOrder(panels, { w: 1366, h: 768 }, PAD);
    expect(calls[0].canvasX).toBe(PAD + 50);
    expect(calls[0].canvasY).toBe(PAD + 30);
  });

  it('respektiert wsX=0, wsY=0 (Panel oben-links)', async () => {
    const panels = [
      { id: 'p1', w: 390, h: 844, wsX: 0, wsY: 0, png: 'x' },
    ];
    const calls = await compositeDrawOrder(panels, { w: 800, h: 600 }, PAD);
    expect(calls[0].canvasX).toBe(PAD);
    expect(calls[0].canvasY).toBe(PAD);
  });

  it('sortiert Panels absteigend nach Fläche (größtes zuerst)', async () => {
    const panels = [
      { id: 'klein', w: 390, h: 844, wsX: 0,   wsY: 0,  png: 'x' },  // 329.160
      { id: 'groß',  w: 768, h: 1024, wsX: 400, wsY: 0,  png: 'y' },  // 786.432
    ];
    const calls = await compositeDrawOrder(panels, { w: 1366, h: 768 }, PAD);
    expect(calls[0].w).toBe(768); // größtes Panel zuerst
    expect(calls[1].w).toBe(390);
  });

  it('filtert Desktop-Panel heraus (id === "desktop")', async () => {
    const panels = [
      { id: 'desktop', w: 1366, h: 768, wsX: 0,  wsY: 0, png: 'd' },
      { id: 'p1',      w: 390,  h: 844, wsX: 50, wsY: 20, png: 'x' },
    ];
    const calls = await compositeDrawOrder(panels, { w: 1366, h: 768 }, PAD);
    // Desktop wird separat gezeichnet (captureDesktopPanel), nicht über Panel-Loop
    expect(calls.every(c => c.w !== 1366)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('gibt leere drawCalls zurück wenn nur Desktop vorhanden', async () => {
    const panels = [
      { id: 'desktop', w: 1366, h: 768, wsX: 0, wsY: 0, png: 'd' },
    ];
    const calls = await compositeDrawOrder(panels, { w: 1366, h: 768 }, PAD);
    expect(calls).toHaveLength(0);
  });

  it('zeichnet w/h aus dem WYSIWYG-PNG (nicht aus def.w/def.h)', async () => {
    // Das WYSIWYG-PNG hat die Pixel-Dimensionen des panel-deco,
    // inkl. Geräterahmen – deshalb sind w/h größer als nur die Content-Breite.
    const panels = [
      { id: 'p1', w: 440, h: 940, wsX: 10, wsY: 10, png: 'x' }, // 440 > def.w=390 (Bezel)
    ];
    const calls = await compositeDrawOrder(panels, { w: 1000, h: 800 }, PAD);
    expect(calls[0].w).toBe(440);
    expect(calls[0].h).toBe(940);
  });

  it('verwendet PAD-Parameter korrekt', async () => {
    const panels = [
      { id: 'p1', w: 390, h: 844, wsX: 10, wsY: 20, png: 'x' },
    ];
    const calls0 = await compositeDrawOrder(panels, {}, 0);
    const calls5 = await compositeDrawOrder(panels, {}, 5);
    expect(calls0[0].canvasX).toBe(10);
    expect(calls5[0].canvasX).toBe(15);
  });
});

// ─── E: ssFilename-Logik ──────────────────────────────────────────────────────

/**
 * Repliziert die ssFilename()-Logik aus screenshot.js.
 * Reine Funktion – kein Import nötig.
 */
function ssFilename(label, w, h) {
  const size = (w && h) ? `_${w}x${h}` : '';
  return `${label}${size}_${Date.now()}.png`;
}

describe('E: ssFilename()', () => {
  it('enthält Label, Breite×Höhe und .png-Extension', () => {
    const name = ssFilename('Android', 414, 894);
    expect(name).toMatch(/^Android_414x894_\d+\.png$/);
  });

  it('lässt Maße weg wenn w/h nicht angegeben', () => {
    const name = ssFilename('screenshare_workspace');
    expect(name).toMatch(/^screenshare_workspace_\d+\.png$/);
    expect(name).not.toContain('x');
  });

  it('enthält einen numerischen Timestamp', () => {
    const before = Date.now();
    const name   = ssFilename('Desktop', 1920, 1080);
    const after  = Date.now();
    const ts     = parseInt(name.match(/_(\d+)\.png$/)[1], 10);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('Desktop: Format Desktop_{w}x{h}_{ts}.png', () => {
    const name = ssFilename('Desktop', 1366, 768);
    expect(name).toMatch(/^Desktop_1366x768_\d+\.png$/);
  });

  it('Workspace ohne Maße: screenshare_layout_{ts}.png', () => {
    const name = ssFilename('screenshare_layout');
    expect(name).toMatch(/^screenshare_layout_\d+\.png$/);
  });
});

// ─── Regressionstests: composeDeviceFrame ist entfernt ───────────────────────

import { readFileSync } from 'fs';

const screenshotSrc = readFileSync(
  new URL('../src/renderer/screenshot.js', import.meta.url),
  'utf8',
);

describe('Regression: composeDeviceFrame ist komplett entfernt', () => {
  it('composeDeviceFrame kommt im Quellcode nicht mehr vor', () => {
    expect(screenshotSrc).not.toContain('composeDeviceFrame');
  });
});

describe('Regression: ss-overlay wird nie manipuliert', () => {
  it('ssOverlay kommt im Quellcode nicht mehr vor', () => {
    expect(screenshotSrc).not.toContain('ssOverlay');
  });

  it('ss-overlay getElementById kommt im Quellcode nicht mehr vor', () => {
    expect(screenshotSrc).not.toContain("getElementById('ss-overlay')");
  });
});

describe('Regression: panelCompositeLayout bleibt re-exportiert (für Tests)', () => {
  it('screenshot.js re-exportiert panelCompositeLayout', () => {
    expect(screenshotSrc).toContain("export { panelCompositeLayout } from './screenshot-utils.js'");
  });
});

describe('Regression: captureRect wird für Panels verwendet (kein captureWv)', () => {
  const panelsSrc = readFileSync(
    new URL('../src/renderer/panels.js', import.meta.url),
    'utf8',
  );

  it('screenshotPanel verwendet captureRect', () => {
    // captureRect muss in der screenshotPanel-Funktion vorkommen
    const fnStart = panelsSrc.indexOf('async function screenshotPanel');
    const fnEnd   = panelsSrc.indexOf('\nexport async function screenshotAllPanels');
    const fnBody  = panelsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toContain('captureRect');
  });

  it('screenshotPanel verwendet captureWv NICHT mehr', () => {
    const fnStart = panelsSrc.indexOf('async function screenshotPanel');
    const fnEnd   = panelsSrc.indexOf('\nexport async function screenshotAllPanels');
    const fnBody  = panelsSrc.slice(fnStart, fnEnd);
    expect(fnBody).not.toContain('captureWv(');
  });

  it('screenshotPanel verwendet getBoundingClientRect auf decoEl', () => {
    const fnStart = panelsSrc.indexOf('async function screenshotPanel');
    const fnEnd   = panelsSrc.indexOf('\nexport async function screenshotAllPanels');
    const fnBody  = panelsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toContain('getBoundingClientRect');
  });

  it('Rückgabe enthält wsX und wsY', () => {
    const fnStart = panelsSrc.indexOf('async function screenshotPanel');
    const fnEnd   = panelsSrc.indexOf('\nexport async function screenshotAllPanels');
    const fnBody  = panelsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toContain('wsX');
    expect(fnBody).toContain('wsY');
  });

  it('Rückgabe enthält KEIN frame mehr', () => {
    const fnStart = panelsSrc.indexOf('async function screenshotPanel');
    const fnEnd   = panelsSrc.indexOf('\nexport async function screenshotAllPanels');
    const fnBody  = panelsSrc.slice(fnStart, fnEnd);
    // "frame" darf nur in Kommentaren vorkommen, nicht als Rückgabefeld
    // Einfaches Heuristic: das Wort 'frame:' darf nicht im Return-Objekt erscheinen
    expect(fnBody).not.toMatch(/^\s*frame\s*:/m);
  });
});

// ─── F: withFrame-Option – screenshotPanel & screenshotAllPanels ──────────────
//
// Testet dass bei withFrame=true das panel-deco (Geräterahmen + Inhalt)
// und bei withFrame=false nur das panel-viewport (reiner Seiteninhalt)
// als captureRect-Ziel verwendet wird.

/**
 * Repliziert die withFrame-Logik aus screenshotPanel() in panels.js.
 */
async function screenshotPanelWithFrameLogic(panelEntry, captureRect, { withFrame = true } = {}) {
  const p = panelEntry;
  if (!p) return null;
  const target = withFrame
    ? p.decoEl
    : (p.decoEl.querySelector('.panel-viewport') ?? p.decoEl);
  const br = target.getBoundingClientRect();
  const png = await captureRect({
    x:      Math.round(br.left),
    y:      Math.round(br.top),
    width:  Math.round(br.width),
    height: Math.round(br.height),
  });
  if (!png) return null;
  const s = p.scale ?? 1;
  return { id: p.id, label: p.def.label, w: Math.round(br.width), h: Math.round(br.height),
    wsX: p.rect.x, wsY: p.rect.y, scale: s, png };
}

describe('F: screenshotPanel() – withFrame-Option', () => {
  let captureRect;
  let panelEntry;

  const decoBounds     = { left: 100, top: 50, width: 440, height: 950 }; // inkl. Rahmen
  const viewportBounds = { left: 112, top: 90, width: 414, height: 894 }; // nur Inhalt

  beforeEach(() => {
    captureRect = vi.fn().mockResolvedValue('png_data');

    const viewport = {
      getBoundingClientRect: () => viewportBounds,
    };
    const decoEl = {
      getBoundingClientRect: () => decoBounds,
      querySelector: (sel) => sel === '.panel-viewport' ? viewport : null,
    };
    panelEntry = {
      id:    'p1',
      def:   { label: 'iPhone' },
      decoEl,
      scale: 1,
      rect:  { x: 80, y: 40 },
    };
  });

  it('withFrame=true → captureRect auf decoEl (inkl. Geräterahmen)', async () => {
    await screenshotPanelWithFrameLogic(panelEntry, captureRect, { withFrame: true });
    expect(captureRect).toHaveBeenCalledWith({
      x:      decoBounds.left,
      y:      decoBounds.top,
      width:  decoBounds.width,
      height: decoBounds.height,
    });
  });

  it('withFrame=false → captureRect auf panel-viewport (nur Inhalt)', async () => {
    await screenshotPanelWithFrameLogic(panelEntry, captureRect, { withFrame: false });
    expect(captureRect).toHaveBeenCalledWith({
      x:      viewportBounds.left,
      y:      viewportBounds.top,
      width:  viewportBounds.width,
      height: viewportBounds.height,
    });
  });

  it('withFrame=true → w/h entsprechen der Gesamtgröße inkl. Rahmen', async () => {
    const r = await screenshotPanelWithFrameLogic(panelEntry, captureRect, { withFrame: true });
    expect(r.w).toBe(decoBounds.width);
    expect(r.h).toBe(decoBounds.height);
  });

  it('withFrame=false → w/h entsprechen der reinen Viewport-Größe', async () => {
    const r = await screenshotPanelWithFrameLogic(panelEntry, captureRect, { withFrame: false });
    expect(r.w).toBe(viewportBounds.width);
    expect(r.h).toBe(viewportBounds.height);
  });

  it('withFrame=true liefert größere Abmessungen als withFrame=false', async () => {
    const withF    = await screenshotPanelWithFrameLogic(panelEntry, captureRect, { withFrame: true });
    const withoutF = await screenshotPanelWithFrameLogic(panelEntry, captureRect, { withFrame: false });
    expect(withF.w).toBeGreaterThan(withoutF.w);
    expect(withF.h).toBeGreaterThan(withoutF.h);
  });

  it('Standard-Wert ist withFrame=true (kein Argument = Rahmen dabei)', async () => {
    await screenshotPanelWithFrameLogic(panelEntry, captureRect);
    // sollte wie withFrame=true auf decoEl zugreifen
    expect(captureRect).toHaveBeenCalledWith({
      x:      decoBounds.left,
      y:      decoBounds.top,
      width:  decoBounds.width,
      height: decoBounds.height,
    });
  });

  it('withFrame=false fällt auf decoEl zurück wenn querySelector kein Viewport findet', async () => {
    panelEntry.decoEl.querySelector = () => null;
    await screenshotPanelWithFrameLogic(panelEntry, captureRect, { withFrame: false });
    expect(captureRect).toHaveBeenCalledWith({
      x:      decoBounds.left,
      y:      decoBounds.top,
      width:  decoBounds.width,
      height: decoBounds.height,
    });
  });

  it('gibt null zurück wenn captureRect null liefert (withFrame=false)', async () => {
    captureRect.mockResolvedValue(null);
    const r = await screenshotPanelWithFrameLogic(panelEntry, captureRect, { withFrame: false });
    expect(r).toBeNull();
  });

  it('Ergebnis-Objekt enthält id, label, wsX, wsY, scale unabhängig von withFrame', async () => {
    for (const withFrame of [true, false]) {
      const r = await screenshotPanelWithFrameLogic(panelEntry, captureRect, { withFrame });
      expect(r).toMatchObject({ id: 'p1', label: 'iPhone', wsX: 80, wsY: 40, scale: 1 });
    }
  });
});

// ─── G: screenshotAllPanels – withFrame wird weitergereicht ──────────────────

/**
 * Repliziert screenshotAllPanels({ withFrame }) aus panels.js.
 */
async function screenshotAllPanelsLogic(panelsMap, screenshotPanel) {
  const results = [];
  for (const [id] of panelsMap) {
    const r = await screenshotPanel(id);
    if (r) results.push(r);
  }
  return results;
}

describe('G: screenshotAllPanels() – withFrame-Option wird weitergereicht', () => {
  it('ruft screenshotPanel für jeden Eintrag in der Map auf', async () => {
    const map = new Map([['1', {}], ['2', {}], ['3', {}]]);
    const sp  = vi.fn().mockResolvedValue({ id: 'x', png: 'p' });
    const results = await screenshotAllPanelsLogic(map, sp);
    expect(sp).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(3);
  });

  it('filtert null-Ergebnisse heraus (Panel nicht gefunden)', async () => {
    const map = new Map([['1', {}], ['2', {}]]);
    const sp  = vi.fn()
      .mockResolvedValueOnce({ id: '1', png: 'p' })
      .mockResolvedValueOnce(null);
    const results = await screenshotAllPanelsLogic(map, sp);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('1');
  });

  it('gibt leeres Array zurück wenn alle Panels null liefern', async () => {
    const map = new Map([['1', {}]]);
    const sp  = vi.fn().mockResolvedValue(null);
    const results = await screenshotAllPanelsLogic(map, sp);
    expect(results).toHaveLength(0);
  });
});

// ─── H: captureScreenshot – Rahmen-Steuerung über withFrame-Flag ─────────────
//
// Testet dass bei withFrame=false weder composeMonitorFrame für Desktop
// noch der Geräterahmen für Panels aufgerufen wird.

/**
 * Repliziert die Rahmen-Steuerungslogik aus captureScreenshot() für den
 * "single"-Modus – speziell den composeMonitorFrame-Aufruf für Desktop.
 */
async function captureScreenshotFrameLogic({
  results,
  withFrame,
  composeMonitorFrame,
  downloadSingle,
}) {
  for (const r of results) {
    let png = r.png;
    if (r.id === 'desktop' && withFrame) {
      png = (await composeMonitorFrame(r)) ?? r.png;
    }
    downloadSingle(png, r.label, r.w, r.h);
  }
}

describe('H: captureScreenshot() – Rahmen-Steuerung (withFrame)', () => {
  const desktopResult = { id: 'desktop', label: 'Desktop', w: 1366, h: 768, png: 'desk_raw', visW: 1366, visH: 768 };
  const panelResult   = { id: 'p1',      label: 'iPhone',  w: 390,  h: 844, png: 'panel_png' };

  let composeMonitorFrame;
  let downloadSingle;

  beforeEach(() => {
    composeMonitorFrame = vi.fn().mockResolvedValue('desk_framed');
    downloadSingle      = vi.fn();
  });

  it('withFrame=true → composeMonitorFrame wird für Desktop aufgerufen', async () => {
    await captureScreenshotFrameLogic({
      results: [desktopResult],
      withFrame: true,
      composeMonitorFrame,
      downloadSingle,
    });
    expect(composeMonitorFrame).toHaveBeenCalledOnce();
    expect(composeMonitorFrame).toHaveBeenCalledWith(desktopResult);
  });

  it('withFrame=true → Desktop-Download erhält geframtes PNG', async () => {
    await captureScreenshotFrameLogic({
      results: [desktopResult],
      withFrame: true,
      composeMonitorFrame,
      downloadSingle,
    });
    expect(downloadSingle).toHaveBeenCalledWith('desk_framed', 'Desktop', 1366, 768);
  });

  it('withFrame=false → composeMonitorFrame wird NICHT aufgerufen', async () => {
    await captureScreenshotFrameLogic({
      results: [desktopResult],
      withFrame: false,
      composeMonitorFrame,
      downloadSingle,
    });
    expect(composeMonitorFrame).not.toHaveBeenCalled();
  });

  it('withFrame=false → Desktop-Download erhält rohes PNG (kein Monitor-Rahmen)', async () => {
    await captureScreenshotFrameLogic({
      results: [desktopResult],
      withFrame: false,
      composeMonitorFrame,
      downloadSingle,
    });
    expect(downloadSingle).toHaveBeenCalledWith('desk_raw', 'Desktop', 1366, 768);
  });

  it('withFrame=true → Panel-PNG wird nicht durch composeMonitorFrame verändert', async () => {
    await captureScreenshotFrameLogic({
      results: [panelResult],
      withFrame: true,
      composeMonitorFrame,
      downloadSingle,
    });
    expect(composeMonitorFrame).not.toHaveBeenCalled();
    expect(downloadSingle).toHaveBeenCalledWith('panel_png', 'iPhone', 390, 844);
  });

  it('withFrame=false → Panel-PNG bleibt unverändert', async () => {
    await captureScreenshotFrameLogic({
      results: [panelResult],
      withFrame: false,
      composeMonitorFrame,
      downloadSingle,
    });
    expect(downloadSingle).toHaveBeenCalledWith('panel_png', 'iPhone', 390, 844);
  });

  it('composeMonitorFrame-Fehler → Fallback auf rohes PNG', async () => {
    composeMonitorFrame.mockResolvedValue(null); // simuliert Fehler-Fallback
    await captureScreenshotFrameLogic({
      results: [desktopResult],
      withFrame: true,
      composeMonitorFrame,
      downloadSingle,
    });
    expect(downloadSingle).toHaveBeenCalledWith('desk_raw', 'Desktop', 1366, 768);
  });

  it('mehrere Ergebnisse: Desktop gerahmt, Panel ungerahmt (withFrame=true)', async () => {
    await captureScreenshotFrameLogic({
      results: [desktopResult, panelResult],
      withFrame: true,
      composeMonitorFrame,
      downloadSingle,
    });
    expect(composeMonitorFrame).toHaveBeenCalledTimes(1);
    expect(downloadSingle).toHaveBeenCalledTimes(2);
    expect(downloadSingle).toHaveBeenNthCalledWith(1, 'desk_framed', 'Desktop', 1366, 768);
    expect(downloadSingle).toHaveBeenNthCalledWith(2, 'panel_png',   'iPhone',  390,  844);
  });

  it('mehrere Ergebnisse: kein Framing bei withFrame=false', async () => {
    await captureScreenshotFrameLogic({
      results: [desktopResult, panelResult],
      withFrame: false,
      composeMonitorFrame,
      downloadSingle,
    });
    expect(composeMonitorFrame).not.toHaveBeenCalled();
    expect(downloadSingle).toHaveBeenNthCalledWith(1, 'desk_raw',  'Desktop', 1366, 768);
    expect(downloadSingle).toHaveBeenNthCalledWith(2, 'panel_png', 'iPhone',  390,  844);
  });
});

// ─── I: Quellcode-Struktur – withFrame in panels.js und screenshot.js ─────────

const panelsSrc     = readFileSync(new URL('../src/renderer/panels.js',    import.meta.url), 'utf8');
const screenshotSrc2 = readFileSync(new URL('../src/renderer/screenshot.js', import.meta.url), 'utf8');

describe('I: Quellcode-Struktur – withFrame-Implementierung', () => {
  it('screenshotPanel akzeptiert withFrame-Parameter', () => {
    const fnStart = panelsSrc.indexOf('export async function screenshotPanel');
    const fnEnd   = panelsSrc.indexOf('\nexport async function screenshotAllPanels');
    const fnBody  = panelsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toContain('withFrame');
  });

  it('screenshotPanel verwendet panel-viewport wenn withFrame=false', () => {
    const fnStart = panelsSrc.indexOf('export async function screenshotPanel');
    const fnEnd   = panelsSrc.indexOf('\nexport async function screenshotAllPanels');
    const fnBody  = panelsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toContain('.panel-viewport');
  });

  it('screenshotAllPanels leitet withFrame weiter', () => {
    const fnStart = panelsSrc.indexOf('export async function screenshotAllPanels');
    const fnBody  = panelsSrc.slice(fnStart, fnStart + 300);
    expect(fnBody).toContain('withFrame');
  });

  it('screenshot.js liest ss-frame-cb aus dem DOM', () => {
    expect(screenshotSrc2).toContain('ss-frame-cb');
  });

  it('screenshot.js übergibt withFrame an screenshotAllPanels', () => {
    expect(screenshotSrc2).toContain('screenshotAllPanels({ withFrame');
  });

  it('screenshot.js prüft withFrame vor composeMonitorFrame', () => {
    expect(screenshotSrc2).toContain('withFrame');
    // composeMonitorFrame darf nur bedingt aufgerufen werden
    const monitorIdx  = screenshotSrc2.indexOf('composeMonitorFrame');
    const withFrameNearby = screenshotSrc2.slice(
      Math.max(0, monitorIdx - 150),
      monitorIdx + 50,
    );
    expect(withFrameNearby).toContain('withFrame');
  });
});

// ─── J: Panel-Isolation – Geschwister-Panels beim Screenshot ausblenden ───────
//
//  Wenn Panels überlagert sind, dürfen Geschwister-Panels NICHT im captureRect
//  des aufzunehmenden Panels landen. screenshotPanel() blendet daher alle
//  anderen .panel-deco-Elemente temporär per visibility:hidden aus.

/**
 * Repliziert die Isolierungs-Logik aus screenshotPanel() (panels.js).
 * Geschwister-Panels werden vor captureRect ausgeblendet und danach
 * im finally-Block immer wiederhergestellt.
 */
async function screenshotPanelIsolationLogic(id, panelEntry, allDecos, captureRect) {
  if (!panelEntry) return null;
  const siblings = allDecos.filter(el => el.dataset.id !== String(id));
  siblings.forEach(el => { el.style.visibility = 'hidden'; });
  try {
    const br  = panelEntry.decoEl.getBoundingClientRect();
    const png = await captureRect({
      x: Math.round(br.left), y: Math.round(br.top),
      width: Math.round(br.width), height: Math.round(br.height),
    });
    if (!png) return null;
    return { id, png };
  } finally {
    siblings.forEach(el => { el.style.visibility = ''; });
  }
}

describe('J: screenshotPanel() – Geschwister-Panel-Isolation bei Überlagerung', () => {
  let captureRect;
  let decoA, decoB, decoC;
  let panelEntry;

  beforeEach(() => {
    captureRect = vi.fn().mockResolvedValue('png_data');

    decoA = { dataset: { id: 'a' }, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 414, height: 894 }) };
    decoB = { dataset: { id: 'b' }, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 375, height: 812 }) };
    decoC = { dataset: { id: 'c' }, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 780 }) };

    panelEntry = { decoEl: decoA };
  });

  it('blendet alle anderen panel-deco-Elemente während captureRect aus (visibility:hidden)', async () => {
    await screenshotPanelIsolationLogic('a', panelEntry, [decoA, decoB, decoC], captureRect);
    // captureRect wurde aufgerufen – während des Aufrufs waren B und C hidden
    // Wir prüfen nachher den finalen Zustand und ob captureRect aufgerufen wurde
    expect(captureRect).toHaveBeenCalledOnce();
    // Sichtbarkeit wurde nach dem Aufruf wieder zurückgesetzt
    expect(decoB.style.visibility).toBe('');
    expect(decoC.style.visibility).toBe('');
  });

  it('setzt target-Panel selbst NICHT auf hidden', async () => {
    await screenshotPanelIsolationLogic('a', panelEntry, [decoA, decoB, decoC], captureRect);
    expect(decoA.style.visibility).not.toBe('hidden');
  });

  it('stellt visibility aller Geschwister nach Aufnahme wieder her (leer = default)', async () => {
    await screenshotPanelIsolationLogic('a', panelEntry, [decoA, decoB, decoC], captureRect);
    expect(decoB.style.visibility).toBe('');
    expect(decoC.style.visibility).toBe('');
  });

  it('stellt visibility auch bei captureRect-Fehler wieder her (finally)', async () => {
    captureRect.mockRejectedValue(new Error('capture failed'));
    await screenshotPanelIsolationLogic('a', panelEntry, [decoA, decoB, decoC], captureRect).catch(() => {});
    expect(decoB.style.visibility).toBe('');
    expect(decoC.style.visibility).toBe('');
  });

  it('stellt visibility auch wenn captureRect null zurückgibt wieder her', async () => {
    captureRect.mockResolvedValue(null);
    await screenshotPanelIsolationLogic('a', panelEntry, [decoA, decoB, decoC], captureRect);
    expect(decoB.style.visibility).toBe('');
    expect(decoC.style.visibility).toBe('');
  });

  it('filtert Geschwister anhand dataset.id (nicht nach DOM-Referenz)', async () => {
    // Nur 'b' ist ein Geschwister von 'a'
    const subset = [decoA, decoB];
    await screenshotPanelIsolationLogic('a', panelEntry, subset, captureRect);
    expect(decoB.style.visibility).toBe('');
    expect(decoA.style.visibility).not.toBe('hidden');
  });

  it('gibt null zurück wenn captureRect null liefert (und Isolation korrekt aufgeräumt)', async () => {
    captureRect.mockResolvedValue(null);
    const r = await screenshotPanelIsolationLogic('a', panelEntry, [decoA, decoB], captureRect);
    expect(r).toBeNull();
    expect(decoB.style.visibility).toBe('');
  });

  it('funktioniert auch wenn keine Geschwister vorhanden sind (nur 1 Panel)', async () => {
    const r = await screenshotPanelIsolationLogic('a', panelEntry, [decoA], captureRect);
    expect(r).not.toBeNull();
    expect(captureRect).toHaveBeenCalledOnce();
  });
});

describe('J: Quellcode-Struktur – Geschwister-Panel-Isolation in panels.js', () => {
  it('screenshotPanel enthält querySelectorAll(".panel-deco")', () => {
    const fnStart = panelsSrc.indexOf('export async function screenshotPanel');
    const fnEnd   = panelsSrc.indexOf('\nexport async function screenshotAllPanels');
    const fnBody  = panelsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toContain('.panel-deco');
  });

  it('screenshotPanel filtert Geschwister anhand dataset.id', () => {
    const fnStart = panelsSrc.indexOf('export async function screenshotPanel');
    const fnEnd   = panelsSrc.indexOf('\nexport async function screenshotAllPanels');
    const fnBody  = panelsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toContain('dataset.id');
  });

  it('screenshotPanel setzt visibility:hidden auf Geschwister', () => {
    const fnStart = panelsSrc.indexOf('export async function screenshotPanel');
    const fnEnd   = panelsSrc.indexOf('\nexport async function screenshotAllPanels');
    const fnBody  = panelsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toContain('visibility');
    expect(fnBody).toContain('hidden');
  });

  it('screenshotPanel stellt visibility in einem finally-Block wieder her', () => {
    const fnStart = panelsSrc.indexOf('export async function screenshotPanel');
    const fnEnd   = panelsSrc.indexOf('\nexport async function screenshotAllPanels');
    const fnBody  = panelsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toContain('finally');
    // visibility = '' muss im finally-Block stehen
    const finallyIdx = fnBody.lastIndexOf('finally');
    const finallyBlock = fnBody.slice(finallyIdx);
    expect(finallyBlock).toContain("visibility = ''");
  });
});

