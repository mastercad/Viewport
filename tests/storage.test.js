/**
 * Tests für storage.js (localStorage-Persistenz).
 *
 * localStorage wird per vi.stubGlobal gemockt – kein Browser nötig.
 * Die Storage-Funktionen greifen auf localStorage erst beim Aufruf zu
 * (nicht beim Modulimport), daher greift der Mock rechtzeitig.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveLayout, loadLayout, clearLayout,
  saveCustomDevice, loadCustomDevices,
  saveTemplate, loadTemplates, deleteTemplate,
  BUILTIN_TEMPLATES,
  saveScreenshotSettings, loadScreenshotSettings, SS_SETTINGS_DEFAULT,
} from '../src/renderer/storage.js';

// ─── localStorage-Mock ───────────────────────────────────────────────────────

let mockStore = {};

beforeEach(() => {
  mockStore = {};
  vi.stubGlobal('localStorage', {
    getItem:    (k)    => Object.prototype.hasOwnProperty.call(mockStore, k) ? mockStore[k] : null,
    setItem:    (k, v) => { mockStore[k] = String(v); },
    removeItem: (k)    => { delete mockStore[k]; },
    clear:      ()     => { mockStore = {}; },
  });
});

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

/** Erzeugt einen minimalen Panel-Eintrag für saveLayout */
function makePanel({ id = 'laptop', label = 'Laptop', w = 1366, h = 768,
  frame = null, rect = { x: 10, y: 20, w: 1366, h: 768 },
  scale = 1, url = 'https://example.com' } = {}) {
  const fakeWv = { getURL: () => url };
  return {
    def:    { id, label, w, h, frame },
    rect,
    scale,
    decoEl: { querySelector: () => fakeWv },
  };
}

// ─── loadLayout ──────────────────────────────────────────────────────────────

describe('loadLayout', () => {
  it('gibt leeres Array bei leerem Speicher zurück', () => {
    expect(loadLayout()).toEqual([]);
  });

  it('gibt leeres Array bei ungültigem JSON zurück', () => {
    mockStore['blickfang:layout'] = 'das ist kein json{';
    expect(loadLayout()).toEqual([]);
  });
});

// ─── saveLayout + loadLayout ─────────────────────────────────────────────────

describe('saveLayout + loadLayout', () => {
  it('gibt leeres Array für leere Panels-Map zurück', () => {
    saveLayout(new Map());
    expect(loadLayout()).toEqual([]);
  });

  it('speichert Panel-Daten und lädt sie korrekt zurück', () => {
    const panels = new Map([
      ['p1', makePanel({ id: 'laptop', label: 'Laptop', url: 'https://example.com/page' })],
    ]);
    saveLayout(panels);

    const loaded = loadLayout();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('laptop');
    expect(loaded[0].label).toBe('Laptop');
    expect(loaded[0].url).toBe('https://example.com/page');
    expect(loaded[0].rect).toEqual({ x: 10, y: 20, w: 1366, h: 768 });
    expect(loaded[0].scale).toBe(1);
  });

  it('speichert mehrere Panels und lädt alle zurück', () => {
    const panels = new Map([
      ['p1', makePanel({ id: 'laptop',  label: 'Laptop',  url: 'https://a.com' })],
      ['p2', makePanel({ id: 'iphone',  label: 'iPhone',  url: 'https://b.com', w: 390, h: 844 })],
      ['p3', makePanel({ id: 'android', label: 'Android', url: 'https://c.com', w: 360, h: 800 })],
    ]);
    saveLayout(panels);

    const loaded = loadLayout();
    expect(loaded).toHaveLength(3);
    expect(loaded.map(p => p.id)).toContain('laptop');
    expect(loaded.map(p => p.id)).toContain('iphone');
    expect(loaded.map(p => p.id)).toContain('android');
  });

  it('speichert leere URL wenn getURL about:blank zurückgibt', () => {
    const fakeWv = { getURL: () => 'about:blank' };
    const panels = new Map([
      ['p', {
        def:    { id: 'iphone', label: 'iPhone', w: 390, h: 844, frame: null },
        rect:   { x: 0, y: 0, w: 390, h: 844 },
        scale:  1,
        decoEl: { querySelector: () => fakeWv },
      }],
    ]);
    saveLayout(panels);
    expect(loadLayout()[0].url).toBe('');
  });

  it('speichert frame-Eigenschaft korrekt', () => {
    const frame = { t: 18, r: 10, b: 46, l: 10 };
    const panels = new Map([
      ['p', makePanel({ frame })],
    ]);
    saveLayout(panels);
    expect(loadLayout()[0].frame).toEqual(frame);
  });

  it('überschreibt vorherige Speicherung beim erneuten Aufruf', () => {
    saveLayout(new Map([['p1', makePanel({ id: 'laptop', url: 'https://a.com' })]]));
    saveLayout(new Map([['p2', makePanel({ id: 'iphone', url: 'https://b.com', w: 390, h: 844 })]]));
    const loaded = loadLayout();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('iphone');
  });
});

