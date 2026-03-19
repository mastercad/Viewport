/**
 * Reine Hilfsfunktionen für Screenshot-Compositing.
 * Keine DOM- oder Electron-Abhängigkeiten – vollständig unit-testbar.
 */
import { FRAME_HEAD_H } from './constants.js';

/**
 * Berechnet Position und Größe eines Panels im Workspace-Composite-Canvas.
 *
 * rect.w = def.w + frame.l + frame.r  (Gesamtbreite inkl. Geräterahmen)
 * rect.h = def.h + FRAME_HEAD_H + frame.t + frame.b  (Gesamthöhe)
 *
 * Der Frame-PNG aus composeDeviceFrame enthält KEIN FRAME_HEAD_H,
 * nur Bezel-oben + Inhalt + Bezel-unten → dy muss FRAME_HEAD_H (skaliert) überspringen.
 *
 * @param {{x: number, y: number, w: number, h: number}} rect  Panel-Rect in CSS-Workspace-Koordinaten
 * @param {number} pScale  Visuelle Skalierung des Panels (CSS transform scale)
 * @param {number} [PAD=20]  Randabstand des Canvas
 * @returns {{ dx: number, dy: number, drawW: number, drawH: number }}
 */
export function panelCompositeLayout(rect, pScale, PAD = 20) {
  return {
    drawW: Math.round(rect.w * pScale),
    drawH: Math.round((rect.h - FRAME_HEAD_H) * pScale),
    dx:    PAD + rect.x,
    dy:    PAD + rect.y + Math.round(FRAME_HEAD_H * pScale),
  };
}
