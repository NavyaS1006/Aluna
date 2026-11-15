// Builds the initial design for a mission: defaults + mission preset; and enforces locked fields.
import { DEFAULT_DESIGN } from './design.js';
export function initialDesign(mission, saved) {
  const base = { ...DEFAULT_DESIGN, ...(mission.preset || {}), ...(saved || {}), ...(mission.lock || {}) };
  base.alloc = { ...DEFAULT_DESIGN.alloc, ...(mission.preset?.alloc || {}), ...(saved?.alloc || {}) };
  base.sensors = [...new Set([...(saved?.sensors || mission.preset?.sensors || DEFAULT_DESIGN.sensors)])];
  return base;
}
export function isLocked(mission, key) { return mission.lock && key in mission.lock; }
