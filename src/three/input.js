// Shared input state: keyboard, mouse-drag camera, wheel zoom, and touch joystick feed one object.
export const input = { f: 0, r: 0, sprint: false, interact: false, yaw: Math.PI, pitch: 0.32, dist: 7, touch: { x: 0, y: 0, active: false }, enabled: true };

const keys = new Set();
let bound = false;

function recompute() {
  input.f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  input.r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  input.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
}

export function bindInput() {
  if (bound) return;
  bound = true;
  const isTyping = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName);
  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    keys.add(e.code); recompute();
    if (e.code === 'KeyE' || e.code === 'Enter') input.interact = true;
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); recompute(); });
  window.addEventListener('blur', () => { keys.clear(); recompute(); });
}

export function bindCameraDrag(el) {
  let drag = null;
  const down = (e) => { if (e.pointerType === 'touch' && input.touch.active && e.clientX < window.innerWidth * 0.45) return; drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; };
  const move = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    input.yaw -= (e.clientX - drag.x) * 0.006;
    input.pitch = Math.max(0.05, Math.min(1.2, input.pitch + (e.clientY - drag.y) * 0.004));
    drag.x = e.clientX; drag.y = e.clientY;
  };
  const up = (e) => { if (drag?.id === e.pointerId) drag = null; };
  const wheel = (e) => { input.dist = Math.max(3, Math.min(14, input.dist + e.deltaY * 0.005)); };
  el.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  el.addEventListener('wheel', wheel, { passive: true });
  return () => { el.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); el.removeEventListener('wheel', wheel); };
}

export function consumeInteract() { const v = input.interact; input.interact = false; return v; }
