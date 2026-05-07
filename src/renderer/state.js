// rect.h schließt FRAME_HEAD_H (Titelbar-Höhe) ein.
export const state = {
  panels:      new Map(),
  wsRect:      { x: 0, y: 0, w: 0, h: 0 },
  topId:       null,
  panelScale:  1.0,
  snapEnabled: true,
};

export function normalizeWsRect(r) {
  if (!r) return { x: 0, y: 0, w: 800, h: 600 };
  return { x: r.x ?? 0, y: r.y ?? 0, w: r.w ?? r.width ?? 800, h: r.h ?? r.height ?? 600 };
}

// Klemmt gegen visuelle Größe. CSS scale() greift nur für s<1 (transform-origin top-left);
// für s>=1 bleibt die visuelle Größe rect.w × rect.h.
export function clampRect(r, scale) {
  const s = Math.min(scale ?? state.panelScale, 1);
  return {
    ...r,
    x: Math.max(0, Math.min(r.x, state.wsRect.w - r.w * s)),
    y: Math.max(0, Math.min(r.y, state.wsRect.h - r.h * s)),
  };
}

/**
 * Berechnet rect und Anker-Werte nach einer Skalierungsänderung.
 *
 * Die Position (naturalX/Y) bleibt der feste Anker. Beim Vergrößern wird
 * nur so weit geclamppt wie nötig. Beim Verkleinern kehrt das Panel exakt
 * zur Ausgangsposition zurück.
 *
 * @param {object} p        Panel-Objekt mit {rect, scale, naturalX?, naturalY?}
 * @param {number} newScale Neue Skalierung
 * @returns {{ rect, naturalX, naturalY }}
 */
export function computeScaleRect(p, newScale) {
  const naturalX = p.naturalX ?? p.rect.x;
  const naturalY = p.naturalY ?? p.rect.y;
  return {
    rect:     clampRect({ ...p.rect, x: naturalX, y: naturalY }, newScale),
    naturalX,
    naturalY,
  };
}

export function applyDecoRect({ rect, decoEl, scale }) {
  const s = scale ?? state.panelScale;
  decoEl.style.left      = rect.x + 'px';
  decoEl.style.top       = rect.y + 'px';
  decoEl.style.width     = rect.w + 'px';
  decoEl.style.height    = rect.h + 'px';
  decoEl.style.transform = s < 1 ? `scale(${s})` : '';
}
