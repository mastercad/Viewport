import { state } from './state.js';
import { cloneAnn } from './geometry.js';
import { redrawAll } from './render.js';

export function pushUndo() {
  state.undoStack.push(state.annotations.map(cloneAnn));
  if (state.undoStack.length > 60) state.undoStack.shift();
}

export function undoStep() {
  if (!state.undoStack.length) return;
  state.annotations = state.undoStack.pop();
  state.selectedId  = null;
  redrawAll();
}

export function clearAll() {
  pushUndo();
  state.annotations = [];
  state.selectedId  = null;
  redrawAll();
}

export function deleteSelected() {
  if (state.selectedId == null) return;
  pushUndo();
  state.annotations = state.annotations.filter(a => a.id !== state.selectedId);
  state.selectedId  = null;
  redrawAll();
}
