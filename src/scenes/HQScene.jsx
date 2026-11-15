// ALUNA Headquarters — interactive 3D hub with arrival sequences, third-person control,
// automatic doors, collision and six functional facilities.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import Character, { DEFAULT_LOOK } from '../three/Character.jsx';
import Earth from '../three/Earth.jsx';
import Starfield from '../three/Starfield.jsx';
import Rocket from '../three/Rocket.jsx';
import { FACILITIES, DOOR, WALLS, FURNITURE, resolveCollisions, nearestFacility } from '../three/hqLayout.js';
import { input, bindInput, bindCameraDrag, consumeInteract } from '../three/input.js';
import { useGame } from '../state/store.js';

// ---------------------------------------------------------------- textures
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const floorTex = () => { const t = canvasTex(512, 512, (g) => { g.fillStyle = '#1a2130'; g.fillRect(0, 0, 512, 512); g.strokeStyle = '#2a3548'; g.lineWidth = 3; for (let i = 0; i <= 512; i += 128) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); } g.strokeStyle = 'rgba(79,209,255,0.25)'; g.lineWidth = 2; g.strokeRect(6, 6, 500, 500); }); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(13, 11); return t; };
const groundTex = () => { const t = canvasTex(512, 512, (g) => { g.fillStyle = '#4a3b33'; g.fillRect(0, 0, 512, 512); for (let i = 0; i < 4000; i++) { const v = 50 + Math.random() * 40; g.fillStyle = `rgba(${v + 30},${v + 10},${v},${Math.random() * 0.4})`; g.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 3, 2 + Math.random() * 3); } }); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(30, 30); return t; };
const signTex = (text, sub, color) => canvasTex(1024, 256, (g, w, h) => { g.fillStyle = 'rgba(4,10,20,0.92)'; g.fillRect(0, 0, w, h); g.strokeStyle = color; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16); g.fillStyle = color; g.font = '700 92px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, sub ? 100 : h / 2); if (sub) { g.fillStyle = '#cfe6ff'; g.font = '400 44px system-ui, sans-serif'; g.fillText(sub, w / 2, 190); } });
const screenTex = (title, color, seed) => canvasTex(512, 320, (g, w, h) => {
  g.fillStyle = '#04101c'; g.fillRect(0, 0, w, h);
  g.strokeStyle = color; g.globalAlpha = 0.25; for (let y = 0; y < h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } g.globalAlpha = 1;
  g.fillStyle = color; g.font = '700 30px system-ui, sans-serif'; g.fillText(title, 18, 42);
  g.strokeStyle = color; g.lineWidth = 3; g.beginPath();
  for (let x = 0; x < w; x += 8) { const y = 200 + Math.sin(x * 0.03 + seed) * 40 + Math.sin(x * 0.11 + seed * 2) * 14; if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke();
  g.fillStyle = color; for (let k = 0; k < 6; k++) { g.globalAlpha = 0.6; g.fillRect(18 + k * 80, 70, 60, 18 + ((seed * 13 + k * 37) % 50)); } g.globalAlpha = 1;
});

// ---------------------------------------------------------------- static environment
function SkyDome() {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; void main(){ float h = vP.y; vec3 low = vec3(0.95,0.45,0.25); vec3 mid = vec3(0.18,0.12,0.30); vec3 top = vec3(0.01,0.02,0.07); vec3 c = h < 0.05 ? mix(low, mid, smoothstep(-0.05, 0.05, h)) : mix(mid, top, smoothstep(0.05, 0.45, h)); gl_FragColor = vec4(c,1.0); }',
  }), []);
  return <mesh material={mat}><sphereGeometry args={[300, 32, 16]} /></mesh>;
}

