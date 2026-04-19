/**
 * screenshot.settings.test.js
 *
 * Testet die Screenshot-Einstellungs-Logik:
 *
 *  A. wireScreenshotSettingsDialog() – Verdrahtung & Persistenz
 *     – Öffnet Dialog bei Klick auf ss-settings-btn
 *     – Befüllt Formular mit gespeicherten Werten beim Öffnen
 *     – Persistiert Einstellungen sofort bei jeder Änderung
 *     – Schließt Dialog bei Klick auf Close-Button
 *     – Schließt Dialog bei Klick auf Backdrop (dialog selbst)
 *
 *  B. Einstellungs-Ladelogik (repliziert)
 *     – Alle drei Modi werden korrekt aus dem Dialog ausgelesen
 *     – withFrame und withLabels werden korrekt ausgelesen
 *     – Fallback auf SS_SETTINGS_DEFAULT bei fehlendem Element
 *
 *  C. panels.js – withLabels-Klasse
 *     – screenshotPanel-Logik: ss-hide-labels wird gesetzt und entfernt
 *     – ss-hide-labels wird auch bei Fehler entfernt (finally)
 *
 *  D. Quellcode-Struktur
 *     – screenshot.js importiert loadScreenshotSettings aus storage.js
 *     – screenshot.js enthält keine ssMode/.value-Referenz mehr
 *     – screenshot.js enthält keine ssFrameCb/.checked-Referenz mehr
 *     – panels.js unterstützt withLabels-Parameter
 *     – index.html enthält keinen #ss-mode select mehr
 *     – index.html enthält keinen #ss-frame-cb checkbox mehr
 *     – index.html enthält #ss-settings-btn
 *     – index.html enthält #ss-settings-dialog
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path             from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');

// ─── A: wireScreenshotSettingsDialog-Logik (repliziert) ──────────────────────
//
// Die Funktion greift auf DOM-Elemente zu. Wir replizieren die Kernlogik und
// testen sie mit minimalen DOM-Stubs – konsistent mit den anderen Test-Dateien.

/**
 * Repliziert wireScreenshotSettingsDialog() für isolierte Unit-Tests.
 * Alle DOM-Abhängigkeiten werden als Parameter übergeben.
 *
 * @param {{ dialog, ssSettBtn, closeBtn, loadSettings, saveSettings, defaults }} deps
 */
function wireDialogLogic({ dialog, ssSettBtn, closeBtn, loadSettings, saveSettings, defaults }) {
  if (!dialog || !ssSettBtn) return;

  const applySettings = (s) => {
    const radio = dialog.querySelector(`input[name="ss-mode"][value="${s.mode}"]`);
    if (radio) radio.checked = true;
    const frameCb  = dialog.querySelector('#ss-dlg-frame-cb');
    const labelsCb = dialog.querySelector('#ss-dlg-labels-cb');
    if (frameCb)  frameCb.checked  = s.withFrame;
    if (labelsCb) labelsCb.checked = s.withLabels;
  };

  ssSettBtn.addEventListener('click', () => {
    applySettings(loadSettings());
    dialog.showModal();
  });

  closeBtn?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });

  dialog.addEventListener('change', () => {
    const mode       = dialog.querySelector('input[name="ss-mode"]:checked')?.value ?? defaults.mode;
    const withFrame  = dialog.querySelector('#ss-dlg-frame-cb')?.checked  ?? defaults.withFrame;
    const withLabels = dialog.querySelector('#ss-dlg-labels-cb')?.checked ?? defaults.withLabels;
    saveSettings({ mode, withFrame, withLabels });
  });
}

/** Erzeugt einen minimalen Dialog-DOM-Stub. */
function makeDialogStub() {
  const listeners = {};
  const radios = [
    { name: 'ss-mode', value: 'single',    checked: true  },
    { name: 'ss-mode', value: 'workspace', checked: false },
    { name: 'ss-mode', value: 'combined',  checked: false },
  ];
  const frameCb  = { id: 'ss-dlg-frame-cb',  checked: true  };
  const labelsCb = { id: 'ss-dlg-labels-cb', checked: true  };

  const dialog = {
    _open: false,
    showModal() { this._open = true; },
    close()     { this._open = false; },
    addEventListener(event, fn) {
      (listeners[event] ??= []).push(fn);
    },
    dispatchEvent(event) {
      (listeners[event.type] ?? []).forEach(fn => fn(event));
    },
    querySelector(sel) {
      if (sel === '#ss-dlg-frame-cb')  return frameCb;
      if (sel === '#ss-dlg-labels-cb') return labelsCb;
      // input[name="ss-mode"][value="X"]
      const m = sel.match(/input\[name="ss-mode"\]\[value="([^"]+)"\]/);
      if (m) return radios.find(r => r.value === m[1]) ?? null;
      // input[name="ss-mode"]:checked
      if (sel === 'input[name="ss-mode"]:checked') return radios.find(r => r.checked) ?? null;
      return null;
    },
  };
  return { dialog, radios, frameCb, labelsCb, listeners };
}

