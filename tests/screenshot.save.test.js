/**
 * screenshot.save.test.js
 *
 * Testet die „Speichern unter"-Logik des screenshot:save-IPC-Handlers
 * (main.js) und den blobDownload-Pfad (screenshot.js).
 *
 * Da main.js Electron-APIs verwendet, replizieren wir die reine Handler-Logik
 * als isolierte Funktion und mocken dialog.showSaveDialog und fs.promises.
 *
 *  A. screenshotSaveHandler – Normalfall: Dialog bestätigt, Datei geschrieben
 *  B. screenshotSaveHandler – Benutzer bricht Dialog ab (canceled=true)
 *  C. screenshotSaveHandler – Dialog gibt kein filePath zurück
 *  D. screenshotSaveHandler – writeFile schlägt fehl
 *  E. screenshotSaveHandler – Dateinamen-Sanitierung (Path-Traversal-Schutz)
 *  F. screenshotSaveHandler – defaultPath enthält Downloads-Ordner + sicheren Namen
 *  G. screenshotSaveHandler – Dialog bekommt PNG-Filter und Titel übergeben
 *  H. Quellcode-Struktur – main.js registriert screenshot:save korrekt
 *  I. Quellcode-Struktur – preload.js exponiert saveScreenshot über contextBridge
 *  J. Quellcode-Struktur – screenshot.js nutzt saveScreenshot statt a.click()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync }                          from 'fs';
import path                                      from 'path';

// ─── Replizierte Handler-Logik aus main.js ───────────────────────────────────
//
// Die reine Logik des ipcMain.handle('screenshot:save', ...) als testbare
// Funktion extrahiert – alle Electron-Abhängigkeiten werden als Parameter
// übergeben.

/**
 * Repliziert die Handler-Logik von ipcMain.handle('screenshot:save').
 *
 * @param {{ b64: string, filename: string }} args
 * @param {{ showSaveDialog, writeFile, getDownloadsPath, mainWin }} deps
 */
async function screenshotSaveHandler({ b64, filename }, { showSaveDialog, writeFile, getDownloadsPath, mainWin }) {
  const safe = path.basename(filename).replace(/[^\w\-. ]/g, '_');
  const { canceled, filePath: dest } = await showSaveDialog(mainWin, {
    title:       'Screenshot speichern',
    defaultPath: path.join(getDownloadsPath(), safe),
    filters:     [{ name: 'PNG-Bilder', extensions: ['png'] }],
  });
  if (canceled || !dest) return { ok: false, canceled: true };
  const buf = Buffer.from(b64, 'base64');
  return writeFile(dest, buf)
    .then(() => ({ ok: true, path: dest }))
    .catch(err => ({ ok: false, error: err.message }));
}

// ─── A: Normalfall ───────────────────────────────────────────────────────────

describe('A: screenshotSaveHandler – Normalfall', () => {
  let deps;

  beforeEach(() => {
    deps = {
      showSaveDialog:   vi.fn().mockResolvedValue({ canceled: false, filePath: '/home/user/Downloads/test.png' }),
      writeFile:        vi.fn().mockResolvedValue(undefined),
      getDownloadsPath: () => '/home/user/Downloads',
      mainWin:          { id: 1 },
    };
  });

  it('gibt { ok: true, path } zurück wenn Dialog bestätigt und Datei geschrieben', async () => {
    const result = await screenshotSaveHandler(
      { b64: 'aGVsbG8=', filename: 'test.png' },
      deps,
    );
    expect(result).toEqual({ ok: true, path: '/home/user/Downloads/test.png' });
  });

  it('ruft showSaveDialog genau einmal auf', async () => {
    await screenshotSaveHandler({ b64: 'aGVsbG8=', filename: 'test.png' }, deps);
    expect(deps.showSaveDialog).toHaveBeenCalledOnce();
  });

  it('übergibt mainWin als erstes Argument an showSaveDialog', async () => {
    await screenshotSaveHandler({ b64: 'aGVsbG8=', filename: 'test.png' }, deps);
    expect(deps.showSaveDialog.mock.calls[0][0]).toBe(deps.mainWin);
  });

  it('ruft writeFile mit dem korrekten Zielpfad auf', async () => {
    await screenshotSaveHandler({ b64: 'aGVsbG8=', filename: 'test.png' }, deps);
    expect(deps.writeFile.mock.calls[0][0]).toBe('/home/user/Downloads/test.png');
  });

  it('dekodiert das base64-PNG korrekt in einen Buffer', async () => {
    await screenshotSaveHandler({ b64: 'aGVsbG8=', filename: 'test.png' }, deps);
    const buf = deps.writeFile.mock.calls[0][1];
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString('utf8')).toBe('hello');
  });
});

