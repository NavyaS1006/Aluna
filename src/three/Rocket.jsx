// Procedural launch vehicle — stages, side boosters, fairing size from the launcher & payload.
import { forwardRef, useMemo } from 'react';
import * as THREE from 'three';

const body = new THREE.MeshStandardMaterial({ color: '#eef1f5', metalness: 0.35, roughness: 0.45 });
const band = new THREE.MeshStandardMaterial({ color: '#141922', metalness: 0.5, roughness: 0.5 });
const engineMat = new THREE.MeshStandardMaterial({ color: '#3b3f46', metalness: 0.9, roughness: 0.3 });
const accentMat = new THREE.MeshStandardMaterial({ color: '#d9a441', metalness: 0.6, roughness: 0.3 });

export function rocketLayout(launcher) {
  const L = { light: { h: 22, r: 0.9, stages: 2, boosters: 0 }, medium: { h: 38, r: 1.6, stages: 2, boosters: 2 }, heavy: { h: 58, r: 2.3, stages: 3, boosters: 4 } }[launcher] || { h: 30, r: 1.4, stages: 2, boosters: 0 };
  const first = L.h * 0.55, second = L.stages === 3 ? L.h * 0.2 : L.h * 0.28, third = L.stages === 3 ? L.h * 0.1 : 0, fairing = L.h - first - second - third;
  return { ...L, first, second, third, fairing };
}

/** refs: stage1, boosters, stage2, fairingL, fairingR, upper — parents animate them during launch */
const Rocket = forwardRef(function Rocket({ launcher = 'medium', refs = {}, name = 'ALUNA' }, ref) {
  const L = useMemo(() => rocketLayout(launcher), [launcher]);
  const { r } = L;
  const y1 = L.first / 2, y2 = L.first + L.second / 2, y3 = L.first + L.second + L.third / 2, yf = L.first + L.second + L.third;
  return (
    <group ref={ref}>
      <group ref={refs.stage1}>
        <mesh material={body} position={[0, y1, 0]} castShadow><cylinderGeometry args={[r, r, L.first, 32]} /></mesh>
        <mesh material={band} position={[0, L.first * 0.82, 0]}><cylinderGeometry args={[r * 1.01, r * 1.01, 0.6, 32]} /></mesh>
        <mesh material={accentMat} position={[0, L.first * 0.5, r * 0.98]}><boxGeometry args={[r * 0.6, L.first * 0.35, 0.05]} /></mesh>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => {
          const a = (k / 9) * Math.PI * 2; const rr = k === 8 ? 0 : r * 0.55;
          return <mesh key={k} material={engineMat} position={[Math.cos(a) * rr, -0.4, Math.sin(a) * rr]}><cylinderGeometry args={[r * 0.12, r * 0.2, 0.9, 12, 1, true]} /></mesh>;
        })}
        {[0, 1, 2, 3].map((k) => <mesh key={k} material={band} position={[Math.cos(k * 1.571) * r, 1.2, Math.sin(k * 1.571) * r]} rotation={[0, -k * 1.571, 0]}><boxGeometry args={[0.1, 2.4, r * 0.8]} /></mesh>)}
      </group>
      <group ref={refs.boosters}>
        {Array.from({ length: L.boosters }).map((_, k) => {
          const a = (k / L.boosters) * Math.PI * 2 + Math.PI / 4;
          return (
            <group key={k} position={[Math.cos(a) * r * 1.75, 0, Math.sin(a) * r * 1.75]}>
              <mesh material={body} position={[0, L.first * 0.38, 0]}><cylinderGeometry args={[r * 0.6, r * 0.6, L.first * 0.76, 24]} /></mesh>
              <mesh material={body} position={[0, L.first * 0.8, 0]}><coneGeometry args={[r * 0.6, r * 1.6, 24]} /></mesh>
              <mesh material={engineMat} position={[0, -0.4, 0]}><cylinderGeometry args={[r * 0.25, r * 0.4, 0.9, 12, 1, true]} /></mesh>
            </group>
          );
        })}
      </group>
      <group ref={refs.stage2}>
        <mesh material={body} position={[0, y2, 0]}><cylinderGeometry args={[r, r, L.second, 32]} /></mesh>
        <mesh material={band} position={[0, L.first + 0.3, 0]}><cylinderGeometry args={[r * 1.01, r * 1.01, 0.6, 32]} /></mesh>
        {L.third > 0 && <mesh material={body} position={[0, y3, 0]}><cylinderGeometry args={[r * 0.95, r, L.third, 32]} /></mesh>}
      </group>
      <group ref={refs.upper} position={[0, yf, 0]}>
        <mesh material={band} position={[0, 0.4, 0]}><cylinderGeometry args={[r * 0.6, r * 0.9, 0.8, 24]} /></mesh>
      </group>
      {[1, -1].map((s) => (
        <group key={s} ref={s > 0 ? refs.fairingL : refs.fairingR} position={[0, yf, 0]}>
          <mesh material={body} position={[0, L.fairing * 0.35, 0]} rotation={[0, s > 0 ? 0 : Math.PI, 0]}><cylinderGeometry args={[r * 1.15, r * 1.05, L.fairing * 0.7, 32, 1, true, 0, Math.PI]} /></mesh>
          <mesh material={body} position={[0, L.fairing * 0.7 + L.fairing * 0.15, 0]} rotation={[0, s > 0 ? 0 : Math.PI, 0]}><sphereGeometry args={[r * 1.15, 32, 16, 0, Math.PI, 0, Math.PI / 2]} /></mesh>
        </group>
      ))}
      <mesh position={[0, L.first * 0.62, -r * 1.001]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[r * 1.2, L.first * 0.12]} />
        <meshBasicMaterial color="#0c1018" transparent opacity={0.85} />
      </mesh>
    </group>
  );
});
export default Rocket;