// ─── clearLayout ─────────────────────────────────────────────────────────────

describe('clearLayout', () => {
  it('entfernt gespeichertes Layout aus dem Speicher', () => {
    saveLayout(new Map([['p', makePanel()]]));
    expect(loadLayout()).toHaveLength(1);

    clearLayout();
    expect(loadLayout()).toEqual([]);
    expect(mockStore['blickfang:layout']).toBeUndefined();
  });

  it('wirft keinen Fehler wenn kein Layout gespeichert ist', () => {
    expect(() => clearLayout()).not.toThrow();
  });
});

// ─── loadCustomDevices ────────────────────────────────────────────────────────

describe('loadCustomDevices', () => {
  it('gibt leeres Array bei leerem Speicher zurück', () => {
    expect(loadCustomDevices()).toEqual([]);
  });

  it('gibt leeres Array bei ungültigem JSON zurück', () => {
    mockStore['blickfang:customDevices'] = '!!kein-json';
    expect(loadCustomDevices()).toEqual([]);
  });
});

// ─── saveCustomDevice + loadCustomDevices ─────────────────────────────────────

describe('saveCustomDevice + loadCustomDevices', () => {
  it('speichert ein Gerät und lädt es zurück', () => {
    const def = { id: 'mein-tablet', label: 'Mein Tablet', w: 800, h: 1200 };
    saveCustomDevice(def);

    const list = loadCustomDevices();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(def);
  });

  it('überschreibt Gerät mit gleicher id', () => {
    saveCustomDevice({ id: 'g1', label: 'Version 1', w: 100, h: 200 });
    saveCustomDevice({ id: 'g1', label: 'Version 2', w: 120, h: 220 });

    const list = loadCustomDevices();
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe('Version 2');
    expect(list[0].w).toBe(120);
  });

  it('speichert mehrere Geräte mit unterschiedlichen ids', () => {
    saveCustomDevice({ id: 'g1', label: 'Gerät 1', w: 100, h: 200 });
    saveCustomDevice({ id: 'g2', label: 'Gerät 2', w: 300, h: 400 });
    saveCustomDevice({ id: 'g3', label: 'Gerät 3', w: 500, h: 600 });

    expect(loadCustomDevices()).toHaveLength(3);
  });

  it('erhält bestehende Geräte beim Hinzufügen eines neuen', () => {
    saveCustomDevice({ id: 'g1', label: 'Bestehend', w: 100, h: 200 });
    saveCustomDevice({ id: 'g2', label: 'Neu',       w: 300, h: 400 });

    const list = loadCustomDevices();
    expect(list.find(d => d.id === 'g1')).toBeDefined();
    expect(list.find(d => d.id === 'g2')).toBeDefined();
  });
});

// ─── loadTemplates ────────────────────────────────────────────────────────────

describe('loadTemplates', () => {
  it('gibt leeres Array bei leerem Speicher zurück', () => {
    expect(loadTemplates()).toEqual([]);
  });

  it('gibt leeres Array bei ungültigem JSON zurück', () => {
    mockStore['blickfang:templates'] = '###ungültig###';
    expect(loadTemplates()).toEqual([]);
  });
});

// ─── saveTemplate + loadTemplates ─────────────────────────────────────────────