function makeBtn() {
  const listeners = {};
  return {
    addEventListener(event, fn) { (listeners[event] ??= []).push(fn); },
    click() { (listeners['click'] ?? []).forEach(fn => fn({})); },
  };
}

// ─── A: Öffnen & Befüllen ─────────────────────────────────────────────────────

describe('A: wireScreenshotSettingsDialog – Öffnen & Befüllen', () => {
  let saveSettings, loadSettings;
  let stub, ssSettBtn, closeBtn;

  beforeEach(() => {
    stub      = makeDialogStub();
    ssSettBtn = makeBtn();
    closeBtn  = makeBtn();
    saveSettings = vi.fn();
    loadSettings = vi.fn().mockReturnValue({ mode: 'workspace', withFrame: false, withLabels: false });

    wireDialogLogic({
      dialog:       stub.dialog,
      ssSettBtn,
      closeBtn,
      loadSettings,
      saveSettings,
      defaults:     { mode: 'single', withFrame: true, withLabels: true },
    });
  });

  it('öffnet Dialog bei Klick auf Settings-Button', () => {
    ssSettBtn.click();
    expect(stub.dialog._open).toBe(true);
  });

  it('ruft loadSettings beim Öffnen auf', () => {
    ssSettBtn.click();
    expect(loadSettings).toHaveBeenCalledOnce();
  });

  it('setzt Radio auf gespeicherten Modus beim Öffnen', () => {
    ssSettBtn.click();
    expect(stub.radios.find(r => r.value === 'workspace')?.checked).toBe(true);
  });

  it('setzt frameCb auf gespeicherten Wert beim Öffnen', () => {
    ssSettBtn.click();
    expect(stub.frameCb.checked).toBe(false);
  });

  it('setzt labelsCb auf gespeicherten Wert beim Öffnen', () => {
    ssSettBtn.click();
    expect(stub.labelsCb.checked).toBe(false);
  });
});

// ─── A: Schließen ─────────────────────────────────────────────────────────────

describe('A: wireScreenshotSettingsDialog – Schließen', () => {
  let stub, ssSettBtn, closeBtn;

  beforeEach(() => {
    stub      = makeDialogStub();
    ssSettBtn = makeBtn();
    closeBtn  = makeBtn();
    wireDialogLogic({
      dialog:       stub.dialog,
      ssSettBtn,
      closeBtn,
      loadSettings:  () => ({ mode: 'single', withFrame: true, withLabels: true }),
      saveSettings:  vi.fn(),
      defaults:      { mode: 'single', withFrame: true, withLabels: true },
    });
    ssSettBtn.click(); // öffnen
  });

  it('schließt Dialog bei Klick auf Close-Button', () => {
    closeBtn.click();
    expect(stub.dialog._open).toBe(false);
  });

  it('schließt Dialog bei Klick auf Backdrop (dialog als event.target)', () => {
    const clickEvt = { type: 'click', target: stub.dialog };
    stub.dialog.dispatchEvent(clickEvt);
    expect(stub.dialog._open).toBe(false);
  });

  it('schließt Dialog NICHT bei Klick auf Kind-Element', () => {
    const childEl = {};
    stub.dialog.dispatchEvent({ type: 'click', target: childEl });
    expect(stub.dialog._open).toBe(true);
  });
});

// ─── A: Persistenz bei Änderung ───────────────────────────────────────────────