const M = {
  wall: new THREE.MeshStandardMaterial({ color: '#c9cfd8', metalness: 0.2, roughness: 0.7 }),
  wallIn: new THREE.MeshStandardMaterial({ color: '#232b3a', metalness: 0.4, roughness: 0.6 }),
  trim: new THREE.MeshStandardMaterial({ color: '#0e131c', metalness: 0.6, roughness: 0.4 }),
  glass: new THREE.MeshStandardMaterial({ color: '#7fd8ff', emissive: '#2a8cc0', emissiveIntensity: 0.9, transparent: true, opacity: 0.55, metalness: 0.9, roughness: 0.1 }),
  light: new THREE.MeshBasicMaterial({ color: '#bfe9ff' }),
  amber: new THREE.MeshBasicMaterial({ color: '#ffb547' }),
  desk: new THREE.MeshStandardMaterial({ color: '#2c3446', metalness: 0.6, roughness: 0.35 }),
  door: new THREE.MeshStandardMaterial({ color: '#9aa5b5', metalness: 0.8, roughness: 0.3 }),
  dish: new THREE.MeshStandardMaterial({ color: '#e6e9ef', metalness: 0.4, roughness: 0.5, side: THREE.DoubleSide }),
};

function Building({ doorRef }) {
  const floor = useMemo(floorTex, []);
  const sign = useMemo(() => signTex('ALUNA', 'SPACE OPERATIONS HEADQUARTERS', '#4fd1ff'), []);
  return (
    <group>
      {/* interior floor & ceiling */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, -31]} receiveShadow><planeGeometry args={[52, 42]} /><meshStandardMaterial map={floor} metalness={0.5} roughness={0.5} /></mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 9, -31]}><planeGeometry args={[52, 42]} /><meshStandardMaterial color="#121824" /></mesh>
      {/* ceiling light strips */}
      {[-16, -8, 0, 8, 16].map((x) => <mesh key={x} material={M.light} position={[x, 8.9, -31]}><boxGeometry args={[0.4, 0.05, 38]} /></mesh>)}
      {/* walls */}
      {WALLS.map(([x0, z0, x1, z1], k) => (
        <mesh key={k} material={k < 2 ? M.wall : M.wallIn} position={[(x0 + x1) / 2, 4.5, (z0 + z1) / 2]} castShadow receiveShadow><boxGeometry args={[x1 - x0, 9, z1 - z0]} /></mesh>
      ))}
      {/* exterior facade details */}
      <mesh material={M.trim} position={[0, 9.4, -10]}><boxGeometry args={[56, 0.8, 4]} /></mesh>
      {[-20, -12, 12, 20].map((x) => <mesh key={x} material={M.glass} position={[x, 5, -9.3]}><boxGeometry args={[5, 6, 0.1]} /></mesh>)}
      <mesh position={[0, 7.6, -9.25]}><planeGeometry args={[9, 2.25]} /><meshBasicMaterial map={sign} /></mesh>
      <mesh material={M.amber} position={[0, 6.1, -9.3]}><boxGeometry args={[7, 0.12, 0.1]} /></mesh>
      {/* interior window band on back wall */}
      <mesh material={M.glass} position={[0, 5.5, -51.3]}><boxGeometry args={[40, 3, 0.1]} /></mesh>
      {/* doors (animated by parent) */}
      <group ref={doorRef} position={[DOOR.x, 0, DOOR.z]}>
        <mesh name="L" material={M.door} position={[-1.5, 3, 0]} castShadow><boxGeometry args={[3, 6, 0.3]} /></mesh>
        <mesh name="R" material={M.door} position={[1.5, 3, 0]} castShadow><boxGeometry args={[3, 6, 0.3]} /></mesh>
        <mesh material={M.trim} position={[0, 6.4, 0]}><boxGeometry args={[7, 0.8, 0.9]} /></mesh>
        <mesh name="lamp" position={[0, 6.4, 0.5]}><boxGeometry args={[2, 0.2, 0.05]} /><meshBasicMaterial color="#ff5c5c" /></mesh>
      </group>
      {/* pillars */}
      {FURNITURE.slice(7, 11).map(([x0, z0, x1, z1], k) => <mesh key={k} material={M.trim} position={[(x0 + x1) / 2, 4.5, (z0 + z1) / 2]}><cylinderGeometry args={[0.55, 0.55, 9, 16]} /></mesh>)}
      {/* lounge sofa */}
      <mesh material={M.desk} position={[16, 0.45, -14.3]}><boxGeometry args={[8, 0.9, 1.4]} /></mesh>
      <pointLight position={[0, 7, -20]} intensity={40} distance={30} color="#9fd8ff" />
      <pointLight position={[0, 7, -40]} intensity={40} distance={30} color="#9fd8ff" />
    </group>
  );
}

