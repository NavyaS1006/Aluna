import { useMemo } from 'react';
import * as THREE from 'three';
import { makeRng } from '../sim/rng.js';

/** Procedural star field with a faint galactic band; deterministic positions. */
export default function Starfield({ count = 6000, radius = 400 }) {
  const geo = useMemo(() => {
    const r = makeRng(7);
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count);
    const band = new THREE.Vector3(0.3, 0.9, 0.3).normalize();
    for (let i = 0; i < count; i++) {
      let v = new THREE.Vector3(r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)).normalize();
      if (i % 3 === 0) { // concentrate a third of stars near a great circle (galactic band)
        const k = v.dot(band); v = v.sub(band.clone().multiplyScalar(k * 0.85)).normalize();
      }
      v.multiplyScalar(radius);
      pos.set([v.x, v.y, v.z], i * 3);
      const t = r.next();
      const c = t < 0.15 ? [0.7, 0.8, 1] : t < 0.3 ? [1, 0.85, 0.7] : [1, 1, 1];
      const b = 0.4 + r.next() * 0.6;
      col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
      size[i] = r.next() < 0.02 ? 3.2 : 1 + r.next() * 1.4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    return g;
  }, [count, radius]);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: 'attribute float size; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * 1.5; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying vec3 vC; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vC, a); }',
    vertexColors: true, transparent: true, depthWrite: false,
  }), []);
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}