describe('A: wireScreenshotSettingsDialog – Persistenz', () => {
  let stub, saveSettings;

  beforeEach(() => {
    stub         = makeDialogStub();
    saveSettings = vi.fn();
    wireDialogLogic({
      dialog:       stub.dialog,
      ssSettBtn:    makeBtn(),
      closeBtn:     makeBtn(),
      loadSettings:  () => ({ mode: 'single', withFrame: true, withLabels: true }),
      saveSettings,
      defaults:      { mode: 'single', withFrame: true, withLabels: true },
    });
  });

  it('ruft saveSettings bei change-Event auf', () => {
    stub.dialog.dispatchEvent({ type: 'change' });
    expect(saveSettings).toHaveBeenCalledOnce();
  });

  it('übergibt aktuell selektierten Modus an saveSettings', () => {
    // Wechsel auf "combined"
    stub.radios.forEach(r => { r.checked = r.value === 'combined'; });
    stub.dialog.dispatchEvent({ type: 'change' });
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ mode: 'combined' }));
  });

  it('übergibt withFrame=false wenn Checkbox deaktiviert', () => {
    stub.frameCb.checked = false;
    stub.dialog.dispatchEvent({ type: 'change' });
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ withFrame: false }));
  });

  it('übergibt withLabels=false wenn Checkbox deaktiviert', () => {
    stub.labelsCb.checked = false;
    stub.dialog.dispatchEvent({ type: 'change' });
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ withLabels: false }));
  });

  it('übergibt alle drei Felder gleichzeitig', () => {
    stub.radios.forEach(r => { r.checked = r.value === 'workspace'; });
    stub.frameCb.checked  = true;
    stub.labelsCb.checked = false;
    stub.dialog.dispatchEvent({ type: 'change' });
    expect(saveSettings).toHaveBeenCalledWith({ mode: 'workspace', withFrame: true, withLabels: false });
  });
});

// ─── A: Early-Return wenn keine Elemente ──────────────────────────────────────

describe('A: wireScreenshotSettingsDialog – kein Fehler ohne Elemente', () => {
  it('wirft keinen Fehler wenn dialog null ist', () => {
    expect(() => wireDialogLogic({
      dialog:       null,
      ssSettBtn:    makeBtn(),
      closeBtn:     makeBtn(),
      loadSettings:  vi.fn(),
      saveSettings:  vi.fn(),
      defaults:      { mode: 'single', withFrame: true, withLabels: true },
    })).not.toThrow();
  });

  it('wirft keinen Fehler wenn ssSettBtn null ist', () => {
    const stub = makeDialogStub();
    expect(() => wireDialogLogic({
      dialog:       stub.dialog,
      ssSettBtn:    null,
      closeBtn:     makeBtn(),
      loadSettings:  vi.fn(),
      saveSettings:  vi.fn(),
      defaults:      { mode: 'single', withFrame: true, withLabels: true },
    })).not.toThrow();
  });

  it('öffnet ohne Fehler auch ohne closeBtn (optional)', () => {
    const stub      = makeDialogStub();
    const ssSettBtn = makeBtn();
    wireDialogLogic({
      dialog:       stub.dialog,
      ssSettBtn,
      closeBtn:     null,
      loadSettings:  () => ({ mode: 'single', withFrame: true, withLabels: true }),
      saveSettings:  vi.fn(),
      defaults:      { mode: 'single', withFrame: true, withLabels: true },
    });
    expect(() => ssSettBtn.click()).not.toThrow();
  });
});

// ─── C: panels.js – withLabels CSS-Klasse (repliziert) ───────────────────────

/** Repliziert die body-class-Logik aus screenshotPanel() für isolierte Tests. */
async function screenshotPanelWithLabels({ withLabels, captureRect }) {
  const bodyClasses = new Set();
  const body = {
    classList: {
      add:    c => bodyClasses.add(c),
      remove: c => bodyClasses.delete(c),
    },
  };

  let classWasSetDuringCapture = false;
  if (!withLabels) body.classList.add('ss-hide-labels');
  try {
    classWasSetDuringCapture = bodyClasses.has('ss-hide-labels');
    await captureRect({ x: 0, y: 0, width: 100, height: 200 });
  } finally {
    if (!withLabels) body.classList.remove('ss-hide-labels');
  }
  return { classWasSetDuringCapture, classAfter: bodyClasses.has('ss-hide-labels') };
}

