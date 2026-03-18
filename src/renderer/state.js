/**
 * Gemeinsamer App-Zustand.
 * panels: id → { def, rect, decoEl }
 *   rect: { x, y, w, h } in Workspace-relativen Koordinaten.
 *   h schließt FRAME_HEAD_H (Titelbar) ein.
 */
export const state = {
  panels:      new Map(),        // id -> { def, rect, scale, decoEl }
  wsRect:      { x: 0, y: 0, w: 0, h: 0 },
  topId:       null,
  panelScale:  1.0,              // globaler Default-Scale für neue Panels
  snapEnabled: true,
};

export function normalizeWsRect(r) {
  if (!r) return { x: 0, y: 0, w: 800, h: 600 };
  return { x: r.x ?? 0, y: r.y ?? 0, w: r.w ?? r.width ?? 800, h: r.h ?? r.height ?? 600 };
}

/** Klemmt rect vollständig in den Workspace.
 *  Verwendet die VISUELLE Größe (rect * scale), damit skalierte Panels
 *  den vollen Workspace nutzen können.
 */
export function clampRect(r, scale) {
  const s = scale ?? state.panelScale;
  return {
    ...r,
    x: Math.max(0, Math.min(r.x, state.wsRect.w - r.w * s)),
    y: Math.max(0, Math.min(r.y, state.wsRect.h - r.h * s)),
  };
}

/** CSS-Position des Deko-Elements aktualisieren (inkl. Skalierungs-Transform). */
export function applyDecoRect({ rect, decoEl, scale }) {
  const s = scale ?? state.panelScale;
  decoEl.style.left      = rect.x + 'px';
  decoEl.style.top       = rect.y + 'px';
  decoEl.style.width     = rect.w + 'px';
  decoEl.style.height    = rect.h + 'px';
  decoEl.style.transform = s < 1 ? `scale(${s})` : '';
}
