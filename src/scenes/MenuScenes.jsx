// Cinematic backdrop scenes for intro / title / menus and the spacecraft design hangar.
import { Suspense, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import Earth from '../three/Earth.jsx';
import Starfield from '../three/Starfield.jsx';
import SatelliteModel from '../three/SatelliteModel.jsx';
import { DEFAULT_DESIGN } from '../sim/design.js';

const SHOWCASE = [
  { ...DEFAULT_DESIGN, bus: 'medium', panelArea: 18, panelType: 'tracking', comms: 'xband', payload: 'radar' },
  { ...DEFAULT_DESIGN, bus: 'smallsat', panelArea: 5, comms: 'sband', payload: 'imager' },
  { ...DEFAULT_DESIGN, bus: 'cubesat', panelArea: 0.8, comms: 'uhf', payload: 'science', panelType: 'deployable' },
];

export function TitleScene({ cinematic = false }) {
  const { camera } = useThree();
  const t = useRef(0);
  const sats = useRef([]);
  useFrame((_, dt) => {
    t.current += Math.min(dt, 0.05);
    const T = t.current;
    if (cinematic) {
      // intro: sweeping dolly from deep space to low orbit
      const k = Math.min(1, T / 14);
      const e = 1 - Math.pow(1 - k, 3);
      camera.position.set(Math.sin(T * 0.05) * (9 - e * 6.4), 1.8 - e * 1.1, Math.cos(T * 0.05) * (9 - e * 6.4));
      camera.lookAt(0.4 * e, 0, 0);
    } else {
      camera.position.set(Math.sin(T * 0.03) * 2.9 + 0.4, 0.55 + Math.sin(T * 0.07) * 0.08, Math.cos(T * 0.03) * 2.9);
      camera.lookAt(0.55, 0.15, 0);
    }
    sats.current.forEach((s, k) => {
      if (!s) return;
      const a = T * (0.12 - k * 0.025) + k * 2.1;
      const r = 1.18 + k * 0.12;
      const inc = [0.5, -0.3, 1.0][k];
      s.position.set(Math.cos(a) * r, Math.sin(a) * r * Math.sin(inc), Math.sin(a) * r * Math.cos(inc));
      s.rotation.y = -a;
    });
  });
  return (
    <>
      <color attach="background" args={['#000005']} />
      <Starfield />
      <ambientLight intensity={0.06} />
      <directionalLight position={[30, 8, 20]} intensity={2.6} />
      <Suspense fallback={null}><Earth sunDir={[0.8, -0.65, 0.35]} cloudSpeed={0.01} /></Suspense>
      {SHOWCASE.map((d, k) => (
        <group key={k} ref={(el) => (sats.current[k] = el)}>
          <SatelliteModel design={d} accent={['#4fd1ff', '#ffb547', '#7cff9b'][k]} scale={0.012} />
        </group>
      ))}
    </>
  );
}

export function DesignerScene({ design }) {
  const g = useRef();
  useFrame((_, dt) => { if (g.current) g.current.rotation.y += dt * 0.25; });
  const span = design.bus === 'medium' ? 9 : design.bus === 'cubesat' ? 3 : 6;
  return (
    <>
      <color attach="background" args={['#070b14']} />
      <fog attach="fog" args={['#070b14', 20, 60]} />
      <hemisphereLight args={['#bcd7ff', '#1b1410', 0.6]} />
      <directionalLight position={[5, 10, 6]} intensity={2.2} castShadow />
      <spotLight position={[-6, 8, -4]} intensity={60} angle={0.5} color="#4fd1ff" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.8, 0]} receiveShadow><circleGeometry args={[9, 64]} /><meshStandardMaterial color="#141b28" metalness={0.6} roughness={0.4} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.78, 0]}><ringGeometry args={[4.6, 4.8, 64]} /><meshBasicMaterial color="#4fd1ff" transparent opacity={0.6} /></mesh>
      {[0, 1, 2, 3, 4, 5].map((k) => <mesh key={k} position={[Math.cos(k) * 12, 4, Math.sin(k) * 12]}><boxGeometry args={[0.3, 12, 0.3]} /><meshStandardMaterial color="#1d2636" /></mesh>)}
      <group ref={g} scale={Math.min(1.6, 6 / span)}>
        <SatelliteModel design={design} accent={design.color || '#4fd1ff'} />
      </group>
      <Starfield count={1200} radius={80} />
      <OrbitControls enablePan={false} minDistance={3} maxDistance={18} makeDefault />
    </>
  );
}
