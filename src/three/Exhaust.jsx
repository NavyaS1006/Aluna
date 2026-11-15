// GPU-light particle exhaust & smoke (single InstancedMesh, recycled particles, no per-frame allocation).
import { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const tex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

export default function Exhaust({ active = true, activeFn, count = 500, kind = 'flame', origin = [0, 0, 0], rate = 1, spread = 1, getOrigin }) {
  const mesh = useRef();
  const parts = useMemo(() => Array.from({ length: count }, () => ({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), s: 1 })), [count]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: kind === 'flame' ? THREE.AdditiveBlending : THREE.NormalBlending, vertexColors: false, opacity: kind === 'flame' ? 1 : 0.45 }), [kind]);
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const spawnAcc = useRef(0);
  const o = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame(({ camera }, dt) => {
    if (!mesh.current) return;
    dt = Math.min(dt, 0.05);
    if (getOrigin) getOrigin(o); else o.set(...origin);
    if (activeFn ? activeFn() : active) {
      spawnAcc.current += dt * count * 1.6 * rate;
      while (spawnAcc.current > 1) {
        spawnAcc.current -= 1;
        const pt = parts.find((x) => x.life <= 0);
        if (!pt) break;
        pt.max = kind === 'flame' ? 0.35 + Math.random() * 0.25 : 2.5 + Math.random() * 3;
        pt.life = pt.max;
        pt.p.set(o.x + (Math.random() - 0.5) * spread, o.y, o.z + (Math.random() - 0.5) * spread);
        pt.v.set((Math.random() - 0.5) * (kind === 'flame' ? 3 : 8) * spread, kind === 'flame' ? -30 - Math.random() * 20 : -4 - Math.random() * 6, (Math.random() - 0.5) * (kind === 'flame' ? 3 : 8) * spread);
        pt.s = kind === 'flame' ? 2.4 * spread : 1.8 * spread;
      }
    }
    let i = 0;
    for (const pt of parts) {
      if (pt.life > 0) {
        pt.life -= dt;
        pt.p.addScaledVector(pt.v, dt);
        if (kind === 'smoke') { pt.v.multiplyScalar(0.985); pt.v.y += dt * 1.5; if (pt.p.y < 0.5) { pt.p.y = 0.5; pt.v.y = Math.abs(pt.v.y) * 0.2; pt.v.x *= 1.6; pt.v.z *= 1.6; } }
        const a = pt.life / pt.max;
        dummy.position.copy(pt.p);
        dummy.quaternion.copy(camera.quaternion);
        const sc = kind === 'flame' ? pt.s * (1.1 - (1 - a) * 0.6) : pt.s * (1 + (1 - a) * 2.2);
        dummy.scale.setScalar(sc);
        dummy.updateMatrix();
        mesh.current.setMatrixAt(i, dummy.matrix);
        if (kind === 'flame') color.setRGB(1, 0.6 + a * 0.35, 0.25 + a * 0.6).multiplyScalar(0.6 + a * 0.8);
        else color.setRGB(0.8, 0.78, 0.75).multiplyScalar(0.25 + a * 0.35);
        mesh.current.setColorAt(i, color);
        i++;
      }
    }
    mesh.current.count = i;
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geo, mat, count]} frustumCulled={false} />;
}
