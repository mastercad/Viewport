/**
 * Tests für die Mobile-Device-Emulation (Hamburger-Menü-Support).
 *
 * Hintergrund:
 * Viele responsive Websites zeigen Hamburger-Menüs nur auf mobilen Geräten
 * und nutzen dafür touch-spezifische Event-Listener (touchstart statt click),
 * CSS pointer:coarse oder navigator.maxTouchPoints > 0.
 *
 * Damit das funktioniert, sind zwei Schritte nötig (= Chrome DevTools Mobile):
 *   1. enableDeviceEmulation({ screenPosition:'mobile', ... })
 *      → Viewport-Größe, CSS-Breakpoints correctness
 *   2. CDP Emulation.setTouchEmulationEnabled({ enabled:true, maxTouchPoints:5 })
 *      → navigator.maxTouchPoints, CSS pointer:coarse, ontouchstart in window
 *
 * HINWEIS: Emulation.setEmitTouchEventsForMouse wird NICHT verwendet!
 *   Dieser CDP-Befehl konvertiert alle Chromium-level Mausereignisse zu Touch-Events
 *   und korrumpiert dadurch den Drag-Zustand im Host-Renderer. Hamburger-Menüs
 *   werden stattdessen per JS-Polyfill (did-finish-load + executeJavaScript)
 *   unterstützt: mousedown→touchstart, mouseup→touchend im Seitenkontext.
 *
 * Diese Tests sichern:
 *   A. detectFrameDevice()       – Geräteyp-Erkennung (pure function)
 *   B. getDeviceEmulationOpts()  – UA + mobile-Flag pro Gerätetyp
 *   C. DEVICE_UA                 – korrekte UA-Strings
 *   D. PRESETS.mobile            – korrekte mobile-Flags
 *   E. applyViewport()           – setViewport-Logik mit gemockten WebContents
 *      inkl. REGRESSIONSTESTS für alle drei CDP-Schritte
 */

import { describe, it, expect, vi } from 'vitest';
import { DEVICE_UA, PRESETS }       from '../src/renderer/constants.js';

// ── A: Pure helpers – repliziert aus src/renderer/panels.js ──────────────────
// Die Funktionen sind dort nicht exported, daher hier repliziert (wie in den
// anderen Test-Dateien dieses Projekts: scaleRestore, navigateWv etc.)

function detectFrameDevice(def) {
  if (!def.id.startsWith('custom-')) return def.id;
  const { w, h } = def;
  const portrait  = h >= w;
  if (portrait && Math.min(w, h) <= 500) return 'android';
  if (portrait && Math.min(w, h) <= 900) return 'tablet';
  if (w >= 900) return 'laptop';
  return 'desktop';
}

function getDeviceEmulationOpts(def) {
  const deviceType = detectFrameDevice(def);
  const mobile = def.mobile ?? (
    deviceType === 'android' || deviceType === 'iphone' || deviceType === 'tablet'
  );
  const ua = DEVICE_UA[deviceType] ?? DEVICE_UA.desktop;
  return { mobile, ua };
}

// ── E: setViewport-Logik – repliziert aus src/main.js IPC-Handler ────────────
// Nimmt ein WebContents-ähnliches Objekt (mock-fähig) statt echter Electron-API.
//
// HINWEIS zum JS-Touch-Polyfill (injiziert via did-finish-load in panels.js):
//   Der Polyfill registriert auf 'document' (capture-Phase) drei Listener:
//   mousedown → touchstart, mouseup → touchend, click → suppress (wenn touchstart preventDefault)
//   Das verhindert Doppel-Toggle: touchstart öffnet Menü, click würde es sonst schließen.

async function applyViewport(wc, { w, h, mobile, ua }) {
  if (!wc || wc.isDestroyed()) return false;
  if (ua) wc.setUserAgent(ua);
  if (mobile) {
    wc.enableDeviceEmulation({
      screenPosition:    'mobile',
      screenSize:        { width: w, height: h },
      viewPosition:      { x: 0, y: 0 },
      deviceScaleFactor: 0,
      scale:             1,
    });
    if (!wc.debugger.isAttached()) {
      try { wc.debugger.attach('1.3'); } catch (_) { /* ignored */ }
    }
    if (wc.debugger.isAttached()) {
      await wc.debugger.sendCommand('Emulation.setTouchEmulationEnabled', {
        enabled: true, maxTouchPoints: 5,
      }).catch(() => {});
      // setEmitTouchEventsForMouse wird NICHT verwendet – bricht Drag & Drop im Host-Renderer.
      // Touch-Support via JS-Polyfill (did-finish-load + executeJavaScript) in panels.js.
    }
  } else {
    wc.disableDeviceEmulation();
    if (wc.debugger.isAttached()) {
      await wc.debugger.sendCommand('Emulation.setTouchEmulationEnabled', {
        enabled: false, maxTouchPoints: 0,
      }).catch(() => {});
    }
  }
  return true;
}