function Facility({ f, active }) {
  const tex = useMemo(() => signTex(`${f.icon} ${f.name.split(' ').slice(0, 2).join(' ')}`, f.name.split(' ').slice(2).join(' ') || 'ALUNA', f.color), [f]);
  const scr = useMemo(() => [0, 1, 2].map((k) => screenTex(f.name.split(' ')[0].toUpperCase(), f.color, k + f.pos[0])), [f]);
  const ring = useRef();
  useFrame(({ clock }) => { if (ring.current) { ring.current.material.opacity = (active ? 0.75 : 0.3) + Math.sin(clock.elapsedTime * 3) * 0.12; ring.current.rotation.z = clock.elapsedTime * 0.3; } });
  // console orientation: face the zone
  const desk = { mission: [0, -47.6, 0], satops: [-17.5, -40.8, 0], design: [-21.8, -22, Math.PI / 2], ai: [17.5, -40.8, 0], training: [21.8, -22, -Math.PI / 2], squad: [-17.5, -12, Math.PI] }[f.id];
  return (
    <group>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[f.pos[0], 0.05, f.pos[1]]}>
        <ringGeometry args={[2.2, 2.5, 48]} />
        <meshBasicMaterial color={f.color} transparent opacity={0.4} />
      </mesh>
      <group position={[desk[0], 0, desk[1]]} rotation={[0, desk[2], 0]}>
        <mesh material={M.desk} position={[0, 0.5, 0]} castShadow><boxGeometry args={[f.id === 'mission' ? 8 : 6.6, 1, 1.2]} /></mesh>
        {[-1, 0, 1].map((k) => (
          <mesh key={k} position={[k * (f.id === 'mission' ? 2.6 : 2.1), 1.65, -0.35]} rotation={[-0.25, 0, 0]}>
            <planeGeometry args={[1.9, 1.15]} />
            <meshBasicMaterial map={scr[k + 1]} toneMapped={false} />
          </mesh>
        ))}
        <mesh position={[0, 4.6, -0.8]}><planeGeometry args={[6, 1.5]} /><meshBasicMaterial map={tex} toneMapped={false} /></mesh>
        {f.id === 'mission' && <mesh position={[0, 5.2, -3.4]}><planeGeometry args={[16, 5]} /><meshBasicMaterial map={scr[0]} toneMapped={false} /></mesh>}
      </group>
      <pointLight position={[f.pos[0], 3.5, f.pos[1]]} intensity={active ? 22 : 10} distance={9} color={f.color} />
    </group>
  );
}

function Exterior() {
  const ground = useMemo(groundTex, []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow><planeGeometry args={[400, 400]} /><meshStandardMaterial map={ground} roughness={1} /></mesh>
      {/* walkway */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 15]} receiveShadow><planeGeometry args={[7, 50]} /><meshStandardMaterial color="#5b5f68" roughness={0.9} /></mesh>
      {[-3.6, 3.6].map((x) => Array.from({ length: 8 }).map((_, k) => <mesh key={`${x}${k}`} material={M.light} position={[x, 0.1, 36 - k * 6]}><boxGeometry args={[0.2, 0.2, 0.6]} /></mesh>))}
      {/* launch complex in the distance */}
      <group position={[70, 0, -70]}>
        <mesh material={M.trim} position={[0, 0.5, 0]}><cylinderGeometry args={[9, 10, 1, 32]} /></mesh>
        <Rocket launcher="medium" />
        <mesh material={M.trim} position={[5, 22, 0]}><boxGeometry args={[2, 44, 2]} /></mesh>
        <pointLight position={[0, 30, 8]} intensity={300} distance={80} color="#ffd9a0" />
      </group>
      {/* tracking dishes */}
      {[[-45, -20], [-52, 5], [45, 10]].map(([x, z], k) => (
        <group key={k} position={[x, 0, z]}>
          <mesh material={M.trim} position={[0, 3, 0]}><cylinderGeometry args={[0.4, 0.8, 6]} /></mesh>
          <mesh material={M.dish} position={[0, 7, 0]} rotation={[-0.7 - k * 0.2, k, 0]}><sphereGeometry args={[4, 24, 12, 0, Math.PI * 2, 0, 0.75]} /></mesh>
        </group>
      ))}
    </group>
  );
}

