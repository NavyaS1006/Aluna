// Headquarters layout: facilities, walls, furniture colliders (axis-aligned boxes in XZ).
export const DOOR = { x: 0, z: -10, half: 3 };

export const FACILITIES = [
  { id: 'mission', name: 'Mission Control Room', desc: 'Select, review, start and resume missions.', pos: [0, -44], color: '#4fd1ff', icon: '🛰' },
  { id: 'satops', name: 'Satellite Operations Center', desc: 'Fleet health, power, comms, orbits and collision warnings.', pos: [-17, -38], color: '#7cff9b', icon: '📡' },
  { id: 'design', name: 'Spacecraft Design Laboratory', desc: 'Design buses, arrays, payloads, propulsion and sensors.', pos: [-18, -22], color: '#ffb547', icon: '🛠' },
  { id: 'ai', name: 'Autonomous Intelligence Ops', desc: 'Agents, decisions, approvals and safety warnings.', pos: [17, -38], color: '#b18cff', icon: '🧠' },
  { id: 'training', name: 'Training & Simulation Room', desc: 'Controls, tutorials, collision drills and design tests.', pos: [18, -22], color: '#5cf2d6', icon: '🎓' },
  { id: 'squad', name: 'Squad Coordination Room', desc: 'Friends, invitations, roles and squad mission prep.', pos: [-17, -14], color: '#ff6fa8', icon: '👥' },
];
export const INTERACT_RADIUS = 3.6;

// Static colliders [minX, minZ, maxX, maxZ]
const T = 0.6;
export const WALLS = [
  [-26, -10 - T, -DOOR.half, -10 + T], // front wall left of door
  [DOOR.half, -10 - T, 26, -10 + T], // front wall right
  [-26 - T, -52, -26 + T, -10], // left
  [26 - T, -52, 26 + T, -10], // right
  [-26, -52 - T, 26, -52 + T], // back
];
export const FURNITURE = [
  // central holo-table (approximated as box)
  [-2.6, -30.6, 2.6, -25.4],
  // facility consoles (desks in front of each bay)
  [-4, -48.5, 4, -46.8], // mission control desk row
  [-21, -41.5, -14, -40.2], // satops
  [-22.5, -25, -21.2, -19], // design lab
  [14, -41.5, 21, -40.2], // ai ops
  [21.2, -25, 22.5, -19], // training
  [-21, -12.6, -14, -11.4], // squad
  // pillars
  [-9.5, -20.5, -8.5, -19.5], [8.5, -20.5, 9.5, -19.5], [-9.5, -40.5, -8.5, -39.5], [8.5, -40.5, 9.5, -39.5],
  // lounge sofa
  [12, -15, 20, -13.6],
];
export const DOOR_COLLIDER = [-DOOR.half, -10 - T, DOOR.half, -10 + T];

export function resolveCollisions(p, radius, doorOpen) {
  const boxes = doorOpen > 0.85 ? [...WALLS, ...FURNITURE] : [...WALLS, ...FURNITURE, DOOR_COLLIDER];
  // world boundary (outdoor plaza)
  p.x = Math.max(-60, Math.min(60, p.x)); p.z = Math.max(-51.3, Math.min(40, p.z));
  for (const [x0, z0, x1, z1] of boxes) {
    const cx = Math.max(x0, Math.min(p.x, x1)), cz = Math.max(z0, Math.min(p.z, z1));
    const dx = p.x - cx, dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-9) { const d = Math.sqrt(d2); p.x = cx + (dx / d) * radius; p.z = cz + (dz / d) * radius; }
      else { // inside box: push out along smallest axis
        const pen = [[p.x - x0, -1, 0], [x1 - p.x, 1, 0], [p.z - z0, 0, -1], [z1 - p.z, 0, 1]].sort((a, b) => a[0] - b[0])[0];
        p.x += pen[1] * (pen[0] + radius); p.z += pen[2] * (pen[0] + radius);
      }
    }
  }
  return p;
}

export function nearestFacility(x, z) {
  let best = null;
  for (const f of FACILITIES) { const d = Math.hypot(x - f.pos[0], z - f.pos[1]); if (d < INTERACT_RADIUS && (!best || d < best.d)) best = { ...f, d }; }
  return best;
}