describe('saveTemplate + loadTemplates', () => {
  it('speichert ein Template und lädt es zurück', () => {
    const tpl = { id: 'mein-tpl', name: 'Mein Template', presets: ['laptop', 'iphone'] };
    saveTemplate(tpl);

    const list = loadTemplates();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(tpl);
  });

  it('überschreibt Template mit gleicher id', () => {
    saveTemplate({ id: 't1', name: 'Alt',  presets: ['laptop'] });
    saveTemplate({ id: 't1', name: 'Neu',  presets: ['iphone', 'android'] });

    const list = loadTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Neu');
    expect(list[0].presets).toEqual(['iphone', 'android']);
  });

  it('speichert mehrere Templates mit unterschiedlichen ids', () => {
    saveTemplate({ id: 'a', name: 'A', presets: ['laptop'] });
    saveTemplate({ id: 'b', name: 'B', presets: ['iphone'] });

    expect(loadTemplates()).toHaveLength(2);
  });
});

// ─── deleteTemplate ───────────────────────────────────────────────────────────

describe('deleteTemplate', () => {
  it('löscht Template mit passender id', () => {
    saveTemplate({ id: 'del-me', name: 'Weg',   presets: [] });
    saveTemplate({ id: 'keep',   name: 'Bleib',  presets: [] });

    deleteTemplate('del-me');

    const list = loadTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('keep');
  });

  it('lässt alle anderen Templates unverändert', () => {
    saveTemplate({ id: 'a', name: 'A', presets: [] });
    saveTemplate({ id: 'b', name: 'B', presets: [] });
    saveTemplate({ id: 'c', name: 'C', presets: [] });

    deleteTemplate('b');

    const list = loadTemplates();
    expect(list).toHaveLength(2);
    expect(list.map(t => t.id)).toContain('a');
    expect(list.map(t => t.id)).toContain('c');
    expect(list.map(t => t.id)).not.toContain('b');
  });

  it('wirft keinen Fehler wenn id nicht existiert', () => {
    saveTemplate({ id: 'a', name: 'A', presets: [] });
    expect(() => deleteTemplate('nicht-vorhanden')).not.toThrow();
    expect(loadTemplates()).toHaveLength(1);
  });

  it('wirft keinen Fehler auf leerem Speicher', () => {
    expect(() => deleteTemplate('irgendwas')).not.toThrow();
  });
});

// ─── SS_SETTINGS_DEFAULT ──────────────────────────────────────────────────────

describe('SS_SETTINGS_DEFAULT', () => {
  it('enthält alle erwarteten Standardfelder', () => {
    expect(SS_SETTINGS_DEFAULT).toMatchObject({
      mode:       expect.stringMatching(/^(single|workspace|combined)$/),
      withFrame:  expect.any(Boolean),
      withLabels: expect.any(Boolean),
    });
  });

  it('Standard-Modus ist "single"', () => {
    expect(SS_SETTINGS_DEFAULT.mode).toBe('single');
  });

  it('Rahmen und Labels sind standardmäßig aktiv', () => {
    expect(SS_SETTINGS_DEFAULT.withFrame).toBe(true);
    expect(SS_SETTINGS_DEFAULT.withLabels).toBe(true);
  });
});

// ─── loadScreenshotSettings ───────────────────────────────────────────────────

describe('loadScreenshotSettings', () => {
  it('gibt Standard-Einstellungen bei leerem Speicher zurück', () => {
    expect(loadScreenshotSettings()).toEqual(SS_SETTINGS_DEFAULT);
  });

  it('gibt Standard-Einstellungen bei ungültigem JSON zurück', () => {
    mockStore['blickfang:ssSettings'] = 'kein-json{';
    expect(loadScreenshotSettings()).toEqual(SS_SETTINGS_DEFAULT);
  });

  it('gibt Standard-Einstellungen zurück wenn mode ungültig ist', () => {
    mockStore['blickfang:ssSettings'] = JSON.stringify({ mode: 'unbekannt', withFrame: false, withLabels: false });
    const s = loadScreenshotSettings();
    expect(s.mode).toBe(SS_SETTINGS_DEFAULT.mode);
  });

  it('behält withFrame=false wenn gespeichert', () => {
    mockStore['blickfang:ssSettings'] = JSON.stringify({ mode: 'single', withFrame: false, withLabels: true });
    expect(loadScreenshotSettings().withFrame).toBe(false);
  });

  it('behält withLabels=false wenn gespeichert', () => {
    mockStore['blickfang:ssSettings'] = JSON.stringify({ mode: 'single', withFrame: true, withLabels: false });
    expect(loadScreenshotSettings().withLabels).toBe(false);
  });

  it('akzeptiert alle drei gültigen Modi', () => {
    for (const mode of ['single', 'workspace', 'combined']) {
      mockStore['blickfang:ssSettings'] = JSON.stringify({ mode, withFrame: true, withLabels: true });
      expect(loadScreenshotSettings().mode).toBe(mode);
    }
  });

  it('füllt fehlende Felder mit Standardwerten auf', () => {
    mockStore['blickfang:ssSettings'] = JSON.stringify({ mode: 'workspace' });
    const s = loadScreenshotSettings();
    expect(s.withFrame).toBe(SS_SETTINGS_DEFAULT.withFrame);
    expect(s.withLabels).toBe(SS_SETTINGS_DEFAULT.withLabels);
  });
});