// ─── B: Benutzer bricht Dialog ab ────────────────────────────────────────────

describe('B: screenshotSaveHandler – Dialog abgebrochen', () => {
  let deps;

  beforeEach(() => {
    deps = {
      showSaveDialog:   vi.fn().mockResolvedValue({ canceled: true, filePath: undefined }),
      writeFile:        vi.fn(),
      getDownloadsPath: () => '/home/user/Downloads',
      mainWin:          {},
    };
  });

  it('gibt { ok: false, canceled: true } zurück', async () => {
    const result = await screenshotSaveHandler({ b64: 'aGVsbG8=', filename: 'shot.png' }, deps);
    expect(result).toEqual({ ok: false, canceled: true });
  });

  it('ruft writeFile NICHT auf wenn Dialog abgebrochen', async () => {
    await screenshotSaveHandler({ b64: 'aGVsbG8=', filename: 'shot.png' }, deps);
    expect(deps.writeFile).not.toHaveBeenCalled();
  });
});

// ─── C: Dialog gibt kein filePath zurück ─────────────────────────────────────

describe('C: screenshotSaveHandler – kein filePath vom Dialog', () => {
  it('gibt { ok: false, canceled: true } zurück wenn filePath undefined', async () => {
    const deps = {
      showSaveDialog:   vi.fn().mockResolvedValue({ canceled: false, filePath: undefined }),
      writeFile:        vi.fn(),
      getDownloadsPath: () => '/tmp',
      mainWin:          {},
    };
    const result = await screenshotSaveHandler({ b64: 'x', filename: 'x.png' }, deps);
    expect(result).toEqual({ ok: false, canceled: true });
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('gibt { ok: false, canceled: true } zurück wenn filePath leer-string', async () => {
    const deps = {
      showSaveDialog:   vi.fn().mockResolvedValue({ canceled: false, filePath: '' }),
      writeFile:        vi.fn(),
      getDownloadsPath: () => '/tmp',
      mainWin:          {},
    };
    const result = await screenshotSaveHandler({ b64: 'x', filename: 'x.png' }, deps);
    expect(result).toEqual({ ok: false, canceled: true });
  });
});

// ─── D: writeFile schlägt fehl ────────────────────────────────────────────────

describe('D: screenshotSaveHandler – writeFile-Fehler', () => {
  it('gibt { ok: false, error } zurück wenn writeFile reject', async () => {
    const deps = {
      showSaveDialog:   vi.fn().mockResolvedValue({ canceled: false, filePath: '/tmp/shot.png' }),
      writeFile:        vi.fn().mockRejectedValue(new Error('EACCES: Permission denied')),
      getDownloadsPath: () => '/tmp',
      mainWin:          {},
    };
    const result = await screenshotSaveHandler({ b64: 'aGVsbG8=', filename: 'shot.png' }, deps);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('EACCES');
  });
});

// ─── E: Dateinamen-Sanitierung ────────────────────────────────────────────────

describe('E: screenshotSaveHandler – Dateinamen-Sanitierung', () => {
  let deps;

  beforeEach(() => {
    deps = {
      showSaveDialog:   vi.fn().mockResolvedValue({ canceled: false, filePath: '/tmp/safe.png' }),
      writeFile:        vi.fn().mockResolvedValue(undefined),
      getDownloadsPath: () => '/tmp',
      mainWin:          {},
    };
  });

  it('Path-Traversal: ../../etc/passwd → kein .. im defaultPath-Dateinamen', async () => {
    await screenshotSaveHandler({ b64: 'x', filename: '../../etc/passwd' }, deps);
    const opts = deps.showSaveDialog.mock.calls[0][1];
    const basename = path.basename(opts.defaultPath);
    expect(basename).not.toContain('..');
    expect(basename).not.toContain('/');
  });

  it('Sonderzeichen werden durch _ ersetzt', async () => {
    await screenshotSaveHandler({ b64: 'x', filename: 'shot;rm -rf /.png' }, deps);
    const opts   = deps.showSaveDialog.mock.calls[0][1];
    const name   = path.basename(opts.defaultPath);
    expect(name).not.toContain(';');
    expect(name).not.toContain(' ');
  });

  it('erlaubte Zeichen: Buchstaben, Zahlen, -, _, Punkt, Leerzeichen bleiben erhalten', async () => {
    await screenshotSaveHandler({ b64: 'x', filename: 'Desktop 1920x1080 2026.png' }, deps);
    const opts = deps.showSaveDialog.mock.calls[0][1];
    const name = path.basename(opts.defaultPath);
    // Leerzeichen und . sind erlaubt
    expect(name).toBe('Desktop 1920x1080 2026.png');
  });

  it('nur der Basename des Dateinamens landet im defaultPath (path.basename)', async () => {
    await screenshotSaveHandler({ b64: 'x', filename: '/some/deep/path/shot.png' }, deps);
    const opts = deps.showSaveDialog.mock.calls[0][1];
    const name = path.basename(opts.defaultPath);
    expect(name).toBe('shot.png');
  });
});

// ─── F: defaultPath enthält Downloads-Ordner + sicheren Namen ────────────────

describe('F: screenshotSaveHandler – defaultPath', () => {
  it('defaultPath = Downloads + sanitierter Dateiname', async () => {
    const deps = {
      showSaveDialog:   vi.fn().mockResolvedValue({ canceled: true }),
      writeFile:        vi.fn(),
      getDownloadsPath: () => '/home/user/Downloads',
      mainWin:          {},
    };
    await screenshotSaveHandler({ b64: 'x', filename: 'iPhone_390x844_1000.png' }, deps);
    const opts = deps.showSaveDialog.mock.calls[0][1];
    expect(opts.defaultPath).toBe('/home/user/Downloads/iPhone_390x844_1000.png');
  });
});

// ─── G: Dialog-Optionen – Titel und PNG-Filter ───────────────────────────────

describe('G: screenshotSaveHandler – Dialog-Optionen', () => {
  let deps;

  beforeEach(() => {
    deps = {
      showSaveDialog:   vi.fn().mockResolvedValue({ canceled: true }),
      writeFile:        vi.fn(),
      getDownloadsPath: () => '/tmp',
      mainWin:          {},
    };
  });

  it('übergibt title "Screenshot speichern"', async () => {
    await screenshotSaveHandler({ b64: 'x', filename: 'x.png' }, deps);
    const opts = deps.showSaveDialog.mock.calls[0][1];
    expect(opts.title).toBe('Screenshot speichern');
  });

  it('übergibt PNG-Filter in filters', async () => {
    await screenshotSaveHandler({ b64: 'x', filename: 'x.png' }, deps);
    const opts = deps.showSaveDialog.mock.calls[0][1];
    expect(opts.filters).toBeDefined();
    const pngFilter = opts.filters.find(f => f.extensions?.includes('png'));
    expect(pngFilter).toBeDefined();
  });

  it('filters enthält genau einen Eintrag für PNG', async () => {
    await screenshotSaveHandler({ b64: 'x', filename: 'x.png' }, deps);
    const opts = deps.showSaveDialog.mock.calls[0][1];
    expect(opts.filters).toHaveLength(1);
    expect(opts.filters[0].extensions).toContain('png');
  });
});

// ─── H + I + J: Quellcode-Struktur ───────────────────────────────────────────

const mainSrc       = readFileSync(new URL('../src/main.js',              import.meta.url), 'utf8');
const preloadSrc    = readFileSync(new URL('../src/preload.js',           import.meta.url), 'utf8');
const screenshotSrc = readFileSync(new URL('../src/renderer/screenshot.js', import.meta.url), 'utf8');

describe('H: Quellcode main.js – screenshot:save Handler', () => {
  it('registriert ipcMain.handle("screenshot:save")', () => {
    expect(mainSrc).toContain("ipcMain.handle('screenshot:save'");
  });

  it('verwendet dialog.showSaveDialog', () => {
    expect(mainSrc).toContain('dialog.showSaveDialog');
  });

  it('importiert dialog aus electron', () => {
    expect(mainSrc).toMatch(/import\s*\{[^}]*\bdialog\b[^}]*\}\s*from\s*['"]electron['"]/);
  });

  it('prüft canceled vor dem Schreiben', () => {
    const handlerStart = mainSrc.indexOf("ipcMain.handle('screenshot:save'");
    const handlerSlice = mainSrc.slice(handlerStart, handlerStart + 600);
    expect(handlerSlice).toContain('canceled');
  });

  it('verwendet fs.promises.writeFile (async, kein sync)', () => {
    const handlerStart = mainSrc.indexOf("ipcMain.handle('screenshot:save'");
    const handlerSlice = mainSrc.slice(handlerStart, handlerStart + 600);
    expect(handlerSlice).toContain('fs.promises.writeFile');
    expect(handlerSlice).not.toContain('fs.writeFileSync');
  });

  it('sanitiert den Dateinamen mit path.basename und replace', () => {
    const handlerStart = mainSrc.indexOf("ipcMain.handle('screenshot:save'");
    const handlerSlice = mainSrc.slice(handlerStart, handlerStart + 600);
    expect(handlerSlice).toContain('path.basename');
    expect(handlerSlice).toContain('.replace(');
  });

  it('gibt { ok: true, path } bei Erfolg zurück', () => {
    const handlerStart = mainSrc.indexOf("ipcMain.handle('screenshot:save'");
    const handlerSlice = mainSrc.slice(handlerStart, handlerStart + 600);
    expect(handlerSlice).toContain('ok: true');
    expect(handlerSlice).toContain('ok: false');
  });

  it('verwendet downloads-Pfad als defaultPath-Basis', () => {
    const handlerStart = mainSrc.indexOf("ipcMain.handle('screenshot:save'");
    const handlerSlice = mainSrc.slice(handlerStart, handlerStart + 600);
    expect(handlerSlice).toContain("'downloads'");
  });
});

describe('I: Quellcode preload.js – saveScreenshot via contextBridge', () => {
  it('exponiert saveScreenshot', () => {
    expect(preloadSrc).toContain('saveScreenshot');
  });

  it('ruft ipcRenderer.invoke("screenshot:save") auf', () => {
    expect(preloadSrc).toContain("ipcRenderer.invoke('screenshot:save'");
  });

  it('übergibt { b64, filename } als Argument', () => {
    const idx   = preloadSrc.indexOf('saveScreenshot');
    const slice = preloadSrc.slice(idx, idx + 120);
    expect(slice).toContain('b64');
    expect(slice).toContain('filename');
  });
});

describe('J: Quellcode screenshot.js – saveScreenshot statt a.click()', () => {
  it('verwendet window.ss.saveScreenshot()', () => {
    expect(screenshotSrc).toContain('window.ss.saveScreenshot');
  });

  it('kein a.click() mehr für Downloads', () => {
    // a.click() für Download-Anker ist nicht mehr erlaubt
    // (Inline-Kommentare oder SVG-Klicks sind ok – wir prüfen spezifisch
    //  das Download-Muster: href mit data: oder blob:)
    expect(screenshotSrc).not.toMatch(/\.href\s*=\s*['"]data:image/);
    expect(screenshotSrc).not.toMatch(/\.href\s*=\s*['"]blob:/);
  });

  it('blobDownload nutzt ebenfalls saveScreenshot', () => {
    const fnStart = screenshotSrc.indexOf('function blobDownload');
    const fnSlice = screenshotSrc.slice(fnStart, fnStart + 600);
    expect(fnSlice).toContain('saveScreenshot');
  });

  it('kein createElement("a") für Download-Anker mehr', () => {
    // createElement('a') darf nicht mehr für den Download-Mechanismus benutzt werden
    expect(screenshotSrc).not.toContain("createElement('a')");
    expect(screenshotSrc).not.toContain('createElement("a")');
  });
});