// ── Mock-Factory für WebContents ──────────────────────────────────────────────

function makeMockWc({ initiallyAttached = false } = {}) {
  let _attached = initiallyAttached;
  return {
    isDestroyed:          vi.fn(() => false),
    setUserAgent:         vi.fn(),
    enableDeviceEmulation:  vi.fn(),
    disableDeviceEmulation: vi.fn(),
    debugger: {
      isAttached:  vi.fn(() => _attached),
      attach:      vi.fn(() => { _attached = true; }),
      sendCommand: vi.fn().mockResolvedValue({}),
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// A. detectFrameDevice()
// ═════════════════════════════════════════════════════════════════════════════

describe('detectFrameDevice()', () => {
  it('Preset-IDs werden unverändert zurückgegeben', () => {
    expect(detectFrameDevice({ id: 'iphone',  w: 390,  h: 844  })).toBe('iphone');
    expect(detectFrameDevice({ id: 'android', w: 360,  h: 800  })).toBe('android');
    expect(detectFrameDevice({ id: 'tablet',  w: 768,  h: 1024 })).toBe('tablet');
    expect(detectFrameDevice({ id: 'laptop',  w: 1366, h: 768  })).toBe('laptop');
    expect(detectFrameDevice({ id: 'desktop', w: 1920, h: 1080 })).toBe('desktop');
  });

  it('custom Hochformat ≤ 500px (kurze Seite) → android', () => {
    expect(detectFrameDevice({ id: 'custom-1', w: 375, h: 667 })).toBe('android'); // iPhone 6
    expect(detectFrameDevice({ id: 'custom-2', w: 360, h: 800 })).toBe('android'); // Galaxy S
    expect(detectFrameDevice({ id: 'custom-3', w: 480, h: 500 })).toBe('android'); // Grenzfall 480 ≤ 500
  });

  it('custom Hochformat 501–900px (kurze Seite) → tablet', () => {
    expect(detectFrameDevice({ id: 'custom-1', w: 600, h: 900 })).toBe('tablet');
    expect(detectFrameDevice({ id: 'custom-2', w: 768, h: 1024 })).toBe('tablet'); // iPad
    expect(detectFrameDevice({ id: 'custom-3', w: 501, h: 700 })).toBe('tablet'); // direkt über android-Grenze
  });

  it('custom Querformat mit Breite ≥ 900 → laptop', () => {
    expect(detectFrameDevice({ id: 'custom-1', w: 1280, h: 800  })).toBe('laptop');
    expect(detectFrameDevice({ id: 'custom-2', w: 900,  h: 600  })).toBe('laptop'); // Exakt 900
    expect(detectFrameDevice({ id: 'custom-3', w: 1920, h: 1080 })).toBe('laptop');
  });

  it('custom Querformat mit Breite < 900 → desktop', () => {
    expect(detectFrameDevice({ id: 'custom-1', w: 800, h: 600 })).toBe('desktop');
    expect(detectFrameDevice({ id: 'custom-2', w: 850, h: 768 })).toBe('desktop');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// B. getDeviceEmulationOpts()
// ═════════════════════════════════════════════════════════════════════════════

describe('getDeviceEmulationOpts()', () => {
  it('iphone → mobile:true, iPhone-UA', () => {
    const r = getDeviceEmulationOpts(PRESETS.iphone);
    expect(r.mobile).toBe(true);
    expect(r.ua).toBe(DEVICE_UA.iphone);
    expect(r.ua).toContain('iPhone');
  });

  it('android → mobile:true, Android-UA', () => {
    const r = getDeviceEmulationOpts(PRESETS.android);
    expect(r.mobile).toBe(true);
    expect(r.ua).toBe(DEVICE_UA.android);
    expect(r.ua).toContain('Android');
  });

  it('tablet → mobile:true, iPad-UA', () => {
    const r = getDeviceEmulationOpts(PRESETS.tablet);
    expect(r.mobile).toBe(true);
    expect(r.ua).toBe(DEVICE_UA.tablet);
    expect(r.ua).toContain('iPad');
  });

  it('laptop → mobile:false, Desktop-UA', () => {
    const r = getDeviceEmulationOpts(PRESETS.laptop);
    expect(r.mobile).toBe(false);
    expect(r.ua).toBe(DEVICE_UA.laptop);
    expect(r.ua).not.toContain('Mobile');   // kein mobiler UA
  });

  it('desktop → mobile:false, Desktop-UA', () => {
    const r = getDeviceEmulationOpts(PRESETS.desktop);
    expect(r.mobile).toBe(false);
    expect(r.ua).toBe(DEVICE_UA.desktop);
  });

  it('custom Querformat < 900px → desktop-Typ, desktop-UA', () => {
    const r = getDeviceEmulationOpts({ id: 'custom-99', w: 800, h: 600, mobile: false });
    expect(r.mobile).toBe(false);
    expect(r.ua).toBe(DEVICE_UA.desktop);
  });

  it('custom android-Größe ohne mobile-Flag → mobile:true per auto-Erkennung', () => {
    const r = getDeviceEmulationOpts({ id: 'custom-99', w: 360, h: 800 });
    expect(r.mobile).toBe(true);
    expect(r.ua).toBe(DEVICE_UA.android);
  });

  it('explicit mobile:false überschreibt auto-Erkennung', () => {
    // Ein custom-Preset mit Smartphone-Größe aber mobile:false explizit gesetzt.
    const r = getDeviceEmulationOpts({ id: 'custom-99', w: 360, h: 800, mobile: false });
    expect(r.mobile).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// C. DEVICE_UA – UA-String-Inhalte
// ═════════════════════════════════════════════════════════════════════════════

describe('DEVICE_UA – User-Agent-Strings', () => {
  it('alle UA-Einträge sind nicht-leere Strings', () => {
    for (const [key, ua] of Object.entries(DEVICE_UA)) {
      expect(ua, `DEVICE_UA.${key}`).toBeTruthy();
      expect(typeof ua, `DEVICE_UA.${key} Typ`).toBe('string');
      expect(ua.length, `DEVICE_UA.${key} Länge`).toBeGreaterThan(30);
    }
  });

  it('REGRESSION: android-UA enthält "Android" und "Mobile"', () => {
    expect(DEVICE_UA.android).toContain('Android');
    expect(DEVICE_UA.android).toContain('Mobile');
  });

  it('REGRESSION: iphone-UA enthält "iPhone" und "Mobile"', () => {
    expect(DEVICE_UA.iphone).toContain('iPhone');
    expect(DEVICE_UA.iphone).toContain('Mobile');
  });

  it('REGRESSION: tablet-UA enthält "iPad"', () => {
    expect(DEVICE_UA.tablet).toContain('iPad');
  });

  it('REGRESSION: desktop-UA und laptop-UA enthalten KEIN "Mobile"', () => {
    expect(DEVICE_UA.desktop).not.toContain('Mobile');
    expect(DEVICE_UA.laptop).not.toContain('Mobile');
  });

  it('alle UA-Strings enthalten AppleWebKit (Chromium-Basis)', () => {
    for (const ua of Object.values(DEVICE_UA)) {
      expect(ua).toContain('AppleWebKit');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// D. PRESETS – mobile-Flag
// ═════════════════════════════════════════════════════════════════════════════

describe('PRESETS – mobile-Flag', () => {
  it('REGRESSION: iphone, android, tablet → mobile:true', () => {
    expect(PRESETS.iphone.mobile,  'iphone').toBe(true);
    expect(PRESETS.android.mobile, 'android').toBe(true);
    expect(PRESETS.tablet.mobile,  'tablet').toBe(true);
  });

  it('REGRESSION: desktop, laptop → mobile:false', () => {
    expect(PRESETS.desktop.mobile, 'desktop').toBe(false);
    expect(PRESETS.laptop.mobile,  'laptop').toBe(false);
  });

  it('alle Presets haben einen mobile-Flag (nicht undefined)', () => {
    for (const [id, preset] of Object.entries(PRESETS)) {
      expect(typeof preset.mobile, id).toBe('boolean');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// E. applyViewport() – setViewport-Logik mit gemockten WebContents
// ═════════════════════════════════════════════════════════════════════════════

describe('applyViewport() – Grundverhalten', () => {
  it('null-WebContents → false', async () => {
    const result = await applyViewport(null, { w: 360, h: 800, mobile: true, ua: 'UA' });
    expect(result).toBe(false);
  });

  it('zerstörte WebContents (isDestroyed=true) → false', async () => {
    const wc = { isDestroyed: vi.fn(() => true) };
    expect(await applyViewport(wc, { w: 360, h: 800, mobile: true, ua: 'UA' })).toBe(false);
  });

  it('UA wird immer per setUserAgent gesetzt', async () => {
    const wc = makeMockWc();
    await applyViewport(wc, { w: 360, h: 800, mobile: true, ua: 'MobileUA/1.0' });
    expect(wc.setUserAgent).toHaveBeenCalledWith('MobileUA/1.0');
  });

  it('kein UA → setUserAgent wird nicht aufgerufen', async () => {
    const wc = makeMockWc();
    await applyViewport(wc, { w: 1920, h: 1080, mobile: false, ua: undefined });
    expect(wc.setUserAgent).not.toHaveBeenCalled();
  });
});

describe('applyViewport() – mobile=true (iPhone / Android / Tablet)', () => {
  it('enableDeviceEmulation mit screenPosition:"mobile"', async () => {
    const wc = makeMockWc();
    await applyViewport(wc, { w: 390, h: 844, mobile: true, ua: 'UA' });
    expect(wc.enableDeviceEmulation).toHaveBeenCalledWith(
      expect.objectContaining({ screenPosition: 'mobile' })
    );
  });

  it('enableDeviceEmulation mit korrekter screenSize', async () => {
    const wc = makeMockWc();
    await applyViewport(wc, { w: 390, h: 844, mobile: true, ua: 'UA' });
    expect(wc.enableDeviceEmulation).toHaveBeenCalledWith(
      expect.objectContaining({ screenSize: { width: 390, height: 844 } })
    );
  });

  it('disableDeviceEmulation wird NICHT aufgerufen', async () => {
    const wc = makeMockWc();
    await applyViewport(wc, { w: 390, h: 844, mobile: true, ua: 'UA' });
    expect(wc.disableDeviceEmulation).not.toHaveBeenCalled();
  });

  it('debugger wird attached (wenn noch nicht attached)', async () => {
    const wc = makeMockWc({ initiallyAttached: false });
    await applyViewport(wc, { w: 360, h: 800, mobile: true, ua: 'UA' });
    expect(wc.debugger.attach).toHaveBeenCalledWith('1.3');
  });

  it('debugger.attach() wird nicht erneut aufgerufen wenn bereits attached', async () => {
    const wc = makeMockWc({ initiallyAttached: true });
    await applyViewport(wc, { w: 360, h: 800, mobile: true, ua: 'UA' });
    expect(wc.debugger.attach).not.toHaveBeenCalled();
  });

  it('REGRESSION: Emulation.setTouchEmulationEnabled mit enabled:true + maxTouchPoints:5', async () => {
    // Setzt navigator.maxTouchPoints=5, CSS pointer:coarse, CSS hover:none.
    // Viele Sites prüfen das vor dem Setup ihrer Touch-Handler.
    const wc = makeMockWc({ initiallyAttached: false });
    await applyViewport(wc, { w: 360, h: 800, mobile: true, ua: 'UA' });
    expect(wc.debugger.sendCommand).toHaveBeenCalledWith(
      'Emulation.setTouchEmulationEnabled',
      { enabled: true, maxTouchPoints: 5 }
    );
  });

  it('REGRESSION: setEmitTouchEventsForMouse wird NICHT aufgerufen (bricht Drag & Drop)', async () => {
    // setEmitTouchEventsForMouse konvertiert ALLE Chromium-Mausereignisse zu Touch,
    // was den Drag-Zustand im Host-Renderer korrumpiert.
    // Touch-Support läuft stattdessen über einen JS-Polyfill in panels.js.
    const wc = makeMockWc({ initiallyAttached: false });
    await applyViewport(wc, { w: 360, h: 800, mobile: true, ua: 'UA' });
    const commands = wc.debugger.sendCommand.mock.calls.map(c => c[0]);
    expect(commands).not.toContain('Emulation.setEmitTouchEventsForMouse');
  });

  it('nur setTouchEmulationEnabled wird als CDP-Befehl gesendet (mobile)', async () => {
    // Exakt ein CDP-Befehl für mobile Emulation: setTouchEmulationEnabled.
    const wc = makeMockWc({ initiallyAttached: false });
    await applyViewport(wc, { w: 360, h: 800, mobile: true, ua: 'UA' });
    const commands = wc.debugger.sendCommand.mock.calls.map(c => c[0]);
    expect(commands).toContain('Emulation.setTouchEmulationEnabled');
    expect(commands).toHaveLength(1);
  });

  it('setTouchEmulationEnabled auch wenn debugger bereits attached war', async () => {
    // Wenn der Debugger schon attached ist (z.B. zweiter Aufruf), muss
    // setTouchEmulationEnabled trotzdem gesendet werden.
    const wc = makeMockWc({ initiallyAttached: true });
    await applyViewport(wc, { w: 360, h: 800, mobile: true, ua: 'UA' });
    const commands = wc.debugger.sendCommand.mock.calls.map(c => c[0]);
    expect(commands).toContain('Emulation.setTouchEmulationEnabled');
    expect(commands).not.toContain('Emulation.setEmitTouchEventsForMouse');
  });

  it('ein fehlschlagender CDP-Befehl wirft keinen Fehler (catch)', async () => {
    const wc = makeMockWc({ initiallyAttached: false });
    wc.debugger.sendCommand = vi.fn().mockRejectedValue(new Error('CDP error'));
    await expect(applyViewport(wc, { w: 360, h: 800, mobile: true, ua: 'UA' }))
      .resolves.toBe(true);
  });
});

describe('applyViewport() – mobile=false (Desktop / Laptop)', () => {
  it('disableDeviceEmulation wird aufgerufen', async () => {
    const wc = makeMockWc();
    await applyViewport(wc, { w: 1920, h: 1080, mobile: false, ua: 'UA' });
    expect(wc.disableDeviceEmulation).toHaveBeenCalled();
  });

  it('enableDeviceEmulation wird NICHT aufgerufen', async () => {
    const wc = makeMockWc();
    await applyViewport(wc, { w: 1920, h: 1080, mobile: false, ua: 'UA' });
    expect(wc.enableDeviceEmulation).not.toHaveBeenCalled();
  });

  it('wenn debugger attached → setTouchEmulationEnabled mit enabled:false', async () => {
    const wc = makeMockWc({ initiallyAttached: true });
    await applyViewport(wc, { w: 1366, h: 768, mobile: false, ua: 'UA' });
    expect(wc.debugger.sendCommand).toHaveBeenCalledWith(
      'Emulation.setTouchEmulationEnabled',
      { enabled: false, maxTouchPoints: 0 }
    );
  });

  it('REGRESSION: Desktop sendet kein setEmitTouchEventsForMouse', async () => {
    const wc = makeMockWc({ initiallyAttached: true });
    await applyViewport(wc, { w: 1366, h: 768, mobile: false, ua: 'UA' });
    const commands = wc.debugger.sendCommand.mock.calls.map(c => c[0]);
    expect(commands).not.toContain('Emulation.setEmitTouchEventsForMouse');
  });

  it('wenn debugger NICHT attached → keine CDP-Befehle für Desktop', async () => {
    const wc = makeMockWc({ initiallyAttached: false });
    await applyViewport(wc, { w: 1920, h: 1080, mobile: false, ua: 'UA' });
    expect(wc.debugger.sendCommand).not.toHaveBeenCalled();
    expect(wc.debugger.attach).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Integration: Preset → korrekte Emulations-Optionen
// ═════════════════════════════════════════════════════════════════════════════

describe('Integration – Preset zu Emulations-Optionen', () => {
  const mobilePresets  = ['iphone', 'android', 'tablet'];
  const desktopPresets = ['desktop', 'laptop'];

  for (const id of mobilePresets) {
    it(`PRESET ${id} → mobile:true + touch emulation aktiviert`, async () => {
      const opts = getDeviceEmulationOpts(PRESETS[id]);
      const wc   = makeMockWc({ initiallyAttached: false });
      await applyViewport(wc, { ...PRESETS[id], ...opts });
      expect(opts.mobile).toBe(true);
      expect(wc.enableDeviceEmulation).toHaveBeenCalledWith(
        expect.objectContaining({ screenPosition: 'mobile' })
      );
      const commands = wc.debugger.sendCommand.mock.calls.map(c => c[0]);
      expect(commands).toContain('Emulation.setTouchEmulationEnabled');
      expect(commands).not.toContain('Emulation.setEmitTouchEventsForMouse');
    });
  }

  for (const id of desktopPresets) {
    it(`PRESET ${id} → mobile:false + keine touch emulation`, async () => {
      const opts = getDeviceEmulationOpts(PRESETS[id]);
      const wc   = makeMockWc({ initiallyAttached: false });
      await applyViewport(wc, { ...PRESETS[id], ...opts });
      expect(opts.mobile).toBe(false);
      expect(wc.disableDeviceEmulation).toHaveBeenCalled();
      expect(wc.debugger.sendCommand).not.toHaveBeenCalled();
    });
  }
});
