// Reine Entscheidungslogik für navigateWv (keine Seiteneffekte).
// @returns {{ action: 'noop'|'reload'|'pushState'|'loadURL', url?: string }}
export function navigateWvLogic(wv, url, wvReady) {
  if (!wv) return { action: 'noop' };

  let currentOrigin = null;
  let targetOrigin  = null;
  try {
    const cur = typeof wv.getURL === 'function' ? wv.getURL() : '';
    if (cur && cur !== 'about:blank') currentOrigin = new URL(cur).origin;
    targetOrigin = new URL(url).origin;
  } catch {
    return { action: 'loadURL', url };
  }

  if (!targetOrigin) return { action: 'loadURL', url };

  if (currentOrigin && currentOrigin === targetOrigin) {
    let samePath = false;
    try {
      const cur = new URL(typeof wv.getURL === 'function' ? wv.getURL() : '');
      const tgt = new URL(url);
      samePath = cur.pathname + cur.search === tgt.pathname + tgt.search;
    } catch { /* ignorieren – samePath bleibt false */ }

    if (samePath) {
      // Gleiche URL → reload damit neue Session-Cookies greifen
      return wvReady
        ? { action: 'reload' }
        : { action: 'loadURL', url };
    }

    // Gleiche Origin, anderer Pfad: pushState – kein Startseiten-Flash
    if (wvReady) return { action: 'pushState', url };

    return { action: 'loadURL', url };
  }

  return { action: 'loadURL', url };
}
