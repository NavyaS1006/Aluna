// Procedural satellite built from the player's Mission Designer configuration.
// Bus size, solar array type/area, antenna, payload and thruster are all reflected in geometry.
import { useMemo } from 'react';
import * as THREE from 'three';

const foil = new THREE.MeshStandardMaterial({ color: '#c8962e', metalness: 0.9, roughness: 0.35, emissive: '#2a1a00', emissiveIntensity: 0.2 });
const white = new THREE.MeshStandardMaterial({ color: '#e8ecf2', metalness: 0.3, roughness: 0.5 });
const dark = new THREE.MeshStandardMaterial({ color: '#2a2f3a', metalness: 0.6, roughness: 0.4 });
const cellsMat = (() => {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#0b1a3a'; g.fillRect(0, 0, 128, 64);
  for (let x = 0; x < 8; x++) for (let y = 0; y < 4; y++) { g.fillStyle = `hsl(222, 70%, ${18 + ((x + y) % 2) * 4}%)`; g.fillRect(x * 16 + 1, y * 16 + 1, 14, 14); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshStandardMaterial({ map: t, metalness: 0.7, roughness: 0.25, emissive: '#0a1640', emissiveIntensity: 0.4 });
})();

export default function SatelliteModel({ design, accent = '#4fd1ff', scale = 1, deployed = 1, lost = false }) {
  const parts = useMemo(() => {
    const bus = design.bus === 'cubesat' ? [0.5, 0.5, 0.8] : design.bus === 'medium' ? [1.6, 1.6, 2.2] : [1, 1, 1.3];
    const wingArea = Math.max(0.2, design.panelArea);
    const wingLen = design.panelType === 'body' ? 0 : Math.min(6, Math.sqrt(wingArea) * (design.bus === 'cubesat' ? 1.2 : 1.1));
    const wingW = design.panelType === 'body' ? 0 : Math.max(0.4, wingArea / Math.max(0.5, wingLen * 2));
    return { bus, wingLen, wingW };
  }, [design.bus, design.panelArea, design.panelType]);
  const accentMat = useMemo(() => new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: lost ? 0 : 1.2 }), [accent, lost]);
  const { bus, wingLen, wingW } = parts;
  const busMat = lost ? dark : design.bus === 'cubesat' ? white : foil;
  return (
    <group scale={scale}>
      <mesh material={busMat} castShadow><boxGeometry args={bus} /></mesh>
      {/* accent identity band */}
      <mesh material={accentMat} position={[0, bus[1] / 2 + 0.01, 0]}><boxGeometry args={[bus[0] * 0.6, 0.02, bus[2] * 0.15]} /></mesh>
      {design.panelType === 'body' ? (
        <>
          <mesh material={cellsMat} position={[bus[0] / 2 + 0.01, 0, 0]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[bus[2] * 0.9, bus[1] * 0.9]} /></mesh>
          <mesh material={cellsMat} position={[-bus[0] / 2 - 0.01, 0, 0]} rotation={[0, -Math.PI / 2, 0]}><planeGeometry args={[bus[2] * 0.9, bus[1] * 0.9]} /></mesh>
        </>
      ) : (
        [1, -1].map((s) => (
          <group key={s} position={[s * (bus[0] / 2), 0, 0]} scale={[deployed, 1, 1]}>
            <mesh material={dark} position={[s * 0.15, 0, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.03, 0.03, 0.3, 6]} /></mesh>
            <mesh material={cellsMat} position={[s * (0.3 + wingLen / 2), 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[wingLen, wingW]} />
            </mesh>
            <mesh material={dark} position={[s * (0.3 + wingLen / 2), -0.01, 0]} rotation={[Math.PI / 2, 0, 0]}><planeGeometry args={[wingLen, wingW]} /></mesh>
          </group>
        ))
      )}
      {/* comms */}
      {design.comms === 'xband' && (
        <group position={[0, bus[1] / 2 + 0.25, bus[2] * 0.25]} rotation={[-0.6, 0, 0]}>
          <mesh material={white}><sphereGeometry args={[0.45, 20, 10, 0, Math.PI * 2, 0, 0.9]} /></mesh>
          <mesh material={dark} position={[0, 0.3, 0]}><cylinderGeometry args={[0.02, 0.02, 0.6]} /></mesh>
        </group>
      )}
      {design.comms === 'optical' && <mesh material={white} position={[0, bus[1] / 2 + 0.15, 0]}><cylinderGeometry args={[0.12, 0.15, 0.3, 16]} /></mesh>}
      {(design.comms === 'uhf' || design.comms === 'sband') && (
        <>
          <mesh material={white} position={[bus[0] * 0.3, -bus[1] / 2 - 0.25, 0]}><cylinderGeometry args={[0.01, 0.01, 0.5]} /></mesh>
          <mesh material={white} position={[-bus[0] * 0.3, -bus[1] / 2 - 0.25, 0]}><cylinderGeometry args={[0.01, 0.01, 0.5]} /></mesh>
        </>
      )}
      {/* payload */}
      {design.payload === 'imager' && <mesh material={dark} position={[0, -bus[1] / 2 - 0.12, -bus[2] * 0.2]}><cylinderGeometry args={[0.16, 0.2, 0.24, 20]} /></mesh>}
      {design.payload === 'radar' && <mesh material={white} position={[0, -bus[1] / 2 - 0.05, 0]}><boxGeometry args={[bus[0] * 1.8, 0.05, bus[2] * 0.9]} /></mesh>}
      {design.payload === 'relay' && <mesh material={white} position={[0, 0, bus[2] / 2 + 0.2]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[0.3, 0.4, 16, 1, true]} /></mesh>}
      {(design.payload === 'science' || design.payload === 'weather') && <mesh material={white} position={[0, -bus[1] / 2 - 0.1, 0]}><sphereGeometry args={[0.18, 16, 12]} /></mesh>}
      {/* thruster */}
      {design.propulsion !== 'none' && <mesh material={dark} position={[0, 0, -bus[2] / 2 - 0.1]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[0.12, 0.22, 12, 1, true]} /></mesh>}
      {design.sensors?.includes('star_tracker') && <mesh material={dark} position={[bus[0] * 0.35, bus[1] / 2 + 0.06, -bus[2] * 0.3]}><boxGeometry args={[0.1, 0.12, 0.1]} /></mesh>}
    </group>
  );
}
