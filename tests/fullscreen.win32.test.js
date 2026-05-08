/**
 * fullscreen.win32.test.js
 *
 * Regressionstests für den Windows-Vollbild-Fix:
 * Auf win32 muss setMenuBarVisibility(false) VOR setFullScreen(true) aufgerufen
 * werden, damit die native Windows-Menüleiste im Vollbildmodus verborgen bleibt.
 * Beim Verlassen muss setMenuBarVisibility(true) NACH setFullScreen(false) folgen.
 *
 * Getestete Logik (aus src/main.js repliziert, platform als Parameter):
 *   winEnterFullScreen(win, platform)
 *   winExitFullScreen(win, platform)
 *   winIsFullScreen(win)
 *
 * Source-Invarianten prüfen die Reihenfolge im Quelltext selbst.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const DIR     = dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(join(DIR, '../src/main.js'), 'utf8');

// ── Replizierte Logik aus src/main.js ─────────────────────────────────────────
// platform wird als Parameter übergeben statt process.platform zu lesen,
// damit die Tests plattformunabhängig laufen.

function winEnterFullScreen(mainWin, platform) {
  if (!mainWin) return;
  if (platform === 'win32') {
    mainWin.setMenuBarVisibility(false);
  }
  mainWin.setFullScreen(true);
  if (platform === 'win32') {
    // setTimeout-Branch wird nicht repliziert – timing-abhängig, durch
    // Integration/manuellen Test abgedeckt.
  }
}

function winExitFullScreen(mainWin, platform) {
  if (!mainWin) return;
  mainWin.setFullScreen(false);
  if (platform === 'win32') mainWin.setMenuBarVisibility(true);
}

function winIsFullScreen(mainWin) {
  if (!mainWin) return false;
  return mainWin.isFullScreen();
}

// ── Mock-Factory ───────────────────────────────────────────────────────────────

function makeWin({ isFullScreen = false } = {}) {
  const callOrder = [];
  return {
    callOrder,
    setMenuBarVisibility: vi.fn(v => callOrder.push(['setMenuBarVisibility', v])),
    setFullScreen:        vi.fn(v => callOrder.push(['setFullScreen', v])),
    isFullScreen:         vi.fn(() => isFullScreen),
    focus:                vi.fn(),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// winEnterFullScreen() – win32
// ═════════════════════════════════════════════════════════════════════════════

describe('winEnterFullScreen() – win32', () => {
  let win;
  beforeEach(() => { win = makeWin(); });

  it('ruft setMenuBarVisibility(false) auf', () => {
    winEnterFullScreen(win, 'win32');
    expect(win.setMenuBarVisibility).toHaveBeenCalledWith(false);
  });

  it('ruft setFullScreen(true) auf', () => {
    winEnterFullScreen(win, 'win32');
    expect(win.setFullScreen).toHaveBeenCalledWith(true);
  });

  it('REGRESSION: setMenuBarVisibility(false) wird VOR setFullScreen(true) aufgerufen', () => {
    winEnterFullScreen(win, 'win32');
    const mbvIdx = win.callOrder.findIndex(c => c[0] === 'setMenuBarVisibility' && c[1] === false);
    const fsIdx  = win.callOrder.findIndex(c => c[0] === 'setFullScreen'        && c[1] === true);
    expect(mbvIdx).toBeGreaterThan(-1);
    expect(fsIdx).toBeGreaterThan(-1);
    expect(mbvIdx).toBeLessThan(fsIdx);
  });

  it('ruft setMenuBarVisibility genau einmal auf', () => {
    winEnterFullScreen(win, 'win32');
    expect(win.setMenuBarVisibility).toHaveBeenCalledTimes(1);
  });

  it('ruft setFullScreen genau einmal auf', () => {
    winEnterFullScreen(win, 'win32');
    expect(win.setFullScreen).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// winEnterFullScreen() – non-win32
// ═════════════════════════════════════════════════════════════════════════════

describe('winEnterFullScreen() – non-win32 (linux, darwin)', () => {
  it('linux: ruft setMenuBarVisibility NICHT auf', () => {
    const win = makeWin();
    winEnterFullScreen(win, 'linux');
    expect(win.setMenuBarVisibility).not.toHaveBeenCalled();
  });

  it('darwin: ruft setMenuBarVisibility NICHT auf', () => {
    const win = makeWin();
    winEnterFullScreen(win, 'darwin');
    expect(win.setMenuBarVisibility).not.toHaveBeenCalled();
  });

  it('linux: ruft setFullScreen(true) auf', () => {
    const win = makeWin();
    winEnterFullScreen(win, 'linux');
    expect(win.setFullScreen).toHaveBeenCalledWith(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// winEnterFullScreen() – null-Guard
// ═════════════════════════════════════════════════════════════════════════════

describe('winEnterFullScreen() – null-Guard', () => {
  it('wirft keinen Fehler wenn mainWin null ist', () => {
    expect(() => winEnterFullScreen(null, 'win32')).not.toThrow();
  });

  it('wirft keinen Fehler wenn mainWin null ist (linux)', () => {
    expect(() => winEnterFullScreen(null, 'linux')).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// winExitFullScreen() – win32
// ═════════════════════════════════════════════════════════════════════════════

describe('winExitFullScreen() – win32', () => {
  let win;
  beforeEach(() => { win = makeWin(); });

  it('ruft setFullScreen(false) auf', () => {
    winExitFullScreen(win, 'win32');
    expect(win.setFullScreen).toHaveBeenCalledWith(false);
  });

  it('ruft setMenuBarVisibility(true) auf', () => {
    winExitFullScreen(win, 'win32');
    expect(win.setMenuBarVisibility).toHaveBeenCalledWith(true);
  });

  it('REGRESSION: setFullScreen(false) wird VOR setMenuBarVisibility(true) aufgerufen', () => {
    winExitFullScreen(win, 'win32');
    const fsIdx  = win.callOrder.findIndex(c => c[0] === 'setFullScreen'        && c[1] === false);
    const mbvIdx = win.callOrder.findIndex(c => c[0] === 'setMenuBarVisibility' && c[1] === true);
    expect(fsIdx).toBeGreaterThan(-1);
    expect(mbvIdx).toBeGreaterThan(-1);
    expect(fsIdx).toBeLessThan(mbvIdx);
  });

  it('ruft setMenuBarVisibility genau einmal auf', () => {
    winExitFullScreen(win, 'win32');
    expect(win.setMenuBarVisibility).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// winExitFullScreen() – non-win32
// ═════════════════════════════════════════════════════════════════════════════

describe('winExitFullScreen() – non-win32 (linux, darwin)', () => {
  it('linux: ruft setMenuBarVisibility NICHT auf', () => {
    const win = makeWin();
    winExitFullScreen(win, 'linux');
    expect(win.setMenuBarVisibility).not.toHaveBeenCalled();
  });

  it('darwin: ruft setMenuBarVisibility NICHT auf', () => {
    const win = makeWin();
    winExitFullScreen(win, 'darwin');
    expect(win.setMenuBarVisibility).not.toHaveBeenCalled();
  });

  it('linux: ruft setFullScreen(false) auf', () => {
    const win = makeWin();
    winExitFullScreen(win, 'linux');
    expect(win.setFullScreen).toHaveBeenCalledWith(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// winExitFullScreen() – null-Guard
// ═════════════════════════════════════════════════════════════════════════════

describe('winExitFullScreen() – null-Guard', () => {
  it('wirft keinen Fehler wenn mainWin null ist', () => {
    expect(() => winExitFullScreen(null, 'win32')).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// winIsFullScreen()
// ═════════════════════════════════════════════════════════════════════════════

describe('winIsFullScreen()', () => {
  it('gibt false zurück wenn mainWin null', () => {
    expect(winIsFullScreen(null)).toBe(false);
  });

  it('gibt true zurück wenn isFullScreen() true liefert', () => {
    expect(winIsFullScreen(makeWin({ isFullScreen: true }))).toBe(true);
  });

  it('gibt false zurück wenn isFullScreen() false liefert', () => {
    expect(winIsFullScreen(makeWin({ isFullScreen: false }))).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Source-Invarianten: winEnterFullScreen in main.js
// ═════════════════════════════════════════════════════════════════════════════

describe('Source-Invariante: winEnterFullScreen in main.js', () => {
  const fnStart = mainSrc.indexOf('function winEnterFullScreen()');
  const fnEnd   = mainSrc.indexOf('function winExitFullScreen()');
  const fnBody  = mainSrc.slice(fnStart, fnEnd);

  it('winEnterFullScreen ist in main.js vorhanden', () => {
    expect(fnStart).toBeGreaterThan(-1);
  });

  it('enthält setMenuBarVisibility(false) auf win32', () => {
    expect(fnBody).toContain("setMenuBarVisibility(false)");
  });

  it('enthält setFullScreen(true)', () => {
    expect(fnBody).toContain('setFullScreen(true)');
  });

  it("prüft process.platform === 'win32' vor setMenuBarVisibility", () => {
    const win32Check = fnBody.indexOf("process.platform === 'win32'");
    const mbvCall    = fnBody.indexOf('setMenuBarVisibility(false)');
    expect(win32Check).toBeGreaterThan(-1);
    expect(mbvCall).toBeGreaterThan(-1);
    expect(win32Check).toBeLessThan(mbvCall);
  });

  it('REGRESSION: setMenuBarVisibility(false) steht im Quelltext VOR setFullScreen(true)', () => {
    const mbvIdx = fnBody.indexOf('setMenuBarVisibility(false)');
    const fsIdx  = fnBody.indexOf('setFullScreen(true)');
    expect(mbvIdx).toBeGreaterThan(-1);
    expect(fsIdx).toBeGreaterThan(-1);
    expect(mbvIdx).toBeLessThan(fsIdx);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Source-Invarianten: winExitFullScreen in main.js
// ═════════════════════════════════════════════════════════════════════════════

describe('Source-Invariante: winExitFullScreen in main.js', () => {
  const fnStart = mainSrc.indexOf('function winExitFullScreen()');
  const fnEnd   = mainSrc.indexOf('app.whenReady()');
  const fnBody  = mainSrc.slice(fnStart, fnEnd);

  it('winExitFullScreen ist in main.js vorhanden', () => {
    expect(fnStart).toBeGreaterThan(-1);
  });

  it('enthält setFullScreen(false)', () => {
    expect(fnBody).toContain('setFullScreen(false)');
  });

  it('enthält setMenuBarVisibility(true) auf win32', () => {
    expect(fnBody).toContain('setMenuBarVisibility(true)');
  });

  it('REGRESSION: setFullScreen(false) steht im Quelltext VOR setMenuBarVisibility(true)', () => {
    const fsIdx  = fnBody.indexOf('setFullScreen(false)');
    const mbvIdx = fnBody.indexOf('setMenuBarVisibility(true)');
    expect(fsIdx).toBeGreaterThan(-1);
    expect(mbvIdx).toBeGreaterThan(-1);
    expect(fsIdx).toBeLessThan(mbvIdx);
  });
});