// ─── saveScreenshotSettings + loadScreenshotSettings ─────────────────────────

describe('saveScreenshotSettings + loadScreenshotSettings', () => {
  it('speichert und lädt vollständige Einstellungen zurück', () => {
    const s = { mode: 'workspace', withFrame: false, withLabels: false };
    saveScreenshotSettings(s);
    expect(loadScreenshotSettings()).toEqual(s);
  });

  it('überschreibt vorherige Einstellungen', () => {
    saveScreenshotSettings({ mode: 'single',    withFrame: true,  withLabels: true  });
    saveScreenshotSettings({ mode: 'combined',  withFrame: false, withLabels: false });
    expect(loadScreenshotSettings()).toEqual({ mode: 'combined', withFrame: false, withLabels: false });
  });

  it('speichert mode=combined korrekt', () => {
    saveScreenshotSettings({ mode: 'combined', withFrame: true, withLabels: true });
    expect(loadScreenshotSettings().mode).toBe('combined');
  });

  it('speichert mode=workspace korrekt', () => {
    saveScreenshotSettings({ mode: 'workspace', withFrame: true, withLabels: true });
    expect(loadScreenshotSettings().mode).toBe('workspace');
  });

  it('speichert withFrame=false korrekt', () => {
    saveScreenshotSettings({ mode: 'single', withFrame: false, withLabels: true });
    expect(loadScreenshotSettings().withFrame).toBe(false);
  });

  it('speichert withLabels=false korrekt', () => {
    saveScreenshotSettings({ mode: 'single', withFrame: true, withLabels: false });
    expect(loadScreenshotSettings().withLabels).toBe(false);
  });

  it('schreibt in den Schlüssel blickfang:ssSettings', () => {
    saveScreenshotSettings({ mode: 'single', withFrame: true, withLabels: true });
    expect(mockStore['blickfang:ssSettings']).toBeDefined();
    expect(() => JSON.parse(mockStore['blickfang:ssSettings'])).not.toThrow();
  });

  it('wirft keinen Fehler wenn localStorage voll ist', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(() => saveScreenshotSettings({ mode: 'single', withFrame: true, withLabels: true })).not.toThrow();
  });
});

// ─── BUILTIN_TEMPLATES ────────────────────────────────────────────────────────

describe('BUILTIN_TEMPLATES', () => {
  it('enthält mindestens 4 Einträge', () => {
    expect(BUILTIN_TEMPLATES.length).toBeGreaterThanOrEqual(4);
  });

  it('jedes Entry hat id, name und presets-Array', () => {
    for (const tpl of BUILTIN_TEMPLATES) {
      expect(typeof tpl.id).toBe('string');
      expect(typeof tpl.name).toBe('string');
      expect(Array.isArray(tpl.presets)).toBe(true);
      expect(tpl.presets.length).toBeGreaterThan(0);
    }
  });

  it('alle ids sind einzigartig', () => {
    const ids = BUILTIN_TEMPLATES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('referenziert nur bekannte Preset-ids', () => {
    const validPresets = new Set(['desktop', 'laptop', 'tablet', 'iphone', 'android']);
    for (const tpl of BUILTIN_TEMPLATES) {
      for (const preset of tpl.presets) {
        expect(validPresets.has(preset), `Unbekanntes Preset "${preset}" in Template "${tpl.id}"`).toBe(true);
      }
    }
  });
});
