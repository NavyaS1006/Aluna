// Cinematic launch: preparation, countdown, ignition, liftoff, camera tracking, booster and stage
// separation, fairing jettison revealing the player's actual payload stack, then orbital insertion.
// Timing, vehicle (stages/boosters) and acceleration depend on the mission design (mass, launcher).
import { Suspense, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import Rocket, { rocketLayout } from '../three/Rocket.jsx';
import Exhaust from '../three/Exhaust.jsx';
import Starfield from '../three/Starfield.jsx';
import Earth from '../three/Earth.jsx';
import SatelliteModel from '../three/SatelliteModel.jsx';
import { budgets, LAUNCHERS } from '../sim/design.js';
import { useGame } from '../state/store.js';

export const LAUNCH_TIMELINE = { countdown: 10, ignition: 10, liftoff: 11.5, boosterSep: 24, stageSep: 31, fairingSep: 37, end: 45 };

export default function LaunchScene({ design, onPhase, onDone }) {
  const L = useMemo(() => rocketLayout(design.launcher), [design.launcher]);
  const b = useMemo(() => budgets(design), [design]);
  // thrust-to-weight from payload fraction: heavier payloads accelerate slower
  const loadFrac = Math.min(1, b.totalMass / Math.max(1, LAUNCHERS[design.launcher].capacityLeo));
  const accel = 4.2 - loadFrac * 1.8;
  const refs = { stage1: useRef(), boosters: useRef(), stage2: useRef(), fairingL: useRef(), fairingR: useRef(), upper: useRef() };
  const rocket = useRef();
  const T = useRef(0);
  const phaseRef = useRef('');
  const sky = useRef();
  const stars = useRef();
  const ground = useRef();
  const earth = useRef();
  const fallers = useRef({ s1: null, b: null, fl: null, fr: null });
  const { camera } = useThree();
  const skipTo = useGame((s) => s.launchSkip);
  const satsShown = Math.min(design.satCount, 6);
  const altRef = useRef(0);
  const prevY = useRef(0);

  const countRef = useRef(null);
  const setPhase = (p, extra) => { if (phaseRef.current !== p || (extra !== undefined && countRef.current !== extra)) { phaseRef.current = p; countRef.current = extra; onPhase?.(p, extra); } };

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    if (skipTo && T.current < LAUNCH_TIMELINE.end) T.current = LAUNCH_TIMELINE.end;
    T.current += dt;
    const t = T.current, TL = LAUNCH_TIMELINE;
    const r = rocket.current; if (!r) return;
    // vertical motion
    let y = 0;
    if (t > TL.liftoff) { const tt = t - TL.liftoff; y = 0.5 * accel * tt * tt + (tt > 15 ? (tt - 15) ** 3 * 0.6 : 0); }
    const prevYv = altRef.current; prevY.current = prevYv; altRef.current = y;
    r.position.y = y;
    r.rotation.z = t > TL.liftoff + 8 ? -Math.min(0.35, (t - TL.liftoff - 8) * 0.02) : 0; // gravity turn
    // phases
    if (t < TL.countdown) setPhase('countdown', Math.ceil(TL.countdown - t));
    else if (t < TL.liftoff) setPhase('ignition');
    else if (t < TL.boosterSep) setPhase('liftoff');
    else if (t < TL.stageSep) setPhase(L.boosters ? 'boosters' : 'maxq');
    else if (t < TL.fairingSep) setPhase('staging');
    else if (t < TL.end) setPhase('fairing');
    else { setPhase('insertion'); if (t > TL.end + 0.4) onDone?.(); }
    // separations — detach into world-space fallers
    const detach = (key, obj, vy, spin) => {
      if (!obj || fallers.current[key]) return;
      const wp = new THREE.Vector3(); obj.getWorldPosition(wp);
      fallers.current[key] = { obj, vy, spin, y0: wp.y, x0: wp.x, t0: t, vR: (y - prevY.current) / Math.max(dt, 1e-3) };
      obj.parent.remove(obj); r.parent.add(obj); obj.position.set(wp.x, wp.y, wp.z);
    };
    if (L.boosters && t > TL.boosterSep) detach('b', refs.boosters.current, -8, 0.4);
    if (t > TL.stageSep) detach('s1', refs.stage1.current, -15, 0.25);
    if (t > TL.fairingSep) { detach('fl', refs.fairingL.current, -2, 1); detach('fr', refs.fairingR.current, -2, -1); }
    for (const [k, f] of Object.entries(fallers.current)) {
      if (!f) continue;
      const tt = t - f.t0;
      f.obj.position.y = f.y0 + (f.vR + f.vy) * tt - 9.8 * tt * tt;
      if (k === 'fl' || k === 'fr') { f.obj.position.x = f.x0 + f.spin * tt * 4; f.obj.rotation.z = f.spin * tt * 0.8; }
      else { f.obj.position.x = f.x0 + tt * 0.6; f.obj.rotation.x = f.spin * tt; }
    }
    // sky / atmosphere transition with altitude
    const k = Math.min(1, y / 900);
    if (sky.current) sky.current.setRGB(0.45 * (1 - k) + 0.0 * k, 0.65 * (1 - k), 0.95 * (1 - k) + 0.02 * k);
    if (stars.current) stars.current.visible = k > 0.35;
    if (ground.current) ground.current.visible = y < 2500;
    if (earth.current) { earth.current.visible = y > 500; earth.current.position.y = y - 4200 + Math.min(1400, y * 0.25); }
    // camera tracking
    const ry = y + L.h * 0.6;
    let cam;
    if (t < TL.countdown) cam = new THREE.Vector3(Math.sin(t * 0.25) * L.h * 1.3, 4 + t * 0.6, Math.cos(t * 0.25) * L.h * 1.3);
    else if (t < TL.liftoff + 3) cam = new THREE.Vector3(L.h * 0.6, 3, L.h * 0.9);
    else if (t < TL.stageSep - 2) cam = new THREE.Vector3(L.h * 0.7, ry - L.h * 0.9, L.h * 1.1);
    else cam = new THREE.Vector3(L.h * 0.55, ry + L.h * 0.15, L.h * 0.75);
    camera.position.lerp(cam, 1 - Math.exp(-dt * (t < TL.liftoff + 3 ? 2 : 4)));
    camera.lookAt(0, t < TL.liftoff + 3 ? L.h * 0.5 + y : ry, 0);
  });

  const flameOrigin = (o) => { const r = rocket.current; const t = T.current; const s1 = !fallers.current.s1; o.set(0, (r?.position.y || 0) + (s1 ? -1 : L.first - 0.5), 0); return t; };
  const tl = LAUNCH_TIMELINE;
  return (
    <>
      <color ref={sky} attach="background" args={['#7aa6f0']} />
      <group ref={stars} visible={false}><Starfield count={3000} radius={6000} /></group>
      <hemisphereLight args={['#dbe8ff', '#5a4a3a', 0.9]} />
      <directionalLight position={[60, 120, 80]} intensity={2.2} castShadow />
      <group ref={ground}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[3000, 3000]} /><meshStandardMaterial color="#6b5a4a" roughness={1} /></mesh>
        <mesh position={[0, 0.5, 0]}><cylinderGeometry args={[L.r * 6, L.r * 7, 1, 32]} /><meshStandardMaterial color="#3a3d44" /></mesh>
        <mesh position={[L.r * 3.2, L.h * 0.55, 0]}><boxGeometry args={[1.6, L.h * 1.1, 1.6]} /><meshStandardMaterial color="#b0402a" metalness={0.5} /></mesh>
        {[0.3, 0.6, 0.85].map((f) => <mesh key={f} position={[L.r * 2, L.h * f, 0]}><boxGeometry args={[L.r * 2.4, 0.3, 0.6]} /><meshStandardMaterial color="#8a3020" /></mesh>)}
        <mesh position={[-60, 6, -80]}><boxGeometry args={[30, 12, 20]} /><meshStandardMaterial color="#c9cfd8" /></mesh>
      </group>
      <group ref={earth} visible={false} position={[0, -4200, 0]}>
        <Suspense fallback={null}><Earth radius={3600} sunDir={[0.6, 0.3, 0.7]} segments={64} /></Suspense>
      </group>
      <group ref={rocket}>
        <Rocket launcher={design.launcher} refs={refs} />
        {/* payload stack inside the fairing (each satellite is the player's design) */}
        <group position={[0, L.first + L.second + L.third + 1.2, 0]}>
          {Array.from({ length: satsShown }).map((_, k) => (
            <group key={k} position={[0, k * 1.0 * (design.bus === 'cubesat' ? 0.6 : 1), 0]} rotation={[0, k * 0.9, 0]}>
              <SatelliteModel design={design} accent={['#4fd1ff', '#ffb547', '#7cff9b', '#ff6fa8', '#b18cff', '#ffe066'][k]} scale={Math.min(0.8, (L.r * 0.9) / 2)} deployed={0.15} />
            </group>
          ))}
        </group>
      </group>
      <Exhaust activeFn={() => T.current > tl.ignition && T.current < tl.end} kind="flame" count={260} spread={L.r * 0.9} rate={1.2} getOrigin={flameOrigin} />
      <Exhaust activeFn={() => T.current > tl.ignition - 0.5 && T.current < tl.liftoff + 10} kind="smoke" count={260} spread={L.r * 1.2} rate={0.8} getOrigin={(o) => o.set(0, Math.max(1, (rocket.current?.position.y || 0) - 1), 0)} />
    </>
  );
}