function HoloEarth() {
  const g = useRef();
  useFrame((_, dt) => { if (g.current) g.current.rotation.y += dt * 0.15; });
  return (
    <group position={[0, 0, -28]}>
      <mesh material={M.desk} position={[0, 0.6, 0]}><cylinderGeometry args={[2.6, 2.9, 1.2, 40]} /></mesh>
      <mesh position={[0, 1.25, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[2.2, 2.5, 48]} /><meshBasicMaterial color="#4fd1ff" transparent opacity={0.6} /></mesh>
      <group ref={g} position={[0, 3.4, 0]}>
        <Earth radius={1.4} sunDir={[1, 0.3, 0.6]} segments={48} />
        {[0.3, -0.5, 1.1].map((t, k) => <mesh key={k} rotation={[Math.PI / 2 + t, 0, k]}><torusGeometry args={[1.9 + k * 0.25, 0.01, 6, 96]} /><meshBasicMaterial color={['#4fd1ff', '#ffb547', '#7cff9b'][k]} /></mesh>)}
      </group>
      <pointLight position={[0, 3.4, 0]} intensity={12} distance={8} color="#4fd1ff" />
    </group>
  );
}

// ---------------------------------------------------------------- characters & control
const FORMATION = [[0, 0], [-1.6, 1.2], [1.6, 1.2], [0, 2.4]];

function RemoteMember({ peer }) {
  const ref = useRef();
  const target = useRef(new THREE.Vector3());
  const pr = peer.presence;
  useFrame((_, dt) => {
    if (!ref.current || !pr?.p) return;
    target.current.set(pr.p[0], 0, pr.p[1]);
    ref.current.position.lerp(target.current, Math.min(1, dt * 8));
    const cur = ref.current.rotation.y; let d = (pr.p[2] || 0) - cur; d = Math.atan2(Math.sin(d), Math.cos(d));
    ref.current.rotation.y = cur + d * Math.min(1, dt * 10);
  });
  if (!pr?.p) return null;
  return <Character groupRef={ref} look={pr.look || DEFAULT_LOOK} anim={pr.anim || 'Idle'} name={pr.name || 'Crew'} sub={pr.role ? `${pr.role}` : 'Squad member'} />;
}

export default function HQScene({ squadRoom, memberIndex = 0 }) {
  const { gl, camera } = useThree();
  const profile = useGame((s) => s.profile);
  const mode = useGame((s) => s.mode);
  const facility = useGame((s) => s.facility);
  const hqArrived = useGame((s) => s.hqArrived);
  const setG = useGame((s) => s.set);
  const me = useRef();
  const doorRef = useRef();
  const off = FORMATION[memberIndex % 4];
  const pos = useRef(new THREE.Vector3(off[0], 0, hqArrived ? -30 : 26 + off[1]));
  const heading = useRef(Math.PI);
  const doorOpen = useRef(0);
  const [anim, setAnim] = useState('Walking');
  const animRef = useRef('Walking');
  const phase = useRef(hqArrived ? 'free' : 'arrive');
  const arrivalT = useRef(0);
  const camPos = useRef(new THREE.Vector3(0, 4, hqArrived ? -22 : 36));
  const lookAt = useRef(new THREE.Vector3());
  const near = useRef(null);
  const [peers, setPeers] = useState([]);
  const lastSend = useRef(0);
  const look = profile?.look || DEFAULT_LOOK;

  useEffect(() => { bindInput(); input.yaw = Math.PI; input.pitch = 0.3; input.dist = 7; return bindCameraDrag(gl.domElement); }, [gl]);
  useEffect(() => { if (!hqArrived) setG({ arrivalPhase: 'outside' }); }, [hqArrived, setG]);
  useEffect(() => {
    if (!squadRoom) { setPeers([]); return undefined; }
    return squadRoom.onPeers(({ peers: ps }) => setPeers(ps.filter((p) => !p.sameTab && p.presence?.p)));
  }, [squadRoom]);
  useEffect(() => { const regroup = () => { phase.current = 'arrive'; arrivalT.current = 0; pos.current.set(off[0], 0, 26 + off[1]); camPos.current.set(0, 4, 36); setG({ hqArrived: false, arrivalPhase: 'outside', facility: null }); }; window.addEventListener('aluna:regroup', regroup); return () => window.removeEventListener('aluna:regroup', regroup); }, [setG, off]);
  useEffect(() => { const skip = () => { if (phase.current === 'arrive') { phase.current = 'free'; pos.current.set(off[0], 0, -30 + off[1]); setG({ hqArrived: true, arrivalPhase: 'done' }); } }; window.addEventListener('aluna:skip-arrival', skip); return () => window.removeEventListener('aluna:skip-arrival', skip); }, [setG, off]);

  const setA = (a) => { if (animRef.current !== a) { animRef.current = a; setAnim(a); } };

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const p = pos.current;
    let moving = false, running = false;
    // ---- arrival sequence
    if (phase.current === 'arrive' && useGame.getState().skipArrival) { phase.current = 'free'; p.set(off[0], 0, -30 + off[1]); setG({ hqArrived: true, arrivalPhase: 'done', skipArrival: false }); }
    if (phase.current === 'arrive') {
      arrivalT.current += dt;
      const target = p.z > -6 + off[1] ? new THREE.Vector3(off[0] * 0.5, 0, -6 + off[1]) : new THREE.Vector3(off[0], 0, -24 + off[1]);
      const dir = target.clone().sub(p); dir.y = 0;
      const d = dir.length();
      const wantOpen = Math.abs(p.z - DOOR.z) < 9;
      if (p.z > DOOR.z + 0.8 && doorOpen.current < 0.9 && p.z < DOOR.z + 2.5 + off[1]) { /* wait for door */ setA('Idle'); }
      else if (d > 0.3) { dir.normalize(); p.addScaledVector(dir, dt * 2.6); heading.current = Math.atan2(dir.x, dir.z); moving = true; }
      if (p.z <= -6 && useGame.getState().arrivalPhase !== 'inside') setG({ arrivalPhase: 'inside' });
      else if (wantOpen && useGame.getState().arrivalPhase === 'outside') setG({ arrivalPhase: 'doors' });
      if (p.z < -23.5 + off[1]) { phase.current = 'free'; setG({ hqArrived: true, arrivalPhase: 'done' }); input.yaw = Math.PI; }
    } else if (input.enabled && !facility) {
      // ---- free movement
      const tf = input.f + (input.touch.active ? -input.touch.y : 0);
      const tr = input.r + (input.touch.active ? input.touch.x : 0);
      const mag = Math.min(1, Math.hypot(tf, tr));
      if (mag > 0.08) {
        const ang = Math.atan2(tr, tf) + input.yaw + Math.PI;
        running = input.sprint || (input.touch.active && Math.hypot(input.touch.x, input.touch.y) > 0.9);
        const sp = (running ? 6.2 : 2.8) * mag;
        p.x += Math.sin(ang) * sp * dt; p.z += Math.cos(ang) * sp * dt;
        let dh = ang - heading.current; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        heading.current += dh * Math.min(1, dt * 10);
        moving = true;
      }
      resolveCollisions(p, 0.45, doorOpen.current);
      const nf = nearestFacility(p.x, p.z);
      if ((nf?.id || null) !== (near.current?.id || null)) { near.current = nf; setG({ nearFacility: nf }); }
      if (consumeInteract() && nf) setG({ facility: nf.id });
    } else consumeInteract();
    setA(moving ? (running ? 'Running' : 'Walking') : 'Idle');
    if (me.current) { me.current.position.copy(p); me.current.rotation.y = heading.current; }
    // ---- doors: open when any character is near
    const anyNear = Math.abs(p.x - DOOR.x) < 5 && Math.abs(p.z - DOOR.z) < 6 || peers.some((pp) => Math.abs(pp.presence.p[0]) < 5 && Math.abs(pp.presence.p[1] - DOOR.z) < 6);
    doorOpen.current = THREE.MathUtils.damp(doorOpen.current, anyNear ? 1 : 0, 4, dt);
    if (doorRef.current) {
      const L = doorRef.current.getObjectByName('L'), R = doorRef.current.getObjectByName('R'), lamp = doorRef.current.getObjectByName('lamp');
      L.position.x = -1.5 - doorOpen.current * 2.9; R.position.x = 1.5 + doorOpen.current * 2.9;
      lamp.material.color.set(doorOpen.current > 0.5 ? '#7cff9b' : '#ff5c5c');
    }
    // ---- camera
    const yaw = phase.current === 'arrive' ? Math.PI + Math.sin(arrivalT.current * 0.35) * 0.5 : input.yaw;
    const dist = phase.current === 'arrive' ? 8 + Math.max(0, 6 - arrivalT.current) : input.dist;
    const pitch = phase.current === 'arrive' ? 0.28 : input.pitch;
    const inside = p.z < -10.5;
    const maxDist = inside ? Math.min(dist, 9) : dist;
    const desired = new THREE.Vector3(p.x - Math.sin(yaw) * maxDist * Math.cos(pitch), 1.6 + Math.sin(pitch) * maxDist + 0.6, p.z - Math.cos(yaw) * maxDist * Math.cos(pitch));
    if (inside) { desired.x = THREE.MathUtils.clamp(desired.x, -25, 25); desired.z = THREE.MathUtils.clamp(desired.z, -51, -10.8); desired.y = Math.min(desired.y, 8.4); }
    camPos.current.lerp(desired, 1 - Math.exp(-dt * 6));
    camera.position.copy(camPos.current);
    lookAt.current.lerp(new THREE.Vector3(p.x, 1.5, p.z), 1 - Math.exp(-dt * 10));
    camera.lookAt(lookAt.current);
    // ---- multiplayer presence (~8 Hz)
    if (squadRoom && state.clock.elapsedTime - lastSend.current > 0.12) {
      lastSend.current = state.clock.elapsedTime;
      squadRoom.presence({ p: [+p.x.toFixed(2), +p.z.toFixed(2), +heading.current.toFixed(2)], anim: animRef.current, look, name: profile?.displayName || 'Crew', role: useGame.getState().myRoleLabel || null }).catch(() => {});
    }
  });

  // squad arrival: show actual squad members walking in formation behind the player during arrival
  const nf = useGame((s) => s.nearFacility);
  return (
    <>
      <color attach="background" args={['#05070d']} />
      <fog attach="fog" args={['#1a1424', 60, 220]} />
      <SkyDome />
      <group position={[0, -30, 0]}><Starfield count={2500} radius={250} /></group>
      <hemisphereLight args={['#c9dcff', '#3a2a22', 0.55]} />
      <directionalLight position={[-40, 30, 40]} intensity={1.6} color="#ffc89a" castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-30} shadow-camera-right={30} shadow-camera-top={30} shadow-camera-bottom={-30} />
      <Exterior />
      <Building doorRef={doorRef} />
      <Suspense fallback={null}><HoloEarth /></Suspense>
      {FACILITIES.map((f) => <Facility key={f.id} f={f} active={nf?.id === f.id} />)}
      <Character groupRef={me} look={look} anim={anim} name={profile?.displayName || 'You'} sub={mode === 'squad' ? 'You · Squad Ops' : 'You'} />
      {peers.map((pp) => <RemoteMember key={pp.peer} peer={pp} />)}
      {mode === 'squad' && phase.current === 'arrive' && null}
    </>
  );
}
export { FORMATION };