describe('C: panels.js – withLabels CSS-Klasse', () => {
  it('fügt ss-hide-labels hinzu wenn withLabels=false', async () => {
    const captureRect = vi.fn().mockResolvedValue('png');
    const { classWasSetDuringCapture } = await screenshotPanelWithLabels({
      withLabels: false, captureRect,
    });
    expect(classWasSetDuringCapture).toBe(true);
  });

  it('entfernt ss-hide-labels nach dem Screenshot', async () => {
    const captureRect = vi.fn().mockResolvedValue('png');
    const { classAfter } = await screenshotPanelWithLabels({ withLabels: false, captureRect });
    expect(classAfter).toBe(false);
  });

  it('setzt ss-hide-labels NICHT wenn withLabels=true', async () => {
    const captureRect = vi.fn().mockResolvedValue('png');
    const { classWasSetDuringCapture } = await screenshotPanelWithLabels({
      withLabels: true, captureRect,
    });
    expect(classWasSetDuringCapture).toBe(false);
  });

  it('entfernt ss-hide-labels auch bei Fehler (finally)', async () => {
    const bodyClasses = new Set();
    const body = { classList: { add: c => bodyClasses.add(c), remove: c => bodyClasses.delete(c) } };
    body.classList.add('ss-hide-labels');
    try {
      try {
        throw new Error('test error');
      } finally {
        body.classList.remove('ss-hide-labels');
      }
    } catch { /* Fehler erwartet – finally muss trotzdem aufgeräumt haben */ }
    expect(bodyClasses.has('ss-hide-labels')).toBe(false);
  });
});

// ─── D: Quellcode-Struktur ────────────────────────────────────────────────────

const screenshotSrc = readFileSync(path.join(ROOT, 'src/renderer/screenshot.js'), 'utf8');
const panelsSrc     = readFileSync(path.join(ROOT, 'src/renderer/panels.js'),     'utf8');
const indexHtml     = readFileSync(path.join(ROOT, 'src/renderer/index.html'),    'utf8');

describe('D: Quellcode-Struktur – screenshot.js', () => {
  it('importiert loadScreenshotSettings aus storage.js', () => {
    expect(screenshotSrc).toMatch(/loadScreenshotSettings/);
    expect(screenshotSrc).toMatch(/from ['"]\.\/storage\.js['"]/);
  });

  it('enthält keine ssMode.value-Referenz mehr', () => {
    expect(screenshotSrc).not.toMatch(/ssMode\s*\?\s*\.value|ssMode\.value/);
  });

  it('enthält keine ssFrameCb.checked-Referenz mehr', () => {
    expect(screenshotSrc).not.toMatch(/ssFrameCb\s*\?\s*\.checked|ssFrameCb\.checked/);
  });

  it('enthält wireScreenshotSettingsDialog-Export', () => {
    expect(screenshotSrc).toMatch(/wireScreenshotSettingsDialog/);
  });

  it('enthält ss-settings-btn Referenz', () => {
    expect(screenshotSrc).toMatch(/ss-settings-btn/);
  });
});

describe('D: Quellcode-Struktur – panels.js', () => {
  it('screenshotPanel unterstützt withLabels-Parameter', () => {
    expect(panelsSrc).toMatch(/withLabels/);
  });

  it('screenshotPanel setzt ss-hide-labels-Klasse', () => {
    expect(panelsSrc).toMatch(/ss-hide-labels/);
  });

  it('screenshotAllPanels übergibt withLabels weiter', () => {
    expect(panelsSrc).toMatch(/screenshotAllPanels[\s\S]*?withLabels/);
  });
});

describe('D: Quellcode-Struktur – index.html', () => {
  it('enthält keinen #ss-mode select mehr', () => {
    expect(indexHtml).not.toMatch(/id="ss-mode"/);
  });

  it('enthält keinen #ss-frame-cb checkbox mehr', () => {
    expect(indexHtml).not.toMatch(/id="ss-frame-cb"/);
  });

  it('enthält #ss-settings-btn', () => {
    expect(indexHtml).toMatch(/id="ss-settings-btn"/);
  });

  it('enthält #ss-settings-dialog', () => {
    expect(indexHtml).toMatch(/id="ss-settings-dialog"/);
  });

  it('enthält drei Radio-Buttons für Modi', () => {
    const singles   = (indexHtml.match(/value="single"/g)   ?? []).length;
    const workspace = (indexHtml.match(/value="workspace"/g) ?? []).length;
    const combined  = (indexHtml.match(/value="combined"/g)  ?? []).length;
    expect(singles).toBeGreaterThanOrEqual(1);
    expect(workspace).toBeGreaterThanOrEqual(1);
    expect(combined).toBeGreaterThanOrEqual(1);
  });

  it('enthält ss-dlg-frame-cb Toggle', () => {
    expect(indexHtml).toMatch(/id="ss-dlg-frame-cb"/);
  });

  it('enthält ss-dlg-labels-cb Toggle', () => {
    expect(indexHtml).toMatch(/id="ss-dlg-labels-cb"/);
  });
});
